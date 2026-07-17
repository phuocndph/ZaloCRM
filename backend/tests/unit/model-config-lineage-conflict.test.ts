import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma: any = {
    aiModelConfig: { findFirst: vi.fn(), updateMany: vi.fn() },
    aiProviderConnection: { findFirst: vi.fn() },
    aiAuditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(prisma));
  return { prisma };
});

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));

import { updateModelConfig } from '../../src/modules/ai/model-config-mutation-service.js';

const current = {
  id: 'model-v2',
  orgId: 'org-1',
  connectionId: 'connection-1',
  key: 'reply-main',
  name: 'Reply v2',
  provider: '9router',
  model: 'model-a',
  version: 2,
  revision: 1,
  parameters: {},
  capabilities: {},
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
};

describe('model config logical-key lineage conflict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(mocks.prisma));
    mocks.prisma.aiProviderConnection.findFirst.mockResolvedValue({
      id: 'connection-1', key: 'router', name: 'Router', vendor: '9router', status: 'connected',
    });
  });

  it('rejects moving a draft into a logical key owned by another version family', async () => {
    mocks.prisma.aiModelConfig.findFirst
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ id: 'other-family-v1' });

    await expect(updateModelConfig(
      { orgId: 'org-1', userId: 'maker-1' },
      'model-v2',
      { expectedRevision: 1, logicalKey: 'other-family' },
    )).rejects.toMatchObject({ code: 'AI_MODEL_LOGICAL_KEY_EXISTS', statusCode: 409 });

    expect(mocks.prisma.aiModelConfig.updateMany).not.toHaveBeenCalled();
  });
});
