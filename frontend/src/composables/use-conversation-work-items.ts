import { ref } from 'vue';
import { api } from '@/api';
import { createAppSocket } from '@/api/socket';
import type { Socket } from 'socket.io-client';

export type WorkItemScope = 'now' | 'today' | 'waiting' | 'upcoming' | 'verify' | 'done';
export type WorkItemPriority = 'critical' | 'high' | 'normal' | 'low';

export interface ConversationWorkItemMetadata {
  contactName?: string;
  contactAvatar?: string | null;
  nickNames?: string[];
  conversationIds?: string[];
  unreadCount?: number;
  signalCount?: number;
  signals?: Array<{ kind?: string; title?: string; dueAt?: string | null }>;
  actionKey?: string;
  isGroup?: boolean;
  groupName?: string;
  groupCategory?: string;
  actionableSenderUid?: string | null;
  actionableSenderName?: string | null;
  actionableMessageId?: string | null;
  actionableRequest?: string | null;
  requiredEmployeeAction?: string | null;
}

export interface ConversationWorkItem {
  id: string;
  contactId: string;
  conversationId: string | null;
  kind: string;
  status: 'open' | 'snoozed' | 'completed';
  priority: WorkItemPriority;
  priorityScore: number;
  title: string;
  customerSituation: string | null;
  nextAction: string;
  reason: string | null;
  dueAt: string | null;
  snoozedUntil: string | null;
  confidence: number | null;
  metadata: ConversationWorkItemMetadata | null;
  contact?: {
    id: string;
    fullName: string | null;
    crmName: string | null;
    avatarUrl: string | null;
  };
  conversation?: {
    id: string;
    zaloAccount?: { displayName: string; status: string } | null;
  } | null;
}

export interface WorkItemCounts {
  now: number;
  today: number;
  waiting: number;
  upcoming: number;
  verify: number;
  done: number;
  all?: number;
}

export interface WorkItemSummary {
  totalActive: number;
  critical: number;
  overdue: number;
  waitingReply: number;
  verification: number;
}

type WorkItemResponse = {
  items: ConversationWorkItem[];
  counts: WorkItemCounts;
  summary?: WorkItemSummary;
  generatedAt: string;
  hasMore?: boolean;
  nextOffset?: number | null;
};

export function useConversationWorkItems() {
  const items = ref<ConversationWorkItem[]>([]);
  const counts = ref<WorkItemCounts>({ now: 0, today: 0, waiting: 0, upcoming: 0, verify: 0, done: 0 });
  const summary = ref<WorkItemSummary>({ totalActive: 0, critical: 0, overdue: 0, waitingReply: 0, verification: 0 });
  const loading = ref(false);
  const loadingMore = ref(false);
  const hasMore = ref(false);
  const mutatingId = ref<string | null>(null);
  const error = ref<string | null>(null);
  let requestSequence = 0;
  let socket: Socket | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let activeScope: WorkItemScope = 'now';
  let activeAsUserId: string | null | undefined;
  let activeQuery = '';

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { void fetchItems(activeScope, activeAsUserId, true, activeQuery); }, 350);
  }

  function startRealtime() {
    if (socket) return;
    socket = createAppSocket();
    const refreshOnActivity = (payload: { conversationId?: string; itemId?: string } = {}) => {
      if (payload.conversationId || payload.itemId) scheduleRefresh();
    };
    socket.on('chat:message', refreshOnActivity);
    socket.on('work-items:updated', refreshOnActivity);
  }

  async function fetchItems(scope: WorkItemScope, asUserId?: string | null, quiet = false, query = '') {
    const sequence = ++requestSequence;
    activeScope = scope;
    activeAsUserId = asUserId;
    activeQuery = query.trim();
    if (!quiet) loading.value = true;
    error.value = null;
    try {
      startRealtime();
      const { data } = await api.get<WorkItemResponse>('/work-items', {
        params: { scope, limit: 40, offset: 0, ...(activeQuery ? { q: activeQuery } : {}), ...(asUserId ? { asUserId } : {}) },
      });
      if (sequence !== requestSequence) return;
      items.value = data.items ?? [];
      counts.value = { ...counts.value, ...(data.counts ?? {}) };
      summary.value = { ...summary.value, ...(data.summary ?? {}) };
      hasMore.value = data.hasMore === true;
    } catch {
      if (sequence === requestSequence) error.value = 'Không tải được danh sách công việc. Vui lòng thử lại.';
    } finally {
      if (sequence === requestSequence) loading.value = false;
    }
  }

  async function loadMore() {
    if (!hasMore.value || loadingMore.value) return;
    const sequence = requestSequence;
    loadingMore.value = true;
    try {
      const { data } = await api.get<WorkItemResponse>('/work-items', {
        params: {
          scope: activeScope,
          limit: 40,
          offset: items.value.length,
          ...(activeQuery ? { q: activeQuery } : {}),
          ...(activeAsUserId ? { asUserId: activeAsUserId } : {}),
        },
      });
      if (sequence !== requestSequence) return;
      const existingIds = new Set(items.value.map((item) => item.id));
      items.value = [...items.value, ...(data.items ?? []).filter((item) => !existingIds.has(item.id))];
      hasMore.value = data.hasMore === true;
    } finally {
      if (sequence === requestSequence) loadingMore.value = false;
    }
  }

  async function updateItem(
    itemId: string,
    action: 'complete' | 'snooze' | 'reopen',
    options?: { snoozeMinutes?: number; snoozedUntil?: string },
  ) {
    mutatingId.value = itemId;
    try {
      await api.patch(`/work-items/${itemId}`, { action, ...options });
    } finally {
      mutatingId.value = null;
    }
  }

  function stopRealtime() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    socket?.disconnect();
    socket = null;
  }

  return { items, counts, summary, loading, loadingMore, hasMore, mutatingId, error, fetchItems, loadMore, updateItem, stopRealtime };
}
