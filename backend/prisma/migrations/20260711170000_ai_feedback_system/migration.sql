ALTER TABLE "ai_feedback"
  ALTER COLUMN "run_id" DROP NOT NULL,
  ADD COLUMN "conversation_id" TEXT,
  ADD COLUMN "contact_id" TEXT,
  ADD COLUMN "customer_message_id" TEXT,
  ADD COLUMN "followup_customer_message_id" TEXT,
  ADD COLUMN "selection_status" TEXT NOT NULL DEFAULT 'skipped',
  ADD COLUMN "proposed_encrypted" BYTEA,
  ADD COLUMN "final_encrypted" BYTEA,
  ADD COLUMN "context_manifest" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "knowledge_refs" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "outcome" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "quote_generated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "order_generated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL;
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL;
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_customer_message_id_fkey" FOREIGN KEY ("customer_message_id") REFERENCES "messages"("id") ON DELETE SET NULL;
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_followup_customer_message_id_fkey" FOREIGN KEY ("followup_customer_message_id") REFERENCES "messages"("id") ON DELETE SET NULL;
CREATE INDEX "ai_feedback_conversation_created_idx" ON "ai_feedback"("conversation_id", "created_at");
CREATE INDEX "ai_feedback_contact_created_idx" ON "ai_feedback"("contact_id", "created_at");
