-- Mau tin nhan da phuong tien (2026-07-11) — them cot attachments cho message_templates.
-- THUAN BO SUNG: cot moi co default '[]', khong dung du lieu cu. Rollback = DROP COLUMN.
ALTER TABLE "message_templates" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';
