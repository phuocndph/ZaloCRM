-- CreateTable
CREATE TABLE "ai_agents" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "persona_id" TEXT,
    "prompt_version_id" TEXT,
    "model_config_id" TEXT,
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "policy" JSONB NOT NULL DEFAULT '{}',
    "auto_reply_mode" TEXT NOT NULL DEFAULT 'disabled',
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_personas" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content_encrypted" BYTEA,
    "content_hash" TEXT,
    "preview_redacted" TEXT,
    "style" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ai_personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_skills" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handler_type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "credential_ref" TEXT,
    "risk_tier" TEXT NOT NULL DEFAULT 'low',
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ai_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_skills" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "skill_id" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "config_override" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agent_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ai_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_prompt_versions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "content_encrypted" BYTEA NOT NULL,
    "content_hash" TEXT NOT NULL,
    "preview_redacted" TEXT,
    "input_schema" JSONB,
    "output_schema" JSONB,
    "created_by_user_id" TEXT,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_configs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "credential_ref" TEXT,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "data_policy" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ai_model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_knowledge_sources" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "credential_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "last_synced_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ai_knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_knowledge_documents" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "external_id" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "content_ref" TEXT,
    "content_hash" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" TEXT,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ai_knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_knowledge_chunks" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content_encrypted" BYTEA,
    "content_redacted" TEXT,
    "content_hash" TEXT NOT NULL,
    "token_count" INTEGER,
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "embedding_model" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ai_knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT,
    "task_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "risk_tier" TEXT NOT NULL DEFAULT 'low',
    "conversation_id" TEXT,
    "contact_id" TEXT,
    "trigger_message_id" TEXT,
    "prompt_version_id" TEXT,
    "model_config_id" TEXT,
    "context_manifest" JSONB NOT NULL DEFAULT '{}',
    "knowledge_refs" JSONB NOT NULL DEFAULT '[]',
    "input_hash" TEXT,
    "output_hash" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversation_summaries" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT,
    "conversation_id" TEXT NOT NULL,
    "source_through_message_id" TEXT,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "summary_encrypted" BYTEA NOT NULL,
    "summary_redacted" TEXT,
    "summary_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversation_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_customer_memories" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT,
    "contact_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value_encrypted" BYTEA,
    "value_redacted" TEXT,
    "value_hash" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "confidence" DOUBLE PRECISION,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ai_customer_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_intent_analyses" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "message_id" TEXT,
    "contact_id" TEXT,
    "label" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "secondary" JSONB NOT NULL DEFAULT '[]',
    "reason_redacted" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_intent_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_emotion_analyses" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "message_id" TEXT,
    "contact_id" TEXT,
    "label" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "intensity" DOUBLE PRECISION,
    "secondary" JSONB NOT NULL DEFAULT '[]',
    "reason_redacted" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_emotion_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_assistant_suggestions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "trigger_message_id" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "content_encrypted" BYTEA,
    "content_redacted" TEXT,
    "content_hash" TEXT,
    "payload_encrypted" BYTEA,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ai_assistant_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_sent_messages" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "suggestion_id" TEXT,
    "action_id" TEXT,
    "send_mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "provider_message_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "safety_decision" JSONB NOT NULL DEFAULT '{}',
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_sent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_feedback" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "suggestion_id" TEXT,
    "sent_message_id" TEXT,
    "action_id" TEXT,
    "user_id" TEXT,
    "type" TEXT NOT NULL,
    "reason_code" TEXT,
    "original_hash" TEXT,
    "final_hash" TEXT,
    "edit_distance" INTEGER,
    "rating" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_learning_candidates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "suggestion_id" TEXT,
    "feedback_id" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload_encrypted" BYTEA,
    "payload_hash" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "risk_tier" TEXT NOT NULL DEFAULT 'low',
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_learning_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_approved_examples" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "approved_by_user_id" TEXT,
    "purpose" TEXT NOT NULL,
    "input_encrypted" BYTEA,
    "input_hash" TEXT NOT NULL,
    "output_encrypted" BYTEA,
    "output_hash" TEXT NOT NULL,
    "review_redacted" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_approved_examples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_blocked_examples" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "blocked_by_user_id" TEXT,
    "reason_code" TEXT NOT NULL,
    "input_hash" TEXT,
    "output_hash" TEXT,
    "review_redacted" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_blocked_examples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_actions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "suggestion_id" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "risk_tier" TEXT NOT NULL DEFAULT 'low',
    "payload_encrypted" BYTEA,
    "payload_hash" TEXT,
    "preview_redacted" TEXT,
    "requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_handoffs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "suggestion_id" TEXT,
    "action_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reason_code" TEXT NOT NULL,
    "summary_encrypted" BYTEA,
    "summary_redacted" TEXT,
    "assigned_to_user_id" TEXT,
    "assigned_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_cases" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "prompt_version_id" TEXT,
    "input_encrypted" BYTEA NOT NULL,
    "input_hash" TEXT NOT NULL,
    "expected_encrypted" BYTEA,
    "expected_hash" TEXT,
    "rubric" JSONB NOT NULL DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ai_evaluation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_runs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "agent_id" TEXT,
    "prompt_version_id" TEXT,
    "model_config_id" TEXT,
    "dataset_version" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_evaluation_results" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "evaluation_run_id" TEXT NOT NULL,
    "evaluation_case_id" TEXT NOT NULL,
    "ai_run_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "score" DOUBLE PRECISION,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_evaluation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_audit_logs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT,
    "actor_user_id" TEXT,
    "conversation_id" TEXT,
    "event_type" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "input_hash" TEXT,
    "output_hash" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "details_encrypted" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_records" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" BIGINT NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "provider_request_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_agents_org_id_status_deleted_at_idx" ON "ai_agents"("org_id", "status", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_agents_org_id_key_key" ON "ai_agents"("org_id", "key");

-- CreateIndex
CREATE INDEX "ai_personas_org_id_deleted_at_idx" ON "ai_personas"("org_id", "deleted_at");

-- CreateIndex
CREATE INDEX "ai_skills_org_id_deleted_at_idx" ON "ai_skills"("org_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_skills_org_id_key_key" ON "ai_skills"("org_id", "key");

-- CreateIndex
CREATE INDEX "ai_agent_skills_org_id_is_enabled_idx" ON "ai_agent_skills"("org_id", "is_enabled");

-- CreateIndex
CREATE INDEX "ai_agent_skills_skill_id_idx" ON "ai_agent_skills"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_agent_skills_agent_id_skill_id_key" ON "ai_agent_skills"("agent_id", "skill_id");

-- CreateIndex
CREATE INDEX "ai_prompts_org_id_task_type_deleted_at_idx" ON "ai_prompts"("org_id", "task_type", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompts_org_id_key_key" ON "ai_prompts"("org_id", "key");

-- CreateIndex
CREATE INDEX "ai_prompt_versions_org_id_status_idx" ON "ai_prompt_versions"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompt_versions_prompt_id_version_key" ON "ai_prompt_versions"("prompt_id", "version");

-- CreateIndex
CREATE INDEX "ai_model_configs_org_id_provider_status_deleted_at_idx" ON "ai_model_configs"("org_id", "provider", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "ai_knowledge_sources_org_id_type_status_deleted_at_idx" ON "ai_knowledge_sources"("org_id", "type", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "ai_knowledge_documents_org_id_status_deleted_at_idx" ON "ai_knowledge_documents"("org_id", "status", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_knowledge_documents_source_id_external_id_version_key" ON "ai_knowledge_documents"("source_id", "external_id", "version");

-- CreateIndex
CREATE INDEX "ai_knowledge_chunks_org_id_deleted_at_idx" ON "ai_knowledge_chunks"("org_id", "deleted_at");

-- CreateIndex
CREATE INDEX "ai_knowledge_chunks_content_hash_idx" ON "ai_knowledge_chunks"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "ai_knowledge_chunks_document_id_chunk_index_key" ON "ai_knowledge_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE INDEX "ai_runs_org_id_task_type_status_created_at_idx" ON "ai_runs"("org_id", "task_type", "status", "created_at");

-- CreateIndex
CREATE INDEX "ai_runs_conversation_id_created_at_idx" ON "ai_runs"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_runs_contact_id_created_at_idx" ON "ai_runs"("contact_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_conversation_summaries_org_id_status_created_at_idx" ON "ai_conversation_summaries"("org_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_conversation_summaries_conversation_id_version_key" ON "ai_conversation_summaries"("conversation_id", "version");

-- CreateIndex
CREATE INDEX "ai_customer_memories_org_id_status_deleted_at_idx" ON "ai_customer_memories"("org_id", "status", "deleted_at");

-- CreateIndex
CREATE INDEX "ai_customer_memories_contact_id_key_status_idx" ON "ai_customer_memories"("contact_id", "key", "status");

-- CreateIndex
CREATE INDEX "ai_intent_analyses_org_id_label_created_at_idx" ON "ai_intent_analyses"("org_id", "label", "created_at");

-- CreateIndex
CREATE INDEX "ai_intent_analyses_run_id_idx" ON "ai_intent_analyses"("run_id");

-- CreateIndex
CREATE INDEX "ai_intent_analyses_conversation_id_created_at_idx" ON "ai_intent_analyses"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_emotion_analyses_org_id_label_created_at_idx" ON "ai_emotion_analyses"("org_id", "label", "created_at");

-- CreateIndex
CREATE INDEX "ai_emotion_analyses_run_id_idx" ON "ai_emotion_analyses"("run_id");

-- CreateIndex
CREATE INDEX "ai_emotion_analyses_conversation_id_created_at_idx" ON "ai_emotion_analyses"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_assistant_suggestions_org_id_status_created_at_idx" ON "ai_assistant_suggestions"("org_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ai_assistant_suggestions_conversation_id_created_at_idx" ON "ai_assistant_suggestions"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_sent_messages_message_id_key" ON "ai_sent_messages"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_sent_messages_action_id_key" ON "ai_sent_messages"("action_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_sent_messages_idempotency_key_key" ON "ai_sent_messages"("idempotency_key");

-- CreateIndex
CREATE INDEX "ai_sent_messages_org_id_status_sent_at_idx" ON "ai_sent_messages"("org_id", "status", "sent_at");

-- CreateIndex
CREATE INDEX "ai_sent_messages_run_id_idx" ON "ai_sent_messages"("run_id");

-- CreateIndex
CREATE INDEX "ai_feedback_org_id_type_created_at_idx" ON "ai_feedback"("org_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "ai_feedback_run_id_idx" ON "ai_feedback"("run_id");

-- CreateIndex
CREATE INDEX "ai_learning_candidates_org_id_status_created_at_idx" ON "ai_learning_candidates"("org_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ai_learning_candidates_run_id_idx" ON "ai_learning_candidates"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_approved_examples_candidate_id_key" ON "ai_approved_examples"("candidate_id");

-- CreateIndex
CREATE INDEX "ai_approved_examples_org_id_purpose_created_at_idx" ON "ai_approved_examples"("org_id", "purpose", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_blocked_examples_candidate_id_key" ON "ai_blocked_examples"("candidate_id");

-- CreateIndex
CREATE INDEX "ai_blocked_examples_org_id_reason_code_created_at_idx" ON "ai_blocked_examples"("org_id", "reason_code", "created_at");

-- CreateIndex
CREATE INDEX "ai_actions_org_id_type_status_created_at_idx" ON "ai_actions"("org_id", "type", "status", "created_at");

-- CreateIndex
CREATE INDEX "ai_actions_run_id_idx" ON "ai_actions"("run_id");

-- CreateIndex
CREATE INDEX "ai_handoffs_org_id_status_created_at_idx" ON "ai_handoffs"("org_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ai_handoffs_conversation_id_status_idx" ON "ai_handoffs"("conversation_id", "status");

-- CreateIndex
CREATE INDEX "ai_handoffs_assigned_to_user_id_status_idx" ON "ai_handoffs"("assigned_to_user_id", "status");

-- CreateIndex
CREATE INDEX "ai_evaluation_cases_org_id_task_type_status_deleted_at_idx" ON "ai_evaluation_cases"("org_id", "task_type", "status", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_evaluation_cases_org_id_key_key" ON "ai_evaluation_cases"("org_id", "key");

-- CreateIndex
CREATE INDEX "ai_evaluation_runs_org_id_status_created_at_idx" ON "ai_evaluation_runs"("org_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ai_evaluation_results_org_id_status_idx" ON "ai_evaluation_results"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_evaluation_results_evaluation_run_id_evaluation_case_id_key" ON "ai_evaluation_results"("evaluation_run_id", "evaluation_case_id");

-- CreateIndex
CREATE INDEX "ai_audit_logs_org_id_event_type_created_at_idx" ON "ai_audit_logs"("org_id", "event_type", "created_at");

-- CreateIndex
CREATE INDEX "ai_audit_logs_run_id_idx" ON "ai_audit_logs"("run_id");

-- CreateIndex
CREATE INDEX "ai_audit_logs_target_type_target_id_idx" ON "ai_audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "ai_usage_records_org_id_created_at_idx" ON "ai_usage_records"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_records_org_id_provider_model_created_at_idx" ON "ai_usage_records"("org_id", "provider", "model", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_records_run_id_idx" ON "ai_usage_records"("run_id");

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "ai_personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_model_config_id_fkey" FOREIGN KEY ("model_config_id") REFERENCES "ai_model_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_personas" ADD CONSTRAINT "ai_personas_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_personas" ADD CONSTRAINT "ai_personas_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_skills" ADD CONSTRAINT "ai_skills_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_skills" ADD CONSTRAINT "ai_skills_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_skills" ADD CONSTRAINT "ai_agent_skills_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_skills" ADD CONSTRAINT "ai_agent_skills_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_skills" ADD CONSTRAINT "ai_agent_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "ai_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompts" ADD CONSTRAINT "ai_prompts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "ai_prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_prompt_versions" ADD CONSTRAINT "ai_prompt_versions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_configs" ADD CONSTRAINT "ai_model_configs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_model_configs" ADD CONSTRAINT "ai_model_configs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_sources" ADD CONSTRAINT "ai_knowledge_sources_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_sources" ADD CONSTRAINT "ai_knowledge_sources_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_documents" ADD CONSTRAINT "ai_knowledge_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_documents" ADD CONSTRAINT "ai_knowledge_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "ai_knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_documents" ADD CONSTRAINT "ai_knowledge_documents_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_documents" ADD CONSTRAINT "ai_knowledge_documents_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_chunks" ADD CONSTRAINT "ai_knowledge_chunks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_chunks" ADD CONSTRAINT "ai_knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "ai_knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_trigger_message_id_fkey" FOREIGN KEY ("trigger_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_model_config_id_fkey" FOREIGN KEY ("model_config_id") REFERENCES "ai_model_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation_summaries" ADD CONSTRAINT "ai_conversation_summaries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation_summaries" ADD CONSTRAINT "ai_conversation_summaries_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation_summaries" ADD CONSTRAINT "ai_conversation_summaries_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversation_summaries" ADD CONSTRAINT "ai_conversation_summaries_source_through_message_id_fkey" FOREIGN KEY ("source_through_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_customer_memories" ADD CONSTRAINT "ai_customer_memories_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_customer_memories" ADD CONSTRAINT "ai_customer_memories_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_customer_memories" ADD CONSTRAINT "ai_customer_memories_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_customer_memories" ADD CONSTRAINT "ai_customer_memories_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_intent_analyses" ADD CONSTRAINT "ai_intent_analyses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_intent_analyses" ADD CONSTRAINT "ai_intent_analyses_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_intent_analyses" ADD CONSTRAINT "ai_intent_analyses_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_intent_analyses" ADD CONSTRAINT "ai_intent_analyses_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_intent_analyses" ADD CONSTRAINT "ai_intent_analyses_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_emotion_analyses" ADD CONSTRAINT "ai_emotion_analyses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_emotion_analyses" ADD CONSTRAINT "ai_emotion_analyses_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_emotion_analyses" ADD CONSTRAINT "ai_emotion_analyses_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_emotion_analyses" ADD CONSTRAINT "ai_emotion_analyses_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_emotion_analyses" ADD CONSTRAINT "ai_emotion_analyses_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_suggestions" ADD CONSTRAINT "ai_assistant_suggestions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_suggestions" ADD CONSTRAINT "ai_assistant_suggestions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_suggestions" ADD CONSTRAINT "ai_assistant_suggestions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_assistant_suggestions" ADD CONSTRAINT "ai_assistant_suggestions_trigger_message_id_fkey" FOREIGN KEY ("trigger_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_sent_messages" ADD CONSTRAINT "ai_sent_messages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_sent_messages" ADD CONSTRAINT "ai_sent_messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_sent_messages" ADD CONSTRAINT "ai_sent_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_sent_messages" ADD CONSTRAINT "ai_sent_messages_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_sent_messages" ADD CONSTRAINT "ai_sent_messages_suggestion_id_fkey" FOREIGN KEY ("suggestion_id") REFERENCES "ai_assistant_suggestions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_sent_messages" ADD CONSTRAINT "ai_sent_messages_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "ai_actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_suggestion_id_fkey" FOREIGN KEY ("suggestion_id") REFERENCES "ai_assistant_suggestions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_sent_message_id_fkey" FOREIGN KEY ("sent_message_id") REFERENCES "ai_sent_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "ai_actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_learning_candidates" ADD CONSTRAINT "ai_learning_candidates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_learning_candidates" ADD CONSTRAINT "ai_learning_candidates_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_learning_candidates" ADD CONSTRAINT "ai_learning_candidates_suggestion_id_fkey" FOREIGN KEY ("suggestion_id") REFERENCES "ai_assistant_suggestions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_learning_candidates" ADD CONSTRAINT "ai_learning_candidates_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "ai_feedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approved_examples" ADD CONSTRAINT "ai_approved_examples_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approved_examples" ADD CONSTRAINT "ai_approved_examples_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "ai_learning_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_approved_examples" ADD CONSTRAINT "ai_approved_examples_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_blocked_examples" ADD CONSTRAINT "ai_blocked_examples_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_blocked_examples" ADD CONSTRAINT "ai_blocked_examples_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "ai_learning_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_blocked_examples" ADD CONSTRAINT "ai_blocked_examples_blocked_by_user_id_fkey" FOREIGN KEY ("blocked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_suggestion_id_fkey" FOREIGN KEY ("suggestion_id") REFERENCES "ai_assistant_suggestions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_handoffs" ADD CONSTRAINT "ai_handoffs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_handoffs" ADD CONSTRAINT "ai_handoffs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_handoffs" ADD CONSTRAINT "ai_handoffs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_handoffs" ADD CONSTRAINT "ai_handoffs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_handoffs" ADD CONSTRAINT "ai_handoffs_suggestion_id_fkey" FOREIGN KEY ("suggestion_id") REFERENCES "ai_assistant_suggestions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_handoffs" ADD CONSTRAINT "ai_handoffs_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "ai_actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_handoffs" ADD CONSTRAINT "ai_handoffs_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_cases" ADD CONSTRAINT "ai_evaluation_cases_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_cases" ADD CONSTRAINT "ai_evaluation_cases_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_cases" ADD CONSTRAINT "ai_evaluation_cases_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_runs" ADD CONSTRAINT "ai_evaluation_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_runs" ADD CONSTRAINT "ai_evaluation_runs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_runs" ADD CONSTRAINT "ai_evaluation_runs_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_runs" ADD CONSTRAINT "ai_evaluation_runs_model_config_id_fkey" FOREIGN KEY ("model_config_id") REFERENCES "ai_model_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_runs" ADD CONSTRAINT "ai_evaluation_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_results" ADD CONSTRAINT "ai_evaluation_results_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_results" ADD CONSTRAINT "ai_evaluation_results_evaluation_run_id_fkey" FOREIGN KEY ("evaluation_run_id") REFERENCES "ai_evaluation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_results" ADD CONSTRAINT "ai_evaluation_results_evaluation_case_id_fkey" FOREIGN KEY ("evaluation_case_id") REFERENCES "ai_evaluation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_evaluation_results" ADD CONSTRAINT "ai_evaluation_results_ai_run_id_fkey" FOREIGN KEY ("ai_run_id") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_audit_logs" ADD CONSTRAINT "ai_audit_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_audit_logs" ADD CONSTRAINT "ai_audit_logs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_audit_logs" ADD CONSTRAINT "ai_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_audit_logs" ADD CONSTRAINT "ai_audit_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
