<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="jf-ui jf-connection-page">
    <header><h1>CRM Joliefam</h1><p class="jf-muted">Kết nối đơn hàng và thông tin mua hàng.</p></header>
    <p v-if="error" class="jf-error" role="alert">{{ error }}</p>
    <p v-if="message" class="jf-success" role="status">{{ message }}</p>
    <p v-if="loading" class="jf-muted">Đang tải kết nối…</p>
    <button v-if="!settings && !loading" @click="load">Thử lại</button>
    <template v-if="settings">
      <section class="jf-connection-status">
        <div><strong>{{ stateLabel }}</strong><p class="jf-muted">{{ stateDescription }}</p></div>
        <div v-if="canEdit && !setupOpen" class="jf-actions">
          <button v-if="!settings.hasToken" class="jf-primary" @click="setupOpen = true">Thiết lập kết nối</button>
          <button v-else-if="!settings.enabled && settings.testedAt" class="jf-primary" :disabled="busy || connectionDirty" @click="setEnabled(true)">Bật kết nối</button>
          <button v-else-if="!settings.enabled" class="jf-primary" :disabled="busy || connectionDirty" @click="test">Kiểm tra kết nối</button>
          <button v-else class="jf-primary" :disabled="busy || connectionDirty" @click="test">Kiểm tra kết nối</button>
          <button v-if="settings.hasToken" :disabled="busy" @click="setupOpen = !setupOpen">{{ setupOpen ? 'Đóng thiết lập' : 'Chỉnh sửa' }}</button>
          <button v-if="settings.enabled" :disabled="busy" @click="setEnabled(false)">Tắt kết nối</button>
        </div>
      </section>
      <p v-if="settings.lastError" class="jf-notice">Một số thông tin chưa cập nhật được. Kiểm tra lại kết nối.</p>
      <form v-if="setupOpen" class="jf-section" @submit.prevent="saveAndTest">
        <h3>Thiết lập kết nối</h3>
        <p class="jf-muted">Nhập hai khóa do người quản lý CRM cung cấp.</p>
        <fieldset :disabled="busy || !canEdit">
          <label>Khóa kết nối<input v-model="token" type="password" autocomplete="new-password" :placeholder="settings.hasToken ? 'Đã lưu — để trống để giữ nguyên' : 'Nhập khóa kết nối'"></label>
          <label>Khóa nhận cập nhật<input v-model="webhookSecret" type="password" autocomplete="new-password" :placeholder="settings.hasWebhookSecret ? 'Đã lưu — để trống để giữ nguyên' : 'Nhập khóa nhận cập nhật'"></label>
          <p v-if="!settings.encryptionReady" class="jf-notice">Máy chủ chưa sẵn sàng lưu khóa. Liên hệ người quản lý hệ thống.</p>
          <div class="jf-actions"><button type="submit" class="jf-primary" :disabled="!settings.encryptionReady">{{ busy ? 'Đang kiểm tra…' : 'Lưu và kiểm tra' }}</button><button type="button" @click="cancelSetup">Hủy</button></div>
        </fieldset>
      </form>
      <details class="jf-section">
        <summary>Nhân viên được lên đơn <span class="jf-muted">({{ mappings.length }})</span></summary>
        <p class="jf-muted">Chọn nhân viên ZCRM và nhập mã tài khoản của họ bên CRM.</p>
        <p v-if="usersError" class="jf-error" role="alert">{{ usersError }} <button @click="loadUsers">Thử lại</button></p>
        <fieldset :disabled="busy || !canEdit">
          <div v-for="(row, index) in mappings" :key="index" class="jf-employee-row">
            <label>Nhân viên ZCRM<select v-model="row.zcrm"><option value="">Chọn nhân viên</option><option v-if="row.zcrm && !users.some(u => u.id === row.zcrm)" :value="row.zcrm">Nhân viên đã ghép (chưa tải được tên)</option><option v-for="u in users" :key="u.id" :value="u.id">{{ u.fullName }}{{ !u.isActive ? ' (ngừng hoạt động)' : '' }}</option></select></label>
            <label>Mã nhân viên bên CRM<input v-model="row.crm" placeholder="Mã do CRM cung cấp"></label>
            <button type="button" :aria-label="`Bỏ nhân viên ${index + 1}`" @click="mappings.splice(index, 1)">Bỏ</button>
          </div>
          <p v-if="!mappings.length" class="jf-muted">Chưa ghép nhân viên. Vẫn có thể xem đơn khi kết nối được bật.</p>
          <div class="jf-actions"><button type="button" @click="mappings.push({ zcrm: '', crm: '' })">Thêm nhân viên</button><button type="button" class="jf-primary" :disabled="!settings.hasToken || connectionDirty" @click="saveMappings">Lưu nhân viên</button></div>
        </fieldset>
      </details>
      <details class="jf-section">
        <summary>Thông tin kỹ thuật</summary>
        <p>Địa chỉ CRM: <a href="https://crm.joliefam.vn" target="_blank" rel="noopener noreferrer">crm.joliefam.vn</a></p>
        <label>Đường dẫn API<input v-model="basePath" :readonly="!setupOpen || !canEdit" maxlength="110"></label>
        <p class="jf-muted">Đường dẫn mặc định đã có sẵn. Chỉ sửa trong lúc thiết lập khi phía CRM yêu cầu.</p>
        <label>Địa chỉ nhận cập nhật<code>{{ webhookUrl }}</code></label>
        <button type="button" @click="copyWebhook">Sao chép địa chỉ</button>
        <p class="jf-muted">Kiểm tra gần nhất: {{ dateTime(settings.testedAt) }}<br>Đối chiếu gần nhất: {{ dateTime(settings.lastSyncAt) }}</p>
        <p v-if="!settings.encryptionReady" class="jf-muted">Thiếu TOKEN_ENCRYPTION_KEY trên máy chủ.</p>
        <p v-if="settings.lastError" class="jf-error">{{ settings.lastError }}</p>
      </details>
    </template>
  </section>
</template>
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { commerceApi, purchaseError, dateTime, type Settings } from '@/api/commerce';
import '@/components/commerce/commerce.css';
const auth = useAuthStore();
const settings = ref<Settings | null>(null), loading = ref(false), busy = ref(false), error = ref(''), message = ref(''), setupOpen = ref(false);
const basePath = ref('/api/zcrm/v1'), token = ref(''), webhookSecret = ref('');
const mappings = ref<Array<{ zcrm: string; crm: string }>>([]), users = ref<Array<{ id: string; fullName: string; isActive: boolean }>>([]), usersError = ref('');
const canEdit = computed(() => auth.canAccess('commerce_connection', 'edit'));
const connectionDirty = computed(() => !!token.value || !!webhookSecret.value || basePath.value !== settings.value?.basePath);
const webhookUrl = computed(() => settings.value ? location.origin + settings.value.webhookPath : '');
const stateLabel = computed(() => !settings.value?.hasToken ? 'Chưa kết nối' : settings.value.enabled ? 'Đang bật kết nối' : 'Kết nối đang tắt');
const stateDescription = computed(() => !settings.value?.hasToken ? 'Thiết lập một lần để xem đơn từ CRM.' : settings.value.enabled ? 'ZCRM sẽ lấy thông tin và gửi đơn nháp qua CRM.' : settings.value.testedAt ? 'Đã kiểm tra thành công. Có thể bật kết nối.' : 'Kiểm tra cấu hình trước khi bật kết nối.');
function receive(s: Settings) { settings.value = s; basePath.value = s.basePath; mappings.value = Object.entries(s.actorMap).map(([zcrm, crm]) => ({ zcrm, crm })); token.value = ''; webhookSecret.value = ''; }
function actorMap() { const ids = mappings.value.map(m => m.zcrm); if (new Set(ids).size !== ids.length || mappings.value.some(m => !m.zcrm || !m.crm.trim())) throw new Error('Chọn đủ nhân viên và mã CRM, không chọn trùng nhân viên.'); return Object.fromEntries(mappings.value.map(m => [m.zcrm, m.crm.trim()])); }
async function operation(fn: () => Promise<void>) { busy.value = true; error.value = ''; message.value = ''; try { await fn(); } catch (e: any) { error.value = e?.response ? purchaseError(e) : e?.message || 'Chưa hoàn thành. Vui lòng thử lại.'; } finally { busy.value = false; } }
async function saveAndTest() { await operation(async () => { const body = { enabled: false, basePath: basePath.value, token: token.value, webhookSecret: webhookSecret.value, actorMap: actorMap() }; receive(await commerceApi.saveSettings(body)); await commerceApi.test(); receive(await commerceApi.settings()); setupOpen.value = false; message.value = 'Kiểm tra thành công. Bấm Bật kết nối để sử dụng.'; }); }
async function test() { await operation(async () => { try { await commerceApi.test(); message.value = 'Kiểm tra kết nối thành công.'; } finally { receive(await commerceApi.settings()); } }); }
async function setEnabled(enabled: boolean) { await operation(async () => { receive(await commerceApi.saveSettings({ enabled, basePath: settings.value!.basePath, actorMap: settings.value!.actorMap })); message.value = enabled ? 'Đã bật kết nối.' : 'Đã tắt kết nối.'; }); }
async function saveMappings() { await operation(async () => { receive(await commerceApi.saveSettings({ enabled: settings.value!.enabled, basePath: settings.value!.basePath, actorMap: actorMap() })); message.value = 'Đã lưu nhân viên.'; }); }
function cancelSetup() { if (settings.value) { token.value = ''; webhookSecret.value = ''; basePath.value = settings.value.basePath; } setupOpen.value = false; }
async function copyWebhook() { try { await navigator.clipboard.writeText(webhookUrl.value); message.value = 'Đã sao chép địa chỉ nhận cập nhật.'; } catch { error.value = 'Chưa sao chép được. Anh có thể chọn địa chỉ trong Thông tin kỹ thuật.'; } }
async function loadUsers() { usersError.value = ''; try { const { data } = await api.get('/users'); users.value = data.users; } catch { usersError.value = 'Chưa tải được tên nhân viên.'; } }
async function load() { loading.value = true; error.value = ''; try { receive(await commerceApi.settings()); } catch (e) { error.value = purchaseError(e); } finally { loading.value = false; } }
onMounted(() => { void load(); void loadUsers(); });
</script>
<style scoped>
.jf-connection-page { max-width: 800px; margin: 0 auto; padding: 8px 0 24px; }
.jf-connection-page > header { margin-bottom: 24px; }
.jf-connection-status { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; padding: 20px; border: 1px solid var(--line); background: var(--surface); border-radius: 7px; margin-bottom: 20px; }
.jf-connection-status strong { font-size: 16px; }.jf-connection-status p { margin: 4px 0 0; }
.jf-employee-row { display: flex; gap: 12px; align-items: flex-end; margin-bottom: 14px; }.jf-employee-row label { flex: 1; min-width: 0; margin: 0; }
.jf-connection-page code { display: block; padding: 10px; margin-top: 6px; font-size: 12px; background: var(--surface-2); overflow-wrap: anywhere; font-weight: 400; }
@media(max-width:600px) { .jf-employee-row { flex-wrap: wrap; }.jf-employee-row label { flex-basis: 100%; } }
</style>
