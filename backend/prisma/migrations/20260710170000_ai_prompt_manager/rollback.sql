DROP INDEX IF EXISTS "ai_prompt_versions_one_production_per_prompt";
DROP INDEX IF EXISTS "ai_prompts_org_id_scope_skill_id_deleted_at_idx";

ALTER TABLE "ai_prompt_versions"
  DROP CONSTRAINT IF EXISTS "ai_prompt_versions_status_check",
  DROP COLUMN IF EXISTS "change_note";

ALTER TABLE "ai_prompts"
  DROP CONSTRAINT IF EXISTS "ai_prompts_scope_check",
  DROP CONSTRAINT IF EXISTS "ai_prompts_skill_id_fkey",
  DROP COLUMN IF EXISTS "skill_id",
  DROP COLUMN IF EXISTS "scope";
