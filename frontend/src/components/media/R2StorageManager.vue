<template>
  <section class="storage-admin">
    <header class="page-head">
      <div>
        <h2>Quản lý lưu trữ <span class="driver-badge" :class="overview?.storageDriver">{{ overview?.storageDriver === 'r2' ? 'Cloudflare R2' : 'Local VPS' }}</span></h2>
        <p>Media hội thoại theo tài khoản Zalo và nhóm hội thoại.</p>
      </div>
      <div class="head-actions">
        <button class="secondary" :disabled="loading || reconciling || executing" @click="reconcileOldData">
          <ArchiveRestore :size="16" />{{ reconciling ? `Đối soát ${number(reconcileProgress)} tin...` : 'Đối soát dữ liệu cũ' }}
        </button>
        <button class="icon-button" title="Làm mới thống kê" :disabled="loading || reconciling" @click="refreshAll">
          <RefreshCw :size="17" :class="{ spin: loading }" />
        </button>
      </div>
    </header>

    <div v-if="loading && !overview" class="empty">Đang tổng hợp dữ liệu lưu trữ...</div>
    <template v-else-if="overview">
      <div class="scope-note">Số liệu là object có metadata trong CRM, không phải quota trực tiếp từ Cloudflare R2.</div>
      <div class="health-row"><span>{{ number(overview.orphanMetadata.files) }} object không còn liên kết metadata</span><span>{{ overview.latestReconciliation ? `Đối soát gần nhất: ${dateTime(overview.latestReconciliation.completedAt || overview.latestReconciliation.startedAt)}` : 'Chưa đối soát ledger' }}</span></div>
      <div class="metrics">
        <div><Database :size="18" /><span>Đã sử dụng</span><b>{{ size(overview.total.bytes) }}</b><small v-if="overview.capacityBytes">trên {{ size(overview.capacityBytes) }}</small></div>
        <div><HardDrive :size="18" /><span>Còn lại</span><b>{{ overview.remainingBytes == null ? 'Không đặt quota' : size(overview.remainingBytes) }}</b><small>{{ usagePercent }}% quota</small></div>
        <div><Files :size="18" /><span>Tổng số object</span><b>{{ number(overview.total.files) }}</b><small>{{ number(overview.unattributed.files) }} thiếu UID hoặc nhóm</small></div>
        <div><ArchiveRestore :size="18" /><span>Đã giải phóng</span><b>{{ size(overview.freedBytes) }}</b><small>{{ overview.storageDriver === 'r2' ? 'Cloudflare R2' : 'Storage local' }}</small></div>
      </div>
      <div v-if="overview.unattributed.files" class="warning"><AlertTriangle :size="16" />{{ number(overview.unattributed.files) }} object hội thoại thiếu UID hoặc nhóm, chiếm {{ size(overview.unattributed.bytes) }}.</div>

      <nav class="subtabs">
        <button v-for="item in tabs" :key="item.id" :class="{ active: tab === item.id }" :disabled="executing" @click="openTab(item.id)">
          <component :is="item.icon" :size="15" />{{ item.label }}
        </button>
      </nav>

      <section v-if="tab === 'overview'" class="dashboard">
        <div class="dashboard-grid">
          <div class="panel"><h3>10 nhóm dùng nhiều nhất</h3><RankTable :rows="overview.topGroups" name-label="Nhóm hội thoại" entity="group" @open="openEntity('group', $event)" /></div>
          <div class="panel"><h3>10 tài khoản dùng nhiều nhất</h3><RankTable :rows="overview.topAccounts" name-label="Tài khoản Zalo" entity="account" @open="openEntity('account', $event)" /></div>
        </div>
        <div class="dashboard-grid lower">
          <div class="panel">
            <h3>Dung lượng theo loại</h3>
            <div class="type-list"><div v-for="row in overview.fileTypes" :key="row.type"><span class="type-dot" :class="row.type" /><b>{{ kindLabel(row.type) }}</b><span>{{ number(row.files) }} object</span><strong>{{ size(row.bytes) }}</strong></div></div>
          </div>
          <div class="panel">
            <h3>Dung lượng tăng trong 30 ngày</h3>
            <div class="bars"><div v-for="row in overview.daily" :key="row.date" class="bar-wrap" :title="`${date(row.date)}: ${size(row.bytes)}`"><div class="bar" :style="{ height: `${barHeight(row.bytes)}%` }" /></div></div>
            <div class="chart-axis"><span>{{ date(overview.daily[0]?.date) }}</span><span>{{ date(overview.daily.at(-1)?.date) }}</span></div>
          </div>
        </div>
      </section>

      <section v-else-if="tab === 'groups' || tab === 'accounts'" class="panel entity-panel">
        <div class="table-head">
          <h3>{{ tab === 'groups' ? 'Danh sách nhóm hội thoại Zalo' : 'Danh sách tài khoản Zalo' }}</h3>
          <div class="filters">
            <label class="search-field"><Search :size="15" /><input v-model="entitySearch" :placeholder="tab === 'groups' ? 'Tìm tên nhóm' : 'Tìm tên hoặc UID'" @keyup.enter="searchEntities" /></label>
            <select v-model="entitySort" @change="searchEntities"><option value="bytes">Dung lượng giảm dần</option><option value="files">Số file giảm dần</option><option value="name">Tên A-Z</option></select>
          </div>
        </div>
        <div class="table-scroll"><table><thead><tr><th>{{ tab === 'groups' ? 'Nhóm' : 'Tài khoản / UID' }}</th><th v-if="tab === 'groups'">Số tài khoản</th><th>Dung lượng</th><th>Số file</th><th>Ảnh</th><th>Video</th><th>File</th><th>Ghi âm</th></tr></thead><tbody><tr v-for="row in entityRows" :key="row.id" class="click-row" @click="openEntity(tab === 'groups' ? 'group' : 'account', row.id)"><td><b>{{ row.name }}</b><small v-if="'uid' in row">{{ row.uid }}</small></td><td v-if="tab === 'groups'">{{ number((row as StorageGroupRow).accountCount) }}</td><td>{{ size(row.bytes) }}</td><td>{{ number(row.files) }}</td><td>{{ number(row.image) }}</td><td>{{ number(row.video) }}</td><td>{{ number(row.file) }}</td><td>{{ number(row.audio) }}</td></tr><tr v-if="!entityRows.length"><td :colspan="tab === 'groups' ? 8 : 7" class="empty-cell">Không có dữ liệu phù hợp.</td></tr></tbody></table></div>
        <Pager :page="entityPage" :pages="entityPages" :total="entityTotal" @change="changeEntityPage" />
      </section>

      <section v-else-if="tab === 'cleanup'" class="panel cleanup-panel">
        <div class="section-title"><h3>Dọn media tự lưu từ hội thoại</h3><ShieldCheck :size="22" /></div>
        <div class="cleanup-form">
          <label>Phạm vi<select v-model="targetType" :disabled="executing"><option value="all">Toàn bộ hệ thống</option><option value="group">Một nhóm hội thoại</option><option value="account">Một tài khoản Zalo</option></select></label>
          <label v-if="targetType !== 'all'">Tìm {{ targetType === 'group' ? 'nhóm' : 'tài khoản' }}<input v-model="selectorSearch" :placeholder="targetType === 'group' ? 'Tên nhóm' : 'Tên hoặc UID'" :disabled="executing" /></label>
          <label v-if="targetType === 'group'">Nhóm<select v-model="targetId" :disabled="executing"><option value="">Chọn nhóm</option><option v-for="row in selectorGroups" :key="row.id" :value="row.id">{{ row.name }}</option></select></label>
          <label v-if="targetType === 'account'">Tài khoản<select v-model="targetId" :disabled="executing"><option value="">Chọn tài khoản</option><option v-for="row in selectorAccounts" :key="row.id" :value="row.id">{{ row.name }} · {{ row.uid }}</option></select></label>
          <label>Xóa dữ liệu trước ngày<input v-model="beforeDate" type="date" :disabled="executing" /></label>
        </div>
        <div class="kind-options"><label v-for="kind in kinds" :key="kind.value"><input v-model="fileKinds" type="checkbox" :value="kind.value" :disabled="executing" /><component :is="kind.icon" :size="16" />{{ kind.label }}</label></div>
        <button class="primary" :disabled="!validCleanup || previewing || executing" @click="createPreview"><Search :size="16" />{{ previewing ? 'Đang lập snapshot...' : 'Thống kê trước khi xóa' }}</button>
        <div v-if="previewData" class="preview-box">
          <div class="preview-summary"><div><span>Liên kết chat bị gỡ</span><b>{{ number(previewData.linksToRemove) }}</b></div><div><span>Object xóa vật lý</span><b>{{ number(previewData.objectsToDelete) }}</b></div><div><span>Dung lượng chắc chắn giải phóng</span><b>{{ size(previewData.bytes) }}</b></div><div><span>Loại dữ liệu</span><b class="breakdown">{{ previewData.image }} ảnh · {{ previewData.video }} video · {{ previewData.file }} tệp · {{ previewData.audio }} ghi âm</b></div></div>
          <p class="shared-note">{{ number(previewData.shared || 0) }} object vẫn còn liên kết ngoài phạm vi; chúng chỉ bị gỡ link chat, không xóa bytes. {{ number(previewData.linksKept) }} liên kết được giữ lại.</p>
          <div class="confirm-row"><label>Nhập <b>XOA</b> để xác nhận<input v-model="confirmText" autocomplete="off" placeholder="XOA" :disabled="executing" /></label><button class="danger" :disabled="confirmText !== 'XOA' || executing" @click="executePreview()"><Trash2 :size="16" />{{ executing ? `Đang xử lý ${number(progressDeleted)} object...` : 'Xóa vĩnh viễn' }}</button></div>
          <div v-if="cleanupError" class="error"><AlertCircle :size="15" />{{ cleanupError }}<button v-if="canRetry && !executing" @click="retryFailed">Thử lại file lỗi</button></div>
        </div>
      </section>

      <div v-if="activeRun" class="progress-box"><div><b>Job {{ statusLabel(activeRun.status) }}: {{ activeRun.percent }}%</b><small>{{ number(activeRun.processedItems) }} / {{ number(activeRun.totalItems) }} object · giải phóng {{ size(activeRun.bytesFreed) }}</small></div><div class="progress-track"><i :style="{ width: `${activeRun.percent}%` }" /></div><button v-if="activeRun.status === 'partial'" class="secondary" @click="retryFailed">Thử lại file lỗi</button></div>
      <section v-else-if="tab === 'history'" class="panel history-panel">
        <div class="table-head"><h3>Lịch sử dọn dung lượng</h3><label class="search-field"><Search :size="15" /><input v-model="historySearch" placeholder="Tìm phạm vi hoặc người thực hiện" @keyup.enter="searchHistory" /></label></div>
        <div class="table-scroll"><table><thead><tr><th>Thời gian</th><th>Phạm vi</th><th>Người thực hiện</th><th>Trạng thái</th><th>Đã xử lý</th><th>Giải phóng</th><th>Lỗi</th></tr></thead><tbody><tr v-for="run in historyRows" :key="run.id" class="click-row" @click="openHistory(run.id)"><td>{{ dateTime(run.createdAt) }}</td><td>{{ run.targetName || run.targetType }}</td><td>{{ run.performedByName }}</td><td><span class="status" :class="run.status">{{ statusLabel(run.status) }}</span></td><td>{{ number(run.assetsDeleted) }}</td><td>{{ size(run.bytesFreed) }}</td><td>{{ run.failedCount }}</td></tr><tr v-if="!historyRows.length"><td colspan="7" class="empty-cell">Chưa có lần dọn nào.</td></tr></tbody></table></div>
        <Pager :page="historyPage" :pages="historyPages" :total="historyTotal" @change="changeHistoryPage" />
      </section>
      <section v-else class="panel policy-panel"><div class="section-title"><div><h3>Cảnh báo và retention</h3><small>Retention chỉ tạo điều kiện preview; không tự động xóa dữ liệu chat.</small></div><Settings2 :size="22" /></div><div class="policy-grid"><label>Cảnh báo quota (%)<input v-model.number="policyForm.quotaAlertPercent" type="number" min="1" max="100" /></label><label>Tăng trưởng bất thường (lần)<input v-model.number="policyForm.anomalyMultiplier" type="number" min="1" max="10" step="0.1" /></label><label>Retention gợi ý (ngày, 0 = tắt)<input v-model.number="policyForm.retentionDays" type="number" min="0" max="3650" /></label></div><div class="kind-options"><label v-for="kind in kinds" :key="kind.value"><input v-model="policyForm.retentionFileKinds" type="checkbox" :value="kind.value" /><component :is="kind.icon" :size="16" />{{ kind.label }}</label></div><button class="secondary" @click="savePolicy"><Save :size="16" />Lưu ngưỡng</button><button class="primary" :disabled="!policyForm.retentionDays" @click="prepareRetention">Tạo preview theo retention</button></section>    <aside v-if="entityDetail" class="storage-drawer"><button class="icon-button close-drawer" @click="entityDetail = undefined"><X :size="16" /></button><small>{{ entityDetail.target.type === 'group' ? 'Nhóm hội thoại' : 'Tài khoản Zalo' }}</small><h3>{{ entityDetail.target.name }}</h3><div class="drawer-stats"><div><span>Dung lượng</span><b>{{ size(entityDetail.summary.bytes) }}</b></div><div><span>Object</span><b>{{ number(entityDetail.summary.files) }}</b></div></div><div class="drawer-list"><div v-for="row in entityDetail.fileTypes" :key="row.type"><span>{{ kindLabel(row.type) }}</span><b>{{ number(row.files) }} · {{ size(row.bytes) }}</b></div></div><small>Cũ nhất: {{ dateTime(entityDetail.range?.oldestAt) }} · Mới nhất: {{ dateTime(entityDetail.range?.newestAt) }}</small><button class="primary drawer-action" @click="useEntityForCleanup"><Trash2 :size="16" />Tạo preview dọn theo mục này</button></aside>
    <aside v-if="historyDetail" class="storage-drawer"><button class="icon-button close-drawer" @click="historyDetail = undefined"><X :size="16" /></button><small>Lần dọn {{ historyDetail.run.targetName || historyDetail.run.targetType }}</small><h3>{{ statusLabel(historyDetail.run.status) }} · {{ size(historyDetail.run.bytesFreed) }}</h3><div class="drawer-stats"><div><span>Link gỡ</span><b>{{ number(historyDetail.run.assetsDeleted) }}</b></div><div><span>Object xóa</span><b>{{ number(historyDetail.run.objectsDeleted) }}</b></div></div><div v-if="historyDetail.failedItems.length" class="drawer-list"><div v-for="item in historyDetail.failedItems" :key="item.objectKey"><b>{{ item.objectKey }}</b><small>{{ item.error || 'Không rõ lỗi' }}</small></div></div><div v-else class="empty-cell">Không có object lỗi.</div><button class="secondary drawer-action" @click="downloadHistory(historyDetail.run.id)"><Download :size="16" />Xuất CSV</button></aside>    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type Component, type PropType } from 'vue';
import { AlertCircle, AlertTriangle, ArchiveRestore, BarChart3, ChevronLeft, Download, ChevronRight, Database, Files, FileText, Group, HardDrive, History, Image, Mic, RefreshCw, Save, Search, Settings2, ShieldCheck, Trash2, UserRound, Video, X } from 'lucide-vue-next';
import {
  downloadStorageHistoryCsv, executeStorageCleanup, getStorageCleanupProgress, getStorageEntityDetail, getStorageHistoryDetail, getStorageOverview, getStoragePolicy, listStorageEntities, listStorageHistory, updateStoragePolicy,
  previewStorageCleanup, reconcileStorageLedger, type StorageAccountRow, type StorageCleanupRun,
  type StorageEntityDetail, type StorageFileKind, type StorageGroupRow, type StorageOverview, type StoragePolicy, type StorageSort,
  type StorageCleanupPreview, type StorageTargetType,
} from '@/api/media';
import { useToast } from '@/composables/use-toast';

const toast = useToast();
const overview = ref<StorageOverview>();
const loading = ref(false);
const reconciling = ref(false);
const reconcileProgress = ref(0);
const tab = ref<'overview' | 'groups' | 'accounts' | 'cleanup' | 'history' | 'policy'>('overview');
const tabs: Array<{ id: typeof tab.value; label: string; icon: Component }> = [
  { id: 'overview', label: 'Tổng quan', icon: BarChart3 },
  { id: 'groups', label: 'Nhóm', icon: Group },
  { id: 'accounts', label: 'Tài khoản', icon: UserRound },
  { id: 'cleanup', label: 'Dọn dữ liệu', icon: Trash2 },
  { id: 'history', label: 'Lịch sử', icon: History },
  { id: 'policy', label: 'Vận hành', icon: Settings2 },
];
const pageSize = 25;
const entityRows = ref<Array<StorageAccountRow | StorageGroupRow>>([]);
const entityPage = ref(1);
const entityTotal = ref(0);
const entitySort = ref<StorageSort>('bytes');
const entitySearch = ref('');
const selectorAccounts = ref<StorageAccountRow[]>([]);
const selectorGroups = ref<StorageGroupRow[]>([]);
const selectorSearch = ref('');
const targetType = ref<StorageTargetType>('all');
const targetId = ref('');
const beforeDate = ref('');
const fileKinds = ref<StorageFileKind[]>(['image', 'video', 'file', 'audio']);
const previewData = ref<StorageCleanupPreview>();
const activeRun = ref<Awaited<ReturnType<typeof getStorageCleanupProgress>>>();
const confirmText = ref('');
const previewing = ref(false);
const executing = ref(false);
const progressDeleted = ref(0);
const cleanupError = ref('');
const canRetry = ref(false);
let progressTimer: number | undefined;
const historyRows = ref<StorageCleanupRun[]>([]);
const historyPage = ref(1);
const historyTotal = ref(0);
const historySearch = ref('');
const entityDetail = ref<StorageEntityDetail>();
const policyForm = ref<StoragePolicy>({ quotaAlertPercent: 80, anomalyMultiplier: 2, retentionDays: 0, retentionFileKinds: [] });
const historyDetail = ref<Awaited<ReturnType<typeof getStorageHistoryDetail>>>()
const kinds = [
  { value: 'image', label: 'Ảnh', icon: Image }, { value: 'video', label: 'Video', icon: Video },
  { value: 'file', label: 'File', icon: FileText }, { value: 'audio', label: 'Ghi âm', icon: Mic },
] as const;

const usagePercent = computed(() => overview.value?.capacityBytes ? Math.min(100, Math.round(overview.value.total.bytes / overview.value.capacityBytes * 100)) : 0);
const cleanupRunning = computed(() => activeRun.value?.status === 'running' || activeRun.value?.status === 'previewed');
const entityPages = computed(() => Math.max(1, Math.ceil(entityTotal.value / pageSize)));
const historyPages = computed(() => Math.max(1, Math.ceil(historyTotal.value / pageSize)));
const validCleanup = computed(() => !!beforeDate.value && fileKinds.value.length > 0 && (targetType.value === 'all' || !!targetId.value));
const maxDaily = computed(() => Math.max(1, ...(overview.value?.daily.map((row) => row.bytes) || [1])));
const number = (value: number) => Number(value || 0).toLocaleString('vi-VN');
const size = (value: number) => { const bytes = Number(value || 0); if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`; if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`; if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${bytes} B`; };
const date = (value?: string) => value ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(new Date(`${value}T00:00:00`)) : '—';
const dateTime = (value?: string | null) => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const barHeight = (bytes: number) => Math.max(4, Math.round(bytes / maxDaily.value * 100));
const kindLabel = (kind: string) => ({ image: 'Ảnh', video: 'Video', file: 'File', audio: 'Ghi âm' }[kind] || kind);
const statusLabel = (status: string) => ({ previewing: 'Đang thống kê', previewed: 'Chờ xác nhận', running: 'Đang xóa', completed: 'Hoàn tất', partial: 'Có lỗi', failed: 'Thất bại' }[status] || status);

const RankTable = defineComponent({
  props: { rows: { type: Array as PropType<Array<{ id: string; name: string; bytes: number; files: number }>>, required: true }, nameLabel: String },
  emits: ['open'],
  setup(props, { emit }) { return () => h('table', [h('thead', h('tr', [h('th', props.nameLabel), h('th', 'Dung lượng'), h('th', 'File')])), h('tbody', props.rows.map((row) => h('tr', { key: row.id, class: 'click-row', onClick: () => emit('open', row.id) }, [h('td', row.name), h('td', size(row.bytes)), h('td', number(row.files))])))]) },
});
const Pager = defineComponent({
  props: { page: { type: Number, required: true }, pages: { type: Number, required: true }, total: { type: Number, required: true } },
  emits: ['change'],
  setup(props, { emit }) { return () => h('div', { class: 'pager' }, [h('button', { disabled: props.page <= 1, title: 'Trang trước', onClick: () => emit('change', props.page - 1) }, h(ChevronLeft, { size: 16 })), h('span', `Trang ${props.page} / ${props.pages} · ${number(props.total)} mục`), h('button', { disabled: props.page >= props.pages, title: 'Trang sau', onClick: () => emit('change', props.page + 1) }, h(ChevronRight, { size: 16 }))]) },
});

async function loadOverview() { overview.value = await getStorageOverview(); policyForm.value = { ...overview.value.policy }; }
async function loadSelectors() {
  if (targetType.value === 'all') return;
  const entity = targetType.value === 'group' ? 'groups' : 'accounts';
  const result = await listStorageEntities({ entity, pageSize: 20, sort: 'name', search: selectorSearch.value });
  if (entity === 'groups') selectorGroups.value = result.items as StorageGroupRow[];
  else selectorAccounts.value = result.items as StorageAccountRow[];
}
async function refreshAll() {
  loading.value = true;
  try {
    await loadOverview();
    if (targetType.value !== 'all') await loadSelectors();
    if (tab.value === 'groups' || tab.value === 'accounts') await loadEntities();
    if (tab.value === 'history') await loadHistory();
  } catch (e: any) { toast.warning(e?.response?.data?.error || 'Không tải được quản lý R2'); }
  finally { loading.value = false; }
}
async function loadEntities() {
  const entity = tab.value === 'groups' ? 'groups' : 'accounts';
  const result = await listStorageEntities({ entity, page: entityPage.value, pageSize, sort: entitySort.value, search: entitySearch.value });
  entityRows.value = result.items; entityTotal.value = result.total;
}
async function searchEntities() { entityPage.value = 1; await loadEntities(); }
async function loadHistory() { const result = await listStorageHistory({ page: historyPage.value, pageSize, search: historySearch.value }); historyRows.value = result.items; historyTotal.value = result.total; }
async function searchHistory() { historyPage.value = 1; await loadHistory(); }
async function openTab(next: typeof tab.value) { tab.value = next; if (next === 'groups' || next === 'accounts') { entityPage.value = 1; entitySearch.value = ''; await loadEntities(); } else if (next === 'history') { historyPage.value = 1; await loadHistory(); } else if (next === 'policy') { policyForm.value = await getStoragePolicy(); } }
async function changeEntityPage(page: number) { entityPage.value = page; await loadEntities(); }
async function changeHistoryPage(page: number) { historyPage.value = page; await loadHistory(); }
async function openEntity(type: 'group' | 'account', id: string) {
  try { entityDetail.value = await getStorageEntityDetail(type, id); }
  catch (e: any) { toast.warning(e?.response?.data?.error || 'Không tải được chi tiết lưu trữ.'); }
}
function useEntityForCleanup() {
  if (!entityDetail.value) return;
  targetType.value = entityDetail.value.target.type; targetId.value = entityDetail.value.target.id;
  selectorSearch.value = entityDetail.value.target.name; entityDetail.value = undefined; tab.value = 'cleanup'; resetPreview();
}
async function openHistory(runId: string) {
  try { historyDetail.value = await getStorageHistoryDetail(runId); }
  catch (e: any) { toast.warning(e?.response?.data?.error || 'Không tải được chi tiết lần dọn.'); }
}
async function savePolicy() {
  try { policyForm.value = await updateStoragePolicy(policyForm.value); toast.success('Đã lưu ngưỡng vận hành.'); await loadOverview(); }
  catch (e: any) { toast.warning(e?.response?.data?.error || 'Không lưu được chính sách.'); }
}
function prepareRetention() {
  const before = new Date(); before.setDate(before.getDate() - policyForm.value.retentionDays);
  beforeDate.value = before.toISOString().slice(0, 10); fileKinds.value = policyForm.value.retentionFileKinds.length ? [...policyForm.value.retentionFileKinds] : ['image', 'video', 'file', 'audio'];
  targetType.value = 'all'; targetId.value = ''; tab.value = 'cleanup'; resetPreview();
}
async function downloadHistory(runId: string) {
  try { const blob = await downloadStorageHistoryCsv(runId); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `storage-cleanup-${runId}.csv`; link.click(); URL.revokeObjectURL(url); }
  catch { toast.warning('Không thể xuất CSV.'); }
}
function resetPreview() { previewData.value = undefined; confirmText.value = ''; cleanupError.value = ''; canRetry.value = false; progressDeleted.value = 0; }
async function createPreview() {
  if (cleanupRunning.value) return;
  window.clearInterval(progressTimer);
  activeRun.value = undefined;
  previewing.value = true; resetPreview();
  try { previewData.value = await previewStorageCleanup({ targetType: targetType.value, targetId: targetId.value || undefined, beforeDate: beforeDate.value, fileKinds: fileKinds.value }); }
  catch (e: any) { toast.warning(e?.response?.data?.error || 'Không tạo được bản xem trước'); }
  finally { previewing.value = false; }
}
async function executePreview(retryFailed = false) {
  const runId = previewData.value?.runId;
  if (!runId || executing.value) return;
  executing.value = true; cleanupError.value = ''; canRetry.value = false;
  try {
    const result = await executeStorageCleanup({ runId, confirm: true, retryFailed });
    activeRun.value = result.run; progressDeleted.value = result.run.assetsDeleted;
    watchCleanupProgress(runId);
    toast.success('Job dọn dữ liệu đã được khởi động.');
  } catch (e: any) { cleanupError.value = e?.response?.data?.error || e?.message || 'Không khởi động được job dọn dữ liệu.'; }
  finally { executing.value = false; }
}
function watchCleanupProgress(runId: string) {
  window.clearInterval(progressTimer);
  progressTimer = window.setInterval(async () => {
    try {
      const progress = await getStorageCleanupProgress(runId);
      activeRun.value = progress; progressDeleted.value = progress.assetsDeleted;
      if (!['running', 'previewed'].includes(progress.status)) {
        window.clearInterval(progressTimer); canRetry.value = progress.status === 'partial';
        if (progress.status === 'completed') toast.success(`Đã hoàn tất, giải phóng ${size(progress.bytesFreed)}.`);
        await Promise.all([loadOverview(), loadHistory()]);
        if (progress.status === 'completed') {
          activeRun.value = undefined;
          resetPreview();
        } else if (progress.status === 'failed') {
          activeRun.value = undefined;
        }
      }
    } catch { window.clearInterval(progressTimer); }
  }, 1200);
}
async function retryFailed() { confirmText.value = 'XOA'; await executePreview(true); }
async function reconcileOldData() {
  if (reconciling.value || !window.confirm('Đối soát sẽ kiểm tra metadata cũ, không xóa object nào. Tiếp tục?')) return;
  reconciling.value = true; reconcileProgress.value = 0;
  try {
    await reconcileStorageLedger();
    const timer = window.setInterval(async () => {
      await loadOverview(); const current = overview.value?.latestReconciliation;
      reconcileProgress.value = current?.scanned || 0;
      if (current?.status !== 'running' && current?.status !== 'completed') {
        window.clearInterval(timer); reconciling.value = false;
        const detail = current?.errorSummary && typeof current.errorSummary === 'object' && 'message' in current.errorSummary
          ? String((current.errorSummary as { message?: unknown }).message || '') : '';
        toast.warning(detail
          ? `\u0110\u1ed1i so\u00e1t ledger th\u1ea5t b\u1ea1i: ${detail}`
          : '\u0110\u1ed1i so\u00e1t ledger th\u1ea5t b\u1ea1i. Vui l\u00f2ng xem l\u1ea1i l\u1ecbch s\u1eed job.');
        return;
      }
      if (current?.status !== 'running') { window.clearInterval(timer); reconciling.value = false; toast.success('Đối soát ledger đã hoàn tất.'); }
    }, 1400);
  } catch (e: any) { reconciling.value = false; toast.warning(e?.response?.data?.error || 'Đối soát dữ liệu cũ thất bại'); }
}
let selectorTimer: number | undefined;
watch(targetType, async () => { targetId.value = ''; selectorSearch.value = ''; resetPreview(); await loadSelectors(); });
watch(selectorSearch, () => { window.clearTimeout(selectorTimer); selectorTimer = window.setTimeout(() => { targetId.value = ''; void loadSelectors(); }, 300); });
watch([targetId, beforeDate, fileKinds], resetPreview, { deep: true });
onMounted(refreshAll);
onBeforeUnmount(() => { window.clearInterval(progressTimer); window.clearTimeout(selectorTimer); });
</script>

<style scoped>
.storage-admin{padding:20px 24px 30px;background:#f5f8f9;min-height:680px;color:#17212b}.page-head,.head-actions,.table-head,.filters,.section-title{display:flex;align-items:center;justify-content:space-between;gap:10px}.page-head{align-items:flex-start}.page-head h2{margin:0;font-size:22px}.page-head p{margin:5px 0 0;color:#65737d;font-size:13px}.icon-button,.pager button{width:36px;height:36px;display:grid;place-items:center;border:1px solid #cdd7dc;background:#fff;border-radius:5px;cursor:pointer}.secondary,.primary,.danger{height:36px;display:inline-flex;align-items:center;gap:7px;border-radius:5px;padding:0 12px;cursor:pointer}.secondary{border:1px solid #b9c8ce;background:#fff;color:#264653}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:18px}.metrics>div{position:relative;background:#fff;border:1px solid #dce4e7;border-radius:6px;padding:14px}.metrics svg{position:absolute;right:14px;color:#79909c}.metrics span,.metrics small{display:block;color:#687782;font-size:12px}.metrics b{display:block;margin:6px 0 2px;font-size:21px}.warning,.error{display:flex;align-items:center;gap:8px;padding:10px 12px;margin-top:10px;border:1px solid #e7c77d;background:#fff9e8;color:#74530c;font-size:13px}.subtabs{display:flex;gap:2px;border-bottom:1px solid #ccd7dc;margin-top:18px}.subtabs button{display:flex;align-items:center;gap:6px;padding:10px 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:#576771;cursor:pointer}.subtabs button.active{border-bottom-color:#087ea4;color:#075f7b;font-weight:700}.panel{background:#fff;border:1px solid #dce4e7;border-radius:6px;padding:15px}.dashboard{padding-top:14px}.dashboard-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.dashboard-grid.lower{margin-top:12px}.panel h3{margin:0 0 12px;font-size:15px}.section-title h3,.table-head h3{margin-bottom:0}.panel table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid #edf1f2;white-space:nowrap}th{color:#64737d;font-weight:600}.type-list>div{display:grid;grid-template-columns:12px 1fr 90px 90px;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid #edf1f2;font-size:13px}.type-list strong{text-align:right}.type-dot{width:9px;height:9px;background:#5c86a6}.type-dot.video{background:#d05c42}.type-dot.file{background:#7b6aa8}.type-dot.audio{background:#38886d}.bars{height:155px;display:flex;align-items:flex-end;gap:3px;border-bottom:1px solid #cad5da;padding-top:10px}.bar-wrap{flex:1;height:100%;display:flex;align-items:flex-end}.bar{width:100%;background:#3b8199;min-height:4px}.chart-axis{display:flex;justify-content:space-between;color:#71808a;font-size:11px;margin-top:5px}.entity-panel,.cleanup-panel,.history-panel{margin-top:14px}.filters{justify-content:flex-end}.search-field{height:36px;display:flex;align-items:center;gap:6px;border:1px solid #c8d3d8;border-radius:4px;background:#fff;padding:0 9px;color:#71808a}.search-field input{width:210px;border:0;outline:0}.table-head select,.cleanup-form select,.cleanup-form input,.confirm-row input{height:36px;border:1px solid #c8d3d8;border-radius:4px;background:#fff;padding:0 9px}.table-scroll{overflow:auto;margin-top:10px}.entity-panel small{display:block;color:#73818a;margin-top:2px}.pager{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:14px;font-size:12px}.pager button:disabled,.secondary:disabled,.icon-button:disabled,.subtabs button:disabled{opacity:.4}.cleanup-form{display:grid;grid-template-columns:repeat(4,minmax(170px,1fr));gap:10px;margin-top:16px}.cleanup-form label,.confirm-row label{display:flex;flex-direction:column;gap:5px;color:#60707a;font-size:12px}.kind-options{display:flex;gap:8px;margin:12px 0}.kind-options label{display:flex;align-items:center;gap:6px;border:1px solid #cdd7dc;background:#fff;padding:8px 10px;font-size:13px}.primary,.danger{border:0;color:#fff}.primary{background:#087ea4}.danger{background:#b42318}.primary:disabled,.danger:disabled{opacity:.45;cursor:not-allowed}.preview-box{border:1px solid #e4a28c;background:#fff8f5;margin-top:14px;padding:14px}.preview-summary{display:grid;grid-template-columns:180px 210px 1fr;gap:12px}.preview-summary span{display:block;color:#6d7a83;font-size:12px}.preview-summary b{display:block;margin-top:5px;font-size:20px}.preview-summary .breakdown{font-size:14px}.shared-note{margin:12px 0 0;color:#74530c;font-size:12px}.confirm-row{align-items:flex-end;justify-content:flex-end;border-top:1px solid #ecd8d1;margin-top:13px;padding-top:13px}.confirm-row input{width:120px}.error{border-color:#e4a59f;background:#fff2f1;color:#8b2119}.error button{margin-left:auto;border:0;background:transparent;color:#8b2119;text-decoration:underline;cursor:pointer}.status{padding:3px 6px;background:#edf2f4;color:#54636c}.status.completed{background:#e5f5ed;color:#17643e}.status.partial,.status.failed{background:#ffebe8;color:#9b251a}.status.running{background:#e7f2f8;color:#17627d}.empty,.empty-cell{text-align:center;color:#74828b;padding:45px}.spin{animation:rotate 1s linear infinite}@keyframes rotate{to{transform:rotate(360deg)}}@media(max-width:900px){.storage-admin{padding:15px}.page-head,.table-head{align-items:stretch;flex-direction:column}.head-actions,.filters{justify-content:flex-start;flex-wrap:wrap}.metrics,.dashboard-grid,.cleanup-form,.preview-summary{grid-template-columns:1fr}.subtabs{overflow:auto}.confirm-row{align-items:stretch;flex-direction:column}.confirm-row input,.search-field input{width:100%}}

/* R2 admin tables: keep dense storage data readable inside the media page. */
.storage-admin{width:100%;flex:1;min-height:0;box-sizing:border-box;overflow:auto}.entity-panel{width:100%;min-width:0;box-sizing:border-box;overflow:hidden}.table-head{align-items:flex-start;flex-wrap:wrap;gap:16px}.table-head h3{flex:1;min-width:240px;line-height:1.35;white-space:normal}.filters{flex:0 1 auto;flex-wrap:wrap;gap:10px}.table-head select{min-width:190px}.table-scroll{max-width:100%;overflow:auto;border:1px solid #e2e8eb;border-radius:6px;background:#fff}.entity-panel table{min-width:920px;table-layout:fixed}.entity-panel th,.entity-panel td{height:42px;padding:10px 12px}.entity-panel th:first-child,.entity-panel td:first-child{width:360px;white-space:normal}.entity-panel th:not(:first-child),.entity-panel td:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}.entity-panel thead th{position:sticky;top:0;z-index:2;background:#f8fafb;border-bottom-color:#dbe4e8}.entity-panel thead th:first-child,.entity-panel tbody td:first-child{position:sticky;left:0;z-index:3;background:#fff}.entity-panel thead th:first-child{background:#f8fafb;z-index:4}.entity-panel tbody tr:hover td{background:#f7fbfc}.entity-panel tbody tr:hover td:first-child{background:#f7fbfc}.entity-panel td:first-child b{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#101820}.entity-panel small{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pager{border-top:1px solid #edf1f2;padding-top:12px}.history-panel table{min-width:860px}@media(max-width:900px){.table-head{gap:12px}.filters{width:100%}.search-field{flex:1 1 240px}.table-head select{flex:1 1 190px}.entity-panel table{min-width:820px}.entity-panel th:first-child,.entity-panel td:first-child{width:280px}}
.scope-note{margin-top:12px;padding:9px 11px;border-left:3px solid #3b8199;background:#edf7f9;color:#39535e;font-size:12px}.health-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px;color:#62727b;font-size:12px}.health-row span{padding:6px 8px;border:1px solid #dce5e8;background:#fff}.driver-badge{display:inline-block;margin-left:8px;padding:3px 8px;border:1px solid #9bb8c2;border-radius:999px;background:#edf7fa;color:#17627d;font-size:11px;font-weight:700;vertical-align:middle}.driver-badge.local{border-color:#cfd8dc;background:#f2f4f5;color:#56616a}.progress-box{display:flex;align-items:center;gap:12px;margin:14px 0;padding:12px;border:1px solid #9bc7d6;background:#f2fbfd}.progress-box small{display:block;margin-top:4px;color:#58727c;font-size:12px}.progress-track{flex:1;height:8px;overflow:hidden;border-radius:999px;background:#dbecef}.progress-track i{display:block;height:100%;background:#087ea4;transition:width .25s}@media(max-width:900px){.progress-box{align-items:stretch;flex-direction:column}.health-row{display:grid;grid-template-columns:1fr}}.storage-drawer{position:fixed;z-index:20;top:0;right:0;bottom:0;width:min(390px,100vw);padding:20px;border-left:1px solid #cfdcdf;background:#fff;box-shadow:-12px 0 32px rgba(20,42,52,.16);overflow:auto}.storage-drawer h3{margin:5px 0 18px;font-size:17px}.close-drawer{float:right}.drawer-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}.drawer-stats>div{padding:10px;border:1px solid #e0e8ea;background:#f8fafb}.drawer-stats span{display:block;color:#64737d;font-size:11px}.drawer-stats b{display:block;margin-top:4px}.drawer-list{margin:16px 0;border-top:1px solid #edf1f2}.drawer-list>div{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #edf1f2;font-size:12px}.drawer-list small{display:block;max-width:220px;overflow:hidden;color:#8b2119;text-overflow:ellipsis;white-space:nowrap}.drawer-action{width:100%;justify-content:center;margin-top:18px}.click-row{cursor:pointer}.click-row:hover td{background:#f3fafc}.policy-grid{display:grid;grid-template-columns:repeat(3,minmax(170px,1fr));gap:10px;margin:16px 0}.policy-grid label{display:flex;flex-direction:column;gap:5px;color:#60707a;font-size:12px}.policy-grid input{height:36px;padding:0 9px;border:1px solid #c8d3d8;border-radius:4px;background:#fff}@media(max-width:900px){.policy-grid{grid-template-columns:1fr}}</style>
<style scoped>
/* Keep the storage workspace readable when the application is in dark mode. */
.storage-admin { color-scheme: light; }
.storage-admin .cleanup-form label,
.storage-admin .confirm-row label,
.storage-admin .policy-grid label { color: #334155; font-weight: 600; }
.storage-admin .cleanup-form select,
.storage-admin .cleanup-form input,
.storage-admin .confirm-row input,
.storage-admin .policy-grid input,
.storage-admin .search-field input,
.storage-admin .table-head select {
  background: #ffffff !important; color: #17212b !important;
  -webkit-text-fill-color: #17212b; color-scheme: light;
}
.storage-admin .cleanup-form input::placeholder,
.storage-admin .confirm-row input::placeholder,
.storage-admin .search-field input::placeholder { color: #64748b; opacity: 1; }
.storage-admin .cleanup-form select:focus,
.storage-admin .cleanup-form input:focus,
.storage-admin .confirm-row input:focus,
.storage-admin .policy-grid input:focus,
.storage-admin .search-field:focus-within,
.storage-admin .table-head select:focus { outline: 2px solid #087ea4; outline-offset: 1px; border-color: #087ea4; }
.storage-admin .kind-options label { color: #17212b; font-weight: 600; border-color: #aab8c1; }
.storage-admin .kind-options input { accent-color: #087ea4; }
.storage-admin .cleanup-form input[type='date'] { min-width: 170px; font-weight: 600; }
.storage-admin .cleanup-form select option { background: #ffffff; color: #17212b; }
</style>
<style scoped>
.storage-admin .panel { width: 100%; max-width: none; min-width: 0; box-sizing: border-box; }
.cleanup-panel{display:block}.cleanup-panel .cleanup-form{grid-template-columns:repeat(4,minmax(0,1fr))}.preview-summary{grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.preview-summary div{min-width:0;overflow-wrap:anywhere}.preview-summary span{min-height:34px;line-height:1.35}.preview-summary b{font-variant-numeric:tabular-nums}.preview-summary .breakdown{line-height:1.45}.preview-box{overflow:hidden}@media(max-width:1100px){.cleanup-panel .cleanup-form,.preview-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.cleanup-panel .cleanup-form,.preview-summary{grid-template-columns:1fr}.preview-summary span{min-height:0}}
</style>
