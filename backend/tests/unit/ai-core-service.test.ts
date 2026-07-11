import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIClient } from '../../src/modules/ai/core/ai-client.js';
import { AIError } from '../../src/modules/ai/core/ai-error-handler.js';
import type { AIProvider, AIProviderContext, AIProviderRequest, AIProviderResponse } from '../../src/modules/ai/core/ai-provider.js';
import { AISafeLogger } from '../../src/modules/ai/core/ai-safe-logger.js';
import { AIUsageTracker, type AIUsageEvent, type UsageRepository } from '../../src/modules/ai/core/ai-usage-tracker.js';
import { ModelRegistry, type ModelConfigRepository } from '../../src/modules/ai/core/model-registry.js';
import { PromptRenderer } from '../../src/modules/ai/core/prompt-renderer.js';

class FakeProvider implements AIProvider {
  readonly id: string;
  calls = 0;
  failures = 0;
  responseText = '{"ok":true}';

  constructor(id: string) {
    this.id = id;
  }

  async complete(_context: AIProviderContext, _request: AIProviderRequest): Promise<AIProviderResponse> {
    this.calls += 1;
    if (this.calls <= this.failures) {
      throw Object.assign(new Error('temporary provider failure 503'), { status: 503 });
    }
    return {
      text: this.responseText,
      providerRequestId: `req-${this.calls}`,
      usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 10 },
    };
  }
}

type Stored = Awaited<ReturnType<ModelConfigRepository['find']>>;

function stored(id: string, provider: string, parameters: Record<string, unknown> = {}): NonNullable<Stored> {
  return {
    id,
    orgId: 'org-1',
    name: id,
    provider,
    model: `${provider}-model`,
    credentialRef: 'env:AI_CORE_TEST_KEY',
    parameters: {
      baseUrl: 'https://provider.test',
      timeoutMs: 1000,
      maxRetries: 0,
      rateLimitPerMinute: 100,
      circuitFailureThreshold: 3,
      inputCostPerMillion: 2,
      outputCostPerMillion: 10,
      cachedInputCostPerMillion: 1,
      ...parameters,
    },
    dataPolicy: {},
    status: 'active',
  };
}

function harness(configs: NonNullable<Stored>[], providers: AIProvider[]) {
  const events: Array<{ event: AIUsageEvent; cost: bigint }> = [];
  const usageRepository: UsageRepository = {
    async create(event, cost) {
      events.push({ event, cost });
    },
  };
  const repository: ModelConfigRepository = {
    async find(orgId, id) {
      return configs.find((config) => config.orgId === orgId && config.id === id) ?? null;
    },
  };
  const registry = new ModelRegistry(repository);
  providers.forEach((provider) => registry.registerProvider(provider));
  const client = new AIClient(
    registry,
    new AIUsageTracker(usageRepository),
    { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as AISafeLogger,
    async () => undefined,
  );
  return { client, events };
}

const baseRequest = {
  orgId: 'org-1',
  modelConfigId: 'primary',
  runId: 'run-1',
  taskType: 'unit_test',
  messages: [{ role: 'user' as const, content: 'sensitive customer text' }],
};

describe('AI Core Service', () => {
  beforeEach(() => {
    process.env.AI_CORE_TEST_KEY = 'test-secret-key';
  });

  afterEach(() => {
    delete process.env.AI_CORE_TEST_KEY;
  });

  it('parses structured output and tracks token cost', async () => {
    const provider = new FakeProvider('primary-provider');
    const { client, events } = harness([stored('primary', provider.id)], [provider]);
    const result = await client.complete<{ ok: boolean }>({
      ...baseRequest,
      structuredOutput: {
        name: 'health',
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
        validate: (value): value is { ok: boolean } =>
          typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === true,
      },
    });
    expect(result.structured).toEqual({ ok: true });
    expect(result.usage.costMicros).toBe(410n);
    expect(events).toHaveLength(1);
    expect(events[0].event.providerRequestId).toBe('req-1');
  });

  it('retries only up to configured limit', async () => {
    const provider = new FakeProvider('retry-provider');
    provider.failures = 1;
    const config = stored('primary', provider.id, { maxRetries: 1 });
    const { client } = harness([config], [provider]);
    await expect(client.complete(baseRequest)).resolves.toMatchObject({ provider: provider.id });
    expect(provider.calls).toBe(2);
  });

  it('uses configured fallback after retryable primary failure', async () => {
    const primary = new FakeProvider('primary-provider');
    primary.failures = 5;
    const fallback = new FakeProvider('fallback-provider');
    const configs = [
      stored('primary', primary.id, { fallbackModelConfigId: 'fallback' }),
      stored('fallback', fallback.id),
    ];
    const { client } = harness(configs, [primary, fallback]);
    const result = await client.complete(baseRequest);
    expect(result.usedFallback).toBe(true);
    expect(result.provider).toBe(fallback.id);
  });

  it('opens circuit after repeated provider failures', async () => {
    const provider = new FakeProvider('broken-provider');
    provider.failures = 10;
    const config = stored('primary', provider.id, { circuitFailureThreshold: 1, circuitResetMs: 60_000 });
    const { client } = harness([config], [provider]);
    await expect(client.complete(baseRequest)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(client.complete(baseRequest)).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
    expect(provider.calls).toBe(1);
  });

  it('enforces per-model rate limit', async () => {
    const provider = new FakeProvider('limited-provider');
    const config = stored('primary', provider.id, { rateLimitPerMinute: 1 });
    const { client } = harness([config], [provider]);
    await client.complete(baseRequest);
    await expect(client.complete(baseRequest)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('aborts a provider request at the configured timeout', async () => {
    vi.useFakeTimers();
    const provider: AIProvider = {
      id: 'slow-provider',
      complete: async (_context, request) => new Promise((_resolve, reject) => {
        request.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    };
    const { client } = harness([stored('primary', provider.id, { timeoutMs: 1000 })], [provider]);
    const pending = client.complete(baseRequest);
    const rejection = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1001);
    await rejection;
    vi.useRealTimers();
  });
  it('safe logger strips secrets and raw content', () => {
    expect(AISafeLogger.sanitize({
      provider: 'openai',
      apiKey: 'must-not-log',
      authorization: 'Bearer secret',
      prompt: 'customer phone',
      content: 'customer message',
      status: 'ok',
    })).toEqual({ provider: 'openai', status: 'ok' });
  });

  it('renders prompt variables and rejects missing variables', () => {
    const renderer = new PromptRenderer();
    expect(renderer.render('Hello {{customer.name}}', { customer: { name: 'Lan' } })).toBe('Hello Lan');
    expect(() => renderer.render('Hello {{missing}}', {})).toThrow(AIError);
  });
});
