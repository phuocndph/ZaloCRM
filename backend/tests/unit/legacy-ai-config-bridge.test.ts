import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {},
  getProviderConfig: vi.fn(),
  normalizeProviderBaseUrl: vi.fn((value: unknown) => String(value).replace(/\/$/, '')),
}));

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/modules/ai/provider-registry.js', () => ({
  getProviderConfig: mocks.getProviderConfig,
}));
vi.mock('../../src/modules/ai/provider-connection-service.js', () => ({
  normalizeProviderBaseUrl: mocks.normalizeProviderBaseUrl,
}));
vi.mock('../../src/modules/integrations/_shared/token-encryption.util.js', () => ({
  encryptToken: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  decryptToken: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
}));

import { bridgeLegacyAiConfiguration } from '../../src/modules/ai/legacy-ai-config-bridge.js';

function memoryDb(options: { apiKey?: string; baseUrl?: string } = {}) {
  const state: any = {
    config: {
      id: 'config-1',
      orgId: 'org-1',
      provider: '9router',
      model: 'router-model',
      defaultModelConfigId: null,
    },
    settings: [
      ...(options.apiKey ? [{
        settingKey: 'ai_9router_api_key',
        valuePlain: options.apiKey,
        valueEncrypted: null,
      }] : []),
      ...(options.baseUrl ? [{
        settingKey: 'ai_9router_base_url',
        valuePlain: options.baseUrl,
        valueEncrypted: null,
      }] : []),
    ],
    connections: [] as any[],
    models: [] as any[],
    audits: [] as any[],
  };

  const db: any = {
    aiConfig: {
      findUnique: vi.fn(async () => ({
        id: state.config.id,
        provider: state.config.provider,
        model: state.config.model,
        defaultModelConfigId: state.config.defaultModelConfigId,
      })),
      updateMany: vi.fn(async ({ data }: any) => {
        if (state.config.defaultModelConfigId) return { count: 0 };
        state.config.defaultModelConfigId = data.defaultModelConfigId;
        return { count: 1 };
      }),
    },
    appSetting: {
      findMany: vi.fn(async () => state.settings),
    },
    aiProviderConnection: {
      findFirst: vi.fn(async ({ where }: any) => state.connections.find((item: any) => item.key === where.key) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const created = { id: 'connection-1', deletedAt: null, ...data };
        state.connections.push(created);
        return created;
      }),
    },
    aiModelConfig: {
      findFirst: vi.fn(async ({ where }: any) => state.models.find((item: any) => item.key === where.key && item.version === where.version) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const created = { id: 'model-config-1', deletedAt: null, ...data };
        state.models.push(created);
        return created;
      }),
    },
    aiAuditLog: {
      create: vi.fn(async ({ data }: any) => {
        state.audits.push(data);
        return data;
      }),
    },
  };
  return { db, state };
}

describe('legacy AI configuration bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConfig.mockReturnValue({
      id: '9router',
      name: '9Router',
      adapter: 'openai-compatible',
      vendor: '9router',
      baseUrl: 'http://host.docker.internal:20128/v1',
    });
    delete process.env.NINE_ROUTER_API_KEY;
  });

  it('copies a legacy AppSetting credential once and assigns an active compatibility model', async () => {
    const secret = 'legacy-super-secret-value';
    const { db, state } = memoryDb({ apiKey: secret, baseUrl: 'http://9router:20128/v1/' });

    const first = await bridgeLegacyAiConfiguration('org-1', db);
    const second = await bridgeLegacyAiConfiguration('org-1', db);

    expect(first).toMatchObject({
      status: 'created',
      connectionCreated: true,
      modelCreated: true,
      connectionId: 'connection-1',
      modelConfigId: 'model-config-1',
    });
    expect(second).toMatchObject({ status: 'already_configured', modelConfigId: 'model-config-1' });
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0]).toMatchObject({ status: 'needs_test', apiKeyLast4: 'alue' });
    expect(Buffer.from(state.connections[0].apiKeyEncrypted).toString('utf8')).not.toContain(secret);
    expect(state.models).toHaveLength(1);
    expect(state.models[0]).toMatchObject({
      connectionId: 'connection-1',
      credentialRef: null,
      status: 'active',
    });
    expect(state.config.defaultModelConfigId).toBe('model-config-1');
    expect(state.audits).toHaveLength(1);
    expect(JSON.stringify({ first, second, audits: state.audits })).not.toContain(secret);
  });

  it('keeps an environment-backed legacy model detached from a connection without a persistent secret', async () => {
    process.env.NINE_ROUTER_API_KEY = 'environment-secret';
    const { db, state } = memoryDb();

    await bridgeLegacyAiConfiguration('org-1', db);

    expect(state.connections[0]).toMatchObject({ status: 'draft', apiKeyEncrypted: null });
    expect(state.models[0]).toMatchObject({
      connectionId: null,
      credentialRef: 'env:NINE_ROUTER_API_KEY',
      status: 'active',
    });
  });
});

