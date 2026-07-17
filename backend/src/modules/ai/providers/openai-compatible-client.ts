import { AIError, AIErrorHandler } from '../core/ai-error-handler.js';

export type OpenAICompatibleModel = { title: string; value: string };

export type OpenAICompatibleClientOptions = {
  baseUrl: string;
  apiKey: string;
  vendor?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type OpenAICompatibleProbeOptions = OpenAICompatibleClientOptions & {
  model?: string;
  modelsPath?: string;
  completionPath?: string;
};

export type OpenAICompatibleProbeResult = {
  models: OpenAICompatibleModel[];
  selectedModel: string;
  latencyMs: number;
  completionVerified: true;
};

export type OpenAICompatibleCompletionPayload = {
  id?: string;
  choices?: Array<{
    message?: { content?: string };
    delta?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEVELOPMENT_HTTP_HOSTS = ['host.docker.internal', '9router'] as const;
const TERMINAL_RESOURCE_SUFFIXES = [
  ['chat', 'completions'],
  ['models'],
] as const;

function safeVendor(vendor?: string): string {
  const value = (vendor || 'openai-compatible').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) ? value : 'openai-compatible';
}

/**
 * Validate the transport-level URL used by an OpenAI-compatible adapter.
 * HTTPS is required except for the two intentional Docker-local 9Router hosts.
 * Callers that accept arbitrary URLs should still apply their own DNS/IP SSRF policy.
 */
export function parseOpenAICompatibleBaseUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new AIError('CONFIGURATION', 'AI provider base URL is invalid', false, 400);
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new AIError('CONFIGURATION', 'AI provider base URL must not contain credentials, query, or fragment', false, 400);
  }
  const configuredHttpHosts = (
    process.env.AI_PROVIDER_HTTP_HOST_ALLOWLIST
    ?? process.env.AI_PROVIDER_HTTP_ALLOWLIST
    ?? ''
  )
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  const allowedHttpHosts = new Set(
    configuredHttpHosts.length > 0
      ? configuredHttpHosts
      : process.env.NODE_ENV === 'production' ? [] : DEVELOPMENT_HTTP_HOSTS,
  );
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowedHttpHosts.has(url.hostname.toLowerCase()))) {
    throw new AIError('CONFIGURATION', 'AI provider base URL must use HTTPS', false, 400);
  }
  return url;
}

function pathSegments(pathname: string): string[] {
  return pathname.split('/').map((part) => part.trim()).filter(Boolean);
}

function withoutTerminalResource(segments: string[]): string[] {
  for (const suffix of TERMINAL_RESOURCE_SUFFIXES) {
    if (segments.length >= suffix.length && suffix.every((part, index) => segments[segments.length - suffix.length + index] === part)) {
      return segments.slice(0, -suffix.length);
    }
  }
  return segments;
}

function overlapLength(left: string[], right: string[]): number {
  const limit = Math.min(left.length, right.length);
  for (let size = limit; size > 0; size -= 1) {
    if (left.slice(-size).every((part, index) => part === right[index])) return size;
  }
  return 0;
}

/**
 * Join an OpenAI-compatible base URL with a resource path without producing
 * `/v1/v1/...`. It also accepts a copied `/chat/completions` or `/models` URL.
 */
export function joinOpenAICompatibleUrl(baseUrl: string, resourcePath: string): string {
  const url = parseOpenAICompatibleBaseUrl(baseUrl);
  const target = pathSegments(resourcePath);
  if (target.length === 0) {
    url.pathname = `/${pathSegments(url.pathname).join('/')}`;
    return url.toString().replace(/\/$/, '');
  }

  const base = withoutTerminalResource(pathSegments(url.pathname));
  const overlap = overlapLength(base, target);
  url.pathname = `/${[...base, ...target.slice(overlap)].join('/')}`;
  return url.toString().replace(/\/$/, '');
}

/** Convert any upstream/network failure to a stable error without raw body, URL or key. */
export function normalizeOpenAICompatibleError(error: unknown, vendor?: string): AIError {
  const provider = safeVendor(vendor);
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new AIError('TIMEOUT', 'AI provider request timed out', true, 504, provider);
  }
  const normalized = AIErrorHandler.normalize(error, provider);
  return new AIError(
    normalized.code,
    normalized.message,
    normalized.retryable,
    normalized.statusCode,
    provider,
  );
}

function combinedAbortSignal(external: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeoutSignal]) : timeoutSignal;
}

function assertCredential(apiKey: string, vendor?: string): string {
  const value = apiKey.trim();
  if (!value) throw new AIError('CONFIGURATION', 'AI provider credential is not configured', false, 400, safeVendor(vendor));
  return value;
}

export async function requestOpenAICompatible(
  options: OpenAICompatibleClientOptions,
  resourcePath: string,
  init: Omit<RequestInit, 'signal'> = {},
): Promise<Response> {
  const vendor = safeVendor(options.vendor);
  const apiKey = assertCredential(options.apiKey, vendor);
  const timeoutMs = Math.max(250, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 120_000));
  const signal = combinedAbortSignal(options.signal, timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(joinOpenAICompatibleUrl(options.baseUrl, resourcePath), {
      ...init,
      // Never forward an Authorization header across an upstream redirect.
      redirect: 'error',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...init.headers,
      },
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw Object.assign(new Error('AI provider HTTP request failed'), { status: response.status });
    }
    return response;
  } catch (error) {
    throw normalizeOpenAICompatibleError(error, vendor);
  }
}

function invalidResponse(vendor?: string): AIError {
  return new AIError(
    'INVALID_RESPONSE',
    'AI provider returned an invalid response',
    false,
    502,
    safeVendor(vendor),
  );
}

function parseJsonObject(text: string): OpenAICompatibleCompletionPayload | null {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as OpenAICompatibleCompletionPayload
      : null;
  } catch {
    return null;
  }
}

/**
 * Normalize both regular JSON and providers that unexpectedly return SSE for
 * a non-stream completion request.
 */
export async function readOpenAICompatibleCompletion(
  response: Response,
  vendor?: string,
): Promise<OpenAICompatibleCompletionPayload> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    throw invalidResponse(vendor);
  }

  const direct = parseJsonObject(body.trim());
  if (direct) return direct;

  let id: string | undefined;
  let text = '';
  let finishReason: string | undefined;
  let usage: OpenAICompatibleCompletionPayload['usage'];
  let sawEvent = false;
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    const event = parseJsonObject(payload);
    if (!event) continue;
    sawEvent = true;
    id ||= event.id;
    text += event.choices?.[0]?.delta?.content ?? event.choices?.[0]?.message?.content ?? '';
    finishReason = event.choices?.[0]?.finish_reason ?? finishReason;
    usage = event.usage ?? usage;
  }
  if (!sawEvent) throw invalidResponse(vendor);
  return {
    id,
    choices: [{ message: { content: text }, finish_reason: finishReason }],
    usage,
  };
}

function toModels(ids: string[]): OpenAICompatibleModel[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
    .sort()
    .map((id) => ({ title: id, value: id }));
}

export async function listOpenAICompatibleModels(
  options: OpenAICompatibleClientOptions,
  modelsPath = '/v1/models',
): Promise<OpenAICompatibleModel[]> {
  const response = await requestOpenAICompatible(options, modelsPath, { method: 'GET' });
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw invalidResponse(options.vendor);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw invalidResponse(options.vendor);
  const raw = (data as { data?: unknown }).data;
  if (!Array.isArray(raw)) throw invalidResponse(options.vendor);
  return toModels(raw.map((item) => (
    typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string'
      ? (item as { id: string }).id
      : ''
  )));
}

export async function probeOpenAICompatibleConnection(
  options: OpenAICompatibleProbeOptions,
): Promise<OpenAICompatibleProbeResult> {
  const startedAt = Date.now();
  const models = await listOpenAICompatibleModels(options, options.modelsPath ?? '/v1/models');
  const requestedModel = options.model?.trim();
  const selectedModel = requestedModel || models[0]?.value;
  if (!selectedModel) throw invalidResponse(options.vendor);
  if (requestedModel && !models.some((model) => model.value === requestedModel)) {
    throw new AIError('INVALID_REQUEST', 'Selected AI model is not available', false, 400, safeVendor(options.vendor));
  }

  const response = await requestOpenAICompatible(options, options.completionPath ?? '/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: selectedModel,
      messages: [{ role: 'user', content: 'Reply with OK only.' }],
      max_completion_tokens: 16,
      stream: false,
    }),
  });
  const completion = await readOpenAICompatibleCompletion(response, options.vendor);
  if (!completion.choices?.length) throw invalidResponse(options.vendor);

  return {
    models,
    selectedModel,
    latencyMs: Math.max(0, Date.now() - startedAt),
    completionVerified: true,
  };
}
