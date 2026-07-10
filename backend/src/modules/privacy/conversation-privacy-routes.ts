// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * conversation-privacy-routes.ts — Riêng tư cấp HỘI THOẠI (2026-07-09)
 *
 * "Chỉ mình tôi xem cuộc hội thoại này" — đơn giản hoá so với riêng tư cấp NICK:
 *   • KHÔNG cần OTP mỗi lần xem (khác `privacyMode='main'` + phiên OTP).
 *   • Người bật là NGƯỜI DUY NHẤT xem được nội dung — kể cả owner/admin của tổ chức.
 *   • Chỉ người bật mới tắt được (yêu cầu 6).
 *   • Chủ bị khóa/xóa → Admin GỠ được cờ, nhưng KHÔNG xem được nội dung trong lúc còn
 *     khóa (yêu cầu 10). Gỡ xong hội thoại trở lại bình thường.
 *
 * Việc chặn đọc nằm ở `redact.ts::canSeeConversationContent` (cổng trung tâm) chứ KHÔNG
 * ở tầng phân quyền `requireZaloAccess` — vì tầng đó có bypass cho owner/admin.
 *
 * Endpoints:
 *   GET    /api/v1/conversations/:id/privacy          → trạng thái + quyền của viewer
 *   POST   /api/v1/conversations/:id/privacy          → bật "Chỉ mình tôi xem"
 *   DELETE /api/v1/conversations/:id/privacy          → tắt (chỉ chủ)
 *   POST   /api/v1/conversations/:id/privacy/force-release → Admin gỡ khi chủ bị khóa/xóa
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logActivity } from '../activity/activity-logger.js';
import { logger } from '../../shared/utils/logger.js';
import { getZaloScope } from '../zalo/zalo-scope.js';

interface AuthUser {
  id: string;
  orgId: string;
  role: string;
}

const CONV_SELECT = {
  id: true,
  orgId: true,
  zaloAccountId: true,
  isPrivate: true,
  privateOwnerUserId: true,
  privateEnabledAt: true,
  privateDisabledAt: true,
  privateOwner: { select: { id: true, fullName: true, isActive: true } },
} as const;

type ConvRow = {
  id: string;
  orgId: string;
  zaloAccountId: string;
  isPrivate: boolean;
  privateOwnerUserId: string | null;
  privateEnabledAt: Date | null;
  privateDisabledAt: Date | null;
  privateOwner: { id: string; fullName: string; isActive: boolean } | null;
};

/**
 * Chủ sở hữu "vắng mặt" → Admin được phép gỡ cờ (yêu cầu 10).
 * Ba trường hợp: user đã bị XÓA (FK SetNull → null), bị KHÓA (isActive=false),
 * hoặc row user không còn đọc được.
 */
function ownerIsUnavailable(conv: ConvRow): boolean {
  if (!conv.privateOwnerUserId) return true;
  if (!conv.privateOwner) return true;
  return conv.privateOwner.isActive === false;
}

async function loadConversation(
  user: AuthUser,
  conversationId: string,
): Promise<ConvRow | null> {
  return prisma.conversation.findFirst({
    where: { id: conversationId, orgId: user.orgId },
    select: CONV_SELECT,
  }) as Promise<ConvRow | null>;
}

/** Payload trạng thái — KHÔNG chứa nội dung tin nhắn, an toàn trả cho mọi người trong org. */
function statusPayload(conv: ConvRow, viewerUserId: string, isOrgAdmin: boolean) {
  const isOwner = conv.isPrivate && conv.privateOwnerUserId === viewerUserId;
  return {
    conversationId: conv.id,
    isPrivate: conv.isPrivate,
    // Danh tính người bật KHÔNG phải nội dung trao đổi → hiện để đồng nghiệp biết hỏi ai.
    privateOwnerUserId: conv.privateOwnerUserId,
    privateOwnerName: conv.privateOwner?.fullName ?? null,
    privateEnabledAt: conv.privateEnabledAt,
    privateDisabledAt: conv.privateDisabledAt,
    canView: !conv.isPrivate || isOwner,
    canDisable: isOwner,
    // Admin chỉ gỡ được khi chủ vắng mặt — và gỡ KHÔNG cho xem nội dung ngay lúc đó.
    canForceRelease: conv.isPrivate && isOrgAdmin && ownerIsUnavailable(conv),
  };
}

export async function registerConversationPrivacyRoutes(app: FastifyInstance): Promise<void> {
  // preHandler gắn TỪNG route (không addHook toàn cục — `app` ở đây là instance gốc).
  // ── Trạng thái riêng tư của 1 hội thoại ────────────────────────────────
  app.get('/api/v1/conversations/:id/privacy', { preHandler: authMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as unknown as AuthUser;
    const { id } = request.params as { id: string };

    const conv = await loadConversation(user, id);
    if (!conv) return reply.status(404).send({ error: 'Không tìm thấy hội thoại' });

    const isOrgAdmin = user.role === 'owner' || user.role === 'admin';
    return statusPayload(conv, user.id, isOrgAdmin);
  });

  // ── Bật "Chỉ mình tôi xem" ─────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/privacy', { preHandler: authMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as unknown as AuthUser;
    const { id } = request.params as { id: string };

    const conv = await loadConversation(user, id);
    if (!conv) return reply.status(404).send({ error: 'Không tìm thấy hội thoại' });

    if (conv.isPrivate) {
      if (conv.privateOwnerUserId === user.id) {
        return statusPayload(conv, user.id, false); // idempotent — bật lại chính mình
      }
      return reply.status(403).send({
        error: 'Cuộc hội thoại này đã được người khác đặt ở chế độ riêng tư.',
        code: 'CONVERSATION_PRIVATE',
      });
    }

    // Chỉ người ĐANG được xem hội thoại mới được khoá nó lại cho riêng mình.
    // Cố ý KHÔNG dùng requireZaloAccess: hàm đó bypass cho owner/admin, sẽ cho phép
    // một admin khoá hội thoại của nick mà họ không hề chăm.
    const scope = await getZaloScope(user.id, user.orgId, user.role);
    if (!scope.displayableIds.includes(conv.zaloAccountId)) {
      return reply.status(403).send({ error: 'Bạn không có quyền với hội thoại này', code: 'not_in_scope' });
    }

    const now = new Date();
    const updated = (await prisma.conversation.update({
      where: { id },
      data: {
        isPrivate: true,
        privateOwnerUserId: user.id,
        privateEnabledAt: now,
        privateDisabledAt: null,
      },
      select: CONV_SELECT,
    })) as ConvRow;

    logActivity({
      orgId: user.orgId,
      userId: user.id,
      action: 'conversation_privacy_enable',
      entityType: 'conversation',
      entityId: id,
      details: { zaloAccountId: conv.zaloAccountId, enabledAt: now.toISOString() },
    });
    logger.info(`[conv-privacy] BẬT conv=${id} bởi user=${user.id}`);

    return statusPayload(updated, user.id, false);
  });

  // ── Tắt riêng tư — CHỈ người đã bật (yêu cầu 6) ────────────────────────
  app.delete('/api/v1/conversations/:id/privacy', { preHandler: authMiddleware }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as unknown as AuthUser;
    const { id } = request.params as { id: string };

    const conv = await loadConversation(user, id);
    if (!conv) return reply.status(404).send({ error: 'Không tìm thấy hội thoại' });
    if (!conv.isPrivate) return statusPayload(conv, user.id, false); // idempotent

    if (conv.privateOwnerUserId !== user.id) {
      return reply.status(403).send({
        error: 'Chỉ người đã bật chế độ riêng tư mới tắt được.',
        code: 'NOT_PRIVACY_OWNER',
      });
    }

    const now = new Date();
    const updated = (await prisma.conversation.update({
      where: { id },
      data: { isPrivate: false, privateOwnerUserId: null, privateDisabledAt: now },
      select: CONV_SELECT,
    })) as ConvRow;

    logActivity({
      orgId: user.orgId,
      userId: user.id,
      action: 'conversation_privacy_disable',
      entityType: 'conversation',
      entityId: id,
      details: { zaloAccountId: conv.zaloAccountId, disabledAt: now.toISOString() },
    });
    logger.info(`[conv-privacy] TẮT conv=${id} bởi user=${user.id}`);

    return statusPayload(updated, user.id, false);
  });

  // ── Admin gỡ cờ khi chủ bị khóa/xóa/nghỉ việc (yêu cầu 10) ─────────────
  // KHÔNG cho admin xem nội dung. Chỉ gỡ cờ → hội thoại trở lại bình thường, và những
  // người có quyền quản lý nick đó (gồm admin) xem lại được từ thời điểm gỡ.
  app.post(
    '/api/v1/conversations/:id/privacy/force-release',
    { preHandler: authMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as unknown as AuthUser;
      const { id } = request.params as { id: string };

      if (user.role !== 'owner' && user.role !== 'admin') {
        return reply.status(403).send({ error: 'Chỉ quản trị viên mới gỡ được', code: 'forbidden' });
      }

      const conv = await loadConversation(user, id);
      if (!conv) return reply.status(404).send({ error: 'Không tìm thấy hội thoại' });
      if (!conv.isPrivate) return statusPayload(conv, user.id, true);

      // Chốt chặn: chủ VẪN đang hoạt động → admin không được đụng vào. Nếu không, admin
      // có thể gỡ bất cứ hội thoại riêng tư nào rồi đọc — vô hiệu hoá toàn bộ tính năng.
      if (!ownerIsUnavailable(conv)) {
        return reply.status(403).send({
          error: 'Chủ hội thoại vẫn đang hoạt động — chỉ người đó tắt được chế độ riêng tư.',
          code: 'PRIVACY_OWNER_ACTIVE',
        });
      }

      const now = new Date();
      const previousOwnerId = conv.privateOwnerUserId;
      const updated = (await prisma.conversation.update({
        where: { id },
        data: { isPrivate: false, privateOwnerUserId: null, privateDisabledAt: now },
        select: CONV_SELECT,
      })) as ConvRow;

      logActivity({
        orgId: user.orgId,
        userId: user.id,
        action: 'conversation_privacy_force_release',
        entityType: 'conversation',
        entityId: id,
        details: {
          zaloAccountId: conv.zaloAccountId,
          previousOwnerUserId: previousOwnerId,
          previousOwnerName: conv.privateOwner?.fullName ?? null,
          reason: conv.privateOwner ? 'owner_locked' : 'owner_deleted',
          releasedAt: now.toISOString(),
        },
      });
      logger.warn(
        `[conv-privacy] ADMIN GỠ conv=${id} bởi admin=${user.id}, chủ cũ=${previousOwnerId ?? 'đã xóa'}`,
      );

      return statusPayload(updated, user.id, true);
    },
  );
}
