<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Màn hình công việc hằng ngày cho nhân viên trên mobile. -->
<template>
  <div class="mwi mc-scroll">
    <MPageHeader title="Công việc" :count="counts[scope] ?? 0" notifications />
    <div class="mwi-body m-scroll">
      <div class="mwi-intro">
        <strong>Việc cần xử lý hôm nay</strong>
        <span>Chọn một khách để mở chat, xử lý xong thì đánh dấu hoàn thành.</span>
      </div>
      <DailyWorkQueue ref="queue" mobile :initial-scope="scope" @scope-change="onScopeChange" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MPageHeader from '@/components/mobile/MPageHeader.vue';
import DailyWorkQueue from '@/components/dashboard/DailyWorkQueue.vue';
import type { WorkItemScope } from '@/composables/use-conversation-work-items';

defineOptions({ name: 'MWorkItemsView' });
const route = useRoute();
const router = useRouter();
const queue = ref<InstanceType<typeof DailyWorkQueue> | null>(null);
const validScopes: WorkItemScope[] = ['now', 'today', 'waiting', 'upcoming', 'verify', 'done'];
const scope = computed<WorkItemScope>(() => {
  const value = String(route.query.scope || 'now') as WorkItemScope;
  return validScopes.includes(value) ? value : 'now';
});
const counts = computed(() => queue.value?.counts ?? { now: 0, today: 0, waiting: 0, upcoming: 0, verify: 0, done: 0 });

function onScopeChange(value: WorkItemScope) {
  void router.replace({ query: { ...route.query, scope: value === 'now' ? undefined : value } });
}
</script>

<style scoped>
.mwi { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--m-bg); }
.mwi-body { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: calc(var(--m-sp-3) + env(safe-area-inset-bottom, 0px)); }
.mwi-intro { display: flex; flex-direction: column; gap: 2px; padding: var(--m-sp-3) var(--m-sp-4) var(--m-sp-2); color: var(--m-text-2); }
.mwi-intro strong { color: var(--m-text); font-size: var(--m-fs-md); font-weight: var(--m-fw-bold); }
.mwi-intro span { font-size: var(--m-fs-xs); line-height: 1.45; }
.mwi :deep(.dwq) { margin: 0 var(--m-sp-4) var(--m-sp-4); }
</style>
