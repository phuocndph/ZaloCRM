<template>
  <section class="evaluation-manager">
    <header class="panel-header">
      <div>
        <div class="title-row">
          <h2>Đánh giá AI phía máy chủ</h2>
          <span class="server-badge"><span class="mdi mdi-server-security" /> Server-side</span>
        </div>
        <p>Máy chủ tự sinh câu trả lời, chấm bộ ca kiểm thử và áp dụng cổng an toàn.</p>
      </div>
      <div class="header-actions">
        <button type="button" class="secondary" :disabled="referenceLoading" @click="loadReferences">
          <span class="mdi mdi-refresh" /> {{ referenceLoading ? 'Đang tải…' : 'Làm mới dữ liệu chọn' }}
        </button>
        <button type="button" class="seed-button" :disabled="seeding" @click="seedSuite">
          <span class="mdi mdi-database-plus-outline" /> {{ seeding ? 'Đang đồng bộ…' : 'Đồng bộ bộ ca khởi tạo' }}
        </button>
      </div>
    </header>

    <div class="trust-banner">
      <span class="mdi mdi-shield-check-outline" aria-hidden="true" />
      <div>
        <strong>Kết quả không do trình duyệt tự khai báo</strong>
        <p>Request không có trường outputs. Backend tạo output bằng model đã chọn; raw reply không được trả về hoặc lưu trong kết quả đánh giá.</p>
      </div>
      <div class="trust-flags"><span>clientOutputsAccepted=false</span><span>rawOutputsStored=false</span></div>
    </div>

    <div v-if="message" class="notice" :class="{ error: !messageOk }" role="status">
      <span class="mdi" :class="messageOk ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline'" />
      {{ message }}
      <button type="button" aria-label="Đóng thông báo" @click="message = ''">×</button>
    </div>

    <div v-if="referenceWarnings.length" class="reference-warning">
      <span class="mdi mdi-alert-outline" />
      <div><strong>Một số danh sách tham chiếu chưa tải được</strong><p v-for="warning in referenceWarnings" :key="warning">{{ warning }}</p></div>
    </div>

    <div class="layout">
      <form class="run-form" @submit.prevent="startRun">
        <div class="form-heading">
          <div><h3>Cấu hình lượt đánh giá</h3><p>Prompt version và model luôn bắt buộc đối với server runner.</p></div>
          <span v-if="referenceLoading" class="mini-loading"><i /> Đang tải tham chiếu</span>
        </div>

        <label>Tên lượt chạy
          <div class="name-field"><input v-model.trim="runName" required maxlength="180" placeholder="Ví dụ: Kiểm tra prompt CSKH v3" /><button type="button" @click="suggestRunName">Tạo tên</button></div>
        </label>

        <div class="form-grid two">
          <label>Loại target
            <select v-model="targetType">
              <option v-for="item in targetTypes" :key="item.value" :value="item.value">{{ item.label }}</option>
            </select>
          </label>
          <label>{{ targetTypeLabel(targetType) }} target
            <select v-if="targetOptions.length" v-model="targetId" required>
              <option value="" disabled>Chọn target</option>
              <option v-for="item in targetOptions" :key="item.id" :value="item.id">{{ item.label }}</option>
            </select>
            <input v-else v-model.trim="targetId" required :placeholder="targetIdPlaceholder" />
            <small v-if="targetType === 'policy'">Backend chưa có API danh sách policy; cần nhập ID thật.</small>
            <small v-else-if="targetType === 'agent'">Prompt và model được khóa theo cấu hình hiện tại của tác nhân.</small>
            <small v-else-if="!targetOptions.length && !referenceLoading">Không có danh sách khả dụng; có thể nhập ID nếu đã biết.</small>
          </label>
        </div>

        <div class="form-grid two">
          <label>Phiên bản prompt
            <select v-if="promptVersionOptions.length" v-model="promptVersionId" required>
              <option value="" disabled>Chọn prompt version</option>
              <option v-for="version in promptVersionOptions" :key="version.id" :value="version.id">{{ version.label }}</option>
            </select>
            <input v-else v-model.trim="promptVersionId" required placeholder="Prompt version ID" />
            <small v-if="targetType === 'prompt'">Chỉ hiển thị version thuộc prompt target đã chọn.</small>
          </label>
          <label>Mô hình chạy evaluation
            <select v-if="models.length" v-model="modelConfigId" required>
              <option value="" disabled>Chọn model config</option>
              <option v-for="model in models" :key="model.id" :value="model.id">{{ model.name }} · {{ model.provider }}/{{ model.model }} · {{ model.status }}</option>
            </select>
            <input v-else v-model.trim="modelConfigId" required placeholder="Model config ID" />
            <small>Danh sách API chỉ gồm model active/approved.</small>
          </label>
        </div>

        <label>Ngưỡng đạt
          <div class="threshold-field"><input v-model.number="threshold" type="range" min="0" max="100" step="1" /><input v-model.number="threshold" class="threshold-number" type="number" min="0" max="100" step="1" /><span>%</span></div>
          <small>Run chỉ đạt khi điểm trung bình đạt ngưỡng và không có critical failure.</small>
        </label>

        <div class="selection-summary">
          <div><span>Target</span><strong>{{ selectedTargetLabel || 'Chưa chọn' }}</strong></div>
          <div><span>Prompt</span><strong>{{ selectedPromptLabel || promptVersionId || 'Chưa chọn' }}</strong></div>
          <div><span>Model</span><strong>{{ selectedModelLabel || modelConfigId || 'Chưa chọn' }}</strong></div>
        </div>

        <button class="run-button" type="submit" :disabled="running || !canRun">
          <span class="mdi mdi-play-circle-outline" />
          {{ running ? 'Máy chủ đang đánh giá…' : 'Chạy đánh giá phía máy chủ' }}
        </button>

        <p class="history-note"><span class="mdi mdi-history" /> Kết quả được lưu phía máy chủ và xuất hiện trong lịch sử bên dưới.</p>
      </form>

      <main class="result-area">
        <div v-if="running" class="running-state" aria-live="polite">
          <div class="running-icon"><span class="mdi mdi-server-outline" /></div>
          <h3>Evaluation đang chạy trên máy chủ</h3>
          <p>{{ evaluationProgressPhase(elapsedSeconds) }}</p>
          <div class="indeterminate"><i /></div>
          <span>Đã chờ {{ elapsedSeconds }} giây · Không hiển thị phần trăm giả vì backend chưa có progress endpoint.</span>
        </div>

        <div v-else-if="runError" class="result-empty error-state" role="alert">
          <span class="mdi mdi-alert-octagon-outline" />
          <h3>Không chạy được evaluation</h3>
          <p>{{ runError }}</p>
          <div class="error-actions"><button v-if="runErrorCode === 'EVALUATION_CASES_REQUIRED'" type="button" class="seed-button" @click="seedSuite">Đồng bộ bộ ca</button><button type="button" class="secondary" @click="startRun">Thử lại</button></div>
        </div>

        <div v-else-if="result" class="run-result">
          <header class="result-header" :class="resultState">
            <div class="score-ring"><strong>{{ result.averageScore }}</strong><span>/100</span></div>
            <div>
              <span class="result-status">{{ resultStateLabel }}</span>
              <h3>{{ resultState === 'passed' ? 'Lượt đánh giá đạt cổng chất lượng' : 'Lượt đánh giá chưa đạt' }}</h3>
              <p>Run ID <code>{{ result.runId }}</code> · ngưỡng {{ result.threshold }}% · {{ result.results.length }} ca</p>
            </div>
          </header>

          <div class="proof-strip">
            <span :class="{ ok: result.executionSource === 'server' }"><i class="mdi mdi-server-security" /> executionSource={{ result.executionSource }}</span>
            <span :class="{ ok: result.clientOutputsAccepted === false }"><i class="mdi mdi-code-braces" /> clientOutputsAccepted={{ result.clientOutputsAccepted }}</span>
            <span class="ok"><i class="mdi mdi-eye-off-outline" /> Không có raw output trong response</span>
          </div>

          <section v-if="result.generationFailures.length" class="failure-box generation">
            <div class="box-heading"><h4><span class="mdi mdi-cloud-alert-outline" /> Lỗi sinh kết quả</h4><strong>{{ result.generationFailures.length }}</strong></div>
            <p>Các case này được chấm với output rỗng; cần xử lý provider/model trước khi tin cậy kết quả tổng.</p>
            <div class="failure-list"><span v-for="failure in result.generationFailures" :key="failure.key"><b>{{ humanizeEvaluationKey(failure.key) }}</b><code>{{ failure.code }}</code></span></div>
          </section>

          <section v-if="result.criticalFailures.length" class="failure-box critical">
            <div class="box-heading"><h4><span class="mdi mdi-shield-alert-outline" /> Critical failures</h4><strong>{{ result.criticalFailures.length }}</strong></div>
            <div class="failure-chips"><span v-for="key in result.criticalFailures" :key="key">{{ humanizeEvaluationKey(key) }}</span></div>
          </section>

          <section class="cases-section">
            <div class="cases-heading"><div><h4>Kết quả từng ca kiểm thử</h4><p>Mở từng ca để xem 11 tiêu chí; nội dung trả lời thô không được trả về.</p></div><span>{{ passedCaseCount }}/{{ result.results.length }} đạt điểm</span></div>
            <details v-for="item in sortedResults" :key="item.key" class="case-card">
              <summary>
                <span class="case-name"><i class="mdi" :class="caseFailedCritical(item.key) ? 'mdi-shield-alert-outline' : item.score >= result.threshold ? 'mdi-check-circle-outline' : 'mdi-close-circle-outline'" />{{ humanizeEvaluationKey(item.key) }}</span>
                <span v-if="generationFailureFor(item.key)" class="case-generation">{{ generationFailureFor(item.key)?.code }}</span>
                <span class="case-score" :class="scoreClass(item.score)">{{ item.score }}/100</span>
                <span class="mdi mdi-chevron-down chevron" />
              </summary>
              <div class="criteria-grid">
                <article v-for="criterion in criteriaRows(item)" :key="criterion.key" :class="{ critical: criterion.critical, failed: criterion.score < result.threshold }">
                  <div><span>{{ criterion.label }} <i v-if="criterion.critical">Critical</i></span><strong>{{ criterion.score }}</strong></div>
                  <div class="score-bar"><i :style="{ width: criterion.score + '%' }" /></div>
                </article>
              </div>
            </details>
          </section>
        </div>

        <div v-else class="result-empty">
          <span class="mdi mdi-clipboard-check-outline" />
          <h3>Chưa có kết quả trong phiên này</h3>
          <p>Chọn target, prompt version và model rồi chạy evaluation. Kết quả chỉ chứa điểm, criteria và mã lỗi sinh kết quả.</p>
        </div>
      </main>
    </div>
    <EvaluationHistoryPanel
      ref="historyPanel"
      :current-target-type="targetType"
      :current-target-id="targetId"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  listEvaluationKnowledgeSources,
  listEvaluationModels,
  listEvaluationPrompts,
  runServerEvaluation,
  seedInitialEvaluationSuite,
  type AiEvaluationKnowledgeReference,
  type AiEvaluationModelReference,
  type AiEvaluationPromptReference,
  type AiEvaluationRunResult,
  type AiEvaluationTarget,
} from '@/api/ai-evaluations';
import { listAiSkills, type AiSkillRecord } from '@/api/ai-skills';
import { listAiAgents, type AiAgentRecord } from '@/api/ai-agents';
import EvaluationHistoryPanel from './EvaluationHistoryPanel.vue';
import {
  criteriaRows,
  evaluationProgressPhase,
  evaluationResultState,
  humanizeEvaluationKey,
  promptVersionsForTarget,
  targetTypeLabel,
} from './evaluation-view-model';

type TargetOption = { id: string; label: string };

const targetTypes: Array<{ value: AiEvaluationTarget; label: string }> = [
  { value: 'prompt', label: 'Lời nhắc' }, { value: 'skill', label: 'Kỹ năng' },
  { value: 'model', label: 'Mô hình' }, { value: 'agent', label: 'Tác nhân' },
  { value: 'knowledge', label: 'Kho tri thức' },
  { value: 'policy', label: 'Chính sách' },
];

const route = useRoute();
const prompts = ref<AiEvaluationPromptReference[]>([]);
const models = ref<AiEvaluationModelReference[]>([]);
const skills = ref<AiSkillRecord[]>([]);
const agents = ref<AiAgentRecord[]>([]);
const knowledgeSources = ref<AiEvaluationKnowledgeReference[]>([]);
const referenceWarnings = ref<string[]>([]);
const referenceLoading = ref(false);
const seeding = ref(false);
const running = ref(false);
const elapsedSeconds = ref(0);
const runError = ref('');
const runErrorCode = ref('');
const message = ref('');
const messageOk = ref(true);
const result = ref<AiEvaluationRunResult | null>(null);
const historyPanel = ref<InstanceType<typeof EvaluationHistoryPanel> | null>(null);
const runName = ref('');
const targetType = ref<AiEvaluationTarget>('prompt');
const targetId = ref('');
const promptVersionId = ref('');
const modelConfigId = ref('');
const threshold = ref(80);
let referenceController: AbortController | null = null;
let elapsedTimer: number | null = null;

const targetOptions = computed<TargetOption[]>(() => {
  if (targetType.value === 'prompt') return prompts.value.map((item) => ({ id: item.id, label: `${item.name} · ${item.key}` }));
  if (targetType.value === 'skill') return skills.value.map((item) => ({ id: item.id, label: `${item.name} · ${item.key}` }));
  if (targetType.value === 'agent') return agents.value.map((item) => ({ id: item.id, label: `${item.name} · ${item.key} · ${item.status}` }));
  if (targetType.value === 'model') return models.value.map((item) => ({ id: item.id, label: `${item.name} · ${item.provider}/${item.model}` }));
  if (targetType.value === 'knowledge') return knowledgeSources.value.map((item) => ({ id: item.id, label: `${item.name} · ${item.type} · ${item.status}` }));
  return [];
});

const promptVersionOptions = computed(() => promptVersionsForTarget(prompts.value, targetType.value, targetId.value));
const selectedTargetLabel = computed(() => targetOptions.value.find((item) => item.id === targetId.value)?.label || targetId.value);
const selectedPromptLabel = computed(() => promptVersionOptions.value.find((item) => item.id === promptVersionId.value)?.label || '');
const selectedModelLabel = computed(() => { const item = models.value.find((model) => model.id === modelConfigId.value); return item ? `${item.name} · ${item.provider}/${item.model}` : ''; });
const targetIdPlaceholder = computed(() => targetType.value === 'policy' ? 'Policy target ID' : `${targetTypeLabel(targetType.value)} target ID`);
const canRun = computed(() => !!runName.value.trim() && !!targetId.value.trim() && !!promptVersionId.value.trim() && !!modelConfigId.value.trim() && threshold.value >= 0 && threshold.value <= 100);
const resultState = computed(() => result.value ? evaluationResultState(result.value) : 'failed');
const resultStateLabel = computed(() => ({ passed: 'Đạt', failed: 'Không đạt', generation_error: 'Có lỗi sinh kết quả' })[resultState.value]);
const sortedResults = computed(() => [...(result.value?.results || [])].sort((a, b) => a.score - b.score));
const passedCaseCount = computed(() => result.value?.results.filter((item) => item.score >= result.value!.threshold && !result.value!.criticalFailures.includes(item.key)).length || 0);

function cancelled(error: unknown) { const value = error as { code?: string; name?: string }; return value?.code === 'ERR_CANCELED' || value?.name === 'CanceledError' || value?.name === 'AbortError'; }
function errorText(error: any, fallback: string) { if (error?.response?.status === 403) return 'Bạn không có quyền chạy Evaluation AI.'; return error?.response?.data?.error || error?.message || fallback; }
function notify(text: string, ok = true) { message.value = text; messageOk.value = ok; window.setTimeout(() => { if (message.value === text) message.value = ''; }, 5000); }
function scoreClass(score: number) { return score >= 80 ? 'good' : score >= 60 ? 'warning' : 'bad'; }
function caseFailedCritical(key: string) { return result.value?.criticalFailures.includes(key) || false; }
function generationFailureFor(key: string) { return result.value?.generationFailures.find((item) => item.key === key); }

function ensureSelections() {
  if (targetType.value === 'agent') {
    const agent = agents.value.find((item) => item.id === targetId.value);
    if (agent?.promptVersionId) promptVersionId.value = agent.promptVersionId;
    if (agent?.modelConfigId) modelConfigId.value = agent.modelConfigId;
  }
  if (targetType.value !== 'policy' && !targetOptions.value.some((item) => item.id === targetId.value)) targetId.value = targetOptions.value[0]?.id || '';
  if (targetType.value === 'model' && targetId.value) modelConfigId.value = targetId.value;
  if (!models.value.some((item) => item.id === modelConfigId.value)) modelConfigId.value = models.value[0]?.id || modelConfigId.value;
  if (!promptVersionOptions.value.some((item) => item.id === promptVersionId.value)) {
    const preferred = promptVersionOptions.value.find((item) => item.status === 'production') || promptVersionOptions.value[0];
    promptVersionId.value = preferred?.id || promptVersionId.value;
  }
}

function suggestRunName() {
  const target = selectedTargetLabel.value || targetTypeLabel(targetType.value);
  runName.value = `Đánh giá ${target} · ${new Date().toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}`;
}

async function loadReferences() {
  referenceController?.abort();
  referenceController = new AbortController();
  referenceLoading.value = true;
  referenceWarnings.value = [];
  const signal = referenceController.signal;
  const [promptResult, modelResult, skillResult, agentResult, knowledgeResult] = await Promise.allSettled([
    listEvaluationPrompts(signal), listEvaluationModels(signal), listAiSkills(signal), listAiAgents(undefined, signal), listEvaluationKnowledgeSources(signal),
  ]);
  if (promptResult.status === 'fulfilled') prompts.value = promptResult.value; else if (!cancelled(promptResult.reason)) referenceWarnings.value.push('Không tải được danh sách prompt/version.');
  if (modelResult.status === 'fulfilled') models.value = modelResult.value; else if (!cancelled(modelResult.reason)) referenceWarnings.value.push('Không tải được danh sách model active/approved.');
  if (skillResult.status === 'fulfilled') skills.value = skillResult.value; else if (!cancelled(skillResult.reason)) referenceWarnings.value.push('Không tải được danh sách kỹ năng.');
  if (agentResult.status === 'fulfilled') agents.value = agentResult.value; else if (!cancelled(agentResult.reason)) referenceWarnings.value.push('Không tải được danh sách tác nhân.');
  if (knowledgeResult.status === 'fulfilled') knowledgeSources.value = knowledgeResult.value; else if (!cancelled(knowledgeResult.reason)) referenceWarnings.value.push('Không tải được danh sách nguồn tri thức.');
  referenceLoading.value = false;
  ensureSelections();
  if (!runName.value) suggestRunName();
}

async function seedSuite() {
  if (seeding.value) return;
  seeding.value = true;
  try {
    const response = await seedInitialEvaluationSuite();
    notify(`Đã đồng bộ ${response.count} ca kiểm thử trong bộ khởi tạo.`);
  } catch (error) {
    notify(errorText(error, 'Không thể đồng bộ bộ ca kiểm thử.'), false);
  } finally { seeding.value = false; }
}

function startElapsed() {
  elapsedSeconds.value = 0;
  if (elapsedTimer != null) window.clearInterval(elapsedTimer);
  elapsedTimer = window.setInterval(() => { elapsedSeconds.value += 1; }, 1000);
}
function stopElapsed() { if (elapsedTimer != null) window.clearInterval(elapsedTimer); elapsedTimer = null; }

async function startRun() {
  if (running.value || !canRun.value) return;
  running.value = true;
  runError.value = '';
  runErrorCode.value = '';
  result.value = null;
  startElapsed();
  try {
    result.value = await runServerEvaluation({
      name: runName.value.trim(), targetType: targetType.value, targetId: targetId.value.trim(),
      promptVersionId: promptVersionId.value.trim(), modelConfigId: modelConfigId.value.trim(), threshold: threshold.value,
    });
    await historyPanel.value?.reload(result.value.runId);
  } catch (error: any) {
    runErrorCode.value = error?.response?.data?.code || '';
    runError.value = errorText(error, 'Không thể chạy evaluation phía máy chủ.');
  } finally { running.value = false; stopElapsed(); }
}

watch(targetType, () => { targetId.value = ''; promptVersionId.value = ''; ensureSelections(); if (!runName.value) suggestRunName(); });
watch(targetId, () => { ensureSelections(); });
async function initialize() {
  await loadReferences();
  const requestedType = Array.isArray(route.query.targetType) ? route.query.targetType[0] : route.query.targetType;
  const requestedId = Array.isArray(route.query.targetId) ? route.query.targetId[0] : route.query.targetId;
  if (requestedType && requestedId && targetTypes.some((item) => item.value === requestedType)) {
    targetType.value = requestedType as AiEvaluationTarget;
    await nextTick();
    targetId.value = requestedId;
    ensureSelections();
    suggestRunName();
  }
}

onMounted(() => void initialize());
onBeforeUnmount(() => { referenceController?.abort(); stopElapsed(); });
</script>

<style scoped>
.evaluation-manager { overflow: hidden; border: 1px solid #dbe4f0; border-radius: 12px; background: #f8fafc; color: #334155; }
.panel-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 18px; border-bottom: 1px solid #dbe4f0; background: #fff; }
.title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }.panel-header h2 { margin: 0; color: #172033; font-size: 17px; }.panel-header p { margin: 4px 0 0; color: #64748b; font-size: 12px; }
.server-badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border-radius: 999px; background: #ede9fe; color: #6d28d9; font-size: 9px; font-weight: 750; }
.header-actions, .error-actions { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
button { font: inherit; }.secondary, .seed-button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 33px; padding: 6px 10px; border-radius: 7px; font-size: 11px; font-weight: 650; cursor: pointer; }.secondary { border: 1px solid #cbd5e1; background: #fff; color: #475569; }.seed-button { border: 1px solid #c4b5fd; background: #f5f3ff; color: #6d28d9; } button:disabled { cursor: wait; opacity: .6; }
.trust-banner { display: flex; align-items: flex-start; gap: 10px; margin: 12px; padding: 11px 12px; border: 1px solid #bbf7d0; border-left: 4px solid #16a34a; border-radius: 9px; background: #f0fdf4; }.trust-banner > .mdi { color: #15803d; font-size: 22px; }.trust-banner > div:nth-child(2) { flex: 1; }.trust-banner strong { color: #166534; font-size: 12px; }.trust-banner p { margin: 3px 0 0; color: #475569; font-size: 11px; line-height: 1.5; }.trust-flags { display: flex; gap: 5px; flex-wrap: wrap; justify-content: flex-end; }.trust-flags span { padding: 3px 6px; border-radius: 5px; background: #dcfce7; color: #166534; font: 9px Consolas, monospace; }
.notice, .reference-warning { display: flex; align-items: flex-start; gap: 7px; margin: 0 12px 10px; padding: 8px 10px; border: 1px solid #bbf7d0; border-radius: 7px; background: #f0fdf4; color: #166534; font-size: 11px; }.notice.error { border-color: #fecaca; background: #fff1f2; color: #991b1b; }.notice button { margin-left: auto; border: 0; background: transparent; color: inherit; font-size: 17px; cursor: pointer; }.reference-warning { border-color: #fde68a; background: #fffbeb; color: #92400e; }.reference-warning strong { font-size: 11px; }.reference-warning p { margin: 3px 0 0; font-size: 10px; }
.layout { display: grid; grid-template-columns: minmax(330px, .72fr) minmax(500px, 1.28fr); min-height: 680px; border-top: 1px solid #dbe4f0; }.run-form { padding: 16px; border-right: 1px solid #dbe4f0; background: #fff; }.result-area { min-width: 0; padding: 16px; }
.form-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 14px; }.form-heading h3 { margin: 0; color: #172033; font-size: 14px; }.form-heading p { margin: 3px 0 0; color: #64748b; font-size: 10px; }.mini-loading { display: flex; align-items: center; gap: 5px; color: #64748b; font-size: 9px; }.mini-loading i { width: 10px; height: 10px; border: 2px solid #cbd5e1; border-top-color: #2563eb; border-radius: 50%; animation: spin .8s linear infinite; }
.run-form label { display: flex; flex-direction: column; gap: 5px; margin-bottom: 11px; color: #475569; font-size: 10px; font-weight: 700; }.run-form label small { color: #94a3b8; font-weight: 400; line-height: 1.4; }.run-form input, .run-form select { box-sizing: border-box; width: 100%; min-height: 35px; padding: 7px 8px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: #334155; font: 11px inherit; }.form-grid { display: grid; gap: 9px; }.form-grid.two { grid-template-columns: 1fr 1fr; }.name-field { display: flex; gap: 5px; }.name-field input { flex: 1; }.name-field button { flex: 0 0 auto; border: 1px solid #cbd5e1; border-radius: 7px; background: #f8fafc; color: #475569; font-size: 10px; cursor: pointer; }
.threshold-field { display: flex; align-items: center; gap: 7px; }.threshold-field input[type=range] { flex: 1; padding: 0; border: 0; }.threshold-number { flex: 0 0 60px; width: 60px!important; }.threshold-field > span { color: #64748b; }
.selection-summary { display: grid; gap: 6px; margin: 12px 0; padding: 10px; border-radius: 8px; background: #f8fafc; }.selection-summary div { display: grid; grid-template-columns: 55px minmax(0,1fr); gap: 7px; }.selection-summary span { color: #94a3b8; font-size: 9px; text-transform: uppercase; }.selection-summary strong { min-width: 0; overflow: hidden; color: #475569; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.run-button { display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%; min-height: 40px; border: 1px solid #2563eb; border-radius: 8px; background: #2563eb; color: #fff; font-size: 12px; font-weight: 750; cursor: pointer; }.history-note { display: flex; align-items: flex-start; gap: 5px; margin: 10px 0 0; color: #94a3b8; font-size: 9px; line-height: 1.45; }
.running-state, .result-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 500px; color: #64748b; text-align: center; }.running-icon { display: grid; width: 58px; height: 58px; place-items: center; border-radius: 18px; background: #ede9fe; color: #6d28d9; font-size: 28px; }.running-state h3, .result-empty h3 { margin: 14px 0 5px; color: #334155; font-size: 15px; }.running-state p, .result-empty p { max-width: 520px; margin: 0; font-size: 11px; line-height: 1.5; }.running-state > span { margin-top: 8px; color: #94a3b8; font-size: 9px; }.indeterminate { position: relative; width: min(420px,80%); height: 6px; margin-top: 18px; overflow: hidden; border-radius: 999px; background: #e2e8f0; }.indeterminate i { position: absolute; width: 35%; height: 100%; border-radius: inherit; background: #7c3aed; animation: progress 1.3s ease-in-out infinite; }.result-empty > .mdi { color: #94a3b8; font-size: 40px; }.result-empty.error-state > .mdi { color: #be123c; }.result-empty.error-state h3 { color: #991b1b; }.error-actions { margin-top: 15px; }
.run-result { display: grid; gap: 11px; }.result-header { display: flex; align-items: center; gap: 14px; padding: 14px; border: 1px solid #fecaca; border-radius: 10px; background: #fff7f7; }.result-header.passed { border-color: #bbf7d0; background: #f0fdf4; }.result-header.generation_error { border-color: #fde68a; background: #fffbeb; }.score-ring { display: grid; flex: 0 0 68px; width: 68px; height: 68px; place-content: center; border: 5px solid #fca5a5; border-radius: 50%; text-align: center; }.passed .score-ring { border-color: #4ade80; }.generation_error .score-ring { border-color: #fbbf24; }.score-ring strong { color: #172033; font-size: 21px; line-height: 1; }.score-ring span { color: #64748b; font-size: 9px; }.result-status { color: #b91c1c; font-size: 9px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }.passed .result-status { color: #15803d; }.generation_error .result-status { color: #b45309; }.result-header h3 { margin: 3px 0; color: #172033; font-size: 15px; }.result-header p { margin: 0; color: #64748b; font-size: 10px; }.result-header code { color: #475569; }
.proof-strip { display: flex; gap: 6px; flex-wrap: wrap; }.proof-strip span { display: inline-flex; align-items: center; gap: 4px; padding: 4px 7px; border-radius: 6px; background: #fee2e2; color: #991b1b; font: 9px Consolas, monospace; }.proof-strip span.ok { background: #dcfce7; color: #166534; }
.failure-box, .cases-section { padding: 12px; border: 1px solid #e2e8f0; border-radius: 9px; background: #fff; }.failure-box.generation { border-color: #fde68a; background: #fffbeb; }.failure-box.critical { border-color: #fecaca; background: #fff7f7; }.box-heading, .cases-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }.box-heading h4, .cases-heading h4 { margin: 0; color: #334155; font-size: 12px; }.box-heading strong { display: grid; min-width: 22px; height: 22px; place-items: center; border-radius: 999px; background: rgba(255,255,255,.8); font-size: 10px; }.failure-box > p, .cases-heading p { margin: 4px 0 0; color: #64748b; font-size: 10px; }.failure-list { display: grid; gap: 5px; margin-top: 9px; }.failure-list span { display: flex; justify-content: space-between; gap: 8px; padding: 5px 7px; border-radius: 5px; background: rgba(255,255,255,.65); font-size: 10px; }.failure-list code { color: #b45309; }.failure-chips { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 9px; }.failure-chips span { padding: 4px 7px; border-radius: 5px; background: #fee2e2; color: #991b1b; font-size: 10px; }
.cases-heading { margin-bottom: 9px; }.cases-heading > span { padding: 3px 6px; border-radius: 999px; background: #eff6ff; color: #1d4ed8; font-size: 9px; font-weight: 700; }.case-card { border-top: 1px solid #e2e8f0; }.case-card summary { display: grid; grid-template-columns: minmax(160px,1fr) auto auto 18px; align-items: center; gap: 7px; padding: 10px 2px; list-style: none; cursor: pointer; }.case-card summary::-webkit-details-marker { display: none; }.case-name { display: flex; align-items: center; gap: 6px; color: #334155; font-size: 11px; font-weight: 650; }.case-name .mdi-check-circle-outline { color: #16a34a; }.case-name .mdi-close-circle-outline, .case-name .mdi-shield-alert-outline { color: #dc2626; }.case-generation { padding: 2px 5px; border-radius: 4px; background: #fef3c7; color: #92400e; font: 8px Consolas,monospace; }.case-score { padding: 3px 6px; border-radius: 5px; font-size: 9px; font-weight: 750; }.case-score.good { background: #dcfce7; color: #166534; }.case-score.warning { background: #fef3c7; color: #92400e; }.case-score.bad { background: #fee2e2; color: #991b1b; }.chevron { color: #94a3b8; transition: transform .15s; }.case-card[open] .chevron { transform: rotate(180deg); }
.criteria-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 0 2px 12px; }.criteria-grid article { padding: 7px; border: 1px solid #e2e8f0; border-radius: 6px; }.criteria-grid article.critical { border-left: 3px solid #7c3aed; }.criteria-grid article.failed { background: #fff7f7; }.criteria-grid article > div:first-child { display: flex; align-items: center; justify-content: space-between; gap: 6px; }.criteria-grid span { color: #475569; font-size: 9px; }.criteria-grid span i { margin-left: 3px; color: #7c3aed; font-size: 7px; font-style: normal; font-weight: 750; text-transform: uppercase; }.criteria-grid strong { color: #334155; font-size: 9px; }.score-bar { height: 3px; margin-top: 5px; overflow: hidden; border-radius: 99px; background: #e2e8f0; }.score-bar i { display: block; height: 100%; background: #22c55e; }.criteria-grid article.failed .score-bar i { background: #ef4444; }
@keyframes spin { to { transform: rotate(360deg); } } @keyframes progress { from { left: -35%; } to { left: 100%; } }
@media (max-width: 1050px) { .layout { grid-template-columns: 1fr; }.run-form { border-right: 0; border-bottom: 1px solid #dbe4f0; }.result-area { min-height: 560px; } }
@media (max-width: 700px) { .panel-header, .trust-banner { flex-direction: column; }.header-actions { width: 100%; }.trust-flags { justify-content: flex-start; }.form-grid.two, .criteria-grid { grid-template-columns: 1fr; }.result-header { align-items: flex-start; }.case-card summary { grid-template-columns: minmax(120px,1fr) auto 18px; }.case-generation { grid-column: 1 / -1; grid-row: 2; }.form-heading { flex-direction: column; } }
@media (prefers-reduced-motion: reduce) { .mini-loading i, .indeterminate i { animation: none; } }
</style>
