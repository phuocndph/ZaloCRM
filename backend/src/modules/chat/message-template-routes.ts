// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * message-template-routes.ts — CRUD Mẫu tin nhắn + Thư mục (core, 2026-07-11).
 *
 * Trước đây CRUD nằm trong bundle enterprise `_ee/automation` (bị lược ở bản Community) →
 * FE gọi /automation/templates trả 404 → mẫu tin nhắn KHÔNG chạy. File này đưa CRUD vào
 * CORE để tính năng hoạt động ở mọi bản.
 *
 * Endpoint (khớp use-message-templates.ts):
 *   GET/POST         /api/v1/automation/templates
 *   PUT/DELETE       /api/v1/automation/templates/:id
 *   POST             /api/v1/automation/templates/:id/track-use
 *   GET/POST         /api/v1/automation/template-folders
 *   PUT/DELETE       /api/v1/automation/template-folders/:id
 *
 * Quyền: org-scope. Mẫu 'public' = cả org xem; 'private' = chỉ chủ. Sửa/xoá = người tạo
 * hoặc owner/admin org. Xoá mẫu = soft (archivedAt). KHÔNG đụng model khác.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';

interface AuthUser { id: string; orgId: string; role: string }

const isOrgAdmin = (u: AuthUser) => u.role === 'owner' || u.role === 'admin';

/** Chuẩn hoá shortcut: bỏ dấu, bỏ '/', lowercase, chỉ [a-z0-9_-]. Khớp normQuery FE. */
export function normalizeShortcut(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .trim()
    .replace(/^\/+/, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  return s || null;
}

interface RichPayload { text: string; styles?: Array<{ st: string; start: number; len: number }> }

/** Tách text + rich từ payload (content | contentRich). content luôn = contentRich.text. */
export function deriveContent(body: Record<string, unknown>): { content: string; contentRich: RichPayload | null } {
  const rich = body.contentRich as RichPayload | null | undefined;
  if (rich && typeof rich.text === 'string') {
    return { content: rich.text, contentRich: { text: rich.text, styles: Array.isArray(rich.styles) ? rich.styles : [] } };
  }
  const content = typeof body.content === 'string' ? body.content : '';
  return { content, contentRich: content ? { text: content, styles: [] } : null };
}

export function sanitizeAttachments(v: unknown): unknown[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a) => a && typeof a === 'object' && typeof (a as any).url === 'string')
    .slice(0, 10)
    .map((a) => {
      const x = a as Record<string, unknown>;
      return {
        kind: x.kind === 'file' ? 'file' : 'image',
        // assetId = tham chiếu Kho Media (để gửi lại qua /media/:id/send, đã kiểm quyền).
        assetId: typeof x.assetId === 'string' ? x.assetId : undefined,
        url: String(x.url),
        name: typeof x.name === 'string' ? x.name : undefined,
        mime: typeof x.mime === 'string' ? x.mime : undefined,
        size: typeof x.size === 'number' ? x.size : undefined,
        thumb: typeof x.thumb === 'string' ? x.thumb : undefined,
      };
    });
}

/** Chuẩn hoá mảng block (mẫu nhiều bước). Null/rỗng → null (mẫu 1 bước cũ). */
export function sanitizeBlocks(v: unknown): unknown[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const types = ['text', 'image', 'image_album', 'video', 'file', 'delay'];
  const out = v
    .filter((b) => b && typeof b === 'object' && types.includes((b as any).type))
    .map((b: any, i: number) => {
      const type = String(b.type);
      const base: Record<string, unknown> = { id: typeof b.id === 'string' && b.id ? b.id : `b${i}`, type, order: i, enabled: b.enabled !== false };
      if (type === 'delay') base.delayMs = Math.max(0, Math.min(10000, Number(b.delayMs) || 0));
      else if (type === 'text') base.content = typeof b.content === 'string' ? b.content : '';
      else base.attachments = sanitizeAttachments(b.attachments);
      return base;
    })
    .filter((b: any) => b.type === 'delay' || b.type === 'text' || (Array.isArray(b.attachments) && b.attachments.length > 0));
  return out.length > 0 ? out : null;
}

const TEMPLATE_SELECT = {
  id: true, name: true, shortcut: true, content: true, contentRich: true, attachments: true, blocks: true,
  category: true, folderId: true, visibility: true, tagIds: true, ownerUserId: true, createdById: true,
  usageCount: true, lastUsedAt: true, manualSendCount: true, createdAt: true, updatedAt: true,
} as const;

/** Map row → DTO cho FE (thêm isMine/isPersonal). */
function toDto(row: any, userId: string) {
  return {
    ...row,
    isMine: row.createdById === userId || row.ownerUserId === userId,
    isPersonal: row.visibility === 'private',
  };
}

export async function registerMessageTemplateRoutes(app: FastifyInstance): Promise<void> {
  const guard = [authMiddleware];

  // ═══════════ TEMPLATES ═══════════
  app.get('/api/v1/automation/templates', { preHandler: guard }, async (request: FastifyRequest) => {
    const user = request.user as unknown as AuthUser;
    const q = request.query as Record<string, string>;

    const where: Prisma.MessageTemplateWhereInput = {
      orgId: user.orgId,
      // Chỉ thấy mẫu public của org HOẶC mẫu riêng của chính mình.
      OR: [{ visibility: 'public' }, { ownerUserId: user.id }, { createdById: user.id }],
    };
    if (!q.includeArchived) where.archivedAt = null;
    if (q.folderId) where.folderId = q.folderId;
    if (q.visibility === 'public' || q.visibility === 'private') where.visibility = q.visibility;
    if (q.category) where.category = q.category;
    if (q.tags) {
      const tags = q.tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (tags.length) where.tagIds = { hasSome: tags };
    }
    if (q.search) {
      const s = q.search.trim();
      // Gộp vào AND để không phá OR visibility ở trên.
      where.AND = [{ OR: [{ name: { contains: s, mode: 'insensitive' } }, { content: { contains: s, mode: 'insensitive' } }, { shortcut: { contains: normalizeShortcut(s) ?? s } }] }];
    }

    const rows = await prisma.messageTemplate.findMany({
      where,
      // Hay dùng lên đầu, rồi mới nhất (yêu cầu P1 #10).
      orderBy: [{ usageCount: 'desc' }, { updatedAt: 'desc' }],
      select: TEMPLATE_SELECT,
      take: 500,
    });
    return { templates: rows.map((r) => toDto(r, user.id)) };
  });

  app.post('/api/v1/automation/templates', { preHandler: guard }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as unknown as AuthUser;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return reply.status(400).send({ error: 'Thiếu tên mẫu' });

    const { content, contentRich } = deriveContent(body);
    const attachments = sanitizeAttachments(body.attachments);
    if (!content.trim() && attachments.length === 0) {
      return reply.status(400).send({ error: 'Mẫu phải có nội dung hoặc đính kèm' });
    }
    const visibility = body.visibility === 'public' ? 'public' : 'private';
    const blk = sanitizeBlocks(body.blocks);

    const created = await prisma.messageTemplate.create({
      data: {
        orgId: user.orgId,
        name,
        shortcut: normalizeShortcut(body.shortcut as string),
        content,
        contentRich: (contentRich ?? undefined) as Prisma.InputJsonValue | undefined,
        attachments: attachments as Prisma.InputJsonValue,
        // Mẫu nhiều bước: chỉ set khi CÓ block. Rỗng → OMIT field → cột NULL (không lưu '{}').
        ...(blk ? { blocks: blk as Prisma.InputJsonValue } : {}),
        category: typeof body.category === 'string' ? body.category : null,
        folderId: typeof body.folderId === 'string' ? body.folderId : null,
        visibility,
        tagIds: Array.isArray(body.tagIds) ? (body.tagIds as string[]).filter((t) => typeof t === 'string') : [],
        ownerUserId: visibility === 'private' ? user.id : null,
        createdById: user.id,
      },
      select: TEMPLATE_SELECT,
    });
    return reply.status(201).send(toDto(created, user.id));
  });

  app.put('/api/v1/automation/templates/:id', { preHandler: guard }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as unknown as AuthUser;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    const existing = await prisma.messageTemplate.findFirst({ where: { id, orgId: user.orgId }, select: { createdById: true, ownerUserId: true } });
    if (!existing) return reply.status(404).send({ error: 'Không tìm thấy mẫu' });
    const canEdit = isOrgAdmin(user) || existing.createdById === user.id || existing.ownerUserId === user.id;
    if (!canEdit) return reply.status(403).send({ error: 'Không có quyền sửa mẫu này' });

    const data: Prisma.MessageTemplateUncheckedUpdateInput = {};
    if (typeof body.name === 'string') data.name = body.name.trim();
    if ('shortcut' in body) data.shortcut = normalizeShortcut(body.shortcut as string);
    if ('content' in body || 'contentRich' in body) {
      const { content, contentRich } = deriveContent(body);
      data.content = content;
      data.contentRich = contentRich ? (contentRich as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
    }
    if ('attachments' in body) data.attachments = sanitizeAttachments(body.attachments) as Prisma.InputJsonValue;
    // Xoá về JsonNull (trả 'null', KHÔNG '{}') khi mẫu quay lại 1 bước; set mảng khi nhiều bước.
    if ('blocks' in body) { const blk = sanitizeBlocks(body.blocks); data.blocks = blk ? (blk as Prisma.InputJsonValue) : Prisma.JsonNull; }
    if ('category' in body) data.category = (body.category as string) || null;
    if ('folderId' in body) data.folderId = (body.folderId as string) || null;
    if ('tagIds' in body && Array.isArray(body.tagIds)) data.tagIds = (body.tagIds as string[]).filter((t) => typeof t === 'string');
    if (body.visibility === 'public' || body.visibility === 'private') {
      data.visibility = body.visibility;
      data.ownerUserId = body.visibility === 'private' ? user.id : null;
    }

    const updated = await prisma.messageTemplate.update({ where: { id }, data, select: TEMPLATE_SELECT });
    return toDto(updated, user.id);
  });

  app.delete('/api/v1/automation/templates/:id', { preHandler: guard }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as unknown as AuthUser;
    const { id } = request.params as { id: string };
    const existing = await prisma.messageTemplate.findFirst({ where: { id, orgId: user.orgId }, select: { createdById: true, ownerUserId: true } });
    if (!existing) return reply.status(404).send({ error: 'Không tìm thấy mẫu' });
    const canDelete = isOrgAdmin(user) || existing.createdById === user.id || existing.ownerUserId === user.id;
    if (!canDelete) return reply.status(403).send({ error: 'Không có quyền xoá mẫu này' });
    // Soft-delete (giữ lịch sử usage). Khôi phục được qua includeArchived nếu cần sau.
    await prisma.messageTemplate.update({ where: { id }, data: { archivedAt: new Date() } });
    return { ok: true };
  });

  app.post('/api/v1/automation/templates/:id/track-use', { preHandler: guard }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as unknown as AuthUser;
    const { id } = request.params as { id: string };
    const res = await prisma.messageTemplate.updateMany({
      where: { id, orgId: user.orgId },
      data: { usageCount: { increment: 1 }, manualSendCount: { increment: 1 }, lastUsedAt: new Date(), lastManualSentAt: new Date() },
    });
    if (res.count === 0) return reply.status(404).send({ error: 'Không tìm thấy mẫu' });
    return { ok: true };
  });

  // ═══════════ FOLDERS ═══════════
  app.get('/api/v1/automation/template-folders', { preHandler: guard }, async (request: FastifyRequest) => {
    const user = request.user as unknown as AuthUser;
    const rows = await prisma.messageTemplateFolder.findMany({
      where: { orgId: user.orgId, OR: [{ visibility: 'public' }, { ownerUserId: user.id }, { createdById: user.id }] },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, visibility: true, ownerUserId: true, parentId: true, _count: { select: { templates: true } } },
    });
    return { folders: rows };
  });

  app.post('/api/v1/automation/template-folders', { preHandler: guard }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as unknown as AuthUser;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return reply.status(400).send({ error: 'Thiếu tên thư mục' });
    const visibility = body.visibility === 'private' ? 'private' : 'public';
    const created = await prisma.messageTemplateFolder.create({
      data: {
        orgId: user.orgId, name, visibility,
        parentId: typeof body.parentId === 'string' ? body.parentId : null,
        ownerUserId: visibility === 'private' ? user.id : null,
        createdById: user.id,
      },
      select: { id: true, name: true, visibility: true, ownerUserId: true, parentId: true },
    });
    return reply.status(201).send(created);
  });

  app.put('/api/v1/automation/template-folders/:id', { preHandler: guard }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as unknown as AuthUser;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const existing = await prisma.messageTemplateFolder.findFirst({ where: { id, orgId: user.orgId }, select: { createdById: true, ownerUserId: true } });
    if (!existing) return reply.status(404).send({ error: 'Không tìm thấy thư mục' });
    if (!(isOrgAdmin(user) || existing.createdById === user.id || existing.ownerUserId === user.id)) {
      return reply.status(403).send({ error: 'Không có quyền sửa thư mục này' });
    }
    const data: Prisma.MessageTemplateFolderUpdateInput = {};
    if (typeof body.name === 'string') data.name = body.name.trim();
    if (body.visibility === 'public' || body.visibility === 'private') data.visibility = body.visibility;
    const updated = await prisma.messageTemplateFolder.update({ where: { id }, data, select: { id: true, name: true, visibility: true, ownerUserId: true, parentId: true } });
    return updated;
  });

  app.delete('/api/v1/automation/template-folders/:id', { preHandler: guard }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as unknown as AuthUser;
    const { id } = request.params as { id: string };
    const force = (request.query as Record<string, string>).force === 'true';
    const existing = await prisma.messageTemplateFolder.findFirst({ where: { id, orgId: user.orgId }, select: { createdById: true, ownerUserId: true } });
    if (!existing) return reply.status(404).send({ error: 'Không tìm thấy thư mục' });
    if (!(isOrgAdmin(user) || existing.createdById === user.id || existing.ownerUserId === user.id)) {
      return reply.status(403).send({ error: 'Không có quyền xoá thư mục này' });
    }
    const count = await prisma.messageTemplate.count({ where: { folderId: id, archivedAt: null } });
    if (count > 0 && !force) {
      return reply.status(409).send({ error: `Thư mục còn ${count} mẫu. Xoá kèm hoặc chuyển mẫu ra ngoài trước.`, count });
    }
    // force: chuyển mẫu ra ngoài (folderId=null) rồi xoá thư mục (không mất mẫu).
    if (count > 0) await prisma.messageTemplate.updateMany({ where: { folderId: id }, data: { folderId: null } });
    await prisma.messageTemplateFolder.delete({ where: { id } });
    return { ok: true };
  });

  logger.info('[message-templates] CRUD routes registered (core edition)');
}
