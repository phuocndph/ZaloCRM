ALTER TABLE "ai_learning_candidates" ALTER COLUMN "run_id" DROP NOT NULL;
ALTER TABLE "ai_learning_candidates" DROP CONSTRAINT IF EXISTS "ai_learning_candidates_run_id_fkey";
ALTER TABLE "ai_learning_candidates" ADD CONSTRAINT "ai_learning_candidates_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "ai_learning_candidates_org_kind_status_created_at_idx" ON "ai_learning_candidates"("org_id", "kind", "status", "created_at");