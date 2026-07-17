import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma: any = {
    aiProviderConnection: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    aiModelConfig: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    aiAuditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(prisma));
  return {
    prisma,
    encryptToken: vi.fn((value: string) => `encrypted:${value}`),
    decryptToken: vi.fn((value: string) => value.replace(/^encrypted:/, '')),
    listOpenAICompatibleModels: vi.fn(),
    probeOpenAICompatibleConnection: vi.fn(),
    normalizeOpenAICompatibleError: vi.fn((error: any, vendor?: string) => ({
      code: error?.code ?? 'UNKNOWN',
      message: error?.message ?? 'AI provider request failed',
      retryable: false,
      statusCode: error?.statusCode ?? 502,
      provider: vendor,
    })),
  };
});

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/modules/integrations/_shared/token-encryption.util.js', () => ({
  encryptToken: mocks.encryptToken,
  decryptToken: mocks.decryptToken,
}));
vi.mock('../../src/modules/ai/providers/openai-compatible-client.js', () => ({
  listOpenAICompatibleModels: mocks.listOpenAICompatibleModels,
  probeOpenAICompatibleConnection: mocks.probeOpenAICompatibleConnection,
  normalizeOpenAICompatibleError: mocks.normalizeOpenAICompatibleError,
}));

import {
  ProviderConnectionError,
  createProviderConnection,
  deleteProviderConnection,
  getProviderConnection,
  listProviderConnections,
  normalizeProviderBaseUrl,
  revokeProviderConnectionSecret,
  setProviderConnectionSecret,
  testProviderConnection,
  updateProviderConnection,
} from '../../src/modules/ai/provider-connection-service.js';

const actor = { orgId: 'org-1', userId: 'admin-1' };

function connectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'connection-1',
    key: '9router-main',
    name: '9Router chính',
    adapter: 'openai_compatible',
    vendor: '9router',
    baseUrl: 'http://host.docker.internal:20128/v1',
    apiKeyLast4: '1234',
    credentialVersion: 1,
    status: 'connected',
    lastTestStatus: 'healthy',
    lastTestedAt: new Date('2026-07-16T00:00:00Z'),
    lastLatencyMs: 42,
    lastErrorCode: null,
    createdByUserId: 'admin-1',
    updatedByUserId: 'admin-1',
    createdAt: new Date('2026-07-15T00:00:00Z'),
    updatedAt: new Date('2026-07-16T00:00:00Z'),
    _count: { modelConfigs: 2 },
    ...overrides,
  };
}

describe('provider connection service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AI_PROVIDER_HTTP_HOST_ALLOWLIST;
    mocks.prisma.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => callback(mocks.prisma));
    mocks.prisma.aiAuditLog.create.mockResolvedValue({});
  });

  it('accepts HTTPS and only allows HTTP for an exact 9Router host allowlist match', () => {
    expect(normalizeProviderBaseUrl('https://router.example.com/v1/', 'custom'))
      .toBe('https://router.example.com/v1');
    expect(normalizeProviderBaseUrl('http://host.docker.internal:20128/v1/', '9router'))
      .toBe('http://host.docker.internal:20128/v1');

    expect(() => normalizeProviderBaseUrl('http://host.docker.internal:20128/v1', 'custom'))
      .toThrowError(expect.objectContaining({ code: 'AI_BASE_URL_HTTP_DENIED' }));
    expect(() => normalizeProviderBaseUrl('http://localhost:20128/v1', '9router'))
      .toThrowError(expect.objectContaining({ code: 'AI_BASE_URL_HOST_DENIED' }));
    expect(() => normalizeProviderBaseUrl('https://127.0.0.1/v1', 'custom'))
      .toThrowError(expect.objectContaining({ code: 'AI_BASE_URL_HOST_DENIED' }));
    expect(() => normalizeProviderBaseUrl('https://[::ffff:127.0.0.1]/v1', 'custom'))
      .toThrowError(expect.objectContaining({ code: 'AI_BASE_URL_HOST_DENIED' }));
    expect(() => normalizeProviderBaseUrl('https://user:pass@router.example.com/v1', 'custom'))
      .toThrowError(expect.objectContaining({ code: 'AI_BASE_URL_CREDENTIALS_DENIED' }));
    expect(() => normalizeProviderBaseUrl('https://router.example.com/v1?token=secret', 'custom'))
      .toThrowError(expect.objectContaining({ code: 'AI_BASE_URL_COMPONENT_DENIED' }));
  });

  it('always scopes list reads by organization and never serializes encrypted secrets', async () => {
    mocks.prisma.aiProviderConnection.findMany.mockResolvedValue([
      connectionRow({ apiKeyEncrypted: new TextEncoder().encode('must-not-leak') }),
    ]);

    const result = await listProviderConnections('org-1', { status: 'connected' });

    expect(mocks.prisma.aiProviderConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ orgId: 'org-1', deletedAt: null, status: 'connected' }),
    }));
    expect(result[0]).toMatchObject({
      id: 'connection-1',
      apiKeyConfigured: true,
      apiKeyLast4: '1234',
      modelConfigCount: 2,
    });
    expect(JSON.stringify(result)).not.toContain('apiKeyEncrypted');
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('does not reveal whether a connection exists in another organization', async () => {
    mocks.prisma.aiProviderConnection.findFirst.mockResolvedValue(null);

    await expect(getProviderConnection('org-1', 'connection-from-org-2')).rejects.toMatchObject({
      statusCode: 404,
      code: 'AI_CONNECTION_NOT_FOUND',
    });
    expect(mocks.prisma.aiProviderConnection.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'connection-from-org-2', orgId: 'org-1', deletedAt: null },
    }));
  });

  it('creates a tenant-scoped draft and audits only non-secret metadata', async () => {
    mocks.prisma.aiProviderConnection.findFirst.mockResolvedValue(null);
    mocks.prisma.aiProviderConnection.create.mockResolvedValue(connectionRow({
      status: 'draft',
      apiKeyLast4: null,
      _count: { modelConfigs: 0 },
    }));

    const created = await createProviderConnection(actor, {
      name: '9Router chính',
      adapter: 'openai_compatible',
      vendor: '9router',
      baseUrl: 'http://host.docker.internal:20128/v1',
    });

    expect(mocks.prisma.aiProviderConnection.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        orgId: 'org-1',
        createdByUserId: 'admin-1',
        status: 'draft',
      }),
    }));
    expect(created.apiKeyConfigured).toBe(false);
    expect(mocks.prisma.aiAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'provider_connection.created',
        targetType: 'ai_provider_connection',
      }),
    }));
    expect(JSON.stringify(mocks.prisma.aiAuditLog.create.mock.calls)).not.toContain('apiKey');
  });

  it('encrypts a write-only secret, preserves only its last four characters, and requires a new test', async () => {
    mocks.prisma.aiProviderConnection.findFirst
      .mockResolvedValueOnce(connectionRow({ apiKeyEncrypted: null, apiKeyLast4: null, status: 'draft' }))
      .mockResolvedValueOnce(connectionRow({ apiKeyLast4: '1234', status: 'needs_test' }));
    mocks.prisma.aiProviderConnection.updateMany.mockResolvedValue({ count: 1 });

    const updated = await setProviderConnectionSecret(actor, 'connection-1', 'sk-live-example-1234');

    expect(mocks.encryptToken).toHaveBeenCalledWith('sk-live-example-1234');
    const update = mocks.prisma.aiProviderConnection.updateMany.mock.calls[0][0];
    expect(Buffer.from(update.data.apiKeyEncrypted).toString('utf8')).toBe('encrypted:sk-live-example-1234');
    expect(update.data).toMatchObject({
      apiKeyLast4: '1234',
      credentialVersion: 1,
      status: 'needs_test',
      lastTestStatus: null,
    });
    expect(updated).not.toHaveProperty('apiKeyEncrypted');
    expect(JSON.stringify(mocks.prisma.aiAuditLog.create.mock.calls)).not.toContain('sk-live-example-1234');
  });

  it('resets a connected configuration to needs_test when its runtime URL changes', async () => {
    mocks.prisma.aiProviderConnection.findFirst
      .mockResolvedValueOnce(connectionRow())
      .mockResolvedValueOnce(connectionRow({
        baseUrl: 'https://router.example.com/v1',
        status: 'needs_test',
        lastTestStatus: null,
      }));
    mocks.prisma.aiProviderConnection.updateMany.mockResolvedValue({ count: 1 });

    await updateProviderConnection(actor, 'connection-1', {
      baseUrl: 'https://router.example.com/v1/',
    });

    expect(mocks.prisma.aiProviderConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'connection-1', orgId: 'org-1', deletedAt: null },
      data: expect.objectContaining({ status: 'needs_test', lastTestStatus: null }),
    }));
  });

  it('keeps a disabled connection disabled when runtime metadata changes until status=draft is explicit', async () => {
    mocks.prisma.aiProviderConnection.findFirst
      .mockResolvedValueOnce(connectionRow({ status: 'disabled' }))
      .mockResolvedValueOnce(connectionRow({
        status: 'disabled',
        baseUrl: 'https://router.example.com/v1',
        lastTestStatus: null,
      }));
    mocks.prisma.aiProviderConnection.updateMany.mockResolvedValue({ count: 1 });

    await updateProviderConnection(actor, 'connection-1', {
      baseUrl: 'https://router.example.com/v1',
    });

    expect(mocks.prisma.aiProviderConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'disabled' }),
    }));
  });

  it('keeps a disabled connection disabled across secret rotation and revocation', async () => {
    const encryptedSecret = new TextEncoder().encode('encrypted:old-secret');
    mocks.prisma.aiProviderConnection.findFirst
      .mockResolvedValueOnce(connectionRow({
        status: 'disabled',
        apiKeyEncrypted: encryptedSecret,
      }))
      .mockResolvedValueOnce(connectionRow({ status: 'disabled', apiKeyLast4: '1234' }));
    mocks.prisma.aiProviderConnection.updateMany.mockResolvedValue({ count: 1 });

    await setProviderConnectionSecret(actor, 'connection-1', 'new-secret-1234');
    expect(mocks.prisma.aiProviderConnection.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'disabled' }),
    }));

    mocks.prisma.aiProviderConnection.findFirst
      .mockResolvedValueOnce(connectionRow({
        status: 'disabled',
        apiKeyEncrypted: encryptedSecret,
      }))
      .mockResolvedValueOnce(connectionRow({ status: 'disabled', apiKeyLast4: null }));
    await revokeProviderConnectionSecret(actor, 'connection-1');
    expect(mocks.prisma.aiProviderConnection.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'disabled', apiKeyEncrypted: null }),
    }));
  });

  it('persists a sanitized successful probe and moves the connection to connected', async () => {
    const encryptedSecret = new TextEncoder().encode('encrypted:sk-router-secret');
    mocks.prisma.aiProviderConnection.findFirst
      .mockResolvedValueOnce(connectionRow({ apiKeyEncrypted: encryptedSecret, status: 'needs_test' }))
      .mockResolvedValueOnce(connectionRow({ status: 'needs_test' }))
      .mockResolvedValueOnce(connectionRow({ status: 'connected', lastTestStatus: 'healthy', lastLatencyMs: 35 }));
    mocks.prisma.aiProviderConnection.updateMany.mockResolvedValue({ count: 1 });
    mocks.probeOpenAICompatibleConnection.mockResolvedValue({
      models: [{ title: 'model-a', value: 'model-a' }],
      selectedModel: 'model-a',
      latencyMs: 35,
      completionVerified: true,
    });

    const result = await testProviderConnection(actor, 'connection-1', { model: 'model-a' });

    expect(mocks.probeOpenAICompatibleConnection).toHaveBeenCalledWith({
      baseUrl: 'http://host.docker.internal:20128/v1',
      apiKey: 'sk-router-secret',
      vendor: '9router',
      model: 'model-a',
    });
    expect(mocks.prisma.aiProviderConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'connection-1', orgId: 'org-1', deletedAt: null },
      data: expect.objectContaining({
        status: 'connected',
        lastTestStatus: 'healthy',
        lastErrorCode: null,
      }),
    }));
    expect(result.probe).toMatchObject({
      selectedModel: 'model-a',
      completionVerified: true,
      latencyMs: 35,
    });
    expect(JSON.stringify(result)).not.toContain('sk-router-secret');
  });

  it('normalizes and persists a failed probe without leaking provider response details', async () => {
    const encryptedSecret = new TextEncoder().encode('encrypted:sk-router-secret');
    mocks.prisma.aiProviderConnection.findFirst
      .mockResolvedValueOnce(connectionRow({ apiKeyEncrypted: encryptedSecret, status: 'needs_test' }))
      .mockResolvedValueOnce(connectionRow({ status: 'needs_test' }))
      .mockResolvedValueOnce(connectionRow({
        status: 'failed',
        lastTestStatus: 'auth_failed',
        lastErrorCode: 'AI_CONNECTION_AUTH_FAILED',
      }));
    mocks.prisma.aiProviderConnection.updateMany.mockResolvedValue({ count: 1 });
    mocks.probeOpenAICompatibleConnection.mockRejectedValue(Object.assign(
      new Error('AI provider authentication failed'),
      { code: 'AUTHENTICATION', statusCode: 502, rawBody: 'upstream-secret-body' },
    ));

    await expect(testProviderConnection(actor, 'connection-1')).rejects.toMatchObject({
      code: 'AI_CONNECTION_AUTH_FAILED',
      statusCode: 502,
    });
    expect(mocks.prisma.aiProviderConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'failed',
        lastTestStatus: 'auth_failed',
        lastErrorCode: 'AI_CONNECTION_AUTH_FAILED',
      }),
    }));
    const serializedAudit = JSON.stringify(mocks.prisma.aiAuditLog.create.mock.calls);
    expect(serializedAudit).not.toContain('sk-router-secret');
    expect(serializedAudit).not.toContain('upstream-secret-body');
  });

  it('blocks deletion while a model configuration still references the connection', async () => {
    mocks.prisma.aiProviderConnection.findFirst.mockResolvedValue(connectionRow());
    mocks.prisma.aiModelConfig.count.mockResolvedValue(1);

    await expect(deleteProviderConnection(actor, 'connection-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'AI_CONNECTION_IN_USE',
    });
    expect(mocks.prisma.aiProviderConnection.updateMany).not.toHaveBeenCalled();
  });

  it('soft-deletes an unused connection and removes its encrypted secret', async () => {
    mocks.prisma.aiProviderConnection.findFirst.mockResolvedValue(connectionRow());
    mocks.prisma.aiModelConfig.count.mockResolvedValue(0);
    mocks.prisma.aiProviderConnection.updateMany.mockResolvedValue({ count: 1 });

    await expect(deleteProviderConnection(actor, 'connection-1')).resolves.toEqual({
      id: 'connection-1',
      deleted: true,
    });
    expect(mocks.prisma.aiProviderConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'connection-1', orgId: 'org-1', deletedAt: null },
      data: expect.objectContaining({ status: 'disabled', apiKeyEncrypted: null, deletedAt: expect.any(Date) }),
    }));
  });

  it('uses a stable error type for validation failures', () => {
    try {
      normalizeProviderBaseUrl('file:///etc/passwd', '9router');
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderConnectionError);
      expect(error).toMatchObject({ code: 'AI_BASE_URL_SCHEME_DENIED' });
    }
  });
});
