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
  it('keeps the form open with its values when saving on close fails', async () => {
    m.save.mockRejectedValue(new Error('offline'));
    const w = mount(OrderDraftEditor, { props: { contactId: 'contact', initial: makeDraft(), links: [] } });
    await w.findAll('textarea').at(-1)!.setValue('Giữ lại nội dung này');
    expect(await (w.vm as any).prepareClose()).toBe(false);
    expect(w.findAll('textarea').at(-1)!.element.value).toBe('Giữ lại nội dung này');
    expect(w.find('[role="alert"]').exists()).toBe(true);
    m.save.mockResolvedValue(makeDraft());
    w.unmount();
  });
  it('waits for a pending save and saves changes made during it before closing', async () => {
    let resolve!: (value: unknown) => void;
    const d = makeDraft();
    m.save.mockImplementationOnce(() => new Promise(r => resolve = r));
    m.save.mockImplementationOnce(async (_id: string, body: any) => ({ ...d, revision: 3, input: body.input }));
    const w = mount(OrderDraftEditor, { props: { contactId: 'contact', initial: d, links: [] } });
    await w.findAll('textarea').at(-1)!.setValue('Lần đầu');
    await w.findAll('button').find(b => b.text() === 'Lưu nháp')!.trigger('click');
    await w.findAll('textarea').at(-1)!.setValue('Nội dung mới nhất');
    const closing = (w.vm as any).prepareClose();
    resolve({ ...d, revision: 2, input: { ...d.input, notes: 'Lần đầu' } });
    expect(await closing).toBe(true);
    expect(m.save).toHaveBeenCalledTimes(2);
    expect(m.save).toHaveBeenLastCalledWith('contact', expect.objectContaining({ revision: 2, input: expect.objectContaining({ notes: 'Nội dung mới nhất' }) }), 'draft');
    w.unmount();
  });
  it('expires the quote while the form remains open', async () => {
    vi.useFakeTimers();
    const d = makeDraft(); d.quote = { expiresAt: new Date(Date.now()+1500).toISOString(), warnings: [], lines: [] };
    const w = mount(OrderDraftEditor, { props: { contactId: 'contact', initial: d, links: [] } });
    expect(w.text()).toContain('Gửi chờ duyệt');
    await vi.advanceTimersByTimeAsync(2000);
    expect(w.text()).not.toContain('Gửi chờ duyệt');
    expect(w.text()).toContain('Bảng giá đã hết hạn');
    w.unmount();
  });
  it('locks editing after submission and exposes a result check', async () => { const w = mount(OrderDraftEditor, { props: { contactId: 'contact', initial: makeDraft('submitted'), links: [] } }); expect(w.find('fieldset').attributes('disabled')).toBeDefined(); expect(w.text()).toContain('Kiểm tra kết quả trong CRM'); expect(w.text()).not.toContain('Gửi CRM chờ duyệt'); w.unmount(); });
  it('does not enable sending without explicit confirmation of a saved quote', async () => { const d = makeDraft(); d.quote = { token: 'q', total: 100000, subtotal: 100000, discount: 0, shipping: 0, tax: 0, warnings: [], expiresAt: new Date(Date.now()+60000).toISOString() }; const w = mount(OrderDraftEditor, { props: { contactId: 'contact', initial: d, links: [] } }); const send = w.findAll('button').find(b => b.text() === 'Gửi chờ duyệt')!; expect(send.attributes('disabled')).toBeDefined(); await w.find('input[type="checkbox"]').setValue(true); expect(send.attributes('disabled')).toBeUndefined(); w.unmount(); });
});
