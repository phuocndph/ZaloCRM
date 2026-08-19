-- Stable keyset pagination for the inbox. Partial indexes exclude soft-deleted
-- rows and cover the two list orderings used by the API.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_org_recent_cursor_idx"
  ON "conversations" ("org_id", "last_message_at" DESC NULLS LAST, "id" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_org_unread_cursor_idx"
  ON "conversations" ("org_id", "unread_count" DESC, "last_message_at" DESC NULLS LAST, "id" DESC)
  WHERE "deleted_at" IS NULL;

-- Complete the inbox substring-search coverage for sender names and legacy
-- phone columns. pg_trgm is installed by the preceding search migration.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_sender_name_search_trgm_idx"
  ON "messages" USING GIN ("sender_name" gin_trgm_ops)
  WHERE "sender_name" IS NOT NULL AND "is_deleted" = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "contacts_phone_search_trgm_idx"
  ON "contacts" USING GIN ("phone" gin_trgm_ops)
  WHERE "phone" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "contacts_phone2_search_trgm_idx"
  ON "contacts" USING GIN ("phone_2" gin_trgm_ops)
  WHERE "phone_2" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "contacts_phone3_search_trgm_idx"
  ON "contacts" USING GIN ("phone_3" gin_trgm_ops)
  WHERE "phone_3" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_conversation_sent_cursor_idx"
  ON "messages" ("conversation_id", "sent_at" DESC, "zalo_msg_id_num" DESC NULLS FIRST, "id" DESC);
