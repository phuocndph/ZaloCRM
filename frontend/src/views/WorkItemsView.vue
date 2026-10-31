<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Màn hình tác nghiệp hằng ngày: mở mặc định ở các việc cần xử lý ngay. -->
<template>
  <div ref="page" class="wi-page" :class="{ 'wi-page--preview': selectedConversationId }">
    <div class="wi-shell" :class="{ 'wi-shell--preview': selectedConversationId }">
      <header class="wi-header">
        <div>
          <div class="wi-eyebrow"><ListTodoIcon :size="15" aria-hidden="true" /> TÁC NGHIỆP HẰNG NGÀY</div>
          <h1>{{ viewMode === 'load' ? 'Phân công hội thoại' : 'Công việc khách hàng' }}</h1>
          <p v-if="viewMode === 'load'">Xem nhanh mỗi hội thoại đang do nhân viên nào phụ trách, nick nào đang xử lý và trạng thái hiện tại.</p>
          <p v-else>Hiển thị công việc của tất cả nhân viên và nick Zalo trong phạm vi được phép xem. Lọc theo người phụ trách khi cần. Mở việc, xử lý rồi đánh dấu hoàn thành.</p>
        </div>
        <div class="wi-header-actions">
          <div class="wi-mode" role="tablist" aria-label="Chế độ xem công việc">
            <button type="button" :class="{ active: viewMode === 'queue' }" role="tab" :aria-selected="viewMode === 'queue'" @click="setViewMode('queue')"><ListTodoIcon :size="14" aria-hidden="true" /> Công việc</button>
            <button type="button" :class="{ active: viewMode === 'load' }" role="tab" :aria-selected="viewMode === 'load'" @click="setViewMode('load')"><UsersRoundIcon :size="14" aria-hidden="true" /> Phân công</button>
          </div>
          <button v-if="viewMode === 'queue'" class="wi-refresh" type="button" :disabled="refreshing" title="Tải lại danh sách" aria-label="Tải lại danh sách" @click="refresh">
            <RefreshCwIcon :size="17" :class="{ spin: refreshing }" aria-hidden="true" />
            <span>Tải lại</span>
          </button>
        </div>
      </header>

      <section v-if="viewMode === 'queue'" class="wi-summary" role="tablist" aria-label="Lọc công việc">
        <button v-for="stat in summaryStats" :key="stat.key" class="wi-stat" :class="{ active: currentScope === stat.key }" type="button" role="tab" :aria-selected="currentScope === stat.key" @click="setScope(stat.key)">
          <span class="wi-stat-value">{{ counts[stat.key] ?? 0 }}</span>
          <span class="wi-stat-label">{{ stat.label }}</span>
        </button>
      </section>

      <WorkloadOverview v-if="viewMode === 'load'" />
      <div v-else class="wi-workspace" :class="{ 'wi-workspace--preview': selectedConversationId }">
        <DailyWorkQueue
          ref="queue"
          all-assignees
          @assignee-change="closePreview"
          hide-tabs
          preview-enabled
          :selected-conversation-id="selectedConversationId"
          :initial-scope="currentScope"
          @scope-change="onScopeChange"
          @preview-conversation="openPreview"
          @item-updated="onItemUpdated"
        />
        <WorkItemConversationPreview
          v-if="selectedConversationId"
          :conversation-id="selectedConversationId"
          :item="selectedItem"
          :busy="previewBusy || !!queue?.mutatingId"
          :item-available="itemAvailable"
          @close="closePreview"
          @marked-read="queue?.refresh(true)"
          @message-sent="queue?.refresh(true)"
          @switch-conversation="openPreview($event, null)"
          @action="onPreviewAction"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ListTodo as ListTodoIcon, RefreshCw as RefreshCwIcon, UsersRound as UsersRoundIcon } from 'lucide-vue-next';
import DailyWorkQueue from '@/components/dashboard/DailyWorkQueue.vue';
import WorkloadOverview from '@/components/dashboard/WorkloadOverview.vue';
import WorkItemConversationPreview from '@/components/dashboard/WorkItemConversationPreview.vue';
import type { ConversationWorkItem, WorkItemCounts, WorkItemScope } from '@/composables/use-conversation-work-items';

const route = useRoute();
const router = useRouter();
const queue = ref<InstanceType<typeof DailyWorkQueue> | null>(null);
const page = ref<HTMLElement | null>(null);
const selectedConversationId = ref<string | null>(null);
const selectedItem = ref<ConversationWorkItem | null>(null);
const previewBusy = ref(false);
let savedScrollTop = 0;
let returnFocus: HTMLElement | null = null;
const itemAvailable = computed(() => !selectedItem.value || selectedItem.value.status === 'completed' || !!queue.value?.items.some((item) => item.id === selectedItem.value?.id));
const refreshing = ref(false);
const viewMode = computed<'queue' | 'load'>(() => route.query.view === 'load' ? 'load' : 'queue');

const validScopes: WorkItemScope[] = ['now', 'today', 'waiting', 'upcoming', 'verify', 'done'];
const currentScope = computed<WorkItemScope>(() => {
  const value = String(route.query.scope || 'now') as WorkItemScope;
  return validScopes.includes(value) ? value : 'now';
});
const counts = computed<WorkItemCounts>(() => queue.value?.counts ?? { now: 0, today: 0, waiting: 0, upcoming: 0, verify: 0, done: 0 });
const summaryStats: Array<{ key: WorkItemScope; label: string }> = [
  { key: 'now', label: 'Cần làm ngay' },
  { key: 'today', label: 'Còn lại hôm nay' },
  { key: 'waiting', label: 'Đang hoãn' },
  { key: 'upcoming', label: 'Sắp tới' },
  { key: 'verify', label: 'Cần xác minh' },
  { key: 'done', label: 'Đã xong' },
];

function setScope(scope: WorkItemScope) {
  void router.replace({ query: { ...route.query, scope: scope === 'now' ? undefined : scope } });
}
function setViewMode(mode: 'queue' | 'load') {
  closePreview();
  void router.replace({ query: { ...route.query, view: mode === 'queue' ? undefined : 'load' } });
}
function onScopeChange(scope: WorkItemScope) {
  if (scope !== currentScope.value) setScope(scope);
}
async function refresh() {
  refreshing.value = true;
  try { await queue.value?.refresh(); } finally { refreshing.value = false; }
}

function openPreview(conversationId: string, item: ConversationWorkItem | null) {
  if (!selectedConversationId.value) {
    savedScrollTop = page.value?.scrollTop ?? 0;
    returnFocus = document.activeElement as HTMLElement | null;
  }
  const top = page.value?.scrollTop ?? 0;
  selectedConversationId.value = conversationId;
  selectedItem.value = item;
  void nextTick(() => { if (page.value) page.value.scrollTop = top; });
}
function closePreview() {
  if (!selectedConversationId.value) return;
  selectedConversationId.value = null;
  selectedItem.value = null;
  void nextTick(() => {
    if (page.value) page.value.scrollTop = savedScrollTop;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  });
}
function onItemUpdated(item: ConversationWorkItem) {
  if (item.id === selectedItem.value?.id) selectedItem.value = { ...selectedItem.value, ...item };
}
async function onPreviewAction(action: 'complete' | 'reopen' | 'snooze', options?: { snoozeMinutes?: number; snoozedUntil?: string }) {
  if (!selectedItem.value || previewBusy.value || !queue.value) return;
  previewBusy.value = true;
  try { await queue.value.performAction(selectedItem.value, action, options); }
  finally { previewBusy.value = false; }
}
watch(() => queue.value?.items, (items) => {
  const latest = items?.find((item) => item.id === selectedItem.value?.id);
  if (latest) selectedItem.value = latest;
});
</script>

<style scoped>
.wi-page {
  box-sizing: border-box;
  height: calc(100dvh - var(--smax-topnav-h, 48px));
  min-height: 0;
  padding: 24px 28px 40px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  background: var(--smax-grey-100, #f4f6f8);
}
.wi-shell { width: min(1180px, 100%); margin: 0 auto; padding-bottom: 1px; }
.wi-shell--preview { width: min(1480px, 100%); }
.wi-workspace { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: 14px; }
.wi-workspace--preview { grid-template-columns: minmax(0, 1fr) clamp(500px, 46%, 680px); }
.wi-page :deep(.dwq-list) { max-height: none; overflow: visible; }
.wi-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 18px; }
.wi-header-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
.wi-mode { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid #d0d5dd; border-radius: 7px; background: #fff; }
.wi-mode button { display: inline-flex; align-items: center; gap: 5px; min-height: 30px; padding: 0 9px; border: 0; border-radius: 5px; background: transparent; color: #667085; font: inherit; font-size: 11px; font-weight: 750; cursor: pointer; }
.wi-mode button.active { background: #e8f5f8; color: #087daf; }
.wi-eyebrow { display: flex; align-items: center; gap: 7px; color: #087daf; font-size: 11px; font-weight: 800; letter-spacing: .06em; }
.wi-header h1 { margin: 6px 0 5px; color: #172033; font-size: 26px; line-height: 1.2; }
.wi-header p { max-width: 680px; margin: 0; color: #667085; font-size: 13px; line-height: 1.5; }
.wi-refresh { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 0 12px; border: 1px solid #d0d5dd; border-radius: 6px; background: #fff; color: #344054; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.wi-refresh:hover:not(:disabled) { border-color: #087daf; color: #087daf; }
.wi-refresh:disabled { opacity: .6; cursor: default; }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.wi-summary { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
.wi-stat { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-height: 70px; padding: 12px 14px; border: 1px solid #e4e7ec; border-radius: 7px; background: #fff; text-align: left; cursor: pointer; }
.wi-stat:hover, .wi-stat.active { border-color: #8bcde3; background: #f4fbfd; }
.wi-stat-value { color: #172033; font-size: 21px; font-weight: 800; line-height: 1; }
.wi-stat-label { color: #667085; font-size: 11px; font-weight: 650; }
@media (max-width: 1000px) {
  .wi-workspace--preview { grid-template-columns: minmax(0, 1fr); }
  .wi-page--preview { overflow: hidden; }
}
@media (max-width: 720px) {
  .wi-page { height: calc(100dvh - var(--smax-topnav-h, 48px)); padding: 16px 12px 28px; }
  .wi-header { gap: 12px; }
  .wi-header-actions { align-items: flex-end; flex-direction: column; gap: 6px; }
  .wi-header h1 { font-size: 21px; }
  .wi-header p { font-size: 12px; }
  .wi-refresh span { display: none; }
  .wi-summary { gap: 6px; overflow-x: auto; padding-bottom: 2px; }
  .wi-stat { min-width: 112px; min-height: 62px; padding: 10px; }
}
</style>
