// @vitest-environment jsdom
import { shallowMount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { describe, expect, it } from 'vitest';
import MessageBubble from './message-bubble.vue';
import type { Message } from '@/composables/use-chat';

function render(patch: Partial<Message>) {
  return shallowMount(MessageBubble, { props: { message: {
    id: 'message', contentType: 'file', content: JSON.stringify({ href: '', name: 'quote.pdf' }), senderType: 'self',
    sentAt: '2020-01-01T00:00:00Z', ...patch,
  } as Message, isSelf: true, isLastSelf: true, isGroup: false }, global: {
    plugins: [createPinia()], stubs: { 'v-icon': true, 'v-btn': true },
  } });
}

describe('rendered delivery receipts', () => {
  it('shows Zalo acceptance without claiming customer delivery', () => {
    const view = render({ zaloMsgId: 'remote-file', deliveryState: 'completed' });
    expect(view.find('.receipt-label').text()).toBe('Zalo đã tiếp nhận');
    expect(view.find('.receipt-label').text()).not.toContain('Đang gửi');
    expect(view.find('.receipt-label').text()).not.toBe('Đã nhận');
    view.unmount();
  });
  it('renders a durable queued placeholder rather than an empty file card', () => {
    const view = render({ deliveryState: 'prepared', metadata: { outboundAttachment: { status: 'queued' } } });
    expect(view.find('.attachment-placeholder').text()).toContain('Chờ gửi');
    expect(view.find('.attachment-placeholder strong').text()).toBe('quote.pdf');
    view.unmount();
  });
  it('stops the sending label for uncertain outcomes', () => {
    const view = render({ deliveryState: 'uncertain', metadata: { outboundAttachment: { status: 'uncertain' } } });
    expect(view.find('.receipt-label').text()).toBe('Chưa xác định kết quả');
    expect(view.find('.attachment-placeholder').text()).toContain('Không tự gửi lại');
    view.unmount();
  });
  it('offers explicit retry only for a known failure with durable bytes', async () => {
    const view = render({ deliveryState: 'failed', metadata: { sendStatus: 'failed', failReason: 'rejected', outboundAttachment: { sourceId: 'source', status: 'failed' } } });
    await view.find('button.retry-attachment').trigger('click');
    expect(view.emitted('retry-attachment')).toHaveLength(1);
    expect(view.find('.send-failed').text()).toContain('rejected');
    view.unmount();
  });
});
