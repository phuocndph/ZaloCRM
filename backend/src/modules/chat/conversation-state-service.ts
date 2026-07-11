// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * conversation-state-service.ts — Conversation State System per-USER (2026-07-10).
 *
 * Trạng thái hội thoại RIÊNG của từng user CRM: ghim cá nhân, đánh dấu chưa đọc thủ công,
 * và (mở rộng) snooze/reminder/star/follow-up/VIP/priority/internal state.
 *
 * NGUYÊN TẮC:
 *   • Per-user: mỗi hàng = (user × conversation). Không ảnh hưởng ai khác.
 *   • KHÔNG đụng Conversation.unreadCount (chưa đọc THẬT) — manual unread là cờ riêng.
 *   • KHÔNG đồng bộ Zalo (khác PinnedConversation cấp nick).
 *   • Realtime chỉ bắn vào room `user:${userId}` → không phá luồng chat:message org-wide.
 *
 * MỞ RỘNG: field mới thêm vào WHITELIST_FIELDS (nếu là cột typed) hoặc để nguyên trong
 * `flags` JSON (state ad-hoc). Route generic PATCH tự nhận field mới không cần sửa.
 */
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

/** Trạng thái trả cho client — không lộ id nội bộ. */
export interface ConversationStateDto {
  conversationId: string;
  isPinned: boolean;
  pinnedAt: string | null;
  isManualUnread: boolean;
  manualUnreadAt: string | null;
  /** Cửa mở rộng: state tương lai chưa có cột typed. */
  flags: Record<string, unknown>;
}

/** State "trống" (chưa có hàng DB) — mọi cờ tắt. */
export function emptyState(conversationId: string): ConversationStateDto {
  return {
    conversationId,
    isPinned: false,
    pinnedAt: null,
    isManualUnread: false,
    manualUnreadAt: null,
    flags: {},
  };
}

type StateRow = {
  conversationId: string;
  isPinned: boolean;
  pinnedAt: Date | null;
  isManualUnread: boolean;
  manualUnreadAt: Date | null;
  flags: unknown;
};

function toDto(row: StateRow): ConversationStateDto {
  return {
    conversationId: row.conversationId,
    isPinned: row.isPinned,
    pinnedAt: row.pinnedAt ? row.pinnedAt.toISOString() : null,
    isManualUnread: row.isManualUnread,
    manualUnreadAt: row.manualUnreadAt ? row.manualUnreadAt.toISOString() : null,
    flags: (row.flags && typeof row.flags === 'object' ? row.flags : {}) as Record<string, unknown>,
  };
}

const STATE_SELECT = {
  conversationId: true,
  isPinned: true,
  pinnedAt: true,
  isManualUnread: true,
  manualUnreadAt: true,
  flags: true,
} as const;

/**
 * Field cột typed được PATCH nhận. Field ngoài danh sách này → gom vào `flags` (state
 * ad-hoc). Thêm state tương lai có cột typed = thêm 1 dòng ở đây.
 */
const BOOLEAN_FIELDS = ['isPinned', 'isManualUnread'] as const;
/** Mỗi cờ boolean gắn 1 cột timestamp "…At" tự set khi bật, null khi tắt. */
const BOOLEAN_TIMESTAMP: Record<string, string> = {
  isPinned: 'pinnedAt',
  isManualUnread: 'manualUnreadAt',
};

export interface StatePatch {
  isPinned?: boolean;
  isManualUnread?: boolean;
  /** Merge nông vào cột flags (state mở rộng). null ở 1 key → xoá key đó. */
  flags?: Record<string, unknown>;
}

/** Lấy state của 1 hội thoại cho 1 user (chưa có hàng → state trống). */
export async function getState(userId: string, conversationId: string): Promise<ConversationStateDto> {
  const row = (await prisma.conversationUserState.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
    select: STATE_SELECT,
  })) as StateRow | null;
  return row ? toDto(row) : emptyState(conversationId);
}

/**
 * Batch: nạp state cho NHIỀU hội thoại của 1 user trong 1 query (dùng ở list view, tránh
 * N+1). Trả Map conversationId → dto; hội thoại chưa có hàng KHÔNG nằm trong Map (caller
 * tự coi là state trống).
 */
export async function loadStates(
  userId: string,
  conversationIds: string[],
): Promise<Map<string, ConversationStateDto>> {
  if (conversationIds.length === 0) return new Map();
  const rows = (await prisma.conversationUserState.findMany({
    where: { userId, conversationId: { in: conversationIds } },
    select: STATE_SELECT,
  })) as StateRow[];
  return new Map(rows.map((r) => [r.conversationId, toDto(r)]));
}

/**
 * Upsert state (partial). Chỉ đụng field có trong patch (giữ nguyên phần còn lại). Cờ
 * boolean tự set/clear cột timestamp đi kèm. `flags` merge nông, value=null → xoá key.
 */
export async function patchState(
  orgId: string,
  userId: string,
  conversationId: string,
  patch: StatePatch,
): Promise<ConversationStateDto> {
  const now = new Date();
  const data: Record<string, unknown> = {};

  for (const f of BOOLEAN_FIELDS) {
    if (typeof patch[f] === 'boolean') {
      data[f] = patch[f];
      const tsCol = BOOLEAN_TIMESTAMP[f];
      data[tsCol] = patch[f] ? now : null;
    }
  }

  // flags: merge nông trên giá trị hiện có (đọc trước rồi ghi — không dùng JSON path update
  // để giữ tính khả chuyển). key=null → xoá.
  let mergedFlags: Record<string, unknown> | undefined;
  if (patch.flags && typeof patch.flags === 'object') {
    const existing = (await prisma.conversationUserState.findUnique({
      where: { userId_conversationId: { userId, conversationId } },
      select: { flags: true },
    })) as { flags: unknown } | null;
    const base = (existing?.flags && typeof existing.flags === 'object' ? existing.flags : {}) as Record<string, unknown>;
    mergedFlags = { ...base };
    for (const [k, v] of Object.entries(patch.flags)) {
      if (v === null) delete mergedFlags[k];
      else mergedFlags[k] = v;
    }
    data.flags = mergedFlags;
  }

  const row = (await prisma.conversationUserState.upsert({
    where: { userId_conversationId: { userId, conversationId } },
    update: data,
    create: {
      orgId,
      userId,
      conversationId,
      isPinned: (data.isPinned as boolean) ?? false,
      pinnedAt: (data.pinnedAt as Date | null) ?? null,
      isManualUnread: (data.isManualUnread as boolean) ?? false,
      manualUnreadAt: (data.manualUnreadAt as Date | null) ?? null,
      flags: (mergedFlags ?? {}) as object,
    },
    select: STATE_SELECT,
  })) as StateRow;

  return toDto(row);
}

/**
 * Tắt cờ "chưa đọc thủ công" khi user MỞ hội thoại (hook trong /mark-read). No-op nếu
 * chưa có hàng hoặc cờ vốn đã tắt → không tạo hàng thừa, không emit thừa.
 *
 * @returns true nếu vừa đổi (caller nên emit), false nếu không có gì để tắt.
 */
export async function clearManualUnreadOnRead(userId: string, conversationId: string): Promise<boolean> {
  const res = await prisma.conversationUserState.updateMany({
    where: { userId, conversationId, isManualUnread: true },
    data: { isManualUnread: false, manualUnreadAt: null },
  });
  return res.count > 0;
}

/**
 * Bắn state mới CHỈ tới room riêng của user → người khác trong org KHÔNG nhận (đúng ngữ
 * nghĩa per-user), và KHÔNG chạm luồng chat:message. FE nghe 'conversation:state' để
 * cập nhật badge/ghim in-place, không refetch.
 */
export function emitStateChange(io: Server | null | undefined, userId: string, dto: ConversationStateDto): void {
  if (!io) return;
  try {
    io.to(`user:${userId}`).emit('conversation:state', dto);
  } catch (err) {
    logger.error('[conv-state] emit lỗi:', err);
  }
}
