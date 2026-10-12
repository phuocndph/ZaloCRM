// @vitest-environment jsdom
import { effectScope } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationInsight } from './use-conversation-insight';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), createSocket: vi.fn() }));
vi.mock('@/api', () => ({ api: { get: mocks.get, post: mocks.post } }));
vi.mock('@/api/socket', () => ({ createAppSocket: mocks.createSocket }));

const progress = (aiStatus: string) => ({ aiStatus, aiStatusLabel: aiStatus, aiStatusDetail: aiStatus });
function snapshot(message = 'new', status = 'ready', version = 1) {
  return { data: {
    latestMessageId: message, analysisProgress: progress(status),
    readiness: { aiStatus: 'ready', accountStatus: 'connected', accountName: 'Nick' },
    insight: { id: 'insight', version, updatedAt: `${version}`, sourceThroughMessageId: message, latestMessageId: message },
  } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('conversation insight lifecycle', () => {
  let scope: ReturnType<typeof effectScope>;
  let view: ReturnType<typeof useConversationInsight>;
  let handlers: Record<string, (data: any) => void>;
  let reconnect: () => void;
  let disconnect: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    handlers = {};
    disconnect = vi.fn();
    mocks.createSocket.mockImplementation((options) => {
      reconnect = options.onReconnect;
      return { on: (event: string, callback: (data: any) => void) => { handlers[event] = callback; }, disconnect };
    });
    mocks.get.mockResolvedValue(snapshot());
    mocks.post.mockResolvedValue({ data: { queued: true, messageId: 'new' } });
    scope = effectScope();
    scope.run(() => { view = useConversationInsight(); });
  });
  afterEach(() => { scope.stop(); vi.useRealTimers(); });

  it('shows first analysis progress and polls without force-queueing it again', async () => {
    mocks.get.mockResolvedValue({ data: { ...snapshot('new', 'analyzing').data, insight: null } });
    await view.fetchInsight('conv');
    expect(view.analysisProgress.value?.aiStatus).toBe('analyzing');
    expect(view.loading.value).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('ignores other chats and coalesces progress events into a read-only refresh', async () => {
    await view.fetchInsight('conv');
    handlers['chat:message']({ conversationId: 'other' });
    await vi.advanceTimersByTimeAsync(400);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    handlers['work-items:updated']({ conversationId: 'conv' });
    handlers['work-items:updated']({ conversationId: 'conv' });
    await vi.advanceTimersByTimeAsync(350);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('invalidates the current result immediately when a new message arrives', async () => {
    await view.fetchInsight('conv');
    handlers['chat:message']({ conversationId: 'conv' });
    expect(view.invalidated.value).toBe(true);
    expect(view.analysisProgress.value?.aiStatus).toBe('pending');
    mocks.get.mockResolvedValue(snapshot('newer', 'queued'));
    await vi.advanceTimersByTimeAsync(350);
    expect(view.latestMessageId.value).toBe('newer');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('discards a response overtaken by a message, then reads once more', async () => {
    await view.fetchInsight('conv');
    const response = deferred<ReturnType<typeof snapshot>>();
    mocks.get.mockReturnValueOnce(response.promise);
    const request = view.refreshStatus();
    handlers['chat:message']({ conversationId: 'conv' });
    mocks.get.mockResolvedValue(snapshot('newer'));
    response.resolve(snapshot('old'));
    await request;
    expect(view.invalidated.value).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(view.latestMessageId.value).toBe('newer');
  });

  it('never lets a slow previous chat response replace the selected chat', async () => {
    const old = deferred<ReturnType<typeof snapshot>>();
    mocks.get.mockReturnValueOnce(old.promise);
    const first = view.fetchInsight('first');
    mocks.get.mockResolvedValue(snapshot('second'));
    await view.fetchInsight('second');
    old.resolve(snapshot('first'));
    await first;
    expect(view.latestMessageId.value).toBe('second');
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not stop a refresh on a changed but stale insight', async () => {
    await view.fetchInsight('conv');
    mocks.get.mockResolvedValue({ data: { ...snapshot('old', 'pending', 2).data, latestMessageId: 'new' } });
    await view.analyzeInsight('conv');
    mocks.get.mockResolvedValue(snapshot('new', 'ready', 3));
    await vi.advanceTimersByTimeAsync(2000);
    expect(view.insight.value?.version).toBe(3);
    const calls = mocks.get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.get).toHaveBeenCalledTimes(calls);
  });

  it('continues polling a fresh result while its run is still saving', async () => {
    await view.fetchInsight('conv');
    mocks.get.mockResolvedValue(snapshot('new', 'analyzing', 2));
    await view.analyzeInsight('conv');
    mocks.get.mockResolvedValue(snapshot('new', 'ready', 2));
    await vi.advanceTimersByTimeAsync(2000);
    expect(view.analysisProgress.value?.aiStatus).toBe('ready');
    const calls = mocks.get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(mocks.get).toHaveBeenCalledTimes(calls);
  });

  it('stops polling after a failed retry without discarding the old result', async () => {
    await view.fetchInsight('conv');
    mocks.get.mockResolvedValue({ data: {
      ...snapshot().data, analysisAttempt: { status: 'failed', updatedAt: 'changed', messageId: 'new' },
    } });
    await view.analyzeInsight('conv');
    const calls = mocks.get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.get).toHaveBeenCalledTimes(calls);
    expect(view.insight.value).not.toBeNull();
  });

  it('refetches after reconnect without posting another model request', async () => {
    await view.fetchInsight('conv');
    reconnect();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('cancels polling, debounce, and subscriptions on scope disposal', async () => {
    mocks.get.mockResolvedValue(snapshot('new', 'analyzing'));
    await view.fetchInsight('conv');
    handlers['work-items:updated']({ conversationId: 'conv' });
    scope.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(view.insight.value).toBeNull();
  });

  it('preserves existing results on a transient network error', async () => {
    await view.fetchInsight('conv');
    mocks.get.mockRejectedValueOnce(new Error('offline'));
    await view.refreshStatus();
    await flushPromises();
    expect(view.error.value).not.toBe('');
    expect(view.insight.value).not.toBeNull();
  });
});
