<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Màn hình tác nghiệp hằng ngày: mở mặc định ở các việc cần xử lý ngay. -->
<template>
  <div class="wi-page">
    <div class="wi-shell">
      <header class="wi-header">
        <div>
          <div class="wi-eyebrow"><ListTodoIcon :size="15" aria-hidden="true" /> TÁC NGHIỆP HẰNG NGÀY</div>
          <h1>Công việc khách hàng</h1>
          <p>Danh sách đã được gom theo khách hàng, nick Zalo và tín hiệu từ cuộc hội thoại. Mở việc, xử lý rồi đánh dấu hoàn thành.</p>
        </div>
        <button class="wi-refresh" type="button" :disabled="refreshing" title="Tải lại danh sách" aria-label="Tải lại danh sách" @click="refresh">
          <RefreshCwIcon :size="17" :class="{ spin: refreshing }" aria-hidden="true" />
          <span>Tải lại</span>
        </button>
      </header>

      <section class="wi-summary" role="tablist" aria-label="Lọc công việc">
        <button v-for="stat in summaryStats" :key="stat.key" class="wi-stat" :class="{ active: currentScope === stat.key }" type="button" role="tab" :aria-selected="currentScope === stat.key" @click="setScope(stat.key)">
          <span class="wi-stat-value">{{ counts[stat.key] ?? 0 }}</span>
          <span class="wi-stat-label">{{ stat.label }}</span>
        </button>
      </section>

      <DailyWorkQueue
        ref="queue"
        hide-tabs
        :initial-scope="currentScope"
        @scope-change="onScopeChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ListTodo as ListTodoIcon, RefreshCw as RefreshCwIcon } from 'lucide-vue-next';
import DailyWorkQueue from '@/components/dashboard/DailyWorkQueue.vue';
import type { WorkItemCounts, WorkItemScope } from '@/composables/use-conversation-work-items';

const route = useRoute();
const router = useRouter();
const queue = ref<{ refresh: (quiet?: boolean) => Promise<unknown>; counts: WorkItemCounts } | null>(null);
const refreshing = ref(false);

const validScopes: WorkItemScope[] = ['now', 'today', 'waiting', 'upcoming', 'done'];
const currentScope = computed<WorkItemScope>(() => {
  const value = String(route.query.scope || 'now') as WorkItemScope;
  return validScopes.includes(value) ? value : 'now';
});
const counts = computed<WorkItemCounts>(() => queue.value?.counts ?? { now: 0, today: 0, waiting: 0, upcoming: 0, done: 0 });
const summaryStats: Array<{ key: WorkItemScope; label: string }> = [
  { key: 'now', label: 'Cần làm ngay' },
  { key: 'today', label: 'Còn lại hôm nay' },
  { key: 'waiting', label: 'Đang hoãn' },
  { key: 'upcoming', label: 'Sắp tới' },
  { key: 'done', label: 'Đã xong' },
];

function setScope(scope: WorkItemScope) {
  void router.replace({ query: { ...route.query, scope: scope === 'now' ? undefined : scope } });
}
function onScopeChange(scope: WorkItemScope) {
  if (scope !== currentScope.value) setScope(scope);
}
async function refresh() {
  refreshing.value = true;
  try { await queue.value?.refresh(); } finally { refreshing.value = false; }
}
</script>

<style scoped>
.wi-page { min-height: calc(100vh - var(--smax-topnav-h, 60px)); padding: 24px 28px 40px; background: var(--smax-grey-100, #f4f6f8); }
.wi-shell { width: min(1180px, 100%); margin: 0 auto; }
.wi-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 18px; }
.wi-eyebrow { display: flex; align-items: center; gap: 7px; color: #087daf; font-size: 11px; font-weight: 800; letter-spacing: .06em; }
.wi-header h1 { margin: 6px 0 5px; color: #172033; font-size: 26px; line-height: 1.2; }
.wi-header p { max-width: 680px; margin: 0; color: #667085; font-size: 13px; line-height: 1.5; }
.wi-refresh { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 0 12px; border: 1px solid #d0d5dd; border-radius: 6px; background: #fff; color: #344054; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.wi-refresh:hover:not(:disabled) { border-color: #087daf; color: #087daf; }
.wi-refresh:disabled { opacity: .6; cursor: default; }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.wi-summary { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
.wi-stat { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-height: 70px; padding: 12px 14px; border: 1px solid #e4e7ec; border-radius: 7px; background: #fff; text-align: left; cursor: pointer; }
.wi-stat:hover, .wi-stat.active { border-color: #8bcde3; background: #f4fbfd; }
.wi-stat-value { color: #172033; font-size: 21px; font-weight: 800; line-height: 1; }
.wi-stat-label { color: #667085; font-size: 11px; font-weight: 650; }
@media (max-width: 720px) {
  .wi-page { padding: 16px 12px 28px; }
  .wi-header { gap: 12px; }
  .wi-header h1 { font-size: 21px; }
  .wi-header p { font-size: 12px; }
  .wi-refresh span { display: none; }
  .wi-summary { gap: 6px; overflow-x: auto; padding-bottom: 2px; }
  .wi-stat { min-width: 112px; min-height: 62px; padding: 10px; }
}
</style>
