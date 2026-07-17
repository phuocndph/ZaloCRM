import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { ModelConfigError, type ModelConfigActor, type UpdateModelConfigInput } from './model-config-service.js';
import {
  aiConfigState,
  modelAudit,
  modelRowOrThrow,
  providerConnectionOrThrow,
  validateFallback,
} from './model-config-manager-service.js';
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
  type JsonObject,
} from './model-config-validation.js';

export async function updateModelConfig(
  actor: ModelConfigActor,
  modelConfigId: string,
  input: UpdateModelConfigInput,
) {
  const current = await modelRowOrThrow(actor.orgId, modelConfigId);
  if (!['draft', 'testing'].includes(current.status)) {
    throw new ModelConfigError('Only draft or tested model configurations can be edited', 409, 'AI_MODEL_IMMUTABLE');
  }
  const revision = expectedRevision(input.expectedRevision);
  if (revision !== current.revision) {
    throw new ModelConfigError('Model configuration was changed by another user', 409, 'AI_MODEL_REVISION_CONFLICT');
  }
  const cleanConnectionId = input.connectionId === undefined ? current.connectionId : connectionId(input.connectionId);
  if (!cleanConnectionId) throw new ModelConfigError('connectionId is required', 400, 'AI_MODEL_CONNECTION_ID_REQUIRED');
  const cleanLogicalKey = input.logicalKey === undefined ? current.key : logicalKey(input.logicalKey);
  if (!cleanLogicalKey) throw new ModelConfigError('logicalKey is required', 400, 'AI_MODEL_LOGICAL_KEY_REQUIRED');
  const cleanDisplayName = input.displayName === undefined ? current.name : displayName(input.displayName);
  const cleanModelId = input.externalModelId === undefined ? current.model : externalModelId(input.externalModelId);
  const parameters = input.parameters === undefined ? current.parameters as JsonObject : jsonObject(input.parameters, 'parameters');
  const capabilities = input.capabilities === undefined ? current.capabilities as JsonObject : jsonObject(input.capabilities, 'capabilities');
  const dataPolicy = input.dataPolicy === undefined ? current.dataPolicy as JsonObject : jsonObject(input.dataPolicy, 'dataPolicy');
  const fallbackModelConfigId = input.fallbackModelConfigId === undefined
    ? current.fallbackModelConfigId
    : optionalId(input.fallbackModelConfigId, 'fallback_model_config_id');
  const cleanChangeNote = input.changeNote === undefined ? current.changeNote : changeNote(input.changeNote);
  const connection = await providerConnectionOrThrow(actor.orgId, cleanConnectionId, { requireConnected: true });
  await validateFallback(actor.orgId, fallbackModelConfigId, modelConfigId);
  const runtimeChanged = cleanConnectionId !== current.connectionId
    || cleanModelId !== current.model
    || connection.vendor !== current.provider;

  const updated = await prisma.$transaction(async (tx) => {
    if (cleanLogicalKey !== current.key) {
      const duplicate = await tx.aiModelConfig.findFirst({
        where: { orgId: actor.orgId, key: cleanLogicalKey, deletedAt: null, NOT: { id: modelConfigId } },
        select: { id: true },
      });
      if (duplicate) throw new ModelConfigError('logicalKey already exists', 409, 'AI_MODEL_LOGICAL_KEY_EXISTS');
    }
    const changedFields = [
      ...(cleanConnectionId !== current.connectionId ? ['connectionId'] : []),
      ...(cleanLogicalKey !== current.key ? ['logicalKey'] : []),
      ...(cleanDisplayName !== current.name ? ['displayName'] : []),
      ...(cleanModelId !== current.model ? ['externalModelId'] : []),
      ...(JSON.stringify(parameters) !== JSON.stringify(current.parameters) ? ['parameters'] : []),
      ...(JSON.stringify(capabilities) !== JSON.stringify(current.capabilities) ? ['capabilities'] : []),
      ...(JSON.stringify(dataPolicy) !== JSON.stringify(current.dataPolicy) ? ['dataPolicy'] : []),
      ...(fallbackModelConfigId !== current.fallbackModelConfigId ? ['fallbackModelConfigId'] : []),
      ...(cleanChangeNote !== current.changeNote ? ['changeNote'] : []),
    ];
    if (!changedFields.length) return current;
    const result = await tx.aiModelConfig.updateMany({
      where: {
        id: modelConfigId,
        orgId: actor.orgId,
        deletedAt: null,
        revision,
        status: { in: ['draft', 'testing'] },
      },
      data: {
        connectionId: cleanConnectionId,
        key: cleanLogicalKey,
        name: cleanDisplayName,
        provider: connection.vendor,
        model: cleanModelId,
        parameters: inputJson(parameters),
        capabilities: inputJson(capabilities),
        dataPolicy: inputJson(dataPolicy),
        fallbackModelConfigId,
        changeNote: cleanChangeNote,
        status: runtimeChanged ? 'draft' : current.status,
        revision: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new ModelConfigError('Model configuration was changed by another user', 409, 'AI_MODEL_REVISION_CONFLICT');
    }
    const row = await modelRowOrThrow(actor.orgId, modelConfigId, tx);
    await modelAudit(tx, actor, 'model_config.updated', modelConfigId, 'success', { changedFields, runtimeChanged });
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const config = await aiConfigState(actor.orgId);
  return dto(updated, config.defaultModelConfigId);
}

export async function cloneModelConfig(
  actor: ModelConfigActor,
  modelConfigId: string,
  input: { changeNote?: unknown } = {},
) {
  const source = await modelRowOrThrow(actor.orgId, modelConfigId);
  const cleanChangeNote = changeNote(input.changeNote) ?? `Cloned from version ${source.version}`;
  const cleanLogicalKey = source.key ?? `model-${source.id.slice(0, 8)}`;
  const cloned = await prisma.$transaction(async (tx) => {
    const latest = await tx.aiModelConfig.findFirst({
      where: { orgId: actor.orgId, key: cleanLogicalKey, deletedAt: null },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = Math.max(source.version, latest?.version ?? 0) + 1;
    const row = await tx.aiModelConfig.create({
      data: {
        orgId: actor.orgId,
        connectionId: source.connectionId,
        key: cleanLogicalKey,
        name: source.name,
        provider: source.provider,
        model: source.model,
        version,
        revision: 1,
        parameters: source.parameters as Prisma.InputJsonValue,
        capabilities: source.capabilities as Prisma.InputJsonValue,
        dataPolicy: source.dataPolicy as Prisma.InputJsonValue,
        status: 'draft',
        fallbackModelConfigId: source.fallbackModelConfigId,
        changeNote: cleanChangeNote,
        createdByUserId: actor.userId,
      },
      select: MODEL_CONFIG_SELECT,
    });
    await modelAudit(tx, actor, 'model_config.cloned', row.id, 'success', {
      sourceModelConfigId: source.id,
      logicalKey: cleanLogicalKey,
      version,
    });
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return dto(cloned, null);
}
