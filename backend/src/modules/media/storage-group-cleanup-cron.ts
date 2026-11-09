// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * storage-group-cleanup-cron.ts - nightly per-group chat media cleanup (2026-11-09).
 *
 * Each row of storage_group_cleanup_schedules says: for group X, remove media
 * older than N days of these kinds (optionally including media of visible
 * messages). Rows are created with enabled=false and only an owner enables
 * them from the storage admin page.
 *
 * The worker deliberately goes through the SAME path as the admin button:
 *   createCleanupPreview()  ->  executeCleanupRun()
 * so every run is a StorageCleanupRun (trigger='schedule') in the history,
 * with its item snapshot, CSV export and retry support.
 *
 *   02:00 Asia/Ho_Chi_Minh ──► enabled schedules ──► preview ──► execute ──► history
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { ALL_KINDS, createCleanupPreview, executeCleanupRun, type FileKind } from './storage-cleanup-service.js';

export const GROUP_CLEANUP_CRON = '0 2 * * *';
export const GROUP_CLEANUP_TIMEZONE = 'Asia/Ho_Chi_Minh';
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650;
let running = false;

export interface ScheduleInput {
  retentionDays: number;
  fileKinds: FileKind[];
  includeVisible: boolean;
  enabled: boolean;
}

/** Validate a schedule body. enabled defaults to false unless sent as true. */
export function normalizeScheduleInput(value: unknown): ScheduleInput {
  const body = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const retentionDays = Math.floor(Number(body.retentionDays));
  if (!Number.isFinite(retentionDays) || retentionDays < MIN_RETENTION_DAYS || retentionDays > MAX_RETENTION_DAYS) {
    throw new Error(`Số ngày giữ lại phải từ ${MIN_RETENTION_DAYS} đến ${MAX_RETENTION_DAYS}.`);
  }
  const fileKinds = Array.isArray(body.fileKinds)
    ? [...new Set(body.fileKinds.filter((kind): kind is FileKind => typeof kind === 'string' && ALL_KINDS.includes(kind as FileKind)))]
    : [];
  if (!fileKinds.length) throw new Error('Chọn ít nhất một loại dữ liệu.');
  return { retentionDays, fileKinds, includeVisible: body.includeVisible === true, enabled: body.enabled === true };
}

export function describeSchedule(row: any) {
  return { ...row, runsAt: '02:00 (giờ Việt Nam)' };
}

/** YYYY-MM-DD in Vietnam time, `days` before `now`. Used as the cleanup cutoff. */
export function cutoffDate(now: Date, days: number) {
  const vn = new Date(now.getTime() + 7 * 3600_000 - days * 86400_000);
  return vn.toISOString().slice(0, 10);
}

export interface ScheduleRunResult { scheduleId: string; groupId: string; runId?: string; files?: number; error?: string }

/**
 * Run every enabled schedule once. Sequential on purpose: one group at a time
 * keeps the database and R2 load predictable during the night.
 */
export async function runStorageGroupCleanupSchedules(opts: { now?: Date; orgId?: string } = {}): Promise<ScheduleRunResult[]> {
  if (running) { logger.warn('[storage-group-cleanup] previous run still active, skipping'); return []; }
  running = true;
  const now = opts.now ?? new Date();
  const results: ScheduleRunResult[] = [];
  try {
    const schedules = await prisma.storageGroupCleanupSchedule.findMany({
      where: { enabled: true, ...(opts.orgId ? { orgId: opts.orgId } : {}) },
      orderBy: [{ orgId: 'asc' }, { groupId: 'asc' }],
    });
    for (const schedule of schedules) {
      const result: ScheduleRunResult = { scheduleId: schedule.id, groupId: schedule.groupId };
      try {
        const kinds = (schedule.fileKinds || []).filter((kind): kind is FileKind => ALL_KINDS.includes(kind as FileKind));
        if (!kinds.length) throw new Error('Schedule has no valid file kinds.');
        const beforeDate = cutoffDate(now, schedule.retentionDays);
        const preview = await createCleanupPreview({
          orgId: schedule.orgId, performedById: null, trigger: 'schedule', scheduleId: schedule.id,
          targetType: 'group', targetId: schedule.groupId, targetIds: [schedule.groupId],
          before: new Date(`${beforeDate}T00:00:00+07:00`), kinds, includeVisible: schedule.includeVisible,
          targetName: `Lịch tự dọn: ${schedule.groupName || schedule.groupId}`,
        });
        result.runId = preview.runId; result.files = Number(preview.files || 0);
        const { done } = await executeCleanupRun({ runId: preview.runId, orgId: schedule.orgId });
        await done;
        await prisma.storageGroupCleanupSchedule.update({ where: { id: schedule.id }, data: { lastRunAt: new Date(), lastRunId: preview.runId, lastError: null } });
      } catch (err: any) {
        result.error = String(err?.message || err).slice(0, 1000);
        logger.error(`[storage-group-cleanup] schedule ${schedule.id} failed: ${result.error}`);
        try {
          await prisma.storageGroupCleanupSchedule.update({ where: { id: schedule.id }, data: { lastRunAt: new Date(), lastRunId: result.runId ?? null, lastError: result.error } });
        } catch (updateErr) {
          logger.warn(`[storage-group-cleanup] could not record error for ${schedule.id}: ${String(updateErr)}`);
        }
      }
      results.push(result);
    }
    if (schedules.length) logger.info(`[storage-group-cleanup] processed ${schedules.length} schedule(s)`);
    return results;
  } finally {
    running = false;
  }
}

export function startStorageGroupCleanupCron(): void {
  cron.schedule(GROUP_CLEANUP_CRON, async () => {
    try { await runStorageGroupCleanupSchedules(); }
    catch (err) { logger.error('[storage-group-cleanup] error:', err); }
  }, { timezone: GROUP_CLEANUP_TIMEZONE });
  logger.info('[storage-group-cleanup] nightly per-group cleanup scheduled at 02:00 Asia/Ho_Chi_Minh (only enabled schedules run)');
}
