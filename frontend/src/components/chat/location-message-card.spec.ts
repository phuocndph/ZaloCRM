// @vitest-environment jsdom
import { flushPromises, mount, shallowMount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LocationMessageCard from './location-message-card.vue';
import SpecialMessageRenderer from './special-message-renderer.vue';
import MessageBubble from './message-bubble.vue';
import type { Message } from '@/composables/use-chat';

const content = { title: 'Nhà hát Thành phố', description: '7 Công trường Lam Sơn, Quận 1, TP. Hồ Chí Minh',
  params: JSON.stringify({ latitude: 10.7769, longitude: 106.7009, isUserLocation: 1 }) };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, 'execCommand'); });

describe('location card presentation', () => {
  it('displays real destination, address and actions with accessible map title', async () => {
    const wrapper = mount(LocationMessageCard, { props: { content } });
    await wrapper.vm.$nextTick();
    expect(wrapper.get('.location-title').text()).toBe(content.title);
    expect(wrapper.get('.location-address').text()).toBe(content.description);
    expect(wrapper.text()).not.toContain('LIVE');
    expect(wrapper.get('iframe').attributes('title')).toContain(content.title);
    expect(new URL(wrapper.get('.location-action.primary').attributes('href')!).searchParams.get('destination')).toBe('10.7769,106.7009');
    for (const link of wrapper.findAll('a')) {
      expect(link.attributes('target')).toBe('_blank');
      expect(link.attributes('rel')).toContain('noopener');
    }
    await wrapper.get('iframe').trigger('load');
    expect(wrapper.find('.location-map-state').exists()).toBe(false);
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retains destination/actions and supports retry when map times out', async () => {
    const wrapper = mount(LocationMessageCard, { props: { content } });
    await vi.advanceTimersByTimeAsync(15000);
    expect(wrapper.text()).toContain('Chưa tải được bản đồ');
    expect(wrapper.find('iframe').exists()).toBe(false);
    expect(wrapper.findAll('.location-action')).toHaveLength(2);
    await wrapper.get('.location-retry').trigger('click');
    expect(wrapper.find('iframe').exists()).toBe(true);
    await wrapper.get('iframe').trigger('load');
    await vi.advanceTimersByTimeAsync(16000);
    expect(wrapper.find('.location-map-state').exists()).toBe(false);
    wrapper.unmount();
  });
  it('handles explicit iframe errors', async () => {
    const wrapper = mount(LocationMessageCard, { props: { content } });
    await wrapper.vm.$nextTick();
    await wrapper.get('iframe').trigger('error');
    expect(wrapper.text()).toContain('Chưa tải được bản đồ');
    expect(vi.getTimerCount()).toBe(0);
    wrapper.unmount();
  });
  it('does not start network/timeout for offscreen cards until visible', async () => {
    let intersect: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { intersect = callback; }
      observe = vi.fn(); disconnect = disconnect;
    });
    const wrapper = mount(LocationMessageCard, { props: { content } });
    await vi.advanceTimersByTimeAsync(30000);
    expect(wrapper.find('iframe').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Chưa tải được');
    intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('iframe').exists()).toBe(true);
    expect(disconnect).toHaveBeenCalled();
    wrapper.unmount();
  });
  it('shows honest missing-coordinate state with no demo map', () => {
    const wrapper = mount(LocationMessageCard, { props: { content: { title: 'Thiếu vị trí', params: { latitude: '', longitude: null } } } });
    expect(wrapper.text()).toContain('không kèm tọa độ hợp lệ');
    expect(wrapper.find('iframe').exists()).toBe(false);
    expect(wrapper.findAll('a')).toHaveLength(0);
    expect(wrapper.find('.location-copy').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('copying a location', () => {
  it('copies the title, address, coordinates and safe map link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const wrapper = mount(LocationMessageCard, { props: { content } });
    await wrapper.get('.location-copy').trigger('click'); await flushPromises();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(`${content.title}\n${content.description}\n10.7769,106.7009\nhttps://www.google.com/maps/`));
    expect(wrapper.get('.location-copy-status').text()).toContain('Đã sao chép');
    wrapper.unmount();
  });
  it.each([false, true])('supports clipboard fallback (%s)', async (rejected) => {
    vi.stubGlobal('navigator', rejected ? { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } } : {});
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const wrapper = mount(LocationMessageCard, { props: { content } });
    await wrapper.get('.location-copy').trigger('click'); await flushPromises();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
    expect(wrapper.get('.location-copy-status').text()).toContain('Đã sao chép');
    wrapper.unmount();
  });
  it('shows failure instead of false success and clears it for a new position', async () => {
    vi.stubGlobal('navigator', {});
    const wrapper = mount(LocationMessageCard, { props: { content } });
    await wrapper.get('.location-copy').trigger('click');
    expect(wrapper.get('.location-copy-status').text()).toContain('Không sao chép được');
    await wrapper.setProps({ content: { ...content, params: { latitude: 21, longitude: 105 } } });
    expect(wrapper.find('.location-copy-status').exists()).toBe(false);
    expect(new URL(wrapper.get('iframe').attributes('src')!).searchParams.get('pb')).toContain('21,105');
    wrapper.unmount();
  });
});

describe('location bubble routing', () => {
  it.each([{}, { thumb: 'https://cdn.zdn.vn/map.png' }, { href: 'https://example.com/map' }])('cannot be swallowed by image/file fallbacks %j', (extra) => {
    const wrapper = shallowMount(MessageBubble, { props: { message: { id: 'location', senderType: 'contact', contentType: 'location',
      content: JSON.stringify({ ...content, ...extra }), sentAt: new Date().toISOString() } as Message, isSelf: false, isGroup: false },
      global: { plugins: [createPinia()], stubs: { 'v-icon': true, 'v-btn': true } } });
    expect(wrapper.find('.chat-image').exists()).toBe(false);
    expect(wrapper.find('.file-card').exists()).toBe(false);
    expect(wrapper.getComponent(SpecialMessageRenderer).props('type')).toBe('location');
    expect(wrapper.get('.message-bubble').classes()).toContain('is-bare');
    wrapper.unmount();
  });
  it('uses the location component inside special messages', () => {
    const wrapper = shallowMount(SpecialMessageRenderer, { props: { type: 'location', content } });
    expect(wrapper.getComponent(LocationMessageCard).props('content')).toEqual(content);
    wrapper.unmount();
  });
});
