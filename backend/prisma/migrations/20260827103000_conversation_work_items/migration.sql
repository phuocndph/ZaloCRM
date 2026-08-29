CREATE TABLE "conversation_work_items" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "zalo_account_id" TEXT,
    "assignee_user_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "priority_score" INTEGER NOT NULL DEFAULT 50,
    "title" TEXT NOT NULL,
    "customer_situation" TEXT,
    "next_action" TEXT NOT NULL,
    "reason" TEXT,
    "due_at" TIMESTAMP(3),
    "snoozed_until" TIMESTAMP(3),
    "source_event_at" TIMESTAMP(3),
    "fingerprint" TEXT NOT NULL,
    "context_version" INTEGER,
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_work_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_work_items_org_id_assignee_user_id_source_type_source_id_key"
ON "conversation_work_items"("org_id", "assignee_user_id", "source_type", "source_id");

CREATE INDEX "conversation_work_items_org_id_assignee_user_id_status_due_at_idx"
ON "conversation_work_items"("org_id", "assignee_user_id", "status", "due_at");

CREATE INDEX "conversation_work_items_org_id_contact_id_status_idx"
ON "conversation_work_items"("org_id", "contact_id", "status");

CREATE INDEX "conversation_work_items_conversation_id_status_idx"
ON "conversation_work_items"("conversation_id", "status");

CREATE INDEX "conversation_work_items_priority_score_due_at_idx"
ON "conversation_work_items"("priority_score" DESC, "due_at");

ALTER TABLE "conversation_work_items"
ADD CONSTRAINT "conversation_work_items_org_id_fkey"
FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_work_items"
ADD CONSTRAINT "conversation_work_items_contact_id_fkey"
FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_work_items"
ADD CONSTRAINT "conversation_work_items_conversation_id_fkey"
FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_work_items"
ADD CONSTRAINT "conversation_work_items_assignee_user_id_fkey"
FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
