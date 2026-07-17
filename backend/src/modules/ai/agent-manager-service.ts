import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { AI_CAPABILITIES, type AiCapability } from './ai-capabilities.js';

export const AGENT_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'active',
  'inactive',
  'archived',
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_AUTO_REPLY_MODES = ['disabled', 'shadow', 'suggested'] as const;
export type AgentAutoReplyMode = (typeof AGENT_AUTO_REPLY_MODES)[number];

export type AgentActor = { orgId: string; userId: string };
export type AgentPolicy = {
  requireHumanReview: boolean;
  requireCitations: boolean;
  confidenceThreshold: number;
  maxReplyLength: number;
  handoffOnRisk: Array<'medium' | 'high' | 'critical'>;
};

export type AgentInput = {
  key?: string;
  name?: string;
  personaId?: string | null;
  promptVersionId?: string | null;
  modelConfigId?: string | null;
  skillIds?: string[];
  capabilities?: string[];
  policy?: unknown;
  autoReplyMode?: string;
};

export class AgentManagerError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'AGENT_MANAGER_ERROR',
  ) {
    super(message);
    this.name = 'AgentManagerError';
  }
}

type Db = any;
type JsonObject = Record<string, unknown>;
const MUTATION_EVENTS = ['agent.created', 'agent.updated'] as const;
const DEFAULT_CAPABILITIES: AiCapability[] = ['read_conversation', 'generate_reply', 'create_suggestion'];
const DEFAULT_POLICY: AgentPolicy = {
  requireHumanReview: true,
  requireCitations: true,
  confidenceThreshold: 0.75,
  maxReplyLength: 900,
  handoffOnRisk: ['high', 'critical'],
};

const SAFE_AGENT_INCLUDE = {
  persona: { select: { id: true, name: true } },
  promptVersion: {
    select: {
      id: true,
      version: true,
      status: true,
      prompt: { select: { id: true, key: true, name: true, taskType: true } },
    },
  },
  modelConfig: { select: { id: true, name: true, provider: true, model: true, status: true } },
  createdBy: { select: { id: true, fullName: true } },
  skills: {
    where: { isEnabled: true },
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      isEnabled: true,
      skill: { select: { id: true, key: true, name: true, riskTier: true, deletedAt: true } },
    },
  },
} as const;

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function safeAuditNote(value: unknown, maxLength = 500): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value
    .trim()
    .slice(0, maxLength)
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[redacted-email]')
    .replace(/(?:\+?84|0)(?:[ .-]?\d){8,10}/g, '[redacted-phone]')
    .replace(/\b(otp|password|token|api[_ -]?key|secret)\s*[:=]\s*\S+/gi, '$1=[redacted]');
}

function cleanOptionalId(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > 100) {
    throw new AgentManagerError(`${label} is invalid`, 400, 'AGENT_REFERENCE_INVALID');
  }
  return value.trim();
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AgentManagerError('Agent name is required', 400, 'AGENT_NAME_REQUIRED');
  }
  const name = value.trim();
  if (name.length > 160) throw new AgentManagerError('Agent name is too long', 400, 'AGENT_NAME_INVALID');
  return name;
}

function cleanKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_.-]{2,79}$/.test(value.trim())) {
    throw new AgentManagerError('Agent key is invalid', 400, 'AGENT_KEY_INVALID');
  }
  return value.trim();
}

export function normalizeAgentCapabilities(value: unknown): AiCapability[] {
  if (value === undefined) return [...DEFAULT_CAPABILITIES];
  if (!Array.isArray(value)) {
    throw new AgentManagerError('capabilities must be an array', 400, 'AGENT_CAPABILITIES_INVALID');
  }
  const capabilities = [...new Set(value.map((item) => typeof item === 'string' ? item.trim() : ''))]
    .filter(Boolean);
  if (capabilities.length > Object.keys(AI_CAPABILITIES).length) {
    throw new AgentManagerError('Too many capabilities', 400, 'AGENT_CAPABILITIES_INVALID');
  }
  for (const capability of capabilities) {
    if (!(capability in AI_CAPABILITIES)) {
      throw new AgentManagerError(
        `Capability ${capability} is not allowed`,
        400,
        'AGENT_CAPABILITY_DENIED',
      );
    }
  }
  return capabilities as AiCapability[];
}

export function normalizeAgentPolicy(value: unknown): AgentPolicy {
  if (value === undefined) return { ...DEFAULT_POLICY, handoffOnRisk: [...DEFAULT_POLICY.handoffOnRisk] };
  const input = objectValue(value);
  const allowed = new Set(Object.keys(DEFAULT_POLICY));
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new AgentManagerError(
      `Policy field ${unknown[0]} is not allowed`,
      400,
      'AGENT_POLICY_FIELD_DENIED',
    );
  }
  const confidence = input.confidenceThreshold ?? DEFAULT_POLICY.confidenceThreshold;
  const maxReplyLength = input.maxReplyLength ?? DEFAULT_POLICY.maxReplyLength;
  const risks = input.handoffOnRisk ?? DEFAULT_POLICY.handoffOnRisk;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new AgentManagerError('confidenceThreshold must be between 0 and 1', 400, 'AGENT_POLICY_INVALID');
  }
  if (typeof maxReplyLength !== 'number' || !Number.isInteger(maxReplyLength) || maxReplyLength < 100 || maxReplyLength > 2_000) {
    throw new AgentManagerError('maxReplyLength must be between 100 and 2000', 400, 'AGENT_POLICY_INVALID');
  }
  if (!Array.isArray(risks) || risks.some((risk) => !['medium', 'high', 'critical'].includes(String(risk)))) {
    throw new AgentManagerError('handoffOnRisk is invalid', 400, 'AGENT_POLICY_INVALID');
  }
  if (input.requireHumanReview !== undefined && typeof input.requireHumanReview !== 'boolean') {
    throw new AgentManagerError('requireHumanReview must be boolean', 400, 'AGENT_POLICY_INVALID');
  }
  if (input.requireCitations !== undefined && typeof input.requireCitations !== 'boolean') {
    throw new AgentManagerError('requireCitations must be boolean', 400, 'AGENT_POLICY_INVALID');
  }
  return {
    requireHumanReview: typeof input.requireHumanReview === 'boolean'
      ? input.requireHumanReview
      : DEFAULT_POLICY.requireHumanReview,
    requireCitations: typeof input.requireCitations === 'boolean'
      ? input.requireCitations
      : DEFAULT_POLICY.requireCitations,
    confidenceThreshold: confidence,
    maxReplyLength,
    handoffOnRisk: [...new Set(risks.map(String))] as AgentPolicy['handoffOnRisk'],
  };
}

function safeStoredPolicy(value: unknown): AgentPolicy {
  const input = objectValue(value);
  const safeInput: JsonObject = {};
  if (typeof input.requireHumanReview === 'boolean') safeInput.requireHumanReview = input.requireHumanReview;
  if (typeof input.requireCitations === 'boolean') safeInput.requireCitations = input.requireCitations;
  if (typeof input.confidenceThreshold === 'number') safeInput.confidenceThreshold = input.confidenceThreshold;
  if (typeof input.maxReplyLength === 'number') safeInput.maxReplyLength = input.maxReplyLength;
  if (Array.isArray(input.handoffOnRisk)) safeInput.handoffOnRisk = input.handoffOnRisk;
  try {
    return normalizeAgentPolicy(safeInput);
  } catch {
    return { ...DEFAULT_POLICY, handoffOnRisk: [...DEFAULT_POLICY.handoffOnRisk] };
  }
}

function normalizeAutoReplyMode(value: unknown): AgentAutoReplyMode {
  const mode = value ?? 'disabled';
  if (typeof mode !== 'string' || !AGENT_AUTO_REPLY_MODES.includes(mode as AgentAutoReplyMode)) {
    throw new AgentManagerError(
      'autoReplyMode only supports disabled, shadow or suggested',
      400,
      'AGENT_FULL_AUTO_FORBIDDEN',
    );
  }
  return mode as AgentAutoReplyMode;
}

function normalizeSkillIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new AgentManagerError('skillIds must be an array', 400, 'AGENT_SKILLS_INVALID');
  const ids = [...new Set(value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean))];
  if (ids.length > 50) throw new AgentManagerError('Too many skills', 400, 'AGENT_SKILLS_INVALID');
  return ids;
}

async function validateReferences(orgId: string, refs: {
  personaId: string | null;
  promptVersionId: string | null;
  modelConfigId: string | null;
  skillIds: string[];
}) {
  const [persona, promptVersion, modelConfig, skills] = await Promise.all([
    refs.personaId ? prisma.aiPersona.findFirst({
      where: { id: refs.personaId, orgId, deletedAt: null },
      select: { id: true },
    }) : null,
    refs.promptVersionId ? prisma.aiPromptVersion.findFirst({
      where: { id: refs.promptVersionId, orgId, prompt: { deletedAt: null } },
      select: { id: true, status: true },
    }) : null,
    refs.modelConfigId ? prisma.aiModelConfig.findFirst({
      where: { id: refs.modelConfigId, orgId, deletedAt: null },
      select: { id: true, status: true },
    }) : null,
    refs.skillIds.length ? prisma.aiSkill.findMany({
      where: { id: { in: refs.skillIds }, orgId, deletedAt: null },
      select: { id: true },
    }) : [],
  ]);
  if (refs.personaId && !persona) throw new AgentManagerError('Persona not found in this organization', 404, 'AGENT_PERSONA_NOT_FOUND');
  if (refs.promptVersionId && !promptVersion) throw new AgentManagerError('Prompt version not found in this organization', 404, 'AGENT_PROMPT_NOT_FOUND');
  if (refs.modelConfigId && !modelConfig) throw new AgentManagerError('Model config not found in this organization', 404, 'AGENT_MODEL_NOT_FOUND');
  if (skills.length !== refs.skillIds.length) throw new AgentManagerError('One or more skills were not found in this organization', 404, 'AGENT_SKILL_NOT_FOUND');
  return { promptVersion, modelConfig };
}

async function audit(
  db: Db,
  actor: AgentActor,
  eventType: string,
  agentId: string,
  outcome: string,
  metadata: JsonObject,
) {
  await db.aiAuditLog.create({
    data: {
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType,
      outcome,
      targetType: 'ai_agent',
      targetId: agentId,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

async function latestMutationMap(orgId: string, agentIds: string[]) {
  if (!agentIds.length) return new Map<string, { actorUserId: string | null; createdAt: Date }>();
  const rows = await prisma.aiAuditLog.findMany({
    where: {
      orgId,
      targetType: 'ai_agent',
      targetId: { in: agentIds },
      eventType: { in: [...MUTATION_EVENTS] },
    },
    orderBy: { createdAt: 'desc' },
    select: { targetId: true, actorUserId: true, createdAt: true },
  });
  const result = new Map<string, { actorUserId: string | null; createdAt: Date }>();
  for (const row of rows) {
    if (row.targetId && !result.has(row.targetId)) {
      result.set(row.targetId, { actorUserId: row.actorUserId, createdAt: row.createdAt });
    }
  }
  return result;
}

export type AgentEvaluationGate = {
  passed: boolean;
  runId: string | null;
  completedAt: Date | null;
  reason: 'passed' | 'evaluation_required' | 'evaluation_stale';
};

async function evaluationGateMap(orgId: string, agentIds: string[]) {
  const gates = new Map<string, AgentEvaluationGate>();
  if (!agentIds.length) return gates;
  const [runs, mutations] = await Promise.all([
    prisma.aiEvaluationRun.findMany({
      where: { orgId, status: 'completed' },
      orderBy: { completedAt: 'desc' },
      take: 500,
      select: { id: true, config: true, metrics: true, completedAt: true },
    }),
    latestMutationMap(orgId, agentIds),
  ]);
  const requested = new Set(agentIds);
  for (const run of runs) {
    const config = objectValue(run.config);
    const metrics = objectValue(run.metrics);
    const targetId = typeof config.targetId === 'string' ? config.targetId : '';
    if (config.targetType !== 'agent' || !requested.has(targetId) || metrics.passed !== true || !run.completedAt) continue;
    if (gates.has(targetId)) continue;
    const mutation = mutations.get(targetId);
    const stale = Boolean(mutation && run.completedAt.getTime() < mutation.createdAt.getTime());
    gates.set(targetId, {
      passed: !stale,
      runId: run.id,
      completedAt: run.completedAt,
      reason: stale ? 'evaluation_stale' : 'passed',
    });
  }
  for (const agentId of agentIds) {
    if (!gates.has(agentId)) gates.set(agentId, { passed: false, runId: null, completedAt: null, reason: 'evaluation_required' });
  }
  return gates;
}

function agentDto(agent: any, gate?: AgentEvaluationGate) {
  const capabilities = Array.isArray(agent.capabilities)
    ? [...new Set(agent.capabilities.filter(
      (item: unknown): item is AiCapability => typeof item === 'string' && item in AI_CAPABILITIES,
    ))]
    : [];
  const autoReplyMode = AGENT_AUTO_REPLY_MODES.includes(agent.autoReplyMode as AgentAutoReplyMode)
    ? agent.autoReplyMode as AgentAutoReplyMode
    : 'disabled';
  return {
    id: agent.id,
    key: agent.key,
    name: agent.name,
    status: agent.status,
    personaId: agent.personaId,
    promptVersionId: agent.promptVersionId,
    modelConfigId: agent.modelConfigId,
    capabilities,
    policy: safeStoredPolicy(agent.policy),
    autoReplyMode,
    createdByUserId: agent.createdByUserId,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    persona: agent.persona ? { id: agent.persona.id, name: agent.persona.name } : null,
    promptVersion: agent.promptVersion ? {
      id: agent.promptVersion.id,
      version: agent.promptVersion.version,
      status: agent.promptVersion.status,
      prompt: agent.promptVersion.prompt ? {
        id: agent.promptVersion.prompt.id,
        key: agent.promptVersion.prompt.key,
        name: agent.promptVersion.prompt.name,
        taskType: agent.promptVersion.prompt.taskType,
      } : null,
    } : null,
    modelConfig: agent.modelConfig ? {
      id: agent.modelConfig.id,
      name: agent.modelConfig.name,
      provider: agent.modelConfig.provider,
      model: agent.modelConfig.model,
      status: agent.modelConfig.status,
    } : null,
    createdBy: agent.createdBy ? { id: agent.createdBy.id, fullName: agent.createdBy.fullName } : null,
    skills: (agent.skills ?? [])
      .filter((link: any) => link.skill && !link.skill.deletedAt)
      .map((link: any) => ({
        id: link.skill.id,
        key: link.skill.key,
        name: link.skill.name,
        riskTier: link.skill.riskTier,
      })),
    evaluationGate: gate ?? { passed: false, runId: null, completedAt: null, reason: 'evaluation_required' },
  };
}

async function getAgentRow(orgId: string, agentId: string) {
  const agent = await prisma.aiAgent.findFirst({
    where: { id: agentId, orgId, deletedAt: null },
    include: SAFE_AGENT_INCLUDE,
  });
  if (!agent) throw new AgentManagerError('Agent not found', 404, 'AGENT_NOT_FOUND');
  return agent;
}

export async function listAgents(orgId: string, options: { status?: string } = {}) {
  const agents = await prisma.aiAgent.findMany({
    where: {
      orgId,
      deletedAt: null,
      ...(AGENT_STATUSES.includes(options.status as AgentStatus) && options.status !== 'archived'
        ? { status: options.status }
        : {}),
    },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: SAFE_AGENT_INCLUDE,
  });
  const gates = await evaluationGateMap(orgId, agents.map((agent) => agent.id));
  return agents.map((agent) => agentDto(agent, gates.get(agent.id)));
}

export async function getAgentDetail(orgId: string, agentId: string) {
  const agent = await getAgentRow(orgId, agentId);
  const gates = await evaluationGateMap(orgId, [agent.id]);
  return agentDto(agent, gates.get(agent.id));
}

export async function listAgentReferences(orgId: string) {
  const [personas, promptVersions, modelConfigs, skills] = await Promise.all([
    prisma.aiPersona.findMany({
      where: { orgId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.aiPromptVersion.findMany({
      where: { orgId, prompt: { deletedAt: null }, status: { not: 'archived' } },
      orderBy: [{ prompt: { name: 'asc' } }, { version: 'desc' }],
      select: {
        id: true,
        version: true,
        status: true,
        prompt: { select: { id: true, key: true, name: true, taskType: true } },
      },
    }),
    prisma.aiModelConfig.findMany({
      where: { orgId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, provider: true, model: true, status: true },
    }),
    prisma.aiSkill.findMany({
      where: { orgId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, key: true, name: true, riskTier: true },
    }),
  ]);
  return { personas, promptVersions, modelConfigs, skills, capabilities: Object.keys(AI_CAPABILITIES) as AiCapability[] };
}

export async function createAgent(actor: AgentActor, input: AgentInput) {
  const key = cleanKey(input.key);
  const name = cleanName(input.name);
  const refs = {
    personaId: cleanOptionalId(input.personaId, 'personaId'),
    promptVersionId: cleanOptionalId(input.promptVersionId, 'promptVersionId'),
    modelConfigId: cleanOptionalId(input.modelConfigId, 'modelConfigId'),
    skillIds: normalizeSkillIds(input.skillIds),
  };
  const capabilities = normalizeAgentCapabilities(input.capabilities);
  const policy = normalizeAgentPolicy(input.policy);
  const autoReplyMode = normalizeAutoReplyMode(input.autoReplyMode);
  await validateReferences(actor.orgId, refs);

  const duplicate = await prisma.aiAgent.findFirst({ where: { orgId: actor.orgId, key }, select: { id: true } });
  if (duplicate) throw new AgentManagerError('Agent key already exists', 409, 'AGENT_KEY_EXISTS');

  return prisma.$transaction(async (tx) => {
    const agent = await tx.aiAgent.create({
      data: {
        orgId: actor.orgId,
        key,
        name,
        status: 'draft',
        personaId: refs.personaId,
        promptVersionId: refs.promptVersionId,
        modelConfigId: refs.modelConfigId,
        capabilities: capabilities as Prisma.InputJsonValue,
        policy: policy as Prisma.InputJsonValue,
        autoReplyMode,
        createdByUserId: actor.userId,
      },
      select: { id: true, key: true, status: true },
    });
    if (refs.skillIds.length) {
      await tx.aiAgentSkill.createMany({
        data: refs.skillIds.map((skillId) => ({ orgId: actor.orgId, agentId: agent.id, skillId, isEnabled: true })),
      });
    }
    await audit(tx, actor, 'agent.created', agent.id, 'success', {
      key,
      personaId: refs.personaId,
      promptVersionId: refs.promptVersionId,
      modelConfigId: refs.modelConfigId,
      skillIds: refs.skillIds,
      capabilities,
      autoReplyMode,
    });
    return agent;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateAgent(actor: AgentActor, agentId: string, input: AgentInput) {
  const current = await prisma.aiAgent.findFirst({
    where: { id: agentId, orgId: actor.orgId, deletedAt: null },
    select: {
      id: true, name: true, status: true, personaId: true, promptVersionId: true, modelConfigId: true,
      capabilities: true, policy: true, autoReplyMode: true,
      skills: { where: { isEnabled: true }, select: { skillId: true } },
    },
  });
  if (!current) throw new AgentManagerError('Agent not found', 404, 'AGENT_NOT_FOUND');
  if (current.status === 'active') throw new AgentManagerError('Deactivate the agent before editing', 409, 'AGENT_ACTIVE_EDIT_FORBIDDEN');
  if (current.status === 'pending_approval') throw new AgentManagerError('Agent awaiting approval cannot be edited', 409, 'AGENT_PENDING_EDIT_FORBIDDEN');

  const refs = {
    personaId: input.personaId !== undefined ? cleanOptionalId(input.personaId, 'personaId') : current.personaId,
    promptVersionId: input.promptVersionId !== undefined ? cleanOptionalId(input.promptVersionId, 'promptVersionId') : current.promptVersionId,
    modelConfigId: input.modelConfigId !== undefined ? cleanOptionalId(input.modelConfigId, 'modelConfigId') : current.modelConfigId,
    skillIds: input.skillIds !== undefined ? normalizeSkillIds(input.skillIds) : current.skills.map((item) => item.skillId),
  };
  const name = input.name !== undefined ? cleanName(input.name) : current.name;
  const capabilities = input.capabilities !== undefined ? normalizeAgentCapabilities(input.capabilities) : normalizeAgentCapabilities(current.capabilities);
  const policy = input.policy !== undefined ? normalizeAgentPolicy(input.policy) : normalizeAgentPolicy(current.policy);
  const autoReplyMode = input.autoReplyMode !== undefined ? normalizeAutoReplyMode(input.autoReplyMode) : normalizeAutoReplyMode(current.autoReplyMode);
  await validateReferences(actor.orgId, refs);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.aiAgent.updateMany({
      where: { id: agentId, orgId: actor.orgId, deletedAt: null, status: current.status },
      data: {
        name,
        status: 'draft',
        personaId: refs.personaId,
        promptVersionId: refs.promptVersionId,
        modelConfigId: refs.modelConfigId,
        capabilities: capabilities as Prisma.InputJsonValue,
        policy: policy as Prisma.InputJsonValue,
        autoReplyMode,
      },
    });
    if (updated.count !== 1) throw new AgentManagerError('Agent changed concurrently', 409, 'AGENT_CONFLICT');
    if (input.skillIds !== undefined) {
      await tx.aiAgentSkill.deleteMany({ where: { agentId } });
      if (refs.skillIds.length) {
        await tx.aiAgentSkill.createMany({
          data: refs.skillIds.map((skillId) => ({ orgId: actor.orgId, agentId, skillId, isEnabled: true })),
        });
      }
    }
    await audit(tx, actor, 'agent.updated', agentId, 'success', {
      statusResetTo: 'draft',
      personaId: refs.personaId,
      promptVersionId: refs.promptVersionId,
      modelConfigId: refs.modelConfigId,
      skillIds: refs.skillIds,
      capabilities,
      autoReplyMode,
    });
    return { id: agentId, status: 'draft' as const };
  });
}

export async function submitAgentForApproval(actor: AgentActor, agentId: string) {
  const agent = await prisma.aiAgent.findFirst({
    where: { id: agentId, orgId: actor.orgId, deletedAt: null },
    select: {
      id: true, status: true, promptVersionId: true, modelConfigId: true,
      skills: { where: { isEnabled: true }, select: { id: true } },
    },
  });
  if (!agent) throw new AgentManagerError('Agent not found', 404, 'AGENT_NOT_FOUND');
  if (agent.status !== 'draft') throw new AgentManagerError('Only a Draft agent can be submitted', 409, 'AGENT_INVALID_TRANSITION');
  if (!agent.promptVersionId || !agent.modelConfigId || !agent.skills.length) {
    throw new AgentManagerError('Prompt, model and at least one skill are required', 409, 'AGENT_INCOMPLETE');
  }
  return prisma.$transaction(async (tx) => {
    const changed = await tx.aiAgent.updateMany({
      where: { id: agentId, orgId: actor.orgId, status: 'draft', deletedAt: null },
      data: { status: 'pending_approval' },
    });
    if (changed.count !== 1) throw new AgentManagerError('Agent changed concurrently', 409, 'AGENT_CONFLICT');
    await audit(tx, actor, 'agent.submitted', agentId, 'pending_approval', {});
    return { id: agentId, status: 'pending_approval' as const };
  });
}

export async function approveAgent(actor: AgentActor, agentId: string, note?: string) {
  return prisma.$transaction(async (tx) => {
    const agent = await tx.aiAgent.findFirst({
      where: { id: agentId, orgId: actor.orgId, deletedAt: null },
      select: { id: true, status: true, createdByUserId: true },
    });
    if (!agent) throw new AgentManagerError('Agent not found', 404, 'AGENT_NOT_FOUND');
    if (agent.status !== 'pending_approval') throw new AgentManagerError('Agent is not awaiting approval', 409, 'AGENT_INVALID_TRANSITION');
    const mutation = await tx.aiAuditLog.findFirst({
      where: {
        orgId: actor.orgId,
        targetType: 'ai_agent',
        targetId: agentId,
        eventType: { in: [...MUTATION_EVENTS] },
      },
      orderBy: { createdAt: 'desc' },
      select: { actorUserId: true },
    });
    const makerId = mutation?.actorUserId ?? agent.createdByUserId;
    if (!makerId) throw new AgentManagerError('Cannot determine the latest configuration author', 409, 'AGENT_MAKER_UNKNOWN');
    if (makerId === actor.userId) {
      throw new AgentManagerError('The latest configuration author cannot approve this agent', 409, 'AGENT_MAKER_CHECKER_REQUIRED');
    }
    const changed = await tx.aiAgent.updateMany({
      where: { id: agentId, orgId: actor.orgId, status: 'pending_approval', deletedAt: null },
      data: { status: 'approved' },
    });
    if (changed.count !== 1) throw new AgentManagerError('Agent changed concurrently', 409, 'AGENT_CONFLICT');
    await audit(tx, actor, 'agent.approved', agentId, 'approved', {
      makerUserId: makerId,
      note: safeAuditNote(note),
    });
    return { id: agentId, status: 'approved' as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function assertActivationReferences(agent: any) {
  if (!agent.promptVersionId || agent.promptVersion?.status !== 'production') {
    throw new AgentManagerError('A Production prompt version is required', 409, 'AGENT_PROMPT_NOT_PRODUCTION');
  }
  if (!agent.modelConfigId || !['active', 'approved'].includes(agent.modelConfig?.status ?? '')) {
    throw new AgentManagerError('An active or approved model config is required', 409, 'AGENT_MODEL_NOT_ACTIVE');
  }
  if (!(agent.skills ?? []).some((link: any) => link.isEnabled && link.skill && !link.skill.deletedAt)) {
    throw new AgentManagerError('At least one active skill is required', 409, 'AGENT_SKILL_REQUIRED');
  }
}

export async function activateAgent(actor: AgentActor, agentId: string) {
  const agent = await getAgentRow(actor.orgId, agentId);
  if (!['approved', 'inactive'].includes(agent.status)) {
    throw new AgentManagerError('Only Approved or Inactive agents can be activated', 409, 'AGENT_INVALID_TRANSITION');
  }
  await assertActivationReferences(agent);
  const gates = await evaluationGateMap(actor.orgId, [agentId]);
  const gate = gates.get(agentId)!;
  if (!gate.passed) {
    throw new AgentManagerError(
      gate.reason === 'evaluation_stale'
        ? 'The passing agent evaluation is older than the latest configuration change'
        : 'A passing evaluation targeting this agent is required',
      409,
      gate.reason === 'evaluation_stale' ? 'AGENT_EVALUATION_STALE' : 'AGENT_EVALUATION_REQUIRED',
    );
  }
  return prisma.$transaction(async (tx) => {
    const changed = await tx.aiAgent.updateMany({
      where: { id: agentId, orgId: actor.orgId, status: agent.status, deletedAt: null },
      data: { status: 'active' },
    });
    if (changed.count !== 1) throw new AgentManagerError('Agent changed concurrently', 409, 'AGENT_CONFLICT');
    await audit(tx, actor, 'agent.activated', agentId, 'active', { evaluationRunId: gate.runId });
    return { id: agentId, status: 'active' as const, evaluationGate: gate };
  });
}

export async function deactivateAgent(actor: AgentActor, agentId: string) {
  return prisma.$transaction(async (tx) => {
    const changed = await tx.aiAgent.updateMany({
      where: { id: agentId, orgId: actor.orgId, status: 'active', deletedAt: null },
      data: { status: 'inactive' },
    });
    if (changed.count !== 1) throw new AgentManagerError('Only an Active agent can be deactivated', 409, 'AGENT_INVALID_TRANSITION');
    await audit(tx, actor, 'agent.deactivated', agentId, 'inactive', {});
    return { id: agentId, status: 'inactive' as const };
  });
}

export async function archiveAgent(actor: AgentActor, agentId: string) {
  return prisma.$transaction(async (tx) => {
    const agent = await tx.aiAgent.findFirst({
      where: { id: agentId, orgId: actor.orgId, deletedAt: null },
      select: { id: true, key: true, status: true },
    });
    if (!agent) throw new AgentManagerError('Agent not found', 404, 'AGENT_NOT_FOUND');
    if (agent.status === 'active') throw new AgentManagerError('Deactivate the agent before archiving', 409, 'AGENT_ACTIVE_ARCHIVE_FORBIDDEN');
    await tx.aiAgent.update({ where: { id: agentId }, data: { status: 'archived', deletedAt: new Date() } });
    await tx.aiAgentSkill.updateMany({ where: { agentId }, data: { isEnabled: false } });
    await audit(tx, actor, 'agent.archived', agentId, 'archived', { key: agent.key, from: agent.status });
    return { id: agentId, archived: true };
  });
}

