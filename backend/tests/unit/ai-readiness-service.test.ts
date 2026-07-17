import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    aiConfig: { findUnique: vi.fn() },
  },
  getProviderConfig: vi.fn(),
  resolveProviderApiKey: vi.fn(),
  getProviderBaseUrl: vi.fn(),
  invalidateModelCache: vi.fn(),
  listProviderModels: vi.fn(),
}));

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/modules/ai/provider-registry.js', () => ({
  getProviderConfig: mocks.getProviderConfig,
  resolveProviderApiKey: mocks.resolveProviderApiKey,
  getProviderBaseUrl: mocks.getProviderBaseUrl,
}));
vi.mock('../../src/modules/ai/providers/list-models.js', () => ({
  invalidateModelCache: mocks.invalidateModelCache,
  listProviderModels: mocks.listProviderModels,
}));

import {
  AiReadinessError,
  clearAiReadinessProbeCache,
  getAiReadiness,
  testProviderConnection,
} from '../../src/modules/ai/ai-readiness-service.js';

describe('AI readiness service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAiReadinessProbeCache();
    mocks.getProviderConfig.mockImplementation((provider: string) => provider === 'openai'
      ? { id: 'openai', name: 'OpenAI-compatible', baseUrl: 'https://api.example.test', authToken: '' }
      : undefined);
    mocks.resolveProviderApiKey.mockResolvedValue('sk-secret-value');
    mocks.getProviderBaseUrl.mockResolvedValue('https://api.example.test');
  });

  it('reports a missing AI configuration without resolving credentials', async () => {
    mocks.prisma.aiConfig.findUnique.mockResolvedValue(null);

    const result = await getAiReadiness('org-1');

    expect(result.status).toBe('disabled');
    expect(result.ready).toBe(false);
    expect(result.provider.hasApiKey).toBe(false);
    expect(result.model.status).toBe('missing');
    expect(mocks.resolveProviderApiKey).not.toHaveBeenCalled();
  });

  it('reports configured-but-unverified and never returns URL credentials or API keys', async () => {
    mocks.prisma.aiConfig.findUnique.mockResolvedValue({ enabled: true, provider: 'openai', model: 'gpt-test' });
    mocks.getProviderBaseUrl.mockResolvedValue('https://url-user:url-secret@api.example.test/v1?token=query-secret');

    const result = await getAiReadiness('org-1');
    const serialized = JSON.stringify(result);

    expect(result.status).toBe('needs_test');
    expect(result.provider.baseUrl).toBe('https://api.example.test/v1');
    expect(result.connection.status).toBe('not_tested');
    expect(serialized).not.toContain('sk-secret-value');
    expect(serialized).not.toContain('url-secret');
    expect(serialized).not.toContain('query-secret');
  });

  it('becomes ready after a successful provider test verifies the selected model', async () => {
    mocks.prisma.aiConfig.findUnique.mockResolvedValue({ enabled: true, provider: 'openai', model: 'gpt-test' });
    mocks.listProviderModels.mockResolvedValue([
      { title: 'gpt-test', value: 'gpt-test' },
      { title: 'gpt-other', value: 'gpt-other' },
    ]);

    const connection = await testProviderConnection('org-1', 'openai');
    const readiness = await getAiReadiness('org-1');

    expect(connection).toMatchObject({ ok: true, status: 'connected', modelAvailable: true, modelsCount: 2 });
    expect(mocks.invalidateModelCache).toHaveBeenCalledWith('org-1', 'openai');
    expect(readiness).toMatchObject({
      ready: true,
      status: 'ready',
      model: { status: 'available', available: true },
      connection: { status: 'connected', errorCode: null },
    });
  });

  it('stores and returns only a sanitized connection failure', async () => {
    mocks.prisma.aiConfig.findUnique.mockResolvedValue({ enabled: true, provider: 'openai', model: 'gpt-test' });
    mocks.listProviderModels.mockRejectedValue(new Error('HTTP 401 key=sk-secret-value upstream-body'));

    const connection = await testProviderConnection('org-1', 'openai');
    const readiness = await getAiReadiness('org-1');
    const serialized = JSON.stringify({ connection, readiness });

    expect(connection).toMatchObject({
      ok: false,
      status: 'failed',
      errorCode: 'AI_PROVIDER_CONNECTION_FAILED',
    });
    expect(readiness.status).toBe('error');
    expect(serialized).not.toContain('sk-secret-value');
    expect(serialized).not.toContain('upstream-body');
  });

  it('rejects an unsupported provider before attempting a request', async () => {
    await expect(testProviderConnection('org-1', 'unknown')).rejects.toMatchObject<AiReadinessError>({
      statusCode: 400,
      code: 'AI_PROVIDER_UNSUPPORTED',
    });
    expect(mocks.listProviderModels).not.toHaveBeenCalled();
  });
});
