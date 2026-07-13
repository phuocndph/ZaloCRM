<template>
  <section class="storage-admin">
    <header class="page-head">
      <div>
        <h2>Quản lý Cloudflare R2</h2>
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
          <div class="panel"><h3>10 nhóm dùng nhiều nhất</h3><RankTable :rows="overview.topGroups" name-label="Nhóm hội thoại" /></div>
          <div class="panel"><h3>10 tài khoản dùng nhiều nhất</h3><RankTable :rows="overview.topAccounts" name-label="Tài khoản Zalo" /></div>
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
        <div class="table-scroll"><table><thead><tr><th>{{ tab === 'groups' ? 'Nhóm' : 'Tài khoản / UID' }}</th><th v-if="tab === 'groups'">Số tài khoản</th><th>Dung lượng</th><th>Số file</th><th>Ảnh</th><th>Video</th><th>File</th><th>Ghi âm</th></tr></thead><tbody><tr v-for="row in entityRows" :key="row.id"><td><b>{{ row.name }}</b><small v-if="'uid' in row">{{ row.uid }}</small></td><td v-if="tab === 'groups'">{{ number((row as StorageGroupRow).accountCount) }}</td><td>{{ size(row.bytes) }}</td><td>{{ number(row.files) }}</td><td>{{ number(row.image) }}</td><td>{{ number(row.video) }}</td><td>{{ number(row.file) }}</td><td>{{ number(row.audio) }}</td></tr><tr v-if="!entityRows.length"><td :colspan="tab === 'groups' ? 8 : 7" class="empty-cell">Không có dữ liệu phù hợp.</td></tr></tbody></table></div>
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
          <div class="preview-summary"><div><span>Số object được xử lý</span><b>{{ number(previewData.files) }}</b></div><div><span>Dung lượng giải phóng</span><b>{{ size(previewData.bytes) }}</b></div><div><span>Chi tiết</span><b class="breakdown">{{ previewData.image }} ảnh · {{ previewData.video }} video · {{ previewData.file }} file · {{ previewData.audio }} ghi âm</b></div></div>
          <p v-if="previewData.shared" class="shared-note">{{ number(previewData.shared) }} object còn được nơi khác sử dụng; hệ thống chỉ gỡ liên kết thuộc phạm vi đã chọn.</p>
          <div class="confirm-row"><label>Nhập <b>XOA</b> để xác nhận<input v-model="confirmText" autocomplete="off" placeholder="XOA" :disabled="executing" /></label><button class="danger" :disabled="confirmText !== 'XOA' || executing" @click="executePreview()"><Trash2 :size="16" />{{ executing ? `Đang xử lý ${number(progressDeleted)} object...` : 'Xóa vĩnh viễn' }}</button></div>
          <div v-if="cleanupError" class="error"><AlertCircle :size="15" />{{ cleanupError }}<button v-if="canRetry && !executing" @click="retryFailed">Thử lại file lỗi</button></div>
        </div>
      </section>

      <section v-else class="panel history-panel">
        <div class="table-head"><h3>Lịch sử dọn dung lượng</h3><label class="search-field"><Search :size="15" /><input v-model="historySearch" placeholder="Tìm phạm vi hoặc người thực hiện" @keyup.enter="searchHistory" /></label></div>
        <div class="table-scroll"><table><thead><tr><th>Thời gian</th><th>Phạm vi</th><th>Người thực hiện</th><th>Trạng thái</th><th>Đã xử lý</th><th>Giải phóng</th><th>Lỗi</th></tr></thead><tbody><tr v-for="run in historyRows" :key="run.id"><td>{{ dateTime(run.createdAt) }}</td><td>{{ run.targetName || run.targetType }}</td><td>{{ run.performedByName }}</td><td><span class="status" :class="run.status">{{ statusLabel(run.status) }}</span></td><td>{{ number(run.assetsDeleted) }}</td><td>{{ size(run.bytesFreed) }}</td><td>{{ run.failedCount }}</td></tr><tr v-if="!historyRows.length"><td colspan="7" class="empty-cell">Chưa có lần dọn nào.</td></tr></tbody></table></div>
        <Pager :page="historyPage" :pages="historyPages" :total="historyTotal" @change="changeHistoryPage" />
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref, watch, type Component, type PropType } from 'vue';
import { AlertCircle, AlertTriangle, ArchiveRestore, BarChart3, ChevronLeft, ChevronRight, Database, Files, FileText, Group, HardDrive, History, Image, Mic, RefreshCw, Search, ShieldCheck, Trash2, UserRound, Video } from 'lucide-vue-next';
import {
  executeStorageCleanup, getStorageOverview, listStorageEntities, listStorageHistory,
  previewStorageCleanup, reconcileStorageLedger, type StorageAccountRow, type StorageCleanupRun,
  type StorageFileKind, type StorageGroupRow, type StorageOverview, type StorageSort,
  type StorageSummary, type StorageTargetType,
} from '@/api/media';
import { useToast } from '@/composables/use-toast';

const toast = useToast();
const overview = ref<StorageOverview>();
const loading = ref(false);
const reconciling = ref(false);
const reconcileProgress = ref(0);
const tab = ref<'overview' | 'groups' | 'accounts' | 'cleanup' | 'history'>('overview');
const tabs: Array<{ id: typeof tab.value; label: string; icon: Component }> = [
  { id: 'overview', label: 'Tổng quan', icon: BarChart3 },
  { id: 'groups', label: 'Nhóm', icon: Group },
  { id: 'accounts', label: 'Tài khoản', icon: UserRound },
  { id: 'cleanup', label: 'Dọn dữ liệu', icon: Trash2 },
  { id: 'history', label: 'Lịch sử', icon: History },
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
const previewData = ref<(StorageSummary & { runId: string; expiresAt: string; selectedBytes?: number })>();
const confirmText = ref('');
const previewing = ref(false);
const executing = ref(false);
const progressDeleted = ref(0);
const cleanupError = ref('');
const canRetry = ref(false);
const historyRows = ref<StorageCleanupRun[]>([]);
const historyPage = ref(1);
const historyTotal = ref(0);
const historySearch = ref('');
const kinds = [
  { value: 'image', label: 'Ảnh', icon: Image }, { value: 'video', label: 'Video', icon: Video },
  { value: 'file', label: 'File', icon: FileText }, { value: 'audio', label: 'Ghi âm', icon: Mic },
] as const;

const usagePercent = computed(() => overview.value?.capacityBytes ? Math.min(100, Math.round(overview.value.total.bytes / overview.value.capacityBytes * 100)) : 0);
const entityPages = computed(() => Math.max(1, Math.ceil(entityTotal.value / pageSize)));
const historyPages = computed(() => Math.max(1, Math.ceil(historyTotal.value / pageSize)));
const validCleanup = computed(() => !!beforeDate.value && fileKinds.value.length > 0 && (targetType.value === 'all' || !!targetId.value));
const maxDaily = computed(() => Math.max(1, ...(overview.value?.daily.map((row) => row.bytes) || [1])));
const number = (value: number) => Number(value || 0).toLocaleString('vi-VN');
const size = (value: number) => { const bytes = Number(value || 0); if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`; if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`; if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${bytes} B`; };
const date = (value?: string) => value ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' }).format(new Date(`${value}T00:00:00`)) : '—';
const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const barHeight = (bytes: number) => Math.max(4, Math.round(bytes / maxDaily.value * 100));
const kindLabel = (kind: string) => ({ image: 'Ảnh', video: 'Video', file: 'File', audio: 'Ghi âm' }[kind] || kind);
const statusLabel = (status: string) => ({ previewing: 'Đang thống kê', previewed: 'Chờ xác nhận', running: 'Đang xóa', completed: 'Hoàn tất', partial: 'Có lỗi', failed: 'Thất bại' }[status] || status);
const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const RankTable = defineComponent({
  props: { rows: { type: Array as PropType<Array<{ id: string; name: string; bytes: number; files: number }>>, required: true }, nameLabel: String },
  setup(props) { return () => h('table', [h('thead', h('tr', [h('th', props.nameLabel), h('th', 'Dung lượng'), h('th', 'File')])), h('tbody', props.rows.map((row) => h('tr', { key: row.id }, [h('td', row.name), h('td', size(row.bytes)), h('td', number(row.files))])))]) },
});
const Pager = defineComponent({
  props: { page: { type: Number, required: true }, pages: { type: Number, required: true }, total: { type: Number, required: true } },
  emits: ['change'],
  setup(props, { emit }) { return () => h('div', { class: 'pager' }, [h('button', { disabled: props.page <= 1, title: 'Trang trước', onClick: () => emit('change', props.page - 1) }, h(ChevronLeft, { size: 16 })), h('span', `Trang ${props.page} / ${props.pages} · ${number(props.total)} mục`), h('button', { disabled: props.page >= props.pages, title: 'Trang sau', onClick: () => emit('change', props.page + 1) }, h(ChevronRight, { size: 16 }))]) },
});

async function loadOverview() { overview.value = await getStorageOverview(); }
async function loadSelectors() {
  if (targetType.value === 'all') return;
  const entity = targetType.value === 'group' ? 'groups' : 'accounts';
  const result = await listStorageEntities({ entity, pageSize: 100, sort: 'name', search: selectorSearch.value });
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
async function openTab(next: typeof tab.value) { tab.value = next; if (next === 'groups' || next === 'accounts') { entityPage.value = 1; entitySearch.value = ''; await loadEntities(); } else if (next === 'history') { historyPage.value = 1; await loadHistory(); } }
async function changeEntityPage(page: number) { entityPage.value = page; await loadEntities(); }
async function changeHistoryPage(page: number) { historyPage.value = page; await loadHistory(); }
function resetPreview() { previewData.value = undefined; confirmText.value = ''; cleanupError.value = ''; canRetry.value = false; progressDeleted.value = 0; }
async function createPreview() {
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
    let hasMore = true; let first = true; let idlePasses = 0;
    while (hasMore) {
      const result = await executeStorageCleanup({ runId, confirm: true, retryFailed: retryFailed && first });
      first = false; progressDeleted.value = result.totalDeleted; hasMore = result.hasMore;
      if (hasMore && result.deleted === 0) { idlePasses += 1; await delay(300); if (idlePasses >= 10) throw new Error('Batch đang được tiến trình khác xử lý. Hãy làm mới sau ít phút.'); }
      else idlePasses = 0;
      if (!hasMore && result.failed > 0) { cleanupError.value = `${result.failed} object chưa xóa được. Metadata được giữ lại để thử lại.`; canRetry.value = true; }
    }
    if (!canRetry.value) { toast.success(`Đã xử lý ${number(progressDeleted.value)} object theo snapshot`); resetPreview(); }
    await Promise.all([loadOverview(), loadHistory()]);
  } catch (e: any) { cleanupError.value = e?.response?.data?.error || e?.message || 'Dọn dữ liệu thất bại'; canRetry.value = true; }
  finally { executing.value = false; }
}
async function retryFailed() { confirmText.value = 'XOA'; await executePreview(true); }
async function reconcileOldData() {
  if (reconciling.value) return;
  reconciling.value = true; reconcileProgress.value = 0;
  try {
    let cursor: string | undefined; let hasMore = true; let references = 0; let missing = 0;
    while (hasMore) {
      const result = await reconcileStorageLedger({ cursor, batch: 100 });
      reconcileProgress.value += result.scanned; references += result.references; missing += result.missing;
      cursor = result.nextCursor || undefined; hasMore = result.hasMore;
    }
    toast.success(`Đã đối soát ${number(references)} liên kết${missing ? `, ${number(missing)} object không còn trên storage` : ''}`);
    await refreshAll();
  } catch (e: any) { toast.warning(e?.response?.data?.error || 'Đối soát dữ liệu cũ thất bại'); }
  finally { reconciling.value = false; }
}

let selectorTimer: number | undefined;
watch(targetType, async () => { targetId.value = ''; selectorSearch.value = ''; resetPreview(); await loadSelectors(); });
watch(selectorSearch, () => { window.clearTimeout(selectorTimer); selectorTimer = window.setTimeout(() => { targetId.value = ''; void loadSelectors(); }, 300); });
watch([targetId, beforeDate, fileKinds], resetPreview, { deep: true });
onMounted(refreshAll);
</script>

<style scoped>
.storage-admin{padding:20px 24px 30px;background:#f5f8f9;min-height:680px;color:#17212b}.page-head,.head-actions,.table-head,.filters,.section-title{display:flex;align-items:center;justify-content:space-between;gap:10px}.page-head{align-items:flex-start}.page-head h2{margin:0;font-size:22px}.page-head p{margin:5px 0 0;color:#65737d;font-size:13px}.icon-button,.pager button{width:36px;height:36px;display:grid;place-items:center;border:1px solid #cdd7dc;background:#fff;border-radius:5px;cursor:pointer}.secondary,.primary,.danger{height:36px;display:inline-flex;align-items:center;gap:7px;border-radius:5px;padding:0 12px;cursor:pointer}.secondary{border:1px solid #b9c8ce;background:#fff;color:#264653}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:18px}.metrics>div{position:relative;background:#fff;border:1px solid #dce4e7;border-radius:6px;padding:14px}.metrics svg{position:absolute;right:14px;color:#79909c}.metrics span,.metrics small{display:block;color:#687782;font-size:12px}.metrics b{display:block;margin:6px 0 2px;font-size:21px}.warning,.error{display:flex;align-items:center;gap:8px;padding:10px 12px;margin-top:10px;border:1px solid #e7c77d;background:#fff9e8;color:#74530c;font-size:13px}.subtabs{display:flex;gap:2px;border-bottom:1px solid #ccd7dc;margin-top:18px}.subtabs button{display:flex;align-items:center;gap:6px;padding:10px 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:#576771;cursor:pointer}.subtabs button.active{border-bottom-color:#087ea4;color:#075f7b;font-weight:700}.panel{background:#fff;border:1px solid #dce4e7;border-radius:6px;padding:15px}.dashboard{padding-top:14px}.dashboard-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.dashboard-grid.lower{margin-top:12px}.panel h3{margin:0 0 12px;font-size:15px}.section-title h3,.table-head h3{margin-bottom:0}.panel table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid #edf1f2;white-space:nowrap}th{color:#64737d;font-weight:600}.type-list>div{display:grid;grid-template-columns:12px 1fr 90px 90px;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid #edf1f2;font-size:13px}.type-list strong{text-align:right}.type-dot{width:9px;height:9px;background:#5c86a6}.type-dot.video{background:#d05c42}.type-dot.file{background:#7b6aa8}.type-dot.audio{background:#38886d}.bars{height:155px;display:flex;align-items:flex-end;gap:3px;border-bottom:1px solid #cad5da;padding-top:10px}.bar-wrap{flex:1;height:100%;display:flex;align-items:flex-end}.bar{width:100%;background:#3b8199;min-height:4px}.chart-axis{display:flex;justify-content:space-between;color:#71808a;font-size:11px;margin-top:5px}.entity-panel,.cleanup-panel,.history-panel{margin-top:14px}.filters{justify-content:flex-end}.search-field{height:36px;display:flex;align-items:center;gap:6px;border:1px solid #c8d3d8;border-radius:4px;background:#fff;padding:0 9px;color:#71808a}.search-field input{width:210px;border:0;outline:0}.table-head select,.cleanup-form select,.cleanup-form input,.confirm-row input{height:36px;border:1px solid #c8d3d8;border-radius:4px;background:#fff;padding:0 9px}.table-scroll{overflow:auto;margin-top:10px}.entity-panel small{display:block;color:#73818a;margin-top:2px}.pager{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:14px;font-size:12px}.pager button:disabled,.secondary:disabled,.icon-button:disabled,.subtabs button:disabled{opacity:.4}.cleanup-form{display:grid;grid-template-columns:repeat(4,minmax(170px,1fr));gap:10px;margin-top:16px}.cleanup-form label,.confirm-row label{display:flex;flex-direction:column;gap:5px;color:#60707a;font-size:12px}.kind-options{display:flex;gap:8px;margin:12px 0}.kind-options label{display:flex;align-items:center;gap:6px;border:1px solid #cdd7dc;background:#fff;padding:8px 10px;font-size:13px}.primary,.danger{border:0;color:#fff}.primary{background:#087ea4}.danger{background:#b42318}.primary:disabled,.danger:disabled{opacity:.45;cursor:not-allowed}.preview-box{border:1px solid #e4a28c;background:#fff8f5;margin-top:14px;padding:14px}.preview-summary{display:grid;grid-template-columns:180px 210px 1fr;gap:12px}.preview-summary span{display:block;color:#6d7a83;font-size:12px}.preview-summary b{display:block;margin-top:5px;font-size:20px}.preview-summary .breakdown{font-size:14px}.shared-note{margin:12px 0 0;color:#74530c;font-size:12px}.confirm-row{align-items:flex-end;justify-content:flex-end;border-top:1px solid #ecd8d1;margin-top:13px;padding-top:13px}.confirm-row input{width:120px}.error{border-color:#e4a59f;background:#fff2f1;color:#8b2119}.error button{margin-left:auto;border:0;background:transparent;color:#8b2119;text-decoration:underline;cursor:pointer}.status{padding:3px 6px;background:#edf2f4;color:#54636c}.status.completed{background:#e5f5ed;color:#17643e}.status.partial,.status.failed{background:#ffebe8;color:#9b251a}.status.running{background:#e7f2f8;color:#17627d}.empty,.empty-cell{text-align:center;color:#74828b;padding:45px}.spin{animation:rotate 1s linear infinite}@keyframes rotate{to{transform:rotate(360deg)}}@media(max-width:900px){.storage-admin{padding:15px}.page-head,.table-head{align-items:stretch;flex-direction:column}.head-actions,.filters{justify-content:flex-start;flex-wrap:wrap}.metrics,.dashboard-grid,.cleanup-form,.preview-summary{grid-template-columns:1fr}.subtabs{overflow:auto}.confirm-row{align-items:stretch;flex-direction:column}.confirm-row input,.search-field input{width:100%}}
</style>