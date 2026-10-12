import { api } from '@/api';

export const AGENT_PERMISSION_OPTIONS = [
  { key: 'work_read', label: 'Xem công việc khách hàng', group: 'Đọc dữ liệu' },
  { key: 'conversation_read', label: 'Xem hội thoại và tin nhắn', group: 'Đọc dữ liệu' },
  { key: 'customer_read', label: 'Xem hồ sơ và ghi chú khách hàng', group: 'Đọc dữ liệu' },
  { key: 'analysis_read', label: 'Xem kết quả và tiến trình AI', group: 'Đọc dữ liệu' },
  { key: 'appointment_read', label: 'Xem lịch hẹn', group: 'Đọc dữ liệu' },
  { key: 'analysis_run', label: 'Chạy phân tích AI', group: 'Xử lý công việc' },
  { key: 'draft_create', label: 'Tạo bản nháp trả lời bằng AI CRM', group: 'Xử lý công việc' },
  { key: 'work_update', label: 'Hoàn thành, hoãn, mở lại công việc', group: 'Xử lý công việc' },
  { key: 'customer_update', label: 'Sửa hồ sơ, trạng thái và nhãn khách hàng', group: 'Xử lý công việc' },
  { key: 'note_create', label: 'Thêm ghi chú khách hàng', group: 'Xử lý công việc' },
  { key: 'appointment_write', label: 'Tạo lịch hẹn và cập nhật trạng thái', group: 'Tác động bên ngoài' },
  { key: 'message_send', label: 'Gửi tin nhắn cho khách hàng', group: 'Tác động bên ngoài' },
] as const;
export type AgentPermission = typeof AGENT_PERMISSION_OPTIONS[number]['key'];
export type AgentConnection = {
  id: string; name: string; userId: string; enabled: boolean; revokedAt: string | null;
  accountIds: string[]; permissions: AgentPermission[]; expiresAt: string;
  maxWritesPerDay: number; maxSendsPerDay: number;
};
export type AgentSettings = {
  agents: AgentConnection[]; users: { id: string; fullName: string }[];
  accounts: { id: string; displayName: string | null; status: string }[];
  audit: { id: string; targetId: string | null; eventType: string; outcome: string; createdAt: string; metadata: Record<string, unknown> }[];
};
export function newAgentForm(): Omit<AgentConnection, 'id' | 'revokedAt'> {
  return { name: 'Hermes Agent', userId: '', enabled: false, accountIds: [], permissions: [],
    expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), maxWritesPerDay: 100, maxSendsPerDay: 20 };
}
export function needsAgentConfirmation(value: Omit<AgentConnection, 'id' | 'revokedAt'>, old?: AgentConnection) {
  const sensitive = value.permissions.some((p) => ['message_send', 'appointment_write', 'work_update'].includes(p));
  return value.enabled && sensitive && (!old || !old.enabled || old.userId !== value.userId
    || value.accountIds.some((id) => !old.accountIds.includes(id)) || value.permissions.some((p) => !old.permissions.includes(p))
    || value.maxSendsPerDay > old.maxSendsPerDay || value.maxWritesPerDay > old.maxWritesPerDay);
}
export const agentsApi = {
  load: async () => (await api.get<AgentSettings>('/settings/agents')).data,
  save: async (value: Omit<AgentConnection, 'id' | 'revokedAt'>, id?: string, confirmSensitive = false) => {
    const body = { name: value.name, userId: value.userId, enabled: value.enabled, accountIds: value.accountIds,
      permissions: value.permissions, expiresAt: value.expiresAt, maxWritesPerDay: value.maxWritesPerDay, maxSendsPerDay: value.maxSendsPerDay, confirmSensitive };
    return (id ? await api.put<{ agent: AgentConnection }>('/settings/agents/' + id, body)
      : await api.post<{ agent: AgentConnection; token?: string }>('/settings/agents', body)).data as { agent: AgentConnection; token?: string };
  },
  rotate: async (id: string) => (await api.post<{ token: string }>('/settings/agents/' + id + '/rotate')).data,
  revoke: async (id: string) => { await api.post('/settings/agents/' + id + '/revoke'); },
};
