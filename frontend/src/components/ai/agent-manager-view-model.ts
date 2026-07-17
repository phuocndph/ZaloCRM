import type { AiAgentRecord, AiAgentStatus } from '@/api/ai-agents';

export type AgentStatusTone = 'neutral' | 'warning' | 'ready' | 'live' | 'muted';
export type AgentAction = 'edit' | 'submit' | 'approve' | 'activate' | 'deactivate' | 'archive';

export interface AgentActionState {
  action: AgentAction;
  label: string;
  enabled: boolean;
  reason?: string;
  tone: 'primary' | 'secondary' | 'danger';
}

const STATUS_META: Record<AiAgentStatus, { label: string; tone: AgentStatusTone; description: string }> = {
  draft: { label: 'Bản nháp', tone: 'neutral', description: 'Có thể chỉnh sửa và gửi phê duyệt.' },
  pending_approval: { label: 'Chờ duyệt', tone: 'warning', description: 'Cần một người khác với người sửa gần nhất phê duyệt.' },
  approved: { label: 'Đã duyệt', tone: 'ready', description: 'Chỉ được kích hoạt khi bài đánh giá tác nhân đạt.' },
  active: { label: 'Đang hoạt động', tone: 'live', description: 'Phải tạm dừng trước khi chỉnh sửa hoặc lưu trữ.' },
  inactive: { label: 'Tạm dừng', tone: 'muted', description: 'Có thể đánh giá lại, kích hoạt hoặc chỉnh sửa.' },
  archived: { label: 'Đã lưu trữ', tone: 'muted', description: 'Không còn khả dụng trong vận hành.' },
};

const ERROR_MESSAGES: Record<string, string> = {
  AGENT_CAPABILITY_DENIED: 'Tác nhân đang yêu cầu một khả năng không được phép.',
  AGENT_POLICY_FIELD_DENIED: 'Chính sách có trường không thuộc danh sách an toàn.',
  AGENT_FULL_AUTO_FORBIDDEN: 'Hệ thống chưa cho phép tác nhân tự gửi hoàn toàn. Chỉ dùng Tắt, Shadow hoặc Gợi ý.',
  AGENT_PERSONA_NOT_FOUND: 'Tính cách đã chọn không tồn tại trong tổ chức này.',
  AGENT_PROMPT_NOT_FOUND: 'Phiên bản lời nhắc đã chọn không tồn tại trong tổ chức này.',
  AGENT_MODEL_NOT_FOUND: 'Cấu hình mô hình đã chọn không tồn tại trong tổ chức này.',
  AGENT_SKILL_NOT_FOUND: 'Có kỹ năng đã chọn không tồn tại trong tổ chức này.',
  AGENT_KEY_EXISTS: 'Key tác nhân đã tồn tại.',
  AGENT_ACTIVE_EDIT_FORBIDDEN: 'Hãy tạm dừng tác nhân trước khi chỉnh sửa.',
  AGENT_PENDING_EDIT_FORBIDDEN: 'Không thể sửa khi tác nhân đang chờ phê duyệt.',
  AGENT_INCOMPLETE: 'Cần chọn lời nhắc, mô hình và ít nhất một kỹ năng trước khi gửi duyệt.',
  AGENT_MAKER_CHECKER_REQUIRED: 'Người sửa cấu hình gần nhất không được tự phê duyệt. Hãy nhờ một quản trị viên khác.',
  AGENT_PROMPT_NOT_PRODUCTION: 'Cần dùng một phiên bản lời nhắc Production.',
  AGENT_MODEL_NOT_ACTIVE: 'Cấu hình mô hình phải ở trạng thái Active hoặc Approved.',
  AGENT_SKILL_REQUIRED: 'Cần ít nhất một kỹ năng đang khả dụng.',
  AGENT_EVALUATION_REQUIRED: 'Cần chạy và đạt bài đánh giá dành riêng cho tác nhân này trước khi kích hoạt.',
  AGENT_EVALUATION_STALE: 'Bài đánh giá đạt đã cũ hơn lần sửa cấu hình gần nhất. Hãy đánh giá lại.',
  AGENT_CONFLICT: 'Cấu hình vừa được thay đổi ở nơi khác. Hãy tải lại và thử lại.',
  AGENT_INVALID_TRANSITION: 'Trạng thái hiện tại không cho phép thao tác này.',
};

export function agentStatusMeta(status: AiAgentStatus) {
  return STATUS_META[status];
}

export function agentEvaluationLabel(agent: Pick<AiAgentRecord, 'evaluationGate'>): {
  label: string;
  detail: string;
  tone: 'passed' | 'required' | 'stale';
} {
  const gate = agent.evaluationGate;
  if (gate.passed) {
    return {
      label: 'Đã đạt đánh giá',
      detail: gate.completedAt ? `Đạt lúc ${new Date(gate.completedAt).toLocaleString('vi-VN')}` : 'Có bài đánh giá đạt còn hiệu lực.',
      tone: 'passed',
    };
  }
  if (gate.reason === 'evaluation_stale') {
    return {
      label: 'Cần đánh giá lại',
      detail: 'Cấu hình đã thay đổi sau bài đánh giá đạt gần nhất.',
      tone: 'stale',
    };
  }
  return {
    label: 'Chưa đạt đánh giá',
    detail: 'Kích hoạt bị khóa cho tới khi có bài đánh giá tác nhân đạt.',
    tone: 'required',
  };
}

function action(action: AgentAction, label: string, tone: AgentActionState['tone'], enabled = true, reason?: string): AgentActionState {
  return { action, label, tone, enabled, ...(reason ? { reason } : {}) };
}

export function agentActionStates(agent: AiAgentRecord): AgentActionState[] {
  const activationReason = agent.evaluationGate.reason === 'evaluation_stale'
    ? 'Cần đánh giá lại sau lần sửa cấu hình gần nhất.'
    : 'Cần một bài đánh giá tác nhân đạt trước khi kích hoạt.';
  switch (agent.status) {
    case 'draft':
      return [
        action('edit', 'Chỉnh sửa', 'secondary'),
        action('submit', 'Gửi phê duyệt', 'primary'),
        action('archive', 'Lưu trữ', 'danger'),
      ];
    case 'pending_approval':
      return [
        action('approve', 'Phê duyệt', 'primary'),
        action('archive', 'Lưu trữ', 'danger'),
      ];
    case 'approved':
      return [
        action('edit', 'Chỉnh sửa', 'secondary'),
        action('activate', 'Kích hoạt', 'primary', agent.evaluationGate.passed, agent.evaluationGate.passed ? undefined : activationReason),
        action('archive', 'Lưu trữ', 'danger'),
      ];
    case 'active':
      return [action('deactivate', 'Tạm dừng', 'secondary')];
    case 'inactive':
      return [
        action('edit', 'Chỉnh sửa', 'secondary'),
        action('activate', 'Kích hoạt lại', 'primary', agent.evaluationGate.passed, agent.evaluationGate.passed ? undefined : activationReason),
        action('archive', 'Lưu trữ', 'danger'),
      ];
    case 'archived':
      return [];
  }
}

export function agentMissingConfiguration(agent: Pick<AiAgentRecord, 'promptVersionId' | 'modelConfigId' | 'skills'>): string[] {
  const missing: string[] = [];
  if (!agent.promptVersionId) missing.push('lời nhắc');
  if (!agent.modelConfigId) missing.push('mô hình');
  if (!agent.skills.length) missing.push('kỹ năng');
  return missing;
}

export function filterAiAgents(agents: AiAgentRecord[], search: string, status: '' | AiAgentStatus): AiAgentRecord[] {
  const query = search.trim().toLocaleLowerCase('vi');
  return agents.filter((agent) => {
    const haystack = [agent.name, agent.key, agent.persona?.name, agent.modelConfig?.name, ...agent.skills.map((skill) => skill.name)]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('vi');
    return (!status || agent.status === status) && (!query || haystack.includes(query));
  });
}

export function agentErrorMessage(error: unknown, fallback = 'Không thể hoàn tất thao tác. Vui lòng thử lại.'): string {
  const response = error && typeof error === 'object' && 'response' in error
    ? (error as { response?: { data?: { code?: unknown; error?: unknown } } }).response
    : undefined;
  const code = typeof response?.data?.code === 'string' ? response.data.code : '';
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return typeof response?.data?.error === 'string' && response.data.error.trim()
    ? response.data.error
    : fallback;
}
