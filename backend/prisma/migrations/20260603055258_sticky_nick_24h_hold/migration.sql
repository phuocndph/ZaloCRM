-- ════════════════════════════════════════════════════════════════════════
-- Sticky Nick 24h Hold Flow — Sprint v3 (2026-06-03)
-- ════════════════════════════════════════════════════════════════════════
-- Anh Lộc chốt: nick gắn chặt 1 KH hết sequence. Nick chết → hold 23h →
-- reset queue cho nick khác làm lại từ đầu. Trùng welcome OK.
--
-- 4 cột mới:
--   customer_list_entries.nick_hold_since     — mốc bắt đầu chờ nick hồi
--   customer_list_entries.restart_cycle       — số lần KH bị reset (Vòng N)
--   customer_list_entries.last_reset_reason   — lý do reset (audit)
--   friend_request_outbox.attempt_round       — số vòng welcome (khớp restart_cycle)
--   friend_request_outbox.nick_first_offline_at — mốc nick offline với outbox này
--   automation_campaigns.nick_first_offline_at — mốc nick offline với campaign này
--
-- Index đổi: uniq_outbox_welcome_sent_per_contact_trigger →
--           uniq_outbox_welcome_sent_per_contact_trigger_round
--
-- An toàn: tất cả cột mới có DEFAULT, không break query cũ.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. customer_list_entries: thêm 3 cột sticky hold ──
ALTER TABLE customer_list_entries
  ADD COLUMN IF NOT EXISTS nick_hold_since    TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS restart_cycle      INT         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reset_reason  VARCHAR(64) NULL;

-- Partial index quét entry đang hold (sweeper 5 phút)
CREATE INDEX IF NOT EXISTS idx_entries_nick_hold_since
  ON customer_list_entries (nick_hold_since)
  WHERE nick_hold_since IS NOT NULL;

-- ── 2. friend_request_outbox: thêm 2 cột attempt + offline tracking ──
ALTER TABLE friend_request_outbox
  ADD COLUMN IF NOT EXISTS attempt_round         INT         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nick_first_offline_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_outbox_nick_first_offline_at
  ON friend_request_outbox (nick_first_offline_at)
  WHERE nick_first_offline_at IS NOT NULL;

-- ── 3. automation_campaigns: tracking offline cho campaign ──
ALTER TABLE automation_campaigns
  ADD COLUMN IF NOT EXISTS nick_first_offline_at TIMESTAMPTZ NULL;

-- ── 4. Đổi unique index welcome theo attempt_round ──
-- Cho phép cùng (contact, trigger) gửi welcome nhiều vòng sau reset.
-- Migration cũ 20260602170000_welcome_per_trigger đã tạo:
--   uniq_outbox_welcome_sent_per_contact_trigger
-- ON (contact_id, trigger_id) WHERE welcome_outcome IN ('sent', 'retry')

DROP INDEX IF EXISTS uniq_outbox_welcome_sent_per_contact_trigger;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_outbox_welcome_sent_per_contact_trigger_round
  ON friend_request_outbox (contact_id, trigger_id, attempt_round)
  WHERE welcome_outcome IN ('sent', 'retry');

-- Helper read index cũ vẫn giữ (idx_outbox_welcome_dedup)
