ALTER TABLE "ai_knowledge_sources"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "effective_from" TIMESTAMP(3),
  ADD COLUMN "effective_to" TIMESTAMP(3),
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "scope" JSONB NOT NULL DEFAULT '{"visibility":"org"}',
  ADD COLUMN "last_indexed_at" TIMESTAMP(3),
  ADD COLUMN "approved_by_user_id" TEXT,
  ADD COLUMN "approved_at" TIMESTAMP(3);

ALTER TABLE "ai_knowledge_documents"
  ADD COLUMN "mime_type" TEXT,
  ADD COLUMN "language" TEXT DEFAULT 'vi',
  ADD COLUMN "effective_from" TIMESTAMP(3),
  ADD COLUMN "effective_to" TIMESTAMP(3),
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "scope" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "last_indexed_at" TIMESTAMP(3);

ALTER TABLE "ai_knowledge_documents" ALTER COLUMN "status" SET DEFAULT 'draft';

ALTER TABLE "ai_knowledge_chunks"
  ADD COLUMN "embedding_version" TEXT,
  ADD COLUMN "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "ai_knowledge_sources"
  ADD CONSTRAINT "ai_knowledge_sources_approved_by_user_id_fkey"
  FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ai_knowledge_sources_effective_idx" ON "ai_knowledge_sources"("org_id", "status", "effective_from", "effective_to", "deleted_at");
CREATE INDEX "ai_knowledge_sources_tags_idx" ON "ai_knowledge_sources" USING GIN ("tags");
CREATE INDEX "ai_knowledge_documents_effective_idx" ON "ai_knowledge_documents"("org_id", "status", "effective_from", "effective_to", "deleted_at");
CREATE INDEX "ai_knowledge_documents_source_content_hash_idx" ON "ai_knowledge_documents"("source_id", "content_hash");
CREATE INDEX "ai_knowledge_documents_tags_idx" ON "ai_knowledge_documents" USING GIN ("tags");
CREATE INDEX "ai_knowledge_chunks_keywords_idx" ON "ai_knowledge_chunks" USING GIN ("keywords");
