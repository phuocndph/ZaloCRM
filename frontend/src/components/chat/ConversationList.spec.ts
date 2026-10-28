// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom
import { reactive, ref } from 'vue';
import { shallowMount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), hidden: false, defs: new Map<string, any>() }));
vi.mock('@/api/index', () => ({ api: { get: mocks.get } }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: { id: 'user-a', role: 'owner' } }) }));
vi.mock('@/composables/use-privacy-visibility', () => ({ usePrivacyVisibility: () => ({ shouldBlurConv: () => mocks.hidden, isOwnerOfPrivateNick: () => false }) }));
vi.mock('@/composables/use-crm-tag-defs', () => ({ loadTagDefs: vi.fn(async () => {}), isZaloManaged: () => false, cleanTagName: (value: string) => value, tagColor: () => '#333333' }));
vi.mock('@/composables/use-tag-taxonomy', () => ({ loadTagTaxonomy: vi.fn(async () => {}), findTagBySlug: (slug: string) => mocks.defs.get(slug), useTagTaxonomy: () => ({ taxonomyVersion: ref(0) }) }));
import ConversationList from './ConversationList.vue';
function conversation() { return reactive({ id: 'chat-a', threadType: 'user', contact: { id: 'customer', fullName: 'Khách sạn A', tags: [] }, zaloAccount: { id: 'account', displayName: 'Nick A' }, friendship: { id: 'friend', zaloLabels: [{ id: '1', name: 'Đã mua', color: '#166534' }], crmTagsPerNick: ['hotel'], autoTags: ['active'] }, messages: [], unreadCount: 0, lastMessageAt: null }) as any; }
async function render(current = conversation()) {
  const wrapper = shallowMount(ConversationList, { props: { conversations: [current], selectedId: null, loading: false, search: '' }, global: { stubs: { 'v-icon': true, 'v-progress-linear': true, 'v-progress-circular': true } } });
  await flushPromises(); return { wrapper, current };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.hidden = false; mocks.defs.clear(); mocks.defs.set('hotel', { name: 'Khách sạn', color: '#123456' });
  mocks.get.mockResolvedValue({ data: { crmTags: [], zaloTags: [], counts: {} } });
});
describe('conversation list tags', () => {
  it('shows Zalo and manual CRM tags below the preview, with remaining tags accessible', async () => {
    const current = conversation();
    current.contact.tags = ['interested'];
    mocks.defs.set('interested', { name: 'Quan tâm rèm', color: '#456789' });
    const { wrapper } = await render(current);
    const row = wrapper.get('.ci-row-tags');
    expect(row.findAll('.ci-chip').map(chip => chip.text())).toEqual(['Đã mua', 'Khách sạn']);
    expect(row.get('.ci-tags-more').text()).toBe('+1');
    expect(row.get('.ci-tags-more').attributes('title')).toBe('Quan tâm rèm');
    expect(row.text()).not.toContain('Hoạt động');
    expect(row.classes()).not.toContain('ci-row-meta'); wrapper.unmount();
  });
  it('does not show an automatic status as a customer label', async () => {
    const current = conversation();
    current.friendship.zaloLabels = [];
    current.friendship.crmTagsPerNick = [];
    current.friendship.autoTags = ['active', 'engagement-cold'];
    const { wrapper } = await render(current);
    expect(wrapper.find('.ci-row-tags').exists()).toBe(false);
    wrapper.unmount();
  });
  it('excludes automatic status definitions from legacy CRM arrays', async () => {
    const current = conversation();
    mocks.defs.set('active', { name: 'Đang chat', color: '#999999', source: 'auto_detect' });
    current.contact.tags = ['active'];
    const { wrapper } = await render(current);
    expect(wrapper.get('.ci-row-tags').text()).toContain('Đã mua');
    expect(wrapper.get('.ci-row-tags').text()).not.toContain('Đang chat');
    expect(wrapper.find('.ci-tags-more').exists()).toBe(false);
    wrapper.unmount();
  });
  it('updates tag name and color when a tag is replaced without changing the number of tags', async () => {
    const { wrapper, current } = await render();
    current.friendship.zaloLabels = [{ id: '2', name: 'Đặt mẫu', color: '#aabbcc' }];
    mocks.defs.set('new-hotel', { name: 'Khách mới', color: '#445566' });
    current.friendship.crmTagsPerNick = ['new-hotel']; await flushPromises();
    expect(wrapper.get('.ci-row-tags').text()).toContain('Đặt mẫu');
    expect(wrapper.get('.ci-row-tags').text()).toContain('Khách mới');
    expect(wrapper.get('.ci-row-tags').text()).not.toContain('Đã mua');
    expect(wrapper.get('.ci-chip').attributes('style')).toContain('#aabbcc'); wrapper.unmount();
  });
  it('keeps tags specific to each nick and does not show tags on an untagged group', async () => {
    const first = conversation(); const second = conversation(); second.id = 'chat-b'; second.friendship = { id: 'friend-b', zaloLabels: [], crmTagsPerNick: [], autoTags: [] }; second.threadType = 'group';
    const { wrapper } = await render(first); await wrapper.setProps({ conversations: [first, second] });
    expect(wrapper.findAll('.conv-item')[0].find('.ci-row-tags').exists()).toBe(true);
    expect(wrapper.findAll('.conv-item')[1].find('.ci-row-tags').exists()).toBe(false); wrapper.unmount();
  });
  it('respects the existing privacy gate instead of exposing private conversation tags', async () => {
    mocks.hidden = true; const { wrapper } = await render();
    expect(wrapper.find('.ci-row-tags').exists()).toBe(false); wrapper.unmount();
  });
});
