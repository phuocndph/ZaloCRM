/**
 * group-scan-worker.test.ts — Unit tests for processGroupScan (E1 worker).
 * Mocks prisma + zaloOps + logger (mirrors friend-sync-service.test.ts). No `_ee`.
 *
 * Asserts real worker behavior from group-scan-worker.ts:
 *   - state machine queued→running→(completed|partial)
 *   - upsert via unique [zaloAccountId, groupId, memberUid] (no dup row, lastSeenAt advances)
 *   - isFriend from Friend(zaloAccountId, zaloUidInNick, friendshipStatus='accepted')
 *   - truncated group (hasMoreMember>0) throws → partial, members upserted, memberCount NOT incremented
 *   - per-group try/catch → other groups still processed, resumeCursor advances
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockZaloOps } from './test-helpers.js';

const zaloOpsMock = mockZaloOps();

const prismaMock = {
  groupScan: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  groupMember: {
    upsert: vi.fn().mockResolvedValue({}),
  },
  friend: {
    findMany: vi.fn().mockResolvedValue([]),
  },
};

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/zalo-operations.js', () => ({ zaloOps: zaloOpsMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { processGroupScan } = await import('../src/modules/zalo/group-scan-worker.js');

// Helpers to shape getGroupInfo's gridInfoMap response.
function groupInfo(
  groupId: string,
  opts: {
    memberIds: string[];
    adminIds?: string[];
    creatorId?: string;
    totalMember?: number;
    hasMoreMember?: number;
    memVerList?: string[];
    currentMems?: Array<{ id: string; dName?: string; zaloName?: string; avatar?: string }>;
  },
) {
  return {
    gridInfoMap: {
      [groupId]: {
        memberIds: opts.memberIds,
        memVerList: opts.memVerList,
        adminIds: opts.adminIds ?? [],
        creatorId: opts.creatorId,
        totalMember: opts.totalMember ?? opts.memberIds.length,
        hasMoreMember: opts.hasMoreMember ?? 0,
        currentMems: opts.currentMems ?? opts.memberIds.map((id) => ({ id, dName: `name-${id}` })),
      },
    },
  };
}

function scanRecord(over: Record<string, unknown> = {}) {
  return {
    id: 'scan-1',
    orgId: 'org-1',
    zaloAccountId: 'za-1',
    groupIds: ['gA'],
    state: 'queued',
    startedAt: null,
    resumeCursor: null,
    ...over,
  };
}

/** Pull the data passed to the LAST groupScan.update call (the final-state write). */
function lastScanUpdate() {
  const calls = prismaMock.groupScan.update.mock.calls;
  return calls[calls.length - 1][0].data;
}
/** Find a groupScan.update call whose data has the given key. */
function scanUpdatesWith(key: string) {
  return prismaMock.groupScan.update.mock.calls
    .map((c) => c[0].data)
    .filter((d) => Object.prototype.hasOwnProperty.call(d, key));
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.groupScan.findUnique.mockReset();
  prismaMock.groupScan.update.mockReset().mockResolvedValue({});
  prismaMock.groupMember.upsert.mockReset().mockResolvedValue({});
  prismaMock.friend.findMany.mockReset().mockResolvedValue([]);
  zaloOpsMock.getGroupInfo.mockReset();
  zaloOpsMock.getGroupMembersInfo.mockReset().mockResolvedValue({ profiles: {} });
});

// ── AC #7 — happy path ───────────────────────────────────────────────────────────
describe('processGroupScan — happy path (1 group, N members)', () => {
  it('upserts N GroupMember rows and ends state=completed', async () => {
    prismaMock.groupScan.findUnique.mockResolvedValueOnce(
      scanRecord({ groupIds: ['gA'] }),
    );
    zaloOpsMock.getGroupInfo.mockResolvedValueOnce(
      groupInfo('gA', { memberIds: ['u1', 'u2', 'u3'] }),
    );

    await processGroupScan('scan-1');

    // N upserts, one per member, keyed by the unique composite.
    expect(prismaMock.groupMember.upsert).toHaveBeenCalledTimes(3);
    const keys = prismaMock.groupMember.upsert.mock.calls.map(
      (c) => c[0].where.zaloAccountId_groupId_memberUid,
    );
    expect(keys).toEqual([
      { zaloAccountId: 'za-1', groupId: 'gA', memberUid: 'u1' },
      { zaloAccountId: 'za-1', groupId: 'gA', memberUid: 'u2' },
      { zaloAccountId: 'za-1', groupId: 'gA', memberUid: 'u3' },
    ]);

    // running transition happened, then final completed.
    expect(scanUpdatesWith('state').some((d) => d.state === 'running')).toBe(true);
    expect(lastScanUpdate()).toMatchObject({ state: 'completed' });

    // memberCount incremented by number actually upserted (3).
    const progress = scanUpdatesWith('memberCount');
    expect(progress.some((d) => d.memberCount?.increment === 3)).toBe(true);
  });
});

// ── AC #8 — re-scan / member in 2 groups: upsert in place, lastSeenAt advances ──
describe('processGroupScan — re-scan uses upsert (no duplicate row)', () => {
  it('upsert update payload sets lastSeenAt (advances on re-scan), update branch has no create', async () => {
    prismaMock.groupScan.findUnique.mockResolvedValueOnce(scanRecord({ groupIds: ['gA'] }));
    zaloOpsMock.getGroupInfo.mockResolvedValueOnce(groupInfo('gA', { memberIds: ['u1'] }));

    await processGroupScan('scan-1');

    expect(prismaMock.groupMember.upsert).toHaveBeenCalledTimes(1);
    const call = prismaMock.groupMember.upsert.mock.calls[0][0];
    // Single upsert keyed by unique tuple → no duplicate row possible.
    expect(call.where.zaloAccountId_groupId_memberUid).toEqual({
      zaloAccountId: 'za-1', groupId: 'gA', memberUid: 'u1',
    });
    // update branch advances lastSeenAt and does NOT recreate the row.
    expect(call.update.lastSeenAt).toBeInstanceOf(Date);
    expect(call.update).not.toHaveProperty('orgId');
    expect(call.create).toMatchObject({ orgId: 'org-1', memberUid: 'u1' });
  });

  it('member in 2 groups → one upsert per (group,uid) tuple, no cross-group dup key', async () => {
    prismaMock.groupScan.findUnique.mockResolvedValueOnce(scanRecord({ groupIds: ['gA', 'gB'] }));
    zaloOpsMock.getGroupInfo
      .mockResolvedValueOnce(groupInfo('gA', { memberIds: ['shared'] }))
      .mockResolvedValueOnce(groupInfo('gB', { memberIds: ['shared'] }));

    await processGroupScan('scan-1');

    const keys = prismaMock.groupMember.upsert.mock.calls.map(
      (c) => c[0].where.zaloAccountId_groupId_memberUid,
    );
    expect(keys).toEqual([
      { zaloAccountId: 'za-1', groupId: 'gA', memberUid: 'shared' },
      { zaloAccountId: 'za-1', groupId: 'gB', memberUid: 'shared' },
    ]);
    expect(lastScanUpdate()).toMatchObject({ state: 'completed' });
  });
});

// ── AC #9 — isFriend only when accepted Friend row exists ──────────────────────
describe('processGroupScan — isFriend from Friend(accepted)', () => {
  it('sets isFriend=true only for uids returned by Friend(accepted) lookup', async () => {
    prismaMock.groupScan.findUnique.mockResolvedValueOnce(scanRecord({ groupIds: ['gA'] }));
    zaloOpsMock.getGroupInfo.mockResolvedValueOnce(
      groupInfo('gA', { memberIds: ['friendUid', 'strangerUid'] }),
    );
    // Friend lookup returns only friendUid as accepted.
    prismaMock.friend.findMany.mockResolvedValueOnce([{ zaloUidInNick: 'friendUid' }]);

    await processGroupScan('scan-1');

    // Friend query filtered by zaloAccountId + zaloUidInNick(in batch) + accepted.
    const friendWhere = prismaMock.friend.findMany.mock.calls[0][0].where;
    expect(friendWhere).toMatchObject({
      zaloAccountId: 'za-1',
      friendshipStatus: 'accepted',
    });
    expect(friendWhere.zaloUidInNick.in).toEqual(['friendUid', 'strangerUid']);

    const byUid: Record<string, boolean> = {};
    for (const c of prismaMock.groupMember.upsert.mock.calls) {
      byUid[c[0].where.zaloAccountId_groupId_memberUid.memberUid] = c[0].create.isFriend;
    }
    expect(byUid.friendUid).toBe(true);
    expect(byUid.strangerUid).toBe(false);
  });
});

// ── Regression (test server thật) — roster nằm ở memVerList, memberIds rỗng ──
describe('processGroupScan — members from memVerList (real zca-js shape)', () => {
  it('extracts uid from memVerList when memberIds + currentMems are empty → completed', async () => {
    prismaMock.groupScan.findUnique.mockResolvedValueOnce(scanRecord({ groupIds: ['gA'] }));
    // zca-js thật: memberIds=[], currentMems=[], roster ở memVerList "<uid>_<ver>".
    zaloOpsMock.getGroupInfo.mockResolvedValueOnce(
      groupInfo('gA', {
        memberIds: [],
        currentMems: [],
        memVerList: ['111_3', '222_5', '333_0'],
        totalMember: 3,
      }),
    );

    await processGroupScan('scan-1');

    // 3 member upsert với uid đã tách '_version'.
    expect(prismaMock.groupMember.upsert).toHaveBeenCalledTimes(3);
    const uids = prismaMock.groupMember.upsert.mock.calls.map(
      (c: any) => c[0].where.zaloAccountId_groupId_memberUid.memberUid,
    );
    expect(uids.sort()).toEqual(['111', '222', '333']);
    // Đủ roster (3/3) → completed, không partial.
    expect(lastScanUpdate()).toMatchObject({ state: 'completed' });
  });
});

// ── AC #10 — truncated group (hasMoreMember>0) → partial, members upserted + COUNTED (not inflated) ──
describe('processGroupScan — truncated group → partial', () => {
  it('hasMoreMember>0 ends state=partial, upserts fetched members, counts ONLY fetched (not totalMember)', async () => {
    prismaMock.groupScan.findUnique.mockResolvedValueOnce(scanRecord({ groupIds: ['gA'] }));
    // 2 members fetched but totalMember=5, hasMoreMember=3 → roster truncated.
    zaloOpsMock.getGroupInfo.mockResolvedValueOnce(
      groupInfo('gA', { memberIds: ['u1', 'u2'], totalMember: 5, hasMoreMember: 3 }),
    );

    await processGroupScan('scan-1');

    // Members that WERE fetched are still upserted (no silent loss).
    expect(prismaMock.groupMember.upsert).toHaveBeenCalledTimes(2);
    // Final state partial (truncated, not a failure).
    expect(lastScanUpdate()).toMatchObject({ state: 'partial' });
    // memberCount incremented by ACTUALLY-fetched (2), NOT inflated to totalMember (5).
    const inc = scanUpdatesWith('memberCount');
    expect(inc.some((d) => d.memberCount?.increment === 2)).toBe(true);
    expect(inc.some((d) => d.memberCount?.increment === 5)).toBe(false);
  });
});

// ── AC #11 — one group throws mid-loop → partial, others processed, resumeCursor advances ──
describe('processGroupScan — per-group failure isolation', () => {
  it('one group throws → state=partial, other group still processed, resumeCursor written for each', async () => {
    prismaMock.groupScan.findUnique.mockResolvedValueOnce(
      scanRecord({ groupIds: ['gBad', 'gGood'] }),
    );
    zaloOpsMock.getGroupInfo
      // gBad: no gridInfoMap entry → scanOneGroup throws.
      .mockResolvedValueOnce({ gridInfoMap: {} })
      // gGood: normal.
      .mockResolvedValueOnce(groupInfo('gGood', { memberIds: ['u1'] }));

    await processGroupScan('scan-1');

    // gGood's member was still upserted despite gBad failing first.
    expect(prismaMock.groupMember.upsert).toHaveBeenCalledTimes(1);
    expect(
      prismaMock.groupMember.upsert.mock.calls[0][0].where.zaloAccountId_groupId_memberUid,
    ).toMatchObject({ groupId: 'gGood', memberUid: 'u1' });

    // resumeCursor advanced for both groups (failure path + success path both write it).
    const cursors = scanUpdatesWith('resumeCursor').map((d) => d.resumeCursor);
    expect(cursors).toContain('gBad');
    expect(cursors).toContain('gGood');

    expect(lastScanUpdate()).toMatchObject({ state: 'partial' });
  });

  it('resume: skips groups already at/under resumeCursor', async () => {
    prismaMock.groupScan.findUnique.mockResolvedValueOnce(
      scanRecord({ groupIds: ['gA', 'gB'], resumeCursor: 'gA' }),
    );
    // Only gB should be fetched (gA already done).
    zaloOpsMock.getGroupInfo.mockResolvedValueOnce(groupInfo('gB', { memberIds: ['u9'] }));

    await processGroupScan('scan-1');

    expect(zaloOpsMock.getGroupInfo).toHaveBeenCalledTimes(1);
    expect(zaloOpsMock.getGroupInfo).toHaveBeenCalledWith('za-1', 'gB');
    expect(lastScanUpdate()).toMatchObject({ state: 'completed' });
  });
});

// ── guard: missing scan ─────────────────────────────────────────────────────────
describe('processGroupScan — missing scan', () => {
  it('returns early (no update) when scan not found', async () => {
    prismaMock.groupScan.findUnique.mockResolvedValueOnce(null);
    await processGroupScan('nope');
    expect(prismaMock.groupScan.update).not.toHaveBeenCalled();
  });
});
