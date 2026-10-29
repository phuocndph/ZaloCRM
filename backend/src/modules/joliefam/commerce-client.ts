// SPDX-License-Identifier: AGPL-3.0-or-later
import { contract, customerValid, summaryValid, productValid, pageValid, orderValid, orderSummaryValid } from './commerce-contract.js';
import { CommerceError, safeLink, type Customer, type Product, type Page, type Order, type OrderSummary, type Summary, type DraftInput, type Quote } from './commerce-domain.js';

export const CRM_ORIGIN = 'https://crm.joliefam.vn';
// Versioned, documented contract. No cookies or browser session are used.
export class JoliefamClient {
  constructor(private token: string, private basePath = '/api/zcrm/v1', private transport: typeof fetch = fetch) {
    if (!/^\/api\/[a-zA-Z0-9/_-]{1,100}$/.test(basePath) || basePath.includes('..') || basePath.includes('//')) throw new CommerceError('Đường dẫn kết nối phải bắt đầu bằng /api/.');
  }
  async request<T>(path: string, options: { method?: string; body?: unknown; key?: string } = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.transport(CRM_ORIGIN + this.basePath + path, {
        method: options.method ?? 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.key ? { 'Idempotency-Key': options.key } : {}) },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch { throw new CommerceError('Chưa xác nhận được phản hồi CRM. Có thể kiểm tra và thử lại.', 502, 'CRM_UNAVAILABLE'); }
    if (!response.ok) {
      const status = response.status;
      const codes: Record<number, [string, string]> = { 401: ['Khóa kết nối CRM không hợp lệ.', 'CRM_UNAUTHORIZED'], 403: ['CRM chưa cấp quyền thực hiện thao tác này.', 'CRM_FORBIDDEN'], 404: ['CRM chưa có cổng kết nối hoặc không tìm thấy dữ liệu.', 'CRM_NOT_FOUND'], 409: ['Đơn hoặc giá đã thay đổi. Hãy cập nhật và kiểm tra lại.', 'CRM_CONFLICT'], 422: ['CRM yêu cầu bổ sung thông tin đơn. Hãy kiểm tra sản phẩm, quy cách và người nhận.', 'CRM_VALIDATION'], 429: ['CRM đang bận. Vui lòng thử lại sau.', 'CRM_BUSY'] };
      const [message, code] = codes[status] ?? ['Chưa nhận được kết quả hợp lệ từ CRM.', 'CRM_UNAVAILABLE'];
      throw new CommerceError(message, [409, 422].includes(status) ? status : 502, code);
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > 2_000_000) throw new CommerceError('Phản hồi CRM quá lớn.', 502, 'CRM_CONTRACT_INVALID');
    // Bound streamed responses too; do not trust content-length.
    const reader = response.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    if (!reader) throw new CommerceError('CRM không trả dữ liệu.', 502, 'CRM_CONTRACT_INVALID');
    try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2_000_000) { await reader.cancel(); throw new Error(); } chunks.push(part.value); } return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T; }
    catch { throw new CommerceError('Dữ liệu CRM không đúng định dạng kết nối.', 502, 'CRM_CONTRACT_INVALID'); }
  }
  capabilities() { return this.request<{ version: 1; capabilities: string[] }>('/capabilities'); }
  async customers(q: string, cursor = '') { const data = await this.request<Page<Customer>>('/customers?' + new URLSearchParams({ q, cursor, limit: '20' })); contract(pageValid(data, customerValid)); return data; }
  async customer(id: string) { const c = await this.request<Customer>(`/customers/${encodeURIComponent(id)}`); contract(customerValid(c) && c.id === id); return { ...c, url: safeLink(c.url) ?? undefined }; }
  async createCustomer(body: unknown, key: string) { const data = await this.request<Customer>('/customers', { method: 'POST', body, key }); contract(customerValid(data)); return data; }
  async summary(id: string) { const data = await this.request<Summary>(`/customers/${encodeURIComponent(id)}/summary`); contract(summaryValid(data)); return data; }
  async orders(id: string, filters: Record<string, string>) { const data = await this.request<Page<OrderSummary>>(`/customers/${encodeURIComponent(id)}/orders?` + new URLSearchParams({ ...filters, limit: '20' })); contract(pageValid(data, o => orderSummaryValid(o) && o.customerId === id)); return data; }
  async order(customerId: string, id: string) {
    const order = await this.request<Order>(`/customers/${encodeURIComponent(customerId)}/orders/${encodeURIComponent(id)}`);
    if (!orderValid(order) || order.id !== id || order.customerId !== customerId) throw new CommerceError('Đơn CRM không khớp khách hàng.', 502, 'CRM_CONTRACT_INVALID');
    return order;
  }
  async products(q: string, cursor = '') { const data = await this.request<Page<Product>>('/products?' + new URLSearchParams({ q, cursor, limit: '20' })); contract(pageValid(data, productValid)); return data; }
  quote(draft: DraftInput, fingerprint: string, actorId: string) { return this.request<Quote>('/quotes', { method: 'POST', body: { draft, fingerprint, actorId, source: 'ZCRM' } }); }
  async lookup(key: string) { const data = await this.request<{ found: boolean; order?: Order; approver?: string; rejection?: string }>('/requests/' + encodeURIComponent(key)); contract(typeof data?.found === 'boolean' && (!data.found || orderValid(data.order))); return data; }
  submit(draft: DraftInput, quote: Quote, key: string, actorId: string, existingOrderId: string | null, attachments: unknown[] = []) { return this.request<{ order: Order; approver?: string }>('/draft-orders', { method: 'POST', key, body: { draft, quoteToken: quote.token, fingerprint: quote.fingerprint, actorId, source: 'ZCRM', existingOrderId, attachments } }); }
}
