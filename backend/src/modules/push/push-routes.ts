// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * push-routes.ts — REST cho Web Push (PWA Mobile). Prefix /api/v1/push.
 *
 * Bảo mật: mọi route đi qua authMiddleware ⇒ CHỈ user đã đăng nhập mới đăng ký/nhận
 * được notification. Subscription luôn gắn userId + orgId lấy TỪ JWT, không nhận từ client.
 * Chỉ trả VAPID *public* key; private key không bao giờ rời server.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { getVapidPublicKey } from './web-push-service.js';

type JwtUser = { id: string; email: string; role: string; orgId: string };
function normalizePushSubscription(body: { endpoint?: string; p256dh?: string; auth?: string }) {
  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : '';
  const p256dh = typeof body.p256dh === 'string' ? body.p256dh.trim() : '';
  const auth = typeof body.auth === 'string' ? body.auth.trim() : '';
  if (!endpoint || !p256dh || !auth) return { ok: false as const, error: 'Thiếu endpoint/p256dh/auth' };
  if (endpoint.length > 2048 || p256dh.length > 512 || auth.length > 512) {
    return { ok: false as const, error: 'Push Subscription vượt giới hạn cho phép' };
  }
  try {
    const url = new URL(endpoint);
    const isLocalHttp = url.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
    if (url.protocol !== 'https:' && !isLocalHttp) {
      return { ok: false as const, error: 'Push endpoint phải dùng HTTPS' };
    }
  } catch {
    return { ok: false as const, error: 'Push endpoint không hợp lệ' };
  }
  return { ok: true as const, endpoint, p256dh, auth };
}

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /vapid-public-key — client cần để subscribe ──
  app.get('/api/v1/push/vapid-public-key', async (_request, reply) => {
    const publicKey = getVapidPublicKey();
    if (!publicKey) {
      return reply.status(503).send({ success: false, error: 'Máy chủ chưa cấu hình VAPID key' });
    }
    return { success: true, publicKey };
  });

  // ── POST /subscriptions — lưu (upsert theo endpoint) ──
  app.post<{ Body: { endpoint?: string; p256dh?: string; auth?: string; userAgent?: string; deviceName?: string } }>(
    '/api/v1/push/subscriptions',
    async (request, reply) => {
      const user = request.user as JwtUser;
      const b = request.body ?? {};
      const normalized = normalizePushSubscription(b);
      if (!normalized.ok) {
        return reply.status(400).send({ success: false, error: normalized.error });
      }
      // Upsert: cùng endpoint đăng ký lại (đổi user, hoặc bật lại sau khi tắt) → cập nhật,
      // đồng thời gỡ cờ revoked để nhận tin trở lại.
      const sub = await prisma.pushSubscription.upsert({
        where: { endpoint: normalized.endpoint },
        create: {
          userId: user.id, orgId: user.orgId,
          endpoint: normalized.endpoint, p256dh: normalized.p256dh, auth: normalized.auth,
          userAgent: b.userAgent ?? null, deviceName: b.deviceName ?? null,
        },
        update: {
          userId: user.id, orgId: user.orgId,
          p256dh: normalized.p256dh, auth: normalized.auth,
          userAgent: b.userAgent ?? null, deviceName: b.deviceName ?? null,
          revokedAt: null, lastSeenAt: new Date(),
        },
        select: { id: true, deviceName: true, createdAt: true },
      });
      return reply.status(201).send({ success: true, subscription: sub });
    },
  );

  // ── DELETE /subscriptions — huỷ trên thiết bị hiện tại ──
  app.delete<{ Body: { endpoint?: string } }>(
    '/api/v1/push/subscriptions',
    async (request, reply) => {
      const user = request.user as JwtUser;
      const endpoint = request.body?.endpoint;
      if (!endpoint) return reply.status(400).send({ success: false, error: 'Thiếu endpoint' });
      // Chỉ cho xoá subscription CỦA CHÍNH MÌNH (chống xoá nhầm/chéo user).
      const { count } = await prisma.pushSubscription.deleteMany({
        where: { endpoint, userId: user.id },
      });
      return { success: true, deleted: count };
    },
  );

  // ── GET /status — thiết bị hiện tại đã bật chưa + danh sách thiết bị ──
  app.get<{ Querystring: { endpoint?: string } }>(
    '/api/v1/push/status',
    async (request) => {
      const user = request.user as JwtUser;
      const endpoint = request.query?.endpoint;
      const [subscribed, devices] = await Promise.all([
        endpoint
          ? prisma.pushSubscription.findFirst({ where: { endpoint, userId: user.id, revokedAt: null }, select: { id: true } })
          : Promise.resolve(null),
        prisma.pushSubscription.findMany({
          where: { userId: user.id, revokedAt: null },
          select: { id: true, deviceName: true, lastSeenAt: true, createdAt: true },
          orderBy: { lastSeenAt: 'desc' },
        }),
      ]);
      return {
        success: true,
        configured: !!getVapidPublicKey(),
        subscribed: !!subscribed,
        devices,
      };
    },
  );
}
