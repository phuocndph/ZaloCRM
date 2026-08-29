// SPDX-License-Identifier: AGPL-3.0-or-later
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

interface ReconcileRow {
  updatedCount: bigint;
}

export async function reconcileFriendMessageAggregates(): Promise<number> {
  const rows = await prisma.$queryRaw<ReconcileRow[]>`
    WITH message_aggregates AS (
      SELECT
        f.id AS friend_id,
        COUNT(m.id) FILTER (WHERE m.sender_type = 'contact')::integer AS total_inbound,
        COUNT(m.id) FILTER (WHERE m.sender_type = 'self')::integer AS total_outbound,
        MIN(m.sent_at) FILTER (WHERE m.sender_type IN ('contact', 'self')) AS first_message_at,
        MAX(m.sent_at) FILTER (WHERE m.sender_type = 'contact') AS last_inbound_at,
        MAX(m.sent_at) FILTER (WHERE m.sender_type = 'self') AS last_outbound_at,
        MAX(m.sent_at) FILTER (WHERE m.sender_type IN ('contact', 'self')) AS last_interaction_at
      FROM friends f
      LEFT JOIN conversations c
        ON c.org_id = f.org_id
        AND c.zalo_account_id = f.zalo_account_id
        AND c.external_thread_id = f.zalo_uid_in_nick
        AND c."threadType" = 'user'
      LEFT JOIN messages m ON m.conversation_id = c.id
      GROUP BY f.id
    ), updated AS (
      UPDATE friends f
      SET
        total_inbound = a.total_inbound,
        total_outbound = a.total_outbound,
        first_message_at = a.first_message_at,
        last_inbound_at = a.last_inbound_at,
        last_outbound_at = a.last_outbound_at,
        last_interaction_at = a.last_interaction_at
      FROM message_aggregates a
      WHERE f.id = a.friend_id
        AND (
          f.total_inbound IS DISTINCT FROM a.total_inbound
          OR f.total_outbound IS DISTINCT FROM a.total_outbound
          OR f.first_message_at IS DISTINCT FROM a.first_message_at
          OR f.last_inbound_at IS DISTINCT FROM a.last_inbound_at
          OR f.last_outbound_at IS DISTINCT FROM a.last_outbound_at
          OR f.last_interaction_at IS DISTINCT FROM a.last_interaction_at
        )
      RETURNING f.id
    )
    SELECT COUNT(*)::bigint AS "updatedCount" FROM updated
  `;
  return Number(rows[0]?.updatedCount ?? 0);
}

export function startFriendMessageReconcileCron(): void {
  cron.schedule('15 3 * * *', async () => {
    try {
      const updated = await reconcileFriendMessageAggregates();
      if (updated > 0) logger.info(`[friend-message-reconcile] corrected ${updated} Friend rows`);
    } catch (error) {
      logger.error('[friend-message-reconcile] failed:', error);
    }
  });
}
