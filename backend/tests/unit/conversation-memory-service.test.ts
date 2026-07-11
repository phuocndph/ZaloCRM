import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma = {
    $transaction: vi.fn(async (callback: any) => callback(prisma)),
    message: { count: vi.fn(), findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
    aiConversationSummary: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    aiCustomerMemory: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    aiAuditLog: { create: vi.fn() },
  };
  return {
    prisma,
    buildConversationContext: vi.fn(),
    aiClientComplete: vi.fn(),
  };
});

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/modules/integrations/_shared/token-encryption.util.js', () => ({
  encryptToken: (value: string) => `enc:${value}`,
  decryptToken: (value: string) => value.replace(/^enc:/, ''),
}));
vi.mock('../../src/modules/ai/conversation-context-builder-service.js', async () => {
  const actual = await vi.importActual<any>('../../src/modules/ai/conversation-context-builder-service.js');
  return { ...actual, buildConversationContext: mocks.buildConversationContext };
});
vi.mock('../../src/modules/ai/core/index.js', () => ({ aiClient: { complete: mocks.aiClientComplete } }));

import {
  ConversationMemoryError,
  listCustomerMemories,
  proposeCustomerMemoriesFromConversation,
  refreshConversationSummary,
  upsertCustomerMemory,
} from '../../src/modules/ai/conversation-memory-service.js';

const actor = { orgId: 'org-1', userId: 'admin-1', role: 'admin', privacyUnlocked: true };

function context() {
  return {
    conversationId: 'conv-1',
    orgId: 'org-1',
    generatedAt: '2026-07-11T01:00:00.000Z',
    tokenBudget: 2600,
    tokenEstimate: 500,
    truncated: false,
    truncation: { droppedSections: [], droppedMessages: 0, originalTokenEstimate: 500 },
    access: {
      allowed: true,
      contentVisible: true,
      reason: 'ok',
      scope: 'conversation',
      userId: 'admin-1',
      role: 'admin',
      privacy: { conversationPrivate: false, privacyUnlocked: true },
    },
    sections: [
      { id: 'customer_profile', title: 'Customer profile', priority: 90, tokenEstimate: 10, items: { contactId: 'contact-1', demographics: { incomeRange: '40-60m' } }, sources: ['contacts:contact-1:row'] },
      { id: 'current_product', title: 'Current product', priority: 88, tokenEstimate: 12, items: { type: '2PN', area: 'Thu Duc', budgetMax: 4 }, sources: ['contacts:contact-1:metadata.propertyNeed'] },
      { id: 'latest_emotion', title: 'Emotion', priority: 79, tokenEstimate: 6, items: { label: 'positive', confidence: 0.8 }, sources: ['ai_emotion_analyses:emo-1:row'] },
      {
        id: 'recent_messages',
        title: 'Recent messages',
        priority: 92,
        tokenEstimate: 60,
        sources: ['messages:m-1:content', 'messages:m-2:content'],
        items: [
          { id: 'm-1', senderType: 'contact', content: 'Em quan tam can 2PN o Thu Duc?', sentAt: '2026-07-11T00:00:00.000Z' },
          { id: 'm-2', senderType: 'self', content: 'Bao gia khoang 3.8 ty', sentAt: '2026-07-11T00:10:00.000Z' },
        ],
      },
    ],
    sources: [],
  };
}

describe('ConversationMemoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildConversationContext.mockResolvedValue(context());
    mocks.prisma.message.count.mockResolvedValue(8);
    mocks.prisma.message.findFirst.mockResolvedValue({ sentAt: new Date('2026-07-10T00:00:00.000Z'), createdAt: new Date('2026-07-10T00:00:00.000Z') });
    mocks.prisma.contact.findFirst.mockResolvedValue({ id: 'contact-1' });
    mocks.prisma.aiConversationSummary.findFirst.mockResolvedValue({ id: 'sum-1', version: 1, sourceThroughMessageId: 'm-0' });
    mocks.prisma.aiConversationSummary.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.aiConversationSummary.create.mockResolvedValue({ id: 'sum-2', version: 2, summaryRedacted: '{}', sourceThroughMessageId: 'm-2', createdAt: new Date() });
    mocks.prisma.aiCustomerMemory.findFirst.mockResolvedValue(null);
    mocks.prisma.aiCustomerMemory.create.mockImplementation(async ({ data }: any) => ({ id: 'mem-1', createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...data }));
    mocks.prisma.aiCustomerMemory.update.mockImplementation(async ({ where, data }: any) => ({ id: where.id, orgId: 'org-1', contactId: 'contact-1', key: 'interested_product', evidence: [], createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...data }));
    mocks.prisma.aiCustomerMemory.findMany.mockResolvedValue([]);
    mocks.prisma.aiAuditLog.create.mockResolvedValue({});
  });

  it('refreshes short-term conversation summary with source-through message and audit log', async () => {
    const result = await refreshConversationSummary(actor, 'conv-1', { force: true });

    expect(result.skipped).toBe(false);
    expect(mocks.prisma.aiConversationSummary.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { orgId: 'org-1', conversationId: 'conv-1', status: 'active' },
    }));
    expect(mocks.prisma.aiConversationSummary.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ conversationId: 'conv-1', version: 2, sourceThroughMessageId: 'm-2' }),
    }));
    expect(mocks.prisma.aiAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'memory.summary_refreshed' }),
    }));
  });

  it('skips summary refresh when thresholds are not met', async () => {
    mocks.prisma.message.count.mockResolvedValue(1);
    const recentContext = context();
    (recentContext.sections.find((section) => section.id === 'recent_messages')!.items as any[])[1].sentAt = new Date().toISOString();
    mocks.buildConversationContext.mockResolvedValue(recentContext);

    const result = await refreshConversationSummary(actor, 'conv-1', { minNewMessages: 6, idleMs: 60_000 });

    expect(result).toMatchObject({ skipped: true, reason: 'threshold_not_met' });
    expect(mocks.prisma.aiConversationSummary.create).not.toHaveBeenCalled();
  });

  it('creates approved manual memory with evidence, expiry, and audit log', async () => {
    const memory = await upsertCustomerMemory(actor, 'contact-1', {
      key: 'communication_style',
      value: 'Khach thich trao doi ngan gon qua Zalo vao buoi sang',
      confidence: 0.9,
      evidence: [{ type: 'manual', excerpt: 'Sale confirmed from customer request' }],
      source: 'manual',
    });

    expect(memory.status).toBe('approved');
    expect(memory.value).toContain('trao doi ngan gon');
    expect(mocks.prisma.aiCustomerMemory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ approvedByUserId: 'admin-1', expiresAt: expect.any(Date), lastReinforcedAt: expect.any(Date) }),
    }));
    expect(mocks.prisma.aiAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'memory.created' }),
    }));
  });

  it('reinforces duplicate memory instead of creating a second copy', async () => {
    mocks.prisma.aiCustomerMemory.findFirst
      .mockResolvedValueOnce({
        id: 'mem-existing',
        orgId: 'org-1',
        contactId: 'contact-1',
        key: 'interested_product',
        valueHash: 'same',
        valueEncrypted: new TextEncoder().encode('enc:2PN Thu Duc'),
        valueRedacted: '2PN Thu Duc',
        evidence: [{ type: 'manual' }],
        status: 'candidate',
        confidence: 0.6,
        approvedByUserId: null,
        approvedAt: null,
      });
    mocks.prisma.aiCustomerMemory.update.mockResolvedValue({
      id: 'mem-existing',
      orgId: 'org-1',
      contactId: 'contact-1',
      key: 'interested_product',
      valueEncrypted: new TextEncoder().encode('enc:2PN Thu Duc'),
      valueRedacted: '2PN Thu Duc',
      evidence: [],
      status: 'candidate',
      confidence: 0.8,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    const memory = await upsertCustomerMemory(actor, 'contact-1', {
      key: 'interested_product',
      value: '2PN Thu Duc',
      confidence: 0.8,
      evidence: [{ type: 'context', sourceId: 'contacts:contact-1:metadata.propertyNeed' }],
    });

    expect(memory.id).toBe('mem-existing');
    expect(mocks.prisma.aiCustomerMemory.create).not.toHaveBeenCalled();
    expect(mocks.prisma.aiAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'memory.reinforced' }),
    }));
  });

  it('rejects sensitive memory values by default', async () => {
    await expect(upsertCustomerMemory(actor, 'contact-1', {
      key: 'explicit_remember_request',
      value: 'OTP cua toi la 123456',
      evidence: [{ type: 'manual', excerpt: 'bad' }],
    })).rejects.toMatchObject({ code: 'SENSITIVE_MEMORY_REJECTED' } satisfies Partial<ConversationMemoryError>);
  });

  it('proposes candidate long-term memories from permission-filtered context', async () => {
    const result = await proposeCustomerMemoriesFromConversation(actor, 'conv-1');

    expect(result.contactId).toBe('contact-1');
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(mocks.buildConversationContext).toHaveBeenCalledWith(actor, 'conv-1', { maxTokens: 2600 });
    expect(mocks.prisma.aiCustomerMemory.create).toHaveBeenCalled();
  });

  it('lists only active non-expired memories and decrypts returned value', async () => {
    mocks.prisma.aiCustomerMemory.findMany.mockResolvedValue([
      {
        id: 'mem-1',
        orgId: 'org-1',
        contactId: 'contact-1',
        key: 'communication_style',
        valueEncrypted: new TextEncoder().encode('enc:Thich noi ngan gon'),
        valueRedacted: 'Thich noi ngan gon',
        evidence: [],
        status: 'approved',
        confidence: 0.9,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ]);

    const memories = await listCustomerMemories(actor, 'contact-1');

    expect(memories[0].value).toBe('Thich noi ngan gon');
    expect(memories[0].valueEncrypted).toBeUndefined();
  });
});
