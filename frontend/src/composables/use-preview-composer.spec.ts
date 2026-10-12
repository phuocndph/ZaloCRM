// @vitest-environment jsdom
import { effectScope, nextTick, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreviewComposer } from './use-preview-composer';
import type { Message } from './use-chat';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/api', () => ({ api: { post: mocks.post } }));
let serial = 0;
function setup(user = `viewer-${++serial}`, id = 'a') {
  const scope = effectScope();
  const conversationId = ref(id);
  const userId = ref(user);
  const messages = ref<Message[]>([]);
  const allowed = ref(true);
  const onSent = vi.fn();
  const onForbidden = vi.fn();
  const composer = scope.run(() => usePreviewComposer({ conversationId, userId, messages, allowed, onSent, onForbidden }))!;
  return { ...composer, scope, conversationId, userId, messages, allowed, onSent, onForbidden };
}
const accepted = { data: { id: 'outgoing', deliveryState: 'completed' } };
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (cause: any) => void;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('quick-preview composer', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.post.mockResolvedValue(accepted); });
  it('preserves whitespace offsets for rich styles and mentions and retries the captured reply', async () => {
    const c = setup(); c.draft.value = '  @An chào  ';
    const rich = { text: c.draft.value, styles: [{ st: 'b', start: 6, len: 4 }], mentions: [{ uid: 'customer', pos: 2, len: 3 }] };
    mocks.post.mockRejectedValueOnce(new Error('timeout'));
    await c.send(rich, 'quoted');
    expect(mocks.post.mock.calls[0][1]).toEqual({ content: rich.text, styles: rich.styles, mentions: rich.mentions, replyMessageId: 'quoted', echoId: expect.any(String) });
    c.draft.value = 'Khác'; await c.send();
    expect(mocks.post.mock.calls[1][1]).toEqual(mocks.post.mock.calls[0][1]); c.scope.stop();
  });

  it('sends only to the captured conversation and preserves a newer draft and other customer', async () => {
    const c = setup();
    const request = deferred(); mocks.post.mockReturnValue(request.promise);
    c.draft.value = '  Chào khách A  ';
    const sending = c.send();
    await c.send();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/conversations/a/messages', { content: 'Chào khách A', echoId: expect.any(String) }, expect.objectContaining({ timeout: 120000 }));
    c.draft.value = 'Nội dung mới cho A';
    c.conversationId.value = 'b';
    c.draft.value = 'Chào khách B';
    request.resolve(accepted); await sending;
    expect(c.draft.value).toBe('Chào khách B');
    expect(c.onSent).toHaveBeenCalledWith('a');
    c.conversationId.value = 'a';
    expect(c.draft.value).toBe('Nội dung mới cho A');
    c.scope.stop();
  });

  it('retains per-user drafts and the in-flight lock across closing/reopening', async () => {
    const first = setup(); const user = first.userId.value;
    const request = deferred(); mocks.post.mockReturnValue(request.promise);
    first.draft.value = 'Bản nháp'; const sending = first.send(); first.scope.stop();
    const reopened = setup(user);
    expect(reopened.draft.value).toBe('Bản nháp');
    expect(reopened.state.value.sending).toBe(true);
    await reopened.send(); expect(mocks.post).toHaveBeenCalledTimes(1);
    reopened.userId.value = 'another-user'; expect(reopened.draft.value).toBe('');
    reopened.userId.value = user;
    request.resolve(accepted); await sending;
    expect(reopened.draft.value).toBe(''); expect(first.onSent).not.toHaveBeenCalled();
    reopened.scope.stop();
  });

  it('keeps the draft and uses the same payload/echo after a lost response', async () => {
    const c = setup(); c.draft.value = 'Tin cần kiểm tra';
    mocks.post.mockRejectedValueOnce(new Error('timeout'));
    await c.send();
    const originalPayload = mocks.post.mock.calls[0][1];
    expect(c.state.value.uncertain).toBe(true); expect(c.draft.value).toBe('Tin cần kiểm tra');
    c.draft.value = 'Bản nháp khác';
    await c.send();
    expect(mocks.post.mock.calls[1][1]).toEqual(originalPayload);
    expect(c.state.value.uncertain).toBe(false); expect(c.draft.value).toBe('Bản nháp khác');
    c.scope.stop();
  });

  it('does not treat HTTP 202 as delivered and reconciles from authorized history', async () => {
    const c = setup(); c.draft.value = 'Tin đang xác nhận';
    mocks.post.mockResolvedValueOnce({ status: 202, data: { id: 'outgoing', pendingConfirmation: true, deliveryState: 'uncertain' } });
    await c.send();
    expect(c.onSent).not.toHaveBeenCalled(); expect(c.state.value.uncertain).toBe(true);
    const echo = mocks.post.mock.calls[0][1].echoId;
    c.messages.value = [{ id: 'outgoing', clientEchoId: echo, deliveryState: 'completed' } as unknown as Message];
    await nextTick();
    expect(c.draft.value).toBe(''); expect(c.state.value.uncertain).toBe(false);
    expect(c.onSent).toHaveBeenCalledOnce();
    c.scope.stop();
  });

  it('retains uncertain delivery identity even when a later reconciliation is rejected before delivery lookup', async () => {
    const c = setup(); c.draft.value = 'Tin gốc';
    mocks.post.mockRejectedValueOnce(new Error('timeout'));
    await c.send();
    mocks.post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'Nick mất kết nối' } } });
    await c.send();
    expect(c.state.value.uncertain).toBe(true);
    c.draft.value = 'Nội dung khác'; await c.send();
    expect(mocks.post.mock.calls[2][1]).toEqual(mocks.post.mock.calls[0][1]);
    expect(c.draft.value).toBe('Nội dung khác'); c.scope.stop();
  });

  it('shows a Zalo business failure even on HTTP 200 and retains retry identity', async () => {
    const c = setup(); c.draft.value = 'Tin bị từ chối';
    mocks.post.mockResolvedValueOnce({ data: { id: 'failed', deliveryState: 'failed', metadata: { sendStatus: 'failed', failReason: 'Khách chặn nhận tin' } } });
    await c.send();
    expect(c.onSent).not.toHaveBeenCalled(); expect(c.state.value.error).toBe('Khách chặn nhận tin');
    expect(c.draft.value).toBe('Tin bị từ chối'); expect(c.state.value.uncertain).toBe(false);
    await c.send(); expect(mocks.post.mock.calls[1][1]).toEqual(mocks.post.mock.calls[0][1]);
    c.scope.stop();
  });

  it('allocates a new echo when the user edits a definitively failed message', async () => {
    const c = setup(); c.draft.value = 'Cũ';
    mocks.post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'Nick chưa kết nối' } } });
    await c.send(); c.draft.value = 'Mới'; await c.send();
    expect(mocks.post.mock.calls[1][1].echoId).not.toBe(mocks.post.mock.calls[0][1].echoId);
    expect(mocks.post.mock.calls[1][1].content).toBe('Mới');
    c.scope.stop();
  });

  it('checks permissions, empty drafts and lost session before any send', async () => {
    const c = setup(); await c.send(); c.draft.value = 'Tin'; c.allowed.value = false; await c.send();
    c.allowed.value = true; c.userId.value = ''; c.draft.value = 'Tin'; await c.send();
    expect(mocks.post).not.toHaveBeenCalled(); c.scope.stop();
  });

  it('invalidates the active conversation on denied access without affecting another selection', async () => {
    const c = setup(); c.draft.value = 'Tin';
    mocks.post.mockRejectedValueOnce({ response: { status: 403, data: { error: 'Không có quyền' } } });
    await c.send(); expect(c.onForbidden).toHaveBeenCalledOnce(); expect(c.draft.value).toBe('Tin');
    const request = deferred(); mocks.post.mockReturnValueOnce(request.promise);
    const sending = c.send(); c.conversationId.value = 'b'; c.draft.value = 'B';
    request.reject({ response: { status: 404 } }); await sending;
    expect(c.onForbidden).toHaveBeenCalledTimes(1); expect(c.draft.value).toBe('B');
    c.scope.stop();
  });

  it('does not overwrite a listener confirmation when the HTTP response subsequently fails', async () => {
    const c = setup(); c.draft.value = 'Tin'; const request = deferred(); mocks.post.mockReturnValue(request.promise);
    const sending = c.send(); const echo = mocks.post.mock.calls[0][1].echoId;
    c.messages.value = [{ id: 'delivered', clientEchoId: echo, deliveryState: 'completed' } as unknown as Message]; await nextTick();
    request.reject(new Error('lost HTTP')); await sending;
    expect(c.state.value.error).toBe(''); expect(c.state.value.uncertain).toBe(false); expect(c.onSent).toHaveBeenCalledOnce();
    c.scope.stop();
  });
});
