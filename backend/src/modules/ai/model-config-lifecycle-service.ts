import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { ModelConfigError, type ModelConfigActor, type ModelConfigStatus } from './model-config-service.js';
import {
  ProviderConnectionError,
  testProviderConnection,
} from './provider-connection-service.js';
import {
  aiConfigState,
  modelAudit,
  modelRowOrThrow,
  providerConnectionOrThrow,
} from './model-config-manager-service.js';
import { dto, uniqueViolation } from './model-config-validation.js';

function providerError(error: unknown): ModelConfigError {
  if (error instanceof ProviderConnectionError) {
    return new ModelConfigError(error.message, error.statusCode, error.code);
  }
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; statusCode?: unknown; code?: unknown };
    if (typeof candidate.code === 'string') {
      return new ModelConfigError(
        typeof candidate.message === 'string' ? candidate.message : 'Model test failed',
        typeof candidate.statusCode === 'number' ? candidate.statusCode : 502,
        candidate.code,
      );
    }
  }
  return new ModelConfigError('Model test failed', 502, 'AI_MODEL_TEST_FAILED');
}

export async function testModelConfig(actor: ModelConfigActor, modelConfigId: string) {
  const current = await modelRowOrThrow(actor.orgId, modelConfigId);
  if (!['draft', 'testing'].includes(current.status)) {
    throw new ModelConfigError('Only draft or tested model configurations can be tested', 409, 'AI_MODEL_IMMUTABLE');
  }
  if (!current.connectionId) throw new ModelConfigError('Model has no provider connection', 409, 'AI_CONNECTION_MISSING');
  try {
    const tested = await testProviderConnection(actor, current.connectionId, { model: current.model });
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.aiModelConfig.updateMany({
        where: {
          id: modelConfigId,
          orgId: actor.orgId,
          deletedAt: null,
          revision: current.revision,
          status: { in: ['draft', 'testing'] },
        },
        data: { status: 'testing', revision: { increment: 1 } },
      });
      if (result.count !== 1) {
        throw new ModelConfigError('Model configuration was changed by another user', 409, 'AI_MODEL_REVISION_CONFLICT');
      }
      const row = await modelRowOrThrow(actor.orgId, modelConfigId, tx);
      await modelAudit(tx, actor, 'model_config.tested', modelConfigId, 'success', {
        externalModelId: current.model,
        latencyMs: tested.probe.latencyMs,
        completionVerified: tested.probe.completionVerified,
      });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const config = await aiConfigState(actor.orgId);
    return { modelConfig: dto(updated, config.defaultModelConfigId), probe: tested.probe };
  } catch (error) {
    const safe = providerError(error);
    await modelAudit(prisma, actor, 'model_config.tested', modelConfigId, 'failed', { errorCode: safe.code });
    throw safe;
  }
}

async function transition(
  actor: ModelConfigActor,
  modelConfigId: string,
  fromStatuses: readonly string[],
  targetStatus: ModelConfigStatus,
  eventType: string,
  extraData: Record<string, unknown> = {},
) {
  const current = await modelRowOrThrow(actor.orgId, modelConfigId);
  if (!fromStatuses.includes(current.status)) {
    throw new ModelConfigError(
      `Model cannot transition from ${current.status} to ${targetStatus}`,
      409,
      'AI_MODEL_STATUS_TRANSITION_INVALID',
    );
  }
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.aiModelConfig.updateMany({
      where: {
        id: modelConfigId,
        orgId: actor.orgId,
        deletedAt: null,
        revision: current.revision,
        status: { in: [...fromStatuses] },
      },
      data: { status: targetStatus, revision: { increment: 1 }, ...extraData },
    });
    if (result.count !== 1) {
      throw new ModelConfigError('Model configuration was changed by another user', 409, 'AI_MODEL_REVISION_CONFLICT');
    }
    const row = await modelRowOrThrow(actor.orgId, modelConfigId, tx);
    await modelAudit(tx, actor, eventType, modelConfigId, 'success', {
      fromStatus: current.status,
      toStatus: targetStatus,
      version: current.version,
    });
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const config = await aiConfigState(actor.orgId);
  return dto(updated, config.defaultModelConfigId);
}

export async function submitModelConfig(actor: ModelConfigActor, modelConfigId: string) {
  const current = await modelRowOrThrow(actor.orgId, modelConfigId);
  if (!current.connectionId) throw new ModelConfigError('Model has no provider connection', 409, 'AI_CONNECTION_MISSING');
  await providerConnectionOrThrow(actor.orgId, current.connectionId, { requireConnected: true });
  return transition(actor, modelConfigId, ['testing'], 'submitted', 'model_config.submitted');
}

export async function approveModelConfig(actor: ModelConfigActor, modelConfigId: string) {
  const current = await modelRowOrThrow(actor.orgId, modelConfigId);
  if (current.status !== 'submitted') {
    throw new ModelConfigError('Only a submitted model can be approved', 409, 'AI_MODEL_STATUS_TRANSITION_INVALID');
  }
  if (current.createdByUserId && current.createdByUserId === actor.userId) {
    throw new ModelConfigError(
      'The model creator cannot approve the same model version',
      409,
      'AI_MODEL_MAKER_CHECKER_REQUIRED',
    );
  }
  if (!current.connectionId) throw new ModelConfigError('Model has no provider connection', 409, 'AI_CONNECTION_MISSING');
  await providerConnectionOrThrow(actor.orgId, current.connectionId, { requireConnected: true });
  return transition(actor, modelConfigId, ['submitted'], 'approved', 'model_config.approved', {
    approvedByUserId: actor.userId,
    approvedAt: new Date(),
  });
}

function snapshotContainsModelConfig(value: unknown, modelConfigId: string): boolean {
  if (value === modelConfigId) return true;
  if (Array.isArray(value)) return value.some((item) => snapshotContainsModelConfig(item, modelConfigId));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, nested]) => (
      (key === 'modelConfigId' && nested === modelConfigId)
      || snapshotContainsModelConfig(nested, modelConfigId)
    ));
  }
  return false;
}

export async function getModelConfigImpact(orgId: string, modelConfigId: string) {
  await modelRowOrThrow(orgId, modelConfigId);
  const [agents, runs, evaluationRuns, fallbackFor, defaults, releases] = await Promise.all([
    prisma.aiAgent.findMany({
      where: { orgId, modelConfigId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, status: true },
    }),
    prisma.aiRun.count({ where: { orgId, modelConfigId } }),
    prisma.aiEvaluationRun.count({ where: { orgId, modelConfigId } }),
    prisma.aiModelConfig.count({ where: { orgId, fallbackModelConfigId: modelConfigId, deletedAt: null } }),
    prisma.aiConfig.count({ where: { orgId, defaultModelConfigId: modelConfigId } }),
    prisma.aiRelease.findMany({
      where: { orgId },
      select: { id: true, version: true, status: true, snapshot: true },
    }),
  ]);
  const linkedReleases = releases
    .filter((release) => snapshotContainsModelConfig(release.snapshot, modelConfigId))
    .map(({ id, version, status }) => ({ id, version, status }));
  const blockingReleases = linkedReleases.filter((release) => ['approved', 'deployed'].includes(release.status));
  const blockingReasons = [
    ...(agents.length ? ['agents'] : []),
    ...(fallbackFor ? ['fallback_models'] : []),
    ...(defaults ? ['default_model'] : []),
    ...(blockingReleases.length ? ['live_releases'] : []),
  ];
  return {
    modelConfigId,
    canArchive: blockingReasons.length === 0,
    blockingReasons,
    counts: {
      agents: agents.length,
      runs,
      evaluationRuns,
      fallbackFor,
      defaultForAiConfigs: defaults,
      releases: linkedReleases.length,
      liveReleases: blockingReleases.length,
    },
    agents,
    releases: linkedReleases,
  };
}

export async function archiveModelConfig(actor: ModelConfigActor, modelConfigId: string) {
  const impact = await getModelConfigImpact(actor.orgId, modelConfigId);
  if (!impact.canArchive) {
    throw new ModelConfigError(
      `Model configuration is still in use: ${impact.blockingReasons.join(', ')}`,
      409,
      'AI_MODEL_IN_USE',
    );
  }
  return transition(
    actor,
    modelConfigId,
    ['draft', 'testing', 'submitted', 'approved'],
    'archived',
    'model_config.archived',
    { archivedAt: new Date() },
  );
}

export async function setDefaultModelConfig(
  actor: ModelConfigActor,
  modelConfigId: string,
  expectedRevision: unknown,
) {
  const model = await modelRowOrThrow(actor.orgId, modelConfigId);
  if (model.status !== 'approved') {
    throw new ModelConfigError('Only an approved model can be set as default', 409, 'AI_MODEL_NOT_APPROVED');
  }
  if (!model.connectionId) throw new ModelConfigError('Model has no provider connection', 409, 'AI_CONNECTION_MISSING');
  await providerConnectionOrThrow(actor.orgId, model.connectionId, { requireConnected: true });
  const normalizedExpected = expectedRevision === null ? null : String(expectedRevision ?? '');
  if (normalizedExpected !== null && !normalizedExpected) {
    throw new ModelConfigError('expectedRevision is required', 400, 'AI_CONFIG_REVISION_REQUIRED');
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.aiConfig.findUnique({
      where: { orgId: actor.orgId },
      select: { id: true, defaultModelConfigId: true, updatedAt: true },
    });
    if (current) {
      if (normalizedExpected !== current.updatedAt.toISOString()) {
        throw new ModelConfigError('AI configuration was changed by another user', 409, 'AI_CONFIG_REVISION_CONFLICT');
      }
      const result = await tx.aiConfig.updateMany({
        where: { orgId: actor.orgId, updatedAt: current.updatedAt },
        data: { defaultModelConfigId: modelConfigId },
      });
      if (result.count !== 1) {
        throw new ModelConfigError('AI configuration was changed by another user', 409, 'AI_CONFIG_REVISION_CONFLICT');
      }
    } else {
      if (normalizedExpected !== null) {
        throw new ModelConfigError('AI configuration was changed by another user', 409, 'AI_CONFIG_REVISION_CONFLICT');
      }
      try {
        await tx.aiConfig.create({ data: { orgId: actor.orgId, defaultModelConfigId: modelConfigId } });
      } catch (error) {
        if (uniqueViolation(error)) {
          throw new ModelConfigError('AI configuration was changed by another user', 409, 'AI_CONFIG_REVISION_CONFLICT');
        }
        throw error;
      }
    }
    await modelAudit(tx, actor, 'model_config.default_changed', modelConfigId, 'success', {
      previousModelConfigId: current?.defaultModelConfigId ?? null,
    });
    return aiConfigState(actor.orgId, tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
