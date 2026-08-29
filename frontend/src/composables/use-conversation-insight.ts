import { ref } from 'vue';
import { api } from '@/api';
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
  let requestVersion = 0;
  const autoAnalyzeAttempted = new Set<string>();

  const sleep = (milliseconds: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });

  async function analyzeInsight(conversationId: string) {
    const currentRequest = ++requestVersion;
    const previousInsightMarker = insight.value
      ? `${insight.value.id}:${insight.value.version}:${insight.value.updatedAt}`
      : null;
    loading.value = true;
    error.value = '';
    try {
      const queued = await api.post(
        `/ai/insights/conversations/${conversationId}/analyze`,
        {},
        { timeout: 15_000 },
      );
      if (currentRequest !== requestVersion) return;
      if (!queued.data?.queued) {
        const latest = await api.get(`/ai/insights/conversations/${conversationId}`);
        if (currentRequest === requestVersion) {
          insight.value = latest.data.insight;
          readiness.value = latest.data.readiness ?? readiness.value;
        }
        return;
      }
      // The worker uses one prepared conversation package for a combined AI
      // analysis. Poll for the persisted result without blocking this request.
      for (let attempt = 0; attempt < 45; attempt += 1) {
        await sleep(2_000);
        if (currentRequest !== requestVersion) return;
        const latest = await api.get(`/ai/insights/conversations/${conversationId}`);
        if (currentRequest !== requestVersion) return;
        insight.value = latest.data.insight;
        readiness.value = latest.data.readiness ?? readiness.value;
        const latestMarker = insight.value
          ? `${insight.value.id}:${insight.value.version}:${insight.value.updatedAt}`
          : null;
        if (latestMarker && latestMarker !== previousInsightMarker) break;
      }
    } catch (requestError: any) {
      if (currentRequest !== requestVersion) return;
      insight.value = null;
      error.value = safeInsightError(requestError);
    } finally {
      if (currentRequest === requestVersion) loading.value = false;
    }
  }

  function clear() {
    requestVersion += 1;
    insight.value = null;
    readiness.value = null;
    loading.value = false;
    error.value = '';
  }

  async function fetchInsight(conversationId: string) {
    const currentRequest = ++requestVersion;
    loading.value = true;
    error.value = '';
    try {
      const loadLatest = () => api.get<{
        insight: ConversationInsight | null;
        readiness?: ConversationInsightReadiness;
      }>(`/ai/insights/conversations/${conversationId}`);
      let response = await loadLatest();
      if (currentRequest !== requestVersion) return;
      insight.value = response.data.insight;
      readiness.value = response.data.readiness ?? null;

      // A conversation imported before AI was configured has no inbound event
      // left to trigger the debounced worker. Backfill it once on first view,
      // then poll until the worker has persisted the insight.
      const readyForBackfill = !insight.value
        && ['ready', 'needs_test'].includes(readiness.value?.aiStatus || '')
        && !autoAnalyzeAttempted.has(conversationId);
      if (readyForBackfill) {
        autoAnalyzeAttempted.add(conversationId);
        const queued = await api.post(
          `/ai/insights/conversations/${conversationId}/analyze`,
          {},
          { timeout: 15_000 },
        );
        if (currentRequest !== requestVersion) return;
        if (queued.data?.queued) {
          // F5Quota requests can take tens of seconds. Keep the panel in a
          // loading state while checking, without blocking the HTTP request.
          for (let attempt = 0; attempt < 45; attempt += 1) {
            await sleep(2_000);
            if (currentRequest !== requestVersion) return;
            response = await loadLatest();
            if (currentRequest !== requestVersion) return;
            insight.value = response.data.insight;
            readiness.value = response.data.readiness ?? readiness.value;
            if (insight.value) break;
          }
        }
      }
    } catch (requestError: any) {
      if (currentRequest !== requestVersion) return;
      insight.value = null;
      readiness.value = null;
      error.value = safeInsightError(requestError);
    } finally {
      if (currentRequest === requestVersion) loading.value = false;
    }
  }

  return { insight, readiness, loading, error, fetchInsight, analyzeInsight, clear };
}
