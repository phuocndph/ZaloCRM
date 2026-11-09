// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * storage-cleanup-service.ts - shared core of the R2/local chat media cleanup.
 *
 * Both the admin button (preview-cleanup -> execute-cleanup) and the nightly
 * per-group schedule worker go through the SAME two functions here:
 *   createCleanupPreview()  snapshot the objects into storage_cleanup_object_items
 *   executeCleanupRun()     validate the snapshot and start the batch worker
 * so a scheduled run is indistinguishable from a manual one in the history.
 *
 * includeVisible (2026-11-09): normally an object still shown by a visible chat
 * message (is_deleted=false AND hidden_at IS NULL) is protected. With
 * includeVisible=true that guard is lifted ONLY for references inside the
 * selected groups. The message rows are never deleted; after the object is
 * physically removed every message that pointed at it gets
 * metadata.mediaPurged so the chat shows "Ảnh đã được dọn" instead of a
 * broken image.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { deleteObjectFrom } from '../../shared/storage/minio-client.js';

export type FileKind = 'image' | 'video' | 'file' | 'audio';
export type TargetType = 'all' | 'account' | 'group';
export const ALL_KINDS: FileKind[] = ['image', 'video', 'file', 'audio'];
export const ALL_TARGETS: TargetType[] = ['all', 'account', 'group'];
export const PREVIEW_TTL_MS = 30 * 60_000;
export const PROCESSING_LEASE_MS = 10 * 60_000;
export const MAX_TARGET_IDS = 200;
const CLEANUP_BATCH = 100;
const MEDIA_CONTENT_TYPES = Prisma.sql`('image','video','file','gif','voice','audio')`;

export const cleanupWorkers = new Map<string, Promise<void>>();

export function serializeRows(rows: any[]) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, typeof value === 'bigint' ? Number(value) : value],
  )));
}

export function kindSql(kinds: FileKind[]) {
  return Prisma.join(kinds.map((kind) => Prisma.sql`${kind}`));
}

export interface ParsedCleanup {
  targetType: TargetType;
  targetId?: string;
  targetIds: string[];
  before: Date;
  kinds: FileKind[];
  includeVisible: boolean;
}

export function parseCleanupBody(value: unknown): ParsedCleanup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Dữ liệu yêu cầu không hợp lệ.');
  const body = value as Record<string, unknown>;
  const targetType = body.targetType;
  if (typeof targetType !== 'string' || !ALL_TARGETS.includes(targetType as TargetType)) {
    throw new Error('Phạm vi dọn dữ liệu không hợp lệ.');
  }
  if (!Array.isArray(body.fileKinds) || body.fileKinds.length === 0 || !body.fileKinds.every((kind) => typeof kind === 'string' && ALL_KINDS.includes(kind as FileKind))) {
    throw new Error('Chọn ít nhất một loại dữ liệu hợp lệ.');
  }
  if (typeof body.beforeDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.beforeDate)) {
    throw new Error('Chọn ngày xóa hợp lệ.');
  }
  const before = new Date(`${body.beforeDate}T00:00:00+07:00`);
  if (Number.isNaN(before.getTime())) throw new Error('Chọn ngày xóa hợp lệ.');
  if (body.targetIds !== undefined && (!Array.isArray(body.targetIds) || !body.targetIds.every((id) => typeof id === 'string'))) {
    throw new Error('Danh sách nhóm không hợp lệ.');
  }
  const ids = [
    ...(Array.isArray(body.targetIds) ? body.targetIds as string[] : []),
    ...(typeof body.targetId === 'string' ? [body.targetId] : []),
  ].map((id) => id.trim()).filter(Boolean);
  const targetIds = [...new Set(ids)];
  if (targetIds.length > MAX_TARGET_IDS) throw new Error(`Chỉ chọn tối đa ${MAX_TARGET_IDS} mục mỗi lần.`);
  if (targetType === 'account' && targetIds.length > 1) throw new Error('Chỉ chọn một tài khoản Zalo mỗi lần.');
  const includeVisible = body.includeVisible === true;
  if (includeVisible && targetType !== 'group') {
    throw new Error('Tuỳ chọn xoá cả ảnh đang hiển thị chỉ dùng khi chọn nhóm cụ thể.');
  }
  return {
    targetType: targetType as TargetType,
    targetId: targetIds[0],
    targetIds: targetType === 'all' ? [] : targetIds,
    before,
    kinds: [...new Set(body.fileKinds as FileKind[])],
    includeVisible,
  };
}

/** SQL predicate: the reference's conversation is one of the selected groups. */
export function groupScopeSql(orgId: string, conversationColumn: Prisma.Sql, ids: string[]) {
  if (!ids.length) return Prisma.sql`FALSE`;
  const list = Prisma.join(ids.map((id) => Prisma.sql`${id}`));
  return Prisma.sql`EXISTS (
    SELECT 1 FROM conversations gc
    WHERE gc.id=${conversationColumn} AND gc.org_id=${orgId} AND gc."threadType"='group'
      AND (gc.external_thread_id IN (${list}) OR gc.id IN (${list})))`;
}

/**
 * Guard that keeps media of visible chat messages. With includeVisible the
 * guard still applies to references OUTSIDE the selected groups, so an object
 * shared with another group's visible message is never selected.
 */
export function protectedRefSql(orgId: string, includeVisible: boolean, groupIds: string[]) {
  const lift = includeVisible && groupIds.length
    ? Prisma.sql`AND NOT ${groupScopeSql(orgId, Prisma.raw('protected_ref.conversation_id'), groupIds)}`
    : Prisma.empty;
  return Prisma.sql`NOT EXISTS (
    SELECT 1
    FROM storage_object_references protected_ref
    JOIN messages protected_message ON protected_message.id=protected_ref.message_id
    WHERE protected_ref.object_id=o.id
      AND protected_ref.source='chat_message'
      AND protected_message.is_deleted=false
      AND protected_message.hidden_at IS NULL
      AND protected_message.content_type IN ${MEDIA_CONTENT_TYPES}
      ${lift}
  )`;
}

export async function resolveTargets(orgId: string, targetType: TargetType, ids: string[]) {
  if (targetType === 'all') return { ids: [] as string[], name: 'Toàn bộ hệ thống' };
  if (!ids.length) throw new Error('Cần chọn nhóm hoặc tài khoản.');
  if (targetType === 'account') {
    const account = await prisma.zaloAccount.findFirst({ where: { id: ids[0], orgId }, select: { id: true, displayName: true, zaloUid: true } });
    if (!account) throw new Error('Tài khoản Zalo không tồn tại trong tổ chức.');
    return { ids: [account.id], name: account.displayName || account.zaloUid || 'Tài khoản Zalo' };
  }
  const groups = await prisma.conversation.findMany({
    where: { orgId, threadType: 'group', OR: [{ id: { in: ids } }, { externalThreadId: { in: ids } }] },
    select: { id: true, externalThreadId: true, groupName: true },
  });
  const resolved = new Map<string, string>();
  for (const id of ids) {
    const group = groups.find((row) => row.id === id || row.externalThreadId === id);
    if (!group) throw new Error('Nhóm hội thoại Zalo không tồn tại trong tổ chức.');
    const key = group.externalThreadId || group.id;
    if (!resolved.has(key) || (!resolved.get(key) && group.groupName)) resolved.set(key, group.groupName || '');
  }
  const names = [...resolved.values()].map((name) => name || 'Nhóm chưa có tên');
  const name = names.length === 1 ? names[0] : `${names.length} nhóm: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '...' : ''}`;
  return { ids: [...resolved.keys()], name: name.slice(0, 500) };
}

export async function removeExpiredPreviews(orgId: string) {
  await prisma.storageCleanupRun.deleteMany({
    where: { orgId, status: { in: ['previewing', 'previewed'] }, expiresAt: { lt: new Date() } },
  });
}

export interface PreviewBreakdown {
  files: number; linksToRemove: number; objectsToDelete: number; bytes: number; selectedBytes: number;
  image: number; video: number; file: number; audio: number; shared: number; linksKept: number;
  visibleMessages: number; gb: number; targetCount: number; includeVisible: boolean;
}

export interface PreviewInput extends ParsedCleanup {
  orgId: string;
  performedById: string | null;
  trigger?: 'manual' | 'schedule';
  scheduleId?: string | null;
  targetName?: string;
}

/** Snapshot the objects a cleanup would touch. Never deletes anything. */
export async function createCleanupPreview(input: PreviewInput) {
  const { orgId, targetType, before, kinds, includeVisible } = input;
  await removeExpiredPreviews(orgId);
  const target = await resolveTargets(orgId, targetType, input.targetIds);
  const run = await prisma.storageCleanupRun.create({ data: {
    orgId, performedById: input.performedById, targetType, targetId: target.ids[0] ?? null,
    targetIds: target.ids, includeVisible, trigger: input.trigger || 'manual', scheduleId: input.scheduleId ?? null,
    targetName: input.targetName || target.name, beforeDate: before, fileKinds: kinds, status: 'previewing',
    expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
  } });
  try {
    const targetCondition = targetType === 'account'
      ? Prisma.sql`AND r.zalo_account_id=${target.ids[0]}`
      : targetType === 'group'
        ? Prisma.sql`AND ${groupScopeSql(orgId, Prisma.raw('r.conversation_id'), target.ids)}`
        : Prisma.empty;
    await prisma.$executeRaw(Prisma.sql`
      WITH selected AS (
        SELECT o.id AS object_id, o.object_key, o.storage_driver, o.size_bytes, o.file_type,
               ARRAY_AGG(r.id ORDER BY r.id) AS reference_ids
        FROM storage_object_references r JOIN storage_objects o ON o.id=r.object_id
        WHERE r.org_id=${orgId} AND r.source='chat_message' AND r.created_at < ${before}
          AND ${protectedRefSql(orgId, includeVisible, target.ids)}
          AND o.file_type IN (${kindSql(kinds)}) ${targetCondition}
        GROUP BY o.id,o.object_key,o.storage_driver,o.size_bytes,o.file_type
      )
      INSERT INTO storage_cleanup_object_items
        (id,run_id,object_id,reference_ids,object_key,storage_driver,size_bytes,file_type,status,attempts,updated_at)
      SELECT gen_random_uuid()::text, ${run.id}, object_id, reference_ids, object_key, storage_driver,
             size_bytes, file_type, 'pending', 0, NOW()
      FROM selected ON CONFLICT (run_id,object_id) DO NOTHING`);
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS files,
        COALESCE(SUM(cardinality(i.reference_ids)),0)::bigint AS "linksToRemove",
        COUNT(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM storage_object_references r WHERE r.object_id=i.object_id AND NOT (r.id=ANY(i.reference_ids))
        ))::bigint AS "objectsToDelete",
        COALESCE(SUM(i.size_bytes) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM storage_object_references r WHERE r.object_id=i.object_id AND NOT (r.id=ANY(i.reference_ids))
        )),0)::bigint AS bytes,
        COALESCE(SUM(i.size_bytes),0)::bigint AS "selectedBytes",
        COUNT(*) FILTER (WHERE i.file_type='image')::bigint AS image,
        COUNT(*) FILTER (WHERE i.file_type='video')::bigint AS video,
        COUNT(*) FILTER (WHERE i.file_type='file')::bigint AS file,
        COUNT(*) FILTER (WHERE i.file_type='audio')::bigint AS audio,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM storage_object_references r WHERE r.object_id=i.object_id AND NOT (r.id=ANY(i.reference_ids))
        ))::bigint AS shared,
        COALESCE(SUM((SELECT COUNT(*) FROM storage_object_references r WHERE r.object_id=i.object_id AND NOT (r.id=ANY(i.reference_ids)))),0)::bigint AS "linksKept",
        COALESCE(SUM((SELECT COUNT(*) FROM storage_object_references r JOIN messages m ON m.id=r.message_id
          WHERE r.id=ANY(i.reference_ids) AND m.is_deleted=false AND m.hidden_at IS NULL)),0)::bigint AS "visibleMessages"
      FROM storage_cleanup_object_items i WHERE i.run_id=${run.id}`);
    const raw: Record<string, any> = serializeRows(rows)[0] || { files: 0, linksToRemove: 0, objectsToDelete: 0, bytes: 0, selectedBytes: 0, image: 0, video: 0, file: 0, audio: 0, shared: 0, linksKept: 0, visibleMessages: 0 };
    const breakdown: PreviewBreakdown = {
      files: 0, linksToRemove: 0, objectsToDelete: 0, bytes: 0, selectedBytes: 0, image: 0, video: 0, file: 0, audio: 0, shared: 0, linksKept: 0, visibleMessages: 0,
      ...raw,
      gb: Math.round(Number(raw.bytes || 0) / 1024 ** 3 * 100) / 100,
      targetCount: target.ids.length,
      includeVisible,
    };
    await prisma.storageCleanupRun.update({ where: { id: run.id }, data: { status: 'previewed', breakdown: { ...breakdown } } });
    return { runId: run.id, expiresAt: run.expiresAt, targetIds: target.ids, targetName: input.targetName || target.name, ...breakdown };
  } catch (err: any) {
    await prisma.storageCleanupRun.update({ where: { id: run.id }, data: { status: 'failed', errorSummary: { message: String(err?.message || err).slice(0, 1000) }, completedAt: new Date() } }).catch(() => {});
    throw err;
  }
}

export async function processCleanupBatch(runId: string, orgId: string, retryFailed = false) {
  const run = await prisma.storageCleanupRun.findFirst({ where: { id: runId, orgId } });
  if (!run) throw new Error('Cleanup snapshot no longer exists.');
  const liftedGroups = run.includeVisible && run.targetType === 'group' ? (run.targetIds?.length ? run.targetIds : run.targetId ? [run.targetId] : []) : [];
  const staleBefore = new Date(Date.now() - PROCESSING_LEASE_MS);
  await prisma.storageCleanupItem.updateMany({ where: { runId, status: { in: ['processing', 'deleting'] }, updatedAt: { lt: staleBefore } }, data: { status: 'pending', error: 'Recovered after an interrupted batch.' } });
  if (retryFailed) await prisma.storageCleanupItem.updateMany({ where: { runId, status: 'failed' }, data: { status: 'pending', error: null } });
  await prisma.storageCleanupRun.update({ where: { id: runId }, data: { status: 'running', startedAt: run.startedAt || new Date(), completedAt: null } });
  const items = await prisma.$queryRaw<Array<{ id: string; objectId: string; referenceIds: string[]; objectKey: string; storageDriver: string; sizeBytes: bigint; fileType: string }>>(Prisma.sql`
    WITH claimed AS (
      SELECT id FROM storage_cleanup_object_items WHERE run_id=${runId} AND status='pending'
      ORDER BY object_id FOR UPDATE SKIP LOCKED LIMIT ${CLEANUP_BATCH}
    )
    UPDATE storage_cleanup_object_items i SET status='processing', attempts=i.attempts+1, updated_at=NOW()
    FROM claimed WHERE i.id=claimed.id
    RETURNING i.id, i.object_id AS "objectId", i.reference_ids AS "referenceIds", i.object_key AS "objectKey",
      i.storage_driver AS "storageDriver", i.size_bytes AS "sizeBytes", i.file_type AS "fileType"`);
  const lift = liftedGroups.length
    ? Prisma.sql`AND NOT ${groupScopeSql(orgId, Prisma.raw('r.conversation_id'), liftedGroups)}`
    : Prisma.empty;
  let linksRemoved = 0; let objectsDeleted = 0; let bytesFreed = 0;
  for (const item of items) {
    try {
      // Commit database intent before the external side effect. A storage delete must
      // never occur inside this transaction, otherwise a DB rollback can resurrect
      // metadata for a file that has already been physically removed.
      const prepared = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM storage_objects WHERE id=${item.objectId} FOR UPDATE`);
        if (!locked.length) return { protected: false, objectMissing: true, needsPhysicalDelete: false, links: 0, messageIds: [] as string[] };
        // A chat media object is durable history. Even an old cleanup snapshot
        // must not remove references for a message still visible in chat,
        // unless the owner explicitly included visible media of these groups.
        const activeMessage = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT m.id
          FROM storage_object_references r
          JOIN messages m ON m.id=r.message_id
          WHERE r.object_id=${item.objectId}
            AND r.source='chat_message'
            AND m.is_deleted=false
            AND m.hidden_at IS NULL
            AND m.content_type IN ${MEDIA_CONTENT_TYPES}
            ${lift}
          LIMIT 1`);
        if (activeMessage.length > 0) {
          return { protected: true, objectMissing: false, needsPhysicalDelete: false, links: 0, messageIds: [] as string[] };
        }
        const refs = await tx.storageObjectReference.findMany({ where: { id: { in: item.referenceIds }, orgId, source: 'chat_message' }, select: { messageId: true } });
        const messageIds = [...new Set(refs.map((ref) => ref.messageId).filter((id): id is string => !!id))];
        const removed = await tx.storageObjectReference.deleteMany({ where: { id: { in: item.referenceIds }, orgId, source: 'chat_message' } });
        const remaining = await tx.storageObjectReference.count({ where: { objectId: item.objectId } });
        if (remaining > 0) return { protected: false, objectMissing: false, needsPhysicalDelete: false, links: removed.count, messageIds };
        await tx.storageCleanupItem.update({ where: { id: item.id }, data: { status: 'deleting', error: null } });
        return { protected: false, objectMissing: false, needsPhysicalDelete: true, links: removed.count, messageIds };
      }, { maxWait: 10_000, timeout: 60_000 });
      if (prepared.protected) {
        await prisma.storageCleanupItem.update({ where: { id: item.id }, data: { status: 'protected', error: 'Chat media is retained while its message remains active.' } });
        continue;
      }
      linksRemoved += prepared.links;
      if (!prepared.needsPhysicalDelete) {
        await prisma.storageCleanupItem.update({ where: { id: item.id }, data: { status: 'deleted', error: null } });
        continue;
      }
      const driver = item.storageDriver === 'r2' ? 'r2' : 'local';
      if (!await deleteObjectFrom(driver, item.objectKey)) throw new Error(`Unable to delete ${driver}:${item.objectKey}`);
      // Finalize only after external deletion. A new reference is surfaced as a
      // retryable inconsistency instead of silently deleting live metadata.
      const finalized = await prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM storage_objects WHERE id=${item.objectId} FOR UPDATE`);
        if (!locked.length) return { deleted: false, reason: 'metadata already removed' };
        const remaining = await tx.storageObjectReference.count({ where: { objectId: item.objectId } });
        if (remaining > 0) return { deleted: false, reason: 'new references were created after the storage object was removed' };
        await tx.storageObject.delete({ where: { id: item.objectId } });
        await markMessagesMediaPurged(tx, prepared.messageIds, { runId, fileType: item.fileType });
        return { deleted: true, reason: '' };
      }, { maxWait: 10_000, timeout: 60_000 });
      if (!finalized.deleted) throw new Error(`Storage object deleted but metadata finalization failed: ${finalized.reason}`);
      await prisma.storageCleanupItem.update({ where: { id: item.id }, data: { status: 'deleted', error: null } });
      objectsDeleted += 1; bytesFreed += Number(item.sizeBytes);
    } catch (err: any) {
      await prisma.storageCleanupItem.update({ where: { id: item.id }, data: { status: 'failed', error: String(err?.message || err).slice(0, 1000) } });
    }
  }
  const grouped = await prisma.storageCleanupItem.groupBy({ by: ['status'], where: { runId }, _count: { _all: true } });
  const counts = Object.fromEntries(grouped.map((row) => [row.status, row._count._all])) as Record<string, number>;
  const waiting = (counts.pending || 0) + (counts.processing || 0) + (counts.deleting || 0);
  const failed = counts.failed || 0;
  const status = waiting ? 'running' : failed ? 'partial' : 'completed';
  const errors = failed ? await prisma.storageCleanupItem.findMany({ where: { runId, status: 'failed' }, take: 20, select: { objectKey: true, error: true, attempts: true } }) : [];
  const updated = await prisma.storageCleanupRun.update({ where: { id: runId }, data: {
    status, assetsDeleted: { increment: linksRemoved }, objectsDeleted: { increment: objectsDeleted }, bytesFreed: { increment: BigInt(bytesFreed) },
    failedCount: failed, errorSummary: errors, ...(waiting ? {} : { completedAt: new Date() }),
  } });
  return { run: updated, hasMore: waiting > 0 };
}

/**
 * Keep the message row, flag its media as purged. The chat UI renders
 * "Ảnh đã được dọn" for these instead of trying to load a missing object.
 */
export async function markMessagesMediaPurged(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, messageIds: string[], info: { runId: string; fileType: string }) {
  if (!messageIds.length) return 0;
  const marker = JSON.stringify({ at: new Date().toISOString(), runId: info.runId, fileType: info.fileType });
  return tx.$executeRaw(Prisma.sql`
    UPDATE messages
    SET metadata = (CASE WHEN jsonb_typeof(metadata::jsonb)='object' THEN metadata::jsonb ELSE '{}'::jsonb END)
                   || jsonb_build_object('mediaPurged', ${marker}::jsonb)
    WHERE id IN (${Prisma.join(messageIds.map((id) => Prisma.sql`${id}`))})`);
}

export function startCleanupWorker(runId: string, orgId: string, retryFailed = false): Promise<void> {
  const existing = cleanupWorkers.get(runId);
  if (existing) return existing;
  const job = (async () => {
    try {
      let result = await processCleanupBatch(runId, orgId, retryFailed);
      while (result.hasMore) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        result = await processCleanupBatch(runId, orgId, false);
      }
    } catch (err: any) {
      await prisma.storageCleanupRun.update({ where: { id: runId }, data: { status: 'failed', completedAt: new Date(), errorSummary: { message: String(err?.message || err).slice(0, 1000) } } }).catch(() => {});
    } finally { cleanupWorkers.delete(runId); }
  })();
  cleanupWorkers.set(runId, job);
  return job;
}

export class CleanupExecuteError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

/** Same checks the execute-cleanup button goes through, then starts the worker. */
export async function executeCleanupRun(input: { runId: string; orgId: string; retryFailed?: boolean }) {
  const run = await prisma.storageCleanupRun.findFirst({ where: { id: input.runId, orgId: input.orgId } });
  if (!run) throw new CleanupExecuteError(404, 'Cleanup snapshot not found.');
  if (run.expiresAt && run.expiresAt < new Date() && run.status === 'previewed') throw new CleanupExecuteError(410, 'Cleanup preview has expired. Create a new preview.');
  if (!['previewed', 'running', 'partial'].includes(run.status)) throw new CleanupExecuteError(409, run.status === 'completed' ? 'This cleanup already completed.' : 'This cleanup cannot be executed.');
  await prisma.storageCleanupRun.update({ where: { id: run.id }, data: { status: 'running', startedAt: run.startedAt || new Date(), completedAt: null } });
  const done = startCleanupWorker(run.id, input.orgId, input.retryFailed === true);
  return { runId: run.id, done };
}
