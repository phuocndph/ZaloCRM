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

  // 1. Set triggerId on entries (if not yet set) — claim ownership
  await prisma.customerListEntry.updateMany({
    where: {
      customerListId: spec.listId,
      // Don't overwrite if already in another active trigger
      triggerId: null,
    },
    data: { triggerId },
  });

  // 2. Scoped batch UPDATE with CTE — per spike #1 query plan verified
  //    Replaces queue_status to: queued_for_pickup | skipped_* | unchanged.
  //    Uses Friend table for friend cap + Conversation+Message for recency.
  const entryStatusList =
    entryStatuses.length > 0 ? entryStatuses.map((s) => `'${s.replace(/'/g, "''")}'`).join(',') : "''";

  // Use raw SQL because CASE expression across multiple LEFT JOINs + filters
  // is awkward in Prisma. Scoped tới THIS trigger only.
  const rawUpdateResult = await prisma.$executeRawUnsafe(
    `
    WITH this_trigger_contacts AS (
      SELECT contact_id FROM customer_list_entries
      WHERE trigger_id = $1 AND contact_id IS NOT NULL
    ),
    friend_count AS (
      SELECT f.contact_id, COUNT(*) AS cnt
      FROM friends f
      JOIN this_trigger_contacts t ON t.contact_id = f.contact_id
      WHERE f.org_id = $2
      GROUP BY f.contact_id
    ),
    last_chat AS (
      SELECT c.contact_id, MAX(m.sent_at) AS last_at
      FROM conversations c
      JOIN this_trigger_contacts t ON t.contact_id = c.contact_id
      JOIN messages m ON m.conversation_id = c.id
      WHERE c.org_id = $2
        AND m.sent_at > NOW() - INTERVAL '${Math.max(recencyDays, 30)} days'
      GROUP BY c.contact_id
    )
    UPDATE customer_list_entries e
    SET queue_status = CASE
      WHEN e.has_zalo = false THEN 'skipped_no_zalo'
      WHEN e.has_zalo IS NULL THEN 'queued_for_pickup'
      WHEN fc.cnt > $3 THEN 'skipped_friend_cap'
      WHEN lc.last_at > NOW() - INTERVAL '${recencyDays} days' THEN 'skipped_recency'
      WHEN e.status IN (${entryStatusList}) THEN 'skipped_status'
      ELSE 'queued_for_pickup'
    END
    FROM (SELECT 1) dummy
    LEFT JOIN friend_count fc ON true
    LEFT JOIN last_chat lc ON true
    WHERE e.trigger_id = $1
      AND (fc.contact_id IS NULL OR fc.contact_id = e.contact_id)
      AND (lc.contact_id IS NULL OR lc.contact_id = e.contact_id)
    `,
    triggerId,
    orgId,
    friendCap,
  );

  // 3. Count results
  const counts = await prisma.customerListEntry.groupBy({
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
