-- CreateTable
CREATE TABLE "customer_research_projects" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "model_config_id" TEXT NOT NULL,
    "max_queries" INTEGER NOT NULL DEFAULT 5,
    "max_sources" INTEGER NOT NULL DEFAULT 30,
    "max_ai_calls" INTEGER NOT NULL DEFAULT 10,
    "max_ai_cost_micros" BIGINT NOT NULL DEFAULT 1000000,
    "search_calls" INTEGER NOT NULL DEFAULT 0,
    "ai_calls" INTEGER NOT NULL DEFAULT 0,
    "ai_cost_micros" BIGINT NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_research_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_research_sources" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "url" TEXT,
    "canonical_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'web',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "speaker_role" TEXT NOT NULL DEFAULT 'unknown',
    "content_encrypted" TEXT,
    "content_hash" TEXT,
    "duplicate_of_id" TEXT,
    "published_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_research_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_research_pains" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "independent_sources" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "merged_into_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_research_pains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_research_contents" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "pain_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "missing_information" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "root_id" TEXT,
    "pain_revision" INTEGER NOT NULL,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_research_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_research_tasks" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "input" JSONB NOT NULL DEFAULT '{}',
    "checkpoint" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" TEXT NOT NULL,
    "lease_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "error_code" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "customer_research_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_research_projects_org_id_created_at_idx" ON "customer_research_projects"("org_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_research_projects_org_id_id_key" ON "customer_research_projects"("org_id", "id");

-- CreateIndex
CREATE INDEX "customer_research_sources_org_id_project_id_status_idx" ON "customer_research_sources"("org_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_research_sources_org_id_project_id_canonical_key_key" ON "customer_research_sources"("org_id", "project_id", "canonical_key");

-- CreateIndex
CREATE INDEX "customer_research_pains_org_id_project_id_status_idx" ON "customer_research_pains"("org_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_research_pains_org_id_project_id_id_key" ON "customer_research_pains"("org_id", "project_id", "id");

-- CreateIndex
CREATE INDEX "customer_research_contents_org_id_project_id_status_idx" ON "customer_research_contents"("org_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "customer_research_contents_org_id_pain_id_root_id_idx" ON "customer_research_contents"("org_id", "pain_id", "root_id");

-- CreateIndex
CREATE INDEX "customer_research_tasks_org_id_project_id_status_idx" ON "customer_research_tasks"("org_id", "project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_research_tasks_org_id_project_id_idempotency_key_key" ON "customer_research_tasks"("org_id", "project_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "customer_research_projects" ADD CONSTRAINT "customer_research_projects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_research_sources" ADD CONSTRAINT "customer_research_sources_org_id_project_id_fkey" FOREIGN KEY ("org_id", "project_id") REFERENCES "customer_research_projects"("org_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_research_pains" ADD CONSTRAINT "customer_research_pains_org_id_project_id_fkey" FOREIGN KEY ("org_id", "project_id") REFERENCES "customer_research_projects"("org_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_research_contents" ADD CONSTRAINT "customer_research_contents_org_id_project_id_fkey" FOREIGN KEY ("org_id", "project_id") REFERENCES "customer_research_projects"("org_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_research_contents" ADD CONSTRAINT "customer_research_contents_org_id_project_id_pain_id_fkey" FOREIGN KEY ("org_id", "project_id", "pain_id") REFERENCES "customer_research_pains"("org_id", "project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_research_tasks" ADD CONSTRAINT "customer_research_tasks_org_id_project_id_fkey" FOREIGN KEY ("org_id", "project_id") REFERENCES "customer_research_projects"("org_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Same tenant RLS convention as ai_provider_connections; table-owner bypass is retained.
DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['customer_research_projects','customer_research_sources','customer_research_pains','customer_research_contents','customer_research_tasks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = current_setting(''app.current_org'', true) OR current_setting(''app.bypass_rls'', true) = ''on'') WITH CHECK (org_id = current_setting(''app.current_org'', true) OR current_setting(''app.bypass_rls'', true) = ''on'')', table_name);
  END LOOP;
END $$;
