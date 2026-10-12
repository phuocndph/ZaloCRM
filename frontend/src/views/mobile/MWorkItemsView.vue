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
      <DailyWorkQueue ref="queue" mobile preview-enabled :selected-conversation-id="selectedConversationId" :initial-scope="scope" @scope-change="onScopeChange" @preview-conversation="openPreview" @item-updated="onItemUpdated" />
    </div>
    <WorkItemConversationPreview v-if="selectedConversationId" mobile :conversation-id="selectedConversationId" :item="selectedItem" :busy="previewBusy || !!queue?.mutatingId" :item-available="itemAvailable" @close="closePreview" @marked-read="queue?.refresh(true)" @message-sent="queue?.refresh(true)" @switch-conversation="openPreview($event, null)" @action="onPreviewAction" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MPageHeader from '@/components/mobile/MPageHeader.vue';
import DailyWorkQueue from '@/components/dashboard/DailyWorkQueue.vue';
import WorkItemConversationPreview from '@/components/dashboard/WorkItemConversationPreview.vue';
import type { ConversationWorkItem, WorkItemScope } from '@/composables/use-conversation-work-items';

defineOptions({ name: 'MWorkItemsView' });
const route = useRoute();
const router = useRouter();
const queue = ref<InstanceType<typeof DailyWorkQueue> | null>(null);
const selectedConversationId = ref<string | null>(null);
const selectedItem = ref<ConversationWorkItem | null>(null);
const previewBusy = ref(false);
let returnFocus: HTMLElement | null = null;
const itemAvailable = computed(() => !selectedItem.value || selectedItem.value.status === 'completed' || !!queue.value?.items.some((item) => item.id === selectedItem.value?.id));
const validScopes: WorkItemScope[] = ['now', 'today', 'waiting', 'upcoming', 'verify', 'done'];
const scope = computed<WorkItemScope>(() => {
  const value = String(route.query.scope || 'now') as WorkItemScope;
  return validScopes.includes(value) ? value : 'now';
});
const counts = computed(() => queue.value?.counts ?? { now: 0, today: 0, waiting: 0, upcoming: 0, verify: 0, done: 0 });

function onScopeChange(value: WorkItemScope) {
  void router.replace({ query: { ...route.query, scope: value === 'now' ? undefined : value } });
}
function openPreview(id: string, item: ConversationWorkItem | null) {
  returnFocus = document.activeElement as HTMLElement | null;
  selectedConversationId.value = id;
  selectedItem.value = item;
}
function closePreview() {
  selectedConversationId.value = null;
  selectedItem.value = null;
  void nextTick(() => { if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); });
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
.mwi { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--m-bg); }
.mwi-body { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: calc(var(--m-sp-3) + env(safe-area-inset-bottom, 0px)); }
.mwi-intro { display: flex; flex-direction: column; gap: 2px; padding: var(--m-sp-3) var(--m-sp-4) var(--m-sp-2); color: var(--m-text-2); }
.mwi-intro strong { color: var(--m-text); font-size: var(--m-fs-md); font-weight: var(--m-fw-bold); }
.mwi-intro span { font-size: var(--m-fs-xs); line-height: 1.45; }
.mwi :deep(.dwq) { margin: 0 var(--m-sp-4) var(--m-sp-4); }
</style>
