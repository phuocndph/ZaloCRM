// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), remove: vi.fn(), error: vi.fn(), success: vi.fn(), refresh: vi.fn() }));
vi.mock('@/api/index', () => ({ api: { get: mocks.get, post: mocks.post, delete: mocks.remove } }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/composables/use-toast', () => ({ useToast: () => ({ error: mocks.error, success: mocks.success }) }));
vi.mock('@/composables/use-friend-socket', () => ({ useFriendSocket: vi.fn() }));
vi.mock('@/composables/use-tag-taxonomy', () => ({ refreshTagTaxonomy: mocks.refresh }));
import TagCrmBar from './TagCrmBar.vue';
const tag = { id: 't1', name: 'Khách sạn', slug: 'khach-san', source: 'manual_per_nick', color: '#123456' };
const assignment = { id: 'a1', tag, removedAt: null };
const menu = defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], template: `<div><slot name="activator" :props="{onClick: () => $emit('update:modelValue', !modelValue)}"/><slot v-if="modelValue"/></div>` });
function create() { return mount(TagCrmBar, { props: { friendId: 'a', contactId: 'contact-a' }, global: { stubs: { VMenu: menu } } }); }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockImplementation(async (url: string) => ({ data: url === '/tags' ? { tags: [tag] } : { friendTags: [] } }));
});
describe('manual CRM tag bar', () => {
  it('ignores an old tag response after switching to another customer', async () => {
    let old!: (value: any) => void;
    mocks.get.mockImplementation((url: string) => url === '/friends/a/tags' ? new Promise(resolve => { old = resolve; }) : Promise.resolve({ data: { friendTags: [] } }));
    const wrapper = create(); await wrapper.setProps({ friendId: 'b', contactId: 'contact-b' }); await flushPromises();
    old({ data: { friendTags: [assignment] } }); await flushPromises();
    expect(wrapper.findAll('.is-manual')).toHaveLength(0); wrapper.unmount();
  });
  it('distinguishes a failed dropdown request from an empty list and lets the user retry', async () => {
    const original = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((url: string) => url === '/tags' ? Promise.reject(new Error('network')) : original(url));
    const wrapper = create(); await flushPromises(); await wrapper.get('.tag-add-btn').trigger('click'); await flushPromises();
    expect(wrapper.text()).toContain('Không tải được danh sách tag'); expect(wrapper.text()).not.toContain('Chưa có tag thủ công');
    mocks.get.mockImplementation(original); await wrapper.get('.dd-retry').trigger('click'); await flushPromises();
    expect(wrapper.get('.dd-option').text()).toContain('Khách sạn'); wrapper.unmount();
  });
  it('serializes clicks and never assigns a completed old operation to the new chat', async () => {
    let finish!: () => void; mocks.post.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const wrapper = create(); await flushPromises(); await wrapper.get('.tag-add-btn').trigger('click'); await flushPromises();
    await wrapper.get('.dd-option').trigger('click'); await wrapper.get('.dd-option').trigger('click');
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ friendId: 'b', contactId: 'contact-b' }); await flushPromises();
    const changed: any[] = []; const listener = (event: Event) => changed.push((event as CustomEvent).detail);
    window.addEventListener('friend-crm-tags-changed', listener); finish(); await flushPromises(); window.removeEventListener('friend-crm-tags-changed', listener);
    expect(mocks.post).toHaveBeenCalledWith('/friends/a/tags', { tagId: 't1', source: 'manual_per_nick' });
    expect(changed).toEqual([]); expect(wrapper.findAll('.is-manual')).toHaveLength(0); wrapper.unmount();
  });
  it('reloads available tag definitions when reopening the menu', async () => {
    const wrapper = create(); await flushPromises(); await wrapper.get('.tag-add-btn').trigger('click'); await flushPromises();
    await wrapper.get('.tag-add-btn').trigger('click'); await wrapper.get('.tag-add-btn').trigger('click'); await flushPromises();
    expect(mocks.get.mock.calls.filter(([url]) => url === '/tags')).toHaveLength(2); wrapper.unmount();
  });
  it('creates and attaches a new CRM tag, refreshing the name cache', async () => {
    let assigned = false; mocks.post.mockImplementation(async () => { assigned = true; });
    mocks.get.mockImplementation(async (url: string) => ({ data: url === '/tags' ? { tags: [] } : { friendTags: assigned ? [assignment] : [] } }));
    const wrapper = create(); await flushPromises(); await wrapper.get('.tag-add-btn').trigger('click'); await flushPromises();
    await wrapper.get('input').setValue('Khách sạn'); await wrapper.get('input').trigger('keydown', { key: 'Enter' }); await flushPromises();
    expect(mocks.post).toHaveBeenCalledWith('/friends/a/tags', { tagName: 'Khách sạn', source: 'manual_per_nick', autoCreate: true });
    expect(mocks.refresh).toHaveBeenCalledOnce(); expect(wrapper.get('.is-manual').text()).toContain('Khách sạn'); wrapper.unmount();
  });
  it('keeps a tag displayed when removing it fails', async () => {
    mocks.get.mockResolvedValue({ data: { friendTags: [assignment] } }); mocks.remove.mockRejectedValue(new Error('offline'));
    const wrapper = create(); await flushPromises(); await wrapper.get('.tag-x').trigger('click'); await flushPromises();
    expect(wrapper.get('.is-manual').text()).toContain('Khách sạn'); expect(mocks.error).toHaveBeenCalled(); wrapper.unmount();
  });
  it('loads tag definitions beyond the first two hundred instead of silently hiding them', async () => {
    const batch = Array.from({ length: 200 }, (_, index) => ({ ...tag, id: `tag-${index}`, name: `Tag ${index}` }));
    mocks.get.mockImplementation(async (url: string, args: any) => ({ data: url === '/tags' ? { tags: args?.params?.cursor ? [{ ...tag, id: 'last-tag', name: 'Tag cuối' }] : batch } : { friendTags: [] } }));
    const wrapper = create(); await flushPromises(); await wrapper.get('.tag-add-btn').trigger('click'); await flushPromises();
    expect(wrapper.findAll('.dd-option')).toHaveLength(201);
    expect(mocks.get).toHaveBeenCalledWith('/tags', { params: { scope: 'friend', source: 'manual_per_nick', limit: 200, cursor: 'tag-199' } }); wrapper.unmount();
  });
  it('attaches and removes CRM tags using server-confirmed state', async () => {
    let assigned = false; mocks.post.mockImplementation(async () => { assigned = true; }); mocks.remove.mockImplementation(async () => { assigned = false; });
    mocks.get.mockImplementation(async (url: string) => ({ data: url === '/tags' ? { tags: [tag] } : { friendTags: assigned ? [assignment] : [] } }));
    const wrapper = create(); await flushPromises(); await wrapper.get('.tag-add-btn').trigger('click'); await flushPromises();
    await wrapper.get('.dd-option').trigger('click'); await flushPromises();
    expect(wrapper.get('.is-manual').text()).toContain('Khách sạn');
    await wrapper.get('.tag-x').trigger('click'); await flushPromises();
    expect(mocks.remove).toHaveBeenCalledWith('/friends/a/tags/t1'); expect(wrapper.findAll('.is-manual')).toHaveLength(0); wrapper.unmount();
  });
});
