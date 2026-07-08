-- Outreach per-phone state (1 số = 1 dòng, worker upsert tại chỗ). Additive + IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "outreach_phones" (
  "id"             TEXT PRIMARY KEY,
  "campaign_id"    TEXT NOT NULL,
  "entry_id"       TEXT NOT NULL,
  "phone"          TEXT NOT NULL,
  "overall_status" TEXT NOT NULL DEFAULT 'waiting',
  "friend_status"  TEXT NOT NULL DEFAULT 'none',
  "message_status" TEXT NOT NULL DEFAULT 'none',
  "note"           TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "outreach_phones_campaign_id_entry_id_key" ON "outreach_phones" ("campaign_id", "entry_id");
CREATE INDEX IF NOT EXISTS "outreach_phones_campaign_id_overall_status_idx" ON "outreach_phones" ("campaign_id", "overall_status");
CREATE INDEX IF NOT EXISTS "outreach_phones_campaign_id_updated_at_idx" ON "outreach_phones" ("campaign_id", "updated_at");
CREATE INDEX IF NOT EXISTS "outreach_phones_campaign_id_phone_idx" ON "outreach_phones" ("campaign_id", "phone");

DO $$ BEGIN
  ALTER TABLE "outreach_phones"
    ADD CONSTRAINT "outreach_phones_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "outreach_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
