// SPDX-License-Identifier: AGPL-3.0-or-later

export interface FriendOverviewGroupRow {
  contactId: string;
  pairCount: number | bigint;
  nickCount: number | bigint;
  friendNickCount: number | bigint;
  totalInbound: number | bigint;
  totalOutbound: number | bigint;
  lastInteractionAt: Date | null;
  maxLeadScore: number | null;
  stuckSince: Date | null;
}

export interface FriendOverviewPairGroupRow {
  contactId: string;
  zaloAccountId: string;
  relationshipKind: string;
  _count: { _all: number };
  _sum: { totalInbound: number | null; totalOutbound: number | null };
  _max: {
    lastInteractionAt: Date | null;
    lastInboundAt: Date | null;
    lastOutboundAt: Date | null;
    leadScore: number | null;
  };
  _min: { stuckSince: Date | null };
}

export interface FriendOverviewTag {
  id: string | null;
  name: string;
  color: string | null;
  scope: 'friend' | 'crm';
  source: string;
}

interface TagAssignmentLike {
  tag?: {
    id?: string | null;
    name?: string | null;
    color?: string | null;
    scope?: 'friend' | 'crm' | null;
    source?: string | null;
  } | null;
}

interface ContactLike {
  id: string;
  tags?: unknown;
  tagAssignments?: TagAssignmentLike[];
  [key: string]: unknown;
}

export interface FriendOverviewSourceRow {
  id: string;
  contactId: string;
  zaloAccountId: string;
  relationshipKind: string;
  totalInbound?: number | null;
  totalOutbound?: number | null;
  lastInboundAt?: Date | string | null;
  lastOutboundAt?: Date | string | null;
  lastInteractionAt?: Date | string | null;
  leadScore?: number | null;
  crmTagsPerNick?: unknown;
  zaloLabels?: unknown;
  autoTags?: unknown;
  tagAssignments?: TagAssignmentLike[];
  contact?: ContactLike | null;
  zaloAccount?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface FriendOverviewAccount {
  zaloAccountId: string;
  account: Record<string, unknown> | null;
  relationshipKind: string;
  friend: FriendOverviewSourceRow;
  friendIds: string[];
  identityCount: number;
  totalInbound: number;
  totalOutbound: number;
  totalMessages: number;
  lastInboundAt: string | Date | null;
  lastOutboundAt: string | Date | null;
  lastInteractionAt: string | Date | null;
  tags: FriendOverviewTag[];
}

export interface FriendOverviewItem {
  id: string;
  contactId: string;
  contact: ContactLike | null;
  primaryFriend: FriendOverviewSourceRow;
  pairCount: number;
  nickCount: number;
  friendNickCount: number;
  isMultiNickFriend: boolean;
  totalInbound: number;
  totalOutbound: number;
  totalMessages: number;
  lastInteractionAt: Date | string | null;
  maxLeadScore: number;
  stuckSince: Date | null;
  tags: FriendOverviewTag[];
  accounts: FriendOverviewAccount[];
}

function asNumber(value: number | bigint | null | undefined): number {
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
}

function asDateMs(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function aggregateFriendOverviewGroups(
  pairs: FriendOverviewPairGroupRow[],
): FriendOverviewGroupRow[] {
  const contactGroups = new Map<string, FriendOverviewGroupRow>();
  const accountKeysByContact = new Map<string, Set<string>>();
  const friendAccountKeysByContact = new Map<string, Set<string>>();

  for (const pair of pairs) {
    const current = contactGroups.get(pair.contactId) ?? {
      contactId: pair.contactId,
      pairCount: 0,
      nickCount: 0,
      friendNickCount: 0,
      totalInbound: 0,
      totalOutbound: 0,
      lastInteractionAt: null,
      maxLeadScore: 0,
      stuckSince: null,
    };
    const accountKeys = accountKeysByContact.get(pair.contactId) ?? new Set<string>();
    const friendAccountKeys = friendAccountKeysByContact.get(pair.contactId) ?? new Set<string>();

    accountKeys.add(pair.zaloAccountId);
    if (pair.relationshipKind === 'friend') friendAccountKeys.add(pair.zaloAccountId);

    current.pairCount = Number(current.pairCount) + pair._count._all;
    current.nickCount = accountKeys.size;
    current.friendNickCount = friendAccountKeys.size;
    current.totalInbound = Number(current.totalInbound) + (pair._sum.totalInbound ?? 0);
    current.totalOutbound = Number(current.totalOutbound) + (pair._sum.totalOutbound ?? 0);

    const pairLastInteraction = [
      pair._max.lastInteractionAt,
      pair._max.lastInboundAt,
      pair._max.lastOutboundAt,
    ].filter((value): value is Date => value instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    if (pairLastInteraction && (!current.lastInteractionAt || pairLastInteraction > current.lastInteractionAt)) {
      current.lastInteractionAt = pairLastInteraction;
    }
    current.maxLeadScore = Math.max(current.maxLeadScore ?? 0, pair._max.leadScore ?? 0);
    if (pair._min.stuckSince && (!current.stuckSince || pair._min.stuckSince < current.stuckSince)) {
      current.stuckSince = pair._min.stuckSince;
    }

    accountKeysByContact.set(pair.contactId, accountKeys);
    friendAccountKeysByContact.set(pair.contactId, friendAccountKeys);
    contactGroups.set(pair.contactId, current);
  }

  return [...contactGroups.values()];
}

export function friendOverviewStats(groups: FriendOverviewGroupRow[]) {
  return {
    totalPairs: groups.reduce((sum, group) => sum + Number(group.pairCount), 0),
    totalContacts: groups.length,
    duplicateContacts: groups.filter((group) => Number(group.friendNickCount) > 1).length,
    totalMessages: groups.reduce(
      (sum, group) => sum + Number(group.totalInbound) + Number(group.totalOutbound),
      0,
    ),
  };
}

function latestValue<T extends Date | string | null | undefined>(values: T[]): Date | string | null {
  let latest: Date | string | null = null;
  let latestMs = 0;
  for (const value of values) {
    const ms = asDateMs(value);
    if (ms > latestMs) {
      latest = value ?? null;
      latestMs = ms;
    }
  }
  return latest;
}

function rowLastInteraction(row: FriendOverviewSourceRow): Date | string | null {
  return latestValue([row.lastInteractionAt, row.lastInboundAt, row.lastOutboundAt]);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function tagKey(tag: FriendOverviewTag): string {
  return `${tag.scope}:${tag.name.trim().toLocaleLowerCase('vi')}`;
}

function addTag(target: Map<string, FriendOverviewTag>, tag: FriendOverviewTag): void {
  const name = tag.name.trim();
  if (!name) return;
  const normalized = { ...tag, name };
  const key = tagKey(normalized);
  const current = target.get(key);
  if (!current || (!current.color && normalized.color)) target.set(key, normalized);
}

function collectAssignmentTags(
  target: Map<string, FriendOverviewTag>,
  assignments: TagAssignmentLike[] | undefined,
  fallbackScope: 'friend' | 'crm',
): void {
  for (const assignment of assignments ?? []) {
    const tag = assignment.tag;
    if (!tag?.name) continue;
    addTag(target, {
      id: tag.id ?? null,
      name: tag.name,
      color: tag.color ?? null,
      scope: tag.scope ?? fallbackScope,
      source: tag.source ?? 'taxonomy',
    });
  }
}

function collectFriendTags(friend: FriendOverviewSourceRow, includeContact: boolean): FriendOverviewTag[] {
  const tags = new Map<string, FriendOverviewTag>();
  collectAssignmentTags(tags, friend.tagAssignments, 'friend');

  for (const name of stringArray(friend.crmTagsPerNick)) {
    addTag(tags, { id: null, name, color: null, scope: 'friend', source: 'legacy_crm_per_nick' });
  }
  for (const name of stringArray(friend.autoTags)) {
    addTag(tags, { id: null, name, color: null, scope: 'friend', source: 'legacy_auto' });
  }
  if (Array.isArray(friend.zaloLabels)) {
    for (const label of friend.zaloLabels) {
      if (!label || typeof label !== 'object') continue;
      const value = label as { id?: string | number; name?: string; color?: string };
      if (!value.name) continue;
      addTag(tags, {
        id: value.id == null ? null : String(value.id),
        name: value.name,
        color: value.color ?? null,
        scope: 'friend',
        source: 'zalo_real',
      });
    }
  }

  if (includeContact && friend.contact) {
    collectAssignmentTags(tags, friend.contact.tagAssignments, 'crm');
    for (const name of stringArray(friend.contact.tags)) {
      addTag(tags, { id: null, name, color: null, scope: 'crm', source: 'legacy_contact' });
    }
  }

  return [...tags.values()].sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === 'crm' ? -1 : 1;
    return a.name.localeCompare(b.name, 'vi');
  });
}

function pickPrimary(rows: FriendOverviewSourceRow[]): FriendOverviewSourceRow {
  return [...rows].sort((a, b) => {
    const friendPriority = Number(b.relationshipKind === 'friend') - Number(a.relationshipKind === 'friend');
    if (friendPriority !== 0) return friendPriority;
    const interaction = asDateMs(rowLastInteraction(b)) - asDateMs(rowLastInteraction(a));
    if (interaction !== 0) return interaction;
    return asNumber(b.totalInbound) + asNumber(b.totalOutbound)
      - asNumber(a.totalInbound) - asNumber(a.totalOutbound);
  })[0];
}

function buildAccount(rows: FriendOverviewSourceRow[]): FriendOverviewAccount {
  const primary = pickPrimary(rows);
  const totalInbound = rows.reduce((sum, row) => sum + asNumber(row.totalInbound), 0);
  const totalOutbound = rows.reduce((sum, row) => sum + asNumber(row.totalOutbound), 0);
  const tags = new Map<string, FriendOverviewTag>();
  for (const row of rows) {
    for (const tag of collectFriendTags(row, false)) addTag(tags, tag);
  }
  return {
    zaloAccountId: primary.zaloAccountId,
    account: primary.zaloAccount ?? null,
    relationshipKind: rows.some((row) => row.relationshipKind === 'friend')
      ? 'friend'
      : primary.relationshipKind,
    friend: primary,
    friendIds: rows.map((row) => row.id),
    identityCount: rows.length,
    totalInbound,
    totalOutbound,
    totalMessages: totalInbound + totalOutbound,
    lastInboundAt: latestValue(rows.map((row) => row.lastInboundAt)),
    lastOutboundAt: latestValue(rows.map((row) => row.lastOutboundAt)),
    lastInteractionAt: latestValue(rows.map(rowLastInteraction)),
    tags: [...tags.values()],
  };
}

export function buildFriendOverviewItems(
  groups: FriendOverviewGroupRow[],
  friends: FriendOverviewSourceRow[],
): FriendOverviewItem[] {
  const rowsByContact = new Map<string, FriendOverviewSourceRow[]>();
  for (const friend of friends) {
    const rows = rowsByContact.get(friend.contactId) ?? [];
    rows.push(friend);
    rowsByContact.set(friend.contactId, rows);
  }

  return groups.flatMap((group) => {
    const rows = rowsByContact.get(group.contactId) ?? [];
    if (!rows.length) return [];
    const primary = pickPrimary(rows);
    const accountBuckets = new Map<string, FriendOverviewSourceRow[]>();
    for (const row of rows) {
      const bucket = accountBuckets.get(row.zaloAccountId) ?? [];
      bucket.push(row);
      accountBuckets.set(row.zaloAccountId, bucket);
    }
    const accounts = [...accountBuckets.values()]
      .map(buildAccount)
      .sort((a, b) => {
        const friendPriority = Number(b.relationshipKind === 'friend') - Number(a.relationshipKind === 'friend');
        return friendPriority || asDateMs(b.lastInteractionAt) - asDateMs(a.lastInteractionAt);
      });
    const tags = new Map<string, FriendOverviewTag>();
    for (const row of rows) {
      for (const tag of collectFriendTags(row, true)) addTag(tags, tag);
    }
    const totalInbound = accounts.reduce((sum, account) => sum + account.totalInbound, 0);
    const totalOutbound = accounts.reduce((sum, account) => sum + account.totalOutbound, 0);
    const friendNickCount = accounts.filter((account) => account.relationshipKind === 'friend').length;

    return [{
      id: group.contactId,
      contactId: group.contactId,
      contact: primary.contact ?? null,
      primaryFriend: primary,
      pairCount: rows.length,
      nickCount: accounts.length,
      friendNickCount,
      isMultiNickFriend: friendNickCount > 1,
      totalInbound,
      totalOutbound,
      totalMessages: totalInbound + totalOutbound,
      lastInteractionAt: latestValue(accounts.map((account) => account.lastInteractionAt)),
      maxLeadScore: Math.max(0, ...rows.map((row) => asNumber(row.leadScore))),
      stuckSince: group.stuckSince,
      tags: [...tags.values()],
      accounts,
    } satisfies FriendOverviewItem];
  });
}

export function sortFriendOverviewGroups(
  groups: FriendOverviewGroupRow[],
  sortBy: string,
): FriendOverviewGroupRow[] {
  const sorted = [...groups];
  sorted.sort((a, b) => {
    switch (sortBy) {
      case 'messages-desc': {
        const messages = asNumber(b.totalInbound) + asNumber(b.totalOutbound)
          - asNumber(a.totalInbound) - asNumber(a.totalOutbound);
        if (messages !== 0) return messages;
        break;
      }
      case 'nicks-desc': {
        const nickDiff = asNumber(b.friendNickCount) - asNumber(a.friendNickCount);
        if (nickDiff !== 0) return nickDiff;
        break;
      }
      case 'score-desc': {
        const scoreDiff = asNumber(b.maxLeadScore) - asNumber(a.maxLeadScore);
        if (scoreDiff !== 0) return scoreDiff;
        break;
      }
      case 'score-asc': {
        const scoreDiff = asNumber(a.maxLeadScore) - asNumber(b.maxLeadScore);
        if (scoreDiff !== 0) return scoreDiff;
        break;
      }
      case 'stuck': {
        const aStuck = a.stuckSince ? a.stuckSince.getTime() : Number.POSITIVE_INFINITY;
        const bStuck = b.stuckSince ? b.stuckSince.getTime() : Number.POSITIVE_INFINITY;
        if (aStuck !== bStuck) return aStuck - bStuck;
        break;
      }
      default:
        break;
    }
    const interactionDiff = asDateMs(b.lastInteractionAt) - asDateMs(a.lastInteractionAt);
    if (interactionDiff !== 0) return interactionDiff;
    return a.contactId.localeCompare(b.contactId);
  });
  return sorted;
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function isoDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function buildFriendOverviewCsv(items: FriendOverviewItem[]): string {
  const rows: unknown[][] = [[
    'Khach hang',
    'So dien thoai',
    'Tai khoan Zalo',
    'SDT tai khoan',
    'Quan he',
    'Tin KH',
    'Tin sale',
    'Tong tin',
    'Tag chung',
    'Tag theo nick',
    'Tuong tac gan nhat',
    'Zalo UID trong nick',
  ]];

  for (const item of items) {
    const customerName = item.contact?.crmName
      || item.primaryFriend.zaloDisplayName
      || item.contact?.fullName
      || 'Khach chua dat ten';
    const commonTags = item.tags
      .filter((tag) => tag.scope === 'crm')
      .map((tag) => tag.name)
      .join(' | ');

    for (const account of item.accounts) {
      rows.push([
        customerName,
        item.contact?.phone ?? '',
        account.account?.displayName ?? 'Nick Zalo',
        account.account?.phone ?? '',
        account.relationshipKind,
        account.totalInbound,
        account.totalOutbound,
        account.totalMessages,
        commonTags,
        account.tags.filter((tag) => tag.scope === 'friend').map((tag) => tag.name).join(' | '),
        isoDate(account.lastInteractionAt),
        account.friend.zaloUidInNick ?? '',
      ]);
    }
  }

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
