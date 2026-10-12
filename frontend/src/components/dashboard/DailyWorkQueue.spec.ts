// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DailyWorkQueue from './DailyWorkQueue.vue';
import type { ConversationWorkItem } from '@/composables/use-conversation-work-items';

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@/api', () => ({ api: mocks }));

const item: ConversationWorkItem = {
  id: 'work-1', contactId: 'contact-1', conversationId: 'conversation-1', kind: 'reply', status: 'open',
  priority: 'critical', priorityScore: 100, title: 'Trả lời khách hàng',
  customerSituation: 'Khách đang khiếu nại giao sai sản phẩm.',
  nextAction: 'Ưu tiên nhân viên xử lý trực tiếp',
  reason: 'Khách yêu cầu gặp nhân viên.', dueAt: '2026-08-27T03:00:00.000Z', snoozedUntil: null,
  confidence: 0.91,
  metadata: { contactName: 'Nguyễn Văn An', nickNames: ['Nick bán hàng', 'Nick hỗ trợ'], unreadCount: 2, signalCount: 2 },
};

function response(items = [item]) {
  return {
    data: {
      items,
      counts: { now: items.length, today: items.length, waiting: 0, upcoming: 0, done: 0 },
      generatedAt: '2026-08-27T04:00:00.000Z',
    },
  };
}

async function render(props: Record<string, unknown> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/chat/:convId?', name: 'Chat', component: { template: '<div />' } },
      { path: '/contacts', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  await router.isReady();
  const wrapper = mount(DailyWorkQueue, { props, global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('DailyWorkQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue(response());
    mocks.patch.mockResolvedValue({ data: { item } });
  });

  it('shows the customer situation, next action, account context and AI progress', async () => {
    const wrapper = await render();
    expect(wrapper.text()).toContain('Nguyễn Văn An');
    expect(wrapper.text()).toContain('Khách đang khiếu nại giao sai sản phẩm.');
    expect(wrapper.text()).toContain('Ưu tiên nhân viên xử lý trực tiếp');
    expect(wrapper.text()).toContain('Nick bán hàng, Nick hỗ trợ');
    expect(wrapper.text()).toContain('AI đã phân tích xong');
    wrapper.unmount();
  });

  it('opens a preview instead of changing routes when enabled', async () => {
    const wrapper = await render({ previewEnabled: true, selectedConversationId: item.conversationId });
    await wrapper.get('[aria-label="Mở hội thoại"]').trigger('click');
    expect(wrapper.emitted('preview-conversation')?.[0]).toEqual([item.conversationId, item]);
    expect((wrapper.vm as any).$route.path).toBe('/');
    expect(wrapper.find('.dwq-row--selected').exists()).toBe(true);
    expect(mocks.patch).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('opens running AI conversations in the preview including conversations without work items', async () => {
    const data = response([]);
    mocks.get.mockResolvedValue({ data: { ...data.data, aiActivity: [{ conversationId: 'running', name: 'Khách', nickName: 'Nick', step: 'Phân tích' }] } });
    const wrapper = await render({ previewEnabled: true });
    await wrapper.get('.dwq-ai-activity-row').trigger('click');
    expect(wrapper.emitted('preview-conversation')?.[0]).toEqual(['running', null]);
    expect((wrapper.vm as any).$route.path).toBe('/');
    wrapper.unmount();
  });

  it('shows an active analysis state while AI is processing a new message', async () => {
    mocks.get.mockResolvedValue(response([{
      ...item,
      confidence: null,
      metadata: {
        ...item.metadata,
        aiStatus: 'analyzing',
        aiStatusLabel: 'AI đang phân tích tin nhắn mới',
        aiStatusDetail: 'Phân tích nhu cầu và cảm xúc',
      },
    }]));

    const wrapper = await render();
    expect(wrapper.text()).toContain('AI đang phân tích tin nhắn mới');
    expect(wrapper.text()).toContain('1 hội thoại đang được AI phân tích');
    expect(wrapper.get('[aria-label="Tiến trình AI"]').text()).toContain('Phân tích nhu cầu và cảm xúc');
    expect(wrapper.get('.dwq-ai-step').text()).toBe('Phân tích nhu cầu và cảm xúc');
    expect(wrapper.find('.dwq-ai-status--analyzing .dwq-spin').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows queued analysis instead of making the AI look idle', async () => {
    mocks.get.mockResolvedValue(response([{
      ...item,
      confidence: null,
      metadata: {
        ...item.metadata,
        aiStatus: 'pending',
        aiStatusLabel: 'Chờ kết quả phân tích AI',
        aiStatusDetail: 'Đang chờ tác vụ AI bắt đầu.',
      },
    }]));

    const wrapper = await render();
    expect(wrapper.text()).toContain('1 hội thoại đang chờ AI phân tích');
    expect(wrapper.text()).toContain('AI: Chờ kết quả phân tích AI');
    expect(wrapper.text()).not.toContain('AI: Không có tác vụ đang chạy');
    wrapper.unmount();
  });

  it('shows long-overdue work as an actionable number of days', async () => {
    const oldItem = { ...item, dueAt: new Date(Date.now() - 47 * 86_400_000).toISOString() };
    mocks.get.mockResolvedValue(response([oldItem]));

    const wrapper = await render();
    expect(wrapper.text()).toContain('Trễ 47 ngày');
    wrapper.unmount();
  });

  it('shows live AI work even before a customer work item is created', async () => {
    const data = response([]);
    mocks.get.mockResolvedValue({ data: { ...data.data, aiActivity: [{
      conversationId: 'new-conversation', name: 'Nhóm khách hàng', nickName: 'Nick hỗ trợ', step: 'Đọc ngữ cảnh hội thoại',
    }] } });
    const wrapper = await render();
    expect(wrapper.get('[aria-label="Tiến trình AI"]').text()).toContain('Nhóm khách hàng');
    expect(wrapper.get('[aria-label="Tiến trình AI"]').text()).toContain('Đọc ngữ cảnh hội thoại');
    expect(wrapper.text()).not.toContain('Không có tác vụ đang chạy');
    wrapper.unmount();
  });

  it('lists concurrent conversations in the header and opens the selected conversation', async () => {
    const data = response([]);
    mocks.get.mockResolvedValue({ data: { ...data.data, aiActivity: [
      { conversationId: 'conversation-a', name: 'Khách An', nickName: 'Nick bán hàng', step: 'Phân tích nhu cầu và cảm xúc' },
      { conversationId: 'conversation-b', name: 'Nhóm hỗ trợ', nickName: 'Nick hỗ trợ', step: 'Lưu kết quả và đề xuất công việc' },
    ] } });

    const wrapper = await render();
    const bar = wrapper.get('.dwq-head [aria-label="Tiến trình AI"]');
    expect(bar.findAll('.dwq-ai-activity-row')).toHaveLength(2);
    expect(wrapper.text()).toContain('2 hội thoại đang được AI phân tích');
    expect(bar.text()).toContain('Nick bán hàng');
    expect(bar.text()).toContain('Lưu kết quả và đề xuất công việc');
    await bar.get('[aria-label="Mở hội thoại Nhóm hỗ trợ trên nick Nick hỗ trợ"]').trigger('click');
    await flushPromises();
    expect((wrapper.vm as any).$route.params.convId).toBe('conversation-b');
    expect(mocks.patch).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('deduplicates active conversation information and distinguishes pending conversations', async () => {
    const data = response([
      { ...item, metadata: { ...item.metadata, aiStatus: 'analyzing', aiStatusDetail: 'Bước cũ' } },
      { ...item, id: 'work-2', conversationId: 'conversation-2', metadata: { contactName: 'Khách Bình', nickNames: ['Nick hỗ trợ'], aiStatus: 'queued' } },
    ]);
    mocks.get.mockResolvedValue({ data: { ...data.data, aiActivity: [{
      conversationId: item.conversationId, name: 'Nguyễn Văn An', nickName: 'Nick bán hàng', step: 'Tổng hợp nội dung hội thoại',
    }] } });

    const wrapper = await render();
    const bar = wrapper.get('[aria-label="Tiến trình AI"]');
    expect(bar.findAll('.dwq-ai-activity-row')).toHaveLength(2);
    expect(bar.text()).toContain('Tổng hợp nội dung hội thoại');
    expect(bar.text()).not.toContain('Bước cũ');
    expect(bar.get('.dwq-ai-activity-row--pending').text()).toContain('Khách Bình');
    expect(bar.get('.dwq-ai-activity-row--pending').text()).toContain('Đã xếp hàng');
    expect(bar.get('.dwq-ai-activity-row--pending').find('.dwq-spin').exists()).toBe(false);
    wrapper.unmount();
  });

  it('does not spin for pending or failed analysis', async () => {
    mocks.get.mockResolvedValue(response([{ ...item, confidence: null, metadata: { aiStatus: 'failed', aiStatusDetail: 'Lần phân tích bị gián đoạn.' } }]));
    const wrapper = await render();
    expect(wrapper.text()).toContain('AI chưa phân tích thành công');
    expect(wrapper.text()).toContain('Lần phân tích bị gián đoạn.');
    expect(wrapper.find('.dwq-ai-status .dwq-spin').exists()).toBe(false);
    wrapper.unmount();
  });

  it('requests the selected scope and completes a work item', async () => {
    const wrapper = await render();
    await wrapper.get('[role="tab"]:nth-child(2)').trigger('click');
    await flushPromises();
    expect(mocks.get).toHaveBeenLastCalledWith('/work-items', expect.objectContaining({ params: expect.objectContaining({ scope: 'today' }) }));

    await wrapper.get('[aria-label="Đánh dấu đã xong"]').trigger('click');
    await flushPromises();
    expect(mocks.patch).toHaveBeenCalledWith('/work-items/work-1', { action: 'complete' });
    wrapper.unmount();
  });

  it('offers clear snooze choices and sends the selected duration', async () => {
    const wrapper = await render();
    await wrapper.get('[aria-label="Hoãn công việc"]').trigger('click');
    expect(wrapper.text()).toContain('Sau 1 giờ');
    const oneHour = wrapper.findAll('.dwq-snooze-menu button')[0];
    await oneHour.trigger('click');
    await flushPromises();
    expect(mocks.patch).toHaveBeenCalledWith('/work-items/work-1', { action: 'snooze', snoozeMinutes: 60 });
    wrapper.unmount();
  });

  it('opens the exact conversation when the work-item row is clicked', async () => {
    const wrapper = await render();
    await wrapper.get('.dwq-row').trigger('click');
    await flushPromises();

    expect((wrapper.vm as any).$route.name).toBe('Chat');
    expect((wrapper.vm as any).$route.params.convId).toBe('conversation-1');
    wrapper.unmount();
  });

  it('opens Copilot for the exact conversation without sending a message', async () => {
    const wrapper = await render();
    await wrapper.get('[aria-label="Mở AI và soạn nháp trả lời"]').trigger('click');
    await flushPromises();

    expect((wrapper.vm as any).$route.name).toBe('Chat');
    expect((wrapper.vm as any).$route.params.convId).toBe('conversation-1');
    expect((wrapper.vm as any).$route.query.ai).toBe('1');
    expect(mocks.patch).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('opens the requested scope and provides a compact dashboard summary', async () => {
    const wrapper = await render({ initialScope: 'today', compact: true });
    expect(mocks.get).toHaveBeenLastCalledWith('/work-items', expect.objectContaining({ params: expect.objectContaining({ scope: 'today' }) }));
    expect(wrapper.find('[role="tab"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Xem tất cả công việc');
    wrapper.unmount();
  });
});
