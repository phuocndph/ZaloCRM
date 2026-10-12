// @vitest-environment jsdom
import { defineComponent, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkItemConversationPreview from './WorkItemConversationPreview.vue';
import type { ConversationWorkItem } from '@/composables/use-conversation-work-items';

const mocks = vi.hoisted(() => ({ preview: null as any, post: vi.fn(), copilot: vi.fn(), jump: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/api', () => ({ api: { post: mocks.post } }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: { id: 'viewer' } }) }));
vi.mock('@/stores/privacy', () => ({ usePrivacyStore: () => ({ isUnlocked: false }) }));
vi.mock('@/composables/use-toast', () => ({ useToast: () => mocks.toast }));
vi.mock('@/composables/use-conversation-preview', () => ({ useConversationPreview: () => mocks.preview }));
const work = { id: 'work', conversationId: 'conv', kind: 'verification', status: 'open', nextAction: 'Xác minh đơn hàng', reason: 'Cần xem ảnh' } as ConversationWorkItem;
const WorkspaceStub = defineComponent({ name: 'ConversationChatWorkspace', props: ['conversation', 'messages', 'preview'],
  setup(_, { expose }) { expose({ openCopilot: mocks.copilot, jump: mocks.jump }); },
  template: '<div class="workspace-stub">{{ conversation.contact?.fullName }} {{ conversation.zaloAccount?.displayName }}<div v-for="message in messages" :key="message.id">{{ message.content }}</div></div>',
});
async function render(props: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/work-items', component: { template: '<div />' } }, { path: '/chat/:convId', name: 'Chat', component: { template: '<div />' } },
  ] }); await router.push('/work-items');
  const wrapper = mount(WorkItemConversationPreview, { props: { conversationId: 'conv', item: work, ...props }, global: { plugins: [router], stubs: { ConversationChatWorkspace: WorkspaceStub } } });
  await flushPromises(); return { wrapper, router };
}
describe('work item full-chat preview shell', () => {
  beforeEach(() => {
    vi.stubGlobal('innerHeight', 900);
    vi.clearAllMocks(); mocks.post.mockResolvedValue({ data: {} });
    mocks.preview = { conversation: ref({ id: 'conv', threadType: 'user', contact: { fullName: 'Khách An' }, zaloAccount: { displayName: 'Nick bán hàng', privacyMode: 'sub' } }),
      messages: ref([{ id: 'msg', content: 'Nội dung tin' }]), loading: ref(false), error: ref(''), blocked: ref(false), realtimeOffline: ref(false), refresh: vi.fn(), invalidate: vi.fn() };
  });
  afterEach(() => vi.unstubAllGlobals());
  it('opens with enough room on a short laptop screen', async () => {
    vi.stubGlobal('innerWidth', 1366); vi.stubGlobal('innerHeight', 768);
    const { wrapper } = await render(); expect(wrapper.classes()).toContain('wicp--expanded'); wrapper.unmount();
  });
  it('embeds the shared workspace without navigation, sending or marking read', async () => {
    const { wrapper, router } = await render(); expect(wrapper.text()).toContain('Khách An'); expect(wrapper.text()).toContain('Nội dung tin');
    expect(wrapper.findComponent(WorkspaceStub).props('preview')).toBe(mocks.preview); expect(mocks.post).not.toHaveBeenCalled(); expect(router.currentRoute.value.path).toBe('/work-items'); wrapper.unmount();
  });
  it('marks read and completes only on explicit actions', async () => {
    const { wrapper } = await render(); await wrapper.get('[aria-label="Đánh dấu đã đọc"]').trigger('click'); await flushPromises();
    expect(mocks.post).toHaveBeenCalledWith('/conversations/conv/mark-read'); expect(wrapper.emitted('marked-read')).toHaveLength(1);
    await wrapper.get('.wicp-complete').trigger('click'); expect(wrapper.emitted('action')?.[0]).toEqual(['complete']);
    await wrapper.get('[aria-label="Hoãn công việc trong xem nhanh"]').trigger('click'); expect(wrapper.emitted('action')?.[1]).toEqual(['snooze', { snoozeMinutes: 60 }]); wrapper.unmount();
  });
  it('keeps the route on expand, Copilot, sends, nick changes and closing', async () => {
    const { wrapper, router } = await render(); await wrapper.get('[aria-label="Mở rộng khung chat"]').trigger('click'); expect(wrapper.classes()).toContain('wicp--expanded');
    await wrapper.get('[aria-label="AI Copilot trong xem nhanh"]').trigger('click'); expect(mocks.copilot).toHaveBeenCalledOnce();
    wrapper.findComponent(WorkspaceStub).vm.$emit('message-sent', 'conv'); wrapper.findComponent(WorkspaceStub).vm.$emit('switch-conversation', 'other');
    expect(wrapper.emitted('message-sent')?.[0]).toEqual(['conv']); expect(wrapper.emitted('switch-conversation')?.[0]).toEqual(['other']); expect(wrapper.emitted('action')).toBeUndefined();
    await wrapper.get('[aria-label="Đóng xem nhanh"]').trigger('click'); expect(wrapper.emitted('close')).toHaveLength(1); expect(router.currentRoute.value.path).toBe('/work-items'); wrapper.unmount();
  });
  it('only navigates from the explicit full-chat button', async () => {
    const { wrapper, router } = await render(); await wrapper.get('[aria-label="Mở trang Tin nhắn đầy đủ"]').trigger('click'); await flushPromises(); expect(router.currentRoute.value.params.convId).toBe('conv'); wrapper.unmount();
  });
  it('destroys the chat and all its panels when content is private or access revoked', async () => {
    const { wrapper } = await render(); mocks.preview.blocked.value = true; mocks.preview.conversation.value = null; await flushPromises();
    expect(wrapper.findComponent(WorkspaceStub).exists()).toBe(false); expect(wrapper.get('.wicp-complete').attributes('disabled')).toBeDefined(); wrapper.unmount();
  });
  it('does not mount tools for a locked private account', async () => {
    mocks.preview.conversation.value.zaloAccount = { privacyMode: 'main', ownerUserId: 'other' };
    const { wrapper } = await render(); expect(wrapper.findComponent(WorkspaceStub).exists()).toBe(false); expect(wrapper.text()).not.toContain('Nội dung tin'); wrapper.unmount();
  });
  it('keeps chat available when the task leaves the filter, but disables task actions', async () => {
    const { wrapper } = await render({ itemAvailable: false }); expect(wrapper.findComponent(WorkspaceStub).exists()).toBe(true); expect(wrapper.get('.wicp-complete').attributes('disabled')).toBeDefined(); wrapper.unmount();
  });
  it('opens the expanded workspace when a tool requests more room', async () => {
    const { wrapper } = await render(); wrapper.findComponent(WorkspaceStub).vm.$emit('expand'); await flushPromises(); expect(wrapper.classes()).toContain('wicp--expanded'); wrapper.unmount();
  });
});
