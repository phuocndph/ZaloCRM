import { Prisma } from '@prisma/client';
import { isIP } from 'node:net';
import { prisma } from '../../shared/database/prisma-client.js';
import { decryptToken, encryptToken } from '../integrations/_shared/token-encryption.util.js';
import {
  listOpenAICompatibleModels,
  normalizeOpenAICompatibleError,
  probeOpenAICompatibleConnection,
} from './providers/openai-compatible-client.js';

export const PROVIDER_CONNECTION_STATUSES = ['draft', 'needs_test', 'connected', 'failed', 'disabled'] as const;
export type ProviderConnectionStatus = (typeof PROVIDER_CONNECTION_STATUSES)[number];

export const PROVIDER_CONNECTION_ADAPTERS = ['openai_compatible'] as const;
export type ProviderConnectionAdapter = (typeof PROVIDER_CONNECTION_ADAPTERS)[number];

export type ProviderConnectionActor = { orgId: string; userId: string };

export type CreateProviderConnectionInput = {
  key?: string;
  name?: string;
  adapter?: string;
  vendor?: string;
  baseUrl?: string;
};

export type UpdateProviderConnectionInput = {
  name?: string;
  adapter?: string;
  vendor?: string;
  baseUrl?: string;
  status?: string;
};

export type ProviderConnectionTestResult = {
  success: boolean;
  status: string;
  latencyMs?: number | null;
  errorCode?: string | null;
};

export class ProviderConnectionError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'AI_PROVIDER_CONNECTION_ERROR',
  ) {
    super(message);
    this.name = 'ProviderConnectionError';
  }
}

// Prisma's tenant extension changes the transaction-client generic signature;
// keep the audit dependency structural instead of widening the whole service DB.
type Db = { aiAuditLog: { create(args: any): Promise<unknown> } };
type JsonObject = Record<string, unknown>;

const CONNECTION_SELECT = {
  id: true,
  key: true,
  name: true,
  adapter: true,
  vendor: true,
  baseUrl: true,
  apiKeyLast4: true,
  credentialVersion: true,
  status: true,
  lastTestStatus: true,
  lastTestedAt: true,
  lastLatencyMs: true,
  lastErrorCode: true,
  createdByUserId: true,
  updatedByUserId: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      modelConfigs: { where: { deletedAt: null } },
    },
  },
} as const;

function cleanName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProviderConnectionError('Connection name is required', 400, 'AI_CONNECTION_NAME_REQUIRED');
  }
  const name = value.trim();
  if (name.length > 160) {
    throw new ProviderConnectionError('Connection name is too long', 400, 'AI_CONNECTION_NAME_INVALID');
  }
  return name;
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function cleanKey(value: unknown, fallback: string): string {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : slug(fallback);
  if (!/^[a-z0-9][a-z0-9_.-]{1,79}$/.test(candidate)) {
    throw new ProviderConnectionError('Connection key is invalid', 400, 'AI_CONNECTION_KEY_INVALID');
  }
  return candidate;
}

function cleanAdapter(value: unknown): ProviderConnectionAdapter {
  const normalized = value === 'openai-compatible' ? 'openai_compatible' : String(value ?? '').trim();
  if (!PROVIDER_CONNECTION_ADAPTERS.includes(normalized as ProviderConnectionAdapter)) {
    throw new ProviderConnectionError(
      'Only the OpenAI-compatible adapter is supported in this release',
      400,
      'AI_CONNECTION_ADAPTER_UNSUPPORTED',
    );
  }
  return normalized as ProviderConnectionAdapter;
}

function cleanVendor(value: unknown): string {
  const vendor = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{1,63}$/.test(vendor)) {
    throw new ProviderConnectionError('Connection vendor is invalid', 400, 'AI_CONNECTION_VENDOR_INVALID');
  }
  return vendor;
}

function exactHttpHostAllowlist(): ReadonlySet<string> {
  const configured = process.env.AI_PROVIDER_HTTP_HOST_ALLOWLIST
    ?? process.env.AI_PROVIDER_HTTP_ALLOWLIST
    ?? (process.env.NODE_ENV === 'production' ? '' : 'host.docker.internal,9router');
  return new Set(configured.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean));
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return false;
  const [a, b] = octets;
  return a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a === 0;
}

function isLocalOrPrivateHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  const isIpv6 = normalized.includes(':');
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '::1'
    || (isIpv6 && normalized.startsWith('fc'))
    || (isIpv6 && normalized.startsWith('fd'))
    || (isIpv6 && normalized.startsWith('fe8'))
    || (isIpv6 && normalized.startsWith('fe9'))
    || (isIpv6 && normalized.startsWith('fea'))
    || (isIpv6 && normalized.startsWith('feb'))
    || isIP(normalized) === 6
    || isPrivateIpv4(normalized);
}

/**
 * Validate and canonicalize an administrator-supplied provider base URL.
 * HTTP is intentionally limited to the local 9Router deployment hosts. The
 * adapter must still apply redirect and DNS/IP checks when it opens a socket.
 */
export function normalizeProviderBaseUrl(value: unknown, vendor: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048) {
    throw new ProviderConnectionError('Provider base URL is required', 400, 'AI_BASE_URL_INVALID');
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ProviderConnectionError('Provider base URL is invalid', 400, 'AI_BASE_URL_INVALID');
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new ProviderConnectionError('Provider base URL must use HTTPS', 400, 'AI_BASE_URL_SCHEME_DENIED');
  }
  if (parsed.username || parsed.password) {
    throw new ProviderConnectionError('Credentials are not allowed in the provider URL', 400, 'AI_BASE_URL_CREDENTIALS_DENIED');
  }
  if (parsed.search || parsed.hash) {
    throw new ProviderConnectionError('Query strings and fragments are not allowed in the provider URL', 400, 'AI_BASE_URL_COMPONENT_DENIED');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const explicitlyAllowed = exactHttpHostAllowlist().has(hostname);
  if (isLocalOrPrivateHost(hostname) && !explicitlyAllowed) {
    throw new ProviderConnectionError('Local or private provider hosts are not allowed', 400, 'AI_BASE_URL_HOST_DENIED');
  }
  if (parsed.protocol === 'http:' && (vendor !== '9router' || !explicitlyAllowed)) {
    throw new ProviderConnectionError(
      'HTTP is only allowed for an approved 9Router host',
      400,
      'AI_BASE_URL_HTTP_DENIED',
    );
  }

  parsed.hostname = hostname;
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
}

function cleanSecret(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ProviderConnectionError('API key is required', 400, 'AI_SECRET_REQUIRED');
  }
  const secret = value.trim();
  if (!secret || secret.length > 8_192 || /[\u0000-\u001f\u007f]/.test(secret)) {
    throw new ProviderConnectionError('API key is invalid', 400, 'AI_SECRET_INVALID');
  }
  return secret;
}

function dto(row: any) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    adapter: row.adapter,
    vendor: row.vendor,
    baseUrl: row.baseUrl,
    apiKeyConfigured: Boolean(row.apiKeyLast4),
    apiKeyLast4: row.apiKeyLast4 ?? null,
    credentialVersion: row.credentialVersion,
    status: row.status,
    lastTestStatus: row.lastTestStatus ?? null,
    lastTestedAt: row.lastTestedAt ?? null,
    lastLatencyMs: row.lastLatencyMs ?? null,
    lastErrorCode: row.lastErrorCode ?? null,
    createdByUserId: row.createdByUserId ?? null,
    updatedByUserId: row.updatedByUserId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    modelConfigCount: Number(row._count?.modelConfigs ?? 0),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'P2002');
}

async function audit(
  db: Db,
  actor: ProviderConnectionActor,
  eventType: string,
  connectionId: string,
  outcome: 'success' | 'failed',
  metadata: JsonObject = {},
) {
  await db.aiAuditLog.create({
    data: {
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType,
      outcome,
      targetType: 'ai_provider_connection',
      targetId: connectionId,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

async function rowOrThrow(orgId: string, connectionId: string) {
  const row = await prisma.aiProviderConnection.findFirst({
    where: { id: connectionId, orgId, deletedAt: null },
    select: CONNECTION_SELECT,
  });
  if (!row) {
    throw new ProviderConnectionError('Provider connection not found', 404, 'AI_CONNECTION_NOT_FOUND');
  }
  return row;
}

async function secretRowOrThrow(orgId: string, connectionId: string) {
  const row = await prisma.aiProviderConnection.findFirst({
    where: { id: connectionId, orgId, deletedAt: null },
    select: {
      ...CONNECTION_SELECT,
      apiKeyEncrypted: true,
    },
  });
  if (!row) {
    throw new ProviderConnectionError('Provider connection not found', 404, 'AI_CONNECTION_NOT_FOUND');
  }
  return row;
}

export async function listProviderConnections(
  orgId: string,
  options: { status?: string; vendor?: string; search?: string } = {},
) {
  const status = PROVIDER_CONNECTION_STATUSES.includes(options.status as ProviderConnectionStatus)
    ? options.status as ProviderConnectionStatus
    : undefined;
  const vendor = options.vendor?.trim().toLowerCase();
  const search = options.search?.trim().slice(0, 120);
  const rows = await prisma.aiProviderConnection.findMany({
    where: {
      orgId,
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(vendor ? { vendor } : {}),
      ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { key: { contains: search, mode: 'insensitive' } }] } : {}),
    },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    select: CONNECTION_SELECT,
  });
  return rows.map(dto);
}

export async function getProviderConnection(orgId: string, connectionId: string) {
  return dto(await rowOrThrow(orgId, connectionId));
}

export async function createProviderConnection(actor: ProviderConnectionActor, input: CreateProviderConnectionInput) {
  const name = cleanName(input.name);
  const adapter = cleanAdapter(input.adapter ?? 'openai_compatible');
  const vendor = cleanVendor(input.vendor ?? 'custom');
  const key = cleanKey(input.key, `${vendor}-${name}`);
  const baseUrl = normalizeProviderBaseUrl(input.baseUrl, vendor);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.aiProviderConnection.findFirst({
        where: { orgId: actor.orgId, key },
        select: { id: true },
      });
      if (duplicate) {
        throw new ProviderConnectionError('Connection key already exists', 409, 'AI_CONNECTION_KEY_EXISTS');
      }
      const connection = await tx.aiProviderConnection.create({
        data: {
          orgId: actor.orgId,
          key,
          name,
          adapter,
          vendor,
          baseUrl,
          status: 'draft',
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
        select: CONNECTION_SELECT,
      });
      await audit(tx, actor, 'provider_connection.created', connection.id, 'success', {
        key,
        adapter,
        vendor,
      });
      return connection;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return dto(created);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ProviderConnectionError('Connection key already exists', 409, 'AI_CONNECTION_KEY_EXISTS');
    }
    throw error;
  }
}

export async function updateProviderConnection(
  actor: ProviderConnectionActor,
  connectionId: string,
  input: UpdateProviderConnectionInput,
) {
  const current = await rowOrThrow(actor.orgId, connectionId);
  const name = input.name === undefined ? current.name : cleanName(input.name);
  const adapter = input.adapter === undefined ? current.adapter : cleanAdapter(input.adapter);
  const vendor = input.vendor === undefined ? current.vendor : cleanVendor(input.vendor);
  const baseUrl = input.baseUrl === undefined
    ? current.baseUrl
    : normalizeProviderBaseUrl(input.baseUrl, vendor);
  let requestedStatus: 'draft' | 'disabled' | undefined;
  if (input.status !== undefined) {
    if (!['draft', 'disabled'].includes(input.status)) {
      throw new ProviderConnectionError('Connected status can only be set by a successful test', 400, 'AI_CONNECTION_STATUS_INVALID');
    }
    requestedStatus = input.status as 'draft' | 'disabled';
  }
  const runtimeChanged = adapter !== current.adapter || vendor !== current.vendor || baseUrl !== current.baseUrl;
  const resetTestState = runtimeChanged || requestedStatus === 'draft';
  const changedFields = [
    ...(name !== current.name ? ['name'] : []),
    ...(adapter !== current.adapter ? ['adapter'] : []),
    ...(vendor !== current.vendor ? ['vendor'] : []),
    ...(baseUrl !== current.baseUrl ? ['baseUrl'] : []),
    ...(requestedStatus && requestedStatus !== current.status ? ['status'] : []),
  ];
  if (!changedFields.length) return dto(current);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.aiProviderConnection.updateMany({
      where: { id: connectionId, orgId: actor.orgId, deletedAt: null },
      data: {
        name,
        adapter,
        vendor,
        baseUrl,
        status: requestedStatus
          ?? (current.status === 'disabled' ? 'disabled' : runtimeChanged ? 'needs_test' : current.status),
        ...(resetTestState
          ? { lastTestStatus: null, lastTestedAt: null, lastLatencyMs: null, lastErrorCode: null }
          : {}),
        updatedByUserId: actor.userId,
      },
    });
    const row = await tx.aiProviderConnection.findFirst({
      where: { id: connectionId, orgId: actor.orgId, deletedAt: null },
      select: CONNECTION_SELECT,
    });
    if (!row) throw new ProviderConnectionError('Provider connection not found', 404, 'AI_CONNECTION_NOT_FOUND');
    await audit(tx, actor, 'provider_connection.updated', connectionId, 'success', { changedFields });
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return dto(updated);
}

export async function setProviderConnectionSecret(
  actor: ProviderConnectionActor,
  connectionId: string,
  apiKey: unknown,
) {
  const secret = cleanSecret(apiKey);
  const current = await secretRowOrThrow(actor.orgId, connectionId);
  const encrypted = new TextEncoder().encode(encryptToken(secret));
  const credentialVersion = current.apiKeyEncrypted
    ? current.credentialVersion + 1
    : current.credentialVersion;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.aiProviderConnection.updateMany({
      where: { id: connectionId, orgId: actor.orgId, deletedAt: null },
      data: {
        apiKeyEncrypted: encrypted,
        apiKeyLast4: secret.slice(-4),
        credentialVersion,
        status: current.status === 'disabled' ? 'disabled' : 'needs_test',
        lastTestStatus: null,
        lastTestedAt: null,
        lastLatencyMs: null,
        lastErrorCode: null,
        updatedByUserId: actor.userId,
      },
    });
    const row = await tx.aiProviderConnection.findFirst({
      where: { id: connectionId, orgId: actor.orgId, deletedAt: null },
      select: CONNECTION_SELECT,
    });
    if (!row) throw new ProviderConnectionError('Provider connection not found', 404, 'AI_CONNECTION_NOT_FOUND');
    await audit(tx, actor, 'provider_connection.secret_rotated', connectionId, 'success', { credentialVersion });
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return dto(updated);
}

export async function revokeProviderConnectionSecret(actor: ProviderConnectionActor, connectionId: string) {
  const current = await secretRowOrThrow(actor.orgId, connectionId);
  if (!current.apiKeyEncrypted) return dto(current);
  const credentialVersion = current.credentialVersion + 1;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.aiProviderConnection.updateMany({
      where: { id: connectionId, orgId: actor.orgId, deletedAt: null },
      data: {
        apiKeyEncrypted: null,
        apiKeyLast4: null,
        credentialVersion,
        status: current.status === 'disabled' ? 'disabled' : 'draft',
        lastTestStatus: null,
        lastTestedAt: null,
        lastLatencyMs: null,
        lastErrorCode: 'AI_SECRET_MISSING',
        updatedByUserId: actor.userId,
      },
    });
    const row = await tx.aiProviderConnection.findFirst({
      where: { id: connectionId, orgId: actor.orgId, deletedAt: null },
      select: CONNECTION_SELECT,
    });
    if (!row) throw new ProviderConnectionError('Provider connection not found', 404, 'AI_CONNECTION_NOT_FOUND');
    await audit(tx, actor, 'provider_connection.secret_revoked', connectionId, 'success', { credentialVersion });
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return dto(updated);
}

/** Internal runtime-only resolver. Never return this value from an HTTP route. */
export async function getProviderConnectionSecret(orgId: string, connectionId: string): Promise<string> {
  const current = await secretRowOrThrow(orgId, connectionId);
  if (!current.apiKeyEncrypted) {
    throw new ProviderConnectionError('Provider API key has not been configured', 409, 'AI_SECRET_MISSING');
  }
  try {
    return decryptToken(Buffer.from(current.apiKeyEncrypted).toString('utf8'));
  } catch {
    throw new ProviderConnectionError('Provider API key could not be decrypted', 500, 'AI_SECRET_UNAVAILABLE');
  }
}

export async function getProviderConnectionRuntime(orgId: string, connectionId: string) {
  const current = await secretRowOrThrow(orgId, connectionId);
  if (current.status === 'disabled') {
    throw new ProviderConnectionError('Provider connection is disabled', 409, 'AI_CONNECTION_DISABLED');
  }
  if (!current.apiKeyEncrypted) {
    throw new ProviderConnectionError('Provider API key has not been configured', 409, 'AI_SECRET_MISSING');
  }
  let apiKey: string;
  try {
    apiKey = decryptToken(Buffer.from(current.apiKeyEncrypted).toString('utf8'));
  } catch {
    throw new ProviderConnectionError('Provider API key could not be decrypted', 500, 'AI_SECRET_UNAVAILABLE');
  }
  return {
    id: current.id,
    key: current.key,
    adapter: current.adapter,
    vendor: current.vendor,
    baseUrl: current.baseUrl,
    apiKey,
    credentialVersion: current.credentialVersion,
  };
}

const PROVIDER_ERROR_CODES: Record<string, string> = {
  AUTHENTICATION: 'AI_CONNECTION_AUTH_FAILED',
  RATE_LIMITED: 'AI_CONNECTION_RATE_LIMITED',
  TIMEOUT: 'AI_CONNECTION_TIMEOUT',
  PROVIDER_UNAVAILABLE: 'AI_CONNECTION_UNREACHABLE',
  INVALID_REQUEST: 'AI_CONNECTION_REQUEST_REJECTED',
  INVALID_RESPONSE: 'AI_CONNECTION_INVALID_RESPONSE',
  CIRCUIT_OPEN: 'AI_CONNECTION_CIRCUIT_OPEN',
  CONFIGURATION: 'AI_CONNECTION_CONFIGURATION_INVALID',
  UNKNOWN: 'AI_CONNECTION_TEST_FAILED',
};

const PROVIDER_HEALTH_STATUSES: Record<string, string> = {
  AUTHENTICATION: 'auth_failed',
  RATE_LIMITED: 'rate_limited',
  TIMEOUT: 'timeout',
  PROVIDER_UNAVAILABLE: 'unreachable',
  INVALID_REQUEST: 'request_rejected',
  INVALID_RESPONSE: 'invalid_response',
  CIRCUIT_OPEN: 'circuit_open',
  CONFIGURATION: 'configuration_error',
  UNKNOWN: 'failed',
};

function publicProviderError(error: unknown, vendor: string) {
  const normalized = normalizeOpenAICompatibleError(error, vendor);
  return {
    error: new ProviderConnectionError(
      normalized.message,
      normalized.statusCode,
      PROVIDER_ERROR_CODES[normalized.code] ?? 'AI_CONNECTION_TEST_FAILED',
    ),
    healthStatus: PROVIDER_HEALTH_STATUSES[normalized.code] ?? 'failed',
  };
}

export async function discoverProviderConnectionModels(orgId: string, connectionId: string) {
  const runtime = await getProviderConnectionRuntime(orgId, connectionId);
  if (runtime.adapter !== 'openai_compatible') {
    throw new ProviderConnectionError(
      'Provider connection adapter is not supported',
      400,
      'AI_CONNECTION_ADAPTER_UNSUPPORTED',
    );
  }
  try {
    const models = await listOpenAICompatibleModels({
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
      vendor: runtime.vendor,
    });
    return {
      connectionId: runtime.id,
      models: models.slice(0, 1_000),
      truncated: models.length > 1_000,
    };
  } catch (error) {
    throw publicProviderError(error, runtime.vendor).error;
  }
}

export async function testProviderConnection(
  actor: ProviderConnectionActor,
  connectionId: string,
  input: { model?: unknown } = {},
) {
  const runtime = await getProviderConnectionRuntime(actor.orgId, connectionId);
  if (runtime.adapter !== 'openai_compatible') {
    throw new ProviderConnectionError(
      'Provider connection adapter is not supported',
      400,
      'AI_CONNECTION_ADAPTER_UNSUPPORTED',
    );
  }
  if (input.model !== undefined && input.model !== null && typeof input.model !== 'string') {
    throw new ProviderConnectionError('Model identifier is invalid', 400, 'AI_MODEL_ID_INVALID');
  }
  const model = typeof input.model === 'string' && input.model.trim()
    ? input.model.trim()
    : undefined;
  if (model && model.length > 256) {
    throw new ProviderConnectionError('Model identifier is invalid', 400, 'AI_MODEL_ID_INVALID');
  }
  const startedAt = Date.now();
  let probe: Awaited<ReturnType<typeof probeOpenAICompatibleConnection>>;
  try {
    probe = await probeOpenAICompatibleConnection({
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
      vendor: runtime.vendor,
      model,
    });
  } catch (error) {
    const failure = publicProviderError(error, runtime.vendor);
    await recordProviderConnectionTest(actor, connectionId, {
      success: false,
      status: failure.healthStatus,
      latencyMs: Math.max(0, Date.now() - startedAt),
      errorCode: failure.error.code,
    });
    throw failure.error;
  }
  const connection = await recordProviderConnectionTest(actor, connectionId, {
    success: true,
    status: 'healthy',
    latencyMs: probe.latencyMs,
    errorCode: null,
  });
  return {
    connection,
    probe: {
      models: probe.models.slice(0, 1_000),
      modelsTruncated: probe.models.length > 1_000,
      selectedModel: probe.selectedModel,
      latencyMs: probe.latencyMs,
      completionVerified: probe.completionVerified,
    },
  };
}

export async function recordProviderConnectionTest(
  actor: ProviderConnectionActor,
  connectionId: string,
  result: ProviderConnectionTestResult,
) {
  const current = await rowOrThrow(actor.orgId, connectionId);
  if (current.status === 'disabled') {
    throw new ProviderConnectionError('Provider connection is disabled', 409, 'AI_CONNECTION_DISABLED');
  }
  const latencyMs = result.latencyMs == null
    ? null
    : Math.max(0, Math.min(300_000, Math.round(result.latencyMs)));
  const status = String(result.status || (result.success ? 'healthy' : 'failed')).slice(0, 64);
  const errorCode = result.success ? null : String(result.errorCode || 'AI_PROVIDER_UNAVAILABLE').slice(0, 120);
  const testedAt = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    await tx.aiProviderConnection.updateMany({
      where: { id: connectionId, orgId: actor.orgId, deletedAt: null },
      data: {
        status: result.success ? 'connected' : 'failed',
        lastTestStatus: status,
        lastTestedAt: testedAt,
        lastLatencyMs: latencyMs,
        lastErrorCode: errorCode,
        updatedByUserId: actor.userId,
      },
    });
    const row = await tx.aiProviderConnection.findFirst({
      where: { id: connectionId, orgId: actor.orgId, deletedAt: null },
      select: CONNECTION_SELECT,
    });
    if (!row) throw new ProviderConnectionError('Provider connection not found', 404, 'AI_CONNECTION_NOT_FOUND');
    await audit(
      tx,
      actor,
      'provider_connection.tested',
      connectionId,
      result.success ? 'success' : 'failed',
      { status, latencyMs, errorCode },
    );
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return dto(updated);
}

export async function getProviderConnectionImpact(orgId: string, connectionId: string) {
  await rowOrThrow(orgId, connectionId);
  const modelConfigs = await prisma.aiModelConfig.findMany({
    where: { orgId, connectionId, deletedAt: null },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      key: true,
      name: true,
      provider: true,
      model: true,
      status: true,
      agents: {
        where: { deletedAt: null },
        select: { id: true },
      },
    },
  });
  const agentIds = new Set<string>();
  for (const model of modelConfigs) {
    for (const agent of model.agents) agentIds.add(agent.id);
  }
  return {
    connectionId,
    canDelete: modelConfigs.length === 0,
    counts: {
      modelConfigs: modelConfigs.length,
      activeModelConfigs: modelConfigs.filter((model) => ['active', 'approved'].includes(model.status)).length,
      agents: agentIds.size,
    },
    modelConfigs: modelConfigs.map((model) => ({
      id: model.id,
      key: model.key ?? null,
      name: model.name,
      provider: model.provider,
      model: model.model,
      status: model.status,
      agentCount: model.agents.length,
    })),
  };
}

export async function deleteProviderConnection(actor: ProviderConnectionActor, connectionId: string) {
  await rowOrThrow(actor.orgId, connectionId);
  return prisma.$transaction(async (tx) => {
    const linkedModels = await tx.aiModelConfig.count({
      where: { orgId: actor.orgId, connectionId, deletedAt: null },
    });
    if (linkedModels > 0) {
      throw new ProviderConnectionError(
        'Remove or migrate linked model configurations before deleting this connection',
        409,
        'AI_CONNECTION_IN_USE',
      );
    }
    const result = await tx.aiProviderConnection.updateMany({
      where: { id: connectionId, orgId: actor.orgId, deletedAt: null },
      data: {
        status: 'disabled',
        apiKeyEncrypted: null,
        apiKeyLast4: null,
        deletedAt: new Date(),
        updatedByUserId: actor.userId,
      },
    });
    if (result.count !== 1) {
      throw new ProviderConnectionError('Provider connection not found', 404, 'AI_CONNECTION_NOT_FOUND');
    }
    await audit(tx, actor, 'provider_connection.deleted', connectionId, 'success', {});
    return { id: connectionId, deleted: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
