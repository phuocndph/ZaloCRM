<template>
  <div class="agents-page">
    <header class="agents-heading">
      <h1><Bot :size="22" /> Kết nối Agent</h1>
      <div class="actions"><v-btn icon variant="text" aria-label="Tải lại" :disabled="loading || saving" @click="load"><RefreshCw :size="18" /></v-btn><v-btn color="primary" :disabled="loading || saving || !!error" @click="edit()"><Plus :size="16" class="mr-2" /> Thêm Agent</v-btn></div>
    </header>
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <div v-else-if="!settings.agents.length && !error" class="empty">Chưa có kết nối Agent.</div>
    <section class="agent-list" aria-label="Các kết nối Agent">
      <article v-for="agent in settings.agents" :key="agent.id" class="agent-row">
        <div class="agent-info"><strong>{{ agent.name }}</strong><span class="state" :class="{ live: active(agent) }">{{ status(agent) }}</span><p>{{ userName(agent.userId) }} · {{ agent.accountIds.length }} nick · {{ agent.permissions.length }} quyền</p><small>Hết hạn: {{ date(agent.expiresAt) }} · {{ agent.maxSendsPerDay }} tin/ngày</small></div>
        <div class="actions">
          <v-switch :model-value="agent.enabled && !agent.revokedAt" :disabled="!!agent.revokedAt || saving" density="compact" hide-details color="primary" :aria-label="'Bật kết nối ' + agent.name" @update:model-value="toggle(agent, !!$event)" />
          <v-btn icon variant="text" :disabled="!!agent.revokedAt || saving" :aria-label="'Cài đặt ' + agent.name" title="Cài đặt quyền" @click="edit(agent)"><Settings2 :size="18" /></v-btn>
          <v-btn icon variant="text" :disabled="!!agent.revokedAt || saving" aria-label="Đổi khóa" title="Đổi khóa" @click="keyAction = { type: 'rotate', agent }"><KeyRound :size="18" /></v-btn>
          <v-btn icon variant="text" :disabled="!!agent.revokedAt || saving" aria-label="Thu hồi kết nối" title="Thu hồi kết nối" @click="keyAction = { type: 'revoke', agent }"><ShieldOff :size="18" /></v-btn>
        </div>
      </article>
    </section>
    <section v-if="settings.audit.length" class="audit-section">
      <h2>Hoạt động gần đây</h2>
      <div v-for="entry in settings.audit" :key="entry.id" class="audit-row"><span>{{ agentName(entry.targetId) }}</span><span>{{ entry.metadata.tool || (entry.eventType === 'agent.settings' ? 'Cập nhật quyền' : 'Xử lý thao tác') }}</span><span>{{ outcome(entry.outcome) }}</span><time>{{ date(entry.createdAt) }}</time></div>
    </section>

    <v-dialog v-model="editor" max-width="780" scrollable :persistent="saving">
      <v-card>
        <v-card-title class="dialog-title">{{ original ? 'Cài đặt Agent' : 'Thêm Agent' }}<v-btn icon variant="text" aria-label="Đóng" :disabled="saving" @click="editor = false"><X :size="18" /></v-btn></v-card-title>
        <v-card-text>
          <v-alert v-if="formError" type="error" variant="tonal" class="mb-4">{{ formError }}</v-alert>
          <div class="form-grid"><v-text-field v-model="form.name" label="Tên kết nối" maxlength="80" /><v-select v-model="form.userId" :items="settings.users" item-title="fullName" item-value="id" label="Quyền CRM theo nhân viên" /></div>
          <v-select v-model="form.accountIds" :items="accountOptions" item-title="label" item-value="id" label="Nick Zalo được phép thao tác" multiple chips closable-chips />
          <div class="permission-grid">
            <section v-for="group in permissionGroups" :key="group"><h2>{{ group }}</h2><v-switch v-for="permission in AGENT_PERMISSION_OPTIONS.filter(p => p.group === group)" :key="permission.key" v-model="form.permissions" :value="permission.key" :label="permission.label" :data-permission="permission.key" density="compact" hide-details color="primary" /></section>
          </div>
          <div class="form-grid limits"><v-text-field v-model.number="form.maxWritesPerDay" type="number" label="Thao tác ghi/ngày (UTC)" min="1" max="1000" /><v-text-field v-model.number="form.maxSendsPerDay" type="number" label="Tin gửi trực tiếp/ngày (UTC)" min="0" max="200" /><v-text-field v-model="expiryDate" type="date" label="Ngày hết hạn" /><v-switch v-model="form.enabled" label="Bật kết nối" color="primary" hide-details /></div>
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn :disabled="saving" @click="editor = false">Hủy</v-btn><v-btn color="primary" variant="flat" :loading="saving" @click="requestSave">Lưu</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="confirming" max-width="520" persistent>
      <v-card><v-card-title>Cấp quyền tự động cho Agent</v-card-title><v-card-text>Agent có thể cập nhật công việc và gửi tin nếu được cấp quyền. Hoàn thành bước Follow-up có thể kích hoạt bước tiếp theo; lịch hẹn áp dụng quy tắc nhắc hẹn hiện tại.<p class="mt-3">{{ form.accountIds.length }} nick · tối đa {{ form.maxSendsPerDay }} tin gửi trực tiếp/ngày.</p></v-card-text><v-card-actions><v-spacer /><v-btn :disabled="saving" @click="confirming = false">Hủy</v-btn><v-btn color="warning" :loading="saving" @click="save(true)">Xác nhận cấp quyền</v-btn></v-card-actions></v-card>
    </v-dialog>
    <v-dialog :model-value="!!keyAction" max-width="460" persistent>
      <v-card><v-card-title>{{ keyAction?.type === 'rotate' ? 'Đổi khóa truy cập' : 'Thu hồi kết nối' }}</v-card-title><v-card-text>{{ keyAction?.agent.name }}: khóa hiện tại sẽ ngừng hoạt động.</v-card-text><v-card-actions><v-spacer /><v-btn :disabled="saving" @click="keyAction = null">Hủy</v-btn><v-btn color="error" :loading="saving" @click="applyKeyAction">Xác nhận</v-btn></v-card-actions></v-card>
    </v-dialog>
    <v-dialog :model-value="!!secret" max-width="700" persistent>
      <v-card><v-card-title>Khóa truy cập (chỉ hiển thị một lần)</v-card-title><v-card-text><v-text-field :model-value="secret" readonly :type="showSecret ? 'text' : 'password'" label="Agent API Key"><template #append-inner><v-btn icon variant="text" aria-label="Hiện hoặc ẩn khóa" @click="showSecret = !showSecret"><Eye :size="18" /></v-btn><v-btn icon variant="text" aria-label="Sao chép khóa" @click="copySecret"><Copy :size="18" /></v-btn></template></v-text-field><v-text-field :model-value="endpoint" label="Agent API" readonly /></v-card-text><v-card-actions><v-spacer /><v-btn color="primary" @click="secret = ''; showSecret = false">Đóng</v-btn></v-card-actions></v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Bot, Copy, Eye, KeyRound, Plus, RefreshCw, Settings2, ShieldOff, X } from 'lucide-vue-next';
import { AGENT_PERMISSION_OPTIONS, agentsApi, newAgentForm, needsAgentConfirmation, type AgentConnection, type AgentSettings } from '@/api/agents';
import { useToast } from '@/composables/use-toast';
const toast = useToast();
const settings = ref<AgentSettings>({ agents: [], users: [], accounts: [], audit: [] });
const loading = ref(false), saving = ref(false), error = ref(''), formError = ref('');
const editor = ref(false), confirming = ref(false), secret = ref(''), showSecret = ref(false);
const original = ref<AgentConnection>();
const form = ref(newAgentForm());
const expiryDate = ref('');
const keyAction = ref<{ type: 'rotate' | 'revoke'; agent: AgentConnection } | null>(null);
const endpoint = `${window.location.origin}/api/agent/v1`;
const permissionGroups = [...new Set(AGENT_PERMISSION_OPTIONS.map(p => p.group))];
const accountOptions = computed(() => settings.value.accounts.map(a => ({ ...a, label: `${a.displayName || 'Nick Zalo'}${a.status === 'connected' ? '' : ' (mất kết nối)'}` })));
const date = (value: string) => new Date(value).toLocaleString('vi-VN');
const active = (agent: AgentConnection) => agent.enabled && !agent.revokedAt && Date.parse(agent.expiresAt) > Date.now();
const status = (agent: AgentConnection) => agent.revokedAt ? 'Đã thu hồi' : Date.parse(agent.expiresAt) <= Date.now() ? 'Hết hạn' : agent.enabled ? 'Đang bật' : 'Đang tắt';
const userName = (id: string) => settings.value.users.find(u => u.id === id)?.fullName || 'Nhân viên không còn hoạt động';
const agentName = (id: string | null) => settings.value.agents.find(a => a.id === id)?.name || 'Agent';
const outcome = (value: string) => ({ success: 'Thành công', failed: 'Thất bại', started: 'Đã tiếp nhận' }[value] || value);
async function load() {
  loading.value = true; error.value = '';
  try { settings.value = await agentsApi.load(); }
  catch { settings.value = { agents: [], users: [], accounts: [], audit: [] }; error.value = 'Không tải được kết nối Agent. Cần quyền quản trị và backend đã cập nhật.'; }
  finally { loading.value = false; }
}
function edit(agent?: AgentConnection) {
  original.value = agent ? { ...agent, accountIds: [...agent.accountIds], permissions: [...agent.permissions] } : undefined;
  form.value = agent ? { ...agent, accountIds: [...agent.accountIds], permissions: [...agent.permissions] } : newAgentForm();
  expiryDate.value = form.value.expiresAt.slice(0, 10);
  formError.value = ''; editor.value = true;
}
function requestSave() {
  formError.value = '';
  if (!form.value.name.trim() || !form.value.userId || (form.value.enabled && !form.value.accountIds.length)) { formError.value = 'Chọn nhân viên, nick Zalo và tên kết nối.'; return; }
  const expiry = new Date(`${expiryDate.value}T23:59:59.000Z`);
  if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now() || expiry.getTime() > Date.now() + 366 * 86400000) { formError.value = 'Ngày hết hạn phải ở tương lai, tối đa một năm.'; return; }
  if (!Number.isInteger(form.value.maxWritesPerDay) || form.value.maxWritesPerDay < 1 || form.value.maxWritesPerDay > 1000 || !Number.isInteger(form.value.maxSendsPerDay) || form.value.maxSendsPerDay < 0 || form.value.maxSendsPerDay > 200) { formError.value = 'Giới hạn ghi: 1–1000; giới hạn gửi: 0–200 mỗi ngày.'; return; }
  form.value.expiresAt = expiry.toISOString();
  if (needsAgentConfirmation(form.value, original.value)) confirming.value = true;
  else void save(false);
}
async function save(confirmed: boolean) {
  if (saving.value) return;
  saving.value = true;
  try { const result = await agentsApi.save(form.value, original.value?.id, confirmed); secret.value = result.token ?? ''; editor.value = false; confirming.value = false; await load(); toast.success('Đã lưu quyền Agent'); }
  catch { confirming.value = false; formError.value = 'Không lưu được cấu hình. Kiểm tra nhân viên, nick, ngày hết hạn và quyền quản trị.'; }
  finally { saving.value = false; }
}
async function toggle(agent: AgentConnection, enabled: boolean) {
  edit(agent); form.value.enabled = enabled;
  if (enabled) { requestSave(); return; }
  await save(false);
}
async function applyKeyAction() {
  if (!keyAction.value || saving.value) return;
  const { type, agent } = keyAction.value; saving.value = true;
  try { if (type === 'rotate') secret.value = (await agentsApi.rotate(agent.id)).token; else await agentsApi.revoke(agent.id); keyAction.value = null; await load(); toast.success(type === 'rotate' ? 'Đã đổi khóa' : 'Đã thu hồi kết nối'); }
  catch { keyAction.value = null; toast.error('Thao tác thất bại'); }
  finally { saving.value = false; }
}
async function copySecret() { try { await navigator.clipboard.writeText(secret.value); toast.success('Đã sao chép khóa'); } catch { toast.error('Không sao chép được khóa'); } }
onMounted(load);
</script>

<style scoped>
.agents-page { max-width: 1040px; padding-bottom: 24px; }
.agents-heading,.dialog-title { display:flex;align-items:center;justify-content:space-between;gap:12px; }
.agents-heading { margin-bottom:20px;flex-wrap:wrap; }
h1 { font-size:21px;display:flex;align-items:center;gap:10px; }
h2 { font-size:15px;margin:0 0 10px; }
.actions { display:flex;align-items:center;gap:4px;flex-shrink:0; }
.agent-row { display:flex;justify-content:space-between;align-items:center;gap:18px;padding:18px 0;border-bottom:1px solid rgba(128,128,128,.22); }
.agent-info { min-width:0;overflow-wrap:anywhere; }
.agent-info p { font-size:13px;margin:6px 0; }
.agent-info small { opacity:.7; }
.state { display:inline-block;font-size:12px;margin-left:12px;color:#676b73; }
.state.live { color:#18815d; }
.empty { padding:36px 0;color:#676b73; }
.form-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px; }
.permission-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 18px;margin:10px 0 24px; }
.permission-grid section { min-width:0; }
.permission-grid :deep(.v-label) { white-space:normal;font-size:13px;line-height:1.4; }
.audit-section { margin-top:30px; }
.audit-row { display:grid;grid-template-columns:1fr 1.5fr .8fr 1.2fr;gap:12px;border-bottom:1px solid rgba(128,128,128,.15);padding:10px 0;font-size:12px;overflow-wrap:anywhere; }
@media(max-width:600px) { .agent-row { flex-direction:column;align-items:stretch;gap:8px; }.agent-row .actions { justify-content:flex-end; }.form-grid,.permission-grid { grid-template-columns:minmax(0,1fr); }.audit-row { grid-template-columns:1fr 1fr; } }
</style>
