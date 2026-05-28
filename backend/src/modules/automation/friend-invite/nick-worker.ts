// Phase Friend Invite Queue 2026-05-28 — Per-nick setInterval worker lifecycle.
//
// Architecture (per anh chốt + spike verified):
//   - 1 worker per active ZaloAccount
//   - Each worker: setInterval với delay 20-40 phút random (TEST mode 1 phút)
//   - Each worker: pg_try_advisory_lock cho multi-instance safety
//   - Each iteration: claim 1 entry → dispatch Zalo SDK (Phase 1 → 2 → 3)
//
// Lifecycle hooks (gọi từ engine/index.ts):
//   - On server boot: spawn workers cho mọi ZaloAccount status=connected
//   - On nick.connected event: startNickWorker(nickId)
//   - On nick.disconnected event: stopNickWorker(nickId)
//   - On graceful shutdown: stopAllWorkers()
//
// Crash safety: advisory lock auto-released khi DB connection close
//   (spike #3 verified). Multi-instance setup: instance B sees lock taken
//   by instance A → 0 worker spawn → log warning.

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { zaloOps } from '../../../shared/zalo-operations.js';
import { nickWorkerLockKey } from './fnv1a.js';
import { claimNextEntry, markEntrySent, releaseEntryFailed } from './pool-query.js';

// Test mode: 1 phút cố định (anh chốt cho test loop)
// Prod mode: 20-40 phút random (anh chốt design)
const TEST_MODE = process.env.FRIEND_INVITE_TEST_MODE === 'true';

interface WorkerState {
  intervalId: NodeJS.Timeout;
  nickId: string;
  orgId: string;
  todayCount: number; // friend-request count today (from Outbox)
  isBusy: boolean; // prevent overlapping ticks
}

const nickWorkers = new Map<string, WorkerState>();

/**
 * Random delay 20-40 phút (prod) or 1 phút (test) trong millisecond.
 */
function getRandomDelayMs(): number {
  if (TEST_MODE) return 60_000; // 1 phút
  const minMs = 20 * 60_000;
  const maxMs = 40 * 60_000;
  return minMs + Math.random() * (maxMs - minMs);
}

/**
 * Recover today's friend-request count for this nick from Outbox table.
 * Uses Asia/Ho_Chi_Minh timezone for "today" boundary.
 */
async function recoverTodayCount(nickId: string): Promise<number> {
  const result = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
    SELECT COUNT(*)::bigint AS cnt
    FROM friend_request_outbox o
    WHERE o.nick_id = ${nickId}
      AND o.send_status IN ('success', 'tentative')
      AND o.created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')
  `;
  return Number(result[0]?.cnt ?? 0n);
}

/**
 * Working hours check — 6-22h Asia/Ho_Chi_Minh (anh chốt).
 */
function isWithinWorkingHours(): boolean {
  // Asia/Ho_Chi_Minh = UTC+7
  const now = new Date();
  const vnHour = (now.getUTCHours() + 7) % 24;
  return vnHour >= 6 && vnHour < 22;
}

/**
 * Spawn nick worker: acquire advisory lock + recover state + setInterval.
 * Idempotent: nếu worker đã exist, no-op.
 */
export async function startNickWorker(nickId: string, orgId: string): Promise<void> {
  if (nickWorkers.has(nickId)) {
    logger.debug(`[nick-worker] worker for ${nickId} already running, skip`);
    return;
  }

  // Acquire Postgres advisory lock (spike #3 verified auto-release on disconnect).
  const lockKey = nickWorkerLockKey(nickId);
  const lockResult = await prisma.$queryRaw<Array<{ pg_try_advisory_lock: boolean }>>`
    SELECT pg_try_advisory_lock(${lockKey})
  `;
  if (!lockResult[0]?.pg_try_advisory_lock) {
    logger.warn(
      `[nick-worker] advisory lock NOT acquired for nick=${nickId} (lockKey=${lockKey.toString()}). Another instance owns this nick. Skip spawn.`,
    );
    return;
  }

  // Recover state from DB
  const todayCount = await recoverTodayCount(nickId);

  // Spawn interval
  const delayMs = getRandomDelayMs();
  const intervalId = setInterval(() => {
    void runTick(nickId).catch((err) =>
      logger.error(`[nick-worker] tick error for nick=${nickId}:`, err),
    );
  }, delayMs);

  nickWorkers.set(nickId, { intervalId, nickId, orgId, todayCount, isBusy: false });

  logger.info(
    `[nick-worker] spawned nick=${nickId} delay=${Math.round(delayMs / 1000)}s todayCount=${todayCount} ${TEST_MODE ? '(TEST mode 1min)' : ''}`,
  );

  // Immediate first tick (after small jitter 1-5s) — don't wait full delay on spawn.
  // This lets anh see entries flow immediately when activating trigger.
  setTimeout(() => {
    void runTick(nickId).catch((err) =>
      logger.error(`[nick-worker] initial tick error for nick=${nickId}:`, err),
    );
  }, 1000 + Math.random() * 4000);
}

/**
 * Stop nick worker: clearInterval + release advisory lock.
 */
export async function stopNickWorker(nickId: string): Promise<void> {
  const worker = nickWorkers.get(nickId);
  if (!worker) return;

  clearInterval(worker.intervalId);
  nickWorkers.delete(nickId);

  const lockKey = nickWorkerLockKey(nickId);
  try {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${lockKey})`;
  } catch (err) {
    // Lock release best-effort. Connection drop auto-releases anyway.
    logger.warn(`[nick-worker] pg_advisory_unlock failed for nick=${nickId}:`, err);
  }

  logger.info(`[nick-worker] stopped nick=${nickId}`);
}

/**
 * Stop all workers (graceful shutdown).
 */
export async function stopAllNickWorkers(): Promise<void> {
  const nickIds = Array.from(nickWorkers.keys());
  for (const nickId of nickIds) {
    await stopNickWorker(nickId);
  }
  logger.info(`[nick-worker] stopped all ${nickIds.length} workers`);
}

/**
 * Get worker state (for dashboard query).
 */
export function getNickWorkerState(nickId: string): {
  isRunning: boolean;
  todayCount: number;
  isBusy: boolean;
} | null {
  const w = nickWorkers.get(nickId);
  if (!w) return null;
  return { isRunning: true, todayCount: w.todayCount, isBusy: w.isBusy };
}

/**
 * 1 tick: check gates → claim entry → 3-phase dispatch.
 */
async function runTick(nickId: string): Promise<void> {
  const worker = nickWorkers.get(nickId);
  if (!worker) return;
  if (worker.isBusy) return; // skip if previous tick still running

  // Gate 1: working hours
  if (!isWithinWorkingHours()) {
    logger.debug(`[nick-worker] ${nickId} skip tick: outside working hours (6-22h VN)`);
    return;
  }

  // Gate 2: daily cap (friend-request)
  const nick = await prisma.zaloAccount.findUnique({
    where: { id: nickId },
    select: { dailyFriendAddCap: true, status: true },
  });
  if (!nick) {
    logger.warn(`[nick-worker] ${nickId} not found, stopping worker`);
    await stopNickWorker(nickId);
    return;
  }
  if (nick.status !== 'connected') {
    logger.debug(`[nick-worker] ${nickId} status=${nick.status}, skip tick`);
    return;
  }
  if (worker.todayCount >= nick.dailyFriendAddCap) {
    logger.debug(
      `[nick-worker] ${nickId} hit daily cap ${worker.todayCount}/${nick.dailyFriendAddCap}, skip tick`,
    );
    return;
  }

  worker.isBusy = true;
  try {
    // Phase 1: CLAIM
    const entry = await claimNextEntry(nickId, worker.orgId);
    if (!entry) {
      // Pool empty for this nick — that's OK, next tick will retry
      return;
    }
    if (!entry.phoneE164) {
      // Should never happen (skip rule pre-filtered) but defensive
      await releaseEntryFailed({ entryId: entry.id, nickId, reason: 'no phone_e164' });
      return;
    }

    logger.info(
      `[nick-worker] ${nickId} claimed entry=${entry.id} phone=${entry.phoneE164} row=${entry.rowIndex} trigger=${entry.triggerId}`,
    );

    // Load trigger for greeting template + successor sequence (snapshot at dispatch time)
    const trigger = await prisma.automationTrigger.findUnique({
      where: { id: entry.triggerId },
      select: { greetingTemplate: true, successorSequenceId: true, segmentSpec: true },
    });
    if (!trigger) {
      await releaseEntryFailed({ entryId: entry.id, nickId, reason: 'trigger not found' });
      return;
    }

    // Load sale user fullName for {sale} variable (last word VN convention)
    const ownerUser = await prisma.user.findFirst({
      where: { zaloAccounts: { some: { id: nickId } } },
      select: { fullName: true },
    });
    const saleName = (ownerUser?.fullName ?? 'em').trim().split(/\s+/).pop() ?? 'em';

    // Phase 2: ZALO HTTP (NO DB tx, 30s timeout enforced by zaloOps)
    let zaloLeadgenId = '';
    let isTentative = false;
    let zaloName = entry.nameRaw ?? 'bạn';
    let zaloGender: 'female' | 'male' | undefined;
    try {
      // 2.1: Find UID by phone (resolves UID + name + gender)
      const found = (await zaloOps.findUser(nickId, entry.phoneE164)) as
        | { uid?: string; displayName?: string; zaloName?: string; gender?: unknown }
        | null
        | undefined;
      if (!found || !found.uid) {
        // KH không có Zalo — mark hasZalo=false + skip (Lead Pool no-Zalo flow handles later)
        await prisma.customerListEntry.update({
          where: { id: entry.id },
          data: { queueStatus: 'skipped_status', hasZalo: false },
        });
        logger.info(`[nick-worker] ${nickId} entry=${entry.id} skipped: no Zalo profile for phone`);
        return;
      }
      const uid = found.uid;
      // Extract gender + name from Zalo profile
      const profile = found as Record<string, unknown>;
      const rawGender = profile.gender;
      if (rawGender === 'female' || rawGender === 0 || rawGender === '0') zaloGender = 'female';
      else if (rawGender === 'male' || rawGender === 1 || rawGender === '1') zaloGender = 'male';
      const profileName = (profile.displayName as string | undefined) ?? (profile.zaloName as string | undefined);
      if (profileName) zaloName = profileName.trim().split(/\s+/).pop() ?? zaloName;

      // 2.2: Render greeting template (per memory reference_greeting_template_vars)
      const genderRendered =
        zaloGender === 'female' ? 'Chị' : zaloGender === 'male' ? 'Anh' : 'Anh Chị';
      const greeting = (trigger.greetingTemplate ?? 'Chào {gender} {name}, em là {sale}.')
        .replaceAll('{gender}', genderRendered)
        .replaceAll('{name}', zaloName)
        .replaceAll('{sale}', saleName);

      // 2.3: Send friend request
      const sendResult = await zaloOps.sendFriendRequest(nickId, greeting, uid);
      // sendResult format từ zca-js — pick leadgen id if available
      const sr = sendResult as Record<string, unknown> | undefined;
      zaloLeadgenId = String(sr?.reqId ?? sr?.requestId ?? sr?.id ?? '');

      // Persist Zalo enrichment on entry (for later UI)
      await prisma.customerListEntry.update({
        where: { id: entry.id },
        data: {
          hasZalo: true,
          zaloUid: uid,
          zaloName: profileName ?? entry.nameRaw,
          resolvedByNickId: nickId,
        },
      });
    } catch (err: any) {
      const code = err?.code ?? '';
      const msg = err?.message ?? String(err);
      // Distinguish RATE_LIMITED (retry) vs hard error (release pool)
      if (code === 'RATE_LIMITED' || code === 'NOT_CONNECTED' || msg.includes('timeout')) {
        // Soft fail — release pool, nick có thể retry sau, KHÔNG append failedNickIds
        await prisma.customerListEntry.update({
          where: { id: entry.id },
          data: {
            queueStatus: 'queued_for_pickup',
            claimedByNickId: null,
            lockedAt: null,
          },
        });
        logger.warn(
          `[nick-worker] ${nickId} entry=${entry.id} soft fail (${code || 'timeout'}): ${msg}`,
        );
      } else {
        // Hard fail — append failedNickIds
        await releaseEntryFailed({
          entryId: entry.id,
          nickId,
          reason: `${code} ${msg}`.slice(0, 200),
        });
        logger.warn(`[nick-worker] ${nickId} entry=${entry.id} hard fail: ${code} ${msg}`);
      }
      return;
    }

    // Phase 3: RESULT — Success path
    await markEntrySent({
      entryId: entry.id,
      triggerId: entry.triggerId,
      nickId,
      contactId: entry.contactId ?? entry.id, // fallback to entry.id if contact not yet linked
      successorSequenceId: trigger.successorSequenceId,
      sequenceSnapshot: null, // drainer re-fetches sequence at materialize time
      zaloLeadgenId,
      isTentative,
    });

    // Update worker state
    worker.todayCount++;

    // Update ZaloAccount.lastFriendReqSentAt for cross-campaign throttle gate
    await prisma.zaloAccount.update({
      where: { id: nickId },
      data: { lastFriendReqSentAt: new Date() },
    });

    logger.info(
      `[nick-worker] ${nickId} entry=${entry.id} sent OK leadgen=${zaloLeadgenId} todayCount=${worker.todayCount}/${nick.dailyFriendAddCap}`,
    );
  } finally {
    worker.isBusy = false;
  }
}

/**
 * Bootstrap: spawn workers cho mọi connected ZaloAccount có entry trong pool.
 * Called once from app.ts on server start.
 */
export async function bootstrapFriendInviteWorkers(): Promise<void> {
  // Find nicks that are connected AND có entry trong pool (queue active)
  const nicks = await prisma.zaloAccount.findMany({
    where: { status: 'connected' },
    select: { id: true, orgId: true, displayName: true },
  });

  if (nicks.length === 0) {
    logger.info('[nick-worker] bootstrap: no connected nicks');
    return;
  }

  // Only spawn workers cho nicks có entries pending
  const nicksWithPending = await prisma.$queryRaw<Array<{ nick_id: string }>>`
    SELECT DISTINCT (segment_spec->'nickIds')::jsonb->>0 AS nick_id
    FROM automation_triggers
    WHERE event_type = 'friend_invite_to_list'
      AND state = 'active'
      AND segment_spec IS NOT NULL
  `;
  // Simpler approach: spawn worker for all nicks tied to active friend_invite_to_list triggers
  const activeNickIds = new Set<string>();
  const activeTriggers = await prisma.automationTrigger.findMany({
    where: { eventType: 'friend_invite_to_list', state: 'active' },
    select: { segmentSpec: true },
  });
  for (const t of activeTriggers) {
    const spec = t.segmentSpec as { nickIds?: string[] } | null;
    if (spec?.nickIds) {
      for (const nid of spec.nickIds) activeNickIds.add(nid);
    }
  }

  let spawned = 0;
  for (const nick of nicks) {
    if (!activeNickIds.has(nick.id)) continue;
    await startNickWorker(nick.id, nick.orgId);
    spawned++;
  }

  logger.info(`[nick-worker] bootstrap done: spawned ${spawned}/${nicks.length} workers`);
}
