<template>
  <section class="release-manager">
    <header class="head">
      <div>
        <span class="eyebrow">CỔNG ÁP DỤNG CÓ KIỂM SOÁT</span>
        <h2>Quản lý AI Release</h2>
        <p>Đóng gói cấu hình đã kiểm thử, phê duyệt độc lập rồi mới áp dụng hoặc khôi phục.</p>
      </div>
      <button class="primary" type="button" @click="toggleCreate">
        <span class="mdi" :class="createOpen ? 'mdi-close' : 'mdi-plus'" />
        {{ createOpen ? 'Đóng' : 'Tạo Release' }}
      </button>
    </header>

    <div class="pointer-note">
      <span class="mdi mdi-source-branch" />
      <div><strong>Chỉ đổi con trỏ Release đang hoạt động</strong><p>Áp dụng và khôi phục không tự đổi trạng thái Production của từng lời nhắc, mô hình, kỹ năng hay nguồn tri thức. Ảnh chụp cấu hình luôn bất biến để kiểm toán.</p></div>
    </div>

    <p v-if="notice" class="notice" :class="{ error: !noticeOk }">
      <span class="mdi" :class="noticeOk ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline'" />{{ notice }}
    </p>

    <div class="stats">
      <article><span>Đang áp dụng</span><strong>{{ productionRelease ? 'v' + productionRelease.version : 'Chưa có' }}</strong><small>{{ productionRelease ? formatDate(productionRelease.deployedAt || productionRelease.createdAt) : 'Chưa kích hoạt Release' }}</small></article>
      <article><span>Chờ phê duyệt</span><strong>{{ pendingCount }}</strong><small>Cần người duyệt độc lập</small></article>
      <article><span>Sẵn sàng áp dụng</span><strong>{{ approvedCount }}</strong><small>Đã vượt cổng đánh giá</small></article>
      <article><span>Tổng phiên bản</span><strong>{{ releases.length }}</strong><small>Lịch sử bất biến</small></article>
    </div>

    <form v-if="createOpen" class="create-card" @submit.prevent="createRelease">
      <div class="form-head">
        <div><h3>Tạo ảnh chụp Release mới</h3><p>Chọn đúng các phiên bản cần khóa cùng nhau. Ảnh chụp không thể sửa sau khi tạo.</p></div>
        <b>{{ selectedComponentCount }} thành phần</b>
      </div>
      <p v-if="referenceLoading" class="loading-line">Đang tải danh mục cấu hình…</p>
      <div v-else class="pickers">
        <fieldset>
          <legend><span class="mdi mdi-message-text-outline" />Lời nhắc <b>{{ form.promptVersionIds.length }}</b></legend>
          <label v-for="prompt in references.promptVersions" :key="prompt.id">
            <input v-model="form.promptVersionIds" type="checkbox" :value="prompt.id" />
            <span><strong>{{ prompt.prompt?.name || prompt.prompt?.key || 'Lời nhắc' }} · v{{ prompt.version }}</strong><small>{{ prompt.status }} · {{ prompt.prompt?.taskType || 'chưa phân loại' }}</small></span>
          </label>
          <p v-if="!references.promptVersions.length">Chưa có phiên bản khả dụng.</p>
        </fieldset>
        <fieldset>
          <legend><span class="mdi mdi-connection" />Mô hình <b>{{ form.modelConfigIds.length }}</b></legend>
          <label v-for="model in references.modelConfigs" :key="model.id">
            <input v-model="form.modelConfigIds" type="checkbox" :value="model.id" />
            <span><strong>{{ model.name }}</strong><small>{{ model.provider }} / {{ model.model }} · {{ model.status }}</small></span>
          </label>
          <p v-if="!references.modelConfigs.length">Chưa có mô hình khả dụng.</p>
        </fieldset>
        <fieldset>
          <legend><span class="mdi mdi-puzzle-outline" />Kỹ năng <b>{{ form.skillIds.length }}</b></legend>
          <label v-for="skill in references.skills" :key="skill.id">
            <input v-model="form.skillIds" type="checkbox" :value="skill.id" />
            <span><strong>{{ skill.name }}</strong><small>{{ skill.key }} · rủi ro {{ skill.riskTier }}</small></span>
          </label>
          <p v-if="!references.skills.length">Chưa có kỹ năng khả dụng.</p>
        </fieldset>
        <fieldset>
          <legend><span class="mdi mdi-book-open-page-variant-outline" />Kho tri thức <b>{{ form.knowledgeSourceIds.length }}</b></legend>
          <label v-for="source in knowledgeSources" :key="source.id">
            <input v-model="form.knowledgeSourceIds" type="checkbox" :value="source.id" />
            <span><strong>{{ source.name }}</strong><small>{{ source.type }} · v{{ source.version }} · {{ source.status }}</small></span>
          </label>
          <p v-if="!knowledgeSources.length">Chưa có nguồn tri thức khả dụng.</p>
        </fieldset>
      </div>
      <div class="evaluation-input">
        <label for="create-run">Lượt đánh giá đạt <small>khuyến nghị gắn ngay khi tạo</small></label>
        <div>
          <input id="create-run" v-model.trim="form.evaluationRunId" list="release-evaluation-runs" placeholder="Nhập hoặc chọn ID lượt đánh giá đã đạt" />
          <button class="ghost refresh-runs" type="button" :disabled="evaluationLoading" title="Làm mới lượt đánh giá đạt" @click="loadEvaluationRuns"><span class="mdi" :class="evaluationLoading ? 'mdi-loading mdi-spin' : 'mdi-refresh'" /></button>
          <button class="ghost" type="button" @click="openEvaluations">Mở Đánh giá</button>
        </div>
        <p>Lượt chạy phải thuộc tổ chức, đã hoàn tất, đạt ngưỡng và khớp ảnh chụp.</p>
        <p v-if="evaluationLoading" class="run-state"><span class="mdi mdi-loading mdi-spin" />Đang tải lịch sử đánh giá…</p>
        <p v-else-if="evaluationError" class="run-state error"><span class="mdi mdi-alert-circle-outline" />{{ evaluationError }} <button type="button" @click="loadEvaluationRuns">Thử lại</button></p>
        <p v-else-if="passingEvaluationRuns.length" class="run-state success"><span class="mdi mdi-check-circle-outline" />Có {{ passingEvaluationRuns.length }} lượt đánh giá đã hoàn tất và đạt ngưỡng để chọn.</p>
        <p v-else class="run-state warning"><span class="mdi mdi-information-outline" />Chưa có lượt đánh giá đạt. Bạn vẫn có thể nhập ID thủ công để backend xác minh.</p>
      </div>
      <div class="form-actions"><button class="ghost" type="button" @click="toggleCreate">Hủy</button><button class="primary" :disabled="saving || !selectedComponentCount">{{ saving ? 'Đang khóa…' : 'Tạo bản nháp bất biến' }}</button></div>
    </form>

    <datalist id="release-evaluation-runs"><option v-for="run in passingEvaluationRuns" :key="run.id" :value="run.id">{{ run.name }} · {{ formatScore(run.metrics.averageScore) }} · {{ run.completedAt ? formatDate(run.completedAt) : 'đã hoàn tất' }}</option></datalist>

    <div class="workspace">
      <aside class="release-list">
        <div class="tools">
          <label><span class="mdi mdi-magnify" /><input v-model="search" type="search" placeholder="Tìm phiên bản, mô hình, kỹ năng…" /></label>
          <select v-model="statusFilter"><option value="">Tất cả trạng thái</option><option v-for="status in statusOptions" :key="status" :value="status">{{ releaseStatusMeta(status).shortLabel }}</option></select>
        </div>
        <div v-if="loading" class="empty"><span class="mdi mdi-loading mdi-spin" />Đang tải Release…</div>
        <div v-else-if="!filteredReleases.length" class="empty"><span class="mdi mdi-package-variant-closed" /><strong>{{ releases.length ? 'Không có kết quả' : 'Chưa có Release' }}</strong><p>{{ releases.length ? 'Hãy đổi từ khóa hoặc bộ lọc.' : 'Tạo ảnh chụp đầu tiên để bắt đầu.' }}</p></div>
        <button v-for="release in filteredReleases" v-else :key="release.id" class="release-row" :class="{ active: selectedId === release.id }" @click="selectRelease(release.id)">
          <b>v{{ release.version }}</b><span><em :class="['pill', releaseStatusMeta(release.status).tone]">{{ releaseStatusMeta(release.status).shortLabel }}</em><small>{{ releaseComponentCount(release) }} thành phần · {{ formatDate(release.createdAt) }}</small></span><i class="mdi mdi-chevron-right" />
        </button>
      </aside>

      <main class="detail">
        <div v-if="detailLoading" class="empty"><span class="mdi mdi-loading mdi-spin" />Đang kiểm tra tính toàn vẹn…</div>
        <div v-else-if="!selectedRelease" class="empty"><span class="mdi mdi-source-branch" /><strong>Chọn một Release để rà soát</strong><p>Thành phần, cổng đánh giá và thao tác hợp lệ sẽ hiển thị tại đây.</p></div>
        <template v-else>
          <header class="detail-head">
            <div><div><h3>Release v{{ selectedRelease.version }}</h3><em :class="['pill', selectedStatus.tone]">{{ selectedStatus.label }}</em></div><p>{{ selectedStatus.description }}</p></div>
            <button class="icon" title="Làm mới" @click="loadReleases(selectedRelease.id)"><span class="mdi mdi-refresh" /></button>
          </header>

          <ol class="lifecycle">
            <li v-for="(step, index) in lifecycleSteps" :key="step" :class="{ done: lifecycleIndex > index || selectedRelease.status === 'superseded' || selectedRelease.status === 'rolled_back', current: lifecycleIndex === index }"><b>{{ index + 1 }}</b><span>{{ releaseStatusMeta(step).shortLabel }}</span></li>
          </ol>
          <p v-if="lifecycleIndex < 0" :class="['terminal', selectedStatus.tone]">{{ selectedStatus.description }}</p>

          <section class="gate" :class="{ passed: selectedRelease.evaluationRunId }">
            <span class="mdi" :class="selectedRelease.evaluationRunId ? 'mdi-shield-check-outline' : 'mdi-shield-alert-outline'" />
            <div><strong>{{ selectedRelease.evaluationRunId ? 'Đã gắn cổng đánh giá' : 'Chưa gắn cổng đánh giá' }}</strong><p v-if="selectedRelease.evaluationRunId">Run <code>{{ selectedRelease.evaluationRunId }}</code> được backend kiểm tra lại ở từng bước.</p><p v-else>Bản nháp chưa thể gửi duyệt nếu không có lượt đánh giá đạt.</p></div>
            <button @click="openEvaluations">Xem đánh giá</button>
          </section>
          <div v-if="selectedRelease.status === 'draft'" class="submit-gate"><label for="submit-run">Lượt đánh giá dùng để gửi duyệt</label><input id="submit-run" v-model.trim="gateRunId" list="release-evaluation-runs" placeholder="ID lượt đánh giá đã đạt" /><small>Có thể bổ sung ở bước này nếu chưa gắn khi tạo.</small></div>

          <section class="snapshot">
            <header><div><h4>Ảnh chụp cấu hình</h4><p>{{ releaseComponentCount(selectedRelease) }} thành phần · schema v{{ selectedRelease.snapshot.schemaVersion }}</p></div><code :title="selectedRelease.snapshotHash">{{ shortHash(selectedRelease.snapshotHash) }}</code></header>
            <div class="snapshot-grid">
              <article><h5><span class="mdi mdi-message-text-outline" />Lời nhắc <b>{{ snapshotCounts.prompts }}</b></h5><ul v-if="selectedRelease.snapshot.promptVersions.length"><li v-for="item in selectedRelease.snapshot.promptVersions" :key="item.id"><strong>{{ promptLabel(item.id, item.promptId) }}</strong><small>v{{ item.version }} · {{ item.status }}</small></li></ul><p v-else>Không có trong Release này.</p></article>
              <article><h5><span class="mdi mdi-connection" />Mô hình <b>{{ snapshotCounts.models }}</b></h5><ul v-if="selectedRelease.snapshot.modelConfigs.length"><li v-for="item in selectedRelease.snapshot.modelConfigs" :key="item.id"><strong>{{ item.name }}</strong><small>{{ item.provider }} / {{ item.model }} · {{ item.status }}</small></li></ul><p v-else>Không có trong Release này.</p></article>
              <article><h5><span class="mdi mdi-puzzle-outline" />Kỹ năng <b>{{ snapshotCounts.skills }}</b></h5><ul v-if="selectedRelease.snapshot.skills.length"><li v-for="item in selectedRelease.snapshot.skills" :key="item.id"><strong>{{ item.name }}</strong><small>{{ item.key }} · rủi ro {{ item.riskTier }}</small></li></ul><p v-else>Không có trong Release này.</p></article>
              <article><h5><span class="mdi mdi-book-open-page-variant-outline" />Kho tri thức <b>{{ snapshotCounts.knowledge }}</b></h5><ul v-if="snapshotCounts.knowledge"><li v-for="item in selectedRelease.snapshot.knowledgeSources" :key="'s-' + item.id"><strong>{{ item.name }}</strong><small>{{ item.type }} · v{{ item.version }} · {{ item.status }}</small></li><li v-for="item in selectedRelease.snapshot.knowledgeDocuments" :key="'d-' + item.id"><strong>{{ item.title }}</strong><small>Tài liệu v{{ item.version }} · {{ item.status }}</small></li></ul><p v-else>Không có trong Release này.</p></article>
            </div>
          </section>

          <div class="facts"><div><span>Tạo lúc</span><b>{{ formatDate(selectedRelease.createdAt) }}</b></div><div><span>Phê duyệt</span><b>{{ selectedRelease.approvedAt ? formatDate(selectedRelease.approvedAt) : 'Chưa có' }}</b></div><div><span>Áp dụng</span><b>{{ selectedRelease.deployedAt ? formatDate(selectedRelease.deployedAt) : 'Chưa có' }}</b></div><div><span>Release trước</span><b>{{ selectedRelease.previousReleaseId ? shortId(selectedRelease.previousReleaseId) : 'Không có' }}</b></div></div>

          <footer class="action-bar">
            <p><span class="mdi mdi-account-switch-outline" /><strong>Maker–checker bắt buộc.</strong> Người tạo không được tự phê duyệt; backend kiểm tra quyền và cổng đánh giá ở từng bước.</p>
            <div><button v-for="item in selectedActions" :key="item.action" :class="item.tone" :disabled="saving || !item.enabled" :title="item.reason" @click="runAction(item.action)"><span v-if="saving && activeAction === item.action" class="mdi mdi-loading mdi-spin" />{{ saving && activeAction === item.action ? 'Đang xử lý…' : item.label }}</button></div>
          </footer>
        </template>
      </main>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { approveAiRelease, createAiRelease, deployAiRelease, getAiRelease, listAiReleases, rollbackAiRelease, submitAiRelease, type AiReleaseRecord, type AiReleaseStatus } from '@/api/ai-releases';
import { listAiAgentReferences, type AiAgentReferences } from '@/api/ai-agents';
import { listEvaluationKnowledgeSources, listEvaluationRuns, type AiEvaluationHistoryRun, type AiEvaluationKnowledgeReference } from '@/api/ai-evaluations';
import { filterAiReleases, releaseActionStates, releaseComponentCount, releaseErrorMessage, releaseLifecycleIndex, releaseSnapshotCounts, releaseStatusMeta, type ReleaseAction } from './release-manager-view-model';

const router = useRouter();
const aborter = new AbortController();
const loading = ref(false), detailLoading = ref(false), referenceLoading = ref(false), evaluationLoading = ref(false), saving = ref(false), createOpen = ref(false);
const evaluationError = ref('');
const releases = ref<AiReleaseRecord[]>([]), selectedId = ref(''), selectedDetail = ref<AiReleaseRecord | null>(null);
const search = ref(''), statusFilter = ref<'' | AiReleaseStatus>(''), gateRunId = ref(''), notice = ref(''), noticeOk = ref(true);
const activeAction = ref<ReleaseAction | ''>('');
const references = reactive<AiAgentReferences>({ personas: [], promptVersions: [], modelConfigs: [], skills: [], capabilities: [] });
const knowledgeSources = ref<AiEvaluationKnowledgeReference[]>([]);
const evaluationRuns = ref<AiEvaluationHistoryRun[]>([]);
const form = reactive({ promptVersionIds: [] as string[], modelConfigIds: [] as string[], skillIds: [] as string[], knowledgeSourceIds: [] as string[], evaluationRunId: '' });
const statusOptions: AiReleaseStatus[] = ['draft', 'pending_approval', 'approved', 'production', 'superseded', 'rolled_back', 'failed'];
const lifecycleSteps: AiReleaseStatus[] = ['draft', 'pending_approval', 'approved', 'production'];

const filteredReleases = computed(() => filterAiReleases(releases.value, search.value, statusFilter.value));
const selectedRelease = computed(() => selectedDetail.value || releases.value.find((item) => item.id === selectedId.value) || null);
const selectedStatus = computed(() => releaseStatusMeta(selectedRelease.value?.status || 'draft'));
const snapshotCounts = computed(() => selectedRelease.value ? releaseSnapshotCounts(selectedRelease.value) : { prompts: 0, models: 0, skills: 0, knowledge: 0 });
const lifecycleIndex = computed(() => selectedRelease.value ? releaseLifecycleIndex(selectedRelease.value.status) : -1);
const productionRelease = computed(() => releases.value.find((item) => item.status === 'production') || null);
const pendingCount = computed(() => releases.value.filter((item) => item.status === 'pending_approval').length);
const approvedCount = computed(() => releases.value.filter((item) => item.status === 'approved').length);
const selectedComponentCount = computed(() => form.promptVersionIds.length + form.modelConfigIds.length + form.skillIds.length + form.knowledgeSourceIds.length);
const passingEvaluationRuns = computed(() => evaluationRuns.value.filter((run) => run.status === 'completed' && run.metrics.passed === true));
const selectedActions = computed(() => selectedRelease.value ? releaseActionStates(selectedRelease.value).map((item) => item.action === 'submit' && gateRunId.value ? { ...item, enabled: true, reason: undefined } : item) : []);

function showNotice(text: string, ok = true) { notice.value = text; noticeOk.value = ok; window.setTimeout(() => { if (notice.value === text) notice.value = ''; }, 5000); }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Không rõ' : date.toLocaleString('vi-VN'); }
function shortId(value: string) { return value.length > 12 ? value.slice(0, 8) + '…' + value.slice(-4) : value; }
function shortHash(value: string) { return value ? 'SHA ' + value.slice(0, 10) + '…' : 'Chưa có hash'; }
function formatScore(value: number | null) { return value === null ? 'chưa có điểm' : value.toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' điểm'; }
function promptLabel(versionId: string, promptId: string) { const ref = references.promptVersions.find((item) => item.id === versionId); return ref?.prompt?.name || ref?.prompt?.key || 'Prompt ' + shortId(promptId); }
function resetForm() { form.promptVersionIds = []; form.modelConfigIds = []; form.skillIds = []; form.knowledgeSourceIds = []; form.evaluationRunId = ''; }
function toggleCreate() { createOpen.value = !createOpen.value; if (createOpen.value) void loadEvaluationRuns(); else resetForm(); }
function openEvaluations() { void router.push('/settings/crm/ai-assistant/evaluations'); }

async function loadEvaluationRuns() {
  evaluationLoading.value = true;
  evaluationError.value = '';
  try {
    evaluationRuns.value = await listEvaluationRuns({ status: 'completed', limit: 100 }, aborter.signal);
  } catch (error) {
    if (!aborter.signal.aborted) evaluationError.value = releaseErrorMessage(error, 'Không tải được lịch sử đánh giá.');
  } finally {
    evaluationLoading.value = false;
  }
}

async function loadReferences() {
  referenceLoading.value = true;
  try {
    const [refs, sources] = await Promise.all([listAiAgentReferences(aborter.signal), listEvaluationKnowledgeSources(aborter.signal)]);
    Object.assign(references, refs); knowledgeSources.value = sources;
  } catch (error) { if (!aborter.signal.aborted) showNotice(releaseErrorMessage(error, 'Không tải được danh mục cấu hình.'), false); }
  finally { referenceLoading.value = false; }
}
async function loadReleases(preferredId?: string) {
  loading.value = true;
  try {
    const result = await listAiReleases({ limit: 100, signal: aborter.signal }); releases.value = result.releases || [];
    const id = preferredId && releases.value.some((item) => item.id === preferredId) ? preferredId : selectedId.value && releases.value.some((item) => item.id === selectedId.value) ? selectedId.value : releases.value[0]?.id || '';
    if (id) await selectRelease(id); else { selectedId.value = ''; selectedDetail.value = null; }
  } catch (error) { if (!aborter.signal.aborted) showNotice(releaseErrorMessage(error, 'Không tải được danh sách Release.'), false); }
  finally { loading.value = false; }
}
async function selectRelease(id: string) {
  selectedId.value = id; selectedDetail.value = releases.value.find((item) => item.id === id) || null; gateRunId.value = selectedDetail.value?.evaluationRunId || ''; detailLoading.value = true;
  try { selectedDetail.value = await getAiRelease(id, aborter.signal); gateRunId.value = selectedDetail.value.evaluationRunId || gateRunId.value; }
  catch (error) { if (!aborter.signal.aborted) showNotice(releaseErrorMessage(error, 'Không tải được chi tiết Release.'), false); }
  finally { detailLoading.value = false; }
}
async function createRelease() {
  if (saving.value || !selectedComponentCount.value) return; saving.value = true;
  try {
    const created = await createAiRelease({ snapshot: { promptVersionIds: [...form.promptVersionIds], modelConfigIds: [...form.modelConfigIds], skillIds: [...form.skillIds], knowledgeSourceIds: [...form.knowledgeSourceIds] }, evaluationRunId: form.evaluationRunId || null });
    showNotice('Đã tạo Release v' + created.version + ' với ảnh chụp bất biến.'); createOpen.value = false; resetForm(); await loadReleases(created.id);
  } catch (error) { showNotice(releaseErrorMessage(error), false); } finally { saving.value = false; }
}
function confirmation(action: ReleaseAction, release: AiReleaseRecord) {
  if (action === 'submit') return 'Gửi Release v' + release.version + ' sang phê duyệt? Backend sẽ kiểm tra lại ảnh chụp và lượt đánh giá.';
  if (action === 'approve') return 'Phê duyệt Release v' + release.version + '? Người duyệt phải khác người tạo.';
  if (action === 'deploy') return 'Áp dụng Release v' + release.version + '? Chỉ con trỏ Release hoạt động được đổi; bản hiện tại sẽ bị thay thế.';
  return 'Khôi phục bản trước Release v' + release.version + '? Con trỏ hoạt động sẽ quay về phiên bản trước.';
}
async function runAction(action: ReleaseAction) {
  const release = selectedRelease.value; if (!release || saving.value) return;
  if (action === 'submit' && !gateRunId.value) { showNotice('Hãy nhập ID lượt đánh giá đạt trước khi gửi duyệt.', false); return; }
  if (!window.confirm(confirmation(action, release))) return;
  saving.value = true; activeAction.value = action;
  try {
    let id = release.id;
    if (action === 'submit') { await submitAiRelease(id, gateRunId.value); showNotice('Đã gửi Release v' + release.version + ' sang phê duyệt.'); }
    else if (action === 'approve') { await approveAiRelease(id); showNotice('Đã phê duyệt Release v' + release.version + '.'); }
    else if (action === 'deploy') { await deployAiRelease(id); showNotice('Release v' + release.version + ' đang là con trỏ hoạt động.'); }
    else { const result = await rollbackAiRelease(id); id = result.activeRelease.id; showNotice('Đã khôi phục Release v' + result.activeRelease.version + '.'); }
    await Promise.all([loadReleases(id), loadEvaluationRuns()]);
  } catch (error) { showNotice(releaseErrorMessage(error), false); } finally { saving.value = false; activeAction.value = ''; }
}
onMounted(() => { void Promise.all([loadReferences(), loadReleases(), loadEvaluationRuns()]); });
onBeforeUnmount(() => aborter.abort());
</script>

<style scoped>
.release-manager{margin-bottom:24px;overflow:hidden;border:1px solid #dbe4f0;border-radius:12px;background:#f6f8fb;color:#1e293b}.head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:18px 20px;border-bottom:1px solid #e2e8f0;background:#fff}.eyebrow{display:block;margin-bottom:4px;color:#2563eb;font-size:9px;font-weight:800;letter-spacing:.09em}.head h2{margin:0;color:#172033;font-size:19px}.head p{margin:5px 0 0;color:#64748b;font-size:12px}.primary,.ghost{min-height:36px;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer}.primary{border:1px solid #2563eb;background:#2563eb;color:#fff}.primary:disabled{border-color:#94a3b8;background:#94a3b8;cursor:not-allowed}.ghost{border:1px solid #cbd5e1;background:#fff;color:#334155}.head .primary{display:flex;align-items:center;gap:5px;white-space:nowrap}.pointer-note{display:flex;gap:10px;margin:12px;padding:11px 13px;border:1px solid #bae6fd;border-radius:9px;background:#f0f9ff;color:#0c4a6e}.pointer-note>.mdi{font-size:21px}.pointer-note strong{font-size:12px}.pointer-note p{margin:2px 0 0;color:#075985;font-size:11px;line-height:1.5}.notice{display:flex;align-items:center;gap:6px;margin:10px 12px;padding:9px 11px;border:1px solid #bbf7d0;border-radius:8px;background:#f0fdf4;color:#166534;font-size:12px}.notice.error{border-color:#fecaca;background:#fff1f2;color:#991b1b}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 12px 12px}.stats article{padding:11px 12px;border:1px solid #dbe4f0;border-radius:9px;background:#fff}.stats span,.stats small{display:block;color:#64748b;font-size:10px}.stats strong{display:block;margin:3px 0;color:#0f172a;font-size:19px}.create-card{margin:0 12px 12px;padding:15px;border:1px solid #bfdbfe;border-radius:10px;background:#fff;box-shadow:0 5px 18px rgba(30,64,175,.07)}.form-head{display:flex;justify-content:space-between;gap:12px;padding-bottom:11px;border-bottom:1px solid #e2e8f0}.form-head h3{margin:0;font-size:15px}.form-head p{margin:4px 0 0;color:#64748b;font-size:11px}.form-head>b{align-self:start;padding:4px 8px;border-radius:99px;background:#eff6ff;color:#1d4ed8;font-size:10px;white-space:nowrap}.loading-line{padding:25px;color:#64748b;text-align:center}.pickers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}.pickers fieldset{min-width:0;max-height:210px;margin:0;padding:8px;overflow:auto;border:1px solid #dbe4f0;border-radius:8px;background:#f8fafc}.pickers legend{display:flex;align-items:center;gap:6px;padding:0 5px;font-size:11px;font-weight:750}.pickers legend b{padding:1px 5px;border-radius:99px;background:#dbeafe;color:#1d4ed8;font-size:9px}.pickers label{display:flex;gap:8px;padding:7px;border-radius:7px;cursor:pointer}.pickers label:hover{background:#fff}.pickers input{width:15px;height:15px;margin-top:2px;accent-color:#2563eb}.pickers label span{min-width:0}.pickers label strong,.pickers label small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pickers label strong{font-size:11px}.pickers label small{margin-top:2px;color:#64748b;font-size:10px}.pickers fieldset>p{color:#94a3b8;font-size:11px;text-align:center}.evaluation-input,.submit-gate{margin-top:12px;padding:10px;border-radius:8px;background:#f8fafc}.evaluation-input label,.submit-gate label{display:block;margin-bottom:5px;font-size:11px;font-weight:750}.evaluation-input label small{color:#64748b;font-weight:500}.evaluation-input>div{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:7px}.refresh-runs{width:36px;padding:0}.refresh-runs:disabled{opacity:.6;cursor:not-allowed}.evaluation-input input,.submit-gate input,.tools input,.tools select{box-sizing:border-box;width:100%;min-height:36px;padding:7px 9px;border:1px solid #cbd5e1;border-radius:7px;outline:0;background:#fff;color:#1e293b;font:12px inherit}.evaluation-input p,.submit-gate small{display:block;margin:5px 0 0;color:#64748b;font-size:10px}.evaluation-input .run-state{display:flex;align-items:center;gap:5px;margin-top:7px;padding:6px 8px;border-radius:6px;background:#f1f5f9}.evaluation-input .run-state.success{background:#ecfdf5;color:#047857}.evaluation-input .run-state.warning{background:#fffbeb;color:#92400e}.evaluation-input .run-state.error{background:#fff1f2;color:#b91c1c}.run-state button{margin-left:auto;border:0;background:transparent;color:inherit;font-size:10px;font-weight:750;cursor:pointer;text-decoration:underline}.form-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:12px}.workspace{display:grid;grid-template-columns:280px minmax(0,1fr);min-height:610px;border-top:1px solid #dbe4f0;background:#fff}.release-list{min-width:0;border-right:1px solid #e2e8f0;background:#fbfcfe}.tools{display:grid;gap:7px;padding:10px;border-bottom:1px solid #e2e8f0}.tools label{position:relative}.tools label .mdi{position:absolute;left:9px;top:9px;color:#94a3b8;font-size:17px}.tools input{padding-left:31px}.tools select{color:#475569;font-size:11px}.release-row{display:flex;align-items:center;gap:9px;width:100%;min-height:62px;padding:9px 10px;border:0;border-bottom:1px solid #edf1f5;background:transparent;text-align:left;cursor:pointer}.release-row:hover{background:#f1f5f9}.release-row.active{box-shadow:inset 3px 0 #2563eb;background:#eff6ff}.release-row>b{flex:0 0 36px;color:#172033;font-size:14px}.release-row>span{min-width:0;flex:1}.release-row small{display:block;margin-top:5px;overflow:hidden;color:#64748b;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.release-row>i{color:#94a3b8}.pill{display:inline-flex;padding:3px 7px;border:1px solid #cbd5e1;border-radius:99px;background:#f8fafc;color:#475569;font-size:9px;font-style:normal;font-weight:750}.pill.warning{border-color:#fde68a;background:#fffbeb;color:#92400e}.pill.ready{border-color:#bfdbfe;background:#eff6ff;color:#1d4ed8}.pill.live{border-color:#a7f3d0;background:#ecfdf5;color:#047857}.pill.muted{border-color:#e2e8f0;background:#f1f5f9;color:#64748b}.pill.danger{border-color:#fecaca;background:#fff1f2;color:#b91c1c}.empty{display:flex;min-height:190px;padding:24px;flex-direction:column;align-items:center;justify-content:center;gap:7px;color:#94a3b8;font-size:12px;text-align:center}.empty>.mdi{font-size:27px}.empty strong{color:#475569}.empty p{margin:0}.detail{min-width:0;padding:17px}.detail-head{display:flex;justify-content:space-between;gap:12px}.detail-head>div>div{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.detail-head h3{margin:0;color:#172033;font-size:18px}.detail-head p{margin:5px 0 0;color:#64748b;font-size:11px}.icon{width:34px;height:34px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#475569;cursor:pointer}.lifecycle{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:16px 0;padding:0;list-style:none}.lifecycle li{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;color:#94a3b8}.lifecycle li:not(:last-child):after{position:absolute;top:11px;left:calc(50% + 13px);width:calc(100% - 26px);height:2px;background:#e2e8f0;content:''}.lifecycle li.done:not(:last-child):after{background:#86efac}.lifecycle b{z-index:1;display:grid;width:23px;height:23px;place-items:center;border:2px solid #cbd5e1;border-radius:50%;background:#fff;font-size:9px}.lifecycle .done b{border-color:#22c55e;background:#dcfce7;color:#15803d}.lifecycle .current b{border-color:#2563eb;background:#dbeafe;color:#1d4ed8;box-shadow:0 0 0 3px #eff6ff}.lifecycle span{font-size:9px}.lifecycle .current span{color:#1d4ed8;font-weight:750}.terminal{padding:8px 10px;border-radius:7px;background:#f1f5f9;color:#64748b;font-size:10px}.terminal.danger{background:#fff1f2;color:#b91c1c}.gate{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:11px 12px;border:1px solid #fed7aa;border-radius:9px;background:#fff7ed;color:#9a3412}.gate.passed{border-color:#bbf7d0;background:#f0fdf4;color:#166534}.gate>.mdi{font-size:23px}.gate strong{font-size:11px}.gate p{margin:3px 0 0;font-size:10px}.gate code{font-size:9px;word-break:break-all}.gate button{border:0;background:transparent;color:#1d4ed8;font-size:10px;font-weight:700;cursor:pointer}.submit-gate{border:1px dashed #f59e0b;background:#fffbeb}.snapshot{margin-top:15px}.snapshot>header{display:flex;justify-content:space-between;gap:10px;margin-bottom:9px}.snapshot h4{margin:0;font-size:13px}.snapshot header p{margin:3px 0 0;color:#64748b;font-size:10px}.snapshot header>code{align-self:start;padding:4px 7px;border-radius:5px;background:#f1f5f9;color:#475569;font-size:9px}.snapshot-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.snapshot-grid article{min-width:0;padding:10px;border:1px solid #dbe4f0;border-radius:8px;background:#fbfcfe}.snapshot-grid h5{display:flex;align-items:center;gap:6px;margin:0;padding-bottom:7px;border-bottom:1px solid #e2e8f0;font-size:11px}.snapshot-grid h5 b{margin-left:auto;padding:2px 5px;border-radius:99px;background:#e2e8f0;font-size:9px}.snapshot-grid ul{max-height:145px;margin:7px 0 0;padding:0;overflow:auto;list-style:none}.snapshot-grid li{padding:5px 0;border-bottom:1px solid #edf1f5}.snapshot-grid li strong,.snapshot-grid li small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.snapshot-grid li strong{font-size:10px}.snapshot-grid li small{margin-top:2px;color:#64748b;font-size:9px}.snapshot-grid article>p{color:#94a3b8;font-size:10px;text-align:center}.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin-top:12px;overflow:hidden;border:1px solid #e2e8f0;border-radius:8px;background:#e2e8f0}.facts div{min-width:0;padding:8px;background:#f8fafc}.facts span,.facts b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.facts span{color:#64748b;font-size:9px}.facts b{margin-top:3px;font-size:10px}.action-bar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:15px -17px -17px;padding:11px 17px;border-top:1px solid #e2e8f0;background:#f8fafc}.action-bar>p{display:flex;align-items:flex-start;gap:6px;max-width:520px;margin:0;color:#64748b;font-size:9px;line-height:1.5}.action-bar>p .mdi{color:#2563eb;font-size:18px}.action-bar>p strong{color:#334155}.action-bar>div{display:flex;gap:7px}.action-bar button{min-height:34px;padding:6px 10px;border-radius:7px;font-size:11px;font-weight:750;cursor:pointer;white-space:nowrap}.action-bar button.primary{border:1px solid #2563eb;background:#2563eb;color:#fff}.action-bar button.secondary{border:1px solid #cbd5e1;background:#fff;color:#334155}.action-bar button.danger{border:1px solid #fca5a5;background:#fff1f2;color:#b91c1c}.action-bar button:disabled{opacity:.55;cursor:not-allowed}@media(max-width:950px){.workspace{grid-template-columns:240px minmax(0,1fr)}.facts{grid-template-columns:repeat(2,1fr)}}@media(max-width:800px){.stats,.pickers,.snapshot-grid{grid-template-columns:1fr 1fr}.workspace{grid-template-columns:1fr}.release-list{max-height:330px;overflow:auto;border-right:0;border-bottom:1px solid #e2e8f0}}@media(max-width:600px){.head,.action-bar{flex-direction:column}.stats,.pickers,.snapshot-grid,.facts{grid-template-columns:1fr}.evaluation-input>div{grid-template-columns:1fr auto}.evaluation-input>div .ghost:last-child{grid-column:1/-1}.gate{grid-template-columns:auto 1fr}.gate button{grid-column:2;justify-self:start}.action-bar>div{flex-direction:column}}
</style>
