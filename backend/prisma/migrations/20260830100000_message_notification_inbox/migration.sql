CREATE TABLE "message_notifications" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "org_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "zalo_account_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "preview" TEXT NOT NULL,
  "avatar_url" TEXT,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "message_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_notifications_user_id_message_id_key"
  ON "message_notifications"("user_id", "message_id");
CREATE INDEX "message_notifications_user_id_read_at_created_at_idx"
  ON "message_notifications"("user_id", "read_at", "created_at" DESC);
CREATE INDEX "message_notifications_user_id_conversation_id_read_at_idx"
  ON "message_notifications"("user_id", "conversation_id", "read_at");
CREATE INDEX "message_notifications_org_id_created_at_idx"
  ON "message_notifications"("org_id", "created_at" DESC);

ALTER TABLE "message_notifications"
  ADD CONSTRAINT "message_notifications_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_notifications"
  ADD CONSTRAINT "message_notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
