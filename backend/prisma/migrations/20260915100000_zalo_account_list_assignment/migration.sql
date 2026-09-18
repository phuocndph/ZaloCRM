-- Store the responsible Zalo account on each list entry without changing CRM ownership.
ALTER TABLE "customer_list_entries"
  ADD COLUMN "assigned_zalo_account_id" TEXT;

CREATE INDEX "customer_list_entries_assigned_zalo_account_id_idx"
  ON "customer_list_entries"("assigned_zalo_account_id");

ALTER TABLE "customer_list_entries"
  ADD CONSTRAINT "customer_list_entries_assigned_zalo_account_id_fkey"
  FOREIGN KEY ("assigned_zalo_account_id") REFERENCES "zalo_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "customer_list_zalo_assignments" (
  "id" TEXT NOT NULL,
  "customer_list_id" TEXT NOT NULL,
  "zalo_account_id" TEXT NOT NULL,
  "weight" INTEGER NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_list_zalo_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_list_zalo_assignments_customer_list_id_zalo_account_id_key"
  ON "customer_list_zalo_assignments"("customer_list_id", "zalo_account_id");
CREATE INDEX "customer_list_zalo_assignments_zalo_account_id_idx"
  ON "customer_list_zalo_assignments"("zalo_account_id");

ALTER TABLE "customer_list_zalo_assignments"
  ADD CONSTRAINT "customer_list_zalo_assignments_customer_list_id_fkey"
  FOREIGN KEY ("customer_list_id") REFERENCES "customer_lists"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_list_zalo_assignments"
  ADD CONSTRAINT "customer_list_zalo_assignments_zalo_account_id_fkey"
  FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "zalo_assignment_states" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "customer_list_id" TEXT NOT NULL,
  "last_assigned_zalo_account_id" TEXT,
  "counter" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "zalo_assignment_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "zalo_assignment_states_customer_list_id_key"
  ON "zalo_assignment_states"("customer_list_id");
CREATE INDEX "zalo_assignment_states_org_id_idx"
  ON "zalo_assignment_states"("org_id");

ALTER TABLE "zalo_assignment_states"
  ADD CONSTRAINT "zalo_assignment_states_customer_list_id_fkey"
  FOREIGN KEY ("customer_list_id") REFERENCES "customer_lists"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;