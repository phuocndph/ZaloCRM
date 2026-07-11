-- Prompt Management: system/skill scope and immutable version change notes.
ALTER TABLE "ai_prompts"
  ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN "skill_id" TEXT;

ALTER TABLE "ai_prompt_versions"
  ADD COLUMN "change_note" TEXT;

ALTER TABLE "ai_prompts"
  ADD CONSTRAINT "ai_prompts_skill_id_fkey"
  FOREIGN KEY ("skill_id") REFERENCES "ai_skills"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ai_prompts_org_id_scope_skill_id_deleted_at_idx"
  ON "ai_prompts"("org_id", "scope", "skill_id", "deleted_at");

-- Database-level invariant: at most one running Production version per prompt.
CREATE UNIQUE INDEX "ai_prompt_versions_one_production_per_prompt"
  ON "ai_prompt_versions"("prompt_id")
  WHERE "status" = 'production';

ALTER TABLE "ai_prompts"
  ADD CONSTRAINT "ai_prompts_scope_check"
  CHECK (
    ("scope" = 'system' AND "skill_id" IS NULL)
    OR ("scope" = 'skill' AND "skill_id" IS NOT NULL)
  );

ALTER TABLE "ai_prompt_versions"
  ADD CONSTRAINT "ai_prompt_versions_status_check"
  CHECK ("status" IN ('draft', 'testing', 'production', 'archived'));
