// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WorkItemsView from './WorkItemsView.vue';

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@/api', () => ({ api: mocks }));

describe('WorkItemsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({
      data: {
        items: [],
        counts: { now: 3, today: 7, waiting: 2, upcoming: 4, verify: 0, done: 5 },
        generatedAt: '2026-08-27T04:00:00.000Z',
      },
    });
  });

  it('reads the scope from the URL and keeps the summary linked to the route', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/work-items', component: WorkItemsView }],
    });
    await router.push('/work-items?scope=today');
    await router.isReady();

    const wrapper = mount(WorkItemsView, { global: { plugins: [router] } });
    await flushPromises();

    expect(mocks.get).toHaveBeenLastCalledWith('/work-items', expect.objectContaining({ params: expect.objectContaining({ scope: 'today' }) }));
    expect(wrapper.findAll('.wi-stat-value').map((node) => node.text())).toEqual(['3', '7', '2', '4', '0', '5']);

    await wrapper.findAll('.wi-stat')[2].trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.query.scope).toBe('waiting');
    expect(mocks.get).toHaveBeenLastCalledWith('/work-items', expect.objectContaining({ params: expect.objectContaining({ scope: 'waiting' }) }));
    wrapper.unmount();
  });
});
