ALTER TABLE "media_blobs" ADD COLUMN "storage_driver" TEXT NOT NULL DEFAULT 'local';

ALTER TABLE "storage_cleanup_runs"
  ADD COLUMN "failed_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "target_name" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'previewed',
  ADD COLUMN "breakdown" JSONB,
  ADD COLUMN "error_summary" JSONB,
  ADD COLUMN "expires_at" TIMESTAMP(3),
  ADD COLUMN "started_at" TIMESTAMP(3),
  ADD COLUMN "completed_at" TIMESTAMP(3);

CREATE TABLE "storage_cleanup_items" (
  "run_id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storage_cleanup_items_pkey" PRIMARY KEY ("run_id", "asset_id"),
  CONSTRAINT "storage_cleanup_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "storage_cleanup_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "storage_cleanup_items_run_id_status_idx" ON "storage_cleanup_items"("run_id", "status");

CREATE TABLE "media_storage_attributions" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "media_asset_id" TEXT NOT NULL,
  "zalo_account_id" TEXT,
  "conversation_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "media_storage_attributions_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "media_storage_attributions" ADD CONSTRAINT "media_storage_attributions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_storage_attributions" ADD CONSTRAINT "media_storage_attributions_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_storage_attributions" ADD CONSTRAINT "media_storage_attributions_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "media_storage_attributions" ADD CONSTRAINT "media_storage_attributions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "media_storage_attributions_media_asset_id_zalo_account_id_conversation_id_key" ON "media_storage_attributions"("media_asset_id", "zalo_account_id", "conversation_id");
CREATE INDEX "media_storage_attributions_org_id_zalo_account_id_idx" ON "media_storage_attributions"("org_id", "zalo_account_id");
CREATE INDEX "media_storage_attributions_org_id_conversation_id_idx" ON "media_storage_attributions"("org_id", "conversation_id");

INSERT INTO "media_storage_attributions" ("id", "org_id", "media_asset_id", "zalo_account_id", "conversation_id", "created_at")
SELECT gen_random_uuid()::text, e."org_id", e."media_asset_id", c."zalo_account_id", e."conversation_id", MIN(e."created_at")
FROM "media_usage_events" e
JOIN "conversations" c ON c."id" = e."conversation_id"
WHERE e."event_type" = 'saved_from_chat' AND e."conversation_id" IS NOT NULL
GROUP BY e."org_id", e."media_asset_id", c."zalo_account_id", e."conversation_id"
ON CONFLICT DO NOTHING;
