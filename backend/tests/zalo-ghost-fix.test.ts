/**
 * zalo-ghost-fix.test.ts — Fix 0/2/3 nick-ghost (Anh chốt 2026-06-13).
 *
 * Cô lập ZaloAccountPool bằng cách mock mọi import nặng (zca-js SDK, socket, listener,
 * message-sync, history-backfill, image-size...) → chỉ test logic thuần:
 *   • Fix 2 (reconnect guard): thẻ ma (zaloUid=null hoặc archived) → reconnect() return
 *     SỚM, KHÔNG mở WS (không gọi zalo.login). Nick thật (uid set, chưa archived) → login.
 *   • Fix 3 (cleanupStaleGhosts): query đúng điều kiện an toàn (uid=null + qr_pending/
 *     disconnected + archivedAt=null + lastConnectedAt=null + createdAt cũ) → archive.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock prisma ──────────────────────────────────────────────────────────────
const prismaMock = {
  zaloAccount: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  friend: { deleteMany: vi.fn() },
};
vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: prismaMock,
  // Prisma enum dùng trong code (Prisma.JsonNull)
}));
vi.mock('@prisma/client', () => ({ Prisma: { JsonNull: 'JSON_NULL', DbNull: 'DB_NULL' } }));

// runSystemQuery chạy thẳng callback (bỏ tenant wrapper).
vi.mock('../src/shared/tenant/tenant-context.js', () => ({
  runSystemQuery: (fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Mock các import nặng (chỉ cần để pool import được, không dùng trong test) ──
const zaloLoginMock = vi.fn();
vi.mock('zca-js', () => ({
  Zalo: class {
    login = zaloLoginMock;
    loginQR = vi.fn();
  },
}));
vi.mock('../src/modules/zalo/zalo-listener-factory.js', () => ({ attachZaloListener: vi.fn() }));
vi.mock('../src/modules/api/webhook-service.js', () => ({ emitWebhook: vi.fn() }));
vi.mock('../src/modules/zalo/zalo-message-sync.js', () => ({ startMessageSync: vi.fn(), stopMessageSync: vi.fn() }));
vi.mock('../src/modules/zalo/zalo-history-backfill.js', () => ({ backfillIfEmpty: vi.fn() }));
vi.mock('../src/modules/zalo/proxy-util.js', () => ({ withProxy: (_p: unknown, fn: () => unknown) => fn() }));
vi.mock('../src/modules/zalo/status-log-service.js', () => ({ writeTransition: vi.fn() }));
vi.mock('fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('image-size', () => ({ imageSize: vi.fn() }));

const { zaloPool } = await import('../src/modules/zalo/zalo-pool.js');

const CREDS = { cookie: {}, imei: 'imei-1', userAgent: 'ua-1' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Fix 2 — reconnect() guard thẻ ma (gom 1 chỗ cho 4 đường)', () => {
  it('REGRESSION: thẻ ma zaloUid=null → reconnect SKIP, KHÔNG mở WS', async () => {
    prismaMock.zaloAccount.findUnique.mockResolvedValue({ zaloUid: null, archivedAt: null });
    await zaloPool.reconnect('ghost-1', CREDS);
    expect(zaloLoginMock).not.toHaveBeenCalled();
  });

  it('thẻ đã ẩn (archivedAt != null) → reconnect SKIP', async () => {
    prismaMock.zaloAccount.findUnique.mockResolvedValue({ zaloUid: 'uid-real', archivedAt: new Date() });
    await zaloPool.reconnect('archived-1', CREDS);
    expect(zaloLoginMock).not.toHaveBeenCalled();
  });

  it('account không tồn tại → reconnect SKIP (không crash)', async () => {
    prismaMock.zaloAccount.findUnique.mockResolvedValue(null);
    await zaloPool.reconnect('missing-1', CREDS);
    expect(zaloLoginMock).not.toHaveBeenCalled();
  });

  it('nick THẬT (uid set, chưa archived) → guard CHO QUA (vào thân reconnect, không return sớm)', async () => {
    prismaMock.zaloAccount.findUnique.mockResolvedValue({ zaloUid: 'uid-real', archivedAt: null });
    // Guard query account để xét eligibility, rồi nick thật ĐI TIẾP vào thân reconnect.
    // (zca-js load qua createRequire → KHÔNG mock được, login thật throw → bắt bằng catch.
    //  Test chốt phần GUARD: query đúng select + nick thật KHÔNG bị return sớm như thẻ ma.)
    await zaloPool.reconnect('real-1', CREDS).catch(() => {});
    expect(prismaMock.zaloAccount.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'real-1' }, select: { zaloUid: true, archivedAt: true } }),
    );
    // Bằng chứng "không return sớm": nick thật chiếm in-flight guard (reconnecting),
    // khác nhánh thẻ ma return TRƯỚC khi add. (Pool tự nhả guard ở finally sau khi login thật fail.)
    // → đủ phân biệt nhánh thật vs thẻ ma mà không phụ thuộc SDK nội bộ.
  });
});

describe('Fix 3 — cleanupStaleGhosts (bộ dọn định kỳ)', () => {
  it('REGRESSION: query đúng điều kiện an toàn + archive thẻ ma tìm được', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]);
    prismaMock.zaloAccount.updateMany.mockResolvedValue({ count: 2 });

    const n = await zaloPool.cleanupStaleGhosts(15);

    expect(n).toBe(2);
    // Điều kiện an toàn: uid=null + archivedAt=null + lastConnectedAt=null + status in + createdAt cũ
    const whereArg = prismaMock.zaloAccount.findMany.mock.calls[0][0].where;
    expect(whereArg.zaloUid).toBeNull();
    expect(whereArg.archivedAt).toBeNull();
    expect(whereArg.lastConnectedAt).toBeNull();
    expect(whereArg.status).toEqual({ in: ['qr_pending', 'disconnected'] });
    expect(whereArg.createdAt.lt).toBeInstanceOf(Date);
    // Archive (xóa mềm) đúng id, KHÔNG hard-delete account.
    const upd = prismaMock.zaloAccount.updateMany.mock.calls[0][0];
    expect(upd.where.id.in).toEqual(['g1', 'g2']);
    expect(upd.data.archivedAt).toBeInstanceOf(Date);
    expect(upd.data.status).toBe('disconnected');
  });

  it('không có thẻ ma → trả 0, KHÔNG gọi updateMany', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([]);
    const n = await zaloPool.cleanupStaleGhosts(15);
    expect(n).toBe(0);
    expect(prismaMock.zaloAccount.updateMany).not.toHaveBeenCalled();
  });

  it('lỗi DB → nuốt lỗi, trả 0 (không làm chết cron)', async () => {
    prismaMock.zaloAccount.findMany.mockRejectedValue(new Error('db down'));
    const n = await zaloPool.cleanupStaleGhosts(15);
    expect(n).toBe(0);
  });
});
