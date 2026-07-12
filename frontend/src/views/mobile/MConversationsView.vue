<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="mc-wrap">
    <!-- Header -->
    <header class="mc-head">
      <div class="mc-title-row">
        <h1 class="mc-title">Tin nhắn<span v-if="totalUnread" class="m-badge mc-total">{{ totalUnread > 99 ? '99+' : totalUnread }}</span></h1>
        <button class="m-iconbtn" aria-label="Cài đặt" @click="router.push({ name: 'M.Settings' })">
          <SettingsIcon :size="22" :stroke-width="1.9" />
        </button>
      </div>
      <div class="mc-search">
        <SearchIcon class="mc-search-ic" :size="18" :stroke-width="2" />
        <input v-model="search" type="search" placeholder="Tìm tên, số điện thoại…" @input="onSearch" />
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

      <!-- Skeleton loading (cảm giác nhanh + có chiều sâu) -->
      <template v-if="loading && !items.length">
        <div v-for="n in 8" :key="n" class="mc-row mc-row--skel">
          <div class="m-skel mc-sk-av" />
          <div class="mc-body">
            <div class="m-skel mc-sk-l1" />
            <div class="m-skel mc-sk-l2" />
          </div>
        </div>
      </template>
      <div v-else-if="error" class="mc-state mc-err">
        <AlertTriangleIcon :size="26" :stroke-width="1.6" />
        <p>{{ error }}</p>
        <button @click="load()">Thử lại</button>
      </div>
      <div v-else-if="!items.length" class="mc-state">
        <MessageCircleIcon :size="30" :stroke-width="1.5" />
        <p>{{ search ? 'Không tìm thấy hội thoại phù hợp.' : 'Chưa có hội thoại nào.' }}</p>
      </div>

      <button
        v-for="(c, idx) in items"
        :key="c.id"
        class="mc-row"
        :class="{ unread: (c.unreadCount ?? 0) > 0 }"
        :style="idx < 12 ? { animationDelay: idx * 18 + 'ms' } : undefined"
        @click="open(c)"
      >
        <div class="mc-avatar">
          <img v-if="c.contact?.avatarUrl" :src="c.contact.avatarUrl" alt="" loading="lazy" />
          <span v-else>{{ initial(c) }}</span>
          <span v-if="c.zaloAccount" class="mc-ch" title="Zalo">Z</span>
        </div>
        <div class="mc-body">
          <div class="mc-line1">
            <span class="mc-name">{{ name(c) }}</span>
            <span class="mc-time">{{ shortTime(c.lastMessageAt) }}</span>
          </div>
          <div class="mc-line2">
            <span class="mc-prev">{{ isPrivate(c) ? 'Nội dung riêng tư' : previewText(c) }}</span>
            <span v-if="(c.unreadCount ?? 0) > 0" class="m-badge mc-badge">{{ c.unreadCount! > 99 ? '99+' : c.unreadCount }}</span>
          </div>
          <!-- Hàng meta: tín hiệu nhanh (nền tảng · nick · riêng tư). Mở rộng thêm ở PR2. -->
          <div v-if="hasMeta(c)" class="mc-meta">
            <span v-if="isPrivate(c)" class="m-chip m-chip--danger"><LockIcon :size="11" :stroke-width="2.2" /> Riêng tư</span>
            <span v-if="c.zaloAccount?.displayName" class="m-chip">{{ c.zaloAccount.displayName }}</span>
          </div>
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
import {
  Settings as SettingsIcon, Search as SearchIcon, Lock as LockIcon,
  AlertTriangle as AlertTriangleIcon, MessageCircle as MessageCircleIcon,
} from 'lucide-vue-next';
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
function isPrivate(c: MConversation): boolean {
  return !!((c as any).isPrivate || c.redacted);
}
function hasMeta(c: MConversation): boolean {
  return isPrivate(c) || !!c.zaloAccount?.displayName;
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
.mc-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--m-surface); }
/* Header: padding-top = safe-area (env trực tiếp, có fallback 0px) → luôn dưới status bar/notch;
   longhand tách khỏi shorthand để không trình duyệt nào hỏng padding. */
.mc-head { flex-shrink: 0; padding: 0 var(--m-sp-4) var(--m-sp-2); padding-top: env(safe-area-inset-top, 0px); background: var(--m-surface); border-bottom: 1px solid var(--m-border); }
.mc-title-row { display: flex; align-items: center; justify-content: space-between; min-height: var(--m-touch); }
.mc-title { font-size: var(--m-fs-xl); font-weight: var(--m-fw-bold); color: var(--m-text); margin: 0; display: flex; align-items: center; gap: var(--m-sp-2); }
.mc-total { margin-left: 2px; }
/* Ô tìm kiếm — pill có icon, focus ring brand */
.mc-search { position: relative; margin-top: var(--m-sp-1); }
.mc-search-ic { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--m-text-3); pointer-events: none; }
.mc-search input {
  width: 100%; border: 1.5px solid transparent; background: var(--m-surface-2);
  border-radius: var(--m-r-full); padding: 11px 16px 11px 40px; font-size: var(--m-fs-input);
  color: var(--m-text); outline: none; transition: border-color var(--m-dur-fast) var(--m-ease), background var(--m-dur-fast) var(--m-ease);
}
.mc-search input:focus { border-color: var(--m-brand); background: var(--m-surface); }
.mc-search input::placeholder { color: var(--m-text-3); }
.mc-filters { display: flex; gap: var(--m-sp-2); margin-top: var(--m-sp-2); }
.mc-chip {
  border: 0; background: var(--m-surface-2); color: var(--m-text-2);
  border-radius: var(--m-r-full); padding: 7px 15px; font-size: var(--m-fs-sm); font-weight: var(--m-fw-semibold);
  cursor: pointer; transition: background var(--m-dur-fast) var(--m-ease), color var(--m-dur-fast) var(--m-ease);
}
.mc-chip:active { transform: scale(0.96); }
.mc-chip.on { background: var(--m-brand); color: var(--m-brand-ink); }

.mc-list { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: env(safe-area-inset-bottom, 0px); }
.mc-pull { display: flex; align-items: center; justify-content: center; font-size: var(--m-fs-xs); color: var(--m-text-2); }
.mc-state { display: flex; flex-direction: column; align-items: center; gap: var(--m-sp-3); padding: 56px var(--m-sp-6); text-align: center; color: var(--m-text-2); }
.mc-state p { font-size: var(--m-fs-md); margin: 0; }
.mc-state.mc-err button { border: 0; background: var(--m-brand); color: var(--m-brand-ink); border-radius: var(--m-r-sm); padding: 8px 18px; font-weight: var(--m-fw-semibold); }
.mc-end { padding: var(--m-sp-4); text-align: center; font-size: var(--m-fs-xs); color: var(--m-text-3); }

.mc-row {
  display: flex; gap: var(--m-sp-3); width: 100%; text-align: left;
  padding: 10px var(--m-sp-4); border: 0; background: none; cursor: pointer;
  min-height: 72px; align-items: center;
  animation: m-rise var(--m-dur-base) var(--m-ease) both;
  transition: background var(--m-dur-fast) var(--m-ease);
}
.mc-row + .mc-row { box-shadow: inset 0 1px 0 var(--m-border); } /* divider mảnh */
.mc-row:active { background: var(--m-surface-2); }
.mc-row--skel { animation: none; pointer-events: none; }
.mc-sk-av { width: 54px; height: 54px; border-radius: var(--m-r-full); flex-shrink: 0; }
.mc-sk-l1 { height: 14px; width: 45%; margin-bottom: 9px; }
.mc-sk-l2 { height: 12px; width: 75%; }

.mc-avatar {
  position: relative; width: 54px; height: 54px; flex-shrink: 0; border-radius: var(--m-r-full);
  background: linear-gradient(135deg, #8fb7ff, #1f6fd6); color: #fff;
  display: flex; align-items: center; justify-content: center; font-weight: var(--m-fw-semibold); font-size: 20px;
}
.mc-avatar img { width: 100%; height: 100%; border-radius: var(--m-r-full); object-fit: cover; }
.mc-ch {
  position: absolute; right: -1px; bottom: -1px; width: 19px; height: 19px; border-radius: var(--m-r-full);
  background: #0068ff; color: #fff; font-size: 10px; font-weight: var(--m-fw-bold);
  display: flex; align-items: center; justify-content: center; border: 2.5px solid var(--m-surface);
}
.mc-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.mc-line1 { display: flex; align-items: baseline; justify-content: space-between; gap: var(--m-sp-2); }
.mc-name { font-size: var(--m-fs-md); font-weight: var(--m-fw-semibold); color: var(--m-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-time { font-size: var(--m-fs-xs); color: var(--m-text-3); flex-shrink: 0; font-weight: var(--m-fw-medium); }
.mc-line2 { display: flex; align-items: center; gap: var(--m-sp-2); }
.mc-prev { flex: 1; min-width: 0; font-size: var(--m-fs-sm); color: var(--m-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-badge { flex-shrink: 0; }
/* Chưa đọc: tên đậm + preview đậm hơn (phân tầng rõ) */
.mc-row.unread .mc-name { font-weight: var(--m-fw-bold); }
.mc-row.unread .mc-prev { color: var(--m-text); font-weight: var(--m-fw-medium); }
.mc-meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 1px; }
</style>
