// SPDX-License-Identifier: AGPL-3.0-or-later
/** Đồng bộ trạng thái ẩn thông báo của Zalo chính thức vào các hội thoại nhóm CRM. */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { runSystemQuery, withTenant } from '../../shared/tenant/tenant-context.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { logger } from '../../shared/utils/logger.js';

const CRON_SCHEDULE = '* * * * *';

export type ZaloMuteEntry = {
  id?: unknown;
  duration?: unknown;
  startTime?: unknown;
  currentTime?: unknown;
};

function unixSeconds(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** Trả thời điểm hết mute; null nghĩa là mute vô thời hạn. */
export function muteUntilFromEntry(entry: ZaloMuteEntry, nowMs = Date.now()): Date | null {
  const duration = Number(entry.duration);
  if (!Number.isFinite(duration) || duration < 0) return null;
  if (duration === 0) return new Date(nowMs);
  const start = unixSeconds(entry.startTime) ?? unixSeconds(entry.currentTime) ?? Math.floor(nowMs / 1000);
  return new Date((start + duration) * 1000);
}

export function activeGroupMutes(
  entries: ZaloMuteEntry[] | undefined,
  nowMs = Date.now(),
): Map<string, Date | null> {
  const active = new Map<string, Date | null>();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const id = String(entry?.id ?? '').trim();
    if (!id) continue;
    const until = muteUntilFromEntry(entry, nowMs);
    if (until && until.getTime() <= nowMs) continue;
    active.set(id, until);
  }
  return active;
}

async function syncAccount(account: { id: string; orgId: string; displayName: string | null }) {
  const now = new Date();
  const response = await zaloOps.getMute(account.id) as { groupChatEntries?: ZaloMuteEntry[] };
  const active = activeGroupMutes(response?.groupChatEntries, now.getTime());
  const groups = await withTenant(account.orgId, () => prisma.conversation.findMany({
    where: { zaloAccountId: account.id, threadType: 'group', externalThreadId: { not: null } },
    select: { id: true, externalThreadId: true },
  }));

  if (!groups.length) return { groups: 0, muted: 0, changed: 0 };
  let changed = 0;
  await withTenant(account.orgId, () => prisma.$transaction(async (tx) => {
    for (const group of groups) {
      const muteUntil = active.get(group.externalThreadId!);
      const muted = active.has(group.externalThreadId!);
      const result = await tx.conversation.updateMany({
        where: {
          id: group.id,
          OR: [
            { zaloNotificationsMuted: { not: muted } },
            { zaloMutedUntil: muteUntil ? { not: muteUntil } : { not: null } },
          ],
        },
        data: {
          zaloNotificationsMuted: muted,
          zaloMutedUntil: muteUntil,
          zaloMuteSyncedAt: now,
        },
      });
      changed += result.count;
    }
  }));

  return { groups: groups.length, muted: active.size, changed };
}

let running = false;
let task: ReturnType<typeof cron.schedule> | null = null;

export async function runZaloMuteSyncCycleNow() {
  if (running) return { accounts: 0, groups: 0, muted: 0, changed: 0, skipped: true };
  running = true;
  try {
    const accounts = await runSystemQuery(() => prisma.zaloAccount.findMany({
      where: { status: 'connected', archivedAt: null },
      select: { id: true, orgId: true, displayName: true },
    }));
    let groups = 0;
    let muted = 0;
    let changed = 0;
    for (const account of accounts) {
      try {
        const result = await syncAccount(account);
        groups += result.groups;
        muted += result.muted;
        changed += result.changed;
      } catch (error) {
        logger.warn(`[zalo-mute-sync] account=${account.id} (${account.displayName ?? 'unknown'}) failed:`, error);
      }
    }
    if (accounts.length) logger.info(`[zalo-mute-sync] accounts=${accounts.length} groups=${groups} muted=${muted} changed=${changed}`);
    return { accounts: accounts.length, groups, muted, changed, skipped: false };
  } finally {
    running = false;
  }
}

export function startZaloMuteSyncCron() {
  if (task) return;
  task = cron.schedule(CRON_SCHEDULE, () => void runZaloMuteSyncCycleNow());
  logger.info('[zalo-mute-sync] started (every 1 minute)');
  void runZaloMuteSyncCycleNow();
}

export function stopZaloMuteSyncCron() {
  task?.stop();
  task = null;
}
