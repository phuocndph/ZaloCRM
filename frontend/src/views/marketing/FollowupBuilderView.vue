<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div v-if="wf" class="fb-wrap">
    <!-- Top bar -->
    <div class="fb-top">
      <v-btn variant="text" icon="mdi-arrow-left" @click="goBack" />
      <input v-model="wf.name" class="fb-name-input" placeholder="Tên chiến dịch" />
      <span class="fu-status" :class="'st-' + wf.status">{{ statusLabel(wf.status) }}</span>
      <span v-if="wf.version > 1" class="fb-ver">v{{ wf.version }}</span>
      <div class="fb-spacer" />
      <v-btn variant="tonal" color="grey-darken-1" prepend-icon="mdi-play-circle-outline" @click="openDryRun">Chạy thử</v-btn>
      <v-btn variant="tonal" color="primary" prepend-icon="mdi-content-save-outline" :loading="saving" @click="save">Lưu</v-btn>
      <v-btn v-if="wf.status !== 'active'" color="success" prepend-icon="mdi-rocket-launch-outline" @click="setStatus('active')">Kích hoạt</v-btn>
      <v-btn v-else color="warning" variant="tonal" prepend-icon="mdi-pause" @click="setStatus('paused')">Tạm dừng</v-btn>
    </div>

    <v-tabs v-model="tab" density="compact" color="primary" class="fb-tabs">
      <v-tab value="design">Thiết kế</v-tab>
      <v-tab value="track">Theo dõi &amp; Thống kê</v-tab>
    </v-tabs>

    <!-- ══════════ TAB THIẾT KẾ ══════════ -->
    <div v-show="tab === 'design'" class="fb-body">
      <!-- Cấu hình -->
      <div class="fb-col fb-settings">
        <h3 class="fb-h3">Cấu hình</h3>

        <label class="fb-label">Loại chiến dịch</label>
        <v-select v-model="wf.type" :items="typeOptions" density="compact" variant="outlined" hide-details />

        <label class="fb-label">Mục tiêu (Goal)</label>
        <v-select v-model="wf.goalType" :items="goalOptions" density="compact" variant="outlined" hide-details />
        <v-text-field v-if="wf.goalType === 'has_tag'" v-model="wf.goalTag" label="Tag đạt mục tiêu" density="compact" variant="outlined" hide-details class="mt-2" />
        <v-text-field v-model="wf.goalTagOnReach" label="Gắn tag khi đạt Goal (tuỳ chọn)" density="compact" variant="outlined" hide-details class="mt-2" />

        <label class="fb-label">Chiến dịch kế tiếp (khi đạt Goal)</label>
        <v-select v-model="wf.nextWorkflowId" :items="nextWfOptions" density="compact" variant="outlined" hide-details clearable />

        <h4 class="fb-h4">Giới hạn gửi</h4>
        <div class="fb-row2">
          <div>
            <label class="fb-label">Giờ gửi từ</label>
            <input type="time" class="fb-time" :value="minToTime(wf.sendWindowStart)" @input="wf.sendWindowStart = timeToMin(($event.target as HTMLInputElement).value)" />
          </div>
          <div>
            <label class="fb-label">đến</label>
            <input type="time" class="fb-time" :value="minToTime(wf.sendWindowEnd)" @input="wf.sendWindowEnd = timeToMin(($event.target as HTMLInputElement).value)" />
          </div>
        </div>
        <div class="fb-row2">
          <div>
            <label class="fb-label">Cách nhau tối thiểu (phút)</label>
            <v-text-field v-model.number="wf.minGapMinutes" type="number" density="compact" variant="outlined" hide-details />
          </div>
          <div>
            <label class="fb-label">Trần số tin</label>
            <v-text-field v-model.number="wf.maxMessages" type="number" density="compact" variant="outlined" hide-details />
          </div>
        </div>

        <h4 class="fb-h4">Điều kiện dừng</h4>
        <v-checkbox v-model="wf.stopOnPurchase" label="Dừng khi khách đã mua" density="compact" hide-details />
        <label class="fb-label">Dừng nếu có tag</label>
        <v-combobox v-model="wf.stopOnTags" multiple chips closable-chips density="compact" variant="outlined" hide-details placeholder="vd: Không làm phiền, Đã mua" />
      </div>

      <!-- Các bước -->
      <div class="fb-col fb-steps">
        <div class="fb-steps-head">
          <h3 class="fb-h3">Các bước</h3>
          <v-menu>
            <template #activator="{ props }">
              <v-btn v-bind="props" size="small" color="primary" variant="tonal" prepend-icon="mdi-plus">Thêm bước</v-btn>
            </template>
            <v-list density="compact">
              <v-list-item v-for="t in addableTypes" :key="t.type" :title="t.label" :prepend-icon="t.icon" @click="addStep(t.type)" />
            </v-list>
          </v-menu>
        </div>

        <div class="fb-steplist">
          <div v-for="(s, i) in steps" :key="s.key" class="fb-step" :class="'ty-' + s.type">
            <div class="fb-step-head">
              <v-icon size="18" :color="stepColor(s.type)">{{ stepIcon(s.type) }}</v-icon>
              <span class="fb-step-title">{{ stepTitle(s.type) }}</span>
              <span class="fb-step-key">#{{ i + 1 }}</span>
              <div class="fb-spacer" />
              <v-btn v-if="canMove(s)" size="x-small" variant="text" icon="mdi-arrow-up" :disabled="i === 0" @click="move(i, -1)" />
              <v-btn v-if="canMove(s)" size="x-small" variant="text" icon="mdi-arrow-down" :disabled="i === steps.length - 1" @click="move(i, 1)" />
              <v-btn v-if="s.type !== 'start' && s.type !== 'end'" size="x-small" variant="text" icon="mdi-delete-outline" color="error" @click="removeStep(i)" />
            </div>

            <!-- config editors -->
            <div v-if="s.type === 'send'" class="fb-step-cfg">
              <v-textarea v-model="s.config.content" label="Nội dung tin (biến {{name}}, {{phone}})" rows="3" auto-grow density="compact" variant="outlined" hide-details />
            </div>
            <div v-else-if="s.type === 'wait'" class="fb-step-cfg fb-row2">
              <v-text-field v-model.number="s.config.amount" type="number" label="Số lượng" density="compact" variant="outlined" hide-details />
              <v-select v-model="s.config.unit" :items="waitUnits" label="Đơn vị" density="compact" variant="outlined" hide-details />
            </div>
            <div v-else-if="s.type === 'condition'" class="fb-step-cfg">
              <v-select v-model="s.config.check" :items="conditionChecks" label="Kiểm tra" density="compact" variant="outlined" hide-details />
              <v-text-field v-if="s.config.check === 'has_tag' || s.config.check === 'no_tag'" v-model="s.config.tag" label="Tag" density="compact" variant="outlined" hide-details class="mt-2" />
              <div class="fb-row2 mt-2">
                <v-select v-model="s.config.trueKey" :items="branchOptions(s.key)" label="Nếu ĐÚNG → bước" density="compact" variant="outlined" hide-details />
                <v-select v-model="s.config.falseKey" :items="branchOptions(s.key)" label="Nếu SAI → bước" density="compact" variant="outlined" hide-details />
              </div>
            </div>
            <div v-else-if="s.type === 'tag_add' || s.type === 'tag_remove'" class="fb-step-cfg">
              <v-text-field v-model="s.config.tag" label="Tag" density="compact" variant="outlined" hide-details />
            </div>
            <div v-else-if="s.type === 'sale_task'" class="fb-step-cfg">
              <v-text-field v-model="s.config.title" label="Tiêu đề công việc" density="compact" variant="outlined" hide-details />
              <v-text-field v-model="s.config.note" label="Ghi chú (tuỳ chọn)" density="compact" variant="outlined" hide-details class="mt-2" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══════════ TAB THEO DÕI ══════════ -->
    <div v-show="tab === 'track'" class="fb-track">
      <div class="fb-stats">
        <div class="fb-stat" v-for="st in statCards" :key="st.key"><div class="fb-stat-num">{{ st.val }}</div><div class="fb-stat-lbl">{{ st.label }}</div></div>
      </div>
      <v-table density="compact" class="fu-table mt-3">
        <thead><tr><th>Khách hàng</th><th>SĐT</th><th>Trạng thái</th><th class="text-center">Đã gửi</th><th>Cập nhật</th><th></th></tr></thead>
        <tbody>
          <tr v-for="e in enrollments" :key="e.id">
            <td class="fu-name">{{ e.contactName }}</td>
            <td class="text-grey">{{ e.phone || '—' }}</td>
            <td><span class="fu-status" :class="'en-' + e.status">{{ enrollStatusLabel(e.status) }}</span><span v-if="e.saleTaskTitle" class="fb-task"> · {{ e.saleTaskTitle }}</span></td>
            <td class="text-center">{{ e.messagesSent }}</td>
            <td class="text-grey">{{ fmtDateTime(e.updatedAt) }}</td>
            <td class="text-right">
              <v-btn v-if="isActiveEnroll(e.status)" size="x-small" variant="text" color="error" @click="stopEnroll(e.id)">Dừng</v-btn>
              <v-btn v-if="e.status === 'waiting_sale'" size="x-small" variant="text" color="primary" @click="completeTask(e.id)">Xong việc</v-btn>
            </td>
          </tr>
          <tr v-if="!enrollments.length"><td colspan="6" class="text-center text-grey py-6">Chưa có khách nào trong chiến dịch này.</td></tr>
        </tbody>
      </v-table>
    </div>

    <!-- Dry-run dialog -->
    <v-dialog v-model="dryOpen" max-width="560">
      <v-card>
        <v-card-title>Chạy thử chiến dịch (mô phỏng — không gửi tin)</v-card-title>
        <v-card-text>
          <v-autocomplete
            v-model="dryContactId" :items="contactOptions" :loading="contactLoading"
            v-model:search="contactSearch" item-title="label" item-value="id"
            label="Chọn khách hàng" placeholder="Gõ tên hoặc SĐT để tìm"
            density="compact" variant="outlined" hide-details no-filter
          >
            <template #no-data>
              <div class="pa-3 text-caption text-grey">
                {{ contactLoading ? 'Đang tìm…' : 'Không tìm thấy khách hàng phù hợp.' }}
              </div>
            </template>
          </v-autocomplete>
          <v-btn class="mt-3" color="primary" size="small" :disabled="!dryContactId" :loading="dryLoading" @click="runDry">Mô phỏng</v-btn>
          <div v-if="dryResult" class="fb-dry mt-4">
            <div v-for="(st, i) in dryResult.steps" :key="i" class="fb-dry-step">
              <v-icon size="16" :color="stepColor(st.type)">{{ stepIcon(st.type) }}</v-icon>
              <span>{{ st.label }}</span>
              <span v-if="st.note" class="fb-dry-note">— {{ st.note }}</span>
            </div>
            <div class="fb-dry-end">▶ {{ dryResult.endReason }}</div>
          </div>

          <!-- Mô phỏng KHÔNG đánh giá Mục tiêu → bù bằng kiểm tra logic tĩnh. -->
          <div v-if="dryResult?.warnings?.length" class="mt-4">
            <v-alert
              v-for="(w, i) in dryResult.warnings" :key="i"
              :type="w.level === 'error' ? 'error' : 'warning'"
              variant="tonal" density="compact" class="mb-2"
            >
              <b v-if="w.stepKey">Bước {{ w.stepKey }}: </b>{{ w.message }}
            </v-alert>
          </div>
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn @click="dryOpen = false">Đóng</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </div>
  <v-progress-linear v-else indeterminate color="primary" />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';

interface StepUI { key: string; type: string; label?: string | null; config: Record<string, any> }

const route = useRoute();
const router = useRouter();
const toast = useToast();

const wf = ref<any>(null);
const steps = ref<StepUI[]>([]);
const tab = ref<'design' | 'track'>('design');
const saving = ref(false);
let keyCounter = 1;

const typeOptions = [
  { title: 'Giới thiệu doanh nghiệp', value: 'intro' }, { title: 'Follow-up sau báo giá', value: 'after_quote' },
  { title: 'Chăm sóc khách hàng', value: 'care' }, { title: 'Nhắc mua lại', value: 'rebuy' },
  { title: 'Chăm sóc sau bán', value: 'post_sale' }, { title: 'Khuyến mại', value: 'promo' },
  { title: 'KH lâu không tương tác', value: 'reengage' },
  { title: 'Chúc mừng sinh nhật (tự chạy hằng ngày)', value: 'birthday' },
  { title: 'Tùy chỉnh', value: 'custom' },
];
const goalOptions = [
  { title: 'Không đặt mục tiêu', value: 'none' }, { title: 'Khách phản hồi', value: 'replied' },
  { title: 'Khách đã mua', value: 'purchased' }, { title: 'Có tag cụ thể', value: 'has_tag' },
];
const waitUnits = [{ title: 'Giờ', value: 'hour' }, { title: 'Ngày', value: 'day' }, { title: 'Tuần', value: 'week' }];
const conditionChecks = [
  { title: 'Đã phản hồi', value: 'replied' }, { title: 'Chưa phản hồi', value: 'not_replied' },
  { title: 'Đã là bạn', value: 'is_friend' }, { title: 'Chưa là bạn', value: 'not_friend' },
  { title: 'Có tag', value: 'has_tag' }, { title: 'Không có tag', value: 'no_tag' },
];
const addableTypes = [
  { type: 'send', label: 'Gửi tin nhắn', icon: 'mdi-send' },
  { type: 'wait', label: 'Chờ', icon: 'mdi-timer-sand' },
  { type: 'condition', label: 'Điều kiện', icon: 'mdi-source-branch' },
  { type: 'tag_add', label: 'Gắn Tag', icon: 'mdi-tag-plus-outline' },
  { type: 'tag_remove', label: 'Xóa Tag', icon: 'mdi-tag-minus-outline' },
  { type: 'sale_task', label: 'Công việc cho Sale', icon: 'mdi-account-clock-outline' },
];
const STATUS_LABELS: Record<string, string> = { draft: 'Nháp', active: 'Đang chạy', paused: 'Tạm dừng', archived: 'Lưu trữ' };
const ENROLL_LABELS: Record<string, string> = { running: 'Đang chạy', waiting: 'Đang chờ', waiting_sale: 'Chờ Sale', completed: 'Hoàn thành', stopped: 'Đã dừng', goal_reached: 'Đạt Goal' };
function statusLabel(s: string) { return STATUS_LABELS[s] ?? s; }
function enrollStatusLabel(s: string) { return ENROLL_LABELS[s] ?? s; }
function isActiveEnroll(s: string) { return ['running', 'waiting', 'waiting_sale'].includes(s); }

const nextWfList = ref<Array<{ id: string; name: string }>>([]);
const nextWfOptions = computed(() => nextWfList.value.filter((w) => w.id !== wf.value?.id).map((w) => ({ title: w.name, value: w.id })));

function stepIcon(t: string) { return ({ start: 'mdi-flag-outline', send: 'mdi-send', wait: 'mdi-timer-sand', condition: 'mdi-source-branch', tag_add: 'mdi-tag-plus-outline', tag_remove: 'mdi-tag-minus-outline', sale_task: 'mdi-account-clock-outline', end: 'mdi-flag-checkered' } as Record<string, string>)[t] ?? 'mdi-circle-small'; }
function stepColor(t: string) { return ({ start: 'green', send: 'primary', wait: 'orange', condition: 'purple', tag_add: 'teal', tag_remove: 'blue-grey', sale_task: 'deep-orange', end: 'grey' } as Record<string, string>)[t] ?? 'grey'; }
function stepTitle(t: string) { return ({ start: 'Bắt đầu', send: 'Gửi tin nhắn', wait: 'Chờ', condition: 'Điều kiện', tag_add: 'Gắn Tag', tag_remove: 'Xóa Tag', sale_task: 'Công việc cho Sale', end: 'Kết thúc' } as Record<string, string>)[t] ?? t; }
function canMove(s: StepUI) { return s.type !== 'start' && s.type !== 'end'; }
function branchOptions(selfKey: string) {
  return steps.value.filter((s) => s.key !== selfKey && s.type !== 'start').map((s) => ({ title: `#${steps.value.indexOf(s) + 1} ${stepTitle(s.type)}`, value: s.key }));
}

function minToTime(m: number) { const h = Math.floor((m ?? 0) / 60); const mm = (m ?? 0) % 60; return `${h.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`; }
function timeToMin(v: string) { const [h, m] = (v || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function fmtDateTime(iso: string) { const d = new Date(iso); return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')} ${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`; }

// ── Steps ops ──
function addStep(type: string) {
  const step: StepUI = { key: `s${keyCounter++}`, type, config: defaultConfig(type) };
  const endIdx = steps.value.findIndex((s) => s.type === 'end');
  if (endIdx >= 0) steps.value.splice(endIdx, 0, step); else steps.value.push(step);
}
function defaultConfig(type: string): Record<string, any> {
  if (type === 'send') return { content: '' };
  if (type === 'wait') return { amount: 1, unit: 'day' };
  if (type === 'condition') return { check: 'not_replied', tag: '', trueKey: null, falseKey: null };
  if (type === 'tag_add' || type === 'tag_remove') return { tag: '' };
  if (type === 'sale_task') return { title: 'Gọi điện cho khách', note: '' };
  return {};
}
function removeStep(i: number) { steps.value.splice(i, 1); }
function move(i: number, dir: number) {
  const j = i + dir;
  if (j < 0 || j >= steps.value.length) return;
  const a = steps.value[i]; steps.value[i] = steps.value[j]; steps.value[j] = a;
}

// ── Load / Save ──
async function load() {
  const id = route.params.id as string;
  try {
    const [res, act] = await Promise.all([
      api.get(`/followup/workflows/${id}`),
      api.get('/followup/active').catch(() => ({ data: { workflows: [] } })),
    ]);
    const w = res.data.workflow;
    w.stopOnTags = Array.isArray(w.stopOnTags) ? w.stopOnTags : [];
    wf.value = w;
    nextWfList.value = act.data.workflows ?? [];
    steps.value = (w.steps ?? []).sort((a: any, b: any) => a.orderIndex - b.orderIndex).map((s: any) => ({
      key: s.key, type: s.type, label: s.label, config: (s.config && typeof s.config === 'object') ? { ...s.config } : {},
    }));
    // đảm bảo có start + end
    if (!steps.value.some((s) => s.type === 'start')) steps.value.unshift({ key: 'start', type: 'start', config: {} });
    if (!steps.value.some((s) => s.type === 'end')) steps.value.push({ key: 'end', type: 'end', config: {} });
    const maxN = steps.value.reduce((m, s) => { const n = /^s(\d+)$/.exec(s.key); return n ? Math.max(m, Number(n[1])) : m; }, 0);
    keyCounter = maxN + 1;
    loadStats(); loadEnrollments();
  } catch {
    toast.error('Không tải được chiến dịch');
  }
}

function buildStepsPayload() {
  return steps.value.map((s, i) => {
    let nextKey: string | null = null;
    if (s.type !== 'end' && s.type !== 'condition') nextKey = steps.value[i + 1]?.key ?? null;
    return { key: s.key, type: s.type, orderIndex: i, label: s.label ?? null, config: s.config ?? {}, nextKey };
  });
}

async function save() {
  saving.value = true;
  try {
    const payload = {
      name: wf.value.name, type: wf.value.type,
      goalType: wf.value.goalType, goalTag: wf.value.goalTag, goalTagOnReach: wf.value.goalTagOnReach,
      nextWorkflowId: wf.value.nextWorkflowId,
      sendWindowStart: wf.value.sendWindowStart, sendWindowEnd: wf.value.sendWindowEnd,
      minGapMinutes: wf.value.minGapMinutes, maxMessages: wf.value.maxMessages,
      stopOnPurchase: wf.value.stopOnPurchase, stopOnTags: wf.value.stopOnTags,
      steps: buildStepsPayload(),
    };
    const res = await api.put(`/followup/workflows/${wf.value.id}`, payload);
    if (res.data.workflow?.newVersion) {
      toast.success('Đã tạo phiên bản mới (bản cũ vẫn phục vụ KH đang chạy)');
      router.replace({ name: 'CE.FollowupBuilder', params: { id: res.data.workflow.id } });
      wf.value = res.data.workflow;
    } else {
      toast.success('Đã lưu');
    }
  } catch {
    toast.error('Lưu thất bại');
  } finally {
    saving.value = false;
  }
}

async function setStatus(status: string) {
  try {
    await api.post(`/followup/workflows/${wf.value.id}/status`, { status });
    wf.value.status = status;
    toast.success(status === 'active' ? 'Đã kích hoạt chiến dịch' : 'Đã tạm dừng');
  } catch { toast.error('Không đổi được trạng thái'); }
}

// ── Stats + enrollments ──
const stats = ref<any>({});
const enrollments = ref<any[]>([]);
const statCards = computed(() => [
  { key: 'running', label: 'Đang chạy', val: stats.value.running ?? 0 },
  { key: 'waiting', label: 'Đang chờ', val: stats.value.waiting ?? 0 },
  { key: 'waitingSale', label: 'Chờ Sale', val: stats.value.waitingSale ?? 0 },
  { key: 'completed', label: 'Hoàn thành', val: stats.value.completed ?? 0 },
  { key: 'stopped', label: 'Đã dừng', val: stats.value.stopped ?? 0 },
  { key: 'goalReached', label: 'Đạt Goal', val: stats.value.goalReached ?? 0 },
]);
async function loadStats() { try { const r = await api.get(`/followup/workflows/${wf.value.id}/stats`); stats.value = r.data.stats ?? {}; } catch { /* */ } }
async function loadEnrollments() { try { const r = await api.get(`/followup/workflows/${wf.value.id}/enrollments`); enrollments.value = r.data.enrollments ?? []; } catch { /* */ } }
async function stopEnroll(id: string) { try { await api.post(`/followup/enrollments/${id}/stop`); toast.success('Đã dừng'); loadStats(); loadEnrollments(); } catch { toast.error('Lỗi'); } }
async function completeTask(id: string) { try { await api.post(`/followup/enrollments/${id}/complete-task`); toast.success('Đã tiếp tục workflow'); loadStats(); loadEnrollments(); } catch { toast.error('Lỗi'); } }
watch(tab, (t) => { if (t === 'track') { loadStats(); loadEnrollments(); } });

// ── Dry-run ──
const dryOpen = ref(false);
const dryContactId = ref<string | null>(null);
const dryResult = ref<any>(null);
const dryLoading = ref(false);
const contactSearch = ref('');
const contactOptions = ref<Array<{ id: string; label: string }>>([]);
const contactLoading = ref(false);
let searchTimer: any;
/** Nạp danh sách KH (rỗng search = danh sách mặc định để dialog không trống trơn). */
async function fetchContacts(q = '') {
  contactLoading.value = true;
  try {
    const r = await api.get('/contacts', { params: { ...(q ? { search: q } : {}), limit: 20 } });
    const list = r.data.contacts ?? r.data.items ?? r.data.data ?? [];
    contactOptions.value = list.map((c: any) => ({
      id: c.id,
      label: `${c.fullName || c.crmName || '(Không tên)'}${c.phone ? ' · ' + c.phone : ''}`,
    }));
  } catch {
    contactOptions.value = [];
  } finally {
    contactLoading.value = false;
  }
}
watch(contactSearch, (q) => {
  clearTimeout(searchTimer);
  // Bỏ qua khi search bằng đúng nhãn vừa chọn (Vuetify set search = item-title sau khi chọn).
  if (contactOptions.value.some((c) => c.label === q)) return;
  searchTimer = setTimeout(() => fetchContacts((q ?? '').trim()), 300);
});
function openDryRun() {
  dryResult.value = null;
  dryContactId.value = null;
  dryOpen.value = true;
  fetchContacts(); // nạp sẵn danh sách ngay khi mở
}
async function runDry() {
  if (!dryContactId.value) return;
  dryLoading.value = true;
  try {
    const r = await api.post(`/followup/workflows/${wf.value.id}/simulate`, { contactId: dryContactId.value });
    dryResult.value = r.data;
  } catch { toast.error('Chạy thử thất bại'); } finally { dryLoading.value = false; }
}

function goBack() { router.push({ name: 'CE.Followup' }); }
onMounted(load);
</script>

<style scoped>
.fb-wrap { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.fb-top { display: flex; align-items: center; gap: 10px; padding: 10px 18px; border-bottom: 1px solid var(--smax-grey-200, #ebedf0); background: var(--smax-bg, #fff); }
.fb-name-input { font-size: 17px; font-weight: 700; border: none; outline: none; min-width: 240px; color: var(--smax-text, #212121); background: transparent; }
.fb-name-input:focus { border-bottom: 2px solid var(--smax-primary, #1786be); }
.fb-ver { font-size: 11px; color: var(--smax-grey-700); }
.fb-spacer { flex: 1; }
.fb-tabs { border-bottom: 1px solid var(--smax-grey-200, #ebedf0); flex-shrink: 0; padding: 0 12px; }
.fb-body { flex: 1; display: grid; grid-template-columns: 340px 1fr; gap: 16px; padding: 16px; overflow: hidden; }
.fb-col { background: var(--smax-bg, #fff); border-radius: 12px; box-shadow: 0 1px 3px rgba(15,23,42,.06); padding: 16px; overflow-y: auto; }
.fb-h3 { font-size: 15px; font-weight: 700; margin-bottom: 10px; }
.fb-h4 { font-size: 13px; font-weight: 700; margin: 16px 0 6px; color: var(--smax-grey-700); }
.fb-label { display: block; font-size: 12px; font-weight: 600; color: var(--smax-grey-700); margin: 10px 0 4px; }
.fb-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.fb-time { width: 100%; padding: 7px 10px; border: 1px solid var(--smax-grey-300, #d4d8de); border-radius: 6px; font-size: 14px; }
.fb-steps-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.fb-steplist { display: flex; flex-direction: column; gap: 10px; }
.fb-step { border: 1px solid var(--smax-grey-200, #ebedf0); border-radius: 10px; padding: 10px 12px; background: var(--smax-grey-50, #fafbfc); }
.fb-step-head { display: flex; align-items: center; gap: 8px; }
.fb-step-title { font-weight: 600; font-size: 13.5px; }
.fb-step-key { font-size: 11px; color: var(--smax-grey-700); background: #fff; border-radius: 6px; padding: 1px 6px; }
.fb-step-cfg { margin-top: 10px; }
.fb-track { flex: 1; overflow-y: auto; padding: 16px; }
.fb-stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
.fb-stat { background: var(--smax-bg, #fff); border-radius: 12px; box-shadow: 0 1px 3px rgba(15,23,42,.06); padding: 14px; text-align: center; }
.fb-stat-num { font-size: 24px; font-weight: 700; color: var(--smax-primary, #1786be); }
.fb-stat-lbl { font-size: 12px; color: var(--smax-grey-700); margin-top: 2px; }
.fu-table { background: var(--smax-bg, #fff); border-radius: 12px; box-shadow: 0 1px 3px rgba(15,23,42,.06); }
.fu-name { font-weight: 600; }
.fu-status { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
.st-draft { background: #eceff1; color: #607d8b; } .st-active { background: rgba(0,200,83,.14); color: #1b8a4d; }
.st-paused { background: rgba(255,145,0,.14); color: #ef6c00; } .st-archived { background: #eceff1; color: #90a4ae; }
.en-running { background: rgba(0,200,83,.14); color: #1b8a4d; } .en-waiting { background: rgba(33,150,243,.14); color: #1565c0; }
.en-waiting_sale { background: rgba(255,145,0,.14); color: #ef6c00; } .en-completed { background: #eceff1; color: #607d8b; }
.en-stopped { background: #fce4ec; color: #ad1457; } .en-goal_reached { background: rgba(103,58,183,.14); color: #5e35b1; }
.fb-task { font-size: 11px; color: var(--smax-grey-700); }
.fb-dry { background: var(--smax-grey-50, #fafbfc); border-radius: 8px; padding: 12px; }
.fb-dry-step { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 3px 0; }
.fb-dry-note { color: var(--smax-grey-700); font-size: 12px; }
.fb-dry-end { margin-top: 8px; font-weight: 700; color: var(--smax-primary, #1786be); font-size: 13px; }
</style>
