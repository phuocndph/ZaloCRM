<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- MFab — nút hành động nổi (Floating Action Button) góc phải dưới, trên bottom nav.
     Chỉ render khi được phép (parent kiểm quyền). Vùng chạm ≥ 56px. -->
<template>
  <button class="mfab" :aria-label="label" @click="$emit('click')">
    <slot><PlusIcon :size="24" :stroke-width="2.4" /></slot>
    <span v-if="extended && label" class="mfab-label">{{ label }}</span>
  </button>
</template>

<script setup lang="ts">
import { Plus as PlusIcon } from 'lucide-vue-next';
defineProps<{ label?: string; extended?: boolean }>();
defineEmits<{ click: [] }>();
</script>

<style scoped>
.mfab {
  position: absolute;
  right: var(--m-sp-4);
  bottom: calc(54px + var(--m-sp-4) + env(safe-area-inset-bottom, 0px));
  min-width: 56px; height: 56px; padding: 0 18px;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  border: 0; border-radius: var(--m-r-lg);
  background: var(--m-brand); color: var(--m-brand-ink);
  box-shadow: var(--m-e3);
  cursor: pointer; z-index: 5;
  animation: mfab-in var(--m-dur-base) var(--m-ease) both;
  transition: transform var(--m-dur-fast) var(--m-ease);
}
.mfab:active { transform: scale(0.92); }
.mfab-label { font-size: var(--m-fs-sm); font-weight: var(--m-fw-semibold); }
@keyframes mfab-in { from { opacity: 0; transform: scale(0.6) translateY(10px); } to { opacity: 1; transform: none; } }
</style>
