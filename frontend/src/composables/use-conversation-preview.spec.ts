// @vitest-environment jsdom
import { effectScope, ref, type Ref } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationPreview } from './use-conversation-preview';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), createSocket: vi.fn() }));
vi.mock('@/api', () => ({ api: mocks }));
vi.mock('@/api/socket', () => ({ createAppSocket: mocks.createSocket }));
const message = (id: string, hour = 10) => ({
  id, content: id, contentType: 'text', senderType: 'contact', senderName: 'Khách',
  sentAt: `2026-10-12T${String(hour).padStart(2, '0')}:00:00Z`, isDeleted: false, zaloMsgId: null, albumKey: null, albumIndex: null, albumTotal: null,
});
const detail = (id: string) => ({ data: { id, threadType: 'user', contact: { fullName: id }, zaloAccount: { id: `nick-${id}`, displayName: id, privacyMode: 'sub' } } });
const history = (id: string, hasMore = true) => ({ data: { messages: [message(id)], hasMore, nextCursor: `${id}-cursor` } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('read-only conversation preview', () => {
  let scope: ReturnType<typeof effectScope>;
  let view: ReturnType<typeof useConversationPreview>;
  let id: Ref<string>;
  let handlers: Record<string, (payload?: any) => void>;
  let reconnect: () => void;
  const disconnect = vi.fn();
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    handlers = {};
    mocks.createSocket.mockImplementation((options) => {
      reconnect = options.onReconnect;
      return { on: (event: string, callback: (payload: any) => void) => { handlers[event] = callback; }, disconnect };
    });
    mocks.get.mockImplementation((path: string) => Promise.resolve(path.endsWith('/messages') ? history(path.split('/')[2]) : detail(path.split('/')[2])));
    id = ref('first');
    scope = effectScope();
    scope.run(() => { view = useConversationPreview(id); });
    await flushPromises();
  });
  afterEach(() => { scope.stop(); vi.useRealTimers(); });

  it('loads only the chosen conversation without marking read or mutating chat state', () => {
    expect(view.conversation.value?.id).toBe('first');
    expect(view.messages.value.map((item) => item.id)).toEqual(['first']);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('aborts and discards late responses while switching conversations', async () => {
    const old = deferred<ReturnType<typeof history>>();
    mocks.get.mockImplementation((path: string) => path === '/conversations/first/messages' ? old.promise : Promise.resolve(path.endsWith('/messages') ? history('second') : detail('second')));
    const refresh = view.refresh();
    const signal = mocks.get.mock.calls.at(-1)![1].signal;
    id.value = 'second';
    await flushPromises();
    expect(signal.aborted).toBe(true);
    old.resolve(history('first'));
    await refresh;
    expect(view.conversation.value?.id).toBe('second');
    expect(view.messages.value.map((item) => item.id)).toEqual(['second']);
  });

  it('preserves cursor-based expanded history and deduplicates during realtime refresh', async () => {
    mocks.get.mockResolvedValueOnce({ data: { messages: [message('older', 9), message('first')], hasMore: true, nextCursor: 'older-cursor' } });
    await view.loadOlder();
    expect(mocks.get).toHaveBeenLastCalledWith('/conversations/first/messages', expect.objectContaining({ params: { limit: 40, cursor: 'first-cursor' } }));
    mocks.get.mockImplementation((path: string) => Promise.resolve(path.endsWith('/messages') ? { data: { messages: [message('first'), message('newest', 11)], hasMore: false } } : detail('first')));
    await view.refresh();
    expect(view.messages.value.map((item) => item.id)).toEqual(['older', 'first', 'newest']);
    expect(view.hasMore.value).toBe(true);
    mocks.get.mockResolvedValueOnce({ data: { messages: [], hasMore: false } });
    await view.loadOlder();
    expect(mocks.get).toHaveBeenLastCalledWith('/conversations/first/messages', expect.objectContaining({ params: { limit: 40, cursor: 'older-cursor' } }));
  });

  it('coalesces selected-chat events and never trusts their raw contents', async () => {
    handlers['chat:message']({ conversationId: 'other', message: message('wrong') });
    await vi.advanceTimersByTimeAsync(400);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    handlers['chat:message']({ conversationId: 'first', message: message('unverified') });
    handlers['chat:message']({ conversationId: 'first', message: message('unverified') });
    expect(view.messages.value.map((item) => item.id)).toEqual(['first']);
    await vi.advanceTimersByTimeAsync(350);
    expect(mocks.get).toHaveBeenCalledTimes(4);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('clears content immediately on a permission change and blocks forbidden responses', async () => {
    mocks.get.mockRejectedValue({ response: { status: 403, data: { code: 'CONVERSATION_PRIVATE' } } });
    handlers['zalo:access-changed']();
    expect(view.messages.value).toEqual([]);
    expect(view.conversation.value).toBeNull();
    await vi.advanceTimersByTimeAsync(350);
    expect(view.blocked.value).toBe(true);
    expect(view.error.value).toContain('riêng tư');
  });

  it('does not resurrect messages from older history after access has been revoked', async () => {
    const older = deferred<ReturnType<typeof history>>();
    mocks.get.mockReturnValueOnce(older.promise);
    const request = view.loadOlder();
    mocks.get.mockRejectedValue({ response: { status: 403 } });
    await view.refresh();
    older.resolve(history('leaked'));
    await request;
    expect(view.blocked.value).toBe(true);
    expect(view.messages.value).toEqual([]);
  });

  it('loads context using the selected conversation and preserves current messages', async () => {
    mocks.get.mockResolvedValueOnce({ data: { items: [message('target', 8)] } });
    await view.loadContext('target');
    expect(mocks.get).toHaveBeenLastCalledWith('/conversations/first/messages/target/context', expect.objectContaining({ params: { before: 10, after: 10 } }));
    expect(view.messages.value.map((item) => item.id)).toEqual(['target', 'first']);
  });

  it('keeps the conversation available when a quoted message cannot be found', async () => {
    mocks.get.mockRejectedValueOnce({ response: { status: 404 } });
    await view.loadContext('missing-zalo-id');
    expect(view.blocked.value).toBe(false);
    expect(view.conversation.value?.id).toBe('first');
    expect(view.messages.value.map((item) => item.id)).toEqual(['first']);
    expect(view.error.value).toContain('tin gốc');
  });

  it('clears and rechecks permissions after reconnecting', async () => {
    reconnect();
    expect(view.messages.value).toEqual([]);
    await vi.advanceTimersByTimeAsync(350);
    expect(view.conversation.value?.id).toBe('first');
  });
  it('preserves pending uploads during refresh and deduplicates a confirmed echo', async () => {
    const pending = { ...message('pending:e1', 11), isPending: true, clientEchoId: 'e1' } as any;
    view.addOptimisticMessages('other', [pending]); expect(view.messages.value).toHaveLength(1);
    view.addOptimisticMessages('first', [pending]); await view.refresh();
    expect(view.messages.value.map((item) => item.id)).toEqual(['first', 'pending:e1']);
    const confirmed = { ...pending, id: 'confirmed', isPending: false };
    view.reconcileOptimisticMessages('first', ['pending:e1'], [confirmed]);
    expect(view.messages.value.map((item) => item.id)).toEqual(['first', 'confirmed']);
  });
  it('isolates CRM and Zalo typing indicators and expires them', async () => {
    view.conversation.value!.externalThreadId = 'thread1';
    handlers['chat:typing']({ conversationId: 'other', typers: [{ userId: 'u', userName: 'Other' }] });
    handlers['zalo:typing']({ accountId: 'nick-other', threadId: 'thread1' });
    expect(view.typingUsers.value).toEqual([]); expect(view.customerTyping.value).toBe(false);
    handlers['chat:typing']({ conversationId: 'first', typers: [{ userId: 'u', userName: 'Staff' }] });
    handlers['zalo:typing']({ accountId: 'nick-first', threadId: 'thread1' });
    expect(view.typingUsers.value).toHaveLength(1); expect(view.customerTyping.value).toBe(true);
    await vi.advanceTimersByTimeAsync(6000);
    expect(view.typingUsers.value).toEqual([]); expect(view.customerTyping.value).toBe(false);
  });

  it('aborts requests, stops timers and disconnects its own socket on close', async () => {
    const pending = deferred<ReturnType<typeof history>>();
    mocks.get.mockReturnValueOnce(pending.promise);
    const request = view.loadOlder();
    const signal = mocks.get.mock.calls.at(-1)![1].signal;
    scope.stop();
    expect(signal.aborted).toBe(true);
    expect(disconnect).toHaveBeenCalledTimes(1);
    const calls = mocks.get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.get).toHaveBeenCalledTimes(calls);
    pending.resolve(history('late'));
    await request;
    expect(view.messages.value.map((item) => item.id)).toEqual(['first']);
  });
});
