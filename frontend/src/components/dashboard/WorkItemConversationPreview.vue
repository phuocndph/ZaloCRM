<template>
  <aside ref="panel" class="wicp" :class="{ 'wicp--expanded': expanded }" tabindex="-1" aria-label="Xem nhanh hội thoại" @keydown.esc="escape" @keydown.tab="trapFocus">
    <header class="wicp-head">
      <strong>Hội thoại</strong>
      <button type="button" title="AI Copilot" aria-label="AI Copilot trong xem nhanh" :disabled="!viewAvailable" @click="workspace?.openCopilot()"><Sparkles :size="17" /></button>
      <button type="button" title="Đánh dấu đã đọc" aria-label="Đánh dấu đã đọc" :disabled="!viewAvailable || markingRead" @click="markRead"><MailCheck :size="17" /></button>
      <button type="button" :title="expanded ? 'Thu gọn khung chat' : 'Mở rộng khung chat'" :aria-label="expanded ? 'Thu gọn khung chat' : 'Mở rộng khung chat'" @click="expanded = !expanded"><Minimize2 v-if="expanded" :size="17" /><Maximize2 v-else :size="17" /></button>
      <button type="button" title="Mở trang Tin nhắn đầy đủ" aria-label="Mở trang Tin nhắn đầy đủ" @click="openFull"><ExternalLink :size="17" /></button>
      <button type="button" title="Đóng xem nhanh" aria-label="Đóng xem nhanh" @click="emit('close')"><X :size="18" /></button>
    </header>
    <details v-if="item && !blocked && !privateBlocked" class="wicp-context">
      <summary><BrainCircuit :size="14" /><strong>{{ item.nextAction }}</strong></summary>
      <div><span v-if="item.reason">{{ item.reason }}</span><span v-if="item.metadata?.aiStatusLabel">{{ item.metadata.aiStatusLabel }}</span>
        <button v-if="item.metadata?.actionableMessageId" type="button" @click="workspace?.jump(item.metadata.actionableMessageId)"><LocateFixed :size="13" /> Xem tin cần xác minh</button>
      </div>
    </details>
    <div v-if="item && !itemAvailable" class="wicp-notice">Công việc không còn trong bộ lọc hiện tại.</div>
    <div v-if="realtimeOffline" class="wicp-banner" role="status">Mất kết nối cập nhật trực tiếp. Đang thử kết nối lại.</div>
    <div v-if="error" class="wicp-banner wicp-banner--error" role="alert"><span>{{ error }}</span><button type="button" @click="refresh">Thử lại</button></div>
    <div v-if="loading && !conversation" class="wicp-state" role="status"><LoaderCircle :size="24" class="spin" /> Đang tải hội thoại</div>
    <div v-else-if="blocked || privateBlocked" class="wicp-state"><LockKeyhole :size="24" />{{ error || 'Nội dung riêng tư chưa được mở khóa.' }}</div>
    <ConversationChatWorkspace v-else-if="conversation" :key="`${auth.user?.id}:${conversationId}`" ref="workspace"
      :conversation="conversation" :messages="messages" :preview="preview" @message-sent="emit('message-sent', $event)"
      @switch-conversation="emit('switch-conversation', $event)" @expand="expanded = true" />
    <footer v-if="item" class="wicp-foot">
      <span>{{ item.status === 'completed' ? 'Đã hoàn thành' : item.status === 'snoozed' ? 'Đang hoãn' : 'Chờ xử lý' }}</span>
      <template v-if="item.status !== 'completed'">
        <select v-model="snoozeMinutes" aria-label="Thời gian hoãn" :disabled="actionsDisabled"><option :value="60">Sau 1 giờ</option><option :value="180">Sau 3 giờ</option><option :value="0">9:00 ngày mai</option></select>
        <button type="button" title="Hoãn công việc" aria-label="Hoãn công việc trong xem nhanh" :disabled="actionsDisabled" @click="snooze"><Clock3 :size="16" /></button>
        <button type="button" class="wicp-complete" :disabled="actionsDisabled" @click="emit('action', 'complete')"><Check :size="16" /> Hoàn thành</button>
      </template>
      <button v-else type="button" :disabled="actionsDisabled" @click="emit('action', 'reopen')"><RotateCcw :size="16" /> Mở lại</button>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { BrainCircuit, Check, Clock3, ExternalLink, LoaderCircle, LocateFixed, LockKeyhole, MailCheck, Maximize2, Minimize2, RotateCcw, Sparkles, X } from 'lucide-vue-next';
import ConversationChatWorkspace from '@/components/chat/ConversationChatWorkspace.vue';
import { useConversationPreview } from '@/composables/use-conversation-preview';
import { usePrivacyVisibility } from '@/composables/use-privacy-visibility';
import { useAuthStore } from '@/stores/auth';
import { usePrivacyStore } from '@/stores/privacy';
import { useToast } from '@/composables/use-toast';
import { api } from '@/api';
import type { ConversationWorkItem } from '@/composables/use-conversation-work-items';

const props = withDefaults(defineProps<{ conversationId: string; item?: ConversationWorkItem | null; busy?: boolean; itemAvailable?: boolean; mobile?: boolean }>(), { item: null, busy: false, itemAvailable: true, mobile: false });
const emit = defineEmits<{ close: []; 'marked-read': []; 'message-sent': [id: string]; 'switch-conversation': [id: string]; action: [action: 'complete' | 'reopen' | 'snooze', options?: { snoozeMinutes?: number; snoozedUntil?: string }] }>();
const router = useRouter();
const auth = useAuthStore();
const privacy = usePrivacyStore();
const visibility = usePrivacyVisibility();
const toast = useToast();
const preview = useConversationPreview(toRef(props, 'conversationId'), computed(() => auth.user?.id));
const { conversation, messages, loading, error, blocked, realtimeOffline, refresh, invalidate } = preview;
const panel = ref<HTMLElement | null>(null);
const workspace = ref<InstanceType<typeof ConversationChatWorkspace> | null>(null);
const expanded = ref(false);
const markingRead = ref(false);
const snoozeMinutes = ref(60);
const privateBlocked = computed(() => visibility.shouldBlurConv(conversation.value));
const viewAvailable = computed(() => !!conversation.value && !blocked.value && !privateBlocked.value);
const actionsDisabled = computed(() => props.busy || !viewAvailable.value || loading.value || !props.itemAvailable);
function openFull() { void router.push(props.mobile ? `/m/c/${props.conversationId}` : { name: 'Chat', params: { convId: props.conversationId } }); }
function escape(event: KeyboardEvent) {
  // Teleported menus/dialogs handle Escape themselves; do not close the enclosing chat.
  if (event.defaultPrevented || document.querySelector('.v-overlay--active, .ctx-menu-overlay, .mention-popup')) return;
  event.stopPropagation(); emit('close');
}
function trapFocus(event: KeyboardEvent) {
  if (window.innerWidth > 1000 && !expanded.value) return;
  if (document.querySelector('.v-overlay--active, .copilot')) return;
  const controls = Array.from(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [contenteditable="true"]') ?? [])
    .filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.value)) { event.preventDefault(); first?.focus(); }
}
async function markRead() {
  if (markingRead.value || !viewAvailable.value) return;
  const id = props.conversationId;
  markingRead.value = true;
  try { await api.post(`/conversations/${id}/mark-read`); if (id === props.conversationId) { emit('marked-read'); toast.success('Đã đánh dấu hội thoại là đã đọc'); } }
  catch { toast.error('Không đánh dấu đã đọc được.'); }
  finally { markingRead.value = false; }
}
function snooze() {
  if (snoozeMinutes.value) emit('action', 'snooze', { snoozeMinutes: snoozeMinutes.value });
  else { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0); emit('action', 'snooze', { snoozedUntil: tomorrow.toISOString() }); }
}
watch(() => props.conversationId, () => { snoozeMinutes.value = 60; });
watch(() => privacy.isUnlocked, invalidate);
onMounted(() => {
  if (window.innerWidth > 1000 && window.innerHeight < 850) expanded.value = true;
  panel.value?.focus({ preventScroll: true });
});
</script>

<style scoped>
.wicp { position: sticky; top: 0; display: flex; flex-direction: column; min-width: 0; height: calc(100dvh - var(--smax-topnav-h, 48px) - 230px); min-height: 390px; max-height: 850px; overflow: hidden; border: 1px solid #d0d5dd; border-radius: 8px; background: #fff; color: #172033; outline: none; }
.wicp--expanded { position: fixed; inset: calc(var(--smax-topnav-h, 48px) + 12px) 20px 16px; z-index: 1100; height: auto; max-height: none; box-shadow: 0 12px 40px #17203333; }
.wicp-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid #e4e7ec; flex-shrink: 0; }
.wicp-head > strong { flex: 1; font-size: 12px; }
.wicp-head button, .wicp-foot button, .wicp-banner button, .wicp-context button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 30px; padding: 0 8px; border: 1px solid #d0d5dd; border-radius: 5px; background: #fff; color: #475467; font: inherit; font-size: 11px; cursor: pointer; }
.wicp-head button { width: 30px; padding: 0; flex-shrink: 0; }
.wicp button:disabled, .wicp select:disabled { opacity: .5; cursor: default; }
.wicp-head button:hover:not(:disabled), .wicp-foot button:hover:not(:disabled) { color: #087daf; background: #f4fbfd; }
.wicp-context { padding: 6px 10px; border-bottom: 1px solid #e4e7ec; background: #f9fafb; max-height: 125px; overflow: auto; flex-shrink: 0; font-size: 11px; }
.wicp-context summary { cursor: pointer; display: flex; align-items: center; gap: 6px; }
.wicp-context summary strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.wicp-context > div { display: flex; flex-direction: column; gap: 5px; margin-top: 6px; color: #667085; }
.wicp-context button { align-self: flex-start; }
.wicp-notice { font-size: 10px; color: #8a4b08; padding: 4px 10px; }
.wicp-banner { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 10px; background: #fff4e5; color: #8a4b08; font-size: 11px; flex-shrink: 0; }
.wicp-banner--error { background: #fff1f0; color: #b42318; }
.wicp-state { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; color: #667085; text-align: center; font-size: 12px; }
.wicp-foot { display: flex; align-items: center; gap: 6px; padding: 6px 10px; flex-shrink: 0; border-top: 1px solid #e4e7ec; flex-wrap: wrap; }
.wicp-foot > span { flex: 1; font-size: 10px; color: #667085; }
.wicp-foot select { max-width: 120px; min-height: 30px; padding: 0 5px; border: 1px solid #d0d5dd; border-radius: 5px; color: #475467; font-size: 11px; background: #fff; }
.wicp .wicp-complete { color: #fff; background: #087443; border-color: #087443; }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
@media (max-width: 1000px) { .wicp { position: fixed; inset: var(--smax-topnav-h, 48px) 0 0; z-index: 1100; width: 100%; height: auto; max-height: none; min-height: 0; border-radius: 0; } }
</style>
