<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div v-if="count > 0" class="bulk-bar">
    <span class="count">{{ count }}</span>
    <span>đã chọn</span>
    <button @click="$emit('msg-batch')"><MessageSquareIcon :size="14" :stroke-width="2" /> Nhắn hàng loạt</button>
    <button @click="$emit('tag')"><TagIcon :size="14" :stroke-width="2" /> Gắn tag</button>
    <button @click="$emit('change-status')"><CalendarClockIcon :size="14" :stroke-width="2" /> Đổi trạng thái</button>
    <button @click="$emit('export')"><DownloadIcon :size="14" :stroke-width="2" /> Xuất</button>
    <span class="clear" @click="$emit('clear')"><XIcon :size="13" :stroke-width="2" /> Bỏ chọn</span>
  </div>
</template>

<script setup lang="ts">
import {
  MessageSquare as MessageSquareIcon,
  Tag as TagIcon,
  CalendarClock as CalendarClockIcon,
  Download as DownloadIcon,
  X as XIcon,
} from 'lucide-vue-next';

defineProps<{
  count: number;
}>();

defineEmits<{
  (e: 'msg-batch'): void;
  (e: 'tag'): void;
  (e: 'change-status'): void;
  (e: 'export'): void;
  (e: 'clear'): void;
}>();
</script>

<style scoped>
.bulk-bar {
  padding: 8px 20px;
  background: var(--brand);
  color: #fff;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  animation: slideDown .15s ease;
}
@keyframes slideDown {
  from { transform: translateY(-100%); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}
.bulk-bar .count { font-weight: 700; }
.bulk-bar button {
  display: inline-flex; align-items: center; gap: 5px;
  background: rgba(255,255,255,.12);
  border: 1px solid rgba(255,255,255,.2);
  color: #fff;
  padding: 4px 10px;
  border-radius: 5px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.bulk-bar button:hover { background: rgba(255,255,255,.2); }
.bulk-bar .clear {
  display: inline-flex; align-items: center; gap: 4px;
  margin-left: auto;
  cursor: pointer;
  opacity: .8;
  user-select: none;
}
.bulk-bar .clear:hover { opacity: 1; }
</style>
