-- CreateTable
CREATE TABLE "ai_conversation_insights" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT,
    "conversation_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "summary_id" TEXT,
    "source_through_message_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "mode" TEXT NOT NULL DEFAULT 'shadow',
    "stage" TEXT NOT NULL,
    "stage_confidence" DOUBLE PRECISION NOT NULL,
    "stage_reason_redacted" TEXT,
    "intent_label" TEXT NOT NULL,
    "intent_confidence" DOUBLE PRECISION NOT NULL,
    "emotion_label" TEXT NOT NULL,
    "emotion_confidence" DOUBLE PRECISION NOT NULL,
    "emotion_intensity" DOUBLE PRECISION,
    "requires_human" BOOLEAN NOT NULL DEFAULT false,
    "next_action" TEXT NOT NULL,
    "next_action_reason_redacted" TEXT,
    "recommended_workflow_type" TEXT,
    "memory_candidate_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signals" JSONB NOT NULL DEFAULT '{}',
    "safeguards" JSONB NOT NULL DEFAULT '{}',
    "analysis_hash" TEXT NOT NULL,
    "generated_with_model" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversation_insights_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_conversation_insights_conversation_id_version_key"
ON "ai_conversation_insights"("conversation_id", "version");

CREATE UNIQUE INDEX "ai_conversation_insights_conversation_id_source_through_message_id_key"
ON "ai_conversation_insights"("conversation_id", "source_through_message_id");

CREATE INDEX "ai_conversation_insights_org_id_status_created_at_idx"
ON "ai_conversation_insights"("org_id", "status", "created_at");

CREATE INDEX "ai_conversation_insights_contact_id_created_at_idx"
ON "ai_conversation_insights"("contact_id", "created_at");

CREATE INDEX "ai_conversation_insights_stage_created_at_idx"
ON "ai_conversation_insights"("stage", "created_at");

ALTER TABLE "ai_conversation_insights"
ADD CONSTRAINT "ai_conversation_insights_org_id_fkey"
FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_conversation_insights"
ADD CONSTRAINT "ai_conversation_insights_run_id_fkey"
FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_conversation_insights"
ADD CONSTRAINT "ai_conversation_insights_conversation_id_fkey"
FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_conversation_insights"
ADD CONSTRAINT "ai_conversation_insights_contact_id_fkey"
FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_conversation_insights"
ADD CONSTRAINT "ai_conversation_insights_summary_id_fkey"
FOREIGN KEY ("summary_id") REFERENCES "ai_conversation_summaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_conversation_insights"
ADD CONSTRAINT "ai_conversation_insights_source_through_message_id_fkey"
FOREIGN KEY ("source_through_message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
