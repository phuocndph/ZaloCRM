/**
 * redact.ts — Phase Riêng Tư 2026-05-22
 *
 * Server-side redaction helpers. Áp dụng cho mọi endpoint trả KH content/PII
 * khi viewer KHÔNG own nick main + chưa unlock PIN.
 *
 * Anh chốt Q4: avatar KH blur CHỈ ở conv nick main (conv sub vẫn hiện đầy đủ).
 * Anh chốt Q6: nick name/avatar (sale) KHÔNG blur.
 * Anh chốt: metadata (count, score, KPI aggregate) KHÔNG blur, chỉ content.
 */
import { prisma } from '../../shared/database/prisma-client.js';

const BLUR_TOKEN = '▒'.repeat(8);

export interface PrivacyContext {
  /** Current user (viewer) — null = anonymous (shouldn't happen post-auth) */
  viewerUserId: string | null;
  /** Org của viewer — REQUIRED cho cross-tenant safety (codex review P2 #5) */
  orgId: string | null;
  /** True nếu viewer đã unlock PIN trong session hiện tại */
  privacyUnlocked: boolean;
}

/**
 * Decide: viewer có quyền xem content của 1 conv không?
 * - Sub-nick conv → always show.
 * - Main-nick conv → only owner + unlocked.
 */
export function canSeeConversationContent(
  conv: { zaloAccount: { privacyMode: string; ownerUserId: string } },
  ctx: PrivacyContext,
): boolean {
  if (conv.zaloAccount.privacyMode !== 'main') return true;
  const isOwner = conv.zaloAccount.ownerUserId === ctx.viewerUserId;
  return isOwner && ctx.privacyUnlocked;
}

/**
 * Redact 1 message — CODEX REVIEW P1 FIX: allowlist response, không spread.
 * Mọi field content-bearing đều replace bằng blur. Field metadata giữ.
 *
 * Allowlist field giữ (an toàn metadata):
 *   id, conversationId, senderType, sentAt, isDeleted, deletedAt, zaloMsgId, zaloMsgIdNum
 * Field BLUR:
 *   content, originalContent, contentType, attachments, quote, senderUid, senderName
 */
export function redactMessage(
  msg: any,
  conv: { zaloAccount: { privacyMode: string; ownerUserId: string } },
  ctx: PrivacyContext,
): any {
  if (canSeeConversationContent(conv, ctx)) return msg;
  // Allowlist: chỉ giữ field metadata an toàn
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    senderType: msg.senderType,
    sentAt: msg.sentAt,
    isDeleted: msg.isDeleted ?? false,
    deletedAt: msg.deletedAt ?? null,
    zaloMsgId: msg.zaloMsgId ?? null,
    zaloMsgIdNum: msg.zaloMsgIdNum?.toString?.() ?? null,
    editedAt: msg.editedAt ?? null,
    reactions: msg.reactions ?? [], // count metadata only
    albumKey: msg.albumKey ?? null,
    albumIndex: msg.albumIndex ?? null,
    albumTotal: msg.albumTotal ?? null,
    // BLUR all content-bearing fields
    content: BLUR_TOKEN,
    originalContent: msg.originalContent ? BLUR_TOKEN : null,
    contentType: 'text', // hide actual contentType (image/file leaks signal)
    attachments: [],
    quote: null,
    senderUid: null,
    senderName: null,
    redacted: true,
  };
}

/**
 * Redact conversation row (list view) — main-nick: blur preview text + lastMessage.
 */
export function redactConversationRow<T extends {
  lastMessageContent?: string | null;
  unreadCount?: number;
}>(
  conv: T & { zaloAccount: { privacyMode: string; ownerUserId: string } },
  ctx: PrivacyContext,
): T & { redacted?: boolean } {
  if (canSeeConversationContent(conv, ctx)) return conv;
  return {
    ...conv,
    lastMessageContent: BLUR_TOKEN,
    // unreadCount giữ — metadata, không leak content
    redacted: true,
  } as any;
}

/**
 * Decide: viewer có quyền xem PII của 1 Contact không?
 *
 * Q4 (anh chốt): contact PII blur NẾU có ít nhất 1 friend row thuộc main-nick non-owned.
 * CODEX REVIEW P2 #5: REQUIRE orgId trong context để tenant-safe.
 */
export async function shouldRedactContactPii(
  contactId: string,
  ctx: PrivacyContext,
): Promise<boolean> {
  if (!ctx.orgId) {
    // Defensive: no org context = unsafe, default redact
    return true;
  }
  const offending = await prisma.friend.findFirst({
    where: {
      orgId: ctx.orgId,
      contactId,
      zaloAccount: {
        orgId: ctx.orgId,
        privacyMode: 'main',
        ownerUserId: ctx.viewerUserId ? { not: ctx.viewerUserId } : undefined,
      },
    },
    select: { id: true },
  });
  return !!offending;
}

/**
 * Redact Contact object — CODEX REVIEW P1 #2 FIX: allowlist pattern.
 * Chỉ trả ID + score/metadata aggregate. Mọi PII strip.
 *
 * Allowlist giữ: id, orgId, displayStatus, displayLeadScore, displayHasZalo,
 *   priorityScore, engagementScore, engagementPattern, conversationCount,
 *   createdAt, updatedAt, redacted flag.
 * Strip: fullName, crmName, phone(*), email, address, social, demographic, notes,
 *   zalo* (uid, globalId, username), avatar, assigned user info, tags content.
 */
export function redactContact(contact: any): any {
  return {
    id: contact.id,
    orgId: contact.orgId,
    // Aggregate display values (computed) — metadata, không lộ raw
    displayStatus: contact.displayStatus,
    displayLeadScore: contact.displayLeadScore,
    displayHasZalo: contact.displayHasZalo,
    // Score system (Phase 8) — metadata
    leadScore: contact.leadScore,
    engagementScore: contact.engagementScore,
    engagementPattern: contact.engagementPattern,
    engagementTrend: contact.engagementTrend,
    priorityScore: contact.priorityScore,
    // Count aggregates
    _count: contact._count ?? null,
    // Timestamps
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
    lastActivity: contact.lastActivity,
    // BLUR placeholder cho UI
    fullName: BLUR_TOKEN,
    redacted: true,
  };
}

/**
 * Redact Friend row — blur display name + alias nếu thuộc main-nick non-owned.
 */
export function redactFriend<T extends {
  aliasInNick?: string | null;
  zaloUidInNick?: string | null;
}>(
  friend: T & { zaloAccount: { privacyMode: string; ownerUserId: string } },
  ctx: PrivacyContext,
): T & { redacted?: boolean } {
  if (friend.zaloAccount.privacyMode !== 'main') return friend;
  const isOwner = friend.zaloAccount.ownerUserId === ctx.viewerUserId;
  if (isOwner && ctx.privacyUnlocked) return friend;
  return {
    ...friend,
    aliasInNick: BLUR_TOKEN,
    zaloUidInNick: null,
    redacted: true,
  } as any;
}

/**
 * Build PrivacyContext từ Fastify request — đọc cookie + resolve session.
 * Inject as preHandler hoặc gọi inline trong handler.
 */
export async function buildPrivacyContext(request: any): Promise<PrivacyContext> {
  const user = request.user;
  if (!user) return { viewerUserId: null, orgId: null, privacyUnlocked: false };
  const viewerUserId = user.userId ?? user.id;
  const orgId = user.orgId ?? null;

  const cookies = parseCookies(request.headers.cookie);
  const token = cookies.priv_session;
  if (!token) return { viewerUserId, orgId, privacyUnlocked: false };

  const { resolveSession } = await import('./pin-service.js');
  const session = await resolveSession(token);
  return {
    viewerUserId,
    orgId,
    privacyUnlocked: !!session && session.userId === viewerUserId,
  };
}

function parseCookies(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    }),
  );
}

/** Hằng số export cho test + frontend reference */
export const PRIVACY_BLUR_TOKEN = BLUR_TOKEN;
