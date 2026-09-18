import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    customerListEntry: { findUnique: vi.fn(), update: vi.fn() },
    customerListZaloAssignment: { findMany: vi.fn() },
    zaloAssignmentState: { upsert: vi.fn(), update: vi.fn() },
    contact: { findFirst: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(),
    customerListEntry: { findMany: vi.fn() },
  };
  return {
    tx,
    prisma,
    appendSystemMessage: vi.fn(),
    sendSystemNotificationToUser: vi.fn(),
  };
});

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));
vi.mock('../src/modules/lists/list-system-messages.js', () => ({
  appendSystemMessage: mocks.appendSystemMessage,
}));
vi.mock('../src/modules/system-notifications/system-notify-service.js', () => ({
  sendSystemNotificationToUser: mocks.sendSystemNotificationToUser,
}));

const { assignListEntry } = await import('../src/modules/lists/list-lead-assignment-service.js');

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    customerListId: 'list-1',
    contactId: 'contact-1',
    hasZalo: true,
    assignedZaloAccountId: null,
    phoneLocal: '0912345678',
    nameRaw: 'Khach A',
    systemMessages: [],
    customerList: {
      name: 'Tep A',
      orgId: 'org-1',
      archivedAt: null,
      leadNotifyEnabled: true,
      notifyIndividual: false,
    },
    ...overrides,
  };
}

function recipient(id: string) {
  return {
    id: `rule-${id}`,
    customerListId: 'list-1',
    zaloAccountId: id,
    createdAt: new Date('2026-09-18T00:00:00Z'),
    zaloAccount: {
      id,
      displayName: `Nick ${id}`,
      ownerUserId: null,
      status: 'connected',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
  mocks.tx.customerListEntry.findUnique.mockResolvedValue(entry());
  mocks.tx.customerListZaloAssignment.findMany.mockResolvedValue([recipient('account-a')]);
  mocks.tx.zaloAssignmentState.upsert.mockResolvedValue({
    customerListId: 'list-1',
    lastAssignedZaloAccountId: null,
    counter: 0,
  });
  mocks.tx.contact.findFirst.mockResolvedValue({ id: 'contact-1' });
  mocks.tx.customerListEntry.update.mockResolvedValue({});
  mocks.tx.zaloAssignmentState.update.mockResolvedValue({});
  mocks.appendSystemMessage.mockResolvedValue(undefined);
});

describe('list lead assignment', () => {
  it('reassigns when only a stale audit message remains', async () => {
    mocks.tx.customerListEntry.findUnique.mockResolvedValue(entry({
      systemMessages: [{
        type: 'ASSIGNED_TO_ZALO_ACCOUNT',
        text: 'Da gan cho nick cu',
        ts: '2026-09-17T00:00:00.000Z',
        payload: { zaloAccountId: 'deleted-account' },
      }],
    }));

    await expect(assignListEntry('entry-1')).resolves.toBe(true);
    expect(mocks.tx.customerListEntry.update).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: { assignedZaloAccountId: 'account-a' },
    });
  });

  it('uses the assignment FK as the idempotency guard', async () => {
    mocks.tx.customerListEntry.findUnique.mockResolvedValue(entry({ assignedZaloAccountId: 'account-a' }));

    await expect(assignListEntry('entry-1')).resolves.toBe(false);
    expect(mocks.tx.customerListZaloAssignment.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.customerListEntry.update).not.toHaveBeenCalled();
  });

  it('continues with the account after the most recently assigned account', async () => {
    mocks.tx.customerListZaloAssignment.findMany.mockResolvedValue([
      recipient('account-a'),
      recipient('account-b'),
      recipient('account-c'),
    ]);
    mocks.tx.zaloAssignmentState.upsert.mockResolvedValue({
      customerListId: 'list-1',
      lastAssignedZaloAccountId: 'account-b',
      counter: 8,
    });

    await expect(assignListEntry('entry-1')).resolves.toBe(true);
    expect(mocks.tx.customerListEntry.update).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      data: { assignedZaloAccountId: 'account-c' },
    });
  });
});
