<template>
  <section class="agents">
    <header class="top">
      <div><div class="title"><h2>Tác nhân AI</h2><span>{{ agents.length }} tác nhân</span></div><p>Ghép vai trò, lời nhắc, mô hình và kỹ năng thành cấu hình có kiểm soát trước khi vận hành.</p></div>
      <div class="top-actions"><button class="secondary" type="button" :disabled="loading" @click="loadData"><i class="mdi mdi-refresh" /> {{ loading ? 'Đang tải…' : 'Làm mới' }}</button><button class="primary" type="button" @click="beginCreate"><i class="mdi mdi-account-plus-outline" /> Tạo tác nhân</button></div>
    </header>
    <div class="safety"><i class="mdi mdi-shield-lock-outline" /><div><strong>Không cho phép tự gửi hoàn toàn</strong><p>Chỉ có Tắt, Shadow hoặc Gợi ý. Kích hoạt bắt buộc phê duyệt chéo và một lượt đánh giá đạt sau lần sửa gần nhất.</p></div><b>Fail-closed</b></div>
    <div v-if="notice" class="notice" :class="{ error: !noticeOk }" role="status"><i class="mdi" :class="noticeOk ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline'" /><span>{{ notice }}</span><button type="button" aria-label="Đóng" @click="notice = ''">×</button></div>
    <div class="toolbar">
      <label class="search"><i class="mdi mdi-magnify" /><input v-model="search" type="search" placeholder="Tìm tên, key, model hoặc kỹ năng…" /></label>
      <label class="filter"><span>Trạng thái</span><select v-model="statusFilter"><option value="">Tất cả đang dùng</option><option v-for="status in filterStatuses" :key="status" :value="status">{{ agentStatusMeta(status).label }} ({{ statusCounts[status] || 0 }})</option></select></label>
    </div>
    <div v-if="loading && !agents.length" class="skeletons"><div v-for="n in 6" :key="n"><i /><i /><i /></div></div>
    <div v-else-if="loadError && !agents.length" class="state error-state"><i class="mdi mdi-alert-circle-outline" /><h3>Không tải được tác nhân</h3><p>{{ loadError }}</p><button class="secondary" @click="loadData">Thử lại</button></div>
    <div v-else-if="!agents.length && !editorOpen" class="state"><i class="mdi mdi-account-cog-outline" /><h3>Chưa có tác nhân AI</h3><p>Tạo bản nháp, chọn prompt, model và kỹ năng rồi gửi một quản trị viên khác phê duyệt.</p><button class="primary" @click="beginCreate">Tạo tác nhân đầu tiên</button></div>

    <div v-else class="workspace">
      <aside class="list">
        <div class="list-head"><strong>{{ filteredAgents.length }} kết quả</strong><span>{{ loadError ? 'Dữ liệu cũ · làm mới lỗi' : 'Đang sử dụng' }}</span></div>
        <button v-for="agent in filteredAgents" :key="agent.id" class="agent-row" :class="{ selected: agent.id === selectedId }" type="button" @click="selectAgent(agent.id)">
          <span class="avatar"><i class="mdi mdi-robot-outline" /></span><span class="row-body"><span class="row-title"><strong>{{ agent.name }}</strong><em class="status" :class="'tone-' + agentStatusMeta(agent.status).tone">{{ agentStatusMeta(agent.status).label }}</em></span><code>{{ agent.key }}</code><small>{{ agent.modelConfig?.name || 'Chưa chọn model' }} · {{ agent.skills.length }} kỹ năng</small><span class="eval-mini" :class="'eval-' + agentEvaluationLabel(agent).tone"><i class="mdi" :class="agent.evaluationGate.passed ? 'mdi-check-circle-outline' : 'mdi-shield-alert-outline'" /> {{ agentEvaluationLabel(agent).label }}</span></span><i class="mdi mdi-chevron-right chevron" />
        </button>
        <div v-if="!filteredAgents.length" class="list-empty"><i class="mdi mdi-filter-off-outline" /><strong>Không có kết quả</strong><p>Đổi từ khóa hoặc bộ lọc.</p><button @click="search = ''; statusFilter = ''">Xóa bộ lọc</button></div>
      </aside>

      <main v-if="editorOpen" class="editor">
        <header class="detail-head"><div><span class="eyebrow">{{ editingId ? 'Chỉnh sửa cấu hình' : 'Tạo bản nháp mới' }}</span><h3>{{ editingId ? form.name || 'Tác nhân chưa đặt tên' : 'Tác nhân AI mới' }}</h3><p>Mọi lần sửa tác nhân đã duyệt sẽ đưa trạng thái về Bản nháp.</p></div><button class="icon" type="button" aria-label="Đóng" @click="closeEditor"><i class="mdi mdi-close" /></button></header>
        <form class="form" @submit.prevent="saveAgent">
          <section><Heading icon="mdi-card-account-details-outline" title="Nhận diện tác nhân" text="Tên để người dùng nhận biết; key ổn định cho tích hợp." /><div class="grid two"><label><span>Tên tác nhân <b>*</b></span><input v-model.trim="form.name" required maxlength="160" placeholder="Trợ lý tư vấn bán hàng" /></label><label><span>Key kỹ thuật <b>*</b></span><input v-model.trim="form.key" required maxlength="80" :disabled="!!editingId" pattern="[a-z][a-z0-9_.-]{2,79}" placeholder="sales.assistant" /><small>Chữ thường, bắt đầu bằng chữ; cho phép . _ -</small></label></div><label><span>Vai trò / tính cách</span><select v-model="form.personaId"><option value="">Không gắn persona</option><option v-for="item in references.personas" :key="item.id" :value="item.id">{{ item.name }}</option></select></label></section>
          <section><Heading icon="mdi-source-branch" title="Nguồn thực thi" text="Prompt Production và model Active/Approved là điều kiện kích hoạt." /><div class="grid two"><label><span>Phiên bản lời nhắc <b>*</b></span><select v-model="form.promptVersionId"><option value="">Chọn prompt version</option><option v-for="item in references.promptVersions" :key="item.id" :value="item.id">{{ item.prompt?.name || 'Prompt' }} · v{{ item.version }} · {{ item.status }}</option></select><small v-if="selectedPrompt && selectedPrompt.status !== 'production'" class="warn">Có thể lưu nháp nhưng chưa đủ điều kiện kích hoạt.</small></label><label><span>Mô hình <b>*</b></span><select v-model="form.modelConfigId"><option value="">Chọn model</option><option v-for="item in references.modelConfigs" :key="item.id" :value="item.id">{{ item.name }} · {{ item.provider }}/{{ item.model }} · {{ item.status }}</option></select><small v-if="selectedModel && !['active', 'approved'].includes(selectedModel.status)" class="warn">Model chưa Active/Approved.</small></label></div></section>
          <section><Heading icon="mdi-puzzle-outline" title="Kỹ năng *" text="Cần ít nhất một kỹ năng trước khi gửi phê duyệt." /><div v-if="references.skills.length" class="choices"><label v-for="item in references.skills" :key="item.id"><input v-model="form.skillIds" type="checkbox" :value="item.id" /><span><strong>{{ item.name }}</strong><small>{{ item.key }} · Rủi ro {{ item.riskTier }}</small></span></label></div><p v-else class="inline-warning"><i class="mdi mdi-alert-outline" /> Chưa có kỹ năng nào. Hãy tạo kỹ năng trước.</p></section>
          <section><Heading icon="mdi-key-chain-variant" title="Khả năng được cấp" text="Backend chỉ chấp nhận khả năng trong allowlist." /><div class="choices caps"><label v-for="item in availableCapabilities" :key="item"><input v-model="form.capabilities" type="checkbox" :value="item" /><span><strong>{{ capabilityLabel(item) }}</strong><code>{{ item }}</code></span></label></div></section>
          <section><Heading icon="mdi-message-processing-outline" title="Chế độ phản hồi" text="Không có lựa chọn tự gửi hoàn toàn." /><div class="modes"><label v-for="item in replyModes" :key="item.value" :class="{ selected: form.autoReplyMode === item.value }"><input v-model="form.autoReplyMode" type="radio" :value="item.value" /><i class="mdi" :class="item.icon" /><span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span></label></div></section>
          <section><Heading icon="mdi-shield-check-outline" title="Chính sách an toàn" text="Ngưỡng và bàn giao được backend kiểm tra lại." /><div class="toggles"><label><input v-model="form.policy.requireHumanReview" type="checkbox" /><span><strong>Yêu cầu người duyệt</strong><small>Nhân viên kiểm tra trước khi sử dụng.</small></span></label><label><input v-model="form.policy.requireCitations" type="checkbox" /><span><strong>Yêu cầu nguồn dẫn</strong><small>Ưu tiên câu trả lời có căn cứ.</small></span></label></div><div class="grid two"><label><span>Ngưỡng tin cậy</span><div class="range"><input v-model.number="form.policy.confidenceThreshold" type="range" min="0" max="1" step="0.05" /><input v-model.number="form.policy.confidenceThreshold" type="number" min="0" max="1" step="0.05" /></div></label><label><span>Độ dài tối đa</span><div class="suffix"><input v-model.number="form.policy.maxReplyLength" type="number" min="100" max="2000" step="50" /><span>ký tự</span></div></label></div><fieldset><legend>Bàn giao khi mức rủi ro</legend><div class="risks"><label v-for="item in riskLevels" :key="item.value"><input v-model="form.policy.handoffOnRisk" type="checkbox" :value="item.value" /> {{ item.label }}</label></div></fieldset></section>
          <p v-if="referenceError" class="inline-warning"><i class="mdi mdi-alert-outline" /> {{ referenceError }}</p>
          <footer class="form-actions"><button class="secondary" type="button" :disabled="saveBusy" @click="closeEditor">Hủy</button><button class="primary" type="submit" :disabled="saveBusy || !canSave"><i class="mdi" :class="saveBusy ? 'mdi-loading mdi-spin' : 'mdi-content-save-outline'" /> {{ saveBusy ? 'Đang lưu…' : editingId ? 'Lưu thành bản nháp' : 'Tạo bản nháp' }}</button></footer>
        </form>
      </main>

      <main v-else-if="selectedAgent" class="detail">
        <header class="detail-head"><div class="identity"><span class="detail-avatar"><i class="mdi mdi-robot-outline" /></span><div><div class="title-line"><h3>{{ selectedAgent.name }}</h3><em class="status" :class="'tone-' + agentStatusMeta(selectedAgent.status).tone">{{ agentStatusMeta(selectedAgent.status).label }}</em></div><code>{{ selectedAgent.key }}</code><p>{{ agentStatusMeta(selectedAgent.status).description }}</p></div></div><button class="icon" type="button" aria-label="Làm mới" :disabled="loading" @click="loadData"><i class="mdi mdi-refresh" /></button></header>
        <div v-if="agentMissingConfiguration(selectedAgent).length" class="config-warning"><i class="mdi mdi-alert-outline" /><div><strong>Cấu hình chưa hoàn chỉnh</strong><p>Còn thiếu {{ agentMissingConfiguration(selectedAgent).join(', ') }}. Chưa thể gửi phê duyệt.</p></div></div>
        <section class="evaluation" :class="'eval-' + selectedEvaluation.tone"><i class="mdi" :class="selectedAgent.evaluationGate.passed ? 'mdi-shield-check-outline' : 'mdi-shield-alert-outline'" /><div><strong>{{ selectedEvaluation.label }}</strong><p>{{ selectedEvaluation.detail }}</p><code v-if="selectedAgent.evaluationGate.runId">Run {{ selectedAgent.evaluationGate.runId }}</code></div><button type="button" @click="openEvaluation(selectedAgent.id)">{{ selectedAgent.evaluationGate.passed ? 'Xem đánh giá' : 'Chạy đánh giá' }} <i class="mdi mdi-arrow-right" /></button></section>
        <div class="summary"><article><span>Persona</span><strong>{{ selectedAgent.persona?.name || 'Không gắn' }}</strong></article><article><span>Prompt</span><strong>{{ selectedAgent.promptVersion?.prompt?.name || 'Chưa chọn' }}</strong><small v-if="selectedAgent.promptVersion">v{{ selectedAgent.promptVersion.version }} · {{ selectedAgent.promptVersion.status }}</small></article><article><span>Model</span><strong>{{ selectedAgent.modelConfig?.name || 'Chưa chọn' }}</strong><small v-if="selectedAgent.modelConfig">{{ selectedAgent.modelConfig.provider }}/{{ selectedAgent.modelConfig.model }} · {{ selectedAgent.modelConfig.status }}</small></article><article><span>Phản hồi</span><strong>{{ replyModeLabel(selectedAgent.autoReplyMode) }}</strong><small>Không tự gửi hoàn toàn</small></article></div>
        <div class="cards">
          <section><CardTitle icon="mdi-puzzle-outline" title="Kỹ năng" :count="selectedAgent.skills.length" /><div v-if="selectedAgent.skills.length" class="chips"><span v-for="item in selectedAgent.skills" :key="item.id">{{ item.name }} <small>{{ item.riskTier }}</small></span></div><p v-else>Chưa gắn kỹ năng.</p></section>
          <section><CardTitle icon="mdi-key-chain-variant" title="Khả năng" :count="selectedAgent.capabilities.length" /><div v-if="selectedAgent.capabilities.length" class="chips purple"><span v-for="item in selectedAgent.capabilities" :key="item">{{ capabilityLabel(item) }}</span></div><p v-else>Chưa cấp khả năng.</p></section>
          <section><CardTitle icon="mdi-shield-check-outline" title="Chính sách" /><dl><div><dt>Người duyệt</dt><dd>{{ selectedAgent.policy.requireHumanReview ? 'Bắt buộc' : 'Không' }}</dd></div><div><dt>Nguồn dẫn</dt><dd>{{ selectedAgent.policy.requireCitations ? 'Bắt buộc' : 'Không' }}</dd></div><div><dt>Tin cậy</dt><dd>{{ Math.round(selectedAgent.policy.confidenceThreshold * 100) }}%</dd></div><div><dt>Độ dài</dt><dd>{{ selectedAgent.policy.maxReplyLength }} ký tự</dd></div><div class="wide"><dt>Bàn giao</dt><dd>{{ selectedAgent.policy.handoffOnRisk.map(riskLabel).join(', ') || 'Chưa cấu hình' }}</dd></div></dl></section>
          <section><CardTitle icon="mdi-account-check-outline" title="Trách nhiệm" /><dl><div><dt>Người tạo</dt><dd>{{ selectedAgent.createdBy?.fullName || 'Không xác định' }}</dd></div><div><dt>Tạo lúc</dt><dd>{{ formatDate(selectedAgent.createdAt) }}</dd></div><div class="wide"><dt>Sửa gần nhất</dt><dd>{{ formatDate(selectedAgent.updatedAt) }}</dd></div></dl><p>Người sửa gần nhất không được tự phê duyệt.</p></section>
        </div>
        <footer class="action-bar"><div><strong>Thao tác theo trạng thái</strong><p>{{ disabledActionReason || 'Mỗi thay đổi đều được ghi nhật ký kiểm toán.' }}</p></div><div><button v-for="item in selectedActions" :key="item.action" class="action" :class="item.tone" type="button" :disabled="!!busyAction || !item.enabled" :title="item.reason" @click="requestAction(item)"><i v-if="busyAction === item.action" class="mdi mdi-loading mdi-spin" /> {{ busyAction === item.action ? 'Đang xử lý…' : item.label }}</button></div></footer>
      </main>
      <main v-else class="placeholder"><i class="mdi mdi-cursor-default-click-outline" /><h3>Chọn một tác nhân</h3><p>Xem cấu hình, cổng đánh giá và hành động hợp lệ.</p></main>
    </div>

    <div v-if="confirm.open" class="backdrop" @click.self="closeConfirm"><section class="dialog" role="dialog" aria-modal="true"><i class="mdi dialog-icon" :class="confirm.danger ? 'mdi-alert-outline danger' : 'mdi-shield-check-outline'" /><h3>{{ confirm.title }}</h3><p>{{ confirm.message }}</p><label v-if="confirm.action === 'approve'"><span>Ghi chú phê duyệt (không nhập dữ liệu nhạy cảm)</span><textarea v-model.trim="confirm.note" maxlength="500" rows="3" /></label><div><button class="secondary" type="button" :disabled="!!busyAction" @click="closeConfirm">Hủy</button><button class="action" :class="confirm.danger ? 'danger' : 'primary'" type="button" :disabled="!!busyAction" @click="performConfirmed">{{ busyAction ? 'Đang xử lý…' : confirm.label }}</button></div></section></div>
  </section>
</template>
<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  activateAiAgent, approveAiAgent, archiveAiAgent, createAiAgent, deactivateAiAgent,
  listAiAgentReferences, listAiAgents, submitAiAgent, updateAiAgent,
  type AiAgentAutoReplyMode, type AiAgentCapability, type AiAgentCreateInput,
  type AiAgentPolicy, type AiAgentRecord, type AiAgentReferences, type AiAgentStatus,
} from '@/api/ai-agents';
import {
  agentActionStates, agentErrorMessage, agentEvaluationLabel, agentMissingConfiguration,
  agentStatusMeta, filterAiAgents, type AgentAction, type AgentActionState,
} from './agent-manager-view-model';

const Heading = defineComponent({
  props: { icon: { type: String, required: true }, title: { type: String, required: true }, text: { type: String, required: true } },
  setup: (props) => () => h('div', { class: 'section-heading' }, [
    h('i', { class: ['mdi', props.icon] }),
    h('div', [h('h4', props.title), h('p', props.text)]),
  ]),
});
const CardTitle = defineComponent({
  props: { icon: { type: String, required: true }, title: { type: String, required: true }, count: { type: Number, required: false } },
  setup: (props) => () => h('div', { class: 'card-title' }, [
    h('h4', [h('i', { class: ['mdi', props.icon] }), ' ' + props.title]),
    props.count === undefined ? null : h('span', String(props.count)),
  ]),
});

type AgentForm = AiAgentCreateInput;
const EMPTY: AiAgentReferences = { personas: [], promptVersions: [], modelConfigs: [], skills: [], capabilities: [] };
const FALLBACK_CAPABILITIES: AiAgentCapability[] = [
  'read_conversation', 'generate_reply', 'extract_entities', 'save_ai_message',
  'update_conversation_meta', 'create_suggestion', 'notify_internal',
];
const DEFAULT_CAPABILITIES: AiAgentCapability[] = ['read_conversation', 'generate_reply', 'create_suggestion'];
const CAPABILITY_LABELS: Record<AiAgentCapability, string> = {
  read_conversation: 'Đọc hội thoại',
  generate_reply: 'Soạn câu trả lời',
  extract_entities: 'Trích xuất thông tin',
  save_ai_message: 'Lưu tin nhắn AI',
  update_conversation_meta: 'Cập nhật metadata hội thoại',
  create_suggestion: 'Tạo gợi ý',
  notify_internal: 'Thông báo nội bộ',
};
const replyModes: Array<{ value: AiAgentAutoReplyMode; label: string; description: string; icon: string }> = [
  { value: 'disabled', label: 'Tắt', description: 'Không sinh phản hồi tự động.', icon: 'mdi-cancel' },
  { value: 'shadow', label: 'Shadow', description: 'Chạy ngầm để đo, tuyệt đối không gửi.', icon: 'mdi-eye-off-outline' },
  { value: 'suggested', label: 'Gợi ý', description: 'Soạn nháp để nhân viên chủ động gửi.', icon: 'mdi-account-edit-outline' },
];
const riskLevels: Array<{ value: 'medium' | 'high' | 'critical'; label: string }> = [
  { value: 'medium', label: 'Trung bình' },
  { value: 'high', label: 'Cao' },
  { value: 'critical', label: 'Nghiêm trọng' },
];
const filterStatuses: AiAgentStatus[] = ['draft', 'pending_approval', 'approved', 'active', 'inactive'];
const defaultPolicy = (): AiAgentPolicy => ({
  requireHumanReview: true,
  requireCitations: true,
  confidenceThreshold: 0.75,
  maxReplyLength: 900,
  handoffOnRisk: ['high', 'critical'],
});
const blankForm = (): AgentForm => ({
  key: '',
  name: '',
  personaId: null,
  promptVersionId: null,
  modelConfigId: null,
  skillIds: [],
  capabilities: [...DEFAULT_CAPABILITIES],
  policy: defaultPolicy(),
  autoReplyMode: 'disabled',
});

const router = useRouter();
const agents = ref<AiAgentRecord[]>([]);
const references = ref<AiAgentReferences>({ ...EMPTY });
const selectedId = ref('');
const search = ref('');
const statusFilter = ref<'' | AiAgentStatus>('');
const loading = ref(false);
const loadError = ref('');
const referenceError = ref('');
const notice = ref('');
const noticeOk = ref(true);
const editorOpen = ref(false);
const editingId = ref('');
const saveBusy = ref(false);
const busyAction = ref<AgentAction | null>(null);
const form = reactive<AgentForm>(blankForm());
const confirm = reactive({
  open: false,
  action: null as AgentAction | null,
  title: '',
  message: '',
  label: 'Xác nhận',
  danger: false,
  note: '',
});
let controller: AbortController | null = null;
let timer: number | null = null;

const filteredAgents = computed(() => filterAiAgents(agents.value, search.value, statusFilter.value));
const selectedAgent = computed(() => agents.value.find((item) => item.id === selectedId.value) || null);
const selectedActions = computed(() => selectedAgent.value ? agentActionStates(selectedAgent.value) : []);
const selectedEvaluation = computed(() => selectedAgent.value
  ? agentEvaluationLabel(selectedAgent.value)
  : { label: '', detail: '', tone: 'required' as const });
const availableCapabilities = computed(() => references.value.capabilities.length
  ? references.value.capabilities
  : FALLBACK_CAPABILITIES);
const selectedPrompt = computed(() => references.value.promptVersions.find((item) => item.id === form.promptVersionId));
const selectedModel = computed(() => references.value.modelConfigs.find((item) => item.id === form.modelConfigId));
const canSave = computed(() =>
  /^[a-z][a-z0-9_.-]{2,79}$/.test(form.key)
  && !!form.name.trim()
  && form.policy.confidenceThreshold >= 0
  && form.policy.confidenceThreshold <= 1
  && Number.isInteger(form.policy.maxReplyLength)
  && form.policy.maxReplyLength >= 100
  && form.policy.maxReplyLength <= 2000);
const statusCounts = computed<Record<string, number>>(() => agents.value.reduce((out, item) => {
  out[item.status] = (out[item.status] || 0) + 1;
  return out;
}, {} as Record<string, number>));
const disabledActionReason = computed(() => selectedActions.value.find((item) => !item.enabled)?.reason || '');

watch(filteredAgents, (items) => {
  if (!editorOpen.value && items.length && !items.some((item) => item.id === selectedId.value)) {
    selectedId.value = items[0].id;
  }
});

function cancelled(error: unknown) {
  const value = error as { code?: string; name?: string };
  return value?.code === 'ERR_CANCELED' || value?.name === 'CanceledError' || value?.name === 'AbortError';
}
function toast(message: string, ok = true) {
  notice.value = message;
  noticeOk.value = ok;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (notice.value === message) notice.value = '';
  }, 6000);
}
function setForm(value: AgentForm) {
  Object.assign(form, {
    ...value,
    skillIds: [...value.skillIds],
    capabilities: [...value.capabilities],
    policy: { ...value.policy, handoffOnRisk: [...value.policy.handoffOnRisk] },
  });
}
async function loadData() {
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  loadError.value = '';
  referenceError.value = '';
  const [agentResult, referenceResult] = await Promise.allSettled([
    listAiAgents(undefined, controller.signal),
    listAiAgentReferences(controller.signal),
  ]);
  if (agentResult.status === 'fulfilled') {
    agents.value = agentResult.value;
    if (!agents.value.some((item) => item.id === selectedId.value)) selectedId.value = agents.value[0]?.id || '';
  } else if (!cancelled(agentResult.reason)) {
    loadError.value = agentErrorMessage(agentResult.reason, 'Không tải được danh sách tác nhân.');
  }
  if (referenceResult.status === 'fulfilled') {
    references.value = referenceResult.value;
  } else if (!cancelled(referenceResult.reason)) {
    referenceError.value = agentErrorMessage(referenceResult.reason, 'Không tải được prompt, model và kỹ năng.');
  }
  loading.value = false;
}
function selectAgent(id: string) {
  selectedId.value = id;
  editorOpen.value = false;
  editingId.value = '';
}
function beginCreate() {
  editingId.value = '';
  setForm(blankForm());
  editorOpen.value = true;
}
function beginEdit() {
  const item = selectedAgent.value;
  if (!item) return;
  editingId.value = item.id;
  setForm({
    key: item.key,
    name: item.name,
    personaId: item.personaId,
    promptVersionId: item.promptVersionId,
    modelConfigId: item.modelConfigId,
    skillIds: item.skills.map((skill) => skill.id),
    capabilities: [...item.capabilities],
    policy: { ...item.policy, handoffOnRisk: [...item.policy.handoffOnRisk] },
    autoReplyMode: item.autoReplyMode,
  });
  editorOpen.value = true;
}
function closeEditor() {
  if (!saveBusy.value) {
    editorOpen.value = false;
    editingId.value = '';
  }
}
async function saveAgent() {
  if (!canSave.value || saveBusy.value) return;
  saveBusy.value = true;
  try {
    const input: AgentForm = {
      key: form.key,
      name: form.name.trim(),
      personaId: form.personaId || null,
      promptVersionId: form.promptVersionId || null,
      modelConfigId: form.modelConfigId || null,
      skillIds: [...form.skillIds],
      capabilities: [...form.capabilities],
      policy: { ...form.policy, handoffOnRisk: [...form.policy.handoffOnRisk] },
      autoReplyMode: form.autoReplyMode,
    };
    let id = editingId.value;
    if (editingId.value) {
      const { key: _key, ...updateInput } = input;
      await updateAiAgent(editingId.value, updateInput);
      toast('Đã lưu thay đổi và đưa tác nhân về Bản nháp.');
    } else {
      const created = await createAiAgent(input);
      id = created.id;
      toast('Đã tạo bản nháp tác nhân AI.');
    }
    editorOpen.value = false;
    editingId.value = '';
    await loadData();
    if (id) selectedId.value = id;
  } catch (error) {
    toast(agentErrorMessage(error, 'Không lưu được tác nhân.'), false);
  } finally {
    saveBusy.value = false;
  }
}

function requestAction(state: AgentActionState) {
  if (!state.enabled) {
    if (state.reason) toast(state.reason, false);
    return;
  }
  if (state.action === 'edit') {
    beginEdit();
    return;
  }
  const copy = {
    submit: ['Gửi tác nhân để phê duyệt?', 'Cấu hình sẽ khóa chỉnh sửa tới khi một quản trị viên khác phê duyệt.', 'Gửi phê duyệt', false],
    approve: ['Phê duyệt cấu hình?', 'Xác nhận đã rà soát prompt, model, kỹ năng, quyền và chính sách. Người sửa gần nhất không được tự duyệt.', 'Phê duyệt', false],
    activate: ['Kích hoạt tác nhân?', 'Backend kiểm tra lại prompt Production, model khả dụng và lượt đánh giá đạt còn hiệu lực.', 'Kích hoạt', false],
    deactivate: ['Tạm dừng tác nhân?', 'Tác nhân ngừng vận hành nhưng cấu hình và nhật ký vẫn được giữ.', 'Tạm dừng', false],
    archive: ['Lưu trữ tác nhân?', 'Tác nhân bị loại khỏi danh sách vận hành. Chỉ tiếp tục khi chắc chắn không còn cần.', 'Lưu trữ', true],
  } as const;
  const item = copy[state.action as Exclude<AgentAction, 'edit'>];
  Object.assign(confirm, {
    open: true,
    action: state.action,
    title: item[0],
    message: item[1],
    label: item[2],
    danger: item[3],
    note: '',
  });
}
function closeConfirm() {
  if (!busyAction.value) Object.assign(confirm, { open: false, action: null, note: '' });
}
async function performConfirmed() {
  const action = confirm.action;
  const item = selectedAgent.value;
  if (!action || !item || busyAction.value) return;
  busyAction.value = action;
  try {
    if (action === 'submit') await submitAiAgent(item.id);
    else if (action === 'approve') await approveAiAgent(item.id, confirm.note || undefined);
    else if (action === 'activate') await activateAiAgent(item.id);
    else if (action === 'deactivate') await deactivateAiAgent(item.id);
    else if (action === 'archive') await archiveAiAgent(item.id);
    toast({
      submit: 'Đã gửi phê duyệt.',
      approve: 'Đã phê duyệt tác nhân.',
      activate: 'Đã kích hoạt sau khi vượt cổng đánh giá.',
      deactivate: 'Đã tạm dừng tác nhân.',
      archive: 'Đã lưu trữ tác nhân.',
      edit: '',
    }[action]);
    confirm.open = false;
    if (action === 'archive') selectedId.value = '';
    await loadData();
  } catch (error) {
    toast(agentErrorMessage(error), false);
  } finally {
    busyAction.value = null;
  }
}
function openEvaluation(id: string) {
  void router.push({ path: '/settings/crm/ai-assistant/evaluations', query: { targetType: 'agent', targetId: id } });
}
function capabilityLabel(value: AiAgentCapability) {
  return CAPABILITY_LABELS[value] || value;
}
function replyModeLabel(value: AiAgentAutoReplyMode) {
  return replyModes.find((item) => item.value === value)?.label || value;
}
function riskLabel(value: 'medium' | 'high' | 'critical') {
  return riskLevels.find((item) => item.value === value)?.label || value;
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Không xác định'
    : date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

onMounted(loadData);
onBeforeUnmount(() => {
  controller?.abort();
  if (timer !== null) window.clearTimeout(timer);
});
</script>
<style scoped>
.agents{color:#172033;font-size:14px;line-height:1.5}
.top,.title,.top-actions,.toolbar,.detail-head,.title-line,.form-actions,.action-bar,.dialog>div{display:flex;align-items:center}
.top{justify-content:space-between;gap:20px;margin-bottom:16px}.top h2,.detail-head h3,.dialog h3{margin:0;color:#102a43}.top h2{font-size:21px}.top p,.detail-head p{margin:4px 0 0;color:#68798c}.title{gap:10px}.title span,.safety>b{padding:3px 9px;border-radius:99px;color:#087291;background:#dcf3f8;font-size:12px}.top-actions{gap:9px}
button,input,select,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.55}
.primary,.secondary,.action,.evaluation button,.list-empty button{min-height:38px;padding:0 14px;border:1px solid transparent;border-radius:8px;font-weight:700}.primary{color:#fff;background:#087fa3;border-color:#087fa3}.secondary{color:#294157;background:#fff;border-color:#c8d5e0}
.safety{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;padding:13px 15px;margin-bottom:14px;border:1px solid #b8dce7;border-radius:10px;background:#f1fbfd}.safety>.mdi{color:#087fa3;font-size:24px}.safety strong{color:#11475d}.safety p{margin:2px 0 0;color:#576e7c;font-size:13px}
.notice{display:flex;gap:9px;align-items:center;padding:10px 12px;margin-bottom:14px;border:1px solid #a8dcc1;border-radius:8px;color:#17643d;background:#effbf4}.notice.error{color:#a32839;border-color:#f0b7bf;background:#fff3f5}.notice span{flex:1}.notice button{border:0;color:inherit;background:none;font-size:20px}
.toolbar{justify-content:space-between;gap:12px;margin-bottom:14px}.search{position:relative;flex:1;max-width:560px}.search>.mdi{position:absolute;left:12px;top:10px;color:#738397}.search input{padding-left:36px}.filter{display:flex;align-items:center;gap:8px}.filter>span{color:#657489;font-size:12px;font-weight:700}
input,select,textarea{width:100%;min-height:39px;box-sizing:border-box;padding:8px 10px;border:1px solid #c9d5e1;border-radius:7px;color:#172033;background:#fff;outline:0}input:focus,select:focus,textarea:focus{border-color:#168eae;box-shadow:0 0 0 3px #168eae1f}
.workspace{display:grid;grid-template-columns:minmax(280px,350px) minmax(0,1fr);min-height:610px;overflow:hidden;border:1px solid #d6e0e8;border-radius:11px;background:#fff}.list{overflow:auto;border-right:1px solid #dce5ec;background:#f8fafc}.list-head{display:flex;justify-content:space-between;padding:11px 13px;border-bottom:1px solid #dce5ec;color:#69798b;font-size:12px}
.agent-row{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:10px;width:100%;padding:13px 12px;text-align:left;border:0;border-bottom:1px solid #e3eaf0;background:none}.agent-row:hover{background:#f0f7fa}.agent-row.selected{box-shadow:inset 3px 0 #0b8aad;background:#eaf6fb}
.avatar,.detail-avatar{display:grid;place-items:center;color:#087fa3;background:#dff2f7;border-radius:10px}.avatar{width:38px;height:38px;font-size:21px}.row-body{min-width:0}.row-title{display:flex;align-items:center;gap:6px}.row-title strong{overflow:hidden;color:#12273d;text-overflow:ellipsis;white-space:nowrap}.row-body code,.row-body small{display:block;overflow:hidden;color:#63758a;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.status{flex:none;padding:2px 7px;border-radius:99px;font-size:10px;font-style:normal;font-weight:800}
.tone-neutral{color:#536274;background:#e8edf2}.tone-warning{color:#8a5700;background:#fff0c8}.tone-ready{color:#17643d;background:#ddf5e8}.tone-live{color:#076788;background:#d8f3fb}.tone-muted{color:#6d6376;background:#eeeaf1}.eval-mini{display:flex;margin-top:6px;font-size:11px;font-weight:700}.eval-passed{color:#1b7b4a}.eval-required{color:#9a5a10}.eval-stale{color:#a13242}.chevron{align-self:center;color:#8a9aac}
.list-empty,.state,.placeholder{text-align:center;color:#65758a}.list-empty{padding:36px 18px}.list-empty i,.state>i,.placeholder>i{font-size:38px;color:#82a1b4}.list-empty strong{display:block;color:#23394e}.list-empty p{margin:4px 0 12px}.list-empty button{color:#087fa3;border-color:#bfd3df;background:#fff}
.skeletons{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.skeletons>div{height:100px;padding:14px;border:1px solid #e0e7ed;border-radius:10px}.skeletons i{display:block;width:75%;height:11px;margin:9px 0;border-radius:99px;background:#edf1f5}.skeletons i:first-child{width:45%;height:16px}.state{padding:48px 22px;border:1px solid #dce5ec;border-radius:10px;background:#fff}.state h3,.placeholder h3{margin:8px 0 0;color:#23394e}.state p,.placeholder p{margin:5px auto 15px}.error-state>i{color:#c94757}
.detail,.editor{min-width:0;padding:20px}.editor{overflow:auto;background:#fbfcfd}.detail-head{justify-content:space-between;gap:16px;padding-bottom:16px;border-bottom:1px solid #e2e8ee}.identity{display:flex;gap:12px}.detail-avatar{width:52px;height:52px;font-size:28px}.title-line{flex-wrap:wrap;gap:9px}.detail-head h3{font-size:20px}.detail-head code{color:#5e7186;font-size:12px}.eyebrow{color:#087fa3;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.icon{display:grid;place-items:center;width:36px;height:36px;border:1px solid #d2dce5;border-radius:8px;color:#53677b;background:#fff}
.config-warning,.inline-warning{display:flex;gap:9px;padding:10px 12px;color:#86520d;border:1px solid #f1d39b;border-radius:8px;background:#fff9eb}.config-warning{align-items:center;margin-top:14px}.config-warning p,.inline-warning{margin-bottom:0}
.evaluation{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;padding:14px;margin-top:14px;border:1px solid;border-radius:10px}.evaluation.eval-passed{border-color:#a9dcc0;background:#f0fbf5}.evaluation.eval-required{border-color:#f0cf93;background:#fff9ea}.evaluation.eval-stale{border-color:#edb6be;background:#fff4f5}.evaluation>.mdi{font-size:25px}.evaluation p{margin:2px 0;color:#586a7c;font-size:13px}.evaluation code{font-size:11px}.evaluation button{color:#0b6f8f;border-color:#b6d4df;background:#fff}
.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}.summary article{min-width:0;padding:12px;border:1px solid #dde5ec;border-radius:9px;background:#fbfcfd}.summary span,.summary small{display:block;color:#69798b;font-size:11px}.summary strong{display:block;overflow:hidden;color:#20374c;text-overflow:ellipsis;white-space:nowrap}
.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:14px}.cards>section{min-width:0;padding:14px;border:1px solid #dce4eb;border-radius:10px}.card-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.card-title h4{margin:0;color:#263b50}.card-title i{color:#1885a4}.card-title span{font-size:12px}.chips{display:flex;flex-wrap:wrap;gap:7px}.chips span{padding:5px 8px;border-radius:6px;color:#18536a;background:#e8f5f8;font-size:12px;font-weight:700}.chips.purple span{color:#4f4779;background:#efedfa}.cards p{color:#718093;font-size:12px}.cards dl{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin:0}.cards .wide{grid-column:1/-1}.cards dt{color:#718093;font-size:11px}.cards dd{margin:2px 0;color:#263b50;font-weight:700}
.action-bar{justify-content:space-between;gap:16px;padding-top:16px;margin-top:16px;border-top:1px solid #e1e7ed}.action-bar p{margin:2px 0;color:#6b798a;font-size:12px}.action-bar>div:last-child{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.action.secondary{color:#254057;border-color:#c7d4df;background:#fff}.action.primary{color:#fff;border-color:#087fa3;background:#087fa3}.action.danger{color:#b2293e;border-color:#e8b0b8;background:#fff5f6}.placeholder{align-self:center;padding:48px 24px}
.form{display:grid;gap:14px;padding-top:16px}.form>section{padding:15px;border:1px solid #dce5ec;border-radius:10px;background:#fff}.section-heading{display:flex;gap:10px;margin-bottom:13px}.section-heading>i{color:#1685a4;font-size:21px}.section-heading h4{margin:0;color:#233a50}.section-heading p{margin:2px 0;color:#708093;font-size:12px}.grid{display:grid;gap:12px}.grid.two{grid-template-columns:repeat(2,1fr)}.form label>span,.dialog label>span{display:block;margin-bottom:5px;color:#405367;font-size:12px;font-weight:700}.form label small{display:block;margin-top:4px;color:#718094;font-size:11px}.form .grid+label{display:block;margin-top:12px}.warn{color:#a35d0b!important}
.choices{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;max-height:240px;overflow:auto}.choices label,.modes label,.toggles label{display:flex;gap:9px;padding:10px;border:1px solid #dce4eb;border-radius:8px;background:#fbfcfd}.choices input,.modes input,.toggles input,.risks input{width:16px;min-height:16px;box-shadow:none}.choices strong,.modes strong,.toggles strong{display:block;color:#2b4054}.choices small,.modes small,.toggles small,.choices code{display:block;color:#6c7c8e;font-size:11px}
.modes{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.modes label{align-items:center}.modes label.selected{border-color:#44a4be;background:#eef9fc}.modes i{color:#1683a2;font-size:21px}.toggles{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px}.range,.suffix{display:flex;align-items:center;gap:8px}.range input[type=range]{flex:1;padding:0;border:0;box-shadow:none}.range input[type=number]{width:82px}.suffix span{white-space:nowrap}
fieldset{margin-top:13px;border:1px solid #dce4eb;border-radius:8px}legend{font-size:12px;font-weight:700}.risks{display:flex;gap:14px;padding:5px}.risks label{display:flex;align-items:center;gap:6px}.form-actions{position:sticky;bottom:0;justify-content:flex-end;gap:9px;padding:12px 0;background:#fbfcfd}
.backdrop{position:fixed;z-index:1200;inset:0;display:grid;place-items:center;padding:18px;background:#0f1c2b7a}.dialog{width:min(440px,100%);padding:22px;border-radius:12px;background:#fff;box-shadow:0 18px 60px #0c1e303d}.dialog-icon{color:#1683a2;font-size:32px}.dialog-icon.danger{color:#bd3348}.dialog h3{margin-top:6px}.dialog>p{color:#637286}.dialog>div{justify-content:flex-end;gap:8px;margin-top:14px}
@media(max-width:1100px){.workspace{grid-template-columns:minmax(250px,300px) minmax(0,1fr)}.summary{grid-template-columns:repeat(2,1fr)}.modes{grid-template-columns:1fr}}
@media(max-width:780px){.top,.toolbar,.action-bar{align-items:stretch;flex-direction:column}.top-actions,.top-actions button{width:100%}.search{max-width:none}.filter{align-items:stretch;flex-direction:column}.workspace{display:block}.list{max-height:340px;border-right:0;border-bottom:1px solid #dce5ec}.detail,.editor{padding:15px}.grid.two,.choices,.toggles,.summary,.cards{grid-template-columns:1fr}.evaluation{grid-template-columns:auto 1fr}.evaluation button{grid-column:1/-1}.safety{grid-template-columns:auto 1fr}.safety>b{grid-column:2;width:max-content}.action-bar>div:last-child{justify-content:stretch}.action-bar button{flex:1}}
</style>
