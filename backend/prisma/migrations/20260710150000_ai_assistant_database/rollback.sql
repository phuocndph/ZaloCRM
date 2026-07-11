-- DropForeignKey
ALTER TABLE "public"."ai_agents" DROP CONSTRAINT "ai_agents_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_agents" DROP CONSTRAINT "ai_agents_persona_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_agents" DROP CONSTRAINT "ai_agents_prompt_version_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_agents" DROP CONSTRAINT "ai_agents_model_config_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_agents" DROP CONSTRAINT "ai_agents_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_personas" DROP CONSTRAINT "ai_personas_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_personas" DROP CONSTRAINT "ai_personas_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_skills" DROP CONSTRAINT "ai_skills_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_skills" DROP CONSTRAINT "ai_skills_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_agent_skills" DROP CONSTRAINT "ai_agent_skills_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_agent_skills" DROP CONSTRAINT "ai_agent_skills_agent_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_agent_skills" DROP CONSTRAINT "ai_agent_skills_skill_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_prompts" DROP CONSTRAINT "ai_prompts_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_prompts" DROP CONSTRAINT "ai_prompts_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_prompt_versions" DROP CONSTRAINT "ai_prompt_versions_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_prompt_versions" DROP CONSTRAINT "ai_prompt_versions_prompt_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_prompt_versions" DROP CONSTRAINT "ai_prompt_versions_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_prompt_versions" DROP CONSTRAINT "ai_prompt_versions_approved_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_model_configs" DROP CONSTRAINT "ai_model_configs_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_model_configs" DROP CONSTRAINT "ai_model_configs_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_knowledge_sources" DROP CONSTRAINT "ai_knowledge_sources_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_knowledge_sources" DROP CONSTRAINT "ai_knowledge_sources_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_knowledge_documents" DROP CONSTRAINT "ai_knowledge_documents_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_knowledge_documents" DROP CONSTRAINT "ai_knowledge_documents_source_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_knowledge_documents" DROP CONSTRAINT "ai_knowledge_documents_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_knowledge_documents" DROP CONSTRAINT "ai_knowledge_documents_approved_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_knowledge_chunks" DROP CONSTRAINT "ai_knowledge_chunks_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_knowledge_chunks" DROP CONSTRAINT "ai_knowledge_chunks_document_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_runs" DROP CONSTRAINT "ai_runs_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_runs" DROP CONSTRAINT "ai_runs_agent_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_runs" DROP CONSTRAINT "ai_runs_requested_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_runs" DROP CONSTRAINT "ai_runs_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_runs" DROP CONSTRAINT "ai_runs_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_runs" DROP CONSTRAINT "ai_runs_trigger_message_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_runs" DROP CONSTRAINT "ai_runs_prompt_version_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_runs" DROP CONSTRAINT "ai_runs_model_config_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_conversation_summaries" DROP CONSTRAINT "ai_conversation_summaries_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_conversation_summaries" DROP CONSTRAINT "ai_conversation_summaries_run_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_conversation_summaries" DROP CONSTRAINT "ai_conversation_summaries_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_conversation_summaries" DROP CONSTRAINT "ai_conversation_summaries_source_through_message_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_customer_memories" DROP CONSTRAINT "ai_customer_memories_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_customer_memories" DROP CONSTRAINT "ai_customer_memories_run_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_customer_memories" DROP CONSTRAINT "ai_customer_memories_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_customer_memories" DROP CONSTRAINT "ai_customer_memories_approved_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_intent_analyses" DROP CONSTRAINT "ai_intent_analyses_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_intent_analyses" DROP CONSTRAINT "ai_intent_analyses_run_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_intent_analyses" DROP CONSTRAINT "ai_intent_analyses_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_intent_analyses" DROP CONSTRAINT "ai_intent_analyses_message_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_intent_analyses" DROP CONSTRAINT "ai_intent_analyses_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_emotion_analyses" DROP CONSTRAINT "ai_emotion_analyses_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_emotion_analyses" DROP CONSTRAINT "ai_emotion_analyses_run_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_emotion_analyses" DROP CONSTRAINT "ai_emotion_analyses_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_emotion_analyses" DROP CONSTRAINT "ai_emotion_analyses_message_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_emotion_analyses" DROP CONSTRAINT "ai_emotion_analyses_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_assistant_suggestions" DROP CONSTRAINT "ai_assistant_suggestions_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_assistant_suggestions" DROP CONSTRAINT "ai_assistant_suggestions_run_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_assistant_suggestions" DROP CONSTRAINT "ai_assistant_suggestions_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_assistant_suggestions" DROP CONSTRAINT "ai_assistant_suggestions_trigger_message_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_sent_messages" DROP CONSTRAINT "ai_sent_messages_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_sent_messages" DROP CONSTRAINT "ai_sent_messages_run_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_sent_messages" DROP CONSTRAINT "ai_sent_messages_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_sent_messages" DROP CONSTRAINT "ai_sent_messages_message_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_sent_messages" DROP CONSTRAINT "ai_sent_messages_suggestion_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_sent_messages" DROP CONSTRAINT "ai_sent_messages_action_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_feedback" DROP CONSTRAINT "ai_feedback_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_feedback" DROP CONSTRAINT "ai_feedback_run_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_feedback" DROP CONSTRAINT "ai_feedback_suggestion_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_feedback" DROP CONSTRAINT "ai_feedback_sent_message_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_feedback" DROP CONSTRAINT "ai_feedback_action_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_feedback" DROP CONSTRAINT "ai_feedback_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_learning_candidates" DROP CONSTRAINT "ai_learning_candidates_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_learning_candidates" DROP CONSTRAINT "ai_learning_candidates_run_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_learning_candidates" DROP CONSTRAINT "ai_learning_candidates_suggestion_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_learning_candidates" DROP CONSTRAINT "ai_learning_candidates_feedback_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_approved_examples" DROP CONSTRAINT "ai_approved_examples_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_approved_examples" DROP CONSTRAINT "ai_approved_examples_candidate_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_approved_examples" DROP CONSTRAINT "ai_approved_examples_approved_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_blocked_examples" DROP CONSTRAINT "ai_blocked_examples_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_blocked_examples" DROP CONSTRAINT "ai_blocked_examples_candidate_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_blocked_examples" DROP CONSTRAINT "ai_blocked_examples_blocked_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_actions" DROP CONSTRAINT "ai_actions_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_actions" DROP CONSTRAINT "ai_actions_run_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_actions" DROP CONSTRAINT "ai_actions_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_actions" DROP CONSTRAINT "ai_actions_suggestion_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_actions" DROP CONSTRAINT "ai_actions_approved_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_handoffs" DROP CONSTRAINT "ai_handoffs_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_handoffs" DROP CONSTRAINT "ai_handoffs_run_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_handoffs" DROP CONSTRAINT "ai_handoffs_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_handoffs" DROP CONSTRAINT "ai_handoffs_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_handoffs" DROP CONSTRAINT "ai_handoffs_suggestion_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_handoffs" DROP CONSTRAINT "ai_handoffs_action_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_handoffs" DROP CONSTRAINT "ai_handoffs_assigned_to_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_evaluation_cases" DROP CONSTRAINT "ai_evaluation_cases_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_evaluation_cases" DROP CONSTRAINT "ai_evaluation_cases_prompt_version_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_evaluation_cases" DROP CONSTRAINT "ai_evaluation_cases_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_evaluation_runs" DROP CONSTRAINT "ai_evaluation_runs_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_evaluation_runs" DROP CONSTRAINT "ai_evaluation_runs_agent_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_evaluation_runs" DROP CONSTRAINT "ai_evaluation_runs_prompt_version_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_evaluation_runs" DROP CONSTRAINT "ai_evaluation_runs_model_config_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_evaluation_runs" DROP CONSTRAINT "ai_evaluation_runs_created_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_evaluation_results" DROP CONSTRAINT "ai_evaluation_results_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_evaluation_results" DROP CONSTRAINT "ai_evaluation_results_evaluation_run_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_evaluation_results" DROP CONSTRAINT "ai_evaluation_results_evaluation_case_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_evaluation_results" DROP CONSTRAINT "ai_evaluation_results_ai_run_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_audit_logs" DROP CONSTRAINT "ai_audit_logs_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_audit_logs" DROP CONSTRAINT "ai_audit_logs_run_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_audit_logs" DROP CONSTRAINT "ai_audit_logs_actor_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_audit_logs" DROP CONSTRAINT "ai_audit_logs_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_usage_records" DROP CONSTRAINT "ai_usage_records_org_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."ai_usage_records" DROP CONSTRAINT "ai_usage_records_run_id_fkey";

-- DropTable
DROP TABLE IF EXISTS "public"."ai_agents" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_personas" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_skills" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_agent_skills" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_prompts" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_prompt_versions" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_model_configs" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_knowledge_sources" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_knowledge_documents" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_knowledge_chunks" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_runs" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_conversation_summaries" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_customer_memories" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_intent_analyses" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_emotion_analyses" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_assistant_suggestions" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_sent_messages" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_feedback" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_learning_candidates" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_approved_examples" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_blocked_examples" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_actions" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_handoffs" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_evaluation_cases" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_evaluation_runs" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_evaluation_results" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_audit_logs" CASCADE;

-- DropTable
DROP TABLE IF EXISTS "public"."ai_usage_records" CASCADE;
