<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- MobileShell — khung ngoài cho PWA Mobile (/m).
     Chịu trách nhiệm: khởi tạo socket MỘT LẦN, banner offline, safe-area iOS. -->
<template>
  <div class="ms-root m-scope">
    <div v-if="!isOnline" class="ms-offline">
      <span class="ms-dot" /> Mất kết nối mạng — đang thử lại…
    </div>
    <div v-else-if="realtimeOffline" class="ms-offline ms-warn">
      <span class="ms-dot" /> Mất kết nối realtime — đang kết nối lại…
    </div>

    <div class="ms-body">
      <router-view v-slot="{ Component }">
        <keep-alive include="MConversationsView">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </div>

    <!-- Bottom navigation — ẩn ở màn chat chi tiết (/m/c/:id) để dành toàn màn cho khung chat. -->
    <nav v-if="showBottomNav" class="ms-tabbar">
      <button
        v-for="t in TABS"
        :key="t.path"
        class="ms-tab"
        :class="{ on: isActive(t) }"
        @click="go(t.path)"
      >
        <component :is="t.icon" :size="23" :stroke-width="isActive(t) ? 2.4 : 1.9" />
        <span class="ms-tab-label">{{ t.label }}</span>
      </button>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  MessageCircle as MessageCircleIcon, Users as UsersIcon,
  CalendarClock as CalendarClockIcon, LayoutDashboard as DashboardIcon, Settings as SettingsIcon,
} from 'lucide-vue-next';
import { useChat } from '@/composables/use-chat';
import { useMobile } from '@/composables/use-mobile';

const { isOnline } = useMobile();
// Tái dùng socket + realtime của hệ thống hiện có, KHÔNG dựng kênh riêng.
const { initSocket, destroySocket, realtimeOffline } = useChat();

const route = useRoute();
const router = useRouter();

// Tin nhắn ở /m (bộ mobile chuyên dụng). Các tab khác chưa có bản /m → về route desktop
// (render trong MobileLayout responsive) cho tới khi có bản /m riêng.
// Tab đã có bản /m chuyên dụng → route /m/*; tab chưa có → tạm về route desktop (MobileLayout).
// 4 tab đều có bản /m chuyên dụng (2026-07-12).
const TABS = [
  { label: 'Tin nhắn', icon: MessageCircleIcon, path: '/m' },
  { label: 'Khách hàng', icon: UsersIcon, path: '/m/customers' },
  { label: 'Lịch hẹn', icon: CalendarClockIcon, path: '/m/appointments' },
  { label: 'Tổng quan', icon: DashboardIcon, path: '/m/overview' },
  { label: 'Cài đặt', icon: SettingsIcon, path: '/m/settings' },
];
function isActive(t: { path: string }) {
  if (t.path === '/m') return route.path === '/m' || route.path.startsWith('/m/c');
  return route.path.startsWith(t.path);
}
function go(path: string) { if (path !== route.path) router.push(path); }
// Ẩn tab bar ở màn chi tiết (chat / hồ sơ KH / chi tiết lịch hẹn) — toàn màn cho nội dung.
const DETAIL_RE = /^\/m\/(c\/|compose|customers\/[^/]+|appointments\/[^/]+)/;
const showBottomNav = computed(() => !DETAIL_RE.test(route.path));

// Dựng socket NGAY trong setup (đồng bộ) — KHÔNG đợi onMounted. Vì onMounted của con
// (MChatView) chạy TRƯỚC cha; nếu F5 thẳng vào /m/c/:id mà socket chưa có thì con
// registerSocketListeners(null) → mất realtime reactions/typing. Dựng ở setup đảm bảo
// getSocket() đã sống trước khi bất kỳ view con nào mount.
initSocket();
onUnmounted(() => destroySocket());
</script>

<style scoped>
.ms-root {
  /* Neo theo VIEWPORT thật (position:fixed inset:0) thay vì height:100dvh —
     đảm bảo footer nhập KHÔNG rớt khỏi màn hình khi có URL bar / safe-area, và với
     interactive-widget=resizes-content thì bàn phím đẩy nội dung lên (input luôn thấy). */
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--m-bg);
  /* Safe-area TRÊN/DƯỚI xử lý trong từng header/footer (để nền chạm mép, blur đẹp).
     TRÁI/PHẢI xử lý ở đây: khi XOAY NGANG, notch/Dynamic Island sang cạnh bên → chèn lề
     để nội dung không chui xuống dưới tai thỏ. Portrait: insets = 0, không tạo lề thừa. */
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
  overflow: hidden;
}
.ms-offline {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 7px 12px; font-size: 12.5px; font-weight: 600;
  background: #fee2e2; color: #991b1b; flex-shrink: 0;
}
.ms-offline.ms-warn { background: #fef3c7; color: #92400e; }
.ms-dot {
  width: 8px; height: 8px; border-radius: 50%; background: currentColor;
  animation: ms-pulse 1.2s ease-in-out infinite;
}
@keyframes ms-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }

/* Body giữa banner và tab bar — view con (MConversationsView/MChatView) fill 100% */
.ms-body { flex: 1; min-height: 0; min-width: 0; width: 100%; overflow: hidden; display: flex; flex-direction: column; overscroll-behavior: none; touch-action: pan-y; }
.ms-body > * { flex: 1; min-height: 0; min-width: 0; max-width: 100%; }

/* ── Bottom navigation (design system) ── */
.ms-tabbar {
  flex-shrink: 0;
  display: flex;
  background: color-mix(in srgb, var(--m-surface) 92%, transparent);
  backdrop-filter: saturate(1.4) blur(12px);
  -webkit-backdrop-filter: saturate(1.4) blur(12px);
  border-top: 1px solid var(--m-border);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  box-shadow: var(--m-e-up);
}
.ms-tab {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  min-height: 54px; border: 0; background: transparent; cursor: pointer;
  color: var(--m-text-3);
  transition: color var(--m-dur-fast) var(--m-ease), transform var(--m-dur-fast) var(--m-ease);
}
.ms-tab:active { transform: scale(0.92); }
.ms-tab.on { color: var(--m-brand); }
.ms-tab-label { font-size: 10.5px; font-weight: var(--m-fw-semibold); line-height: 1; }
</style>
