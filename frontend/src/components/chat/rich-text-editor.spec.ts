// @vitest-environment jsdom
import { mount, flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import RichTextEditor from './rich-text-editor.vue';
vi.mock('@/composables/use-toast', () => ({ useToast: () => ({ push: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() }) }));
vi.mock('@/composables/use-groups', () => ({ useGroups: () => ({ fetchMembers: vi.fn(), members: [] }) }));
vi.mock('@/api/index', () => ({ api: { post: vi.fn() } }));
describe('rich chat draft restoration', () => {
  it('restores mentions and styles without changing their text offsets', async () => {
    const wrapper = mount(RichTextEditor, { props: { modelValue: '', isGroup: true }, global: { stubs: { VTooltip: true, VIcon: true } } });
    await flushPromises();
    wrapper.vm.applyRichPayload({ text: 'Hi @An\n@Bình ok', styles: [{ st: 'b', start: 0, len: 2 }], mentions: [{ uid: 'a', pos: 3, len: 3 }, { uid: 'b', pos: 7, len: 5 }] });
    const rich = wrapper.vm.getRichPayload();
    expect(rich.text).toBe('Hi @An\n@Bình ok');
    expect(rich.mentions).toEqual([{ uid: 'a', pos: 3, len: 3 }, { uid: 'b', pos: 7, len: 5 }]);
    expect(rich.styles).toContainEqual({ st: 'b', start: 0, len: 2 });
    wrapper.vm.clear(); wrapper.vm.applyRichPayload(rich);
    expect(wrapper.vm.getRichPayload()).toEqual(rich); wrapper.unmount();
  });
});
