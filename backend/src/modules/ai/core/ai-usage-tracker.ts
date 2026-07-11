import { prisma } from '../../../shared/database/prisma-client.js';
import type { AITokenUsage } from './ai-provider.js';
import type { AIModelRuntimeConfig } from './model-registry.js';
import { aiSafeLogger } from './ai-safe-logger.js';

export type AIUsageEvent = {
  orgId: string;
  runId?: string;
  taskType: string;
  modelConfig: AIModelRuntimeConfig;
  usage: AITokenUsage;
  latencyMs: number;
  providerRequestId?: string;
  status: string;
};

export type AIUsageSummary = AITokenUsage & {
  costMicros: bigint;
  latencyMs: number;
};

export type UsageRepository = {
  create(event: AIUsageEvent, costMicros: bigint): Promise<void>;
};

const prismaUsageRepository: UsageRepository = {
  async create(event, costMicros) {
    if (!event.runId) return;
    await prisma.aiUsageRecord.create({
      data: {
        orgId: event.orgId,
        runId: event.runId,
        provider: event.modelConfig.provider,
        model: event.modelConfig.model,
        taskType: event.taskType,
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
        cachedInputTokens: event.usage.cachedInputTokens,
        costMicros,
        latencyMs: event.latencyMs,
        providerRequestId: event.providerRequestId,
        status: event.status,
      },
    });
  },
};

export class AIUsageTracker {
  constructor(private readonly repository: UsageRepository = prismaUsageRepository) {}

  calculate(config: AIModelRuntimeConfig, usage: AITokenUsage, latencyMs: number): AIUsageSummary {
    const cost =
      usage.inputTokens * config.inputCostPerMillion +
      usage.outputTokens * config.outputCostPerMillion +
      usage.cachedInputTokens * config.cachedInputCostPerMillion;
    return { ...usage, costMicros: BigInt(Math.max(0, Math.round(cost))), latencyMs };
  }

  async track(event: AIUsageEvent): Promise<AIUsageSummary> {
    const summary = this.calculate(event.modelConfig, event.usage, event.latencyMs);
    try {
      await this.repository.create(event, summary.costMicros);
    } catch (error) {
      aiSafeLogger.error('usage_tracking_failed', {
        orgId: event.orgId,
        provider: event.modelConfig.provider,
        model: event.modelConfig.model,
        errorCode: error instanceof Error ? error.name : 'unknown',
      });
    }
    return summary;
  }
}
