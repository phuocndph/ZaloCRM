import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/ai/provider-connection-service.js', () => ({
  getProviderConnectionRuntime: vi.fn(),
}));

import type { AIProvider } from '../../src/modules/ai/core/ai-provider.js';
import {
  ModelRegistry,
  type ModelConfigRepository,
  type ProviderConnectionRuntimeResolver,
  type StoredModelConfig,
} from '../../src/modules/ai/core/model-registry.js';

const provider: AIProvider = {
  id: '9router',
  complete: vi.fn(),
};

function stored(overrides: Partial<StoredModelConfig> = {}): StoredModelConfig {
  return {
    id: 'model-1',
    orgId: 'org-1',
    name: '9Router model',
    provider: '9router',
    model: 'router-model',
    connectionId: 'connection-1',
    credentialRef: 'env:NINE_ROUTER_API_KEY',
    parameters: { baseUrl: 'https://legacy-parameter.invalid/v1' },
    dataPolicy: {},
    status: 'active',
    ...overrides,
  };
}

function registry(config: StoredModelConfig, resolver: ProviderConnectionRuntimeResolver) {
  const repository: ModelConfigRepository = {
    find: vi.fn(async (orgId, id) => orgId === config.orgId && id === config.id ? config : null),
  };
  return new ModelRegistry(repository, resolver).registerProvider(provider);
}

describe('ModelRegistry persistent provider connections', () => {
  afterEach(() => {
    delete process.env.NINE_ROUTER_API_KEY;
  });

  it('uses the persistent connection secret and base URL instead of environment values', async () => {
    process.env.NINE_ROUTER_API_KEY = 'environment-must-not-win';
    const resolver = vi.fn(async () => ({
      id: 'connection-1',
      adapter: 'openai_compatible',
      vendor: '9router',
      baseUrl: 'http://host.docker.internal:20128/v1',
      apiKey: 'persistent-secret',
    }));

    const result = await registry(stored(), resolver).resolve('org-1', 'model-1');

    expect(resolver).toHaveBeenCalledWith('org-1', 'connection-1');
    expect(result.apiKey).toBe('persistent-secret');
    expect(result.baseUrl).toBe('http://host.docker.internal:20128/v1');
  });

  it('fails closed when a managed connection secret is missing and never falls back to env', async () => {
    process.env.NINE_ROUTER_API_KEY = 'environment-secret-must-not-leak';
    const resolver = vi.fn(async () => {
      throw Object.assign(new Error('upstream raw secret=provider-secret'), { code: 'AI_SECRET_MISSING' });
    });

    const pending = registry(stored(), resolver).resolve('org-1', 'model-1');

    await expect(pending).rejects.toMatchObject({
      code: 'CONFIGURATION',
      message: 'AI provider connection is unavailable (AI_SECRET_MISSING)',
    });
    await expect(pending).rejects.not.toThrow(/environment-secret-must-not-leak|provider-secret/);
  });

  it('does not reflect an uncontrolled connection error code', async () => {
    process.env.NINE_ROUTER_API_KEY = 'environment-secret-must-not-win';
    const resolver = vi.fn(async () => {
      throw Object.assign(new Error('provider-secret'), { code: 'secret=provider-secret' });
    });

    await expect(registry(stored(), resolver).resolve('org-1', 'model-1')).rejects.toMatchObject({
      code: 'CONFIGURATION',
      message: 'AI provider connection is unavailable (AI_CONNECTION_UNAVAILABLE)',
    });
  });

  it('continues to resolve an explicit environment credential for a model without connectionId', async () => {
    process.env.NINE_ROUTER_API_KEY = 'legacy-environment-secret';
    const resolver = vi.fn() as unknown as ProviderConnectionRuntimeResolver;

    const result = await registry(stored({ connectionId: null }), resolver).resolve('org-1', 'model-1');

    expect(resolver).not.toHaveBeenCalled();
    expect(result.apiKey).toBe('legacy-environment-secret');
    expect(result.baseUrl).toBe('https://legacy-parameter.invalid/v1');
  });
});

