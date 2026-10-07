-- Keep inbound chat media durable even when the Zalo CDN is temporarily unavailable.
ALTER TABLE "messages"
  ADD COLUMN "media_mirror_state" TEXT,
  ADD COLUMN "media_mirror_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "media_mirror_next_attempt_at" TIMESTAMP(3),
  ADD COLUMN "media_mirror_locked_at" TIMESTAMP(3),
  ADD COLUMN "media_mirror_last_error" TEXT,
  ADD COLUMN "media_mirrored_at" TIMESTAMP(3);

CREATE INDEX "messages_media_mirror_state_media_mirror_next_attempt_at_idx"
  ON "messages"("media_mirror_state", "media_mirror_next_attempt_at");
