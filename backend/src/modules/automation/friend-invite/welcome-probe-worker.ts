// Phase Friend Invite Wave 2 — Welcome Probe Worker 2026-05-29.
//
// Poll FriendRequestOutbox WHERE kind='WELCOME_PROBE' AND welcome_outcome IS NULL
// AND created_at <= NOW() - INTERVAL '<welcomeDelayAfterFriendReqSec> seconds'.
// FOR UPDATE SKIP LOCKED. Limit 5 per tick.
//
// Per row:
//  1. Load org config (template + maxRetries + strangerInboxEnabled)
//  2. Load contact + friend record (per-nick UID)
//  3. If contact.welcomeSentAt set → outcome=DUPLICATE_SKIP
//  4. Detect warm = friend.friendshipStatus='accepted' AND contact.lastInboundAt < 30d
//     → channel=FRIEND, else STRANGER (only if org.welcomeStrangerInboxEnabled)
//  5. Render template via {gender}/{name}/{sale}
//  6. zaloOps.sendMessage(nickId, threadId, 0, { msg, allowStrangerMessage: !isWarm })
//  7. Classify error: BLOCKED_STRANGER (stranger guard hits) → no retry
//     transient (timeout/5xx) + retry_count < maxRetries → increment, leave null
//     else → HARD_FAIL
//  8. Success → tx: outbox welcomeOutcome=SENT_STRANGER|SENT_FRIEND + welcomeSentAt,
//     contact welcomeSentAt + welcomeChannel
//  9. Honor hour 6-22 VN window

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { zaloOps } from '../../../shared/zalo-operations.js';

let probeInterval: NodeJS.Timeout | null = null;
let busy = false;
let tickCounter = 0;

interface ProbeRow {
  id: string;
  org_id: string;
  nick_id: string;
  contact_id: string;
  welcome_retry_count: number;
}

function isWithinWorkingHours(): boolean {
  const vnHour = (new Date().getUTCHours() + 7) % 24;
  return vnHour >= 6 && vnHour < 22;
}

function classifyError(msg: string): 'BLOCKED_STRANGER' | 'TRANSIENT' | 'HARD_FAIL' {
  const m = msg.toLowerCase();
  if (m.includes('cannot_message_stranger') || m.includes('user_blocked') ||
      m.includes('spam') || msg.includes('Tham số không hợp lệ')) {
    return 'BLOCKED_STRANGER';
  }
  if (m.includes('timeout') || m.includes('etimedout') || /\b5\d\d\b/.test(msg) ||
      m.includes('econnreset') || m.includes('socket')) {
    return 'TRANSIENT';
  }
  return 'HARD_FAIL';
}

async function renderGreeting(raw: string, contactId: string, nickId: string): Promise<string> {
  if (!raw.includes('{')) return raw;
  const [contact, ownerUser] = await Promise.all([
    prisma.contact.findUnique({ where: { id: contactId }, select: { fullName: true, gender: true } }),
    prisma.user.findFirst({ where: { zaloAccounts: { some: { id: nickId } } }, select: { fullName: true } }),
  ]);
  const genderStr =
    contact?.gender === 'female' ? 'Chị' : contact?.gender === 'male' ? 'Anh' : 'Anh Chị';
  const name = (contact?.fullName ?? '').trim().split(/\s+/).pop() ?? 'Anh Chị';
  const sale = (ownerUser?.fullName ?? 'em').trim().split(/\s+/).pop() ?? 'em';
  return raw.replaceAll('{gender}', genderStr).replaceAll('{name}', name).replaceAll('{sale}', sale);
}

async function processRow(row: ProbeRow): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: row.org_id },
    select: {
      friendInviteWelcomeTemplate: true,
      welcomeMaxRetries: true,
      welcomeStrangerInboxEnabled: true,
    },
  });
  if (!org?.friendInviteWelcomeTemplate) {
    // Contact may not exist yet (early Wave 1.5 rows had contact_id = null).
    // Guard the contact update so a missing contact doesn't crash the tx and
    // strand the row with the claim token still set in welcome_last_error.
    await prisma.$transaction(async (tx) => {
      await tx.friendRequestOutbox.update({
        where: { id: row.id },
        data: { welcomeOutcome: 'HARD_FAIL', welcomeLastError: 'no friend-invite template configured', welcomeSentAt: new Date() },
      });
      if (row.contact_id) {
        await tx.contact.updateMany({
          where: { id: row.contact_id },
          data: { welcomeSentAt: new Date() },
        });
      }
    });
    return;
  }

  const [contact, friend] = await Promise.all([
    prisma.contact.findUnique({
      where: { id: row.contact_id },
      select: { welcomeSentAt: true, lastInboundAt: true },
    }),
    prisma.friend.findFirst({
      where: { zaloAccountId: row.nick_id, contactId: row.contact_id },
      select: { zaloUidInNick: true, friendshipStatus: true },
    }),
  ]);

  if (!friend) {
    await prisma.$transaction([
      prisma.friendRequestOutbox.update({
        where: { id: row.id },
        data: { welcomeOutcome: 'HARD_FAIL', welcomeLastError: 'friend record missing', welcomeSentAt: new Date() },
      }),
      prisma.contact.update({
        where: { id: row.contact_id },
        data: { welcomeSentAt: new Date() },
      }),
    ]);
    return;
  }

  if (contact?.welcomeSentAt) {
    await prisma.friendRequestOutbox.update({
      where: { id: row.id },
      data: { welcomeOutcome: 'DUPLICATE_SKIP', welcomeSentAt: new Date() },
    });
    return;
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const isWarm = friend.friendshipStatus === 'accepted' &&
    !!contact?.lastInboundAt && contact.lastInboundAt > thirtyDaysAgo;

  if (!isWarm && !org.welcomeStrangerInboxEnabled) {
    await prisma.friendRequestOutbox.update({
      where: { id: row.id },
      data: { welcomeOutcome: 'BLOCKED_STRANGER', welcomeLastError: 'stranger inbox disabled' },
    });
    return;
  }

  const channel = isWarm ? 'SENT_FRIEND' : 'SENT_STRANGER';
  const channelLabel = isWarm ? 'friend_msg' : 'stranger_inbox';
  const msg = await renderGreeting(org.friendInviteWelcomeTemplate, row.contact_id, row.nick_id);

  // Race-safe contact lock: atomically claim welcomeSentAt before network send.
  // Any concurrent worker (or replay) that also picked this contact will get 0 rows.
  const lockClaim = await prisma.contact.updateMany({
    where: { id: row.contact_id, welcomeSentAt: null },
    data: { welcomeSentAt: new Date() },
  });
  if (lockClaim.count === 0) {
    await prisma.friendRequestOutbox.update({
      where: { id: row.id },
      data: { welcomeOutcome: 'DUPLICATE_SKIP', welcomeSentAt: new Date() },
    });
    return;
  }

  try {
    await zaloOps.sendMessage(row.nick_id, friend.zaloUidInNick, 0, {
      msg,
      allowStrangerMessage: !isWarm,
    });
    await prisma.$transaction([
      prisma.friendRequestOutbox.update({
        where: { id: row.id },
        data: { welcomeOutcome: channel, welcomeSentAt: new Date() },
      }),
      prisma.contact.update({
        where: { id: row.contact_id },
        data: { welcomeChannel: channelLabel },
      }),
    ]);
    logger.info(`[welcome-probe] sent outbox=${row.id} channel=${channelLabel}`);
  } catch (err: any) {
    const errMsg = (err?.message ?? String(err)).slice(0, 500);
    const kind = classifyError(errMsg);
    if (kind === 'BLOCKED_STRANGER') {
      await prisma.friendRequestOutbox.update({
        where: { id: row.id },
        data: { welcomeOutcome: 'BLOCKED_STRANGER', welcomeLastError: errMsg, welcomeSentAt: new Date() },
      });
    } else if (kind === 'TRANSIENT' && row.welcome_retry_count < org.welcomeMaxRetries) {
      // Transient retry: release the lock so retry can re-claim cleanly.
      await prisma.$transaction([
        prisma.friendRequestOutbox.update({
          where: { id: row.id },
          data: { welcomeRetryCount: { increment: 1 }, welcomeLastError: errMsg },
        }),
        prisma.contact.update({
          where: { id: row.contact_id },
          data: { welcomeSentAt: null },
        }),
      ]);
    } else {
      // HARD_FAIL (including max retries exhausted) — terminal, keep contact lock set.
      await prisma.friendRequestOutbox.update({
        where: { id: row.id },
        data: { welcomeOutcome: 'HARD_FAIL', welcomeLastError: errMsg, welcomeSentAt: new Date() },
      });
    }
  }
}

async function runProbeTick(): Promise<void> {
  if (busy) return;
  if (!isWithinWorkingHours()) return;
  busy = true;
  try {
    // Atomic UPDATE ... RETURNING claim pattern (replaces SELECT FOR UPDATE SKIP LOCKED).
    // We mark welcome_last_error with a per-process claim token so any concurrent worker
    // sees this row is taken (welcome_last_error NOT LIKE 'claim:%' in the inner SELECT).
    // 60s `created_at` floor doubles as a stale-claim recovery: if a prior process crashed
    // mid-tick, the row becomes re-claimable on the next eligible tick.
    const claimToken = 'claim:' + (++tickCounter) + ':' + process.pid;
    const rows = await prisma.$queryRaw<ProbeRow[]>`
      UPDATE friend_request_outbox
      SET welcome_last_error = ${claimToken}
      WHERE id IN (
        SELECT o.id
        FROM friend_request_outbox o
        JOIN automation_triggers t ON t.id = o.trigger_id
        WHERE o.kind = 'WELCOME_PROBE'
          AND o.welcome_outcome IS NULL
          AND (o.welcome_last_error IS NULL OR o.welcome_last_error NOT LIKE 'claim:%')
          AND o.created_at <= NOW() - INTERVAL '60 seconds'
          AND o.created_at <= NOW() - make_interval(secs => COALESCE(
            (SELECT welcome_delay_after_friend_req_sec FROM organizations WHERE id = t.org_id), 60))
        ORDER BY o.created_at ASC
        LIMIT 5
      )
      RETURNING
        id,
        nick_id,
        contact_id,
        welcome_retry_count,
        (SELECT org_id FROM automation_triggers WHERE id = friend_request_outbox.trigger_id) AS org_id
    `;
    for (const row of rows) {
      await processRow(row).catch(async (err) => {
        const errMsg = (err?.message ?? String(err)).slice(0, 500);
        logger.error(
          `[welcome-probe] processRow ${row.id} failed: ${errMsg}`,
          err,
        );
        // Clear the claim token so the row is re-pickable on the next tick.
        // Without this, a processRow throw leaves welcome_last_error = 'claim:...'
        // and the row is permanently filtered out by the claim WHERE.
        try {
          await prisma.friendRequestOutbox.update({
            where: { id: row.id },
            data: { welcomeLastError: errMsg },
          });
        } catch (recoverErr) {
          logger.error(
            `[welcome-probe] failed to release claim on ${row.id}:`,
            recoverErr,
          );
        }
      });
    }
  } catch (err) {
    logger.error('[welcome-probe] tick error:', err);
  } finally {
    busy = false;
  }
}

export function startWelcomeProbeWorker(): void {
  if (probeInterval) {
    logger.warn('[welcome-probe] already running, skip start');
    return;
  }
  probeInterval = setInterval(() => void runProbeTick(), 10_000);
  logger.info('[welcome-probe] worker started (10s tick, limit 5/tick, 6-22 VN)');
  void runProbeTick();
}

export function stopWelcomeProbeWorker(): void {
  if (probeInterval) {
    clearInterval(probeInterval);
    probeInterval = null;
    logger.info('[welcome-probe] worker stopped');
  }
}
