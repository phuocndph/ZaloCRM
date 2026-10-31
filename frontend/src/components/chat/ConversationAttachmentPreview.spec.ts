// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConversationAttachmentPreview from './ConversationAttachmentPreview.vue';

const mocks = vi.hoisted(() => ({ get: vi.fn(), error: vi.fn() }));
vi.mock('@/api', () => ({ api: { get: mocks.get } }));
vi.mock('@/composables/use-toast', () => ({ useToast: () => ({ error: mocks.error }) }));
function render() {
  return mount(ConversationAttachmentPreview, { global: { stubs: {
    VDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /></div>' },
  } } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('conversation attachment preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });

  it('fetches PDF through the authenticated gateway and releases its object URL on close', async () => {
    mocks.get.mockResolvedValue({ data: new Blob(['pdf']) });
    const wrapper = render();
    await (wrapper.vm as any).open('https://files.test/file.pdf', 'Báo cáo.pdf');
    await flushPromises();
    expect(mocks.get).toHaveBeenCalledWith('/media/preview', expect.objectContaining({ params: { url: 'https://files.test/file.pdf', name: 'Báo cáo.pdf' }, responseType: 'blob' }));
    expect(wrapper.get('iframe').attributes('src')).toBe('blob:preview');
    (wrapper.vm as any).close();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    wrapper.unmount();
  });

  it('discards a late PDF response after switching to another attachment', async () => {
    const response = deferred<{ data: Blob }>();
    mocks.get.mockReturnValue(response.promise);
    const wrapper = render();
    const request = (wrapper.vm as any).open('https://files.test/old.pdf', 'old.pdf');
    const signal = mocks.get.mock.calls[0][1].signal;
    await (wrapper.vm as any).open('https://files.test/new.jpg', 'new.jpg', 'image');
    response.resolve({ data: new Blob(['old']) });
    await request;
    await flushPromises();
    expect(signal.aborted).toBe(true);
    expect(wrapper.find('iframe').exists()).toBe(false);
    expect(wrapper.get('img').attributes('src')).toBe('https://files.test/new.jpg');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('opens the image gallery locally and handles navigation', async () => {
    const wrapper = render();
    await (wrapper.vm as any).open('https://files.test/one.jpg', 'one.jpg', 'image', ['https://files.test/one.jpg', 'https://files.test/two.jpg']);
    await wrapper.get('[aria-label="Ảnh sau"]').trigger('click');
    expect(wrapper.get('img').attributes('src')).toBe('https://files.test/two.jpg');
    expect(wrapper.get('[aria-label="Ảnh sau"]').attributes('disabled')).toBeDefined();
    expect(mocks.get).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('shows unsupported formats without uploading them to an external viewer', async () => {
    const wrapper = render();
    await (wrapper.vm as any).open('https://files.test/file.docx', 'file.docx');
    await flushPromises();
    expect(wrapper.text()).toContain('Định dạng này chưa hỗ trợ xem trước');
    expect(mocks.get).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it('allows moving to the next gallery image after the previous image fails', async () => {
    const wrapper = render();
    await (wrapper.vm as any).open('https://files.test/one.jpg', 'one.jpg', 'image', ['https://files.test/one.jpg', 'https://files.test/two.jpg']);
    await wrapper.get('img').trigger('error');
    expect(wrapper.text()).toContain('Ảnh không tải được');
    await wrapper.get('[aria-label="Ảnh sau"]').trigger('click');
    expect(wrapper.get('img').attributes('src')).toBe('https://files.test/two.jpg');
    expect(wrapper.text()).not.toContain('Ảnh không tải được'); wrapper.unmount();
  });

});
