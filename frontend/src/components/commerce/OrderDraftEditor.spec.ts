// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ save: vi.fn(), quote: vi.fn(), submit: vi.fn(), check: vi.fn() }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ canAccess: () => true }) }));
vi.mock('@/api/commerce', async original => ({ ...await original<any>(), commerceApi: m }));
import OrderDraftEditor from './OrderDraftEditor.vue';
const makeDraft = (status = 'local') => ({ id: 'draft', contactId: 'contact', revision: 1, status, input: { customerId: 'hotel', orderedBy: 'Người đặt', recipient: { name: 'Người nhận', phone: '0901234567', address: 'Khách sạn' }, desiredDate: '', notes: '', lines: [] }, quote: null, updatedAt: '2026-10-29T01:00:00Z' } as any);
beforeEach(() => vi.clearAllMocks()); afterEach(() => vi.useRealTimers());
describe('Draft editor', () => {
  it('renders Vue-reactive draft props without structuredClone errors', async () => { const w = mount(OrderDraftEditor, { props: { contactId: 'contact', initial: makeDraft(), links: [] } }); expect(w.text()).toContain('Đơn nháp mới'); w.unmount(); });
  it('autosaves changes to the original contact and clears the old quote', async () => { vi.useFakeTimers(); const d = makeDraft(); m.save.mockImplementation(async (_id: string, body: any) => ({ ...d, input: body.input, revision: 2 })); const w = mount(OrderDraftEditor, { props: { contactId: 'contact', initial: d, links: [] } }); const notes = w.findAll('textarea').at(-1)!; await notes.setValue('Ghi chú mới'); await vi.advanceTimersByTimeAsync(1600); await flushPromises(); expect(m.save).toHaveBeenCalledWith('contact', expect.objectContaining({ input: expect.objectContaining({ notes: 'Ghi chú mới' }), revision: 1 }), 'draft'); expect(w.text()).toContain('Đã lưu nháp'); w.unmount(); });
  it('locks editing after submission and exposes a result check', async () => { const w = mount(OrderDraftEditor, { props: { contactId: 'contact', initial: makeDraft('submitted'), links: [] } }); expect(w.find('fieldset').attributes('disabled')).toBeDefined(); expect(w.text()).toContain('Kiểm tra kết quả trong CRM'); expect(w.text()).not.toContain('Gửi CRM chờ duyệt'); w.unmount(); });
  it('does not enable sending without explicit confirmation of a saved quote', async () => { const d = makeDraft(); d.quote = { token: 'q', total: 100000, subtotal: 100000, discount: 0, shipping: 0, tax: 0, warnings: [], expiresAt: '2026-12-01T00:00:00Z' }; const w = mount(OrderDraftEditor, { props: { contactId: 'contact', initial: d, links: [] } }); const send = w.findAll('button').find(b => b.text() === 'Gửi CRM chờ duyệt')!; expect(send.attributes('disabled')).toBeDefined(); await w.find('input[type="checkbox"]').setValue(true); expect(send.attributes('disabled')).toBeUndefined(); w.unmount(); });
});
