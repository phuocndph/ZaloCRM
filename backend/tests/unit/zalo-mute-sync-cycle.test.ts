import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ accounts: vi.fn(), conversations: vi.fn(), update: vi.fn(), getMute: vi.fn(), warn: vi.fn() }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: {
  zaloAccount: { findMany: mocks.accounts }, conversation: { findMany: mocks.conversations },
  $transaction: (fn: (tx: any) => any) => fn({ conversation: { updateMany: mocks.update } }),
} }));
vi.mock('../../src/shared/tenant/tenant-context.js', () => ({ runSystemQuery: (fn: () => any) => fn(), withTenant: (_org: string, fn: () => any) => fn() }));
vi.mock('../../src/shared/zalo-operations.js', () => ({ zaloOps: { getMute: mocks.getMute } }));
vi.mock('../../src/shared/utils/logger.js', () => ({ logger: { info: vi.fn(), warn: mocks.warn } }));
import { runZaloMuteSyncCycleNow } from '../../src/modules/zalo/zalo-mute-sync-cron.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accounts.mockResolvedValue([{ id: 'nick', orgId: 'org', displayName: 'Nick' }]);
  mocks.conversations.mockResolvedValue([
    { id: 'group', externalThreadId: 'same-id', threadType: 'group' },
    { id: 'user', externalThreadId: 'same-id', threadType: 'user' },
  ]);
  mocks.update.mockResolvedValue({ count: 1 });
});
describe('Zalo mute synchronization cycle', () => {
  it('syncs direct chats and groups independently even when external IDs collide', async () => {
    mocks.getMute.mockResolvedValue({ groupChatEntries: [], chatEntries: [{ id: 'same-id', duration: -1 }] });
    expect(await runZaloMuteSyncCycleNow()).toMatchObject({ conversations: 2, groups: 1, muted: 1, changed: 2 });
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ where: { id: 'group' }, data: { zaloNotificationsMuted: false, zaloMutedUntil: null } });
    expect(mocks.update.mock.calls[1][0]).toMatchObject({ where: { id: 'user' }, data: { zaloNotificationsMuted: true, zaloMutedUntil: null } });
  });
  it('does not reset missing chat types on a partial response', async () => {
    mocks.getMute.mockResolvedValue({ groupChatEntries: [] });
    mocks.conversations.mockResolvedValue([{ id: 'group', externalThreadId: 'group-id', threadType: 'group' }]);
    await runZaloMuteSyncCycleNow();
    expect(mocks.conversations.mock.calls[0][0].where.threadType).toEqual({ in: ['group'] });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it('does not unmute conversations on malformed responses or transport failure', async () => {
    mocks.getMute.mockResolvedValue({ groupChatEntries: null });
    await runZaloMuteSyncCycleNow(); expect(mocks.update).not.toHaveBeenCalled();
    mocks.getMute.mockRejectedValue(new Error('offline'));
    await runZaloMuteSyncCycleNow(); expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledTimes(2);
  });
  it('updates a timed mute when its old expiry is SQL NULL', async () => {
    mocks.getMute.mockResolvedValue({ groupChatEntries: [{ id: 'same-id', duration: 3600, startTime: Math.floor(Date.now() / 1000) }], chatEntries: [] });
    await runZaloMuteSyncCycleNow();
    expect(mocks.update.mock.calls[0][0].where.OR).toContainEqual({ zaloMutedUntil: null });
    expect(mocks.update.mock.calls[0][0].data.zaloMutedUntil).toBeInstanceOf(Date);
  });
  it('issues no UPDATE and opens no transaction when stored state already matches Zalo', async () => {
    const start = Math.floor(Date.now() / 1000);
    mocks.getMute.mockResolvedValue({ groupChatEntries: [{ id: 'g-timed', duration: 3600, startTime: start }], chatEntries: [{ id: 'u-forever', duration: -1 }] });
    mocks.conversations.mockResolvedValue([
      { id: 'a', externalThreadId: 'g-timed', threadType: 'group', zaloNotificationsMuted: true, zaloMutedUntil: new Date((start + 3600) * 1000) },
      { id: 'b', externalThreadId: 'u-forever', threadType: 'user', zaloNotificationsMuted: true, zaloMutedUntil: null },
      { id: 'c', externalThreadId: 'u-plain', threadType: 'user', zaloNotificationsMuted: false, zaloMutedUntil: null },
    ]);
    expect(await runZaloMuteSyncCycleNow()).toMatchObject({ conversations: 3, muted: 2, changed: 0 });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('updates only the conversations whose mute state differs', async () => {
    mocks.getMute.mockResolvedValue({ groupChatEntries: [], chatEntries: [{ id: 'u-new', duration: -1 }] });
    mocks.conversations.mockResolvedValue([
      { id: 'same', externalThreadId: 'u-old', threadType: 'user', zaloNotificationsMuted: false, zaloMutedUntil: null },
      { id: 'newly-muted', externalThreadId: 'u-new', threadType: 'user', zaloNotificationsMuted: false, zaloMutedUntil: null },
      { id: 'unmuted', externalThreadId: 'u-gone', threadType: 'user', zaloNotificationsMuted: true, zaloMutedUntil: null },
    ]);
    expect(await runZaloMuteSyncCycleNow()).toMatchObject({ conversations: 3, muted: 1, changed: 2 });
    expect(mocks.update.mock.calls.map((call) => call[0].where.id)).toEqual(['newly-muted', 'unmuted']);
  });
  it('queries only connected, non-archived accounts and ignores deleted conversations', async () => {
    mocks.getMute.mockResolvedValue({ groupChatEntries: [], chatEntries: [] });
    await runZaloMuteSyncCycleNow();
    expect(mocks.accounts.mock.calls[0][0].where).toEqual({ status: 'connected', archivedAt: null });
    expect(mocks.conversations.mock.calls[0][0].where).toMatchObject({ zaloAccountId: 'nick', deletedAt: null });
  });
});
