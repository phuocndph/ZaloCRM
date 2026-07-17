import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma: any = {
    aiAgent: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    aiAgentSkill: { createMany: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
    aiPersona: { findFirst: vi.fn(), findMany: vi.fn() },
    aiPromptVersion: { findFirst: vi.fn(), findMany: vi.fn() },
    aiModelConfig: { findFirst: vi.fn(), findMany: vi.fn() },
    aiSkill: { findMany: vi.fn() },
    aiAuditLog: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    aiEvaluationRun: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(prisma));
  return { prisma };
});

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));

import {
  activateAgent,
  approveAgent,
  createAgent,
  listAgents,
  normalizeAgentCapabilities,
  normalizeAgentPolicy,
} from '../../src/modules/ai/agent-manager-service.js';

const maker = { orgId: 'org-1', userId: 'maker-1' };
const checker = { orgId: 'org-1', userId: 'checker-1' };

function agentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    key: 'sales.helper',
    name: 'Sales Helper',
    status: 'approved',
    personaId: 'persona-1',
    promptVersionId: 'prompt-version-1',
    modelConfigId: 'model-1',
    capabilities: ['read_conversation', 'generate_reply'],
    policy: {
      requireHumanReview: true,
      requireCitations: true,
      confidenceThreshold: 0.8,
      maxReplyLength: 900,
      handoffOnRisk: ['high', 'critical'],
    },
    autoReplyMode: 'suggested',
    createdByUserId: 'maker-1',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    persona: { id: 'persona-1', name: 'Sales', contentEncrypted: 'must-not-leak' },
    promptVersion: {
      id: 'prompt-version-1',
      version: 2,
      status: 'production',
      contentEncrypted: 'must-not-leak',
      prompt: { id: 'prompt-1', key: 'sales', name: 'Sales', taskType: 'reply' },
    },
    modelConfig: {
      id: 'model-1',
      name: '9Router',
      provider: 'openai-compatible',
      model: 'model-a',
      status: 'active',
      credentialRef: 'secret-ref',
    },
    createdBy: { id: 'maker-1', fullName: 'Maker', passwordHash: 'must-not-leak' },
    skills: [{
      id: 'link-1',
      isEnabled: true,
      skill: { id: 'skill-1', key: 'draft_reply', name: 'Draft Reply', riskTier: 'low', deletedAt: null },
    }],
    ...overrides,
  };
}

describe('agent manager service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(mocks.prisma));
    mocks.prisma.aiAuditLog.create.mockResolvedValue({});
    mocks.prisma.aiAuditLog.findMany.mockResolvedValue([]);
    mocks.prisma.aiEvaluationRun.findMany.mockResolvedValue([]);
    mocks.prisma.aiPersona.findFirst.mockResolvedValue({ id: 'persona-1' });
    mocks.prisma.aiPromptVersion.findFirst.mockResolvedValue({ id: 'prompt-version-1', status: 'production' });
    mocks.prisma.aiModelConfig.findFirst.mockResolvedValue({ id: 'model-1', status: 'active' });
    mocks.prisma.aiSkill.findMany.mockResolvedValue([{ id: 'skill-1' }]);
  });

  it('rejects unknown capabilities and policy fields', () => {
    expect(() => normalizeAgentCapabilities(['delete_contact'])).toThrowError(expect.objectContaining({
      code: 'AGENT_CAPABILITY_DENIED',
    }));
    expect(() => normalizeAgentPolicy({ apiKey: 'secret' })).toThrowError(expect.objectContaining({
      code: 'AGENT_POLICY_FIELD_DENIED',
    }));
  });

  it('never accepts full auto reply mode', async () => {
    await expect(createAgent(maker, {
      key: 'sales.helper',
      name: 'Sales Helper',
      autoReplyMode: 'full_auto',
    })).rejects.toMatchObject({ code: 'AGENT_FULL_AUTO_FORBIDDEN' });
    expect(mocks.prisma.aiAgent.create).not.toHaveBeenCalled();
  });

  it('rejects references from outside the organization', async () => {
    mocks.prisma.aiPersona.findFirst.mockResolvedValue(null);
    await expect(createAgent(maker, {
      key: 'sales.helper',
      name: 'Sales Helper',
      personaId: 'persona-foreign',
    })).rejects.toMatchObject({ code: 'AGENT_PERSONA_NOT_FOUND' });
    expect(mocks.prisma.aiAgent.create).not.toHaveBeenCalled();
  });

  it('enforces maker-checker approval', async () => {
    mocks.prisma.aiAgent.findFirst.mockResolvedValue({
      id: 'agent-1', status: 'pending_approval', createdByUserId: 'maker-1',
    });
    mocks.prisma.aiAuditLog.findFirst.mockResolvedValue({ actorUserId: 'maker-1' });

    await expect(approveAgent(maker, 'agent-1')).rejects.toMatchObject({
      code: 'AGENT_MAKER_CHECKER_REQUIRED',
    });
    expect(mocks.prisma.aiAgent.updateMany).not.toHaveBeenCalled();
  });

  it('fails activation closed until a current passing agent evaluation exists', async () => {
    mocks.prisma.aiAgent.findFirst.mockResolvedValue(agentRow());
    mocks.prisma.aiAuditLog.findMany.mockResolvedValue([{ 
      targetId: 'agent-1', actorUserId: 'maker-1', createdAt: new Date('2026-07-01T00:00:00Z'),
    }]);

    await expect(activateAgent(checker, 'agent-1')).rejects.toMatchObject({
      code: 'AGENT_EVALUATION_REQUIRED',
    });

    mocks.prisma.aiEvaluationRun.findMany.mockResolvedValue([{
      id: 'eval-1',
      config: { targetType: 'agent', targetId: 'agent-1' },
      metrics: { passed: true },
      completedAt: new Date('2026-07-02T00:00:00Z'),
    }]);
    mocks.prisma.aiAgent.updateMany.mockResolvedValue({ count: 1 });

    await expect(activateAgent(checker, 'agent-1')).resolves.toMatchObject({
      status: 'active',
      evaluationGate: { passed: true, runId: 'eval-1' },
    });
    expect(mocks.prisma.aiAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'agent.activated', targetId: 'agent-1' }),
    }));
  });

  it('returns only allowlisted fields from legacy stored records', async () => {
    mocks.prisma.aiAgent.findMany.mockResolvedValue([agentRow({
      capabilities: ['generate_reply', 'delete_contact'],
      autoReplyMode: 'full_auto',
      policy: {
        requireHumanReview: true,
        confidenceThreshold: 0.8,
        maxReplyLength: 900,
        handoffOnRisk: ['high'],
        apiKey: 'secret-policy-value',
      },
    })]);

    const result = await listAgents('org-1');
    expect(result[0]).toMatchObject({
      capabilities: ['generate_reply'],
      autoReplyMode: 'disabled',
      policy: { requireHumanReview: true, confidenceThreshold: 0.8 },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('contentEncrypted');
    expect(serialized).not.toContain('credentialRef');
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('delete_contact');
    expect(serialized).not.toContain('secret-policy-value');
  });
});
