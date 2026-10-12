import { computed, onScopeDispose, reactive, watch, type Ref } from 'vue';
import { api } from '@/api';
import { messageEchoIdOf, resolveClientEchoId } from '@/composables/chat-outbox';
import type { Message } from '@/composables/use-chat';
import type { RichChatDraft } from './chat-session-context';

type Attempt = { echoId: string; content: string; draft: string; payload: Record<string, unknown>; signature: string };
type ComposerState = { draft: string; sending: boolean; uncertain: boolean; error: string; attempt: Attempt | null };
type DeliveryMessage = Omit<Partial<Message>, 'metadata'> & {
  deliveryState?: string; pendingConfirmation?: boolean;
  metadata?: { sendStatus?: string; failReason?: string } | null;
};

// Session memory only: closing the panel retains drafts without writing private chat to browser storage.
const drafts = new Map<string, ComposerState>();

export function usePreviewComposer(options: {
  conversationId: Ref<string>;
  userId: Ref<string>;
  messages: Ref<Message[]>;
  allowed: Ref<boolean>;
  onSent: (conversationId: string) => void;
  onForbidden: () => void;
}) {
  let disposed = false;
  const state = computed(() => {
    const key = JSON.stringify([options.userId.value, options.conversationId.value]);
    let entry = drafts.get(key);
    if (!entry) {
      entry = reactive({ draft: '', sending: false, uncertain: false, error: '', attempt: null });
      drafts.set(key, entry);
    }
    return entry;
  });
  const draft = computed({ get: () => state.value.draft, set: (text: string) => { state.value.draft = text; } });
  const canSubmit = computed(() => !!options.userId.value && options.allowed.value && !state.value.sending
    && (!!state.value.draft.trim() || state.value.uncertain));

  function confirmed(message: DeliveryMessage) {
    return !message.pendingConfirmation && (['completed', 'accepted'].includes(message.deliveryState ?? '')
      || message.metadata?.sendStatus === 'sent');
  }
  function settle(entry: ComposerState, attempt: Attempt, id: string, userId: string) {
    if (entry.attempt?.echoId !== attempt.echoId) return;
    if (entry.draft === attempt.draft) entry.draft = '';
    entry.attempt = null;
    entry.uncertain = false;
    entry.error = '';
    if (!disposed && options.userId.value === userId) options.onSent(id);
  }
  function applyDelivery(entry: ComposerState, attempt: Attempt, message: DeliveryMessage, id: string, userId: string) {
    if (entry.attempt?.echoId !== attempt.echoId) return;
    if (message.deliveryState === 'failed' || message.metadata?.sendStatus === 'failed') {
      entry.uncertain = false;
      entry.error = String(message.metadata?.failReason || 'Zalo từ chối gửi tin nhắn.');
    } else if (confirmed(message)) {
      settle(entry, attempt, id, userId);
    } else {
      entry.uncertain = true;
      entry.error = 'Chưa nhận được xác nhận từ Zalo. Kiểm tra lại kết quả trước khi gửi tiếp.';
    }
  }

  async function send(rich?: RichChatDraft, replyId?: string | null): Promise<boolean> {
    if (!canSubmit.value) return false;
    const id = options.conversationId.value;
    const userId = options.userId.value;
    const entry = state.value;
    const extras = rich ? {
      ...(rich.styles?.length ? { styles: rich.styles } : {}),
      ...(rich.mentions?.length ? { mentions: rich.mentions } : {}),
      ...(replyId ? { replyMessageId: replyId } : {}),
    } : {};
    const signature = JSON.stringify([entry.draft, extras]);
    const previous = entry.attempt;
    const echoId = resolveClientEchoId();
    const content = rich ? rich.text : entry.draft.trim();
    const attempt = previous && (entry.uncertain || previous.signature === signature) ? previous
      : { echoId, content, draft: entry.draft, signature, payload: { content, echoId, ...extras } };
    entry.attempt = attempt;
    entry.sending = true;
    entry.error = '';
    try {
      const { data } = await api.post<DeliveryMessage>(`/conversations/${id}/messages`, attempt.payload,
        { timeout: 120000, _skipGlobalErrorToast: true });
      applyDelivery(entry, attempt, data, id, userId);
      return confirmed(data) && data.deliveryState !== 'failed' && data.metadata?.sendStatus !== 'failed';
    } catch (cause) {
      if (entry.attempt?.echoId !== attempt.echoId) return true;
      const response = (cause as { response?: { status?: number; data?: { error?: string } } }).response;
      // An HTTP timeout can happen after delivery. Retain the original payload/echo for reconciliation.
      entry.uncertain = entry.uncertain || !response || response.status === 408 || (response.status ?? 0) >= 500;
      entry.error = entry.uncertain
        ? 'Chưa xác định được kết quả gửi. Kiểm tra lại để tránh gửi trùng.'
        : response?.data?.error || 'Không gửi được tin nhắn. Bản nháp đã được giữ lại.';
      if (!disposed && id === options.conversationId.value && userId === options.userId.value
        && [403, 404].includes(response?.status ?? 0)) options.onForbidden();
      return false;
    } finally {
      entry.sending = false;
    }
  }

  watch(options.messages, (messages) => {
    if (!options.allowed.value) return;
    const entry = state.value;
    const attempt = entry.attempt;
    if (!attempt) return;
    const outgoing = messages.find((message) => messageEchoIdOf(message) === attempt.echoId);
    if (outgoing) applyDelivery(entry, attempt, outgoing, options.conversationId.value, options.userId.value);
  }, { immediate: true });
  onScopeDispose(() => { disposed = true; });
  return { draft, state, canSubmit, send };
}
