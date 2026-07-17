import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import {
  MODEL_CONFIG_STATUSES,
  ModelConfigError,
  type CreateModelConfigInput,
  type ModelConfigActor,
  type ModelConfigStatus,
  type UpdateModelConfigInput,
} from './model-config-service.js';
import {
  MODEL_CONFIG_SELECT,
  changeNote,
  connectionId,
  displayName,
  dto,
  expectedRevision,
  externalModelId,
  inputJson,
  jsonObject,
  logicalKey,
  optionalId,
  uniqueViolation,
  type JsonObject,
} from './model-config-validation.js';

type AuditDb = { aiAuditLog: { create(args: any): Promise<unknown> } };

export async function modelAudit(
  db: AuditDb,
  actor: ModelConfigActor,
  eventType: string,
  modelConfigId: string,
  outcome: 'success' | 'failed',
  metadata: JsonObject = {},
) {
  await db.aiAuditLog.create({
    data: {
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType,
      outcome,
      targetType: 'ai_model_config',
      targetId: modelConfigId,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

export async function aiConfigState(orgId: string, db: any = prisma) {
  const config = await db.aiConfig.findUnique({
    where: { orgId },
    select: { defaultModelConfigId: true, updatedAt: true },
  });
  return {
    defaultModelConfigId: config?.defaultModelConfigId ?? null,
    aiConfigRevision: config?.updatedAt?.toISOString() ?? null,
  };
}

export async function modelRowOrThrow(orgId: string, modelConfigId: string, db: any = prisma) {
  const row = await db.aiModelConfig.findFirst({
    where: { id: modelConfigId, orgId, deletedAt: null },
    select: MODEL_CONFIG_SELECT,
  });
  if (!row) throw new ModelConfigError('Model configuration not found', 404, 'AI_MODEL_NOT_FOUND');
  return row;
}

export async function providerConnectionOrThrow(
  orgId: string,
  id: string,
  options: { requireConnected?: boolean } = {},
) {
  const connection = await prisma.aiProviderConnection.findFirst({
    where: { id, orgId, deletedAt: null },
    select: { id: true, key: true, name: true, vendor: true, status: true },
  });
  if (!connection) throw new ModelConfigError('Provider connection not found', 404, 'AI_CONNECTION_NOT_FOUND');
  if (connection.status === 'disabled') {
    throw new ModelConfigError('Provider connection is disabled', 409, 'AI_CONNECTION_DISABLED');
  }
  if (options.requireConnected && connection.status !== 'connected') {
    throw new ModelConfigError('Provider connection must pass its connection test first', 409, 'AI_CONNECTION_NOT_VERIFIED');
  }
  return connection;
}

export async function validateFallback(orgId: string, fallbackId: string | null, currentId?: string) {
  if (!fallbackId) return;
  if (fallbackId === currentId) {
    throw new ModelConfigError('A model cannot fall back to itself', 400, 'AI_MODEL_FALLBACK_INVALID');
  }
  const fallback = await prisma.aiModelConfig.findFirst({
    where: { id: fallbackId, orgId, deletedAt: null, status: 'approved' },
    select: { id: true },
  });
  if (!fallback) {
    throw new ModelConfigError('Fallback model must be approved in this organization', 400, 'AI_MODEL_FALLBACK_INVALID');
  }
}

export async function listModelConfigs(
  orgId: string,
  options: { status?: string; connectionId?: string; search?: string } = {},
) {
  const status = MODEL_CONFIG_STATUSES.includes(options.status as ModelConfigStatus)
    ? options.status as ModelConfigStatus
    : undefined;
  const search = options.search?.trim().slice(0, 120);
  const filterConnectionId = options.connectionId?.trim().slice(0, 128);
  const [rows, config] = await Promise.all([
    prisma.aiModelConfig.findMany({
      where: {
        orgId,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(filterConnectionId ? { connectionId: filterConnectionId } : {}),
        ...(search ? {
          OR: [
            { key: { contains: search, mode: 'insensitive' } },
            { name: { contains: search, mode: 'insensitive' } },
            { model: { contains: search, mode: 'insensitive' } },
          ],
        } : {}),
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }, { version: 'desc' }],
      select: MODEL_CONFIG_SELECT,
    }),
    aiConfigState(orgId),
  ]);
  return { modelConfigs: rows.map((row) => dto(row, config.defaultModelConfigId)), ...config };
}

export async function getModelConfig(orgId: string, modelConfigId: string) {
  const [row, config] = await Promise.all([
    modelRowOrThrow(orgId, modelConfigId),
    aiConfigState(orgId),
  ]);
  return dto(row, config.defaultModelConfigId);
}

export async function createModelConfig(actor: ModelConfigActor, input: CreateModelConfigInput) {
  const cleanConnectionId = connectionId(input.connectionId);
  const cleanLogicalKey = logicalKey(input.logicalKey);
  const cleanDisplayName = displayName(input.displayName);
  const cleanModelId = externalModelId(input.externalModelId);
  const parameters = jsonObject(input.parameters, 'parameters');
  const capabilities = jsonObject(input.capabilities, 'capabilities');
  const dataPolicy = jsonObject(input.dataPolicy, 'dataPolicy');
  const fallbackModelConfigId = optionalId(input.fallbackModelConfigId, 'fallback_model_config_id');
  const cleanChangeNote = changeNote(input.changeNote);
  const connection = await providerConnectionOrThrow(actor.orgId, cleanConnectionId, { requireConnected: true });
  await validateFallback(actor.orgId, fallbackModelConfigId);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.aiModelConfig.findFirst({
        where: { orgId: actor.orgId, key: cleanLogicalKey, deletedAt: null },
        select: { id: true },
      });
      if (existing) {
        throw new ModelConfigError(
          'logicalKey already exists; clone the existing model to create a new version',
          409,
          'AI_MODEL_LOGICAL_KEY_EXISTS',
        );
      }
      const row = await tx.aiModelConfig.create({
        data: {
          orgId: actor.orgId,
          connectionId: cleanConnectionId,
          key: cleanLogicalKey,
          name: cleanDisplayName,
          provider: connection.vendor,
          model: cleanModelId,
          version: 1,
          revision: 1,
          parameters: inputJson(parameters),
          capabilities: inputJson(capabilities),
          dataPolicy: inputJson(dataPolicy),
          status: 'draft',
          fallbackModelConfigId,
          changeNote: cleanChangeNote,
          createdByUserId: actor.userId,
        },
        select: MODEL_CONFIG_SELECT,
      });
      await modelAudit(tx, actor, 'model_config.created', row.id, 'success', {
        logicalKey: cleanLogicalKey,
        connectionId: cleanConnectionId,
        externalModelId: cleanModelId,
        version: 1,
      });
      return row;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return dto(created, null);
  } catch (error) {
    if (uniqueViolation(error)) {
      throw new ModelConfigError('logicalKey already exists', 409, 'AI_MODEL_LOGICAL_KEY_EXISTS');
    }
    throw error;
  }
}
