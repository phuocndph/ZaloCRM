// @vitest-environment jsdom
import { computed, defineComponent, inject, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConversationChatWorkspace from './ConversationChatWorkspace.vue';
import { chatSessionKey } from '@/composables/chat-session-context';
import type { Conversation, Message } from '@/composables/use-chat';
import type { useConversationPreview } from '@/composables/use-conversation-preview';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), user: { id: 'workspace-user' }, toast: { success: vi.fn(), error: vi.fn(), push: vi.fn() } }));
vi.mock('@/api', () => ({ api: mocks })); vi.mock('@/api/index', () => ({ api: mocks }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: mocks.user }) }));
vi.mock('@/stores/privacy', () => ({ usePrivacyStore: () => ({ isUnlocked: false }) }));
vi.mock('@/composables/use-toast', () => ({ useToast: () => mocks.toast }));

const ThreadStub = defineComponent({ name: 'MessageThread', props: ['conversation', 'messages', 'replyingTo', 'editingMessage', 'pinnedIds', 'allConversations', 'typingUsers', 'aiSuggestion'],
  setup(_, { expose }) {
    const session = inject(chatSessionKey)!;
    const text = computed({ get: () => session.draft.value.text, set: (value: string) => { session.draft.value = { text: value }; } });
    const submit = () => {
      const rich = { text: text.value, styles: [{ st: 'b', start: 0, len: 3 }], mentions: [] };
      session.draft.value = rich;
      return session.submit(rich);
    };
    const clearComposer = () => { text.value = ''; };
    expose({ session, clearComposer, applySuggestion: (value: string) => { text.value = value; }, captureScrollAnchor: () => ({ top: 5, height: 10 }), restoreScrollAnchor: vi.fn(), scrollToMessage: () => false });
    return { session, text, submit, allowed: session.canSend };
  }, template: '<div class="thread-stub"><span>{{ conversation.contact?.fullName }}</span><textarea v-model="text" :disabled="!allowed" /><button class="send-stub" :disabled="!allowed" @click="submit">Send</button></div>',
});
let serial = 0;
function conversation(id = `session-${++serial}`) { return { id, threadType: 'user', contact: { id: 'customer', fullName: 'Khách An' }, zaloAccount: { id: 'nick', displayName: 'Nick bán hàng', status: 'connected', privacyMode: 'sub' } } as Conversation; }
async function render(current = conversation()) {
  const preview = { conversation: ref(current), messages: ref<Message[]>([]), loadingOlder: ref(false), hasMore: ref(false), blocked: ref(false), typingUsers: ref([]), customerTyping: ref(false),
    refresh: vi.fn(), invalidate: vi.fn(), loadOlder: vi.fn(), loadContext: vi.fn(), addOptimisticMessages: vi.fn(), reconcileOptimisticMessages: vi.fn(), removeOptimisticMessages: vi.fn() } as unknown as ReturnType<typeof useConversationPreview>;
  const wrapper = mount(ConversationChatWorkspace, { props: { conversation: current, messages: [], preview }, global: { stubs: {
    MessageThread: ThreadStub, ConversationContentPanel: true, MediaTabPanel: true, ChatContactPanel: true, GroupMonitoringPanel: true, AiCopilotPanel: true,
  } } }); await flushPromises(); return { wrapper, preview, thread: wrapper.findComponent(ThreadStub) };
}
describe('embedded full-chat workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockImplementation((path: string) => Promise.resolve({ data: path.includes('pinned') ? { items: [] } : path === '/conversations' ? { conversations: [] } : { provider: 'test', enabled: true } }));
    mocks.post.mockResolvedValue({ data: { id: 'sent', deliveryState: 'completed' } }); mocks.delete.mockResolvedValue({ data: {} });
  });
  it('uses shared MessageThread and supplies an isolated session instead of selecting global chat', async () => {
    const { wrapper, thread, preview } = await render(); expect(thread.exists()).toBe(true);
    expect(thread.vm.session.addOptimisticMessages).toBe(preview.addOptimisticMessages);
    expect(mocks.post).not.toHaveBeenCalled(); wrapper.unmount();
  });
  it('sends rich text/triggers queue refresh without marking read or completing a task', async () => {
    const current = conversation(); const { wrapper, thread } = await render(current);
    await thread.get('textarea').setValue('Chào khách'); await thread.get('.send-stub').trigger('click'); await flushPromises();
    expect(mocks.post).toHaveBeenCalledWith(`/conversations/${current.id}/messages`, expect.objectContaining({ content: 'Chào khách', styles: [{ st: 'b', start: 0, len: 3 }], echoId: expect.any(String) }), expect.any(Object));
    expect(wrapper.emitted('message-sent')?.[0]).toEqual([current.id]); expect(wrapper.emitted('action')).toBeUndefined(); expect(thread.vm.text).toBe(''); wrapper.unmount();
  });
  it('retains rich drafts, reply and file references across closing/reopening and isolates customers', async () => {
    const current = conversation(); const first = await render(current);
    first.thread.vm.session.draft.value = { text: 'Bản nháp', styles: [{ st: 'b', start: 0, len: 3 }] };
    const file = new File(['abc'], 'a.pdf', { type: 'application/pdf' }); first.thread.vm.session.attachments.files = [file];
    first.thread.vm.$emit('set-reply-to', { id: 'quoted', content: 'Tin gốc' }); await flushPromises(); first.wrapper.unmount();
    const second = await render(current); expect(second.thread.vm.session.draft.value.styles).toHaveLength(1); expect(second.thread.vm.session.attachments.files[0]).toBe(file);
    expect(second.thread.props('replyingTo').id).toBe('quoted'); second.wrapper.unmount();
    const other = await render(); expect(other.thread.vm.text).toBe(''); expect(other.thread.vm.session.attachments.files).toEqual([]); other.wrapper.unmount();
  });
  it('blocks sending and Media when the nick disconnects, without hiding the transcript', async () => {
    const current = conversation(); current.zaloAccount!.status = 'disconnected'; const { wrapper, thread } = await render(current);
    expect(thread.vm.allowed).toBe(false); thread.vm.$emit('open-media-tab'); await flushPromises(); expect(wrapper.findComponent({ name: 'MediaTabPanel' }).exists()).toBe(false);
    expect(wrapper.text()).toContain('mất kết nối'); expect(mocks.post).not.toHaveBeenCalled(); wrapper.unmount();
  });
  it('shows tool panels in place and requests expansion, not navigation', async () => {
    const { wrapper, thread } = await render(); thread.vm.$emit('open-content-panel', 'search'); await flushPromises();
    expect(wrapper.findComponent({ name: 'ConversationContentPanel' }).props('initialTab')).toBe('search'); expect(wrapper.emitted('expand')).toHaveLength(1);
    thread.vm.$emit('open-media-tab'); await flushPromises(); expect(wrapper.findComponent({ name: 'MediaTabPanel' }).exists()).toBe(true);
    thread.vm.$emit('toggle-contact-panel'); await flushPromises(); expect(wrapper.findComponent({ name: 'ChatContactPanel' }).exists()).toBe(true); wrapper.unmount();
  });
  it('binds reactions, editing, forwarding and pins to the captured conversation', async () => {
    const current = conversation(); const { wrapper, thread } = await render(current);
    thread.vm.$emit('add-reaction', 'msg', 'like'); await flushPromises(); expect(mocks.post).toHaveBeenCalledWith(`/conversations/${current.id}/reactions`, { msgId: 'msg', reaction: 'like' });
    thread.vm.$emit('remove-reaction', 'msg', 'like'); await flushPromises(); expect(mocks.delete).toHaveBeenCalledWith(`/conversations/${current.id}/reactions`, { data: { msgId: 'msg', reaction: 'like' } });
    thread.vm.$emit('pin-message', { id: 'msg' }); await flushPromises(); expect(mocks.post).toHaveBeenCalledWith(`/conversations/${current.id}/messages/msg/pin`);
    thread.vm.$emit('edit-message', 'msg', 'Đã sửa'); await flushPromises(); expect(mocks.post).toHaveBeenCalledWith(`/conversations/${current.id}/messages/msg/edit`, { content: 'Đã sửa' }); wrapper.unmount();
  });
  it('loads authorized forwarding targets only for the current nick and passes nick switches to the shell', async () => {
    const { wrapper, thread } = await render(); thread.vm.$emit('prepare-forward'); await flushPromises();
    expect(mocks.get).toHaveBeenCalledWith('/conversations', expect.objectContaining({ params: { accountId: 'nick', limit: 100 } }));
    thread.vm.$emit('switch-conversation', 'other-nick-conversation'); expect(wrapper.emitted('switch-conversation')?.[0]).toEqual(['other-nick-conversation']); wrapper.unmount();
  });
  it('includes forwarding destinations beyond the first page without duplicating conversations', async () => {
    const { wrapper, thread } = await render();
    mocks.get.mockResolvedValueOnce({ data: { conversations: [conversation('target-one')], hasMore: true, nextCursor: 'cursor1' } })
      .mockResolvedValueOnce({ data: { conversations: [conversation('target-one'), conversation('target-two')], hasMore: false } });
    thread.vm.$emit('prepare-forward'); await flushPromises();
    expect(thread.props('allConversations').map((item: Conversation) => item.id)).toEqual(['target-one', 'target-two']);
    expect(mocks.get).toHaveBeenLastCalledWith('/conversations', expect.objectContaining({ params: { accountId: 'nick', limit: 100, cursor: 'cursor1' } })); wrapper.unmount();
  });
  it('keeps failed/uncertain sends and offers reconciliation without enabling a second new send', async () => {
    const { wrapper, thread } = await render(); await thread.get('textarea').setValue('Tin đang gửi'); mocks.post.mockRejectedValueOnce(new Error('timeout'));
    await thread.get('.send-stub').trigger('click'); await flushPromises(); expect(thread.vm.text).toBe('Tin đang gửi'); expect(thread.vm.allowed).toBe(false);
    expect(wrapper.text()).toContain('Kiểm tra kết quả'); await wrapper.get('.ccw-notice button').trigger('click'); await flushPromises();
    expect(mocks.post.mock.calls[1][1]).toEqual(mocks.post.mock.calls[0][1]); expect(thread.vm.text).toBe(''); wrapper.unmount();
  });
  it('inserts Copilot replies locally and never sends them automatically', async () => {
    const { wrapper, thread } = await render(); (wrapper.vm as any).openCopilot(); await flushPromises();
    const ai = wrapper.findComponent({ name: 'AiCopilotPanel' }); expect(ai.props('localDraft')).toBe(true); ai.vm.$emit('use-reply', 'Gợi ý'); await flushPromises();
    expect(thread.vm.text).toBe('Gợi ý'); expect(mocks.post).not.toHaveBeenCalled(); wrapper.unmount();
  });
  it('does not clear a newer rich draft when reconciling an older uncertain send', async () => {
    const { wrapper, thread } = await render();
    await thread.get('textarea').setValue('Cùng nội dung');
    mocks.post.mockRejectedValueOnce(new Error('timeout'));
    await thread.get('.send-stub').trigger('click'); await flushPromises();
    const newer = { text: 'Cùng nội dung', styles: [{ st: 'i', start: 0, len: 3 }] };
    thread.vm.session.draft.value = newer;
    await wrapper.get('.ccw-notice button').trigger('click'); await flushPromises();
    expect(thread.vm.session.draft.value).toEqual(newer); wrapper.unmount();
  });
  it('ignores a late AI response after its workspace is closed', async () => {
    const { wrapper, thread } = await render(); let resolve!: (data: any) => void;
    mocks.post.mockReturnValueOnce(new Promise((done) => { resolve = done; })); thread.vm.$emit('ask-ai'); await flushPromises(); wrapper.unmount();
    resolve({ data: { reply_text: 'Nội dung cũ' } }); await flushPromises(); expect(wrapper.emitted('message-sent')).toBeUndefined();
  });
});
