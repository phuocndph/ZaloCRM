export type AiProgressStatus = 'pending' | 'queued' | 'analyzing' | 'ready' | 'verification' | 'failed' | 'not_applicable';

export const ANALYSIS_STEP_LABELS = {
  context: 'Đọc ngữ cảnh hội thoại',
  model: 'Phân tích nhu cầu và cảm xúc',
  summary: 'Tổng hợp nội dung hội thoại',
  classification: 'Xác định ý định và mức ưu tiên',
  memory: 'Cập nhật thông tin khách hàng',
  saving: 'Lưu kết quả và đề xuất công việc',
} as const;

export type AnalysisStep = keyof typeof ANALYSIS_STEP_LABELS;

const COPY: Record<AiProgressStatus, { label: string; detail: string }> = {
  pending: { label: 'Chờ kết quả phân tích AI', detail: 'Chưa có kết quả cho tin nhắn mới nhất; tác vụ có thể đang chờ hoặc AI chưa được bật.' },
  queued: { label: 'Đang chờ AI xử lý', detail: 'Tin nhắn mới nhất đã được đưa vào hàng đợi phân tích.' },
  analyzing: { label: 'AI đang phân tích tin nhắn mới', detail: 'AI đang xử lý hội thoại.' },
  ready: { label: 'AI đã phân tích xong', detail: 'Kết quả đã sẵn sàng để nhân viên xử lý.' },
  verification: { label: 'Chờ nhân viên xác minh', detail: 'Nội dung chưa đủ chắc chắn, cần nhân viên kiểm tra.' },
  failed: { label: 'AI chưa phân tích thành công', detail: 'Lần phân tích chưa thành công; hệ thống có thể thử lại. Nhân viên vẫn có thể xử lý công việc.' },
  not_applicable: { label: 'Không cần AI phân tích', detail: 'Việc này đến từ lịch hẹn, follow-up hoặc nội dung bị giới hạn quyền riêng tư.' },
};

export function aiProgressMetadata(status: AiProgressStatus, detail?: string) {
  return { aiStatus: status, aiStatusLabel: COPY[status].label, aiStatusDetail: detail || COPY[status].detail };
}

export function resolveAnalysisProgress(input: {
  latestMessageId: string | null;
  insight?: any;
  run?: any;
  redacted?: boolean;
  verification?: boolean;
}) {
  if (input.redacted) return aiProgressMetadata('not_applicable');
  const run = input.run?.triggerMessageId === input.latestMessageId && input.latestMessageId ? input.run : null;
  if (run?.status === 'running') {
    const updatedAt = new Date(run.updatedAt || run.createdAt).getTime();
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > 10 * 60_000) {
      return aiProgressMetadata('failed', 'Lần phân tích không cập nhật trong hơn 10 phút, có thể đã bị gián đoạn.');
    }
    const step = run.contextManifest?.analysisStep as AnalysisStep;
    return aiProgressMetadata('analyzing', ANALYSIS_STEP_LABELS[step]);
  }
  const insight = input.insight;
  if (insight && input.latestMessageId && insight.sourceThroughMessageId === input.latestMessageId) {
    if (input.verification || ['clarify_latest_message', 'verify_customer_identity'].includes(insight.nextAction)) {
      return aiProgressMetadata('verification');
    }
    return aiProgressMetadata('ready', insight.generatedWithModel === false
      ? 'Đã tạo đề xuất dự phòng; cần kiểm tra vì lần gọi mô hình AI không thành công.' : undefined);
  }
  if (run?.status === 'failed') return aiProgressMetadata('failed');
  return aiProgressMetadata('pending');
}
