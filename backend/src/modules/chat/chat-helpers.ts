// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Chat helpers — shared utilities cho 11 writer site của Message.
 *
 * 2026-06-03 — Anh báo bug optimistic "Sale CRM · Staff":
 * Khi sale gõ tin trên CRM, BE insert Message rồi socket emit. Trước fix
 * Message thiếu metadata.sender.name + repliedBy relation → FE render
 * badge "Sale CRM · Staff" (fallback hardcoded). Sau reload mới đúng.
 *
 * Fix: 11 writer site (chat-routes + chat-operations + chat-attachment)
 * dùng helper này để build sender metadata + lookup userFullName 1 lần
 * per request.
 */

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';

const userNameCache = new Map<string, { name: string; ts: number }>();
const CACHE_TTL_MS = 5 * 60_000; // 5 phút

/**
 * Lookup User.fullName với cache 5 phút. Giảm 1 DB roundtrip mỗi tin gửi
 * (sale gõ liên tục → cùng userId → cache hit).
 */
export async function getUserFullName(userId: string): Promise<string> {
  const cached = userNameCache.get(userId);
  const now = Date.now();
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.name;

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true, email: true },
  });
  const name = u?.fullName?.trim() || u?.email?.split('@')[0] || 'Sale';
  userNameCache.set(userId, { name, ts: now });
  return name;
}

/**
 * Build M11 metadata.sender cho tin sale gõ qua CRM.
 * Đảm bảo FE MessageSourceBadge render badge "Sale CRM · {tên}" ngay
 * optimistic, không đợi reload.
 */
export function buildSaleCrmSenderMeta(userFullName: string) {
  return {
    sender: { kind: 'user_crm' as const, name: userFullName },
  };
}

/**
 * createMediaMessage — Phase Media Library 2026-06-11 (eng review E4 / DRY).
 *
 * Gộp 4 block prisma.message.create LẶP trong chat-attachment-routes
 * (image batch / video-success / video-fallback / file) thành 1 helper.
 * Trước: 4 chỗ copy cùng base (id/zaloMsgId/senderType/senderUid/...) chỉ khác
 * content+contentType → sửa privacy/field 1 chỗ phải nhớ 4 chỗ. Giờ 1 nguồn.
 *
 * Caller chỉ truyền phần KHÁC NHAU: contentType + content (đã JSON.stringify)
 * + tùy chọn sentVia/metadata. Phần chung (sender self, senderName Staff,
 * sentAt, repliedByUserId) helper tự điền.
 */
export interface CreateMediaMessageInput {
  conversationId: string;
  zaloAccount: { zaloUid: string | null };
  repliedByUserId: string;
  zaloMsgId: string; // '' nếu chưa có
  contentType: 'image' | 'video' | 'file';
  content: string; // đã JSON.stringify
  /** M11 sender metadata (badge "Sale CRM · {tên}"). image/video truyền; file legacy có thể bỏ. */
  metadata?: Record<string, unknown>;
  /** 'user' cho image/video (đường gửi mới). file legacy để mặc định (undefined). */
  sentVia?: string;
  /** Stable per-file key used to make attachment retries idempotent. */
  clientEchoId?: string | null;
  /** Refresh the attempt timestamp when an existing outbox row is retried. */
  sentAt?: Date;
  /** One request owns the external-send lease for every file in its batch. */
  deliveryLeaseId?: string;
}

export type OutboundDeliveryState =
  | 'prepared'
  | 'submitting'
  | 'uncertain'
  | 'accepted'
  | 'completed'
  | 'failed';

export type MediaOutboxAcquireResult = {
  state: 'acquired' | 'accepted' | 'in_progress' | 'uncertain';
  message: any;
  leaseId: string | null;
};

export interface CreateTextOutboxInput {
  conversationId: string;
  zaloAccount: { zaloUid: string | null };
  repliedByUserId: string;
  content: string;
  contentType: 'text' | 'rich';
  metadata: Record<string, unknown>;
  sentVia: string;
  clientEchoId: string;
  quote?: Prisma.InputJsonValue;
  deliveryLeaseId?: string;
}

export const OUTBOUND_DELIVERY_LEASE_MS = 10 * 60_000;

type OutboundOutboxInput = {
  conversationId: string;
  zaloAccount: { zaloUid: string | null };
  repliedByUserId: string;
  content: string;
  contentType: string;
  metadata?: Record<string, unknown>;
  sentVia?: string;
  clientEchoId: string;
  quote?: Prisma.InputJsonValue;
  sentAt?: Date;
  deliveryLeaseId?: string;
};

function mediaOutboxStatus(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const outbound = (metadata as { outboundAttachment?: unknown }).outboundAttachment;
  if (!outbound || typeof outbound !== 'object' || Array.isArray(outbound)) return null;
  const status = (outbound as { status?: unknown }).status;
  return typeof status === 'string' ? status : null;
}

export function outboundDeliveryState(message: {
  deliveryState?: string | null;
  metadata?: unknown;
  zaloMsgId?: string | null;
}): OutboundDeliveryState | null {
  if (message.zaloMsgId) return 'accepted';
  const state = message.deliveryState;
  if (state === 'prepared' || state === 'submitting' || state === 'uncertain'
    || state === 'accepted' || state === 'completed' || state === 'failed') {
    return state;
  }
  const legacy = mediaOutboxStatus(message.metadata);
  if (legacy === 'zalo_accepted' || legacy === 'listener_confirmed' || legacy === 'accepted_pending_mirror') return 'accepted';
  if (legacy === 'mirrored') return 'completed';
  if (legacy === 'failed') return 'failed';
  if (legacy === 'submitting' || legacy === 'sending') return 'submitting';
  if (legacy === 'uncertain') return 'uncertain';
  return null;
}

function isAcceptedDeliveryState(state: OutboundDeliveryState | null): boolean {
  return state === 'accepted' || state === 'completed';
}

function activeLease(message: { deliveryLeaseUntil?: Date | string | null }, now = Date.now()): boolean {
  if (!message.deliveryLeaseUntil) return false;
  const until = new Date(message.deliveryLeaseUntil).getTime();
  return Number.isFinite(until) && until > now;
}

async function acquireOutboundOutbox(input: OutboundOutboxInput): Promise<MediaOutboxAcquireResult> {
  const sentAt = input.sentAt ?? new Date();
  const leaseId = input.deliveryLeaseId ?? randomUUID();
  const leaseUntil = new Date(Date.now() + OUTBOUND_DELIVERY_LEASE_MS);
  const createData = {
    id: randomUUID(),
    conversationId: input.conversationId,
    zaloMsgId: null,
    zaloMsgIdNum: null,
    senderType: 'self',
    senderUid: input.zaloAccount.zaloUid || '',
    senderName: 'Staff',
    sentVia: input.sentVia,
    metadata: input.metadata,
    content: input.content,
    contentType: input.contentType,
    quote: input.quote,
    sentAt,
    repliedByUserId: input.repliedByUserId,
    clientEchoId: input.clientEchoId,
    deliveryState: 'submitting',
    deliveryLeaseId: leaseId,
    deliveryLeaseUntil: leaseUntil,
  };

  try {
    const message = await prisma.message.create({ data: createData });
    return { state: 'acquired', message, leaseId };
  } catch (error) {
    if ((error as { code?: string })?.code !== 'P2002') throw error;
  }

  const uniqueWhere = {
    conversationId_clientEchoId: {
      conversationId: input.conversationId,
      clientEchoId: input.clientEchoId,
    },
  };
  let existing = await prisma.message.findUnique({ where: uniqueWhere });
  if (!existing) throw new Error('Outbound outbox identity conflict');

  let state = outboundDeliveryState(existing);
  if (isAcceptedDeliveryState(state)) return { state: 'accepted', message: existing, leaseId: null };
  if (state === 'uncertain') return { state: 'uncertain', message: existing, leaseId: null };
  if (state === 'prepared' || state === 'submitting') {
    if (activeLease(existing)) return { state: 'in_progress', message: existing, leaseId: null };
    // An expired external-send lease is ambiguous: the process may have died
    // after Zalo accepted the payload. Never reclaim it automatically.
    await prisma.message.updateMany({
      where: {
        id: existing.id,
        deliveryState: existing.deliveryState,
        deliveryLeaseId: existing.deliveryLeaseId,
        deliveryLeaseUntil: existing.deliveryLeaseUntil,
      },
      data: {
        deliveryState: 'uncertain',
        deliveryLeaseId: null,
        deliveryLeaseUntil: null,
        metadata: {
          ...(existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
            ? existing.metadata as Record<string, unknown>
            : {}),
          sendStatus: 'sending',
        },
      },
    });
    existing = await prisma.message.findUnique({ where: uniqueWhere }) ?? existing;
    return { state: 'uncertain', message: existing, leaseId: null };
  }

  // Only a deterministic failure may reuse the same echo id. The CAS prevents
  // two explicit retries from acquiring it together.
  const claimed = await prisma.message.updateMany({
    where: {
      id: existing.id,
      zaloMsgId: null,
      deliveryState: existing.deliveryState,
      deliveryLeaseId: existing.deliveryLeaseId,
      deliveryLeaseUntil: existing.deliveryLeaseUntil,
    },
    data: {
      senderType: 'self',
      senderUid: input.zaloAccount.zaloUid || '',
      senderName: 'Staff',
      sentVia: input.sentVia,
      metadata: input.metadata,
      content: input.content,
      contentType: input.contentType,
      quote: input.quote,
      repliedByUserId: input.repliedByUserId,
      deliveryState: 'submitting',
      deliveryLeaseId: leaseId,
      deliveryLeaseUntil: leaseUntil,
    },
  });
  existing = await prisma.message.findUnique({ where: uniqueWhere }) ?? existing;
  return claimed.count > 0
    ? { state: 'acquired', message: existing, leaseId }
    : { state: 'in_progress', message: existing, leaseId: null };
}

/** Atomically acquire one client echo id before performing the external send. */
export async function acquireMediaOutbox(input: CreateMediaMessageInput): Promise<MediaOutboxAcquireResult> {
  if (!input.clientEchoId) {
    throw new Error('Attachment outbox requires a client echo id');
  }
  return acquireOutboundOutbox(input as OutboundOutboxInput);
}

export async function acquireTextOutbox(input: CreateTextOutboxInput): Promise<MediaOutboxAcquireResult> {
  return acquireOutboundOutbox(input);
}

export async function finalizeTextOutbox(input: {
  conversationId: string;
  outboxMessageId: string;
  zaloMsgId: string;
  data: Prisma.MessageUncheckedUpdateInput;
}) {
  const include = { repliedBy: { select: { id: true, fullName: true, email: true } } } as const;
  try {
    return await prisma.message.update({
      where: { id: input.outboxMessageId },
      data: input.data,
      include,
    });
  } catch (error) {
    // The self-listener can persist the Zalo row between sendMessage() and this
    // update. Merge the durable placeholder into that row instead of returning
    // a false 500 or leaving two bubbles in the conversation.
    if ((error as { code?: string })?.code !== 'P2002' || !input.zaloMsgId) throw error;
    const listenerRow = await prisma.message.findFirst({
      where: { conversationId: input.conversationId, zaloMsgId: input.zaloMsgId },
      select: { id: true },
    });
    if (!listenerRow || listenerRow.id === input.outboxMessageId) throw error;
    return prisma.$transaction(async (tx) => {
      await tx.message.delete({ where: { id: input.outboxMessageId } });
      return tx.message.update({
        where: { id: listenerRow.id },
        data: input.data,
        include,
      });
    });
  }
}

export async function renewOutboundDeliveryLease(messageIds: string[], leaseId: string): Promise<void> {
  if (messageIds.length === 0) return;
  await prisma.message.updateMany({
    where: {
      id: { in: messageIds },
      deliveryState: 'submitting',
      deliveryLeaseId: leaseId,
    },
    data: { deliveryLeaseUntil: new Date(Date.now() + OUTBOUND_DELIVERY_LEASE_MS) },
  });
}

export async function createMediaMessage(input: CreateMediaMessageInput) {
  const { zaloMsgId } = input;
  const metadataStatus = mediaOutboxStatus(input.metadata);
  const deliveryState: OutboundDeliveryState = metadataStatus === 'failed'
    ? 'failed'
    : metadataStatus === 'uncertain'
      ? 'uncertain'
      : metadataStatus === 'mirrored'
        ? 'completed'
        : zaloMsgId || metadataStatus === 'zalo_accepted' || metadataStatus === 'listener_confirmed'
          ? 'accepted'
          : 'submitting';

  const build = (msgId: string | null) => ({
    id: randomUUID(),
    conversationId: input.conversationId,
    zaloMsgId: msgId,
    zaloMsgIdNum: msgId && /^\d+$/.test(msgId) ? BigInt(msgId) : null,
    senderType: 'self',
    senderUid: input.zaloAccount.zaloUid || '',
    senderName: 'Staff',
    sentVia: input.sentVia,
    metadata: input.metadata,
    content: input.content,
    contentType: input.contentType,
    sentAt: input.sentAt ?? new Date(),
    repliedByUserId: input.repliedByUserId,
    clientEchoId: input.clientEchoId ?? null,
    deliveryState,
    deliveryLeaseId: null,
    deliveryLeaseUntil: null,
  });

  const updateData = {
    ...(zaloMsgId
      ? {
          zaloMsgId,
          zaloMsgIdNum: /^\d+$/.test(zaloMsgId) ? BigInt(zaloMsgId) : null,
        }
      : {}),
    senderType: 'self',
    senderUid: input.zaloAccount.zaloUid || '',
    senderName: 'Staff',
    sentVia: input.sentVia,
    metadata: input.metadata,
    content: input.content,
    contentType: input.contentType,
    repliedByUserId: input.repliedByUserId,
    clientEchoId: input.clientEchoId ?? null,
    deliveryState,
    deliveryLeaseId: null,
    deliveryLeaseUntil: null,
    ...(input.sentAt ? { sentAt: input.sentAt } : {}),
  };

  // A delivery receipt or listener echo may already have created/claimed this
  // row. Finalize the durable placeholder instead of inserting a second row.
  if (input.clientEchoId) {
    const byEcho = await prisma.message.findUnique({
      where: {
        conversationId_clientEchoId: {
          conversationId: input.conversationId,
          clientEchoId: input.clientEchoId,
        },
      },
    });
    if (byEcho) {
      try {
        return await prisma.message.update({ where: { id: byEcho.id }, data: updateData });
      } catch (err) {
        if ((err as { code?: string })?.code !== 'P2002' || !zaloMsgId) throw err;
        const byZaloId = await prisma.message.findFirst({
          where: { conversationId: input.conversationId, zaloMsgId },
        });
        if (!byZaloId || byZaloId.id === byEcho.id) throw err;
        return prisma.$transaction(async (tx) => {
          await tx.message.delete({ where: { id: byEcho.id } });
          return tx.message.update({ where: { id: byZaloId.id }, data: updateData });
        });
      }
    }
  }

  try {
    return await prisma.message.create({ data: build(zaloMsgId || null) });
  } catch (err) {
    // UNIQUE(conversation_id, zalo_msg_id) đụng độ = tin với msgId này ĐÃ TỒN TẠI — thường do
    // echo từ Zalo listener về trước khi ta kịp create. KHÔNG tạo tin thứ 2 (sẽ hiện ảnh 2 lần):
    // cập nhật tin sẵn có bằng content mirror của ta (URL /files bền hơn CDN Zalo) rồi trả về.
    if ((err as { code?: string })?.code === 'P2002' && zaloMsgId) {
      const existing = await prisma.message.findFirst({
        where: { conversationId: input.conversationId, zaloMsgId },
      });
      if (existing) {
        return await prisma.message.update({
          where: { id: existing.id },
          data: {
            senderType: 'self',
            content: input.content,
            contentType: input.contentType,
            sentVia: input.sentVia,
            metadata: input.metadata,
            repliedByUserId: input.repliedByUserId,
            clientEchoId: input.clientEchoId ?? existing.clientEchoId,
            deliveryState,
            deliveryLeaseId: null,
            deliveryLeaseUntil: null,
          },
        });
      }
    }
    throw err;
  }
}
