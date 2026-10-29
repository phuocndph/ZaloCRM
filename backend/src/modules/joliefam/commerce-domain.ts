// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';

export class CommerceError extends Error {
  constructor(message: string, public statusCode = 400, public code = 'COMMERCE_INVALID_INPUT') { super(message); }
}
export type Actor = { orgId: string; userId: string; role: string };
export type Address = { id?: string; name: string; phone: string; address: string };
export type Customer = { id: string; code: string; name: string; phone?: string; kind: 'hotel' | 'individual'; contacts: Array<{ id: string; name: string; phone?: string }>; addresses: Address[]; url?: string };
export type OrderStatus = { code: string; label: string };
export type Product = { id: string; name: string; sku: string; kind: 'stock' | 'custom'; unit: string; price: number | null; variant?: string; warehouseId?: string; warehouseName?: string; available: number | null; updatedAt: string; requiredFields: string[] };
export type DraftLine = { productId: string; name: string; kind: 'stock' | 'custom'; variant?: string; warehouseId?: string; quantity: number; unit: string; proposedPrice: number | null; specifications: Record<string, string>; attachments: Array<{ name: string; mediaId: string }> };
export type DraftInput = { customerId: string | null; newCustomer?: { name: string; phone: string; kind: 'hotel' | 'individual' }; orderedBy: string; recipient: Address; desiredDate: string; notes: string; lines: DraftLine[] };
export type Quote = { token: string; expiresAt: string; fingerprint: string; currency: 'VND'; subtotal: number; discount: number; shipping: number; tax: number; total: number; warnings: string[]; lines: Array<{ productId: string; quantity: number; unitPrice: number; total: number }> };
export type Order = { id: string; customerId: string; code: string; version: number; updatedAt: string; url?: string; approval: OrderStatus; processing: OrderStatus; payment: OrderStatus; delivery: OrderStatus; total: number; currency: 'VND'; orderedBy?: string; recipient?: Address; owner?: string; confirmedDeliveryDate?: string; desiredDate?: string; lines: Array<DraftLine & { unitPrice?: number }>; amounts: { subtotal: number; discount: number; shipping: number; tax: number; deposit: number; collected: number; refunded: number; due: number }; payments: Array<{ id: string; date: string; type: string; amount: number; note?: string }>; production: Array<{ date: string; label: string; note?: string }>; shipments: Array<{ id: string; carrier: string; trackingCode: string; trackingUrl?: string; status: string; lines: Array<{ name: string; quantity: number; unit: string }>; history: Array<{ date: string; label: string; note?: string }> }>; returns: Array<{ id: string; status: string; refunded: number; lines: Array<{ name: string; quantity: number; unit: string }> }> };
export type OrderSummary = Pick<Order, 'id' | 'customerId' | 'code' | 'version' | 'updatedAt' | 'currency' | 'total' | 'approval' | 'processing' | 'payment' | 'delivery'>;
export type Summary = { orderCount: number; netSales: number; collected: number; due: number; activeOrderCount: number; currency: 'VND' };
export type Page<T> = { items: T[]; nextCursor: string | null };

export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CommerceError('Dữ liệu không hợp lệ.');
  return value as Record<string, any>;
}
export function text(value: unknown, max = 200, required = false): string {
  if (value === undefined || value === null) { if (required) throw new CommerceError('Thiếu thông tin bắt buộc.'); return ''; }
  if (typeof value !== 'string' || value.includes('\0') || value.length > max || (required && !value.trim())) throw new CommerceError('Thông tin nhập không hợp lệ hoặc quá dài.');
  return value.trim();
}
export function identifier(value: unknown): string { return text(value, 128, true); }
export function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new CommerceError('Phiên bản dữ liệu không hợp lệ.');
  return value as number;
}
export function parseDraft(value: unknown): DraftInput {
  const data = object(value), recipient = object(data.recipient ?? {});
  if (!Array.isArray(data.lines) || data.lines.length > 100) throw new CommerceError('Mỗi đơn tối đa 100 dòng sản phẩm.');
  const lines = data.lines.map((raw: unknown): DraftLine => {
    const line = object(raw);
    if (!['stock', 'custom'].includes(line.kind) || !Number.isFinite(line.quantity) || line.quantity <= 0 || line.quantity > 1e7) throw new CommerceError('Loại hàng hoặc số lượng không hợp lệ.');
    if (line.proposedPrice !== null && line.proposedPrice !== undefined && (!Number.isSafeInteger(line.proposedPrice) || line.proposedPrice < 0 || line.proposedPrice > 1e12)) throw new CommerceError('Giá đề xuất phải là số tiền VND hợp lệ.');
    const specifications = object(line.specifications ?? {});
    if (Object.keys(specifications).length > 30) throw new CommerceError('Quá nhiều thông tin quy cách.');
    const specs = Object.fromEntries(Object.entries(specifications).map(([k, v]) => [text(k, 80, true), text(v, 2000)]));
    const attachments = line.attachments ?? [];
    if (!Array.isArray(attachments) || attachments.length > 10) throw new CommerceError('Tối đa 10 tài liệu cho một dòng hàng.');
    return { productId: text(line.productId, 128), name: text(line.name, 200), kind: line.kind, variant: text(line.variant, 200), warehouseId: text(line.warehouseId, 128), quantity: line.quantity, unit: text(line.unit, 30), proposedPrice: line.proposedPrice ?? null, specifications: specs, attachments: attachments.map((a: unknown) => { const doc = object(a); return { name: text(doc.name, 200, true), mediaId: identifier(doc.mediaId) }; }) };
  });
  const desiredDate = text(data.desiredDate, 10);
  if (desiredDate && (!/^\d{4}-\d{2}-\d{2}$/.test(desiredDate) || (!Number.isFinite(Date.parse(desiredDate)) || new Date(desiredDate).toISOString().slice(0, 10) !== desiredDate))) throw new CommerceError('Ngày mong muốn không hợp lệ.');
  let newCustomer: DraftInput['newCustomer'];
  if (data.newCustomer) { const c = object(data.newCustomer); if (!['hotel', 'individual'].includes(c.kind)) throw new CommerceError('Loại khách chưa đúng.'); newCustomer = { name: text(c.name, 200), phone: text(c.phone, 40), kind: c.kind }; }
  return { customerId: data.customerId ? identifier(data.customerId) : null, ...(newCustomer ? { newCustomer } : {}), orderedBy: text(data.orderedBy, 200), recipient: { name: text(recipient.name, 200), phone: text(recipient.phone, 40), address: text(recipient.address, 2000) }, desiredDate, notes: text(data.notes, 5000), lines };
}
export function validateSubmission(draft: DraftInput): void {
  if (!draft.customerId) throw new CommerceError('Cần liên kết hoặc tạo khách trong CRM trước khi gửi.');
  if (!draft.orderedBy || !draft.recipient.name || !draft.recipient.phone || !draft.recipient.address || !draft.lines.length) throw new CommerceError('Cần đủ người đặt, người nhận, điện thoại, địa chỉ và sản phẩm.');
  for (const line of draft.lines) {
    if (!line.productId || !line.unit || (line.kind === 'custom' && line.proposedPrice === null)) throw new CommerceError('Cần chọn sản phẩm, đơn vị tính và giá đề xuất cho hàng đặt riêng.');
  }
}
export function fingerprint(draft: DraftInput): string { return createHash('sha256').update(JSON.stringify(draft)).digest('hex'); }
export function validateQuote(quote: Quote, draft: DraftInput): void {
  if (!quote?.token || quote.fingerprint !== fingerprint(draft) || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= Date.now()) throw new CommerceError('Giá đã hết hạn hoặc đơn đã đổi. Vui lòng kiểm tra giá lại.', 409, 'QUOTE_EXPIRED');
  if (quote.currency !== 'VND' || ![quote.subtotal, quote.discount, quote.shipping, quote.tax, quote.total].every(n => Number.isSafeInteger(n) && n >= 0) || quote.total !== quote.subtotal - quote.discount + quote.shipping + quote.tax) throw new CommerceError('CRM trả về bảng tính tiền không hợp lệ.', 502, 'CRM_CONTRACT_INVALID');
  if (!Array.isArray(quote.warnings) || quote.warnings.length > 100 || quote.warnings.some(w => typeof w !== 'string' || w.length > 2000) || !Array.isArray(quote.lines) || quote.lines.length !== draft.lines.length || quote.lines.some((l, i) => !l || l.productId !== draft.lines[i].productId || l.quantity !== draft.lines[i].quantity || !Number.isSafeInteger(l.unitPrice) || l.unitPrice < 0 || !Number.isSafeInteger(l.total) || l.total !== Math.round(l.quantity * l.unitPrice)) || quote.lines.reduce((sum, l) => sum + l.total, 0) !== quote.subtotal) throw new CommerceError('Chi tiết bảng giá không khớp sản phẩm trong đơn.', 502, 'CRM_CONTRACT_INVALID');
}
export function safeLink(value: unknown): string | null {
  try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
