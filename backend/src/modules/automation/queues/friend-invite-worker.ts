// ════════════════════════════════════════════════════════════════════════
// Luồng Mục Tiêu M2a — Friend Invite BullMQ Worker (2026-06-01)
// ════════════════════════════════════════════════════════════════════════
//
// Replaces legacy `nick-worker.ts` setInterval polling architecture.
// BullMQ Worker pull from queue `friend-invite` thay vì poll DB mỗi 20-40 phút.
//
// Job payload:
//   {
//     triggerId: string,
//     entryId: string,
//     nickId: string,
//     orgId: string,
//   }
//
// Pipeline (sẽ thêm full guards trong M2b — hour, quota, recency, multi-nick):
//   1. Load entry + verify state queued_for_pickup
//   2. Claim entry (pool-query.claimNextEntry pattern, single row)
//   3. Resolve contact qua phone → Zalo UID
//   4. Send friend-request (Zalo SDK)
//   5. Mark entry processed + INSERT outbox
//   6. On error: classifyError (T4A) → permanent vs transient
//
// Concurrency: 1 per nick (sequential, anh chốt). Multiple workers cho cùng
// nick = race condition (Zalo Anti-spam treat as DDoS). BullMQ Worker class
// concurrency: option mặc định 1 = đúng.
//
// Reuse:
//   - pool-query.markEntrySent / releaseEntryFailed
//   - applyFriendTransition (friend-event-handler)
//   - resolveOrCreateContact (contacts)
//
// Memory: project_friend_invite_test_config 2026-05-28 (test cap 300/day,
// delay 1 phút) — cap đọc từ ZaloAccount.dailyFriendAddCap (default 30, anh
// override per-nick trong /settings/channels/zalo).

import { Worker, DelayedError, UnrecoverableError, type Job, type WorkerOptions } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { getBullMQRedis } from './redis-connection.js';
import { QUEUE_NAMES, buildFriendInviteJobId } from './queue-registry.js';
import { runAllGuards, type TriggerGuardConfig, recordNickSend, consumeQuotaAfterSend } from './worker-guards.js';
import { classifyError } from './error-classify.js';
import { requestFriendHandler } from '../engine/action-handlers/request-friend.js';
import { markEntrySent, releaseEntryFailed } from '../friend-invite/pool-query.js';
import { notifyNoZalo, notifySendError } from './internal-notify-worker.js';
import type { ActionContext } from '../engine/types.js';

export interface FriendInviteJobData {
  triggerId: string;
  entryId: string;
  nickId: string;
  orgId: string;
}

export interface FriendInviteResult {
  status: 'sent' | 'permanent_fail' | 'transient_fail' | 'skipped';
  reason?: string;
  outboxId?: string;
}

let workerInstance: Worker<FriendInviteJobData, FriendInviteResult> | null = null;

// ════════════════════════════════════════════════════════════════════════
// Job processor — single tick per job (M2b full pipeline)
// ════════════════════════════════════════════════════════════════════════
async function processJob(
  job: Job<FriendInviteJobData, FriendInviteResult>,
  token?: string,
): Promise<FriendInviteResult> {
  const { triggerId, entryId, nickId, orgId } = job.data;
  const tag = `[friend-invite-worker job=${job.id}]`;

  // ── STEP 1: Load entry (data khách) + hàng đợi bảng nối (per-trigger) ──
  // #2 2026-06-06 — queueStatus/triggerId chuyển sang bảng nối trigger_queue_entries.
  const entry = await prisma.customerListEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      phoneE164: true,
      phoneRaw: true,
      zaloUid: true,
      contactId: true,
    },
  });
  if (!entry) {
    return { status: 'skipped', reason: 'entry_not_found' };
  }
  const queueRow = await prisma.triggerQueueEntry.findUnique({
    where: { triggerId_customerListEntryId: { triggerId, customerListEntryId: entryId } },
    select: { queueStatus: true },
  });
  if (!queueRow) {
    return { status: 'skipped', reason: 'queue_row_not_found' };
  }
  if (queueRow.queueStatus !== 'queued_for_pickup' && queueRow.queueStatus !== 'processing') {
    return { status: 'skipped', reason: `state_${queueRow.queueStatus}` };
  }
  if (!entry.contactId) {
    return { status: 'skipped', reason: 'no_contact_id' };
  }

  // ── STEP 2: Load trigger config + nick caps ──
  const [trigger, nick] = await Promise.all([
    prisma.automationTrigger.findUnique({
      where: { id: triggerId },
      select: {
        id: true,
        orgId: true,
        createdById: true,
        sendHourStart: true,
        sendHourEnd: true,
        recencySkipDays: true,
        multiNickThreshold: true,
        minFriendReqGapMs: true,
        state: true,
      },
    }),
    prisma.zaloAccount.findUnique({
      where: { id: nickId },
      select: {
        id: true,
        dailyFriendAddCap: true,
        status: true,
      },
    }),
  ]);

  if (!trigger) return { status: 'skipped', reason: 'trigger_not_found' };
  if (trigger.state !== 'active') return { status: 'skipped', reason: `trigger_${trigger.state}` };
  if (!nick) return { status: 'skipped', reason: 'nick_not_found' };
  if (nick.status !== 'connected') {
    return { status: 'skipped', reason: `nick_${nick.status}` };
  }

  // ── STEP 3: Run 5 guards ──
  const triggerCfg: TriggerGuardConfig = {
    triggerId: trigger.id,
    sendHourStart: trigger.sendHourStart,
    sendHourEnd: trigger.sendHourEnd,
    recencySkipDays: trigger.recencySkipDays,
    multiNickThreshold: trigger.multiNickThreshold,
    minFriendReqGapMs: trigger.minFriendReqGapMs,
    triggerOwnerUserId: trigger.createdById,
    orgId: trigger.orgId,
  };

  const guard = await runAllGuards({
    contactId: entry.contactId,
    nickId,
    triggerCfg,
    nickCap: nick.dailyFriendAddCap,
  });

  if (!guard.passed) {
    // Defer hoặc skip permanent dựa vào deferUntilMs
    if (guard.deferUntilMs && guard.deferUntilMs > Date.now() && token) {
      await job.moveToDelayed(guard.deferUntilMs, token);
      throw new DelayedError();
    }
    // Permanent skip (recency / multi-nick) — #2: bảng nối per-trigger.
    await prisma.triggerQueueEntry.update({
      where: { triggerId_customerListEntryId: { triggerId, customerListEntryId: entryId } },
      data: {
        queueStatus: guard.reason?.startsWith('multi_nick') ? 'skipped_friend_cap' :
                     guard.reason?.startsWith('cross_nick_recency') ? 'skipped_recency' :
                     'skipped_status',
      },
    });
    return { status: 'skipped', reason: guard.reason };
  }

  // ── STEP 4: Load greeting template từ trigger ──
  // Friend-invite trigger có greetingTemplate hoặc dùng default
  const triggerFull = await prisma.automationTrigger.findUnique({
    where: { id: triggerId },
    select: {
      greetingTemplate: true,
      successorSequenceId: true,
      segmentSpec: true,
    },
  });

  const greetingTemplate = triggerFull?.greetingTemplate ??
    'Chào anh/chị, em liên hệ giới thiệu sản phẩm. Anh/chị duyệt kết bạn để em gửi thông tin nhé!';

  // ── STEP 5: Dispatch requestFriendHandler (M2c wire actual SDK) ──
  const taskPseudoId = job.id ?? randomUUID();
  const ctx: ActionContext = {
    orgId,
    taskId: taskPseudoId,
    contactId: entry.contactId,
    assignedNickId: nickId,
    blockSnapshot: { greetingVariants: [greetingTemplate] },
    actionType: 'request_friend',
    attemptCount: (job.attemptsMade ?? 0) + 1,
  };

  logger.info(
    `${tag} dispatching request_friend contact=${entry.contactId} nick=${nickId} phone=${entry.phoneE164 ?? entry.phoneRaw}`,
  );

  let actionResult: Awaited<ReturnType<typeof requestFriendHandler>>;
  try {
    actionResult = await requestFriendHandler(ctx);
  } catch (err) {
    const classified = classifyError(err);
    logger.error(`${tag} handler threw ${classified.classification}: ${classified.message}`);
    if (classified.classification === 'permanent') {
      await releaseEntryFailed({ entryId, triggerId, nickId, reason: classified.errorCode });
      throw new UnrecoverableError(`Permanent: ${classified.errorCode}`);
    }
    throw err;
  }

  // Handle outcome
  if (actionResult.outcome === 'no_zalo') {
    // P4: notify sale gọi điện — #2: hàng đợi bảng nối per-trigger.
    await prisma.triggerQueueEntry.update({
      where: { triggerId_customerListEntryId: { triggerId, customerListEntryId: entryId } },
      data: { queueStatus: 'failed_permanent', lockedAt: null },
    });
    await prisma.automationEventLog.create({
      data: {
        orgId,
        triggerId,
        contactId: entry.contactId,
        nickId,
        eventType: 'no_zalo',
      },
    });

    // Resolve sale owner of this nick
    const nickOwner = await prisma.zaloAccount.findUnique({
      where: { id: nickId },
      select: { ownerUserId: true },
    });
    const contact = await prisma.contact.findUnique({
      where: { id: entry.contactId },
      select: { fullName: true, phone: true },
    });
    if (nickOwner?.ownerUserId) {
      await notifyNoZalo({
        orgId,
        targetUserId: nickOwner.ownerUserId,
        contactId: entry.contactId,
        contactName: contact?.fullName ?? '',
        contactPhone: contact?.phone ?? entry.phoneE164 ?? entry.phoneRaw,
        nickId,
      });
    }
    return { status: 'skipped', reason: 'no_zalo' };
  }

  if (actionResult.outcome === 'already_friend') {
    await prisma.triggerQueueEntry.update({
      where: { triggerId_customerListEntryId: { triggerId, customerListEntryId: entryId } },
      data: { queueStatus: 'processed', lockedAt: null },
    });
    await prisma.automationEventLog.create({
      data: {
        orgId,
        triggerId,
        contactId: entry.contactId,
        nickId,
        eventType: 'friend_already',
      },
    });
    return { status: 'skipped', reason: 'already_friend' };
  }

  if (actionResult.outcome === 'failure') {
    const classified = classifyError(
      new Error(actionResult.errorMessage ?? actionResult.errorCode ?? 'unknown'),
    );
    logger.error(
      `${tag} action failed code=${actionResult.errorCode} msg=${actionResult.errorMessage} classified=${classified.classification}`,
    );

    await prisma.automationEventLog.create({
      data: {
        orgId,
        triggerId,
        contactId: entry.contactId,
        nickId,
        eventType: 'send_error',
        detail: `${actionResult.errorCode}: ${(actionResult.errorMessage ?? '').slice(0, 200)}`,
      },
    });

    if (actionResult.retryable === false || classified.classification === 'permanent') {
      // P5: markPermanent + notify Zalo nội bộ
      await releaseEntryFailed({
        entryId,
        triggerId,
        nickId,
        reason: actionResult.errorCode ?? classified.errorCode,
      });

      const nickOwner = await prisma.zaloAccount.findUnique({
        where: { id: nickId },
        select: { ownerUserId: true, displayName: true },
      });
      const contact = await prisma.contact.findUnique({
        where: { id: entry.contactId },
        select: { fullName: true, phone: true },
      });
      if (nickOwner?.ownerUserId) {
        await notifySendError({
          orgId,
          targetUserId: nickOwner.ownerUserId,
          contactId: entry.contactId,
          contactName: contact?.fullName ?? '',
          contactPhone: contact?.phone ?? entry.phoneE164 ?? entry.phoneRaw,
          nickId,
          nickName: nickOwner.displayName ?? '',
          triggerId,
          errorMessage: actionResult.errorMessage,
        });
      }

      throw new UnrecoverableError(`Permanent: ${actionResult.errorCode}`);
    }

    // Transient: release entry để nick khác pick + throw retry
    await releaseEntryFailed({
      entryId,
      triggerId,
      nickId,
      reason: actionResult.errorCode ?? 'transient',
    });
    throw new Error(actionResult.errorMessage ?? 'transient failure');
  }

  // ── STEP 6: Success — INCR quota + mark entry sent + outbox ──
  await consumeQuotaAfterSend(nickId, nick.dailyFriendAddCap);
  await recordNickSend(nickId);

  const zaloLeadgenId = (actionResult.data?.uid as string | undefined) ?? '';
  await markEntrySent({
    entryId,
    triggerId,
    nickId,
    contactId: entry.contactId,
    successorSequenceId: triggerFull?.successorSequenceId ?? null,
    sequenceSnapshot: null,
    zaloLeadgenId,
    isTentative: false,
  });

  await prisma.automationEventLog.create({
    data: {
      orgId,
      triggerId,
      contactId: entry.contactId,
      nickId,
      eventType: 'friend_request_sent',
      detail: `entry=${entryId} uid=${zaloLeadgenId}`,
    },
  });

  return { status: 'sent', outboxId: zaloLeadgenId };
}

// ════════════════════════════════════════════════════════════════════════
// Worker lifecycle
// ════════════════════════════════════════════════════════════════════════
export function startFriendInviteWorker(opts?: Partial<WorkerOptions>): Worker {
  if (workerInstance) {
    logger.warn('[friend-invite-worker] already started');
    return workerInstance;
  }

  workerInstance = new Worker<FriendInviteJobData, FriendInviteResult>(
    QUEUE_NAMES.FRIEND_INVITE,
    processJob,
    {
      connection: getBullMQRedis(),
      // Concurrency 1 per nick — sequential. Future: multi-worker per nick = Zalo ban risk.
      concurrency: 1,
      // M2b sẽ add: per-nick rate limit qua Lua quota gate
      ...opts,
    },
  );

  workerInstance.on('completed', (job) => {
    logger.info(
      `[friend-invite-worker] completed job=${job.id} status=${job.returnvalue?.status}`,
    );
  });

  workerInstance.on('failed', (job, err) => {
    logger.error(
      `[friend-invite-worker] failed job=${job?.id} attempt=${job?.attemptsMade}/${job?.opts.attempts}: ${err.message}`,
    );
  });

  workerInstance.on('error', (err) => {
    logger.error(`[friend-invite-worker] error: ${err.message}`);
  });

  logger.info('[friend-invite-worker] started');
  return workerInstance;
}

export async function stopFriendInviteWorker(): Promise<void> {
  if (workerInstance) {
    logger.info('[friend-invite-worker] closing...');
    await workerInstance.close();
    workerInstance = null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// Enqueue helper — gọi từ trigger-routes.ts khi trigger activate
// ════════════════════════════════════════════════════════════════════════
import { getFriendInviteQueue } from './queue-registry.js';

export async function enqueueFriendInvite(
  data: FriendInviteJobData,
  delay = 0,
): Promise<void> {
  const queue = getFriendInviteQueue();
  const jobId = buildFriendInviteJobId(data.triggerId, data.entryId);
  await queue.add('send-friend-request', data, {
    jobId,
    delay,
  });
  logger.info(
    `[friend-invite-worker] enqueued jobId=${jobId} (delay=${delay}ms)`,
  );
}
