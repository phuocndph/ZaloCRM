import { prisma } from '../../shared/database/prisma-client.js';
import {
  getProviderBaseUrl,
  getProviderConfig,
  resolveProviderApiKey,
} from './provider-registry.js';
import { invalidateModelCache, listProviderModels } from './providers/list-models.js';
import { getPersistentAiReadiness } from './ai-persistent-readiness.js';

export type AiReadinessStatus = 'disabled' | 'not_configured' | 'needs_test' | 'ready' | 'error';
export type AiConnectionStatus = 'not_tested' | 'connected' | 'failed';
export type AiCheckStatus = 'passed' | 'failed' | 'warning';

type ConnectionProbe = {
  status: Exclude<AiConnectionStatus, 'not_tested'>;
  testedAt: string;
  latencyMs: number;
  model: string | null;
  modelAvailable: boolean | null;
  errorCode: string | null;
};

export type ProviderConnectionTestResult = {
  ok: boolean;
  status: Exclude<AiConnectionStatus, 'not_tested'>;
  provider: string;
  model: string | null;
  modelAvailable: boolean | null;
  modelsCount: number;
  latencyMs: number;
  testedAt: string;
  errorCode: string | null;
  message?: string;
};

export class AiReadinessError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'AI_READINESS_ERROR',
  ) {
    super(message);
    this.name = 'AiReadinessError';
  }
}

const PROBE_TTL_MS = 5 * 60 * 1000;
const probes = new Map<string, ConnectionProbe>();

function probeKey(orgId: string, provider: string): string {
  return `${orgId}:${provider}`;
}

function currentProbe(orgId: string, provider: string | null): ConnectionProbe | null {
  if (!provider) return null;
  const probe = probes.get(probeKey(orgId, provider));
  if (!probe) return null;
  if (Date.now() - new Date(probe.testedAt).getTime() > PROBE_TTL_MS) {
    probes.delete(probeKey(orgId, provider));
    return null;
  }
  return probe;
}

function inspectBaseUrl(raw: string): { configured: boolean; valid: boolean; publicValue: string | null } {
  if (!raw.trim()) return { configured: false, valid: false, publicValue: null };
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
      return { configured: true, valid: false, publicValue: null };
    }
    // Never echo credentials, query strings, or fragments from an administrator-supplied URL.
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return { configured: true, valid: true, publicValue: parsed.toString().replace(/\/$/, '') };
  } catch {
    return { configured: true, valid: false, publicValue: null };
  }
}

function check(id: string, status: AiCheckStatus, message: string) {
  return { id, status, message };
}

export async function getAiReadiness(orgId: string) {
  const config = await prisma.aiConfig.findUnique({
    where: { orgId },
    select: {
      enabled: true,
      provider: true,
      model: true,
      defaultModelConfig: {
        select: {
          id: true,
          name: true,
          provider: true,
          model: true,
          status: true,
          connection: {
            select: {
              id: true,
              name: true,
              adapter: true,
              vendor: true,
              baseUrl: true,
              apiKeyLast4: true,
              status: true,
              lastTestStatus: true,
              lastTestedAt: true,
              lastLatencyMs: true,
              lastErrorCode: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  });
  const persistent = config ? getPersistentAiReadiness(config) : null;
  if (persistent) return persistent;

  // Compatibility fallback for organizations not bridged yet and for legacy
  // model configs that intentionally resolve credentials from an environment
  // reference rather than a managed provider connection.
  const providerId = config?.provider?.trim() || null;
  const modelId = config?.model?.trim() || null;
  const providerDef = providerId ? getProviderConfig(providerId) : undefined;

  let apiKey = '';
  let baseUrl = '';
  if (providerDef && providerId) {
    [apiKey, baseUrl] = await Promise.all([
      resolveProviderApiKey(orgId, providerId),
      getProviderBaseUrl(orgId, providerId),
    ]);
  }

  const baseUrlState = inspectBaseUrl(baseUrl);
  const probe = currentProbe(orgId, providerId);
  const modelAvailable = probe?.model === modelId ? probe.modelAvailable : null;
  const modelStatus = !modelId
    ? 'missing'
    : modelAvailable === true
      ? 'available'
      : modelAvailable === false
        ? 'unavailable'
        : 'unverified';

  const checks = [
    check('ai_enabled', config?.enabled ? 'passed' : 'failed', config?.enabled ? 'Trợ lý AI đang được bật.' : 'Trợ lý AI đang bị tắt.'),
    check('provider_selected', providerDef ? 'passed' : 'failed', providerDef ? `Đã chọn nhà cung cấp ${providerDef.name}.` : 'Chưa chọn nhà cung cấp AI được hỗ trợ.'),
    check('api_key', apiKey ? 'passed' : 'failed', apiKey ? 'Đã cấu hình API key của nhà cung cấp.' : 'Chưa cấu hình API key của nhà cung cấp.'),
    check('base_url', baseUrlState.valid ? 'passed' : 'failed', baseUrlState.valid ? 'Địa chỉ API hợp lệ.' : 'Địa chỉ API đang thiếu hoặc không hợp lệ.'),
    check('model_selected', modelId ? 'passed' : 'failed', modelId ? `Đã chọn model ${modelId}.` : 'Chưa chọn model AI.'),
    check(
      'connection',
      probe?.status === 'connected' ? 'passed' : probe?.status === 'failed' ? 'failed' : 'warning',
      probe?.status === 'connected'
        ? 'Kết nối đến nhà cung cấp đã được kiểm tra thành công.'
        : probe?.status === 'failed'
          ? 'Không thể kết nối đến nhà cung cấp AI.'
          : 'Kết nối nhà cung cấp chưa được kiểm tra gần đây.',
    ),
    check(
      'model_available',
      modelAvailable === true ? 'passed' : modelAvailable === false ? 'failed' : 'warning',
      modelAvailable === true
        ? 'Model đã chọn hiện khả dụng.'
        : modelAvailable === false
          ? 'Nhà cung cấp không trả về model đã chọn.'
          : 'Tính khả dụng của model chưa được kiểm tra gần đây.',
    ),
  ];

  const configurationReady = Boolean(config?.enabled && providerDef && apiKey && baseUrlState.valid && modelId);
  let status: AiReadinessStatus;
  if (!config?.enabled) status = 'disabled';
  else if (!configurationReady) status = 'not_configured';
  else if (probe?.status === 'failed' || modelAvailable === false) status = 'error';
  else if (probe?.status === 'connected' && modelAvailable === true) status = 'ready';
  else status = 'needs_test';

  return {
    ready: status === 'ready',
    status,
    checkedAt: new Date().toISOString(),
    config: {
      enabled: config?.enabled ?? false,
      provider: providerId,
      model: modelId,
    },
    provider: {
      id: providerId,
      name: providerDef?.name ?? null,
      configured: Boolean(providerDef),
      hasApiKey: Boolean(apiKey),
      baseUrlConfigured: baseUrlState.configured,
      baseUrlValid: baseUrlState.valid,
      baseUrl: baseUrlState.publicValue,
    },
    model: {
      id: modelId,
      configured: Boolean(modelId),
      status: modelStatus,
      available: modelAvailable,
    },
    connection: {
      status: probe?.status ?? 'not_tested',
      testedAt: probe?.testedAt ?? null,
      latencyMs: probe?.latencyMs ?? null,
      errorCode: probe?.errorCode ?? null,
    },
    checks,
  };
}

export async function testProviderConnection(
  orgId: string,
  provider: string,
  requestedModel?: string,
): Promise<ProviderConnectionTestResult> {
  const providerDef = getProviderConfig(provider);
  if (!providerDef) throw new AiReadinessError('Nhà cung cấp AI không được hỗ trợ.', 400, 'AI_PROVIDER_UNSUPPORTED');

  const [apiKey, baseUrl, aiConfig] = await Promise.all([
    resolveProviderApiKey(orgId, provider),
    getProviderBaseUrl(orgId, provider),
    prisma.aiConfig.findUnique({ where: { orgId }, select: { provider: true, model: true } }),
  ]);
  if (!apiKey) throw new AiReadinessError('Chưa cấu hình API key của nhà cung cấp.', 400, 'AI_API_KEY_MISSING');
  if (!inspectBaseUrl(baseUrl).valid) {
    throw new AiReadinessError('Địa chỉ API đang thiếu hoặc không hợp lệ.', 400, 'AI_BASE_URL_INVALID');
  }

  const selectedModel = requestedModel?.trim()
    || (aiConfig?.provider === provider ? aiConfig.model?.trim() : '')
    || null;
  const startedAt = Date.now();
  const testedAt = new Date().toISOString();

  try {
    // A connection test must bypass a previous successful model-list cache entry.
    invalidateModelCache(orgId, provider);
    const models = await listProviderModels(provider, baseUrl, apiKey, orgId);
    const latencyMs = Date.now() - startedAt;
    const modelAvailable = selectedModel ? models.some((item) => item.value === selectedModel) : null;
    const snapshot: ConnectionProbe = {
      status: 'connected',
      testedAt,
      latencyMs,
      model: selectedModel,
      modelAvailable,
      errorCode: null,
    };
    probes.set(probeKey(orgId, provider), snapshot);
    return {
      ok: true,
      status: snapshot.status,
      provider,
      model: selectedModel,
      modelAvailable,
      modelsCount: models.length,
      latencyMs,
      testedAt,
      errorCode: null,
    };
  } catch {
    const latencyMs = Date.now() - startedAt;
    const snapshot: ConnectionProbe = {
      status: 'failed',
      testedAt,
      latencyMs,
      model: selectedModel,
      modelAvailable: null,
      errorCode: 'AI_PROVIDER_CONNECTION_FAILED',
    };
    probes.set(probeKey(orgId, provider), snapshot);
    return {
      ok: false,
      status: snapshot.status,
      provider,
      model: selectedModel,
      modelAvailable: null,
      modelsCount: 0,
      latencyMs,
      testedAt,
      errorCode: snapshot.errorCode,
      message: 'Không thể kết nối nhà cung cấp AI. Hãy kiểm tra API key, địa chỉ API và trạng thái dịch vụ.',
    };
  }
}

/** Test-only reset; deliberately does not expose probe contents or credentials. */
export function clearAiReadinessProbeCache(): void {
  probes.clear();
}
