import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    aiEvaluationRun: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: mocks.prisma,
}));

import {
  getEvaluationRun,
  listEvaluationRuns,
} from '../../src/modules/ai/evaluation-history-service.js';

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    name: 'Release gate',
    status: 'completed',
    agentId: 'agent-1',
    promptVersionId: 'prompt-v1',
    modelConfigId: 'model-1',
    datasetVersion: null,
    config: {
      targetType: 'agent',
      targetId: 'agent-1',
      threshold: 85,
      suite: 'initial-v1',
      internalSecret: 'must-not-leak',
    },
    metrics: {
      averageScore: 92,
      threshold: 85,
      passed: true,
      criticalFailures: [],
      caseCount: 12,
      rawOutput: 'must-not-leak',
    },
    agent: { id: 'agent-1', name: 'Sale assistant', status: 'active' },
    promptVersion: {
      id: 'prompt-v1',
      version: 3,
      status: 'approved',
      prompt: { key: 'reply', name: 'Reply draft' },
    },
    modelConfig: {
      id: 'model-1',
      name: '9Router',
      provider: 'openai',
      model: 'router-model',
      status: 'active',
    },
    createdBy: { id: 'user-1', fullName: 'Nguyen Van A' },
    _count: { results: 12 },
    startedAt: new Date('2026-07-16T01:00:00.000Z'),
    completedAt: new Date('2026-07-16T01:02:00.000Z'),
    createdAt: new Date('2026-07-16T01:00:00.000Z'),
    updatedAt: new Date('2026-07-16T01:02:00.000Z'),
    ...overrides,
  };
}

describe('evaluation history service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists only organization-scoped, filtered and allow-listed run metadata', async () => {
    mocks.prisma.aiEvaluationRun.findMany.mockResolvedValue([runRow()]);

    const result = await listEvaluationRuns('org-1', {
      status: 'completed',
      targetType: 'agent',
      targetId: 'agent-1',
      limit: 999,
    });

    expect(mocks.prisma.aiEvaluationRun.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        orgId: 'org-1',
        status: 'completed',
        AND: [
          { config: { path: ['targetType'], equals: 'agent' } },
          { config: { path: ['targetId'], equals: 'agent-1' } },
        ],
      },
      take: 100,
    }));
    expect(result.runs[0]).toMatchObject({
      id: 'run-1',
      config: { targetType: 'agent', targetId: 'agent-1', threshold: 85 },
      metrics: { averageScore: 92, passed: true, caseCount: 12 },
      resultCount: 12,
    });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('returns safe case-level scores without raw payloads or output hashes', async () => {
    mocks.prisma.aiEvaluationRun.findFirst.mockResolvedValue(runRow({
      results: [{
        id: 'result-1',
        status: 'completed',
        score: 0.92,
        metrics: {
          criteria: { accuracy: 100, privacy: 100, internal: 999 },
          policyViolations: ['POLICY_A'],
          outputHash: 'forbidden-hash',
          rawOutput: 'forbidden-output',
        },
        errorCode: null,
        evaluationCase: {
          id: 'case-1',
          key: 'price_missing_size',
          name: 'Hỏi giá thiếu kích thước',
          taskType: 'reply_draft',
          tags: ['price_inquiry'],
          inputEncrypted: 'forbidden-input',
        },
        createdAt: new Date('2026-07-16T01:01:00.000Z'),
        updatedAt: new Date('2026-07-16T01:02:00.000Z'),
      }],
    }));

    const result = await getEvaluationRun('org-1', 'run-1');
    const serialized = JSON.stringify(result);

    expect(mocks.prisma.aiEvaluationRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'run-1', orgId: 'org-1' },
    }));
    expect(result.run.results[0]).toMatchObject({
      score: 0.92,
      metrics: {
        criteria: { accuracy: 100, privacy: 100 },
        policyViolations: ['POLICY_A'],
      },
      evaluationCase: { key: 'price_missing_size' },
    });
    expect(serialized).not.toContain('forbidden-hash');
    expect(serialized).not.toContain('forbidden-output');
    expect(serialized).not.toContain('forbidden-input');
    expect(serialized).not.toContain('internal');
  });

  it('does not return a run from another organization', async () => {
    mocks.prisma.aiEvaluationRun.findFirst.mockResolvedValue(null);

    await expect(getEvaluationRun('org-1', 'run-other')).rejects.toMatchObject({
      statusCode: 404,
      code: 'EVALUATION_RUN_NOT_FOUND',
    });
  });
});
