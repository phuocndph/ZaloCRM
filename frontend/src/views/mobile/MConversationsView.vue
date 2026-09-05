<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="mc-wrap">
    <!-- Header -->
    <header class="mc-head">
      <div class="mc-title-row">
        <h1 class="mc-title">Tin nhắn<span v-if="totalUnread" class="m-badge mc-total">{{ totalUnread > 99 ? '99+' : totalUnread }}</span></h1>
        <MNotificationButton />
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
        <button class="mc-chip" :class="{ on: unrepliedOnly }" @click="setUnreplied(!unrepliedOnly)">Chưa rep</button>
        <button class="mc-chip" :class="{ on: !!tagFilter }" @click="openTagFilter">{{ tagFilter || 'Tag' }}</button>
      </div>
    </header>

    <!-- List: pull-to-refresh + infinite scroll -->
    <div
      ref="scroller" class="mc-list"
      @scroll.passive="onScroll"
      @touchstart.passive="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd"
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
      <div v-else-if="!displayItems.length" class="mc-state">
        <MessageCircleIcon :size="30" :stroke-width="1.5" />
        <p>{{ search ? 'Không tìm thấy hội thoại phù hợp.' : 'Chưa có hội thoại nào.' }}</p>
      </div>

      <div
        v-for="(c, idx) in displayItems"
        :key="c.id"
        :data-conversation-id="c.id"
        class="mc-row"
        :class="{ unread: isUnread(c), pinned: isPinned(c) }"
        :style="idx < 12 ? { animationDelay: idx * 18 + 'ms' } : undefined"
        role="button"
        tabindex="0"
        @click="open(c)"
        @keydown.enter.prevent="open(c)"
      >
        <div
          class="mc-avatar"
          :class="[
            usesGroupCollage(c) ? 'mc-avatar--group' : '',
            usesGroupCollage(c) ? `mc-avatar--group-${groupAvatarCellCount(c)}` : '',
          ]"
        >
          <template v-if="usesGroupCollage(c)">
            <img
              v-for="src in groupAvatarUrls(c)"
              :key="src"
              class="mc-group-img"
              :src="src"
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
              @error="markAvatarFailed(c.id, src)"
            />
            <span v-if="extraGroupCount(c) > 0" class="mc-group-extra">+{{ extraGroupCount(c) > 99 ? '99+' : extraGroupCount(c) }}</span>
          </template>
          <img v-else-if="avatarUrl(c) && !imgFailed.has(c.id)" :src="avatarUrl(c)!" alt="" loading="lazy" referrerpolicy="no-referrer" @error="imgFailed.add(c.id)" />
          <span v-else>{{ initial(c) }}</span>
          <svg v-if="false" class="mc-group-icon" viewBox="0 0 24 24" aria-label="Nhóm hội thoại">
            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
          </svg>
          <span v-if="c.zaloAccount" class="mc-ch" title="Zalo">Z</span>
        </div>
        <div class="mc-body">
          <div class="mc-line1">
            <span class="mc-name"><PinIcon v-if="isPinned(c)" class="mc-pin" :size="13" :stroke-width="2.4" /><UsersIcon v-if="isGroup(c) && !!avatarUrl(c)" class="mc-group-title-icon" :size="14" :stroke-width="2.3" />{{ name(c) }}</span>
            <span class="mc-time">{{ shortTime(c.lastMessageAt) }}</span>
          </div>
          <div class="mc-line2">
            <span
              class="mc-prev"
              :class="{ 'is-recalled': !isPrivate(c) && isRecalledPreview(c) }"
            >{{ isPrivate(c) ? 'Nội dung riêng tư' : previewText(c) }}</span>
            <span v-if="isUnread(c)" class="m-badge mc-badge">{{ (c.unreadCount ?? 0) > 0 ? (c.unreadCount! > 99 ? '99+' : c.unreadCount) : '' }}</span>
          </div>
          <!-- Hàng meta: tín hiệu nhanh (nền tảng · nick · riêng tư). Mở rộng thêm ở PR2. -->
          <div v-if="hasMeta(c)" class="mc-meta">
            <span v-if="isPrivate(c)" class="m-chip m-chip--danger"><LockIcon :size="11" :stroke-width="2.2" /> Riêng tư</span>
            <span v-if="c.zaloAccount?.displayName" class="m-chip">{{ c.zaloAccount.displayName }}</span>
          </div>
        </div>
        <button class="mc-more" type="button" :aria-label="`Tác vụ ${name(c)}`" @click.stop="openActions(c)">
          <MoreHorizontalIcon :size="21" :stroke-width="2" />
        </button>
      </div>

      <div v-if="loadingMore" class="mc-state">Đang tải thêm…</div>
      <div v-else-if="!hasMore && displayItems.length" class="mc-end">Hết hội thoại</div>
    </div>

    <div v-if="actionConv" class="mc-action-backdrop" @click="closeActions">
      <section class="mc-action-sheet" @click.stop>
        <div class="mc-action-grip" />
        <div class="mc-action-title">{{ name(actionConv) }}</div>
        <button class="mc-action-row" :disabled="actionBusy" @click="togglePin">
          <PinIcon v-if="!isPinned(actionConv)" :size="20" :stroke-width="2" />
          <PinOffIcon v-else :size="20" :stroke-width="2" />
          <span>{{ isPinned(actionConv) ? 'Bỏ ghim hội thoại' : 'Ghim hội thoại' }}</span>
        </button>
        <button class="mc-action-row" :disabled="actionBusy" @click="toggleUnread">
          <MailIcon v-if="!isManualUnread(actionConv)" :size="20" :stroke-width="2" />
          <MailOpenIcon v-else :size="20" :stroke-width="2" />
          <span>{{ isManualUnread(actionConv) ? 'Đánh dấu đã đọc' : 'Đánh dấu chưa đọc' }}</span>
        </button>
      </section>
    </div>
    <div v-if="tagSheet" class="mc-action-backdrop" @click="tagSheet = false">
      <section class="mc-action-sheet mc-tag-sheet" @click.stop>
        <div class="mc-action-grip" />
        <div class="mc-action-title">Lọc Tag</div>
        <button class="mc-action-row" :class="{ on: !tagFilter }" @click="setTagFilter('')">Tất cả tag</button>
        <button v-for="tag in tagOptions" :key="tag" class="mc-action-row" :class="{ on: tagFilter === tag }" @click="setTagFilter(tag)">{{ tag }}</button>
        <div v-if="!tagOptions.length" class="mc-tag-empty">Chưa có tag trong phạm vi hiện tại.</div>
      </section>
    </div>
    <!-- Soạn tin mới (FAB) — chọn nick, tìm bạn bè, mở chat. -->
    <button class="mc-fab" aria-label="Soạn tin mới" @click="router.push({ name: 'M.Compose' })">
      <PenSquareIcon :size="24" :stroke-width="2" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';
import {
  Settings as SettingsIcon, Search as SearchIcon, Lock as LockIcon,
  AlertTriangle as AlertTriangleIcon, MessageCircle as MessageCircleIcon,
  SquarePen as PenSquareIcon, Pin as PinIcon, PinOff as PinOffIcon,
  Mail as MailIcon, MailOpen as MailOpenIcon, MoreHorizontal as MoreHorizontalIcon, UsersRound as UsersIcon,
} from 'lucide-vue-next';
import { useChat } from '@/composables/use-chat';
import MNotificationButton from '@/components/mobile/MNotificationButton.vue';
import {
  useMobileConversations, previewText, shortTime, isRecalledPreview, type MConversation,
} from '@/composables/use-mobile-conversations';
import {
  captureConversationScrollAnchor,
  restoreConversationScrollAnchor,
} from '@/composables/conversation-scroll-anchor';

defineOptions({ name: 'MConversationsView' }); // để <keep-alive include> nhận diện

const router = useRouter();
const { getSocket } = useChat();
const {
  items, displayItems, loading, loadingMore, search, unreadOnly, unrepliedOnly, tagFilter, error,
  hasMore, totalUnread, isUnread, load, loadMore, applyIncoming, markRead, setPinned, setManualUnread,
} = useMobileConversations();

// Avatar tải lỗi → hiện chữ cái đầu (reactive Set — Vue 3 theo dõi has/add).
const imgFailed = reactive(new Set<string>());

function name(c: MConversation) {
  return c.groupName || c.contact?.crmName || c.contact?.fullName || 'Khách hàng';
}
function isGroup(c: MConversation): boolean {
  return c.threadType === 'group';
}
function avatarUrl(c: MConversation): string | null {
  if (isGroup(c)) return c.groupAvatarUrl || c.contact?.avatarUrl || null;
  return c.contact?.avatarUrl || null;
}
function markAvatarFailed(convId: string, src: string) {
  imgFailed.add(`${convId}:${src}`);
}
function groupAvatarUrls(c: MConversation): string[] {
  if (!isGroup(c)) return [];
  const urls = (c.groupMemberAvatars ?? [])
    .map((m) => m.avatarUrl)
    .filter((src): src is string => !!src && !imgFailed.has(`${c.id}:${src}`));
  return [...new Set(urls)].slice(0, 3);
}
function usesGroupCollage(c: MConversation): boolean {
  return isGroup(c) && !avatarUrl(c) && groupAvatarUrls(c).length >= 2;
}
function extraGroupCount(c: MConversation): number {
  const count = c.groupMembersCount ?? 0;
  const visible = groupAvatarUrls(c).length;
  return count > visible ? count - visible : 0;
}
function groupAvatarCellCount(c: MConversation): number {
  return groupAvatarUrls(c).length + (extraGroupCount(c) > 0 ? 1 : 0);
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
function isPinned(c: MConversation): boolean {
  return c.userState?.isPinned === true;
}
function isManualUnread(c: MConversation): boolean {
  return c.userState?.isManualUnread === true;
}

const actionConv = ref<MConversation | null>(null);
const actionBusy = ref(false);
const tagSheet = ref(false);
const tagOptions = ref<string[]>([]);
function openActions(c: MConversation) { actionConv.value = c; }
function closeActions() { if (!actionBusy.value) actionConv.value = null; }
async function togglePin() {
  const c = actionConv.value;
  if (!c || actionBusy.value) return;
  actionBusy.value = true;
  try { await setPinned(c.id, !isPinned(c)); closeActions(); }
  finally { actionBusy.value = false; }
}
async function toggleUnread() {
  const c = actionConv.value;
  if (!c || actionBusy.value) return;
  actionBusy.value = true;
  try { await setManualUnread(c.id, !isManualUnread(c)); closeActions(); }
  finally { actionBusy.value = false; }
}

function open(c: MConversation) {
  saveScrollPosition();
  markRead(c.id);
  router.push({ name: 'M.Chat', params: { convId: c.id } });
}

// ── Tìm kiếm (debounce) ──
let searchTimer: ReturnType<typeof setTimeout>;
function onSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { resetScrollPosition(); void load(); }, 350);
}
function setUnread(v: boolean) {
  if (unreadOnly.value === v) return;
  unreadOnly.value = v;
  resetScrollPosition();
  void load();
}
function setUnreplied(v: boolean) {
  if (unrepliedOnly.value === v) return;
  unrepliedOnly.value = v;
  resetScrollPosition();
  void load();
}
async function openTagFilter() {
  tagSheet.value = true;
  if (tagOptions.value.length) return;
  try {
    const { data } = await api.get('/conversations/sidebar-tags');
    const crm = Array.isArray(data.crmTags) ? data.crmTags : [];
    const zalo = Array.isArray(data.zaloTags) ? data.zaloTags.map((t: any) => t?.name).filter(Boolean) : [];
    tagOptions.value = [...new Set([...crm, ...zalo])].slice(0, 80);
  } catch {
    tagOptions.value = [];
  }
}
function setTagFilter(tag: string) {
  tagFilter.value = tag;
  tagSheet.value = false;
  resetScrollPosition();
  void load();
}

// ── Infinite scroll ──
const scroller = ref<HTMLElement | null>(null);
const SCROLL_POSITION_KEY = 'zalocrm:mobile-conversations-scroll-top';
const pendingRealtimeMoves = new Set<string>();
let pendingRealtimeAnchor: ReturnType<typeof captureConversationScrollAnchor> = null;
let scrollAnchorRestoreQueued = false;

function savedScrollTop(): number {
  const value = Number(sessionStorage.getItem(SCROLL_POSITION_KEY) ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function saveScrollPosition() {
  const top = scroller.value?.scrollTop ?? 0;
  sessionStorage.setItem(SCROLL_POSITION_KEY, String(top));
}
function resetScrollPosition() {
  sessionStorage.removeItem(SCROLL_POSITION_KEY);
  scroller.value?.scrollTo({ top: 0, behavior: 'auto' });
}
function restoreScrollPosition() {
  const top = savedScrollTop();
  if (!top) return;
  void nextTick(() => {
    requestAnimationFrame(() => {
      const el = scroller.value;
      if (el) el.scrollTop = Math.min(top, Math.max(0, el.scrollHeight - el.clientHeight));
    });
  });
}
function onScroll() {
  const el = scroller.value;
  if (!el) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) void loadMore();
}

// ── Pull to refresh (chỉ khi đang ở đỉnh danh sách) ──
const PULL_THRESHOLD = 64;
const pullY = ref(0);
let startY = 0;
let startX = 0;
let pulling = false;
function onTouchStart(e: TouchEvent) {
  const el = scroller.value;
  pulling = !!el && el.scrollTop <= 0;
  startY = e.touches[0].clientY; startX = e.touches[0].clientX;
}
function onTouchMove(e: TouchEvent) {
  if (!pulling) return;
  const touch = e.touches[0];
  const dx = touch.clientX - startX;
  const dy = touch.clientY - startY;
  if (Math.abs(dx) > Math.abs(dy)) {
    pulling = false;
    pullY.value = 0;
    return;
  }
  pullY.value = dy > 0 ? Math.min(dy * 0.5, 90) : 0;
  if (pullY.value > 0) e.preventDefault();
}
async function onTouchEnd() {
  if (pullY.value > PULL_THRESHOLD) await load();
  pullY.value = 0;
  pulling = false;
}

// ── Realtime: tin mới → cập nhật preview/badge/thứ tự ──
function onSocketMessage(payload: { conversationId: string; message: Record<string, unknown>; systemNotification?: boolean }) {
  pendingRealtimeMoves.add(payload.conversationId);
  pendingRealtimeAnchor = captureConversationScrollAnchor(scroller.value, pendingRealtimeMoves)
    ?? pendingRealtimeAnchor;
  applyIncoming(payload, null); // ở màn danh sách thì không có hội thoại nào đang mở
  if (!pendingRealtimeAnchor || scrollAnchorRestoreQueued) return;
  scrollAnchorRestoreQueued = true;
  void nextTick(() => {
    requestAnimationFrame(() => {
      const anchor = pendingRealtimeAnchor;
      pendingRealtimeAnchor = null;
      pendingRealtimeMoves.clear();
      scrollAnchorRestoreQueued = false;
      if (!anchor) return;
      const fallbackIndex = displayItems.value.findIndex((item) => item.id === anchor.conversationId);
      restoreConversationScrollAnchor(scroller.value, anchor, fallbackIndex);
    });
  });
}
function onGroupInfoUpdated(payload: { conversationId: string; groupMemberAvatars?: MConversation['groupMemberAvatars'] }) {
  if (!payload.groupMemberAvatars) return;
  const conversation = items.value.find((item) => item.id === payload.conversationId);
  if (conversation) conversation.groupMemberAvatars = payload.groupMemberAvatars;
}
// Mở 1 chat → MChatView phát 'mobile:conv-read' → xoá badge chưa đọc NGAY (không đợi refresh).
function onConvRead(e: Event) {
  const id = (e as CustomEvent).detail;
  if (typeof id === 'string') markRead(id);
}
onMounted(async () => {
  await load();
  restoreScrollPosition();
  getSocket()?.on('chat:message', onSocketMessage);
  getSocket()?.on('chat:group-info-updated', onGroupInfoUpdated);
  window.addEventListener('mobile:conv-read', onConvRead);
});
onActivated(restoreScrollPosition);
onDeactivated(saveScrollPosition);
onUnmounted(() => {
  saveScrollPosition();
  getSocket()?.off('chat:message', onSocketMessage);
  getSocket()?.off('chat:group-info-updated', onGroupInfoUpdated);
  window.removeEventListener('mobile:conv-read', onConvRead);
});
</script>

<style scoped>
.mc-wrap { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--m-surface); }
/* FAB soạn tin mới — nổi trên danh sách, ngay trên thanh nav dưới. */
.mc-fab {
  position: absolute; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  width: 54px; height: 54px; border-radius: 50%; border: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--m-brand); color: var(--m-brand-ink);
  box-shadow: 0 6px 18px rgba(41, 98, 255, 0.4); cursor: pointer; z-index: 20;
  transition: transform 0.12s ease;
}
.mc-fab:active { transform: scale(0.92); }
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
.mc-filters { display: flex; gap: var(--m-sp-2); margin-top: var(--m-sp-2); overflow-x: auto; padding-bottom: 2px; }
.mc-chip {
  border: 0; background: var(--m-surface-2); color: var(--m-text-2);
  border-radius: var(--m-r-full); padding: 7px 15px; font-size: var(--m-fs-sm); font-weight: var(--m-fw-semibold);
  cursor: pointer; transition: background var(--m-dur-fast) var(--m-ease), color var(--m-dur-fast) var(--m-ease);
}
.mc-chip:active { transform: scale(0.96); }
.mc-chip.on { background: var(--m-brand); color: var(--m-brand-ink); }

.mc-list { flex: 1; min-height: 0; overflow-y: auto; overflow-anchor: none; -webkit-overflow-scrolling: touch; padding-bottom: env(safe-area-inset-bottom, 0px); }
.mc-pull { display: flex; align-items: center; justify-content: center; font-size: var(--m-fs-xs); color: var(--m-text-2); }
.mc-state { display: flex; flex-direction: column; align-items: center; gap: var(--m-sp-3); padding: 56px var(--m-sp-6); text-align: center; color: var(--m-text-2); }
.mc-state p { font-size: var(--m-fs-md); margin: 0; }
.mc-state.mc-err button { border: 0; background: var(--m-brand); color: var(--m-brand-ink); border-radius: var(--m-r-sm); padding: 8px 18px; font-weight: var(--m-fw-semibold); }
.mc-end { padding: var(--m-sp-4); text-align: center; font-size: var(--m-fs-xs); color: var(--m-text-3); }

.mc-row {
  display: flex; gap: var(--m-sp-3); width: 100%; text-align: left;
  padding: 13px var(--m-sp-4); border: 0; background: none; cursor: pointer;
  min-height: 78px; align-items: center;
  /* Skip paint/layout work for rows well outside the mobile viewport. */
  content-visibility: auto;
  contain-intrinsic-size: auto 80px;
  transition: background var(--m-dur-fast) var(--m-ease);
}
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
.mc-avatar--group { background: var(--m-surface); display: grid; overflow: hidden; gap: 1.5px; }
.mc-group-img {
  width: 100%; height: 100%; border-radius: 0; object-fit: cover; background: var(--m-surface-2);
}
.mc-avatar--group-2 { grid-template-columns: 1fr 1fr; }
.mc-avatar--group-3 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
.mc-avatar--group-3 .mc-group-img:first-child { grid-row: 1 / span 2; }
.mc-avatar--group-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
.mc-group-extra {
  display: flex; align-items: center; justify-content: center;
  background: #eef2f7; color: var(--m-text-2);
  font-size: 11px; font-weight: var(--m-fw-semibold);
}
.mc-group-icon { position: absolute; width: 16px; height: 16px; top: -1px; right: -2px; fill: #64748b; }
.mc-group-title-icon { flex-shrink: 0; color: #64748b; }
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
/* Tin đã thu hồi — chỉ LÀM NHẠT (không gạch ngang, không in nghiêng) cho dễ đọc. */
.mc-prev.is-recalled { color: var(--m-text-3); }
.mc-badge { flex-shrink: 0; }
/* Chưa đọc: tên đậm + preview đậm hơn (phân tầng rõ) */
.mc-row.unread .mc-name { font-weight: var(--m-fw-bold); }
.mc-row.unread .mc-prev { color: var(--m-text); font-weight: var(--m-fw-medium); }
.mc-meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 1px; }

.mc-row.pinned { background: color-mix(in srgb, var(--m-brand) 5%, var(--m-surface)); }
.mc-name { display: inline-flex; align-items: center; gap: 4px; }
.mc-pin { flex-shrink: 0; color: var(--m-brand); }
.mc-more {
  width: 38px; height: 38px; border: 0; border-radius: var(--m-r-full); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; background: transparent; color: var(--m-text-3);
}
.mc-more:active { background: var(--m-surface-2); color: var(--m-text); }
.mc-row.unread .mc-more { color: var(--m-brand); }
.mc-action-backdrop {
  position: absolute; inset: 0; z-index: 40; display: flex; align-items: flex-end;
  background: rgba(15, 23, 42, 0.26);
}
.mc-action-sheet {
  width: 100%; background: var(--m-surface); border-radius: 18px 18px 0 0;
  padding: 8px var(--m-sp-4) calc(var(--m-sp-4) + env(safe-area-inset-bottom, 0px));
  box-shadow: 0 -14px 32px rgba(15, 23, 42, 0.18);
}
.mc-action-grip { width: 42px; height: 4px; border-radius: 999px; background: var(--m-border-strong); margin: 2px auto 12px; }
.mc-action-title { font-size: var(--m-fs-sm); font-weight: var(--m-fw-bold); color: var(--m-text); padding: 0 2px 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-action-row {
  width: 100%; min-height: 48px; border: 0; background: transparent; border-top: 1px solid var(--m-border);
  display: flex; align-items: center; gap: var(--m-sp-3); color: var(--m-text); font-size: var(--m-fs-md); text-align: left;
}
.mc-action-row svg { color: var(--m-brand); flex-shrink: 0; }
.mc-action-row:disabled { opacity: .55; }
</style>



