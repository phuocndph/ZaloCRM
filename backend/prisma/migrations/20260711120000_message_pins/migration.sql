-- Ghim TIN NHAN trong hoi thoai — Conversation Content Library (2026-07-11)
--
-- THUAN BO SUNG. Tao 1 bang moi, KHONG dung bang/cot/du lieu san co. Rollback = DROP TABLE.
--
-- Khac pinned_conversations (ghim cap NICK, dong bo Zalo) va conversation_user_states
-- (ghim ca nhan per-user): bang nay ghim 1 TIN cu the, CHUNG cho moi nguoi xem duoc hoi
-- thoai. Soft-unpin: giu hang + set unpinned_* de luu lich su; re-pin = update hang cu.
-- org_id / pinned_by_user_id / unpinned_by_user_id la cot THUONG (khong FK) — resolve ten
-- nguoi ghim bang batch query, tranh churn quan he Organization/User.

CREATE TABLE "message_pins" (
    "id"                  TEXT NOT NULL,
    "org_id"              TEXT NOT NULL,
    "conversation_id"     TEXT NOT NULL,
    "message_id"          TEXT NOT NULL,
    "pinned_by_user_id"   TEXT NOT NULL,
    "pinned_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unpinned_by_user_id" TEXT,
    "unpinned_at"         TIMESTAMP(3),
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_pins_pkey" PRIMARY KEY ("id")
);

-- 1 tin chi co 1 hang pin / hoi thoai (soft-unpin -> khong ghim trung).
CREATE UNIQUE INDEX "message_pins_conversation_id_message_id_key"
    ON "message_pins"("conversation_id", "message_id");

-- Panel "Tin da ghim": loc theo hoi thoai + dang ghim (unpinned_at IS NULL), sort pinned_at desc.
CREATE INDEX "message_pins_conversation_id_unpinned_at_pinned_at_idx"
    ON "message_pins"("conversation_id", "unpinned_at", "pinned_at");

CREATE INDEX "message_pins_message_id_idx"
    ON "message_pins"("message_id");

ALTER TABLE "message_pins"
    ADD CONSTRAINT "message_pins_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_pins"
    ADD CONSTRAINT "message_pins_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
