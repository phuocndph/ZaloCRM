/**
 * friend-event-handler.ts — persists zca-js `friend_event` to the Friend table.
 *
 * Maps zca-js FriendEventType into our state machine:
 *   ADD             → friendshipStatus='accepted', relationshipKind='friend'
 *   REMOVE          → friendshipStatus='removed',  relationshipKind='ghost'
 *   REQUEST         → friendshipStatus='pending_received' (someone sent ME a request)
 *   REJECT_REQUEST  → friendshipStatus='rejected', relationshipKind='ghost'
 *   UNDO_REQUEST    → friendshipStatus='none' (request retracted, Friend row stays)
 *   BLOCK / BLOCK_CALL   → friendshipStatus='blocked'
 *   UNBLOCK / UNBLOCK_CALL → revert to prior state if known, else 'none'
 *   SEEN_FRIEND_REQUEST, PIN_*, UNKNOWN — ignored
 *
 * Updates Contact.{accepted,pending,chatting}NicksCount on every transition.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { randomUUID } from 'node:crypto';

// zca-js FriendEventType numeric values (mirrored from models/FriendEvent.d.ts)
export const FriendEventType = {
  ADD: 0,
  REMOVE: 1,
  REQUEST: 2,
  UNDO_REQUEST: 3,
  REJECT_REQUEST: 4,
  SEEN_FRIEND_REQUEST: 5,
  BLOCK: 6,
  UNBLOCK: 7,
  BLOCK_CALL: 8,
  UNBLOCK_CALL: 9,
  PIN_UNPIN: 10,
  PIN_CREATE: 11,
  UNKNOWN: 12,
} as const;

type RelationshipKind = 'friend' | 'pending_friend' | 'chatting_stranger' | 'ghost' | 'none';

/**
 * Counter delta for a Contact when a Friend row's relationshipKind transitions.
 * Returns increments to apply to (acceptedNicksCount, pendingNicksCount, chattingNicksCount).
 */
export function counterDelta(from: RelationshipKind, to: RelationshipKind): {
  accepted: number;
  pending: number;
  chatting: number;
} {
  const sub = (k: RelationshipKind) => ({
    accepted: k === 'friend' ? 1 : 0,
    pending: k === 'pending_friend' ? 1 : 0,
    chatting: k === 'chatting_stranger' ? 1 : 0,
  });
  const a = sub(to);
  const b = sub(from);
  return {
    accepted: a.accepted - b.accepted,
    pending: a.pending - b.pending,
    chatting: a.chatting - b.chatting,
  };
}

/** Derive relationshipKind from friendshipStatus + hasConversation. */
export function deriveRelationshipKind(
  friendshipStatus: string,
  hasConversation: boolean,
): RelationshipKind {
  if (friendshipStatus === 'accepted') return 'friend';
  if (friendshipStatus === 'pending_sent' || friendshipStatus === 'pending_received') return 'pending_friend';
  if (friendshipStatus === 'rejected' || friendshipStatus === 'removed' || friendshipStatus === 'blocked') return 'ghost';
  if (hasConversation) return 'chatting_stranger';
  return 'none';
}

interface ContactRef {
  id: string;
  orgId: string;
}

/**
 * Resolve (or create) the Contact row matching a Zalo uid in a given nick.
 * Tries Friend.zaloUidInNick first, then Contact.zaloUid global, then creates a stub.
 */
async function resolveContact(
  zaloAccountId: string,
  uid: string,
  orgId: string,
  fallbackName?: string | null,
): Promise<ContactRef | null> {
  if (!uid) return null;

  const existingFriend = await prisma.friend.findFirst({
    where: { zaloAccountId, zaloUidInNick: uid },
    select: { contactId: true, contact: { select: { orgId: true } } },
  });
  if (existingFriend) return { id: existingFriend.contactId, orgId: existingFriend.contact.orgId };

  const byGlobalUid = await prisma.contact.findFirst({
    where: { orgId, zaloUid: uid },
    select: { id: true, orgId: true },
  });
  if (byGlobalUid) return byGlobalUid;

  // Fresh — create stub Contact (no phone yet; will be filled from message events later)
  const created = await prisma.contact.create({
    data: {
      id: randomUUID(),
      orgId,
      zaloUid: uid,
      fullName: fallbackName || 'Unknown',
    },
    select: { id: true, orgId: true },
  });
  return created;
}

/**
 * Apply a state transition to the Friend row for (zaloAccountId, contactId, uid):
 *   - upsert Friend with the new friendshipStatus + computed relationshipKind
 *   - update Contact counters by delta
 *   - update FriendshipAttempt status if a row exists
 *
 * All in a single transaction to keep counters consistent.
 */
export async function applyFriendTransition(args: {
  orgId: string;
  zaloAccountId: string;
  contactId: string;
  zaloUidInNick: string;
  newFriendshipStatus: string;
  attemptStateOnAccept?: string; // 'accepted' | 'rejected' | 'cancelled' | 'expired'
}): Promise<void> {
  const { orgId, zaloAccountId, contactId, zaloUidInNick, newFriendshipStatus } = args;

  await prisma.$transaction(async (tx) => {
    const existing = await tx.friend.findUnique({
      where: { zaloAccountId_contactId: { zaloAccountId, contactId } },
      select: { relationshipKind: true, hasConversation: true },
    });

    const fromKind = (existing?.relationshipKind as RelationshipKind) ?? 'none';
    const hasConversation = existing?.hasConversation ?? false;
    const toKind = deriveRelationshipKind(newFriendshipStatus, hasConversation);

    const now = new Date();
    const data: any = {
      friendshipStatus: newFriendshipStatus,
      relationshipKind: toKind,
    };
    if (newFriendshipStatus === 'accepted') data.becameFriendAt = now;
    if (newFriendshipStatus === 'removed' || newFriendshipStatus === 'blocked') data.removedAt = now;

    await tx.friend.upsert({
      where: { zaloAccountId_contactId: { zaloAccountId, contactId } },
      create: {
        id: randomUUID(),
        orgId,
        contactId,
        zaloAccountId,
        zaloUidInNick,
        ...data,
      },
      update: data,
    });

    // Counter delta on Contact
    const delta = counterDelta(fromKind, toKind);
    if (delta.accepted !== 0 || delta.pending !== 0 || delta.chatting !== 0) {
      await tx.contact.update({
        where: { id: contactId },
        data: {
          acceptedNicksCount: { increment: delta.accepted },
          pendingNicksCount: { increment: delta.pending },
          chattingNicksCount: { increment: delta.chatting },
        },
      });
    }

    // First-accepted-wins: claim assignedUserId on Contact for the nick's owner
    if (newFriendshipStatus === 'accepted') {
      const nick = await tx.zaloAccount.findUnique({
        where: { id: zaloAccountId },
        select: { ownerUserId: true },
      });
      if (nick) {
        await tx.contact.updateMany({
          where: { id: contactId, assignedUserId: null },
          data: { assignedUserId: nick.ownerUserId },
        });
      }
    }

    // Update audit row in FriendshipAttempt if present
    if (args.attemptStateOnAccept) {
      await tx.friendshipAttempt.updateMany({
        where: { zaloAccountId, contactId },
        data: { state: args.attemptStateOnAccept, decidedAt: now },
      });
    }
  });
}

/**
 * Mark Friend(pending_sent) right after a successful sendFriendRequest call.
 * Resolves the contact (creates stub if not found). Idempotent.
 *
 * Callers:
 *   - campaign-service.ts (random outreach flow)
 *   - friend-routes.ts POST /requests (manual UI)
 */
export async function markFriendRequestSent(
  accountId: string,
  uid: string,
  contactIdOverride?: string,
): Promise<void> {
  const account = await prisma.zaloAccount.findUnique({
    where: { id: accountId },
    select: { orgId: true },
  });
  if (!account) return;

  let contact: ContactRef | null;
  if (contactIdOverride) {
    contact = { id: contactIdOverride, orgId: account.orgId };
  } else {
    contact = await resolveContact(accountId, uid, account.orgId);
  }
  if (!contact) return;

  await applyFriendTransition({
    orgId: contact.orgId,
    zaloAccountId: accountId,
    contactId: contact.id,
    zaloUidInNick: uid,
    newFriendshipStatus: 'pending_sent',
  });
}

/**
 * Top-level entry called from zalo-listener-factory on every `friend_event`.
 * Decides what to persist based on event type + isSelf.
 */
export async function handleFriendEvent(
  accountId: string,
  event: { type: number; data: any; threadId: string; isSelf: boolean },
): Promise<void> {
  const account = await prisma.zaloAccount.findUnique({
    where: { id: accountId },
    select: { orgId: true },
  });
  if (!account) {
    logger.warn(`[friend-event] account not found: ${accountId}`);
    return;
  }
  const orgId = account.orgId;

  // Determine the friend's uid and (optionally) the request payload.
  // For ADD/REMOVE/BLOCK/UNBLOCK: data is a string (the uid). threadId also = uid.
  // For REQUEST/REJECT_REQUEST/UNDO_REQUEST: data is { fromUid, toUid, ... }.
  let friendUid: string | null = null;
  if (typeof event.data === 'string') {
    friendUid = event.data || event.threadId || null;
  } else if (event.data && typeof event.data === 'object') {
    friendUid = event.isSelf ? event.data.toUid : event.data.fromUid;
    if (!friendUid) friendUid = event.threadId;
  } else {
    friendUid = event.threadId || null;
  }
  if (!friendUid) {
    logger.debug(`[friend-event:${accountId}] type=${event.type}: missing uid, skipping`);
    return;
  }

  const contact = await resolveContact(accountId, friendUid, orgId);
  if (!contact) return;

  let newStatus: string | null = null;
  let attemptUpdate: string | undefined;

  switch (event.type) {
    case FriendEventType.ADD:
      newStatus = 'accepted';
      attemptUpdate = 'accepted';
      break;
    case FriendEventType.REMOVE:
      newStatus = 'removed';
      break;
    case FriendEventType.REQUEST:
      // KH gửi request đến mình. Don't auto-create accepted. Mark pending_received.
      if (!event.isSelf) newStatus = 'pending_received';
      break;
    case FriendEventType.REJECT_REQUEST:
      // KH từ chối request mình gửi
      newStatus = 'rejected';
      attemptUpdate = 'rejected';
      break;
    case FriendEventType.UNDO_REQUEST:
      // Either side withdrew the pending request. Reset to none.
      newStatus = 'none';
      attemptUpdate = 'cancelled';
      break;
    case FriendEventType.BLOCK:
    case FriendEventType.BLOCK_CALL:
      newStatus = 'blocked';
      break;
    case FriendEventType.UNBLOCK:
    case FriendEventType.UNBLOCK_CALL:
      newStatus = 'none';
      break;
    case FriendEventType.SEEN_FRIEND_REQUEST:
    case FriendEventType.PIN_CREATE:
    case FriendEventType.PIN_UNPIN:
    case FriendEventType.UNKNOWN:
    default:
      return; // ignore
  }

  if (!newStatus) return;

  try {
    await applyFriendTransition({
      orgId,
      zaloAccountId: accountId,
      contactId: contact.id,
      zaloUidInNick: friendUid,
      newFriendshipStatus: newStatus,
      attemptStateOnAccept: attemptUpdate,
    });
    logger.info(
      `[friend-event:${accountId}] type=${event.type} uid=${friendUid} → ${newStatus}`,
    );
  } catch (err) {
    logger.error(`[friend-event:${accountId}] apply error:`, err);
  }
}
