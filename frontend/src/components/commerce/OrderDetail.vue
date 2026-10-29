<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="order-detail">
    <header><button type="button" @click="$emit('close')">← Danh sách đơn</button><strong>{{ order.code }}</strong><a v-if="safeLink(order.url)" :href="safeLink(order.url)" target="_blank" rel="noopener noreferrer">Mở trong CRM ↗</a></header>
    <p class="muted">Cập nhật lúc {{ dateTime(updatedAt) }} <span v-if="stale">· Đang xem bản lưu</span></p>
    <div class="facts"><span v-for="(value, label) in { 'Duyệt đơn': order.approval?.label, 'Xử lý hàng': order.processing?.label, 'Thanh toán': order.payment?.label, 'Vận chuyển': order.delivery?.label }" :key="label"><small>{{ label }}</small><b>{{ value || 'Chưa có thông tin' }}</b></span></div>
    <h3>Người đặt và giao hàng</h3><p>Người đặt: {{ order.orderedBy || 'Chưa có thông tin' }} · Phụ trách: {{ order.owner || 'Chưa có thông tin' }}</p><p>{{ order.recipient?.name }} · {{ order.recipient?.phone }}<br>{{ order.recipient?.address || 'Chưa có thông tin' }}</p>
    <p>Ngày khách mong muốn: {{ order.desiredDate || 'Chưa có thông tin' }}<br>Ngày đã xác nhận giao: {{ order.confirmedDeliveryDate || 'Chưa có thông tin' }}</p>
    <h3>Sản phẩm</h3><article v-for="(line, i) in order.lines" :key="i" class="line"><b>{{ line.name }}</b><p>{{ line.variant }} · {{ line.quantity }} {{ line.unit }} · {{ money(line.unitPrice) }} <span v-if="line.kind === 'custom'">· Hàng đặt riêng · Giá đề xuất: {{ money(line.proposedPrice) }}</span></p><dl><template v-for="(value, key) in line.specifications" :key="key"><dt>{{ key }}</dt><dd>{{ value || 'Chưa có thông tin' }}</dd></template></dl><p v-for="file in line.attachments" :key="file.mediaId">Tài liệu: {{ file.name }}</p></article>
    <h3>Tiền hàng</h3><dl class="amounts"><template v-for="(value, label) in { 'Tiền hàng': order.amounts?.subtotal, 'Giảm giá': order.amounts?.discount, 'Phí giao': order.amounts?.shipping, 'Thuế': order.amounts?.tax, 'Tổng đơn': order.total, 'Tiền cọc': order.amounts?.deposit, 'Đã thu': order.amounts?.collected, 'Đã hoàn': order.amounts?.refunded, 'Còn phải thu': order.amounts?.due }" :key="label"><dt>{{ label }}</dt><dd>{{ money(value) }}</dd></template></dl>
    <h3>Lịch sử thu và hoàn tiền</h3><p v-if="!order.payments?.length" class="muted">Chưa có thông tin</p><p v-for="p in order.payments" :key="p.id">{{ dateTime(p.date) }} · {{ p.type }} · {{ money(p.amount) }} · {{ p.note }}</p>
    <h3>Sản xuất và lắp đặt</h3><p v-if="!order.production?.length" class="muted">Chưa có thông tin</p><p v-for="(p, i) in order.production" :key="i">{{ dateTime(p.date) }} · {{ p.label }} · {{ p.note }}</p>
    <h3>Các đợt giao hàng</h3><p v-if="!order.shipments?.length" class="muted">Chưa có thông tin</p><article v-for="s in order.shipments" :key="s.id" class="line"><b>{{ s.carrier }} · {{ s.trackingCode }} · {{ s.status }}</b><p v-if="safeLink(s.trackingUrl)"><a :href="safeLink(s.trackingUrl)" target="_blank" rel="noopener noreferrer">Tra cứu vận đơn ↗</a></p><p v-for="(l, i) in s.lines" :key="i">{{ l.name }} · {{ l.quantity }} {{ l.unit }}</p><p v-for="(h, i) in s.history" :key="i">{{ dateTime(h.date) }} · {{ h.label }} · {{ h.note }}</p></article>
    <h3>Hàng trả lại</h3><p v-if="!order.returns?.length" class="muted">Chưa có thông tin</p><article v-for="r in order.returns" :key="r.id" class="line"><b>{{ r.status }} · Hoàn {{ money(r.refunded) }}</b><p v-for="(l, i) in r.lines" :key="i">{{ l.name }} · {{ l.quantity }} {{ l.unit }}</p></article>
  </section>
</template>
<script setup lang="ts">
import { dateTime, money, safeLink, type Order } from '@/api/commerce';
defineProps<{ order: Order; updatedAt: string; stale?: boolean }>(); defineEmits<{ close: [] }>();
</script>
<style scoped>
.order-detail{font-size:13px;line-height:1.5}.order-detail header{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.order-detail h3{font-size:14px;margin:22px 0 8px}.muted{color:#64748b}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:8px}.facts span,.line{padding:10px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px}.facts small,.facts b{display:block}dl{display:grid;grid-template-columns:1fr 1fr;gap:4px}dd{margin:0;text-align:right;overflow-wrap:anywhere}button,a{color:#087b92}button{border:1px solid #d9e5eb;border-radius:6px;padding:6px 9px}
</style>
