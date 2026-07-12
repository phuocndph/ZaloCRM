<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- MPageHeader — header dùng chung cho các màn /m. Né notch (safe-area-top), tiêu đề,
     ô tìm tuỳ chọn, slot actions (phải) + below (chip/tab). Vùng chạm ≥ 44px. -->
<template>
  <header class="mph">
    <div class="mph-top">
      <button v-if="back" class="m-iconbtn mph-back" aria-label="Quay lại" @click="$emit('back')">
        <ChevronLeftIcon :size="26" :stroke-width="2.2" />
      </button>
      <h1 class="mph-title">
        {{ title }}
        <span v-if="count != null" class="m-badge mph-count">{{ count > 99 ? '99+' : count }}</span>
      </h1>
      <div class="mph-actions"><slot name="actions" /></div>
    </div>

    <div v-if="searchable" class="mph-search">
      <SearchIcon class="mph-search-ic" :size="18" :stroke-width="2" />
      <input
        :value="search"
        type="search"
        :placeholder="searchPlaceholder"
        @input="$emit('update:search', ($event.target as HTMLInputElement).value)"
      />
      <button v-if="search" class="mph-search-clear" aria-label="Xoá" @click="$emit('update:search', '')">
        <XIcon :size="16" :stroke-width="2" />
      </button>
    </div>

    <slot name="below" />
  </header>
</template>

<script setup lang="ts">
import { ChevronLeft as ChevronLeftIcon, Search as SearchIcon, X as XIcon } from 'lucide-vue-next';

defineProps<{
  title: string;
  count?: number | null;
  back?: boolean;
  searchable?: boolean;
  search?: string;
  searchPlaceholder?: string;
}>();
defineEmits<{ back: []; 'update:search': [v: string] }>();
</script>

<style scoped>
.mph {
  flex-shrink: 0;
  background: var(--m-surface);
  border-bottom: 1px solid var(--m-border);
  padding: 0 var(--m-sp-3) var(--m-sp-2);
  padding-top: env(safe-area-inset-top, 0px);
}
.mph-top { display: flex; align-items: center; gap: var(--m-sp-1); min-height: var(--m-touch); }
.mph-back { margin-left: -6px; color: var(--m-brand); }
.mph-title {
  flex: 1; min-width: 0; margin: 0;
  font-size: var(--m-fs-xl); font-weight: var(--m-fw-bold); color: var(--m-text);
  display: flex; align-items: center; gap: var(--m-sp-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mph-count { flex-shrink: 0; }
.mph-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.mph-search { position: relative; margin-top: var(--m-sp-1); }
.mph-search-ic { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--m-text-3); pointer-events: none; }
.mph-search input {
  width: 100%; border: 1.5px solid transparent; background: var(--m-surface-2);
  border-radius: var(--m-r-full); padding: 11px 40px; font-size: var(--m-fs-input);
  color: var(--m-text); outline: none;
  transition: border-color var(--m-dur-fast) var(--m-ease), background var(--m-dur-fast) var(--m-ease);
}
.mph-search input:focus { border-color: var(--m-brand); background: var(--m-surface); }
.mph-search input::placeholder { color: var(--m-text-3); }
.mph-search-clear {
  position: absolute; right: 0; top: 50%; transform: translateY(-50%);
  width: var(--m-touch); height: var(--m-touch); border: 0; background: transparent; color: var(--m-text-3);
  display: flex; align-items: center; justify-content: center; border-radius: var(--m-r-full);
}
.mph-search-clear:active { background: var(--m-surface-2); }
</style>
