// @vitest-environment jsdom
import { shallowMount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import MessageBubble from './message-bubble.vue';
import VoiceMessageBubble from './voice-message-bubble.vue';
import type { Message } from '@/composables/use-chat';
describe('voice messages are not mistaken for file/image cards', () => {
  it.each(['voice', 'audio'])('uses the voice player for %s with empty thumb and JSON params', (contentType) => {
    const wrapper = shallowMount(MessageBubble, { props: { message: { id: 'voice', senderType: 'contact', contentType,
      content: JSON.stringify({ href: 'https://chat.zdn.vn/voice.aac', thumb: '', params: JSON.stringify({ fileSize: 12000, duration: 2000, m4a: '/files/voice.m4a' }) }),
      sentAt: new Date().toISOString() } as Message, isSelf: false, isGroup: false }, global: { plugins: [createPinia()], stubs: { 'v-icon': true, 'v-btn': true } } });
    expect(wrapper.find('.file-card').exists()).toBe(false); expect(wrapper.find('.chat-image').exists()).toBe(false);
    expect(wrapper.findComponent(VoiceMessageBubble).props()).toMatchObject({ audioUrl: 'https://chat.zdn.vn/voice.aac', fallbackUrls: ['/files/voice.m4a'], durationMs: 2000 }); wrapper.unmount();
  });
});
