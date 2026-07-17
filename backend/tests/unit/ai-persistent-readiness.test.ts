import { describe, expect, it } from 'vitest';
import { getPersistentAiReadiness, type PersistentReadinessInput } from '../../src/modules/ai/ai-persistent-readiness.js';

function input(overrides: Partial<PersistentReadinessInput['defaultModelConfig']['connection']> = {}): PersistentReadinessInput {
  return {
    enabled: true,
    defaultModelConfig: {
      id: 'model-config-1',
      name: 'Default 9Router',
      provider: '9router',
      model: 'router-model',
      status: 'active',
      connection: {
        id: 'connection-1',
        name: '9Router local',
        adapter: 'openai_compatible',
        vendor: '9router',
        baseUrl: 'http://host.docker.internal:20128/v1',
        apiKeyLast4: 'cret',
        status: 'connected',
        lastTestStatus: 'healthy',
        lastTestedAt: new Date('2026-07-16T01:02:03.000Z'),
        lastLatencyMs: 25,
        lastErrorCode: null,
        deletedAt: null,
        ...overrides,
      },
    },
  };
}

describe('persistent AI readiness', () => {
  it('is ready only from a tested healthy persistent connection and never exposes key metadata', () => {
    const result = getPersistentAiReadiness(input());
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      ready: true,
      status: 'ready',
      config: { defaultModelConfigId: 'model-config-1' },
      connection: { id: 'connection-1', status: 'connected', health: 'healthy' },
    });
    expect(serialized).not.toContain('cret');
    expect(serialized).not.toContain('apiKeyLast4');
  });

  it('requires a test after the legacy bridge creates a needs_test connection', () => {
    const result = getPersistentAiReadiness(input({
      status: 'needs_test',
      lastTestStatus: null,
      lastTestedAt: null,
      lastLatencyMs: null,
    }));

    expect(result).toMatchObject({
      ready: false,
      status: 'needs_test',
      connection: { status: 'not_tested' },
      model: { status: 'unverified', available: null },
    });
  });

  it('reports a disabled persistent connection as not configured with a stable error code', () => {
    const result = getPersistentAiReadiness(input({ status: 'disabled' }));

    expect(result).toMatchObject({
      ready: false,
      status: 'not_configured',
      connection: { status: 'failed', errorCode: 'AI_CONNECTION_DISABLED' },
    });
  });

  it('sanitizes persisted URL credentials and uncontrolled provider error codes', () => {
    const result = getPersistentAiReadiness(input({
      status: 'failed',
      lastTestStatus: 'failed',
      lastErrorCode: 'secret=provider-secret',
      baseUrl: 'https://user:url-secret@provider.test/v1?token=query-secret',
    }));
    const serialized = JSON.stringify(result);

    expect(result?.connection.errorCode).toBe('AI_CONNECTION_TEST_FAILED');
    expect(serialized).not.toMatch(/url-secret|query-secret|provider-secret/);
  });
});

