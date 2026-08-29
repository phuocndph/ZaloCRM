import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  customerListEntry: { findMany: vi.fn() },
  contact: { findMany: vi.fn() },
  friend: { findMany: vi.fn() },
  zaloAccount: { findFirst: vi.fn() },
};

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));

const {
  deduplicateFriendEntries,
  evaluateCustomerListAudience,
  evaluateFriendPoolEntry,
  orderEligibleByChat,
} = await import('../src/modules/outreach/outreach-audience.js');

const baseFilter = {
  requireTags: [] as string[],
  excludeTags: [] as string[],
  skipChattedDays: null as number | null,
  friendRelation: 'friend_only' as const,
};

function friendSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'friend-1',
    contactId: 'contact-1',
    zaloAccountId: 'account-1',
    zaloUidInNick: 'uid-1',
    aliasInNick: 'Khách An',
    zaloDisplayName: 'An',
    crmTagsPerNick: [],
    zaloLabels: [],
    autoTags: [],
    lastInteractionAt: new Date('2026-08-01T00:00:00Z'),
    zaloAccount: { displayName: 'Nick bán hàng', phone: '0900000000', status: 'connected' },
    tagAssignments: [{ tag: { name: 'VIP', slug: 'vip' } }],
    contact: {
      phone: '0912345678', crmName: 'Nguyễn An', fullName: 'Nguyễn Văn An',
      tags: [], consentStatus: 'granted',
      tagAssignments: [{ tag: { name: 'Đã mua', slug: 'da-mua' } }],
    },
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('friend-pool audience rules', () => {
  it('combines Friend and CRM tags for required/excluded filters', () => {
    const included = evaluateFriendPoolEntry(friendSnapshot(), { ...baseFilter, requireTags: ['Đã mua'] });
    expect(included.eligible).toBe(true);
    expect(included.tags).toEqual(expect.arrayContaining(['VIP', 'vip', 'Đã mua', 'da-mua']));

    const excluded = evaluateFriendPoolEntry(friendSnapshot(), { ...baseFilter, excludeTags: ['VIP'] });
    expect(excluded.eligible).toBe(false);
    expect(excluded.reason).toContain('VIP');
  });

  it('skips a recipient who interacted inside the configured window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T00:00:00Z'));
    const entry = evaluateFriendPoolEntry(
      friendSnapshot({ lastInteractionAt: new Date('2026-08-23T00:00:00Z') }),
      { ...baseFilter, skipChattedDays: 7 },
    );
    expect(entry.eligible).toBe(false);
    expect(entry.reason).toContain('7 ngày');
  });

  it('blocks contacts that revoked marketing consent', () => {
    const snapshot = friendSnapshot();
    snapshot.contact.consentStatus = 'revoked';
    const entry = evaluateFriendPoolEntry(snapshot, baseFilter);
    expect(entry.eligible).toBe(false);
    expect(entry.reason).toContain('thu hồi');
  });

  it('deduplicates a CRM contact and prefers an eligible connected account', () => {
    const connected = evaluateFriendPoolEntry(friendSnapshot(), baseFilter);
    const disconnected = evaluateFriendPoolEntry(friendSnapshot({
      id: 'friend-2', zaloAccountId: 'account-2',
      zaloAccount: { displayName: 'Nick lỗi', phone: null, status: 'disconnected' },
    }), baseFilter);
    expect(deduplicateFriendEntries([disconnected, connected])).toEqual([connected]);
  });

  it('orders eligible recipients from oldest interaction to never interacted', () => {
    const oldest = evaluateFriendPoolEntry(friendSnapshot({ id: 'old', contactId: 'c-old', lastInteractionAt: new Date('2026-01-01') }), baseFilter);
    const newer = evaluateFriendPoolEntry(friendSnapshot({ id: 'new', contactId: 'c-new', lastInteractionAt: new Date('2026-08-01') }), baseFilter);
    const never = evaluateFriendPoolEntry(friendSnapshot({ id: 'never', contactId: 'c-never', lastInteractionAt: null }), baseFilter);
    expect(orderEligibleByChat([never, newer, oldest]).map((entry: { id: string }) => entry.id)).toEqual(['old', 'new', 'never']);
  });
});

describe('legacy customer-list regression', () => {
  it('still evaluates a phone-list entry with its configured sender account', async () => {
    prismaMock.customerListEntry.findMany.mockResolvedValue([{
      id: 'entry-1', contactId: 'contact-1', phoneLocal: '0912345678',
      phoneE164: '+84912345678', phoneRaw: '0912345678', nameRaw: 'An', zaloName: null,
    }]);
    prismaMock.contact.findMany.mockResolvedValue([{
      id: 'contact-1', tags: [], lastInteractionAt: null,
      tagAssignments: [{ tag: { name: 'VIP', slug: 'vip' } }],
    }]);
    prismaMock.friend.findMany.mockResolvedValue([{
      contactId: 'contact-1', friendshipStatus: 'accepted', zaloUidInNick: 'uid-1',
    }]);
    prismaMock.zaloAccount.findFirst.mockResolvedValue({
      id: 'account-1', displayName: 'Nick chính', phone: '0900000000', status: 'connected',
    });

    const [entry] = await evaluateCustomerListAudience('org-1', 'list-1', 'account-1', {
      ...baseFilter, friendRelation: 'any', requireTags: ['VIP'],
    });
    expect(entry).toMatchObject({
      source: 'customer_list', eligible: true, zaloAccountId: 'account-1', accountName: 'Nick chính', phone: '0912345678',
    });
  });
});
