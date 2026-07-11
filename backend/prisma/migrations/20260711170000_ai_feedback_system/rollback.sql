DROP INDEX IF EXISTS "ai_feedback_contact_created_idx";
DROP INDEX IF EXISTS "ai_feedback_conversation_created_idx";
ALTER TABLE "ai_feedback" DROP CONSTRAINT IF EXISTS "ai_feedback_followup_customer_message_id_fkey";
ALTER TABLE "ai_feedback" DROP CONSTRAINT IF EXISTS "ai_feedback_customer_message_id_fkey";
ALTER TABLE "ai_feedback" DROP CONSTRAINT IF EXISTS "ai_feedback_contact_id_fkey";
ALTER TABLE "ai_feedback" DROP CONSTRAINT IF EXISTS "ai_feedback_conversation_id_fkey";
ALTER TABLE "ai_feedback" DROP COLUMN IF EXISTS "order_generated", DROP COLUMN IF EXISTS "quote_generated", DROP COLUMN IF EXISTS "outcome", DROP COLUMN IF EXISTS "knowledge_refs", DROP COLUMN IF EXISTS "context_manifest", DROP COLUMN IF EXISTS "final_encrypted", DROP COLUMN IF EXISTS "proposed_encrypted", DROP COLUMN IF EXISTS "selection_status", DROP COLUMN IF EXISTS "followup_customer_message_id", DROP COLUMN IF EXISTS "customer_message_id", DROP COLUMN IF EXISTS "contact_id", DROP COLUMN IF EXISTS "conversation_id";
ALTER TABLE "ai_feedback" ALTER COLUMN "run_id" SET NOT NULL;
