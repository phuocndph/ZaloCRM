-- Add a friend-based audience to Community Outreach while keeping existing
-- customer-list campaigns fully backward compatible.
ALTER TABLE "outreach_campaigns"
  ADD COLUMN "audience_source" TEXT NOT NULL DEFAULT 'customer_list',
  ADD COLUMN "source_account_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "deduplicate_contacts" BOOLEAN NOT NULL DEFAULT TRUE,
  ALTER COLUMN "customer_list_id" DROP NOT NULL,
  ALTER COLUMN "zalo_account_id" DROP NOT NULL;

ALTER TABLE "outreach_phones"
  ADD COLUMN "target_name" TEXT,
  ADD COLUMN "friend_id" TEXT,
  ADD COLUMN "contact_id" TEXT,
  ADD COLUMN "zalo_account_id" TEXT,
  ADD COLUMN "zalo_uid" TEXT,
  ADD COLUMN "account_name" TEXT,
  ADD COLUMN "tag_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "last_interaction_at" TIMESTAMP(3);

CREATE INDEX "outreach_phones_campaign_id_friend_id_idx"
  ON "outreach_phones"("campaign_id", "friend_id");
CREATE INDEX "outreach_phones_campaign_id_zalo_account_id_idx"
  ON "outreach_phones"("campaign_id", "zalo_account_id");
