-- Multi-group cleanup runs + per-group nightly cleanup schedules (2026-11-09).
-- All schedules start disabled; nothing is deleted by this migration.

-- AlterTable
ALTER TABLE "storage_cleanup_runs"
  ADD COLUMN "target_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "include_visible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "schedule_id" TEXT;

-- CreateTable
CREATE TABLE "storage_group_cleanup_schedules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "group_name" TEXT,
    "retention_days" INTEGER NOT NULL DEFAULT 90,
    "file_kinds" TEXT[] DEFAULT ARRAY['image']::TEXT[],
    "include_visible" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_run_at" TIMESTAMP(3),
    "last_run_id" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_group_cleanup_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "storage_group_cleanup_schedules_org_id_group_id_key" ON "storage_group_cleanup_schedules"("org_id", "group_id");

-- CreateIndex
CREATE INDEX "storage_group_cleanup_schedules_enabled_idx" ON "storage_group_cleanup_schedules"("enabled");

-- AddForeignKey
ALTER TABLE "storage_group_cleanup_schedules" ADD CONSTRAINT "storage_group_cleanup_schedules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
