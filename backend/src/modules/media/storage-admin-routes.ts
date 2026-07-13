// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { config } from '../../config/index.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { userHasGrant } from '../rbac/permission-group-service.js';
import { deleteObjectFrom } from '../../shared/storage/minio-client.js';
import { reconcileChatStorage } from './storage-reconciliation.js';

type FileKind = 'image' | 'video' | 'file' | 'audio';
type TargetType = 'all' | 'account' | 'group';
type SortBy = 'bytes' | 'files' | 'name';
const ALL_KINDS: FileKind[] = ['image', 'video', 'file', 'audio'];
const ALL_TARGETS: TargetType[] = ['all', 'account', 'group'];
const PREVIEW_TTL_MS = 30 * 60_000;
const PROCESSING_LEASE_MS = 10 * 60_000;
const CLEANUP_BATCH = 100;

const n = (value: unknown) => Number(value ?? 0);

function serializeRows(rows: any[]) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, typeof value === 'bigint' ? Number(value) : value],
  )));
}

function entitySelect() {
  return Prisma.sql`
    COUNT(DISTINCT s.object_id)::bigint AS "files",
    COALESCE(SUM(s.size_bytes), 0)::bigint AS "bytes",
    COUNT(DISTINCT s.object_id) FILTER (WHERE s.file_type = 'image')::bigint AS "image",
    COUNT(DISTINCT s.object_id) FILTER (WHERE s.file_type = 'video')::bigint AS "video",
    COUNT(DISTINCT s.object_id) FILTER (WHERE s.file_type = 'file')::bigint AS "file",
    COUNT(DISTINCT s.object_id) FILTER (WHERE s.file_type = 'audio')::bigint AS "audio"`;
}

function orgObjectsCte(orgId: string) {
  return Prisma.sql`
    SELECT DISTINCT o.id AS object_id, o.size_bytes, o.file_type, o.created_at
    FROM storage_objects o
    JOIN storage_object_references r ON r.object_id = o.id
    WHERE r.org_id = ${orgId}`;
}
function chatObjectsCte(orgId: string) {
  return Prisma.sql`
    SELECT DISTINCT o.id AS object_id, o.size_bytes, o.file_type, o.created_at
    FROM storage_objects o
    JOIN storage_object_references r ON r.object_id = o.id
    WHERE r.org_id = ${orgId} AND r.source = 'chat_message'`;
}

async function requireStorageAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user!;
  const userId = (user as any).userId ?? user.id;
  if (!await userHasGrant(userId, 'media', 'view_all')) {
    reply.status(403).send({ error: 'Chỉ quản trị viên được quản lý dung lượng.' });
    return null;
  }
  return { orgId: user.orgId, userId };
}

function parsePaging(query: any) {
  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(10, parseInt(String(query.pageSize || '25'), 10) || 25));
  const sort = (['bytes', 'files', 'name'].includes(query.sort) ? query.sort : 'bytes') as SortBy;
  const search = String(query.search || '').trim().slice(0, 100);
  return { page, pageSize, skip: (page - 1) * pageSize, sort, search };
}

function orderSql(sort: SortBy, nameColumn: string) {
  if (sort === 'name') return Prisma.raw(`${nameColumn} ASC`);
  if (sort === 'files') return Prisma.raw(`"files" DESC, ${nameColumn} ASC`);
  return Prisma.raw(`"bytes" DESC, ${nameColumn} ASC`);
}

function kindSql(kinds: FileKind[]) {
  return Prisma.join(kinds.map((kind) => Prisma.sql`${kind}`));
}

export function parseCleanupBody(value: unknown) {
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
  return {
    targetType: targetType as TargetType,
    targetId: typeof body.targetId === 'string' ? body.targetId : undefined,
    before,
    kinds: [...new Set(body.fileKinds as FileKind[])],
  };
}

async function resolveTarget(orgId: string, targetType: TargetType, targetId?: string) {
  if (targetType === 'all') return { id: null, name: 'Toàn bộ hệ thống' };
  if (!targetId) throw new Error('Cần chọn nhóm hoặc tài khoản.');
  if (targetType === 'account') {
    const account = await prisma.zaloAccount.findFirst({ where: { id: targetId, orgId }, select: { id: true, displayName: true, zaloUid: true } });
    if (!account) throw new Error('Tài khoản Zalo không tồn tại trong tổ chức.');
    return { id: account.id, name: account.displayName || account.zaloUid || 'Tài khoản Zalo' };
  }
  const group = await prisma.conversation.findFirst({
    where: { orgId, threadType: 'group', OR: [{ id: targetId }, { externalThreadId: targetId }] },
    select: { id: true, externalThreadId: true, groupName: true },
  });
  if (!group) throw new Error('Nhóm hội thoại Zalo không tồn tại trong tổ chức.');
  return { id: group.externalThreadId || group.id, name: group.groupName || 'Nhóm chưa có tên' };
}

async function removeExpiredPreviews(orgId: string) {
  await prisma.storageCleanupRun.deleteMany({
    where: { orgId, status: { in: ['previewing', 'previewed'] }, expiresAt: { lt: new Date() } },
  });
}

function formatRun(run: any) {
  return {
    ...run,
    bytesFreed: Number(run.bytesFreed),
    performedByName: run.performedBy?.fullName || 'Người dùng đã xóa',
    performedBy: undefined,
  };
}

export async function storageAdminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/media/storage/overview', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    const { orgId } = principal;
    await removeExpiredPreviews(orgId);
    const [totals, topAccounts, topGroups, fileTypes, daily, runs, unattributed, freed] = await Promise.all([
      prisma.$queryRaw<any[]>(Prisma.sql`WITH s AS (${orgObjectsCte(orgId)}) SELECT ${entitySelect()} FROM s`),
      prisma.$queryRaw<any[]>(Prisma.sql`
        WITH s AS (
          SELECT DISTINCT r.zalo_account_id AS entity_id, o.id AS object_id, o.size_bytes, o.file_type
          FROM storage_object_references r JOIN storage_objects o ON o.id=r.object_id
          WHERE r.org_id=${orgId} AND r.source='chat_message' AND r.zalo_account_id IS NOT NULL
        )
        SELECT z.id, COALESCE(z.display_name,'Chưa đặt tên') AS name, COALESCE(z.zalo_uid,'—') AS uid, ${entitySelect()}
        FROM zalo_accounts z JOIN s ON s.entity_id=z.id WHERE z.org_id=${orgId}
        GROUP BY z.id,z.display_name,z.zalo_uid ORDER BY "bytes" DESC LIMIT 10`),
      prisma.$queryRaw<any[]>(Prisma.sql`
        WITH refs AS (
          SELECT COALESCE(c.external_thread_id,c.id) AS entity_id, r.zalo_account_id,
                 o.id AS object_id, o.size_bytes, o.file_type
          FROM storage_object_references r
          JOIN storage_objects o ON o.id=r.object_id
          JOIN conversations c ON c.id=r.conversation_id
          WHERE r.org_id=${orgId} AND r.source='chat_message' AND c."threadType"='group'
        ), s AS (
          SELECT DISTINCT entity_id, object_id, size_bytes, file_type FROM refs
        ), a AS (
          SELECT entity_id, COUNT(DISTINCT zalo_account_id)::bigint AS account_count FROM refs GROUP BY entity_id
        ), g AS (
          SELECT COALESCE(external_thread_id,id) AS id, COALESCE(MAX(group_name),'Nhóm chưa có tên') AS name
          FROM conversations WHERE org_id=${orgId} AND "threadType"='group' GROUP BY COALESCE(external_thread_id,id)
        )
        SELECT g.id, g.name, COALESCE(a.account_count,0)::bigint AS "accountCount", ${entitySelect()}
        FROM g JOIN s ON s.entity_id=g.id LEFT JOIN a ON a.entity_id=g.id
        GROUP BY g.id,g.name,a.account_count ORDER BY "bytes" DESC LIMIT 10`),
      prisma.$queryRaw<any[]>(Prisma.sql`WITH s AS (${orgObjectsCte(orgId)}) SELECT file_type AS type, COUNT(*)::bigint AS files, COALESCE(SUM(size_bytes),0)::bigint AS bytes FROM s GROUP BY file_type ORDER BY bytes DESC`),
      prisma.$queryRaw<any[]>(Prisma.sql`
        WITH s AS (
          SELECT o.id, o.size_bytes, MIN(r.created_at) AS first_used
          FROM storage_objects o JOIN storage_object_references r ON r.object_id=o.id
          WHERE r.org_id=${orgId} AND r.source='chat_message' GROUP BY o.id,o.size_bytes
        )
        SELECT TO_CHAR(first_used AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS date, SUM(size_bytes)::bigint AS bytes
        FROM s WHERE first_used >= NOW() - INTERVAL '30 days' GROUP BY 1 ORDER BY 1`),
      prisma.storageCleanupRun.findMany({ where: { orgId }, take: 10, orderBy: { createdAt: 'desc' }, include: { performedBy: { select: { fullName: true } } } }),
      prisma.$queryRaw<any[]>(Prisma.sql`
        WITH missing AS (
          SELECT DISTINCT o.id, o.size_bytes
          FROM storage_objects o JOIN storage_object_references r ON r.object_id=o.id
          WHERE r.org_id=${orgId} AND r.source='chat_message' AND (r.zalo_account_id IS NULL OR r.conversation_id IS NULL)
        ) SELECT COUNT(*)::bigint AS files, COALESCE(SUM(size_bytes),0)::bigint AS bytes FROM missing`),
      prisma.storageCleanupRun.aggregate({ where: { orgId, status: { in: ['completed', 'partial'] } }, _sum: { bytesFreed: true } }),
    ]);
    const total: any = serializeRows(totals)[0] || { files: 0, bytes: 0, image: 0, video: 0, file: 0, audio: 0 };
    const capacityBytes = config.r2StorageCapBytes;
    return {
      storageDriver: config.storageDriver, total, capacityBytes,
      remainingBytes: capacityBytes > 0 ? Math.max(0, capacityBytes - total.bytes) : null,
      topAccounts: serializeRows(topAccounts), topGroups: serializeRows(topGroups),
      fileTypes: serializeRows(fileTypes), daily: serializeRows(daily),
      unattributed: serializeRows(unattributed)[0] || { files: 0, bytes: 0 },
      freedBytes: Number(freed._sum.bytesFreed || 0),
      runs: runs.map(formatRun),
    };
  });

  app.get('/api/v1/media/storage/entities', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    const q = request.query as any; const entity = q.entity === 'groups' ? 'groups' : 'accounts';
    const { page, pageSize, skip, sort, search } = parsePaging(q); const { orgId } = principal;
    const pattern = `%${search}%`;
    if (entity === 'accounts') {
      const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
        WITH s AS (
          SELECT DISTINCT r.zalo_account_id AS entity_id, o.id AS object_id, o.size_bytes, o.file_type
          FROM storage_object_references r JOIN storage_objects o ON o.id=r.object_id
          WHERE r.org_id=${orgId} AND r.source='chat_message' AND r.zalo_account_id IS NOT NULL
        ), agg AS (
          SELECT z.id, COALESCE(z.display_name,'Chưa đặt tên') name, COALESCE(z.zalo_uid,'—') uid, ${entitySelect()}
          FROM zalo_accounts z LEFT JOIN s ON s.entity_id=z.id
          WHERE z.org_id=${orgId} AND (${search}='' OR COALESCE(z.display_name,'') ILIKE ${pattern} OR COALESCE(z.zalo_uid,'') ILIKE ${pattern})
          GROUP BY z.id,z.display_name,z.zalo_uid
        ) SELECT *, COUNT(*) OVER()::bigint AS total FROM agg ORDER BY ${orderSql(sort, 'name')} LIMIT ${pageSize} OFFSET ${skip}`);
      return { items: serializeRows(rows), total: n(rows[0]?.total), page, pageSize };
    }
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      WITH refs AS (
        SELECT COALESCE(c.external_thread_id,c.id) AS entity_id, r.zalo_account_id,
               o.id AS object_id, o.size_bytes, o.file_type
        FROM storage_object_references r
        JOIN storage_objects o ON o.id=r.object_id
        JOIN conversations c ON c.id=r.conversation_id
        WHERE r.org_id=${orgId} AND r.source='chat_message' AND c."threadType"='group'
      ), s AS (
        SELECT DISTINCT entity_id, object_id, size_bytes, file_type FROM refs
      ), a AS (
        SELECT entity_id, COUNT(DISTINCT zalo_account_id)::bigint AS account_count FROM refs GROUP BY entity_id
      ), g AS (
        SELECT COALESCE(external_thread_id,id) AS id, COALESCE(MAX(group_name),'Nhóm chưa có tên') AS name
        FROM conversations WHERE org_id=${orgId} AND "threadType"='group' GROUP BY COALESCE(external_thread_id,id)
      ), agg AS (
        SELECT g.id, g.name, COALESCE(a.account_count,0)::bigint AS "accountCount", ${entitySelect()}
        FROM g LEFT JOIN s ON s.entity_id=g.id LEFT JOIN a ON a.entity_id=g.id
        WHERE (${search}='' OR g.name ILIKE ${pattern})
        GROUP BY g.id,g.name,a.account_count
      ) SELECT *, COUNT(*) OVER()::bigint AS total FROM agg ORDER BY ${orderSql(sort, 'name')} LIMIT ${pageSize} OFFSET ${skip}`);
    return { items: serializeRows(rows), total: n(rows[0]?.total), page, pageSize };
  });

  app.get('/api/v1/media/storage/history', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    const { page, pageSize, skip, search } = parsePaging(request.query as any);
    const where: Prisma.StorageCleanupRunWhereInput = {
      orgId: principal.orgId,
      ...(search ? { OR: [
        { targetName: { contains: search, mode: 'insensitive' } },
        { performedBy: { fullName: { contains: search, mode: 'insensitive' } } },
      ] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.storageCleanupRun.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' }, include: { performedBy: { select: { fullName: true } } } }),
      prisma.storageCleanupRun.count({ where }),
    ]);
    return { items: items.map(formatRun), total, page, pageSize };
  });

  app.post('/api/v1/media/storage/reconcile', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    const body = (request.body && typeof request.body === 'object' ? request.body : {}) as { cursor?: unknown; batch?: unknown };
    const cursor = typeof body.cursor === 'string' && body.cursor ? body.cursor : undefined;
    const batch = typeof body.batch === 'number' ? body.batch : undefined;
    try {
      return await reconcileChatStorage({ orgId: principal.orgId, cursor, batch });
    } catch (err: any) {
      return reply.status(500).send({ error: err?.message || 'Không đối soát được dữ liệu hội thoại cũ.' });
    }
  });
  app.post('/api/v1/media/storage/preview-cleanup', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    let runId: string | null = null;
    try {
      await removeExpiredPreviews(principal.orgId);
      const { targetType, targetId, before, kinds } = parseCleanupBody(request.body);
      const target = await resolveTarget(principal.orgId, targetType, targetId);
      const run = await prisma.storageCleanupRun.create({ data: {
        orgId: principal.orgId, performedById: principal.userId, targetType, targetId: target.id,
        targetName: target.name, beforeDate: before, fileKinds: kinds, status: 'previewing',
        expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
      } });
      runId = run.id;
      const targetCondition = targetType === 'account'
        ? Prisma.sql`AND r.zalo_account_id=${target.id}`
        : targetType === 'group'
          ? Prisma.sql`AND EXISTS (SELECT 1 FROM conversations gc WHERE gc.id=r.conversation_id AND gc.org_id=${principal.orgId} AND gc."threadType"='group' AND (gc.external_thread_id=${target.id} OR gc.id=${target.id}))`
          : Prisma.empty;
      await prisma.$executeRaw(Prisma.sql`
        WITH selected AS (
          SELECT o.id AS object_id, o.object_key, o.storage_driver, o.size_bytes, o.file_type,
                 ARRAY_AGG(r.id ORDER BY r.id) AS reference_ids
          FROM storage_object_references r JOIN storage_objects o ON o.id=r.object_id
          WHERE r.org_id=${principal.orgId} AND r.source='chat_message' AND r.created_at < ${before}
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
          ))::bigint AS shared
        FROM storage_cleanup_object_items i WHERE i.run_id=${run.id}`);
      const breakdown = serializeRows(rows)[0] || { files: 0, bytes: 0, selectedBytes: 0, image: 0, video: 0, file: 0, audio: 0, shared: 0 };
      await prisma.storageCleanupRun.update({ where: { id: run.id }, data: { status: 'previewed', breakdown } });
      return { runId: run.id, expiresAt: run.expiresAt, ...breakdown };
    } catch (err: any) {
      if (runId) await prisma.storageCleanupRun.update({ where: { id: runId }, data: { status: 'failed', errorSummary: { message: String(err?.message || err).slice(0, 1000) }, completedAt: new Date() } }).catch(() => {});
      return reply.status(400).send({ error: err?.message || 'Không tạo được bản xem trước.' });
    }
  });

  app.post('/api/v1/media/storage/execute-cleanup', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    const body = request.body as { runId?: unknown; confirm?: unknown; retryFailed?: unknown } | null;
    if (!body || body.confirm !== true || typeof body.runId !== 'string' || !body.runId) {
      return reply.status(400).send({ error: 'Thiếu snapshot hoặc xác nhận xóa.' });
    }
    const run = await prisma.storageCleanupRun.findFirst({ where: { id: body.runId, orgId: principal.orgId } });
    if (!run) return reply.status(404).send({ error: 'Snapshot không tồn tại.' });
    if (run.expiresAt && run.expiresAt < new Date() && run.status === 'previewed') {
      await prisma.storageCleanupRun.delete({ where: { id: run.id } }).catch(() => {});
      return reply.status(410).send({ error: 'Bản xem trước đã hết hạn. Hãy xem trước lại.' });
    }
    if (!['previewed', 'running', 'partial'].includes(run.status)) {
      return reply.status(409).send({ error: run.status === 'completed' ? 'Snapshot này đã hoàn tất.' : 'Snapshot không ở trạng thái có thể thực thi.' });
    }

    const staleBefore = new Date(Date.now() - PROCESSING_LEASE_MS);
    await prisma.storageCleanupItem.updateMany({ where: { runId: run.id, status: 'processing', updatedAt: { lt: staleBefore } }, data: { status: 'pending', error: 'Khôi phục batch bị gián đoạn.' } });
    if (body.retryFailed === true) {
      await prisma.storageCleanupItem.updateMany({ where: { runId: run.id, status: 'failed' }, data: { status: 'pending', error: null } });
    }
    await prisma.storageCleanupRun.updateMany({ where: { id: run.id, orgId: principal.orgId, status: { in: ['previewed', 'running', 'partial'] } }, data: { status: 'running', startedAt: run.startedAt || new Date(), completedAt: null } });

    const items = await prisma.$queryRaw<Array<{
      id: string; objectId: string; referenceIds: string[]; objectKey: string;
      storageDriver: string; sizeBytes: bigint; fileType: string;
    }>>(Prisma.sql`
      WITH claimed AS (
        SELECT id FROM storage_cleanup_object_items
        WHERE run_id=${run.id} AND status='pending'
        ORDER BY object_id FOR UPDATE SKIP LOCKED LIMIT ${CLEANUP_BATCH}
      )
      UPDATE storage_cleanup_object_items i SET status='processing', attempts=i.attempts+1, updated_at=NOW()
      FROM claimed WHERE i.id=claimed.id
      RETURNING i.id, i.object_id AS "objectId", i.reference_ids AS "referenceIds",
                i.object_key AS "objectKey", i.storage_driver AS "storageDriver",
                i.size_bytes AS "sizeBytes", i.file_type AS "fileType"`);

    let deleted = 0; let objectsDeleted = 0; let bytes = 0;
    for (const item of items) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM storage_objects WHERE id=${item.objectId} FOR UPDATE`);
          if (!locked.length) return { objectDeleted: false, freed: 0 };
          await tx.storageObjectReference.deleteMany({ where: { id: { in: item.referenceIds }, orgId: principal.orgId, source: 'chat_message' } });
          const remaining = await tx.storageObjectReference.count({ where: { objectId: item.objectId } });
          if (remaining > 0) return { objectDeleted: false, freed: 0 };
          const driver = item.storageDriver === 'r2' ? 'r2' : 'local';
          if (!await deleteObjectFrom(driver, item.objectKey)) throw new Error(`Không xóa được ${driver}:${item.objectKey}`);
          await tx.storageObject.delete({ where: { id: item.objectId } });
          return { objectDeleted: true, freed: Number(item.sizeBytes) };
        }, { maxWait: 10_000, timeout: 60_000 });
        await prisma.storageCleanupItem.update({ where: { id: item.id }, data: { status: 'deleted', error: null } });
        deleted += 1;
        if (result.objectDeleted) { objectsDeleted += 1; bytes += result.freed; }
      } catch (err: any) {
        await prisma.storageCleanupItem.update({ where: { id: item.id }, data: { status: 'failed', error: String(err?.message || err).slice(0, 1000) } });
      }
    }

    const grouped = await prisma.storageCleanupItem.groupBy({ by: ['status'], where: { runId: run.id }, _count: { _all: true } });
    const counts = Object.fromEntries(grouped.map((row) => [row.status, row._count._all]));
    const waiting = (counts.pending || 0) + (counts.processing || 0);
    const failed = counts.failed || 0;
    const status = waiting > 0 ? 'running' : failed > 0 ? 'partial' : 'completed';
    const errors = failed ? await prisma.storageCleanupItem.findMany({ where: { runId: run.id, status: 'failed' }, take: 20, select: { objectKey: true, error: true, attempts: true } }) : [];
    const updated = await prisma.storageCleanupRun.update({ where: { id: run.id }, data: {
      status, assetsDeleted: { increment: deleted }, objectsDeleted: { increment: objectsDeleted },
      bytesFreed: { increment: BigInt(bytes) }, failedCount: failed, errorSummary: errors,
      ...(waiting === 0 ? { completedAt: new Date() } : {}),
    } });
    return {
      ok: status === 'completed', runId: run.id, status, deleted, objectsDeleted, bytes, failed,
      hasMore: waiting > 0, totalDeleted: updated.assetsDeleted, totalBytes: Number(updated.bytesFreed),
    };
  });
}