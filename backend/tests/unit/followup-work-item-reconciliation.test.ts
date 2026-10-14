import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  zaloAccount: { findMany: vi.fn() }, organization: { findUnique: vi.fn() },
  conversation: { findMany: vi.fn(), findFirst: vi.fn() }, appointment: { findMany: vi.fn() },
  followupEnrollment: { findMany: vi.fn(), findUnique: vi.fn() }, contact: { findMany: vi.fn() },
  conversationWorkItem: { findMany: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: db }));
vi.mock('../../src/shared/event-buffer.js', () => ({ getIo: () => null }));
import { reconcileConversationWorkItems } from '../../src/modules/dashboard/conversation-work-item-service.js';

const contact = { id: 'customer', fullName: 'Fixture', assignedUserId: 'sale', contactAccess: [] };
const enrollment = {
  id: 'enrollment', contactId: 'customer', zaloAccountId: 'nick', workflowId: 'workflow',
  currentStepKey: 'sale-step', saleTaskTitle: 'Gọi hoặc nhắn trực tiếp để làm rõ vướng mắc sau báo giá',
  messagesSent: 2, updatedAt: new Date('2026-08-20T00:00:00Z'), workflow: { name: 'Workflow' },
};
function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exact-thread', contactId: 'customer', zaloAccountId: 'nick', contact,
    lastMessageAt: new Date('2026-08-26T00:00:00Z'), unreadCount: 0, isReplied: true,
    isPrivate: false, privateOwnerUserId: null,
    zaloAccount: { id: 'nick', displayName: 'Nick', ownerUserId: 'sale', privacyMode: 'sub', status: 'disconnected' },
    messages: [{ senderType: 'contact', contentType: 'text', content: 'Giá cao hơn bên khác' }],
    aiInsights: [], aiRuns: [], ...overrides,
  };
}
const input = { orgId: 'org', assigneeUserId: 'sale', privacy: { orgId: 'org', viewerUserId: 'sale', privacyUnlocked: false } };

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-27T04:00:00Z'));
  db.zaloAccount.findMany.mockResolvedValue([{ id: 'nick', ownerUserId: 'sale', privacyMode: 'sub', status: 'disconnected', displayName: 'Nick' }]);
  db.organization.findUnique.mockResolvedValue({ timezone: '+07:00' });
  db.conversation.findMany.mockResolvedValue([]); db.conversation.findFirst.mockResolvedValue(thread());
  db.appointment.findMany.mockResolvedValue([]); db.followupEnrollment.findMany.mockResolvedValue([enrollment]);
  db.followupEnrollment.findUnique.mockResolvedValue({ logs: [{ eventType: 'sale_task_created', stepKey: 'sale-step', createdAt: new Date('2026-08-18T00:00:00Z') }] });
  db.contact.findMany.mockResolvedValue([contact]); db.conversationWorkItem.findMany.mockResolvedValue([]);
  db.conversationWorkItem.upsert.mockResolvedValue({}); db.conversationWorkItem.updateMany.mockResolvedValue({ count: 0 });
  db.$transaction.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe('follow-up reconciliation with mocked persistence only', () => {
  it('loads the exact contact/account nondeleted user thread even outside reply/AI/dormant sources', async () => {
    await reconcileConversationWorkItems(input);
    expect(db.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId: 'org', contactId: 'customer', zaloAccountId: 'nick', threadType: 'user', deletedAt: null },
      select: expect.objectContaining({
        isPrivate: true, privateOwnerUserId: true,
        zaloAccount: { select: expect.objectContaining({ status: true, privacyMode: true, ownerUserId: true }) },
        messages: expect.objectContaining({ take: 12, where: { isDeleted: false }, orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }] }),
      }),
    }));
    const candidate = db.conversationWorkItem.upsert.mock.calls[0][0].create;
    expect(candidate.conversationId).toBe('exact-thread');
    expect(candidate.title).toBe('Xác nhận nhu cầu hiện tại và làm rõ chênh lệch giá');
    expect(candidate.nextAction).toContain('đồng bộ nick');
  });
  it('omits a follow-up thread private to another viewer', async () => {
    db.conversation.findFirst.mockResolvedValue(thread({ isPrivate: true, privateOwnerUserId: 'other' }));
    await reconcileConversationWorkItems(input);
    expect(db.conversationWorkItem.upsert).not.toHaveBeenCalled();
  });
  it('redacts an un-unlocked main nick before interpreting messages or manual titles', async () => {
    db.followupEnrollment.findMany.mockResolvedValue([{ ...enrollment, saleTaskTitle: 'SECRET MANUAL TITLE' }]);
    db.conversation.findFirst.mockResolvedValue(thread({ zaloAccount: { id: 'nick', ownerUserId: 'other', privacyMode: 'main', status: 'disconnected' } }));
    await reconcileConversationWorkItems(input);
    const candidate = db.conversationWorkItem.upsert.mock.calls[0][0].create;
    expect(candidate.title).toBe('Công việc follow-up trong hội thoại riêng tư');
    expect(JSON.stringify(candidate)).not.toContain('SECRET MANUAL TITLE');
    expect(JSON.stringify(candidate)).not.toContain('chênh lệch giá');
  });
  it('selects original sale-task log times and keeps dueAt on that timestamp', async () => {
    db.followupEnrollment.findMany.mockResolvedValue([{ ...enrollment, logs: [{ eventType: 'sale_task_created', stepKey: 'sale-step', createdAt: new Date('2026-08-18T00:00:00Z') }] }]);
    await reconcileConversationWorkItems(input);
    expect(db.followupEnrollment.findMany.mock.calls[0][0].select.logs).toBeTruthy();
    expect(db.conversationWorkItem.upsert.mock.calls[0][0].create.dueAt).toEqual(new Date('2026-08-18T00:00:00Z'));
  });
});
