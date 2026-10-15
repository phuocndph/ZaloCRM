<template>
  <div class="ccw" :class="{ 'ccw--tools': tool, 'ccw--compact': compact }">
    <div class="ccw-thread">
      <div v-if="sendNotice || composerState.error" class="ccw-notice" role="status">
        <span>{{ composerState.error || sendNotice }}</span>
        <button v-if="composerState.uncertain" type="button" :disabled="composerState.sending || !sendPermission" @click="reconcileSend"><RefreshCw :size="15" /> Kiểm tra kết quả</button>
      </div>
      <MessageThread
        ref="thread" :compact="compact" :conversation="conversation" :messages="messages" :loading="false"
        :loading-older="preview.loadingOlder.value" :has-older-messages="preview.hasMore.value"
        :sending="composerState.sending" :replying-to="draftSession.reply.value" :editing-message="draftSession.editing.value"
        :typing-users="typers" :pinned-ids="pinnedIds" :all-conversations="forwardTargets"
        :show-contact-panel="tool === 'contact'" :ai-suggestion="aiSuggestion" :ai-suggestion-loading="aiLoading"
        :ai-suggestion-error="aiError" :ai-config="aiConfig" :ai-config-loading="configLoading"
        @send="(text, replyId, styles, mentions) => submitText({ text, styles, mentions }, replyId)" @ask-ai="generateSuggestion" @load-older="older" @refresh-thread="refreshAfterAction"
        @set-reply-to="setReply" @set-editing="setEditing" @cancel-reply-edit="cancelReplyEdit"
        @edit-message="edit" @delete-message="remove" @undo-message="undo" @forward-message="forward"
        @add-reaction="(messageId, emoji) => reaction(messageId, emoji, false)"
        @remove-reaction="(messageId, emoji) => reaction(messageId, emoji, true)"
        @typing="sendTyping" @pin-message="(message) => pin(message, false)" @unpin-message="(message) => pin(message, true)"
        @open-content-panel="openContent" @open-media-tab="openTool('media')" @toggle-contact-panel="openTool('contact')"
        @switch-conversation="emit('switch-conversation', $event)" @profile-synced="preview.refresh"
        @privacy-released="preview.invalidate" @prepare-forward="loadForwardTargets"
      />
    </div>
    <aside v-if="tool" class="ccw-tools" :aria-label="toolTitle">
      <header><strong>{{ toolTitle }}</strong><button type="button" title="Đóng bảng hỗ trợ" aria-label="Đóng bảng hỗ trợ" @click="tool = ''"><X :size="18" /></button></header>
      <ConversationContentPanel v-if="tool === 'content'" :conversation-id="id" :initial-tab="contentTab" @jump="jump" @pinned-ids="pinnedIds = $event" />
      <MediaTabPanel v-else-if="tool === 'media'" :conversation-id="id" :contact="conversation.contact" :owner-nick-id="conversation.zaloAccount?.id" :nick-name="conversation.zaloAccount?.displayName" />
      <ChatContactPanel v-else-if="tool === 'contact' && conversation.contact && conversation.threadType === 'user'"
        :contact-id="conversation.contact.id" :contact="conversation.contact" :friendship="conversation.friendship"
        :conversation-id="id" :active-zalo-account-id="conversation.zaloAccount?.id" :active-zalo-account-name="conversation.zaloAccount?.displayName"
        :friend-id="conversation.friendship?.id" :ai-summary="aiSummary" :ai-summary-loading="summaryLoading"
        :ai-sentiment="aiSentiment" :ai-sentiment-loading="sentimentLoading" @close="tool = ''" @saved="preview.refresh"
        @refresh-ai-summary="summarize" @refresh-ai-sentiment="sentiment" @status-changed="preview.refresh"
      />
      <GroupMonitoringPanel v-else-if="tool === 'contact' && conversation.threadType === 'group'" :conversation="conversation" @close="tool = ''" @updated="preview.refresh" />
      <div v-else class="ccw-empty">Hội thoại chưa có hồ sơ khách hàng.</div>
    </aside>
    <AiCopilotPanel :open="copilotOpen" :conversation-id="id" :local-draft="true" :private-blocked="!canView"
      :customer-stage="conversation.contact?.status ?? undefined" @close="copilotOpen = false" @use-reply="insertReply" @feedback="feedback" @action="copilotAction" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onScopeDispose, provide, ref, watch } from 'vue';
import { RefreshCw, X } from 'lucide-vue-next';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { usePrivacyVisibility } from '@/composables/use-privacy-visibility';
import { useToast } from '@/composables/use-toast';
import { chatSessionKey, type RichChatDraft } from '@/composables/chat-session-context';
import { useChatSessionDraft } from '@/composables/use-chat-session-draft';
import { useChatOperations } from '@/composables/use-chat-operations';
import { useConversationContent } from '@/composables/use-conversation-content';
import { usePreviewComposer } from '@/composables/use-preview-composer';
import type { useConversationPreview } from '@/composables/use-conversation-preview';
import type { AiConfig, AiSentiment, Conversation, Message } from '@/composables/use-chat';
import MessageThread from './MessageThread.vue';
import ConversationContentPanel from './ConversationContentPanel.vue';
import MediaTabPanel from './MediaTabPanel.vue';
import ChatContactPanel from './ChatContactPanel.vue';
import GroupMonitoringPanel from './GroupMonitoringPanel.vue';
import AiCopilotPanel from './AiCopilotPanel.vue';

const props = defineProps<{ conversation: Conversation; messages: Message[]; preview: ReturnType<typeof useConversationPreview>; compact?: boolean }>();
const emit = defineEmits<{ 'message-sent': [id: string]; 'switch-conversation': [id: string]; 'expand': [] }>();
// This component is keyed by viewer/conversation. Async actions never read a new customer's id.
const id = props.conversation.id;
const auth = useAuthStore();
const viewerId = auth.user?.id ?? '';
const visibility = usePrivacyVisibility();
const toast = useToast();
const preview = props.preview;
const draftSession = useChatSessionDraft(viewerId, id);
const operations = useChatOperations();
const content = useConversationContent();
const thread = ref<InstanceType<typeof MessageThread> | null>(null);
const tool = ref<'' | 'content' | 'media' | 'contact'>('');
const contentTab = ref<'search' | 'pinned' | 'media' | 'files' | 'links'>('search');
const toolTitle = computed(() => tool.value === 'media' ? 'Kho Media' : tool.value === 'contact' ? 'Thông tin và chăm sóc' : 'Nội dung hội thoại');
const copilotOpen = ref(false);
const pinnedIds = ref<string[]>([]);
const forwardTargets = ref<Conversation[]>([]);
let forwardLoading = false;
const aiSuggestion = ref('');
const aiLoading = ref(false);
const aiError = ref('');
const aiConfig = ref<AiConfig>();
const configLoading = ref(true);
const aiSummary = ref('');
const summaryLoading = ref(false);
const aiSentiment = ref<AiSentiment | null>(null);
const sentimentLoading = ref(false);
const mutationBusy = ref(false);
const controller = new AbortController();
let disposed = false;
const canView = computed(() => auth.user?.id === viewerId && preview.conversation.value?.id === id
  && !preview.blocked.value && !visibility.shouldBlurConv(props.conversation));
const sendNotice = computed(() => {
  if (!canView.value) return 'Hội thoại không còn khả dụng.';
  const current = props.conversation;
  if (current.zaloAccount?.archivedAt) return 'Nick đã bị xóa. Chỉ xem lại lịch sử.';
  if (!visibility.canSendInConv(current) || (current.isPrivate && current.privateOwnerUserId !== viewerId)) return 'Bạn không có quyền gửi tin trong hội thoại này.';
  if (!current.isVirtual && current.zaloAccount?.status && current.zaloAccount.status !== 'connected') return 'Nick Zalo mất kết nối. Kết nối lại để gửi tin.';
  return '';
});
const sendPermission = computed(() => !sendNotice.value);
const composer = usePreviewComposer({ conversationId: computed(() => id), userId: computed(() => viewerId),
  messages: computed(() => props.messages), allowed: sendPermission,
  onSent: () => {
    if (draftSession.submission.value && JSON.stringify(draftSession.rich.value) === JSON.stringify(draftSession.submission.value)) {
      draftSession.rich.value = { text: '' };
      if (!draftSession.editing.value) thread.value?.clearComposer();
      draftSession.reply.value = null;
    }
    draftSession.submission.value = null;
    emit('message-sent', id); if (!disposed) void preview.refresh();
  }, onForbidden: preview.invalidate });
const composerState = composer.state;
const canSend = computed(() => sendPermission.value && !composerState.value.sending && !composerState.value.uncertain && !draftSession.attachments.uploading && !mutationBusy.value);
const typers = computed(() => [
  ...(preview.customerTyping.value ? [{ userId: '__customer__', userName: props.conversation.contact?.fullName || 'Khách hàng' }] : []),
  ...preview.typingUsers.value.filter((user) => user.userId !== viewerId),
]);

async function submitText(rich: RichChatDraft, replyId?: string | null) {
  if (!canSend.value) return false;
  draftSession.submission.value = rich;
  composer.draft.value = rich.text;
  const delivered = await composer.send(rich, replyId);
  if (!disposed) void preview.refresh();
  return delivered;
}
provide(chatSessionKey, { canSend, draft: draftSession.rich, attachments: draftSession.attachments,
  submit: submitText, addOptimisticMessages: preview.addOptimisticMessages,
  reconcileOptimisticMessages: preview.reconcileOptimisticMessages, removeOptimisticMessages: preview.removeOptimisticMessages });

async function reconcileSend() {
  await composer.send();
  if (!disposed) void preview.refresh();
}
function setReply(message: Message) { if (!canSend.value) return; draftSession.reply.value = message; draftSession.editing.value = null; }
function setEditing(message: Message) { if (!canSend.value) return; draftSession.editing.value = message; draftSession.reply.value = null; }
function cancelReplyEdit() { draftSession.reply.value = null; draftSession.editing.value = null; }
async function mutate(action: () => Promise<unknown>, success?: string) {
  if (!canView.value || !sendPermission.value || mutationBusy.value) return false;
  mutationBusy.value = true;
  try {
    await action();
    if (!disposed) { if (success) toast.success(success); void preview.refresh(); }
    return true;
  } catch (cause) {
    if (!disposed) {
      const response = (cause as { response?: { status?: number; data?: { error?: string } } }).response;
      toast.error(response?.data?.error || 'Không thực hiện được thao tác.');
      if ([403, 404].includes(response?.status ?? 0)) preview.invalidate();
    }
    return false;
  } finally { mutationBusy.value = false; }
}
async function edit(messageId: string, text: string) {
  if (await mutate(() => operations.editMessage(id, messageId, text), 'Đã sửa trên CRM; bản gốc ở Zalo không thay đổi.') && !disposed) {
    cancelReplyEdit(); await thread.value?.clearComposer();
  }
}
function remove(messageId: string) { return mutate(() => operations.deleteMessage(id, messageId), 'Đã xóa tin ở phía bạn.'); }
function undo(messageId: string) { return mutate(() => operations.undoMessage(id, messageId), 'Đã thu hồi tin nhắn.'); }
function reaction(messageId: string, emoji: string, removing: boolean) { return mutate(() => removing ? operations.removeReaction(id, messageId, emoji) : operations.addReaction(id, messageId, emoji)); }
async function forward(messageId: string, targetIds: string[]) {
  await mutate(async () => {
    const result = await operations.forwardMessage(id, messageId, targetIds);
    if (!disposed) toast.push(result.pendingConfirmation ? 'Một số tệp đang chờ Zalo xác nhận, không gửi lại.'
      : `Đã chuyển tiếp ${result.forwarded} hội thoại${result.failed ? `; ${result.failed} thất bại` : ''}.`);
  });
}
function sendTyping() { if (canSend.value) operations.sendTypingEvent(id); }
async function pin(message: Message, removing: boolean) {
  if (await mutate(() => removing ? content.unpin(id, message.id) : content.pin(id, message.id))) await loadPins();
}
async function loadPins() {
  if (!canView.value || disposed) return;
  try { const list = await content.listPinned(id); if (!disposed && canView.value) pinnedIds.value = list.filter((item) => item.message).map((item) => item.message!.id); } catch { /* History remains available without pins. */ }
}
async function older() {
  const anchor = thread.value?.captureScrollAnchor() ?? null;
  await preview.loadOlder(); await nextTick();
  if (!disposed) thread.value?.restoreScrollAnchor(anchor);
}
async function jump(messageId: string) {
  if (thread.value?.scrollToMessage(messageId)) return;
  await preview.loadContext(messageId); await nextTick();
  if (!disposed) thread.value?.scrollToMessage(messageId);
}
function openTool(value: 'content' | 'media' | 'contact') {
  if (!canView.value || (value === 'media' && !sendPermission.value)) return;
  tool.value = tool.value === value ? '' : value;
  if (tool.value) emit('expand');
}
function openContent(value: string) { contentTab.value = value as typeof contentTab.value; tool.value = 'content'; emit('expand'); }
function openCopilot() { if (canView.value) copilotOpen.value = !copilotOpen.value; }
function insertReply(text: string) { if (canSend.value) void thread.value?.applySuggestion(text); }
function copilotAction(kind: string) { openTool('contact'); toast.push(kind === 'handoff' ? 'Xem thông tin phụ trách trước khi chuyển nhân viên.' : 'Xem và xác nhận trong bảng chăm sóc.'); }
async function feedback(kind: string, payload: Record<string, unknown> = {}) {
  if (!canView.value) return;
  try { await api.post(`/ai/feedback/conversations/${id}`, { type: kind, ...payload }); } catch { if (!disposed) toast.error('Không lưu được phản hồi AI.'); }
}
async function aiRequest<T>(path: string, loading: typeof aiLoading, apply: (data: T) => void) {
  if (loading.value || !canView.value) return;
  loading.value = true;
  try {
    const { data } = await api.post<T>(path, {}, { timeout: 90000, signal: controller.signal });
    if (!disposed && canView.value) apply(data);
  } catch (cause) {
    if (!disposed && !controller.signal.aborted) aiError.value = (cause as { response?: { data?: { error?: string } } }).response?.data?.error || 'Không tạo được kết quả AI.';
  } finally { if (!disposed) loading.value = false; }
}
function generateSuggestion() { return aiRequest<{ reply_text: string }>(`/ai/replies/conversations/${id}/generate`, aiLoading, (data) => { aiSuggestion.value = data.reply_text || ''; }); }
function summarize() { return aiRequest<{ content: string }>(`/ai/summarize/${id}`, summaryLoading, (data) => { aiSummary.value = data.content || ''; }); }
function sentiment() { return aiRequest<AiSentiment>(`/ai/sentiment/${id}`, sentimentLoading, (data) => { aiSentiment.value = data; }); }
async function loadForwardTargets() {
  if (!canView.value || forwardLoading) return;
  forwardLoading = true;
  try {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const targets = new Map<string, Conversation>();
    do {
      const { data } = await api.get<{ conversations: Conversation[]; hasMore?: boolean; nextCursor?: string | null }>('/conversations', {
        params: { accountId: props.conversation.zaloAccount?.id, limit: 100, ...(cursor ? { cursor } : {}) }, signal: controller.signal,
      });
      if (disposed || !canView.value) return;
      for (const conversation of data.conversations ?? []) targets.set(conversation.id, conversation);
      forwardTargets.value = [...targets.values()];
      cursor = data.hasMore && data.nextCursor && !cursors.has(data.nextCursor) ? data.nextCursor : undefined;
      if (cursor) cursors.add(cursor);
    } while (cursor);
  } catch { if (!disposed) toast.error('Không tải được danh sách chuyển tiếp.'); }
  finally { forwardLoading = false; }
}
function refreshAfterAction() { if (!disposed) void preview.refresh(); }
watch([canView, sendPermission], () => { if (!canView.value) { tool.value = ''; copilotOpen.value = false; } else if (!sendPermission.value && tool.value === 'media') tool.value = ''; });
void api.get<AiConfig>('/ai/config', { signal: controller.signal }).then(({ data }) => { if (!disposed) aiConfig.value = data; }).catch(() => {}).finally(() => { if (!disposed) configLoading.value = false; });
watch(() => props.messages, () => { void loadPins(); });
void loadPins();
onScopeDispose(() => { disposed = true; controller.abort(); });
defineExpose({ openCopilot, jump });
</script>

<style scoped>
.ccw { display: flex; flex: 1; min-height: 0; min-width: 0; position: relative; overflow: hidden; }
.ccw-thread { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.ccw-thread > :deep(.message-thread) { flex: 1; min-height: 0; height: auto; }
.ccw-notice { padding: 6px 10px; background: #fff4e5; color: #8a4b08; display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; flex-shrink: 0; }
.ccw-notice button { display: flex; align-items: center; gap: 4px; padding: 5px; border: 1px solid #d0d5dd; border-radius: 5px; background: #fff; color: #344054; cursor: pointer; font-size: 11px; }
.ccw-tools { width: 360px; min-width: 0; flex-shrink: 0; display: flex; flex-direction: column; border-left: 1px solid #e4e7ec; background: #fff; overflow: hidden; }
.ccw-tools > header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #e4e7ec; flex-shrink: 0; font-size: 12px; }
.ccw-tools > header button { display: grid; place-items: center; width: 30px; height: 30px; border: 0; background: transparent; color: #475467; cursor: pointer; }
.ccw-tools > :deep(.info-panel), .ccw-tools > :deep(.mtp), .ccw-tools > :deep(.ccp), .ccw-tools > :deep(.gmp) { flex: 1; min-height: 0; width: 100%; max-width: none; height: auto; overflow: auto; border: 0; }
.ccw-empty { padding: 20px; font-size: 12px; color: #667085; }
.ccw :deep(.chat-header) { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; padding: 7px 10px; gap: 5px 7px; }
.ccw :deep(.ch-avatar-wrap) { grid-column: 1; grid-row: 1 / 3; }
.ccw :deep(.ch-info) { display: contents; }
.ccw :deep(.ch-row-1) { grid-column: 2 / 4; grid-row: 1; padding-right: 0; flex-wrap: wrap; overflow: visible; }
.ccw :deep(.ch-row-chips) { grid-column: 2; grid-row: 2; }
.ccw :deep(.chat-header > .ch-actions) { grid-column: 3; grid-row: 2; position: static; margin-left: auto; display: flex; flex-wrap: wrap; }
.ccw :deep(.ch-name) { flex: 1 1 110px; white-space: nowrap; }
.ccw :deep(.input-toolbar-top) { flex-wrap: wrap; gap: 4px; }
.ccw :deep(.input-area) { padding: 6px 10px; flex-shrink: 0; max-height: 45%; overflow: auto; }
.ccw :deep(.pending-attachments) { max-height: 90px; overflow: auto; }
.ccw :deep(.composer-send-hint) { display: none; }
.ccw :deep(.input-row) { min-width: 0; }
.ccw :deep(.editor-wrap) { min-width: 0; }
.ccw :deep(.ch-row-chips) { gap: 5px; }
@media (max-width: 420px) {
  .ccw :deep(.chat-header) { grid-template-columns: 40px minmax(0, 1fr); }
  .ccw :deep(.ch-row-1) { grid-column: 2; }
  .ccw :deep(.ch-row-chips) { grid-column: 1 / 3; grid-row: 2; }
  .ccw :deep(.ch-avatar-wrap) { grid-row: 1; }
  .ccw :deep(.chat-header > .ch-actions) { grid-column: 1 / 3; grid-row: 3; }
}
@media (max-width: 1000px) { .ccw-tools { position: absolute; inset: 0 0 0 auto; z-index: 50; width: min(390px, 100%); box-shadow: -6px 0 18px #17203322; } }
.ccw--compact :deep(.chat-header:not(.chat-header--details)) { grid-template-columns: 40px minmax(0, 1fr) auto; gap: 2px 7px; }
.ccw--compact :deep(.chat-header:not(.chat-header--details) .ch-avatar-wrap) { grid-column: 1; grid-row: 1 / 3; }
.ccw--compact :deep(.chat-header:not(.chat-header--details) .ch-row-1) { grid-column: 2; grid-row: 1; flex-wrap: nowrap; }
.ccw--compact :deep(.chat-header:not(.chat-header--details) .ch-row-chips) { grid-column: 2; grid-row: 2; min-width: 0; flex-wrap: nowrap; }
.ccw--compact :deep(.chat-header:not(.chat-header--details) > .ch-actions) { grid-column: 3; grid-row: 1 / 3; flex-wrap: nowrap; gap: 2px; }
.ccw--compact :deep(.chat-header:not(.chat-header--details) .ch-row-1 > :not(.ch-name)),
.ccw--compact :deep(.chat-header:not(.chat-header--details) .ch-row-chips > :not(.nick-switcher):not(.nick-name):not(.nick-archived-chip)),
.ccw--compact :deep(.chat-header:not(.chat-header--details) > .ch-actions > :not(.compact-header-action)) { display: none; }
.ccw--compact :deep(.ch-name) { font-size: 14px; min-width: 0; flex-basis: 0; }
.ccw--compact :deep(.nick-switcher) { min-width: 0; max-width: 100%; }
.ccw--compact :deep(.nick-name) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ccw--compact :deep(.input-toolbar-top) { flex-wrap: nowrap; gap: 4px; }
.ccw--compact :deep(.chat-header--details) { max-height: 35dvh; overflow: auto; }
</style>
