/**
 * auth-flow.test.ts — Phase 2 (Bảo mật xác thực 2026-06-08)
 *
 * Integration test luồng token trên DB test: login -> access(typ:access,15') +
 * refresh; /auth/refresh xoay; reuse -> 401; access token qua /profile; legacy
 * 7d token vẫn dùng được (4A).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { authRoutes } from '../../src/modules/auth/auth-routes.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { hasRealDatabase } from '../test-helpers.js';

// Integration test: cần Postgres THẬT (beforeAll xoá/tạo row). Không có DATABASE_URL thật
// thì bỏ qua thay vì đỏ suite. Đặt DATABASE_URL trỏ DB thật để chạy lại.
const HAS_DB = hasRealDatabase();
import { config } from '../../src/config/index.js';

const ORG_ID = 'test-af-org';
const USER_ID = 'test-af-user';
const PASSWORD = 'secret123';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: config.jwtSecret });
  await app.register(authRoutes);
  await app.ready();
  return app;
}

beforeAll(async () => {
  if (!HAS_DB) return;
  await prisma.refreshToken.deleteMany({ where: { userId: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.organization.create({ data: { id: ORG_ID, name: 'AF Org' } });
  await prisma.user.create({
    data: {
      id: USER_ID,
      orgId: ORG_ID,
      email: 'af-test@example.com',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      fullName: 'AF Test',
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

describe.skipIf(!HAS_DB)('auth flow (Phase 2)', () => {
  it('login trả access (typ:access) + refresh', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'af-test@example.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    const decoded = app.jwt.decode<{ typ?: string; exp: number; iat: number }>(body.token)!;
    expect(decoded.typ).toBe('access');
    // TTL ~15' (900s), cho sai số.
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(16 * 60);
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(14 * 60);
    await app.close();
  });

  it('access token qua /profile OK (bỏ check tv — 10A)', async () => {
    const app = await buildApp();
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email: 'af-test@example.com', password: PASSWORD },
    });
    const token = login.json().token;
    const res = await app.inject({
      method: 'GET', url: '/api/v1/profile',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(USER_ID);
    await app.close();
  });

  it('legacy 7d token (không typ) vẫn dùng được /profile (4A)', async () => {
    const app = await buildApp();
    const legacy = app.jwt.sign(
      { id: USER_ID, email: 'af-test@example.com', role: 'owner', orgId: ORG_ID, tv: 0 },
      { expiresIn: '7d' },
    );
    const res = await app.inject({
      method: 'GET', url: '/api/v1/profile',
      headers: { authorization: `Bearer ${legacy}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('/auth/refresh xoay token; reuse token cũ -> 401', async () => {
    config.refreshGraceMs = 0; // tắt grace để test reuse
    const app = await buildApp();
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email: 'af-test@example.com', password: PASSWORD },
    });
    const oldRefresh = login.json().refreshToken;

    const r1 = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh',
      payload: { refreshToken: oldRefresh },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().refreshToken).not.toBe(oldRefresh);
    expect(r1.json().token).toBeTruthy();

    // Dùng lại refresh cũ -> reuse -> 401.
    const r2 = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh',
      payload: { refreshToken: oldRefresh },
    });
    expect(r2.statusCode).toBe(401);
    expect(r2.json().code).toBe('refresh_reuse');
    config.refreshGraceMs = 20000;
    await app.close();
  });

  it('/auth/logout revoke -> refresh sau đó 401', async () => {
    const app = await buildApp();
    const login = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { email: 'af-test@example.com', password: PASSWORD },
    });
    const refresh = login.json().refreshToken;
    const out = await app.inject({
      method: 'POST', url: '/api/v1/auth/logout',
      payload: { refreshToken: refresh },
    });
    expect(out.statusCode).toBe(200);
    const r = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh',
      payload: { refreshToken: refresh },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
