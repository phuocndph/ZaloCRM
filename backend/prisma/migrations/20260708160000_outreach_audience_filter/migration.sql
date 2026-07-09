-- Điều kiện gửi (Campaign Audience Filter). Additive — rỗng/'any' = không lọc (như cũ).

ALTER TABLE "outreach_campaigns" ADD COLUMN IF NOT EXISTS "filter_require_tags" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "outreach_campaigns" ADD COLUMN IF NOT EXISTS "filter_exclude_tags" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "outreach_campaigns" ADD COLUMN IF NOT EXISTS "filter_skip_chatted_days" INTEGER;
ALTER TABLE "outreach_campaigns" ADD COLUMN IF NOT EXISTS "filter_friend_relation" TEXT NOT NULL DEFAULT 'any';
