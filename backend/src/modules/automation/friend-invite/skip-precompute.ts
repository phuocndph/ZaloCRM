// Phase Friend Invite Queue 2026-05-28 — Skip rules pre-compute + pool seed.
//
// Called khi trigger transition draft → active. 1 large UPDATE scoped tới
// trigger's customer list contacts only (per spike #1 verified 16.8ms cho 714 entries).
//
// Spec: triggers/segment-spec.schema.ts
//   { kind:'customer_list_pool', listId, nickIds[],
//     skipRules:{ recencyDays, friendCap, entryStatuses[] } }

import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';

export interface FriendInviteSegmentSpec {
  kind: 'customer_list_pool';
  listId: string;
  nickIds: string[];
  skipRules: {
    recencyDays: number; // default 7
    friendCap: number; // default 2
    entryStatuses: string[]; // statuses to skip (multi-select)
  };
}

export function isFriendInviteSegmentSpec(spec: unknown): spec is FriendInviteSegmentSpec {
  if (!spec || typeof spec !== 'object') return false;
  const s = spec as Record<string, unknown>;
  if (s.kind !== 'customer_list_pool') return false;
  if (typeof s.listId !== 'string') return false;
  if (!Array.isArray(s.nickIds) || s.nickIds.length === 0) return false;
  if (!s.skipRules || typeof s.skipRules !== 'object') return false;
  const sr = s.skipRules as Record<string, unknown>;
  if (typeof sr.recencyDays !== 'number') return false;
  if (typeof sr.friendCap !== 'number') return false;
  if (!Array.isArray(sr.entryStatuses)) return false;
  return true;
}

export interface PrecomputeResult {
  totalEntries: number;
  queuedForPickup: number;
  skippedFriendCap: number;
  skippedRecency: number;
  skippedStatus: number;
  skippedNoZalo: number;
  durationMs: number;
}

/**
 * Scoped batch UPDATE — pre-compute skip rules + seed pool.
 *
 * Idempotent: re-run on same trigger overwrites queue_status based on current data.
 */
export async function precomputeAndSeedPool(input: {
  triggerId: string;
  orgId: string;
  spec: FriendInviteSegmentSpec;
}): Promise<PrecomputeResult> {
  const start = Date.now();
  const { triggerId, orgId, spec } = input;
  const { recencyDays, friendCap, entryStatuses } = spec.skipRules;

  // #2 2026-06-06 (Anh chốt) — MỖI MỤC TIÊU ĐỘC LẬP, KHÔNG chống trùng.
  // Trước đây "claim ownership" set trigger_id trên entry → 1 khách chỉ thuộc 1 Mục tiêu
  // → 2 Mục tiêu chung tệp tranh nhau (release stale + chỉ claim trigger_id=null). BỎ HẲN
  // logic đó. Giờ INSERT 1 hàng bảng nối cho MỌI entry của list (mỗi Mục tiêu hàng riêng).
  // ON CONFLICT DO NOTHING: re-seed (cron re-activate) idempotent, KHÔNG xoá tiến độ đang chạy.
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO trigger_queue_entries
      (id, trigger_id, customer_list_entry_id, org_id, customer_list_id, contact_id,
       queue_status, failed_nick_ids, stuck_recovery_count, rate_limit_count, created_at, updated_at)
    SELECT gen_random_uuid()::text, $1, e.id, $2, e.customer_list_id, e.contact_id,
           'queued_for_pickup', '[]'::jsonb, 0, 0, NOW(), NOW()
    FROM customer_list_entries e
    WHERE e.customer_list_id = $3
    ON CONFLICT (trigger_id, customer_list_entry_id) DO NOTHING
    `,
    triggerId,
    orgId,
    spec.listId,
  );

  // 2. Scoped batch UPDATE with CTE — per spike #1 query plan verified
  //    Replaces queue_status to: queued_for_pickup | skipped_* | unchanged.
  //    #2 2026-06-06: target BẢNG NỐI (theo triggerId), đọc has_zalo/status từ entry.
  //    Uses Friend table for friend cap + Conversation+Message for recency.
  const entryStatusList =
    entryStatuses.length > 0 ? entryStatuses.map((s) => `'${s.replace(/'/g, "''")}'`).join(',') : "''";

  // Fix 2026-05-29 (Wave 1.5-B): semantic 0 = "không apply rule" (anh chốt).
  //   friendCap=0  → KHÔNG check friend count (gửi cho cả KH đã là bạn)
  //   recencyDays=0 → KHÔNG check recency (gửi cả KH vừa chat)
  //
  // Scalar subqueries trong CASE thay vì LEFT JOIN cross product
  // (cross product không match entries thiếu Friend/Conversation → bỏ sót entries).
  // Inline orgId + friendCap vào clause string (escape SQL — orgId là UUID đã validate
  // tại route layer, friendCap là number → safe). Tránh dynamic $param binding mismatch.
  const orgIdLit = `'${orgId.replace(/'/g, "''")}'`;
  const friendCapClause = friendCap > 0
    ? `WHEN COALESCE((SELECT COUNT(*) FROM friends f WHERE f.org_id = ${orgIdLit} AND f.contact_id = e.contact_id), 0) > ${friendCap} THEN 'skipped_friend_cap'`
    : '';
  const recencyClause = recencyDays > 0
    ? `WHEN COALESCE((SELECT MAX(m.sent_at) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.org_id = ${orgIdLit} AND c.contact_id = e.contact_id AND m.sent_at > NOW() - INTERVAL '${Math.max(recencyDays, 30)} days'), TIMESTAMP 'epoch') > NOW() - INTERVAL '${recencyDays} days' THEN 'skipped_recency'`
    : '';

  const rawUpdateResult = await prisma.$executeRawUnsafe(
    `
    UPDATE trigger_queue_entries q
    SET queue_status = CASE
      WHEN e.has_zalo = false THEN 'skipped_no_zalo'
      ${friendCapClause}
      ${recencyClause}
      WHEN e.status IN (${entryStatusList}) THEN 'skipped_status'
      ELSE 'queued_for_pickup'
    END,
    updated_at = NOW()
    FROM customer_list_entries e
    WHERE q.customer_list_entry_id = e.id
      AND q.trigger_id = $1
      -- chỉ (re)tính cho hàng chưa xử lý — KHÔNG đụng hàng đang processing/processed
      AND q.queue_status = 'queued_for_pickup'
    `,
    triggerId,
  );

  // 3. Count results (bảng nối, theo triggerId)
  const counts = await prisma.triggerQueueEntry.groupBy({
    by: ['queueStatus'],
    where: { triggerId },
    _count: { id: true },
  });

  const result: PrecomputeResult = {
    totalEntries: 0,
    queuedForPickup: 0,
    skippedFriendCap: 0,
    skippedRecency: 0,
    skippedStatus: 0,
    skippedNoZalo: 0,
    durationMs: Date.now() - start,
  };
  for (const c of counts) {
    const n = c._count.id;
    result.totalEntries += n;
    if (c.queueStatus === 'queued_for_pickup') result.queuedForPickup = n;
    else if (c.queueStatus === 'skipped_friend_cap') result.skippedFriendCap = n;
    else if (c.queueStatus === 'skipped_recency') result.skippedRecency = n;
    else if (c.queueStatus === 'skipped_status') result.skippedStatus = n;
    else if (c.queueStatus === 'skipped_no_zalo') result.skippedNoZalo = n;
  }

  logger.info(
    `[friend-invite] precompute trigger=${triggerId} duration=${result.durationMs}ms ` +
      `pool=${result.queuedForPickup} skipFriendCap=${result.skippedFriendCap} ` +
      `skipRecency=${result.skippedRecency} skipStatus=${result.skippedStatus} ` +
      `skipNoZalo=${result.skippedNoZalo} total=${result.totalEntries} rawUpdated=${rawUpdateResult}`,
  );

  return result;
}
