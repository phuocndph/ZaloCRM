-- Chạy lại chiến dịch: run counter + thứ tự xử lý (seq) + lịch sử chạy. Additive.

ALTER TABLE "outreach_campaigns" ADD COLUMN IF NOT EXISTS "run_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "outreach_phones" ADD COLUMN IF NOT EXISTS "seq" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "outreach_runs" (
  "id"              TEXT PRIMARY KEY,
  "campaign_id"     TEXT NOT NULL,
  "run_number"      INTEGER NOT NULL,
  "state"           TEXT NOT NULL DEFAULT 'running',
  "started_by_id"   TEXT,
  "started_by_name" TEXT,
  "action"          TEXT NOT NULL DEFAULT 'start',
  "started_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at"    TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "outreach_runs_campaign_id_run_number_idx" ON "outreach_runs" ("campaign_id", "run_number");

DO $$ BEGIN
  ALTER TABLE "outreach_runs"
    ADD CONSTRAINT "outreach_runs_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "outreach_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
