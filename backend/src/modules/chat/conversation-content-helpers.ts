// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * conversation-content-helpers.ts — logic THUẦN (không I/O) cho Conversation Content
 * Library. Tách khỏi routes để unit-test không cần DB/Fastify (khớp convention repo).
 */
import type { Prisma } from '@prisma/client';

/** Ép query param → int trong [min,max], fallback def khi thiếu/không hợp lệ. */
export function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = parseInt(String(v ?? ''), 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}

// URL trong text (tab Link auto-detect). Global để lấy mọi URL trong 1 tin.
export const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

/**
 * Trích URL đầu tiên trong 1 message content. Ưu tiên field href/url trong JSON (tin
 * type=link Zalo lưu JSON), fallback regex trong text thường. Trả null nếu không có URL.
 */
export function extractFirstUrl(content: string | null | undefined): string | null {
  if (!content) return null;
  if (content.startsWith('{')) {
    try {
      const p = JSON.parse(content) as Record<string, unknown>;
      const href = (p.href || p.url || p.link) as unknown;
      if (typeof href === 'string' && /^https?:\/\//i.test(href)) return href;
    } catch {
      /* fall through to regex */
    }
  }
  const m = content.match(URL_RE);
  return m && m[0] ? m[0] : null;
}

export type ContentType = 'all' | 'text' | 'media' | 'file' | 'link' | 'pinned';
export type SenderFilter = 'all' | 'self' | 'contact';

export interface SearchParams {
  conversationId: string;
  term?: string;
  type?: string;
  senderType?: string;
  from?: string;
  to?: string;
}

/**
 * Dựng Prisma where cho tìm kiếm/lọc trong 1 hội thoại. Case-insensitive ILIKE cho text
 * (VN có dấu khớp chính xác). type=link gộp contentType='link' + text chứa 'http'.
 */
export function buildSearchWhere(params: SearchParams): Prisma.MessageWhereInput {
  const { conversationId } = params;
  const term = (params.term ?? '').trim();
  const type = (params.type ?? 'all').toLowerCase();
  const senderType = (params.senderType ?? 'all').toLowerCase();

  const where: Prisma.MessageWhereInput = { conversationId };
  if (term) where.content = { contains: term, mode: 'insensitive' };
  if (senderType === 'self' || senderType === 'contact') where.senderType = senderType;

  if (params.from || params.to) {
    const sentAt: Prisma.DateTimeFilter = {};
    if (params.from) sentAt.gte = new Date(params.from);
    if (params.to) sentAt.lte = new Date(params.to);
    where.sentAt = sentAt;
  }

  if (type === 'media') where.contentType = { in: ['image', 'video'] };
  else if (type === 'file') where.contentType = 'file';
  else if (type === 'text') where.contentType = 'text';
  else if (type === 'link') {
    where.OR = [{ contentType: 'link' }, { content: { contains: 'http', mode: 'insensitive' } }];
  } else if (type === 'pinned') {
    where.messagePins = { some: { unpinnedAt: null } };
  }

  return where;
}

/** OrderBy cho tab File / list — newest (desc) hoặc oldest (asc). */
export function resolveOrderBy(
  sort: string | undefined,
): Prisma.MessageOrderByWithRelationInput[] {
  return (sort ?? 'newest').toLowerCase() === 'oldest'
    ? [{ zaloMsgIdNum: { sort: 'asc', nulls: 'first' } }, { sentAt: 'asc' }]
    : [{ zaloMsgIdNum: { sort: 'desc', nulls: 'last' } }, { sentAt: 'desc' }];
}
