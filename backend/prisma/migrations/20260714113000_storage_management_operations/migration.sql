-- Storage management operating settings and reconciliation audit history.
-- Additive only: safe to apply alongside existing media/storage data.
CREATE TABLE "storage_management_policies" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "quota_alert_percent" INTEGER NOT NULL DEFAULT 80,
  "anomaly_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 2,
  "retention_days" INTEGER NOT NULL DEFAULT 0,
  "retention_file_kinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storage_management_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "storage_management_policies_org_id_key" UNIQUE ("org_id"),
  CONSTRAINT "storage_management_policies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "storage_reconciliation_runs" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "performed_by_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'running',
  "scanned" INTEGER NOT NULL DEFAULT 0,
  "references" INTEGER NOT NULL DEFAULT 0,
  "missing" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "error_summary" JSONB,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storage_reconciliation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "storage_reconciliation_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "storage_reconciliation_runs_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "storage_reconciliation_runs_org_id_created_at_idx" ON "storage_reconciliation_runs"("org_id", "created_at");