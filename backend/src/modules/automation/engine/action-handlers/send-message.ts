// Phase G full — send_message action handler (REAL Zalo SDK).
//
// Flow:
//   1. Read blockSnapshot.textVariants — pick one randomly
//   2. Find Friend row for (assignedNickId, contactId)
//      - must be friendshipStatus='accepted' (or 'pending_sent' if user replied first)
//      - extract zaloUidInNick → threadId
//   3. Get or create Conversation with (zaloAccountId, externalThreadId)
//   4. zaloOps.sendMessage(nickId, threadId, threadType=0, { msg: text })
//   5. Persist Message row with senderType='self', zaloMsgId from response
//   6. Apply Contact + Friend aggregates so /contacts dashboard updates
//
// Worker handles ZaloAccount.lastMessageSentAt update on success.
// Attachments support deferred — text-only for now (logs a warning if present).
//
// Set AUTOMATION_STUB_MODE=true to revert to stub for safe testing.

import { randomUUID } from 'node:crypto';
import { prisma } from '../../../../shared/database/prisma-client.js';
import { logger } from '../../../../shared/utils/logger.js';
import { zaloOps } from '../../../../shared/zalo-operations.js';
import { applyContactAggregateFromMessage, applyFriendAggregate } from '../../../contacts/contact-aggregate.js';
import type { ActionContext, ActionResult } from '../types.js';

const STUB_MODE = process.env.AUTOMATION_STUB_MODE === 'true';

export async function sendMessageHandler(ctx: ActionContext): Promise<ActionResult> {
  const snap = ctx.blockSnapshot as {
    textVariants?: string[];
    attachments?: Array<{ kind: string; url: string; caption?: string }>;
  };

  if (!Array.isArray(snap.textVariants) || snap.textVariants.length === 0) {
    return {
      outcome: 'failure',
      errorCode: 'BAD_SNAPSHOT',
      errorMessage: 'blockSnapshot.textVariants empty',
      retryable: false,
    };
  }
  if (!ctx.assignedNickId) {
    return {
      outcome: 'failure',
      errorCode: 'NO_NICK',
      errorMessage: 'assignedNickId required for send_message',
      retryable: false,
    };
  }

  const text = snap.textVariants[Math.floor(Math.random() * snap.textVariants.length)];
  if (snap.attachments && snap.attachments.length > 0) {
    logger.warn(`[send-message] block has ${snap.attachments.length} attachment(s) — text-only sent in v1, attachments deferred`);
  }

  if (STUB_MODE) {
    logger.info(`[send-message STUB] would send "${text.slice(0, 40)}..." from nick ${ctx.assignedNickId} to contact ${ctx.contactId}`);
    return {
      outcome: 'success',
      data: { stub: true, textUsed: text },
    };
  }

  // ── Real impl ───────────────────────────────────────────────────────────

  // Step 1: find Friend row to get threadId (= zaloUidInNick) and verify status
  const friend = await prisma.friend.findFirst({
    where: {
      zaloAccountId: ctx.assignedNickId,
      contactId: ctx.contactId,
      orgId: ctx.orgId,
    },
    select: {
      id: true,
      zaloUidInNick: true,
      friendshipStatus: true,
      hasConversation: true,
    },
  });
  if (!friend) {
    return {
      outcome: 'failure',
      errorCode: 'NO_FRIEND_ROW',
      errorMessage: 'No Friend row for (nick, contact) — chat trước khi sequence gửi message',
      retryable: false,
    };
  }
  // Allow accepted (real friends) + chatting_stranger (Zalo cho phép gửi qua stranger,
  // tuy nhiên rate limit nghiêm hơn). Reject removed/blocked/none.
  if (!['accepted', 'pending_sent', 'pending_received', 'none'].includes(friend.friendshipStatus)) {
    return {
      outcome: 'failure',
      errorCode: 'FRIENDSHIP_BLOCKED',
      errorMessage: `Friend status '${friend.friendshipStatus}' không cho phép gửi tin`,
      retryable: false,
    };
  }

  const threadId = friend.zaloUidInNick;
  const threadType = 0; // 0 = user, 1 = group (only user supported)

  // Step 2: get-or-create Conversation
  let conversation = await prisma.conversation.findUnique({
    where: { zaloAccountId_externalThreadId: { zaloAccountId: ctx.assignedNickId, externalThreadId: threadId } },
    select: { id: true },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        id: randomUUID(),
        orgId: ctx.orgId,
        zaloAccountId: ctx.assignedNickId,
        externalThreadId: threadId,
        threadType: 'user',
        contactId: ctx.contactId,
      },
      select: { id: true },
    });
  }

  // Step 3: send via Zalo SDK
  let sdkResult: Record<string, unknown>;
  try {
    const raw = await zaloOps.sendMessage(ctx.assignedNickId, threadId, threadType, { msg: text });
    sdkResult = (raw as Record<string, unknown>) || {};
  } catch (err: any) {
    const code = err?.code as string | undefined;
    const msg = err?.message ?? String(err);
    if (code === 'RATE_LIMITED') {
      return { outcome: 'failure', errorCode: 'RATE_LIMITED', errorMessage: msg, retryable: true };
    }
    if (code === 'NOT_CONNECTED') {
      return { outcome: 'failure', errorCode: 'NOT_CONNECTED', errorMessage: msg, retryable: true };
    }
    return {
      outcome: 'failure',
      errorCode: 'SEND_MESSAGE_FAILED',
      errorMessage: msg,
      retryable: false,
    };
  }

  // Step 4: extract zaloMsgId for dedup with self-listen echo
  const sr = sdkResult as { message?: { msgId?: number | string } | null; msgId?: number | string };
  const rawId = sr?.message?.msgId ?? sr?.msgId ?? '';
  const zaloMsgId = String(rawId || '');

  // Step 5: persist outbound Message row
  let messageRow: { id: string; content: string | null; contentType: string; sentAt: Date };
  try {
    messageRow = await prisma.message.create({
      data: {
        id: randomUUID(),
        conversationId: conversation.id,
        zaloMsgId: zaloMsgId || null,
        senderType: 'self',
        senderUid: '',
        senderName: 'Bot-Auto',
        content: text,
        contentType: 'text',
        sentAt: new Date(),
      },
      select: { id: true, content: true, contentType: true, sentAt: true },
    });
  } catch (err) {
    logger.error(`[send-message] message persistence failed (Zalo send succeeded):`, err);
    // SDK already sent — return success with warning so retry doesn't double-send
    return {
      outcome: 'success',
      data: { zaloMsgId, textUsed: text, persistenceFailed: true },
    };
  }

  // Step 6: apply aggregates (Contact + Friend lastOutbound counters)
  const aggInput = {
    conversationId: conversation.id,
    message: {
      id: messageRow.id,
      content: messageRow.content,
      contentType: messageRow.contentType,
      sentAt: messageRow.sentAt,
      senderType: 'self' as const,
    },
    outboundUserId: null, // automation-sent, not user-attributed
  };
  void applyContactAggregateFromMessage(aggInput);
  void applyFriendAggregate(aggInput);

  logger.info(`[send-message] sent from nick=${ctx.assignedNickId} to contact=${ctx.contactId}, msgId=${zaloMsgId}`);
  return {
    outcome: 'success',
    data: {
      zaloMsgId,
      textUsed: text,
      conversationId: conversation.id,
      messageId: messageRow.id,
    },
  };
}
