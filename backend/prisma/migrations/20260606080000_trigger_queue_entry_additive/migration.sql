-- #2 2026-06-06 (Anh chốt) — Bảng nối hàng đợi per-Mục-tiêu (ADDITIVE).
-- Bước này CHỈ tạo bảng + dời dữ liệu. CHƯA drop cột cũ trên customer_list_entries
-- (drop ở migration sau, sau khi verify code mới chạy ổn — rollback an toàn).

CREATE TABLE "trigger_queue_entries" (
  "id"                     TEXT NOT NULL,
  "trigger_id"             TEXT NOT NULL,
  "customer_list_entry_id" TEXT NOT NULL,
  "org_id"                 TEXT NOT NULL,
  "customer_list_id"       TEXT NOT NULL,
  "contact_id"             TEXT,
  "queue_status"           TEXT NOT NULL DEFAULT 'queued_for_pickup',
  "claimed_by_nick_id"     TEXT,
  "locked_at"              TIMESTAMP(3),
  "failed_nick_ids"        JSONB NOT NULL DEFAULT '[]',
  "stuck_recovery_count"   INTEGER NOT NULL DEFAULT 0,
  "rate_limit_count"       INTEGER NOT NULL DEFAULT 0,
  "nick_hold_since"        TIMESTAMP(3),
  "restart_cycle"          INTEGER NOT NULL DEFAULT 0,
  "last_reset_reason"      TEXT,
  "sequence_id_override"   TEXT,
  "nick_id_override"       TEXT,
  "enrolled_by"            TEXT,
  "enroll_reason"          TEXT,
  "enrolled_at"            TIMESTAMP(3),
  "manual_enroll_meta"     JSONB,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trigger_queue_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trigger_queue_entries_trigger_id_customer_list_entry_id_key"
  ON "trigger_queue_entries"("trigger_id", "customer_list_entry_id");
CREATE INDEX "trigger_queue_entries_queue_status_trigger_id_idx"
  ON "trigger_queue_entries"("queue_status", "trigger_id");
CREATE INDEX "trigger_queue_entries_queue_status_locked_at_idx"
  ON "trigger_queue_entries"("queue_status", "locked_at");
CREATE INDEX "trigger_queue_entries_claimed_by_nick_id_queue_status_idx"
  ON "trigger_queue_entries"("claimed_by_nick_id", "queue_status");
CREATE INDEX "trigger_queue_entries_nick_hold_since_idx"
  ON "trigger_queue_entries"("nick_hold_since");
CREATE INDEX "trigger_queue_entries_trigger_id_contact_id_idx"
  ON "trigger_queue_entries"("trigger_id", "contact_id");
CREATE INDEX "trigger_queue_entries_customer_list_entry_id_idx"
  ON "trigger_queue_entries"("customer_list_entry_id");

ALTER TABLE "trigger_queue_entries"
  ADD CONSTRAINT "trigger_queue_entries_trigger_id_fkey"
  FOREIGN KEY ("trigger_id") REFERENCES "automation_triggers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trigger_queue_entries"
  ADD CONSTRAINT "trigger_queue_entries_customer_list_entry_id_fkey"
  FOREIGN KEY ("customer_list_entry_id") REFERENCES "customer_list_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dời dữ liệu: mỗi entry đang có trigger_id → 1 hàng bảng nối, mang nguyên trạng thái.
-- COALESCE queue_status để entry legacy NULL không biến mất khỏi hàng đợi.
-- Bỏ qua entry mà trigger_id trỏ tới trigger đã bị xóa (LEFT JOIN guard) — tránh FK fail.
INSERT INTO "trigger_queue_entries" (
  "id", "trigger_id", "customer_list_entry_id", "org_id", "customer_list_id", "contact_id",
  "queue_status", "claimed_by_nick_id", "locked_at", "failed_nick_ids",
  "stuck_recovery_count", "rate_limit_count", "nick_hold_since", "restart_cycle", "last_reset_reason",
  "sequence_id_override", "nick_id_override", "enrolled_by", "enroll_reason", "enrolled_at", "manual_enroll_meta",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text, e."trigger_id", e."id", cl."org_id", e."customer_list_id", e."contact_id",
  COALESCE(e."queue_status", 'queued_for_pickup'), e."claimed_by_nick_id", e."locked_at", e."failed_nick_ids",
  e."stuck_recovery_count", e."rate_limit_count", e."nick_hold_since", e."restart_cycle", e."last_reset_reason",
  e."sequence_id_override", e."nick_id_override", e."enrolled_by", e."enroll_reason", e."enrolled_at", e."manual_enroll_meta",
  e."created_at", NOW()
FROM "customer_list_entries" e
JOIN "customer_lists" cl ON cl."id" = e."customer_list_id"
JOIN "automation_triggers" t ON t."id" = e."trigger_id"
WHERE e."trigger_id" IS NOT NULL
ON CONFLICT ("trigger_id", "customer_list_entry_id") DO NOTHING;
