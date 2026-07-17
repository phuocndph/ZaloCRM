import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { decryptToken, encryptToken } from '../integrations/_shared/token-encryption.util.js';
import { getProviderConfig } from './provider-registry.js';
import { normalizeProviderBaseUrl } from './provider-connection-service.js';
import { providerCredentialEnvironmentKey } from './provider-credential-env.js';

type BridgeDb = Pick<
  typeof prisma,
  'aiConfig' | 'appSetting' | 'aiProviderConnection' | 'aiModelConfig' | 'aiAuditLog'
>;

export type LegacyAiBridgeOutcome = {
  orgId: string;
  status: 'created' | 'already_configured' | 'skipped';
  reason?: string;
  connectionId?: string;
  modelConfigId?: string;
  connectionCreated: boolean;
  modelCreated: boolean;
};

export type LegacyAiBridgeBackfillResult = {
  scanned: number;
  bridged: number;
  alreadyConfigured: number;
  skipped: number;
  failed: Array<{ orgId: string; code: string }>;
};

const LEGACY_CHANGE_NOTE = 'Legacy AiConfig compatibility bridge; requires provider connection test before readiness.';

function legacyConnectionKey(provider: string): string {
  const safe = provider.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return `legacy-${safe || 'provider'}`;
}

function legacyModelKey(provider: string, model: string): string {
  const safe = provider.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  const digest = createHash('sha256').update(model).digest('hex').slice(0, 16);
  return `legacy-default-${safe || 'provider'}-${digest}`;
}

function providerAdapter(adapter: string): string {
  return adapter === 'openai-compatible' ? 'openai_compatible' : adapter;
}

function modelName(providerName: string, model: string): string {
  return `${providerName} · ${model}`.slice(0, 160);
}

function skip(orgId: string, reason: string): LegacyAiBridgeOutcome {
  return {
    orgId,
    status: 'skipped',
    reason,
    connectionCreated: false,
    modelCreated: false,
  };
}

function secretMaterial(setting: { valueEncrypted?: Uint8Array | null; valuePlain?: string | null } | undefined) {
  if (setting?.valueEncrypted) {
    try {
      const encrypted = Buffer.from(setting.valueEncrypted);
      const plaintext = decryptToken(encrypted.toString('utf8'));
      if (plaintext) return { encrypted, last4: plaintext.slice(-4) };
    } catch {
      // A corrupt legacy blob is not copied. Runtime may still use an explicit
      // environment credential, but a persistent connection must fail closed.
    }
  }
  const plaintext = setting?.valuePlain?.trim();
  if (!plaintext) return null;
  return {
    encrypted: Buffer.from(encryptToken(plaintext), 'utf8'),
    last4: plaintext.slice(-4),
  };
}

async function bridgeWithDb(orgId: string, db: BridgeDb): Promise<LegacyAiBridgeOutcome> {
  const config = await db.aiConfig.findUnique({
    where: { orgId },
    select: {
      id: true,
      provider: true,
      model: true,
      defaultModelConfigId: true,
    },
  });
  if (!config) return skip(orgId, 'legacy_config_missing');
  if (config.defaultModelConfigId) {
    return {
      orgId,
      status: 'already_configured',
      connectionId: undefined,
      modelConfigId: config.defaultModelConfigId,
      connectionCreated: false,
      modelCreated: false,
    };
  }

  const provider = config.provider?.trim().toLowerCase();
  const model = config.model?.trim();
  const definition = provider ? getProviderConfig(provider) : undefined;
  if (!provider || !definition) return skip(orgId, 'provider_unsupported');
  if (!model) return skip(orgId, 'model_missing');

  const apiKeySettingKey = `ai_${provider}_api_key`;
  const baseUrlSettingKey = `ai_${provider}_base_url`;
  const settings = await db.appSetting.findMany({
    where: { orgId, settingKey: { in: [apiKeySettingKey, baseUrlSettingKey] } },
    select: { settingKey: true, valuePlain: true, valueEncrypted: true },
  });
  const apiKeySetting = settings.find((item) => item.settingKey === apiKeySettingKey);
  const baseUrlSetting = settings.find((item) => item.settingKey === baseUrlSettingKey);
  const rawBaseUrl = baseUrlSetting?.valuePlain?.trim() || definition.baseUrl;
  let baseUrl: string;
  try {
    baseUrl = normalizeProviderBaseUrl(rawBaseUrl, definition.vendor);
  } catch {
    return skip(orgId, 'base_url_invalid');
  }
  const secret = secretMaterial(apiKeySetting);

  const connectionKey = legacyConnectionKey(provider);
  let connection = await db.aiProviderConnection.findFirst({
    where: { orgId, key: connectionKey },
    select: { id: true, deletedAt: true, apiKeyEncrypted: true },
  });
  if (connection?.deletedAt) return skip(orgId, 'legacy_connection_deleted');

  let connectionCreated = false;
  if (!connection) {
    connection = await db.aiProviderConnection.create({
      data: {
        orgId,
        key: connectionKey,
        name: `${definition.name} (legacy)`.slice(0, 160),
        adapter: providerAdapter(definition.adapter),
        vendor: definition.vendor,
        baseUrl,
        apiKeyEncrypted: secret?.encrypted ?? null,
        apiKeyLast4: secret?.last4 ?? null,
        status: secret ? 'needs_test' : 'draft',
      },
      select: { id: true, deletedAt: true, apiKeyEncrypted: true },
    });
    connectionCreated = true;
  }

  const modelKey = legacyModelKey(provider, model);
  let modelConfig = await db.aiModelConfig.findFirst({
    where: { orgId, key: modelKey, version: 1 },
    select: { id: true, deletedAt: true },
  });
  if (modelConfig?.deletedAt) return skip(orgId, 'legacy_model_deleted');

  let modelCreated = false;
  if (!modelConfig) {
    const hasPersistentSecret = Boolean(connection.apiKeyEncrypted);
    const environmentKey = providerCredentialEnvironmentKey(provider);
    modelConfig = await db.aiModelConfig.create({
      data: {
        orgId,
        connectionId: hasPersistentSecret ? connection.id : null,
        key: modelKey,
        name: modelName(definition.name, model),
        provider,
        model,
        version: 1,
        revision: 1,
        credentialRef: hasPersistentSecret ? null : `env:${environmentKey}`,
        parameters: {
          baseUrl,
          timeoutMs: 30_000,
          maxRetries: 2,
          rateLimitPerMinute: 60,
          circuitFailureThreshold: 5,
          circuitResetMs: 30_000,
        },
        capabilities: { chat: true },
        dataPolicy: {},
        status: 'active',
        changeNote: LEGACY_CHANGE_NOTE,
      },
      select: { id: true, deletedAt: true },
    });
    modelCreated = true;
  }

  const assigned = await db.aiConfig.updateMany({
    where: { orgId, defaultModelConfigId: null },
    data: { defaultModelConfigId: modelConfig.id },
  });
  if (assigned.count > 0) {
    await db.aiAuditLog.create({
      data: {
        orgId,
        eventType: 'legacy_ai_config.bridged',
        outcome: 'success',
        targetType: 'ai_model_config',
        targetId: modelConfig.id,
        metadata: {
          provider,
          connectionId: connection.id,
          persistentCredentialCopied: Boolean(connection.apiKeyEncrypted),
        },
      },
    });
  }

  return {
    orgId,
    status: assigned.count > 0 || connectionCreated || modelCreated ? 'created' : 'already_configured',
    connectionId: connection.id,
    modelConfigId: modelConfig.id,
    connectionCreated,
    modelCreated,
  };
}

/**
 * Idempotently convert one organization's legacy AiConfig into the V2 model
 * registry. Existing V2 defaults and soft-deleted bridge records are respected.
 */
export async function bridgeLegacyAiConfiguration(
  orgId: string,
  db: BridgeDb = prisma,
): Promise<LegacyAiBridgeOutcome> {
  if (db !== prisma) return bridgeWithDb(orgId, db);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`zalocrm:ai-legacy-bridge:${orgId}`}))::text AS lock_result`,
    );
    return bridgeWithDb(orgId, tx as BridgeDb);
  }, { maxWait: 15_000, timeout: 60_000 });
}

function publicFailureCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code ?? '');
    if (/^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return code;
  }
  return 'AI_LEGACY_BRIDGE_FAILED';
}

/** Best-effort bounded bootstrap backfill. Failure details never contain secrets. */
export async function backfillLegacyAiConfigurations(options: { batchSize?: number } = {}): Promise<LegacyAiBridgeBackfillResult> {
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 100, 500));
  const result: LegacyAiBridgeBackfillResult = {
    scanned: 0,
    bridged: 0,
    alreadyConfigured: 0,
    skipped: 0,
    failed: [],
  };
  let cursor: string | undefined;

  while (true) {
    const rows = await prisma.aiConfig.findMany({
      where: { defaultModelConfigId: null },
      select: { id: true, orgId: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;

    for (const row of rows) {
      result.scanned += 1;
      try {
        const outcome = await bridgeLegacyAiConfiguration(row.orgId);
        if (outcome.status === 'created') result.bridged += 1;
        else if (outcome.status === 'already_configured') result.alreadyConfigured += 1;
        else result.skipped += 1;
      } catch (error) {
        result.failed.push({ orgId: row.orgId, code: publicFailureCode(error) });
      }
    }

    cursor = rows[rows.length - 1]?.id;
    if (!cursor || rows.length < batchSize) break;
  }
  return result;
}

