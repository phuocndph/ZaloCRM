import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  zaloAccount: { findMany: vi.fn() }, organization: { findUnique: vi.fn() },
  conversation: { findMany: vi.fn(), findFirst: vi.fn() }, appointment: { findMany: vi.fn() },
  followupEnrollment: { findMany: vi.fn() }, contact: { findMany: vi.fn() },
  conversationWorkItem: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: db }));
vi.mock('../../src/shared/event-buffer.js', () => ({ getIo: () => null }));
import {
  listConversationLoadOverview,
  listConversationWorkItems,
  reconcileConversationWorkItems,
  sanitizeConversationWorkItemForViewer,
} from '../../src/modules/dashboard/conversation-work-item-service.js';

const owner = { viewerUserId: 'owner', orgId: 'read-privacy-org', privacyUnlocked: true };
const outsider = { ...owner, viewerUserId: 'manager' };
const contact = { id: 'customer', fullName: 'Company customer', crmName: null, avatarUrl: 'customer-avatar', assignedUserId: 'owner', contactAccess: [] };
const assignee = { id: 'owner', fullName: 'Account owner', avatarUrl: null };
const account = { id: 'main', displayName: 'Main nick', ownerUserId: 'owner', privacyMode: 'main', status: 'connected' };
function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread', contactId: contact.id, zaloAccountId: account.id, contact,
    threadType: 'user', groupName: null, lastMessageAt: new Date('2026-08-26T00:00:00Z'),
    unreadCount: 2, isReplied: true, isPrivate: false, privateOwnerUserId: null,
    zaloAccount: account,
    messages: [{ id: 'message', senderType: 'contact', contentType: 'text', content: 'Giá cao hơn bên khác' }],
    aiInsights: [], aiRuns: [], ...overrides,
  };
}
function workRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'work', orgId: owner.orgId, assigneeUserId: assignee.id, assignee,
    contactId: contact.id, contact, conversationId: 'thread', conversation: conversation(),
    zaloAccountId: account.id, sourceType: 'contact', sourceId: contact.id,
    kind: 'followup_sale', status: 'open', priority: 'high', priorityScore: 84,
    dueAt: new Date('2026-08-20T00:00:00Z'), snoozedUntil: null,
    title: 'SECRET TITLE', customerSituation: 'SECRET SITUATION', nextAction: 'SECRET ACTION', reason: 'SECRET REASON',
    metadata: { contactName: contact.fullName, nickNames: [account.displayName], unreadCount: 2, signalCount: 1, signals: [{ title: 'SECRET SIGNAL' }] },
    ...overrides,
  };
}
const overviewInput = { orgId: owner.orgId, visibleUserIds: [assignee.id], viewerUserId: outsider.viewerUserId };

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-27T04:00:00Z'));
  db.zaloAccount.findMany.mockResolvedValue([account]);
  db.organization.findUnique.mockResolvedValue({ timezone: '+07:00' });
  db.conversation.findMany.mockResolvedValue([]); db.conversation.findFirst.mockResolvedValue(conversation());
  db.appointment.findMany.mockResolvedValue([]); db.followupEnrollment.findMany.mockResolvedValue([]);
  db.contact.findMany.mockResolvedValue([contact]); db.conversationWorkItem.findMany.mockResolvedValue([]);
  db.conversationWorkItem.upsert.mockResolvedValue({}); db.conversationWorkItem.updateMany.mockResolvedValue({ count: 0 });
  db.$transaction.mockImplementation(async (operations) => Promise.all(operations));
});
afterEach(() => vi.useRealTimers());

describe('work-item privacy at the real service READ boundary (all persistence mocked)', () => {
  it.each([
    ['sub', outsider, false, null, false],
    ['main', owner, false, null, false],
    ['main', { ...owner, privacyUnlocked: false }, false, null, true],
    ['main', outsider, false, null, true],
    ['main', { ...owner, privacyUnlocked: false }, true, 'owner', false],
  ])('preserves privacy precedence for %s and viewer %j', (privacyMode, privacy, isPrivate, privateOwnerUserId, redacted) => {
    const row = workRow({
      conversation: conversation({ isPrivate, privateOwnerUserId, zaloAccount: { ...account, privacyMode } }),
      metadata: { signals: [{ conversationId: 'thread', zaloAccountId: 'main', title: 'SECRET SIGNAL' }] },
    });
    const sanitized = sanitizeConversationWorkItemForViewer(row, privacy);
    if (redacted) {
      expect(sanitized).toMatchObject({ metadata: { redacted: true } });
      expect(JSON.stringify(sanitized)).not.toContain('SECRET');
    } else expect(sanitized).toBe(row);
  });

  it('excludes private secondary sources from overview and list counts even when primary is public', async () => {
    const row = workRow({
      conversation: conversation({ zaloAccount: { ...account, privacyMode: 'sub' } }),
      metadata: { conversationIds: ['thread', 'private-source'], signals: [{ conversationId: 'private-source', zaloAccountId: 'main' }] },
    });
    db.zaloAccount.findMany.mockResolvedValue([]);
    db.conversation.findMany.mockResolvedValue([conversation({ id: 'private-source', isPrivate: true, privateOwnerUserId: 'owner' })]);
    db.conversationWorkItem.findMany.mockImplementation(async (args) => args.include ? [row] : []);
    const overview = await listConversationLoadOverview(overviewInput);
    expect(overview.items).toEqual([]);
    expect(overview.summary.totalWorkItems).toBe(0);
    const result = await listConversationWorkItems({ orgId: owner.orgId!, assigneeUserId: 'owner', privacy: outsider, scope: 'all' });
    expect(result.items).toEqual([]);
    expect(result.summary.totalActive).toBe(0);
    expect(result.counts.all).toBe(0);
  });

  it('redacts missing secondary sources without trusting a public primary', async () => {
    const row = workRow({ conversation: conversation({ zaloAccount: { ...account, privacyMode: 'sub' } }), metadata: { conversationIds: ['thread', 'deleted-source'] } });
    db.conversationWorkItem.findMany.mockResolvedValue([row]);
    const overview = await listConversationLoadOverview(overviewInput);
    expect(overview.items[0].taskTitles).toEqual(['Công việc trong hội thoại riêng tư']);
  });

  it('keeps locked main titles redacted on merged overview rows, including completed rows', async () => {
    db.conversationWorkItem.findMany.mockResolvedValue([workRow(), workRow({ id: 'work-2', status: 'completed', title: 'SECOND SECRET' })]);
    const result = await listConversationLoadOverview({ ...overviewInput, includeCompleted: true });
    expect(result.items[0].workItemCount).toBe(2);
    expect(result.items[0].taskTitles).toEqual(['Công việc trong hội thoại riêng tư']);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('does not access persisted customer or metadata preview getters on the list path', async () => {
    const row = workRow();
    for (const field of ['title', 'customerSituation', 'nextAction', 'reason']) {
      Object.defineProperty(row, field, { enumerable: true, get() { throw new Error(`protected ${field}`); } });
    }
    row.contact = { ...contact };
    Object.defineProperty(row.contact, 'lastOutboundPreview', { enumerable: true, get() { throw new Error('customer content'); } });
    Object.defineProperty(row.metadata, 'customerSituation', { enumerable: true, get() { throw new Error('metadata content'); } });
    db.zaloAccount.findMany.mockResolvedValue([]);
    db.conversationWorkItem.findMany.mockImplementation(async (args) => args.include ? [row] : []);
    const result = await listConversationWorkItems({ orgId: owner.orgId!, assigneeUserId: 'owner', privacy: outsider, scope: 'all' });
    expect(result.items[0].title).toBe('Công việc trong hội thoại riêng tư');
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(result.summary.totalActive).toBe(1);
  });

  it('does not treat an anonymous unlocked context as a main account owner', () => {
    const row = workRow({ conversation: conversation({ zaloAccount: { ...account, ownerUserId: null } }), metadata: {} });
    const sanitized = sanitizeConversationWorkItemForViewer(row, { orgId: owner.orgId, viewerUserId: null, privacyUnlocked: true });
    expect(sanitized).toMatchObject({ metadata: { redacted: true } });
  });

  it('redacts cached list reads after another viewer overwrites the shared row with unlocked content', async () => {
    const orgId = 'cached-read-privacy-org';
    db.zaloAccount.findMany.mockResolvedValue([]);
    let persisted = workRow({ orgId });
    db.conversationWorkItem.findMany.mockImplementation(async (args) => args.include ? [persisted] : []);
    const input = { orgId, assigneeUserId: 'owner', privacy: { ...outsider, orgId }, scope: 'all' as const };
    await listConversationWorkItems(input);
    const reconciliationCount = db.$transaction.mock.calls.length;
    persisted = workRow({ orgId, title: 'SECRET OWNER OVERWRITE', customerSituation: 'SECRET LATEST SITUATION' });
    const result = await listConversationWorkItems(input);
    expect(db.$transaction.mock.calls.length).toBe(reconciliationCount);
    expect(result.items[0].title).toBe('Công việc trong hội thoại riêng tư');
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('renders overview safely when an account relation is missing', async () => {
    db.conversationWorkItem.findMany.mockResolvedValue([workRow({ conversation: conversation({ zaloAccount: null }) })]);
    const result = await listConversationLoadOverview(overviewInput);
    expect(result.items[0].taskTitles).toEqual(['Công việc trong hội thoại riêng tư']);
    expect(result.items[0].nickStatus).toBeNull();
  });

  it('redacts legacy content signals with unknown provenance even when the primary nick is public', () => {
    const row = workRow({ conversation: conversation({ zaloAccount: { ...account, privacyMode: 'sub' } }) });
    expect(sanitizeConversationWorkItemForViewer(row, outsider)).toMatchObject({ metadata: { redacted: true } });
    expect(JSON.stringify(sanitizeConversationWorkItemForViewer(row, outsider))).not.toContain('SECRET');
  });

  it('fails closed for incomplete account privacy fields and source provenance', () => {
    for (const zaloAccount of [{ displayName: 'Nick' }, { privacyMode: 'unknown' }, null]) {
      const row = workRow({ conversation: conversation({ zaloAccount }) });
      expect(sanitizeConversationWorkItemForViewer(row, owner)).toMatchObject({ metadata: { redacted: true } });
    }
    const row = workRow({ conversation: conversation({ zaloAccount: { ...account, privacyMode: 'sub' } }), metadata: {
      signals: [{ zaloAccountId: 'main', title: 'SECRET WITHOUT CONVERSATION' }],
    } });
    expect(sanitizeConversationWorkItemForViewer(row, outsider)).toMatchObject({ metadata: { redacted: true } });
  });

  it('fails closed for account-backed orphan rows instead of returning stale persisted content', async () => {
    const row = workRow({ conversation: null });
    db.conversationWorkItem.findMany.mockResolvedValue([row]);
    const overview = await listConversationLoadOverview(overviewInput);
    expect(overview.items[0].taskTitles).toEqual(['Công việc trong hội thoại riêng tư']);
    expect(sanitizeConversationWorkItemForViewer(row, outsider)).toMatchObject({ metadata: { redacted: true } });
    expect(JSON.stringify(sanitizeConversationWorkItemForViewer(row, outsider))).not.toContain('SECRET');
    const appointment = workRow({ conversation: null, conversationId: null, zaloAccountId: null, kind: 'appointment', metadata: {} });
    expect(sanitizeConversationWorkItemForViewer(appointment, outsider)).toBe(appointment);
  });

  it('redacts mixed-nick aggregate content in both overview and list before search/count/pagination', async () => {
    const publicConversation = conversation({ zaloAccount: { ...account, id: 'sub', privacyMode: 'sub' }, zaloAccountId: 'sub' });
    const row = workRow({ conversation: publicConversation, zaloAccountId: 'sub', metadata: {
      contactName: contact.fullName, nickNames: ['Main nick', 'Sub nick'], signalCount: 2,
      conversationIds: ['thread', 'main-source'],
      signals: [{ conversationId: 'main-source', zaloAccountId: 'main', title: 'SECRET SIGNAL' }],
    } });
    db.zaloAccount.findMany.mockResolvedValue([]);
    db.conversationWorkItem.findMany.mockImplementation(async (args) => args.include ? [row] : []);
    db.conversation.findMany.mockResolvedValue([conversation({ id: 'main-source' })]);
    const overview = await listConversationLoadOverview(overviewInput);
    expect(overview.items[0].taskTitles).toEqual(['Công việc trong hội thoại riêng tư']);
    const result = await listConversationWorkItems({ orgId: owner.orgId!, assigneeUserId: 'owner', privacy: outsider, scope: 'all', limit: 1 });
    expect(result.items[0]).toMatchObject({
      title: 'Công việc trong hội thoại riêng tư', customerSituation: 'Nội dung hội thoại đang được bảo vệ.', metadata: { redacted: true, signalCount: 2 },
    });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    const searched = await listConversationWorkItems({ orgId: owner.orgId!, assigneeUserId: 'owner', privacy: outsider, scope: 'all', query: 'SECRET' });
    expect(searched.items).toEqual([]);
    expect(searched.summary.totalActive).toBe(1);
    expect(db.conversation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId: owner.orgId, id: { in: ['main-source'] }, deletedAt: null },
      select: expect.objectContaining({ isPrivate: true, privateOwnerUserId: true, zaloAccount: { select: expect.objectContaining({ privacyMode: true, ownerUserId: true }) } }),
    }));
  });

  it('does not access protected content getters while projecting a redacted work item', async () => {
    const row = workRow();
    for (const field of ['title', 'customerSituation', 'nextAction', 'reason', 'unexpectedContent']) {
      Object.defineProperty(row, field, { enumerable: true, get() { throw new Error(`protected ${field} accessed`); } });
    }
    row.contact = { ...contact };
    Object.defineProperty(row.contact, 'lastInboundPreview', { enumerable: true, get() { throw new Error('customer preview accessed'); } });
    Object.defineProperty(row.conversation, 'messages', { enumerable: true, get() { throw new Error('messages accessed'); } });
    Object.defineProperty(row.metadata, 'customerSituation', { enumerable: true, get() { throw new Error('metadata content accessed'); } });
    const sanitized = sanitizeConversationWorkItemForViewer(row, outsider);
    expect(sanitized).toMatchObject({
      title: 'Công việc trong hội thoại riêng tư', customerSituation: 'Nội dung hội thoại đang được bảo vệ.',
      contact: { fullName: contact.fullName }, metadata: { redacted: true, signalCount: 1 },
    });
    expect(sanitized).not.toHaveProperty('unexpectedContent');
    expect(sanitized.contact).not.toHaveProperty('lastInboundPreview');
    expect(sanitized.conversation).not.toHaveProperty('messages');
    expect(sanitized.metadata).not.toHaveProperty('signals');
    expect(JSON.stringify(sanitized)).not.toContain('SECRET');
    db.conversationWorkItem.findMany.mockResolvedValue([row]);
    const overview = await listConversationLoadOverview(overviewInput);
    expect(overview.items[0].taskTitles).toEqual(['Công việc trong hội thoại riêng tư']);
  });
  it('redacts owner-unlocked persisted content when an unauthorized manager reads overview without reconciliation', async () => {
    db.followupEnrollment.findMany.mockResolvedValue([{
      id: 'enrollment', contactId: contact.id, zaloAccountId: account.id, workflowId: 'workflow',
      currentStepKey: 'sale-step', saleTaskTitle: 'Gọi hoặc nhắn trực tiếp để làm rõ vướng mắc sau báo giá', messagesSent: 2,
      updatedAt: new Date('2026-08-20T00:00:00Z'), logs: [], workflow: { name: 'Workflow' },
    }]);
    let persisted: any;
    db.conversationWorkItem.upsert.mockImplementation(async ({ create }) => {
      persisted = workRow(create);
      return persisted;
    });
    await reconcileConversationWorkItems({ orgId: owner.orgId!, assigneeUserId: 'owner', privacy: owner });
    expect(persisted.title).toBe('Xác nhận nhu cầu hiện tại và làm rõ chênh lệch giá');
    expect(persisted.customerSituation).toContain('giá');
    db.conversationWorkItem.findMany.mockResolvedValue([persisted]);
    db.conversationWorkItem.upsert.mockClear();

    const result = await listConversationLoadOverview(overviewInput);
    expect(result.items[0].taskTitles).toEqual(['Công việc trong hội thoại riêng tư']);
    expect(result.items[0]).toMatchObject({ contactName: contact.fullName, contactAvatar: contact.avatarUrl, nickName: account.displayName, unreadCount: 2 });
    expect(result.summary).toMatchObject({ activeConversations: 1, totalWorkItems: 1 });
    expect(JSON.stringify(result)).not.toContain('chênh lệch giá');
    expect(db.conversationWorkItem.upsert).not.toHaveBeenCalled();
    expect(db.conversationWorkItem.findMany.mock.calls.at(-1)?.[0].include.conversation.select.zaloAccount.select)
      .toMatchObject({ privacyMode: true, ownerUserId: true });
    expect(persisted.title).toBe('Xác nhận nhu cầu hiện tại và làm rõ chênh lệch giá');
  });
});
