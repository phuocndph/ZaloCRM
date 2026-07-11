CREATE TABLE "ai_auto_reply_configs" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'workspace',
  "scope_ref_id" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "mode" TEXT NOT NULL DEFAULT 'disabled',
  "emergency_stop" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB NOT NULL DEFAULT '{}',
  "created_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "ai_auto_reply_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_auto_reply_configs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ai_auto_reply_configs_org_scope_scope_ref_id_deleted_at_idx" ON "ai_auto_reply_configs"("org_id", "scope", "scope_ref_id", "deleted_at");
CREATE INDEX "ai_auto_reply_configs_org_emergency_stop_idx" ON "ai_auto_reply_configs"("org_id", "emergency_stop");
CREATE TABLE "ai_auto_reply_logs" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "config_id" TEXT,
  "status" TEXT NOT NULL,
  "decision_reasons" JSONB NOT NULL DEFAULT '[]',
  "reply_hash" TEXT,
  "confidence" INTEGER,
  "mode" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_auto_reply_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_auto_reply_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ai_auto_reply_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ai_auto_reply_logs_org_status_created_at_idx" ON "ai_auto_reply_logs"("org_id", "status", "created_at");
CREATE INDEX "ai_auto_reply_logs_conversation_id_created_at_idx" ON "ai_auto_reply_logs"("conversation_id", "created_at");