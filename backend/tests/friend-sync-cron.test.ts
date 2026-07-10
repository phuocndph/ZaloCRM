/**
 * friend-sync-cron.test.ts — Test runFriendSyncCycleNow (direct cycle, no scheduler).
 * Verify: iterate accounts, error in 1 account không break others, no accounts → no-op.
 *
 * 2026-07-10: cron gọi `syncAccountFully` (bạn bè + alias + label), không còn
 * `syncFriendsForAccount`. Kết quả trả về shape mới: { friends:{emittedCount,errors},
 * aliasesUpdated, labelsUpdated, errors: [] }.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockPrisma } from './test-helpers.js';

// mockPrisma() tự sinh model/method → code chạm bảng mới không làm test chết.
const prismaMock = mockPrisma();
const syncAccountFullyMock = vi.fn();

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/zalo/friend-sync-service.js', () => ({
  syncAccountFully: syncAccountFullyMock,
}));
vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
  },
}));

const { runFriendSyncCycleNow } = await import('../src/modules/zalo/friend-sync-cron.js');

/** Kết quả rỗng hợp lệ của syncAccountFully. */
function okResult(over: Record<string, unknown> = {}) {
  return {
    friends: { emittedCount: 0, errors: 0 },
    aliasesUpdated: 0,
    labelsUpdated: 0,
    errors: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.zaloAccount.findMany.mockReset();
  syncAccountFullyMock.mockReset();
});

describe('runFriendSyncCycleNow', () => {
  it('no-op when no connected accounts', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([]);
    await runFriendSyncCycleNow(null);
    expect(syncAccountFullyMock).not.toHaveBeenCalled();
  });

  it('iterates each connected account sequentially', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([
      { id: 'za-1', orgId: 'org-1', displayName: 'Nick 1' },
      { id: 'za-2', orgId: 'org-1', displayName: 'Nick 2' },
    ]);
    syncAccountFullyMock.mockResolvedValue(okResult());
    await runFriendSyncCycleNow(null);
    expect(syncAccountFullyMock).toHaveBeenCalledTimes(2);
    expect(syncAccountFullyMock).toHaveBeenNthCalledWith(
      1, 'za-1', 'org-1', { trigger: 'cron', io: null },
    );
    expect(syncAccountFullyMock).toHaveBeenNthCalledWith(
      2, 'za-2', 'org-1', { trigger: 'cron', io: null },
    );
  });

  it('continues iteration when 1 account fails', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([
      { id: 'za-bad', orgId: 'org-1', displayName: 'Bad' },
      { id: 'za-good', orgId: 'org-1', displayName: 'Good' },
    ]);
    syncAccountFullyMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(okResult({ friends: { emittedCount: 1, errors: 0 } }));
    await runFriendSyncCycleNow(null);
    expect(syncAccountFullyMock).toHaveBeenCalledTimes(2);
  });

  it('accumulates emittedCount + errors across accounts', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([
      { id: 'za-1', orgId: 'o', displayName: 'A' },
      { id: 'za-2', orgId: 'o', displayName: 'B' },
    ]);
    syncAccountFullyMock
      .mockResolvedValueOnce(okResult({ friends: { emittedCount: 3, errors: 1 }, labelsUpdated: 2 }))
      .mockResolvedValueOnce(okResult({ friends: { emittedCount: 2, errors: 0 }, aliasesUpdated: 1 }));
    await runFriendSyncCycleNow(null);
    expect(syncAccountFullyMock).toHaveBeenCalledTimes(2);
  });

  it('passes IO param through to syncAccountFully', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([
      { id: 'za-io', orgId: 'org-1', displayName: 'Nick' },
    ]);
    syncAccountFullyMock.mockResolvedValue(okResult());
    const fakeIO = { emit: vi.fn() } as any;
    await runFriendSyncCycleNow(fakeIO);
    expect(syncAccountFullyMock).toHaveBeenCalledWith(
      'za-io', 'org-1', { trigger: 'cron', io: fakeIO },
    );
  });
});
