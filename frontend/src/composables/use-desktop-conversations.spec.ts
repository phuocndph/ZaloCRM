// @vitest-environment jsdom
import { effectScope, ref } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), handlers: new Map<string, (...args: any[]) => any>() }));
vi.mock('@/api', () => ({ api: { get: mocks.get } }));
vi.mock('@/api/socket', () => ({ createAppSocket: () => ({ on: (event: string, fn: (...args: any[]) => any) => mocks.handlers.set(event, fn), disconnect: vi.fn() }) }));
import { useDesktopConversations } from './use-desktop-conversations';
const scopes: ReturnType<typeof effectScope>[] = [];
function start() {
  const scope = effectScope(); scopes.push(scope);
  const search = ref(''), unread = ref(false), account = ref('');
  const inbox = scope.run(() => useDesktopConversations(search, unread, account))!;
  return { inbox, search, unread, account };
}
beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear(); mocks.get.mockImplementation((path: string) => Promise.resolve({ data: path === '/zalo-accounts' ? [{ id: 'nick', displayName: 'Sales' }] : { conversations: [{ id: 'first' }], hasMore: false } })); });
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop(); vi.useRealTimers(); });
describe('desktop conversation inbox', () => {
  it('loads normal CRM conversations independently of the notification queue', async () => {
    const { inbox } = start(); await flushPromises(); expect(inbox.rows.value.map((row) => row.id)).toEqual(['first']);
    expect(inbox.accounts.value).toEqual([{ id: 'nick', displayName: 'Sales' }]);
    expect(mocks.get).toHaveBeenCalledWith('/conversations', expect.objectContaining({ params: expect.objectContaining({ page: 1, limit: 50 }) }));
  });
  it('paginates and deduplicates rows without dropping read conversations', async () => {
    mocks.get.mockImplementation((path: string, opts: any) => Promise.resolve({ data: path === '/zalo-accounts' ? [] : opts.params.cursor ? { conversations: [{ id: 'first' }, { id: 'second' }], hasMore: false } : { conversations: [{ id: 'first', unreadCount: 0 }], hasMore: true, nextCursor: 'next' } }));
    const { inbox } = start(); await flushPromises(); await inbox.loadMore();
    expect(inbox.rows.value.map((row) => row.id)).toEqual(['first', 'second']); expect(inbox.hasMore.value).toBe(false);
  });
  it('rejects stale results after search/account/unread changes', async () => {
    vi.useFakeTimers();
    let resolve!: (value: any) => void;
    mocks.get.mockImplementation((path: string, opts: any) => path === '/zalo-accounts' ? Promise.resolve({ data: [] }) : opts.params.search ? Promise.resolve({ data: { conversations: [{ id: 'fresh' }], hasMore: false } }) : new Promise((done) => { resolve = done; }));
    const { inbox, search, unread, account } = start(); search.value = 'Customer'; unread.value = true; account.value = 'nick';
    await vi.advanceTimersByTimeAsync(230); await flushPromises(); resolve({ data: { conversations: [{ id: 'stale' }], hasMore: false } }); await flushPromises();
    expect(inbox.rows.value.map((row) => row.id)).toEqual(['fresh']);
    expect(mocks.get).toHaveBeenLastCalledWith('/conversations', expect.objectContaining({ params: expect.objectContaining({ search: 'Customer', unread: 'true', accountId: 'nick' }) }));
  });
  it('clears cached rows immediately on privacy/access events', async () => {
    const { inbox } = start(); await flushPromises(); mocks.handlers.get('zalo:access-changed')!();
    expect(inbox.rows.value).toEqual([]); expect(inbox.accounts.value).toEqual([]);
  });
  it('does not wipe current rows on a transient server error', async () => {
    const { inbox } = start(); await flushPromises(); mocks.get.mockRejectedValue(new Error('offline')); await inbox.refresh();
    expect(inbox.rows.value.map((row) => row.id)).toEqual(['first']); expect(inbox.error.value).toContain('Không tải');
  });
});
