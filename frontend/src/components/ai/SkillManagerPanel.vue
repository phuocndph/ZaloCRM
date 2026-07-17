<template>
  <section class="skill-manager">
    <header class="panel-header">
      <div>
        <div class="title-row">
          <h2>Kỹ năng AI</h2>
          <span class="count-badge">{{ skills.length }} kỹ năng</span>
        </div>
        <p>Cấu hình phạm vi, công cụ và hàng rào an toàn cho từng tác vụ AI.</p>
      </div>
      <div class="header-actions">
        <button type="button" class="secondary" :disabled="actionBusy === 'sync'" @click="syncCatalog">
          <span class="mdi mdi-sync" aria-hidden="true" />
          {{ actionBusy === 'sync' ? 'Đang đồng bộ…' : 'Đồng bộ catalog mặc định' }}
        </button>
        <button type="button" class="primary" @click="openCreate">
          <span class="mdi mdi-plus" aria-hidden="true" /> Tạo kỹ năng
        </button>
      </div>
    </header>

    <div class="truth-note">
      <span class="mdi mdi-information-outline" aria-hidden="true" />
      <p><strong>Trạng thái trung thực:</strong> API hiện chỉ trả các kỹ năng chưa lưu trữ và chưa hỗ trợ bật/tắt độc lập. “Đang hoạt động” không đồng nghĩa với đã đủ prompt production.</p>
    </div>

    <div v-if="message" class="notice" :class="{ error: !messageOk }" role="status">
      <span class="mdi" :class="messageOk ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline'" aria-hidden="true" />
      {{ message }}
      <button type="button" aria-label="Đóng thông báo" @click="message = ''">×</button>
    </div>

    <div class="filters">
      <label class="search-field">
        <span class="mdi mdi-magnify" aria-hidden="true" />
        <input v-model="search" type="search" placeholder="Tìm theo tên, key, mục tiêu hoặc intent…" />
      </label>
      <label>
        <span>Rủi ro</span>
        <select v-model="riskFilter">
          <option value="">Tất cả mức rủi ro</option>
          <option value="low">Rủi ro thấp</option>
          <option value="medium">Rủi ro vừa</option>
          <option value="high">Rủi ro cao</option>
        </select>
      </label>
      <label>
        <span>Mức sẵn sàng</span>
        <select v-model="readinessFilter">
          <option value="">Tất cả trạng thái</option>
          <option value="ready">Sẵn sàng</option>
          <option value="needs_prompt">Thiếu prompt production</option>
          <option value="incomplete">Thiếu cấu hình</option>
        </select>
      </label>
      <button v-if="hasFilters" type="button" class="clear-filter" @click="clearFilters">Xóa lọc</button>
    </div>

    <div class="manager-grid">
      <aside class="skill-list" aria-label="Danh sách kỹ năng AI">
        <div v-if="listLoading" class="list-state" aria-live="polite">
          <span class="spinner" aria-hidden="true" /> Đang tải kỹ năng…
        </div>
        <div v-else-if="listError" class="list-state error-state">
          <span class="mdi mdi-alert-circle-outline" aria-hidden="true" />
          <p>{{ listError }}</p>
          <button type="button" @click="loadSkills()">Thử lại</button>
        </div>
        <div v-else-if="!skills.length" class="list-state">
          <span class="mdi mdi-puzzle-outline" aria-hidden="true" />
          <strong>Chưa có kỹ năng</strong>
          <p>Tạo kỹ năng mới hoặc đồng bộ catalog mặc định để bắt đầu.</p>
        </div>
        <div v-else-if="!filteredSkills.length" class="list-state">
          <span class="mdi mdi-filter-off-outline" aria-hidden="true" />
          <strong>Không tìm thấy kết quả</strong>
          <p>Hãy đổi từ khóa hoặc bộ lọc.</p>
          <button type="button" @click="clearFilters">Xóa lọc</button>
        </div>
        <button
          v-for="skill in filteredSkills"
          v-else
          :key="skill.id"
          type="button"
          class="skill-item"
          :class="{ selected: selectedId === skill.id }"
          @click="selectSkill(skill.id)"
        >
          <span class="item-top">
            <strong>{{ skill.name }}</strong>
            <span class="risk-badge" :class="definitionFor(skill).riskTier">{{ riskLabel(definitionFor(skill).riskTier) }}</span>
          </span>
          <code>{{ skill.key }}</code>
          <span class="item-goal">{{ definitionFor(skill).goal || 'Chưa có mục tiêu' }}</span>
          <span class="item-bottom">
            <span class="active-status"><i /> Đang hoạt động</span>
            <span class="readiness-badge" :class="skillReadiness(skill)">{{ readinessLabel(skillReadiness(skill)) }}</span>
          </span>
        </button>
      </aside>

      <main class="skill-detail">
        <div v-if="detailLoading" class="detail-state">
          <span class="spinner" aria-hidden="true" />
          <p>Đang tải chi tiết kỹ năng…</p>
        </div>

        <form v-else-if="editorMode" class="skill-form" @submit.prevent="saveSkill">
          <header class="form-header">
            <div>
              <h3>{{ editorMode === 'create' ? 'Tạo kỹ năng mới' : 'Chỉnh sửa kỹ năng' }}</h3>
              <p v-if="editorMode === 'edit'">Backend chỉ cho cập nhật khi kỹ năng đã có evaluation đạt.</p>
            </div>
            <button type="button" class="icon-button" aria-label="Đóng trình chỉnh sửa" @click="closeEditor">×</button>
          </header>

          <fieldset>
            <legend>Thông tin cơ bản</legend>
            <div class="form-grid two">
              <label>Key kỹ năng
                <input v-model.trim="form.key" :disabled="editorMode === 'edit'" required pattern="[a-z][a-z0-9_]{2,99}" placeholder="sales_advisor" />
                <small v-if="editorMode === 'edit'">Key không thể đổi sau khi tạo.</small>
              </label>
              <label>Tên hiển thị
                <input v-model.trim="form.name" required maxlength="180" placeholder="Tư vấn bán hàng" />
              </label>
            </div>
            <label>Mục tiêu
              <textarea v-model.trim="form.goal" required rows="3" placeholder="Mô tả kết quả kỹ năng cần đạt…" />
            </label>
            <div class="form-grid three">
              <label>Mức rủi ro
                <select v-model="form.riskTier"><option value="low">Thấp</option><option value="medium">Vừa</option><option value="high">Cao</option></select>
              </label>
              <label>Giọng điệu
                <select v-model="form.defaultTone"><option v-for="tone in tones" :key="tone.value" :value="tone.value">{{ tone.label }}</option></select>
              </label>
              <label>Ngưỡng tin cậy
                <input v-model.number="form.confidenceThreshold" type="number" min="0" max="1" step="0.01" required />
              </label>
            </div>
            <label>Prompt key
              <input v-model.trim="form.promptKey" required placeholder="skill.sales_advisor" />
              <small>Việc nhập key không tự tạo hoặc publish prompt.</small>
            </label>
          </fieldset>

          <fieldset>
            <legend>Kích hoạt & tri thức</legend>
            <div class="form-grid two">
              <label>Intents <small>Mỗi dòng hoặc cách nhau bằng dấu phẩy</small><textarea v-model="form.intents" rows="4" placeholder="product_inquiry&#10;price_inquiry" /></label>
              <label>Điều kiện kích hoạt <small>Mỗi điều kiện một dòng</small><textarea v-model="form.conditions" rows="4" /></label>
              <label>Loại nguồn tri thức<textarea v-model="form.sourceTypes" rows="3" placeholder="product, price_list, policy" /></label>
              <label>Tags tri thức<textarea v-model="form.knowledgeTags" rows="3" placeholder="retail, current_price" /></label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Khả năng & quyền hành động</legend>
            <div class="form-grid three">
              <label>Công cụ được phép<textarea v-model="form.allowedTools" rows="5" placeholder="context.read&#10;knowledge.search" /></label>
              <label>Hành động được phép<textarea v-model="form.allowedActions" rows="5" placeholder="suggest_reply" /></label>
              <label>Cần người duyệt<textarea v-model="form.approvalActions" rows="5" placeholder="send_quote&#10;create_order" /></label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Hàng rào an toàn</legend>
            <div class="form-grid two">
              <label>Quy tắc an toàn<textarea v-model="form.safetyRules" rows="5" placeholder="Mỗi quy tắc một dòng" /></label>
              <label>Quy tắc bàn giao<textarea v-model="form.handoffRules" rows="5" placeholder="Khi nào phải chuyển nhân viên" /></label>
            </div>
          </fieldset>

          <details class="advanced">
            <summary>Ngưỡng theo chế độ (tùy chọn)</summary>
            <div class="form-grid three">
              <label>Cần phê duyệt<input v-model.number="form.approvalThreshold" type="number" min="0" max="1" step="0.01" placeholder="Không đặt" /></label>
              <label>Cho phép tự gửi<input v-model.number="form.autoSendThreshold" type="number" min="0" max="1" step="0.01" placeholder="Không đặt" /></label>
              <label>Bàn giao người thật<input v-model.number="form.handoffThreshold" type="number" min="0" max="1" step="0.01" placeholder="Không đặt" /></label>
            </div>
          </details>

          <div class="form-actions">
            <button type="button" class="secondary" @click="closeEditor">Hủy</button>
            <button type="submit" class="primary" :disabled="saving">{{ saving ? 'Đang lưu…' : editorMode === 'create' ? 'Tạo kỹ năng' : 'Lưu thay đổi' }}</button>
          </div>
        </form>

        <div v-else-if="detail && selectedDefinition" class="detail-content">
          <header class="detail-header">
            <div>
              <div class="detail-title-row">
                <h3>{{ detail.name }}</h3>
                <span class="active-pill"><i /> Đang hoạt động</span>
                <span class="readiness-badge" :class="skillReadiness(detail)">{{ readinessLabel(skillReadiness(detail)) }}</span>
              </div>
              <code>{{ detail.key }}</code>
              <p>{{ selectedDefinition.goal || 'Kỹ năng chưa có mục tiêu.' }}</p>
            </div>
            <div class="detail-actions">
              <button type="button" class="secondary" @click="openEdit"><span class="mdi mdi-pencil-outline" /> Chỉnh sửa</button>
              <button type="button" class="archive-button" :disabled="actionBusy === 'archive'" @click="archiveSelected"><span class="mdi mdi-archive-outline" /> {{ actionBusy === 'archive' ? 'Đang lưu trữ…' : 'Lưu trữ' }}</button>
            </div>
          </header>

          <div v-if="skillReadiness(detail) !== 'ready'" class="readiness-warning">
            <span class="mdi mdi-alert-outline" aria-hidden="true" />
            <p v-if="skillReadiness(detail) === 'needs_prompt'"><strong>Chưa có prompt production liên kết.</strong> Kỹ năng tồn tại nhưng chưa đủ điều kiện sẵn sàng theo UI.</p>
            <p v-else><strong>Thiếu cấu hình bắt buộc.</strong> Hãy bổ sung mục tiêu và prompt key trước khi sử dụng.</p>
          </div>

          <div class="summary-cards">
            <article><span>Rủi ro</span><strong class="risk-text" :class="selectedDefinition.riskTier">{{ riskLabel(selectedDefinition.riskTier) }}</strong></article>
            <article><span>Ngưỡng tin cậy</span><strong>{{ Math.round(selectedDefinition.confidenceThreshold * 100) }}%</strong></article>
            <article><span>Giọng điệu</span><strong>{{ toneLabel(selectedDefinition.defaultTone) }}</strong></article>
            <article><span>Prompt key</span><strong class="mono">{{ selectedDefinition.promptKey || 'Chưa đặt' }}</strong></article>
          </div>

          <div class="detail-grid">
            <section class="detail-card">
              <h4><span class="mdi mdi-target" /> Điều kiện kích hoạt</h4>
              <h5>Intents</h5><div class="chips"><span v-for="item in selectedDefinition.activation.intents" :key="item">{{ item }}</span><em v-if="!selectedDefinition.activation.intents.length">Chưa cấu hình</em></div>
              <h5>Điều kiện</h5><ul><li v-for="item in selectedDefinition.activation.conditions" :key="item">{{ item }}</li></ul><p v-if="!selectedDefinition.activation.conditions.length" class="empty-line">Chưa cấu hình</p>
            </section>
            <section class="detail-card">
              <h4><span class="mdi mdi-book-open-page-variant-outline" /> Phạm vi tri thức</h4>
              <h5>Loại nguồn</h5><div class="chips"><span v-for="item in selectedDefinition.knowledgeScope.sourceTypes" :key="item">{{ item }}</span><em v-if="!selectedDefinition.knowledgeScope.sourceTypes.length">Không giới hạn đã khai báo</em></div>
              <h5>Tags</h5><div class="chips neutral"><span v-for="item in selectedDefinition.knowledgeScope.tags" :key="item">{{ item }}</span><em v-if="!selectedDefinition.knowledgeScope.tags?.length">Không có tags</em></div>
            </section>
            <section class="detail-card wide">
              <h4><span class="mdi mdi-tools" /> Khả năng và công cụ</h4>
              <div class="capability-columns">
                <div><h5>Công cụ được phép</h5><div class="chips tool"><span v-for="item in selectedDefinition.allowedTools" :key="item">{{ item }}</span><em v-if="!selectedDefinition.allowedTools.length">Không có công cụ</em></div></div>
                <div><h5>Hành động được phép</h5><div class="chips action"><span v-for="item in selectedDefinition.allowedActions" :key="item">{{ item }}</span><em v-if="!selectedDefinition.allowedActions.length">Không có hành động</em></div></div>
                <div><h5>Cần người duyệt</h5><div class="chips approval"><span v-for="item in selectedDefinition.approvalActions" :key="item">{{ item }}</span><em v-if="!selectedDefinition.approvalActions.length">Không khai báo</em></div></div>
              </div>
            </section>
            <section class="detail-card">
              <h4><span class="mdi mdi-shield-check-outline" /> Quy tắc an toàn</h4>
              <ul class="guardrails"><li v-for="item in selectedDefinition.safetyRules" :key="item">{{ item }}</li></ul><p v-if="!selectedDefinition.safetyRules.length" class="empty-line">Chưa có quy tắc an toàn.</p>
            </section>
            <section class="detail-card">
              <h4><span class="mdi mdi-account-arrow-right-outline" /> Quy tắc bàn giao</h4>
              <ul class="guardrails"><li v-for="item in selectedDefinition.handoffRules" :key="item">{{ item }}</li></ul><p v-if="!selectedDefinition.handoffRules.length" class="empty-line">Chưa có quy tắc bàn giao.</p>
            </section>
            <section class="detail-card wide prompt-card">
              <div class="card-title-actions"><h4><span class="mdi mdi-message-text-outline" /> Prompt production liên kết</h4><span>{{ productionPromptCount(detail) }} phiên bản</span></div>
              <div v-if="detail.prompts.length" class="prompt-list">
                <div v-for="prompt in detail.prompts" :key="prompt.id"><code>{{ prompt.key }}</code><span v-if="prompt.versions.length">Production v{{ prompt.versions.map((version) => version.version).join(', v') }}</span><span v-else class="missing">Chưa có production</span></div>
              </div>
              <p v-else class="empty-line">Chưa có prompt nào được liên kết bởi backend.</p>
            </section>
          </div>

          <footer class="detail-footer">Cập nhật {{ formatDate(detail.updatedAt) }} · Handler: <code>{{ detail.handlerType }}</code></footer>
        </div>

        <div v-else class="detail-state">
          <span class="mdi mdi-cursor-default-click-outline" aria-hidden="true" />
          <strong>Chọn một kỹ năng</strong>
          <p>Xem mục tiêu, quyền công cụ, hành động cần duyệt và hàng rào an toàn.</p>
        </div>
      </main>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import {
  archiveAiSkill,
  createAiSkill,
  getAiSkill,
  listAiSkills,
  syncAiSkillCatalog,
  updateAiSkill,
  type AiSkillDefinition,
  type AiSkillRecord,
  type AiSkillRiskTier,
  type AiSkillTone,
} from '@/api/ai-skills';
import {
  filterAiSkills,
  listText,
  parseList,
  readinessLabel,
  riskLabel,
  skillDefinitionOf,
  skillReadiness,
  type AiSkillReadiness,
} from './skill-manager-view-model';

type EditorMode = 'create' | 'edit' | '';
type OptionalNumber = number | '';
type SkillForm = {
  key: string; name: string; goal: string; riskTier: AiSkillRiskTier; promptKey: string; defaultTone: AiSkillTone;
  confidenceThreshold: number; intents: string; conditions: string; sourceTypes: string; knowledgeTags: string;
  allowedTools: string; allowedActions: string; approvalActions: string; safetyRules: string; handoffRules: string;
  approvalThreshold: OptionalNumber; autoSendThreshold: OptionalNumber; handoffThreshold: OptionalNumber;
};

const tones: Array<{ value: AiSkillTone; label: string }> = [
  { value: 'warm', label: 'Ấm áp' }, { value: 'clear', label: 'Rõ ràng' },
  { value: 'reassuring', label: 'Trấn an' }, { value: 'concise', label: 'Ngắn gọn' },
  { value: 'calm_deescalating', label: 'Bình tĩnh, xoa dịu' }, { value: 'handoff', label: 'Bàn giao' },
];

const skills = ref<AiSkillRecord[]>([]);
const detail = ref<AiSkillRecord | null>(null);
const selectedId = ref('');
const listLoading = ref(false);
const detailLoading = ref(false);
const saving = ref(false);
const actionBusy = ref<'sync' | 'archive' | ''>('');
const listError = ref('');
const message = ref('');
const messageOk = ref(true);
const search = ref('');
const riskFilter = ref<'' | AiSkillRiskTier>('');
const readinessFilter = ref<'' | AiSkillReadiness>('');
const editorMode = ref<EditorMode>('');
let listController: AbortController | null = null;
let detailController: AbortController | null = null;

const form = reactive<SkillForm>(blankForm());
const filteredSkills = computed(() => filterAiSkills(skills.value, { search: search.value, riskTier: riskFilter.value, readiness: readinessFilter.value }));
const selectedDefinition = computed(() => detail.value ? skillDefinitionOf(detail.value) : null);
const hasFilters = computed(() => !!search.value || !!riskFilter.value || !!readinessFilter.value);

function blankForm(): SkillForm {
  return { key: '', name: '', goal: '', riskTier: 'low', promptKey: '', defaultTone: 'clear', confidenceThreshold: 0.8, intents: '', conditions: '', sourceTypes: '', knowledgeTags: '', allowedTools: '', allowedActions: '', approvalActions: '', safetyRules: '', handoffRules: '', approvalThreshold: '', autoSendThreshold: '', handoffThreshold: '' };
}

function cancelled(error: unknown) {
  const value = error as { code?: string; name?: string };
  return value?.code === 'ERR_CANCELED' || value?.name === 'CanceledError' || value?.name === 'AbortError';
}

function errorText(error: any, fallback: string) {
  const code = error?.response?.data?.code;
  const backendMessage = String(error?.response?.data?.error || '');
  if (code === 'EVALUATION_GATE_BLOCKED' || /passing evaluation/i.test(backendMessage)) return 'Chưa thể cập nhật: kỹ năng cần một lượt evaluation đạt theo cổng kiểm soát của backend.';
  if (error?.response?.status === 403) return 'Bạn không có quyền quản trị kỹ năng AI.';
  return error?.response?.data?.error || error?.message || fallback;
}

function notify(text: string, ok = true) {
  message.value = text;
  messageOk.value = ok;
  window.setTimeout(() => { if (message.value === text) message.value = ''; }, 5000);
}

function definitionFor(skill: AiSkillRecord) { return skillDefinitionOf(skill); }
function toneLabel(tone: AiSkillTone) { return tones.find((item) => item.value === tone)?.label || tone; }
function formatDate(value: string) { return new Date(value).toLocaleString('vi-VN'); }
function productionPromptCount(skill: AiSkillRecord) { return skill.prompts.reduce((total, prompt) => total + prompt.versions.length, 0); }

async function loadSkills(preferredId = selectedId.value) {
  listController?.abort();
  listController = new AbortController();
  listLoading.value = true;
  listError.value = '';
  try {
    skills.value = await listAiSkills(listController.signal);
    const target = skills.value.find((skill) => skill.id === preferredId) || skills.value[0];
    if (target) await selectSkill(target.id);
    else { selectedId.value = ''; detail.value = null; }
  } catch (error) {
    if (!cancelled(error)) listError.value = errorText(error, 'Không thể tải danh sách kỹ năng AI.');
  } finally {
    listLoading.value = false;
  }
}

async function selectSkill(id: string) {
  if (!id) return;
  detailController?.abort();
  detailController = new AbortController();
  selectedId.value = id;
  detailLoading.value = true;
  editorMode.value = '';
  try {
    detail.value = await getAiSkill(id, detailController.signal);
  } catch (error) {
    if (!cancelled(error)) { detail.value = null; notify(errorText(error, 'Không thể tải chi tiết kỹ năng.'), false); }
  } finally {
    detailLoading.value = false;
  }
}

function clearFilters() { search.value = ''; riskFilter.value = ''; readinessFilter.value = ''; }
function openCreate() { Object.assign(form, blankForm()); editorMode.value = 'create'; }

function openEdit() {
  if (!detail.value) return;
  const definition = skillDefinitionOf(detail.value);
  Object.assign(form, {
    key: definition.key, name: definition.name, goal: definition.goal, riskTier: definition.riskTier,
    promptKey: definition.promptKey, defaultTone: definition.defaultTone, confidenceThreshold: definition.confidenceThreshold,
    intents: listText(definition.activation.intents), conditions: listText(definition.activation.conditions),
    sourceTypes: listText(definition.knowledgeScope.sourceTypes), knowledgeTags: listText(definition.knowledgeScope.tags),
    allowedTools: listText(definition.allowedTools), allowedActions: listText(definition.allowedActions),
    approvalActions: listText(definition.approvalActions), safetyRules: listText(definition.safetyRules), handoffRules: listText(definition.handoffRules),
    approvalThreshold: definition.confidenceModeThresholds?.approval_required ?? '',
    autoSendThreshold: definition.confidenceModeThresholds?.auto_send_allowed ?? '',
    handoffThreshold: definition.confidenceModeThresholds?.human_handoff ?? '',
  });
  editorMode.value = 'edit';
}

function closeEditor() { editorMode.value = ''; }

function optionalThresholds() {
  const entries = {
    approval_required: form.approvalThreshold,
    auto_send_allowed: form.autoSendThreshold,
    human_handoff: form.handoffThreshold,
  };
  const values = Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== '' && Number.isFinite(Number(value))).map(([key, value]) => [key, Number(value)]));
  return Object.keys(values).length ? values : undefined;
}

function formDefinition(): AiSkillDefinition {
  return {
    key: form.key, name: form.name, goal: form.goal,
    activation: { intents: parseList(form.intents), conditions: parseList(form.conditions) },
    promptKey: form.promptKey,
    knowledgeScope: { sourceTypes: parseList(form.sourceTypes), tags: parseList(form.knowledgeTags) },
    allowedTools: parseList(form.allowedTools), allowedActions: parseList(form.allowedActions), approvalActions: parseList(form.approvalActions),
    defaultTone: form.defaultTone, safetyRules: parseList(form.safetyRules), handoffRules: parseList(form.handoffRules),
    confidenceThreshold: Number(form.confidenceThreshold), confidenceModeThresholds: optionalThresholds(), riskTier: form.riskTier,
  };
}

function thresholdsValid(definition: AiSkillDefinition) {
  const values = [definition.confidenceThreshold, ...Object.values(definition.confidenceModeThresholds || {})];
  return values.every((value) => typeof value === 'number' && value >= 0 && value <= 1);
}

async function saveSkill() {
  if (saving.value) return;
  const definition = formDefinition();
  if (!/^[a-z][a-z0-9_]{2,99}$/.test(definition.key)) return notify('Key phải bắt đầu bằng chữ thường và chỉ gồm chữ thường, số hoặc dấu gạch dưới.', false);
  if (!thresholdsValid(definition)) return notify('Tất cả ngưỡng tin cậy phải nằm trong khoảng 0–1.', false);
  saving.value = true;
  try {
    let id = selectedId.value;
    if (editorMode.value === 'create') {
      const created = await createAiSkill(definition);
      id = created.id;
      notify('Đã tạo kỹ năng. Kỹ năng vẫn cần prompt production trước khi được xem là sẵn sàng.');
    } else if (detail.value) {
      const { key: _key, ...update } = definition;
      await updateAiSkill(detail.value.id, update);
      id = detail.value.id;
      notify('Đã cập nhật kỹ năng.');
    }
    editorMode.value = '';
    await loadSkills(id);
  } catch (error) {
    notify(errorText(error, 'Không thể lưu kỹ năng.'), false);
  } finally {
    saving.value = false;
  }
}

async function syncCatalog() {
  if (actionBusy.value) return;
  actionBusy.value = 'sync';
  try {
    const result = await syncAiSkillCatalog();
    notify(result.created.length ? `Đã bổ sung ${result.created.length}/${result.catalogSize} kỹ năng mặc định.` : `Catalog ${result.catalogSize} kỹ năng đã đồng bộ, không có mục mới.`);
    await loadSkills();
  } catch (error) {
    notify(errorText(error, 'Không thể đồng bộ catalog kỹ năng.'), false);
  } finally {
    actionBusy.value = '';
  }
}

async function archiveSelected() {
  if (!detail.value || actionBusy.value) return;
  if (!window.confirm(`Lưu trữ kỹ năng “${detail.value.name}”? API hiện chưa có thao tác bật lại riêng cho kỹ năng tùy chỉnh.`)) return;
  actionBusy.value = 'archive';
  try {
    await archiveAiSkill(detail.value.id);
    notify('Đã lưu trữ kỹ năng. Kỹ năng không còn xuất hiện trong danh sách hoạt động.');
    selectedId.value = '';
    detail.value = null;
    await loadSkills('');
  } catch (error) {
    notify(errorText(error, 'Không thể lưu trữ kỹ năng.'), false);
  } finally {
    actionBusy.value = '';
  }
}

onMounted(() => void loadSkills());
onBeforeUnmount(() => { listController?.abort(); detailController?.abort(); });
</script>

<style scoped>
.skill-manager { overflow: hidden; border: 1px solid #dbe4f0; border-radius: 12px; background: #f8fafc; }
.panel-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 18px; border-bottom: 1px solid #dbe4f0; background: #fff; }
.title-row { display: flex; align-items: center; gap: 8px; }
.panel-header h2 { margin: 0; color: #172033; font-size: 17px; }
.panel-header p { margin: 4px 0 0; color: #64748b; font-size: 12px; }
.count-badge { padding: 2px 7px; border-radius: 999px; background: #eaf2ff; color: #1d4ed8; font-size: 10px; font-weight: 700; }
.header-actions, .detail-actions, .form-actions { display: flex; gap: 7px; align-items: center; }
button { font: inherit; }
.primary, .secondary, .archive-button, .clear-filter, .list-state button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 33px; padding: 6px 10px; border-radius: 7px; font-size: 11px; font-weight: 650; cursor: pointer; }
.primary { border: 1px solid #2563eb; background: #2563eb; color: #fff; }
.secondary, .list-state button { border: 1px solid #cbd5e1; background: #fff; color: #475569; }
.archive-button { border: 1px solid #fed7aa; background: #fff7ed; color: #c2410c; }
button:disabled { cursor: wait; opacity: .6; }
.truth-note { display: flex; align-items: flex-start; gap: 8px; margin: 12px 12px 0; padding: 9px 11px; border: 1px solid #dbeafe; border-radius: 8px; background: #f8fbff; color: #475569; }
.truth-note > span { color: #2563eb; font-size: 17px; }
.truth-note p { margin: 0; font-size: 11px; line-height: 1.55; }
.notice { display: flex; align-items: center; gap: 7px; margin: 10px 12px 0; padding: 8px 10px; border: 1px solid #bbf7d0; border-radius: 7px; background: #f0fdf4; color: #166534; font-size: 11px; }
.notice.error { border-color: #fecaca; background: #fff1f2; color: #991b1b; }
.notice button { margin-left: auto; border: 0; background: transparent; color: inherit; font-size: 17px; cursor: pointer; }
.filters { display: flex; align-items: end; gap: 8px; padding: 12px; }
.filters label { display: flex; flex-direction: column; gap: 4px; color: #64748b; font-size: 10px; font-weight: 650; }
.filters select, .filters input { box-sizing: border-box; min-height: 34px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: #334155; font: 12px inherit; }
.filters select { min-width: 160px; padding: 6px 28px 6px 8px; }
.search-field { position: relative; flex: 1; }
.search-field > span { position: absolute; bottom: 8px; left: 9px; color: #94a3b8; font-size: 17px; }
.search-field input { width: 100%; padding: 6px 9px 6px 32px; }
.clear-filter { border: 0; background: transparent; color: #2563eb; }
.manager-grid { display: grid; grid-template-columns: 310px minmax(0, 1fr); min-height: 650px; border-top: 1px solid #dbe4f0; }
.skill-list { padding: 8px; border-right: 1px solid #dbe4f0; background: #fff; overflow-y: auto; }
.skill-item { display: flex; flex-direction: column; gap: 4px; width: 100%; margin-bottom: 5px; padding: 10px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: #334155; text-align: left; cursor: pointer; }
.skill-item:hover, .skill-item.selected { border-color: #bfdbfe; background: #eff6ff; }
.item-top, .item-bottom { display: flex; align-items: center; justify-content: space-between; gap: 7px; }
.item-top strong { min-width: 0; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.skill-item code { color: #64748b; font-size: 10px; }
.item-goal { min-height: 30px; overflow: hidden; color: #64748b; font-size: 10px; line-height: 1.45; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.active-status, .active-pill { display: inline-flex; align-items: center; gap: 4px; color: #15803d; font-size: 9px; font-weight: 650; }
.active-status i, .active-pill i { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; }
.risk-badge, .readiness-badge { padding: 2px 5px; border-radius: 999px; font-size: 8px; font-weight: 750; white-space: nowrap; }
.risk-badge.low, .risk-text.low { background: #ecfdf5; color: #047857; }.risk-badge.medium, .risk-text.medium { background: #fffbeb; color: #b45309; }.risk-badge.high, .risk-text.high { background: #fff1f2; color: #be123c; }
.readiness-badge.ready { background: #dcfce7; color: #166534; }.readiness-badge.needs_prompt { background: #fef3c7; color: #92400e; }.readiness-badge.incomplete { background: #fee2e2; color: #991b1b; }
.skill-detail { min-width: 0; padding: 16px; }
.list-state, .detail-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; min-height: 240px; padding: 20px; color: #94a3b8; font-size: 12px; text-align: center; }
.list-state .mdi, .detail-state .mdi { font-size: 28px; }.list-state strong, .detail-state strong { color: #475569; }.list-state p, .detail-state p { margin: 0; line-height: 1.5; }
.error-state { color: #b91c1c; }
.spinner { width: 20px; height: 20px; border: 2px solid #cbd5e1; border-top-color: #2563eb; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.detail-header, .form-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding-bottom: 13px; border-bottom: 1px solid #e2e8f0; }
.detail-title-row { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.detail-header h3, .form-header h3 { margin: 0; color: #172033; font-size: 18px; }
.detail-header code { display: block; margin-top: 3px; color: #64748b; font-size: 10px; }.detail-header p, .form-header p { max-width: 660px; margin: 7px 0 0; color: #64748b; font-size: 12px; line-height: 1.5; }
.active-pill { padding: 3px 6px; border-radius: 999px; background: #f0fdf4; }
.readiness-warning { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; padding: 10px; border: 1px solid #fde68a; border-radius: 8px; background: #fffbeb; color: #92400e; }
.readiness-warning p { margin: 0; font-size: 11px; line-height: 1.5; }
.summary-cards { display: grid; grid-template-columns: repeat(4, minmax(110px, 1fr)); gap: 8px; margin: 12px 0; }
.summary-cards article { padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
.summary-cards span { display: block; color: #94a3b8; font-size: 9px; text-transform: uppercase; }.summary-cards strong { display: block; margin-top: 5px; color: #334155; font-size: 12px; }.summary-cards .risk-text { display: inline-block; padding: 2px 5px; border-radius: 5px; }.summary-cards .mono { overflow: hidden; font: 10px Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
.detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.detail-card { min-width: 0; padding: 12px; border: 1px solid #e2e8f0; border-radius: 9px; background: #fff; }.detail-card.wide { grid-column: 1 / -1; }
.detail-card h4 { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; color: #334155; font-size: 12px; }.detail-card h4 .mdi { color: #2563eb; font-size: 16px; }.detail-card h5 { margin: 10px 0 5px; color: #64748b; font-size: 9px; letter-spacing: .04em; text-transform: uppercase; }
.detail-card ul { margin: 5px 0 0; padding-left: 18px; color: #475569; font-size: 11px; line-height: 1.55; }
.chips { display: flex; gap: 5px; flex-wrap: wrap; }.chips span { padding: 3px 6px; border-radius: 5px; background: #eaf2ff; color: #1d4ed8; font: 10px Consolas, monospace; }.chips.neutral span { background: #f1f5f9; color: #475569; }.chips.tool span { background: #ede9fe; color: #6d28d9; }.chips.action span { background: #ecfdf5; color: #047857; }.chips.approval span { background: #fff7ed; color: #c2410c; }.chips em, .empty-line { margin: 0; color: #94a3b8; font-size: 10px; font-style: normal; }
.capability-columns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.guardrails li::marker { color: #2563eb; }
.card-title-actions, .prompt-list > div { display: flex; align-items: center; justify-content: space-between; gap: 10px; }.card-title-actions > span { color: #94a3b8; font-size: 10px; }.prompt-list > div { padding: 7px 0; border-top: 1px solid #f1f5f9; font-size: 10px; }.prompt-list code { color: #475569; }.prompt-list span { color: #15803d; }.prompt-list .missing { color: #b45309; }
.detail-footer { margin-top: 12px; color: #94a3b8; font-size: 9px; text-align: right; }
.skill-form { max-width: 940px; margin: 0 auto; }.icon-button { border: 0; background: transparent; color: #64748b; font-size: 20px; cursor: pointer; }
fieldset { margin: 12px 0; padding: 12px; border: 1px solid #dbe4f0; border-radius: 9px; background: #fff; } legend { padding: 0 5px; color: #334155; font-size: 11px; font-weight: 750; }
.skill-form label { display: flex; flex-direction: column; gap: 5px; margin-bottom: 9px; color: #475569; font-size: 10px; font-weight: 650; }.skill-form label small { color: #94a3b8; font-weight: 400; }
.skill-form input, .skill-form textarea, .skill-form select { box-sizing: border-box; width: 100%; padding: 7px 8px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: #334155; font: 11px inherit; }.skill-form textarea { resize: vertical; }.skill-form input:disabled { background: #f1f5f9; color: #64748b; }
.form-grid { display: grid; gap: 10px; }.form-grid.two { grid-template-columns: 1fr 1fr; }.form-grid.three { grid-template-columns: repeat(3, 1fr); }
.advanced { margin: 12px 0; padding: 10px 12px; border: 1px solid #dbe4f0; border-radius: 8px; background: #fff; }.advanced summary { color: #475569; font-size: 11px; font-weight: 700; cursor: pointer; }.advanced .form-grid { margin-top: 12px; }
.form-actions { justify-content: flex-end; padding-top: 12px; border-top: 1px solid #e2e8f0; }
@media (max-width: 1100px) { .manager-grid { grid-template-columns: 260px minmax(0, 1fr); }.summary-cards { grid-template-columns: 1fr 1fr; }.detail-grid { grid-template-columns: 1fr; }.detail-card.wide { grid-column: auto; }.capability-columns { grid-template-columns: 1fr; } }
@media (max-width: 800px) { .panel-header, .detail-header { flex-direction: column; }.header-actions, .detail-actions { width: 100%; flex-wrap: wrap; }.filters { flex-wrap: wrap; }.search-field { flex-basis: 100%; }.filters label:not(.search-field) { flex: 1; }.filters select { width: 100%; min-width: 0; }.manager-grid { grid-template-columns: 1fr; }.skill-list { max-height: 340px; border-right: 0; border-bottom: 1px solid #dbe4f0; }.form-grid.two, .form-grid.three { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
