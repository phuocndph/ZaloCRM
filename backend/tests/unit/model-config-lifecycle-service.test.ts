import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma: any = {
    aiModelConfig: { findFirst: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    aiProviderConnection: { findFirst: vi.fn() },
    aiConfig: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    aiAgent: { findMany: vi.fn() },
    aiRun: { count: vi.fn() },
    aiEvaluationRun: { count: vi.fn() },
    aiRelease: { findMany: vi.fn() },
    aiAuditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(prisma));
  return { prisma, testProviderConnection: vi.fn() };
});

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/modules/ai/provider-connection-service.js', () => {
  class ProviderConnectionError extends Error {
    constructor(message: string, public readonly statusCode = 400, public readonly code = 'AI_PROVIDER_CONNECTION_ERROR') {
      super(message);
    }
  }
  return { ProviderConnectionError, testProviderConnection: mocks.testProviderConnection };
});

import {
  approveModelConfig,
  getModelConfigImpact,
  setDefaultModelConfig,
  testModelConfig,
} from '../../src/modules/ai/model-config-lifecycle-service.js';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'model-1',
    orgId: 'org-1',
    connectionId: 'connection-1',
    key: 'reply-main',
    name: 'Reply main',
    provider: '9router',
    model: 'model-a',
    version: 1,
    revision: 1,
    parameters: {},
    capabilities: { text: true },
    dataPolicy: {},
    status: 'draft',
    fallbackModelConfigId: null,
    changeNote: null,
    createdByUserId: 'maker-1',
    approvedByUserId: null,
    approvedAt: null,
    archivedAt: null,
    createdAt: new Date('2026-07-16T00:00:00Z'),
    updatedAt: new Date('2026-07-16T00:00:00Z'),
    connection: { id: 'connection-1', key: 'router', name: 'Router', vendor: '9router', status: 'connected' },
    ...overrides,
  };
}

describe('model config lifecycle service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(mocks.prisma));
    mocks.prisma.aiAuditLog.create.mockResolvedValue({});
    mocks.prisma.aiConfig.findUnique.mockResolvedValue(null);
    mocks.prisma.aiProviderConnection.findFirst.mockResolvedValue({
      id: 'connection-1', key: 'router', name: 'Router', vendor: '9router', status: 'connected',
    });
  });

  it('probes the selected model then moves the version to testing', async () => {
    mocks.prisma.aiModelConfig.findFirst
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(row({ status: 'testing', revision: 2 }));
    mocks.prisma.aiModelConfig.updateMany.mockResolvedValue({ count: 1 });
    mocks.testProviderConnection.mockResolvedValue({
      connection: { id: 'connection-1', status: 'connected' },
      probe: { selectedModel: 'model-a', latencyMs: 31, completionVerified: true, models: [], modelsTruncated: false },
    });
    const result = await testModelConfig({ orgId: 'org-1', userId: 'maker-1' }, 'model-1');
    expect(mocks.testProviderConnection).toHaveBeenCalledWith(
      { orgId: 'org-1', userId: 'maker-1' },
      'connection-1',
      { model: 'model-a' },
    );
    expect(mocks.prisma.aiModelConfig.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ orgId: 'org-1', revision: 1 }),
      data: { status: 'testing', revision: { increment: 1 } },
    }));
    expect(result.modelConfig.status).toBe('testing');
    expect(result.probe.completionVerified).toBe(true);
  });

  it('enforces maker-checker approval', async () => {
    mocks.prisma.aiModelConfig.findFirst.mockResolvedValue(row({ status: 'submitted' }));
    await expect(approveModelConfig(
      { orgId: 'org-1', userId: 'maker-1' },
      'model-1',
    )).rejects.toMatchObject({ code: 'AI_MODEL_MAKER_CHECKER_REQUIRED', statusCode: 409 });
    expect(mocks.prisma.aiModelConfig.updateMany).not.toHaveBeenCalled();
  });

  it('uses tenant-scoped impact references and reports archive blockers', async () => {
    mocks.prisma.aiModelConfig.findFirst.mockResolvedValue(row({ status: 'approved' }));
    mocks.prisma.aiAgent.findMany.mockResolvedValue([{ id: 'agent-1', name: 'Sales agent', status: 'approved' }]);
    mocks.prisma.aiRun.count.mockResolvedValue(10);
    mocks.prisma.aiEvaluationRun.count.mockResolvedValue(2);
    mocks.prisma.aiModelConfig.count.mockResolvedValue(1);
    mocks.prisma.aiConfig.count.mockResolvedValue(1);
    mocks.prisma.aiRelease.findMany.mockResolvedValue([
      { id: 'release-1', version: 3, status: 'deployed', snapshot: { modelConfigId: 'model-1' } },
    ]);
    const impact = await getModelConfigImpact('org-1', 'model-1');
    expect(mocks.prisma.aiAgent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId: 'org-1', modelConfigId: 'model-1', deletedAt: null },
    }));
    expect(impact.canArchive).toBe(false);
    expect(impact.blockingReasons).toEqual(['agents', 'fallback_models', 'default_model', 'live_releases']);
    expect(impact.counts).toMatchObject({ runs: 10, evaluationRuns: 2, liveReleases: 1 });
  });

  it('rejects stale default-model writes using the AiConfig updatedAt revision', async () => {
    mocks.prisma.aiModelConfig.findFirst.mockResolvedValue(row({ status: 'approved' }));
    mocks.prisma.aiConfig.findUnique.mockResolvedValue({
      id: 'config-1',
      defaultModelConfigId: null,
      updatedAt: new Date('2026-07-16T01:00:00Z'),
    });
    await expect(setDefaultModelConfig(
      { orgId: 'org-1', userId: 'checker-1' },
      'model-1',
      '2026-07-16T00:00:00.000Z',
    )).rejects.toMatchObject({ code: 'AI_CONFIG_REVISION_CONFLICT', statusCode: 409 });
    expect(mocks.prisma.aiConfig.updateMany).not.toHaveBeenCalled();
  });
});
