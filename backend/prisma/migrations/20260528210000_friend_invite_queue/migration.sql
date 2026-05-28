-- Phase Friend Invite Queue 2026-05-28
-- Producer-consumer queue model cho Mục tiêu auto kết bạn + bám đuổi tin lạ.

-- ============================================================================
-- AlterTable customer_list_entries — queue fields
-- ============================================================================
ALTER TABLE "customer_list_entries"
  ADD COLUMN "queue_status" TEXT,
  ADD COLUMN "claimed_by_nick_id" TEXT,
  ADD COLUMN "locked_at" TIMESTAMP(3),
  ADD COLUMN "failed_nick_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "stuck_recovery_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "trigger_id" TEXT;

CREATE INDEX "customer_list_entries_queue_status_trigger_id_row_index_idx"
  ON "customer_list_entries"("queue_status", "trigger_id", "row_index");
CREATE INDEX "customer_list_entries_queue_status_locked_at_idx"
  ON "customer_list_entries"("queue_status", "locked_at");

-- GIN index for failed_nick_ids JSONB array exclusion query
CREATE INDEX "customer_list_entries_failed_nick_ids_gin_idx"
  ON "customer_list_entries" USING GIN ("failed_nick_ids");

-- ============================================================================
-- AlterTable automation_triggers — successor sequence + greeting + state machine
-- ============================================================================
ALTER TABLE "automation_triggers"
  ADD COLUMN "successor_sequence_id" TEXT,
  ADD COLUMN "greeting_template" TEXT,
  ADD COLUMN "state" TEXT NOT NULL DEFAULT 'draft';

-- ============================================================================
-- AlterTable zalo_accounts — stranger message cap (anh chốt 300/ngày default)
-- ============================================================================
ALTER TABLE "zalo_accounts"
  ADD COLUMN "daily_stranger_message_cap" INTEGER NOT NULL DEFAULT 300,
  ADD COLUMN "last_stranger_message_at" TIMESTAMP(3);

-- ============================================================================
-- CreateTable friend_request_outbox — atomic send + materialize bridge
-- ============================================================================
CREATE TABLE "friend_request_outbox" (
  "id" TEXT NOT NULL,
  "customer_list_entry_id" TEXT NOT NULL,
  "trigger_id" TEXT NOT NULL,
  "nick_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "successor_sequence_id" TEXT,
  "sequence_version_snapshot" JSONB,
  "send_status" TEXT NOT NULL,
  "zalo_leadgen_id" TEXT,
  "sequence_materialized_at" TIMESTAMP(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "friend_request_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "friend_request_outbox_customer_list_entry_id_key"
  ON "friend_request_outbox"("customer_list_entry_id");
CREATE INDEX "friend_request_outbox_send_status_sequence_materialized_at_idx"
  ON "friend_request_outbox"("send_status", "sequence_materialized_at");
CREATE INDEX "friend_request_outbox_nick_id_created_at_idx"
  ON "friend_request_outbox"("nick_id", "created_at");
