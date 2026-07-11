// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * conversation-content-routes.ts — Conversation Content Library (2026-07-11)
 *
 * Nhóm tính năng "quản lý nội dung trong 1 hội thoại" (cảm hứng Zalo): ghim tin nhắn,
 * xem tin đã ghim, tìm kiếm trong hội thoại, tab Ảnh/Video · File · Link, và "nhảy tới
 * tin gốc" (context window cho tin chưa tải ở FE).
 *
 * NGUYÊN TẮC BẢO MẬT (yêu cầu 9):
 *   • Mọi endpoint gate 2 lớp: requireZaloAccess('read') (grant nick) + canSeeConversation
 *     Content (riêng tư hội thoại / nick main). Không có quyền → 403, KHÔNG trả data để FE
 *     che bằng CSS.
 *   • Mọi message trả về đều đi qua redactMessage (fail-safe lớp 2).
 *   • Scope org: conversation phải thuộc orgId của viewer.
 *
 * READ-ONLY trừ pin/unpin. KHÔNG đụng schema Message, không đổi luồng gửi/nhận realtime.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Server } from 'socket.io';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import {
  buildPrivacyContext,
  canSeeConversationContent,
  redactMessage,
  CONVERSATION_PRIVATE_CODE,
  CONVERSATION_PRIVATE_MESSAGE,
  type PrivacyContext,
  type PrivacyConversation,
} from '../privacy/redact.js';
import {
  clampInt,
  extractFirstUrl,
  buildSearchWhere,
  resolveOrderBy,
} from './conversation-content-helpers.js';

interface AuthUser {
  id: string;
  orgId: string;
  role: string;
}

// Field content-bearing đủ để FE render preview + trích ảnh/file/link (khớp getImageUrl/
// getFileInfo/getVideoUrl phía FE). KHÔNG kèm field nặng không cần cho panel.
const CONTENT_MSG_SELECT = {
  id: true,
  zaloMsgId: true,
  zaloMsgIdNum: true,
  senderType: true,
  senderUid: true,
  senderName: true,
  content: true,
  contentType: true,
  attachments: true,
  quote: true,
  sentAt: true,
  isDeleted: true,
  deletedAt: true,
  editedAt: true,
  albumKey: true,
  albumIndex: true,
  albumTotal: true,
  repliedByUserId: true,
} as const;

type ConvGate = {
  conv: {
    id: string;
    isPrivate: boolean;
    privateOwnerUserId: string | null;
    zaloAccount: { privacyMode: string; ownerUserId: string | null };
  };
  ctx: PrivacyContext;
};

/**
 * Nạp conversation (đúng org) + kiểm 2 lớp quyền nội dung. Trả null (đã gửi 404/403) nếu chặn.
 * Dùng chung cho MỌI endpoint content — 1 nơi quyết định, không lệch luật.
 */
async function gateConversation(
  request: FastifyRequest,
  reply: FastifyReply,
  conversationId: string,
): Promise<ConvGate | null> {
  const user = request.user as unknown as AuthUser;
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId: user.orgId },
    select: {
      id: true,
      isPrivate: true,
      privateOwnerUserId: true,
      zaloAccount: { select: { privacyMode: true, ownerUserId: true } },
    },
  });
  if (!conv) {
    reply.status(404).send({ error: 'Không tìm thấy hội thoại' });
    return null;
  }
  const ctx = await buildPrivacyContext(request);
  if (!canSeeConversationContent(conv as PrivacyConversation, ctx)) {
    reply.status(403).send({
      error: CONVERSATION_PRIVATE_MESSAGE,
      code: CONVERSATION_PRIVATE_CODE,
    });
    return null;
  }
  return { conv, ctx };
}

/** Redact 1 message theo conv + ctx (fail-safe lớp 2). BigInt zaloMsgIdNum → global toJSON lo. */
function redactRow(msg: any, gate: ConvGate): any {
  return redactMessage(msg, gate.conv as PrivacyConversation, gate.ctx);
}

/** Batch resolve tên user (người ghim) — tránh N+1, không cần @relation trong schema. */
async function resolveUserNames(userIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const rows = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, fullName: true, email: true },
  });
  return new Map(rows.map((u) => [u.id, u.fullName || u.email || 'Người dùng']));
}

// ─────────────────────────────────────────────────────────────────────────────
// Realtime — pin/unpin chỉ phát METADATA (messageId + người ghim), KHÔNG content.
// Room: hội thoại riêng tư → chỉ chủ; còn lại → room org (đã chặn cross-tenant).
// ─────────────────────────────────────────────────────────────────────────────
function emitPinEvent(
  io: Server | null | undefined,
  event: 'conversation:pin' | 'conversation:unpin',
  conv: { id: string; orgId: string; isPrivate: boolean; privateOwnerUserId: string | null },
  payload: Record<string, unknown>,
): void {
  if (!io) return;
  try {
    const body = { conversationId: conv.id, ...payload };
    if (conv.isPrivate) {
      if (conv.privateOwnerUserId) io.to(`user:${conv.privateOwnerUserId}`).emit(event, body);
      return;
    }
    io.to(`org:${conv.orgId}`).emit(event, body);
  } catch (err) {
    logger.error('[conv-content] emit pin lỗi:', err);
  }
}

export async function registerConversationContentRoutes(app: FastifyInstance): Promise<void> {
  // LƯU Ý: routes này đăng ký TRỰC TIẾP trên root app (không qua app.register → không
  // encapsulate). PHẢI dùng preHandler THEO TỪNG ROUTE, KHÔNG app.addHook global (sẽ rò
  // auth ra mọi route kể cả /health). Ghép [authMiddleware, requireZaloAccess('read')].
  const io = () => (app as any).io as Server | undefined;
  const guard = [authMiddleware, requireZaloAccess('read')];

  // ═══════════════ 1) GHIM / BỎ GHIM TIN NHẮN ═══════════════
  app.post(
    '/api/v1/conversations/:id/messages/:messageId/pin',
    { preHandler: guard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as unknown as AuthUser;
      const { id, messageId } = request.params as { id: string; messageId: string };
      const gate = await gateConversation(request, reply, id);
      if (!gate) return;

      // Tin phải thuộc đúng hội thoại này (chống ghim chéo hội thoại).
      const msg = await prisma.message.findFirst({
        where: { id: messageId, conversationId: id },
        select: { id: true },
      });
      if (!msg) return reply.status(404).send({ error: 'Không tìm thấy tin nhắn trong hội thoại' });

      // Upsert: re-pin (đã unpin trước đó) = clear unpinned_* + cập nhật người ghim mới.
      const now = new Date();
      const pin = await prisma.messagePin.upsert({
        where: { conversationId_messageId: { conversationId: id, messageId } },
        create: {
          orgId: user.orgId,
          conversationId: id,
          messageId,
          pinnedByUserId: user.id,
          pinnedAt: now,
        },
        update: {
          pinnedByUserId: user.id,
          pinnedAt: now,
          unpinnedByUserId: null,
          unpinnedAt: null,
        },
        select: { id: true, messageId: true, pinnedByUserId: true, pinnedAt: true },
      });

      emitPinEvent(io(), 'conversation:pin', { ...gate.conv, orgId: user.orgId }, {
        messageId,
        pinnedByUserId: user.id,
        pinnedAt: pin.pinnedAt,
      });

      return { ok: true, pin };
    },
  );

  app.delete(
    '/api/v1/conversations/:id/messages/:messageId/pin',
    { preHandler: guard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as unknown as AuthUser;
      const { id, messageId } = request.params as { id: string; messageId: string };
      const gate = await gateConversation(request, reply, id);
      if (!gate) return;

      // Soft-unpin: giữ hàng, set unpinned_* (lưu lịch sử). No-op nếu chưa từng ghim hoặc đã gỡ.
      const res = await prisma.messagePin.updateMany({
        where: { conversationId: id, messageId, unpinnedAt: null },
        data: { unpinnedByUserId: user.id, unpinnedAt: new Date() },
      });

      if (res.count > 0) {
        emitPinEvent(io(), 'conversation:unpin', { ...gate.conv, orgId: user.orgId }, { messageId });
      }
      return { ok: true, changed: res.count > 0 };
    },
  );

  // ═══════════════ 2) DANH SÁCH TIN ĐÃ GHIM ═══════════════
  app.get(
    '/api/v1/conversations/:id/pinned-messages',
    { preHandler: guard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const gate = await gateConversation(request, reply, id);
      if (!gate) return;

      const pins = await prisma.messagePin.findMany({
        where: { conversationId: id, unpinnedAt: null },
        orderBy: { pinnedAt: 'desc' },
        select: {
          id: true,
          messageId: true,
          pinnedByUserId: true,
          pinnedAt: true,
          message: { select: CONTENT_MSG_SELECT },
        },
      });

      const nameMap = await resolveUserNames(pins.map((p) => p.pinnedByUserId));
      const items = pins.map((p) => ({
        pinId: p.id,
        pinnedByUserId: p.pinnedByUserId,
        pinnedByName: nameMap.get(p.pinnedByUserId) ?? 'Người dùng',
        pinnedAt: p.pinnedAt,
        // Tin đã xóa cứng → message null (FK cascade đã dọn pin, nên hiếm); tin thu hồi mềm
        // vẫn còn (isDeleted=true) → FE hiện trạng thái "đã thu hồi".
        message: p.message ? redactRow(p.message, gate) : null,
        missing: !p.message,
      }));
      return { items, total: items.length };
    },
  );

  // ═══════════════ 3) TÌM KIẾM TRONG HỘI THOẠI ═══════════════
  // q (text, case-insensitive ILIKE — VN có dấu khớp chính xác), type (all|text|media|file|
  // link|pinned), senderType (self|contact|all), from/to (ISO), page/limit.
  app.get(
    '/api/v1/conversations/:id/search',
    { preHandler: guard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const gate = await gateConversation(request, reply, id);
      if (!gate) return;

      const q = request.query as Record<string, string>;
      const page = clampInt(q.page, 1, 1, 100000);
      const limit = clampInt(q.limit, 30, 1, 100);

      const where = buildSearchWhere({
        conversationId: id,
        term: q.q,
        type: q.type,
        senderType: q.senderType,
        from: q.from,
        to: q.to,
      });

      const [rows, total] = await Promise.all([
        prisma.message.findMany({
          where,
          orderBy: [{ zaloMsgIdNum: { sort: 'desc', nulls: 'last' } }, { sentAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
          select: CONTENT_MSG_SELECT,
        }),
        prisma.message.count({ where }),
      ]);

      return {
        items: rows.map((m) => redactRow(m, gate)),
        total,
        page,
        limit,
        hasMore: page * limit < total,
      };
    },
  );

  // ═══════════════ 4) ẢNH & VIDEO ═══════════════
  app.get(
    '/api/v1/conversations/:id/media',
    { preHandler: guard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const gate = await gateConversation(request, reply, id);
      if (!gate) return;
      const q = request.query as Record<string, string>;
      const page = clampInt(q.page, 1, 1, 100000);
      const limit = clampInt(q.limit, 40, 1, 100);

      const where: Prisma.MessageWhereInput = {
        conversationId: id,
        contentType: { in: ['image', 'video'] },
        isDeleted: false,
      };
      const [rows, total] = await Promise.all([
        prisma.message.findMany({
          where,
          orderBy: [{ zaloMsgIdNum: { sort: 'desc', nulls: 'last' } }, { sentAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
          select: CONTENT_MSG_SELECT,
        }),
        prisma.message.count({ where }),
      ]);
      return {
        items: rows.map((m) => redactRow(m, gate)),
        total,
        page,
        limit,
        hasMore: page * limit < total,
      };
    },
  );

  // ═══════════════ 5) FILE ═══════════════
  app.get(
    '/api/v1/conversations/:id/files',
    { preHandler: guard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const gate = await gateConversation(request, reply, id);
      if (!gate) return;
      const q = request.query as Record<string, string>;
      const page = clampInt(q.page, 1, 1, 100000);
      const limit = clampInt(q.limit, 40, 1, 100);
      const term = (q.q ?? '').trim();
      const sort = (q.sort ?? 'newest').toLowerCase();

      const where: Prisma.MessageWhereInput = {
        conversationId: id,
        contentType: 'file',
        isDeleted: false,
      };
      if (term) where.content = { contains: term, mode: 'insensitive' };

      const orderBy = resolveOrderBy(sort);

      const [rows, total] = await Promise.all([
        prisma.message.findMany({
          where,
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
          select: CONTENT_MSG_SELECT,
        }),
        prisma.message.count({ where }),
      ]);
      return {
        items: rows.map((m) => redactRow(m, gate)),
        total,
        page,
        limit,
        hasMore: page * limit < total,
      };
    },
  );

  // ═══════════════ 6) LINK ═══════════════
  app.get(
    '/api/v1/conversations/:id/links',
    { preHandler: guard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const gate = await gateConversation(request, reply, id);
      if (!gate) return;
      const q = request.query as Record<string, string>;
      const page = clampInt(q.page, 1, 1, 100000);
      const limit = clampInt(q.limit, 40, 1, 100);

      const where: Prisma.MessageWhereInput = {
        conversationId: id,
        isDeleted: false,
        OR: [{ contentType: 'link' }, { content: { contains: 'http', mode: 'insensitive' } }],
      };
      // Lấy dư 1 trang để bù các dòng "http" trong text nhưng KHÔNG có URL thật (loại sau extract).
      const rows = await prisma.message.findMany({
        where,
        orderBy: [{ zaloMsgIdNum: { sort: 'desc', nulls: 'last' } }, { sentAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit + 1,
        select: CONTENT_MSG_SELECT,
      });
      const total = await prisma.message.count({ where });

      const items = rows
        .map((m) => {
          const red = redactRow(m, gate);
          if ((red as any).redacted) return { message: red, url: null as string | null };
          return { message: red, url: extractFirstUrl(m.content) };
        })
        .filter((x) => x.url || (x.message as any).redacted)
        .slice(0, limit)
        .map((x) => x.message);

      return { items, total, page, limit, hasMore: page * limit < total };
    },
  );

  // ═══════════════ 7) CONTEXT — nhảy tới tin gốc (kể cả chưa tải ở FE) ═══════════════
  // Trả cửa sổ before + target + after (thứ tự tăng dần) quanh 1 messageId để FE merge vào
  // thread rồi cuộn + highlight. KHÔNG tải toàn bộ lịch sử.
  app.get(
    '/api/v1/conversations/:id/messages/:messageId/context',
    { preHandler: guard },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id, messageId } = request.params as { id: string; messageId: string };
      const gate = await gateConversation(request, reply, id);
      if (!gate) return;
      const q = request.query as Record<string, string>;
      const before = clampInt(q.before, 20, 0, 50);
      const after = clampInt(q.after, 20, 0, 50);

      const target = await prisma.message.findFirst({
        where: { id: messageId, conversationId: id },
        select: { id: true, sentAt: true },
      });
      if (!target) {
        return reply.status(404).send({ error: 'Tin nhắn không còn tồn tại', code: 'MESSAGE_NOT_FOUND' });
      }

      // Cửa sổ theo sentAt (ổn định, không phụ thuộc zaloMsgIdNum có thể null cho tin CRM in-flight).
      const [olderDesc, newerAsc] = await Promise.all([
        prisma.message.findMany({
          where: { conversationId: id, sentAt: { lt: target.sentAt } },
          orderBy: { sentAt: 'desc' },
          take: before,
          select: CONTENT_MSG_SELECT,
        }),
        prisma.message.findMany({
          where: { conversationId: id, sentAt: { gte: target.sentAt } },
          orderBy: { sentAt: 'asc' },
          take: after + 1, // +1 để bao gồm chính target
          select: CONTENT_MSG_SELECT,
        }),
      ]);

      const ordered = [...olderDesc.reverse(), ...newerAsc];
      // Dedupe theo id (target nằm trong newerAsc; phòng trùng biên).
      const seen = new Set<string>();
      const items = ordered
        .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
        .map((m) => redactRow(m, gate));

      return { targetId: messageId, items };
    },
  );
}
