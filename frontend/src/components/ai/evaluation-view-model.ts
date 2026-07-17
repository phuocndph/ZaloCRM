import type {
  AiEvaluationCaseResult,
  AiEvaluationCriterion,
  AiEvaluationPromptReference,
  AiEvaluationRunResult,
  AiEvaluationTarget,
} from '@/api/ai-evaluations';

export type EvaluationResultState = 'passed' | 'failed' | 'generation_error';

const CRITERIA: Array<{ key: AiEvaluationCriterion; label: string; critical: boolean }> = [
  { key: 'accuracy', label: 'Độ chính xác', critical: false },
  { key: 'groundedness', label: 'Bám nguồn tri thức', critical: false },
  { key: 'policy_compliance', label: 'Tuân thủ chính sách', critical: true },
  { key: 'tone', label: 'Giọng điệu', critical: false },
  { key: 'emotion_appropriateness', label: 'Phù hợp cảm xúc', critical: false },
  { key: 'helpfulness', label: 'Mức hữu ích', critical: false },
  { key: 'sales_effectiveness', label: 'Hiệu quả bán hàng', critical: false },
  { key: 'conciseness', label: 'Ngắn gọn', critical: false },
  { key: 'hallucination', label: 'Không bịa thông tin', critical: false },
  { key: 'privacy', label: 'Bảo vệ riêng tư', critical: true },
  { key: 'handoff_correctness', label: 'Bàn giao đúng lúc', critical: true },
];

const TARGET_LABELS: Record<AiEvaluationTarget, string> = {
  prompt: 'Lời nhắc', model: 'Mô hình', agent: 'Tác nhân', skill: 'Kỹ năng', knowledge: 'Kho tri thức', policy: 'Chính sách',
};

function score(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

export function targetTypeLabel(target: AiEvaluationTarget): string {
  return TARGET_LABELS[target];
}

export function humanizeEvaluationKey(key: string): string {
  return key.replace(/^learning-/, 'Learning · ').replace(/[_-]+/g, ' ').replace(/\b\w/g, (value) => value.toLocaleUpperCase('vi'));
}

export function criteriaRows(result: AiEvaluationCaseResult) {
  return CRITERIA.map((criterion) => ({ ...criterion, score: score(result.criteria[criterion.key]) }));
}

export function evaluationResultState(result: AiEvaluationRunResult): EvaluationResultState {
  if (result.generationFailures.length) return 'generation_error';
  return result.passed ? 'passed' : 'failed';
}

export function evaluationProgressPhase(elapsedSeconds: number): string {
  if (elapsedSeconds < 2) return 'Đang gửi cấu hình đánh giá lên máy chủ…';
  if (elapsedSeconds < 10) return 'Máy chủ đang sinh câu trả lời cho từng ca kiểm thử…';
  return 'Đang chấm tiêu chí an toàn và tổng hợp kết quả…';
}

export function promptVersionsForTarget(
  prompts: AiEvaluationPromptReference[],
  targetType: AiEvaluationTarget,
  targetId: string,
) {
  const source = targetType === 'prompt' ? prompts.filter((prompt) => prompt.id === targetId) : prompts;
  return source.flatMap((prompt) => prompt.versions.map((version) => ({
    ...version,
    promptId: prompt.id,
    promptKey: prompt.key,
    promptName: prompt.name,
    label: `${prompt.name} · v${version.version} · ${version.status}`,
  })));
}

export function passingCriteriaCount(result: AiEvaluationCaseResult, threshold: number): number {
  return criteriaRows(result).filter((criterion) => criterion.score >= threshold).length;
}
