<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Hộp thư thông báo tin nhắn bền vững cho mobile. -->
<template>
  <div class="mni">
    <MPageHeader title="Thông báo" :count="inbox.unreadCount.value || null" back @back="router.back()">
      <template #actions>
        <button
          v-if="inbox.unreadCount.value"
          class="mni-read-all"
          type="button"
          :disabled="markingAll"
          @click="readAll"
        >
          <CheckCheckIcon :size="17" :stroke-width="2" /> Đọc hết
        </button>
      </template>
    </MPageHeader>

    <main class="mni-list m-scroll">
      <template v-if="inbox.loading.value && !inbox.notifications.value.length">
        <div v-for="n in 7" :key="n" class="mni-row mni-skeleton">
          <span class="m-skel mni-avatar" />
          <span class="mni-body"><i class="m-skel sk-title" /><i class="m-skel sk-line" /><i class="m-skel sk-short" /></span>
        </div>
      </template>

      <div v-else-if="inbox.error.value && !inbox.notifications.value.length" class="mni-state">
        <BellOffIcon :size="30" :stroke-width="1.5" />
        <strong>Chưa tải được thông báo</strong>
        <span>{{ inbox.error.value }}</span>
        <button type="button" @click="inbox.refresh()">Thử lại</button>
      </div>

      <div v-else-if="!inbox.notifications.value.length" class="mni-state">
        <BellIcon :size="30" :stroke-width="1.5" />
        <strong>Chưa có thông báo</strong>
        <span>Tin nhắn mới từ khách hàng sẽ được lưu tại đây.</span>
      </div>

      <template v-else>
        <button
          v-for="item in inbox.notifications.value"
          :key="item.id"
          class="mni-row"
          :class="{ unread: !item.readAt }"
          type="button"
          @click="open(item)"
        >
          <span class="mni-avatar">
            <img v-if="item.avatarUrl && !failedAvatars.has(item.id)" :src="item.avatarUrl" alt="" @error="failedAvatars.add(item.id)" />
            <span v-else>{{ initial(item.title) }}</span>
          </span>
          <span class="mni-body">
            <span class="mni-top">
              <strong>{{ item.title }}</strong>
              <time>{{ timeLabel(item.createdAt) }}</time>
            </span>
            <span class="mni-context">{{ item.context }}</span>
            <span class="mni-preview">{{ item.preview }}</span>
          </span>
          <span v-if="!item.readAt" class="mni-dot" aria-label="Chưa đọc" />
        </button>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onActivated, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Bell as BellIcon, BellOff as BellOffIcon, CheckCheck as CheckCheckIcon } from 'lucide-vue-next';
import MPageHeader from '@/components/mobile/MPageHeader.vue';
import {
  useMessageNotificationInbox,
  type MessageNotificationItem,
} from '@/composables/use-message-notification-inbox';

defineOptions({ name: 'MNotificationsView' });
const router = useRouter();
const inbox = useMessageNotificationInbox();
const markingAll = ref(false);
const failedAvatars = reactive(new Set<string>());

function initial(title: string) { return (title || 'T').trim().charAt(0).toUpperCase(); }
function timeLabel(value: string): string {
  const date = new Date(value);
  const elapsed = Date.now() - date.getTime();
  if (!Number.isFinite(date.getTime())) return '';
  if (elapsed < 60_000) return 'Vừa xong';
  if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))} phút`;
  const now = new Date();
  const time = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return time;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Hôm qua ${time}`;
  return `${date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} ${time}`;
}
function open(item: MessageNotificationItem) {
  void inbox.markConversationRead(item.conversationId);
  void router.push({ name: 'M.Chat', params: { convId: item.conversationId } });
}
async function readAll() {
  if (markingAll.value) return;
  markingAll.value = true;
  try { await inbox.markAllRead(); } finally { markingAll.value = false; }
}

onMounted(() => void inbox.refresh());
onActivated(() => void inbox.refresh());
</script>

<style scoped>
.mni { display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--m-bg); }
.mni-read-all {
  min-height: 36px; border: 0; border-radius: var(--m-r-md); background: transparent; color: var(--m-brand);
  display: inline-flex; align-items: center; gap: 5px; padding: 0 7px; font-size: var(--m-fs-xs); font-weight: var(--m-fw-semibold);
}
.mni-read-all:active { background: var(--m-brand-soft); }
.mni-read-all:disabled { opacity: .55; }
.mni-list { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; background: var(--m-surface); }
.mni-row {
  position: relative; width: 100%; min-height: 88px; border: 0; border-bottom: 1px solid var(--m-border);
  background: var(--m-surface); color: var(--m-text); display: flex; align-items: flex-start; gap: var(--m-sp-3);
  padding: var(--m-sp-3) var(--m-sp-4); text-align: left;
}
.mni-row.unread { background: var(--m-brand-soft); }
.mni-row:active { filter: brightness(.97); }
.mni-avatar {
  flex: 0 0 46px; width: 46px; height: 46px; overflow: hidden; border-radius: var(--m-r-full);
  background: var(--m-surface-2); color: var(--m-brand); display: flex; align-items: center; justify-content: center;
  font-size: var(--m-fs-lg); font-weight: var(--m-fw-bold);
}
.mni-avatar img { width: 100%; height: 100%; object-fit: cover; }
.mni-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.mni-top { display: flex; align-items: baseline; gap: var(--m-sp-2); min-width: 0; }
.mni-top strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--m-fs-md); }
.mni-top time { flex-shrink: 0; color: var(--m-text-3); font-size: var(--m-fs-2xs); }
.mni-context { color: var(--m-brand); font-size: var(--m-fs-xs); font-weight: var(--m-fw-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mni-preview { color: var(--m-text-2); font-size: var(--m-fs-sm); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mni-dot { position: absolute; right: 7px; top: 50%; width: 7px; height: 7px; border-radius: 50%; background: var(--m-brand); }
.mni-state { min-height: 55vh; padding: var(--m-sp-6); color: var(--m-text-3); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--m-sp-2); text-align: center; }
.mni-state strong { color: var(--m-text); font-size: var(--m-fs-md); }
.mni-state span { max-width: 280px; font-size: var(--m-fs-sm); line-height: 1.45; }
.mni-state button { margin-top: var(--m-sp-2); min-height: 40px; border: 0; border-radius: var(--m-r-md); background: var(--m-brand); color: #fff; padding: 0 var(--m-sp-4); font-weight: var(--m-fw-semibold); }
.mni-skeleton { pointer-events: none; }
.mni-skeleton .mni-body { gap: 7px; }
.mni-skeleton i { display: block; height: 11px; border-radius: var(--m-r-sm); }
.sk-title { width: 48%; }.sk-line { width: 72%; }.sk-short { width: 88%; }
</style>
