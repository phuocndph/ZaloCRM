import { requireGrant } from '../rbac/rbac-middleware.js';

/** AI control-plane guards. Owner/admin fallback stays centralized in userHasGrant. */
export const aiPermissions = {
  overview: { access: requireGrant('ai', 'access') },
  model: {
    access: requireGrant('ai_model', 'access'),
    create: requireGrant('ai_model', 'create'),
    edit: requireGrant('ai_model', 'edit'),
    delete: requireGrant('ai_model', 'delete'),
    manageSecret: requireGrant('ai_model', 'manage_secret'),
    approve: requireGrant('ai_model', 'approve'),
  },
  agent: {
    access: requireGrant('ai_agent', 'access'),
    create: requireGrant('ai_agent', 'create'),
    edit: requireGrant('ai_agent', 'edit'),
    delete: requireGrant('ai_agent', 'delete'),
    approve: requireGrant('ai_agent', 'approve'),
  },
  skill: {
    access: requireGrant('ai_skill', 'access'),
    create: requireGrant('ai_skill', 'create'),
    edit: requireGrant('ai_skill', 'edit'),
    delete: requireGrant('ai_skill', 'delete'),
    approve: requireGrant('ai_skill', 'approve'),
  },
  prompt: {
    access: requireGrant('ai_prompt', 'access'),
    create: requireGrant('ai_prompt', 'create'),
    edit: requireGrant('ai_prompt', 'edit'),
    delete: requireGrant('ai_prompt', 'delete'),
    approve: requireGrant('ai_prompt', 'approve'),
    rollback: requireGrant('ai_prompt', 'rollback'),
  },
  knowledge: {
    access: requireGrant('ai_knowledge', 'access'),
    create: requireGrant('ai_knowledge', 'create'),
    edit: requireGrant('ai_knowledge', 'edit'),
    delete: requireGrant('ai_knowledge', 'delete'),
    approve: requireGrant('ai_knowledge', 'approve'),
  },
  feedback: {
    access: requireGrant('ai_feedback', 'access'),
    approve: requireGrant('ai_feedback', 'approve'),
    export: requireGrant('ai_feedback', 'export'),
  },
  learning: {
    access: requireGrant('ai_learning', 'access'),
    edit: requireGrant('ai_learning', 'edit'),
    approve: requireGrant('ai_learning', 'approve'),
  },
  evaluation: {
    access: requireGrant('ai_evaluation', 'access'),
    create: requireGrant('ai_evaluation', 'create'),
    approve: requireGrant('ai_evaluation', 'approve'),
  },
  autoReply: {
    access: requireGrant('ai_auto_reply', 'access'),
    edit: requireGrant('ai_auto_reply', 'edit'),
    approve: requireGrant('ai_auto_reply', 'approve'),
    emergencyStop: requireGrant('ai_auto_reply', 'emergency_stop'),
  },
  deployment: {
    access: requireGrant('ai_deployment', 'access'),
    create: requireGrant('ai_deployment', 'create'),
    approve: requireGrant('ai_deployment', 'approve'),
    deploy: requireGrant('ai_deployment', 'deploy'),
    rollback: requireGrant('ai_deployment', 'rollback'),
  },
  audit: {
    access: requireGrant('ai_audit', 'access'),
    viewAll: requireGrant('ai_audit', 'view_all'),
    export: requireGrant('ai_audit', 'export'),
  },
} as const;
