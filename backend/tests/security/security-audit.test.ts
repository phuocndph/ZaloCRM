/**
 * security-audit.test.ts — Phase 3 (Bảo mật xác thực 2026-06-08)
 * Integration trên DB test: auditSecurityCritical ghi durable; reuse-detection
 * trong rotateRefreshToken sinh row refresh_reuse (category security).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { config } from '../../src/config/index.js';
import { auditSecurityCritical } from '../../src/modules/auth/security-audit.js';
import { issueRefreshToken, rotateRefreshToken } from '../../src/modules/auth/refresh-token-service.js';

const ORG_ID = 'test-aud-org';
const USER_ID = 'test-aud-user';

beforeAll(async () => {
  await prisma.activityLog.deleteMany({ where: { userId: USER_ID } });
  await prisma.refreshToken.deleteMany({ where: { userId: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.organization.create({ data: { id: ORG_ID, name: 'Aud Org' } });
  await prisma.user.create({
    data: { id: USER_ID, orgId: ORG_ID, email: 'aud@example.com', passwordHash: 'x', fullName: 'Aud', role: 'owner' },
  });
});

afterAll(async () => {
  await prisma.activityLog.deleteMany({ where: { userId: USER_ID } });
  await prisma.refreshToken.deleteMany({ where: { userId: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.activityLog.deleteMany({ where: { userId: USER_ID } });
  await prisma.refreshToken.deleteMany({ where: { userId: USER_ID } });
});

describe('security-audit', () => {
  it('auditSecurityCritical ghi durable row (category security, resolve orgId từ userId)', async () => {
    await auditSecurityCritical({ action: 'password_change', userId: USER_ID });
    const rows = await prisma.activityLog.findMany({ where: { userId: USER_ID, action: 'password_change' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('security');
    expect(rows[0].orgId).toBe(ORG_ID);
    expect(rows[0].actorType).toBe('user');
  });

  it('reuse-detection sinh row refresh_reuse', async () => {
    config.refreshGraceMs = 0;
    const t1 = await issueRefreshToken(USER_ID);
    await rotateRefreshToken(t1.token);
    await expect(rotateRefreshToken(t1.token)).rejects.toThrow();

    const rows = await prisma.activityLog.findMany({ where: { userId: USER_ID, action: 'refresh_reuse' } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].category).toBe('security');
    config.refreshGraceMs = 20000;
  });
});
