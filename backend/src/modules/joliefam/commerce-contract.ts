// SPDX-License-Identifier: AGPL-3.0-or-later
import { CommerceError } from './commerce-domain.js';
const record = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: any, max = 2000) => typeof v === 'string' && v.length <= max;
const id = (v: any) => str(v, 128) && v.trim().length > 0;
const money = (v: any) => Number.isSafeInteger(v) && v >= 0;
const date = (v: any) => str(v, 50) && Number.isFinite(Date.parse(v));
const array = (v: any, max: number, check: (v: any) => boolean) => Array.isArray(v) && v.length <= max && v.every(check);
const status = (v: any) => record(v) && id(v.code) && str(v.label, 200);
const address = (v: any) => record(v) && str(v.name, 200) && str(v.phone, 40) && str(v.address, 2000);
export function contract(ok: unknown): asserts ok { if (!ok) throw new CommerceError('CRM trả dữ liệu thiếu hoặc sai định dạng. Cần kiểm tra tài liệu kết nối.', 502, 'CRM_CONTRACT_INVALID'); }
export const customerValid = (v: any) => record(v) && id(v.id) && str(v.code, 128) && str(v.name, 200) && ['hotel','individual'].includes(v.kind) && array(v.contacts, 500, c => record(c) && id(c.id) && str(c.name, 200) && (c.phone === undefined || str(c.phone, 40))) && array(v.addresses, 500, address);
export const summaryValid = (v: any) => record(v) && v.currency === 'VND' && ['orderCount','netSales','collected','due','activeOrderCount'].every(k => money(v[k]));
export const productValid = (v: any) => record(v) && id(v.id) && str(v.name, 200) && str(v.sku, 128) && ['stock','custom'].includes(v.kind) && str(v.unit, 30) && (v.price === null || money(v.price)) && (v.available === null || typeof v.available === 'number' && Number.isFinite(v.available)) && date(v.updatedAt) && array(v.requiredFields, 30, k => str(k, 80));
export function pageValid(v: any, check: (value: any) => boolean) { return record(v) && array(v.items, 20, check) && (v.nextCursor === null || str(v.nextCursor, 500)); }
const lineValid = (v: any) => record(v) && id(v.productId) && str(v.name, 200) && ['stock','custom'].includes(v.kind) && typeof v.quantity === 'number' && Number.isFinite(v.quantity) && v.quantity > 0 && str(v.unit, 30) && (v.unitPrice === undefined || money(v.unitPrice)) && (v.proposedPrice === null || money(v.proposedPrice)) && record(v.specifications) && Object.entries(v.specifications).length <= 30 && Object.entries(v.specifications).every(([k, val]) => str(k, 80) && str(val, 2000)) && array(v.attachments, 10, a => record(a) && id(a.mediaId) && str(a.name, 200));
export function orderSummaryValid(v: any): boolean {
  return record(v) && id(v.id) && id(v.customerId) && str(v.code, 128) && Number.isSafeInteger(v.version) && v.version > 0 && date(v.updatedAt) && v.currency === 'VND' && money(v.total) && ['approval','processing','payment','delivery'].every(k => status(v[k]));
}
export function orderValid(v: any): boolean {
  return orderSummaryValid(v) && array(v.lines, 100, lineValid)
    && (v.recipient === undefined || address(v.recipient)) && record(v.amounts) && ['subtotal','discount','shipping','tax','deposit','collected','refunded','due'].every(k => money(v.amounts[k]))
    && array(v.payments, 1000, p => record(p) && id(p.id) && date(p.date) && str(p.type) && money(p.amount))
    && array(v.production, 1000, p => record(p) && date(p.date) && str(p.label))
    && array(v.shipments, 500, s => record(s) && id(s.id) && str(s.carrier) && str(s.trackingCode) && str(s.status) && array(s.lines, 100, l => record(l) && str(l.name) && typeof l.quantity === 'number' && Number.isFinite(l.quantity) && str(l.unit)) && array(s.history, 1000, h => record(h) && date(h.date) && str(h.label)))
    && array(v.returns, 500, r => record(r) && id(r.id) && str(r.status) && money(r.refunded) && array(r.lines, 100, l => record(l) && str(l.name) && typeof l.quantity === 'number' && Number.isFinite(l.quantity) && str(l.unit)));
}
