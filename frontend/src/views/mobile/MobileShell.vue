<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- MobileShell — khung ngoài cho PWA Mobile (/m).
     Chịu trách nhiệm: khởi tạo socket MỘT LẦN, banner offline, safe-area iOS. -->
<template>
  <div class="ms-root">
    <div v-if="!isOnline" class="ms-offline">
      <span class="ms-dot" /> Mất kết nối mạng — đang thử lại…
    </div>
    <div v-else-if="realtimeOffline" class="ms-offline ms-warn">
      <span class="ms-dot" /> Mất kết nối realtime — đang kết nối lại…
    </div>

    <router-view v-slot="{ Component }">
      <keep-alive include="MConversationsView">
        <component :is="Component" />
      </keep-alive>
    </router-view>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useChat } from '@/composables/use-chat';
import { useMobile } from '@/composables/use-mobile';

const { isOnline } = useMobile();
// Tái dùng socket + realtime của hệ thống hiện có, KHÔNG dựng kênh riêng.
const { initSocket, destroySocket, realtimeOffline } = useChat();

onMounted(() => initSocket());
onUnmounted(() => destroySocket());
</script>

<style scoped>
.ms-root {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--smax-grey-100, #f5f6fa);
  /* Tai thỏ / thanh home iOS */
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
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
</style>
