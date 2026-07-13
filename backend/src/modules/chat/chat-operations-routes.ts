// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * chat-operations-routes.ts — Extended chat operations: reactions, typing, delete/undo/edit,
 * forward, pin/unpin, sticker, link, card. All ported from openzca CLI capabilities.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireZaloAccess } from '../zalo/zalo-access-middleware.js';
import { zaloOps, ZaloOpError } from '../../shared/zalo-operations.js';
import { zaloPool } from '../zalo/zalo-pool.js';
import { eventBuffer } from '../../shared/event-buffer.js';
import { logger } from '../../shared/utils/logger.js';
import { sendNativeVideo } from '../../shared/video-processor.js';
import { applyContactAggregateFromMessage, applyContactInteraction, applyFriendAggregate } from '../contacts/contact-aggregate.js';
import { markExpected as markReactionEchoExpected } from './reaction-echo-cache.js';
import { getUserFullName } from './chat-helpers.js';
import { downloadMediaToTemp, extractZaloMsgId } from './chat-media-helpers.js';
import { getSocketAuth } from '../../shared/realtime/socket-auth.js';
import { setViewing, clearViewing } from '../push/presence.js';

interface ResolvedMessageRefs {
  messageId: string;
  zaloMsgId: string;
  cliMsgId: string | null;       // null nếu tin cũ trước migration 2026-05-21 — undo sẽ trả 400
  ownerId: string;
  senderType: string;            // 'self' = sale của org gửi (qua phone HOẶC qua CRM)
  repliedByUserId: string | null;
  content: string | null;
  contentType: string;
  sentAt: Date;
  albumKey: string | null;       // ảnh gửi theo cụm (Zalo group_layout_id) — forward phải gửi cả cụm
}

async function resolveMessageRefs(conversationId: string, messageId: string, userOrgId: string): Promise<ResolvedMessageRefs | null> {
  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      conversationId,
      conversation: { orgId: userOrgId },
    },
    select: {
      id: true, zaloMsgId: true, zaloCliMsgId: true, senderUid: true, senderType: true,
      repliedByUserId: true, content: true, contentType: true, sentAt: true, albumKey: true,
    },
  });

  if (!message?.zaloMsgId) return null;
  return {
    messageId: message.id,
    zaloMsgId: message.zaloMsgId,
    cliMsgId: message.zaloCliMsgId,   // real cliMsgId từ DB — null cho tin cũ
    ownerId: message.senderUid || '',
    senderType: message.senderType,
    repliedByUserId: message.repliedByUserId || null,
    content: message.content,
    contentType: message.contentType,
    sentAt: message.sentAt,
    albumKey: message.albumKey,
  };
}

// Frontend reaction key → Zalo zca-js Reactions enum string code.
// Reactions enum (zca-js): HEART="/-heart", LIKE="/-strong", HAHA=":>",
// WOW=":o", CRY=":-((", ANGRY=":-h", ...
const REACTION_MAP: Record<string, string> = {
  heart: '/-heart',
  like: '/-strong',
  haha: ':>',
  wow: ':o',
  sad: ':-((',
  angry: ':-h',
};
// Reverse map cho Socket.io broadcast (display emoji) + DB lưu emoji thân thiện
const REACTION_DISPLAY: Record<string, string> = {
  heart: '❤️',
  like: '👍',
  haha: '😆',
  wow: '😮',
  sad: '😭',
  angry: '😡',
};

function mapReaction(r: string): string {
  return REACTION_MAP[r.toLowerCase()] ?? r;
}
function reactionDisplay(r: string): string {
  return REACTION_DISPLAY[r.toLowerCase()] ?? r;
}

/**
 * Shared conversation lookup — returns 404 reply when missing.
 *
 * Đồng thời là CHỐT CHẶN riêng tư cấp hội thoại cho MỌI thao tác chat (thả cảm xúc, sửa,
 * thu hồi, ghim, sticker, và nhất là CHUYỂN TIẾP). Bắt buộc phải ở đây vì preHandler
 * `requireZaloAccess('chat')` có bypass cho owner/admin. Không có chốt này, người khác
 * chuyển tiếp được tin của hội thoại riêng tư sang hội thoại thường rồi đọc thoải mái.
 */
async function getConversation(id: string, orgId: string, reply: FastifyReply, viewerUserId?: string) {
  const conv = await prisma.conversation.findFirst({ where: { id, orgId } });
  if (!conv) { reply.status(404).send({ error: 'Conversation not found' }); return null; }
  if (conv.isPrivate && conv.privateOwnerUserId !== viewerUserId) {
    reply.status(403).send({
      error: 'Cuộc hội thoại này đang ở chế độ riêng tư.',
      code: 'CONVERSATION_PRIVATE',
    });
    return null;
  }
  return conv;
}

const FORWARD_MEDIA_TYPES = new Set(['image', 'video', 'voice', 'audio', 'gif', 'file']);
const MEDIA_URL_FIELDS: Record<string, string[]> = {
  image: ['hdUrl', 'href', 'normalUrl', 'url', 'thumbUrl', 'thumb', 'thumbnail'],
  video: ['href', 'fileUrl', 'url', 'normalUrl', 'hdUrl'],
  voice: ['href', 'url', 'fileUrl'],
  audio: ['href', 'url', 'fileUrl'],
  gif: ['href', 'hdUrl', 'url', 'normalUrl'],
  file: ['href', 'url', 'fileUrl'],
};

// Media URL hợp lệ để tải: http(s) TUYỆT ĐỐI hoặc TƯƠNG ĐỐI `/files/...` (driver lưu trữ local
// persist đường dẫn tương đối). Trước đây chỉ nhận http(s) → mọi ảnh lưu bằng driver local đều
// rơi vào lỗi "Tin gốc không có URL media để chuyển tiếp". candidateDownloadUrls() đã biết cách
// gắn origin nội bộ cho đường dẫn tương đối, nên chỉ cần đừng loại nó ở đây.
function isDownloadableUrl(value: unknown): value is string {
  return typeof value === 'string' && (/^https?:\/\//i.test(value.trim()) || value.trim().startsWith('/'));
}

function safeJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value?.trim().startsWith('{')) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function pickForwardMedia(content: string | null, contentType: string): { url: string; filename?: string; mimeType?: string } | null {
  if (!content) return null;
  if (isDownloadableUrl(content.trim())) return { url: content.trim() };

  const parsed = safeJsonObject(content);
  if (!parsed) return null;

  const fields = MEDIA_URL_FIELDS[contentType] ?? ['href', 'url', 'fileUrl'];
  for (const field of fields) {
    const value = parsed[field];
    if (isDownloadableUrl(value)) {
      return {
        url: value.trim(),
        filename: pickString(parsed, ['fileName', 'filename', 'name']),
        mimeType: pickString(parsed, ['mime', 'mimeType', 'contentType']),
      };
    }
  }

  const params = typeof parsed.params === 'string' ? safeJsonObject(parsed.params) : null;
  if (params) {
    for (const field of ['rawUrl', 'hd', 'url'] as const) {
      const value = params[field];
      if (isDownloadableUrl(value)) {
        return {
          url: value.trim(),
          filename: pickString(parsed, ['fileName', 'filename', 'name']),
          mimeType: pickString(parsed, ['mime', 'mimeType', 'contentType']),
        };
      }
    }
  }

  return null;
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function handleError(err: unknown, reply: FastifyReply) {
  if (err instanceof ZaloOpError) return reply.status(err.statusCode).send({ error: err.message });
  logger.error('[chat-ops] Unexpected error:', err);
  return reply.status(500).send({ error: 'Internal server error' });
}

export async function chatOperationsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  const chatAccess = { preHandler: requireZaloAccess('chat') };

  // ── POST /reactions ──────────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/reactions', chatAccess, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { msgId, reaction } = request.body as { msgId: string; reaction: string };

    if (!msgId || !reaction) return reply.status(400).send({ error: 'msgId and reaction required' });

    const conv = await getConversation(id, user.orgId, reply, user.id);
    if (!conv) return;

    const refs = await resolveMessageRefs(id, msgId, user.orgId);
    if (!refs) return reply.status(404).send({ error: 'Message not found' });

    try {
      const threadType = conv.threadType === 'group' ? 1 : 0;
      const displayEmoji = reactionDisplay(reaction);

      // FIX 2026-05-22 (regress bug "thả 1 tim hiện 2"): mark cache TRƯỚC khi
      // call SDK.addReaction. Nếu mark SAU await, echo từ Zalo có thể arrive
      // qua socket TRƯỚC khi cache được set → consumeIfExpected miss →
      // listener tạo DB row 'zalo' DUPLICATE row 'crm' đã upsert phía dưới →
      // FE count = 2.
      // Lookup ownNick UID → key (zaloMsgId, emoji, ownUid) → cache 5s.
      const ownNick = await prisma.zaloAccount.findUnique({
        where: { id: conv.zaloAccountId },
        select: { zaloUid: true, displayName: true, avatarUrl: true },
      });
      if (ownNick?.zaloUid) {
        markReactionEchoExpected(refs.zaloMsgId, displayEmoji, ownNick.zaloUid);
      }

      // zca-js addReaction signature: (icon, dest) where dest = {data: {msgId, cliMsgId}, threadId, type}
      const result = await zaloOps.addReaction(
        conv.zaloAccountId,
        mapReaction(reaction),
        {
          data: { msgId: refs.zaloMsgId, cliMsgId: refs.cliMsgId ?? refs.zaloMsgId },
          threadId: conv.externalThreadId || '',
          type: threadType,
        },
      );
      // Phase A reaction fix (2026-05-21): bỏ eventBuffer.recordReaction để tránh
      // double-emit. Giữ duy nhất direct emit phía dưới.
      // Multi-emoji: upsert keyed theo (messageId, reactorId, emoji) — cùng user có thể có nhiều emoji
      await prisma.messageReaction.upsert({
        where: {
          messageId_reactorId_emoji: {
            messageId: refs.messageId,
            reactorId: user.id,
            emoji: displayEmoji,
          },
        },
        update: {}, // đã tồn tại — không cần update gì
        create: {
          id: randomUUID(),
          messageId: refs.messageId,
          reactorId: user.id,
          reactorSource: 'crm',
          reactorName: user.email,
          emoji: displayEmoji,
        },
      });
      // ANTI-DRIFT FIX 2026-05-22: emit totalCount real từ DB → FE set không increment.
      const newCount = await prisma.messageReaction.count({
        where: { messageId: refs.messageId, emoji: displayEmoji },
      });
      const io = (app as any).io as Server;
      // 2026-06-20 (anh chốt): sale thả qua CRM → realtime hiện DANH TÍNH NICK ZALO (tên+avatar nick),
      // KHÔNG phải email tài khoản sale CRM.
      io?.emit('chat:reactions', {
        conversationId: id,
        messageId: refs.messageId,
        msgId: refs.messageId,
        reactions: [{ userId: user.id, userName: ownNick?.displayName || user.email, avatar: ownNick?.avatarUrl || null, reaction: displayEmoji, action: 'add', totalCount: newCount }],
      });
      void applyContactInteraction({
        conversationId: id,
        type: `reaction_${reaction}`,
        occurredAt: new Date(),
        payload: { messageId: refs.messageId, reactorUserId: user.id },
      });
      return { success: true, result };
    } catch (err) { return handleError(err, reply); }
  });

  // ── DELETE /reactions ────────────────────────────────────────────────────────
  // Toggle off: user gỡ 1 emoji cụ thể khỏi tin (chỉ xoá row local — không gọi Zalo)
  app.delete('/api/v1/conversations/:id/reactions', chatAccess, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { msgId, reaction } = request.body as { msgId: string; reaction: string };
    if (!msgId || !reaction) return reply.status(400).send({ error: 'msgId and reaction required' });

    const conv = await getConversation(id, user.orgId, reply, user.id);
    if (!conv) return;
    const refs = await resolveMessageRefs(id, msgId, user.orgId);
    if (!refs) return reply.status(404).send({ error: 'Message not found' });

    const displayEmoji = reactionDisplay(reaction);
    await prisma.messageReaction.deleteMany({
      where: { messageId: refs.messageId, reactorId: user.id, emoji: displayEmoji },
    });
    // ANTI-DRIFT FIX 2026-05-22: emit totalCount post-delete.
    const newCount = await prisma.messageReaction.count({
      where: { messageId: refs.messageId, emoji: displayEmoji },
    });
    const io = (app as any).io as Server;
    io?.emit('chat:reactions', {
      conversationId: id,
      messageId: refs.messageId,
      msgId: refs.messageId,
      reactions: [{ userId: user.id, userName: user.email, reaction: displayEmoji, action: 'remove', totalCount: newCount }],
    });
    return { success: true };
  });

  // ── POST /typing ─────────────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/typing', chatAccess, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conv = await getConversation(id, user.orgId, reply, user.id);
    if (!conv) return;

    try {
      const threadType = conv.threadType === 'group' ? 1 : 0;
      await zaloOps.sendTypingEvent(conv.zaloAccountId, conv.externalThreadId || '', threadType);
      eventBuffer.recordTyping(id, user.id, user.email);
      return { success: true };
    } catch (err) { return handleError(err, reply); }
  });

  // ── DELETE /messages/:msgId ──────────────────────────────────────────────────
  app.delete('/api/v1/conversations/:id/messages/:msgId', chatAccess, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id, msgId } = request.params as { id: string; msgId: string };
    const { onlyMe = false } = (request.body ?? {}) as { onlyMe?: boolean };

    const conv = await getConversation(id, user.orgId, reply, user.id);
    if (!conv) return;

    const refs = await resolveMessageRefs(id, msgId, user.orgId);
    if (!refs) return reply.status(404).send({ error: 'Message not found' });

    try {
      const threadType = conv.threadType === 'group' ? 1 : 0;
      await zaloOps.deleteMessage(conv.zaloAccountId, refs.zaloMsgId, refs.cliMsgId ?? refs.zaloMsgId, refs.ownerId, conv.externalThreadId || '', threadType, onlyMe);

      if (!onlyMe) {
        await prisma.message.update({ where: { id: refs.messageId }, data: { isDeleted: true, deletedAt: new Date() } });
      }

      const io = (app as any).io as Server;
      io?.emit('chat:deleted', { conversationId: id, messageId: refs.messageId, zaloMsgId: refs.zaloMsgId });
      return { success: true };
    } catch (err) { return handleError(err, reply); }
  });

  // ── POST /messages/:msgId/undo ───────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/messages/:msgId/undo', chatAccess, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id, msgId } = request.params as { id: string; msgId: string };

    const conv = await getConversation(id, user.orgId, reply, user.id);
    if (!conv) return;

    const refs = await resolveMessageRefs(id, msgId, user.orgId);
    if (!refs) return reply.status(404).send({ error: 'Message not found' });

    try {
      // 2026-05-21 ownership + cliMsgId checks:
      // - senderType !== 'self' → không thu hồi được tin KH (Zalo không cho phép)
      // - cliMsgId null → tin cũ trước migration, không có client id → Zalo từ chối [zalo:112]
      if (refs.senderType !== 'self') {
        return reply.status(403).send({ error: 'Chỉ thu hồi được tin do bạn gửi' });
      }
      if (!refs.cliMsgId) {
        return reply.status(400).send({
          error: 'Tin này không thu hồi được (thiếu client ID — tin gửi trước bản fix 2026-05-21)',
        });
      }
      // Quá 24h: Zalo cũng từ chối — em không pre-check, để zca-js trả lỗi.

      const threadType = conv.threadType === 'group' ? 1 : 0;
      await zaloOps.undoMessage(conv.zaloAccountId, refs.zaloMsgId, refs.cliMsgId, refs.ownerId, conv.externalThreadId || '', threadType);
      await prisma.message.update({ where: { id: refs.messageId }, data: { isDeleted: true, deletedAt: new Date() } });

      const io = (app as any).io as Server;
      io?.emit('chat:deleted', { conversationId: id, messageId: refs.messageId, zaloMsgId: refs.zaloMsgId });
      return { success: true };
    } catch (err) { return handleError(err, reply); }
  });

  // ── POST /messages/:msgId/edit ───────────────────────────────────────────────
  // 2026-05-21: zca-js KHÔNG support edit thật → edit chỉ áp dụng trên CRM, không sync Zalo.
  // Khi sửa lần đầu: snapshot content cũ vào original_content + set edited_at.
  // FE phải show toast cảnh báo "Chỉ sửa trên CRM" + badge "(đã sửa)" trong bubble.
  app.post('/api/v1/conversations/:id/messages/:msgId/edit', chatAccess, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id, msgId } = request.params as { id: string; msgId: string };
    const { content } = request.body as { content: string };

    if (!content?.trim()) return reply.status(400).send({ error: 'content required' });

    const conv = await getConversation(id, user.orgId, reply, user.id);
    if (!conv) return;

    const refs = await resolveMessageRefs(id, msgId, user.orgId);
    if (!refs) return reply.status(404).send({ error: 'Message not found' });

    try {
      // 2026-05-21 fix B3: ownership check qua senderType (cả tin gửi từ phone lẫn từ CRM
      // đều có senderType='self' — đại diện sale của org này). repliedByUserId chỉ set
      // cho tin gửi từ CRM → check theo nó loại trừ tin từ phone (sai semantic).
      if (refs.senderType !== 'self') return reply.status(403).send({ error: 'Chỉ sửa được tin do bạn gửi' });

      const existing = await prisma.message.findUnique({
        where: { id: refs.messageId },
        select: { content: true, originalContent: true },
      });

      const updated = await prisma.message.update({
        where: { id: refs.messageId },
        data: {
          content: content.trim(),
          // Chỉ set originalContent lần ĐẦU sửa (giữ snapshot gốc).
          // Các lần sửa sau chỉ update content + editedAt.
          originalContent: existing?.originalContent ?? existing?.content ?? null,
          editedAt: new Date(),
        },
        select: { id: true, content: true, originalContent: true, editedAt: true },
      });

      const io = (app as any).io as Server;
      io?.emit('chat:message-edited', {
        conversationId: id,
        messageId: refs.messageId,
        zaloMsgId: refs.zaloMsgId,
        content: updated.content,
        originalContent: updated.originalContent,
        editedAt: updated.editedAt,
      });
      return {
        success: true,
        zaloSynced: false,
        notice: 'Chỉ sửa trên CRM — KH ở Zalo vẫn thấy nội dung gốc',
        message: updated,
      };
    } catch (err) { return handleError(err, reply); }
  });

  // ── POST /forward ────────────────────────────────────────────────────────────
  // Text/rich dùng native forwardMessage để giữ reference Zalo. Media thì tải file từ URL
  // đang lưu trong DB (MinIO/R2/Zalo CDN fallback), gửi lại bằng SDK rồi persist message ở
  // hội thoại đích để UI cập nhật ngay.
  app.post('/api/v1/conversations/:id/forward', chatAccess, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { msgId, targetConversationIds } = request.body as { msgId: string; targetConversationIds: string[] };

    if (!msgId || !targetConversationIds?.length) {
      return reply.status(400).send({ error: 'msgId and targetConversationIds required' });
    }

    const conv = await getConversation(id, user.orgId, reply, user.id);
    if (!conv) return;

    const refs = await resolveMessageRefs(id, msgId, user.orgId);
    if (!refs) {
      // Phân biệt "không thấy tin" vs "tin thiếu zaloMsgId". Trước đây cả hai đều trả
      // 404 'Message not found' và KHÔNG log → thất bại im lặng, không lần ra nguyên nhân.
      const raw = await prisma.message.findFirst({
        where: { id: msgId, conversationId: id, conversation: { orgId: user.orgId } },
        select: { id: true, zaloMsgId: true, contentType: true },
      });
      if (raw && !raw.zaloMsgId) {
        logger.warn('[chat-ops] forward bị chặn: tin thiếu zaloMsgId', { messageId: msgId, contentType: raw.contentType });
        return reply.status(400).send({
          error: 'Tin này không chuyển tiếp được (thiếu ID tin Zalo do gửi lỗi trước đây). Hãy gửi lại nội dung như tin mới.',
        });
      }
      logger.warn('[chat-ops] forward: không tìm thấy tin gốc', { conversationId: id, messageId: msgId });
      return reply.status(404).send({ error: 'Không tìm thấy tin nhắn gốc để chuyển tiếp' });
    }

    try {
      const targets = await prisma.conversation.findMany({
        where: {
          id: { in: targetConversationIds },
          orgId: user.orgId,
          // Riêng tư cấp hội thoại 2026-07-09: không chuyển tiếp VÀO hội thoại riêng tư
          // của người khác (sẽ ghi tin vào một luồng mình không được xem).
          OR: [{ isPrivate: false }, { privateOwnerUserId: user.id }],
        },
        include: { zaloAccount: true },
      });

      const validTargets = targets.filter((t) => Boolean(t.externalThreadId));
      if (validTargets.length === 0) {
        return reply.status(400).send({ error: 'Không có hội thoại đích hợp lệ để chuyển tiếp' });
      }

      type FwdResp = { success?: unknown[]; fail?: unknown[] };
      let succeeded = 0;
      let failed = 0;
      const io = (app as any).io as Server;

      if (['text', 'rich'].includes(refs.contentType)) {
        let textToForward = refs.content?.trim() || '';
        if (textToForward.startsWith('{')) {
          try {
            const parsed = JSON.parse(textToForward);
            textToForward = String(parsed.title || parsed.text || parsed.msg || textToForward);
          } catch { /* keep raw */ }
        }
        if (!textToForward) return reply.status(400).send({ error: 'Tin gốc không có nội dung text' });

        const reference = {
          id: refs.zaloMsgId,
          ts: refs.sentAt.getTime(),
          logSrcType: 0,
          fwLvl: 0,
        };
        const userTargets = validTargets.filter((t) => t.threadType !== 'group').map((t) => t.externalThreadId!);
        const groupTargets = validTargets.filter((t) => t.threadType === 'group').map((t) => t.externalThreadId!);
        // Gửi text: KHÔNG "mặc định coi là thành công" khi zca-js không trả field success —
        // trước đây `?? targets.length` nuốt mất lỗi thật. Ném lỗi ra ngoài để trả về đúng.
        const forwardText = async (threads: string[], type: 0 | 1) => {
          if (!threads.length) return;
          try {
            const res = (await (zaloOps.forwardMessage as any)(conv.zaloAccountId, textToForward, threads, type, reference)) as FwdResp;
            const okCount = Array.isArray(res?.success) ? res.success.length : undefined;
            const failCount = Array.isArray(res?.fail) ? res.fail.length : 0;
            if (okCount === undefined && failCount === 0) {
              // Không rõ kết quả → coi là thành công (zca-js không phải lúc nào cũng trả success),
              // nhưng LOG lại để còn lần ra nếu khách báo không nhận được.
              logger.info('[chat-ops] forward text: zca-js không trả success/fail', { threads: threads.length, type });
              succeeded += threads.length;
              return;
            }
            succeeded += okCount ?? Math.max(0, threads.length - failCount);
            failed += failCount;
            if (failCount > 0) logger.warn('[chat-ops] forward text: một số đích thất bại', { fail: res?.fail });
          } catch (err) {
            failed += threads.length;
            logger.error('[chat-ops] forward text thất bại:', { type, threads: threads.length, err: (err as Error).message });
          }
        };
        await forwardText(userTargets, 0);
        await forwardText(groupTargets, 1);
      } else if (FORWARD_MEDIA_TYPES.has(refs.contentType)) {
        // Ảnh gửi theo CỤM (album): Zalo lưu MỖI TẤM là một message riêng, chung albumKey. Nếu chỉ
        // gửi đúng tin được nhấn thì bên nhận chỉ thấy 1 tấm trong cụm — nên gom cả cụm và gửi một
        // lần (sendFile nhận nhiều path → Zalo dựng lại thành album).
        const albumItems = refs.albumKey
          ? await prisma.message.findMany({
              where: { conversationId: id, albumKey: refs.albumKey, contentType: 'image' },
              select: { content: true, contentType: true },
              orderBy: [{ albumIndex: 'asc' }, { sentAt: 'asc' }],
            })
          : [];
        const sourceItems = albumItems.length > 1
          ? albumItems
          : [{ content: refs.content, contentType: refs.contentType }];

        const resolved = sourceItems
          .map((item) => ({ item, media: pickForwardMedia(item.content, item.contentType) }))
          .filter((entry): entry is { item: typeof entry.item; media: NonNullable<typeof entry.media> } => !!entry.media);
        if (!resolved.length) return reply.status(400).send({ error: 'Tin gốc không có URL media để chuyển tiếp' });

        const downloads: Array<{ path: string; cleanup: () => Promise<void> }> = [];
        try {
          for (const entry of resolved) {
            downloads.push(await downloadMediaToTemp(entry.media, entry.item.contentType));
          }
          const paths = downloads.map((d) => d.path);
          const isAlbum = paths.length > 1;

          for (const target of validTargets) {
            const threadType = target.threadType === 'group' ? 1 : 0;
            const threadId = target.externalThreadId!;
            const targetAccountId = target.zaloAccountId;
            const instance = refs.contentType === 'video' ? zaloPool.getInstance(targetAccountId) : null;
            let sendResult: unknown;
            try {
              if (isAlbum) {
                sendResult = await zaloOps.sendFile(targetAccountId, threadId, threadType, paths, io);
              } else if (refs.contentType === 'video' && instance?.api) {
                try {
                  sendResult = await sendNativeVideo({
                    api: instance.api as any,
                    threadId,
                    threadType,
                    videoPath: paths[0],
                  });
                } catch (err) {
                  logger.warn('[chat-ops] native forward video failed, falling back to attachment:', err);
                  sendResult = await zaloOps.sendFile(targetAccountId, threadId, threadType, paths, io);
                }
              } else if (refs.contentType === 'voice' || refs.contentType === 'audio') {
                try {
                  sendResult = await zaloOps.sendVoice(targetAccountId, threadId, threadType, paths[0]);
                } catch (err) {
                  logger.warn('[chat-ops] forward voice failed, falling back to attachment:', err);
                  sendResult = await zaloOps.sendFile(targetAccountId, threadId, threadType, paths, io);
                }
              } else {
                // image / gif / file — sendFile lo cả 3.
                sendResult = await zaloOps.sendFile(targetAccountId, threadId, threadType, paths, io);
              }

              // Album trả về mảng attachment (1 msgId / tấm); tin đơn trả về 1 msgId.
              const attachments = (sendResult as { attachment?: Array<{ msgId?: string | number }> } | null)?.attachment;
              const msgIdAt = (index: number): string => {
                const raw = Array.isArray(attachments) ? attachments[index]?.msgId : undefined;
                if (raw) return String(raw);
                return index === 0 ? extractZaloMsgId(sendResult) : '';
              };

              const senderName = await getUserFullName(user.id);
              for (let index = 0; index < resolved.length; index += 1) {
                const item = resolved[index].item;
                const zaloMsgId = msgIdAt(index);
                const created = await prisma.message.create({
                  data: {
                    id: randomUUID(),
                    conversationId: target.id,
                    zaloMsgId: zaloMsgId || null,
                    zaloMsgIdNum: zaloMsgId && /^\d+$/.test(zaloMsgId) ? BigInt(zaloMsgId) : null,
                    senderType: 'self',
                    senderUid: target.zaloAccount.zaloUid || '',
                    senderName: 'Staff',
                    sentVia: 'user',
                    metadata: { sender: { kind: 'user_crm', name: senderName } },
                    content: item.content,
                    contentType: item.contentType,
                    sentAt: new Date(),
                    repliedByUserId: user.id,
                  },
                });

                io?.emit('chat:message', {
                  accountId: target.zaloAccountId,
                  message: { ...created, zaloMsgIdNum: created.zaloMsgIdNum?.toString() ?? null },
                  conversationId: target.id,
                  _privacyMeta: {
                    privacyMode: target.zaloAccount.privacyMode,
                    ownerUserId: target.zaloAccount.ownerUserId,
                  },
                });

                const aggInput = {
                  conversationId: target.id,
                  message: {
                    id: created.id,
                    content: created.content,
                    contentType: created.contentType,
                    sentAt: created.sentAt,
                    senderType: 'self' as const,
                  },
                  outboundUserId: user.id,
                };
                void applyContactAggregateFromMessage(aggInput);
                void applyFriendAggregate(aggInput);
              }

              await prisma.conversation.update({
                where: { id: target.id },
                data: { lastMessageAt: new Date(), isReplied: true, unreadCount: 0 },
              });
              succeeded += 1;
            } catch (err) {
              failed += 1;
              logger.error('[chat-ops] forward media target failed:', {
                targetConversationId: target.id,
                contentType: refs.contentType,
                album: isAlbum ? resolved.length : 0,
                err: (err as Error).message,
              });
            }
          }
        } finally {
          for (const d of downloads) await d.cleanup().catch(() => {});
        }
      } else {
        return reply.status(400).send({
          error: 'Chỉ hỗ trợ chuyển tiếp text, hình ảnh, video, audio, GIF và tệp.',
        });
      }

      io?.emit('chat:forwarded', { conversationId: id, messageId: refs.messageId, succeeded, failed });

      // TRẢ ĐÚNG SỰ THẬT. Trước đây luôn `success: true` kể cả khi MỌI đích đều fail → FE hiện
      // toast xanh "Đã chuyển tiếp" mà khách không hề nhận được. Giờ: fail hết → báo lỗi.
      if (succeeded === 0 && failed > 0) {
        logger.error('[chat-ops] forward: TẤT CẢ đích thất bại', { conversationId: id, messageId: refs.messageId, failed });
        return reply.status(502).send({
          error: 'Không chuyển tiếp được tới hội thoại nào. Kiểm tra kết nối nick Zalo rồi thử lại.',
          forwarded: 0,
          failed,
        });
      }
      return { success: failed === 0, forwarded: succeeded, failed };
    } catch (err) { return handleError(err, reply); }
  });

  // ── POST /pin ────────────────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/pin', chatAccess, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conv = await getConversation(id, user.orgId, reply, user.id);
    if (!conv) return;

    try {
      const threadType = conv.threadType === 'group' ? 1 : 0;
      const result = await zaloOps.pinConversation(conv.zaloAccountId, true, conv.externalThreadId || '', threadType);
      await prisma.pinnedConversation.upsert({
        where: { zaloAccountId_conversationId: { zaloAccountId: conv.zaloAccountId, conversationId: id } },
        update: { pinnedAt: new Date() },
        create: { id: randomUUID(), orgId: user.orgId, zaloAccountId: conv.zaloAccountId, conversationId: id },
      });
      const io = (app as any).io as Server;
      io?.emit('chat:pinned', { conversationId: id, isPinned: true });
      return { success: true, result };
    } catch (err) { return handleError(err, reply); }
  });

  // ── POST /unpin ──────────────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/unpin', chatAccess, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    const conv = await getConversation(id, user.orgId, reply, user.id);
    if (!conv) return;

    try {
      const threadType = conv.threadType === 'group' ? 1 : 0;
      const result = await zaloOps.pinConversation(conv.zaloAccountId, false, conv.externalThreadId || '', threadType);
      await prisma.pinnedConversation.deleteMany({
        where: { zaloAccountId: conv.zaloAccountId, conversationId: id },
      });
      const io = (app as any).io as Server;
      io?.emit('chat:unpinned', { conversationId: id, isPinned: false });
      return { success: true, result };
    } catch (err) { return handleError(err, reply); }
  });

  // ── POST /sticker ────────────────────────────────────────────────────────────
  // Body: { stickerId, cateId, type } — đúng shape zca-js SendStickerPayload
  app.post('/api/v1/conversations/:id/sticker', chatAccess, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { stickerId, cateId, type } = request.body as {
      stickerId: number; cateId?: number; type?: number;
    };

    if (!stickerId) return reply.status(400).send({ error: 'stickerId required' });

    const conv = await getConversation(id, user.orgId, reply, user.id);
    if (!conv) return;

    try {
      const threadType = conv.threadType === 'group' ? 1 : 0;
      const stickerPayload = { id: stickerId, cateId: cateId || 0, type: type || 0 };
      const result = await zaloOps.sendSticker(
        conv.zaloAccountId,
        stickerPayload,
        conv.externalThreadId || '',
        threadType,
      );

      // Extract zaloMsgId từ sendSticker result để dedup với selfListen echo
      // (cũ: zaloMsgId undefined → selfListen tạo row 2 → double sticker UI)
      const sr = result as unknown as {
        message?: { msgId?: number | string } | null;
        msgId?: number | string;
      };
      const rawId = sr?.message?.msgId ?? sr?.msgId ?? '';
      const zaloMsgId = String(rawId || '');

      const created = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: id,
          zaloMsgId: zaloMsgId || null,
          zaloMsgIdNum: zaloMsgId && /^\d+$/.test(zaloMsgId) ? BigInt(zaloMsgId) : null,
          senderType: 'self',
          senderUid: '',
          senderName: 'Staff',
          sentVia: 'user',
          metadata: { sender: { kind: 'user_crm', name: await getUserFullName(user.id) } },
          // Lưu content shape JSON như Zalo native ({id, catId, type}) → frontend
          // dùng metadata endpoint render đúng (animated CSS sprite hoặc static)
          content: JSON.stringify({ id: stickerId, catId: cateId || 0, type: type || 0 }),
          contentType: 'sticker',
          sentAt: new Date(),
          repliedByUserId: user.id,
        },
      });
      {
        const aggInput = {
          conversationId: id,
          message: {
            id: created.id,
            content: created.content,
            contentType: created.contentType,
            sentAt: created.sentAt,
            senderType: 'self' as const,
          },
          outboundUserId: user.id,
        };
        void applyContactAggregateFromMessage(aggInput);
        void applyFriendAggregate(aggInput);
      }

      return { success: true, result };
    } catch (err) { return handleError(err, reply); }
  });

  // ── POST /link ───────────────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/link', chatAccess, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { url } = request.body as { url: string };

    if (!url?.trim()) return reply.status(400).send({ error: 'url required' });

    const conv = await getConversation(id, user.orgId, reply, user.id);
    if (!conv) return;

    try {
      const threadType = conv.threadType === 'group' ? 1 : 0;
      const result = await zaloOps.sendLink(conv.zaloAccountId, conv.externalThreadId || '', threadType, { link: url });

      const created = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: id,
          senderType: 'self',
          senderUid: '',
          senderName: 'Staff',
          sentVia: 'user',
          metadata: { sender: { kind: 'user_crm', name: await getUserFullName(user.id) } },
          content: url,
          contentType: 'link',
          sentAt: new Date(),
          repliedByUserId: user.id,
        },
      });
      {
        const aggInput = {
          conversationId: id,
          message: {
            id: created.id,
            content: created.content,
            contentType: created.contentType,
            sentAt: created.sentAt,
            senderType: 'self' as const,
          },
          outboundUserId: user.id,
        };
        void applyContactAggregateFromMessage(aggInput);
        void applyFriendAggregate(aggInput);
      }

      return { success: true, result };
    } catch (err) { return handleError(err, reply); }
  });

  // ── POST /card ───────────────────────────────────────────────────────────────
  app.post('/api/v1/conversations/:id/card', chatAccess, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const { contactId } = request.body as { contactId: string };

    if (!contactId?.trim()) return reply.status(400).send({ error: 'contactId required' });

    const conv = await getConversation(id, user.orgId, reply, user.id);
    if (!conv) return;

    try {
      const threadType = conv.threadType === 'group' ? 1 : 0;
      const result = await zaloOps.sendCard(conv.zaloAccountId, conv.externalThreadId || '', threadType, contactId);

      const created = await prisma.message.create({
        data: {
          id: randomUUID(),
          conversationId: id,
          senderType: 'self',
          senderUid: '',
          senderName: 'Staff',
          sentVia: 'user',
          metadata: { sender: { kind: 'user_crm', name: await getUserFullName(user.id) } },
          content: contactId,
          contentType: 'contact_card',
          sentAt: new Date(),
          repliedByUserId: user.id,
        },
      });
      {
        const aggInput = {
          conversationId: id,
          message: {
            id: created.id,
            content: created.content,
            contentType: created.contentType,
            sentAt: created.sentAt,
            senderType: 'self' as const,
          },
          outboundUserId: user.id,
        };
        void applyContactAggregateFromMessage(aggInput);
        void applyFriendAggregate(aggInput);
      }

      return { success: true, result };
    } catch (err) { return handleError(err, reply); }
  });
}

// Socket.IO event handlers for chat operations
export function registerChatSocketHandlers(io: Server): void {
  io.on('connection', (socket) => {
    socket.on('chat:typing', (data: { conversationId: string; userId: string; userName: string }) => {
      try {
        eventBuffer.recordTyping(data.conversationId, data.userId, data.userName);
      } catch (err) {
        logger.error('[socket] chat:typing error:', err);
      }
    });

    // PWA Mobile — user đang MỞ hội thoại nào (để không bắn Web Push cho chính họ).
    // userId lấy TỪ TOKEN đã verify (socket.data.authCtx), KHÔNG nhận từ client → chống giả mạo.
    socket.on('presence:viewing', (data: { conversationId: string | null }) => {
      const ctx = getSocketAuth(socket);
      if (!ctx) return;
      void setViewing(ctx.userId, data?.conversationId ?? null);
    });

    socket.on('disconnect', () => {
      const ctx = getSocketAuth(socket);
      if (ctx) void clearViewing(ctx.userId);
    });
  });
}
