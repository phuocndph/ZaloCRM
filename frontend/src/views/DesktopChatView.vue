<template>
  <main class="desktop-chat" :class="{ 'has-conversation': !!id }">
    <header class="desktop-chat-header">
      <button v-if="id" type="button" title="Danh sách hội thoại" aria-label="Danh sách hội thoại" @click="back"><ArrowLeft :size="18" /></button>
      <strong>{{ id ? 'Chat nhanh' : 'Hội thoại' }}</strong>
      <span>{{ conversation?.zaloAccount?.displayName || 'ZaloCRM' }}</span>
      <button type="button" :class="{ active: pinned }" :aria-pressed="pinned" :title="pinned ? 'Bỏ ghim khung' : 'Ghim khung'" aria-label="Ghim khung" @click="togglePin"><Pin :size="17" /></button>
      <AppUpdateButton surface="desktop" />
      <button type="button" title="Mở CRM đầy đủ" aria-label="Mở CRM đầy đủ" @click="openMain"><ExternalLink :size="17" /></button>
      <button type="button" title="Mở rộng" aria-label="Mở rộng" @click="desktop?.expand()"><Maximize2 :size="17" /></button>
      <button type="button" title="Thu về bong bóng" aria-label="Thu về bong bóng" @click="desktop?.hide()"><Minus :size="17" /></button>
    </header>
    <div v-if="offline || preview.realtimeOffline.value" class="desktop-status" role="status">Mất kết nối trực tiếp. Đang thử kết nối lại…</div>
    <div class="desktop-chat-body">
      <aside class="desktop-inbox" aria-label="Danh sách hội thoại">
        <div class="inbox-search"><Search :size="17" /><input v-model="search" type="search" placeholder="Tìm hội thoại" aria-label="Tìm hội thoại" maxlength="120" /></div>
        <div class="inbox-filters">
          <div class="inbox-tabs" role="tablist" aria-label="Lọc hội thoại"><button role="tab" :aria-selected="!onlyUnread" :class="{ active: !onlyUnread }" @click="onlyUnread = false">Tất cả</button><button role="tab" :aria-selected="onlyUnread" :class="{ active: onlyUnread }" @click="onlyUnread = true">Chưa đọc</button></div>
          <select v-model="accountId" aria-label="Lọc theo nick Zalo"><option value="">Tất cả nick Zalo</option><option v-for="account in accounts" :key="account.id" :value="account.id">{{ account.displayName || 'Nick Zalo' }}</option></select>
        </div>
        <div class="inbox-rows" @scroll="onScroll">
          <div v-if="listLoading && !rows.length" class="inbox-empty" role="status">Đang tải hội thoại…</div>
          <div v-else-if="!rows.length && !listError" class="inbox-empty">{{ search ? 'Không tìm thấy hội thoại.' : onlyUnread ? 'Không có hội thoại chưa đọc.' : 'Chưa có hội thoại.' }}</div>
          <button v-for="row in rows" :key="row.id" type="button" class="inbox-row" :class="{ selected: id === row.id, unread: row.unreadCount > 0 }" @click="select(row.id)">
            <img v-if="avatar(row)" class="inbox-avatar" :src="avatar(row)!" alt="" referrerpolicy="no-referrer" @error="hideImage" />
            <span v-else class="inbox-avatar initials">{{ title(row).slice(0, 1) }}</span>
            <span class="inbox-copy"><span class="inbox-top"><strong>{{ title(row) }}</strong><time>{{ time(row.lastMessageAt) }}</time></span><span class="inbox-nick">{{ row.zaloAccount?.displayName || 'Nick Zalo' }}</span><span class="inbox-snippet">{{ snippet(row) }}</span></span>
            <span class="inbox-indicators"><BellOff v-if="muted(row)" :size="13" aria-label="Đã tắt thông báo" /><small v-if="row.unreadCount > 0">{{ row.unreadCount > 99 ? '99+' : row.unreadCount }}</small></span>
          </button>
          <div v-if="listError" class="inbox-empty" role="alert">{{ listError }}<button type="button" @click="list.refresh()">Thử lại</button></div>
          <button v-else-if="hasMore" class="inbox-more" type="button" :disabled="loadingMore" @click="list.loadMore">{{ loadingMore ? 'Đang tải…' : 'Xem thêm' }}</button>
        </div>
      </aside>
      <section class="desktop-thread" aria-label="Nội dung hội thoại">
        <div v-if="!id" class="desktop-chat-empty"><MessageCircle :size="36" /><h1>Chưa chọn hội thoại</h1></div>
        <div v-else-if="loading" class="desktop-chat-empty" role="status"><v-progress-circular indeterminate color="primary" /></div>
        <div v-else-if="!conversation || preview.blocked.value" class="desktop-chat-empty" role="alert"><p>{{ error || 'Không tìm thấy hội thoại.' }}</p><button type="button" @click="preview.refresh">Tải lại</button></div>
        <template v-else><div v-if="error" class="desktop-status" role="status">{{ error }}</div><ConversationChatWorkspace :key="`${auth.user?.id}:${id}`" class="desktop-chat-workspace" :conversation="conversation" :messages="messages" :preview="preview" @switch-conversation="select" @message-sent="list.refresh()" @expand="desktop?.expand()" /></template>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, BellOff, ExternalLink, Maximize2, MessageCircle, Minus, Pin, Search } from 'lucide-vue-next';
import ConversationChatWorkspace from '@/components/chat/ConversationChatWorkspace.vue';
import AppUpdateButton from '@/components/AppUpdateButton.vue';
import { desktopBridge } from '@/composables/desktop-bridge';
import { useDesktopConversations } from '@/composables/use-desktop-conversations';
import { useConversationPreview } from '@/composables/use-conversation-preview';
import { useMessageNotificationInbox } from '@/composables/use-message-notification-inbox';
import { usePrivacyVisibility } from '@/composables/use-privacy-visibility';
import { isConversationNotificationMuted } from '@/composables/use-conversation-state';
import { notificationAvatarUrl, notificationPreview } from '@/composables/message-notification-utils';
import type { Conversation } from '@/composables/use-chat';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api';

const auth = useAuthStore(), route = useRoute(), router = useRouter(), desktop = desktopBridge();
const id = computed(() => String(route.params.convId ?? ''));
const search = ref(''), onlyUnread = ref(false), accountId = ref(''), pinned = ref(false);
const list = useDesktopConversations(search, onlyUnread, accountId);
const { rows, accounts, loading: listLoading, loadingMore, error: listError, hasMore, offline } = list;
const preview = useConversationPreview(id, computed(() => auth.user?.id));
const { conversation, messages, loading, error } = preview;
const privacy = usePrivacyVisibility();
const inbox = useMessageNotificationInbox();
let disposed = false, reading = false, lastRead = '';
const unsubscribers: Array<() => void> = [];
function title(row: Conversation) { return row.conversationPrivate ? 'Hội thoại riêng tư' : row.threadType === 'group' ? row.groupName || 'Nhóm Zalo' : row.contact?.crmName || row.contact?.fullName || row.friendship?.zaloDisplayName || 'Khách hàng'; }
function avatar(row: Conversation) { return privacy.shouldBlurConv(row) || row.conversationPrivate ? null : notificationAvatarUrl(row.threadType === 'group' ? row.groupAvatarUrl : row.contact?.avatarUrl || row.friendship?.zaloAvatarUrl); }
function snippet(row: Conversation) { return privacy.shouldBlurConv(row) || row.conversationPrivate ? 'Nội dung riêng tư' : row.messages?.[0] ? notificationPreview(row.messages[0]) : 'Chưa có tin nhắn'; }
function muted(row: Conversation) { const mute = row as Conversation & { zaloNotificationsMuted?: boolean; zaloMutedUntil?: string | null }; return isConversationNotificationMuted(row.userState) || (mute.zaloNotificationsMuted && (!mute.zaloMutedUntil || Date.parse(mute.zaloMutedUntil) > Date.now())); }
function time(value: string | null) { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }); }
function hideImage(event: Event) { (event.target as HTMLImageElement).style.visibility = 'hidden'; }
function onScroll(event: Event) { const node = event.target as HTMLElement; if (node.scrollHeight - node.scrollTop - node.clientHeight < 100) void list.loadMore(); }
function select(value: string) { if (/^[a-zA-Z0-9_-]{1,100}$/.test(value)) void router.replace({ name: 'Desktop.Chat', params: { convId: value } }); }
function back() { void router.replace({ name: 'Desktop.Chat' }); }
function openMain() { if (desktop) desktop.openMain(id.value); else void router.push(id.value ? `/chat/${id.value}` : '/chat'); }
function togglePin() { desktop?.setPinned?.(!pinned.value); }
async function markVisibleRead() {
  if (!id.value || conversation.value?.id !== id.value || preview.blocked.value || !document.hasFocus() || document.hidden || reading) return;
  const current = id.value, lastMessageId = messages.value.at(-1)?.id || '';
  const fingerprint = `${current}:${lastMessageId}`;
  if (lastRead === fingerprint) { desktop?.active(current); return; }
  reading = true;
  try {
    await api.post(`/conversations/${current}/mark-read`);
    if (disposed || current !== id.value || !document.hasFocus() || document.hidden) return;
    lastRead = fingerprint; desktop?.active(current);
    void inbox.markConversationRead(current);
    const row = rows.value.find((row) => row.id === current); if (row) row.unreadCount = 0;
  } catch { /* A denied read must not clear the unread badge. */ }
  finally {
    reading = false;
    if (!disposed && (current !== id.value || lastMessageId !== (messages.value.at(-1)?.id || ''))) void markVisibleRead();
  }
}
watch([conversation, messages], () => { void markVisibleRead(); });
watch(id, () => { lastRead = ''; desktop?.active(''); });
function onBlur() { desktop?.active(''); }
function onKey(event: KeyboardEvent) {
  const overlayOpen = [...document.querySelectorAll('.v-overlay--active, [role="dialog"], [role="menu"]')].some((node) => node.getClientRects().length > 0);
  if (event.key !== 'Escape' || event.defaultPrevented || overlayOpen) return;
  event.preventDefault(); if (id.value) back(); else desktop?.hide();
}
onMounted(async () => {
  window.addEventListener('focus', markVisibleRead); window.addEventListener('blur', onBlur); window.addEventListener('keydown', onKey);
  if (!desktop) return;
  unsubscribers.push(desktop.onState((state) => { pinned.value = state.pinned === true; }), desktop.onOpen((value) => { if (value) select(value); else back(); }), desktop.onReset(() => { preview.invalidate(); window.location.reload(); }));
  const state = await desktop.state(); if (!disposed) pinned.value = state?.pinned === true;
});
onBeforeUnmount(() => {
  disposed = true; desktop?.active('');
  window.removeEventListener('focus', markVisibleRead); window.removeEventListener('blur', onBlur); window.removeEventListener('keydown', onKey);
  for (const unsubscribe of unsubscribers) unsubscribe();
});
</script>

<style scoped>
.desktop-chat { height: 100dvh; display: flex; flex-direction: column; overflow: hidden; background: var(--color-surface, #fff); color: var(--color-text, #202124); }
.desktop-chat-header { height: 46px; flex: 0 0 46px; display: flex; align-items: center; gap: 8px; padding: 0 10px; border-bottom: 1px solid #e1e5e9; }
.desktop-chat-header strong { font-size: 15px; white-space: nowrap; }
.desktop-chat-header > span { flex: 1; min-width: 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #59636e; }
.desktop-chat-header button { width: 30px; height: 32px; flex-shrink: 0; display: grid; place-items: center; border: 0; background: transparent; cursor: pointer; color: inherit; }
.desktop-chat-header button:hover, .desktop-chat-header button.active { background: #e8f4ef; color: #007b60; }
.desktop-chat-body { display: flex; flex: 1; min-height: 0; }
.desktop-inbox { width: 100%; display: flex; flex-direction: column; min-height: 0; }
.inbox-search { margin: 12px; padding: 0 10px; display: flex; align-items: center; gap: 8px; background: #f0f3f5; border-radius: 6px; min-height: 38px; color: #65707d; }
.inbox-search input { border: 0; outline: 0; background: transparent; width: 100%; min-width: 0; font-size: 14px; color: inherit; }
.inbox-filters { display: flex; gap: 8px; align-items: center; padding: 0 12px 10px; }
.inbox-tabs { display: flex; gap: 4px; }
.inbox-tabs button { border: 0; border-radius: 4px; padding: 7px 9px; font-size: 12px; white-space: nowrap; background: transparent; color: #56616d; cursor: pointer; }
.inbox-tabs button.active { color: #006a50; background: #e5f4ed; font-weight: 600; }
.inbox-filters select { margin-left: auto; font-size: 12px; max-width: 48%; min-width: 0; border: 1px solid #dce2e7; border-radius: 4px; padding: 6px; }
.inbox-rows { overflow: auto; flex: 1; min-height: 0; }
.inbox-row { width: 100%; display: flex; text-align: left; align-items: center; gap: 10px; padding: 12px; border: 0; border-bottom: 1px solid #f0f2f4; background: transparent; color: inherit; cursor: pointer; }
.inbox-row:hover { background: #f5f8fa; }.inbox-row.selected { background: #eaf5ef; }
.inbox-avatar { width: 44px; height: 44px; flex: 0 0 44px; object-fit: cover; border-radius: 50%; background: #e8edf3; }
.inbox-avatar.initials { display: grid; place-items: center; font-size: 18px; color: #4d6476; }
.inbox-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.inbox-top { display: flex; gap: 8px; align-items: center; }.inbox-top strong { font-size: 14px; font-weight: 500; flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.inbox-top time { font-size: 11px; color: #6d7781; flex-shrink: 0; }.inbox-nick { font-size: 11px; color: #43705f; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.inbox-snippet { font-size: 12px; color: #67727d; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }.unread .inbox-top strong, .unread .inbox-snippet { font-weight: 700; color: #202b35; }
.inbox-indicators { display: flex; flex-direction: column; align-items: center; gap: 8px; color: #78828a; }.inbox-indicators small { font-size: 11px; background: #d73446; color: #fff; border-radius: 12px; min-width: 20px; height: 20px; display: grid; place-items: center; padding: 0 4px; }
.inbox-empty { padding: 24px 12px; text-align: center; font-size: 13px; color: #68737e; }.inbox-empty button { display: block; margin: 10px auto; }.inbox-more { width: 100%; padding: 12px; font-size: 13px; color: #007b60; background: transparent; border: 0; cursor: pointer; }
.desktop-thread { display: none; min-width: 0; min-height: 0; flex-direction: column; flex: 1; }.has-conversation .desktop-thread { display: flex; }.has-conversation .desktop-inbox { display: none; }
.desktop-chat-workspace { flex: 1; min-height: 0; }.desktop-status { font-size: 12px; padding: 6px 12px; background: #fff3cd; color: #765d10; }
.desktop-chat-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; text-align: center; }.desktop-chat-empty h1 { font-size: 20px; }.desktop-chat-empty p { font-size: 14px; }
.desktop-chat-empty button { padding: 8px 16px; border: 1px solid #d9dfe5; background: #fff; border-radius: 4px; cursor: pointer; }
@media (min-width: 900px) { .desktop-inbox, .has-conversation .desktop-inbox { display: flex; width: 310px; flex: 0 0 310px; border-right: 1px solid #e1e5e9; }.desktop-thread { display: flex; }.inbox-filters { flex-wrap: wrap; }.inbox-filters select { max-width: 100%; width: 100%; margin-left: 0; } }
</style>
