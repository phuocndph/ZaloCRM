-- Phase Release foundation: immutable, tenant-scoped release manifests and lifecycle audit metadata.
-- Additive only; no existing table or column is modified.
CREATE TABLE "ai_releases" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "snapshot" JSONB NOT NULL,
  "snapshot_hash" CHAR(64) NOT NULL,
  "evaluation_run_id" TEXT,
  "previous_release_id" TEXT,
  "created_by_user_id" TEXT,
  "approved_by_user_id" TEXT,
  "deployed_by_user_id" TEXT,
  "rolled_back_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_at" TIMESTAMP(3),
  "deployed_at" TIMESTAMP(3),
  "rolled_back_at" TIMESTAMP(3),

  CONSTRAINT "ai_releases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_releases_version_positive_check" CHECK ("version" > 0),
  CONSTRAINT "ai_releases_status_check" CHECK (
    "status" IN (
      'draft',
      'pending_approval',
      'approved',
      'production',
      'superseded',
      'rolled_back',
      'failed'
    )
  ),
  CONSTRAINT "ai_releases_snapshot_hash_sha256_check" CHECK (
    "snapshot_hash" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "ai_releases_previous_release_not_self_check" CHECK (
    "previous_release_id" IS NULL OR "previous_release_id" <> "id"
  )
);

CREATE UNIQUE INDEX "ai_releases_org_id_version_key"
  ON "ai_releases"("org_id", "version");

-- Prisma cannot express a partial unique index: one production release per tenant.
CREATE UNIQUE INDEX "ai_releases_one_production_per_org"
  ON "ai_releases"("org_id")
  WHERE "status" = 'production';

CREATE INDEX "ai_releases_org_id_status_created_at_idx"
  ON "ai_releases"("org_id", "status", "created_at");
CREATE INDEX "ai_releases_evaluation_run_id_idx"
  ON "ai_releases"("evaluation_run_id");
CREATE INDEX "ai_releases_previous_release_id_idx"
  ON "ai_releases"("previous_release_id");
CREATE INDEX "ai_releases_created_by_user_id_idx"
  ON "ai_releases"("created_by_user_id");
CREATE INDEX "ai_releases_approved_by_user_id_idx"
  ON "ai_releases"("approved_by_user_id");
CREATE INDEX "ai_releases_deployed_by_user_id_idx"
  ON "ai_releases"("deployed_by_user_id");
CREATE INDEX "ai_releases_rolled_back_by_user_id_idx"
  ON "ai_releases"("rolled_back_by_user_id");

ALTER TABLE "ai_releases"
  ADD CONSTRAINT "ai_releases_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_releases"
  ADD CONSTRAINT "ai_releases_evaluation_run_id_fkey"
  FOREIGN KEY ("evaluation_run_id") REFERENCES "ai_evaluation_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_releases"
  ADD CONSTRAINT "ai_releases_previous_release_id_fkey"
  FOREIGN KEY ("previous_release_id") REFERENCES "ai_releases"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_releases"
  ADD CONSTRAINT "ai_releases_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_releases"
  ADD CONSTRAINT "ai_releases_approved_by_user_id_fkey"
  FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_releases"
  ADD CONSTRAINT "ai_releases_deployed_by_user_id_fkey"
  FOREIGN KEY ("deployed_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ai_releases"
  ADD CONSTRAINT "ai_releases_rolled_back_by_user_id_fkey"
  FOREIGN KEY ("rolled_back_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Lifecycle columns remain mutable; the release identity and captured manifest do not.
CREATE FUNCTION "enforce_ai_release_manifest_immutable"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."org_id" IS DISTINCT FROM OLD."org_id"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."snapshot" IS DISTINCT FROM OLD."snapshot"
    OR NEW."snapshot_hash" IS DISTINCT FROM OLD."snapshot_hash"
  THEN
    RAISE EXCEPTION 'AI release manifest fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_releases_manifest_immutable_trigger"
BEFORE UPDATE OF "org_id", "version", "snapshot", "snapshot_hash"
ON "ai_releases"
FOR EACH ROW
EXECUTE FUNCTION "enforce_ai_release_manifest_immutable"();
