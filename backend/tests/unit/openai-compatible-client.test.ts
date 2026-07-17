import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  joinOpenAICompatibleUrl,
  listOpenAICompatibleModels,
  normalizeOpenAICompatibleError,
  probeOpenAICompatibleConnection,
  readOpenAICompatibleCompletion,
} from '../../src/modules/ai/providers/openai-compatible-client.js';

describe('OpenAI-compatible 9Router client', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowlist = process.env.AI_PROVIDER_HTTP_HOST_ALLOWLIST;
  const originalLegacyAllowlist = process.env.AI_PROVIDER_HTTP_ALLOWLIST;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.AI_PROVIDER_HTTP_HOST_ALLOWLIST;
    delete process.env.AI_PROVIDER_HTTP_ALLOWLIST;
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalAllowlist === undefined) delete process.env.AI_PROVIDER_HTTP_HOST_ALLOWLIST;
    else process.env.AI_PROVIDER_HTTP_HOST_ALLOWLIST = originalAllowlist;
    if (originalLegacyAllowlist === undefined) delete process.env.AI_PROVIDER_HTTP_ALLOWLIST;
    else process.env.AI_PROVIDER_HTTP_ALLOWLIST = originalLegacyAllowlist;
    vi.restoreAllMocks();
  });

  it('joins root and versioned base URLs without duplicating /v1', () => {
    expect(joinOpenAICompatibleUrl('https://api.example.test', '/v1/models'))
      .toBe('https://api.example.test/v1/models');
    expect(joinOpenAICompatibleUrl('https://api.example.test/v1/', '/v1/models'))
      .toBe('https://api.example.test/v1/models');
    expect(joinOpenAICompatibleUrl('https://api.example.test/proxy/v1', '/v1/chat/completions'))
      .toBe('https://api.example.test/proxy/v1/chat/completions');
    expect(joinOpenAICompatibleUrl('https://api.example.test/v1/chat/completions', '/v1/chat/completions'))
      .toBe('https://api.example.test/v1/chat/completions');
  });

  it('allows only explicit HTTP hosts and requires an allowlist in production', () => {
    expect(joinOpenAICompatibleUrl('http://host.docker.internal:20128/v1', '/v1/models'))
      .toBe('http://host.docker.internal:20128/v1/models');
    expect(() => joinOpenAICompatibleUrl('http://localhost:20128/v1', '/v1/models'))
      .toThrow('must use HTTPS');

    process.env.NODE_ENV = 'production';
    expect(() => joinOpenAICompatibleUrl('http://host.docker.internal:20128/v1', '/v1/models'))
      .toThrow('must use HTTPS');
    process.env.AI_PROVIDER_HTTP_HOST_ALLOWLIST = 'host.docker.internal';
    expect(joinOpenAICompatibleUrl('http://host.docker.internal:20128/v1', '/v1/models'))
      .toBe('http://host.docker.internal:20128/v1/models');
  });

  it('lists, de-duplicates and sorts models through /models', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'model-z' }, { id: 'model-a' }, { id: 'model-z' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

    await expect(listOpenAICompatibleModels({
      baseUrl: 'http://9router:20128/v1',
      apiKey: 'secret-key',
      vendor: '9router',
      fetchImpl,
    })).resolves.toEqual([
      { title: 'model-a', value: 'model-a' },
      { title: 'model-z', value: 'model-z' },
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('http://9router:20128/v1/models', expect.objectContaining({
      method: 'GET',
      redirect: 'error',
      headers: expect.objectContaining({ authorization: 'Bearer secret-key' }),
    }));
  });

  it('discovers models then sends a minimal non-stream completion probe', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'router-model' }] }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body)) as { model?: string; stream?: boolean };
      expect(body).toMatchObject({ model: 'router-model', stream: false });
      return new Response(JSON.stringify({
        id: 'req-1',
        choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await probeOpenAICompatibleConnection({
      baseUrl: 'http://9router:20128/v1',
      apiKey: 'secret-key',
      vendor: '9router',
      model: 'router-model',
      fetchImpl,
    });

    expect(result).toMatchObject({
      selectedModel: 'router-model',
      completionVerified: true,
      models: [{ title: 'router-model', value: 'router-model' }],
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'http://9router:20128/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      redirect: 'error',
    }));
  });

  it('normalizes an unexpected SSE completion response', async () => {
    const response = new Response([
      'data: {"id":"req-sse","choices":[{"delta":{"content":"O"}}]}',
      'data: {"choices":[{"delta":{"content":"K"},"finish_reason":"stop"}]}',
      'data: [DONE]',
      '',
    ].join('\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } });

    await expect(readOpenAICompatibleCompletion(response, '9router')).resolves.toMatchObject({
      id: 'req-sse',
      choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
    });
  });

  it('returns sanitized errors and never exposes upstream body, URL, or key', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      'upstream says key=secret-key at https://private.internal',
      { status: 401 },
    )) as unknown as typeof fetch;

    const error = await listOpenAICompatibleModels({
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'secret-key',
      vendor: '9router',
      fetchImpl,
    }).catch((caught: unknown) => caught);
    const serialized = JSON.stringify({
      name: (error as Error).name,
      message: (error as Error).message,
      code: (error as { code?: string }).code,
      provider: (error as { provider?: string }).provider,
    });

    expect(error).toMatchObject({ code: 'AUTHENTICATION', statusCode: 502, provider: '9router' });
    expect(serialized).not.toContain('secret-key');
    expect(serialized).not.toContain('private.internal');
    expect(serialized).not.toContain('upstream says');
  });

  it('normalizes AbortSignal timeout errors to a retryable timeout', () => {
    const upstream = Object.assign(new Error('secret upstream timeout detail'), { name: 'TimeoutError' });
    const error = normalizeOpenAICompatibleError(upstream, '9router');
    expect(error).toMatchObject({
      code: 'TIMEOUT',
      message: 'AI provider request timed out',
      retryable: true,
      statusCode: 504,
      provider: '9router',
    });
    expect(JSON.stringify(error)).not.toContain('secret upstream timeout detail');
  });

  it('uses redirect:error and sanitizes a redirect response without a second request', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://hostile.example/steal' },
    })) as unknown as typeof fetch;

    await expect(listOpenAICompatibleModels({
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'secret-key',
      vendor: '9router',
      fetchImpl,
    })).rejects.toMatchObject({ code: 'UNKNOWN', provider: '9router' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'error' }));
  });
});
