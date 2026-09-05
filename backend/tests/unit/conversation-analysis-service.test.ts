import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    message: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findFirst: vi.fn() },
    aiConfig: { findUnique: vi.fn() },
    aiAgent: { findFirst: vi.fn() },
    aiRun: { create: vi.fn(), update: vi.fn() },
    aiConversationSummary: { findFirst: vi.fn() },
    aiConversationInsight: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    aiIntentAnalysis: { create: vi.fn() },
    aiEmotionAnalysis: { create: vi.fn() },
    aiAuditLog: { create: vi.fn(), findFirst: vi.fn() },
    aiCustomerMemory: { findMany: vi.fn() },
    $transaction: vi.fn(),
  } as any,
  refreshSummary: vi.fn(),
  proposeMemories: vi.fn(),
  analyzeIntent: vi.fn(),
  analyzeEmotion: vi.fn(),
  reconcileAutomation: vi.fn(),
}));

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/shared/utils/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../src/modules/ai/conversation-memory-service.js', () => {
  class ContextBuilderError extends Error { statusCode = 400; code = 'CONTEXT_BUILDER_ERROR'; }
  return {
    ContextBuilderError,
    refreshConversationSummary: mocks.refreshSummary,
    proposeCustomerMemoriesFromConversation: mocks.proposeMemories,
  };
});
vi.mock('../../src/modules/ai/intent-engine-service.js', () => ({ analyzeConversationIntent: mocks.analyzeIntent }));
vi.mock('../../src/modules/ai/emotion-engine-service.js', () => ({ analyzeConversationEmotion: mocks.analyzeEmotion }));
vi.mock('../../src/modules/ai/conversation-context-builder-service.js', () => ({ buildConversationContext: vi.fn() }));
vi.mock('../../src/modules/ai/customer-automation-orchestrator.js', () => ({
  reconcileCustomerAutomation: mocks.reconcileAutomation,
}));

import {
  buildShadowRecommendation,
  getLatestConversationInsight,
  processConversationAnalysis,
} from '../../src/modules/ai/conversation-analysis-service.js';

const intent = {
  primary_intent: 'product_inquiry' as const,
  secondary_intents: [], confidence: 0.82, extracted_entities: {}, missing_information: [],
  suggested_skill: 'product_advisor', requires_human: false, reason: 'Product inquiry evidence.',
};
const emotion = {
  emotion: 'interested' as const, confidence: 0.75, intensity: 0.4,
  suggested_tone: 'warm' as const, escalation_required: false, explanation: 'Interested customer.',
};
const counterparty = {
  role: 'prospect' as const,
  confidence: 0.9,
  reason: 'Đối phương đang hỏi mua sản phẩm của doanh nghiệp.',
};

function trigger(overrides: Record<string, unknown> = {}) {
  return {
    id: 'message-1', senderType: 'contact', content: 'Cho minh xin bao gia', sentAt: new Date(),
    conversation: {
      id: 'conversation-1', orgId: 'org-1', contactId: 'contact-1', threadType: 'user',
      isReplied: false, isPrivate: false, privateOwnerUserId: null,
      contact: { status: 'new', statusRef: { name: 'Moi' } },
      zaloAccount: { privacyMode: 'sub', owner: { id: 'owner-1', role: 'owner', isActive: true } },
      ...overrides,
    },
  };
}

describe('ConversationAnalysisService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(mocks.prisma));
    mocks.prisma.message.findFirst.mockResolvedValueOnce(trigger()).mockResolvedValueOnce({ id: 'message-1' });
    mocks.prisma.message.findMany.mockResolvedValue([
      { senderType: 'contact', content: 'Cho minh xin bao gia' },
      { senderType: 'self', content: 'Bao gia 3 trieu' },
    ]);
    mocks.prisma.aiConversationInsight.findUnique.mockResolvedValue(null);
    mocks.prisma.aiConversationInsight.findFirst.mockResolvedValue(null);
    mocks.prisma.aiConversationInsight.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.aiConversationInsight.create.mockResolvedValue({
      id: 'insight-1', version: 1, stage: 'quoted', nextAction: 'review_quote_follow_up', mode: 'automatic_followup',
    });
    mocks.prisma.aiConversationInsight.update.mockResolvedValue({
      id: 'insight-1', version: 1, stage: 'quoted', nextAction: 'review_quote_follow_up', mode: 'automatic_followup',
    });
    mocks.prisma.aiConfig.findUnique.mockResolvedValue({
      enabled: true, defaultModelConfig: { id: 'model-1', status: 'active', deletedAt: null },
    });
    mocks.prisma.aiAgent.findFirst.mockResolvedValue({
      id: 'agent-1', modelConfigId: 'model-1', promptVersionId: 'prompt-1',
      modelConfig: { status: 'active', deletedAt: null },
    });
    mocks.prisma.aiRun.create.mockResolvedValue({ id: 'run-1' });
    mocks.prisma.aiRun.update.mockResolvedValue({ id: 'run-1' });
    mocks.prisma.aiAuditLog.findFirst.mockResolvedValue(null);
    mocks.reconcileAutomation.mockResolvedValue({ enabled: true, outcome: 'blocked', reason: 'customer_replied' });
    mocks.refreshSummary.mockResolvedValue({ skipped: false, summary: { id: 'summary-1', summaryRedacted: '{"unansweredQuestions":[]}' } });
    mocks.proposeMemories.mockResolvedValue({ contactId: 'contact-1', candidates: [{ id: 'memory-1' }] });
    mocks.analyzeIntent.mockResolvedValue({ output: { ...intent, primary_intent: 'quote_request' } });
    mocks.analyzeEmotion.mockResolvedValue({ output: emotion });
  });

  it('suppresses automation after an explicit opt-out', () => {
    const result = buildShadowRecommendation({
      intent: { ...intent, primary_intent: 'not_interested' }, emotion,
      latestInboundText: 'Đừng nhắn tin và không liên hệ tôi nữa', hasOutboundQuote: false,
      crmStatus: 'Moi', needsReply: true, verifiedPaymentObligation: false,
      counterparty,
    });
    expect(result).toMatchObject({
      stage: 'do_not_contact', nextAction: 'suppress_automation', recommendedWorkflowType: null,
      safeguards: { autoSendAllowed: false, workflowEnrollmentAllowed: false },
    });
  });

  it('blocks payment reminders until a business obligation is verified', () => {
    const result = buildShadowRecommendation({
      intent: { ...intent, primary_intent: 'payment_inquiry', suggested_skill: 'payment_reminder' }, emotion,
      latestInboundText: 'Minh thanh toan nhu the nao?', hasOutboundQuote: true,
      crmStatus: 'Tiep can', needsReply: true, verifiedPaymentObligation: false,
      counterparty,
    });
    expect(result).toMatchObject({
      stage: 'negotiating', requiresHuman: true, nextAction: 'verify_payment_obligation',
      recommendedWorkflowType: null,
      signals: { paymentVerificationRequired: true, verifiedPaymentObligation: false },
    });
  });

  it('turns a concrete quantity order into an order-confirmation task', () => {
    const result = buildShadowRecommendation({
      intent: { ...intent, primary_intent: 'order_intent' }, emotion,
      latestInboundText: 'Cho anh 20 cái ga', hasOutboundQuote: true,
      crmStatus: 'Moi', needsReply: true, verifiedPaymentObligation: false,
      counterparty,
    });
    expect(result).toMatchObject({
      stage: 'won', nextAction: 'confirm_order_details', recommendedWorkflowType: null,
      signals: { explicitOrderConfirmed: true },
    });
    expect(result.nextActionReason).toContain('tạo hoặc hoàn tất đơn hàng');
  });

  it('asks staff to clarify a new image instead of reusing a stale order signal', () => {
    const result = buildShadowRecommendation({
      intent: { ...intent, primary_intent: 'follow_up_response', requires_human: true }, emotion,
      latestInboundText: '',
      recentConversationText: 'Khách đã chốt mua 20 cái ga. Nhân viên đang lên đơn.',
      currentTags: ['Đã mua'],
      hasOutboundQuote: true,
      crmStatus: 'Mới', needsReply: true, verifiedPaymentObligation: false,
      counterparty,
    });
    expect(result).toMatchObject({
      stage: 'won', requiresHuman: true, nextAction: 'clarify_latest_message', recommendedWorkflowType: null,
      signals: { crmWonSignal: true, explicitOrderConfirmed: false, latestMessageNeedsClarification: true },
    });
  });

  it('keeps a complaint escalated even when the customer has purchased', () => {
    const result = buildShadowRecommendation({
      intent: { ...intent, primary_intent: 'complaint', requires_human: true },
      emotion: { ...emotion, emotion: 'angry', escalation_required: true },
      latestInboundText: 'Hàng lỗi, cho tôi gặp nhân viên xử lý',
      recentConversationText: 'Khách đã mua 20 cái ga.',
      currentTags: ['Đã mua'],
      hasOutboundQuote: true,
      crmStatus: 'Mới', needsReply: true, verifiedPaymentObligation: false,
      counterparty,
    });
    expect(result).toMatchObject({
      stage: 'human_required', requiresHuman: true, nextAction: 'assign_to_human',
    });
  });

  it('does not create customer work for a person selling to the business', () => {
    const result = buildShadowRecommendation({
      intent: { ...intent, primary_intent: 'product_inquiry' }, emotion,
      latestInboundText: 'Bên em chuyên cung cấp phần mềm và xin phép gửi báo giá.',
      recentConversationText: 'Công ty chúng tôi muốn giới thiệu dịch vụ đến quý công ty.',
      currentTags: [], hasOutboundQuote: false, crmStatus: null, needsReply: true,
      verifiedPaymentObligation: false,
      counterparty: { role: 'vendor', confidence: 0.94, reason: 'Đang chào bán dịch vụ.' },
    });
    expect(result).toMatchObject({
      stage: 'cold', nextAction: 'ignore_non_customer', recommendedWorkflowType: null,
      signals: { workItemEligible: false, counterpartyRole: 'vendor' },
      safeguards: { autoTagMutationAllowed: false, workflowEnrollmentAllowed: false },
    });
  });

  it('keeps an explicitly unknown contact out of staff work and automation', () => {
    const result = buildShadowRecommendation({
      intent: { ...intent, primary_intent: 'follow_up_response' }, emotion,
      latestInboundText: '', recentConversationText: '[Hình ảnh]\n[Hình ảnh]',
      currentTags: [], hasOutboundQuote: false, crmStatus: null, needsReply: true,
      verifiedPaymentObligation: false,
      counterparty: { role: 'unknown', confidence: 0.91, reason: 'Chưa đủ bằng chứng xác định vai trò.' },
    });

    expect(result).toMatchObject({
      stage: 'needs_reply', nextAction: 'verify_customer_identity', recommendedWorkflowType: null,
      signals: { workItemEligible: false, counterpartyRole: 'unknown', counterpartyClassifierVersion: 2 },
      safeguards: { autoTagMutationAllowed: false, workflowEnrollmentAllowed: false },
    });
  });

  it('persists a versioned insight and reconciles customer automation', async () => {
    const result = await processConversationAnalysis({ orgId: 'org-1', conversationId: 'conversation-1', messageId: 'message-1' });
    expect(result).toMatchObject({ skipped: false, insight: { id: 'insight-1', mode: 'automatic_followup' } });
    expect(mocks.prisma.aiConversationInsight.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        mode: 'automatic_followup', stage: 'quoted', recommendedWorkflowType: 'after_quote',
        safeguards: expect.objectContaining({
          autoSendAllowed: false, workflowEnrollmentAllowed: false, crmStatusMutationAllowed: false,
        }),
      }),
    }));
    expect(mocks.reconcileAutomation).toHaveBeenCalledWith('insight-1');
  });

  it('refreshes the existing insight when force is requested for the same latest message', async () => {
    mocks.prisma.aiConversationInsight.findUnique.mockResolvedValue({ id: 'insight-1', version: 1 });

    const result = await processConversationAnalysis({
      orgId: 'org-1', conversationId: 'conversation-1', messageId: 'message-1', force: true,
    });

    expect(result).toMatchObject({ skipped: false, insight: { id: 'insight-1', refreshed: true } });
    expect(mocks.prisma.aiConversationInsight.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'insight-1' },
      data: expect.objectContaining({ summaryId: 'summary-1', status: 'active' }),
    }));
    expect(mocks.prisma.aiConversationInsight.create).not.toHaveBeenCalled();
  });

  it('uses the organization default model after a provider switch even when the agent still references the old model', async () => {
    mocks.prisma.aiConfig.findUnique.mockResolvedValue({
      enabled: true, defaultModelConfig: { id: 'model-new', status: 'approved', deletedAt: null },
    });
    mocks.prisma.aiAgent.findFirst.mockResolvedValue({
      id: 'agent-1', modelConfigId: 'model-old', promptVersionId: 'prompt-1',
      modelConfig: { status: 'approved', deletedAt: null },
    });

    await processConversationAnalysis({
      orgId: 'org-1', conversationId: 'conversation-1', messageId: 'message-1', force: true,
    });

    expect(mocks.prisma.aiRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ modelConfigId: 'model-new' }),
    }));
  });

  it('skips private conversations before loading AI runtime', async () => {
    mocks.prisma.message.findFirst.mockReset().mockResolvedValue(trigger({ isPrivate: true }));
    const result = await processConversationAnalysis({ orgId: 'org-1', conversationId: 'conversation-1', messageId: 'message-1' });
    expect(result).toEqual({ skipped: true, reason: 'private_conversation' });
    expect(mocks.prisma.aiConfig.findUnique).not.toHaveBeenCalled();
  });

  it('skips an old debounce trigger when a newer inbound message exists', async () => {
    mocks.prisma.message.findFirst.mockReset().mockResolvedValueOnce(trigger()).mockResolvedValueOnce({ id: 'message-newer' });
    const result = await processConversationAnalysis({ orgId: 'org-1', conversationId: 'conversation-1', messageId: 'message-1' });
    expect(result).toEqual({ skipped: true, reason: 'stale_trigger' });
    expect(mocks.prisma.aiRun.create).not.toHaveBeenCalled();
  });

  it('returns a UI-safe insight DTO without internal hashes or run identifiers', async () => {
    mocks.prisma.aiConversationInsight.findFirst.mockReset().mockResolvedValue({
      id: 'insight-1', version: 2, mode: 'shadow', stage: 'quoted', stageConfidence: 0.88,
      stageReasonRedacted: 'Customer has received a quote.', intentLabel: 'quote_request', intentConfidence: 0.9,
      emotionLabel: 'interested', emotionConfidence: 0.78, emotionIntensity: 0.44, requiresHuman: false,
      nextAction: 'review_quote_follow_up', nextActionReasonRedacted: 'Review before follow-up.',
      recommendedWorkflowType: 'after_quote', memoryCandidateIds: ['memory-1'], signals: { needsReply: true },
      safeguards: { autoSendAllowed: false }, createdAt: new Date('2026-08-26T08:00:00Z'),
      updatedAt: new Date('2026-08-26T08:01:00Z'),
      summary: {
        id: 'summary-1', version: 1, sourceThroughMessageId: 'message-1', createdAt: new Date('2026-08-26T08:00:00Z'),
        summaryRedacted: '{"currentDiscussion":"Customer is reviewing the quote.","unansweredQuestions":[]}',
      },
    });
    mocks.prisma.aiCustomerMemory.findMany.mockResolvedValue([
      { id: 'memory-1', key: 'budget_range', valueRedacted: '3-4 million', status: 'candidate', confidence: 0.8, updatedAt: new Date() },
    ]);

    const result = await getLatestConversationInsight(
      { orgId: 'org-1', userId: 'owner-1', role: 'owner', privacyUnlocked: false },
      'conversation-1',
    );

    expect(result).toMatchObject({
      id: 'insight-1', mode: 'shadow', stage: 'quoted', stageReason: 'Customer has received a quote.',
      intent: { label: 'quote_request', confidence: 0.9 },
      nextAction: { key: 'review_quote_follow_up', workflowType: 'after_quote' },
      summary: { content: { currentDiscussion: 'Customer is reviewing the quote.' } },
      safeguards: { autoSendAllowed: false },
    });
    expect(result).not.toHaveProperty('analysisHash');
    expect(result).not.toHaveProperty('runId');
    expect(result).not.toHaveProperty('orgId');
  });
});
