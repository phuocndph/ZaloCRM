-- Outreach Campaign (🟢 Community) — tự động kết bạn + nhắn tin cho tệp khách đã đồng ý.
-- 3 bảng mới, additive + IF NOT EXISTS → an toàn prod (không đụng bảng cũ).

CREATE TABLE IF NOT EXISTS "outreach_campaigns" (
  "id"                     TEXT PRIMARY KEY,
  "org_id"                 TEXT NOT NULL,
  "created_by_id"          TEXT,
  "name"                   TEXT NOT NULL,
  "description"            TEXT,
  "customer_list_id"       TEXT NOT NULL,
  "zalo_account_id"        TEXT NOT NULL,
  "enable_auto_add"        BOOLEAN NOT NULL DEFAULT true,
  "add_friend_message"     TEXT,
  "add_delay_min_ms"       INTEGER NOT NULL DEFAULT 2000,
  "add_delay_max_ms"       INTEGER NOT NULL DEFAULT 5000,
  "max_add_per_day"        INTEGER NOT NULL DEFAULT 100,
  "enable_auto_message"    BOOLEAN NOT NULL DEFAULT true,
  "wait_after_add_min_ms"  INTEGER NOT NULL DEFAULT 60000,
  "wait_after_add_max_ms"  INTEGER NOT NULL DEFAULT 120000,
  "msg_delay_min_ms"       INTEGER NOT NULL DEFAULT 3000,
  "msg_delay_max_ms"       INTEGER NOT NULL DEFAULT 8000,
  "max_msg_per_day"        INTEGER NOT NULL DEFAULT 500,
  "state"                  TEXT NOT NULL DEFAULT 'draft',
  "total_target"           INTEGER NOT NULL DEFAULT 0,
  "total_added"            INTEGER NOT NULL DEFAULT 0,
  "total_add_failed"       INTEGER NOT NULL DEFAULT 0,
  "total_msg_sent"         INTEGER NOT NULL DEFAULT 0,
  "total_msg_failed"       INTEGER NOT NULL DEFAULT 0,
  "total_skipped"          INTEGER NOT NULL DEFAULT 0,
  "started_at"             TIMESTAMP(3),
  "completed_at"           TIMESTAMP(3),
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "outreach_campaigns_org_id_state_idx" ON "outreach_campaigns" ("org_id", "state");
CREATE INDEX IF NOT EXISTS "outreach_campaigns_customer_list_id_idx" ON "outreach_campaigns" ("customer_list_id");

CREATE TABLE IF NOT EXISTS "outreach_templates" (
  "id"              TEXT PRIMARY KEY,
  "campaign_id"     TEXT NOT NULL,
  "title"           TEXT,
  "content"         TEXT NOT NULL,
  "weight"          INTEGER NOT NULL DEFAULT 1,
  "image_asset_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "outreach_templates_campaign_id_idx" ON "outreach_templates" ("campaign_id");

CREATE TABLE IF NOT EXISTS "outreach_logs" (
  "id"            TEXT PRIMARY KEY,
  "campaign_id"   TEXT NOT NULL,
  "entry_id"      TEXT,
  "contact_id"    TEXT,
  "phone"         TEXT NOT NULL,
  "action_type"   TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'pending',
  "result_data"   JSONB,
  "error_message" TEXT,
  "duration_ms"   INTEGER,
  "executed_at"   TIMESTAMP(3),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "outreach_logs_campaign_id_idx" ON "outreach_logs" ("campaign_id");
CREATE INDEX IF NOT EXISTS "outreach_logs_campaign_id_status_idx" ON "outreach_logs" ("campaign_id", "status");
CREATE INDEX IF NOT EXISTS "outreach_logs_campaign_id_action_type_created_at_idx" ON "outreach_logs" ("campaign_id", "action_type", "created_at");

-- FK (cascade khi xoá campaign). DO block để idempotent (bỏ qua nếu đã tồn tại).
DO $$ BEGIN
  ALTER TABLE "outreach_templates"
    ADD CONSTRAINT "outreach_templates_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "outreach_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "outreach_logs"
    ADD CONSTRAINT "outreach_logs_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "outreach_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
