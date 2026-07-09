// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
// ════════════════════════════════════════════════════════════════════════════
// Outreach — Điều kiện gửi (Campaign Audience Filter).
//
// 1 nguồn sự thật cho việc "khách này có ĐỦ ĐIỀU KIỆN nhận chiến dịch không".
// Dùng chung cho: (1) preview trên UI (đếm + danh sách), (2) lúc chạy để seed
// hàng đợi (chỉ khách đủ điều kiện vào queue; khách bị bỏ ghi rõ lý do).
//
// Thứ tự đánh giá (đúng spec):
//   1. Chỉ gửi cho KH có Tag  → không khớp thì BỎ.
//   2. Không gửi cho KH có Tag → khớp thì BỎ.
//   3. Không gửi nếu đã chat trong N ngày → chat gần đây thì BỎ.
//   4. Quan hệ bạn bè → không khớp thì BỎ.
//   Qua hết → ĐỦ ĐIỀU KIỆN.
//
// Rỗng/'any' ở mọi filter = KHÔNG lọc → hành vi y như trước (tương thích ngược).
// ════════════════════════════════════════════════════════════════════════════

import { prisma } from '../../shared/database/prisma-client.js';

export type FriendRelation = 'any' | 'friend_only' | 'non_friend_only';

export interface AudienceFilter {
  requireTags: string[];      // gửi nếu có ÍT NHẤT 1 tag
  excludeTags: string[];      // bỏ nếu có BẤT KỲ tag
  skipChattedDays: number | null; // bỏ nếu đã chat trong N ngày
  friendRelation: FriendRelation;
}

export interface EvaluatedEntry {
  id: string;                 // CustomerListEntry.id
  contactId: string | null;
  phone: string;
  name: string | null;
  tags: string[];
  isFriend: boolean;
  lastChatAt: number | null;  // epoch ms, null = chưa chat
  eligible: boolean;
  reason: string | null;      // lý do bỏ qua (null nếu đủ điều kiện)
}

/** Chuẩn hoá filter từ record campaign (hoặc body preview). */
export function filterFromCampaign(c: {
  filterRequireTags?: string[] | null;
  filterExcludeTags?: string[] | null;
  filterSkipChattedDays?: number | null;
  filterFriendRelation?: string | null;
}): AudienceFilter {
  const rel = (c.filterFriendRelation ?? 'any') as FriendRelation;
  return {
    requireTags: Array.isArray(c.filterRequireTags) ? c.filterRequireTags.filter(Boolean) : [],
    excludeTags: Array.isArray(c.filterExcludeTags) ? c.filterExcludeTags.filter(Boolean) : [],
    skipChattedDays: c.filterSkipChattedDays != null && c.filterSkipChattedDays > 0 ? c.filterSkipChattedDays : null,
    friendRelation: rel === 'friend_only' || rel === 'non_friend_only' ? rel : 'any',
  };
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  return [];
}

/**
 * Đánh giá TOÀN BỘ entries của 1 tệp theo filter. Trả về mảng có đủ thông tin để
 * vừa đếm (eligible/skipped) vừa render danh sách preview vừa seed hàng đợi.
 * KHÔNG sắp xếp — caller tự sắp theo nhu cầu (vd chat cũ nhất trước khi seed).
 */
export async function evaluateAudience(
  orgId: string,
  customerListId: string,
  zaloAccountId: string,
  filter: AudienceFilter,
): Promise<EvaluatedEntry[]> {
  const entries = await prisma.customerListEntry.findMany({
    where: { customerListId },
    select: { id: true, contactId: true, phoneLocal: true, phoneE164: true, phoneRaw: true, nameRaw: true, zaloName: true },
  });
  const contactIds = entries.map((e) => e.contactId).filter((x): x is string => !!x);

  // Tags + thời gian chat của từng Contact.
  const contacts = contactIds.length
    ? await prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, tags: true, lastInteractionAt: true } })
    : [];
  const contactMap = new Map(contacts.map((c) => [c.id, c]));

  // Quan hệ bạn bè theo NICK gửi (Friend keyed by contactId × zaloAccountId).
  const friendRows = contactIds.length
    ? await prisma.friend.findMany({
        where: { zaloAccountId, contactId: { in: contactIds } },
        select: { contactId: true, friendshipStatus: true },
      })
    : [];
  const friendSet = new Set(friendRows.filter((f) => f.friendshipStatus === 'accepted').map((f) => f.contactId));

  const requireSet = new Set(filter.requireTags);
  const excludeSet = new Set(filter.excludeTags);
  const now = Date.now();
  const skipMs = filter.skipChattedDays ? filter.skipChattedDays * 86400000 : null;

  return entries.map((e) => {
    const contact = e.contactId ? contactMap.get(e.contactId) : undefined;
    const tags = parseTags(contact?.tags);
    const isFriend = e.contactId ? friendSet.has(e.contactId) : false;
    const lastChatAt = contact?.lastInteractionAt ? contact.lastInteractionAt.getTime() : null;
    const phone = e.phoneLocal || e.phoneE164 || e.phoneRaw || '';
    const name = e.zaloName || e.nameRaw || null;

    let reason: string | null = null;

    // 1. Chỉ gửi cho KH có Tag — cần giao ÍT NHẤT 1 tag.
    if (!reason && requireSet.size > 0) {
      const hasAny = tags.some((t) => requireSet.has(t));
      if (!hasAny) reason = 'Không có Tag yêu cầu';
    }
    // 2. Không gửi cho KH có Tag — có BẤT KỲ tag loại trừ.
    if (!reason && excludeSet.size > 0) {
      const hit = tags.find((t) => excludeSet.has(t));
      if (hit) reason = `Có Tag "${hit}"`;
    }
    // 3. Không gửi nếu đã chat trong N ngày.
    if (!reason && skipMs != null && lastChatAt != null) {
      if (now - lastChatAt <= skipMs) reason = `Đã chat trong ${filter.skipChattedDays} ngày`;
    }
    // 4. Quan hệ bạn bè.
    if (!reason && filter.friendRelation === 'friend_only' && !isFriend) reason = 'Chưa là bạn';
    if (!reason && filter.friendRelation === 'non_friend_only' && isFriend) reason = 'Đã là bạn';

    return { id: e.id, contactId: e.contactId ?? null, phone, name, tags, isFriend, lastChatAt, eligible: reason === null, reason };
  });
}

/** Sắp ĐỦ ĐIỀU KIỆN theo thứ tự xử lý: chat cũ nhất trước → mới hơn; CHƯA chat (null) cuối. */
export function orderEligibleByChat(list: EvaluatedEntry[]): EvaluatedEntry[] {
  return [...list].sort((a, b) => {
    if (a.lastChatAt === null && b.lastChatAt === null) return 0;
    if (a.lastChatAt === null) return 1;
    if (b.lastChatAt === null) return -1;
    return a.lastChatAt - b.lastChatAt;
  });
}
