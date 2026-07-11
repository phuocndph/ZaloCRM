// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * conversation-state-routes.ts — API trạng thái hội thoại per-USER (2026-07-10).
 *
 * Ghim cá nhân, đánh dấu chưa đọc thủ công, và (mở rộng) snooze/reminder/star/follow-up/
 * VIP/priority/internal. API generic: 1 endpoint PATCH nhận mọi field trạng thái → thêm
 * state tương lai KHÔNG cần thêm route.
 *
 *   GET   /api/v1/conversations/:id/state    → trạng thái của viewer với hội thoại này
 *   PATCH /api/v1/conversations/:id/state    → cập nhật { isPinned?, isManualUnread?, flags? }
 *
 * Realtime chỉ bắn vào room user:${userId} (xem service). Không đụng unreadCount thật,
 * không đồng bộ Zalo.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import {
  getState,
  patchState,
  emitStateChange,
  type StatePatch,
} from './conversation-state-service.js';

interface AuthUser {
  id: string;
  orgId: string;
  role: string;
}

/**
 * Hội thoại phải thuộc org của viewer, và nếu đang "Chỉ mình tôi xem" thì chỉ chủ được
 * đụng — người khác 403 (không cho ghim/đánh dấu hội thoại mình không được xem).
 * Trả về null + đã gửi reply nếu chặn.
 */
async function assertVisible(
  user: AuthUser,
  conversationId: string,
  reply: FastifyReply,
): Promise<boolean> {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId: user.orgId },
    select: { id: true, isPrivate: true, privateOwnerUserId: true },
  });
  if (!conv) {
    reply.status(404).send({ error: 'Không tìm thấy hội thoại' });
    return false;
  }
  if (conv.isPrivate && conv.privateOwnerUserId !== user.id) {
    reply.status(403).send({
      error: 'Cuộc hội thoại này đang ở chế độ riêng tư.',
      code: 'CONVERSATION_PRIVATE',
    });
    return false;
  }
  return true;
}

/** Lọc body PATCH → chỉ giữ field hợp lệ (bỏ field lạ, ép kiểu boolean). */
function sanitizePatch(body: unknown): StatePatch {
  const b = (body ?? {}) as Record<string, unknown>;
  const patch: StatePatch = {};
  if (typeof b.isPinned === 'boolean') patch.isPinned = b.isPinned;
  if (typeof b.isManualUnread === 'boolean') patch.isManualUnread = b.isManualUnread;
  if (b.flags && typeof b.flags === 'object' && !Array.isArray(b.flags)) {
    patch.flags = b.flags as Record<string, unknown>;
  }
  return patch;
}

export async function registerConversationStateRoutes(app: FastifyInstance): Promise<void> {
  // ── Đọc trạng thái ────────────────────────────────────────────────────────
  app.get(
    '/api/v1/conversations/:id/state',
    { preHandler: authMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as unknown as AuthUser;
      const { id } = request.params as { id: string };
      if (!(await assertVisible(user, id, reply))) return;
      return getState(user.id, id);
    },
  );

  // ── Cập nhật trạng thái (generic) ─────────────────────────────────────────
  app.patch(
    '/api/v1/conversations/:id/state',
    { preHandler: authMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as unknown as AuthUser;
      const { id } = request.params as { id: string };
      if (!(await assertVisible(user, id, reply))) return;

      const patch = sanitizePatch(request.body);
      if (patch.isPinned === undefined && patch.isManualUnread === undefined && patch.flags === undefined) {
        return reply.status(400).send({ error: 'Không có field trạng thái hợp lệ để cập nhật' });
      }

      const dto = await patchState(user.orgId, user.id, id, patch);
      // Đồng bộ tab/thiết bị khác của CHÍNH user này (không ảnh hưởng ai khác trong org).
      emitStateChange((app as any).io as Server, user.id, dto);
      return dto;
    },
  );
}
