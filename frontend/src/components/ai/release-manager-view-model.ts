import type { AiReleaseRecord, AiReleaseStatus } from '@/api/ai-releases';

export type ReleaseStatusTone = 'neutral' | 'warning' | 'ready' | 'live' | 'muted' | 'danger';
export type ReleaseAction = 'submit' | 'approve' | 'deploy' | 'rollback';

export interface ReleaseActionState {
  action: ReleaseAction;
  label: string;
  enabled: boolean;
  tone: 'primary' | 'secondary' | 'danger';
  reason?: string;
}

const STATUS_META: Record<AiReleaseStatus, {
  label: string;
  shortLabel: string;
  tone: ReleaseStatusTone;
  description: string;
}> = {
  draft: {
    label: 'Bản nháp',
    shortLabel: 'Nháp',
    tone: 'neutral',
    description: 'Ảnh chụp cấu hình đã được khóa; cần một lượt đánh giá đạt để gửi duyệt.',
  },
  pending_approval: {
    label: 'Đã gửi · Chờ duyệt',
    shortLabel: 'Chờ duyệt',
    tone: 'warning',
    description: 'Đang chờ một quản trị viên khác phê duyệt theo nguyên tắc maker–checker.',
  },
  approved: {
    label: 'Đã phê duyệt',
    shortLabel: 'Đã duyệt',
    tone: 'ready',
    description: 'Cổng đánh giá và phê duyệt đã đạt; có thể áp dụng làm Release hoạt động.',
  },
  production: {
    label: 'Đang áp dụng',
    shortLabel: 'Production',
    tone: 'live',
    description: 'Đây là con trỏ Release đang hoạt động cho tổ chức.',
  },
  superseded: {
    label: 'Đã được thay thế',
    shortLabel: 'Đã thay thế',
    tone: 'muted',
    description: 'Một Release mới hơn đang hoạt động; bản này có thể là đích khôi phục.',
  },
  rolled_back: {
    label: 'Đã khôi phục',
    shortLabel: 'Đã rollback',
    tone: 'muted',
    description: 'Release này đã được rút khỏi con trỏ hoạt động bằng thao tác khôi phục.',
  },
  failed: {
    label: 'Áp dụng thất bại',
    shortLabel: 'Thất bại',
    tone: 'danger',
    description: 'Quá trình áp dụng không hoàn tất; cần rà soát nhật ký trước khi thử lại.',
  },
};

const ERROR_MESSAGES: Record<string, string> = {
  RELEASE_SNAPSHOT_REQUIRED: 'Hãy chọn ít nhất một thành phần để tạo ảnh chụp Release.',
  RELEASE_SNAPSHOT_EMPTY: 'Ảnh chụp Release phải có ít nhất một lời nhắc, mô hình, kỹ năng hoặc nguồn tri thức.',
  RELEASE_SNAPSHOT_INVALID: 'Danh sách thành phần trong ảnh chụp không hợp lệ.',
  RELEASE_SNAPSHOT_TOO_LARGE: 'Ảnh chụp có quá nhiều thành phần. Hãy thu hẹp phạm vi.',
  RELEASE_COMPONENT_NOT_FOUND: 'Có thành phần không tồn tại hoặc không thuộc tổ chức hiện tại.',
  RELEASE_EVALUATION_REQUIRED: 'Cần chọn một lượt đánh giá đã hoàn tất và đạt ngưỡng.',
  RELEASE_EVALUATION_NOT_FOUND: 'Không tìm thấy lượt đánh giá trong tổ chức hiện tại.',
  RELEASE_EVALUATION_NOT_PASSED: 'Lượt đánh giá chưa hoàn tất hoặc chưa đạt ngưỡng.',
  RELEASE_EVALUATION_TARGET_MISMATCH: 'Lượt đánh giá không khớp với thành phần trong ảnh chụp Release.',
  RELEASE_MAKER_CHECKER_REQUIRED: 'Người tạo Release không được tự phê duyệt. Hãy nhờ một quản trị viên khác.',
  RELEASE_INVALID_TRANSITION: 'Trạng thái hiện tại không cho phép thao tác này.',
  RELEASE_ROLLBACK_TARGET_MISSING: 'Release này không có phiên bản trước để khôi phục.',
  RELEASE_ROLLBACK_TARGET_INVALID: 'Phiên bản trước không còn hợp lệ để khôi phục.',
  RELEASE_SNAPSHOT_TAMPERED: 'Ảnh chụp Release không còn toàn vẹn. Không thể tiếp tục.',
  RELEASE_NOT_FOUND: 'Không tìm thấy Release trong tổ chức hiện tại.',
};

export function releaseStatusMeta(status: AiReleaseStatus) {
  return STATUS_META[status] ?? {
    label: status,
    shortLabel: status,
    tone: 'muted' as const,
    description: 'Trạng thái Release chưa được nhận diện.',
  };
}

function action(
  actionName: ReleaseAction,
  label: string,
  tone: ReleaseActionState['tone'],
  enabled = true,
  reason?: string,
): ReleaseActionState {
  return { action: actionName, label, tone, enabled, ...(reason ? { reason } : {}) };
}

export function releaseActionStates(release: AiReleaseRecord): ReleaseActionState[] {
  switch (release.status) {
    case 'draft':
      return [action(
        'submit',
        'Gửi phê duyệt',
        'primary',
        Boolean(release.evaluationRunId),
        release.evaluationRunId ? undefined : 'Chọn lượt đánh giá đạt trước khi gửi.',
      )];
    case 'pending_approval':
      return [action('approve', 'Phê duyệt', 'primary')];
    case 'approved':
      return [action('deploy', 'Áp dụng Release', 'primary')];
    case 'production':
      return [action(
        'rollback',
        'Khôi phục bản trước',
        'danger',
        Boolean(release.previousReleaseId),
        release.previousReleaseId ? undefined : 'Chưa có Release trước đó để khôi phục.',
      )];
    default:
      return [];
  }
}

export function releaseSnapshotCounts(release: Pick<AiReleaseRecord, 'snapshot'>) {
  const snapshot = release.snapshot;
  return {
    prompts: snapshot?.promptVersions?.length ?? 0,
    models: snapshot?.modelConfigs?.length ?? 0,
    skills: snapshot?.skills?.length ?? 0,
    knowledge:
      (snapshot?.knowledgeSources?.length ?? 0)
      + (snapshot?.knowledgeDocuments?.length ?? 0),
  };
}

export function releaseComponentCount(release: Pick<AiReleaseRecord, 'snapshot'>): number {
  return Object.values(releaseSnapshotCounts(release)).reduce((sum, count) => sum + count, 0);
}

export function filterAiReleases(
  releases: AiReleaseRecord[],
  search: string,
  status: '' | AiReleaseStatus,
): AiReleaseRecord[] {
  const query = search.trim().toLocaleLowerCase('vi');
  return releases.filter((release) => {
    const snapshot = release.snapshot;
    const haystack = [
      `v${release.version}`,
      release.id,
      release.evaluationRunId,
      ...((snapshot?.modelConfigs ?? []).flatMap((model) => [model.name, model.provider, model.model])),
      ...((snapshot?.skills ?? []).flatMap((skill) => [skill.name, skill.key])),
      ...((snapshot?.knowledgeSources ?? []).map((source) => source.name)),
      ...((snapshot?.knowledgeDocuments ?? []).map((document) => document.title)),
    ].filter(Boolean).join(' ').toLocaleLowerCase('vi');

    return (!status || release.status === status) && (!query || haystack.includes(query));
  });
}

export function releaseErrorMessage(
  error: unknown,
  fallback = 'Không thể hoàn tất thao tác Release. Vui lòng thử lại.',
): string {
  const response = error && typeof error === 'object' && 'response' in error
    ? (error as { response?: { data?: { code?: unknown; error?: unknown } } }).response
    : undefined;
  const code = typeof response?.data?.code === 'string' ? response.data.code : '';
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  return typeof response?.data?.error === 'string' && response.data.error.trim()
    ? response.data.error
    : fallback;
}

export function releaseLifecycleIndex(status: AiReleaseStatus): number {
  if (status === 'draft') return 0;
  if (status === 'pending_approval') return 1;
  if (status === 'approved') return 2;
  if (status === 'production') return 3;
  return -1;
}
