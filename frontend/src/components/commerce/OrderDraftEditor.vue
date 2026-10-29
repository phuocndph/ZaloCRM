<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="draft-editor">
    <header><button @click="close">← Danh sách</button><strong>{{ draft.crmOrderCode || 'Đơn nháp mới' }}</strong><span>{{ statusLabel }}</span></header>
    <p class="notice">Đơn sẽ chờ người có quyền duyệt trong CRM. Hàng nháp chưa giữ kho.</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="message" role="status" class="success">{{ message }}</p><p v-if="draft.lastError" class="notice">{{ draft.lastError }}</p>
    <p class="muted">{{ dirty ? 'Có thay đổi chưa lưu' : `Đã lưu lúc ${dateTime(draft.updatedAt)}` }}<span v-if="saving"> · Đang lưu…</span></p>
    <template v-if="!editable"><p>Đơn đang khóa sửa. {{ draft.approver ? `Người duyệt: ${draft.approver}` : '' }}</p><button :disabled="busy" @click="check">Kiểm tra kết quả trong CRM</button><button v-if="draft.status === 'uncertain' && auth.canAccess('commerce_draft', 'approve')" :disabled="busy" @click="retry">Kiểm tra và gửi lại cùng yêu cầu</button></template>
    <fieldset :disabled="!editable || busy">
      <h3>1. Khách hàng và người nhận</h3>
      <label>Hồ sơ khách CRM<select v-model="form.customerId"><option :value="null">Chưa liên kết — chỉ lưu nháp</option><option v-for="l in links" :key="l.id" :value="l.customerId">{{ l.customerName }}</option></select></label>
      <p v-if="!form.customerId" class="notice">Liên kết khách ở mục Mua hàng trước khi gửi. Anh vẫn có thể lưu nháp.</p>
      <label>Người đặt<input v-model="form.orderedBy" list="crm-order-contacts" maxlength="200"><datalist id="crm-order-contacts"><option v-for="c in customer?.contacts" :key="c.id" :value="c.name" /></datalist></label>
      <label v-if="customer?.id === form.customerId && customer.addresses.length">Chọn địa chỉ có sẵn<select @change="pickAddress(($event.target as HTMLSelectElement).value)"><option value="">Nhập địa chỉ riêng</option><option v-for="(a, i) in customer.addresses" :key="i" :value="i">{{ a.name }} · {{ a.address }}</option></select></label>
      <div class="grid"><label>Người nhận<input v-model="form.recipient.name" maxlength="200"></label><label>Điện thoại<input v-model="form.recipient.phone" maxlength="40" inputmode="tel"></label></div>
      <label>Địa chỉ giao hàng<textarea v-model="form.recipient.address" maxlength="2000" rows="2" /></label>
      <label>Ngày khách mong muốn<input v-model="form.desiredDate" type="date"></label>
      <h3>2. Sản phẩm và quy cách</h3>
      <form class="search" @submit.prevent="searchProducts()"><input v-model="query" aria-label="Tìm sản phẩm" placeholder="Tên hoặc mã sản phẩm"><button :disabled="searching">{{ searching ? 'Đang tìm…' : 'Tìm' }}</button></form>
      <p v-if="productError" role="alert" class="error">{{ productError }}</p><p v-if="searched && !results.length" class="muted">Chưa tìm thấy sản phẩm.</p>
      <div class="product-results"><button v-for="p in results" :key="p.id + (p.warehouseId || '')" class="product" @click="addProduct(p)"><b>{{ p.name }} · {{ p.sku }}</b><span>{{ p.variant }} · {{ p.kind === 'custom' ? 'Đặt riêng' : money(p.price) }} · Tồn: {{ p.available ?? 'Chưa có thông tin' }} {{ p.unit }} · {{ p.warehouseName }}</span><small>Cập nhật {{ dateTime(p.updatedAt) }} · Bấm để thêm</small></button><button v-if="productCursor" @click="searchProducts(productCursor)">Tải thêm sản phẩm</button></div>
      <article v-for="(line, i) in form.lines" :key="i" class="draft-line"><div class="line-head"><b>{{ i + 1 }}. {{ line.name }} {{ line.variant }}</b><button @click="form.lines.splice(i, 1)">Bỏ</button></div><p v-if="line.warehouseId">Kho: {{ line.warehouseId }}</p>
        <div class="grid"><label>Số lượng<input v-model.number="line.quantity" type="number" min="0.001" step="any"></label><label>Đơn vị tính<input v-model="line.unit" maxlength="30" readonly></label></div>
        <label>{{ line.kind === 'custom' ? 'Giá đề xuất / đơn vị (VND) — chờ duyệt' : 'Giá tham khảo / đơn vị (VND)' }}<input v-model.number="line.proposedPrice" type="number" min="0" step="1" :readonly="line.kind === 'stock'"></label>
        <template v-if="line.kind === 'custom'"><label v-for="field in specFields(line)" :key="field">{{ specLabel(field) }}<textarea v-model="line.specifications[field]" maxlength="2000" rows="2" /></label><label>Tài liệu quy cách, ảnh hoặc bản đo (tối đa 15 MB/tệp)<input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xlsx,.xls" :disabled="uploading || !auth.canAccess('media', 'create')" @change="uploadFiles($event, i)"></label><p v-if="!auth.canAccess('media', 'create')" class="muted">Cần quyền tải tài liệu vào kho để đính kèm.</p><p v-for="(file, fi) in line.attachments" :key="file.mediaId">{{ file.name }} <button @click="line.attachments.splice(fi, 1)">Bỏ tài liệu</button></p></template>
      </article>
      <p v-if="!form.lines.length" class="muted">Tìm sản phẩm từ CRM để thêm vào đơn.</p>
      <h3>3. Ghi chú và kiểm tra giá</h3><label>Ghi chú cho người duyệt<textarea v-model="form.notes" maxlength="5000" rows="3" /></label>
    </fieldset>
    <section v-if="draft.quote && !dirty" class="quote"><h3>Bảng tính tiền từ CRM</h3><p v-for="(line, i) in draft.quote.lines" :key="i">{{ form.lines[i]?.name || line.productId }} · {{ line.quantity }} {{ form.lines[i]?.unit }} × {{ money(line.unitPrice) }} = {{ money(line.total) }}</p><dl><template v-for="(amount, label) in { 'Tiền hàng': draft.quote.subtotal, 'Giảm giá': draft.quote.discount, 'Phí giao hàng': draft.quote.shipping, 'Thuế': draft.quote.tax, 'Tổng tiền': draft.quote.total }" :key="label"><dt>{{ label }}</dt><dd>{{ money(amount) }}</dd></template></dl><p v-for="(w, i) in draft.quote.warnings" :key="i" class="notice">{{ w }}</p><p class="muted">Bảng giá có hiệu lực đến {{ dateTime(draft.quote.expiresAt) }}</p><label v-if="editable" class="confirm"><input v-model="confirmed" type="checkbox">Tôi đã kiểm tra khách, quy cách, người nhận và bảng tính tiền này.</label></section>
    <footer v-if="editable"><button :disabled="busy || saving || uploading" @click="save()">Lưu nháp</button><button :disabled="busy || saving || uploading || !form.customerId" @click="quote">Kiểm tra giá</button><button class="primary" :disabled="busy || saving || uploading || dirty || !draft.quote || !confirmed || !auth.canAccess('commerce_draft', 'approve')" @click="submit">Gửi CRM chờ duyệt</button></footer>
  </section>
</template>
<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { commerceApi, purchaseError, money, dateTime, type Draft, type DraftInput, type DraftLine, type Link, type Customer, type Product } from '@/api/commerce';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const props = defineProps<{ contactId: string; initial: Draft; links: Link[]; customer?: Customer }>();
const emit = defineEmits<{ saved: [draft: Draft]; close: [] }>();
const auth = useAuthStore(), draft = ref<Draft>(clone(props.initial));
const form = ref<DraftInput>(clone(props.initial.input));
const savedText = ref(JSON.stringify(form.value)), error = ref(''), message = ref(''), busy = ref(false), saving = ref(false), uploading = ref(false), confirmed = ref(false);
const dirty = computed(() => JSON.stringify(form.value) !== savedText.value);
const editable = computed(() => ['local', 'returned'].includes(draft.value.status) && auth.canAccess('commerce_draft', 'edit'));
const statusLabel = computed(() => ({ closed: 'Đã kết thúc trong CRM', local: 'Nháp tại ZCRM', returned: 'CRM yêu cầu bổ sung', submitted: 'Đã gửi CRM', submitting: 'Đang gửi', uncertain: 'Chưa xác nhận kết quả' }[draft.value.status]));
let timer: ReturnType<typeof setTimeout> | undefined, alive = true, searchVersion = 0;
const query = ref(''), results = ref<Product[]>([]), productCursor = ref<string | null>(null), productError = ref(''), searching = ref(false), searched = ref(false);
const specNames: Record<string, string> = { measurements: 'Số đo và đơn vị (ví dụ: rộng 250 cm × cao 270 cm)', material: 'Chất liệu', color: 'Màu', sewing: 'Kiểu may', accessories: 'Phụ kiện', installation: 'Yêu cầu lắp đặt' };
const specFields = (line: DraftLine) => [...new Set([...Object.keys(specNames), ...Object.keys(line.specifications)])];
const specLabel = (field: string) => specNames[field] || field;
watch(() => props.initial, latest => {
  if (busy.value || saving.value || dirty.value || latest.id !== draft.value.id) return;
  if (latest.revision !== draft.value.revision || latest.status !== draft.value.status || latest.updatedAt !== draft.value.updatedAt) {
    draft.value = clone(latest); form.value = clone(latest.input); savedText.value = JSON.stringify(form.value); confirmed.value = false;
  }
});
function pickAddress(index: string) { if (index !== '' && props.customer?.id === form.value.customerId && props.customer.addresses[Number(index)]) form.value.recipient = clone(props.customer.addresses[Number(index)]!); }
function receive(value: Draft, inputSaved?: string) { draft.value = value; if (inputSaved !== undefined) savedText.value = inputSaved; confirmed.value = false; if (alive) emit('saved', value); }
async function save() {
  if (saving.value || !editable.value || !dirty.value) return draft.value;
  saving.value = true; error.value = ''; const snapshot = JSON.stringify(form.value), current = draft.value;
  try { const result = await commerceApi.save(props.contactId, { input: JSON.parse(snapshot), revision: current.revision }, current.id); receive(result, snapshot); message.value = 'Đã lưu nháp tại ZCRM.'; return result; }
  catch (e) { error.value = purchaseError(e); return null; }
  finally { saving.value = false; if (alive && dirty.value && !error.value) scheduleSave(); }
}
function scheduleSave() { clearTimeout(timer); timer = setTimeout(() => { if (!busy.value && !uploading.value) void save(); }, 1500); }
watch(form, () => { confirmed.value = false; message.value = ''; if (editable.value) scheduleSave(); }, { deep: true });
async function quote() { const saved = await save(); if (!saved) return; busy.value = true; error.value = ''; try { receive(await commerceApi.quote(props.contactId, saved)); } catch (e) { error.value = purchaseError(e); } finally { busy.value = false; } }
async function submit() { if (!confirmed.value || dirty.value || !draft.value.quote) return; busy.value = true; error.value = ''; try { receive(await commerceApi.submit(props.contactId, draft.value)); message.value = draft.value.status === 'submitted' ? `Đã tạo đơn ${draft.value.crmOrderCode} trong CRM, chờ duyệt.` : 'Chưa xác nhận hoàn tất. Bấm kiểm tra kết quả trước khi gửi lại.'; } catch (e) { error.value = purchaseError(e); } finally { busy.value = false; } }
async function retry() { busy.value = true; error.value = ''; try { receive(await commerceApi.submit(props.contactId, draft.value)); } catch (e) { error.value = purchaseError(e); } finally { busy.value = false; } }
async function check() { busy.value = true; error.value = ''; try { const result = await commerceApi.check(props.contactId, draft.value); receive(result); form.value = clone(result.input); savedText.value = JSON.stringify(result.input); } catch (e) { error.value = purchaseError(e); } finally { busy.value = false; } }
async function close() { if (saving.value) return; if (dirty.value && !await save()) return; emit('close'); }
async function searchProducts(cursor = '') {
  const version = ++searchVersion; searching.value = true; productError.value = '';
  try { const result = await commerceApi.products(props.contactId, query.value, cursor); if (version === searchVersion && alive) { results.value = cursor ? [...results.value, ...result.items] : result.items; productCursor.value = result.nextCursor; searched.value = true; } } catch (e) { if (version === searchVersion && alive) productError.value = purchaseError(e); } finally { if (version === searchVersion) searching.value = false; }
}
function addProduct(p: Product) { if (form.value.lines.length >= 100) { error.value = 'Tối đa 100 dòng sản phẩm.'; return; } form.value.lines.push({ productId: p.id, name: p.name, kind: p.kind, variant: p.variant, warehouseId: p.warehouseId, quantity: 1, unit: p.unit, proposedPrice: p.kind === 'custom' ? null : p.price, specifications: Object.fromEntries((p.requiredFields || []).map(key => [key, ''])), attachments: [] }); }
async function uploadFiles(event: Event, index: number) {
  const input = event.target as HTMLInputElement, files = [...(input.files || [])], line = form.value.lines[index]; if (!line || !files.length) return;
  if (line.attachments.length + files.length > 10 || files.some(f => f.size > 15 * 1024 * 1024)) { error.value = 'Tối đa 10 tài liệu mỗi sản phẩm, mỗi tệp tối đa 15 MB.'; return; }
  uploading.value = true; error.value = '';
  try { const data = new FormData(); data.append('visibility', 'private'); files.forEach(f => data.append('files', f)); const result = await api.post('/media/upload', data); line.attachments.push(...result.data.assets.map((a: any) => ({ name: a.name, mediaId: a.id }))); }
  catch (e) { error.value = purchaseError(e); } finally { uploading.value = false; input.value = ''; scheduleSave(); }
}
function warnUnload(e: BeforeUnloadEvent) { if (dirty.value || saving.value || uploading.value) { e.preventDefault(); e.returnValue = ''; } }
onMounted(() => window.addEventListener('beforeunload', warnUnload));
onBeforeUnmount(() => { alive = false; searchVersion++; clearTimeout(timer); window.removeEventListener('beforeunload', warnUnload); if (dirty.value && !saving.value) void save(); });
</script>
<style scoped>
.draft-editor{font-size:13px}.draft-editor header,.draft-editor footer,.line-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.line-head{justify-content:space-between}fieldset{border:0;padding:0;min-width:0}h3{font-size:14px;margin:22px 0 10px}label{display:block;margin:10px 0}input:not([type=checkbox]),select,textarea{display:block;width:100%;border:1px solid #cbd5e1;border-radius:7px;padding:8px;margin-top:4px;background:white;color:#1e293b;font:inherit}input[readonly]{background:#f1f5f9}button{border:1px solid #cbd5e1;border-radius:7px;padding:7px 10px;background:white;color:#155e75;font:inherit;cursor:pointer}button:disabled{opacity:.5;cursor:default}.primary{background:#087b92;color:white}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.notice{background:#fff7df;color:#805717;padding:9px;border-radius:7px;line-height:1.5}.muted{color:#64748b}.error{color:#b91c1c;background:#fff1f2;padding:9px}.success{color:#166534}.search{display:flex;gap:6px}.search input{margin:0;min-width:0}.product-results{max-height:220px;overflow:auto}.product{display:block;text-align:left;width:100%;margin-top:6px}.product span,.product small{display:block;margin-top:3px}.product small{color:#64748b}.draft-line,.quote{padding:12px;border:1px solid #dbe5ed;border-radius:9px;margin-top:12px}.quote{background:#f0fdfa}dl{display:grid;grid-template-columns:1fr 1fr;gap:7px}dd{text-align:right;margin:0}.confirm input{margin-right:6px}footer{position:sticky;bottom:0;background:white;padding:12px 0;border-top:1px solid #e2e8f0;margin-top:18px}
@media(max-width:500px){.grid{grid-template-columns:1fr}}
</style>
