import { randomUUID } from 'node:crypto';
import type { AIMessage, AIProviderRequest, AIProviderResponse, AIStructuredOutput, AIStreamEvent, AITokenUsage } from './ai-provider.js';
import { AIError, AIErrorHandler } from './ai-error-handler.js';
import { aiSafeLogger, AISafeLogger } from './ai-safe-logger.js';
import { ModelRegistry, type AIModelRuntimeConfig } from './model-registry.js';
import { AIUsageTracker, type AIUsageSummary } from './ai-usage-tracker.js';

export type AIClientRequest<T = unknown> = {
  orgId: string;
  modelConfigId: string;
  runId?: string;
  taskType: string;
  messages: AIMessage[];
  maxTokens?: number;
  temperature?: number;
  structuredOutput?: AIStructuredOutput & { validate?: (value: unknown) => value is T };
};

export type AIClientResponse<T = unknown> = {
  requestId: string;
  provider: string;
  model: string;
  text: string;
  structured?: T;
  finishReason?: string;
  usedFallback: boolean;
  usage: AIUsageSummary;
};

type CircuitState = { failures: number; openedAt?: number; halfOpen: boolean };
type RateState = { windowStartedAt: number; count: number };

export class AIClient {
  private readonly circuits = new Map<string, CircuitState>();
  private readonly rates = new Map<string, RateState>();

  constructor(
    private readonly registry: ModelRegistry,
    private readonly usageTracker = new AIUsageTracker(),
    private readonly safeLogger: AISafeLogger = aiSafeLogger,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  private key(orgId: string, config: AIModelRuntimeConfig) {
    return `${orgId}:${config.id}`;
  }

  private enforceRateLimit(orgId: string, config: AIModelRuntimeConfig) {
    const key = this.key(orgId, config);
    const now = this.now();
    const state = this.rates.get(key);
    if (!state || now - state.windowStartedAt >= 60_000) {
      this.rates.set(key, { windowStartedAt: now, count: 1 });
      return;
    }
    if (state.count >= config.rateLimitPerMinute) {
      throw new AIError('RATE_LIMITED', 'AI Core rate limit exceeded', true, 429, config.provider);
    }
    state.count += 1;
  }

  private assertCircuit(config: AIModelRuntimeConfig) {
    const key = this.key(config.orgId, config);
    const state = this.circuits.get(key);
    if (!state?.openedAt) return;
    if (this.now() - state.openedAt < config.circuitResetMs) {
      throw new AIError('CIRCUIT_OPEN', 'AI provider circuit is open', true, 503, config.provider);
    }
    state.halfOpen = true;
    state.openedAt = undefined;
  }

  private recordSuccess(config: AIModelRuntimeConfig) {
    this.circuits.set(this.key(config.orgId, config), { failures: 0, halfOpen: false });
  }

  private recordFailure(config: AIModelRuntimeConfig) {
    const key = this.key(config.orgId, config);
    const state = this.circuits.get(key) ?? { failures: 0, halfOpen: false };
    state.failures += 1;
    if (state.failures >= config.circuitFailureThreshold || state.halfOpen) state.openedAt = this.now();
    state.halfOpen = false;
    this.circuits.set(key, state);
  }

  private async callProvider(
    config: AIModelRuntimeConfig,
    request: Omit<AIProviderRequest, 'model' | 'signal'>,
  ): Promise<AIProviderResponse> {
    this.enforceRateLimit(config.orgId, config);
    this.assertCircuit(config);
    const provider = this.registry.provider(config.provider);
    let lastError: AIError | undefined;
    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const structuredInstruction = request.structuredOutput
          ? [{ role: 'system' as const, content: `Return JSON only. It must match this JSON Schema: ${JSON.stringify(request.structuredOutput.schema)}` }]
          : [];
        const response = await provider.complete({
          provider: config.provider,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
        }, { ...request, messages: [...structuredInstruction, ...request.messages], model: config.model, signal: controller.signal });
        this.recordSuccess(config);
        return response;
      } catch (error) {
        lastError = AIErrorHandler.normalize(error, config.provider);
        this.safeLogger.warn('provider_attempt_failed', {
          provider: config.provider,
          model: config.model,
          attempt: attempt + 1,
          errorCode: lastError.code,
        });
        if (!lastError.retryable || attempt === config.maxRetries) break;
        await this.sleep(Math.min(2_000, 100 * (2 ** attempt)));
      } finally {
        clearTimeout(timeout);
      }
    }
    this.recordFailure(config);
    throw lastError ?? new AIError('UNKNOWN', 'AI provider request failed', true, 502, config.provider);
  }

  private structured<T>(response: AIProviderResponse, output?: AIClientRequest<T>['structuredOutput']): T | undefined {
    if (!output) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch (error) {
      throw AIErrorHandler.normalize(error);
    }
    if (output.validate && !output.validate(parsed)) {
      throw new AIError('INVALID_RESPONSE', 'AI structured output failed validation', false, 502);
    }
    return parsed as T;
  }

  async complete<T = unknown>(request: AIClientRequest<T>): Promise<AIClientResponse<T>> {
    const requestId = randomUUID();
    const startedAt = this.now();
    const primary = await this.registry.resolve(request.orgId, request.modelConfigId);
    const contentHash = AISafeLogger.hashContent(request.messages.map((message) => message.content).join('\n'));
    this.safeLogger.info('request_started', {
      requestId, orgId: request.orgId, provider: primary.provider, model: primary.model, taskType: request.taskType, contentHash,
    });
    let selected = primary;
    let usedFallback = false;
    let response: AIProviderResponse;
    try {
      response = await this.callProvider(primary, {
        messages: request.messages,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        structuredOutput: request.structuredOutput,
      });
    } catch (primaryError) {
      const normalized = AIErrorHandler.normalize(primaryError, primary.provider);
      if (!primary.fallbackModelConfigId || !normalized.retryable) throw normalized;
      selected = await this.registry.resolve(request.orgId, primary.fallbackModelConfigId);
      if (selected.id === primary.id) throw normalized;
      usedFallback = true;
      this.safeLogger.warn('fallback_selected', {
        requestId, orgId: request.orgId, provider: selected.provider, model: selected.model, errorCode: normalized.code,
      });
      response = await this.callProvider(selected, {
        messages: request.messages,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        structuredOutput: request.structuredOutput,
      });
    }
    const latencyMs = this.now() - startedAt;
    const usage = await this.usageTracker.track({
      orgId: request.orgId,
      runId: request.runId,
      taskType: request.taskType,
      modelConfig: selected,
      usage: response.usage,
      latencyMs,
      providerRequestId: response.providerRequestId,
      status: 'ok',
    });
    const structured = this.structured<T>(response, request.structuredOutput);
    this.safeLogger.info('request_completed', {
      requestId, orgId: request.orgId, provider: selected.provider, model: selected.model,
      taskType: request.taskType, latencyMs, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, status: 'ok',
    });
    return {
      requestId,
      provider: selected.provider,
      model: selected.model,
      text: response.text,
      structured,
      finishReason: response.finishReason,
      usedFallback,
      usage,
    };
  }

  async *stream(request: AIClientRequest): AsyncIterable<AIStreamEvent> {
    const config = await this.registry.resolve(request.orgId, request.modelConfigId);
    const provider = this.registry.provider(config.provider);
    if (!provider.stream) throw new AIError('CONFIGURATION', 'Streaming is not supported by this provider', false, 400, config.provider);
    this.enforceRateLimit(request.orgId, config);
    this.assertCircuit(config);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const startedAt = this.now();
    let usage: AITokenUsage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
    try {
      for await (const event of provider.stream({
        provider: config.provider, baseUrl: config.baseUrl, apiKey: config.apiKey,
      }, {
        model: config.model,
        messages: request.messages,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        structuredOutput: request.structuredOutput,
        signal: controller.signal,
      })) {
        if (event.type === 'usage') usage = event.usage;
        yield event;
      }
      this.recordSuccess(config);
      await this.usageTracker.track({
        orgId: request.orgId, runId: request.runId, taskType: request.taskType,
        modelConfig: config, usage, latencyMs: this.now() - startedAt, status: 'ok',
      });
    } catch (error) {
      this.recordFailure(config);
      throw AIErrorHandler.normalize(error, config.provider);
    } finally {
      clearTimeout(timeout);
    }
  }
}
