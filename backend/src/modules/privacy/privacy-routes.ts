/**
 * privacy-routes.ts — Phase Riêng Tư 2026-05-22
 *
 * Endpoints:
 *   POST   /api/v1/privacy/setup-pin            { currentPassword, pin }
 *   POST   /api/v1/privacy/unlock               { pin, durationMinutes }  → set HttpOnly cookie + return expiresAt
 *   POST   /api/v1/privacy/lock                                            → revoke current session
 *   GET    /api/v1/privacy/status                                          → hasPin + active sessions
 *   PATCH  /api/v1/zalo-accounts/:id/privacy-mode  { mode }                → flip nick main/sub
 *   POST   /api/v1/admin/privacy/reset-pin/:userId                          → owner reset PIN (forgot PIN)
 *   GET    /api/v1/admin/privacy/audit?userId=                              → audit log unlock events
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { userHasGrant } from '../rbac/permission-group-service.js';
import {
  setupPin,
  unlock,
  lock,
  getStatus,
  adminResetPin,
  revokeAllSessions,
  type SessionDuration,
} from './pin-service.js';

const COOKIE_NAME = 'priv_session';
const COOKIE_OPTS_BASE = {
  httpOnly: true,
  sameSite: 'strict' as const,
  path: '/',
};

export async function registerPrivacyRoutes(app: FastifyInstance): Promise<void> {
  // POST /privacy/setup-pin — yêu cầu current password để chống session-hijack
  app.post('/api/v1/privacy/setup-pin', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const body = (request.body ?? {}) as { currentPassword?: string; pin?: string };
    if (!body.pin || !body.currentPassword) {
      return reply.status(400).send({ error: 'Cần currentPassword + pin' });
    }

    // Verify current login password (re-auth gate)
    const u = await prisma.user.findUnique({
      where: { id: user.userId ?? user.id },
      select: { passwordHash: true },
    });
    if (!u) return reply.status(404).send({ error: 'User not found' });
    const valid = await bcrypt.compare(body.currentPassword, u.passwordHash);
    if (!valid) return reply.status(403).send({ error: 'Mật khẩu hiện tại không đúng' });

    try {
      await setupPin(user.userId ?? user.id, body.pin);
      return reply.send({ ok: true });
    } catch (e: any) {
      return reply.status(400).send({ error: e.message });
    }
  });

  // POST /privacy/unlock — set HttpOnly cookie + return expiresAt
  app.post('/api/v1/privacy/unlock', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const body = (request.body ?? {}) as { pin?: string; durationMinutes?: number };
    if (!body.pin || !body.durationMinutes) {
      return reply.status(400).send({ error: 'Cần pin + durationMinutes' });
    }

    try {
      const result = await unlock({
        userId: user.userId ?? user.id,
        pin: body.pin,
        durationMinutes: body.durationMinutes as SessionDuration,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });

      // FIX codex review #3: HttpOnly cookie thay localStorage cho XSS-safe
      const maxAge = Math.floor((result.expiresAt.getTime() - Date.now()) / 1000);
      reply.header(
        'Set-Cookie',
        `${COOKIE_NAME}=${result.sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${
          process.env.NODE_ENV === 'production' ? '; Secure' : ''
        }`,
      );
      return reply.send({ ok: true, expiresAt: result.expiresAt });
    } catch (e: any) {
      return reply.status(400).send({ error: e.message });
    }
  });

  // POST /privacy/lock — revoke session(s).
  // Anh chốt 2026-05-22: revoke ALL active sessions cho user (không chỉ theo cookie).
  // Đảm bảo lock thật sự lock dù cookie thiếu/lệch hoặc có orphan session từ
  // các browser khác. activeSessionCount=0 ngay sau request → bubble blur kích hoạt.
  app.post('/api/v1/privacy/lock', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    const userId = user?.userId ?? user?.id;
    if (userId) {
      await revokeAllSessions(userId);
    }
    const cookieToken = (request as any).cookies?.[COOKIE_NAME] || extractCookie(request, COOKIE_NAME);
    if (cookieToken) await lock(cookieToken); // belt-and-braces (no-op nếu đã revoke ở trên)
    reply.header('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return reply.send({ ok: true });
  });

  // GET /privacy/status
  app.get('/api/v1/privacy/status', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const status = await getStatus(user.userId ?? user.id);
    return reply.send(status);
  });

  // GET /privacy/my-nicks — trả CHỈ nicks user là chính chủ (owner) trong org.
  // Anh chốt 2026-05-22: Privacy page chỉ thấy nick mình owner — không bao gồm
  // granted access cross-sale (vì privacy phải chính chủ flip).
  app.get('/api/v1/privacy/my-nicks', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const userId = user.userId ?? user.id;

    const nicks = await prisma.zaloAccount.findMany({
      where: { orgId: user.orgId, ownerUserId: userId },
      select: {
        id: true,
        zaloUid: true,
        displayName: true,
        avatarUrl: true,
        phone: true,
        status: true,
        privacyMode: true,
        lastConnectedAt: true,
        ownerUserId: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return reply.send({ nicks });
  });

  // PATCH /zalo-accounts/:id/privacy-mode — flip nick main/sub
  // Chỉ owner của nick mới flip được.
  app.patch('/api/v1/zalo-accounts/:id/privacy-mode', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { mode?: 'main' | 'sub' };
    if (body.mode !== 'main' && body.mode !== 'sub') {
      return reply.status(400).send({ error: 'mode phải là main hoặc sub' });
    }

    const account = await prisma.zaloAccount.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true, ownerUserId: true, privacyMode: true },
    });
    if (!account) return reply.status(404).send({ error: 'Nick không tồn tại' });
    if (account.ownerUserId !== (user.userId ?? user.id)) {
      return reply.status(403).send({ error: 'Chỉ owner của nick mới flip privacy mode' });
    }

    await prisma.zaloAccount.update({
      where: { id },
      data: { privacyMode: body.mode },
    });

    // Broadcast WebSocket event (codex review style — invalidate cache khác client)
    const io = (request.server as any).io;
    io?.emit('privacy:mode-changed', { accountId: id, mode: body.mode });

    return reply.send({ ok: true, mode: body.mode });
  });

  // POST /admin/privacy/reset-pin/:userId — owner reset PIN cho sale (forgot PIN)
  app.post('/api/v1/admin/privacy/reset-pin/:userId', {
    preHandler: [
      authMiddleware,
      async (req: any, rep: any) => {
        const u = req.user;
        if (!u) return rep.status(401).send({ error: 'unauthorized' });
        const allowed = await userHasGrant(u.userId ?? u.id, 'user', 'edit');
        if (!allowed) return rep.status(403).send({ error: 'Cần quyền user.edit để reset PIN' });
      },
    ],
  }, async (request, reply) => {
    const user = (request as any).user;
    const { userId } = request.params as { userId: string };

    // Verify target user ∈ same org
    const target = await prisma.user.findFirst({
      where: { id: userId, orgId: user.orgId },
      select: { id: true },
    });
    if (!target) return reply.status(404).send({ error: 'User không tồn tại' });

    await adminResetPin(userId);
    return reply.send({ ok: true });
  });

  // GET /admin/privacy/audit?userId= — audit log unlock events
  app.get('/api/v1/admin/privacy/audit', {
    preHandler: [
      authMiddleware,
      async (req: any, rep: any) => {
        const u = req.user;
        if (!u) return rep.status(401).send({ error: 'unauthorized' });
        const allowed = await userHasGrant(u.userId ?? u.id, 'audit_log', 'access');
        if (!allowed) return rep.status(403).send({ error: 'Cần quyền audit_log.access' });
      },
    ],
  }, async (request, reply) => {
    const user = (request as any).user;
    const query = request.query as { userId?: string; limit?: string };
    const limit = Math.min(parseInt(query.limit ?? '50', 10) || 50, 200);

    const where: any = { user: { orgId: user.orgId } };
    if (query.userId) where.userId = query.userId;

    const sessions = await prisma.userPrivacySession.findMany({
      where,
      orderBy: { unlockedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        userId: true,
        unlockedAt: true,
        expiresAt: true,
        lastActivityAt: true,
        revokedAt: true,
        ipHash: true,
        userAgent: true,
        user: { select: { fullName: true, email: true } },
      },
    });
    return reply.send({ sessions });
  });
}

function extractCookie(request: FastifyRequest, name: string): string | null {
  const raw = request.headers.cookie;
  if (!raw) return null;
  const cookies = Object.fromEntries(
    raw.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    }),
  );
  return cookies[name] || null;
}
