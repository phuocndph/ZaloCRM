ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "delivery_state" TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_lease_id" TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_lease_until" TIMESTAMP(3);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_delivery_state_lease_idx"
  ON "messages"("delivery_state", "delivery_lease_until");
