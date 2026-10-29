// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ api: Object.fromEntries(['links','overview','orders','drafts','search','link','save','order','createCustomer'].map(k => [k, vi.fn()])), can: vi.fn() }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ canAccess: m.can }) }));
vi.mock('@/api/commerce', async original => ({ ...await original<any>(), commerceApi: m.api }));
import PurchasePanel from './PurchasePanel.vue';
const customer = (id: string) => ({ id, name: `Khách sạn ${id}`, code: id, kind: 'hotel', contacts: [], addresses: [] });
const overview = (id: string) => ({ data: { customer: customer(id), summary: { orderCount: 3, netSales: 1000000, collected: 500000, due: 500000, activeOrderCount: 1 } }, updatedAt: '2026-10-29T01:00:00Z', stale: false });
const render = (id: string, extra: Record<string, unknown> = {}) => mount(PurchasePanel, { props: { contactId: id, ...extra }, global: { stubs: { Teleport: true, RouterLink: { template: '<a><slot /></a>' }, OrderDraftEditor: true } } });
beforeEach(() => { vi.clearAllMocks(); m.can.mockReturnValue(true); m.api.links.mockResolvedValue([]); m.api.drafts.mockResolvedValue({ items: [], nextCursor: null }); m.api.orders.mockResolvedValue({ data: { items: [], nextCursor: null }, updatedAt: '', stale: false }); });
afterEach(() => { vi.useRealTimers(); });
describe('Purchasing panel', () => {
  it('shows an explicit linking step without fabricated orders', async () => { const w = render('contact'); await flushPromises(); expect(w.text()).toContain('Chưa liên kết với khách trong CRM'); expect(w.find('form').exists()).toBe(false); expect(m.api.overview).not.toHaveBeenCalled(); w.unmount(); });
  it('does not read purchases without the separate permission', async () => { m.can.mockReturnValue(false); const w = render('contact'); await flushPromises(); expect(w.text()).toContain('chưa được cấp quyền'); expect(m.api.links).not.toHaveBeenCalled(); w.unmount(); });
  it('does not infer the buyer from a group conversation', async () => { const w = render('group-contact', { requireContactSelection: true }); await flushPromises(); expect(w.text()).toContain('Chọn người liên hệ'); expect(m.api.links).not.toHaveBeenCalled(); w.unmount(); });
  it('requires choosing a hotel explicitly when there are multiple links', async () => { m.api.links.mockResolvedValue([{ id: 'l1', customerId: 'h1', customerName: 'A' }, { id: 'l2', customerId: 'h2', customerName: 'B' }]); const w = render('contact'); await flushPromises(); expect(m.api.overview).not.toHaveBeenCalled(); expect(w.find('select').element.value).toBe(''); w.unmount(); });
  it('ignores a late response for the previous customer', async () => { let resolveFirst!: (value: unknown) => void; m.api.links.mockResolvedValue([{ id: 'l', customerId: 'hotel', customerName: 'Hotel' }]); m.api.overview.mockImplementation((id: string) => id === 'old' ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve(overview('new'))); const w = render('old'); await flushPromises(); await w.setProps({ contactId: 'new' }); await flushPromises(); resolveFirst(overview('old')); await flushPromises(); expect(w.text()).toContain('Khách sạn new'); expect(w.text()).not.toContain('Khách sạn old'); w.unmount(); });
  it('labels stale cached information instead of showing it as current', async () => { m.api.links.mockResolvedValue([{ id: 'l', customerId: 'hotel', customerName: 'Hotel' }]); m.api.overview.mockResolvedValue({ ...overview('hotel'), stale: true, error: 'CRM mất kết nối' }); const w = render('contact'); await flushPromises(); expect(w.text()).toContain('Bản lưu gần nhất'); expect(w.text()).toContain('CRM mất kết nối'); w.unmount(); });
  it('shows at most three orders in chat and opens the full list in one workspace', async () => {
    m.api.links.mockResolvedValue([{ id: 'l', customerId: 'hotel', customerName: 'Hotel' }]);
    m.api.overview.mockResolvedValue(overview('hotel'));
    const state = { code: 'active', label: 'Đang xử lý' };
    m.api.orders.mockResolvedValue({ data: { items: Array.from({length: 5}, (_, i) => ({ id: String(i), code: 'DH'+i, total: 100000, processing: state, delivery: state, approval: state })), nextCursor: null }, updatedAt: '', stale: false });
    const w = render('contact', { compact: true }); await flushPromises();
    expect(w.findAll('.jf-recent-orders .jf-list-row')).toHaveLength(3);
    await w.findAll('button').find(b => b.text().startsWith('Xem tất cả đơn'))!.trigger('click');
    expect(w.findAll('[role="dialog"]')).toHaveLength(1);
    expect(w.find('[role="dialog"]').findAll('.jf-list-row')).toHaveLength(5);
    expect(w.emitted('workspaceChange')?.at(-1)).toEqual([true]);
    await w.find('[aria-label="Đóng cửa sổ mua hàng"]').trigger('click'); await flushPromises();
    expect(w.find('[role="dialog"]').exists()).toBe(false);
    expect(w.emitted('workspaceChange')?.at(-1)).toEqual([false]); w.unmount();
  });
  it('runs confirmation explicitly before creating a customer link', async () => { m.api.search.mockResolvedValue({ items: [customer('h')], nextCursor: null }); m.api.link.mockResolvedValue({}); const w = render('contact'); await flushPromises(); await w.findAll('button').find(b => b.text() === 'Chọn khách')!.trigger('click'); await flushPromises(); await w.find('form.jf-search').trigger('submit'); await flushPromises(); await w.findAll('button').find(b => b.text() === 'Chọn')!.trigger('click'); await flushPromises(); const button = w.findAll('button').find(b => b.text() === 'Xác nhận liên kết')!; expect(button.attributes('disabled')).toBeDefined(); await w.find('input[type="checkbox"]').setValue(true); const enabled = w.findAll('button').find(b => b.text() === 'Xác nhận liên kết')!; expect(enabled.attributes('disabled')).toBeUndefined(); await enabled.trigger('click'); await flushPromises(); expect(m.api.link).toHaveBeenCalledWith('contact', { customerId: 'h', crmContactId: undefined, confirmed: true }); w.unmount(); });
});
