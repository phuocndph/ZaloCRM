import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma = {
    conversation: { findFirst: vi.fn() },
    message: { findMany: vi.fn() },
    aiConversationSummary: { findFirst: vi.fn() },
    aiIntentAnalysis: { findFirst: vi.fn() },
    aiEmotionAnalysis: { findFirst: vi.fn() },
    friend: { findFirst: vi.fn() },
    followupEnrollment: { findMany: vi.fn() },
  };
  return {
    prisma,
    checkZaloAccess: vi.fn(),
  };
});

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/modules/zalo/zalo-access-middleware.js', () => ({ checkZaloAccess: mocks.checkZaloAccess }));
vi.mock('../../src/shared/utils/logger.js', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { ContextBuilderError, buildConversationContext } from '../../src/modules/ai/conversation-context-builder-service.js';

const actor = { orgId: 'org-1', userId: 'admin-1', role: 'admin', privacyUnlocked: true };
const baseDate = new Date('2026-07-11T01:00:00.000Z');

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1', orgId: 'org-1', zaloAccountId: 'za-1', contactId: 'contact-1',
    threadType: 'user', groupName: null, lastMessageAt: baseDate, unreadCount: 0,
    isReplied: false, tab: 'main', isPrivate: false, privateOwnerUserId: null,
    zaloAccount: { id: 'za-1', displayName: 'Sales Nick', privacyMode: 'sub', ownerUserId: 'owner-1' },
    contact: {
      id: 'contact-1', fullName: 'Nguyen Lan', crmName: 'Lan CRM', phone: '0912345678', email: 'lan@example.com',
      source: 'zalo', province: 'HCM', district: '1', ward: null, gender: 'female', birthYear: 1992,
      occupation: 'manager', incomeRange: '40-60m', preferredLang: 'vi', status: 'interested', statusId: 'st-1',
      leadScore: 82, tags: ['vip', 'EGV'], metadata: { propertyNeed: { type: '2PN', area: 'Thu Duc', budgetMax: 4, purpose: 'invest' } },
      nextAppointment: new Date('2026-07-15T03:00:00.000Z'), lastActivity: baseDate,
      assignedUser: { id: 'sale-1', fullName: 'Sale A', role: 'member' },
      statusRef: { id: 'st-1', name: 'Interested', color: '#22c55e', order: 2 },
    },
    ...overrides,
  };
}

function setupDefaults() {
  mocks.checkZaloAccess.mockResolvedValue('ok');
  mocks.prisma.conversation.findFirst.mockResolvedValue(conversation());
  mocks.prisma.message.findMany.mockResolvedValue([
    { id: 'm-1', senderType: 'contact', senderName: 'Lan', content: 'Em quan tam can 2PN o Thu Duc', contentType: 'text', sentAt: new Date('2026-07-11T00:00:00.000Z'), metadata: null },
    { id: 'm-2', senderType: 'self', senderName: 'Sale A', content: 'Bao gia can nay khoang 3.8 ty', contentType: 'text', sentAt: new Date('2026-07-11T00:05:00.000Z'), metadata: null },
  ]);
  mocks.prisma.aiConversationSummary.findFirst.mockResolvedValue({ id: 'sum-1', version: 2, summaryRedacted: 'Khach quan tam can 2PN, ngan sach khoang 4 ty.', summaryHash: 'hash', createdAt: baseDate, sourceThroughMessageId: 'm-2' });
  mocks.prisma.aiIntentAnalysis.findFirst.mockResolvedValue({ id: 'intent-1', label: 'buying_interest', confidence: 0.91, secondary: [], reasonRedacted: 'Customer asks about 2PN', createdAt: baseDate, messageId: 'm-1' });
  mocks.prisma.aiEmotionAnalysis.findFirst.mockResolvedValue({ id: 'emo-1', label: 'positive', confidence: 0.86, intensity: 0.6, secondary: [], reasonRedacted: 'Positive tone', createdAt: baseDate, messageId: 'm-1' });
  mocks.prisma.friend.findFirst.mockResolvedValue({ id: 'friend-1', friendshipStatus: 'accepted', relationshipKind: 'friend', crmTagsPerNick: ['hot'], zaloLabels: [{ name: 'zalo-label' }], statusRef: { id: 'fst-1', name: 'Hot', color: '#ef4444', order: 3 }, leadScore: 88, lastInboundAt: baseDate, lastOutboundAt: baseDate, lastInteractionAt: baseDate });
  mocks.prisma.followupEnrollment.findMany.mockResolvedValue([{ id: 'fu-1', status: 'waiting', currentStepKey: 's2', messagesSent: 1, nextRunAt: new Date('2026-07-12T01:00:00.000Z'), saleTaskTitle: null, workflowVersion: 1, updatedAt: baseDate, workflow: { id: 'wf-1', name: 'Care 2PN', type: 'care', goalType: 'replied', status: 'active' } }]);
}

describe('ConversationContextBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it('builds a source-attributed context without exposing full phone or email', async () => {
    const context = await buildConversationContext(actor, 'conv-1', { maxTokens: 2200 });
    expect(context.access.allowed).toBe(true);
    expect(context.sections.map((section) => section.id)).toContain('recent_messages');
    expect(context.sections.map((section) => section.id)).toContain('conversation_summary');
    expect(context.sections.map((section) => section.id)).toContain('current_product');
    expect(context.sources.some((source) => source.table === 'messages')).toBe(true);
    expect(JSON.stringify(context)).toContain('******5678');
    expect(JSON.stringify(context)).not.toContain('0912345678');
    expect(JSON.stringify(context)).not.toContain('lan@example.com');
  });

  it('rejects private conversation content when the current user is not the private owner', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue(conversation({ isPrivate: true, privateOwnerUserId: 'other-user' }));
    await expect(buildConversationContext(actor, 'conv-1')).rejects.toMatchObject({
      statusCode: 403,
      code: 'CONVERSATION_CONTENT_PRIVATE',
    } satisfies Partial<ContextBuilderError>);
    expect(mocks.prisma.message.findMany).not.toHaveBeenCalled();
  });

  it('trims long conversations to the token budget and keeps the newest messages', async () => {
    const longMessages = Array.from({ length: 120 }, (_, index) => ({
      id: `m-${index + 1}`,
      senderType: index % 2 ? 'self' : 'contact',
      senderName: index % 2 ? 'Sale A' : 'Lan',
      content: `message ${index + 1} `.repeat(35),
      contentType: 'text',
      sentAt: new Date(Date.UTC(2026, 6, 11, 0, index)),
      metadata: null,
    })).reverse();
    mocks.prisma.message.findMany.mockResolvedValue(longMessages);

    const context = await buildConversationContext(actor, 'conv-1', { maxTokens: 900, recentMessageLimit: 120 });
    const recent = context.sections.find((section) => section.id === 'recent_messages')!;
    const messages = recent.items as Array<{ id: string }>;
    expect(context.tokenEstimate).toBeLessThanOrEqual(900);
    expect(context.truncated).toBe(true);
    expect(context.truncation.droppedMessages).toBeGreaterThan(0);
    expect(messages.at(-1)?.id).toBe('m-120');
    expect(messages.some((message) => message.id === 'm-1')).toBe(false);
  });
});
