<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  MobileLayout — shell mobile bọc các view desktop (ChatView, Contacts, …) + bottom nav.

  Layout do CSS FLEX kiểm soát (KHÔNG dùng v-app-bar/v-main auto-layout của Vuetify) vì:
   • v-app-bar không tự né status bar/notch (safe-area-inset-top) → header bị che.
   • v-main tính chiều cao theo min-height, không bound → ChatView (cao 100vh-topnav) tràn
     xuống dưới bottom nav → MẤT ô nhập chat.
  Shell neo position:fixed inset:0 (viewport thật). App-bar né notch; body bound flex:1 và
  chừa chỗ bottom nav; view chat được ép height:100% để ô nhập luôn nằm trong vùng thấy được.
  Giữ <v-app> để có theme context + <v-btn>/<v-icon>/BottomNav vẫn hoạt động.
-->
<template>
  <v-app>
    <div class="mlx">
      <OfflineIndicator />

      <!-- App bar — né status bar/notch bằng safe-area-inset-top -->
      <header class="mlx-bar">
        <div class="mlx-brand">
          <div class="mlx-logo"><v-icon size="16" color="white">mdi-robot</v-icon></div>
          <span class="mlx-brand-name">CRM</span>
        </div>
        <div class="mlx-actions">
          <NotificationBell />
          <v-btn icon size="small" variant="text" @click="toggleTheme">
            <v-icon size="20">{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
          </v-btn>
          <v-btn icon size="small" variant="text" @click="logout">
            <v-icon size="20">mdi-logout</v-icon>
          </v-btn>
        </div>
      </header>

      <!-- Body: bound flex + cuộn nội bộ. ChatView fill 100% (không tự cuộn → ô nhập pin đáy);
           trang danh sách (Contacts…) cao hơn → body tự cuộn. Chừa chỗ cho bottom nav. -->
      <main class="mlx-body">
        <slot />
      </main>

      <BottomNav />
    </div>
  </v-app>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useTheme } from 'vuetify';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import NotificationBell from '@/components/NotificationBell.vue';
import BottomNav from '@/components/BottomNav.vue';
import OfflineIndicator from '@/components/OfflineIndicator.vue';

const theme = useTheme();
const authStore = useAuthStore();
const router = useRouter();
const isDark = ref(localStorage.getItem('theme') !== 'light');

onMounted(() => {
  theme.global.name.value = isDark.value ? 'dark' : 'light';
});

function toggleTheme() {
  isDark.value = !isDark.value;
  theme.global.name.value = isDark.value ? 'dark' : 'light';
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
}

function logout() {
  authStore.logout();
  router.push('/login');
}
</script>

<style scoped>
/* Chiều cao app-bar (chưa gồm safe-area) + bottom nav — dùng lại cho tính toán. */
.mlx {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* Safe-area trái/phải (xoay ngang, notch sang cạnh) */
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
  background: rgb(var(--v-theme-background, 255, 255, 255));
}

/* ── App bar — né status bar/notch: padding-top = safe-area (env trực tiếp có fallback) ── */
.mlx-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px 0 12px;
  padding-top: env(safe-area-inset-top, 0px);
  min-height: calc(52px + env(safe-area-inset-top, 0px));
  background: rgb(var(--v-theme-surface, 31, 31, 31));
  border-bottom: 1px solid rgba(128, 128, 128, 0.18);
  position: relative;
  z-index: 30;
}
.mlx-brand { display: flex; align-items: center; gap: 8px; }
.mlx-logo {
  width: 28px; height: 28px; border-radius: 8px;
  background: linear-gradient(135deg, #00f2ff, #0077b6);
  display: flex; align-items: center; justify-content: center;
}
.mlx-brand-name { font-weight: 700; font-size: 16px; color: #00f2ff; }
.mlx-actions { display: flex; align-items: center; gap: 2px; }

/* ── Body — bound, cuộn nội bộ, chừa chỗ bottom nav (56px) + safe-area đáy ── */
.mlx-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px));
}

/* View chat desktop (ChatView) — ép fill đúng vùng body thay vì tự tính 100vh (gây tràn,
   mất ô nhập). height:100% = body content-box (đã trừ bottom nav) → ô nhập luôn thấy được. */
.mlx-body :deep(.smax-chat-grid) {
  height: 100%;
  min-height: 0;
}
</style>
