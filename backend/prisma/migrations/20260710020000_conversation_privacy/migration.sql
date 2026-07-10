-- Riêng tư cấp HỘI THOẠI — "Chỉ mình tôi xem cuộc hội thoại này" (2026-07-09)
--
-- THUẦN BỔ SUNG. Không DROP, không ALTER cột sẵn có, không đụng dữ liệu.
-- Mọi hội thoại hiện hữu nhận is_private = false → hành vi không đổi (yêu cầu 12).
--
-- private_owner_user_id FK ON DELETE SET NULL: xóa nhân viên → cờ riêng tư VẪN CÒN
-- (không ai xem được), chỉ Admin gỡ được qua force-release (yêu cầu 10).

ALTER TABLE "conversations" ADD COLUMN "is_private" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversations" ADD COLUMN "private_owner_user_id" TEXT;
ALTER TABLE "conversations" ADD COLUMN "private_enabled_at" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN "private_disabled_at" TIMESTAMP(3);

CREATE INDEX "conversations_private_owner_user_id_idx" ON "conversations"("private_owner_user_id");

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_private_owner_user_id_fkey"
  FOREIGN KEY ("private_owner_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
