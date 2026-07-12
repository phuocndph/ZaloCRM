<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- MState — trạng thái rỗng / lỗi dùng chung cho các màn /m. Có nút thử lại cho lỗi. -->
<template>
  <div class="mst" :class="`mst--${variant}`">
    <span class="mst-ic">
      <AlertTriangleIcon v-if="variant === 'error'" :size="30" :stroke-width="1.6" />
      <slot v-else name="icon"><InboxIcon :size="30" :stroke-width="1.5" /></slot>
    </span>
    <p class="mst-msg">{{ message }}</p>
    <p v-if="hint" class="mst-hint">{{ hint }}</p>
    <button v-if="variant === 'error'" class="mst-retry" @click="$emit('retry')">Thử lại</button>
    <slot name="action" />
  </div>
</template>

<script setup lang="ts">
import { AlertTriangle as AlertTriangleIcon, Inbox as InboxIcon } from 'lucide-vue-next';
defineProps<{ variant?: 'empty' | 'error'; message: string; hint?: string }>();
defineEmits<{ retry: [] }>();
</script>

<style scoped>
.mst {
  display: flex; flex-direction: column; align-items: center; gap: var(--m-sp-3);
  padding: 56px var(--m-sp-6); text-align: center; color: var(--m-text-2);
  animation: m-rise var(--m-dur-base) var(--m-ease) both;
}
.mst-ic { color: var(--m-text-3); }
.mst--error .mst-ic { color: var(--m-danger); }
.mst-msg { font-size: var(--m-fs-md); margin: 0; color: var(--m-text-2); }
.mst-hint { font-size: var(--m-fs-sm); margin: 0; color: var(--m-text-3); }
.mst-retry {
  margin-top: var(--m-sp-1); border: 0; background: var(--m-brand); color: var(--m-brand-ink);
  border-radius: var(--m-r-sm); padding: 9px 20px; font-size: var(--m-fs-sm); font-weight: var(--m-fw-semibold);
}
.mst-retry:active { transform: scale(0.96); }
</style>
