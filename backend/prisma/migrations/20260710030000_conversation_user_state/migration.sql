-- Conversation State System — trạng thái hội thoại RIÊNG của từng user (2026-07-10)
--
-- THUẦN BỔ SUNG. Tạo 1 bảng mới, KHÔNG đụng bảng/cột/dữ liệu sẵn có. Rollback = DROP TABLE.
--
-- Khác pinned_conversations (ghim cấp NICK, đồng bộ Zalo, chung mọi người): bảng này
-- per-USER — mỗi hàng (user × conversation), chỉ ảnh hưởng chính user đó, KHÔNG đụng
-- conversations.unread_count (chưa đọc thật), KHÔNG đồng bộ Zalo.
--
-- Mở rộng tương lai (snooze/reminder/star/follow-up/VIP/priority/internal): ghi vào cột
-- JSON `flags` không cần migration; khi cần index thì ALTER TABLE thêm cột typed.

CREATE TABLE "conversation_user_states" (
    "id"               TEXT NOT NULL,
    "org_id"           TEXT NOT NULL,
    "user_id"          TEXT NOT NULL,
    "conversation_id"  TEXT NOT NULL,
    "is_pinned"        BOOLEAN NOT NULL DEFAULT false,
    "pinned_at"        TIMESTAMP(3),
    "is_manual_unread" BOOLEAN NOT NULL DEFAULT false,
    "manual_unread_at" TIMESTAMP(3),
    "flags"            JSONB NOT NULL DEFAULT '{}',
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_user_states_pkey" PRIMARY KEY ("id")
);

-- 1 user chỉ có 1 hàng state / 1 hội thoại → upsert theo khoá này.
CREATE UNIQUE INDEX "conversation_user_states_user_id_conversation_id_key"
    ON "conversation_user_states"("user_id", "conversation_id");

-- Ghim cá nhân của user (sort pinned_at desc).
CREATE INDEX "conversation_user_states_user_id_is_pinned_pinned_at_idx"
    ON "conversation_user_states"("user_id", "is_pinned", "pinned_at");

-- Badge "chưa đọc thủ công".
CREATE INDEX "conversation_user_states_user_id_is_manual_unread_idx"
    ON "conversation_user_states"("user_id", "is_manual_unread");

CREATE INDEX "conversation_user_states_conversation_id_idx"
    ON "conversation_user_states"("conversation_id");

ALTER TABLE "conversation_user_states"
    ADD CONSTRAINT "conversation_user_states_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_user_states"
    ADD CONSTRAINT "conversation_user_states_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_user_states"
    ADD CONSTRAINT "conversation_user_states_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
