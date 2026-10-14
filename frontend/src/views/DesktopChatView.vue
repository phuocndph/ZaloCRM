<template>
  <main class="desktop-chat">
    <header class="desktop-chat-header">
      <strong>ZaloCRM</strong>
      <span>{{ conversation?.zaloAccount?.displayName || 'Hội thoại' }}</span>
      <button type="button" title="Mở CRM đầy đủ" aria-label="Mở CRM đầy đủ" @click="openMain"><ExternalLink :size="17" /></button>
      <button type="button" title="Mở rộng" aria-label="Mở rộng" @click="desktop?.expand()"><Maximize2 :size="17" /></button>
      <button type="button" title="Thu về bong bóng" aria-label="Thu về bong bóng" @click="desktop?.hide()"><Minus :size="17" /></button>
    </header>
    <nav v-if="pending.length" class="desktop-chat-pending" aria-label="Hội thoại có tin mới">
      <button v-for="item in pending" :key="item.convId" type="button" :class="{ selected: id === item.convId }" :title="item.context" @click="select(item.convId)">
        <span>{{ item.name }}</span><small>{{ item.count || 1 }}</small>
      </button>
    </nav>
    <div v-if="!id" class="desktop-chat-empty"><MessageCircle :size="36" /><h1>Hội thoại</h1><p>Chưa có tin nhắn mới.</p><button type="button" @click="openMain">Mở ZaloCRM</button></div>
    <div v-else-if="loading" class="desktop-chat-empty" role="status"><v-progress-circular indeterminate color="primary" /></div>
    <div v-else-if="error || !conversation" class="desktop-chat-empty" role="alert"><p>{{ error || 'Không tìm thấy hội thoại.' }}</p><button type="button" @click="preview.refresh">Tải lại</button></div>
    <ConversationChatWorkspace v-else :key="`${auth.user?.id}:${id}`" class="desktop-chat-workspace" :conversation="conversation" :messages="messages" :preview="preview" @switch-conversation="select" @expand="desktop?.expand()" />
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ExternalLink, Maximize2, MessageCircle, Minus } from 'lucide-vue-next';
import ConversationChatWorkspace from '@/components/chat/ConversationChatWorkspace.vue';
import { desktopBridge, type DesktopNotification } from '@/composables/desktop-bridge';
import { useConversationPreview } from '@/composables/use-conversation-preview';
import { useMessageNotificationInbox } from '@/composables/use-message-notification-inbox';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const desktop = desktopBridge();
const id = computed(() => String(route.params.convId ?? ''));
const pending = ref<DesktopNotification[]>([]);
const preview = useConversationPreview(id, computed(() => auth.user?.id));
const { conversation, messages, loading, error } = preview;
const inbox = useMessageNotificationInbox();
let disposed = false;
const unsubscribers: Array<() => void> = [];
function select(value: string) { if (/^[a-zA-Z0-9_-]{1,100}$/.test(value)) void router.replace({ name: 'Desktop.Chat', params: { convId: value } }); }
function openMain() { if (desktop) desktop.openMain(id.value); else void router.push(id.value ? `/chat/${id.value}` : '/chat'); }
async function markVisibleRead() {
  if (!id.value || !conversation.value || preview.blocked.value || !document.hasFocus() || document.hidden) return;
  const current = id.value;
  try {
    await api.post(`/conversations/${current}/mark-read`);
    if (disposed || current !== id.value) return;
    desktop?.active(current);
    void inbox.markConversationRead(current);
  } catch { /* Reading history must not pretend a denied mark-read succeeded. */ }
}
watch([conversation, messages], () => { void markVisibleRead(); });
watch(id, () => desktop?.active(''));
function onBlur() { desktop?.active(''); }
onMounted(async () => {
  window.addEventListener('focus', markVisibleRead);
  window.addEventListener('blur', onBlur);
  if (!desktop) return;
  unsubscribers.push(desktop.onState((state) => { pending.value = state.items; }), desktop.onOpen(select), desktop.onReset(() => {
    pending.value = []; preview.invalidate(); window.location.reload();
  }));
  const state = await desktop.state();
  if (!disposed) pending.value = state?.items ?? [];
});
onBeforeUnmount(() => {
  disposed = true; desktop?.active('');
  window.removeEventListener('focus', markVisibleRead); window.removeEventListener('blur', onBlur);
  for (const unsubscribe of unsubscribers) unsubscribe();
});
</script>

<style scoped>
.desktop-chat { height: 100dvh; display: flex; flex-direction: column; overflow: hidden; background: var(--color-surface, #fff); color: var(--color-text, #202124); }
.desktop-chat-header { height: 46px; flex: 0 0 46px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-bottom: 1px solid #e1e5e9; }
.desktop-chat-header strong { font-size: 15px; }
.desktop-chat-header > span { flex: 1; min-width: 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #59636e; }
.desktop-chat-header button { width: 32px; height: 32px; display: grid; place-items: center; border: 0; background: transparent; cursor: pointer; color: inherit; }
.desktop-chat-header button:hover { background: #eef2f5; }
.desktop-chat-pending { display: flex; flex: 0 0 auto; gap: 6px; padding: 8px 12px; overflow: auto; border-bottom: 1px solid #e1e5e9; }
.desktop-chat-pending button { display: flex; align-items: center; gap: 8px; min-height: 32px; max-width: 220px; flex-shrink: 0; border: 1px solid #d9dfe5; border-radius: 4px; background: #fff; padding: 4px 9px; cursor: pointer; color: inherit; }
.desktop-chat-pending button.selected { border-color: #007b60; background: #eaf6f1; }
.desktop-chat-pending span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.desktop-chat-pending small { color: #b32c37; font-weight: 700; }
.desktop-chat-workspace { flex: 1; min-height: 0; }
.desktop-chat-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; text-align: center; }
.desktop-chat-empty h1 { font-size: 20px; }
.desktop-chat-empty p { font-size: 14px; }
.desktop-chat-empty button { padding: 8px 16px; border: 1px solid #d9dfe5; background: #fff; border-radius: 4px; cursor: pointer; }
</style>
