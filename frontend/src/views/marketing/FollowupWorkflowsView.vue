<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="fu-wrap">
    <div class="fu-head">
      <div>
        <h2 class="fu-title">Follow-up Workflow</h2>
        <p class="fu-sub">Chăm sóc &amp; bám đuổi khách hàng tự động theo nhiều bước.</p>
      </div>
      <v-btn color="primary" prepend-icon="mdi-plus" :loading="creating" @click="createNew">Tạo Workflow</v-btn>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" />

    <div v-else-if="!workflows.length" class="fu-empty">
      <v-icon size="56" color="grey-lighten-1">mdi-timeline-clock-outline</v-icon>
      <p class="mt-3 text-grey">Chưa có workflow nào. Bấm "Tạo Workflow" để bắt đầu.</p>
    </div>

    <v-table v-else class="fu-table" density="comfortable">
      <thead>
        <tr>
          <th>Tên Workflow</th>
          <th>Loại</th>
          <th class="text-center">Đang chạy</th>
          <th class="text-center">Đang chờ</th>
          <th class="text-center">Hoàn thành</th>
          <th class="text-center">Đạt Goal</th>
          <th>Người tạo</th>
          <th>Ngày tạo</th>
          <th>Trạng thái</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="w in workflows" :key="w.id" class="fu-row" @click="openBuilder(w.id)">
          <td class="fu-name">{{ w.name }}</td>
          <td><span class="fu-type">{{ typeLabel(w.type) }}</span></td>
          <td class="text-center">{{ w.totalRunning + w.totalWaitingSale }}</td>
          <td class="text-center">{{ w.totalWaiting }}</td>
          <td class="text-center">{{ w.totalCompleted }}</td>
          <td class="text-center">{{ w.totalGoalReached }}</td>
          <td class="text-grey">{{ w.createdByName || '—' }}</td>
          <td class="text-grey">{{ fmtDate(w.createdAt) }}</td>
          <td><span class="fu-status" :class="'st-' + w.status">{{ statusLabel(w.status) }}</span></td>
          <td class="text-right">
            <v-icon size="18" color="grey">mdi-chevron-right</v-icon>
          </td>
        </tr>
      </tbody>
    </v-table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';

interface WorkflowRow {
  id: string; name: string; type: string; status: string; version: number;
  totalRunning: number; totalWaiting: number; totalWaitingSale: number;
  totalCompleted: number; totalStopped: number; totalGoalReached: number;
  createdByName: string | null; createdAt: string;
}

const router = useRouter();
const toast = useToast();
const workflows = ref<WorkflowRow[]>([]);
const loading = ref(true);
const creating = ref(false);

const TYPE_LABELS: Record<string, string> = {
  intro: 'Giới thiệu DN', after_quote: 'Follow-up báo giá', care: 'Chăm sóc KH',
  rebuy: 'Nhắc mua lại', post_sale: 'Chăm sóc sau bán', promo: 'Khuyến mại',
  reengage: 'Lâu không tương tác', custom: 'Tùy chỉnh',
};
const STATUS_LABELS: Record<string, string> = {
  draft: 'Nháp', active: 'Đang chạy', paused: 'Tạm dừng', archived: 'Lưu trữ',
};
function typeLabel(t: string) { return TYPE_LABELS[t] ?? t; }
function statusLabel(s: string) { return STATUS_LABELS[s] ?? s; }
function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

async function load() {
  loading.value = true;
  try {
    const res = await api.get('/followup/workflows');
    workflows.value = res.data.workflows ?? [];
  } catch {
    toast.error('Không tải được danh sách workflow');
  } finally {
    loading.value = false;
  }
}

async function createNew() {
  creating.value = true;
  try {
    const res = await api.post('/followup/workflows', {
      name: 'Workflow mới', type: 'custom',
      steps: [
        { key: 'start', type: 'start', orderIndex: 0, nextKey: 'end' },
        { key: 'end', type: 'end', orderIndex: 1 },
      ],
    });
    const id = res.data.workflow?.id;
    if (id) router.push({ name: 'CE.FollowupBuilder', params: { id } });
  } catch {
    toast.error('Không tạo được workflow');
  } finally {
    creating.value = false;
  }
}

function openBuilder(id: string) {
  router.push({ name: 'CE.FollowupBuilder', params: { id } });
}

onMounted(load);
</script>

<style scoped>
.fu-wrap { padding: 20px 24px; height: 100%; overflow-y: auto; }
.fu-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
.fu-title { font-size: 20px; font-weight: 700; color: var(--smax-text, #212121); }
.fu-sub { font-size: 13px; color: var(--smax-grey-700, #5a6478); margin-top: 2px; }
.fu-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 0; }
.fu-table { background: var(--smax-bg, #fff); border-radius: 12px; box-shadow: 0 1px 3px rgba(15,23,42,.06); }
.fu-table th { font-size: 12px; font-weight: 600; color: var(--smax-grey-700, #5a6478); white-space: nowrap; }
.fu-row { cursor: pointer; transition: background .12s; }
.fu-row:hover { background: var(--smax-grey-100, #f5f6fa); }
.fu-name { font-weight: 600; color: var(--smax-text, #212121); }
.fu-type { font-size: 12px; padding: 2px 9px; border-radius: 8px; background: var(--smax-primary-soft, #e4f1f8); color: var(--smax-primary-700, #0b5880); white-space: nowrap; }
.fu-status { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
.st-draft { background: #eceff1; color: #607d8b; }
.st-active { background: rgba(0,200,83,.14); color: #1b8a4d; }
.st-paused { background: rgba(255,145,0,.14); color: #ef6c00; }
.st-archived { background: #eceff1; color: #90a4ae; }
</style>
