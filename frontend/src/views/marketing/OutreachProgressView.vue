<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="op-page" v-if="campaign">
    <div class="op-head">
      <button class="op-back" @click="$router.push('/marketing/campaigns')">← Danh sách</button>
      <h1>{{ campaign.name }}</h1>
      <span class="op-badge" :class="campaign.state">{{ stateLabel(campaign.state) }}</span>
      <span class="op-run">Lần chạy: {{ campaign.runCount || 0 }}</span>
    </div>

    <!-- Tiến độ + điều khiển -->
    <div class="op-card op-progress">
      <div class="op-bar-wrap">
        <div class="op-bar"><div class="op-bar-fill" :style="{ width: pct + '%' }" /></div>
        <div class="op-bar-label">{{ pct }}%</div>
      </div>
      <div class="op-controls">
        <button v-if="campaign.state === 'draft'" class="op-btn primary" @click="doControl('start')">Bắt đầu</button>
        <button v-if="campaign.state === 'running'" class="op-btn" @click="doControl('pause')">Tạm dừng</button>
        <button v-if="campaign.state === 'paused'" class="op-btn primary" @click="doControl('resume')">Tiếp tục</button>
        <button v-if="['running','paused','draft'].includes(campaign.state)" class="op-btn danger" @click="doControl('cancel')">Huỷ</button>
        <!-- Chạy lại từ đầu — chỉ khi Hoàn thành / Đã dừng -->
        <button v-if="['completed','cancelled'].includes(campaign.state)" class="op-btn primary" @click="showRestart = true">Chạy lại từ đầu</button>
      </div>
    </div>

    <!-- Summary realtime -->
    <div class="op-summary">
      <button class="op-sum" :class="{ on: filter.status === '' }" @click="setStatus('')">
        <span class="n">{{ summary.total.toLocaleString('vi') }}</span><span class="l">Tổng số</span>
      </button>
      <button class="op-sum ok" :class="{ on: filter.status === 'success' }" @click="setStatus('success')">
        <span class="n">{{ summary.success.toLocaleString('vi') }}</span><span class="l">Thành công</span>
      </button>
      <button class="op-sum proc" :class="{ on: filter.status === 'processing' }" @click="setStatus('processing')">
        <span class="n">{{ summary.processing.toLocaleString('vi') }}</span><span class="l">Đang xử lý</span>
      </button>
      <button class="op-sum wait" :class="{ on: filter.status === 'waiting' }" @click="setStatus('waiting')">
        <span class="n">{{ summary.waiting.toLocaleString('vi') }}</span><span class="l">Chờ lượt</span>
      </button>
      <button class="op-sum skip" :class="{ on: filter.status === 'skipped' }" @click="setStatus('skipped')">
        <span class="n">{{ summary.skipped.toLocaleString('vi') }}</span><span class="l">Bỏ qua</span>
      </button>
    </div>

    <!-- Bảng 1 SỐ = 1 DÒNG -->
    <div class="op-card">
      <div class="op-toolbar">
        <input v-model="filter.search" class="op-search" placeholder="Tìm số điện thoại…" @input="debouncedReload" />
        <div class="op-spacer" />
        <button class="op-sort" @click="toggleSort">
          Sắp xếp: {{ filter.sort === 'phone' ? 'SĐT' : 'Cập nhật mới nhất' }}
        </button>
        <span class="op-total">{{ pagination.total.toLocaleString('vi') }} số</span>
      </div>
      <div class="op-tablewrap">
        <table class="op-ptable">
          <thead>
            <tr>
              <th>Số điện thoại</th>
              <th>Trạng thái</th>
              <th>Kết bạn</th>
              <th>Nhắn tin</th>
              <th>Cập nhật</th>
              <th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in phones" :key="p.entryId">
              <td class="op-mono">{{ p.phone }}</td>
              <td><span class="op-ov" :class="p.overallStatus">{{ overallLabel(p.overallStatus) }}</span></td>
              <td><span class="op-cell" :class="'f-' + p.friendStatus">{{ friendLabel(p.friendStatus) }}</span></td>
              <td><span class="op-cell" :class="'m-' + p.messageStatus">{{ msgLabel(p.messageStatus) }}</span></td>
              <td class="op-dim">{{ p.updatedAt ? fmtTime(p.updatedAt) : '—' }}</td>
              <td class="op-note">{{ p.note || '—' }}</td>
            </tr>
            <tr v-if="!phones.length"><td colspan="6" class="op-empty">Chưa có số nào.</td></tr>
          </tbody>
        </table>
      </div>
      <div class="op-pag" v-if="totalPages > 1">
        <span>Trang {{ pagination.page }}/{{ totalPages }}</span>
        <button :disabled="pagination.page === 1" @click="goPage(pagination.page - 1)">← Trước</button>
        <button :disabled="pagination.page >= totalPages" @click="goPage(pagination.page + 1)">Sau →</button>
      </div>
    </div>

    <!-- Lịch sử chạy -->
    <div class="op-card op-runs" v-if="runs.length">
      <h3>Lịch sử chạy</h3>
      <div class="op-run-row" v-for="r in runs" :key="r.id">
        <span class="op-run-n">Lần chạy {{ r.runNumber }}</span>
        <span class="op-rstate" :class="r.state">{{ runStateLabel(r.state) }}</span>
        <span class="op-run-by" v-if="r.startedByName">{{ r.startedByName }}</span>
        <span class="op-run-time">Bắt đầu {{ fmtDateTime(r.startedAt) }}<template v-if="r.completedAt"> · Kết thúc {{ fmtDateTime(r.completedAt) }}</template></span>
      </div>
    </div>

    <!-- Dialog xác nhận chạy lại -->
    <div v-if="showRestart" class="op-modal-overlay" @click.self="showRestart = false">
      <div class="op-modal">
        <div class="op-modal-head"><h3>Xác nhận chạy lại chiến dịch</h3></div>
        <div class="op-modal-body">
          <p>Bạn sắp chạy lại toàn bộ chiến dịch này.</p>
          <p>Toàn bộ trạng thái xử lý sẽ được đặt lại và chiến dịch sẽ bắt đầu chạy lại từ đầu.</p>
          <p><b>Thứ tự xử lý:</b></p>
          <ul>
            <li>Ưu tiên số có thời gian chat cũ nhất.</li>
            <li>Nếu chưa từng chat thì xử lý sau cùng.</li>
          </ul>
          <p>Bạn có chắc chắn muốn tiếp tục không?</p>
        </div>
        <div class="op-modal-foot">
          <button class="op-btn" @click="showRestart = false">Hủy</button>
          <button class="op-btn primary" :disabled="restarting" @click="doRestart">{{ restarting ? 'Đang chạy lại…' : 'Chạy lại' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { useOutreach, useOutreachSocket, useOutreachPhoneSocket, type OutreachCampaign, type OutreachPhone, type PhoneSummary, type OutreachRun } from '@/composables/use-outreach';
import { useToast } from '@/composables/use-toast';

const route = useRoute();
const toast = useToast();
const { getCampaign, control, restart, getRuns, getPhones } = useOutreach();

const id = route.params.id as string;
const campaign = ref<OutreachCampaign | null>(null);
const phones = ref<OutreachPhone[]>([]);
const runs = ref<OutreachRun[]>([]);
const summary = reactive<PhoneSummary>({ total: 0, success: 0, waiting: 0, processing: 0, skipped: 0 });
const pagination = reactive({ page: 1, limit: 50, total: 0 });
const filter = reactive({ search: '', status: '' as '' | 'success' | 'waiting' | 'processing' | 'skipped', sort: 'updatedAt' as 'updatedAt' | 'phone' });
const showRestart = ref(false);
const restarting = ref(false);

const totalPages = computed(() => Math.max(1, Math.ceil(pagination.total / pagination.limit)));
const pct = computed(() => {
  if (summary.total === 0) return 0;
  return Math.round(((summary.success + summary.skipped) / summary.total) * 1000) / 10;
});

async function loadCampaign() { campaign.value = await getCampaign(id); }
async function loadRuns() { runs.value = await getRuns(id); }
async function loadPhones() {
  const r = await getPhones(id, {
    page: pagination.page, limit: pagination.limit,
    search: filter.search || undefined, status: filter.status || undefined, sort: filter.sort,
  });
  phones.value = r.phones;
  pagination.total = r.pagination.total;
  Object.assign(summary, r.summary);
}

function setStatus(s: '' | 'success' | 'waiting' | 'processing' | 'skipped') { filter.status = s; pagination.page = 1; loadPhones(); }
function toggleSort() { filter.sort = filter.sort === 'updatedAt' ? 'phone' : 'updatedAt'; loadPhones(); }
function goPage(p: number) { pagination.page = p; loadPhones(); }

let searchTimer: ReturnType<typeof setTimeout>;
function debouncedReload() { clearTimeout(searchTimer); searchTimer = setTimeout(() => { pagination.page = 1; loadPhones(); }, 300); }

async function doControl(action: 'start' | 'pause' | 'resume' | 'cancel') {
  try {
    await control(id, action);
    toast.success('Đã ' + ({ start: 'bắt đầu', pause: 'tạm dừng', resume: 'tiếp tục', cancel: 'huỷ' }[action]));
    await Promise.all([loadCampaign(), loadRuns(), loadPhones()]);
  } catch (e: any) { toast.error(e?.response?.data?.error || 'Lỗi điều khiển', 5000); }
}

async function doRestart() {
  restarting.value = true;
  try {
    await restart(id);
    toast.success('Đã khởi động lại chiến dịch thành công.');
    showRestart.value = false;
    await Promise.all([loadCampaign(), loadRuns(), loadPhones()]);
  } catch (e: any) {
    toast.error(e?.response?.data?.message || e?.response?.data?.error || 'Không chạy lại được chiến dịch', 5000);
  } finally { restarting.value = false; }
}

// ── Nhãn hiển thị ──
function stateLabel(s: string) { return ({ draft: 'Nháp', running: 'Đang chạy', paused: 'Đã dừng', completed: 'Hoàn thành', cancelled: 'Đã dừng', failed: 'Lỗi' } as any)[s] || s; }
function overallLabel(s: string) { return ({ success: 'Thành công', processing: 'Đang xử lý', waiting: 'Chờ lượt', skipped: 'Bỏ qua' } as any)[s] || s; }
function runStateLabel(s: string) { return ({ running: 'Đang chạy', completed: 'Hoàn thành', cancelled: 'Đã dừng' } as any)[s] || s; }
function fmtDateTime(iso: string) { const d = new Date(iso); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function friendLabel(s: string) { return ({ success: '✅', already_friend: '🤝 Đã là bạn', waiting: '⏳', failed: '❌', none: '–' } as any)[s] || '–'; }
function msgLabel(s: string) { return ({ sent: '✅ Đã gửi', waiting: '⏳', failed: '❌', none: '–' } as any)[s] || '–'; }
function fmtTime(iso: string) { const d = new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; }

// ── Realtime ──
// Cập nhật campaign state (progress). Phone events → patch dòng tại chỗ + debounced reload
// (để đúng thứ tự/filter/summary toàn tập).
useOutreachSocket((p) => { if (p.campaignId === id && campaign.value) Object.assign(campaign.value, p); });

let reloadTimer: ReturnType<typeof setTimeout> | null = null;
useOutreachPhoneSocket((p) => {
  if (p.campaignId !== id) return;
  // Patch tại chỗ nếu dòng đang hiển thị → cảm giác tức thì.
  const row = phones.value.find(x => x.entryId === p.entryId);
  if (row) {
    row.overallStatus = p.overallStatus; row.friendStatus = p.friendStatus;
    row.messageStatus = p.messageStatus; row.note = p.note; row.updatedAt = p.updatedAt;
  }
  // Debounced reload (700ms) → cập nhật summary toàn tập + thứ tự + filter.
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => loadPhones(), 700);
});

onMounted(async () => { await loadCampaign(); await loadPhones(); await loadRuns(); });
onUnmounted(() => { if (reloadTimer) clearTimeout(reloadTimer); });
</script>

<style scoped>
.op-page { padding: 18px 22px; max-width: 1080px; }
.op-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.op-head h1 { margin: 0; font-size: 19px; font-weight: 800; color: var(--ink); }
.op-back { background: none; border: none; color: var(--brand-700); font-weight: 600; cursor: pointer; font-family: inherit; font-size: 13px; }
.op-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-lg, 14px); box-shadow: var(--sh-sm); margin-bottom: 14px; }
.op-progress { padding: 14px 18px; display: flex; align-items: center; gap: 16px; }
.op-bar-wrap { flex: 1; display: flex; align-items: center; gap: 12px; }
.op-bar { flex: 1; height: 10px; background: var(--surface-3); border-radius: 999px; overflow: hidden; }
.op-bar-fill { height: 100%; background: linear-gradient(90deg, #2e90fa, #12b76a); transition: width .4s; border-radius: 999px; }
.op-bar-label { font-size: 13px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.op-controls { display: flex; gap: 8px; }
.op-btn { padding: 7px 14px; border: 1px solid var(--line); border-radius: var(--r-sm, 8px); background: var(--surface); color: var(--ink-2); font-weight: 600; font-size: 13px; cursor: pointer; font-family: inherit; }
.op-btn.primary { background: var(--brand); color: #fff; border-color: var(--brand); }
.op-btn.danger { background: var(--error); color: #fff; border-color: var(--error); }

/* Summary cards */
.op-summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 14px; }
.op-sum { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md, 10px); cursor: pointer; font-family: inherit; text-align: left; transition: border-color .12s, box-shadow .12s; }
.op-sum:hover { border-color: var(--brand); }
.op-sum.on { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand-soft); }
.op-sum .n { font-size: 22px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
.op-sum .l { font-size: 12px; color: var(--ink-3); }
.op-sum.ok .n { color: var(--success); }
.op-sum.proc .n { color: #b45309; }
.op-sum.wait .n { color: #1e40af; }
.op-sum.skip .n { color: var(--ink-3); }

/* Toolbar */
.op-toolbar { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.op-search { flex: 0 0 260px; padding: 7px 10px; border: 1px solid var(--line); border-radius: var(--r-sm, 8px); font-size: 13px; font-family: inherit; }
.op-spacer { flex: 1; }
.op-sort { padding: 6px 12px; border: 1px solid var(--line); border-radius: var(--r-sm, 8px); background: var(--surface); color: var(--ink-2); font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
.op-total { font-size: 12px; color: var(--ink-4); }

/* Table — compact + sticky header */
.op-tablewrap { max-height: 62vh; overflow: auto; }
.op-ptable { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
.op-ptable thead th { position: sticky; top: 0; z-index: 1; background: var(--surface-2); text-align: left; padding: 8px 12px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-4); border-bottom: 1px solid var(--line); white-space: nowrap; }
.op-ptable tbody td { padding: 7px 12px; border-bottom: 1px solid var(--line-2); color: var(--ink-2); vertical-align: middle; }
.op-ptable tbody tr:hover { background: var(--brand-softer); }
.op-mono { font-family: var(--mono, monospace); color: var(--ink); font-weight: 600; }
.op-dim { color: var(--ink-4); font-variant-numeric: tabular-nums; }
.op-note { color: var(--ink-3); max-width: 260px; }
.op-empty { text-align: center; color: var(--ink-4); padding: 28px; }

.op-ov { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
.op-ov.success { background: #dcfce7; color: #166534; }
.op-ov.processing { background: #fef3c7; color: #b45309; }
.op-ov.waiting { background: #dbeafe; color: #1e40af; }
.op-ov.skipped { background: #f1f5f9; color: #64748b; }
.op-cell { font-size: 12.5px; white-space: nowrap; }
.op-cell.f-failed, .op-cell.m-failed { color: var(--error); }
.op-cell.f-success, .op-cell.m-sent { color: var(--success); }
.op-cell.f-waiting, .op-cell.m-waiting { color: #b45309; }

.op-pag { display: flex; align-items: center; gap: 8px; padding: 10px 14px; font-size: 12.5px; color: var(--ink-3); border-top: 1px solid var(--line); }
.op-pag button { padding: 5px 11px; border: 1px solid var(--line); border-radius: var(--r-sm, 8px); background: var(--surface); cursor: pointer; font-family: inherit; font-size: 12.5px; }
.op-pag button:disabled { opacity: .5; cursor: not-allowed; }

.op-badge { padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; background: var(--surface-3); color: var(--ink-2); }
.op-badge.running { background: #dbeafe; color: #1e40af; }
.op-badge.paused { background: #fef3c7; color: #92400e; }
.op-badge.completed { background: #dcfce7; color: #166534; }
.op-badge.cancelled, .op-badge.failed { background: #fee2e2; color: #b91c1c; }

/* Lần chạy chip */
.op-run { padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; background: var(--surface-3); color: var(--ink-2); }

/* Lịch sử chạy */
.op-runs { padding: 14px 18px; }
.op-runs h3 { margin: 0 0 10px; font-size: 14px; font-weight: 800; color: var(--ink); }
.op-run-row { display: grid; grid-template-columns: 110px 100px 1fr auto; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line-2); font-size: 12.5px; }
.op-run-row:last-child { border-bottom: none; }
.op-run-n { font-weight: 700; color: var(--ink); }
.op-run-by { color: var(--ink-2); font-weight: 600; }
.op-run-time { color: var(--ink-3); text-align: right; font-variant-numeric: tabular-nums; }
.op-rstate { padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; justify-self: start; }
.op-rstate.running { background: #dbeafe; color: #1e40af; }
.op-rstate.completed { background: #dcfce7; color: #166534; }
.op-rstate.cancelled { background: #fee2e2; color: #b91c1c; }

/* Modal xác nhận */
.op-modal-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
.op-modal { background: var(--surface); border-radius: var(--r-lg, 14px); box-shadow: var(--sh-lg, 0 20px 50px rgba(0,0,0,.25)); max-width: 460px; width: 100%; padding: 22px 24px; }
.op-modal-head h3 { margin: 0 0 12px; font-size: 17px; font-weight: 800; color: var(--ink); }
.op-modal-body p { margin: 0 0 8px; font-size: 13.5px; line-height: 1.55; color: var(--ink-2); }
.op-modal-body ul { margin: 6px 0 12px; padding-left: 18px; }
.op-modal-body li { font-size: 13px; color: var(--ink-2); margin-bottom: 4px; }
.op-modal-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
</style>
