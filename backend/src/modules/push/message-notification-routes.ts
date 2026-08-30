// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';

type JwtUser = { id: string; orgId: string };

function boundedLimit(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(1, Math.trunc(value)));
}

export async function messageNotificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  app.get<{ Querystring: { limit?: string } }>('/api/v1/message-notifications', async (request) => {
    const user = request.user as JwtUser;
    const limit = boundedLimit(request.query?.limit);
    const where = { userId: user.id, orgId: user.orgId };
    const [notifications, unreadCount] = await Promise.all([
      prisma.messageNotification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: {
          id: true,
          conversationId: true,
          messageId: true,
          zaloAccountId: true,
          title: true,
          context: true,
          preview: true,
          avatarUrl: true,
          readAt: true,
          createdAt: true,
        },
      }),
      prisma.messageNotification.count({ where: { ...where, readAt: null } }),
    ]);
    return { success: true, notifications, unreadCount };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/message-notifications/:id/read', async (request) => {
    const user = request.user as JwtUser;
    const result = await prisma.messageNotification.updateMany({
      where: { id: request.params.id, userId: user.id, orgId: user.orgId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true, updated: result.count };
  });

  app.post<{ Body: { conversationId?: string } }>('/api/v1/message-notifications/read-conversation', async (request, reply) => {
    const user = request.user as JwtUser;
    const conversationId = request.body?.conversationId?.trim();
    if (!conversationId) return reply.status(400).send({ success: false, error: 'Thiếu conversationId' });
    const result = await prisma.messageNotification.updateMany({
      where: { conversationId, userId: user.id, orgId: user.orgId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true, updated: result.count };
  });

  app.post('/api/v1/message-notifications/read-all', async (request) => {
    const user = request.user as JwtUser;
    const result = await prisma.messageNotification.updateMany({
      where: { userId: user.id, orgId: user.orgId, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true, updated: result.count };
  });
}
