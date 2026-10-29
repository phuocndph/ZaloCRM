-- CreateTable
CREATE TABLE "joliefam_connections" (
    "org_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "base_path" TEXT NOT NULL DEFAULT '/api/zcrm/v1',
    "token_encrypted" TEXT NOT NULL,
    "webhook_secret_encrypted" TEXT NOT NULL,
    "actor_map" JSONB NOT NULL DEFAULT '{}',
    "tested_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "joliefam_connections_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "joliefam_customer_links" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "crm_contact_id" TEXT,
    "customer_name" TEXT NOT NULL,
    "confirmed_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "joliefam_customer_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "joliefam_snapshots" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "cache_key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "source_version" BIGINT NOT NULL DEFAULT 0,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "joliefam_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "joliefam_drafts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "created_by" TEXT NOT NULL,
    "create_key" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "input" JSONB NOT NULL,
    "quote" JSONB,
    "status" TEXT NOT NULL DEFAULT 'local',
    "request_key" TEXT,
    "submission_actor_id" TEXT,
    "crm_order_id" TEXT,
    "crm_order_code" TEXT,
    "approver" TEXT,
    "last_error" TEXT,
    "locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "joliefam_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "joliefam_events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "order_id" TEXT,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "joliefam_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "joliefam_audit" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "joliefam_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "joliefam_customer_links_org_id_customer_id_idx" ON "joliefam_customer_links"("org_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "joliefam_customer_links_org_id_contact_id_customer_id_key" ON "joliefam_customer_links"("org_id", "contact_id", "customer_id");

-- CreateIndex
CREATE INDEX "joliefam_snapshots_org_id_fetched_at_idx" ON "joliefam_snapshots"("org_id", "fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "joliefam_snapshots_org_id_customer_id_cache_key_key" ON "joliefam_snapshots"("org_id", "customer_id", "cache_key");

-- CreateIndex
CREATE INDEX "joliefam_drafts_org_id_contact_id_updated_at_idx" ON "joliefam_drafts"("org_id", "contact_id", "updated_at");

-- CreateIndex
CREATE INDEX "joliefam_drafts_org_id_status_updated_at_idx" ON "joliefam_drafts"("org_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "joliefam_drafts_org_id_create_key_key" ON "joliefam_drafts"("org_id", "create_key");

-- CreateIndex
CREATE UNIQUE INDEX "joliefam_drafts_org_id_request_key_key" ON "joliefam_drafts"("org_id", "request_key");

-- CreateIndex
CREATE INDEX "joliefam_events_org_id_status_created_at_idx" ON "joliefam_events"("org_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "joliefam_events_org_id_event_id_key" ON "joliefam_events"("org_id", "event_id");

-- CreateIndex
CREATE INDEX "joliefam_audit_org_id_created_at_idx" ON "joliefam_audit"("org_id", "created_at");

-- AddForeignKey
ALTER TABLE "joliefam_connections" ADD CONSTRAINT "joliefam_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "joliefam_customer_links" ADD CONSTRAINT "joliefam_customer_links_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "joliefam_snapshots" ADD CONSTRAINT "joliefam_snapshots_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "joliefam_drafts" ADD CONSTRAINT "joliefam_drafts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "joliefam_events" ADD CONSTRAINT "joliefam_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "joliefam_audit" ADD CONSTRAINT "joliefam_audit_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['joliefam_connections','joliefam_customer_links','joliefam_snapshots','joliefam_drafts','joliefam_events','joliefam_audit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = current_setting(''app.current_org'', true) OR current_setting(''app.bypass_rls'', true) = ''on'') WITH CHECK (org_id = current_setting(''app.current_org'', true) OR current_setting(''app.bypass_rls'', true) = ''on'')', t);
  END LOOP;
END $$;
ALTER TABLE joliefam_drafts ADD CONSTRAINT joliefam_draft_status CHECK (status IN ('local','returned','submitting','uncertain','submitted','closed'));
ALTER TABLE joliefam_drafts ADD CONSTRAINT joliefam_draft_revision CHECK (revision > 0);
ALTER TABLE joliefam_events ADD CONSTRAINT joliefam_event_version CHECK (version > 0);
