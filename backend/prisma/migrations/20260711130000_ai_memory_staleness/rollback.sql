DROP INDEX IF EXISTS "ai_customer_memories_expires_at_idx";
DROP INDEX IF EXISTS "ai_customer_memories_contact_key_deleted_expires_idx";

ALTER TABLE "ai_customer_memories"
  DROP COLUMN IF EXISTS "superseded_by_id",
  DROP COLUMN IF EXISTS "last_reinforced_at",
  DROP COLUMN IF EXISTS "expires_at";
