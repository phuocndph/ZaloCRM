import { describe, expect, it } from 'vitest';
import {
  aggregateFriendOverviewGroups,
  buildFriendOverviewCsv,
  buildFriendOverviewItems,
  sortFriendOverviewGroups,
  type FriendOverviewGroupRow,
  type FriendOverviewSourceRow,
} from '../src/modules/zalo/friend-overview.js';

function group(overrides: Partial<FriendOverviewGroupRow> = {}): FriendOverviewGroupRow {
  return {
    contactId: 'contact-1',
    pairCount: 3,
    nickCount: 2,
    friendNickCount: 2,
    totalInbound: 7,
    totalOutbound: 4,
    lastInteractionAt: new Date('2026-08-24T10:00:00.000Z'),
    maxLeadScore: 80,
    stuckSince: null,
    ...overrides,
  };
}

function friend(overrides: Partial<FriendOverviewSourceRow>): FriendOverviewSourceRow {
  return {
    id: 'friend-1',
    contactId: 'contact-1',
    zaloAccountId: 'nick-1',
    relationshipKind: 'friend',
    totalInbound: 0,
    totalOutbound: 0,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastInteractionAt: null,
    crmTagsPerNick: [],
    zaloLabels: [],
    autoTags: [],
    tagAssignments: [],
    contact: { id: 'contact-1', tags: [], tagAssignments: [] },
    zaloAccount: { id: 'nick-1', displayName: 'Nick 1' },
    ...overrides,
  };
}

describe('friend overview aggregation', () => {
  it('counts distinct accounts when one account has mixed relationship identities', () => {
    const groups = aggregateFriendOverviewGroups([
      {
        contactId: 'contact-1', zaloAccountId: 'nick-1', relationshipKind: 'friend',
        _count: { _all: 1 }, _sum: { totalInbound: 2, totalOutbound: 1 },
        _max: { lastInteractionAt: null, lastInboundAt: null, lastOutboundAt: null, leadScore: 0 },
        _min: { stuckSince: null },
      },
      {
        contactId: 'contact-1', zaloAccountId: 'nick-1', relationshipKind: 'ghost',
        _count: { _all: 1 }, _sum: { totalInbound: 1, totalOutbound: 0 },
        _max: { lastInteractionAt: null, lastInboundAt: null, lastOutboundAt: null, leadScore: 0 },
        _min: { stuckSince: null },
      },
    ]);

    expect(groups[0]).toMatchObject({ nickCount: 1, friendNickCount: 1, pairCount: 2 });
  });

  it('combines one contact across accounts while keeping per-account chat counts', () => {
    const rows = [
      friend({
        id: 'friend-1',
        totalInbound: 2,
        totalOutbound: 3,
        lastInteractionAt: new Date('2026-08-20T10:00:00.000Z'),
        crmTagsPerNick: ['Theo dõi'],
        tagAssignments: [{ tag: { id: 'tag-vip', name: 'VIP', color: '#ef4444', scope: 'friend', source: 'manual' } }],
      }),
      friend({
        id: 'friend-2',
        relationshipKind: 'ghost',
        totalInbound: 1,
        autoTags: ['vip'],
        lastOutboundAt: new Date('2026-08-21T10:00:00.000Z'),
      }),
      friend({
        id: 'friend-3',
        zaloAccountId: 'nick-2',
        totalInbound: 4,
        totalOutbound: 1,
        lastInboundAt: new Date('2026-08-24T10:00:00.000Z'),
        contact: {
          id: 'contact-1',
          tags: ['VIP'],
          tagAssignments: [{ tag: { id: 'tag-hot', name: 'Tiềm năng', color: '#16a34a', scope: 'crm', source: 'manual' } }],
        },
        zaloAccount: { id: 'nick-2', displayName: 'Nick 2' },
      }),
    ];

    const [item] = buildFriendOverviewItems([group()], rows);

    expect(item.contactId).toBe('contact-1');
    expect(item.accounts).toHaveLength(2);
    expect(item.friendNickCount).toBe(2);
    expect(item.isMultiNickFriend).toBe(true);
    expect(item.totalInbound).toBe(7);
    expect(item.totalOutbound).toBe(4);
    expect(item.totalMessages).toBe(11);
    expect(new Date(item.lastInteractionAt!).toISOString()).toBe('2026-08-24T10:00:00.000Z');

    const nick1 = item.accounts.find((account) => account.zaloAccountId === 'nick-1')!;
    expect(nick1.identityCount).toBe(2);
    expect(nick1.relationshipKind).toBe('friend');
    expect(nick1.totalInbound).toBe(3);
    expect(nick1.totalOutbound).toBe(3);
    expect(new Date(nick1.lastInteractionAt!).toISOString()).toBe('2026-08-21T10:00:00.000Z');

    expect(item.tags.filter((tag) => tag.scope === 'friend' && tag.name.toLowerCase() === 'vip')).toHaveLength(1);
    expect(item.tags.some((tag) => tag.scope === 'crm' && tag.name === 'VIP')).toBe(true);
    expect(item.tags.some((tag) => tag.scope === 'crm' && tag.name === 'Tiềm năng')).toBe(true);
  });

  it('does not treat multiple identities on one account as a multi-account friend', () => {
    const item = buildFriendOverviewItems(
      [group({ nickCount: 1, friendNickCount: 1 })],
      [friend({ id: 'friend-1' }), friend({ id: 'friend-2' })],
    )[0];

    expect(item.accounts).toHaveLength(1);
    expect(item.accounts[0].identityCount).toBe(2);
    expect(item.friendNickCount).toBe(1);
    expect(item.isMultiNickFriend).toBe(false);
  });

  it('sorts by friend-account count, messages, then latest interaction as a stable fallback', () => {
    const groups = [
      group({ contactId: 'contact-a', friendNickCount: 1, totalInbound: 20, lastInteractionAt: new Date('2026-08-20') }),
      group({ contactId: 'contact-b', friendNickCount: 3, totalInbound: 2, lastInteractionAt: new Date('2026-08-21') }),
      group({ contactId: 'contact-c', friendNickCount: 2, totalInbound: 30, lastInteractionAt: new Date('2026-08-19') }),
    ];

    expect(sortFriendOverviewGroups(groups, 'nicks-desc').map((row) => row.contactId))
      .toEqual(['contact-b', 'contact-c', 'contact-a']);
    expect(sortFriendOverviewGroups(groups, 'messages-desc').map((row) => row.contactId))
      .toEqual(['contact-c', 'contact-a', 'contact-b']);
    expect(sortFriendOverviewGroups(groups, 'recent').map((row) => row.contactId))
      .toEqual(['contact-b', 'contact-a', 'contact-c']);
  });

  it('exports one CSV row per account and escapes customer names', () => {
    const item = buildFriendOverviewItems(
      [group({ pairCount: 1, nickCount: 1, friendNickCount: 1 })],
      [friend({
        contact: { id: 'contact-1', fullName: 'Khách, Một', phone: '0901', tags: [], tagAssignments: [] },
      })],
    )[0];

    const csv = buildFriendOverviewCsv([item]);

    expect(csv).toContain('Khach hang,So dien thoai,Tai khoan Zalo');
    expect(csv).toContain('"Khách, Một"');
    expect(csv).toContain('0901');
  });
});
