import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma: any = {
    aiModelConfig: { findFirst: vi.fn(), updateMany: vi.fn() },
    aiProviderConnection: { findFirst: vi.fn() },
    aiConfig: { findUnique: vi.fn() },
    aiAuditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(prisma));
  return { prisma };
});

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));

import { updateModelConfig } from '../../src/modules/ai/model-config-mutation-service.js';

function versionRow(revision: number) {
  return {
    id: 'model-v2',
    orgId: 'org-1',
    connectionId: 'connection-1',
    key: 'reply-main',
    name: revision === 1 ? 'Reply v2' : 'Reply v2 edited',
    provider: '9router',
    model: 'model-a',
    version: 2,
    revision,
    parameters: {},
    capabilities: {},
    dataPolicy: {},
    status: 'draft',
    fallbackModelConfigId: null,
    changeNote: 'Cloned from version 1',
    createdByUserId: 'maker-1',
    approvedByUserId: null,
    approvedAt: null,
    archivedAt: null,
    createdAt: new Date('2026-07-16T00:00:00Z'),
    updatedAt: new Date('2026-07-16T00:00:00Z'),
    connection: { id: 'connection-1', key: 'router', name: 'Router', vendor: '9router', status: 'connected' },
  };
}

describe('model config version regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(mocks.prisma));
    mocks.prisma.aiAuditLog.create.mockResolvedValue({});
    mocks.prisma.aiConfig.findUnique.mockResolvedValue(null);
    mocks.prisma.aiProviderConnection.findFirst.mockResolvedValue({
      id: 'connection-1', key: 'router', name: 'Router', vendor: '9router', status: 'connected',
    });
  });

  it('allows editing a cloned draft while it keeps the logical key shared by its version family', async () => {
    mocks.prisma.aiModelConfig.findFirst
      .mockResolvedValueOnce(versionRow(1))
      .mockResolvedValueOnce(versionRow(2));
    mocks.prisma.aiModelConfig.updateMany.mockResolvedValue({ count: 1 });

    const updated = await updateModelConfig(
      { orgId: 'org-1', userId: 'maker-1' },
      'model-v2',
      { expectedRevision: 1, displayName: 'Reply v2 edited' },
    );

    expect(updated).toMatchObject({ logicalKey: 'reply-main', version: 2, revision: 2 });
    expect(mocks.prisma.aiModelConfig.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'model-v2', orgId: 'org-1', revision: 1 }),
    }));
  });
});
