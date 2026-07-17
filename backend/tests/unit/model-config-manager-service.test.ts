import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma: any = {
    aiModelConfig: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    aiProviderConnection: { findFirst: vi.fn() },
    aiConfig: { findUnique: vi.fn() },
    aiAuditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(prisma));
  return { prisma };
});

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));

import {
  createModelConfig,
  listModelConfigs,
} from '../../src/modules/ai/model-config-manager-service.js';
import { updateModelConfig } from '../../src/modules/ai/model-config-mutation-service.js';

const actor = { orgId: 'org-1', userId: 'maker-1' };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'model-config-1',
    orgId: 'org-1',
    connectionId: 'connection-1',
    key: 'reply-main',
    name: 'Reply main',
    provider: '9router',
    model: 'model-a',
    version: 1,
    revision: 1,
    credentialRef: 'env:MUST_NOT_LEAK',
    parameters: { timeoutMs: 30_000 },
    capabilities: { text: true },
    dataPolicy: { pii: 'redact' },
    status: 'draft',
    fallbackModelConfigId: null,
    changeNote: null,
    createdByUserId: 'maker-1',
    approvedByUserId: null,
    approvedAt: null,
    archivedAt: null,
    createdAt: new Date('2026-07-16T00:00:00Z'),
    updatedAt: new Date('2026-07-16T00:00:00Z'),
    connection: {
      id: 'connection-1',
      key: '9router-main',
      name: '9Router',
      vendor: '9router',
      status: 'connected',
    },
    ...overrides,
  };
}

describe('model config manager service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(mocks.prisma));
    mocks.prisma.aiAuditLog.create.mockResolvedValue({});
    mocks.prisma.aiConfig.findUnique.mockResolvedValue(null);
  });

  it('scopes list reads to the tenant and never exposes credentialRef', async () => {
    mocks.prisma.aiModelConfig.findMany.mockResolvedValue([row()]);
    const result = await listModelConfigs('org-1', { status: 'draft', search: 'reply' });
    expect(mocks.prisma.aiModelConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ orgId: 'org-1', deletedAt: null, status: 'draft' }),
    }));
    expect(result.modelConfigs[0]).toMatchObject({
      logicalKey: 'reply-main',
      displayName: 'Reply main',
      externalModelId: 'model-a',
      isDefault: false,
    });
    expect(JSON.stringify(result)).not.toContain('credentialRef');
    expect(JSON.stringify(result)).not.toContain('MUST_NOT_LEAK');
  });

  it('derives provider from a verified tenant connection and creates a draft', async () => {
    mocks.prisma.aiProviderConnection.findFirst.mockResolvedValue({
      id: 'connection-1', key: '9router-main', name: '9Router', vendor: '9router', status: 'connected',
    });
    mocks.prisma.aiModelConfig.findFirst.mockResolvedValue(null);
    mocks.prisma.aiModelConfig.create.mockResolvedValue(row());
    const created = await createModelConfig(actor, {
      connectionId: 'connection-1',
      logicalKey: 'reply-main',
      displayName: 'Reply main',
      externalModelId: 'model-a',
      parameters: { timeoutMs: 30_000 },
    });
    expect(mocks.prisma.aiProviderConnection.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'connection-1', orgId: 'org-1', deletedAt: null },
    }));
    expect(mocks.prisma.aiModelConfig.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orgId: 'org-1',
        provider: '9router',
        model: 'model-a',
        status: 'draft',
        createdByUserId: 'maker-1',
      }),
    }));
    expect(created.status).toBe('draft');
    expect(mocks.prisma.aiAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'model_config.created', targetType: 'ai_model_config' }),
    }));
  });

  it('rejects credentials and custom headers nested inside JSON policy fields', async () => {
    await expect(createModelConfig(actor, {
      connectionId: 'connection-1',
      logicalKey: 'reply-main',
      displayName: 'Reply main',
      externalModelId: 'model-a',
      parameters: { customHeaders: { Authorization: 'secret' } },
    })).rejects.toMatchObject({ code: 'AI_MODEL_SENSITIVE_FIELD_DENIED' });
    expect(mocks.prisma.aiProviderConnection.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.aiModelConfig.create).not.toHaveBeenCalled();
  });

  it('keeps approved versions immutable', async () => {
    mocks.prisma.aiModelConfig.findFirst.mockResolvedValue(row({ status: 'approved' }));
    await expect(updateModelConfig(actor, 'model-config-1', {
      expectedRevision: 1,
      displayName: 'Changed',
    })).rejects.toMatchObject({ code: 'AI_MODEL_IMMUTABLE', statusCode: 409 });
    expect(mocks.prisma.aiModelConfig.updateMany).not.toHaveBeenCalled();
  });

  it('detects optimistic revision conflicts before writing', async () => {
    mocks.prisma.aiModelConfig.findFirst.mockResolvedValue(row({ revision: 3 }));
    await expect(updateModelConfig(actor, 'model-config-1', {
      expectedRevision: 2,
      displayName: 'Changed',
    })).rejects.toMatchObject({ code: 'AI_MODEL_REVISION_CONFLICT', statusCode: 409 });
    expect(mocks.prisma.aiModelConfig.updateMany).not.toHaveBeenCalled();
  });
});
