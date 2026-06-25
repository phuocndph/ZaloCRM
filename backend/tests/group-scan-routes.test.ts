/**
 * group-scan-routes.test.ts — Integration tests for E1 group-scan routes.
 * Covers POST /group-scans (selected|all|400|403), GET /:scanId, GET /:scanId/members.
 *
 * Mirrors group-routes.test.ts: builds a Fastify app, registers the route plugin,
 * drives it via inject(); mocks at the prisma + zaloOps + zalo-route-helpers boundary.
 * Community feature — no `_ee` imports.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { mockUser, mockZaloOps } from './test-helpers.js';

// ── Hoisted mock state ──────────────────────────────────────────────────────────
const zaloOpsMock = mockZaloOps();
const enqueueGroupScanMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    zaloAccount: { findFirst: vi.fn() },
    zaloAccountAccess: { findFirst: vi.fn() },
    groupScan: { create: vi.fn(), findFirst: vi.fn() },
    groupMember: { findMany: vi.fn(), count: vi.fn() },
  },
}));
vi.mock('../src/shared/zalo-operations.js', () => ({
  zaloOps: zaloOpsMock,
  ZaloOpError: class extends Error {
    code: string; statusCode: number;
    constructor(msg: string, code: string, statusCode = 400) {
      super(msg); this.code = code; this.statusCode = statusCode;
    }
  },
}));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (req: any) => { req.user = mockUser(); },
}));
vi.mock('../src/modules/zalo/group-scan-queue.js', () => ({
  enqueueGroupScan: enqueueGroupScanMock,
}));
// resolveAccount/checkAccess/handleError stubbed exactly like group-routes.test.ts.
// checkAccess sends its own reply on denial (matching real helper), so tests that
// exercise 403 override it to return false + send 403.
const resolveAccountMock = vi.fn().mockResolvedValue({ id: 'za-1', orgId: 'org-1' });
const checkAccessMock = vi.fn().mockResolvedValue(true);
vi.mock('../src/modules/zalo/zalo-route-helpers.js', () => ({
  resolveAccount: (...a: any[]) => resolveAccountMock(...a),
  checkAccess: (...a: any[]) => checkAccessMock(...a),
  handleError: vi.fn().mockImplementation((reply: any, err: any, _op: string) => {
    reply.status(err?.statusCode ?? 500).send({ error: err?.message ?? 'Error' });
  }),
}));

const { groupScanRoutes } = await import('../src/modules/zalo/group-scan-routes.js');
const { prisma } = await import('../src/shared/database/prisma-client.js');

const BASE = '/api/v1/zalo-accounts/za-1/group-scans';

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(groupScanRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveAccountMock.mockResolvedValue({ id: 'za-1', orgId: 'org-1' });
  // Default: allow access. 403 tests override to send 403 and return false.
  checkAccessMock.mockResolvedValue(true);
});

// ── POST create scan ────────────────────────────────────────────────────────────
describe('POST /api/v1/zalo-accounts/:accountId/group-scans', () => {
  // AC #1 (part) — empty groupIds and all!=true → 400, no scan created.
  it('returns 400 when groupIds is empty and all is not set', async () => {
    const res = await buildApp().inject({ method: 'POST', url: BASE, payload: { groupIds: [] } });
    expect(res.statusCode).toBe(400);
    expect((prisma as any).groupScan.create).not.toHaveBeenCalled();
    expect(enqueueGroupScanMock).not.toHaveBeenCalled();
  });

  it('returns 400 when body is empty (no groupIds, no all)', async () => {
    const res = await buildApp().inject({ method: 'POST', url: BASE, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  // AC #2 — account outside caller's org / no access → 403 (checkAccess denies).
  it('returns 403 when caller lacks access to the account', async () => {
    checkAccessMock.mockImplementationOnce(async (_req: any, reply: any) => {
      reply.status(403).send({ error: 'Không có quyền truy cập tài khoản Zalo này' });
      return false;
    });
    const res = await buildApp().inject({
      method: 'POST', url: BASE, payload: { groupIds: ['A'] },
    });
    expect(res.statusCode).toBe(403);
    expect((prisma as any).groupScan.create).not.toHaveBeenCalled();
    expect(enqueueGroupScanMock).not.toHaveBeenCalled();
  });

  // AC #3 (route) — all:true snapshots getAllGroups() keys into groupIds, state=queued, enqueues.
  it('all:true snapshots getAllGroups() into groupIds, state=queued, and enqueues', async () => {
    zaloOpsMock.getAllGroups.mockResolvedValueOnce({ gridVerMap: { gA: '1', gB: '2' } });
    (prisma as any).groupScan.create.mockResolvedValueOnce({
      id: 'scan-1', scope: 'all', groupIds: ['gA', 'gB'], state: 'queued', totalGroups: 2,
    });
    const res = await buildApp().inject({ method: 'POST', url: BASE, payload: { all: true } });
    expect(res.statusCode).toBe(201);
    expect(zaloOpsMock.getAllGroups).toHaveBeenCalledWith('za-1');
    const createArg = (prisma as any).groupScan.create.mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      scope: 'all', groupIds: ['gA', 'gB'], state: 'queued', totalGroups: 2,
    });
    expect(enqueueGroupScanMock).toHaveBeenCalledWith('scan-1');
  });

  // AC #1 (main) / AC #4 — selected groupIds create GroupScan(state=queued, totalGroups=2) + enqueue.
  it('groupIds:[A,B] creates GroupScan(state=queued,totalGroups=2) and enqueues one job', async () => {
    (prisma as any).groupScan.create.mockResolvedValueOnce({
      id: 'scan-2', scope: 'selected', groupIds: ['A', 'B'], state: 'queued', totalGroups: 2,
    });
    const res = await buildApp().inject({
      method: 'POST', url: BASE, payload: { groupIds: ['A', 'B'] },
    });
    expect(res.statusCode).toBe(201);
    const createArg = (prisma as any).groupScan.create.mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      scope: 'selected', groupIds: ['A', 'B'], state: 'queued', totalGroups: 2,
    });
    expect(enqueueGroupScanMock).toHaveBeenCalledTimes(1);
    expect(enqueueGroupScanMock).toHaveBeenCalledWith('scan-2');
    expect(JSON.parse(res.body)).toMatchObject({ scan: { id: 'scan-2' } });
  });

  it('dedups groupIds before persisting', async () => {
    (prisma as any).groupScan.create.mockResolvedValueOnce({ id: 'scan-3' });
    await buildApp().inject({ method: 'POST', url: BASE, payload: { groupIds: ['A', 'A', 'B'] } });
    expect((prisma as any).groupScan.create.mock.calls[0][0].data.groupIds).toEqual(['A', 'B']);
  });

  // review #4 — guardrails on scan creation
  it('returns 400 when groupIds exceeds the cap (5000)', async () => {
    const huge = Array.from({ length: 5001 }, (_, i) => `g${i}`);
    const res = await buildApp().inject({ method: 'POST', url: BASE, payload: { groupIds: huge } });
    expect(res.statusCode).toBe(400);
    expect((prisma as any).groupScan.create).not.toHaveBeenCalled();
  });

  it('returns 409 when a scan is already queued/running for the account', async () => {
    (prisma as any).groupScan.findFirst.mockResolvedValueOnce({ id: 'scan-running', state: 'running' });
    const res = await buildApp().inject({ method: 'POST', url: BASE, payload: { groupIds: ['A'] } });
    expect(res.statusCode).toBe(409);
    expect((prisma as any).groupScan.create).not.toHaveBeenCalled();
  });
});

// ── GET scan status ───────────────────────────────────────────────────────────
describe('GET /api/v1/zalo-accounts/:accountId/group-scans/:scanId', () => {
  // AC #5 — returns scan with state/scannedGroups/totalGroups/memberCount.
  it('returns scan status fields', async () => {
    (prisma as any).groupScan.findFirst.mockResolvedValueOnce({
      id: 'scan-1', state: 'running', scannedGroups: 1, totalGroups: 2, memberCount: 17,
    });
    const res = await buildApp().inject({ method: 'GET', url: `${BASE}/scan-1` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      scan: { id: 'scan-1', state: 'running', scannedGroups: 1, totalGroups: 2, memberCount: 17 },
    });
  });

  it('returns 404 when scan not found', async () => {
    (prisma as any).groupScan.findFirst.mockResolvedValueOnce(null);
    const res = await buildApp().inject({ method: 'GET', url: `${BASE}/missing` });
    expect(res.statusCode).toBe(404);
  });
});

// ── GET roster ──────────────────────────────────────────────────────────────────
describe('GET /api/v1/zalo-accounts/:accountId/group-scans/:scanId/members', () => {
  // AC #6 — isFriend=true filters where.isFriend=true; only friend members returned.
  it('isFriend=true filters to friend members only', async () => {
    (prisma as any).groupScan.findFirst.mockResolvedValueOnce({ groupIds: ['A', 'B'] });
    (prisma as any).groupMember.findMany.mockResolvedValueOnce([
      { memberUid: 'u1', isFriend: true },
    ]);
    (prisma as any).groupMember.count.mockResolvedValueOnce(1);

    const res = await buildApp().inject({
      method: 'GET', url: `${BASE}/scan-1/members?isFriend=true`,
    });
    expect(res.statusCode).toBe(200);
    const whereArg = (prisma as any).groupMember.findMany.mock.calls[0][0].where;
    expect(whereArg).toMatchObject({
      zaloAccountId: 'za-1', groupId: { in: ['A', 'B'] }, isFriend: true,
    });
    const body = JSON.parse(res.body);
    expect(body.members).toHaveLength(1);
    expect(body.members.every((m: any) => m.isFriend === true)).toBe(true);
  });

  it('no isFriend filter → where has no isFriend constraint', async () => {
    (prisma as any).groupScan.findFirst.mockResolvedValueOnce({ groupIds: ['A'] });
    (prisma as any).groupMember.findMany.mockResolvedValueOnce([]);
    (prisma as any).groupMember.count.mockResolvedValueOnce(0);
    await buildApp().inject({ method: 'GET', url: `${BASE}/scan-1/members` });
    const whereArg = (prisma as any).groupMember.findMany.mock.calls[0][0].where;
    expect(whereArg.isFriend).toBeUndefined();
  });

  it('returns 404 when scan not found', async () => {
    (prisma as any).groupScan.findFirst.mockResolvedValueOnce(null);
    const res = await buildApp().inject({ method: 'GET', url: `${BASE}/missing/members` });
    expect(res.statusCode).toBe(404);
  });
});
