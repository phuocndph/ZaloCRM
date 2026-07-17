import { prisma } from '../../../shared/database/prisma-client.js';
import { AIError } from './ai-error-handler.js';
import type { AIProvider } from './ai-provider.js';
import { parseOpenAICompatibleBaseUrl } from '../providers/openai-compatible-client.js';
import { getProviderConnectionRuntime } from '../provider-connection-service.js';
import { providerCredentialEnvironmentKey } from '../provider-credential-env.js';

export type AIModelRuntimeConfig = {
  id: string;
  orgId: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  rateLimitPerMinute: number;
  circuitFailureThreshold: number;
  circuitResetMs: number;
  fallbackModelConfigId?: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cachedInputCostPerMillion: number;
  parameters: Record<string, unknown>;
};

export type StoredModelConfig = {
  id: string;
  orgId: string;
  name: string;
  provider: string;
  model: string;
  connectionId?: string | null;
  credentialRef: string | null;
  fallbackModelConfigId?: string | null;
  parameters: unknown;
  dataPolicy: unknown;
  status: string;
};

export type ModelConfigRepository = {
  find(orgId: string, id: string): Promise<StoredModelConfig | null>;
};

export type ProviderConnectionRuntime = {
  id: string;
  adapter: string;
  vendor: string;
  baseUrl: string;
  apiKey: string;
};

export type ProviderConnectionRuntimeResolver = (
  orgId: string,
  connectionId: string,
) => Promise<ProviderConnectionRuntime>;

const prismaRepository: ModelConfigRepository = {
  find: (orgId, id) => prisma.aiModelConfig.findFirst({
    where: { id, orgId, deletedAt: null },
    select: {
      id: true,
      orgId: true,
      name: true,
      provider: true,
      model: true,
      connectionId: true,
      credentialRef: true,
      fallbackModelConfigId: true,
      parameters: true,
      dataPolicy: true,
      status: true,
    },
  }),
};

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export class ModelRegistry {
  private readonly providers = new Map<string, AIProvider>();

  constructor(
    private readonly repository: ModelConfigRepository = prismaRepository,
    private readonly connectionRuntime: ProviderConnectionRuntimeResolver = getProviderConnectionRuntime,
  ) {}

  registerProvider(provider: AIProvider): this {
    this.providers.set(provider.id, provider);
    return this;
  }

  provider(providerId: string): AIProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new AIError('CONFIGURATION', `AI provider is not registered: ${providerId}`, false, 400, providerId);
    return provider;
  }

  async resolve(orgId: string, modelConfigId: string): Promise<AIModelRuntimeConfig> {
    const stored = await this.repository.find(orgId, modelConfigId);
    if (!stored) throw new AIError('CONFIGURATION', 'AI model configuration not found', false, 404);
    if (!['active', 'approved'].includes(stored.status)) throw new AIError('CONFIGURATION', 'AI model configuration is not active', false, 400, stored.provider);
    this.provider(stored.provider);
    const parameters = objectValue(stored.parameters);
    const policy = objectValue(stored.dataPolicy);
    let apiKey: string;
    let baseUrl: string;
    if (stored.connectionId) {
      // A model attached to a managed connection is fail-closed. Missing,
      // revoked, disabled or undecryptable persistent credentials must never
      // be hidden by an environment fallback.
      try {
        const connection = await this.connectionRuntime(orgId, stored.connectionId);
        apiKey = connection.apiKey;
        baseUrl = connection.baseUrl;
      } catch (error) {
        const candidateCode = error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code ?? 'AI_CONNECTION_UNAVAILABLE')
          : 'AI_CONNECTION_UNAVAILABLE';
        const code = /^[A-Z][A-Z0-9_]{1,63}$/.test(candidateCode)
          ? candidateCode : 'AI_CONNECTION_UNAVAILABLE';
        throw new AIError(
          'CONFIGURATION',
          `AI provider connection is unavailable (${code})`,
          false,
          400,
          stored.provider,
        );
      }
    } else {
      const keyName = providerCredentialEnvironmentKey(stored.provider, stored.credentialRef);
      apiKey = process.env[keyName] ?? '';
      if (!apiKey) {
        throw new AIError(
          'CONFIGURATION',
          `AI credential environment variable is not configured: ${keyName}`,
          false,
          400,
          stored.provider,
        );
      }
      baseUrl = String(parameters.baseUrl ?? '');
    }
    if (stored.provider === 'openai-compatible' || stored.provider === 'openai' || stored.provider === 'qwen' || stored.provider === 'kimi' || stored.provider === '9router') {
      parseOpenAICompatibleBaseUrl(baseUrl);
    } else if (!/^https:\/\//i.test(baseUrl)) {
      throw new AIError('CONFIGURATION', 'AI model baseUrl must use HTTPS', false, 400, stored.provider);
    }
    return {
      id: stored.id,
      orgId: stored.orgId,
      name: stored.name,
      provider: stored.provider,
      model: stored.model,
      baseUrl,
      apiKey,
      timeoutMs: numberValue(parameters.timeoutMs, 30_000, 1_000, 120_000),
      maxRetries: numberValue(parameters.maxRetries, 2, 0, 5),
      rateLimitPerMinute: numberValue(parameters.rateLimitPerMinute, 60, 1, 10_000),
      circuitFailureThreshold: numberValue(parameters.circuitFailureThreshold, 5, 1, 100),
      circuitResetMs: numberValue(parameters.circuitResetMs, 30_000, 1_000, 600_000),
      fallbackModelConfigId: stored.fallbackModelConfigId
        ?? (typeof parameters.fallbackModelConfigId === 'string' ? parameters.fallbackModelConfigId : undefined),
      inputCostPerMillion: numberValue(parameters.inputCostPerMillion, 0, 0, 1_000_000),
      outputCostPerMillion: numberValue(parameters.outputCostPerMillion, 0, 0, 1_000_000),
      cachedInputCostPerMillion: numberValue(parameters.cachedInputCostPerMillion, 0, 0, 1_000_000),
      parameters: { ...parameters, dataPolicy: policy },
    };
  }
}
