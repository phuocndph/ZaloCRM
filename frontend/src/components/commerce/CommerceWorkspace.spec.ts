// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import CommerceWorkspace from './CommerceWorkspace.vue';
describe('Purchasing workspace', () => {
  it('keeps unsaved content open when its editor rejects closing, then restores focus after closing', async () => {
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const beforeClose = vi.fn().mockResolvedValue(false);
    const w = mount(CommerceWorkspace, { attachTo: document.body, props: { title: 'Tạo đơn', beforeClose }, slots: { default: '<input value="Nội dung đang nhập">' } });
    expect(document.body.style.overflow).toBe('hidden');
    document.querySelector<HTMLButtonElement>('[aria-label="Đóng cửa sổ mua hàng"]')!.click(); await flushPromises();
    expect(beforeClose).toHaveBeenCalledOnce(); expect(w.emitted('close')).toBeUndefined();
    expect(document.querySelector<HTMLInputElement>('.jf-workspace input')!.value).toBe('Nội dung đang nhập');
    beforeClose.mockResolvedValue(true);
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true})); await flushPromises();
    expect(w.emitted('close')).toHaveLength(1); w.unmount(); await flushPromises();
    expect(document.activeElement).toBe(opener); expect(document.body.style.overflow).toBe(''); opener.remove();
  });
});
