// Phase Friend Invite Queue 2026-05-28 — 3 cron sweepers + outbox drainer.
//
// 1. Stuck sweeper (1 phút):
//    UPDATE entries SET queueStatus='queued_for_pickup' WHERE queueStatus='processing'
//    AND lockedAt < NOW() - INTERVAL '5 minutes'
//    Increment stuckRecoveryCount. After 10 recoveries → failed_stuck.
//
// 2. Trigger completion sweeper (1 phút):
//    UPDATE triggers SET state='completed' WHERE state='active' AND pool empty.
//
// 3. Outbox drainer (30s):
//    Pick FriendRequestOutbox WHERE sendStatus='success' AND sequenceMaterializedAt IS NULL
//    Call materializeSequenceForContact() per row → UPDATE sequenceMaterializedAt.

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { materializeSequenceForContact } from '../engine/campaign-materializer.js';
import { getSequenceStepQueue } from '../queues/queue-registry.js';
import { logEvent } from './event-log-service.js';

let stuckSweeperInterval: NodeJS.Timeout | null = null;
let triggerSweeperInterval: NodeJS.Timeout | null = null;
let exhaustedSweeperInterval: NodeJS.Timeout | null = null;
let drainerInterval: NodeJS.Timeout | null = null;
let campaignTimeoutSweeperInterval: NodeJS.Timeout | null = null;

/**
 * Stuck sweeper — release entries stuck >5min back to pool.
 */
async function runStuckSweeper(): Promise<void> {
  try {
    // ── Sprint v3 (2026-06-03) — Sửa 6.5 ──
    // Anh chốt: stuck do nick chết → release entry NHƯNG KHÔNG tăng counter
    // (vì lỗi không do SĐT mà do nick chết, không nên flip failed_stuck oan).
    // Increment chỉ khi nick còn connected — nghĩa là SĐT thực sự stuck do
    // lỗi worker/network chứ không phải nick chết tự nhiên.
    const result = await prisma.$executeRaw`
      UPDATE customer_list_entries
      SET queue_status = 'queued_for_pickup',
          claimed_by_nick_id = NULL,
          locked_at = NULL,
          stuck_recovery_count = CASE
            WHEN claimed_by_nick_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM zalo_accounts za
              WHERE za.id = customer_list_entries.claimed_by_nick_id
                AND za.status = 'connected'
            ) THEN stuck_recovery_count + 1
            ELSE stuck_recovery_count
          END
      WHERE queue_status = 'processing'
        AND locked_at < NOW() - INTERVAL '5 minutes'
        AND stuck_recovery_count < 10
    `;
    if (result > 0) {
      logger.info(`[stuck-sweeper] released ${result} stuck entries back to pool`);
    }

    // Mark entries that hit 10 recoveries as failed_stuck
    const failedStuck = await prisma.$executeRaw`
      UPDATE customer_list_entries
      SET queue_status = 'failed_stuck'
      WHERE queue_status = 'processing'
        AND locked_at < NOW() - INTERVAL '5 minutes'
        AND stuck_recovery_count >= 10
    `;
    if (failedStuck > 0) {
      logger.warn(`[stuck-sweeper] ${failedStuck} entries marked failed_stuck after 10 recoveries`);
    }
  } catch (err) {
    logger.error('[stuck-sweeper] error:', err);
  }
}

/**
 * Trigger completion sweeper — flip state='completed' khi:
 *   1) Pool friend-request empty (all entries processed/skipped/failed)
 *   2) AND all outbox WELCOME_PROBE rows đã materialize sequence (hoặc fail vĩnh viễn)
 *   3) AND all automation_campaigns của trigger đã state='completed' (sequence steps hết)
 *
 * Fix #6 v2 (2026-06-02): version 1 chỉ check tới enroll (sequenceMaterializedAt SET) →
 * trigger flip 'completed' NGAY khi enqueue jobs vào BullMQ delayed, dù step 1/2/3 chưa
 * fire. Sale thấy "Hoàn tất" trong khi sequence còn 60p delay chờ step 1.
 *
 * Fix v2: thêm condition #3 — campaign.state phải 'completed' (sequence-step-worker flip
 * sau khi xử lý step cuối cùng). Trigger chỉ thực sự "hoàn tất" khi cả friend-invite +
 * welcome + toàn bộ sequence steps xong.
 *
 * Edge case: trigger không có successor_sequence (friend-only, no bám đuổi) → campaign
 * không tồn tại → condition #3 trivially true (NOT EXISTS pending campaign).
 */
async function runTriggerCompletionSweeper(): Promise<void> {
  try {
    const result = await prisma.$executeRaw`
      UPDATE automation_triggers
      SET state = 'completed', updated_at = NOW()
      WHERE state = 'active'
        AND event_type = 'friend_invite_to_list'
        AND id IN (
          SELECT t.id FROM automation_triggers t
          LEFT JOIN customer_list_entries e ON e.trigger_id = t.id
          WHERE t.state = 'active'
            AND t.event_type = 'friend_invite_to_list'
          GROUP BY t.id
          HAVING COUNT(e.id) > 0
            AND COUNT(*) FILTER (WHERE e.queue_status IN ('queued_for_pickup', 'processing')) = 0
        )
        AND NOT EXISTS (
          -- Còn outbox WELCOME_PROBE chưa enroll sequence (chưa fail vĩnh viễn)
          SELECT 1 FROM friend_request_outbox o
          WHERE o.trigger_id = automation_triggers.id
            AND o.kind = 'WELCOME_PROBE'
            AND o.sequence_materialized_at IS NULL
            AND o.attempt_count < 5
            AND o.successor_sequence_id IS NOT NULL
        )
        AND NOT EXISTS (
          -- Fix v2 (2026-06-02): còn automation_campaigns đang 'active' của trigger này
          -- (sequence-step-worker chưa xử lý hết step cuối → chưa flip campaign.state='completed').
          SELECT 1 FROM automation_campaigns c
          WHERE c.trigger_id = automation_triggers.id
            AND c.state = 'active'
        )
    `;
    if (result > 0) {
      logger.info(`[trigger-sweeper] flipped ${result} triggers to state='completed' (pool empty + welcome enrolled + all sequence campaigns done)`);
    }
  } catch (err) {
    logger.error('[trigger-sweeper] error:', err);
  }
}

/**
 * Exhausted-nicks sweeper — flip queued_for_pickup → failed_permanent
 * khi failedNickIds đã cover hết trigger.segmentSpec.nickIds.
 *
 * Lý do tách sweep: releaseEntryFailed mark failed_permanent ngay khi release,
 * nhưng entries từ trước fix này (hoặc race window) có thể stuck queued_for_pickup
 * mà không entry nào claim được (vì NOT (failedNickIds @> nickId) loại hết).
 */
async function runExhaustedNicksSweeper(): Promise<void> {
  try {
    const result = await prisma.$executeRaw`
      UPDATE customer_list_entries e
      SET queue_status = 'failed_permanent'
      FROM automation_triggers t
      WHERE e.trigger_id = t.id
        AND e.queue_status = 'queued_for_pickup'
        AND t.event_type = 'friend_invite_to_list'
        AND jsonb_array_length(e.failed_nick_ids) >= jsonb_array_length(t.segment_spec->'nickIds')
        AND jsonb_array_length(t.segment_spec->'nickIds') > 0
    `;
    if (result > 0) {
      logger.warn(`[exhausted-sweeper] ${result} entries marked failed_permanent (all trigger nicks failed)`);
    }
  } catch (err) {
    logger.error('[exhausted-sweeper] error:', err);
  }
}

/**
 * Outbox drainer — materialize sequence campaigns for outbox rows.
 */
async function runOutboxDrainer(): Promise<void> {
  try {
    // Pick rows with sequence_materialized_at IS NULL, exclude rows already 5 attempts (alert state)
    // Wave 2: Gate sequence enrollment by welcome success. KH chặn tin lạ (BLOCKED_STRANGER) hoặc fail cứng (HARD_FAIL) sẽ KHÔNG enroll.
    // Fix #1 (2026-06-02): thêm DUPLICATE_SKIP — khi KH đã nhận welcome từ trigger trước
    // (cùng nick+contact), welcome-probe skip nhưng VẪN phải enroll sequence bám đuổi mới.
    // Không enroll = trigger mới chạy nhưng sequence không bao giờ tới step 1.
    const rows = await prisma.friendRequestOutbox.findMany({
      where: {
        kind: 'WELCOME_PROBE',
        welcomeOutcome: { in: ['SENT_STRANGER', 'SENT_FRIEND', 'DUPLICATE_SKIP'] },
        sequenceMaterializedAt: null,
        successorSequenceId: { not: null },
        attemptCount: { lt: 5 },
      },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });

    if (rows.length === 0) return;

    let materialized = 0;
    for (const row of rows) {
      try {
        // Look up trigger to get orgId + ruleOverrides
        const trigger = await prisma.automationTrigger.findUnique({
          where: { id: row.triggerId },
          select: { orgId: true, ruleOverrides: true },
        });
        if (!trigger) {
          logger.warn(`[outbox-drainer] trigger ${row.triggerId} not found for outbox row ${row.id}`);
          await prisma.friendRequestOutbox.update({
            where: { id: row.id },
            data: {
              attemptCount: { increment: 1 },
              lastErrorMessage: 'trigger missing',
            },
          });
          continue;
        }

        const result = await materializeSequenceForContact({
          orgId: trigger.orgId,
          contactId: row.contactId,
          sequenceId: row.successorSequenceId!,
          triggerId: row.triggerId,
          assignedNickId: row.nickId,
          originTaskId: row.customerListEntryId,
          sequenceSnapshot: (row.sequenceVersionSnapshot ?? null) as never,
          ruleOverrides: trigger.ruleOverrides as Record<string, unknown> | null,
        });

        if (result.skipped) {
          await prisma.friendRequestOutbox.update({
            where: { id: row.id },
            data: {
              attemptCount: { increment: 1 },
              lastErrorMessage: result.reason ?? 'skipped',
            },
          });
        } else {
          await prisma.friendRequestOutbox.update({
            where: { id: row.id },
            data: {
              sequenceMaterializedAt: new Date(),
            },
          });
          materialized++;
        }
      } catch (err: any) {
        logger.error(`[outbox-drainer] materialize failed for outbox row ${row.id}:`, err);
        await prisma.friendRequestOutbox.update({
          where: { id: row.id },
          data: {
            attemptCount: { increment: 1 },
            lastErrorMessage: (err?.message ?? String(err)).slice(0, 500),
          },
        });
      }
    }

    if (materialized > 0) {
      logger.info(`[outbox-drainer] materialized ${materialized}/${rows.length} sequence campaigns`);
    }

    // Alert on rows with attemptCount >= 5
    const stuck = await prisma.friendRequestOutbox.count({
      where: {
        sequenceMaterializedAt: null,
        attemptCount: { gte: 5 },
      },
    });
    if (stuck > 0) {
      logger.warn(`[outbox-drainer] ALERT: ${stuck} outbox rows stuck (>=5 attempts) — manual review needed`);
    }
  } catch (err) {
    logger.error('[outbox-drainer] error:', err);
  }
}

/**
 * Welcome-failed cleanup — mark BLOCKED_STRANGER / HARD_FAIL rows with
 * sequenceMaterializedAt = sentAt so they exit poll set, but keep for analytics.
 */
async function runWelcomeFailedCleanup(): Promise<void> {
  try {
    // ── Sprint v3 (2026-06-03) — Sửa 4.5 ──
    // Sau khi welcome-probe gate nick.status (Tuần 1.3), nick offline KHÔNG
    // còn rơi vào HARD_FAIL — đã chuyển sang AWAITING_NICK + nickHoldSince.
    // HARD_FAIL còn lại đúng nghĩa "KH thực sự lỗi cứng / friend record gone"
    // → vẫn retire để khỏi đa-poll vô hạn (Anh chốt câu 3 GIỮ NGUYÊN sau khi
    // em giải thích, không bỏ retire HARD_FAIL như em đề xuất sai ban đầu).
    const { count } = await prisma.friendRequestOutbox.updateMany({
      where: {
        kind: 'WELCOME_PROBE',
        welcomeOutcome: { in: ['BLOCKED_STRANGER', 'HARD_FAIL'] },
        sequenceMaterializedAt: null,
      },
      data: {
        sequenceMaterializedAt: new Date(),
      },
    });
    if (count > 0) {
      logger.info(`[welcome-failed-cleanup] retired ${count} BLOCKED_STRANGER/HARD_FAIL rows from poll set`);
    }
  } catch (err) {
    logger.error('[welcome-failed-cleanup] error:', err);
  }
}

let welcomeFailedCleanupInterval: NodeJS.Timeout | null = null;

/**
 * Campaign timeout sweeper — P2 2026-06-02.
 *
 * Vấn đề: AutomationCampaign.state='active' có thể kẹt vĩnh viễn khi:
 *   1) sequence-step-worker crash giữa khi xử lý step cuối (chưa kịp flip campaign
 *      sang 'completed' trong tryCompleteCampaign).
 *   2) Redis mất job (eviction policy sai, OOM, restart không persistent) → jobs
 *      delayed của step N+1 bốc hơi → không bao giờ có call nào kích flip state.
 *   3) Trigger event-hook hủy hết jobs (KH block/reject) nhưng quên flip campaign.
 *
 * Hệ quả: trigger sweeper (runTriggerCompletionSweeper) check NOT EXISTS active
 * campaign → false vĩnh viễn → trigger kẹt 'active' → UI hiện đang chạy trong
 * khi thực tế đã chết.
 *
 * Threshold: 12h. Lý do (đối thoại design 2026-06-02):
 *   - 6h quá ngắn: sequence dài 10 step × 1h delay = 10h vẫn còn legit.
 *   - 24h quá lâu: sale thấy "đang chạy" cả ngày dù chết, mất trust UI.
 *   - 12h compromise: cover sequence dài 10h + buffer 2h cho delay worker chậm,
 *     vẫn detect kịp trong nửa ngày.
 *
 * Double-check an toàn: trước khi flip, scan BullMQ delayed/waiting/active jobs
 * theo prefix `${triggerId}-` (buildSequenceStepJobId pattern). Nếu vẫn còn jobs
 * → KHÔNG flip (campaign vẫn alive, chỉ là DB updatedAt chưa refresh). Chỉ flip
 * khi zero jobs pending — đó là evidence chắc chắn Redis đã mất việc.
 *
 * Flow:
 *   1. SELECT campaigns WHERE state='active' AND updatedAt < NOW() - INTERVAL '12 hours'
 *      AND triggerId IS NOT NULL.
 *   2. Với mỗi campaign: scan BullMQ jobs prefix=`${triggerId}-`. Nếu count > 0 → skip.
 *   3. UPDATE campaign SET state='timeout', completedAt=NOW().
 *   4. Log AutomationEventLog eventType='campaign_timeout' priority='urgent'.
 */
async function runCampaignTimeoutSweeper(): Promise<void> {
  try {
    // ── Sprint v3 (2026-06-03) — Sửa 5.7: đổi 12h → 24h ──
    // Anh chốt sticky+hold 24h: sequence dài nhất ~10h + buffer 14h cho nick
    // hồi. Quá 24h vẫn không advance = nick chết hẳn → timeout campaign.
    // runStickyNickHoldSweeper (mới, mục 4.8) chạy 5 phút quét nick_hold_since,
    // sẽ reset KH về queue ở mốc 24h trước khi sweeper này kích campaign timeout.
    // Sweeper campaign-timeout còn giữ làm safety net cho campaign orphan.
    const stale = await prisma.automationCampaign.findMany({
      where: {
        state: { in: ['active', 'on_hold'] },
        triggerId: { not: null },
        updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) },
      },
      select: {
        id: true,
        orgId: true,
        triggerId: true,
        sequenceId: true,
        updatedAt: true,
      },
      take: 200,
    });

    if (stale.length === 0) return;

    // Step 2: scan BullMQ pending jobs ONE TIME — getJobs across all triggers,
    // sau đó group theo triggerId prefix để check per-campaign.
    let pendingJobs: Awaited<ReturnType<ReturnType<typeof getSequenceStepQueue>['getJobs']>> = [];
    try {
      const queue = getSequenceStepQueue();
      pendingJobs = await queue.getJobs(['delayed', 'waiting', 'active'], 0, 10_000);
    } catch (err) {
      logger.warn(
        `[campaign-timeout-sweeper] BullMQ scan failed, skip this tick (sẽ retry tick sau): ${(err as Error).message}`,
      );
      return; // Defensive: nếu Redis down, KHÔNG flip oan (có thể jobs vẫn tồn tại sau khi Redis hồi).
    }

    let flipped = 0;
    for (const c of stale) {
      if (!c.triggerId) continue;
      const prefix = `${c.triggerId}-`;
      const hasPendingJob = pendingJobs.some((j) => j.id && j.id.startsWith(prefix));
      if (hasPendingJob) {
        logger.debug(
          `[campaign-timeout-sweeper] skip campaign=${c.id} trigger=${c.triggerId} — vẫn còn job pending trong BullMQ`,
        );
        continue;
      }

      // Step 3: atomic flip — đảm bảo vẫn 'active' hoặc 'on_hold' (tránh race với tryCompleteCampaign).
      // Sprint v3 (2026-06-03): on_hold cũng eligible — campaign sticky hold quá 24h thì timeout.
      const updated = await prisma.automationCampaign.updateMany({
        where: { id: c.id, state: { in: ['active', 'on_hold'] } },
        data: { state: 'timeout', completedAt: new Date() },
      });
      if (updated.count === 0) continue; // race lost, ai đó đã flip rồi

      flipped++;
      const staleHours = Math.round(
        (Date.now() - c.updatedAt.getTime()) / 3_600_000,
      );
      logger.warn(
        `[campaign-timeout-sweeper] FLIPPED campaign=${c.id} trigger=${c.triggerId} ` +
          `sequence=${c.sequenceId ?? 'null'} state='timeout' (stale ${staleHours}h, zero BullMQ jobs)`,
      );

      // Step 4: alert event log (fire-and-forget).
      void logEvent({
        orgId: c.orgId,
        triggerId: c.triggerId,
        eventType: 'campaign_timeout',
        eventPriority: 'urgent',
        summary: `Campaign ${c.id} bị timeout sau ${staleHours}h không advance (worker crash hoặc Redis mất việc).`,
        metadata: {
          campaignId: c.id,
          sequenceId: c.sequenceId,
          staleHours,
          flippedAt: new Date().toISOString(),
        },
      });
    }

    if (flipped > 0) {
      logger.warn(
        `[campaign-timeout-sweeper] flipped ${flipped}/${stale.length} stale campaigns to state='timeout'`,
      );
    }
  } catch (err) {
    logger.error('[campaign-timeout-sweeper] error:', err);
  }
}

/**
 * ════════════════════════════════════════════════════════════════════════
 * Sticky Nick Hold Sweeper — Sprint v3 (2026-06-03)
 * ════════════════════════════════════════════════════════════════════════
 * Quét entries có nick_hold_since > 24h. Reset KH về queue cho nick khác
 * làm lại từ đầu: friend + welcome + sequence.
 *
 * Anh chốt:
 *   Câu 1: append failedNickIds (Option A) — tránh nick chết tự pick lại KH
 *   Câu 2: reset luôn todayCount=0 cho nick cũ (em document, không enforce ở
 *          sweeper này — nick worker tự đọc lại khi reconnect)
 *   Câu 4: TÁCH SCOPE — Row 2.2 + 6.9 đợt sau (Anh sau đổi ý làm cùng sprint)
 *   Notification mốc T+23h (Anh edit từ 24h xuống 23h) — gửi qua kênh
 *   internal contact để Anh + chủ nick có 1h xử lý trước khi reset 24h.
 *
 * Flow per entry:
 *   1. SELECT entry WHERE nick_hold_since IS NOT NULL AND
 *      nick_hold_since < NOW() - INTERVAL '24 hours' AND
 *      queue_status IN ('processed', 'processing').
 *   2. TX (per entry):
 *      a. Snapshot outbox cũ vào automation_event_log (audit trail).
 *      b. DELETE outbox FRIEND_REQUEST + WELCOME_PROBE (theo contact+trigger).
 *      c. UPDATE entry SET queue_status='queued_for_pickup',
 *         claimed_by_nick_id=NULL, locked_at=NULL,
 *         failed_nick_ids = failed_nick_ids || jsonb_build_array(nick_cũ),
 *         restart_cycle += 1, last_reset_reason='nick_offline_24h',
 *         nick_hold_since=NULL.
 *      d. UPDATE automation_campaigns SET state='timeout', completedAt=NOW()
 *         (cho campaign có cùng triggerId+sequenceId+contact đó).
 *      e. Log AutomationEventLog eventType='nick_hold_reset' priority='urgent'.
 *   3. Pool tự nhiên cho nick khác claim lại từ đầu.
 */
async function runStickyNickHoldSweeper(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60_000);
    const stale = await prisma.customerListEntry.findMany({
      where: {
        nickHoldSince: { not: null, lt: cutoff },
        queueStatus: { in: ['processed', 'processing'] },
      },
      select: {
        id: true,
        customerListId: true,
        triggerId: true,
        contactId: true,
        claimedByNickId: true,
        nickHoldSince: true,
        restartCycle: true,
        failedNickIds: true,
        rowIndex: true,
        phoneE164: true,
      },
      take: 50, // tránh long tx
    });

    if (stale.length === 0) return;

    let resetCount = 0;
    for (const e of stale) {
      const oldNickId = e.claimedByNickId;
      const failedArr: string[] = Array.isArray(e.failedNickIds)
        ? (e.failedNickIds as string[])
        : [];
      // Append old nick to failed list — không cho nick chết tự pick lại KH cũ.
      const newFailedNickIds = oldNickId && !failedArr.includes(oldNickId)
        ? [...failedArr, oldNickId]
        : failedArr;

      try {
        await prisma.$transaction(async (tx) => {
          // Lookup org_id từ trigger (cần cho event log)
          const trigger = e.triggerId
            ? await tx.automationTrigger.findUnique({
                where: { id: e.triggerId },
                select: { orgId: true },
              })
            : null;

          // a. Snapshot outbox vào event log
          if (e.triggerId && e.contactId && trigger?.orgId) {
            const oldOutbox = await tx.friendRequestOutbox.findMany({
              where: {
                triggerId: e.triggerId,
                contactId: e.contactId,
              },
              select: {
                id: true,
                kind: true,
                nickId: true,
                sendStatus: true,
                welcomeOutcome: true,
                welcomeSentAt: true,
                attemptRound: true,
                createdAt: true,
              },
            });
            // b. DELETE outbox cũ (restart cycle xoá vết để welcome lần mới chạy được)
            if (oldOutbox.length > 0) {
              await tx.friendRequestOutbox.deleteMany({
                where: {
                  triggerId: e.triggerId,
                  contactId: e.contactId,
                },
              });
            }
            // Audit snapshot
            await tx.automationEventLog.create({
              data: {
                orgId: trigger.orgId,
                triggerId: e.triggerId,
                contactId: e.contactId,
                nickId: oldNickId,
                eventType: 'nick_hold_reset',
                eventPriority: 'urgent',
                summary: `⏰ KH #${e.rowIndex} (${e.phoneE164 ?? 'no phone'}) reset về queue sau ${Math.round((Date.now() - (e.nickHoldSince?.getTime() ?? Date.now())) / 3_600_000)}h chờ nick offline. Vòng ${(e.restartCycle ?? 0) + 1}.`,
                metadata: {
                  entryId: e.id,
                  oldNickId,
                  oldFailedNickIds: failedArr,
                  newFailedNickIds,
                  restartCycle: (e.restartCycle ?? 0) + 1,
                  outboxSnapshot: oldOutbox,
                  reason: 'nick_offline_24h',
                },
              },
            });
          }

          // c. Reset entry về queue
          await tx.customerListEntry.update({
            where: { id: e.id },
            data: {
              queueStatus: 'queued_for_pickup',
              claimedByNickId: null,
              lockedAt: null,
              failedNickIds: newFailedNickIds,
              restartCycle: { increment: 1 },
              lastResetReason: 'nick_offline_24h',
              nickHoldSince: null,
            },
          });

          // d. Flip campaign về timeout (sweeper campaign-timeout sẽ xử lý alert)
          if (e.triggerId) {
            await tx.automationCampaign.updateMany({
              where: {
                triggerId: e.triggerId,
                state: { in: ['active', 'on_hold'] },
              },
              data: {
                state: 'timeout',
                completedAt: new Date(),
                nickFirstOfflineAt: null,
              },
            });
          }
        });
        resetCount++;
        logger.warn(
          `[sticky-hold-sweeper] reset entry=${e.id} oldNick=${oldNickId} restartCycle=${(e.restartCycle ?? 0) + 1} (nick offline >24h)`,
        );
      } catch (txErr) {
        logger.error(
          `[sticky-hold-sweeper] reset entry=${e.id} failed:`,
          txErr,
        );
      }
    }

    if (resetCount > 0) {
      logger.warn(
        `[sticky-hold-sweeper] reset ${resetCount}/${stale.length} entries về queue sau 24h nick offline`,
      );
    }
  } catch (err) {
    logger.error('[sticky-hold-sweeper] error:', err);
  }
}

let stickyHoldSweeperInterval: NodeJS.Timeout | null = null;

/**
 * Start all sweepers (Sprint v3 — 7 sweeper).
 */
export function startFriendInviteSweepers(): void {
  if (
    stuckSweeperInterval ||
    triggerSweeperInterval ||
    exhaustedSweeperInterval ||
    drainerInterval ||
    welcomeFailedCleanupInterval ||
    campaignTimeoutSweeperInterval ||
    stickyHoldSweeperInterval
  ) {
    logger.warn('[friend-invite] sweepers already running, skip start');
    return;
  }

  stuckSweeperInterval = setInterval(() => void runStuckSweeper(), 60_000);
  triggerSweeperInterval = setInterval(() => void runTriggerCompletionSweeper(), 60_000);
  exhaustedSweeperInterval = setInterval(() => void runExhaustedNicksSweeper(), 60_000);
  drainerInterval = setInterval(() => void runOutboxDrainer(), 30_000);
  welcomeFailedCleanupInterval = setInterval(() => void runWelcomeFailedCleanup(), 60_000);
  // Sprint v3 2026-06-03 — campaign timeout sweeper (5 min). 24h threshold +
  // BullMQ pending-job double-check trước khi flip state='timeout'.
  campaignTimeoutSweeperInterval = setInterval(
    () => void runCampaignTimeoutSweeper(),
    5 * 60_000,
  );
  // Sprint v3 2026-06-03 — sticky-hold sweeper (5 min). 24h threshold quét
  // entry nick_hold_since > 24h → reset queue cho nick khác làm lại từ đầu.
  stickyHoldSweeperInterval = setInterval(
    () => void runStickyNickHoldSweeper(),
    5 * 60_000,
  );

  logger.info(
    '[friend-invite] sweepers started: stuck(60s) + trigger-complete(60s) + exhausted-nicks(60s) + outbox-drainer(30s) + welcome-failed-cleanup(60s) + campaign-timeout(5min,24h) + sticky-hold(5min,24h)',
  );

  // Initial run on start
  void runStuckSweeper();
  void runExhaustedNicksSweeper();
  void runTriggerCompletionSweeper();
  void runOutboxDrainer();
  void runWelcomeFailedCleanup();
  void runCampaignTimeoutSweeper();
  void runStickyNickHoldSweeper();
}

/**
 * Stop all sweepers (graceful shutdown).
 */
export function stopFriendInviteSweepers(): void {
  if (stuckSweeperInterval) clearInterval(stuckSweeperInterval);
  if (triggerSweeperInterval) clearInterval(triggerSweeperInterval);
  if (exhaustedSweeperInterval) clearInterval(exhaustedSweeperInterval);
  if (drainerInterval) clearInterval(drainerInterval);
  if (welcomeFailedCleanupInterval) clearInterval(welcomeFailedCleanupInterval);
  if (campaignTimeoutSweeperInterval) clearInterval(campaignTimeoutSweeperInterval);
  if (stickyHoldSweeperInterval) clearInterval(stickyHoldSweeperInterval);
  stuckSweeperInterval = null;
  triggerSweeperInterval = null;
  exhaustedSweeperInterval = null;
  drainerInterval = null;
  welcomeFailedCleanupInterval = null;
  campaignTimeoutSweeperInterval = null;
  stickyHoldSweeperInterval = null;
  logger.info('[friend-invite] sweepers stopped');
}
