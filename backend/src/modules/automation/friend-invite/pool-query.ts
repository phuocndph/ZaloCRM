// Phase Friend Invite Queue 2026-05-28 — Pool claim query với SKIP LOCKED.
//
// Worker dispatch flow 3-phase (per spike memo):
//   Phase 1 CLAIM (short DB tx <50ms): UPDATE entry status=processing, claim
//   Phase 2 ZALO HTTP (NO DB tx, 30s hard timeout): findUser + sendFriendRequest
//   Phase 3 RESULT (short DB tx <50ms):
//     - Success: UPDATE entry='processed' + INSERT outbox sendStatus='success'
//                (post-execute hook trong markDoneAndAdvance handles outbox INSERT
//                khi dispatch qua AutomationTask path. Direct claim path INSERT here.)
//     - Fail: UPDATE entry='queued_for_pickup', append nickId vào failedNickIds
//     - Timeout: UPDATE entry='processed' + outbox sendStatus='tentative'
//
// Crash recovery: nếu worker crash giữa Phase 2 và Phase 3 → entry stuck status=processing
// → stuck sweeper after 5 phút release back to pool (documented duplicate-send risk).

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';

export interface ClaimedEntry {
  id: string;
  contactId: string | null;
  phoneE164: string | null;
  phoneRaw: string;
  nameRaw: string | null;
  triggerId: string;
  zaloUid: string | null;
  rowIndex: number;
}

/**
 * Claim 1 entry từ pool cho nick này. Implements SKIP LOCKED to avoid race
 * across multiple nick workers within the same Node process.
 *
 * Returns null nếu pool empty for this nick (no entry pickable hiện tại).
 *
 * Filters:
 *   - queueStatus = 'queued_for_pickup'
 *   - trigger belongs to active list-based triggers anh chọn nickId này
 *   - NOT (failedNickIds @> [nickId])  — nick này chưa fail entry
 *   - jsonb_array_length(failedNickIds) < 5  — entry chưa fail 5 lần
 *
 * Order: rowIndex ASC, then trigger creation time ASC (FIFO).
 */
export async function claimNextEntry(nickId: string, orgId: string): Promise<ClaimedEntry | null> {
  // Single atomic UPDATE...RETURNING with SKIP LOCKED subquery.
  // Subquery checks trigger.nickIds (in segmentSpec JSONB) contains this nickId.
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      contact_id: string | null;
      phone_e164: string | null;
      phone_raw: string;
      name_raw: string | null;
      trigger_id: string;
      zalo_uid: string | null;
      row_index: number;
    }>
  >`
    UPDATE customer_list_entries
    SET claimed_by_nick_id = ${nickId},
        locked_at = NOW(),
        queue_status = 'processing'
    WHERE id = (
      SELECT e.id
      FROM customer_list_entries e
      JOIN automation_triggers t ON t.id = e.trigger_id
      WHERE e.queue_status = 'queued_for_pickup'
        AND t.state = 'active'
        AND t.org_id = ${orgId}
        AND t.event_type = 'friend_invite_to_list'
        AND (t.segment_spec->'nickIds')::jsonb @> to_jsonb(${nickId}::text)
        AND NOT (e.failed_nick_ids @> to_jsonb(${nickId}::text))
        AND jsonb_array_length(e.failed_nick_ids) < 5
      ORDER BY e.row_index ASC, t.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, contact_id, phone_e164, phone_raw, name_raw, trigger_id, zalo_uid, row_index
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    contactId: r.contact_id,
    phoneE164: r.phone_e164,
    phoneRaw: r.phone_raw,
    nameRaw: r.name_raw,
    triggerId: r.trigger_id,
    zaloUid: r.zalo_uid,
    rowIndex: r.row_index,
  };
}

/**
 * Phase 3 RESULT — Success: mark entry processed + INSERT outbox row atomically.
 * Outbox drainer cron will materialize sequence.
 */
export async function markEntrySent(input: {
  entryId: string;
  triggerId: string;
  nickId: string;
  contactId: string;
  successorSequenceId: string | null;
  sequenceSnapshot: unknown | null;
  zaloLeadgenId: string;
  isTentative: boolean;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.customerListEntry.update({
      where: { id: input.entryId },
      data: {
        queueStatus: 'processed',
        lockedAt: null,
        // processedAt is reused from enrichedAt? Keep enrichedAt for legacy;
        // Phase Friend Invite uses Outbox.createdAt as send timestamp.
      },
    });
    await tx.friendRequestOutbox.create({
      data: {
        customerListEntryId: input.entryId,
        triggerId: input.triggerId,
        nickId: input.nickId,
        contactId: input.contactId,
        successorSequenceId: input.successorSequenceId,
        sequenceVersionSnapshot: (input.sequenceSnapshot as object | undefined) ?? undefined,
        sendStatus: input.isTentative ? 'tentative' : 'success',
        zaloLeadgenId: input.zaloLeadgenId,
      },
    });
  });
}

/**
 * Phase 3 RESULT — Fail: release entry back to pool + append nickId to failedNickIds.
 * Next iteration nick khác sẽ pick.
 *
 * `failed_nick_ids = failed_nick_ids || to_jsonb(nick_id)` appends if not already present.
 * Idempotent: nếu cùng nick fail 2 lần (retry path), array vẫn unique.
 */
export async function releaseEntryFailed(input: {
  entryId: string;
  nickId: string;
  reason: string;
}): Promise<void> {
  await prisma.$executeRaw`
    UPDATE customer_list_entries
    SET queue_status = 'queued_for_pickup',
        claimed_by_nick_id = NULL,
        locked_at = NULL,
        failed_nick_ids = CASE
          WHEN failed_nick_ids @> to_jsonb(${input.nickId}::text)
            THEN failed_nick_ids
          ELSE failed_nick_ids || to_jsonb(${input.nickId}::text)
        END
    WHERE id = ${input.entryId}
  `;
  // After append, check if all 5 nicks failed → mark failed_permanent.
  // Race-safe: re-read array length.
  const after = await prisma.customerListEntry.findUnique({
    where: { id: input.entryId },
    select: { failedNickIds: true },
  });
  if (Array.isArray(after?.failedNickIds) && (after!.failedNickIds as unknown[]).length >= 5) {
    await prisma.customerListEntry.update({
      where: { id: input.entryId },
      data: { queueStatus: 'failed_permanent' },
    });
    logger.warn(
      `[friend-invite] entry ${input.entryId} marked failed_permanent after 5 nicks failed (last reason: ${input.reason})`,
    );
  }
}
