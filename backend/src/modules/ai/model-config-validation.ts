import type { Prisma } from '@prisma/client';
import { ModelConfigError, type ModelConfigStatus } from './model-config-service.js';

export type JsonObject = Record<string, unknown>;

export const MODEL_CONFIG_SELECT = {
  id: true,
  orgId: true,
  connectionId: true,
  key: true,
  name: true,
  provider: true,
  model: true,
  version: true,
  revision: true,
  parameters: true,
  capabilities: true,
  dataPolicy: true,
  status: true,
  fallbackModelConfigId: true,
  changeNote: true,
  createdByUserId: true,
  approvedByUserId: true,
  approvedAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  connection: {
    select: { id: true, key: true, name: true, vendor: true, status: true },
  },
} as const;

const FORBIDDEN_JSON_KEYS = new Set([
  'apikey', 'authorization', 'basicauth', 'bearertoken', 'credentialref',
  'baseurl', 'customheaders', 'headers', 'password', 'secret', 'token',
]);

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ModelConfigError(`${field} is required`, 400, `AI_MODEL_${field.toUpperCase()}_REQUIRED`);
  }
  const result = value.trim();
  if (result.length > maxLength || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new ModelConfigError(`${field} is invalid`, 400, `AI_MODEL_${field.toUpperCase()}_INVALID`);
  }
  return result;
}

export function logicalKey(value: unknown): string {
  const key = requiredString(value, 'logical_key', 80).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{1,79}$/.test(key)) {
    throw new ModelConfigError('logicalKey is invalid', 400, 'AI_MODEL_LOGICAL_KEY_INVALID');
  }
  return key;
}

export const displayName = (value: unknown) => requiredString(value, 'display_name', 160);
export const externalModelId = (value: unknown) => requiredString(value, 'external_model_id', 256);
export const connectionId = (value: unknown) => requiredString(value, 'connection_id', 128);

export function optionalId(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, field, 128);
}

export function changeNote(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, 'change_note', 4_000);
}

function visitJson(value: unknown, path: string, depth: number): void {
  if (depth > 12) throw new ModelConfigError(`${path} is too deeply nested`, 400, 'AI_MODEL_JSON_INVALID');
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new ModelConfigError(`${path} contains too many items`, 400, 'AI_MODEL_JSON_INVALID');
    value.forEach((item, index) => visitJson(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.replace(/[-_\s]/g, '').toLowerCase();
      if (FORBIDDEN_JSON_KEYS.has(normalized)) {
        throw new ModelConfigError(
          `${path} cannot contain credentials or custom headers`,
          400,
          'AI_MODEL_SENSITIVE_FIELD_DENIED',
        );
      }
      visitJson(nested, `${path}.${key}`, depth + 1);
    }
    return;
  }
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
    throw new ModelConfigError(`${path} is not valid JSON`, 400, 'AI_MODEL_JSON_INVALID');
  }
}

export function jsonObject(value: unknown, field: string, fallback: JsonObject = {}): JsonObject {
  if (value === undefined) return fallback;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ModelConfigError(`${field} must be an object`, 400, 'AI_MODEL_JSON_INVALID');
  }
  visitJson(value, field, 0);
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch {
    throw new ModelConfigError(`${field} is not valid JSON`, 400, 'AI_MODEL_JSON_INVALID');
  }
  if (serialized.length > 64_000) throw new ModelConfigError(`${field} is too large`, 400, 'AI_MODEL_JSON_TOO_LARGE');
  return value as JsonObject;
}

export function expectedRevision(value: unknown): number {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new ModelConfigError('expectedRevision is required', 400, 'AI_MODEL_REVISION_REQUIRED');
  }
  return revision;
}

export function uniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'P2002');
}

export function dto(row: any, defaultModelConfigId?: string | null) {
  return {
    id: row.id,
    logicalKey: row.key ?? null,
    displayName: row.name,
    provider: row.provider,
    externalModelId: row.model,
    version: row.version,
    revision: row.revision,
    connectionId: row.connectionId ?? null,
    parameters: row.parameters ?? {},
    capabilities: row.capabilities ?? {},
    dataPolicy: row.dataPolicy ?? {},
    status: row.status as ModelConfigStatus,
    fallbackModelConfigId: row.fallbackModelConfigId ?? null,
    changeNote: row.changeNote ?? null,
    createdByUserId: row.createdByUserId ?? null,
    approvedByUserId: row.approvedByUserId ?? null,
    approvedAt: row.approvedAt ?? null,
    archivedAt: row.archivedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    connection: row.connection ?? null,
    isDefault: Boolean(defaultModelConfigId && row.id === defaultModelConfigId),
  };
}

export function inputJson(value: JsonObject): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
