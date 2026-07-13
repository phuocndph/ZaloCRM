CREATE TABLE "storage_cleanup_runs" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "performed_by_id" TEXT,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT,
  "before_date" DATE NOT NULL,
  "file_kinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "assets_deleted" INTEGER NOT NULL DEFAULT 0,
  "objects_deleted" INTEGER NOT NULL DEFAULT 0,
  "bytes_freed" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storage_cleanup_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "storage_cleanup_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "storage_cleanup_runs_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "storage_cleanup_runs_org_id_created_at_idx"
ON "storage_cleanup_runs"("org_id", "created_at");
