/**
 * friend-routes-all-nicks.test.ts — Integration test cho NEW /api/v1/friends-db/all-nicks
 * endpoint (cross-nick aggregate cho FriendsView "Tất cả nick" mode).
 *
 * Critical scenarios:
 *  - User access 0 nicks → empty result không throw
 *  - User access N nicks → flat merge với filter
 *  - Pagination deterministic across nicks
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { mockUser, mockPrisma } from './test-helpers.js';

// mockPrisma() tự sinh model/method → route chạm bảng mới không làm test chết.
const prismaMock = mockPrisma();
/** Nick mà viewer được phép xem. Route đọc `scope.accessibleIds`. */
const getZaloScopeMock = vi.fn();
/** Đặt phạm vi nick cho 1 test. */
function setScope(ids: string[]) {
  getZaloScopeMock.mockResolvedValue({ accessibleIds: ids, displayableIds: ids, ownedIds: ids });
}

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (req: any) => { req.user = mockUser(); },
}));
// RBAC có bộ test riêng. Cho grant đi qua để test ĐÚNG logic route, nếu không mọi route
// gắn requireGrant đều trả 403 vì DB mock không có grant thật.
vi.mock('../src/modules/rbac/rbac-middleware.js', () => ({
  requireGrant: () => async () => {},
}));
vi.mock('../src/modules/zalo/zalo-route-helpers.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue({ id: 'za-1', orgId: 'org-1' }),
  checkAccess: vi.fn().mockResolvedValue(true),
  handleError: vi.fn().mockImplementation((reply: any, err: any) => {
    reply.status(500).send({ error: err?.message || 'Error' });
  }),
}));
vi.mock('../src/modules/zalo/friend-event-handler.js', () => ({
  markFriendRequestSent: vi.fn(),
  applyFriendTransition: vi.fn(),
}));
vi.mock('../src/modules/zalo/friend-sync-service.js', () => ({
  syncFriendsForAccount: vi.fn(),
}));
vi.mock('../src/modules/zalo/zalo-pool.js', () => ({
  zaloPool: { getIO: vi.fn().mockReturnValue(null) },
}));
// Route lấy danh sách nick truy cập được qua getZaloScope (ACL + owned + cascade phòng ban),
// không còn tự query zaloAccountAccess/zaloAccount. zalo-scope có test riêng.
vi.mock('../src/modules/zalo/zalo-scope.js', () => ({
  getZaloScope: (...args: unknown[]) => getZaloScopeMock(...args),
}));

const { friendRoutes } = await import('../src/modules/zalo/friend-routes.js');

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(friendRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  getZaloScopeMock.mockReset();
  prismaMock.friend.findMany.mockReset();
  prismaMock.friend.count.mockReset();
  prismaMock.friend.groupBy.mockReset();
});

describe('GET /api/v1/friends-db/all-nicks', () => {
  it('returns empty when user has 0 accessible nicks', async () => {
    setScope([]);
    const res = await buildApp().inject({ method: 'GET', url: '/api/v1/friends-db/all-nicks' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.friends).toEqual([]);
    expect(body.total).toBe(0);
    expect(prismaMock.friend.findMany).not.toHaveBeenCalled();
  });

  it('queries Friend filtered by accessible accountIds (union of access + owned)', async () => {
    // getZaloScope đã hợp nhất ACL + owned + cascade phòng ban và khử trùng lặp.
    setScope(['za-A', 'za-B', 'za-C']);
    prismaMock.friend.findMany.mockResolvedValue([
      { id: 'f1', zaloAccountId: 'za-A', contact: { fullName: 'KH 1' } },
    ]);
    prismaMock.friend.count.mockResolvedValue(1);
    prismaMock.friend.groupBy.mockResolvedValue([
      { relationshipKind: 'friend', _count: 1 },
    ]);

    const res = await buildApp().inject({ method: 'GET', url: '/api/v1/friends-db/all-nicks' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.accessibleNicks).toBe(3); // za-A, za-B, za-C
    expect(body.total).toBe(1);

    // Verify where clause included all 3 zaloAccountIds (dedup)
    const findCall = prismaMock.friend.findMany.mock.calls[0][0];
    expect(findCall.where.zaloAccountId.in.sort()).toEqual(['za-A', 'za-B', 'za-C']);
  });

  it('applies kind filter when provided', async () => {
    setScope(['za-A']);
    prismaMock.friend.findMany.mockResolvedValue([]);
    prismaMock.friend.count.mockResolvedValue(0);
    prismaMock.friend.groupBy.mockResolvedValue([]);

    await buildApp().inject({
      method: 'GET',
      url: '/api/v1/friends-db/all-nicks?kind=friend',
    });
    const where = prismaMock.friend.findMany.mock.calls[0][0].where;
    expect(where.relationshipKind).toBe('friend');
  });

  it('uses deterministic orderBy chain (lastInboundAt → lastOutboundAt → createdAt → id)', async () => {
    setScope(['za-A']);
    prismaMock.friend.findMany.mockResolvedValue([]);
    prismaMock.friend.count.mockResolvedValue(0);
    prismaMock.friend.groupBy.mockResolvedValue([]);

    await buildApp().inject({ method: 'GET', url: '/api/v1/friends-db/all-nicks' });
    const orderBy = prismaMock.friend.findMany.mock.calls[0][0].orderBy;
    expect(orderBy).toEqual([
      { lastInboundAt: { sort: 'desc', nulls: 'last' } },
      { lastOutboundAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  });

  it('respects pagination params (page=2, limit=10)', async () => {
    setScope(['za-A']);
    prismaMock.friend.findMany.mockResolvedValue([]);
    prismaMock.friend.count.mockResolvedValue(0);
    prismaMock.friend.groupBy.mockResolvedValue([]);

    await buildApp().inject({
      method: 'GET',
      url: '/api/v1/friends-db/all-nicks?page=2&limit=10',
    });
    const call = prismaMock.friend.findMany.mock.calls[0][0];
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
  });
});

describe('GET /api/v1/friends-db/overview', () => {
  const maxAt = new Date('2026-08-24T10:00:00.000Z');

  function pairGroup(overrides: Record<string, unknown> = {}) {
    return {
      contactId: 'contact-1',
      zaloAccountId: 'za-A',
      relationshipKind: 'friend',
      _count: { _all: 1 },
      _sum: { totalInbound: 2, totalOutbound: 1 },
      _max: {
        lastInteractionAt: maxAt,
        lastInboundAt: maxAt,
        lastOutboundAt: null,
        leadScore: 70,
      },
      _min: { stuckSince: null },
      ...overrides,
    };
  }

  function friendRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'friend-1',
      contactId: 'contact-1',
      zaloAccountId: 'za-A',
      zaloUidInNick: 'uid-1',
      relationshipKind: 'friend',
      totalInbound: 2,
      totalOutbound: 1,
      lastInteractionAt: maxAt,
      lastInboundAt: maxAt,
      lastOutboundAt: null,
      crmTagsPerNick: [],
      autoTags: [],
      zaloLabels: [],
      tagAssignments: [],
      contact: { id: 'contact-1', fullName: 'Khách Một', tags: [], tagAssignments: [] },
      zaloAccount: { id: 'za-A', displayName: 'Nick A', privacyMode: 'sub' },
      ...overrides,
    };
  }

  it('returns empty aggregate when user has no accessible accounts', async () => {
    setScope([]);

    const res = await buildApp().inject({ method: 'GET', url: '/api/v1/friends-db/overview' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      contacts: [],
      total: 0,
      totalPairs: 0,
      totalContacts: 0,
      duplicateContacts: 0,
      accessibleNicks: 0,
    });
    expect(prismaMock.friend.groupBy).not.toHaveBeenCalled();
  });

  it('paginates by unique contact and returns per-account message counts', async () => {
    setScope(['za-A', 'za-B']);
    prismaMock.friend.groupBy.mockResolvedValue([
      pairGroup({ _count: { _all: 2 }, _sum: { totalInbound: 3, totalOutbound: 2 } }),
      pairGroup({
        zaloAccountId: 'za-B',
        _sum: { totalInbound: 4, totalOutbound: 3 },
        _max: { lastInteractionAt: maxAt, lastInboundAt: maxAt, lastOutboundAt: maxAt, leadScore: 80 },
      }),
      pairGroup({
        contactId: 'contact-2',
        relationshipKind: 'ghost',
        _sum: { totalInbound: 1, totalOutbound: 0 },
        _max: { lastInteractionAt: null, lastInboundAt: null, lastOutboundAt: null, leadScore: 10 },
      }),
    ]);
    prismaMock.friend.findMany.mockResolvedValue([
      friendRow(),
      friendRow({ id: 'friend-2', zaloUidInNick: 'uid-2', totalInbound: 1, totalOutbound: 1 }),
      friendRow({
        id: 'friend-3',
        zaloAccountId: 'za-B',
        zaloUidInNick: 'uid-3',
        totalInbound: 4,
        totalOutbound: 3,
        zaloAccount: { id: 'za-B', displayName: 'Nick B', privacyMode: 'sub' },
      }),
      friendRow({
        id: 'friend-4',
        contactId: 'contact-2',
        zaloUidInNick: 'uid-4',
        relationshipKind: 'ghost',
        totalInbound: 1,
        totalOutbound: 0,
        lastInteractionAt: null,
        lastInboundAt: null,
        contact: { id: 'contact-2', fullName: 'Khách Hai', tags: [], tagAssignments: [] },
      }),
    ]);

    const res = await buildApp().inject({ method: 'GET', url: '/api/v1/friends-db/overview' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.total).toBe(2);
    expect(body.totalContacts).toBe(2);
    expect(body.totalPairs).toBe(4);
    expect(body.duplicateContacts).toBe(1);
    expect(body.totalMessages).toBe(13);
    expect(body.accountCounts).toEqual({
      'za-A': { pairs: 3, contacts: 2, friends: 2 },
      'za-B': { pairs: 1, contacts: 1, friends: 1 },
    });

    const contact = body.contacts.find((item: any) => item.contactId === 'contact-1');
    expect(contact.accounts).toHaveLength(2);
    expect(contact.friendNickCount).toBe(2);
    expect(contact.isMultiNickFriend).toBe(true);
    expect(contact.totalMessages).toBe(12);
    expect(contact.accounts.find((account: any) => account.zaloAccountId === 'za-A')).toMatchObject({
      identityCount: 2,
      totalInbound: 3,
      totalOutbound: 2,
    });

    expect(prismaMock.friend.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        zaloAccountId: { in: ['za-A', 'za-B'] },
        contactId: { in: ['contact-1', 'contact-2'] },
      }),
    }));
  });

  it('filters duplicate contacts and searches account names plus legacy/taxonomy tags', async () => {
    setScope(['za-A', 'za-B']);
    prismaMock.friend.groupBy
      .mockResolvedValueOnce([
        pairGroup(),
        pairGroup({ zaloAccountId: 'za-B' }),
        pairGroup({ contactId: 'contact-2', relationshipKind: 'ghost' }),
      ])
      .mockResolvedValueOnce([{ contactId: 'contact-1', _count: { _all: 1 } }]);
    prismaMock.friend.findMany.mockResolvedValue([
      friendRow(),
      friendRow({
        id: 'friend-2',
        zaloAccountId: 'za-B',
        zaloUidInNick: 'uid-2',
        zaloAccount: { id: 'za-B', displayName: 'Nick B', privacyMode: 'sub' },
      }),
    ]);

    const res = await buildApp().inject({
      method: 'GET',
      url: '/api/v1/friends-db/overview?multiNickOnly=true&search=VIP',
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.total).toBe(1);
    expect(body.contacts).toHaveLength(1);
    expect(prismaMock.friend.findMany.mock.calls[0][0].where.contactId.in).toEqual(['contact-1']);

    const groupWhere = prismaMock.friend.groupBy.mock.calls[1][0].where;
    const serializedWhere = JSON.stringify(groupWhere);
    expect(serializedWhere).toContain('tagAssignments');
    expect(serializedWhere).toContain('crmTagsPerNick');
    expect(serializedWhere).toContain('zaloLabels');
    expect(serializedWhere).toContain('zaloAccount');
    expect(body.filteredStats).toMatchObject({
      totalContacts: 1,
      totalPairs: 2,
      duplicateContacts: 1,
      totalMessages: 6,
    });
  });

  it('returns inventory summary without fetching Friend detail rows', async () => {
    setScope(['za-A', 'za-B']);
    prismaMock.friend.groupBy.mockResolvedValue([
      pairGroup({ _count: { _all: 2 } }),
      pairGroup({ zaloAccountId: 'za-B' }),
    ]);

    const res = await buildApp().inject({
      method: 'GET',
      url: '/api/v1/friends-db/overview?summaryOnly=true',
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      contacts: [],
      total: 1,
      totalContacts: 1,
      totalPairs: 3,
      duplicateContacts: 1,
      accessibleNicks: 2,
    });
    expect(prismaMock.friend.findMany).not.toHaveBeenCalled();
  });
});
