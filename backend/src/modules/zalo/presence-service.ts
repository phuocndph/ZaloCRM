// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * presence-service.ts — Real-time Zalo presence cache + bulk refresh.
 *
 * Architecture:
 *   - In-memory cache: Map<`${accountId}:${friendUid}`, { lastOnline, fetchedAt }>
 *   - TTL: 30s. Stale entries return cached value but trigger background refresh.
 *   - Bulk cron 60s: call api.getFriendOnlines() per account → update cache + emit
 *     socket 'friend:presence' for live UI updates.
 *   - Single-uid fetch: api.lastOnline(uid) for on-demand (conv open).
 *
 * Privacy: Zalo returns `settings.show_online_status: false` if user disabled
 * status sharing — store `null` lastOnline in that case.
 */
import cron from 'node-cron';
import type { Server } from 'socket.io';
import { zaloOps } from '../../shared/zalo-operations.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { runSystemQuery } from '../../shared/tenant/tenant-context.js';

export interface PresenceEntry {
  /** Unix ms timestamp from Zalo lastOnline. null = privacy off OR unknown */
  lastOnline: number | null;
  /** Whether user has show_online_status privacy enabled */
  showStatus: boolean;
  fetchedAt: number;
}

const CACHE_TTL_MS = 30_000; // 30s — single-uid fetch dedup
const cache = new Map<string, PresenceEntry>();
let ioRef: Server | null = null;

function key(accountId: string, friendUid: string): string {
  return `${accountId}:${friendUid}`;
}

/**
 * Get presence for a single friend uid. Returns cached entry if fresh (<30s),
 * else fetches via Zalo SDK lastOnline + updates cache.
 *
 * Returns null on fetch error (caller handles fallback UI).
 */
export async function getPresence(accountId: string, friendUid: string): Promise<PresenceEntry | null> {
  const k = key(accountId, friendUid);
  const cached = cache.get(k);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const result: any = await zaloOps.getLastOnline(accountId, friendUid);
    // Zalo returns: { lastOnline: number, settings: { show_online_status: boolean } }
    // lastOnline = 0 nghĩa là Zalo không có data hoặc KH chưa từng online → treat as null
    let lastOnlineMs: number | null = null;
    if (typeof result?.lastOnline === 'number' && result.lastOnline > 0) {
      // Zalo trả ms hoặc s tuỳ version — detect bằng magnitude (<1e12 ≈ trước 2001 nếu ms → s)
      lastOnlineMs = result.lastOnline < 1e12 ? result.lastOnline * 1000 : result.lastOnline;
    }
    const showStatus = result?.settings?.show_online_status !== false;

    const entry: PresenceEntry = {
      lastOnline: showStatus ? lastOnlineMs : null,
      showStatus,
      fetchedAt: now,
    };
    cache.set(k, entry);
    return entry;
  } catch (err) {
    logger.warn('[presence] fetch failed', { accountId, friendUid, err: (err as Error).message });
    return cached || null;
  }
}

/**
 * Bulk refresh — getFriendOnlines() per account, mark friends in `onlines` list
 * as fresh, emit socket update. Stale entries naturally TTL-expire.
 *
 * Note: getFriendOnlines returns currently-online friends only. Friends NOT in
 * the list might still be online if they recently went offline — we don't
 * proactively mark offline; we let stale data expire and re-fetch on demand.
 */
async function refreshAccountPresence(accountId: string): Promise<{ onlineCount: number } | null> {
  try {
    const result: any = await zaloOps.getFriendOnlines(accountId);
    const onlines: Array<{ userId: string; status?: string }> = result?.onlines ?? [];
    const now = Date.now();

    for (const o of onlines) {
      if (!o.userId) continue;
      cache.set(key(accountId, o.userId), {
        lastOnline: now, // currently online → lastOnline ≈ now
        showStatus: true,
        fetchedAt: now,
      });
    }

    // Emit socket to all org clients — frontend uses to update conv list dots
    if (ioRef) {
      // Find org of this account (account-by-id, cross-org discovery) → runSystemQuery.
      const acc = await runSystemQuery(() =>
        prisma.zaloAccount.findUnique({
          where: { id: accountId },
          select: { orgId: true },
        }),
      );
      if (acc) {
        ioRef.to(`org:${acc.orgId}`).emit('friend:presence', {
          accountId,
          onlines: onlines.map((o) => o.userId),
          at: now,
        });
      }
    }

    return { onlineCount: onlines.length };
  } catch (err) {
    // Common: account not connected (status != 'connected'). Silent fail.
    return null;
  }
}

let cronJob: cron.ScheduledTask | null = null;

// Lùi dần khi một nick gọi getFriendOnlines thất bại liên tiếp. Trước đây nick lỗi
// (vd Zalo trả 404) vẫn bị gọi lại mỗi phút mãi mãi: 9 nick = 9 lỗi mỗi phút.
const PRESENCE_BACKOFF_MAX_MS = 30 * 60_000;
const presenceFailures = new Map<string, { failures: number; nextAttemptAt: number }>();

/** Thời gian chờ trước lần thử kế tiếp sau `failures` lần lỗi liên tiếp. */
export function presenceBackoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(PRESENCE_BACKOFF_MAX_MS, 60_000 * (2 ** Math.min(failures - 1, 10)));
}

/** Một vòng làm mới presence cho danh sách nick, có lùi dần theo từng nick. */
export async function runPresenceRefreshCycle(
  accountIds: string[],
  refresh: (accountId: string) => Promise<{ onlineCount: number } | null> = refreshAccountPresence,
  now: () => number = Date.now,
): Promise<{ attempted: number; skipped: number; totalOnline: number }> {
  let attempted = 0;
  let skipped = 0;
  let totalOnline = 0;
  const live = new Set(accountIds);
  for (const id of presenceFailures.keys()) if (!live.has(id)) presenceFailures.delete(id);
  for (const accountId of accountIds) {
    const state = presenceFailures.get(accountId);
    if (state && state.nextAttemptAt > now()) { skipped++; continue; }
    attempted++;
    const result = await refresh(accountId);
    if (result) {
      totalOnline += result.onlineCount;
      presenceFailures.delete(accountId);
    } else {
      const failures = (state?.failures ?? 0) + 1;
      presenceFailures.set(accountId, { failures, nextAttemptAt: now() + presenceBackoffMs(failures) - 5_000 });
    }
  }
  return { attempted, skipped, totalOnline };
}

export function resetPresenceBackoffForTest(): void {
  presenceFailures.clear();
}

export function startPresenceCron(io: Server | null): void {
  ioRef = io;

  // Every 60s — bulk refresh all connected accounts
  cronJob = cron.schedule('*/1 * * * *', async () => {
    // Cross-org sweep (mọi account connected mọi org) → runSystemQuery.
    const accounts = await runSystemQuery(() =>
      prisma.zaloAccount.findMany({
        where: { status: 'connected' },
        select: { id: true },
      }),
    );
    const { attempted, skipped, totalOnline } = await runPresenceRefreshCycle(accounts.map((acc) => acc.id));
    if (accounts.length > 0) {
      logger.debug('[presence] bulk refresh done', {
        accounts: accounts.length,
        attempted,
        skipped,
        totalOnline,
        cacheSize: cache.size,
      });
    }
  });
  logger.info('[presence] cron started — refresh every 60s');
}

export function stopPresenceCron(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
}

/** Cleanup entries older than 5min (called periodically). */
export function pruneCache(): number {
  const cutoff = Date.now() - 5 * 60_000;
  let removed = 0;
  for (const [k, v] of cache) {
    if (v.fetchedAt < cutoff) {
      cache.delete(k);
      removed++;
    }
  }
  return removed;
}
