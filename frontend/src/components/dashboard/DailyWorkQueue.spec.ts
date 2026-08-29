// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DailyWorkQueue from './DailyWorkQueue.vue';

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@/api', () => ({ api: mocks }));

const item = {
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

  it('shows the customer situation, next action, account context and AI confidence', async () => {
    const wrapper = await render();
    expect(wrapper.text()).toContain('Nguyễn Văn An');
    expect(wrapper.text()).toContain('Khách đang khiếu nại giao sai sản phẩm.');
    expect(wrapper.text()).toContain('Ưu tiên nhân viên xử lý trực tiếp');
    expect(wrapper.text()).toContain('Nick bán hàng, Nick hỗ trợ');
    expect(wrapper.text()).toContain('AI 91%');
    wrapper.unmount();
  });

  it('shows long-overdue work as an actionable number of days', async () => {
    const oldItem = { ...item, dueAt: new Date(Date.now() - 47 * 86_400_000).toISOString() };
    mocks.get.mockResolvedValue(response([oldItem]));

    const wrapper = await render();
    expect(wrapper.text()).toContain('Trễ 47 ngày');
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
