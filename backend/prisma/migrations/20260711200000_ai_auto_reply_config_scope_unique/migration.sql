CREATE UNIQUE INDEX "ai_auto_reply_configs_org_scope_ref_unique"
ON "ai_auto_reply_configs" ("org_id", "scope", COALESCE("scope_ref_id", ''))
WHERE "deleted_at" IS NULL;