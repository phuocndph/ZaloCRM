/**
 * refresh-token-service.test.ts — Phase 2 (Bảo mật xác thực 2026-06-08)
 *
 * Integration test trên DB test thật: rotation, reuse-detection (revoke family),
 * grace window, expiry, invalid.
 *
 * Yêu cầu DATABASE_URL trỏ DB test (xem plans/.../plan.md). Skip nếu không có DB.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { hasRealDatabase } from '../test-helpers.js';

// Integration test: cần Postgres THẬT (beforeAll xoá/tạo row). Không có DATABASE_URL thật
// thì bỏ qua thay vì đỏ suite. Đặt DATABASE_URL trỏ DB thật để chạy lại.
const HAS_DB = hasRealDatabase();
import { config } from '../../src/config/index.js';
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeFamily,
  RefreshReuseError,
  RefreshInvalidError,
} from '../../src/modules/auth/refresh-token-service.js';

const ORG_ID = 'test-rt-org';
const USER_ID = 'test-rt-user';

beforeAll(async () => {
  if (!HAS_DB) return;
  await prisma.refreshToken.deleteMany({ where: { userId: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.organization.create({ data: { id: ORG_ID, name: 'RT Test Org' } });
  await prisma.user.create({
    data: {
      id: USER_ID,
      orgId: ORG_ID,
      email: 'rt-test@example.com',
      passwordHash: 'x',
      fullName: 'RT Test',
      role: 'owner',
    },
  });
});

afterAll(async () => {
  if (!HAS_DB) return;
  await prisma.refreshToken.deleteMany({ where: { userId: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  if (!HAS_DB) return;
  await prisma.refreshToken.deleteMany({ where: { userId: USER_ID } });
  config.refreshGraceMs = 20000; // reset về default mỗi test
});

describe.skipIf(!HAS_DB)('refresh-token-service', () => {
  it('issue + rotate (happy): token mới cùng family, token cũ đánh dấu usedAt', async () => {
    const t1 = await issueRefreshToken(USER_ID);
    const t2 = await rotateRefreshToken(t1.token);
    expect(t2.token).not.toBe(t1.token);
    expect(t2.familyId).toBe(t1.familyId);
    expect(t2.userId).toBe(USER_ID);

    const old = await prisma.refreshToken.findUnique({ where: { id: t1.id } });
    expect(old?.usedAt).not.toBeNull();
    expect(old?.replacedById).toBe(t2.id);
  });

  it('reuse (ngoài grace): rotate token đã dùng -> revoke CẢ family + throw', async () => {
    config.refreshGraceMs = 0; // mọi usedAt -> reuse ngay
    const t1 = await issueRefreshToken(USER_ID);
    await rotateRefreshToken(t1.token); // t1 -> used
    await expect(rotateRefreshToken(t1.token)).rejects.toBeInstanceOf(RefreshReuseError);

    // CẢ family bị revoke (t1 + t2).
    const alive = await prisma.refreshToken.count({
      where: { familyId: t1.familyId, revokedAt: null },
    });
    expect(alive).toBe(0);
  });

  it('grace window: rotate token vừa xoay (trong grace) -> cấp token mới, KHÔNG throw', async () => {
    config.refreshGraceMs = 20000;
    const t1 = await issueRefreshToken(USER_ID);
    await rotateRefreshToken(t1.token); // t1 used
    const t3 = await rotateRefreshToken(t1.token); // race đa tab trong grace
    expect(t3.familyId).toBe(t1.familyId);
    // Family KHÔNG bị revoke.
    const alive = await prisma.refreshToken.count({
      where: { familyId: t1.familyId, revokedAt: null },
    });
    expect(alive).toBeGreaterThan(0);
  });

  it('token đã revoke -> reuse -> throw', async () => {
    const t1 = await issueRefreshToken(USER_ID);
    await revokeFamily(t1.familyId);
    await expect(rotateRefreshToken(t1.token)).rejects.toBeInstanceOf(RefreshReuseError);
  });

  it('token hết hạn -> RefreshInvalidError', async () => {
    const t1 = await issueRefreshToken(USER_ID);
    await prisma.refreshToken.update({
      where: { id: t1.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(rotateRefreshToken(t1.token)).rejects.toBeInstanceOf(RefreshInvalidError);
  });

  it('token không tồn tại -> RefreshInvalidError', async () => {
    await expect(rotateRefreshToken('garbage-token')).rejects.toBeInstanceOf(RefreshInvalidError);
  });

  it('revokeFamily idempotent + chặn rotate sau logout', async () => {
    const t1 = await issueRefreshToken(USER_ID);
    await revokeFamily(t1.familyId);
    await revokeFamily(t1.familyId); // idempotent
    await expect(rotateRefreshToken(t1.token)).rejects.toBeInstanceOf(RefreshReuseError);
  });

  // QA fix P1: used+expired replay phải là REUSE (revoke family), không phải invalid.
  it('token đã dùng + hết hạn bị replay -> REUSE (revoke family), không phải invalid', async () => {
    config.refreshGraceMs = 0;
    const t1 = await issueRefreshToken(USER_ID);
    await rotateRefreshToken(t1.token); // t1 used
    await prisma.refreshToken.update({ where: { id: t1.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(rotateRefreshToken(t1.token)).rejects.toBeInstanceOf(RefreshReuseError);
    const alive = await prisma.refreshToken.count({ where: { familyId: t1.familyId, revokedAt: null } });
    expect(alive).toBe(0);
  });

  // QA fix P1: grace mint token KẾ THỪA hạn gốc (không gia hạn fresh-TTL).
  it('grace: token mới kế thừa expiresAt của token gốc (không kéo dài lifetime)', async () => {
    config.refreshGraceMs = 20000;
    const t1 = await issueRefreshToken(USER_ID);
    await rotateRefreshToken(t1.token);
    const t3 = await rotateRefreshToken(t1.token); // grace
    expect(t3.expiresAt.getTime()).toBe(t1.expiresAt.getTime());
  });

  // QA fix P1: family vượt tuổi thọ tuyệt đối -> revoke + invalid (không rotate vĩnh viễn).
  it('family quá refreshFamilyMaxMs -> revoke + RefreshInvalidError', async () => {
    const t1 = await issueRefreshToken(USER_ID);
    // Giả lập token gốc tạo 100 ngày trước.
    await prisma.refreshToken.update({
      where: { id: t1.id },
      data: { createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) },
    });
    await expect(rotateRefreshToken(t1.token)).rejects.toBeInstanceOf(RefreshInvalidError);
    const alive = await prisma.refreshToken.count({ where: { familyId: t1.familyId, revokedAt: null } });
    expect(alive).toBe(0);
  });
});
