// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * group-info-refresh.ts — Core refresh thông tin 1 nhóm Zalo (dùng chung).
 *
 * Tách khỏi group-info-sync-cron để TÁI DÙNG cho 2 đường:
 *  1. Cron 6h (group-info-sync-cron) — lưới an toàn cho nhóm im lặng / nick offline.
 *  2. Tức thì (zalo-listener-factory, group_event 'update_avatar'/'update') — avatar
 *     đổi là refresh ngay, bỏ độ trễ ≤6h của cron.
 *
 * buildGroupUpdates: getGroupInfo + mirror avatar CDN→S3 (dedup content-hash) + diff,
 * trả updates (non-empty) hoặc null. Không tự ghi DB — caller áp + đếm/emit tuỳ ngữ cảnh.
 */
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { mirrorRemoteMediaUrl, isMirrorableUrl } from '../chat/message-handler.js';

/** Giá trị group hiện tại trong DB để diff. */
export interface GroupConvFields {
  groupName: string | null;
  groupAvatarUrl: string | null;
  groupMembersCount: number | null;
}
export type GroupUpdates = { groupName?: string; groupAvatarUrl?: string; groupMembersCount?: number };

/**
 * Gọi getGroupInfo → mirror avatar → diff vs `existing`. Trả updates (chỉ field ĐỔI)
 * hoặc null nếu không có gì đổi / SDK không trả info. KHÔNG ghi DB.
 */
export async function buildGroupUpdates(
  accountId: string,
  groupId: string,
  existing: GroupConvFields,
): Promise<GroupUpdates | null> {
  const raw: any = await zaloOps.getGroupInfo(accountId, groupId);
  // getGroupInfo → { gridInfoMap: { [groupId]: { name, avt, fullAvt, totalMember } } }
  const info = raw?.gridInfoMap?.[groupId] ?? Object.values(raw?.gridInfoMap || {})[0];
  if (!info) return null;

  const newName: string | undefined = info.name || undefined;
  // Mirror avatar Zalo CDN → S3 nội bộ (URL ổn định, không hết hạn). uploadBuffer dedup
  // content-hash → ảnh không đổi = cùng key = cùng URL → diff không ghi DB thừa. Mirror
  // lỗi → fallback URL CDN thô (vẫn tươi hơn URL cũ). Tái dùng mirror của chat (DRY).
  const rawAvatar: string | undefined = info.fullAvt || info.avt || undefined;
  let newAvatar = rawAvatar;
  if (isMirrorableUrl(rawAvatar)) {
    newAvatar = (await mirrorRemoteMediaUrl(rawAvatar, 'image').catch(() => null)) ?? rawAvatar;
  }
  const newCount: number | undefined =
    typeof info.totalMember === 'number' ? info.totalMember : undefined;

  // Diff + guard: KHÔNG ghi đè bằng rỗng/null (giữ giá trị cũ nếu SDK trả trống).
  const updates: GroupUpdates = {};
  if (newName && newName !== existing.groupName) updates.groupName = newName;
  if (newAvatar && newAvatar !== existing.groupAvatarUrl) updates.groupAvatarUrl = newAvatar;
  if (newCount != null && newCount !== existing.groupMembersCount) updates.groupMembersCount = newCount;

  return Object.keys(updates).length ? updates : null;
}

/**
 * Refresh TỨC THÌ 1 nhóm (gọi từ group_event 'update_avatar'/'update'). Fetch conversation,
 * build updates, ghi DB, emit socket cho client đang mở thấy avatar/tên mới ngay (không F5).
 * Trả true nếu có cập nhật. Mọi lỗi nuốt tại caller.
 */
export async function refreshGroupInfoNow(
  accountId: string,
  orgId: string,
  groupId: string,
  io: Server | null,
): Promise<boolean> {
  const conv = await withTenant(orgId, () =>
    prisma.conversation.findFirst({
      where: { zaloAccountId: accountId, externalThreadId: groupId, threadType: 'group' },
      select: { id: true, groupName: true, groupAvatarUrl: true, groupMembersCount: true },
    }),
  );
  if (!conv) return false; // nhóm chưa được track (chưa có hội thoại) → bỏ qua

  const updates = await buildGroupUpdates(accountId, groupId, conv);
  if (!updates) return false;

  await withTenant(orgId, () => prisma.conversation.update({ where: { id: conv.id }, data: updates }));
  // Push live: client đang mở patch conversation in-place (xem use-chat 'chat:group-info-updated').
  io?.to(`org:${orgId}`).emit('chat:group-info-updated', { conversationId: conv.id, ...updates });
  logger.info(`[group-info-refresh] Group ${groupId} (acc ${accountId}) refreshed: ${Object.keys(updates).join(',')}`);
  return true;
}
