import { onScopeDispose, ref } from 'vue';
import { api } from '@/api';
import { createAppSocket } from '@/api/socket';
import type { Socket } from 'socket.io-client';
import type { AiReadinessStatus } from '@/api/ai-admin';

export type ConversationInsightSummary = {
  id: string;
  version: number;
  sourceThroughMessageId: string | null;
  createdAt: string;
  content: {
    currentDiscussion?: string;
    unansweredQuestions?: string[];
    currentProduct?: unknown;
    currentEmotion?: unknown;
  } | null;
};

export type ConversationMemoryCandidate = {
  id: string;
  key: string;
  valueRedacted: string | null;
  status: string;
  confidence: number | null;
  updatedAt: string;
};

export type ConversationInsight = {
  id: string;
  version: number;
  mode: 'shadow' | 'automatic_followup';
  sourceThroughMessageId?: string | null;
  latestMessageId?: string | null;
  latestMessageAt?: string | null;
  analysisProgress?: {
    aiStatus: 'pending' | 'queued' | 'analyzing' | 'ready' | 'verification' | 'failed' | 'not_applicable';
    aiStatusLabel: string;
    aiStatusDetail: string;
  };
  stage: string;
  stageConfidence: number;
  stageReason: string | null;
  intent: { label: string; confidence: number };
  emotion: { label: string; confidence: number; intensity: number | null };
  requiresHuman: boolean;
  nextAction: { key: string; reason: string | null; workflowType: string | null };
  signals: Record<string, unknown>;
  safeguards: {
    autoSendAllowed?: boolean;
    workflowEnrollmentAllowed?: boolean;
    crmStatusMutationAllowed?: boolean;
    autoTagMutationAllowed?: boolean;
  };
  automation: {
    enabled?: boolean;
    outcome: 'success' | 'no_change' | 'blocked' | 'failed' | 'already_processed';
    reason?: string;
    desiredWorkflowType?: string | null;
    enrollmentId?: string | null;
    actions?: Array<{ type: string; label?: string; reason?: string }>;
    updatedAt: string;
  } | null;
  summary: ConversationInsightSummary | null;
  memoryCandidates: ConversationMemoryCandidate[];
  createdAt: string;
  updatedAt: string;
};

export type ConversationInsightReadiness = {
  aiStatus: AiReadinessStatus;
  accountStatus: string;
  accountName: string | null;
};

function safeInsightError(requestError: any): string {
  const status = Number(requestError?.response?.status || 0);
  if (status === 401 || status === 403) return 'Bạn không có quyền xem phân tích của hội thoại này.';
  if (status === 404) return 'Không tìm thấy hội thoại để phân tích.';
  if (status === 429) return 'AI đang xử lý quá nhiều yêu cầu. Hãy thử lại sau ít phút.';
  if (!requestError?.response) return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.';
  return 'Không tải được phân tích hội thoại. Hãy thử lại.';
}

export function useConversationInsight() {
  const insight = ref<ConversationInsight | null>(null);
  const readiness = ref<ConversationInsightReadiness | null>(null);
  const loading = ref(false);
  const error = ref('');
  const analysisProgress = ref<ConversationInsight['analysisProgress'] | null>(null);
  const latestMessageId = ref<string | null>(null);
  const invalidated = ref(false);
  let activeConversationId: string | null = null;
  let generation = 0;
  let activityVersion = 0;
  let socket: Socket | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let refreshAgain = false;
  let pollAttempts = 0;
  let awaitingRefresh = false;
  let previousMarker: string | null = null;
  let previousAttemptMarker: string | null = null;
  let attemptMarker: string | null = null;
  let posting = false;
  const autoAnalyzeAttempted = new Set<string>();
  const marker = () => insight.value ? `${insight.value.id}:${insight.value.version}:${insight.value.updatedAt}` : null;
  const isBusy = () => ['queued', 'analyzing'].includes(analysisProgress.value?.aiStatus || '');
  const isFresh = () => !!insight.value && !invalidated.value
    && (!latestMessageId.value || insight.value.sourceThroughMessageId === latestMessageId.value);

  function cancelTimers() {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (pollTimer) clearTimeout(pollTimer);
    refreshTimer = null;
    pollTimer = null;
  }

  function scheduleRefresh(delay = 350) {
    if (!activeConversationId) return;
    cancelTimers();
    refreshTimer = setTimeout(() => { refreshTimer = null; void readSnapshot(); }, delay);
  }

  function schedulePoll() {
    if (pollTimer || refreshTimer || posting || !activeConversationId || pollAttempts >= 450) return;
    if (!isBusy() && !awaitingRefresh) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      pollAttempts += 1;
      void readSnapshot();
    }, 2_000);
  }

  function startRealtime() {
    if (socket) return;
    socket = createAppSocket({ onReconnect: () => scheduleRefresh(0) });
    socket.on('chat:message', (payload: { conversationId?: string; systemNotification?: boolean }) => {
      if (payload.conversationId !== activeConversationId || payload.systemNotification) return;
      // Hide the previous recommendation immediately, before the status fetch.
      invalidated.value = true;
      analysisProgress.value = {
        aiStatus: 'pending', aiStatusLabel: 'Chờ kết quả phân tích AI',
        aiStatusDetail: 'Hội thoại vừa có tin nhắn mới, đang lấy trạng thái cập nhật.',
      };
      activityVersion += 1;
      pollAttempts = 0;
      scheduleRefresh();
    });
    socket.on('work-items:updated', (payload: { conversationId?: string }) => {
      if (payload.conversationId === activeConversationId) scheduleRefresh();
    });
  }

  function clear() {
    generation += 1;
    activeConversationId = null;
    cancelTimers();
    socket?.disconnect();
    socket = null;
    inFlight = null;
    refreshAgain = false;
    posting = false;
    awaitingRefresh = false;
    previousAttemptMarker = null;
    attemptMarker = null;
    pollAttempts = 0;
    invalidated.value = false;
    latestMessageId.value = null;
    analysisProgress.value = null;
    insight.value = null;
    readiness.value = null;
    loading.value = false;
    error.value = '';
  }

  function selectConversation(conversationId: string) {
    if (activeConversationId === conversationId) return;
    clear();
    activeConversationId = conversationId;
    startRealtime();
  }

  async function readSnapshot(quiet = true): Promise<void> {
    if (!activeConversationId) return;
    if (inFlight) { refreshAgain = true; return inFlight; }
    const currentGeneration = generation;
    const currentActivity = activityVersion;
    const conversationId = activeConversationId;
    if (!quiet) loading.value = true;
    const request = (async () => {
      try {
        const { data } = await api.get<{
          insight: ConversationInsight | null;
          readiness?: ConversationInsightReadiness;
          latestMessageId?: string | null;
          analysisProgress?: ConversationInsight['analysisProgress'];
          analysisAttempt?: { status: string; updatedAt: string; messageId: string } | null;
        }>(`/ai/insights/conversations/${conversationId}`, { timeout: 15_000 });
        if (currentGeneration !== generation) return;
        if (currentActivity !== activityVersion) { refreshAgain = true; return; }
        const wasBusy = isBusy();
        insight.value = data.insight;
        readiness.value = data.readiness ?? readiness.value;
        latestMessageId.value = data.latestMessageId ?? data.insight?.latestMessageId ?? null;
        analysisProgress.value = data.analysisProgress ?? data.insight?.analysisProgress ?? null;
        attemptMarker = data.analysisAttempt ? `${data.analysisAttempt.status}:${data.analysisAttempt.updatedAt}` : null;
        invalidated.value = false;
        error.value = '';
        if (!wasBusy && isBusy()) pollAttempts = 0;
        if (analysisProgress.value?.aiStatus === 'failed'
          || data.analysisAttempt?.status === 'failed' && attemptMarker !== previousAttemptMarker
          || (isFresh() && !isBusy() && marker() !== previousMarker)) awaitingRefresh = false;
      } catch (requestError: any) {
        if (currentGeneration !== generation) return;
        if ([401, 403, 404].includes(Number(requestError?.response?.status))) clear();
        error.value = safeInsightError(requestError);
      } finally {
        if (currentGeneration === generation) {
          inFlight = null;
          if (!posting) loading.value = false;
          if (refreshAgain) { refreshAgain = false; scheduleRefresh(0); }
          else schedulePoll();
        }
      }
    })();
    inFlight = request;
    return request;
  }

  async function analyzeInsight(conversationId: string) {
    selectConversation(conversationId);
    if (posting) return;
    const currentGeneration = generation;
    posting = true;
    loading.value = true;
    previousMarker = marker();
    previousAttemptMarker = attemptMarker;
    pollAttempts = 0;
    error.value = '';
    try {
      const queued = await api.post(`/ai/insights/conversations/${conversationId}/analyze`, {}, { timeout: 15_000 });
      if (currentGeneration !== generation) return;
      awaitingRefresh = queued.data?.queued === true;
      if (awaitingRefresh) {
        analysisProgress.value = {
          aiStatus: 'queued', aiStatusLabel: 'Đang chờ AI xử lý',
          aiStatusDetail: 'Tin nhắn mới nhất đã được đưa vào hàng đợi phân tích.',
        };
      }
      await readSnapshot();
    } catch (requestError: any) {
      if (currentGeneration === generation) error.value = safeInsightError(requestError);
    } finally {
      if (currentGeneration === generation) {
        posting = false;
        loading.value = false;
        schedulePoll();
      }
    }
  }

  async function fetchInsight(conversationId: string) {
    selectConversation(conversationId);
    const currentGeneration = generation;
    await readSnapshot(false);
    if (currentGeneration !== generation || error.value) return;
    // Only the initial view may backfill; live events only read persisted state.
    if (!isFresh() && !isBusy()
      && analysisProgress.value?.aiStatus !== 'failed'
      && ['ready', 'needs_test'].includes(readiness.value?.aiStatus || '')
      && !autoAnalyzeAttempted.has(conversationId)) {
      autoAnalyzeAttempted.add(conversationId);
      await analyzeInsight(conversationId);
    }
  }

  onScopeDispose(clear);
  function refreshStatus() {
    pollAttempts = 0;
    return readSnapshot(false);
  }
  return { insight, readiness, analysisProgress, latestMessageId, invalidated, loading, error, fetchInsight, analyzeInsight, refreshStatus, clear };
}
