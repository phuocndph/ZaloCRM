ALTER TABLE "conversations"
  ADD COLUMN "group_sdk_type" INTEGER,
  ADD COLUMN "group_category" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "group_monitoring_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "group_classification_source" TEXT NOT NULL DEFAULT 'unclassified',
  ADD COLUMN "group_classification_confidence" DOUBLE PRECISION,
  ADD COLUMN "group_classified_at" TIMESTAMP(3);

CREATE INDEX "conversations_org_id_group_monitoring_enabled_group_category_idx"
  ON "conversations"("org_id", "group_monitoring_enabled", "group_category");
