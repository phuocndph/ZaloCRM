// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TemplateComposerPreview from './TemplateComposerPreview.vue';
const mocks = vi.hoisted(() => ({ post: vi.fn(), media: vi.fn(), toast: vi.fn() }));
vi.mock('@/api/index', () => ({ api: { post: mocks.post } }));
vi.mock('@/api/media', () => ({ sendMediaToConversation: mocks.media }));
vi.mock('@/composables/use-toast', () => ({ useToast: () => ({ push: mocks.toast }) }));
function render() {
  return mount(TemplateComposerPreview, { props: { conversationId: 'customer-a', canSend: true, initialBlocks: [
    { id: 'album', type: 'image_album', enabled: true, attachments: [{ assetId: 'one', kind: 'image', url: '' }, { assetId: 'two', kind: 'image', url: '' }] },
  ] }, global: { stubs: { VIcon: true } } });
}
describe('template send lifecycle', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it.each(['close', 'switch', 'permission'])('stops remaining media after %s while awaiting a send', async (mode) => {
    let resolve!: (value: any) => void;
    mocks.media.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const wrapper = render(); await wrapper.get('.tcp-send').trigger('click');
    expect(mocks.media).toHaveBeenCalledTimes(1);
    if (mode === 'close') wrapper.unmount();
    else await wrapper.setProps(mode === 'switch' ? { conversationId: 'customer-b' } : { canSend: false });
    resolve({}); await flushPromises();
    expect(mocks.media).toHaveBeenCalledTimes(1); expect(wrapper.emitted('done')).toBeUndefined();
    if (mode !== 'close') wrapper.unmount();
  });
  it('keeps an uncertain file on the same echo and does not send the next file', async () => {
    mocks.media.mockResolvedValue({ pendingConfirmation: true });
    const wrapper = render(); await wrapper.get('.tcp-send').trigger('click'); await flushPromises();
    expect(mocks.media).toHaveBeenCalledTimes(1); expect(wrapper.emitted('done')).toBeUndefined();
    await wrapper.get('.tcp-error-acts button').trigger('click'); await flushPromises();
    expect(mocks.media.mock.calls[1]).toEqual(mocks.media.mock.calls[0]); wrapper.unmount();
  });
});
