// @vitest-environment jsdom
import { flushPromises, mount, shallowMount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MessageBubble from './message-bubble.vue';
import SpecialMessageRenderer from './special-message-renderer.vue';
import type { Message } from '@/composables/use-chat';

const payload = { title: 'Khách danh thiếp', action: 'recommened.user', params: '1234567890123456789',
  href: 'https://zaloapp.com/qr/profile', thumb: '/files/avatar.png',
  description: JSON.stringify({ phone: '0901234567', qrCodeUrl: '/files/qr.png' }) };
const globals = { plugins: [createPinia()], stubs: { 'v-icon': true, 'v-btn': true } };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('contact card bubble routing', () => {
  it.each(['contact_card', 'qr_code', 'rich', 'link'])('renders historical %s cards before image/file fallbacks', (contentType) => {
    const wrapper = shallowMount(MessageBubble, { props: { message: { id: 'card', senderType: 'contact', contentType,
      content: JSON.stringify(payload), sentAt: new Date().toISOString() } as Message, isSelf: false, isGroup: false }, global: globals });
    expect(wrapper.find('.text-content').exists()).toBe(false);
    expect(wrapper.find('.chat-image').exists()).toBe(false);
    expect(wrapper.find('.file-card').exists()).toBe(false);
    expect(wrapper.findComponent(SpecialMessageRenderer).props('type')).toBe('user_suggest');
    wrapper.findComponent(SpecialMessageRenderer).vm.$emit('open-profile', '123');
    expect(wrapper.emitted('open-profile')).toEqual([['123']]);
    wrapper.unmount();
  });
  it('renders legacy contact cards without action/thumbnail as cards, not downloadable links', () => {
    const wrapper = shallowMount(MessageBubble, { props: { message: { id: 'card', contentType: 'contact_card',
      content: JSON.stringify({ title: 'Legacy', phone: '0901234567', href: 'https://zalo.me/123' }), sentAt: new Date().toISOString() } as Message,
      isSelf: false, isGroup: false }, global: globals });
    expect(wrapper.find('.file-card').exists()).toBe(false);
    expect(wrapper.findComponent(SpecialMessageRenderer).props('type')).toBe('contact_card_profile');
    wrapper.unmount();
  });
  it('keeps ordinary QR messages in the QR renderer', () => {
    const wrapper = shallowMount(MessageBubble, { props: { message: { id: 'qr', contentType: 'qr_code',
      content: JSON.stringify({ description: JSON.stringify({ qrCodeUrl: '/files/qr.png' }) }), sentAt: new Date().toISOString() } as Message,
      isSelf: false, isGroup: false }, global: globals });
    expect(wrapper.findComponent(SpecialMessageRenderer).props('type')).toBe('qr_code');
    wrapper.unmount();
  });
});

function renderCard(content = payload) {
  return mount(SpecialMessageRenderer, { props: { type: 'user_suggest', content }, global: globals });
}

describe('contact card display and copy', () => {
  it('shows name, phone, avatar, QR and copies only the phone', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const wrapper = renderCard();
    expect(wrapper.find('.profile-name').text()).toBe(payload.title);
    expect(wrapper.find('.profile-phone').text()).toContain('0901234567');
    expect(wrapper.find('.profile-avatar img').attributes('src')).toBe('/files/avatar.png');
    expect(wrapper.find('.profile-qr-img').attributes('src')).toBe('/files/qr.png');
    await wrapper.get('button[aria-label="Sao chép số điện thoại"]').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('0901234567');
    expect(wrapper.get('[role="status"]').text()).toContain('Đã sao chép');
    expect(wrapper.emitted('open-profile')).toBeUndefined();
    await wrapper.find('.profile-btn.primary').trigger('click');
    expect(wrapper.emitted('open-profile')).toEqual([['1234567890123456789']]);
    await wrapper.find('.profile-avatar img').trigger('error');
    expect(wrapper.find('.av-initials').exists()).toBe(true);
    wrapper.unmount();
  });
  it.each([false, true])('falls back when clipboard is missing or rejected (%s)', async (rejected) => {
    vi.stubGlobal('navigator', rejected ? { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } } : {});
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const wrapper = renderCard();
    await wrapper.get('.profile-copy-phone').trigger('click');
    await flushPromises();
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
    expect(wrapper.get('[role="status"]').text()).toContain('Đã sao chép');
    wrapper.unmount();
    Reflect.deleteProperty(document, 'execCommand');
  });
  it('shows a copy failure instead of false success', async () => {
    vi.stubGlobal('navigator', {});
    const wrapper = renderCard();
    await wrapper.get('.profile-copy-phone').trigger('click');
    expect(wrapper.get('[role="status"]').text()).toContain('Không sao chép được');
    wrapper.unmount();
  });
  it('does not show raw JSON or invent a hidden phone number', () => {
    const wrapper = renderCard({ ...payload, description: JSON.stringify({ qrCodeUrl: '/files/qr.png' }) });
    expect(wrapper.text()).toContain('Không kèm số điện thoại');
    expect(wrapper.text()).not.toContain('qrCodeUrl');
    expect(wrapper.find('.profile-copy-phone').exists()).toBe(false);
    wrapper.unmount();
  });
  it('uses phone lookup when the card has no UID', async () => {
    const wrapper = renderCard({ ...payload, params: '' });
    await wrapper.find('.profile-btn.primary').trigger('click');
    expect(wrapper.emitted('open-phone')).toEqual([['0901234567']]);
    wrapper.unmount();
  });
});
