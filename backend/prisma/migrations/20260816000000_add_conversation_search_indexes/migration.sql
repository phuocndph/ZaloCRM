-- Search in the inbox matches message content with ILIKE. Trigram indexes keep
-- substring searches responsive without changing the message data model.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "messages_content_search_trgm_idx"
  ON "messages" USING GIN ("content" gin_trgm_ops)
  WHERE "content" IS NOT NULL AND "is_deleted" = false;

CREATE INDEX IF NOT EXISTS "contacts_full_name_search_trgm_idx"
  ON "contacts" USING GIN ("full_name" gin_trgm_ops)
  WHERE "full_name" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "contacts_crm_name_search_trgm_idx"
  ON "contacts" USING GIN ("crm_name" gin_trgm_ops)
  WHERE "crm_name" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "conversations_group_name_search_trgm_idx"
  ON "conversations" USING GIN ("group_name" gin_trgm_ops)
  WHERE "group_name" IS NOT NULL;
