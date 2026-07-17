<template>
  <section class="history-panel" aria-labelledby="evaluation-history-title">
    <header class="history-header">
      <div>
        <h3 id="evaluation-history-title"><span class="mdi mdi-history" /> Lịch sử đánh giá</h3>
        <p>Đối chiếu các lần chạy đã lưu trên máy chủ; chỉ hiển thị điểm và mã lỗi an toàn.</p>
      </div>
      <div class="history-controls">
        <label>
          Trạng thái
          <select v-model="statusFilter" @change="reload()">
            <option value="">Tất cả</option>
            <option value="completed">Đã đạt</option>
            <option value="failed">Không đạt</option>
            <option value="running">Đang chạy</option>
            <option value="queued">Đang chờ</option>
          </select>
        </label>
        <label class="current-toggle" :class="{ disabled: !currentTargetId }">
          <input v-model="currentTargetOnly" type="checkbox" :disabled="!currentTargetId" @change="reload()" />
          Chỉ target đang chọn
        </label>
        <button type="button" class="refresh-button" :disabled="loading" @click="reload()">
          <span class="mdi mdi-refresh" :class="{ spinning: loading }" /> {{ loading ? 'Đang tải…' : 'Làm mới' }}
        </button>
      </div>
    </header>

    <div v-if="error" class="history-error" role="alert">
      <span class="mdi mdi-alert-circle-outline" />
      <span>{{ error }}</span>
      <button type="button" @click="reload()">Thử lại</button>
    </div>

    <div v-if="loading && !runs.length" class="history-loading" aria-live="polite">
      <i /> Đang tải lịch sử từ máy chủ…
    </div>

    <div v-else-if="!runs.length" class="history-empty">
      <span class="mdi mdi-clipboard-text-clock-outline" />
      <strong>Chưa có lượt đánh giá phù hợp</strong>
      <p>Chạy evaluation mới hoặc đổi bộ lọc để xem lịch sử.</p>
    </div>

    <div v-else class="history-layout">
      <div class="run-list" role="list" aria-label="Danh sách lượt đánh giá">
        <button
          v-for="run in runs"
          :key="run.id"
          type="button"
          class="run-item"
          :class="{ selected: selectedId === run.id }"
          role="listitem"
          @click="selectRun(run.id)"
        >
          <span class="run-status" :class="statusClass(run)">{{ statusLabel(run) }}</span>
          <strong>{{ run.name }}</strong>
          <span class="run-target">
            {{ run.config.targetType ? targetTypeLabel(run.config.targetType) : 'Target' }} ·
            {{ targetLabel(run) }}
          </span>
          <span class="run-meta">
            <b>{{ scoreLabel(run.metrics.averageScore) }}</b>
            <span>Ngưỡng {{ scoreLabel(run.metrics.threshold) }}</span>
            <time>{{ formatDate(run.completedAt || run.createdAt) }}</time>
          </span>
        </button>
      </div>

      <article class="history-detail">
        <div v-if="detailLoading" class="detail-loading"><i /> Đang tải chi tiết…</div>
        <div v-else-if="detailError" class="detail-error" role="alert">
          <span class="mdi mdi-alert-outline" /> {{ detailError }}
        </div>
        <template v-else-if="detail">
          <header class="detail-header" :class="statusClass(detail)">
            <div class="detail-score">
              <strong>{{ plainScore(detail.metrics.averageScore) }}</strong><span>/100</span>
            </div>
            <div>
              <span>{{ statusLabel(detail) }}</span>
              <h4>{{ detail.name }}</h4>
              <p>{{ formatDate(detail.completedAt || detail.createdAt) }} · {{ detail.resultCount }} ca · ID {{ detail.id }}</p>
            </div>
          </header>

          <div class="detail-facts">
            <div><span>Target</span><strong>{{ detail.config.targetType ? targetTypeLabel(detail.config.targetType) : '—' }} · {{ targetLabel(detail) }}</strong></div>
            <div><span>Prompt</span><strong>{{ promptLabel(detail) }}</strong></div>
            <div><span>Model</span><strong>{{ modelLabel(detail) }}</strong></div>
            <div><span>Người chạy</span><strong>{{ detail.createdBy?.fullName || 'Hệ thống' }}</strong></div>
          </div>

          <div v-if="detail.metrics.criticalFailures.length" class="critical-box">
            <strong><span class="mdi mdi-shield-alert-outline" /> Lỗi trọng yếu</strong>
            <div><span v-for="key in detail.metrics.criticalFailures" :key="key">{{ humanizeEvaluationKey(key) }}</span></div>
          </div>

          <section class="history-cases">
            <div class="cases-title">
              <div><h5>Kết quả từng ca</h5><p>Không có input, output thô hoặc hash nội bộ trong màn hình này.</p></div>
              <span>{{ detail.results.length }} ca</span>
            </div>
            <details v-for="item in detail.results" :key="item.id" class="history-case">
              <summary>
                <span class="case-title"><i class="mdi" :class="item.status === 'completed' ? 'mdi-check-circle-outline' : 'mdi-close-circle-outline'" />{{ item.evaluationCase.name }}</span>
                <code v-if="item.errorCode">{{ item.errorCode }}</code>
                <b :class="scoreClass(caseScore(item.score))">{{ caseScore(item.score) }}/100</b>
                <span class="mdi mdi-chevron-down" />
              </summary>
              <div class="case-body">
                <div class="case-tags"><span v-for="tag in item.evaluationCase.tags" :key="tag">{{ tag }}</span></div>
                <div v-if="item.metrics.policyViolations.length" class="policy-codes">
                  <strong>Mã vi phạm:</strong> {{ item.metrics.policyViolations.join(', ') }}
                </div>
                <div class="criteria-grid">
                  <article v-for="criterion in historyCriteria(item)" :key="criterion.key" :class="{ critical: criterion.critical, failed: criterion.score < (detail.metrics.threshold ?? 80) }">
                    <div><span>{{ criterion.label }} <i v-if="criterion.critical">Critical</i></span><strong>{{ criterion.score }}</strong></div>
                    <div class="score-bar"><i :style="{ width: criterion.score + '%' }" /></div>
                  </article>
                </div>
              </div>
            </details>
          </section>
        </template>
        <div v-else class="detail-placeholder">Chọn một lượt chạy để xem chi tiết.</div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  getEvaluationRun,
  listEvaluationRuns,
  type AiEvaluationHistoryCaseResult,
  type AiEvaluationHistoryDetail,
  type AiEvaluationHistoryRun,
  type AiEvaluationRunStatus,
  type AiEvaluationTarget,
} from '@/api/ai-evaluations';
import { criteriaRows, humanizeEvaluationKey, targetTypeLabel } from './evaluation-view-model';

const props = defineProps<{
  currentTargetType: AiEvaluationTarget;
  currentTargetId: string;
}>();

const runs = ref<AiEvaluationHistoryRun[]>([]);
const loading = ref(false);
const error = ref('');
const statusFilter = ref<'' | AiEvaluationRunStatus>('');
const currentTargetOnly = ref(false);
const selectedId = ref('');
const detail = ref<AiEvaluationHistoryDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref('');
let listController: AbortController | null = null;
let detailController: AbortController | null = null;

function cancelled(value: unknown) {
  const item = value as { code?: string; name?: string };
  return item?.code === 'ERR_CANCELED' || item?.name === 'CanceledError' || item?.name === 'AbortError';
}

function errorText(value: any, fallback: string) {
  if (value?.response?.status === 403) return 'Bạn không có quyền xem lịch sử Evaluation AI.';
  return value?.response?.data?.error || value?.message || fallback;
}

function plainScore(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : '—';
}

function scoreLabel(value: number | null) {
  const result = plainScore(value);
  return result === '—' ? result : `${result}/100`;
}

function caseScore(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
}

function scoreClass(value: number) {
  return value >= 80 ? 'good' : value >= 60 ? 'warning' : 'bad';
}

function formatDate(value: string | null) {
  if (!value) return 'Chưa hoàn tất';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
    : 'Không rõ thời gian';
}

function statusClass(run: AiEvaluationHistoryRun) {
  if (run.status === 'completed' && run.metrics.passed === true) return 'passed';
  if (run.status === 'running' || run.status === 'queued') return 'pending';
  return 'failed';
}

function statusLabel(run: AiEvaluationHistoryRun) {
  if (run.status === 'completed' && run.metrics.passed === true) return 'Đạt';
  if (run.status === 'running') return 'Đang chạy';
  if (run.status === 'queued') return 'Đang chờ';
  return 'Không đạt';
}

function targetLabel(run: AiEvaluationHistoryRun) {
  return run.agent?.name || run.promptVersion?.prompt?.name || run.modelConfig?.name || run.config.targetId || 'Không rõ';
}

function promptLabel(run: AiEvaluationHistoryRun) {
  if (!run.promptVersion) return run.promptVersionId || '—';
  return `${run.promptVersion.prompt?.name || 'Prompt'} · v${run.promptVersion.version}`;
}

function modelLabel(run: AiEvaluationHistoryRun) {
  if (!run.modelConfig) return run.modelConfigId || '—';
  return `${run.modelConfig.name} · ${run.modelConfig.provider}/${run.modelConfig.model}`;
}

function historyCriteria(item: AiEvaluationHistoryCaseResult) {
  return criteriaRows({
    key: item.evaluationCase.key,
    score: caseScore(item.score),
    criteria: item.metrics.criteria,
  });
}

async function selectRun(runId: string) {
  selectedId.value = runId;
  detailController?.abort();
  detailController = new AbortController();
  detailLoading.value = true;
  detailError.value = '';
  try {
    detail.value = await getEvaluationRun(runId, detailController.signal);
  } catch (requestError) {
    if (!cancelled(requestError)) {
      detail.value = null;
      detailError.value = errorText(requestError, 'Không tải được chi tiết lượt đánh giá.');
    }
  } finally {
    detailLoading.value = false;
  }
}

async function reload(preferredRunId?: string) {
  listController?.abort();
  listController = new AbortController();
  loading.value = true;
  error.value = '';
  try {
    runs.value = await listEvaluationRuns({
      status: statusFilter.value || undefined,
      targetType: currentTargetOnly.value && props.currentTargetId ? props.currentTargetType : undefined,
      targetId: currentTargetOnly.value && props.currentTargetId ? props.currentTargetId : undefined,
      limit: 50,
    }, listController.signal);
    const nextId = preferredRunId && runs.value.some((run) => run.id === preferredRunId)
      ? preferredRunId
      : runs.value.some((run) => run.id === selectedId.value)
        ? selectedId.value
        : runs.value[0]?.id;
    if (nextId) await selectRun(nextId);
    else {
      selectedId.value = '';
      detail.value = null;
    }
  } catch (requestError) {
    if (!cancelled(requestError)) error.value = errorText(requestError, 'Không tải được lịch sử Evaluation.');
  } finally {
    loading.value = false;
  }
}

watch(() => [props.currentTargetType, props.currentTargetId], () => {
  if (currentTargetOnly.value) void reload();
});
onMounted(() => void reload());
onBeforeUnmount(() => { listController?.abort(); detailController?.abort(); });
defineExpose({ reload, selectRun });
</script>

<style scoped>
.history-panel { border-top: 1px solid #dbe4f0; background: #f8fafc; padding: 16px; }
.history-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 12px; }
.history-header h3 { display: flex; align-items: center; gap: 7px; margin: 0; color: #172033; font-size: 15px; }
.history-header h3 .mdi { color: #2563eb; font-size: 18px; }
.history-header p { margin: 4px 0 0; color: #64748b; font-size: 11px; line-height: 1.45; }
.history-controls { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; }
.history-controls label { display: flex; flex-direction: column; gap: 4px; color: #64748b; font-size: 9px; font-weight: 700; }
.history-controls select { min-height: 33px; padding: 5px 28px 5px 8px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: #334155; font-size: 10px; }
.history-controls .current-toggle { flex-direction: row; align-items: center; min-height: 33px; padding: 0 9px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: #475569; font-size: 10px; }
.current-toggle.disabled { opacity: .55; }
.refresh-button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 33px; padding: 5px 10px; border: 1px solid #2563eb; border-radius: 7px; background: #eff6ff; color: #1d4ed8; font-size: 10px; font-weight: 700; cursor: pointer; }
.refresh-button:disabled { cursor: wait; opacity: .65; }
.spinning { animation: spin .8s linear infinite; }
.history-error { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; padding: 9px 10px; border: 1px solid #fecaca; border-radius: 8px; background: #fff1f2; color: #991b1b; font-size: 10px; }
.history-error span:nth-child(2) { flex: 1; }.history-error button { border: 0; background: transparent; color: inherit; font-weight: 700; cursor: pointer; }
.history-loading, .detail-loading { display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 160px; color: #64748b; font-size: 11px; }
.history-loading i, .detail-loading i { width: 13px; height: 13px; border: 2px solid #cbd5e1; border-top-color: #2563eb; border-radius: 50%; animation: spin .8s linear infinite; }
.history-empty { display: flex; min-height: 150px; flex-direction: column; align-items: center; justify-content: center; color: #64748b; text-align: center; }
.history-empty > .mdi { color: #94a3b8; font-size: 32px; }.history-empty strong { margin-top: 6px; color: #334155; font-size: 12px; }.history-empty p { margin: 3px 0 0; font-size: 10px; }
.history-layout { display: grid; grid-template-columns: minmax(270px, .72fr) minmax(480px, 1.28fr); gap: 12px; min-height: 420px; }
.run-list { display: flex; flex-direction: column; gap: 7px; max-height: 620px; overflow: auto; padding-right: 3px; }
.run-item { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 5px 8px; width: 100%; padding: 10px; border: 1px solid #dbe4f0; border-radius: 9px; background: #fff; color: #334155; text-align: left; cursor: pointer; }
.run-item:hover { border-color: #93c5fd; }.run-item.selected { border-color: #3b82f6; box-shadow: 0 0 0 2px #dbeafe; }
.run-item > strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.run-status { align-self: center; padding: 2px 6px; border-radius: 999px; background: #fee2e2; color: #991b1b; font-size: 8px; font-weight: 800; text-transform: uppercase; }
.run-status.passed { background: #dcfce7; color: #166534; }.run-status.pending { background: #fef3c7; color: #92400e; }
.run-target { grid-column: 1 / -1; overflow: hidden; color: #64748b; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.run-meta { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; color: #94a3b8; font-size: 8px; }.run-meta b { color: #334155; }.run-meta time { margin-left: auto; }
.history-detail { min-width: 0; padding: 12px; border: 1px solid #dbe4f0; border-radius: 10px; background: #fff; }
.detail-error { padding: 10px; border-radius: 7px; background: #fff1f2; color: #991b1b; font-size: 10px; }.detail-placeholder { display: grid; min-height: 320px; place-items: center; color: #94a3b8; font-size: 11px; }
.detail-header { display: flex; align-items: center; gap: 12px; padding: 11px; border: 1px solid #fecaca; border-radius: 9px; background: #fff7f7; }.detail-header.passed { border-color: #bbf7d0; background: #f0fdf4; }.detail-header.pending { border-color: #fde68a; background: #fffbeb; }
.detail-score { display: grid; flex: 0 0 56px; width: 56px; height: 56px; place-content: center; border: 4px solid #fca5a5; border-radius: 50%; text-align: center; }.passed .detail-score { border-color: #4ade80; }.pending .detail-score { border-color: #fbbf24; }
.detail-score strong { color: #172033; font-size: 18px; line-height: 1; }.detail-score span { color: #64748b; font-size: 8px; }.detail-header > div:last-child > span { color: #b91c1c; font-size: 8px; font-weight: 800; text-transform: uppercase; }.detail-header.passed > div:last-child > span { color: #15803d; }.detail-header.pending > div:last-child > span { color: #b45309; }
.detail-header h4 { margin: 2px 0; color: #172033; font-size: 13px; }.detail-header p { margin: 0; color: #64748b; font-size: 9px; overflow-wrap: anywhere; }
.detail-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin: 10px 0; }.detail-facts div { min-width: 0; padding: 7px; border-radius: 7px; background: #f8fafc; }.detail-facts span { display: block; color: #94a3b8; font-size: 8px; text-transform: uppercase; }.detail-facts strong { display: block; margin-top: 2px; overflow: hidden; color: #475569; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.critical-box { padding: 9px; border: 1px solid #fecaca; border-radius: 8px; background: #fff7f7; }.critical-box > strong { color: #991b1b; font-size: 10px; }.critical-box > div { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 6px; }.critical-box > div span { padding: 3px 6px; border-radius: 5px; background: #fee2e2; color: #991b1b; font-size: 8px; }
.history-cases { margin-top: 10px; }.cases-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px; }.cases-title h5 { margin: 0; color: #334155; font-size: 11px; }.cases-title p { margin: 2px 0 0; color: #64748b; font-size: 8px; }.cases-title > span { padding: 3px 6px; border-radius: 999px; background: #eff6ff; color: #1d4ed8; font-size: 8px; font-weight: 700; }
.history-case { border-top: 1px solid #e2e8f0; }.history-case summary { display: grid; grid-template-columns: minmax(160px, 1fr) auto auto 16px; align-items: center; gap: 6px; padding: 9px 2px; list-style: none; cursor: pointer; }.history-case summary::-webkit-details-marker { display: none; }.history-case[open] summary > .mdi-chevron-down { transform: rotate(180deg); }.history-case summary > .mdi-chevron-down { color: #94a3b8; transition: transform .15s; }
.case-title { display: flex; align-items: center; gap: 5px; color: #334155; font-size: 10px; font-weight: 650; }.case-title .mdi-check-circle-outline { color: #16a34a; }.case-title .mdi-close-circle-outline { color: #dc2626; }.history-case summary code { color: #b45309; font-size: 8px; }.history-case summary b { padding: 3px 5px; border-radius: 5px; font-size: 8px; }.history-case summary b.good { background: #dcfce7; color: #166534; }.history-case summary b.warning { background: #fef3c7; color: #92400e; }.history-case summary b.bad { background: #fee2e2; color: #991b1b; }
.case-body { padding: 0 2px 10px; }.case-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }.case-tags span { padding: 2px 5px; border-radius: 4px; background: #f1f5f9; color: #64748b; font-size: 7px; }.policy-codes { margin-bottom: 6px; padding: 6px; border-radius: 5px; background: #fff7ed; color: #9a3412; font-size: 8px; }
.criteria-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }.criteria-grid article { padding: 6px; border: 1px solid #e2e8f0; border-radius: 6px; }.criteria-grid article.critical { border-left: 3px solid #7c3aed; }.criteria-grid article.failed { background: #fff7f7; }.criteria-grid article > div:first-child { display: flex; justify-content: space-between; gap: 5px; }.criteria-grid span { color: #475569; font-size: 8px; }.criteria-grid span i { color: #7c3aed; font-size: 6px; font-style: normal; font-weight: 750; text-transform: uppercase; }.criteria-grid strong { color: #334155; font-size: 8px; }.score-bar { height: 3px; margin-top: 4px; overflow: hidden; border-radius: 99px; background: #e2e8f0; }.score-bar i { display: block; height: 100%; background: #22c55e; }.criteria-grid article.failed .score-bar i { background: #ef4444; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 950px) { .history-header { align-items: flex-start; flex-direction: column; }.history-layout { grid-template-columns: 1fr; }.run-list { max-height: 330px; } }
@media (max-width: 600px) { .history-controls { width: 100%; }.history-controls > * { flex: 1; }.detail-facts, .criteria-grid { grid-template-columns: 1fr; }.history-case summary { grid-template-columns: minmax(120px, 1fr) auto 16px; }.history-case summary code { grid-column: 1 / -1; grid-row: 2; } }
@media (prefers-reduced-motion: reduce) { .spinning, .history-loading i, .detail-loading i { animation: none; } }
</style>
