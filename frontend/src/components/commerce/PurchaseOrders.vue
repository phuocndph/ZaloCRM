<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <div class="jf-ui">
    <nav class="jf-orders-tabs" aria-label="Danh sách mua hàng"><button :aria-pressed="tab === 'orders'" @click="tab = 'orders'">Đơn hàng</button><button v-if="canReadDrafts" :aria-pressed="tab === 'drafts'" @click="tab = 'drafts'">Nháp <span v-if="drafts.length">({{ drafts.length }})</span></button></nav>
    <template v-if="tab === 'orders'">
      <template v-if="customerSelected">
        <form class="jf-search" @submit.prevent="apply"><input v-model="query" aria-label="Tìm mã đơn" placeholder="Tìm mã đơn"><button type="submit">Tìm</button><button type="button" :aria-expanded="showFilters" @click="showFilters = !showFilters">Bộ lọc</button></form>
        <form v-if="showFilters" class="jf-orders-filters" @submit.prevent="apply"><label>Tình trạng<select v-model="status"><option value="">Tất cả</option><option value="active">Đang xử lý</option><option value="pending_approval">Chờ duyệt</option><option value="production">Đang sản xuất</option><option value="shipping">Đang giao</option><option value="problem">Có vấn đề</option><option value="completed">Hoàn tất</option><option value="cancelled">Đã hủy</option></select></label><label>Từ ngày<input v-model="from" type="date"></label><label>Đến ngày<input v-model="to" type="date"></label><button>Áp dụng</button><button type="button" @click="reset">Xóa lọc</button><p v-if="filterError" class="jf-error" role="alert">{{ filterError }}</p></form>
        <p v-if="!orders.length" class="jf-empty">Chưa có đơn hàng phù hợp.</p>
        <button v-for="order in orders" :key="order.id" class="jf-list-row" @click="$emit('order', order.id)"><span><b>{{ order.code }}</b><b>{{ money(order.total) }}</b></span><small>Xử lý: {{ order.processing.label }} · Giao: {{ order.delivery.label }}</small><small v-if="['pending_approval','returned','rejected'].includes(order.approval.code)">Duyệt đơn: {{ order.approval.label }}</small></button>
        <button v-if="orderCursor" :disabled="loading" @click="$emit('moreOrders', orderCursor)">Tải thêm đơn</button>
      </template><p v-else class="jf-empty">Chọn hồ sơ khách CRM để xem đơn hàng.</p>
    </template>
    <template v-else><p v-if="!drafts.length" class="jf-empty">Chưa có đơn nháp.</p><button v-for="draft in drafts" :key="draft.id" class="jf-list-row" @click="$emit('draft', draft)"><span><b>{{ draft.crmOrderCode || `Nháp ${draft.id.slice(0, 8)}` }}</b><span>{{ draftLabel(draft.status) }}</span></span><small>{{ dateTime(draft.updatedAt) }}</small></button><button v-if="draftCursor" :disabled="loading" @click="$emit('moreDrafts', draftCursor)">Tải thêm nháp</button></template>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { money, dateTime, type Draft, type OrderSummary } from '@/api/commerce';
const props = defineProps<{ filters?: Record<string, string>; orders: OrderSummary[]; drafts: Draft[]; customerSelected: boolean; canReadDrafts: boolean; loading: boolean; orderCursor?: string | null; draftCursor?: string | null }>();
const emit = defineEmits<{ order: [id: string]; draft: [draft: Draft]; filter: [params: Record<string, string>]; moreOrders: [cursor: string]; moreDrafts: [cursor: string] }>();
const tab = ref('orders'), showFilters = ref(false), query = ref(props.filters?.q || ''), status = ref(props.filters?.status || ''), from = ref(props.filters?.from || ''), to = ref(props.filters?.to || ''), filterError = ref('');
const draftLabel = (s: string) => ({ local: 'Nháp', returned: 'Cần bổ sung', submitted: 'Đã gửi CRM', submitting: 'Đang gửi', uncertain: 'Chưa rõ kết quả', closed: 'Đã kết thúc' }[s] || s);
function apply() { filterError.value = ''; if (from.value && to.value && from.value > to.value) { filterError.value = 'Ngày bắt đầu cần trước ngày kết thúc.'; return; } emit('filter', { q: query.value, status: status.value, from: from.value, to: to.value }); }
function reset() { query.value = ''; status.value = ''; from.value = ''; to.value = ''; apply(); }
</script>
<style scoped>
.jf-orders-tabs { display: flex; gap: 16px; border-bottom: 1px solid var(--line); margin-bottom: 16px; }
.jf-orders-tabs button { border: 0; border-radius: 0; padding: 8px 0; border-bottom: 2px solid transparent; }
.jf-orders-tabs button[aria-pressed=true] { border-bottom-color: var(--brand); color: var(--brand-700); font-weight: 600; }
.jf-orders-filters { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 10px; padding: 14px; background: var(--surface-2); border-radius: 6px; margin-bottom: 12px; }
.jf-orders-filters label { flex: 1 1 160px; margin: 0; }.jf-orders-filters p { flex-basis: 100%; }
@media(max-width: 600px) { .jf-search { flex-wrap: wrap; }.jf-search input { flex-basis: 100%; } }
</style>
