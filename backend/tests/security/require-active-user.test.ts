/**
 * require-active-user.test.ts — Phase 3 C1 (Bảo mật xác thực 2026-06-08)
 * Re-check isActive cho route nhạy cảm: user bị khoá (dù access token còn hạn)
 * bị chặn 401; user active pass.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { authMiddleware, requireActiveUser } from '../../src/modules/auth/auth-middleware.js';
import { prisma } from '../../src/shared/database/prisma-client.js';
import { hasRealDatabase } from '../test-helpers.js';

// Integration test: cần Postgres THẬT (beforeAll xoá/tạo row). Không có DATABASE_URL thật
// thì bỏ qua thay vì đỏ suite. Đặt DATABASE_URL trỏ DB thật để chạy lại.
const HAS_DB = hasRealDatabase();
import { config } from '../../src/config/index.js';

const ORG_ID = 'test-c1-org';
const ACTIVE_ID = 'test-c1-active';
const LOCKED_ID = 'test-c1-locked';

function sign(app: FastifyInstance, id: string) {
  // Access token (typ:'access') cho user id.
  return app.jwt.sign({ id, email: `${id}@x.com`, role: 'owner', orgId: ORG_ID, tv: 0, typ: 'access' });
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: config.jwtSecret });
  app.get('/sensitive', { preHandler: [authMiddleware, requireActiveUser] }, async () => ({ ok: true }));
  await app.ready();
  return app;
}

beforeAll(async () => {
  if (!HAS_DB) return;
  await prisma.user.deleteMany({ where: { id: { in: [ACTIVE_ID, LOCKED_ID] } } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.organization.create({ data: { id: ORG_ID, name: 'C1 Org' } });
  await prisma.user.create({ data: { id: ACTIVE_ID, orgId: ORG_ID, email: 'a@x.com', passwordHash: 'x', fullName: 'A', role: 'owner', isActive: true } });
  await prisma.user.create({ data: { id: LOCKED_ID, orgId: ORG_ID, email: 'l@x.com', passwordHash: 'x', fullName: 'L', role: 'owner', isActive: false } });
});

afterAll(async () => {
  if (!HAS_DB) return;
  await prisma.user.deleteMany({ where: { id: { in: [ACTIVE_ID, LOCKED_ID] } } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.$disconnect();
});

describe.skipIf(!HAS_DB)('requireActiveUser (C1)', () => {
  it('user active + access token -> 200', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/sensitive', headers: { authorization: `Bearer ${sign(app, ACTIVE_ID)}` } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('user bị khoá (isActive=false) + access token CÒN HẠN -> 401 user_inactive', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/sensitive', headers: { authorization: `Bearer ${sign(app, LOCKED_ID)}` } });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('user_inactive');
    await app.close();
  });
});
