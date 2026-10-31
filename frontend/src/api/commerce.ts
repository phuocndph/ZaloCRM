// SPDX-License-Identifier: AGPL-3.0-or-later
import { api } from '@/api/index';
export type Address = { id?: string; name: string; phone: string; address: string };
export type Customer = { id: string; code: string; name: string; phone?: string; kind: 'hotel' | 'individual'; contacts: Array<{ id: string; name: string; phone?: string }>; addresses: Address[]; url?: string };
export type Product = { id: string; name: string; sku: string; kind: 'stock' | 'custom'; unit: string; price: number | null; variant?: string; warehouseId?: string; warehouseName?: string; available: number | null; updatedAt: string; requiredFields: string[] };
export type DraftLine = { productId: string; name: string; kind: 'stock' | 'custom'; variant?: string; warehouseId?: string; quantity: number; unit: string; proposedPrice: number | null; specifications: Record<string, string>; attachments: Array<{ name: string; mediaId: string }> };
export type DraftInput = { customerId: string | null; newCustomer?: { name: string; phone: string; kind: 'hotel' | 'individual' }; orderedBy: string; recipient: Address; desiredDate: string; notes: string; lines: DraftLine[] };
export type Quote = { token: string; expiresAt: string; fingerprint: string; currency: 'VND'; subtotal: number; discount: number; shipping: number; tax: number; total: number; warnings: string[]; lines: Array<{ productId: string; quantity: number; unitPrice: number; total: number }> };
export type Status = { code: string; label: string };
export type Order = { id: string; customerId: string; code: string; version: number; updatedAt: string; url?: string; approval: Status; processing: Status; payment: Status; delivery: Status; total: number; currency: 'VND'; orderedBy?: string; recipient?: Address; owner?: string; confirmedDeliveryDate?: string; desiredDate?: string; lines: Array<DraftLine & { unitPrice?: number }>; amounts: { subtotal: number; discount: number; shipping: number; tax: number; deposit: number; collected: number; refunded: number; due: number }; payments: Array<{ id: string; date: string; type: string; amount: number; note?: string }>; production: Array<{ date: string; label: string; note?: string }>; shipments: Array<{ id: string; carrier: string; trackingCode: string; trackingUrl?: string; status: string; lines: Array<{ name: string; quantity: number; unit: string }>; history: Array<{ date: string; label: string; note?: string }> }>; returns: Array<{ id: string; status: string; refunded: number; lines: Array<{ name: string; quantity: number; unit: string }> }> };
export type OrderSummary = Pick<Order, 'id' | 'customerId' | 'code' | 'version' | 'updatedAt' | 'currency' | 'total' | 'approval' | 'processing' | 'payment' | 'delivery'>;
export type Summary = { orderCount: number; netSales: number; collected: number; due: number; activeOrderCount: number; currency: 'VND' };
export type Page<T> = { items: T[]; nextCursor: string | null };
export type Snapshot<T> = { data: T; updatedAt: string; stale: boolean; error?: string };
export type Link = { id: string; contactId: string; customerId: string; customerName: string; crmContactId?: string };
export type Draft = { id: string; contactId: string; revision: number; input: DraftInput; quote: Quote | null; status: 'local' | 'returned' | 'submitted' | 'submitting' | 'uncertain' | 'closed'; crmOrderId?: string; crmOrderCode?: string; approver?: string; lastError?: string; updatedAt: string };
export type Settings = { enabled: boolean; basePath: string; hasToken: boolean; hasWebhookSecret: boolean; actorMap: Record<string, string>; testedAt?: string; lastSyncAt?: string; lastError?: string; encryptionReady: boolean; webhookPath: string };
const path = (id: string) => `/joliefam/contacts/${encodeURIComponent(id)}`;
const unwrap = <T>(p: Promise<{ data: T }>) => p.then(r => r.data);
export const commerceApi = {
  settings: () => unwrap(api.get<Settings>('/joliefam/settings')),
  saveSettings: (body: unknown) => unwrap(api.put<Settings>('/joliefam/settings', body)),
  test: () => unwrap(api.post('/joliefam/settings/test')),
  profile: (id: string) => unwrap(api.get<{ contact: { id: string; displayName: string; fullName?: string; phone?: string; email?: string; addressLine?: string; occupation?: string; phonesExtra?: Array<{ phone: string; label: string }> } }>(path(id) + '/profile')),
  links: (id: string) => unwrap(api.get<Link[]>(path(id) + '/links')),
  search: (id: string, q: string, cursor = '') => unwrap(api.get<Page<Customer>>(path(id) + '/search', { params: { q, cursor } })),
  link: (id: string, body: unknown) => unwrap(api.post<Link>(path(id) + '/links', body)),
  unlink: (id: string, customerId: string) => unwrap(api.delete(path(id) + '/links/' + encodeURIComponent(customerId))),
  createCustomer: (id: string, body: unknown) => unwrap(api.post<Link>(path(id) + '/customers', body)),
  overview: (id: string, customer: string, refresh = false) => unwrap(api.get<Snapshot<{ customer: Customer; summary: Summary }>>(path(id) + `/customers/${encodeURIComponent(customer)}/overview`, { params: { refresh } })),
  orders: (id: string, customer: string, params: Record<string, string | boolean>) => unwrap(api.get<Snapshot<Page<OrderSummary>>>(path(id) + `/customers/${encodeURIComponent(customer)}/orders`, { params })),
  order: (id: string, customer: string, orderId: string, refresh = false) => unwrap(api.get<Snapshot<Order>>(path(id) + `/customers/${encodeURIComponent(customer)}/orders/${encodeURIComponent(orderId)}`, { params: { refresh } })),
  products: (id: string, q: string, cursor = '') => unwrap(api.get<Page<Product>>(path(id) + '/products', { params: { q, cursor } })),
  drafts: (id: string, cursor = '') => unwrap(api.get<Page<Draft>>(path(id) + '/drafts', { params: { cursor } })),
  save: (id: string, body: unknown, draftId?: string) => unwrap(draftId ? api.put<Draft>(path(id) + '/drafts/' + encodeURIComponent(draftId), body) : api.post<Draft>(path(id) + '/drafts', body)),
  quote: (id: string, d: Draft) => unwrap(api.post<Draft>(path(id) + `/drafts/${d.id}/quote`, { revision: d.revision })),
  submit: (id: string, d: Draft) => unwrap(api.post<Draft>(path(id) + `/drafts/${d.id}/submit`, { revision: d.revision, quoteToken: d.quote?.token, confirmed: true })),
  check: (id: string, d: Draft) => unwrap(api.post<Draft>(path(id) + `/drafts/${d.id}/check`)),
};
export const purchaseError = (e: any) => e?.response?.data?.error || 'Chưa tải được thông tin. Anh thử lại nhé.';
export const money = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(n) : 'Chưa có thông tin';
export const dateTime = (s?: string) => s && Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleString('vi-VN') : 'Chưa có thông tin';
export function safeLink(s?: string) { try { const u = new URL(s || ''); return u.protocol === 'https:' && !u.username && !u.password ? u.href : undefined; } catch { return undefined; } }
