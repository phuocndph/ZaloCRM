-- Mau tin nhan NHIEU BUOC (block-based, 2026-07-11) — them cot blocks cho message_templates.
-- THUAN BO SUNG: cot nullable, mau cu (blocks NULL) van chay (derive tu content+attachments).
-- Rollback = DROP COLUMN.
ALTER TABLE "message_templates" ADD COLUMN "blocks" JSONB;
