<template>
  <div class="filter-bar">
    <div class="kind-tabs">
      <button
        v-for="t in KIND_TABS"
        :key="t.value"
        class="kind-tab"
        :class="{ active: kindFilter === t.value }"
        @click="$emit('update:kindFilter', t.value)"
      >
        <span v-if="t.dot" class="dot" :style="{ background: t.dot }" />
        {{ t.label }}
        <span class="num">{{ countByKind[t.value] ?? 0 }}</span>
      </button>
    </div>

    <div class="divider" />

    <button class="chip" :class="{ on: !!careStatus }" @click="toggleCareDropdown">
      <span v-if="!careStatus">Trạng thái KH</span>
      <span v-else>{{ careLabel(careStatus) }}</span>
      <span class="caret">{{ careStatus ? '✕' : '▾' }}</span>
    </button>
    <div v-if="careDropdown" class="dropdown care-dd">
      <button
        v-for="opt in CARE_OPTIONS"
        :key="opt.value"
        :class="{ active: careStatus === opt.value }"
        @click="onCarePick(opt.value)"
      >{{ opt.label }}</button>
    </div>

    <button class="chip">📅 Khoảng ngày <span class="caret">▾</span></button>
    <button class="chip">🏷 Tag CRM <span class="caret">▾</span></button>
    <button class="chip">📍 Tỉnh <span class="caret">▾</span></button>

    <button class="saved-view">
      <span class="star">★</span>
      <span>View đã lưu</span>
      <span class="caret">▾</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { FriendKindFilter } from '@/composables/use-friends-state';

defineProps<{
  kindFilter: FriendKindFilter;
  countByKind: Record<string, number>;
  careStatus: string;
}>();

const emit = defineEmits<{
  (e: 'update:kindFilter', v: FriendKindFilter): void;
  (e: 'update:careStatus', v: string): void;
}>();

const KIND_TABS: { value: FriendKindFilter; label: string; dot?: string }[] = [
  { value: 'all',                label: 'Tất cả' },
  { value: 'friend',             label: 'Đã KB',         dot: '#16a34a' },
  { value: 'pending_friend',     label: 'Đã mời',        dot: '#d97706' },
  { value: 'chatting_stranger',  label: 'Đang nhắn lạ',  dot: '#0891b2' },
  { value: 'ghost',              label: 'Đã ngắt',       dot: '#9ca3af' },
];

const CARE_OPTIONS = [
  { value: '',            label: 'Tất cả trạng thái' },
  { value: 'interested',  label: '💬 Quan tâm' },
  { value: 'caring',      label: '🤝 Chăm sóc' },
  { value: 'negotiating', label: '⚡ Đàm phán' },
  { value: 'hot',         label: '🔥 Nóng' },
  { value: 'cold',        label: '❄ Lạnh' },
  { value: 'won',         label: '✅ Đã chốt' },
];

const careDropdown = ref(false);
function toggleCareDropdown() {
  careDropdown.value = !careDropdown.value;
}
function onCarePick(v: string) {
  emit('update:careStatus', v);
  careDropdown.value = false;
}
function careLabel(v: string): string {
  return CARE_OPTIONS.find(o => o.value === v)?.label ?? v;
}
</script>

<style scoped>
.filter-bar {
  padding: 10px 20px;
  background: #fff;
  border-bottom: 1px solid #e4e8ef;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  position: relative;
}

.kind-tabs { display: flex; gap: 4px; }
.kind-tab {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px; border-radius: 14px;
  background: #f9fafc; border: 1px solid #e4e8ef;
  font-size: 12px; cursor: pointer;
  color: #5b6573;
  font-family: inherit;
}
.kind-tab:hover { background: #fff; }
.kind-tab.active {
  background: #2f6ee5; color: #fff;
  border-color: #2f6ee5; font-weight: 600;
}
.kind-tab .dot { width: 6px; height: 6px; border-radius: 50%; }
.kind-tab .num {
  background: rgba(255,255,255,.2);
  padding: 0 6px; border-radius: 8px;
  font-size: 10px; font-weight: 700;
}
.kind-tab:not(.active) .num { background: #fff; color: #8d96a4; }

.divider { width: 1px; height: 22px; background: #e4e8ef; margin: 0 4px; }

.chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 10px; border-radius: 14px;
  border: 1px solid #e4e8ef; background: #fff;
  font-size: 12px; cursor: pointer; color: #5b6573;
  font-family: inherit;
}
.chip:hover { background: #f9fafc; }
.chip.on { background: #2f6ee5; color: #fff; border-color: #2f6ee5; font-weight: 600; }
.chip .caret { opacity: .5; font-size: 9px; }

.saved-view {
  margin-left: auto;
  padding: 5px 12px;
  border: 1px solid #cdd4df; border-radius: 14px;
  background: linear-gradient(180deg, #fff 0%, #f9fafc 100%);
  font-size: 12px;
  display: inline-flex; align-items: center; gap: 6px;
  cursor: pointer;
  font-family: inherit;
}
.saved-view:hover { box-shadow: 0 2px 4px rgba(0,0,0,.04); }
.saved-view .star { color: #d97706; }
.saved-view .caret { opacity: .5; font-size: 9px; }

/* Care status dropdown */
.dropdown.care-dd {
  position: absolute; top: 100%; left: 0; margin-top: 4px;
  background: #fff; border: 1px solid #e4e8ef; border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.1);
  padding: 4px; min-width: 200px;
  z-index: 10;
  display: flex; flex-direction: column;
}
.dropdown.care-dd button {
  padding: 6px 10px; border-radius: 6px;
  background: transparent; border: none; text-align: left;
  cursor: pointer; font-size: 12px; font-family: inherit;
  color: #1a2433;
}
.dropdown.care-dd button:hover { background: #f9fafc; }
.dropdown.care-dd button.active { background: #e8f0fe; color: #2f6ee5; font-weight: 600; }
</style>
