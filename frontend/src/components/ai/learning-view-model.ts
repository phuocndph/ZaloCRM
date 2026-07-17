import type {
  LearningCandidate,
  LearningCandidatePayload,
  LearningCandidateStatus,
  LearningEvidence,
} from '@/api/ai-learning';

export type LearningStatusTone = 'neutral' | 'warning' | 'success' | 'danger' | 'info';

const STATUS_LABELS: Record<LearningCandidateStatus, string> = {
  collected: 'Đã thu thập',
  filtered: 'Đã lọc',
  pending: 'Chờ duyệt',
  pending_review: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Đã từ chối',
  published: 'Đã tạo ca đánh giá',
};

const KIND_LABELS: Record<string, string> = {
  used_reply_pattern: 'Mẫu trả lời đã dùng',
  edited_reply_pattern: 'Mẫu trả lời đã chỉnh sửa',
  knowledge_gap: 'Khoảng trống kiến thức',
  question_pattern: 'Mẫu câu hỏi',
  prompt_improvement: 'Đề xuất cải thiện prompt',
  skill_improvement: 'Đề xuất cải thiện kỹ năng',
  evaluation_case: 'Ca đánh giá',
};

const RISK_LABELS: Record<string, string> = {
  low: 'Rủi ro thấp',
  medium: 'Rủi ro vừa',
  high: 'Rủi ro cao',
};

export function normalizeLearningStatus(status: LearningCandidateStatus): LearningCandidateStatus {
  return status === 'pending' ? 'pending_review' : status;
}

export function learningStatusLabel(status: LearningCandidateStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function learningStatusTone(status: LearningCandidateStatus): LearningStatusTone {
  const normalized = normalizeLearningStatus(status);
  if (normalized === 'pending_review') return 'warning';
  if (normalized === 'approved' || normalized === 'published') return 'success';
  if (normalized === 'rejected') return 'danger';
  if (normalized === 'filtered') return 'neutral';
  return 'info';
}

export function learningKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export function learningRiskLabel(risk: string): string {
  return RISK_LABELS[risk] ?? risk;
}

export function maskSensitiveLearningText(value: unknown, maxLength = 5_000): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\b(?:\+?84|0)(?:\d[ .-]?){8,10}\b/g, '[SỐ ĐIỆN THOẠI ĐÃ ẨN]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL ĐÃ ẨN]')
    .replace(/\b(?:otp|mã xác thực|password|mật khẩu|token|api[_ -]?key)\s*[:=]?\s*\S+/gi, '[BÍ MẬT ĐÃ ẨN]')
    .replace(/\b(?:\d[ -]?){12,19}\b/g, '[DÃY SỐ ĐÃ ẨN]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export interface SafeLearningPayload {
  proposedReply: string;
  finalReply: string;
  reason: string;
  feedbackType: string;
  selectionStatus: string;
  editDistance: number | null;
  knowledgeRefCount: number;
  hiddenContextFields: number;
  hiddenOutcomeFields: number;
}

export function safeLearningPayload(payload: LearningCandidatePayload | null): SafeLearningPayload {
  const context = payload?.context && typeof payload.context === 'object' ? payload.context : {};
  const outcome = payload?.outcome && typeof payload.outcome === 'object' ? payload.outcome : {};
  return {
    proposedReply: maskSensitiveLearningText(payload?.proposedReply),
    finalReply: maskSensitiveLearningText(payload?.finalReply),
    reason: maskSensitiveLearningText(payload?.reason),
    feedbackType: maskSensitiveLearningText(payload?.type, 120),
    selectionStatus: maskSensitiveLearningText(payload?.selectionStatus, 120),
    editDistance: typeof payload?.editDistance === 'number' ? payload.editDistance : null,
    knowledgeRefCount: Array.isArray(payload?.knowledgeRefs) ? payload.knowledgeRefs.length : 0,
    // Nested context/outcome are intentionally counted, never rendered. Their
    // shape is not guaranteed to be recursively redacted by legacy backends.
    hiddenContextFields: Object.keys(context).length,
    hiddenOutcomeFields: Object.keys(outcome).length,
  };
}

export function learningCandidatePreview(candidate: LearningCandidate): string {
  const payload = safeLearningPayload(candidate.payload);
  return payload.finalReply || payload.proposedReply || payload.reason || 'Không có nội dung văn bản an toàn để hiển thị';
}

export interface SafeEvidenceItem {
  label: string;
  detail: string;
  at: string | null;
  materializationId: string | null;
}

export function safeLearningEvidence(evidence: LearningEvidence[]): SafeEvidenceItem[] {
  return evidence.map((item) => {
    const transition = maskSensitiveLearningText(item.transition, 100);
    const feedbackType = maskSensitiveLearningText(item.type, 100);
    const note = maskSensitiveLearningText(item.note, 500);
    const materialized = item.materializedType === 'evaluation_case';
    return {
      label: materialized ? 'Đã tạo ca đánh giá nháp' : transition ? `Chuyển trạng thái ${transition}` : 'Bằng chứng phản hồi',
      detail: note || feedbackType || (item.redacted ? 'Dữ liệu nguồn đã được che thông tin nhạy cảm' : 'Metadata kiểm duyệt'),
      at: typeof item.at === 'string' ? item.at : null,
      materializationId: materialized && typeof item.materializedId === 'string' ? item.materializedId : null,
    };
  });
}

