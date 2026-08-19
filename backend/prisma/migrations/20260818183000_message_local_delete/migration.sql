ALTER TABLE "messages"
ADD COLUMN IF NOT EXISTS "hidden_at" TIMESTAMP(3);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_conversation_id_hidden_at_sent_at_idx"
ON "messages"("conversation_id", "hidden_at", "sent_at" DESC);
