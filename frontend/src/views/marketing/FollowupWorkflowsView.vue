<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="fu-wrap">
    <div class="fu-head">
      <div>
        <h2 class="fu-title">Chiến dịch Follow-up</h2>
        <p class="fu-sub">Chăm sóc &amp; bám đuổi khách hàng tự động theo nhiều bước.</p>
      </div>
      <div class="fu-actions">
        <v-btn variant="tonal" color="primary" prepend-icon="mdi-view-grid-outline" @click="goTemplates">Kho chiến dịch mẫu</v-btn>
        <v-btn color="primary" prepend-icon="mdi-plus" :loading="creating" @click="createNew">Tạo chiến dịch</v-btn>
      </div>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" />

    <div v-else-if="!workflows.length" class="fu-empty">
      <v-icon size="56" color="grey-lighten-1">mdi-timeline-clock-outline</v-icon>
      <p class="mt-3 text-grey">Chưa có chiến dịch nào.</p>
      <v-btn class="mt-2" color="primary" variant="tonal" @click="goTemplates">Chọn từ Kho chiến dịch mẫu →</v-btn>
    </div>

    <v-table v-else class="fu-table" density="comfortable">
      <thead>
        <tr>
          <th>Tên chiến dịch</th>
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
          <td class="text-right" @click.stop>
            <v-menu location="bottom end">
              <template #activator="{ props }">
                <v-btn v-bind="props" icon="mdi-dots-vertical" variant="text" size="small" aria-label="Tác vụ" />
              </template>
              <v-list density="compact" min-width="200">
                <v-list-item prepend-icon="mdi-pencil-outline" title="Chỉnh sửa" @click="openBuilder(w.id)" />
                <v-divider />
                <v-list-item prepend-icon="mdi-archive-outline" title="Lưu trữ (giữ lịch sử)" @click="askDelete(w, 'archive')" />
                <v-list-item
                  prepend-icon="mdi-delete-outline" title="Xóa vĩnh viễn"
                  class="text-error" @click="askDelete(w, 'purge')"
                />
              </v-list>
            </v-menu>
          </td>
        </tr>
      </tbody>
    </v-table>

    <!-- Dialog xác nhận xoá — cảnh báo theo NGỮ CẢNH THẬT (hỏi server, không đoán) -->
    <v-dialog v-model="delOpen" max-width="520" persistent>
      <v-card>
        <v-card-title class="text-body-1">
          {{ delMode === 'archive' ? 'Lưu trữ chiến dịch?' : 'Xóa vĩnh viễn chiến dịch?' }}
        </v-card-title>
        <v-card-text>
          <p class="mb-3">Chiến dịch: <b>{{ delTarget?.name }}</b></p>

          <div v-if="previewLoading" class="text-grey">Đang kiểm tra…</div>

          <template v-else-if="preview">
            <!-- Cảnh báo đang hoạt động -->
            <v-alert v-if="preview.activeEnrollments > 0" type="warning" variant="tonal" density="compact" class="mb-3">
              <b>Chiến dịch đang hoạt động.</b>
              Có <b>{{ preview.activeEnrollments }}</b> khách hàng đang chạy.
              <template v-if="delMode === 'archive'">
                Lưu trữ sẽ <b>dừng ngay</b> các khách này (không gửi thêm tin nào).
              </template>
            </v-alert>

            <v-alert v-if="preview.referencedBy > 0" type="info" variant="tonal" density="compact" class="mb-3">
              Có <b>{{ preview.referencedBy }}</b> chiến dịch khác đang trỏ "chiến dịch kế tiếp" tới đây.
              Liên kết đó sẽ được gỡ.
            </v-alert>

            <!-- Chặn xoá cứng -->
            <v-alert v-if="delMode === 'purge' && !preview.canPurge" type="error" variant="tonal" density="compact" class="mb-3">
              <b>Không thể xóa vĩnh viễn.</b>
              Chiến dịch đã có <b>{{ preview.enrollments }}</b> khách hàng tham gia — xóa sẽ mất toàn bộ
              lịch sử chăm sóc của họ. Hãy dùng <b>Lưu trữ</b> để giữ lịch sử.
            </v-alert>

            <p v-if="delMode === 'archive'" class="text-body-2 text-grey">
              Chiến dịch sẽ được ẩn khỏi danh sách. Toàn bộ timeline và nhật ký của khách <b>vẫn được giữ</b>.
              Áp dụng cho cả {{ preview.versions }} phiên bản.
            </p>
            <p v-else-if="preview.canPurge" class="text-body-2 text-grey">
              Xóa {{ preview.versions }} phiên bản và toàn bộ các bước. Chiến dịch chưa có khách nào nên
              <b>không mất dữ liệu khách hàng</b>. Thao tác này <b>không thể hoàn tác</b>.
            </p>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="deleting" @click="delOpen = false">Hủy</v-btn>
          <v-btn
            v-if="delMode === 'archive'" color="warning" variant="flat" :loading="deleting"
            :disabled="previewLoading" @click="doArchive"
          >Lưu trữ</v-btn>
          <v-btn
            v-else color="error" variant="flat" :loading="deleting"
            :disabled="previewLoading || !preview?.canPurge" @click="doPurge"
          >Xóa vĩnh viễn</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
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
interface DeletePreview {
  versions: number; enrollments: number; activeEnrollments: number;
  referencedBy: number; canPurge: boolean;
}

const router = useRouter();
const toast = useToast();
const workflows = ref<WorkflowRow[]>([]);
const loading = ref(true);
const creating = ref(false);

const TYPE_LABELS: Record<string, string> = {
  intro: 'Giới thiệu DN', after_quote: 'Follow-up báo giá', care: 'Chăm sóc KH',
  rebuy: 'Nhắc mua lại', post_sale: 'Chăm sóc sau bán', promo: 'Khuyến mại',
  reengage: 'Lâu không tương tác', birthday: 'Sinh nhật (tự chạy)', custom: 'Tùy chỉnh',
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
    toast.error('Không tải được danh sách chiến dịch');
  } finally {
    loading.value = false;
  }
}

async function createNew() {
  creating.value = true;
  try {
    const res = await api.post('/followup/workflows', {
      name: 'Chiến dịch mới', type: 'custom',
      steps: [
        { key: 'start', type: 'start', orderIndex: 0, nextKey: 'end' },
        { key: 'end', type: 'end', orderIndex: 1 },
      ],
    });
    const id = res.data.workflow?.id;
    if (id) router.push({ name: 'CE.FollowupBuilder', params: { id } });
  } catch {
    toast.error('Không tạo được chiến dịch');
  } finally {
    creating.value = false;
  }
}

function openBuilder(id: string) { router.push({ name: 'CE.FollowupBuilder', params: { id } }); }
function goTemplates() { router.push({ name: 'CE.FollowupTemplates' }); }

// ── Xoá / Lưu trữ ──
const delOpen = ref(false);
const delMode = ref<'archive' | 'purge'>('archive');
const delTarget = ref<WorkflowRow | null>(null);
const preview = ref<DeletePreview | null>(null);
const previewLoading = ref(false);
const deleting = ref(false);

async function askDelete(w: WorkflowRow, mode: 'archive' | 'purge') {
  delTarget.value = w;
  delMode.value = mode;
  preview.value = null;
  delOpen.value = true;
  previewLoading.value = true;
  try {
    const res = await api.get(`/followup/workflows/${w.id}/delete-preview`);
    preview.value = res.data.preview;
  } catch {
    toast.error('Không kiểm tra được chiến dịch');
    delOpen.value = false;
  } finally {
    previewLoading.value = false;
  }
}

/** Gỡ khỏi danh sách tại chỗ — không tải lại trang. */
function removeRow(id: string) {
  const i = workflows.value.findIndex((w) => w.id === id);
  if (i !== -1) workflows.value.splice(i, 1);
}

async function doArchive() {
  if (!delTarget.value) return;
  deleting.value = true;
  try {
    const res = await api.post(`/followup/workflows/${delTarget.value.id}/archive`);
    const stopped = res.data.stoppedEnrollments ?? 0;
    removeRow(delTarget.value.id);
    delOpen.value = false;
    toast.success(stopped ? `Đã lưu trữ và dừng ${stopped} khách đang chạy` : 'Đã lưu trữ chiến dịch');
  } catch {
    toast.error('Không lưu trữ được');
  } finally {
    deleting.value = false;
  }
}

async function doPurge() {
  if (!delTarget.value) return;
  deleting.value = true;
  try {
    await api.delete(`/followup/workflows/${delTarget.value.id}`);
    removeRow(delTarget.value.id);
    delOpen.value = false;
    toast.success('Đã xóa vĩnh viễn chiến dịch');
  } catch (err: any) {
    // Server là nguồn chân lý: nếu có khách tham gia thì chặn, dù UI có cho bấm.
    if (err?.response?.status === 409) toast.error(err.response.data?.message || 'Chiến dịch đã có khách — hãy Lưu trữ');
    else toast.error('Không xóa được');
  } finally {
    deleting.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.fu-wrap { padding: 20px 24px; height: 100%; overflow-y: auto; }
.fu-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; gap: 12px; }
.fu-actions { display: flex; gap: 8px; flex-shrink: 0; }
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
