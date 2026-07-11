<template>
  <section class="pm">
    <header class="pm-head">
      <div>
        <h2>Quản lý lời nhắc</h2>
        <p>Quan ly Lời nhắc hệ thống va lời nhắc theo kỹ năng voi version, phe duyet va rollback.</p>
      </div>
      <button class="primary" @click="openCreate">+ Tạo lời nhắc</button>
    </header>

    <div v-if="message" class="notice" :class="{ error: !messageOk }">{{ message }}</div>

    <div class="pm-grid">
      <aside class="prompt-list">
        <div class="filters">
          <button :class="{ active: scopeFilter === '' }" @click="scopeFilter = ''; loadList()">Tat ca</button>
          <button :class="{ active: scopeFilter === 'system' }" @click="scopeFilter = 'system'; loadList()">System</button>
          <button :class="{ active: scopeFilter === 'skill' }" @click="scopeFilter = 'skill'; loadList()">Skill</button>
        </div>
        <div v-if="loading" class="empty">Dang tai...</div>
        <button
          v-for="prompt in prompts"
          :key="prompt.id"
          class="prompt-item"
          :class="{ selected: prompt.id === selectedId }"
          @click="selectPrompt(prompt.id)"
        >
          <span class="prompt-name">{{ prompt.name }}</span>
          <span class="prompt-key">{{ prompt.key }}</span>
          <span class="prompt-meta">
            <span class="scope">{{ prompt.scope === 'skill' ? prompt.skill?.name || 'Skill' : 'System' }}</span>
            <span v-if="productionVersion(prompt)" class="production">Production v{{ productionVersion(prompt)?.version }}</span>
            <span v-else class="no-production">Chua Production</span>
          </span>
        </button>
        <div v-if="!loading && !prompts.length" class="empty">Chưa có lời nhắc.</div>
      </aside>

      <main class="prompt-detail">
        <div v-if="!detail && !creating" class="empty detail-empty">Chọn một lời nhắc để xem lịch sử.</div>

        <form v-if="creating" class="editor-card" @submit.prevent="createNewPrompt">
          <h3>Tạo lời nhắc mới</h3>
          <div class="form-row two">
            <label>Ten<input v-model.trim="createForm.name" required /></label>
            <label>Key<input v-model.trim="createForm.key" required placeholder="sales.reply" /></label>
          </div>
          <div class="form-row two">
            <label>Task type<input v-model.trim="createForm.taskType" required placeholder="reply_draft" /></label>
            <label>Pham vi
              <select v-model="createForm.scope">
                <option value="system">System chung</option>
                <option value="skill">Theo Skill</option>
              </select>
            </label>
          </div>
          <label v-if="createForm.scope === 'skill'">Skill
            <select v-model="createForm.skillId" required>
              <option value="">Chon Skill</option>
              <option v-for="skill in skills" :key="skill.id" :value="skill.id">{{ skill.name }}</option>
            </select>
          </label>
          <label>Noi dung Draft v1
            <textarea v-model="createForm.content" rows="12" required placeholder="Ban la tro ly... {{customer.name}}" />
          </label>
          <label>Ghi chú thay đổi<input v-model="createForm.changeNote" placeholder="Khởi tạo lời nhắc" /></label>
          <div class="actions">
            <button type="button" class="ghost" @click="creating = false">Huy</button>
            <button class="primary" :disabled="saving">{{ saving ? 'Dang tao...' : 'Tao Draft' }}</button>
          </div>
        </form>

        <template v-if="detail && !creating">
          <header class="detail-head">
            <div>
              <h3>{{ detail.name }}</h3>
              <div class="detail-sub">{{ detail.key }} - {{ detail.taskType }} - {{ detail.scope }}</div>
            </div>
            <div class="actions compact">
              <button class="ghost" @click="startNewVersion">+ Draft moi</button>
              <button class="danger" @click="removePrompt">Xoa</button>
            </div>
          </header>

          <div class="version-tabs">
            <button
              v-for="version in detail.versions"
              :key="version.id"
              :class="{ active: version.id === selectedVersionId }"
              @click="selectedVersionId = version.id; resetPreview()"
            >
              v{{ version.version }}
              <span class="status" :class="version.status">{{ statusLabel(version.status) }}</span>
            </button>
          </div>

          <div v-if="newVersionMode" class="editor-card">
            <h4>Tao Draft v{{ nextVersion }}</h4>
            <label>Noi dung
              <textarea v-model="versionForm.content" rows="14" />
            </label>
            <label>Ghi chú thay đổi<input v-model="versionForm.changeNote" placeholder="Mo ta thay doi" /></label>
            <div class="actions">
              <button class="ghost" @click="newVersionMode = false">Huy</button>
              <button class="primary" :disabled="saving" @click="saveNewVersion">Luu Draft moi</button>
            </div>
          </div>

          <div v-else-if="selectedVersion" class="version-body">
            <div class="version-toolbar">
              <div>
                <strong>Version {{ selectedVersion.version }}</strong>
                <span class="history">
                  tao boi {{ selectedVersion.createdBy?.fullName || 'He thong' }}
                  - {{ formatDate(selectedVersion.createdAt) }}
                  <template v-if="selectedVersion.approvedBy">
                    - duyet boi {{ selectedVersion.approvedBy.fullName }}
                  </template>
                </span>
              </div>
              <div class="actions compact">
                <button v-if="selectedVersion.status === 'draft'" class="testing-btn" @click="transition('testing')">Dua sang Testing</button>
                <button v-if="selectedVersion.status === 'testing'" class="production-btn" @click="transition('production')">Duyet Production</button>
                <button v-if="selectedVersion.status !== 'production'" class="ghost" @click="rollback">Rollback ve ban nay</button>
              </div>
            </div>
            <p v-if="selectedVersion.changeNote" class="change-note">{{ selectedVersion.changeNote }}</p>
            <div class="variable-row">
              <span>Bien template:</span>
              <code v-for="variable in selectedVersion.variables" :key="variable">{{ variable }}</code>
              <em v-if="!selectedVersion.variables.length">Khong co bien</em>
            </div>
            <textarea class="content-readonly" :value="selectedVersion.content" rows="15" readonly />

            <div class="test-grid">
              <section class="test-card">
                <h4>Preview sau khi render</h4>
                <label>Variables JSON
                  <textarea v-model="variablesJson" rows="5" placeholder='{"customer":{"name":"Lan"}}' />
                </label>
                <button class="ghost" @click="preview">Render Preview</button>
                <pre v-if="previewText" class="result">{{ previewText }}</pre>
              </section>

              <section class="test-card">
                <h4>Test voi Model</h4>
                <label>Model
                  <select v-model="testForm.modelConfigId">
                    <option value="">Chon Model</option>
                    <option v-for="model in modelConfigs" :key="model.id" :value="model.id">
                      {{ model.name }} - {{ model.provider }}/{{ model.model }}
                    </option>
                  </select>
                </label>
                <label>Test input<textarea v-model="testForm.testInput" rows="4" placeholder="Noi dung test khong chua du lieu that" /></label>
                <button class="primary" :disabled="testing" @click="testPrompt">{{ testing ? 'Dang test...' : 'Chay Test' }}</button>
                <pre v-if="testOutput" class="result">{{ testOutput }}</pre>
              </section>
            </div>
          </div>
        </template>
      </main>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '@/api/index';

type Version = {
  id: string; version: number; status: 'draft' | 'testing' | 'production' | 'archived';
  content: string; variables: string[]; changeNote?: string | null;
  createdAt: string; approvedAt?: string | null;
  createdBy?: { id: string; fullName: string } | null;
  approvedBy?: { id: string; fullName: string } | null;
};
type PromptListItem = {
  id: string; key: string; name: string; taskType: string; scope: 'system' | 'skill';
  skill?: { id: string; name: string; key: string } | null;
  versions: Array<Pick<Version, 'id' | 'version' | 'status' | 'approvedAt'>>;
};
type PromptDetail = Omit<PromptListItem, 'versions'> & { versions: Version[] };
type Skill = { id: string; key: string; name: string };
type ModelConfig = { id: string; name: string; provider: string; model: string };

const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const creating = ref(false);
const newVersionMode = ref(false);
const prompts = ref<PromptListItem[]>([]);
const skills = ref<Skill[]>([]);
const modelConfigs = ref<ModelConfig[]>([]);
const detail = ref<PromptDetail | null>(null);
const selectedId = ref('');
const selectedVersionId = ref('');
const scopeFilter = ref('');
const variablesJson = ref('{}');
const previewText = ref('');
const testOutput = ref('');
const message = ref('');
const messageOk = ref(true);

const createForm = reactive({
  name: '', key: '', taskType: '', scope: 'system' as 'system' | 'skill',
  skillId: '', content: '', changeNote: '',
});
const versionForm = reactive({ content: '', changeNote: '' });
const testForm = reactive({ modelConfigId: '', testInput: '' });

const selectedVersion = computed(() => detail.value?.versions.find((item) => item.id === selectedVersionId.value) ?? null);
const nextVersion = computed(() => Math.max(0, ...(detail.value?.versions.map((item) => item.version) ?? [])) + 1);

function productionVersion(prompt: PromptListItem) {
  return prompt.versions.find((version) => version.status === 'production');
}
function statusLabel(status: Version['status']) {
  return ({ draft: 'Draft', testing: 'Testing', production: 'Production', archived: 'Archived' })[status];
}
function formatDate(value: string) {
  return new Date(value).toLocaleString('vi-VN');
}
function notify(text: string, ok = true) {
  message.value = text;
  messageOk.value = ok;
  window.setTimeout(() => { if (message.value === text) message.value = ''; }, 4000);
}
function errorText(error: any) {
  return error?.response?.data?.error || error?.message || 'Co loi xay ra';
}
function parseVariables() {
  const value = JSON.parse(variablesJson.value || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Variables phai la JSON object');
  return value;
}
function resetPreview() {
  previewText.value = '';
  testOutput.value = '';
}

async function loadList() {
  loading.value = true;
  try {
    const params = scopeFilter.value ? { scope: scopeFilter.value } : {};
    const { data } = await api.get<{ prompts: PromptListItem[] }>('/ai/prompts', { params });
    prompts.value = data.prompts;
  } catch (error) {
    notify(errorText(error), false);
  } finally {
    loading.value = false;
  }
}
async function loadReferences() {
  const [skillsRes, modelsRes] = await Promise.all([
    api.get<{ skills: Skill[] }>('/ai/prompts/skills'),
    api.get<{ modelConfigs: ModelConfig[] }>('/ai/prompts/model-configs'),
  ]);
  skills.value = skillsRes.data.skills;
  modelConfigs.value = modelsRes.data.modelConfigs;
}
async function selectPrompt(id: string) {
  selectedId.value = id;
  creating.value = false;
  newVersionMode.value = false;
  resetPreview();
  try {
    const { data } = await api.get<PromptDetail>(`/ai/prompts/${id}`);
    detail.value = data;
    selectedVersionId.value = data.versions[0]?.id || '';
  } catch (error) {
    notify(errorText(error), false);
  }
}
function openCreate() {
  creating.value = true;
  detail.value = null;
  selectedId.value = '';
  Object.assign(createForm, { name: '', key: '', taskType: '', scope: 'system', skillId: '', content: '', changeNote: '' });
}
async function createNewPrompt() {
  saving.value = true;
  try {
    const { data } = await api.post<{ id: string }>('/ai/prompts', {
      ...createForm,
      skillId: createForm.scope === 'skill' ? createForm.skillId : null,
    });
    notify('Da tao Draft moi');
    creating.value = false;
    await loadList();
    await selectPrompt(data.id);
  } catch (error) {
    notify(errorText(error), false);
  } finally {
    saving.value = false;
  }
}
function startNewVersion() {
  versionForm.content = selectedVersion.value?.content || '';
  versionForm.changeNote = '';
  newVersionMode.value = true;
}
async function saveNewVersion() {
  if (!detail.value) return;
  saving.value = true;
  try {
    await api.post(`/ai/prompts/${detail.value.id}/versions`, versionForm);
    notify('Da tao Draft moi');
    newVersionMode.value = false;
    await loadList();
    await selectPrompt(detail.value.id);
  } catch (error) {
    notify(errorText(error), false);
  } finally {
    saving.value = false;
  }
}
async function transition(status: 'testing' | 'production') {
  if (!detail.value || !selectedVersion.value) return;
  if (status === 'production' && !confirm('Duyet version nay thanh Production? Version Production hien tai se duoc archive.')) return;
  try {
    await api.post(`/ai/prompts/${detail.value.id}/versions/${selectedVersion.value.id}/status`, { status });
    notify(status === 'production' ? 'Da duyet Production' : 'Da chuyen sang Testing');
    await loadList();
    await selectPrompt(detail.value.id);
  } catch (error) {
    notify(errorText(error), false);
  }
}
async function rollback() {
  if (!detail.value || !selectedVersion.value) return;
  if (!confirm(`Rollback ve noi dung v${selectedVersion.value.version}? He thong se tao mot Production version moi.`)) return;
  try {
    await api.post(`/ai/prompts/${detail.value.id}/rollback`, { versionId: selectedVersion.value.id });
    notify('Rollback thanh cong');
    await loadList();
    await selectPrompt(detail.value.id);
  } catch (error) {
    notify(errorText(error), false);
  }
}
async function preview() {
  if (!detail.value || !selectedVersion.value) return;
  try {
    const { data } = await api.post<{ rendered: string }>(
      `/ai/prompts/${detail.value.id}/versions/${selectedVersion.value.id}/preview`,
      { variables: parseVariables() },
    );
    previewText.value = data.rendered;
  } catch (error) {
    notify(errorText(error), false);
  }
}
async function testPrompt() {
  if (!detail.value || !selectedVersion.value) return;
  testing.value = true;
  try {
    const { data } = await api.post<{ output: string; provider: string; model: string }>(
      `/ai/prompts/${detail.value.id}/versions/${selectedVersion.value.id}/test`,
      { variables: parseVariables(), ...testForm },
    );
    testOutput.value = `[${data.provider}/${data.model}]\n${data.output}`;
  } catch (error) {
    notify(errorText(error), false);
  } finally {
    testing.value = false;
  }
}
async function removePrompt() {
  if (!detail.value || !confirm('Xóa mềm lời nhắc này? Phiên bản đang áp dụng sẽ được lưu trữ.')) return;
  try {
    await api.delete(`/ai/prompts/${detail.value.id}`);
    notify('Đã xóa lời nhắc');
    detail.value = null;
    selectedId.value = '';
    await loadList();
  } catch (error) {
    notify(errorText(error), false);
  }
}

onMounted(async () => {
  await Promise.all([loadList(), loadReferences()]);
  if (prompts.value[0]) await selectPrompt(prompts.value[0].id);
});
</script>

<style scoped>
.pm { margin-bottom: 24px; border: 1px solid #dbe4f0; border-radius: 12px; background: #f8fafc; overflow: hidden; }
.pm-head { display:flex; justify-content:space-between; gap:16px; align-items:center; padding:16px 18px; background:#fff; border-bottom:1px solid #dbe4f0; }
.pm-head h2 { margin:0 0 4px; font-size:17px; color:#172033; }
.pm-head p { margin:0; color:#64748b; font-size:12px; }
.pm-grid { display:grid; grid-template-columns:260px minmax(0,1fr); min-height:560px; }
.prompt-list { border-right:1px solid #dbe4f0; background:#fff; padding:10px; }
.filters { display:flex; gap:4px; margin-bottom:10px; }
.filters button { flex:1; border:0; background:#f1f5f9; padding:6px; border-radius:6px; font-size:11px; cursor:pointer; }
.filters button.active { background:#dbeafe; color:#1d4ed8; font-weight:700; }
.prompt-item { display:flex; flex-direction:column; width:100%; text-align:left; border:1px solid transparent; background:transparent; padding:10px; border-radius:8px; cursor:pointer; margin-bottom:5px; }
.prompt-item:hover,.prompt-item.selected { background:#eff6ff; border-color:#bfdbfe; }
.prompt-name { font-weight:650; color:#1e293b; }
.prompt-key { font:11px monospace; color:#64748b; margin:2px 0 6px; }
.prompt-meta { display:flex; justify-content:space-between; gap:6px; font-size:10px; }
.scope { color:#475569; }.production{color:#047857}.no-production{color:#b45309}
.prompt-detail { padding:16px; min-width:0; }
.detail-head,.version-toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; }
.detail-head h3 { margin:0; font-size:18px; }.detail-sub{font:11px monospace;color:#64748b;margin-top:4px}
.version-tabs { display:flex; gap:6px; flex-wrap:wrap; margin:16px 0; padding-bottom:10px; border-bottom:1px solid #e2e8f0; }
.version-tabs button { border:1px solid #cbd5e1; background:#fff; border-radius:7px; padding:6px 8px; cursor:pointer; }
.version-tabs button.active { border-color:#3b82f6; box-shadow:0 0 0 2px #dbeafe; }
.status { margin-left:4px; font-size:9px; padding:2px 4px; border-radius:4px; }
.status.draft{background:#f1f5f9}.status.testing{background:#fef3c7;color:#92400e}.status.production{background:#d1fae5;color:#065f46}.status.archived{background:#e5e7eb;color:#6b7280}
.history { display:block; font-size:11px; color:#64748b; margin-top:3px; }
.change-note{font-size:12px;color:#475569;background:#f8fafc;padding:8px;border-left:3px solid #94a3b8}
.variable-row{display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:11px;margin:10px 0}.variable-row code{background:#ede9fe;color:#6d28d9;padding:2px 5px;border-radius:4px}
textarea,input,select { width:100%; box-sizing:border-box; border:1px solid #cbd5e1; border-radius:7px; padding:8px; font:12px inherit; background:#fff; }
textarea { font-family:Consolas,monospace; resize:vertical; }.content-readonly{background:#f8fafc;color:#334155}
label { display:flex; flex-direction:column; gap:5px; font-size:11px; font-weight:600; color:#475569; margin-bottom:10px; }
.form-row.two,.test-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.editor-card,.test-card{background:#fff;border:1px solid #dbe4f0;border-radius:9px;padding:14px}.editor-card h3,.editor-card h4,.test-card h4{margin:0 0 12px}
.actions{display:flex;justify-content:flex-end;gap:7px}.actions.compact button{padding:6px 9px;font-size:11px}
button.primary,.ghost,.danger,.testing-btn,.production-btn{border-radius:7px;padding:7px 12px;cursor:pointer;font-weight:600}
.primary{border:0;background:#2563eb;color:#fff}.ghost{border:1px solid #cbd5e1;background:#fff;color:#475569}.danger{border:1px solid #fecaca;background:#fff;color:#b91c1c}
.testing-btn{border:1px solid #f59e0b;background:#fffbeb;color:#92400e}.production-btn{border:1px solid #10b981;background:#ecfdf5;color:#065f46}
.test-grid{margin-top:14px}.result{white-space:pre-wrap;max-height:240px;overflow:auto;background:#111827;color:#d1fae5;padding:10px;border-radius:7px;font-size:11px}
.empty{padding:18px;text-align:center;color:#94a3b8;font-size:12px}.detail-empty{margin-top:180px}
.notice{margin:10px 16px 0;padding:8px 10px;border-radius:7px;background:#dcfce7;color:#166534;font-size:12px}.notice.error{background:#fee2e2;color:#991b1b}
@media (max-width:900px){.pm-grid{grid-template-columns:1fr}.prompt-list{border-right:0;border-bottom:1px solid #dbe4f0;max-height:260px;overflow:auto}.form-row.two,.test-grid{grid-template-columns:1fr}}
</style>

