ALTER TABLE "ai_customer_memories"
  ADD COLUMN "expires_at" TIMESTAMP(3),
  ADD COLUMN "last_reinforced_at" TIMESTAMP(3),
  ADD COLUMN "superseded_by_id" TEXT;

CREATE INDEX "ai_customer_memories_contact_key_deleted_expires_idx"
  ON "ai_customer_memories"("contact_id", "key", "deleted_at", "expires_at");

CREATE INDEX "ai_customer_memories_expires_at_idx"
  ON "ai_customer_memories"("expires_at");
