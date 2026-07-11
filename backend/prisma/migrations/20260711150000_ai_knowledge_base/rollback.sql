DROP INDEX IF EXISTS "ai_knowledge_chunks_keywords_idx";
DROP INDEX IF EXISTS "ai_knowledge_documents_tags_idx";
DROP INDEX IF EXISTS "ai_knowledge_documents_source_content_hash_idx";
DROP INDEX IF EXISTS "ai_knowledge_documents_effective_idx";
DROP INDEX IF EXISTS "ai_knowledge_sources_tags_idx";
DROP INDEX IF EXISTS "ai_knowledge_sources_effective_idx";

ALTER TABLE "ai_knowledge_sources" DROP CONSTRAINT IF EXISTS "ai_knowledge_sources_approved_by_user_id_fkey";
ALTER TABLE "ai_knowledge_chunks" DROP COLUMN IF EXISTS "keywords", DROP COLUMN IF EXISTS "embedding_version";
ALTER TABLE "ai_knowledge_documents" DROP COLUMN IF EXISTS "last_indexed_at", DROP COLUMN IF EXISTS "scope", DROP COLUMN IF EXISTS "tags", DROP COLUMN IF EXISTS "priority", DROP COLUMN IF EXISTS "effective_to", DROP COLUMN IF EXISTS "effective_from", DROP COLUMN IF EXISTS "language", DROP COLUMN IF EXISTS "mime_type";
ALTER TABLE "ai_knowledge_sources" DROP COLUMN IF EXISTS "approved_at", DROP COLUMN IF EXISTS "approved_by_user_id", DROP COLUMN IF EXISTS "last_indexed_at", DROP COLUMN IF EXISTS "scope", DROP COLUMN IF EXISTS "tags", DROP COLUMN IF EXISTS "priority", DROP COLUMN IF EXISTS "effective_to", DROP COLUMN IF EXISTS "effective_from", DROP COLUMN IF EXISTS "version";
