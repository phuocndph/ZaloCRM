/* Reconcile the legacy F5Quota settings with the V2 Copilot registry. */
import { prisma } from '../dist/shared/database/prisma-client.js';
import { decryptToken } from '../dist/modules/integrations/_shared/token-encryption.util.js';
import {
  createProviderConnection,
  setProviderConnectionSecret,
  updateProviderConnection,
  testProviderConnection,
} from '../dist/modules/ai/provider-connection-service.js';
import { createModelConfig } from '../dist/modules/ai/model-config-manager-service.js';
import {
  testModelConfig,
  submitModelConfig,
  approveModelConfig,
  setDefaultModelConfig,
} from '../dist/modules/ai/model-config-lifecycle-service.js';

const MODEL = process.env.AI_F5QUOTA_MODEL || 'gpt-5.4';
const CONNECTION_KEY = process.env.AI_F5QUOTA_CONNECTION_KEY || 'f5quota-primary';
const MODEL_KEY = process.env.AI_F5QUOTA_MODEL_KEY || 'f5quota-chat-cskh';

function secretFromSetting(setting) {
  if (!setting) return '';
  if (setting.valueEncrypted) {
    try { return decryptToken(Buffer.from(setting.valueEncrypted).toString('utf8')); } catch { return ''; }
  }
  return setting.valuePlain?.trim() || '';
}

try {
  const actorUser = await prisma.user.findFirst({
    where: { role: { in: ['owner', 'admin'] }, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, orgId: true },
  });
  if (!actorUser) throw new Error('No active owner/admin is available for the AI reconciliation.');
  const actor = { orgId: actorUser.orgId, userId: actorUser.id };
  const checkerUser = await prisma.user.findFirst({
    where: { orgId: actor.orgId, isActive: true, id: { not: actor.userId } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!checkerUser) throw new Error('A second active user is required to approve the AI model.');
  const setting = await prisma.appSetting.findUnique({
    where: { orgId_settingKey: { orgId: actor.orgId, settingKey: 'ai_f5quota_api_key' } },
    select: { valueEncrypted: true, valuePlain: true },
  });
  const apiKey = secretFromSetting(setting);
  if (!apiKey) throw new Error('The saved F5Quota API key cannot be decrypted.');

  let connection = await prisma.aiProviderConnection.findFirst({
    where: { orgId: actor.orgId, key: CONNECTION_KEY, deletedAt: null },
    select: { id: true, vendor: true, baseUrl: true, status: true, apiKeyLast4: true },
  });
  if (!connection) {
    connection = await createProviderConnection(actor, {
      key: CONNECTION_KEY,
      name: 'F5Quota',
      adapter: 'openai_compatible',
      vendor: 'f5quota',
      baseUrl: 'https://f5quota.store/v1',
    });
  } else if (connection.vendor !== 'f5quota' || connection.baseUrl !== 'https://f5quota.store/v1') {
    await updateProviderConnection(actor, connection.id, {
      name: 'F5Quota',
      adapter: 'openai_compatible',
      vendor: 'f5quota',
      baseUrl: 'https://f5quota.store/v1',
    });
  }
  await setProviderConnectionSecret(actor, connection.id, apiKey);
  const connectionTest = await testProviderConnection(actor, connection.id, { model: MODEL });
  if (!connectionTest.probe.completionVerified) throw new Error('F5Quota connection did not verify a chat completion.');

  let model = await prisma.aiModelConfig.findFirst({
    where: { orgId: actor.orgId, key: MODEL_KEY, deletedAt: null },
    select: { id: true, status: true, connectionId: true, model: true },
  });
  if (!model) {
    model = await createModelConfig(actor, {
      connectionId: connection.id,
      logicalKey: MODEL_KEY,
      displayName: `F5Quota CSKH · ${MODEL}`,
      externalModelId: MODEL,
      parameters: { temperature: 0.2, maxTokens: 700, timeoutMs: 30000, maxRetries: 2, rateLimitPerMinute: 60 },
      capabilities: { chat: true },
      dataPolicy: { allowSensitiveData: false, requireHumanReview: true },
      changeNote: 'Reconcile F5Quota cho Copilot',
    });
    model = await prisma.aiModelConfig.findUniqueOrThrow({ where: { id: model.id }, select: { id: true, status: true, connectionId: true, model: true } });
  }
  if (model.connectionId !== connection.id || model.model !== MODEL) {
    throw new Error(`Model ${MODEL_KEY} is already bound to a different provider or model.`);
  }
  if (model.status === 'draft' || model.status === 'testing') {
    await testModelConfig(actor, model.id);
    model = await prisma.aiModelConfig.findUniqueOrThrow({ where: { id: model.id }, select: { id: true, status: true, connectionId: true, model: true } });
  }
  if (model.status === 'testing') {
    await submitModelConfig(actor, model.id);
    model = await prisma.aiModelConfig.findUniqueOrThrow({ where: { id: model.id }, select: { id: true, status: true, connectionId: true, model: true } });
  }
  if (model.status === 'submitted') {
    await approveModelConfig({ orgId: actor.orgId, userId: checkerUser.id }, model.id);
    model = await prisma.aiModelConfig.findUniqueOrThrow({ where: { id: model.id }, select: { id: true, status: true, connectionId: true, model: true } });
  }
  if (model.status !== 'approved') throw new Error(`F5Quota model is not approved (${model.status}).`);

  const currentConfig = await prisma.aiConfig.findUnique({ where: { orgId: actor.orgId }, select: { updatedAt: true } });
  await setDefaultModelConfig(actor, model.id, currentConfig?.updatedAt?.toISOString() ?? null);

  // Keep the active agent metadata aligned. Runtime also reads the org default,
  // so this direct repair does not require a risky deactivate/activate cycle.
  await prisma.aiAgent.updateMany({
    where: { orgId: actor.orgId, key: 'cskh-sample-agent', status: 'active', deletedAt: null },
    data: { modelConfigId: model.id },
  });
  process.stdout.write(JSON.stringify({
    orgId: actor.orgId,
    connectionId: connection.id,
    connectionStatus: 'connected',
    modelConfigId: model.id,
    model: MODEL,
    completionVerified: connectionTest.probe.completionVerified,
  }) + '\n');
} finally {
  await prisma.$disconnect();
}
