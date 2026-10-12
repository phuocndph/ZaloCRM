import { onScopeDispose, ref, watch, type Ref } from 'vue';
import { api } from '@/api';
import { createAppSocket } from '@/api/socket';
import { compareEchoMessages, isSameMessageIdentity, upsertMessageByIdentity } from '@/composables/chat-outbox';
import type { Conversation, Message } from '@/composables/use-chat';
import { normalizeChatMessage } from './normalize-chat-message';
import type { Socket } from 'socket.io-client';

type HistoryPage = { messages: Message[]; hasMore: boolean; nextCursor?: string | null };

export function useConversationPreview(conversationId: Ref<string>, viewerId: Ref<string | null | undefined> = ref(null)) {
  const normalizePreviewMessage = (message: Message) => normalizeChatMessage(message, viewerId.value ?? '');
  const conversation = ref<Conversation | null>(null);
  const messages = ref<Message[]>([]);
  const loading = ref(false);
  const loadingOlder = ref(false);
  const hasMore = ref(false);
  const error = ref('');
  const blocked = ref(false);
  const realtimeOffline = ref(false);
  const typingUsers = ref<Array<{ userId: string; userName: string }>>([]);
  let typingTimer: ReturnType<typeof setTimeout> | null = null;
  const customerTyping = ref(false);
  let customerTypingTimer: ReturnType<typeof setTimeout> | null = null;
  let sequence = 0;
  let controller: AbortController | null = null;
  let olderController: AbortController | null = null;
  let contextController: AbortController | null = null;
  let cursor: string | null = null;
  let page = 1;
  let expanded = false;
  let socket: Socket | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  function clearContent() {
    if (typingTimer) clearTimeout(typingTimer);
    if (customerTypingTimer) clearTimeout(customerTypingTimer);
    typingTimer = null;
    customerTypingTimer = null;
    conversation.value = null;
    messages.value = [];
    hasMore.value = false;
    typingUsers.value = [];
    customerTyping.value = false;
  }

  function handleError(cause: unknown) {
    const response = (cause as { response?: { status?: number; data?: { code?: string } } }).response;
    if ([403, 404].includes(response?.status ?? 0)) {
      ++sequence;
      controller?.abort();
      controller = null;
      clearContent();
      olderController?.abort();
      contextController?.abort();
      loading.value = false;
      loadingOlder.value = false;
      blocked.value = true;
      error.value = response?.data?.code === 'CONVERSATION_PRIVATE'
        ? 'Cuộc hội thoại này đang ở chế độ riêng tư.'
        : 'Hội thoại không còn khả dụng hoặc bạn không có quyền xem.';
    } else {
      error.value = 'Không tải được hội thoại. Vui lòng thử lại.';
    }
  }

  async function refresh() {
    const id = conversationId.value;
    if (!id || disposed) return;
    const request = ++sequence;
    controller?.abort();
    const current = new AbortController();
    controller = current;
    loading.value = !conversation.value;
    error.value = '';
    try {
      // Both endpoints enforce the viewer's access; preview never calls selectConversation/mark-read.
      const [detail, history] = await Promise.all([
        api.get<Conversation>(`/conversations/${id}`, { signal: current.signal }),
        api.get<HistoryPage>(`/conversations/${id}/messages`, { params: { limit: 40 }, signal: current.signal }),
      ]);
      if (disposed || current.signal.aborted || request !== sequence || id !== conversationId.value) return;
      conversation.value = detail.data;
      const latest = (history.data.messages ?? []).map(normalizePreviewMessage);
      let merged = expanded ? [...messages.value] : messages.value.filter((message) => message.isPending);
      for (const message of latest) merged = upsertMessageByIdentity(merged, message);
      messages.value = merged.sort(compareEchoMessages);
      if (!expanded) {
        cursor = history.data.nextCursor ?? null;
        hasMore.value = history.data.hasMore === true;
      }
      blocked.value = false;
    } catch (cause) {
      if (!disposed && !current.signal.aborted && request === sequence && id === conversationId.value) {
        current.abort();
        handleError(cause);
      }
    } finally {
      if (request === sequence && !disposed) {
        loading.value = false;
        if (controller === current) controller = null;
      }
    }
  }

  async function loadOlder() {
    if (!hasMore.value || loadingOlder.value || loading.value || blocked.value) return;
    const id = conversationId.value;
    const current = new AbortController();
    olderController = current;
    const nextPage = page + 1;
    loadingOlder.value = true;
    try {
      const { data } = await api.get<HistoryPage>(`/conversations/${id}/messages`, {
        params: { limit: 40, ...(cursor ? { cursor } : { page: nextPage }) }, signal: current.signal,
      });
      if (disposed || current.signal.aborted || id !== conversationId.value || blocked.value) return;
      let merged = [...messages.value];
      for (const message of (data.messages ?? []).map(normalizePreviewMessage)) merged = upsertMessageByIdentity(merged, message);
      messages.value = merged.sort(compareEchoMessages);
      page = nextPage;
      cursor = data.nextCursor ?? null;
      hasMore.value = data.hasMore === true;
      expanded = true;
      error.value = '';
    } catch (cause) {
      if (!disposed && !current.signal.aborted && id === conversationId.value) handleError(cause);
    } finally {
      if (olderController === current) { olderController = null; loadingOlder.value = false; }
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => { refreshTimer = null; void refresh(); }, 350);
  }

  async function loadContext(messageId: string) {
    if (!conversation.value || blocked.value) return;
    const id = conversationId.value;
    contextController?.abort();
    const current = new AbortController();
    contextController = current;
    try {
      const { data } = await api.get<{ items: Message[] }>(`/conversations/${id}/messages/${encodeURIComponent(messageId)}/context`, {
        params: { before: 10, after: 10 }, signal: current.signal,
      });
      if (disposed || current.signal.aborted || id !== conversationId.value || blocked.value) return;
      let merged = [...messages.value];
      for (const message of (data.items ?? []).map(normalizePreviewMessage)) merged = upsertMessageByIdentity(merged, message);
      messages.value = merged.sort(compareEchoMessages);
      expanded = true;
    } catch (cause) {
      if (!disposed && !current.signal.aborted && id === conversationId.value) {
        const status = (cause as { response?: { status?: number } }).response?.status;
        if (status === 404) error.value = 'Không tìm thấy tin gốc trong hội thoại.';
        else handleError(cause);
      }
    }
  }

  function invalidate() {
    ++sequence;
    controller?.abort();
    olderController?.abort();
    contextController?.abort();
    olderController = null;
    loadingOlder.value = false;
    clearContent();
    cursor = null;
    page = 1;
    expanded = false;
    scheduleRefresh();
  }

  watch(conversationId, () => {
    ++sequence;
    controller?.abort();
    olderController?.abort();
    contextController?.abort();
    olderController = null;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    clearContent();
    blocked.value = false;
    loadingOlder.value = false;
    cursor = null;
    page = 1;
    expanded = false;
    void refresh();
  }, { immediate: true });

  socket = createAppSocket({
    onStatusChange: (status) => { realtimeOffline.value = status !== 'connected'; },
    onReconnect: () => invalidate(),
  });
  socket.on('chat:typing', (payload: { conversationId?: string; typers?: Array<{ userId: string; userName: string }> }) => {
    if (!conversation.value || payload?.conversationId !== conversationId.value || blocked.value) return;
    typingUsers.value = payload.typers ?? [];
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { typingUsers.value = []; }, 6000);
  });
  socket.on('zalo:typing', (payload: { accountId?: string; threadId?: string }) => {
    if (!conversation.value || blocked.value || payload.accountId !== conversation.value.zaloAccount?.id || payload.threadId !== conversation.value.externalThreadId) return;
    customerTyping.value = true;
    if (customerTypingTimer) clearTimeout(customerTypingTimer);
    customerTypingTimer = setTimeout(() => { customerTyping.value = false; }, 5000);
  });
  for (const event of ['chat:message', 'chat:deleted', 'chat:message-edited', 'chat:reactions', 'chat:group-info-updated', 'conversation:state', 'conversation:pin', 'conversation:unpin', 'zalo:message-status']) {
    socket.on(event, (payload: { conversationId?: string }) => {
      if (payload?.conversationId === conversationId.value) scheduleRefresh();
    });
  }
  for (const event of ['zalo:access-changed', 'privacy:mode-changed', 'conversation:privacy-changed']) socket.on(event, invalidate);
  // Read through authorized HTTP, not raw socket content, including reconnects and missed events.
  poll = setInterval(() => {
    if (document.visibilityState !== 'hidden' && !controller) void refresh();
  }, 30_000);
  onScopeDispose(() => {
    disposed = true;
    ++sequence;
    controller?.abort();
    olderController?.abort();
    contextController?.abort();
    if (refreshTimer) clearTimeout(refreshTimer);
    if (poll) clearInterval(poll);
    if (typingTimer) clearTimeout(typingTimer);
    if (customerTypingTimer) clearTimeout(customerTypingTimer);
    socket?.disconnect();
  });
  function addOptimisticMessages(id: string, outgoing: Message[]) {
    if (disposed || id !== conversationId.value || blocked.value) return;
    for (const message of outgoing) messages.value = upsertMessageByIdentity(messages.value, message);
  }
  function reconcileOptimisticMessages(id: string, temporaryIds: string[], confirmed: Message[]) {
    if (disposed || id !== conversationId.value || blocked.value) return;
    messages.value = messages.value.filter((message) => !temporaryIds.includes(message.id)
      || confirmed.some((incoming) => isSameMessageIdentity(message, incoming)));
    addOptimisticMessages(id, confirmed.map(normalizePreviewMessage));
  }
  function removeOptimisticMessages(id: string, temporaryIds: string[]) {
    if (!disposed && id === conversationId.value) messages.value = messages.value.filter((message) => !temporaryIds.includes(message.id));
  }
  return { conversation, messages, loading, loadingOlder, hasMore, error, blocked, realtimeOffline, typingUsers, customerTyping,
    refresh, loadOlder, loadContext, invalidate, addOptimisticMessages, reconcileOptimisticMessages, removeOptimisticMessages };
}
