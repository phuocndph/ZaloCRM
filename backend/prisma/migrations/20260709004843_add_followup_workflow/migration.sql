-- DropIndex
DROP INDEX "contacts_pool_robin_idx";

-- DropIndex
DROP INDEX "zalo_accounts_org_id_archived_at_idx";

-- AlterTable
ALTER TABLE "automation_triggers" ALTER COLUMN "welcome_delay_seconds" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "lead_notify_acks" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "outreach_campaigns" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "outreach_phones" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "followup_workflows" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'custom',
    "goal_type" TEXT NOT NULL DEFAULT 'none',
    "goal_tag" TEXT,
    "goal_tag_on_reach" TEXT,
    "next_workflow_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "root_id" TEXT,
    "is_latest" BOOLEAN NOT NULL DEFAULT true,
    "send_window_start" INTEGER NOT NULL DEFAULT 480,
    "send_window_end" INTEGER NOT NULL DEFAULT 1080,
    "min_gap_minutes" INTEGER NOT NULL DEFAULT 1440,
    "max_messages" INTEGER NOT NULL DEFAULT 5,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "stop_on_purchase" BOOLEAN NOT NULL DEFAULT true,
    "stop_on_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'draft',
    "total_enrolled" INTEGER NOT NULL DEFAULT 0,
    "total_running" INTEGER NOT NULL DEFAULT 0,
    "total_waiting" INTEGER NOT NULL DEFAULT 0,
    "total_waiting_sale" INTEGER NOT NULL DEFAULT 0,
    "total_completed" INTEGER NOT NULL DEFAULT 0,
    "total_stopped" INTEGER NOT NULL DEFAULT 0,
    "total_goal_reached" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "followup_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "followup_steps" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "config" JSONB,
    "next_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "followup_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "followup_enrollments" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "workflow_version" INTEGER NOT NULL,
    "contact_id" TEXT NOT NULL,
    "friend_id" TEXT,
    "zalo_account_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "current_step_key" TEXT,
    "messages_sent" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "job_id" TEXT,
    "goal_reached" BOOLEAN NOT NULL DEFAULT false,
    "stop_reason" TEXT,
    "sale_task_title" TEXT,
    "enrolled_by_id" TEXT,
    "enrolled_by_name" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "followup_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "followup_logs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "step_key" TEXT,
    "step_type" TEXT,
    "event_type" TEXT NOT NULL,
    "message" TEXT,
    "detail" JSONB,
    "actor_type" TEXT NOT NULL DEFAULT 'system',
    "actor_id" TEXT,
    "actor_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "followup_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "followup_workflows_org_id_status_idx" ON "followup_workflows"("org_id", "status");

-- CreateIndex
CREATE INDEX "followup_workflows_org_id_root_id_idx" ON "followup_workflows"("org_id", "root_id");

-- CreateIndex
CREATE INDEX "followup_steps_workflow_id_order_index_idx" ON "followup_steps"("workflow_id", "order_index");

-- CreateIndex
CREATE UNIQUE INDEX "followup_steps_workflow_id_key_key" ON "followup_steps"("workflow_id", "key");

-- CreateIndex
CREATE INDEX "followup_enrollments_org_id_contact_id_status_idx" ON "followup_enrollments"("org_id", "contact_id", "status");

-- CreateIndex
CREATE INDEX "followup_enrollments_workflow_id_status_idx" ON "followup_enrollments"("workflow_id", "status");

-- CreateIndex
CREATE INDEX "followup_enrollments_status_next_run_at_idx" ON "followup_enrollments"("status", "next_run_at");

-- CreateIndex
CREATE INDEX "followup_logs_enrollment_id_created_at_idx" ON "followup_logs"("enrollment_id", "created_at");

-- CreateIndex
CREATE INDEX "followup_logs_workflow_id_event_type_idx" ON "followup_logs"("workflow_id", "event_type");

-- CreateIndex
CREATE INDEX "followup_logs_contact_id_created_at_idx" ON "followup_logs"("contact_id", "created_at");

-- CreateIndex
CREATE INDEX "contacts_org_id_pooled_count_last_pooled_at_idx" ON "contacts"("org_id", "pooled_count", "last_pooled_at");

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_source_zalo_account_id_fkey" FOREIGN KEY ("source_zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_steps" ADD CONSTRAINT "followup_steps_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "followup_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_enrollments" ADD CONSTRAINT "followup_enrollments_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "followup_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_logs" ADD CONSTRAINT "followup_logs_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "followup_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_logs" ADD CONSTRAINT "followup_logs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "followup_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "lead_pool_distributions_org_id_assigned_to_user_id_distributed_" RENAME TO "lead_pool_distributions_org_id_assigned_to_user_id_distribu_idx";
