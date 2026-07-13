<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- NotificationSettingsPage — bật/tắt thông báo tin nhắn nổi (desktop, giống Zalo). -->
<template>
  <div class="noti-settings">
    <div class="ns-head">
      <div class="ns-ico">🔔</div>
      <div>
        <div class="ns-h1">Thông báo tin nhắn</div>
        <div class="ns-sub">Hiện thẻ nổi khi có tin nhắn mới — kể cả khi bạn đang ở trang khác trong CRM.</div>
      </div>
    </div>

    <v-card class="ns-card" flat border>
      <div class="ns-row">
        <div class="ns-row-text">
          <div class="ns-row-title">Bật thông báo nổi</div>
          <div class="ns-row-desc">
            Thẻ thông báo trượt ra góc dưới-phải khi khách nhắn tới. Bấm để mở hội thoại.
          </div>
        </div>
        <v-switch
          :model-value="notify.enabled.value"
          color="primary" hide-details density="compact" inset
          :loading="busy"
          @update:model-value="onToggle"
        />
      </div>

      <v-divider />

      <div class="ns-row" :class="{ 'ns-row--off': !notify.enabled.value }">
        <div class="ns-row-text">
          <div class="ns-row-title">Âm báo</div>
          <div class="ns-row-desc">Phát tiếng “ting” nhẹ khi có tin mới.</div>
        </div>
        <v-switch
          :model-value="notify.soundEnabled.value"
          color="primary" hide-details density="compact" inset
          :disabled="!notify.enabled.value"
          @update:model-value="(v: boolean | null) => notify.setSound(!!v)"
        />
      </div>

      <v-divider />

      <div class="ns-row ns-row--static">
        <div class="ns-row-text">
          <div class="ns-row-title">Thông báo ngoài màn hình (hệ điều hành)</div>
          <div class="ns-row-desc">
            Khi cửa sổ CRM ở nền, hiện thông báo của trình duyệt/Windows.
          </div>
        </div>
        <span class="ns-badge" :class="permBadge.cls">{{ permBadge.label }}</span>
      </div>
    </v-card>

    <p v-if="hint" class="ns-hint">{{ hint }}</p>

    <v-btn class="ns-test" variant="tonal" color="primary" size="small" prepend-icon="mdi-bell-ring-outline" @click="sendTest">
      Gửi thử một thông báo
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useMessageNotifications } from '@/composables/use-message-notifications';

const notify = useMessageNotifications();
const busy = ref(false);
const hint = ref('');

const permBadge = computed(() => {
  if (!notify.nativeSupported) return { label: 'Không hỗ trợ', cls: 'is-off' };
  if (notify.permission.value === 'granted') return { label: 'Đã cho phép', cls: 'is-on' };
  if (notify.permission.value === 'denied') return { label: 'Bị chặn', cls: 'is-off' };
  return { label: 'Chưa cấp quyền', cls: 'is-warn' };
});

async function onToggle(v: boolean | null) {
  hint.value = '';
  if (v) {
    busy.value = true;
    try {
      const r = await notify.enable();
      if (r.error) hint.value = r.error;
    } finally { busy.value = false; }
  } else {
    notify.disable();
  }
}

function sendTest() {
  // Đẩy 1 thẻ mẫu để xem giao diện + kiểm tra âm báo/quyền.
  (notify.cards.value as any[]).unshift({
    id: `test-${Date.now()}`,
    convId: '',
    accountId: null,
    name: 'Thông báo thử',
    preview: 'Đây là thông báo mẫu — bấm để xem giao diện thẻ nổi.',
    avatarUrl: null,
    at: Date.now(),
  });
  setTimeout(() => {
    notify.cards.value = (notify.cards.value as any[]).filter((c) => !String(c.id).startsWith('test-'));
  }, 5000);
}
</script>

<style scoped>
.noti-settings { max-width: 720px; padding: 20px; }
.ns-head { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
.ns-ico { font-size: 28px; }
.ns-h1 { font-size: 20px; font-weight: 700; color: var(--smax-grey-900, #0f172a); }
.ns-sub { font-size: 13px; color: var(--smax-grey-600, #64748b); margin-top: 2px; }

.ns-card { border-radius: 14px; overflow: hidden; }
.ns-row { display: flex; align-items: center; gap: 16px; padding: 16px 18px; }
.ns-row-text { flex: 1; min-width: 0; }
.ns-row-title { font-size: 14px; font-weight: 600; color: var(--smax-grey-900, #0f172a); }
.ns-row-desc { font-size: 12.5px; color: var(--smax-grey-600, #64748b); margin-top: 3px; line-height: 1.45; }
.ns-row--off { opacity: 0.55; }

.ns-badge { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
.ns-badge.is-on { background: #dcfce7; color: #15803d; }
.ns-badge.is-warn { background: #fef9c3; color: #a16207; }
.ns-badge.is-off { background: #fee2e2; color: #b91c1c; }

.ns-hint { margin: 12px 2px 0; font-size: 12.5px; color: #a16207; }
.ns-test { margin-top: 16px; }
</style>
