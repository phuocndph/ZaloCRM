-- LỖI B (review-epoch 2026-06-15): cho phép 1 KH chạy NHIỀU luồng bám đuổi KHÁC NHAU
-- song song trên CÙNG (contact, nick, trigger) — anh đã chốt rule này 2026-06-12.
--
-- Index cũ care_sessions_active_uniq (contact_id, nick_id, source_trigger_id) WHERE active
-- KHÔNG gồm source_sequence_id → gắn luồng B trong khi luồng A active cùng (contact,nick,
-- systemTrigger dùng chung) → P2002 → code reuse phiên luồng A → luồng B chết âm thầm.
--
-- Sửa: thêm source_sequence_id vào index. Vẫn chặn TRÙNG cùng-1-luồng (ý nghĩa gốc của
-- index: chống race enroll + self-heal tạo 2 phiên active cho cùng luồng), nhưng cho phép
-- 2 luồng KHÁC nhau cùng tồn tại. COALESCE để source_sequence_id NULL (phiên trigger thuần
-- không gắn sequence) vẫn chặn trùng như cũ (NULL coi như '' — 1 nhóm duy nhất).

DROP INDEX IF EXISTS care_sessions_active_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS care_sessions_active_uniq
ON care_sessions (contact_id, nick_id, source_trigger_id, COALESCE(source_sequence_id, ''))
WHERE state = 'active' AND source_trigger_id IS NOT NULL;
