<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="mc-wrap">
    <!-- Header -->
    <header class="mc-head">
      <div class="mc-title-row">
        <h1 class="mc-title">Tin nhắn<span v-if="totalUnread" class="mc-total">{{ totalUnread }}</span></h1>
        <button class="mc-icon-btn" aria-label="Cài đặt" @click="router.push({ name: 'M.Settings' })">⚙️</button>
      </div>
      <div class="mc-search">
        <input v-model="search" type="search" placeholder="Tìm theo tên, số điện thoại…" @input="onSearch" />
      </div>
      <div class="mc-filters">
        <button class="mc-chip" :class="{ on: !unreadOnly }" @click="setUnread(false)">Tất cả</button>
        <button class="mc-chip" :class="{ on: unreadOnly }" @click="setUnread(true)">Chưa đọc</button>
      </div>
    </header>

    <!-- List: pull-to-refresh + infinite scroll -->
    <div
      ref="scroller" class="mc-list"
      @scroll.passive="onScroll"
      @touchstart.passive="onTouchStart" @touchmove.passive="onTouchMove" @touchend="onTouchEnd"
    >
      <div v-if="pullY > 0" class="mc-pull" :style="{ height: pullY + 'px' }">
        {{ pullY > PULL_THRESHOLD ? 'Thả để tải lại' : 'Kéo xuống để tải lại' }}
      </div>

      <div v-if="loading && !items.length" class="mc-state">Đang tải…</div>
      <div v-else-if="error" class="mc-state mc-err">{{ error }} <button @click="load()">Thử lại</button></div>
      <div v-else-if="!items.length" class="mc-state">Không có hội thoại nào.</div>

      <button v-for="c in items" :key="c.id" class="mc-row" @click="open(c)">
        <div class="mc-avatar">
          <img v-if="c.contact?.avatarUrl" :src="c.contact.avatarUrl" alt="" loading="lazy" />
          <span v-else>{{ initial(c) }}</span>
          <span v-if="c.zaloAccount" class="mc-ch" title="Zalo">Z</span>
        </div>
        <div class="mc-body">
          <div class="mc-line1">
            <span class="mc-name" :class="{ bold: (c.unreadCount ?? 0) > 0 }">{{ name(c) }}</span>
            <span class="mc-time">{{ shortTime(c.lastMessageAt) }}</span>
          </div>
          <div class="mc-line2">
            <span class="mc-prev" :class="{ bold: (c.unreadCount ?? 0) > 0 }">{{ previewText(c) }}</span>
            <span v-if="(c.unreadCount ?? 0) > 0" class="mc-badge">{{ c.unreadCount! > 99 ? '99+' : c.unreadCount }}</span>
          </div>
          <div v-if="c.zaloAccount?.displayName" class="mc-line3">{{ c.zaloAccount.displayName }}</div>
        </div>
      </button>

      <div v-if="loadingMore" class="mc-state">Đang tải thêm…</div>
      <div v-else-if="!hasMore && items.length" class="mc-end">Hết hội thoại</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useChat } from '@/composables/use-chat';
import {
  useMobileConversations, previewText, shortTime, type MConversation,
} from '@/composables/use-mobile-conversations';

defineOptions({ name: 'MConversationsView' }); // để <keep-alive include> nhận diện

const router = useRouter();
const { getSocket } = useChat();
const {
  items, loading, loadingMore, search, unreadOnly, error,
  hasMore, totalUnread, load, loadMore, applyIncoming, markRead,
} = useMobileConversations();

function name(c: MConversation) {
  return c.contact?.crmName || c.contact?.fullName || 'Khách hàng';
}
function initial(c: MConversation) {
  return (name(c) || '?').trim().charAt(0).toUpperCase();
}

function open(c: MConversation) {
  markRead(c.id);
  router.push({ name: 'M.Chat', params: { convId: c.id } });
}

// ── Tìm kiếm (debounce) ──
let searchTimer: ReturnType<typeof setTimeout>;
function onSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => load(), 350);
}
function setUnread(v: boolean) {
  if (unreadOnly.value === v) return;
  unreadOnly.value = v;
  void load();
}

// ── Infinite scroll ──
const scroller = ref<HTMLElement | null>(null);
function onScroll() {
  const el = scroller.value;
  if (!el) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) void loadMore();
}

// ── Pull to refresh (chỉ khi đang ở đỉnh danh sách) ──
const PULL_THRESHOLD = 64;
const pullY = ref(0);
let startY = 0;
let pulling = false;
function onTouchStart(e: TouchEvent) {
  const el = scroller.value;
  pulling = !!el && el.scrollTop <= 0;
  startY = e.touches[0].clientY;
}
function onTouchMove(e: TouchEvent) {
  if (!pulling) return;
  const dy = e.touches[0].clientY - startY;
  pullY.value = dy > 0 ? Math.min(dy * 0.5, 90) : 0;
}
async function onTouchEnd() {
  if (pullY.value > PULL_THRESHOLD) await load();
  pullY.value = 0;
  pulling = false;
}

// ── Realtime: tin mới → cập nhật preview/badge/thứ tự ──
function onSocketMessage(payload: { conversationId: string; message: Record<string, unknown> }) {
  applyIncoming(payload, null); // ở màn danh sách thì không có hội thoại nào đang mở
}
onMounted(() => {
  void load();
  getSocket()?.on('chat:message', onSocketMessage);
});
onUnmounted(() => {
  getSocket()?.off('chat:message', onSocketMessage);
});
</script>

<style scoped>
.mc-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--smax-bg, #fff); }
.mc-head { flex-shrink: 0; padding: 10px 14px 6px; background: var(--smax-bg, #fff); border-bottom: 1px solid var(--smax-grey-200, #ebedf0); }
.mc-title-row { display: flex; align-items: center; justify-content: space-between; }
.mc-title { font-size: 22px; font-weight: 700; margin: 0; display: flex; align-items: center; gap: 8px; }
.mc-total { font-size: 12px; font-weight: 700; background: #ef4444; color: #fff; border-radius: 999px; padding: 2px 8px; }
.mc-icon-btn { background: none; border: 0; font-size: 20px; padding: 6px; cursor: pointer; }
.mc-search { margin-top: 8px; }
.mc-search input {
  width: 100%; border: 0; background: var(--smax-grey-100, #f5f6fa);
  border-radius: 999px; padding: 10px 16px; font-size: 15px; outline: none;
}
.mc-filters { display: flex; gap: 8px; margin-top: 8px; }
.mc-chip {
  border: 0; background: var(--smax-grey-100, #f5f6fa); color: var(--smax-grey-700, #5a6478);
  border-radius: 999px; padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
}
.mc-chip.on { background: var(--smax-primary, #1786be); color: #fff; }

.mc-list { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.mc-pull { display: flex; align-items: center; justify-content: center; font-size: 12.5px; color: var(--smax-grey-700); }
.mc-state { padding: 24px; text-align: center; color: var(--smax-grey-700, #5a6478); font-size: 14px; }
.mc-state.mc-err button { margin-left: 8px; border: 0; background: var(--smax-primary); color: #fff; border-radius: 8px; padding: 5px 12px; }
.mc-end { padding: 16px; text-align: center; font-size: 12px; color: var(--smax-grey-300, #d4d8de); }

.mc-row {
  display: flex; gap: 12px; width: 100%; text-align: left;
  padding: 11px 14px; border: 0; background: none; cursor: pointer;
  border-bottom: 1px solid var(--smax-grey-100, #f5f6fa);
  /* nút lớn, dễ bấm 1 tay */
  min-height: 68px; align-items: center;
}
.mc-row:active { background: var(--smax-grey-100, #f5f6fa); }
.mc-avatar {
  position: relative; width: 52px; height: 52px; flex-shrink: 0; border-radius: 50%;
  background: linear-gradient(135deg, #90caf9, #1976d2); color: #fff;
  display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 19px;
}
.mc-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.mc-ch {
  position: absolute; right: -1px; bottom: -1px; width: 18px; height: 18px; border-radius: 50%;
  background: #0068ff; color: #fff; font-size: 10px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; border: 2px solid #fff;
}
.mc-body { flex: 1; min-width: 0; }
.mc-line1 { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.mc-name { font-size: 15.5px; color: var(--smax-text, #212121); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-name.bold { font-weight: 700; }
.mc-time { font-size: 12px; color: var(--smax-grey-700, #5a6478); flex-shrink: 0; }
.mc-line2 { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.mc-prev { flex: 1; min-width: 0; font-size: 13.5px; color: var(--smax-grey-700, #5a6478); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-prev.bold { color: var(--smax-text, #212121); font-weight: 600; }
.mc-badge { flex-shrink: 0; background: #ef4444; color: #fff; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 7px; min-width: 20px; text-align: center; }
.mc-line3 { font-size: 11px; color: var(--smax-grey-300, #b6bcc6); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
