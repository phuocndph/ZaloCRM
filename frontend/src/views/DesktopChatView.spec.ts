// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import DesktopChatView from './DesktopChatView.vue';
const mocks = vi.hoisted(() => ({ post: vi.fn(), active: vi.fn(), openMain: vi.fn(), conversation: null as any, state: null as any }));
vi.mock('@/api', () => ({ api: { post: mocks.post } }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: { id: 'user' } }) }));
vi.mock('@/composables/use-message-notification-inbox', () => ({ useMessageNotificationInbox: () => ({ markConversationRead: vi.fn() }) }));
vi.mock('@/composables/use-conversation-preview', () => ({ useConversationPreview: () => ({ conversation: mocks.conversation,
  messages: ref([]), loading: ref(false), error: ref(''), blocked: ref(false), refresh: vi.fn(), invalidate: vi.fn() }) }));
vi.mock('@/components/chat/ConversationChatWorkspace.vue', () => ({ default: { props: ['conversation', 'messages', 'preview'], template: '<div class="shared-chat">Shared workspace</div>' } }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.conversation = ref(null); mocks.post.mockResolvedValue({ data: {} });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false }); vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  window.zaloDesktop = { role: 'chat', active: mocks.active, openMain: mocks.openMain, hide: vi.fn(), expand: vi.fn(),
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
  it('switches pending conversations in the compact route', async () => {
    const { wrapper, router } = await render('/desktop/chat');
    mocks.state({ items: [{ convId: 'second', name: 'Customer', context: 'Nick B', count: 2 }] }); await flushPromises();
    await wrapper.get('.desktop-chat-pending button').trigger('click'); await flushPromises(); expect(router.currentRoute.value.params.convId).toBe('second');
    await wrapper.get('[aria-label="Mở CRM đầy đủ"]').trigger('click'); expect(mocks.openMain).toHaveBeenCalledWith('second'); wrapper.unmount();
  });
});
