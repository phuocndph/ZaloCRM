/**
 * test-helpers.ts — Shared test utilities for route handler tests.
 * Provides mock factories for Prisma, zaloOps, Fastify request/reply, and Socket.IO.
 * All route tests mock at the ZaloOperations boundary per architecture decision 6A.
 */
import { vi } from 'vitest';

// ── Integration test gate ──────────────────────────────────────────────────
/**
 * DATABASE_URL giả mà vitest.config.ts tiêm khi máy KHÔNG có DB thật — chỉ đủ để
 * `prisma-client` import được (Prisma nối lazy), không kết nối được.
 */
const PLACEHOLDER_DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

/**
 * True khi có Postgres THẬT để chạy integration test (beforeAll xoá/tạo row).
 *
 * Test integration phải tự bỏ qua khi thiếu DB, thay vì đỏ suite ở beforeAll — trước đây
 * 5 file tests/security/* luôn fail trên máy dev không có .env, làm cả suite đỏ và che mất
 * các lỗi thật. Đặt DATABASE_URL trỏ tới DB thật (vd docker-compose) thì chúng chạy lại.
 */
export function hasRealDatabase(): boolean {
  const url = process.env.DATABASE_URL;
  return !!url && url !== PLACEHOLDER_DATABASE_URL;
}

// ── Mock user (JWT decoded) ────────────────────────────────────────────────
export function mockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    orgId: 'org-1',
    email: 'test@example.com',
    role: 'admin',
    ...overrides,
  };
}

// ── Mock Fastify request ───────────────────────────────────────────────────
export function mockRequest(overrides: {
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  user?: ReturnType<typeof mockUser>;
} = {}) {
  return {
    user: overrides.user ?? mockUser(),
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    body: overrides.body ?? {},
  } as any;
}

// ── Mock Fastify reply ─────────────────────────────────────────────────────
export function mockReply() {
  const reply: any = {
    statusCode: 200,
    body: null,
    status(code: number) { reply.statusCode = code; return reply; },
    send(data: unknown) { reply.body = data; return reply; },
  };
  return reply;
}

// ── Mock Socket.IO server ──────────────────────────────────────────────────
export function mockIO() {
  // 2026-06-11: code thật giờ scope socket theo room (io.to('org:...').emit / 'user:...').
  // mockIO phải hỗ trợ .to() trả về object có .emit để emitChatMessage không throw.
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  const inFn = vi.fn(() => ({ fetchSockets: vi.fn(async () => []) }));
  // `_toMock` = handle tới emit của room (io.to(...).emit). Expose để test assert được
  // nội dung event mà không phải lần theo giá trị trả về của `to`.
  return { emit, to, in: inFn, _toMock: { emit } } as any;
}

// ── Prisma mock factory ────────────────────────────────────────────────────
/** Các method Prisma sinh sẵn cho mỗi model được truy cập. */
const PRISMA_MODEL_METHODS = [
  'findFirst', 'findUnique', 'findUniqueOrThrow', 'findFirstOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy',
  'create', 'createMany', 'update', 'updateMany', 'upsert',
  'delete', 'deleteMany',
] as const;

function makeModelMock() {
  const model: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of PRISMA_MODEL_METHODS) model[m] = vi.fn();
  return model;
}

/**
 * Mock Prisma client cho route test.
 *
 * Dùng Proxy TỰ SINH model khi được truy cập lần đầu, thay vì liệt kê tay từng model.
 * Trước đây danh sách cứng (8 model) → route thêm `prisma.friend.findUnique` là test chết
 * với "Cannot read properties of undefined (reading 'findUnique')", một lỗi hạ tầng test
 * chứ không phải lỗi code. Proxy làm mock không bao giờ lỗi thời theo schema.
 *
 * Mỗi model được cache sau lần truy cập đầu → `prismaMock.friend.findUnique` trong test và
 * `prisma.friend.findUnique` trong route là CÙNG một vi.fn(), nên `mockResolvedValue` và
 * `toHaveBeenCalledWith` hoạt động bình thường.
 */
export function mockPrisma(): any {
  const models = new Map<string, ReturnType<typeof makeModelMock>>();
  // $-method phải được CACHE: nếu mỗi lần truy cập trả vi.fn() mới thì
  // `prismaMock.$transaction.mockImplementation(...)` trong test sẽ gắn lên một hàm khác
  // với hàm mà code thật gọi → mock im lặng không có tác dụng.
  const specials = new Map<string, ReturnType<typeof vi.fn>>();
  const proxy: any = new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string | symbol) {
      if (typeof prop !== 'string') return undefined;
      // `await prismaMock` / assert lib dò `then` → phải trả undefined, nếu không Promise
      // sẽ tưởng đây là thenable và treo.
      if (prop === 'then' || prop === 'constructor') return undefined;
      if (prop.startsWith('$')) {
        if (!specials.has(prop)) {
          specials.set(
            prop,
            prop === '$transaction'
              // callback-style nhận `tx` (chính proxy này) hoặc array-style.
              ? vi.fn(async (arg: unknown) =>
                  typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(proxy) : arg,
                )
              : vi.fn(),
          );
        }
        return specials.get(prop);
      }
      if (!models.has(prop)) models.set(prop, makeModelMock());
      return models.get(prop);
    },
    has: () => true,
  });
  return proxy;
}

/**
 * Mock đầy đủ module prisma-client — gồm cả `tenantTransaction` (dùng trong tag-service).
 * `tenantTransaction(cb)` thật mở transaction + set tenant context; ở test ta chỉ chạy
 * callback với `tx` do caller cung cấp (mặc định chính prisma mock).
 */
export function mockPrismaClientModule(prismaMock: any, tx: any = prismaMock) {
  return {
    prisma: prismaMock,
    tenantTransaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
  };
}

// ── ZaloOps mock factory — all methods as vi.fn() ──────────────────────────
export function mockZaloOps() {
  return {
    addReaction: vi.fn().mockResolvedValue({ success: true }),
    sendTypingEvent: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    undoMessage: vi.fn().mockResolvedValue(undefined),
    editMessage: vi.fn().mockResolvedValue(undefined),
    forwardMessage: vi.fn().mockResolvedValue(undefined),
    sendFile: vi.fn().mockResolvedValue({ message: { msgId: 'media-zalo-msg-1' } }),
    sendVoice: vi.fn().mockResolvedValue({ message: { msgId: 'voice-zalo-msg-1' } }),
    pinConversation: vi.fn().mockResolvedValue({ success: true }),
    getPinConversations: vi.fn().mockResolvedValue([]),
    sendSticker: vi.fn().mockResolvedValue({ success: true }),
    sendLink: vi.fn().mockResolvedValue({ success: true }),
    sendCard: vi.fn().mockResolvedValue({ success: true }),
    // Group management
    createGroup: vi.fn().mockResolvedValue({ groupId: 'g1' }),
    renameGroup: vi.fn().mockResolvedValue(undefined),
    changeGroupAvatar: vi.fn().mockResolvedValue(undefined),
    updateGroupSettings: vi.fn().mockResolvedValue(undefined),
    addUserToGroup: vi.fn().mockResolvedValue(undefined),
    removeUserFromGroup: vi.fn().mockResolvedValue(undefined),
    addGroupDeputy: vi.fn().mockResolvedValue(undefined),
    removeGroupDeputy: vi.fn().mockResolvedValue(undefined),
    changeGroupOwner: vi.fn().mockResolvedValue(undefined),
    blockGroupMember: vi.fn().mockResolvedValue(undefined),
    unblockGroupMember: vi.fn().mockResolvedValue(undefined),
    leaveGroup: vi.fn().mockResolvedValue(undefined),
    disperseGroup: vi.fn().mockResolvedValue(undefined),
    // Group read
    getGroupInfo: vi.fn().mockResolvedValue({ name: 'Test Group' }),
    getAllGroups: vi.fn().mockResolvedValue([]),
    getGroupMembersInfo: vi.fn().mockResolvedValue([]),
    getGroupBlockedMembers: vi.fn().mockResolvedValue([]),
    getPendingGroupMembers: vi.fn().mockResolvedValue([]),
    getGroupLinkDetail: vi.fn().mockResolvedValue({ link: '' }),
    // Polls
    createPoll: vi.fn().mockResolvedValue({ pollId: 'p1' }),
    getPollDetail: vi.fn().mockResolvedValue({ question: 'Q?' }),
    votePoll: vi.fn().mockResolvedValue(undefined),
    lockPoll: vi.fn().mockResolvedValue(undefined),
    sharePoll: vi.fn().mockResolvedValue(undefined),
    // Friends
    getAllFriends: vi.fn().mockResolvedValue([]),
    findUser: vi.fn().mockResolvedValue([]),
    getFriendOnlines: vi.fn().mockResolvedValue([]),
    getFriendRecommendations: vi.fn().mockResolvedValue([]),
    sendFriendRequest: vi.fn().mockResolvedValue({ success: true }),
    acceptFriendRequest: vi.fn().mockResolvedValue({ success: true }),
    rejectFriendRequest: vi.fn().mockResolvedValue({ success: true }),
    cancelFriendRequest: vi.fn().mockResolvedValue({ success: true }),
    getSentFriendRequests: vi.fn().mockResolvedValue([]),
    getFriendRequestStatus: vi.fn().mockResolvedValue({ status: 'none' }),
    removeFriend: vi.fn().mockResolvedValue({ success: true }),
    changeFriendAlias: vi.fn().mockResolvedValue({ success: true }),
    removeFriendAlias: vi.fn().mockResolvedValue({ success: true }),
    getAliasList: vi.fn().mockResolvedValue([]),
    blockUser: vi.fn().mockResolvedValue({ success: true }),
    unblockUser: vi.fn().mockResolvedValue({ success: true }),
    blockViewFeed: vi.fn().mockResolvedValue({ success: true }),
    // Profile
    getUserInfo: vi.fn().mockResolvedValue({ name: 'Test' }),
    getOwnId: vi.fn().mockResolvedValue('uid-1'),
    getAccountInfo: vi.fn().mockResolvedValue({ name: 'Test' }),
    changeAccountAvatar: vi.fn().mockResolvedValue(undefined),
    setOnlineStatus: vi.fn().mockResolvedValue(undefined),
    getLastOnline: vi.fn().mockResolvedValue({ lastOnline: Date.now() }),
  };
}

// ── Mock eventBuffer ───────────────────────────────────────────────────────
export function mockEventBuffer() {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    recordTyping: vi.fn(),
    clearTyping: vi.fn(),
    recordReaction: vi.fn(),
  };
}
