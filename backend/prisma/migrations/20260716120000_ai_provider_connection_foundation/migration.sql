-- P1 AI provider/model foundation.
-- Additive only: existing model config IDs and legacy AiConfig fields remain intact.

CREATE TABLE "ai_provider_connections" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "adapter" TEXT NOT NULL,
  "vendor" TEXT NOT NULL,
  "base_url" TEXT NOT NULL,
  "api_key_encrypted" BYTEA,
  "api_key_last4" VARCHAR(4),
  "credential_version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "last_test_status" TEXT,
  "last_tested_at" TIMESTAMP(3),
  "last_latency_ms" INTEGER,
  "last_error_code" TEXT,
  "created_by_user_id" TEXT,
  "updated_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "ai_provider_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_provider_connections_status_check"
    CHECK ("status" IN ('draft', 'needs_test', 'connected', 'failed', 'disabled')),
  CONSTRAINT "ai_provider_connections_credential_version_positive_check"
    CHECK ("credential_version" > 0),
  CONSTRAINT "ai_provider_connections_latency_nonnegative_check"
    CHECK ("last_latency_ms" IS NULL OR "last_latency_ms" >= 0),
  CONSTRAINT "ai_provider_connections_key_nonempty_check"
    CHECK (char_length(btrim("key")) > 0),
  CONSTRAINT "ai_provider_connections_name_nonempty_check"
    CHECK (char_length(btrim("name")) > 0),
  CONSTRAINT "ai_provider_connections_adapter_nonempty_check"
    CHECK (char_length(btrim("adapter")) > 0),
  CONSTRAINT "ai_provider_connections_vendor_nonempty_check"
    CHECK (char_length(btrim("vendor")) > 0),
  CONSTRAINT "ai_provider_connections_base_url_nonempty_check"
    CHECK (char_length(btrim("base_url")) > 0),
  CONSTRAINT "ai_provider_connections_secret_metadata_check"
    CHECK (
      ("api_key_encrypted" IS NULL AND "api_key_last4" IS NULL)
      OR ("api_key_encrypted" IS NOT NULL AND "api_key_last4" IS NOT NULL)
    )
);

ALTER TABLE "ai_model_configs"
  ADD COLUMN "connection_id" TEXT,
  ADD COLUMN "key" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "capabilities" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "fallback_model_config_id" TEXT,
  ADD COLUMN "change_note" TEXT,
  ADD COLUMN "approved_by_user_id" TEXT,
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "archived_at" TIMESTAMP(3);

ALTER TABLE "ai_model_configs"
  ADD CONSTRAINT "ai_model_configs_version_positive_check"
    CHECK ("version" > 0),
  ADD CONSTRAINT "ai_model_configs_revision_positive_check"
    CHECK ("revision" > 0),
  ADD CONSTRAINT "ai_model_configs_fallback_not_self_check"
    CHECK (
      "fallback_model_config_id" IS NULL
      OR "fallback_model_config_id" <> "id"
    );

ALTER TABLE "ai_configs"
  ADD COLUMN "default_model_config_id" TEXT;

CREATE UNIQUE INDEX "ai_provider_connections_org_id_key_key"
  ON "ai_provider_connections"("org_id", "key");
CREATE INDEX "ai_provider_connections_org_id_status_deleted_at_idx"
  ON "ai_provider_connections"("org_id", "status", "deleted_at");
CREATE INDEX "ai_provider_connections_org_id_adapter_vendor_deleted_at_idx"
  ON "ai_provider_connections"("org_id", "adapter", "vendor", "deleted_at");
CREATE INDEX "ai_provider_connections_created_by_user_id_idx"
  ON "ai_provider_connections"("created_by_user_id");
CREATE INDEX "ai_provider_connections_updated_by_user_id_idx"
  ON "ai_provider_connections"("updated_by_user_id");

-- Prisma cannot express this partial uniqueness rule. Null keys preserve
-- compatibility for legacy rows while assigned keys have immutable versions.
CREATE UNIQUE INDEX "ai_model_configs_org_id_key_version_unique"
  ON "ai_model_configs"("org_id", "key", "version")
  WHERE "key" IS NOT NULL;
CREATE INDEX "ai_model_configs_org_id_key_version_idx"
  ON "ai_model_configs"("org_id", "key", "version");
CREATE INDEX "ai_model_configs_connection_id_status_deleted_at_idx"
  ON "ai_model_configs"("connection_id", "status", "deleted_at");
CREATE INDEX "ai_model_configs_fallback_model_config_id_idx"
  ON "ai_model_configs"("fallback_model_config_id");
CREATE INDEX "ai_model_configs_approved_by_user_id_idx"
  ON "ai_model_configs"("approved_by_user_id");
CREATE INDEX "ai_configs_default_model_config_id_idx"
  ON "ai_configs"("default_model_config_id");

ALTER TABLE "ai_provider_connections"
  ADD CONSTRAINT "ai_provider_connections_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_provider_connections"
  ADD CONSTRAINT "ai_provider_connections_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_provider_connections"
  ADD CONSTRAINT "ai_provider_connections_updated_by_user_id_fkey"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_model_configs"
  ADD CONSTRAINT "ai_model_configs_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "ai_provider_connections"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_model_configs"
  ADD CONSTRAINT "ai_model_configs_fallback_model_config_id_fkey"
  FOREIGN KEY ("fallback_model_config_id") REFERENCES "ai_model_configs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_model_configs"
  ADD CONSTRAINT "ai_model_configs_approved_by_user_id_fkey"
  FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_configs"
  ADD CONSTRAINT "ai_configs_default_model_config_id_fkey"
  FOREIGN KEY ("default_model_config_id") REFERENCES "ai_model_configs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Match the repository tenant RLS convention. Do not FORCE RLS because the
-- current deployment relies on the table-owner/bypass paths for system jobs.
ALTER TABLE "ai_provider_connections" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ai_provider_connections"
  USING (
    "org_id" = current_setting('app.current_org', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  )
  WITH CHECK (
    "org_id" = current_setting('app.current_org', true)
    OR current_setting('app.bypass_rls', true) = 'on'
  );
