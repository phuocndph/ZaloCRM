export type PersistentReadinessInput = {
  enabled: boolean;
  defaultModelConfig: {
    id: string;
    name: string;
    provider: string;
    model: string;
    status: string;
    connection: {
      id: string;
      name: string;
      adapter: string;
      vendor: string;
      baseUrl: string;
      apiKeyLast4: string | null;
      status: string;
      lastTestStatus: string | null;
      lastTestedAt: Date | null;
      lastLatencyMs: number | null;
      lastErrorCode: string | null;
      deletedAt: Date | null;
    } | null;
  } | null;
};

function publicBaseUrl(raw: string): { configured: boolean; valid: boolean; value: string | null } {
  if (!raw?.trim()) return { configured: false, valid: false, value: null };
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
      return { configured: true, valid: false, value: null };
    }
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return {
      configured: true,
      valid: true,
      value: parsed.toString().replace(/\/$/, ''),
    };
  } catch {
    return { configured: true, valid: false, value: null };
  }
}

function check(id: string, status: 'passed' | 'failed' | 'warning', message: string) {
  return { id, status, message };
}

function publicErrorCode(value: string | null): string | null {
  if (!value) return null;
  return /^[A-Z][A-Z0-9_]{1,119}$/.test(value)
    ? value : 'AI_CONNECTION_TEST_FAILED';
}

/**
 * Convert the persisted model/connection state to the existing readiness API.
 * Returns null for a legacy/default-with-env model so the caller can preserve
 * the old AppSetting + in-memory probe compatibility path.
 */
export function getPersistentAiReadiness(input: PersistentReadinessInput) {
  const model = input.defaultModelConfig;
  const connection = model?.connection;
  if (!model || !connection) return null;

  const baseUrl = publicBaseUrl(connection.baseUrl);
  const modelActive = ['active', 'approved'].includes(model.status);
  const connectionDeleted = Boolean(connection.deletedAt);
  const connectionDisabled = connection.status === 'disabled';
  const hasApiKey = Boolean(connection.apiKeyLast4);
  const testedHealthy = connection.status === 'connected'
    && connection.lastTestStatus === 'healthy';
  const testedFailed = connection.status === 'failed'
    || connectionDisabled
    || connectionDeleted;
  const connectionStatus = testedHealthy ? 'connected' : testedFailed ? 'failed' : 'not_tested';
  const errorCode = connectionDeleted
    ? 'AI_CONNECTION_NOT_FOUND'
    : connectionDisabled
      ? 'AI_CONNECTION_DISABLED'
      : publicErrorCode(connection.lastErrorCode);

  const configured = modelActive
    && !connectionDeleted
    && !connectionDisabled
    && hasApiKey
    && baseUrl.valid;
  const status = !input.enabled
    ? 'disabled'
    : !configured
      ? 'not_configured'
      : testedFailed
        ? 'error'
        : testedHealthy
          ? 'ready'
          : 'needs_test';

  const checks = [
    check(
      'ai_enabled',
      input.enabled ? 'passed' : 'failed',
      input.enabled ? 'Trợ lý AI đang được bật.' : 'Trợ lý AI đang bị tắt.',
    ),
    check(
      'provider_selected',
      connectionDeleted ? 'failed' : 'passed',
      connectionDeleted ? 'Kết nối API đã bị xóa.' : `Đã chọn kết nối ${connection.name}.`,
    ),
    check(
      'api_key',
      hasApiKey ? 'passed' : 'failed',
      hasApiKey ? 'Đã cấu hình API key cho kết nối.' : 'Kết nối chưa có API key.',
    ),
    check(
      'base_url',
      baseUrl.valid ? 'passed' : 'failed',
      baseUrl.valid ? 'Địa chỉ API hợp lệ.' : 'Địa chỉ API đang thiếu hoặc không hợp lệ.',
    ),
    check(
      'model_selected',
      modelActive ? 'passed' : 'failed',
      modelActive ? `Đã chọn model ${model.model}.` : 'Model mặc định chưa được kích hoạt.',
    ),
    check(
      'connection',
      testedHealthy ? 'passed' : testedFailed ? 'failed' : 'warning',
      testedHealthy
        ? 'Kết nối API đã được kiểm tra thành công.'
        : testedFailed
          ? 'Kết nối API đang lỗi hoặc đã bị vô hiệu hóa.'
          : 'Kết nối API chưa được kiểm tra.',
    ),
    check(
      'model_available',
      testedHealthy && modelActive ? 'passed' : testedFailed ? 'failed' : 'warning',
      testedHealthy && modelActive
        ? 'Model mặc định sẵn sàng sử dụng.'
        : testedFailed
          ? 'Không thể xác nhận model qua kết nối hiện tại.'
          : 'Cần kiểm tra kết nối với model đã chọn.',
    ),
  ];

  return {
    ready: status === 'ready',
    status,
    checkedAt: new Date().toISOString(),
    config: {
      enabled: input.enabled,
      provider: model.provider,
      model: model.model,
      defaultModelConfigId: model.id,
    },
    provider: {
      id: model.provider,
      name: connection.name,
      configured: !connectionDeleted,
      hasApiKey,
      baseUrlConfigured: baseUrl.configured,
      baseUrlValid: baseUrl.valid,
      baseUrl: baseUrl.value,
      connectionId: connection.id,
      adapter: connection.adapter,
      vendor: connection.vendor,
    },
    model: {
      id: model.model,
      modelConfigId: model.id,
      configured: true,
      status: testedHealthy && modelActive ? 'available' : modelActive ? 'unverified' : 'inactive',
      available: testedHealthy && modelActive ? true : testedFailed ? false : null,
    },
    connection: {
      id: connection.id,
      status: connectionStatus,
      health: connection.lastTestStatus,
      testedAt: connection.lastTestedAt?.toISOString() ?? null,
      latencyMs: connection.lastLatencyMs,
      errorCode,
    },
    checks,
  };
}

