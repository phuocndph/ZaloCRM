// @vitest-environment jsdom
import { effectScope, ref } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), state: vi.fn(), sync: vi.fn(), handlers: new Map<string, (...args: any[]) => any>() }));
vi.mock('@/api', () => ({ api: { get: mocks.get } }));
vi.mock('@/api/socket', () => ({ createAppSocket: () => ({ on: (event: string, fn: (...args: any[]) => any) => mocks.handlers.set(event, fn), disconnect: vi.fn() }) }));
import { eligibleDesktopUnread, useDesktopUnread } from './use-desktop-unread';
const scopes: ReturnType<typeof effectScope>[] = [];
function start(enabled = ref(true)) { const scope = effectScope(); scopes.push(scope); const owner = ref('org:user'); scope.run(() => useDesktopUnread(owner, enabled)); return owner; }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  window.zaloDesktop = { role: 'main', state: mocks.state, syncUnread: mocks.sync, clear: vi.fn() } as any;
  mocks.state.mockResolvedValue({ signedIn: true, revision: 10 }); mocks.sync.mockResolvedValue(true);
  mocks.get.mockResolvedValue({ data: { conversations: [{ id: 'conv', unreadCount: 7, zaloAccount: { privacyMode: 'sub' } }], hasMore: false } });
});
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop(); delete window.zaloDesktop; vi.useRealTimers(); });
describe('authoritative desktop unread', () => {
  it('restores CRM unread across sessions without replaying preview notifications', async () => {
    start(); await vi.advanceTimersByTimeAsync(800); await flushPromises(); expect(mocks.sync).toHaveBeenCalledWith([{ convId: 'conv', count: 7 }], 10);
  });
  it('scans all unread pages, not just the first 100 rows', async () => {
    mocks.get.mockImplementation((_path: string, opts: any) => Promise.resolve({ data: opts.params.cursor ? { conversations: [{ id: 'second', unreadCount: 2 }], hasMore: false } : { conversations: [{ id: 'first', unreadCount: 3 }], hasMore: true, nextCursor: 'next' } }));
    start(); await vi.advanceTimersByTimeAsync(800); await flushPromises(); expect(mocks.sync).toHaveBeenCalledWith([{ convId: 'first', count: 3 }, { convId: 'second', count: 2 }], 10);
  });
  it('excludes personal/Zalo mute and private nick data from the badge but not from the inbox', () => {
    const row = { id: 'conv', unreadCount: 3 } as any;
    expect(eligibleDesktopUnread(row)).toBe(true);
    expect(eligibleDesktopUnread({ ...row, zaloAccount: { privacyMode: 'main' } })).toBe(false);
    expect(eligibleDesktopUnread({ ...row, zaloNotificationsMuted: true })).toBe(false);
    expect(eligibleDesktopUnread({ ...row, redacted: true })).toBe(false);
    expect(eligibleDesktopUnread({ ...row, userState: { flags: { notificationMute: { mode: 'forever' } } } })).toBe(false);
  });
  it('never pushes a stale result after account switch/logout', async () => {
    let resolve!: (value: any) => void; mocks.get.mockReturnValue(new Promise((done) => { resolve = done; }));
    const owner = start(); await vi.advanceTimersByTimeAsync(800); owner.value = ''; await flushPromises();
    resolve({ data: { conversations: [{ id: 'old', unreadCount: 1 }], hasMore: false } }); await flushPromises(); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('retains the last native count on network failure', async () => {
    mocks.get.mockRejectedValue(new Error('offline')); start(); await vi.advanceTimersByTimeAsync(800); await flushPromises(); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('does not restore the badge when global CRM notifications are disabled', async () => {
    const enabled = ref(false); start(enabled); await vi.advanceTimersByTimeAsync(31000); await flushPromises();
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
    enabled.value = true; await vi.advanceTimersByTimeAsync(800); await flushPromises(); expect(mocks.sync).toHaveBeenCalled();
  });
});
