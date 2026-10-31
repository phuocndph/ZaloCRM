<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="jf-ui jf-draft-editor">
    <div class="jf-row jf-between"><span>{{ draft.crmOrderCode || 'Đơn nháp mới' }} · {{ statusLabel }}</span><span class="jf-muted" role="status">{{ saving ? 'Đang lưu…' : dirty ? 'Chưa lưu thay đổi' : `Đã lưu ${dateTime(draft.updatedAt)}` }}</span></div>
    <p v-if="error" role="alert" class="jf-error">{{ error }}</p><p v-if="message" role="status" class="jf-success">{{ message }}</p><p v-if="draft.lastError" class="jf-notice">{{ draft.lastError }}</p>
    <div v-if="!editable" class="jf-section"><p>Đơn đang khóa sửa. {{ draft.approver ? `Người duyệt: ${draft.approver}` : '' }}</p><div class="jf-actions"><button :disabled="busy" @click="check">Kiểm tra kết quả trong CRM</button><button v-if="draft.status === 'uncertain' && auth.canAccess('commerce_draft', 'approve')" :disabled="busy" @click="retry">Kiểm tra và gửi lại cùng yêu cầu</button></div></div>
    <fieldset :disabled="!editable || busy">
      <section class="jf-section"><h3>1. Khách và giao hàng</h3>
        <label v-if="links.length > 1 || !form.customerId">Khách CRM<select v-model="form.customerId" @change="changeCustomer"><option :value="null">Chưa liên kết — có thể lưu nháp</option><option v-for="l in links" :key="l.id" :value="l.customerId">{{ l.customerName }}</option></select></label><p v-else><b>{{ links.find(l => l.customerId === form.customerId)?.customerName || currentCustomer?.name || 'Khách đã liên kết' }}</b></p>
        <p v-if="validation.customer" class="jf-error">{{ validation.customer }}</p>
        <div class="jf-grid"><label>Người đặt<input v-model="form.orderedBy" list="jf-crm-order-contacts" maxlength="200" :aria-invalid="!!validation.orderedBy"><small v-if="validation.orderedBy" class="jf-field-error">{{ validation.orderedBy }}</small><datalist id="jf-crm-order-contacts"><option v-for="c in currentCustomer?.contacts" :key="c.id" :value="c.name" /></datalist></label><label v-if="currentCustomer?.addresses.length">Địa chỉ có sẵn<select :value="addressSelection" @change="pickAddress(($event.target as HTMLSelectElement).value)"><option value="">Nhập địa chỉ khác</option><option v-for="(a, i) in currentCustomer.addresses" :key="i" :value="i">{{ a.name }} · {{ a.address }}</option></select></label></div>
        <div class="jf-grid"><label>Người nhận<input v-model="form.recipient.name" maxlength="200" :aria-invalid="!!validation.name"><small v-if="validation.name" class="jf-field-error">{{ validation.name }}</small></label><label>Điện thoại<input v-model="form.recipient.phone" maxlength="40" inputmode="tel" :aria-invalid="!!validation.phone"><small v-if="validation.phone" class="jf-field-error">{{ validation.phone }}</small></label></div>
        <label>Địa chỉ giao hàng<textarea v-model="form.recipient.address" maxlength="2000" rows="2" :aria-invalid="!!validation.address" /><small v-if="validation.address" class="jf-field-error">{{ validation.address }}</small></label>
        <label class="jf-date-field">Ngày khách mong muốn <span class="jf-muted">(không bắt buộc)</span><input v-model="form.desiredDate" type="date"></label>
      </section>
      <section class="jf-section"><h3>2. Sản phẩm</h3>
        <form v-if="editable" class="jf-search" @submit.prevent="searchProducts()"><input v-model="query" aria-label="Tìm sản phẩm" placeholder="Tên hoặc mã sản phẩm"><button :disabled="searching">{{ searching ? 'Đang tìm…' : 'Tìm sản phẩm' }}</button></form>
        <p v-if="productError" role="alert" class="jf-error">{{ productError }}</p><p v-if="searched && !results.length" class="jf-muted">Chưa tìm thấy sản phẩm.</p>
        <div class="jf-product-results"><button v-for="p in results" :key="p.id + (p.warehouseId || '')" class="jf-product-option" @click="addProduct(p)"><span><b>{{ p.name }}</b> · {{ p.sku }} {{ p.variant }}</span><small>{{ p.kind === 'custom' ? 'Đặt riêng' : money(p.price) }} · Tồn: {{ p.available ?? 'Chưa rõ' }} {{ p.unit }}{{ p.warehouseName ? ' · '+p.warehouseName : '' }} · Cập nhật {{ dateTime(p.updatedAt) }}</small></button><button v-if="productCursor" @click="searchProducts(productCursor)">Tải thêm sản phẩm</button></div>
        <p v-if="validation.lines" class="jf-error">{{ validation.lines }}</p><p v-else-if="!form.lines.length" class="jf-empty">Chưa thêm sản phẩm.</p>
        <article v-for="(line, i) in form.lines" :key="i" class="jf-draft-line">
          <div class="jf-line-fields"><div class="jf-line-name"><b>{{ i + 1 }}. {{ line.name }}</b><small class="jf-muted">{{ line.variant }}{{ line.kind === 'custom' ? ' · Đặt riêng' : '' }}</small></div><label>Số lượng<input v-model.number="line.quantity" type="number" min="0.001" step="any" :aria-label="`Số lượng ${line.name}`"></label><div><span class="jf-muted">Đơn vị</span><p>{{ line.unit }}</p></div><label>{{ line.kind === 'custom' ? 'Giá đề xuất (đ)' : 'Giá tham khảo (đ)' }}<input v-model.number="line.proposedPrice" type="number" min="0" step="1" :readonly="line.kind === 'stock'"></label><button class="jf-link jf-danger" @click="form.lines.splice(i, 1)">Bỏ</button></div>
          <p v-if="validation['line'+i]" class="jf-error">{{ validation['line'+i] }}</p>
          <template v-if="line.kind === 'custom'">
            <button class="jf-link" :aria-expanded="!!expandedSpecs[i]" @click="expandedSpecs[i] = !expandedSpecs[i]">{{ expandedSpecs[i] ? 'Thu gọn quy cách' : 'Quy cách' }}</button>
            <div v-if="expandedSpecs[i] || visibleSpecs(line).length" class="jf-grid jf-specs"><label v-for="field in visibleSpecs(line)" :key="field">{{ specLabel(field) }}<textarea v-model="line.specifications[field]" maxlength="2000" rows="2" /></label></div>
            <template v-if="!expandedSpecs[i]"><p v-for="field in optionalSpecs(line).filter(key => line.specifications[key])" :key="field" class="jf-muted">{{ specLabel(field) }}: {{ line.specifications[field] }}</p></template><div v-if="expandedSpecs[i]" class="jf-grid"><label v-for="field in optionalSpecs(line)" :key="field">{{ specLabel(field) }} <span class="jf-muted">(bổ sung)</span><textarea v-model="line.specifications[field]" maxlength="2000" rows="2" /></label></div>
          </template>
        </article>
        <details><summary>Thêm thông tin</summary><label>Ghi chú cho người duyệt<textarea v-model="form.notes" maxlength="5000" rows="3" /></label><div v-for="(line, i) in form.lines" :key="i"><b>{{ line.name }} — tài liệu đính kèm</b><label class="jf-muted">Ảnh, bản đo hoặc tài liệu · tối đa 15 MB/tệp<input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xlsx,.xls" :disabled="uploading || !auth.canAccess('media', 'create')" @change="uploadFiles($event, i)"></label><p v-if="!auth.canAccess('media', 'create')" class="jf-muted">Cần quyền tải tài liệu để đính kèm.</p><p v-for="(file, fi) in line.attachments" :key="file.mediaId">{{ file.name }} <button class="jf-link" @click="line.attachments.splice(fi, 1)">Bỏ</button></p></div></details>
      </section>
    </fieldset>
    <section class="jf-section"><h3>3. Kiểm tra và gửi</h3><p class="jf-muted">Đơn được gửi sang CRM để chờ duyệt.</p>
      <template v-if="draft.quote && !dirty"><div v-for="(line, i) in draft.quote.lines" :key="i" class="jf-row jf-between"><span>{{ form.lines[i]?.name || line.productId }} · {{ line.quantity }} × {{ money(line.unitPrice) }}</span><b>{{ money(line.total) }}</b></div><dl class="jf-totals jf-quote-totals"><template v-for="(amount, label) in { 'Tiền hàng': draft.quote.subtotal, 'Giảm giá': draft.quote.discount, 'Phí giao hàng': draft.quote.shipping, 'Thuế': draft.quote.tax, 'Tổng tiền': draft.quote.total }" :key="label"><dt>{{ label }}</dt><dd>{{ money(amount) }}</dd></template></dl><p v-for="(w, i) in draft.quote.warnings" :key="i" class="jf-notice">{{ w }}</p><p class="jf-muted">Giá có hiệu lực đến {{ dateTime(draft.quote.expiresAt) }}</p><button v-if="editable" class="jf-link" :disabled="busy || saving || uploading" @click="quote">Kiểm tra lại giá</button><p v-if="!quoteReady" class="jf-notice">Bảng giá đã hết hạn. Kiểm tra lại trước khi gửi.</p><label v-if="editable && quoteReady" class="jf-check"><input v-model="confirmed" type="checkbox">Tôi đã kiểm tra thông tin và bảng tiền.</label></template>
      <p v-else class="jf-muted">Kiểm tra giá để nhận bảng tiền mới nhất từ CRM.</p>
    </section>
    <footer v-if="editable" class="jf-draft-footer"><button :disabled="busy || saving || uploading" @click="save()">Lưu nháp</button><button v-if="!quoteReady" class="jf-primary" :disabled="busy || saving || uploading" @click="quote">Kiểm tra giá</button><template v-else><button class="jf-primary" :disabled="busy || saving || uploading || !confirmed || !auth.canAccess('commerce_draft', 'approve')" @click="submit">Gửi chờ duyệt</button></template></footer>
  </section>
</template>
<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue';
import './commerce.css';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { commerceApi, purchaseError, money, dateTime, type Draft, type DraftInput, type DraftLine, type Link, type Customer, type Product } from '@/api/commerce';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const props = defineProps<{ contactId: string; initial: Draft; links: Link[]; customer?: Customer }>();
const emit = defineEmits<{ saved: [draft: Draft]; close: [] }>();
const originalContactId = props.contactId;
const loadedCustomer = ref<Customer | null>(null);
let customerRequest = 0;
const initialSpecKeys = Object.fromEntries(props.initial.input.lines.map(line => [line.productId, Object.keys(line.specifications)]));
const requiredFields = ref<Record<string, string[]>>({}), expandedSpecs = ref<Record<number, boolean>>({});
const validation = ref<Record<string, string>>({});
const auth = useAuthStore(), draft = ref<Draft>(clone(props.initial));
const form = ref<DraftInput>(clone(props.initial.input));
const savedText = ref(JSON.stringify(form.value)), error = ref(''), message = ref(''), busy = ref(false), saving = ref(false), uploading = ref(false), confirmed = ref(false);
const dirty = computed(() => JSON.stringify(form.value) !== savedText.value);
const editable = computed(() => ['local', 'returned'].includes(draft.value.status) && auth.canAccess('commerce_draft', 'edit'));
const statusLabel = computed(() => ({ closed: 'Đã kết thúc trong CRM', local: 'Nháp tại ZCRM', returned: 'CRM yêu cầu bổ sung', submitted: 'Đã gửi CRM', submitting: 'Đang gửi', uncertain: 'Chưa xác nhận kết quả' }[draft.value.status]));
let timer: ReturnType<typeof setTimeout> | undefined, alive = true, searchVersion = 0;
const query = ref(''), results = ref<Product[]>([]), productCursor = ref<string | null>(null), productError = ref(''), searching = ref(false), searched = ref(false);
const specNames: Record<string, string> = { measurements: 'Số đo và đơn vị (ví dụ: rộng 250 cm × cao 270 cm)', material: 'Chất liệu', color: 'Màu', sewing: 'Kiểu may', accessories: 'Phụ kiện', installation: 'Yêu cầu lắp đặt' };
const requiredSpecs = (line: DraftLine) => requiredFields.value[line.productId] || initialSpecKeys[line.productId] || [];
const visibleSpecs = (line: DraftLine) => requiredSpecs(line);
const optionalSpecs = (line: DraftLine) => Object.keys(specNames).filter(k => !visibleSpecs(line).includes(k));
const now = ref(Date.now());
const quoteReady = computed(() => !!draft.value.quote && !dirty.value && Date.parse(draft.value.quote.expiresAt) > now.value);
let clock: ReturnType<typeof setInterval> | undefined;
const specLabel = (field: string) => specNames[field] || field;
watch(() => props.initial, latest => {
  if (busy.value || saving.value || dirty.value || latest.id !== draft.value.id) return;
  if (latest.revision !== draft.value.revision || latest.status !== draft.value.status || latest.updatedAt !== draft.value.updatedAt) {
    draft.value = clone(latest); form.value = clone(latest.input); savedText.value = JSON.stringify(form.value); confirmed.value = false;
  }
});
const currentCustomer = computed(() => props.customer?.id === form.value.customerId ? props.customer : loadedCustomer.value?.id === form.value.customerId ? loadedCustomer.value : undefined);
const addressSelection = computed(() => { const i = currentCustomer.value?.addresses.findIndex(a => a.name === form.value.recipient.name && a.phone === form.value.recipient.phone && a.address === form.value.recipient.address); return i !== undefined && i >= 0 ? String(i) : ''; });
watch(() => form.value.customerId, async id => {
  const request = ++customerRequest; loadedCustomer.value = null;
  if (!id || props.customer?.id === id || !props.links.some(l => l.customerId === id)) return;
  try { const result = await commerceApi.overview(originalContactId, id); if (alive && request === customerRequest) loadedCustomer.value = result.data.customer; }
  catch (e) { if (alive && request === customerRequest) error.value = purchaseError(e); }
}, { immediate: true });
function changeCustomer() { form.value.orderedBy = ''; form.value.recipient = { name: '', phone: '', address: '' }; }
function pickAddress(index: string) { const address = currentCustomer.value?.addresses[Number(index)]; form.value.recipient = index !== '' && address ? clone(address) : { name: '', phone: '', address: '' }; }
function receive(value: Draft, inputSaved?: string) { draft.value = value; if (inputSaved !== undefined) savedText.value = inputSaved; confirmed.value = false; if (alive) emit('saved', value); }
let saveInFlight: Promise<Draft | null> | null = null;
async function save(): Promise<Draft | null> {
  if (saveInFlight) { const result = await saveInFlight; return result && dirty.value ? save() : result; }
  if (!editable.value || !dirty.value) return draft.value;
  saving.value = true; error.value = ''; const snapshot = JSON.stringify(form.value), current = draft.value;
  saveInFlight = (async () => {
    try { const result = await commerceApi.save(originalContactId, { input: JSON.parse(snapshot), revision: current.revision }, current.id); receive(result, snapshot); message.value = 'Đã lưu nháp.'; return result; }
    catch (e) { error.value = purchaseError(e); return null; }
    finally { saving.value = false; saveInFlight = null; if (alive && dirty.value && !error.value) scheduleSave(); }
  })();
  return saveInFlight;
}
function scheduleSave() { clearTimeout(timer); timer = setTimeout(() => { if (!busy.value && !uploading.value) void save(); }, 1500); }
watch(form, () => { confirmed.value = false; message.value = ''; if (editable.value) scheduleSave(); }, { deep: true });
async function quote() { if (!validateForm()) return; const saved = await save(); if (!saved) return; busy.value = true; error.value = ''; try { receive(await commerceApi.quote(originalContactId, saved)); } catch (e) { error.value = purchaseError(e); } finally { busy.value = false; } }
async function submit() { if (!confirmed.value || !quoteReady.value) return; busy.value = true; error.value = ''; try { receive(await commerceApi.submit(originalContactId, draft.value)); message.value = draft.value.status === 'submitted' ? `Đã tạo đơn ${draft.value.crmOrderCode} trong CRM, chờ duyệt.` : 'Chưa xác nhận hoàn tất. Bấm kiểm tra kết quả trước khi gửi lại.'; } catch (e) { error.value = purchaseError(e); } finally { busy.value = false; } }
async function retry() { busy.value = true; error.value = ''; try { receive(await commerceApi.submit(originalContactId, draft.value)); } catch (e) { error.value = purchaseError(e); } finally { busy.value = false; } }
async function check() { busy.value = true; error.value = ''; try { const result = await commerceApi.check(originalContactId, draft.value); receive(result); form.value = clone(result.input); savedText.value = JSON.stringify(result.input); } catch (e) { error.value = purchaseError(e); } finally { busy.value = false; } }
async function prepareClose() { if (busy.value || uploading.value) { error.value = 'Đang xử lý, vui lòng chờ trước khi đóng.'; return false; } if (saveInFlight && !await saveInFlight) return false; if (dirty.value && !await save()) return false; return true; }
defineExpose({ prepareClose });
async function searchProducts(cursor = '') {
  const version = ++searchVersion; searching.value = true; productError.value = '';
  try { const result = await commerceApi.products(originalContactId, query.value, cursor); if (version === searchVersion && alive) { results.value = cursor ? [...results.value, ...result.items] : result.items; productCursor.value = result.nextCursor; searched.value = true; } } catch (e) { if (version === searchVersion && alive) productError.value = purchaseError(e); } finally { if (version === searchVersion) searching.value = false; }
}
function addProduct(p: Product) { requiredFields.value[p.id] = p.requiredFields || []; if (form.value.lines.length >= 100) { error.value = 'Tối đa 100 dòng sản phẩm.'; return; } form.value.lines.push({ productId: p.id, name: p.name, kind: p.kind, variant: p.variant, warehouseId: p.warehouseId, quantity: 1, unit: p.unit, proposedPrice: p.kind === 'custom' ? null : p.price, specifications: Object.fromEntries((p.requiredFields || []).map(key => [key, ''])), attachments: [] }); }
async function uploadFiles(event: Event, index: number) {
  const input = event.target as HTMLInputElement, files = [...(input.files || [])], line = form.value.lines[index]; if (!line || !files.length) return;
  if (line.attachments.length + files.length > 10 || files.some(f => f.size > 15 * 1024 * 1024)) { error.value = 'Tối đa 10 tài liệu mỗi sản phẩm, mỗi tệp tối đa 15 MB.'; return; }
  uploading.value = true; error.value = '';
  try { const data = new FormData(); data.append('visibility', 'private'); files.forEach(f => data.append('files', f)); const result = await api.post('/media/upload', data); line.attachments.push(...result.data.assets.map((a: any) => ({ name: a.name, mediaId: a.id }))); }
  catch (e) { error.value = purchaseError(e); } finally { uploading.value = false; input.value = ''; scheduleSave(); }
}
function warnUnload(e: BeforeUnloadEvent) { if (dirty.value || saving.value || uploading.value) { e.preventDefault(); e.returnValue = ''; } }
onMounted(() => { window.addEventListener('beforeunload', warnUnload); clock = setInterval(() => now.value = Date.now(), 1000); });
onBeforeUnmount(() => { alive = false; searchVersion++; clearTimeout(timer); clearInterval(clock); window.removeEventListener('beforeunload', warnUnload); if (dirty.value && !saving.value) void save(); });

function validateForm() {
  const errors: Record<string,string> = {};
  if (!form.value.customerId) errors.customer = 'Chọn khách CRM trước khi kiểm tra giá.';
  if (!form.value.orderedBy.trim()) errors.orderedBy = 'Nhập người đặt hàng.';
  if (!form.value.recipient.name.trim()) errors.name = 'Nhập người nhận.';
  if (!form.value.recipient.phone.trim()) errors.phone = 'Nhập số điện thoại nhận hàng.';
  if (!form.value.recipient.address.trim()) errors.address = 'Nhập địa chỉ giao hàng.';
  if (!form.value.lines.length) errors.lines = 'Thêm ít nhất một sản phẩm.';
  form.value.lines.forEach((line, i) => {
    if (!(line.quantity > 0)) errors['line'+i] = 'Số lượng cần lớn hơn 0.';
    else if (line.kind === 'custom' && (line.proposedPrice === null || typeof line.proposedPrice !== 'number')) errors['line'+i] = 'Nhập giá đề xuất cho hàng đặt riêng.';
    else if ((requiredFields.value[line.productId] || []).some(key => !line.specifications[key]?.trim())) { errors['line'+i] = 'Bổ sung quy cách bắt buộc.'; expandedSpecs.value[i] = true; }
  });
  validation.value = errors;
  if (Object.keys(errors).length) { error.value = 'Kiểm tra các mục còn thiếu bên dưới.'; return false; }
  return true;
}
</script>
<style scoped>
.jf-draft-editor > .jf-row { margin-bottom: 16px; }.jf-field-error { color: #b42318; display: block; font-size: 12px; font-weight: 400; margin-top: 4px; }.jf-date-field { max-width: 280px; }
.jf-product-results { max-height: 240px; overflow: auto; }.jf-product-option { display: block; width: 100%; text-align: left; margin-bottom: 6px; }.jf-product-option small { display: block; color: var(--ink-3); font-size: 12px; margin-top: 4px; }
.jf-draft-line { padding: 16px 0; border-bottom: 1px solid var(--line); }.jf-line-fields { display: grid; grid-template-columns: minmax(150px, 1fr) 90px 60px 170px 36px; gap: 14px; align-items: center; }.jf-line-fields label { margin: 0; font-size: 12px; }.jf-line-name small { display: block; }.jf-line-fields p { margin: 5px 0 0; }.jf-specs { padding-top: 10px; }
.jf-quote-totals { max-width: 440px; margin: 16px 0 16px auto; padding-top: 12px; border-top: 1px solid var(--line); }
.jf-draft-footer { position: sticky; bottom: -24px; background: var(--surface, #fff); border-top: 1px solid var(--line); display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 14px 0; z-index: 1; }
@media(max-width: 720px) { .jf-line-fields { grid-template-columns: 1fr 1fr; }.jf-line-name { grid-column: 1/-1; }.jf-line-fields > .jf-link { justify-self: start; } }
@media(max-width: 600px) { .jf-draft-footer { bottom: -16px; flex-wrap: wrap; }.jf-draft-footer button { flex: 1; } }
</style>
