-- Universal storage ledger for R2/local objects and their tenant/message references.
UPDATE "media_blobs"
SET "storage_driver" = 'r2'
WHERE "public_url" ~* '^https://[^/]*(r2\.dev|r2\.cloudflarestorage\.com)/';

CREATE TABLE "storage_objects" (
  "id" TEXT NOT NULL,
  "storage_driver" TEXT NOT NULL,
  "object_key" TEXT NOT NULL,
  "public_url" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_type" TEXT NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storage_objects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "storage_objects_storage_driver_object_key_key" ON "storage_objects"("storage_driver", "object_key");
CREATE INDEX "storage_objects_file_type_created_at_idx" ON "storage_objects"("file_type", "created_at");

CREATE TABLE "storage_object_references" (
  "id" TEXT NOT NULL,
  "object_id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "reference_key" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "zalo_account_id" TEXT,
  "conversation_id" TEXT,
  "message_id" TEXT,
  "media_asset_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storage_object_references_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "storage_object_references_reference_key_key" ON "storage_object_references"("reference_key");
CREATE INDEX "storage_object_references_org_id_created_at_idx" ON "storage_object_references"("org_id", "created_at");
CREATE INDEX "storage_object_references_org_id_zalo_account_id_created_at_idx" ON "storage_object_references"("org_id", "zalo_account_id", "created_at");
CREATE INDEX "storage_object_references_org_id_conversation_id_created_at_idx" ON "storage_object_references"("org_id", "conversation_id", "created_at");
CREATE INDEX "storage_object_references_object_id_org_id_idx" ON "storage_object_references"("object_id", "org_id");
ALTER TABLE "storage_object_references" ADD CONSTRAINT "storage_object_references_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "storage_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "storage_object_references" ADD CONSTRAINT "storage_object_references_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "storage_object_references" ADD CONSTRAINT "storage_object_references_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "storage_object_references" ADD CONSTRAINT "storage_object_references_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "storage_object_references" ADD CONSTRAINT "storage_object_references_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "storage_object_references" ADD CONSTRAINT "storage_object_references_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "storage_cleanup_object_items" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "object_id" TEXT NOT NULL,
  "reference_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "object_key" TEXT NOT NULL,
  "storage_driver" TEXT NOT NULL,
  "size_bytes" BIGINT NOT NULL DEFAULT 0,
  "file_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storage_cleanup_object_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "storage_cleanup_object_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "storage_cleanup_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "storage_cleanup_object_items_run_id_object_id_key" ON "storage_cleanup_object_items"("run_id", "object_id");
CREATE INDEX "storage_cleanup_object_items_run_id_status_idx" ON "storage_cleanup_object_items"("run_id", "status");

-- Backfill physical objects already represented by MediaBlob.
INSERT INTO "storage_objects" ("id", "storage_driver", "object_key", "public_url", "content_hash", "mime_type", "file_type", "size_bytes", "created_at", "updated_at")
SELECT gen_random_uuid()::text, b."storage_driver", b."minio_key", b."public_url", b."content_hash", b."mime_type",
  CASE WHEN b."mime_type" LIKE 'audio/%' THEN 'audio'
       WHEN b."mime_type" LIKE 'image/%' THEN 'image'
       WHEN b."mime_type" LIKE 'video/%' THEN 'video'
       ELSE 'file' END,
  b."size_bytes"::bigint, b."created_at", NOW()
FROM "media_blobs" b
ON CONFLICT ("storage_driver", "object_key") DO UPDATE SET
  "public_url" = EXCLUDED."public_url", "mime_type" = EXCLUDED."mime_type",
  "file_type" = EXCLUDED."file_type", "size_bytes" = EXCLUDED."size_bytes", "updated_at" = NOW();

-- One reference per media attribution; fall back to the MediaAsset itself when unattributed.
INSERT INTO "storage_object_references" ("id", "object_id", "org_id", "reference_key", "source", "purpose", "zalo_account_id", "conversation_id", "media_asset_id", "created_at")
SELECT gen_random_uuid()::text, so."id", b."org_id",
  'asset:' || b."asset_id" || ':blob:' || b."id" || ':attr:' || a."id",
  'media_asset', b."variant_type", a."zalo_account_id", a."conversation_id", b."asset_id", a."created_at"
FROM "media_blobs" b
JOIN "storage_objects" so ON so."storage_driver" = b."storage_driver" AND so."object_key" = b."minio_key"
JOIN "media_storage_attributions" a ON a."media_asset_id" = b."asset_id"
ON CONFLICT ("reference_key") DO NOTHING;

INSERT INTO "storage_object_references" ("id", "object_id", "org_id", "reference_key", "source", "purpose", "zalo_account_id", "media_asset_id", "created_at")
SELECT gen_random_uuid()::text, so."id", b."org_id",
  'asset:' || b."asset_id" || ':blob:' || b."id",
  'media_asset', b."variant_type", ma."source_zalo_account_id", b."asset_id", b."created_at"
FROM "media_blobs" b
JOIN "storage_objects" so ON so."storage_driver" = b."storage_driver" AND so."object_key" = b."minio_key"
JOIN "media_assets" ma ON ma."id" = b."asset_id"
WHERE NOT EXISTS (SELECT 1 FROM "media_storage_attributions" a WHERE a."media_asset_id" = b."asset_id")
ON CONFLICT ("reference_key") DO NOTHING;