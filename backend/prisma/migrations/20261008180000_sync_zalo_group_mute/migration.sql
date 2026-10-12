ALTER TABLE "conversations"
  ADD COLUMN "zalo_notifications_muted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "zalo_muted_until" TIMESTAMP(3),
  ADD COLUMN "zalo_mute_synced_at" TIMESTAMP(3);

CREATE INDEX "conversations_zalo_notifications_muted_idx"
  ON "conversations"("zalo_notifications_muted", "zalo_muted_until");
