-- Sequence recode (Đợt 1+2, 2026-06-13..15): cột mềm nullable cho engine bám đuổi.
-- An toàn: tất cả ADD COLUMN nullable, không default constraint, không đụng data cũ.
-- (Localhost đã ALTER thủ công lúc dev; migration này để VPS/CI có cột khi deploy.)

-- Friend — gửi bất chấp + KH bật chặn tin người lạ.
ALTER TABLE "friends" ADD COLUMN IF NOT EXISTS "stranger_blocked" BOOLEAN;
ALTER TABLE "friends" ADD COLUMN IF NOT EXISTS "stranger_blocked_at" TIMESTAMP(3);

-- CareSession — luật 4 pause/resume + snapshot rules + epoch số lần gắn.
ALTER TABLE "care_sessions" ADD COLUMN IF NOT EXISTS "paused_at_step_idx" INTEGER;
ALTER TABLE "care_sessions" ADD COLUMN IF NOT EXISTS "pause_epoch" INTEGER;
ALTER TABLE "care_sessions" ADD COLUMN IF NOT EXISTS "rules_snapshot" JSONB;
ALTER TABLE "care_sessions" ADD COLUMN IF NOT EXISTS "enroll_epoch" INTEGER;
