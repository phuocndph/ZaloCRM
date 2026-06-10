-- E3 — Vá nợ migration chain (PHẦN B): reconcile FK + index + cột còn lại.
--
-- Sau PHẦN A (baseline_dbpush_tables) + toàn bộ migration cũ, một DB dựng-mới đã có đủ
-- 32 bảng + cột db-push nhưng CÒN THIẾU: FK/index của các bảng db-push, vài cột/định-nghĩa
-- lệch so với schema, và phải bỏ vài artifact migration tạo mà schema đã loại
-- (vd bảng "tag_backfill_progress", 5 index cũ). File này đưa DB mới KHỚP CHÍNH XÁC schema.
--
-- Sinh tự động bằng: prisma migrate diff --from-config-datasource(replay) --to-schema --script
-- rồi bọc IDEMPOTENT (IF EXISTS / IF NOT EXISTS / DO-guard FK) → prod (đã = schema qua db push)
-- chạy chỉ no-op; DB mới được vá khớp. KHÔNG sửa migration cũ → an toàn checksum.

-- DropForeignKey
ALTER TABLE "automation_broadcasts" DROP CONSTRAINT IF EXISTS "automation_broadcasts_block_id_fkey";

-- DropForeignKey
ALTER TABLE "automation_broadcasts" DROP CONSTRAINT IF EXISTS "automation_broadcasts_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "automation_sequences" DROP CONSTRAINT IF EXISTS "automation_sequences_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "automation_triggers" DROP CONSTRAINT IF EXISTS "automation_triggers_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "block_folders" DROP CONSTRAINT IF EXISTS "block_folders_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "blocks" DROP CONSTRAINT IF EXISTS "blocks_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_pool_bonus_quotas" DROP CONSTRAINT IF EXISTS "lead_pool_bonus_quotas_granted_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_pool_bonus_quotas" DROP CONSTRAINT IF EXISTS "lead_pool_bonus_quotas_user_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_requests" DROP CONSTRAINT IF EXISTS "lead_requests_requested_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "sequence_steps" DROP CONSTRAINT IF EXISTS "sequence_steps_block_id_fkey";

-- DropForeignKey
ALTER TABLE "sequence_steps" DROP CONSTRAINT IF EXISTS "sequence_steps_sequence_id_fkey";

-- DropIndex
DO $$ DECLARE r record; BEGIN
  SELECT conrelid::regclass AS tbl INTO r FROM pg_constraint WHERE conname = 'friend_request_outbox_customer_list_entry_id_kind_trigger_key';
  IF FOUND THEN EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, 'friend_request_outbox_customer_list_entry_id_kind_trigger_key');
  ELSE EXECUTE 'DROP INDEX IF EXISTS "friend_request_outbox_customer_list_entry_id_kind_trigger_key"'; END IF;
END $$;

-- DropIndex
DO $$ DECLARE r record; BEGIN
  SELECT conrelid::regclass AS tbl INTO r FROM pg_constraint WHERE conname = 'idx_outbox_welcome_dedup';
  IF FOUND THEN EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, 'idx_outbox_welcome_dedup');
  ELSE EXECUTE 'DROP INDEX IF EXISTS "idx_outbox_welcome_dedup"'; END IF;
END $$;

-- DropIndex
DO $$ DECLARE r record; BEGIN
  SELECT conrelid::regclass AS tbl INTO r FROM pg_constraint WHERE conname = 'messages_zalo_cli_msg_id_idx';
  IF FOUND THEN EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, 'messages_zalo_cli_msg_id_idx');
  ELSE EXECUTE 'DROP INDEX IF EXISTS "messages_zalo_cli_msg_id_idx"'; END IF;
END $$;

-- DropIndex
DO $$ DECLARE r record; BEGIN
  SELECT conrelid::regclass AS tbl INTO r FROM pg_constraint WHERE conname = 'permission_groups_grants_idx';
  IF FOUND THEN EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, 'permission_groups_grants_idx');
  ELSE EXECUTE 'DROP INDEX IF EXISTS "permission_groups_grants_idx"'; END IF;
END $$;

-- DropIndex
DO $$ DECLARE r record; BEGIN
  SELECT conrelid::regclass AS tbl INTO r FROM pg_constraint WHERE conname = 'users_permission_group_id_idx';
  IF FOUND THEN EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, 'users_permission_group_id_idx');
  ELSE EXECUTE 'DROP INDEX IF EXISTS "users_permission_group_id_idx"'; END IF;
END $$;

-- AlterTable
ALTER TABLE "automation_campaigns" ALTER COLUMN "nick_first_offline_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "automation_event_log" ADD COLUMN IF NOT EXISTS "detail" TEXT,
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "trigger_id" DROP NOT NULL,
ALTER COLUMN "summary" DROP NOT NULL,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "automation_sequences" ALTER COLUMN "counters_last_synced_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "automation_triggers" ALTER COLUMN "scheduled_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "paused_until" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "contact_access" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "departments" ALTER COLUMN "path" DROP DEFAULT;

-- AlterTable
ALTER TABLE "friend_request_outbox" ALTER COLUMN "nick_first_offline_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "user_privacy_sessions" ADD COLUMN IF NOT EXISTS "ip_address" TEXT;

-- DropTable
DROP TABLE IF EXISTS "tag_backfill_progress";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "account_folder_members_zalo_account_id_idx" ON "account_folder_members"("zalo_account_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "account_folder_members_folder_id_zalo_account_id_key" ON "account_folder_members"("folder_id", "zalo_account_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "account_folders_org_id_user_id_sort_order_idx" ON "account_folders"("org_id", "user_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "account_folders_user_id_name_key" ON "account_folders"("user_id", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "activity_logs_entity_type_entity_id_created_at_idx" ON "activity_logs"("entity_type", "entity_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "activity_logs_org_id_category_created_at_idx" ON "activity_logs"("org_id", "category", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "activity_logs_org_id_actor_type_created_at_idx" ON "activity_logs"("org_id", "actor_type", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ai_configs_org_id_key" ON "ai_configs"("org_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_suggestions_org_id_created_at_idx" ON "ai_suggestions"("org_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_suggestions_conversation_id_created_at_idx" ON "ai_suggestions"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_suggestions_org_id_type_created_at_idx" ON "ai_suggestions"("org_id", "type", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "appointments_source_idx" ON "appointments"("source");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "appointments_org_id_appointment_date_idx" ON "appointments"("org_id", "appointment_date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_org_id_external_ref_key" ON "appointments"("org_id", "external_ref");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "automation_rules_org_id_trigger_enabled_priority_idx" ON "automation_rules"("org_id", "trigger", "enabled", "priority");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contact_engagement_daily_org_id_contact_id_date_idx" ON "contact_engagement_daily"("org_id", "contact_id", "date" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contact_engagement_daily_org_id_date_idx" ON "contact_engagement_daily"("org_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "contact_engagement_daily_org_id_contact_id_date_key" ON "contact_engagement_daily"("org_id", "contact_id", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_phone_normalized_idx" ON "contacts"("org_id", "phone_normalized");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_priority_score_idx" ON "contacts"("org_id", "priority_score" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_zalo_username_idx" ON "contacts"("org_id", "zalo_username");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_has_zalo_idx" ON "contacts"("org_id", "has_zalo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_import_batch_id_idx" ON "contacts"("org_id", "import_batch_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_consent_status_idx" ON "contacts"("org_id", "consent_status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_province_district_idx" ON "contacts"("org_id", "province", "district");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_last_inbound_at_idx" ON "contacts"("org_id", "last_inbound_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_last_outbound_at_idx" ON "contacts"("org_id", "last_outbound_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_status_last_inbound_at_idx" ON "contacts"("org_id", "status", "last_inbound_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_phone_2_idx" ON "contacts"("phone_2");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_phone_3_idx" ON "contacts"("phone_3");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_accepted_nicks_count_idx" ON "contacts"("org_id", "accepted_nicks_count");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_parent_contact_id_idx" ON "contacts"("org_id", "parent_contact_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_status_id_idx" ON "contacts"("org_id", "status_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_lead_score_idx" ON "contacts"("org_id", "lead_score" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_stuck_since_aggregate_idx" ON "contacts"("org_id", "stuck_since_aggregate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "contacts_org_id_aggregate_score_updated_at_idx" ON "contacts"("org_id", "aggregate_score_updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "contacts_org_id_zalo_global_id_key" ON "contacts"("org_id", "zalo_global_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversations_org_id_zalo_account_id_is_replied_last_messag_idx" ON "conversations"("org_id", "zalo_account_id", "is_replied", "last_message_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversations_org_id_zalo_account_id_last_message_at_idx" ON "conversations"("org_id", "zalo_account_id", "last_message_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversations_org_id_threadType_zalo_account_id_last_messag_idx" ON "conversations"("org_id", "threadType", "zalo_account_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversations_org_id_tab_zalo_account_id_last_message_at_idx" ON "conversations"("org_id", "tab", "zalo_account_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "crm_tag_groups_org_id_archived_at_idx" ON "crm_tag_groups"("org_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "crm_tag_groups_org_id_name_key" ON "crm_tag_groups"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "crm_tag_groups_zalo_account_id_managed_by_key" ON "crm_tag_groups"("zalo_account_id", "managed_by");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "crm_tags_org_id_category_idx" ON "crm_tags"("org_id", "category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "crm_tags_org_id_group_id_idx" ON "crm_tags"("org_id", "group_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "crm_tags_managed_by_archived_at_idx" ON "crm_tags"("managed_by", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "crm_tags_org_id_name_key" ON "crm_tags"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "crm_tags_source_zalo_label_id_key" ON "crm_tags"("source_zalo_label_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_list_entries_customer_list_id_status_idx" ON "customer_list_entries"("customer_list_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_list_entries_phone_e164_idx" ON "customer_list_entries"("phone_e164");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_list_entries_phone_local_idx" ON "customer_list_entries"("phone_local");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "customer_list_entries_customer_list_id_row_index_key" ON "customer_list_entries"("customer_list_id", "row_index");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_lists_org_id_status_created_at_idx" ON "customer_lists"("org_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "customer_lists_org_id_archived_at_idx" ON "customer_lists"("org_id", "archived_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_outbox_kind_send_status_run_at" ON "friend_request_outbox"("kind", "send_status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_outbox_welcome_outcome" ON "friend_request_outbox"("welcome_outcome");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "friends_zalo_account_id_contact_id_idx" ON "friends"("zalo_account_id", "contact_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "friends_org_id_contact_id_idx" ON "friends"("org_id", "contact_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "friends_zalo_account_id_relationship_kind_idx" ON "friends"("zalo_account_id", "relationship_kind");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "friends_zalo_account_id_friendship_status_idx" ON "friends"("zalo_account_id", "friendship_status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "friends_org_id_relationship_kind_idx" ON "friends"("org_id", "relationship_kind");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "friends_org_id_status_id_idx" ON "friends"("org_id", "status_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "friends_org_id_score_updated_at_idx" ON "friends"("org_id", "score_updated_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "friends_org_id_stuck_since_idx" ON "friends"("org_id", "stuck_since");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "friends_org_id_lead_score_idx" ON "friends"("org_id", "lead_score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "friends_zalo_account_id_zalo_uid_in_nick_key" ON "friends"("zalo_account_id", "zalo_uid_in_nick");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "friendship_attempts_org_id_state_idx" ON "friendship_attempts"("org_id", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "friendship_attempts_contact_id_state_idx" ON "friendship_attempts"("contact_id", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "friendship_attempts_zalo_account_id_state_queued_at_idx" ON "friendship_attempts"("zalo_account_id", "state", "queued_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "friendship_attempts_zalo_account_id_contact_id_key" ON "friendship_attempts"("zalo_account_id", "contact_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "group_polls_org_id_group_external_id_idx" ON "group_polls"("org_id", "group_external_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "group_polls_zalo_account_id_zalo_poll_id_key" ON "group_polls"("zalo_account_id", "zalo_poll_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "message_reactions_message_id_idx" ON "message_reactions"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "message_reactions_message_id_reactor_id_emoji_key" ON "message_reactions"("message_id", "reactor_id", "emoji");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "message_templates_org_id_owner_user_id_idx" ON "message_templates"("org_id", "owner_user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "message_templates_org_id_category_idx" ON "message_templates"("org_id", "category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "messages_conversation_id_album_key_idx" ON "messages"("conversation_id", "album_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "messages_conversation_id_zalo_msg_id_num_idx" ON "messages"("conversation_id", "zalo_msg_id_num" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "messages_conversation_id_sent_at_sender_type_sent_via_idx" ON "messages"("conversation_id", "sent_at", "sender_type", "sent_via");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "messages_conversation_id_zalo_msg_id_key" ON "messages"("conversation_id", "zalo_msg_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "nba_templates_org_id_category_enabled_idx" ON "nba_templates"("org_id", "category", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "nba_templates_org_id_key_key" ON "nba_templates"("org_id", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "note_reactions_note_id_idx" ON "note_reactions"("note_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "note_reactions_note_id_user_id_emoji_key" ON "note_reactions"("note_id", "user_id", "emoji");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "notes_org_id_contact_id_created_at_idx" ON "notes"("org_id", "contact_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "notes_parent_note_id_idx" ON "notes"("parent_note_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "parent_candidates_org_id_dismissed_created_at_idx" ON "parent_candidates"("org_id", "dismissed", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "phone_search_events_account_id_occurred_at_idx" ON "phone_search_events"("account_id", "occurred_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "phone_search_events_org_id_occurred_at_idx" ON "phone_search_events"("org_id", "occurred_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "phone_search_events_phone_hash_idx" ON "phone_search_events"("phone_hash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "pinned_conversations_zalo_account_id_conversation_id_key" ON "pinned_conversations"("zalo_account_id", "conversation_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "saved_filter_presets_org_id_user_id_sort_order_idx" ON "saved_filter_presets"("org_id", "user_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "saved_filter_presets_user_id_name_key" ON "saved_filter_presets"("user_id", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "score_signal_rules_org_id_rule_type_enabled_idx" ON "score_signal_rules"("org_id", "rule_type", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "score_signal_rules_org_id_signal_key_key" ON "score_signal_rules"("org_id", "signal_key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "scoring_configs_org_id_key" ON "scoring_configs"("org_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "stage_transition_rules_org_id_from_stage_enabled_idx" ON "stage_transition_rules"("org_id", "from_stage", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "stage_transition_rules_org_id_from_stage_to_stage_key" ON "stage_transition_rules"("org_id", "from_stage", "to_stage");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "statuses_org_id_order_idx" ON "statuses"("org_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "statuses_org_id_name_key" ON "statuses"("org_id", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "stuck_thresholds_org_id_stage_enabled_idx" ON "stuck_thresholds"("org_id", "stage", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "stuck_thresholds_org_id_stage_key" ON "stuck_thresholds"("org_id", "stage");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_preferences_user_id_idx" ON "user_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_preferences_user_id_key_key" ON "user_preferences"("user_id", "key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "zalo_labels_org_id_zalo_account_id_idx" ON "zalo_labels"("org_id", "zalo_account_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "zalo_labels_zalo_account_id_zalo_label_id_key" ON "zalo_labels"("zalo_account_id", "zalo_label_id");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_system_notify_zalo_account_id_fkey') THEN
    ALTER TABLE "organizations" ADD CONSTRAINT "organizations_system_notify_zalo_account_id_fkey" FOREIGN KEY ("system_notify_zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_internal_contact_zalo_account_id_fkey') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_internal_contact_zalo_account_id_fkey" FOREIGN KEY ("internal_contact_zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_parent_contact_id_fkey') THEN
    ALTER TABLE "contacts" ADD CONSTRAINT "contacts_parent_contact_id_fkey" FOREIGN KEY ("parent_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_status_id_fkey') THEN
    ALTER TABLE "contacts" ADD CONSTRAINT "contacts_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statuses_org_id_fkey') THEN
    ALTER TABLE "statuses" ADD CONSTRAINT "statuses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phone_search_events_org_id_fkey') THEN
    ALTER TABLE "phone_search_events" ADD CONSTRAINT "phone_search_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phone_search_events_account_id_fkey') THEN
    ALTER TABLE "phone_search_events" ADD CONSTRAINT "phone_search_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phone_search_events_user_id_fkey') THEN
    ALTER TABLE "phone_search_events" ADD CONSTRAINT "phone_search_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_status_changed_by_user_id_fkey') THEN
    ALTER TABLE "appointments" ADD CONSTRAINT "appointments_status_changed_by_user_id_fkey" FOREIGN KEY ("status_changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notes_org_id_fkey') THEN
    ALTER TABLE "notes" ADD CONSTRAINT "notes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notes_contact_id_fkey') THEN
    ALTER TABLE "notes" ADD CONSTRAINT "notes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notes_author_user_id_fkey') THEN
    ALTER TABLE "notes" ADD CONSTRAINT "notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notes_parent_note_id_fkey') THEN
    ALTER TABLE "notes" ADD CONSTRAINT "notes_parent_note_id_fkey" FOREIGN KEY ("parent_note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notes_suggested_appointment_id_fkey') THEN
    ALTER TABLE "notes" ADD CONSTRAINT "notes_suggested_appointment_id_fkey" FOREIGN KEY ("suggested_appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_tags_org_id_fkey') THEN
    ALTER TABLE "crm_tags" ADD CONSTRAINT "crm_tags_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_tags_group_id_fkey') THEN
    ALTER TABLE "crm_tags" ADD CONSTRAINT "crm_tags_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "crm_tag_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_tag_groups_org_id_fkey') THEN
    ALTER TABLE "crm_tag_groups" ADD CONSTRAINT "crm_tag_groups_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_tag_groups_zalo_account_id_fkey') THEN
    ALTER TABLE "crm_tag_groups" ADD CONSTRAINT "crm_tag_groups_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_preferences_user_id_fkey') THEN
    ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zalo_labels_org_id_fkey') THEN
    ALTER TABLE "zalo_labels" ADD CONSTRAINT "zalo_labels_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zalo_labels_zalo_account_id_fkey') THEN
    ALTER TABLE "zalo_labels" ADD CONSTRAINT "zalo_labels_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'note_reactions_note_id_fkey') THEN
    ALTER TABLE "note_reactions" ADD CONSTRAINT "note_reactions_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'note_reactions_user_id_fkey') THEN
    ALTER TABLE "note_reactions" ADD CONSTRAINT "note_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integrations_org_id_fkey') THEN
    ALTER TABLE "integrations" ADD CONSTRAINT "integrations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sync_logs_integration_id_fkey') THEN
    ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parent_candidates_org_id_fkey') THEN
    ALTER TABLE "parent_candidates" ADD CONSTRAINT "parent_candidates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_reports_org_id_fkey') THEN
    ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_rules_org_id_fkey') THEN
    ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_templates_org_id_fkey') THEN
    ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_templates_owner_user_id_fkey') THEN
    ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_configs_org_id_fkey') THEN
    ALTER TABLE "ai_configs" ADD CONSTRAINT "ai_configs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_suggestions_org_id_fkey') THEN
    ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_suggestions_conversation_id_fkey') THEN
    ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reactions_message_id_fkey') THEN
    ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pinned_conversations_org_id_fkey') THEN
    ALTER TABLE "pinned_conversations" ADD CONSTRAINT "pinned_conversations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pinned_conversations_conversation_id_fkey') THEN
    ALTER TABLE "pinned_conversations" ADD CONSTRAINT "pinned_conversations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_polls_org_id_fkey') THEN
    ALTER TABLE "group_polls" ADD CONSTRAINT "group_polls_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friendship_attempts_org_id_fkey') THEN
    ALTER TABLE "friendship_attempts" ADD CONSTRAINT "friendship_attempts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friendship_attempts_zalo_account_id_fkey') THEN
    ALTER TABLE "friendship_attempts" ADD CONSTRAINT "friendship_attempts_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friendship_attempts_contact_id_fkey') THEN
    ALTER TABLE "friendship_attempts" ADD CONSTRAINT "friendship_attempts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friends_status_id_fkey') THEN
    ALTER TABLE "friends" ADD CONSTRAINT "friends_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "statuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friends_org_id_fkey') THEN
    ALTER TABLE "friends" ADD CONSTRAINT "friends_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friends_contact_id_fkey') THEN
    ALTER TABLE "friends" ADD CONSTRAINT "friends_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friends_zalo_account_id_fkey') THEN
    ALTER TABLE "friends" ADD CONSTRAINT "friends_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scoring_configs_org_id_fkey') THEN
    ALTER TABLE "scoring_configs" ADD CONSTRAINT "scoring_configs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'score_signal_rules_org_id_fkey') THEN
    ALTER TABLE "score_signal_rules" ADD CONSTRAINT "score_signal_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_transition_rules_org_id_fkey') THEN
    ALTER TABLE "stage_transition_rules" ADD CONSTRAINT "stage_transition_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stuck_thresholds_org_id_fkey') THEN
    ALTER TABLE "stuck_thresholds" ADD CONSTRAINT "stuck_thresholds_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nba_templates_org_id_fkey') THEN
    ALTER TABLE "nba_templates" ADD CONSTRAINT "nba_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_folders_org_id_fkey') THEN
    ALTER TABLE "account_folders" ADD CONSTRAINT "account_folders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_folders_user_id_fkey') THEN
    ALTER TABLE "account_folders" ADD CONSTRAINT "account_folders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_folder_members_folder_id_fkey') THEN
    ALTER TABLE "account_folder_members" ADD CONSTRAINT "account_folder_members_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "account_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_folder_members_zalo_account_id_fkey') THEN
    ALTER TABLE "account_folder_members" ADD CONSTRAINT "account_folder_members_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_filter_presets_org_id_fkey') THEN
    ALTER TABLE "saved_filter_presets" ADD CONSTRAINT "saved_filter_presets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_filter_presets_user_id_fkey') THEN
    ALTER TABLE "saved_filter_presets" ADD CONSTRAINT "saved_filter_presets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'block_folders_created_by_id_fkey') THEN
    ALTER TABLE "block_folders" ADD CONSTRAINT "block_folders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blocks_created_by_id_fkey') THEN
    ALTER TABLE "blocks" ADD CONSTRAINT "blocks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sequence_steps_sequence_id_fkey') THEN
    ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "automation_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sequence_steps_block_id_fkey') THEN
    ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_sequences_created_by_id_fkey') THEN
    ALTER TABLE "automation_sequences" ADD CONSTRAINT "automation_sequences_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_triggers_created_by_id_fkey') THEN
    ALTER TABLE "automation_triggers" ADD CONSTRAINT "automation_triggers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'automation_broadcasts_created_by_id_fkey') THEN
    ALTER TABLE "automation_broadcasts" ADD CONSTRAINT "automation_broadcasts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_engagement_daily_contact_id_fkey') THEN
    ALTER TABLE "contact_engagement_daily" ADD CONSTRAINT "contact_engagement_daily_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_list_entries_customer_list_id_fkey') THEN
    ALTER TABLE "customer_list_entries" ADD CONSTRAINT "customer_list_entries_customer_list_id_fkey" FOREIGN KEY ("customer_list_id") REFERENCES "customer_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_requests_requested_by_user_id_fkey') THEN
    ALTER TABLE "lead_requests" ADD CONSTRAINT "lead_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_pool_bonus_quotas_user_id_fkey') THEN
    ALTER TABLE "lead_pool_bonus_quotas" ADD CONSTRAINT "lead_pool_bonus_quotas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_pool_bonus_quotas_granted_by_user_id_fkey') THEN
    ALTER TABLE "lead_pool_bonus_quotas" ADD CONSTRAINT "lead_pool_bonus_quotas_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_triggers_system_kind') AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'automation_triggers_system_kind_idx') THEN
    ALTER INDEX "idx_triggers_system_kind" RENAME TO "automation_triggers_system_kind_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'blocks_org_id_tag_ids_idx') AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'blocks_tag_ids_idx') THEN
    ALTER INDEX "blocks_org_id_tag_ids_idx" RENAME TO "blocks_tag_ids_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'contacts_forgotten_pool_idx') AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'contacts_org_id_last_activity_idx') THEN
    ALTER INDEX "contacts_forgotten_pool_idx" RENAME TO "contacts_org_id_last_activity_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'friend_request_outbox_entry_kind_unique') AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'friend_request_outbox_customer_list_entry_id_kind_key') THEN
    ALTER INDEX "friend_request_outbox_entry_kind_unique" RENAME TO "friend_request_outbox_customer_list_entry_id_kind_key";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'lead_requests_contact_requested_at_idx') AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'lead_requests_contact_id_requested_at_idx') THEN
    ALTER INDEX "lead_requests_contact_requested_at_idx" RENAME TO "lead_requests_contact_id_requested_at_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'lead_requests_expires_returned_idx') AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'lead_requests_expires_at_auto_returned_at_idx') THEN
    ALTER INDEX "lead_requests_expires_returned_idx" RENAME TO "lead_requests_expires_at_auto_returned_at_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'lead_requests_org_user_requested_at_idx') AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'lead_requests_org_id_requested_by_user_id_requested_at_idx') THEN
    ALTER INDEX "lead_requests_org_user_requested_at_idx" RENAME TO "lead_requests_org_id_requested_by_user_id_requested_at_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'lead_requests_user_note_idx') AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'lead_requests_requested_by_user_id_note_submitted_at_idx') THEN
    ALTER INDEX "lead_requests_user_note_idx" RENAME TO "lead_requests_requested_by_user_id_note_submitted_at_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_messages_automation_task') AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'messages_automation_task_id_sent_at_idx') THEN
    ALTER INDEX "idx_messages_automation_task" RENAME TO "messages_automation_task_id_sent_at_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_messages_sent_via_conv') AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'messages_sent_via_conversation_id_idx') THEN
    ALTER INDEX "idx_messages_sent_via_conv" RENAME TO "messages_sent_via_conversation_id_idx";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'system_notify_recipients_target_user_id_sender_zalo_account_id_') AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'system_notify_recipients_target_user_id_sender_zalo_account_key') THEN
    ALTER INDEX "system_notify_recipients_target_user_id_sender_zalo_account_id_" RENAME TO "system_notify_recipients_target_user_id_sender_zalo_account_key";
  END IF;
END $$;

-- RenameIndex
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'uniq_recipient_sender_thread') AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'system_notify_recipients_sender_zalo_account_id_thread_id_i_key') THEN
    ALTER INDEX "uniq_recipient_sender_thread" RENAME TO "system_notify_recipients_sender_zalo_account_id_thread_id_i_key";
  END IF;
END $$;

