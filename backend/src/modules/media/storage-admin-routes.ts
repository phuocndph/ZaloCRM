// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { config } from '../../config/index.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { userHasGrant } from '../rbac/permission-group-service.js';
import { reconcileChatStorage } from './storage-reconciliation.js';
import {
  ALL_KINDS, CleanupExecuteError, cleanupWorkers, createCleanupPreview, executeCleanupRun,
  parseCleanupBody, resolveTargets, serializeRows, startCleanupWorker, type FileKind, type TargetType,
} from './storage-cleanup-service.js';
import { normalizeScheduleInput, describeSchedule } from './storage-group-cleanup-cron.js';

export { parseCleanupBody };

type SortBy = 'bytes' | 'files' | 'name' | 'oldest';
const reconciliationWorkers = new Set<string>();

const n = (value: unknown) => Number(value ?? 0);
const DEFAULT_STORAGE_POLICY = {
  quotaAlertPercent: 80,
  anomalyMultiplier: 2,
  retentionDays: 0,
  retentionFileKinds: [] as string[],
};


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
  const sort = (['bytes', 'files', 'name', 'oldest'].includes(query.sort) ? query.sort : 'bytes') as SortBy;
  const search = String(query.search || '').trim().slice(0, 100);
  return { page, pageSize, skip: (page - 1) * pageSize, sort, search };
}

function orderSql(sort: SortBy, nameColumn: string) {
  if (sort === 'name') return Prisma.raw(`${nameColumn} ASC`);
  if (sort === 'files') return Prisma.raw(`"files" DESC, ${nameColumn} ASC`);
  if (sort === 'oldest') return Prisma.raw(`"oldestAt" ASC NULLS LAST, ${nameColumn} ASC`);
  return Prisma.raw(`"bytes" DESC, ${nameColumn} ASC`);
}

function formatRun(run: any) {
  return {
    ...run,
    bytesFreed: Number(run.bytesFreed),
    performedByName: run.trigger === 'schedule' ? 'Lịch tự dọn' : run.performedBy?.fullName || 'Người dùng đã xóa',
    performedBy: undefined,
  };
}

async function cleanupProgress(run: any) {
  const grouped = await prisma.storageCleanupItem.groupBy({ by: ['status'], where: { runId: run.id }, _count: { _all: true } });
  const counts = Object.fromEntries(grouped.map((row) => [row.status, row._count._all])) as Record<string, number>;
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const processed = (counts.deleted || 0) + (counts.failed || 0) + (counts.protected || 0);
  return {
    ...formatRun(run), totalItems: total, processedItems: processed, pendingItems: counts.pending || 0,
    processingItems: (counts.processing || 0) + (counts.deleting || 0), deletedItems: counts.deleted || 0,
    protectedItems: counts.protected || 0,
    percent: total ? Math.round(processed / total * 100) : 100,
    workerActive: cleanupWorkers.has(run.id),
  };
}

function startReconciliationWorker(runId: string, orgId: string) {
  if (reconciliationWorkers.has(runId)) return;
  reconciliationWorkers.add(runId);
  void (async () => {
    try {
      let cursor: string | undefined; let hasMore = true;
      while (hasMore) {
        const result = await reconcileChatStorage({ orgId, cursor, batch: 100 });
        await prisma.storageReconciliationRun.update({ where: { id: runId }, data: {
          scanned: { increment: result.scanned }, references: { increment: result.references },
          missing: { increment: result.missing }, skipped: { increment: result.skipped },
        } });
        cursor = result.nextCursor || undefined; hasMore = result.hasMore;
        if (hasMore) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await prisma.storageReconciliationRun.update({ where: { id: runId }, data: { status: 'completed', completedAt: new Date() } });
    } catch (err: any) {
      await prisma.storageReconciliationRun.update({ where: { id: runId }, data: { status: 'failed', completedAt: new Date(), errorSummary: { message: String(err?.message || err).slice(0, 1000) } } }).catch(() => {});
    } finally { reconciliationWorkers.delete(runId); }
  })();
}
export async function storageAdminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);
  // Resume interrupted cleanups after a process restart; snapshots and item leases make this idempotent.
  void prisma.storageCleanupRun.findMany({ where: { status: 'running' } }).then((runs) => runs.forEach((run) => startCleanupWorker(run.id, run.orgId))).catch(() => {});
  void prisma.storageReconciliationRun.findMany({ where: { status: 'running' } }).then((runs) => runs.forEach((run) => startReconciliationWorker(run.id, run.orgId))).catch(() => {});

  app.get('/api/v1/media/storage/overview', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    const { orgId } = principal;
    const [totals, topAccounts, topGroups, fileTypes, daily, runs, unattributed, freed, policy, latestReconciliation, orphanMetadata] = await Promise.all([
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
        WITH dates AS (
          SELECT TO_CHAR(day AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS date
          FROM generate_series(date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') - INTERVAL '29 days', date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh'), INTERVAL '1 day') day
        ), s AS (
          SELECT o.id, o.size_bytes, MIN(r.created_at) AS first_used
          FROM storage_objects o JOIN storage_object_references r ON r.object_id=o.id
          WHERE r.org_id=${orgId} AND r.source='chat_message' GROUP BY o.id,o.size_bytes
        ), sums AS (
          SELECT TO_CHAR(first_used AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS date, SUM(size_bytes)::bigint AS bytes
          FROM s WHERE first_used >= NOW() - INTERVAL '30 days' GROUP BY 1
        ) SELECT dates.date, COALESCE(sums.bytes,0)::bigint AS bytes FROM dates LEFT JOIN sums ON sums.date=dates.date ORDER BY dates.date`),
      prisma.storageCleanupRun.findMany({ where: { orgId }, take: 10, orderBy: { createdAt: 'desc' }, include: { performedBy: { select: { fullName: true } } } }),
      prisma.$queryRaw<any[]>(Prisma.sql`
        WITH missing AS (
          SELECT DISTINCT o.id, o.size_bytes
          FROM storage_objects o JOIN storage_object_references r ON r.object_id=o.id
          WHERE r.org_id=${orgId} AND r.source='chat_message' AND (r.zalo_account_id IS NULL OR r.conversation_id IS NULL)
        ) SELECT COUNT(*)::bigint AS files, COALESCE(SUM(size_bytes),0)::bigint AS bytes FROM missing`),
      prisma.storageCleanupRun.aggregate({ where: { orgId, status: { in: ['completed', 'partial'] } }, _sum: { bytesFreed: true } }),
      prisma.storageManagementPolicy.findUnique({ where: { orgId } }),
      prisma.storageReconciliationRun.findFirst({ where: { orgId }, orderBy: { createdAt: 'desc' } }),
      prisma.$queryRaw<any[]>(Prisma.sql`
        SELECT COUNT(DISTINCT o.id)::bigint AS files, COALESCE(SUM(DISTINCT o.size_bytes),0)::bigint AS bytes
        FROM storage_objects o
        JOIN storage_cleanup_object_items i ON i.object_id=o.id
        JOIN storage_cleanup_runs run ON run.id=i.run_id AND run.org_id=${orgId}
        WHERE NOT EXISTS (SELECT 1 FROM storage_object_references r WHERE r.object_id=o.id)`),
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
      policy: policy
        ? { quotaAlertPercent: policy.quotaAlertPercent, anomalyMultiplier: policy.anomalyMultiplier, retentionDays: policy.retentionDays, retentionFileKinds: policy.retentionFileKinds }
        : DEFAULT_STORAGE_POLICY,
      latestReconciliation: latestReconciliation ? { ...latestReconciliation, workerActive: reconciliationWorkers.has(latestReconciliation.id) } : null,
      orphanMetadata: serializeRows(orphanMetadata)[0] || { files: 0, bytes: 0 },
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
    // Every Zalo group of the org (also the ones without media), paged, with
    // GB and the date of the oldest chat media reference (the cleanup cutoff
    // compares reference dates), plus the nightly schedule state if any.
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      WITH refs AS (
        SELECT COALESCE(c.external_thread_id,c.id) AS entity_id, r.zalo_account_id, r.created_at AS ref_created_at,
               o.id AS object_id, o.size_bytes, o.file_type
        FROM storage_object_references r
        JOIN storage_objects o ON o.id=r.object_id
        JOIN conversations c ON c.id=r.conversation_id
        WHERE r.org_id=${orgId} AND r.source='chat_message' AND c."threadType"='group'
      ), s AS (
        SELECT DISTINCT entity_id, object_id, size_bytes, file_type FROM refs
      ), a AS (
        SELECT entity_id, COUNT(DISTINCT zalo_account_id)::bigint AS account_count,
               MIN(ref_created_at) AS oldest_at, MAX(ref_created_at) AS newest_at
        FROM refs GROUP BY entity_id
      ), g AS (
        SELECT COALESCE(external_thread_id,id) AS id, COALESCE(MAX(group_name),'Nhóm chưa có tên') AS name
        FROM conversations WHERE org_id=${orgId} AND "threadType"='group' GROUP BY COALESCE(external_thread_id,id)
      ), agg AS (
        SELECT g.id, g.name, COALESCE(a.account_count,0)::bigint AS "accountCount",
               a.oldest_at AS "oldestAt", a.newest_at AS "newestAt", ${entitySelect()}
        FROM g LEFT JOIN s ON s.entity_id=g.id LEFT JOIN a ON a.entity_id=g.id
        WHERE (${search}='' OR g.name ILIKE ${pattern} OR g.id ILIKE ${pattern})
        GROUP BY g.id,g.name,a.account_count,a.oldest_at,a.newest_at
      ) SELECT agg.*, COUNT(*) OVER()::bigint AS total,
               sch.enabled AS "scheduleEnabled", sch.retention_days AS "scheduleRetentionDays"
        FROM agg LEFT JOIN storage_group_cleanup_schedules sch ON sch.org_id=${orgId} AND sch.group_id=agg.id
        ORDER BY ${orderSql(sort, 'name')} LIMIT ${pageSize} OFFSET ${skip}`);
    const items = serializeRows(rows).map((row) => ({ ...row, gb: Math.round(Number(row.bytes || 0) / 1024 ** 3 * 100) / 100, total: undefined }));
    return { items, total: n(rows[0]?.total), page, pageSize };
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
    const body = (request.body && typeof request.body === 'object' ? request.body : {}) as { confirm?: unknown };
    if (body.confirm !== true) return reply.status(400).send({ error: 'Confirm reconciliation before starting it.' });
    const active = await prisma.storageReconciliationRun.findFirst({ where: { orgId: principal.orgId, status: 'running' }, orderBy: { createdAt: 'desc' } });
    if (active) return { accepted: true, run: { ...active, workerActive: reconciliationWorkers.has(active.id) } };
    const run = await prisma.storageReconciliationRun.create({ data: { orgId: principal.orgId, performedById: principal.userId, status: 'running' } });
    startReconciliationWorker(run.id, principal.orgId);
    return { accepted: true, run: { ...run, workerActive: true } };
  });
  app.get('/api/v1/media/storage/entities/:entity/:id', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    const params = request.params as { entity: string; id: string };
    const targetType: TargetType = params.entity === 'group' ? 'group' : 'account';
    try {
      const resolved = await resolveTargets(principal.orgId, targetType, [params.id]);
      const target = { id: resolved.ids[0], name: resolved.name };
      const scope = targetType === 'group'
        ? Prisma.sql`EXISTS (SELECT 1 FROM conversations c WHERE c.id=r.conversation_id AND c.org_id=${principal.orgId} AND c."threadType"='group' AND (c.external_thread_id=${target.id} OR c.id=${target.id}))`
        : Prisma.sql`r.zalo_account_id=${target.id}`;
      const [summaryRows, typeRows, rangeRows] = await Promise.all([
        prisma.$queryRaw<any[]>(Prisma.sql`WITH s AS (
          SELECT DISTINCT o.id AS object_id, o.size_bytes, o.file_type FROM storage_object_references r
          JOIN storage_objects o ON o.id=r.object_id WHERE r.org_id=${principal.orgId} AND r.source='chat_message' AND ${scope}
        ) SELECT ${entitySelect()} FROM s`),
        prisma.$queryRaw<any[]>(Prisma.sql`SELECT o.file_type AS type, COUNT(DISTINCT o.id)::bigint AS files, COALESCE(SUM(DISTINCT o.size_bytes),0)::bigint AS bytes
          FROM storage_object_references r JOIN storage_objects o ON o.id=r.object_id
          WHERE r.org_id=${principal.orgId} AND r.source='chat_message' AND ${scope} GROUP BY o.file_type ORDER BY bytes DESC`),
        prisma.$queryRaw<any[]>(Prisma.sql`SELECT MIN(r.created_at) AS "oldestAt", MAX(r.created_at) AS "newestAt"
          FROM storage_object_references r WHERE r.org_id=${principal.orgId} AND r.source='chat_message' AND ${scope}`),
      ]);
      return { target: { id: target.id, name: target.name, type: targetType }, summary: serializeRows(summaryRows)[0] || { files: 0, bytes: 0, image: 0, video: 0, file: 0, audio: 0 }, fileTypes: serializeRows(typeRows), range: rangeRows[0] || null };
    } catch (err: any) { return reply.status(400).send({ error: err?.message || 'Cannot load storage detail.' }); }
  });

  app.get('/api/v1/media/storage/policy', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    const policy = await prisma.storageManagementPolicy.findUnique({ where: { orgId: principal.orgId } });
    return policy || DEFAULT_STORAGE_POLICY;
  });
  app.put('/api/v1/media/storage/policy', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    const body = (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
    const quotaAlertPercent = Math.min(100, Math.max(1, Number(body.quotaAlertPercent) || 80));
    const anomalyMultiplier = Math.min(10, Math.max(1, Number(body.anomalyMultiplier) || 2));
    const retentionDays = Math.min(3650, Math.max(0, Math.floor(Number(body.retentionDays) || 0)));
    const retentionFileKinds = Array.isArray(body.retentionFileKinds) ? body.retentionFileKinds.filter((kind): kind is FileKind => typeof kind === 'string' && ALL_KINDS.includes(kind as FileKind)) : [];
    return prisma.storageManagementPolicy.upsert({ where: { orgId: principal.orgId }, create: { orgId: principal.orgId, quotaAlertPercent, anomalyMultiplier, retentionDays, retentionFileKinds }, update: { quotaAlertPercent, anomalyMultiplier, retentionDays, retentionFileKinds } });
  });
  app.post('/api/v1/media/storage/preview-cleanup', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    try {
      // Accepts targetIds[] (several groups at once) and includeVisible.
      const parsed = parseCleanupBody(request.body);
      return await createCleanupPreview({ ...parsed, orgId: principal.orgId, performedById: principal.userId, trigger: 'manual' });
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Không tạo được bản xem trước.' });
    }
  });

  app.get('/api/v1/media/storage/cleanup/:runId', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    const run = await prisma.storageCleanupRun.findFirst({ where: { id: (request.params as { runId: string }).runId, orgId: principal.orgId }, include: { performedBy: { select: { fullName: true } } } });
    if (!run) return reply.status(404).send({ error: 'Cleanup snapshot not found.' });
    return cleanupProgress(run);
  });
  app.get('/api/v1/media/storage/history/:runId/export', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    const runId = (request.params as { runId: string }).runId;
    const run = await prisma.storageCleanupRun.findFirst({ where: { id: runId, orgId: principal.orgId } });
    if (!run) return reply.status(404).send({ error: 'Cleanup history not found.' });
    const items = await prisma.storageCleanupItem.findMany({ where: { runId }, orderBy: [{ status: 'asc' }, { objectKey: 'asc' }] });
    const csv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = ['object_key,driver,file_type,size_bytes,status,attempts,error', ...items.map((item) => [item.objectKey, item.storageDriver, item.fileType, item.sizeBytes, item.status, item.attempts, item.error].map(csv).join(','))];
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="storage-cleanup-${runId}.csv"`).send(`\uFEFF${lines.join('\n')}`);
  });
  app.get('/api/v1/media/storage/history/:runId', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    const runId = (request.params as { runId: string }).runId;
    const run = await prisma.storageCleanupRun.findFirst({ where: { id: runId, orgId: principal.orgId }, include: { performedBy: { select: { fullName: true } } } });
    if (!run) return reply.status(404).send({ error: 'Cleanup history not found.' });
    const failedItems = await prisma.storageCleanupItem.findMany({ where: { runId, status: 'failed' }, take: 50, orderBy: { updatedAt: 'desc' }, select: { objectKey: true, storageDriver: true, fileType: true, sizeBytes: true, attempts: true, error: true } });
    return { run: await cleanupProgress(run), failedItems: failedItems.map((item) => ({ ...item, sizeBytes: Number(item.sizeBytes) })) };
  });
  app.post('/api/v1/media/storage/execute-cleanup', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    const body = request.body as { runId?: unknown; confirm?: unknown; retryFailed?: unknown } | null;
    if (!body || body.confirm !== true || typeof body.runId !== 'string' || !body.runId) return reply.status(400).send({ error: 'Missing cleanup snapshot confirmation.' });
    // The snapshot already carries targetIds[] and includeVisible from preview;
    // execute never widens the scope, it only runs the reviewed snapshot.
    try {
      await executeCleanupRun({ runId: body.runId, orgId: principal.orgId, retryFailed: body.retryFailed === true });
    } catch (err: any) {
      if (err instanceof CleanupExecuteError) return reply.status(err.statusCode).send({ error: err.message });
      throw err;
    }
    const updated = await prisma.storageCleanupRun.findUniqueOrThrow({ where: { id: body.runId }, include: { performedBy: { select: { fullName: true } } } });
    return { accepted: true, run: await cleanupProgress(updated) };
  });

  // Per-group nightly cleanup schedules. Created disabled; the owner enables
  // each group after reviewing a preview. The worker runs ~02:00 Asia/Ho_Chi_Minh.
  app.get('/api/v1/media/storage/group-schedules', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    const items = await prisma.storageGroupCleanupSchedule.findMany({ where: { orgId: principal.orgId }, orderBy: [{ enabled: 'desc' }, { groupName: 'asc' }] });
    return { items: items.map(describeSchedule) };
  });
  app.put('/api/v1/media/storage/group-schedules/:groupId', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    try {
      const groupId = (request.params as { groupId: string }).groupId;
      const target = await resolveTargets(principal.orgId, 'group', [groupId]);
      const data = normalizeScheduleInput(request.body);
      const saved = await prisma.storageGroupCleanupSchedule.upsert({
        where: { orgId_groupId: { orgId: principal.orgId, groupId: target.ids[0] } },
        create: { orgId: principal.orgId, groupId: target.ids[0], groupName: target.name, ...data },
        update: { groupName: target.name, ...data },
      });
      return describeSchedule(saved);
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message || 'Không lưu được lịch dọn.' });
    }
  });
  app.delete('/api/v1/media/storage/group-schedules/:groupId', { preHandler: requireGrant('media', 'view_all') }, async (request, reply) => {
    const principal = await requireStorageAdmin(request, reply); if (!principal) return;
    const groupId = (request.params as { groupId: string }).groupId;
    const removed = await prisma.storageGroupCleanupSchedule.deleteMany({ where: { orgId: principal.orgId, groupId } });
    return { deleted: removed.count };
  });
}
