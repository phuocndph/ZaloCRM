-- E1 Quét group 2026-06-21 (Community) — roster member (group_members) + lịch sử lần
-- quét (group_scans). Additive: 2 bảng mới + FK org/nick (cascade) + index. Không đụng bảng cũ.

-- CreateTable
CREATE TABLE "group_members" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "member_uid" TEXT NOT NULL,
    "global_id" TEXT,
    "display_name" TEXT,
    "zalo_name" TEXT,
    "avatar_url" TEXT,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_friend" BOOLEAN NOT NULL DEFAULT false,
    "friend_checked_at" TIMESTAMP(3),
    "harvested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_scans" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'selected',
    "group_ids" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "total_groups" INTEGER NOT NULL DEFAULT 0,
    "scanned_groups" INTEGER NOT NULL DEFAULT 0,
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "friend_count" INTEGER NOT NULL DEFAULT 0,
    "resume_cursor" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_members_zalo_account_id_group_id_idx" ON "group_members"("zalo_account_id", "group_id");

-- CreateIndex
CREATE INDEX "group_members_org_id_member_uid_idx" ON "group_members"("org_id", "member_uid");

-- CreateIndex
CREATE INDEX "group_members_zalo_account_id_is_friend_idx" ON "group_members"("zalo_account_id", "is_friend");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_zalo_account_id_group_id_member_uid_key" ON "group_members"("zalo_account_id", "group_id", "member_uid");

-- CreateIndex
CREATE INDEX "group_scans_org_id_zalo_account_id_created_at_idx" ON "group_scans"("org_id", "zalo_account_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_scans" ADD CONSTRAINT "group_scans_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_scans" ADD CONSTRAINT "group_scans_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

