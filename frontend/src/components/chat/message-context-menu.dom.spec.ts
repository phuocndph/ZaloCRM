// @vitest-environment jsdom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
const copyImage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/composables/image-clipboard', async (original) => ({
  ...await original<typeof import('@/composables/image-clipboard')>(), useImageClipboard: () => ({ copyImage }),
}));
vi.mock('@/api/index', () => ({ api: { get: vi.fn() } }));
import MessageContextMenu from './message-context-menu.vue';
import type { Message } from '@/composables/use-chat';
afterEach(() => vi.clearAllMocks());
describe('image copy context menu', () => {
  it('copies the selected full image and closes the menu', async () => {
    const wrapper = mount(MessageContextMenu, { props: { modelValue: true, position: { x: 100, y: 100 }, isSelf: false,
      message: { id: 'image', contentType: 'image', content: JSON.stringify({ hdUrl: '/files/original.webp' }) } as Message },
      global: { stubs: { Teleport: true } } });
    const button = wrapper.findAll('button').find((element) => element.text() === 'Sao chép ảnh');
    expect(button).toBeDefined();
    await button!.trigger('click');
    expect(copyImage).toHaveBeenCalledExactlyOnceWith('/files/original.webp');
    expect(wrapper.emitted('update:modelValue')).toContainEqual([false]);
    wrapper.unmount();
  });
  it.each(['file', 'text'])('does not show image copy for %s', (contentType) => {
    const wrapper = mount(MessageContextMenu, { props: { modelValue: true, position: { x: 100, y: 100 }, isSelf: false,
      message: { id: 'file', contentType, content: 'hello' } as Message }, global: { stubs: { Teleport: true } } });
    expect(wrapper.text()).not.toContain('Sao chép ảnh');
    wrapper.unmount();
  });
});
