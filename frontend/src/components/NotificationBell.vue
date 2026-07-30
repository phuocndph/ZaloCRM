<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <!-- 2026-06-09 (anh báo menu bar kẹt): v-model để đóng chủ động khi click thông báo
       → điều hướng. Trước đây close-on-content-click=false + không đóng trong handleClick
       làm menu (z-index 2000) kẹt mở phủ nav, nuốt click. -->
  <v-menu v-model="bellMenu" offset-y :close-on-content-click="false" max-width="420">
    <template #activator="{ props: menuProps }">
      <v-btn
        icon variant="text" v-bind="menuProps" class="mr-1"
        :title="notifications.length ? `${notifications.length} thông báo cần xem` : 'Không có thông báo mới'"
        aria-label="Mở thông báo"
      >
        <v-badge
          :content="notifications.length"
          :model-value="notifications.length > 0"
          color="error"
          overlap
        >
          <v-icon>mdi-bell-outline</v-icon>
        </v-badge>
      </v-btn>
    </template>
    <v-card class="notification-card">
      <v-card-title class="notification-heading">
        <span>Thông báo</span>
        <span v-if="zaloOutCount" class="zalo-out-summary">{{ zaloOutCount }} nick cần kết nối lại</span>
      </v-card-title>
      <v-divider />
      <v-list density="compact" v-if="notifications.length > 0">
        <v-list-item
          v-for="n in notifications"
          :key="n.id"
          @click="handleClick(n)"
          class="notification-item py-2"
          :class="{ 'zalo-out-item': isZaloAccountOut(n) }"
        >
          <template #prepend>
            <v-icon
              :color="n.type === 'error' ? 'red' : n.type === 'warning' ? 'orange' : 'blue'"
              size="20"
            >
              {{ n.type === 'error' ? 'mdi-alert-circle' : n.type === 'warning' ? 'mdi-alert' : 'mdi-information' }}
            </v-icon>
          </template>
          <v-list-item-title class="notification-title">{{ n.title }}</v-list-item-title>
          <v-list-item-subtitle class="notification-detail">{{ n.detail }}</v-list-item-subtitle>
          <template v-if="isZaloAccountOut(n)" #append>
            <button type="button" class="reconnect-link" @click.stop="handleClick(n)">
              {{ n.actionLabel || 'Kết nối lại' }}
            </button>
          </template>
        </v-list-item>
      </v-list>
      <div v-else class="pa-4 text-center text-caption text-grey">Không có thông báo</div>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useZaloAccountAlerts } from '@/composables/use-zalo-account-alerts';
import {
  isZaloAccountOut,
  type AccountAlertNotification,
} from '@/composables/zalo-account-alert-rules';

const router = useRouter();
const bellMenu = ref(false); // 2026-06-09 — điều khiển đóng menu chủ động
const accountAlerts = useZaloAccountAlerts();
const notifications = accountAlerts.notifications;
const zaloOutCount = computed(() => notifications.value.filter(isZaloAccountOut).length);

function handleClick(n: AccountAlertNotification) {
  bellMenu.value = false; // đóng menu TRƯỚC khi điều hướng → tránh overlay kẹt phủ nav
  if (n.actionUrl) router.push(n.actionUrl);
  else if (n.id === 'unreplied') router.push('/chat');
  else if (n.id.startsWith('apt-')) router.push('/appointments');
  else if (n.id.startsWith('zalo-')) router.push('/settings/channels/zalo');
  else if (n.id === 'tmr-apts') router.push('/appointments');
}

watch(bellMenu, (open) => {
  if (open) void accountAlerts.refresh(false);
});

onMounted(() => accountAlerts.start());
onUnmounted(() => accountAlerts.stop());
</script>

<style scoped>
.notification-card { max-height: min(520px, 80vh); overflow-y: auto; min-width: min(410px, calc(100vw - 24px)); }
.notification-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; font-size: 15px; font-weight: 800; }
.zalo-out-summary { padding: 4px 8px; border-radius: 999px; color: #b42318; background: #fee4e2; font-size: 11px; font-weight: 700; white-space: nowrap; }
.notification-item { min-height: 64px; cursor: pointer; }
.zalo-out-item { background: linear-gradient(90deg, rgba(254, 228, 226, 0.72), transparent); }
.notification-title { color: var(--smax-grey-900, #101828); font-size: 13px; font-weight: 700; line-height: 1.35; white-space: normal; }
.notification-detail { margin-top: 3px; color: var(--smax-grey-600, #475467); font-size: 12px; line-height: 1.4; white-space: normal; }
.reconnect-link { margin-left: 10px; padding: 6px 9px; border: 1px solid #f04438; border-radius: 7px; color: #b42318; background: #fff; font-size: 11px; font-weight: 800; cursor: pointer; white-space: nowrap; }
.reconnect-link:hover { color: #fff; background: #d92d20; }

@media (max-width: 600px) {
  .notification-card { min-width: calc(100vw - 20px); }
  .notification-heading { padding: 12px; }
  .reconnect-link { padding: 6px 7px; }
}
</style>
