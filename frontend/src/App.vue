<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <component :is="layout">
    <router-view />
  </component>
  <MessageNotifications v-if="auth.isAuthenticated" />
  <!-- 2026-06-16 — hộp xác nhận HS theme global (thay window.confirm toàn app) -->
  <ConfirmHost />
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import DefaultLayout from '@/layouts/DefaultLayout.vue';
import AuthLayout from '@/layouts/AuthLayout.vue';
import MobileLayout from '@/layouts/MobileLayout.vue';
import BlankLayout from '@/layouts/BlankLayout.vue';
import ConfirmHost from '@/components/ui/ConfirmHost.vue';
import MessageNotifications from '@/components/MessageNotifications.vue';
import { useMobile } from '@/composables/use-mobile';
import { useMessageNotifications } from '@/composables/use-message-notifications';
import { useAuthStore } from '@/stores/auth';
import { usePrivacyStore } from '@/stores/privacy';
import { desktopBridge } from '@/composables/desktop-bridge';
import { onBeforeUnmount } from 'vue';
import { useDesktopUnread } from '@/composables/use-desktop-unread';
import { useDesktopRelease } from '@/composables/use-desktop-release';

const route = useRoute();
const { isMobile } = useMobile();
const auth = useAuthStore();
const privacy = usePrivacyStore();
const messageNotifications = useMessageNotifications();

const layout = computed(() => {
  const name = (route.meta?.layout as string) || 'default';
  if (name === 'auth') return AuthLayout;
  if (name === 'blank') return BlankLayout;
  // Route /m tự quản chrome (MobileShell: header + bottom-nav + safe-area) → không bọc
  // MobileLayout/DefaultLayout để tránh 2 lớp header/nav (2026-07-11, hướng "dùng bộ /m").
  if (route.path === '/m' || route.path.startsWith('/m/')) return BlankLayout;
  return isMobile.value ? MobileLayout : DefaultLayout;
});

watch(
  () => auth.isAuthenticated,
  (isAuthenticated) => {
    if (isAuthenticated) messageNotifications.start();
    else messageNotifications.stop();
  },
  { immediate: true },
);

// Anh chốt 2026-05-22: sau F5 refresh, gọi privacyStore.fetchStatus() để rebuild
// isUnlocked + expiresAt từ HttpOnly cookie. Trước fix: cookie vẫn còn ở browser
// nhưng FE state mặc định isUnlocked=false → bubble blur vẫn hiện → click → bắt
// nhập PIN lại dù session vẫn alive.
watch(
  () => auth.user?.id,
  (uid) => { if (uid) privacy.fetchStatus(true).catch(() => {}); },
  { immediate: true },
);

const desktop = desktopBridge();
const desktopOwner = computed(() => auth.isAuthenticated ? `${auth.user!.orgId}:${auth.user!.id}` : '');
const desktopRelease = useDesktopRelease();
watch(desktopOwner, (value) => {
  if (value) desktopRelease.start(value);
  else desktopRelease.stop();
}, { immediate: true });
if (desktop) {
  watch(desktopOwner, () => {
    if (desktop.role === 'main') {
      messageNotifications.stop();
      desktop.setIdentity(auth.isAuthenticated ? { userId: auth.user!.id, orgId: auth.user!.orgId } : null);
      if (auth.isAuthenticated) messageNotifications.start();
    }
  }, { immediate: true });
  // Electron windows share the CRM session but have independent Vue stores.
  const onTokenChange = (event: StorageEvent) => {
    if (event.key !== 'token') return;
    auth.token = event.newValue ?? '';
    if (!event.newValue) { auth.user = null; void window.location.reload(); }
    else void auth.fetchProfile();
  };
  window.addEventListener('storage', onTokenChange);
  onBeforeUnmount(() => window.removeEventListener('storage', onTokenChange));
}
useDesktopUnread(desktopOwner, messageNotifications.enabled);
</script>
