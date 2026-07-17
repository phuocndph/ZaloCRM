import type {
  AiReadinessCheck,
  AiReadinessResponse,
  AiReadinessStatus,
} from '@/api/ai-admin';

export type AiReadinessDisplayState =
  | 'ready'
  | 'degraded'
  | 'not-configured'
  | 'error';

export interface AiReadinessViewModel {
  state: AiReadinessDisplayState;
  icon: string;
  title: string;
  description: string;
  ctaLabel: string;
}

const STATUS_VIEW: Record<AiReadinessStatus, AiReadinessViewModel> = {
  ready: {
    state: 'ready',
    icon: 'mdi-check-circle-outline',
    title: 'Trợ lý AI đã sẵn sàng',
    description: 'Kết nối, API key và mô hình đã được kiểm tra thành công.',
    ctaLabel: 'Quản lý mô hình',
  },
  disabled: {
    state: 'degraded',
    icon: 'mdi-pause-circle-outline',
    title: 'Trợ lý AI đang tắt',
    description: 'Cấu hình đã có nhưng AI đang bị tắt cho tổ chức này.',
    ctaLabel: 'Bật và cấu hình AI',
  },
  needs_test: {
    state: 'degraded',
    icon: 'mdi-connection',
    title: 'Cần kiểm tra kết nối AI',
    description: 'Provider hoặc mô hình chưa được xác minh bằng lần kiểm tra gần nhất.',
    ctaLabel: 'Xem cấu hình',
  },
  not_configured: {
    state: 'not-configured',
    icon: 'mdi-alert-circle-outline',
    title: 'Trợ lý AI chưa được cấu hình',
    description: 'Hãy cấu hình provider, API key và chọn mô hình trước khi sử dụng.',
    ctaLabel: 'Cấu hình API và mô hình',
  },
  error: {
    state: 'error',
    icon: 'mdi-close-circle-outline',
    title: 'Kết nối AI đang gặp lỗi',
    description: 'Không thể dùng mô hình đã chọn. Hãy kiểm tra lại provider và kết nối.',
    ctaLabel: 'Kiểm tra cấu hình',
  },
};

export function toAiReadinessViewModel(
  readiness: Pick<AiReadinessResponse, 'status'>,
): AiReadinessViewModel {
  return STATUS_VIEW[readiness.status];
}

export function actionableReadinessChecks(checks: AiReadinessCheck[]): AiReadinessCheck[] {
  return checks.filter((check) => check.status !== 'passed');
}

