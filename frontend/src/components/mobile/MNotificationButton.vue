<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <button class="m-iconbtn mnb" aria-label="Mở thông báo" @click="router.push({ name: 'M.Notifications' })">
    <BellIcon :size="22" :stroke-width="1.9" />
    <span v-if="inbox.unreadCount.value" class="mnb-badge">
      {{ inbox.unreadCount.value > 99 ? '99+' : inbox.unreadCount.value }}
    </span>
  </button>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { Bell as BellIcon } from 'lucide-vue-next';
import { useMessageNotificationInbox } from '@/composables/use-message-notification-inbox';

const router = useRouter();
const inbox = useMessageNotificationInbox();
</script>

<style scoped>
.mnb { position: relative; color: var(--m-text-2); flex-shrink: 0; }
.mnb-badge {
  position: absolute; top: 2px; right: 0; min-width: 17px; height: 17px; padding: 0 4px;
  border: 2px solid var(--m-surface); border-radius: var(--m-r-full); background: var(--m-danger);
  color: #fff; display: inline-flex; align-items: center; justify-content: center;
  font-size: 9px; line-height: 1; font-weight: var(--m-fw-bold);
}
</style>
