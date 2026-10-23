// SPDX-License-Identifier: AGPL-3.0-or-later
import { api } from '@/api/index';

export type ResearchFormat = 'article' | 'zalo_message' | 'checklist';
export type ResearchSpeakerRole = 'owner' | 'manager' | 'staff' | 'supplier' | 'guest' | 'unknown';
export type ResearchRelevance = 'direct' | 'educational' | 'outside' | 'unknown';
export type ResearchTaskKind = 'discover' | 'collect' | 'analyze' | 'generate';
export type ResearchTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ResearchPainStatus = 'draft' | 'approved' | 'rejected' | 'needs_review' | 'merged' | 'superseded';
export type ResearchContentStatus = 'draft' | 'approved' | 'outdated' | 'archived';

export interface ResearchCapabilities {
  search: {
    provider: string;
    configured: boolean;
  };
  publicWeb: {
    allowedDomains: string[];
  };
  facebook: {
    automaticGroupReading: boolean;
    manualImport: boolean;
  };
  encryption: boolean;
  formats: ResearchFormat[];
}

export interface ResearchEvidence {
  sourceId: string;
  quote: string;
}

export interface ResearchStatusCount {
  status: string;
  _count: number;
}

export interface ResearchTaskSummary {
  id: string;
  projectId?: string;
  kind: ResearchTaskKind;
  status: ResearchTaskStatus;
  input?: Record<string, unknown> | null;
  checkpoint?: Record<string, unknown> | null;
  errorCode?: string | null;
  cancelRequested: boolean;
  createdAt: string;
  completedAt?: string | null;
}

export interface ResearchProject {
  id: string;
  orgId: string;
  createdByUserId: string;
  title: string;
  brief: string;
  modelConfigId: string;
  executor: 'internal' | 'hermes';
  status: string;
  revision: number;
  maxQueries: number;
  searchCalls: number;
  maxSources: number;
  maxAiCalls: number;
  aiCalls: number;
  maxAiCostMicros: string;
  aiCostMicros: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchProjectDetail extends ResearchProject {
  sources: ResearchStatusCount[];
  pains: ResearchStatusCount[];
  contents: ResearchStatusCount[];
  tasks: ResearchTaskSummary[];
}

export interface ResearchSource {
  id: string;
  orgId: string;
  projectId: string;
  title: string;
  url: string | null;
  canonicalKey: string;
  kind: 'web' | 'facebook' | 'manual' | string;
  status: 'pending' | 'read' | 'duplicate' | 'requires_manual' | 'blocked_domain' | 'blocked_robots' | 'failed' | string;
  speakerRole: ResearchSpeakerRole;
  contentHash: string | null;
  duplicateOfId: string | null;
  errorCode: string | null;
  publishedAt: string | null;
  readAt: string | null;
  createdAt: string;
  content: string | null;
  duplicate?: boolean;
}

export interface ResearchPainDetail {
  audience?: string;
  situation?: string;
  impact?: string;
  desire?: string;
  uncertainty?: string;
  relevance?: ResearchRelevance;
  certainty?: 'operator_source' | 'needs_verification' | string;
}

export interface ResearchPain {
  id: string;
  orgId: string;
  projectId: string;
  taskId: string;
  title: string;
  detail: ResearchPainDetail;
  evidence: ResearchEvidence[];
  independentSources: number;
  status: ResearchPainStatus;
  revision: number;
  mergedIntoId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchContent {
  id: string;
  orgId: string;
  projectId: string;
  painId: string;
  taskId: string | null;
  rootId: string | null;
  version: number;
  format: ResearchFormat;
  title: string;
  body: string;
  evidence: ResearchEvidence[];
  missingInformation: string[];
  status: ResearchContentStatus;
  painRevision: number;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface CreateResearchProjectInput {
  title: string;
  brief: string;
  modelConfigId?: string;
  executor?: 'internal' | 'hermes';
}

export interface AddResearchSourceInput {
  title: string;
  url?: string;
  content?: string;
  permissionConfirmed?: boolean;
  speakerRole?: ResearchSpeakerRole;
  publishedAt?: string;
}

export interface ReviewResearchPainInput {
  revision: number;
  title?: string;
  status?: 'draft' | 'approved' | 'rejected';
  detail?: {
    audience?: string;
    situation?: string;
    impact?: string;
    desire?: string;
    uncertainty?: string;
    relevance?: ResearchRelevance;
  };
}

export interface MergeResearchPainInput {
  sourceId: string;
  targetRevision: number;
  sourceRevision: number;
}

export interface CreateResearchTaskInput {
  kind: ResearchTaskKind;
  idempotencyKey: string;
  painId?: string;
  format?: ResearchFormat;
}

const base = '/ai/research';

export function makeResearchIdempotencyKey(prefix: string): string {
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomPart}`.slice(0, 110);
}

export function formatMicrosToUsd(micros: string | number | null | undefined): string {
  const numeric = Number(micros ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '$0.00';
  const usd = numeric / 1_000_000;
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export const SPEAKER_ROLE_LABELS: Record<ResearchSpeakerRole, string> = {
  owner: 'Chủ khách sạn',
  manager: 'Quản lý khách sạn',
  staff: 'Nhân viên khách sạn',
  supplier: 'Nhà cung cấp / người bán',
  guest: 'Khách lưu trú',
  unknown: 'Chưa rõ người viết',
};

export const RELEVANCE_LABELS: Record<ResearchRelevance, string> = {
  direct: 'Liên quan trực tiếp tới chăn ga, khăn, rèm Jolie’Fam',
  educational: 'Vấn đề vận hành chung (dùng để viết bài chia sẻ kinh nghiệm)',
  outside: 'Ngoài phạm vi sản phẩm',
  unknown: 'Cần kiểm tra thêm',
};

export const FORMAT_LABELS: Record<ResearchFormat, string> = {
  zalo_message: 'Tin nhắn Zalo cá nhân',
  article: 'Bài chia sẻ kinh nghiệm',
  checklist: 'Danh sách kiểm tra (Checklist)',
};

export const TASK_KIND_LABELS: Record<ResearchTaskKind, string> = {
  discover: 'Tìm nguồn trên Google',
  collect: 'Đọc nội dung các trang web',
  analyze: 'AI tổng hợp nỗi đau khách hàng',
  generate: 'AI viết bài nháp',
};

export const TASK_STATUS_LABELS: Record<ResearchTaskStatus, string> = {
  queued: 'Đang chờ chạy',
  running: 'Đang xử lý',
  completed: 'Đã xong',
  failed: 'Gặp lỗi',
  cancelled: 'Đã dừng',
};

export const SOURCE_STATUS_LABELS: Record<string, string> = {
  read: 'Đã đọc nội dung',
  pending: 'Chưa đọc nội dung',
  requires_manual: 'Cần dán nội dung thủ công (Facebook)',
  duplicate: 'Trùng nội dung với nguồn khác',
  blocked_domain: 'Trang web chưa nằm trong danh sách cho phép tự đọc',
  blocked_robots: 'Trang web chặn đọc tự động',
  failed: 'Không đọc được trang này',
};

export const PAIN_STATUS_LABELS: Record<ResearchPainStatus, string> = {
  draft: 'Chờ bạn duyệt',
  approved: 'Đã duyệt',
  rejected: 'Đã bỏ qua',
  needs_review: 'Cần xem lại (do mới thêm nguồn)',
  merged: 'Đã gộp vào vấn đề khác',
  superseded: 'Đã thay bằng bản tổng hợp mới',
};

export const CONTENT_STATUS_LABELS: Record<ResearchContentStatus, string> = {
  draft: 'Bản nháp chờ duyệt',
  approved: 'Đã duyệt dùng',
  outdated: 'Cần tạo lại (vấn đề gốc đã đổi)',
  archived: 'Phiên bản cũ đã lưu trữ',
};

export const aiResearchApi = {
  async getHermesStatus(): Promise<{ lastSeenAt: string | null; recentlySeen: boolean }> {
    return (await api.get<{ lastSeenAt: string | null; recentlySeen: boolean }>(`${base}/hermes-status`)).data;
  },
  async getCapabilities(): Promise<ResearchCapabilities> {
    const res = await api.get<ResearchCapabilities>(`${base}/capabilities`);
    return res.data;
  },

  async listProjects(page = 1): Promise<ResearchProject[]> {
    const res = await api.get<{ projects: ResearchProject[] }>(`${base}/projects`, { params: { page } });
    return res.data.projects ?? [];
  },

  async createProject(input: CreateResearchProjectInput): Promise<ResearchProject> {
    const res = await api.post<ResearchProject>(`${base}/projects`, input);
    return res.data;
  },

  async getProject(projectId: string): Promise<ResearchProjectDetail> {
    const res = await api.get<ResearchProjectDetail>(`${base}/projects/${encodeURIComponent(projectId)}`);
    return res.data;
  },

  async listSources(projectId: string, page = 1): Promise<ResearchSource[]> {
    const res = await api.get<{ sources: ResearchSource[] }>(
      `${base}/projects/${encodeURIComponent(projectId)}/sources`, { params: { page } },
    );
    return res.data.sources ?? [];
  },

  async addSource(projectId: string, input: AddResearchSourceInput): Promise<ResearchSource> {
    const res = await api.post<ResearchSource>(
      `${base}/projects/${encodeURIComponent(projectId)}/sources`,
      input,
    );
    return res.data;
  },

  async listPains(projectId: string, page = 1): Promise<ResearchPain[]> {
    const res = await api.get<{ pains: ResearchPain[] }>(
      `${base}/projects/${encodeURIComponent(projectId)}/pains`,
      { params: { page } },
    );
    return res.data.pains ?? [];
  },

  async reviewPain(projectId: string, painId: string, input: ReviewResearchPainInput): Promise<ResearchPain> {
    const res = await api.patch<ResearchPain>(
      `${base}/projects/${encodeURIComponent(projectId)}/pains/${encodeURIComponent(painId)}`,
      input,
    );
    return res.data;
  },

  async mergePain(projectId: string, targetPainId: string, input: MergeResearchPainInput): Promise<ResearchPain> {
    const res = await api.post<ResearchPain>(
      `${base}/projects/${encodeURIComponent(projectId)}/pains/${encodeURIComponent(targetPainId)}/merge`,
      input,
    );
    return res.data;
  },

  async listContents(projectId: string, page = 1): Promise<ResearchContent[]> {
    const res = await api.get<{ contents: ResearchContent[] }>(
      `${base}/projects/${encodeURIComponent(projectId)}/contents`,
      { params: { page } },
    );
    return res.data.contents ?? [];
  },

  async editContent(
    projectId: string,
    contentId: string,
    input: { title?: string; body: string },
  ): Promise<ResearchContent> {
    const res = await api.patch<ResearchContent>(
      `${base}/projects/${encodeURIComponent(projectId)}/contents/${encodeURIComponent(contentId)}`,
      input,
    );
    return res.data;
  },

  async approveContent(projectId: string, contentId: string): Promise<ResearchContent> {
    const res = await api.post<ResearchContent>(
      `${base}/projects/${encodeURIComponent(projectId)}/contents/${encodeURIComponent(contentId)}/approve`,
      {},
    );
    return res.data;
  },

  async createTask(
    projectId: string,
    input: CreateResearchTaskInput,
  ): Promise<{ taskId: string; status: ResearchTaskStatus }> {
    const res = await api.post<{ taskId: string; status: ResearchTaskStatus }>(
      `${base}/projects/${encodeURIComponent(projectId)}/tasks`,
      input,
    );
    return res.data;
  },

  async getTask(projectId: string, taskId: string): Promise<ResearchTaskSummary> {
    const res = await api.get<ResearchTaskSummary>(
      `${base}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`,
    );
    return res.data;
  },

  async cancelTask(projectId: string, taskId: string): Promise<{ taskId: string; status: ResearchTaskStatus }> {
    const res = await api.post<{ taskId: string; status: ResearchTaskStatus }>(
      `${base}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/cancel`,
      {},
    );
    return res.data;
  },

  async retryTask(projectId: string, taskId: string): Promise<{ taskId: string; status: ResearchTaskStatus }> {
    const res = await api.post<{ taskId: string; status: ResearchTaskStatus }>(
      `${base}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/retry`,
      {},
    );
    return res.data;
  },
};
