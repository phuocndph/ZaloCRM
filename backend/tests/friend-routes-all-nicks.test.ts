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
