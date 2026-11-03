CREATE TABLE "javis_webhook_deliveries" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "raw_body" JSONB NOT NULL,
  "target_url" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3),
  "last_error" TEXT,
  "delivered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "javis_webhook_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "javis_webhook_deliveries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "javis_webhook_deliveries_org_id_event_type_message_id_key" ON "javis_webhook_deliveries"("org_id", "event_type", "message_id");
CREATE INDEX "javis_webhook_deliveries_status_next_attempt_at_idx" ON "javis_webhook_deliveries"("status", "next_attempt_at");
CREATE INDEX "javis_webhook_deliveries_org_id_created_at_idx" ON "javis_webhook_deliveries"("org_id", "created_at");
