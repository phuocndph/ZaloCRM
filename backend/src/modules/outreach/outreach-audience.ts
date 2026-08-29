// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Outreach audience evaluation shared by preview and queue seeding.
 *
 * Sources:
 * - customer_list: legacy phone list + one sender account.
 * - friend_pool: accepted friends aggregated from selected Zalo accounts; each
 *   recipient is sent from the account that owns that Friend identity.
 */
import { prisma } from '../../shared/database/prisma-client.js';

export type FriendRelation = 'any' | 'friend_only' | 'non_friend_only';
export type AudienceSource = 'customer_list' | 'friend_pool';

export interface AudienceFilter {
  requireTags: string[];
  excludeTags: string[];
  skipChattedDays: number | null;
  friendRelation: FriendRelation;
}

export interface EvaluatedEntry {
  id: string;
  source: AudienceSource;
  friendId: string | null;
  contactId: string | null;
  zaloAccountId: string | null;
  accountName: string | null;
  accountStatus: string | null;
  zaloUid: string | null;
  phone: string;
  name: string | null;
  tags: string[];
  isFriend: boolean;
  lastChatAt: number | null;
  eligible: boolean;
  reason: string | null;
}

/** The minimal Friend + Contact projection used both when previewing and before a send. */
export interface FriendPoolSnapshot {
  id: string;
  contactId: string;
  zaloAccountId: string;
  zaloUidInNick: string | null;
  aliasInNick: string | null;
  zaloDisplayName: string | null;
  crmTagsPerNick: unknown;
  zaloLabels: unknown;
  autoTags: unknown;
  lastInteractionAt: Date | null;
  zaloAccount: {
    displayName: string | null;
    phone: string | null;
    status: string;
  };
  tagAssignments: Array<{ tag: { name: string; slug: string } }>;
  contact: {
    phone: string | null;
    crmName: string | null;
    fullName: string | null;
    tags: unknown;
    consentStatus: string;
    tagAssignments: Array<{ tag: { name: string; slug: string } }>;
  };
}

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

function parseLegacyTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const values: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) values.push(item.trim());
    else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const value = typeof obj.name === 'string' ? obj.name : typeof obj.text === 'string' ? obj.text : null;
      if (value?.trim()) values.push(value.trim());
    }
  }
  return values;
}

function uniqueTags(...sets: Array<Iterable<string>>): string[] {
  const out = new Set<string>();
  for (const values of sets) {
    for (const raw of values) {
      const value = raw.trim();
      if (value) out.add(value);
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b, 'vi'));
}

function evaluate(entry: Omit<EvaluatedEntry, 'eligible' | 'reason'>, filter: AudienceFilter): EvaluatedEntry {
  const requireSet = new Set(filter.requireTags);
  const excludeSet = new Set(filter.excludeTags);
  const skipMs = filter.skipChattedDays ? filter.skipChattedDays * 86400000 : null;
  let reason: string | null = null;

  if (entry.source === 'friend_pool' && entry.accountStatus !== 'connected') {
    reason = 'Nick Zalo chưa kết nối';
  }
  if (!reason && entry.source === 'friend_pool' && !entry.zaloUid) reason = 'Thiếu Zalo UID';
  if (!reason && requireSet.size > 0 && !entry.tags.some((tag) => requireSet.has(tag))) {
    reason = 'Không có Tag yêu cầu';
  }
  if (!reason && excludeSet.size > 0) {
    const hit = entry.tags.find((tag) => excludeSet.has(tag));
    if (hit) reason = `Có Tag "${hit}"`;
  }
  if (!reason && skipMs != null && entry.lastChatAt != null && Date.now() - entry.lastChatAt <= skipMs) {
    reason = `Đã tương tác trong ${filter.skipChattedDays} ngày`;
  }
  if (!reason && filter.friendRelation === 'friend_only' && !entry.isFriend) reason = 'Chưa là bạn';
  if (!reason && filter.friendRelation === 'non_friend_only' && entry.isFriend) reason = 'Đã là bạn';

  return { ...entry, eligible: reason === null, reason };
}

export async function evaluateCustomerListAudience(
  orgId: string,
  customerListId: string,
  zaloAccountId: string,
  filter: AudienceFilter,
): Promise<EvaluatedEntry[]> {
  const entries = await prisma.customerListEntry.findMany({
    where: { customerListId },
    select: { id: true, contactId: true, phoneLocal: true, phoneE164: true, phoneRaw: true, nameRaw: true, zaloName: true },
  });
  const contactIds = entries.map((entry) => entry.contactId).filter((id): id is string => !!id);
  const [contacts, friendRows, account] = await Promise.all([
    contactIds.length
      ? prisma.contact.findMany({
          where: { orgId, id: { in: contactIds } },
          select: {
            id: true, tags: true, lastInteractionAt: true,
            tagAssignments: {
              where: { removedAt: null, tag: { archivedAt: null, isActive: true } },
              select: { tag: { select: { name: true, slug: true } } },
            },
          },
        })
      : [],
    contactIds.length
      ? prisma.friend.findMany({
          where: { zaloAccountId, contactId: { in: contactIds } },
          select: { contactId: true, friendshipStatus: true, zaloUidInNick: true },
        })
      : [],
    prisma.zaloAccount.findFirst({
      where: { id: zaloAccountId, orgId },
      select: { id: true, displayName: true, phone: true, status: true },
    }),
  ]);
  const contactMap = new Map(contacts.map((contact) => [contact.id, contact]));
  const friendMap = new Map(friendRows.map((friend) => [friend.contactId, friend]));

  return entries.map((entry) => {
    const contact = entry.contactId ? contactMap.get(entry.contactId) : undefined;
    const friend = entry.contactId ? friendMap.get(entry.contactId) : undefined;
    const taxonomyTags = contact?.tagAssignments.flatMap(({ tag }) => [tag.name, tag.slug]) ?? [];
    return evaluate({
      id: entry.id,
      source: 'customer_list',
      friendId: null,
      contactId: entry.contactId ?? null,
      zaloAccountId,
      accountName: account?.displayName || account?.phone || null,
      accountStatus: account?.status ?? null,
      zaloUid: friend?.zaloUidInNick ?? null,
      phone: entry.phoneLocal || entry.phoneE164 || entry.phoneRaw || '',
      name: entry.zaloName || entry.nameRaw || null,
      tags: uniqueTags(parseLegacyTags(contact?.tags), taxonomyTags),
      isFriend: friend?.friendshipStatus === 'accepted',
      lastChatAt: contact?.lastInteractionAt?.getTime() ?? null,
    }, filter);
  });
}

function friendRank(entry: EvaluatedEntry): number {
  const connected = entry.accountStatus === 'connected' ? 10 ** 15 : 0;
  return connected + (entry.lastChatAt ?? 0);
}

/** Keep one send target per CRM contact, preferring an eligible and recently active account. */
export function deduplicateFriendEntries(entries: EvaluatedEntry[]): EvaluatedEntry[] {
  const selected = new Map<string, EvaluatedEntry>();
  for (const entry of entries) {
    const key = entry.contactId || entry.friendId || entry.id;
    const current = selected.get(key);
    if (!current) {
      selected.set(key, entry);
      continue;
    }
    const entryScore = (entry.eligible ? 10 ** 16 : 0) + friendRank(entry);
    const currentScore = (current.eligible ? 10 ** 16 : 0) + friendRank(current);
    if (entryScore > currentScore) selected.set(key, entry);
  }
  return [...selected.values()];
}

/**
 * Build an audience entry from one Friend row. Keeping this pure lets the worker
 * apply the exact same consent, tag and interaction rules immediately before send.
 */
export function evaluateFriendPoolEntry(friend: FriendPoolSnapshot, filter: AudienceFilter): EvaluatedEntry {
  const friendTaxonomy = friend.tagAssignments.flatMap(({ tag }) => [tag.name, tag.slug]);
  const contactTaxonomy = friend.contact.tagAssignments.flatMap(({ tag }) => [tag.name, tag.slug]);
  const tags = uniqueTags(
    parseLegacyTags(friend.crmTagsPerNick),
    parseLegacyTags(friend.zaloLabels),
    parseLegacyTags(friend.autoTags),
    parseLegacyTags(friend.contact.tags),
    friendTaxonomy,
    contactTaxonomy,
  );
  const entry = evaluate({
    id: friend.id,
    source: 'friend_pool',
    friendId: friend.id,
    contactId: friend.contactId,
    zaloAccountId: friend.zaloAccountId,
    accountName: friend.zaloAccount.displayName || friend.zaloAccount.phone || friend.zaloAccountId,
    accountStatus: friend.zaloAccount.status,
    zaloUid: friend.zaloUidInNick,
    phone: friend.contact.phone || '',
    name: friend.aliasInNick || friend.zaloDisplayName || friend.contact.crmName || friend.contact.fullName || 'Bạn bè Zalo',
    tags,
    isFriend: true,
    lastChatAt: friend.lastInteractionAt?.getTime() ?? null,
  }, { ...filter, friendRelation: 'friend_only' });
  return friend.contact.consentStatus === 'revoked'
    ? { ...entry, eligible: false, reason: 'Khách đã thu hồi đồng ý nhận tin' }
    : entry;
}

export async function evaluateFriendPoolAudience(
  orgId: string,
  zaloAccountIds: string[],
  filter: AudienceFilter,
  deduplicateContacts = true,
): Promise<EvaluatedEntry[]> {
  if (!zaloAccountIds.length) return [];
  const friends = await prisma.friend.findMany({
    where: {
      orgId,
      zaloAccountId: { in: zaloAccountIds },
      friendshipStatus: 'accepted',
      relationshipKind: 'friend',
      zaloAccount: { archivedAt: null },
    },
    select: {
      id: true, contactId: true, zaloAccountId: true, zaloUidInNick: true,
      aliasInNick: true, zaloDisplayName: true, crmTagsPerNick: true, zaloLabels: true,
      autoTags: true, lastInteractionAt: true,
      zaloAccount: { select: { displayName: true, phone: true, status: true } },
      tagAssignments: {
        where: { removedAt: null, tag: { archivedAt: null, isActive: true } },
        select: { tag: { select: { name: true, slug: true } } },
      },
      contact: {
        select: {
          phone: true, crmName: true, fullName: true, tags: true, consentStatus: true,
          tagAssignments: {
            where: { removedAt: null, tag: { archivedAt: null, isActive: true } },
            select: { tag: { select: { name: true, slug: true } } },
          },
        },
      },
    },
  });

  const evaluated = friends.map((friend) => evaluateFriendPoolEntry(friend, filter));

  return deduplicateContacts ? deduplicateFriendEntries(evaluated) : evaluated;
}

/** Backward-compatible name for the legacy source. */
export const evaluateAudience = evaluateCustomerListAudience;

export async function evaluateCampaignAudience(campaign: {
  orgId: string;
  audienceSource?: string | null;
  customerListId: string | null;
  zaloAccountId: string | null;
  sourceAccountIds: string[];
  deduplicateContacts: boolean;
  filterRequireTags: string[];
  filterExcludeTags: string[];
  filterSkipChattedDays: number | null;
  filterFriendRelation: string;
}): Promise<EvaluatedEntry[]> {
  const filter = filterFromCampaign(campaign);
  if (campaign.audienceSource === 'friend_pool') {
    return evaluateFriendPoolAudience(campaign.orgId, campaign.sourceAccountIds, filter, campaign.deduplicateContacts);
  }
  if (!campaign.customerListId || !campaign.zaloAccountId) return [];
  return evaluateCustomerListAudience(campaign.orgId, campaign.customerListId, campaign.zaloAccountId, filter);
}

/** Oldest interaction first; recipients with no interaction are processed last. */
export function orderEligibleByChat(list: EvaluatedEntry[]): EvaluatedEntry[] {
  return [...list].sort((a, b) => {
    if (a.lastChatAt === null && b.lastChatAt === null) return 0;
    if (a.lastChatAt === null) return 1;
    if (b.lastChatAt === null) return -1;
    return a.lastChatAt - b.lastChatAt;
  });
}
