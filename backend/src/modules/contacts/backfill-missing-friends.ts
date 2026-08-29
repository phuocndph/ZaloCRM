// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * backfill-missing-friends.ts — Tạo Friend row thiếu cho mọi Conversation.
 *
 * Use case: sau merge cũ (PR 2c trước đó) bị delete Friend duplicate khi 2 Friend
 * cùng (zaloAccountId, contactId) — vì unique constraint cũ. Conversation tồn tại
 * nhưng không còn Friend tương ứng → UI expand chỉ thấy 2 nick dù badge "Đa nick (3)".
 *
 * Đã drop unique([zaloAccountId, contactId]). Script này tạo Friend cho mỗi
 * Conversation user-thread không có Friend matching (zaloAccountId, zaloUidInNick).
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export interface MissingFriendBackfillResult {
  conversationsScanned: number;
  friendsCreated: number;
}

export async function backfillMissingFriends(): Promise<MissingFriendBackfillResult> {
  // Chỉ xét user thread (group conversations không có per-pair Friend semantic).
  const conversations = await prisma.conversation.findMany({
    where: { threadType: 'user', contactId: { not: null }, externalThreadId: { not: null } },
    select: {
      id: true, orgId: true, zaloAccountId: true, contactId: true, externalThreadId: true,
      lastMessageAt: true,
    },
  });

  const result: MissingFriendBackfillResult = { conversationsScanned: conversations.length, friendsCreated: 0 };

  for (const conv of conversations) {
    const exists = await prisma.friend.findFirst({
      where: { zaloAccountId: conv.zaloAccountId, zaloUidInNick: conv.externalThreadId! },
      select: { id: true },
    });
    if (exists) continue;

    const messageGroups = await prisma.message.groupBy({
      by: ['senderType'],
      where: { conversationId: conv.id, senderType: { in: ['contact', 'self'] } },
      _count: { _all: true },
      _min: { sentAt: true },
      _max: { sentAt: true },
    });
    const inbound = messageGroups.find((group) => group.senderType === 'contact');
    const outbound = messageGroups.find((group) => group.senderType === 'self');
    const firstMessageAt = messageGroups
      .map((group) => group._min.sentAt)
      .filter((value): value is Date => value instanceof Date)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? conv.lastMessageAt;
    const lastInteractionAt = messageGroups
      .map((group) => group._max.sentAt)
      .filter((value): value is Date => value instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? conv.lastMessageAt;

    // Resolve default status cho org
    const defaultStatus = await prisma.status.findFirst({
      where: { orgId: conv.orgId, isDefault: true },
      select: { id: true },
    });

    try {
      await prisma.friend.create({
        data: {
          orgId: conv.orgId,
          contactId: conv.contactId!,
          zaloAccountId: conv.zaloAccountId,
          zaloUidInNick: conv.externalThreadId!,
          hasConversation: true,
          // Conservative: chưa rõ relationshipKind, fallback 'chatting_stranger'
          relationshipKind: 'chatting_stranger',
          friendshipStatus: 'none',
          firstMessageAt,
          lastInboundAt: inbound?._max.sentAt ?? null,
          lastOutboundAt: outbound?._max.sentAt ?? null,
          lastInteractionAt,
          totalInbound: inbound?._count._all ?? 0,
          totalOutbound: outbound?._count._all ?? 0,
          statusId: defaultStatus?.id ?? null,
          leadScore: 0,
        },
      });
      result.friendsCreated++;
    } catch (err) {
      logger.warn(`[backfill-friends] create failed for conv ${conv.id}:`, err);
    }
  }

  logger.info(`[backfill-missing-friends] scanned=${result.conversationsScanned} created=${result.friendsCreated}`);
  return result;
}
