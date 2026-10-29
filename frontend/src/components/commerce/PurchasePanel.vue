<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="jf-ui jf-purchase-panel" :data-workspace-open="!!workspace">
    <header class="jf-row jf-between"><h2>Mua hàng</h2><button v-if="selected" class="jf-link" :disabled="loading" @click="loadPurchase(true)">Cập nhật</button></header>
    <p v-if="!auth.canAccess('commerce')" class="jf-empty">Anh chưa được cấp quyền xem thông tin mua hàng.</p>
    <template v-else-if="!effectiveContactId"><p class="jf-empty">Chọn người liên hệ để xem đơn hàng.</p><button class="jf-primary" @click="workspace = 'contact'">Chọn người liên hệ</button></template>
    <template v-else>
      <p v-if="error" role="alert" class="jf-error">{{ error }}</p>
      <p v-if="loading && !linksLoaded" class="jf-muted">Đang tải thông tin mua hàng…</p>
      <button v-if="!linksLoaded && error" @click="reloadLinks">Thử lại</button>
      <template v-if="linksLoaded">
        <div v-if="!links.length" class="jf-unlinked"><p>Chưa liên kết với khách trong CRM.</p><button v-if="auth.canAccess('commerce_link', 'access')" class="jf-primary" @click="openLinks">Chọn khách</button><p v-else class="jf-muted">Liên hệ người có quyền liên kết khách.</p><button v-if="auth.canAccess('commerce_draft', 'create')" class="jf-link" :disabled="loading" @click="newDraft">Tạo nháp trước</button></div>
        <template v-else>
          <label v-if="links.length > 1">Khách / khách sạn<select v-model="selected"><option value="">Chọn hồ sơ đang giao dịch</option><option v-for="l in links" :key="l.id" :value="l.customerId">{{ l.customerName }}</option></select></label>
          <div v-else class="jf-customer-name"><b>{{ overview?.data.customer.name || links[0]?.customerName }}</b><button v-if="auth.canAccess('commerce_link', 'access')" class="jf-link" @click="openLinks">Thay đổi</button></div>
          <template v-if="overview && selected">
            <div class="jf-purchase-numbers"><div><span>Đã mua</span><b>{{ money(overview.data.summary.netSales) }}</b></div><div><span>Còn phải thu</span><b>{{ money(overview.data.summary.due) }}</b></div></div>
            <p class="jf-muted jf-updated">Cập nhật {{ dateTime(overview.updatedAt) }}<span v-if="overview.stale"> · Bản lưu gần nhất</span></p>
            <p v-if="overview.error || orders?.error" class="jf-notice">{{ overview.error || orders?.error }}</p>
          </template>
          <div v-else-if="selected && loading" class="jf-empty">Đang tải đơn hàng…</div>
          <div class="jf-actions jf-create-action"><button v-if="auth.canAccess('commerce_draft', 'create')" class="jf-primary" :disabled="loading" @click="newDraft">Tạo đơn</button><button v-if="links.length > 1 && auth.canAccess('commerce_link', 'access')" class="jf-link" @click="openLinks">Chọn thêm khách</button></div>
        </template>
        <template v-if="compact">
          <section v-if="selected && orders" class="jf-recent-orders"><h3>Đơn hàng <span v-if="overview" class="jf-muted">({{ overview.data.summary.orderCount }})</span></h3><p v-if="!orders.data.items.length" class="jf-muted">Chưa có đơn hàng.</p><button v-for="o in orders.data.items.slice(0, 3)" :key="o.id" class="jf-list-row" @click="openOrder(o.id)"><span><b>{{ o.code }}</b><b>{{ money(o.total) }}</b></span><small>Xử lý: {{ o.processing.label }}</small><small>Giao: {{ o.delivery.label }}</small></button></section>
          <button v-if="links.length || drafts.length" class="jf-link" @click="workspace = 'orders'">Xem tất cả đơn<span v-if="drafts.length"> · {{ drafts.length }} nháp</span></button>
        </template>
        <template v-else>
          <details v-if="overview" class="jf-section"><summary>Thông tin mua hàng đầy đủ</summary><p>{{ overview.data.summary.orderCount }} đơn · Đã thu {{ money(overview.data.summary.collected) }} · {{ overview.data.summary.activeOrderCount }} đơn đang xử lý</p><p v-for="c in overview.data.customer.contacts" :key="c.id">{{ c.name }} · {{ c.phone }}</p><p v-for="(a, i) in overview.data.customer.addresses" :key="i">{{ a.name }} · {{ a.phone }} · {{ a.address }}</p><a v-if="safeLink(overview.data.customer.url)" :href="safeLink(overview.data.customer.url)" target="_blank" rel="noopener noreferrer">Mở hồ sơ CRM</a></details>
          <PurchaseOrders :key="selected" :filters="appliedFilters" :orders="orders?.data.items || []" :drafts="drafts" :customer-selected="!!selected" :can-read-drafts="auth.canAccess('commerce_draft')" :loading="loading" :order-cursor="orders?.data.nextCursor" :draft-cursor="draftCursor" @order="openOrder" @draft="openDraft" @filter="applyListFilter" @more-orders="loadOrders(true, $event)" @more-drafts="loadDrafts" />
        </template>
      </template>
    </template>
    <CommerceWorkspace v-if="workspace" :title="workspaceTitle" :before-close="beforeClose" @close="closeWorkspace">
      <p v-if="error" role="alert" class="jf-error">{{ error }}</p>
      <OrderDraftEditor v-if="workspace === 'draft' && draftEditor" :key="draftEditor.id" ref="editorRef" :contact-id="effectiveContactId" :initial="draftEditor" :links="links" :customer="overview?.data.customer" @saved="onDraftSaved" @close="closeWorkspace" />
      <template v-else-if="workspace === 'detail'"><OrderDetail v-if="orderDetail" :order="orderDetail.data" :updated-at="orderDetail.updatedAt" :stale="orderDetail.stale" /><p v-else class="jf-muted">{{ error ? 'Chưa tải được chi tiết đơn.' : 'Đang tải chi tiết đơn…' }}</p></template>
      <PurchaseOrders v-else-if="workspace === 'orders'" :key="selected" :filters="appliedFilters" :orders="orders?.data.items || []" :drafts="drafts" :customer-selected="!!selected" :can-read-drafts="auth.canAccess('commerce_draft')" :loading="loading" :order-cursor="orders?.data.nextCursor" :draft-cursor="draftCursor" @order="openOrder" @draft="openDraft" @filter="applyListFilter" @more-orders="loadOrders(true, $event)" @more-drafts="loadDrafts" />
      <template v-else-if="workspace === 'contact'"><form class="jf-search" @submit.prevent="findContacts"><input v-model="contactQuery" placeholder="Tên hoặc điện thoại" aria-label="Tìm người liên hệ"><button>Tìm</button></form><button v-for="c in contactResults" :key="c.id" class="jf-list-row" @click="chosenContact = c.id; closeWorkspace()"><b>{{ c.fullName || c.crmName || 'Khách hàng' }}</b><small>{{ c.phone }}</small></button></template>
      <template v-else-if="workspace === 'links'">
        <template v-if="creatingCustomer"><button class="jf-link" @click="creatingCustomer = false">← Tìm khách có sẵn</button><form class="jf-new-customer" @submit.prevent="createCustomer"><label>Tên khách / khách sạn<input v-model="newCustomer.name" maxlength="200" required></label><label>Điện thoại<input v-model="newCustomer.phone" maxlength="40" required></label><label>Loại khách<select v-model="newCustomer.kind"><option value="hotel">Khách sạn</option><option value="individual">Cá nhân</option></select></label><button class="jf-primary" :disabled="linkingBusy || !newCustomer.name || !newCustomer.phone">Tạo khách và liên kết</button></form></template>
        <template v-else-if="pickedCandidate"><button class="jf-link" @click="pickedCandidate = null">← Chọn lại khách</button><section class="jf-section"><h3>{{ pickedCandidate.name }}</h3><p>{{ pickedCandidate.code }} · {{ pickedCandidate.phone || 'Chưa có điện thoại' }}</p><p class="jf-muted">Kiểm tra đúng hồ sơ trước khi liên kết.</p><label v-if="pickedCandidate.contacts.length">Người liên hệ<select v-model="candidateContacts[pickedCandidate.id]"><option value="">Chưa xác định</option><option v-for="p in pickedCandidate.contacts" :key="p.id" :value="p.id">{{ p.name }} · {{ p.phone }}</option></select></label><label class="jf-check"><input v-model="candidateConfirmed[pickedCandidate.id]" type="checkbox">Đây là đúng khách cần liên kết.</label><button class="jf-primary" :disabled="!candidateConfirmed[pickedCandidate.id] || linkingBusy || !auth.canAccess('commerce_link', 'edit')" @click="confirmLink(pickedCandidate)">Xác nhận liên kết</button></section></template>
        <template v-else><form class="jf-search" @submit.prevent="findCustomers()"><input v-model="query" placeholder="Tên, số điện thoại hoặc mã khách" aria-label="Tìm hồ sơ CRM"><button :disabled="searching">{{ searching ? 'Đang tìm…' : 'Tìm' }}</button></form><p v-if="searchError" role="alert" class="jf-error">{{ searchError }}</p><p v-if="searched && !candidates.length" class="jf-empty">Chưa tìm thấy khách phù hợp.</p><div v-for="c in candidates" :key="c.id" class="jf-candidate"><div><b>{{ c.name }}</b><p class="jf-muted">{{ c.code }} · {{ c.phone || 'Chưa có điện thoại' }}</p></div><button :disabled="linkingBusy" @click="pickedCandidate = c">Chọn</button></div><button v-if="candidateCursor" :disabled="searching" @click="findCustomers(candidateCursor)">Tải thêm khách</button><button v-if="auth.canAccess('commerce_link', 'edit')" class="jf-link" @click="creatingCustomer = true">Tạo khách mới</button>
          <details v-if="links.length"><summary>Hồ sơ đã liên kết</summary><div v-for="l in links" :key="l.id" class="jf-linked"><div class="jf-row jf-between"><span>{{ l.customerName }}</span><button v-if="auth.canAccess('commerce_link', 'edit')" class="jf-link" @click="unlinkId = l.customerId">Gỡ liên kết</button></div><div v-if="unlinkId === l.customerId" class="jf-notice"><p>Gỡ liên kết với {{ l.customerName }}?</p><button :disabled="linkingBusy" @click="unlink(l.customerId)">Xác nhận gỡ</button><button @click="unlinkId = ''">Giữ lại</button></div></div></details>
        </template>
      </template>
    </CommerceWorkspace>
  </section>
</template>
<script setup lang="ts">
import { ref, reactive, computed, watch, onBeforeUnmount } from 'vue';
import CommerceWorkspace from './CommerceWorkspace.vue';
import PurchaseOrders from './PurchaseOrders.vue';
import './commerce.css';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import OrderDetail from './OrderDetail.vue';
import OrderDraftEditor from './OrderDraftEditor.vue';
import { commerceApi, purchaseError, money, dateTime, safeLink, type Link, type Customer, type Summary, type Snapshot, type Page, type Order, type OrderSummary, type Draft } from '@/api/commerce';
const props = defineProps<{ contactId?: string | null; compact?: boolean; requireContactSelection?: boolean }>();
const emit = defineEmits<{ workspaceChange: [open: boolean] }>();
const workspace = ref<'' | 'links' | 'orders' | 'detail' | 'draft' | 'contact'>('');
const editorRef = ref<{ prepareClose: () => Promise<boolean> }>();
const pickedCandidate = ref<Customer | null>(null), creatingCustomer = ref(false), linksLoaded = ref(false);
const auth = useAuthStore(), chosenContact = ref('');
const effectiveContactId = computed(() => props.requireContactSelection ? chosenContact.value : props.contactId || chosenContact.value);
const links = ref<Link[]>([]), selected = ref(''), overview = ref<Snapshot<{ customer: Customer; summary: Summary }> | null>(null), orders = ref<Snapshot<Page<OrderSummary>> | null>(null), orderDetail = ref<Snapshot<Order> | null>(null), draftEditor = ref<Draft | null>(null);
const loading = ref(false), error = ref(''), linking = ref(false), query = ref(''), searching = ref(false), searched = ref(false), searchError = ref(''), candidates = ref<Customer[]>([]), candidateCursor = ref<string | null>(null), candidateContacts = reactive<Record<string, string>>({}), candidateConfirmed = reactive<Record<string, boolean>>({}), linkingBusy = ref(false), unlinkId = ref('');
const drafts = ref<Draft[]>([]), draftCursor = ref<string | null>(null), newCustomer = reactive({ name: '', phone: '', kind: 'hotel' as 'hotel' | 'individual' });
const orderQuery = ref(''), orderStatus = ref(''), from = ref(''), to = ref(''), appliedFilters = ref<Record<string, string>>({});
const contactQuery = ref(''), contactResults = ref<Array<{ id: string; fullName?: string; crmName?: string; phone?: string }>>([]);
let generation = 0, purchaseRequest = 0, orderRequest = 0, searchRequest = 0, timer: ReturnType<typeof setInterval> | undefined;
let customerCreateKey = crypto.randomUUID(), draftCreateKey = crypto.randomUUID();
const fresh = (g: number, id: string) => g === generation && id === effectiveContactId.value;
const workspaceTitle = computed(() => ({ links: creatingCustomer.value ? 'Tạo khách trong CRM' : pickedCandidate.value ? 'Xác nhận khách' : 'Chọn khách CRM', orders: 'Đơn hàng và nháp', detail: orderDetail.value ? `Đơn ${orderDetail.value.data.code}` : 'Chi tiết đơn', draft: draftEditor.value?.crmOrderCode || 'Tạo đơn nháp', contact: 'Chọn người liên hệ', '': '' }[workspace.value]));
watch(workspace, v => emit('workspaceChange', !!v));
async function beforeClose() { return workspace.value !== 'draft' || !editorRef.value ? true : editorRef.value.prepareClose(); }
function closeWorkspace() { detailRequest++; workspace.value = ''; orderDetail.value = null; draftEditor.value = null; pickedCandidate.value = null; creatingCustomer.value = false; }
function openDraft(d: Draft) { draftEditor.value = d; workspace.value = 'draft'; }
function openLinks() { pickedCandidate.value = null; creatingCustomer.value = false; workspace.value = 'links'; }
function applyListFilter(params: Record<string, string>) { appliedFilters.value = params; void loadOrders(true); }
watch(() => [props.contactId, props.requireContactSelection], () => { chosenContact.value = ''; });
watch(effectiveContactId, async id => {
  workspace.value = ''; linksLoaded.value = false; pickedCandidate.value = null; creatingCustomer.value = false;
  const g = ++generation; purchaseRequest++; orderRequest++; searchRequest++; clearInterval(timer);
  links.value = []; selected.value = ''; overview.value = null; orders.value = null; orderDetail.value = null; drafts.value = []; draftEditor.value = null; error.value = ''; candidates.value = []; searched.value = false; linking.value = false; query.value = ''; candidateCursor.value = null; draftCursor.value = null; orderQuery.value = ''; orderStatus.value = ''; from.value = ''; to.value = ''; appliedFilters.value = {}; linkingBusy.value = false; searching.value = false; searchError.value = ''; unlinkId.value = ''; customerCreateKey = crypto.randomUUID(); draftCreateKey = crypto.randomUUID(); newCustomer.name = ''; newCustomer.phone = ''; newCustomer.kind = 'hotel';
  if (!id || !auth.canAccess('commerce')) { loading.value = false; return; }
  loading.value = true;
  try { const list = await commerceApi.links(id); if (!fresh(g, id)) return; links.value = list; linksLoaded.value = true; selected.value = list.length === 1 ? list[0]!.customerId : ''; await loadDrafts(); }
  catch (e) { if (fresh(g, id)) error.value = purchaseError(e); }
  finally { if (fresh(g, id)) loading.value = false; }
  if (!fresh(g, id)) return;
  timer = setInterval(() => { if (document.visibilityState !== 'hidden') void loadPurchase(true); }, 60000);
}, { immediate: true });
watch(selected, () => { overview.value = null; orders.value = null; orderDetail.value = null; appliedFilters.value = {}; orderQuery.value = ''; orderStatus.value = ''; from.value = ''; to.value = ''; if (selected.value) void loadPurchase(); });
async function loadPurchase(refresh = false) {
  const id = effectiveContactId.value, customerId = selected.value, g = generation, request = ++purchaseRequest; if (!id || !customerId) return;
  loading.value = true; error.value = '';
  try { const result = await commerceApi.overview(id, customerId, refresh); if (!fresh(g, id) || customerId !== selected.value || request !== purchaseRequest) return; overview.value = result; await loadOrders(refresh); if (refresh) await loadDrafts(); if (orderDetail.value) await openOrder(orderDetail.value.data.id, refresh); if (!refresh) void loadPurchase(true); }
  catch (e) { if (fresh(g, id) && request === purchaseRequest) error.value = purchaseError(e); }
  finally { if (fresh(g, id) && request === purchaseRequest) loading.value = false; }
}
async function loadOrders(refresh: boolean, cursor = '') {
  const id = effectiveContactId.value, customerId = selected.value, g = generation, request = ++orderRequest; if (!id || !customerId) return;
  try { const result = await commerceApi.orders(id, customerId, { ...appliedFilters.value, cursor, refresh }); if (!fresh(g, id) || customerId !== selected.value || request !== orderRequest) return; if (cursor && orders.value) result.data.items = [...orders.value.data.items, ...result.data.items]; orders.value = result; }
  catch (e) { if (fresh(g, id) && request === orderRequest) error.value = purchaseError(e); }
}
let detailRequest = 0;
async function openOrder(orderId: string, refresh = false) { if (!refresh) { workspace.value = 'detail'; orderDetail.value = null; } const id = effectiveContactId.value, c = selected.value, g = generation, request = ++detailRequest; if (!id) return; try { const result = await commerceApi.order(id, c, orderId, refresh); if (fresh(g, id) && c === selected.value && request === detailRequest && workspace.value === 'detail') { orderDetail.value = result; if (!refresh) void openOrder(orderId, true); } } catch (e) { if (fresh(g, id) && request === detailRequest) error.value = purchaseError(e); } }
async function findCustomers(cursor = '') { const id = effectiveContactId.value, g = generation, request = ++searchRequest; if (!id) return; searching.value = true; searchError.value = ''; try { const result = await commerceApi.search(id, query.value, cursor); if (fresh(g, id) && request === searchRequest) { candidates.value = cursor ? [...candidates.value, ...result.items] : result.items; candidateCursor.value = result.nextCursor; searched.value = true; } } catch (e) { if (fresh(g, id) && request === searchRequest) searchError.value = purchaseError(e); } finally { if (fresh(g, id) && request === searchRequest) searching.value = false; } }
async function confirmLink(c: Customer) { const id = effectiveContactId.value, g = generation; if (!id || !candidateConfirmed[c.id]) return; linkingBusy.value = true; error.value = ''; try { await commerceApi.link(id, { customerId: c.id, crmContactId: candidateContacts[c.id], confirmed: true }); const list = await commerceApi.links(id); if (fresh(g, id)) { links.value = list; selected.value = c.id; linking.value = false; closeWorkspace(); } } catch (e) { if (fresh(g, id)) error.value = purchaseError(e); } finally { if (fresh(g, id)) linkingBusy.value = false; } }
async function unlink(customerId: string) { const id = effectiveContactId.value, g = generation; if (!id) return; linkingBusy.value = true; try { await commerceApi.unlink(id, customerId); const list = await commerceApi.links(id); if (fresh(g, id)) { links.value = list; if (selected.value === customerId) selected.value = ''; unlinkId.value = ''; } } catch (e) { if (fresh(g, id)) error.value = purchaseError(e); } finally { if (fresh(g, id)) linkingBusy.value = false; } }
async function createCustomer() { const id = effectiveContactId.value, g = generation; if (!id) return; linkingBusy.value = true; error.value = ''; try { const result = await commerceApi.createCustomer(id, { ...newCustomer, requestKey: customerCreateKey }); const list = await commerceApi.links(id); if (fresh(g, id)) { links.value = list; selected.value = result.customerId; customerCreateKey = crypto.randomUUID(); closeWorkspace(); } } catch (e) { if (fresh(g, id)) error.value = purchaseError(e); } finally { if (fresh(g, id)) linkingBusy.value = false; } }
async function loadDrafts(cursor = '') { const id = effectiveContactId.value, g = generation; if (!id || !auth.canAccess('commerce_draft')) return; try { const result = await commerceApi.drafts(id, cursor); if (fresh(g, id)) { drafts.value = cursor ? [...drafts.value, ...result.items] : result.items; draftCursor.value = result.nextCursor; if (draftEditor.value) { const latest = result.items.find(d => d.id === draftEditor.value?.id); if (latest) draftEditor.value = latest; } } } catch (e) { if (fresh(g, id)) error.value = purchaseError(e); } }
async function newDraft() { const id = effectiveContactId.value, g = generation; if (!id) return; loading.value = true; error.value = ''; try { const result = await commerceApi.save(id, { createKey: draftCreateKey, input: { customerId: selected.value || null, orderedBy: overview.value?.data.customer.contacts.find(c => c.id === links.value.find(l => l.customerId === selected.value)?.crmContactId)?.name || '', recipient: overview.value?.data.customer.addresses.length === 1 ? overview.value.data.customer.addresses[0] : { name: '', phone: '', address: '' }, desiredDate: '', notes: '', lines: [] } }); if (fresh(g, id)) { draftEditor.value = result; workspace.value = 'draft'; draftCreateKey = crypto.randomUUID(); onDraftSaved(result); } } catch (e) { if (fresh(g, id)) error.value = purchaseError(e); } finally { if (fresh(g, id)) loading.value = false; } }
function onDraftSaved(d: Draft) { if (d.contactId !== effectiveContactId.value) return; const i = drafts.value.findIndex(v => v.id === d.id); if (i >= 0) drafts.value[i] = d; else drafts.value.unshift(d); }
async function findContacts() { const g = generation; try { const { data } = await api.get('/contacts', { params: { search: contactQuery.value, limit: 20 } }); if (g === generation) contactResults.value = data.contacts || []; } catch (e) { error.value = purchaseError(e); } }
onBeforeUnmount(() => { generation++; emit('workspaceChange', false); clearInterval(timer); });

async function reloadLinks() { const id = effectiveContactId.value, g = generation; if (!id) return; loading.value = true; error.value = ''; try { const result = await commerceApi.links(id); if (fresh(g,id)) { links.value = result; linksLoaded.value = true; selected.value = result.length === 1 ? result[0]!.customerId : ''; await loadDrafts(); } } catch(e) { if(fresh(g,id)) error.value = purchaseError(e); } finally { if(fresh(g,id)) loading.value = false; } }
</script>

<style scoped>
.jf-purchase-panel { padding: 16px; }.jf-purchase-panel > header { margin-bottom: 16px; }
.jf-customer-name { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 12px 0; }.jf-customer-name b { overflow-wrap: anywhere; }
.jf-purchase-numbers { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; padding: 14px 0; border-block: 1px solid var(--line); }.jf-purchase-numbers span,.jf-purchase-numbers b { display: block; }.jf-purchase-numbers span { font-size: 12px; color: var(--ink-3); }.jf-purchase-numbers b { margin-top: 4px; font-size: 16px; overflow-wrap: anywhere; }
.jf-create-action { margin: 14px 0; }.jf-updated { margin-top: 10px; }.jf-recent-orders { margin-top: 20px; }.jf-recent-orders h3 { margin-bottom: 2px; }
.jf-unlinked { padding: 12px 0 20px; }.jf-unlinked > .jf-link { display: block; margin-top: 8px; }
.jf-candidate { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--line); }.jf-candidate p { margin: 4px 0 0; }.jf-new-customer { max-width: 540px; margin-top: 16px; }.jf-linked { padding: 8px 0; }
</style>
