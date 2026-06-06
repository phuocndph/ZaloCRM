-- #2 2026-06-06 (Anh chốt) — DESTRUCTIVE: drop 16 cột hàng đợi + M9 override khỏi
-- customer_list_entries SAU KHI code mới đã chạy hoàn toàn từ bảng nối trigger_queue_entries
-- (verify: 2 Mục tiêu chung tệp chạy song song, delete dọn sạch). Tách riêng migration
-- để rollback an toàn (revert code + migration này, data bảng nối vẫn còn).

-- Drop 2 index trên cột sắp xoá trước (nếu không Postgres tự drop kèm cột, nhưng tường minh).
DROP INDEX IF EXISTS "customer_list_entries_queue_status_trigger_id_row_index_idx";
DROP INDEX IF EXISTS "customer_list_entries_queue_status_locked_at_idx";
DROP INDEX IF EXISTS "customer_list_entries_nick_id_override_idx";
DROP INDEX IF EXISTS "customer_list_entries_enrolled_by_enrolled_at_idx";

ALTER TABLE "customer_list_entries"
  DROP COLUMN IF EXISTS "queue_status",
  DROP COLUMN IF EXISTS "claimed_by_nick_id",
  DROP COLUMN IF EXISTS "locked_at",
  DROP COLUMN IF EXISTS "failed_nick_ids",
  DROP COLUMN IF EXISTS "stuck_recovery_count",
  DROP COLUMN IF EXISTS "rate_limit_count",
  DROP COLUMN IF EXISTS "trigger_id",
  DROP COLUMN IF EXISTS "nick_hold_since",
  DROP COLUMN IF EXISTS "restart_cycle",
  DROP COLUMN IF EXISTS "last_reset_reason",
  DROP COLUMN IF EXISTS "sequence_id_override",
  DROP COLUMN IF EXISTS "nick_id_override",
  DROP COLUMN IF EXISTS "enrolled_by",
  DROP COLUMN IF EXISTS "enroll_reason",
  DROP COLUMN IF EXISTS "enrolled_at",
  DROP COLUMN IF EXISTS "manual_enroll_meta";
