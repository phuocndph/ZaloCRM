// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import DesktopChatView from './DesktopChatView.vue';
const mocks = vi.hoisted(() => ({ post: vi.fn(), active: vi.fn(), openMain: vi.fn(), pin: vi.fn(), conversation: null as any, state: null as any, rows: null as any, access: null as any }));
vi.mock('@/api', () => ({ api: { post: mocks.post } }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: { id: 'user' } }) }));
vi.mock('@/composables/use-privacy-visibility', () => ({ usePrivacyVisibility: () => ({ shouldBlurConv: (row: any) => row.redacted === true }) }));
vi.mock('@/composables/use-desktop-conversations', () => ({ useDesktopConversations: () => ({
  rows: mocks.rows, accounts: ref([{ id: 'nick', displayName: 'Nick A' }]), accessRevision: mocks.access, loading: ref(false), loadingMore: ref(false), hasMore: ref(false), error: ref(''), offline: ref(false), refresh: vi.fn(), loadMore: vi.fn(),
}) }));
vi.mock('@/composables/use-message-notification-inbox', () => ({ useMessageNotificationInbox: () => ({ markConversationRead: vi.fn() }) }));
vi.mock('@/composables/use-conversation-preview', () => ({ useConversationPreview: () => ({ conversation: mocks.conversation,
  messages: ref([]), loading: ref(false), error: ref(''), blocked: ref(false), realtimeOffline: ref(false), refresh: vi.fn(), invalidate: vi.fn() }) }));
vi.mock('@/components/chat/ConversationChatWorkspace.vue', () => ({ default: { props: ['conversation', 'messages', 'preview'], template: '<div class="shared-chat">Shared workspace</div>' } }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.conversation = ref(null); mocks.access = ref(0); mocks.post.mockResolvedValue({ data: {} });
  mocks.rows = ref([{ id: 'second', contact: { fullName: 'Customer' }, zaloAccount: { displayName: 'Nick A' }, unreadCount: 2, lastMessageAt: null, messages: [{ content: 'Hello', contentType: 'text' }] }]);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false }); vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  window.zaloDesktop = { role: 'chat', active: mocks.active, openMain: mocks.openMain, hide: vi.fn(), expand: vi.fn(), setPinned: mocks.pin,
    state: async () => ({ items: [], count: 0, signedIn: true }), onState: (callback: any) => { mocks.state = callback; return vi.fn(); }, onOpen: () => vi.fn(), onReset: () => vi.fn() } as any;
});
afterEach(() => { delete window.zaloDesktop; vi.restoreAllMocks(); });
async function render(path = '/desktop/chat/conv') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/desktop/chat/:convId?', name: 'Desktop.Chat', component: DesktopChatView }] });
  await router.push(path); await router.isReady();
  const wrapper = mount(DesktopChatView, { global: { plugins: [router], stubs: { 'v-progress-circular': true } } }); await flushPromises();
  return { wrapper, router };
}
describe('desktop floating chat', () => {
  it('uses shared chat and marks read only after authorized history loads', async () => {
    const { wrapper } = await render(); expect(mocks.post).not.toHaveBeenCalled();
    mocks.conversation.value = { id: 'conv', zaloAccount: { displayName: 'Nick A' } }; await flushPromises();
    expect(wrapper.find('.shared-chat').exists()).toBe(true); expect(wrapper.text()).toContain('Nick A');
    expect(mocks.post).toHaveBeenCalledWith('/conversations/conv/mark-read'); expect(mocks.active).toHaveBeenCalledWith('conv'); wrapper.unmount();
  });
  it('does not mark read when the window is not focused', async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const { wrapper } = await render(); mocks.conversation.value = { id: 'conv' }; await flushPromises();
    expect(mocks.post).not.toHaveBeenCalled(); wrapper.unmount();
  });
  it('does not clear native unread when mark-read is denied', async () => {
    mocks.post.mockRejectedValue(new Error('forbidden')); const { wrapper } = await render();
    mocks.conversation.value = { id: 'conv' }; await flushPromises(); expect(mocks.active).not.toHaveBeenCalledWith('conv'); wrapper.unmount();
  });
  it('shows server conversations even with an empty notification queue', async () => {
    const { wrapper, router } = await render('/desktop/chat');
    expect(wrapper.text()).toContain('Customer'); expect(wrapper.text()).toContain('Hello');
    await wrapper.get('.inbox-row').trigger('click'); await flushPromises(); expect(router.currentRoute.value.params.convId).toBe('second');
    await wrapper.get('[aria-label="Mở CRM đầy đủ"]').trigger('click'); expect(mocks.openMain).toHaveBeenCalledWith('second'); wrapper.unmount();
  });
  it('keeps a read conversation in the list and exposes back/pin controls', async () => {
    const { wrapper, router } = await render('/desktop/chat/second');
    mocks.conversation.value = { id: 'second' }; await flushPromises();
    expect(mocks.rows.value).toHaveLength(1); expect(mocks.rows.value[0].unreadCount).toBe(0);
    await wrapper.get('[aria-label="Ghim khung"]').trigger('click'); expect(mocks.pin).toHaveBeenCalledWith(true);
    await wrapper.get('[aria-label="Danh sách hội thoại"]').trigger('click'); await flushPromises(); expect(router.currentRoute.value.params.convId).toBeUndefined();
    expect(wrapper.find('.inbox-row').exists()).toBe(true); wrapper.unmount();
  });
  it('does not show private previews or avatars in the conversation list', async () => {
    mocks.rows.value[0].redacted = true; mocks.rows.value[0].contact.avatarUrl = 'https://example.com/private.png';
    const { wrapper } = await render('/desktop/chat'); expect(wrapper.text()).toContain('Nội dung riêng tư'); expect(wrapper.text()).not.toContain('Hello');
    expect(wrapper.find('.inbox-avatar[src]').exists()).toBe(false); wrapper.unmount();
  });
  it('does not clear the wrong customer after switching during a read request', async () => {
    let resolve!: (value: any) => void;
    mocks.post.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { wrapper, router } = await render('/desktop/chat/conv');
    mocks.conversation.value = { id: 'conv' }; await flushPromises();
    await router.replace('/desktop/chat/second'); mocks.conversation.value = { id: 'second' }; await flushPromises();
    resolve({ data: {} }); await flushPromises();
    expect(mocks.active).not.toHaveBeenCalledWith('conv'); expect(mocks.active).toHaveBeenCalledWith('second');
    expect(mocks.post).toHaveBeenLastCalledWith('/conversations/second/mark-read'); wrapper.unmount();
  });
  it('lets sales return to a read customer even after filters remove it from the inbox', async () => {
    const { wrapper, router } = await render('/desktop/chat/conv');
    mocks.conversation.value = { id: 'conv', contact: { fullName: 'Khách trước' }, zaloAccount: { displayName: 'Nick A' } };
    await flushPromises();
    await router.replace('/desktop/chat/second');
    mocks.conversation.value = { id: 'second', contact: { fullName: 'Khách tiếp theo' }, zaloAccount: { displayName: 'Nick B' } };
    mocks.rows.value = []; await flushPromises();
    expect(wrapper.findAll('.recent-conversation')).toHaveLength(2);
    const previous = wrapper.findAll('.recent-conversation').find((button) => button.text().includes('Khách trước'))!;
    await previous.trigger('click'); await flushPromises();
    expect(router.currentRoute.value.params.convId).toBe('conv');
    mocks.access.value++; await flushPromises();
    expect(wrapper.findAll('.recent-conversation')).toHaveLength(0); wrapper.unmount();
  });
  it('moves a revisited customer to the front without duplicating or reordering on live refresh', async () => {
    const { wrapper, router } = await render('/desktop/chat/conv');
    mocks.conversation.value = { id: 'conv', contact: { fullName: 'Khách An' } }; await flushPromises();
    await router.replace('/desktop/chat/second');
    mocks.conversation.value = { id: 'second', contact: { fullName: 'Khách Bình' } }; await flushPromises();
    expect(wrapper.findAll('.recent-copy').map((node) => node.text())).toEqual(['Khách BìnhNick Zalo', 'Khách AnNick Zalo']);
    await router.replace('/desktop/chat/conv');
    mocks.conversation.value = { id: 'conv', contact: { fullName: 'Khách An' } }; await flushPromises();
    mocks.conversation.value = { ...mocks.conversation.value }; await flushPromises();
    expect(wrapper.findAll('.recent-copy').map((node) => node.text())).toEqual(['Khách AnNick Zalo', 'Khách BìnhNick Zalo']);
    expect(wrapper.find('.desktop-chat-header').text()).not.toContain('Khách An'); wrapper.unmount();
  });
  it('keeps the native unread notification badge visible while chatting', async () => {
    const { wrapper } = await render();
    mocks.state({ count: 105, pinned: true }); await flushPromises();
    expect(wrapper.get('[aria-label="Danh sách hội thoại"] .notification-count').text()).toBe('99+');
    mocks.state({ count: 0 }); await flushPromises();
    expect(wrapper.find('.notification-count').exists()).toBe(false); wrapper.unmount();
  });
  it('shows unread on recent customers and clears it only after a successful visible read', async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const { wrapper } = await render();
    mocks.conversation.value = { id: 'conv', unreadCount: 4 }; await flushPromises();
    expect(wrapper.get('.recent-unread').text()).toBe('4');
    vi.mocked(document.hasFocus).mockReturnValue(true); window.dispatchEvent(new Event('focus')); await flushPromises();
    expect(wrapper.find('.recent-unread').exists()).toBe(false); wrapper.unmount();
  });
});
