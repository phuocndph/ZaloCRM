import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    aiConversationInsight: { findUnique: vi.fn(), findMany: vi.fn() },
    aiAuditLog: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    contactTag: { findMany: vi.fn() },
    conversation: { findFirst: vi.fn() },
    message: { findUnique: vi.fn() },
    contact: { findFirst: vi.fn(), updateMany: vi.fn() },
    friend: { findFirst: vi.fn() },
    followupEnrollment: { findFirst: vi.fn() },
    followupWorkflow: { findFirst: vi.fn() },
    followupLog: { create: vi.fn() },
  } as any,
  enroll: vi.fn(),
  stop: vi.fn(),
  createWorkflow: vi.fn(),
  setStatus: vi.fn(),
  addTag: vi.fn(),
  removeTag: vi.fn(),
}));

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../src/shared/utils/logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../src/modules/followup/followup-engine.js', () => ({
  enrollContact: mocks.enroll,
  stopEnrollment: mocks.stop,
}));
vi.mock('../../src/modules/followup/followup-service.js', () => ({
  createWorkflow: mocks.createWorkflow,
  setStatus: mocks.setStatus,
}));
vi.mock('../../src/modules/tags/tag-service.js', () => ({
  addCrmTag: mocks.addTag,
  removeCrmTag: mocks.removeTag,
}));

import {
  desiredAutomatedTags,
  normalizeAutomationWorkflowType,
  reconcileCustomerAutomation,
} from '../../src/modules/ai/customer-automation-orchestrator.js';

function insight(overrides: Record<string, unknown> = {}) {
  return {
    id: 'insight-1',
    orgId: 'org-1',
    runId: 'run-1',
    conversationId: 'conversation-1',
    contactId: 'contact-1',
    sourceThroughMessageId: 'message-1',
    stage: 'quoted',
    intentLabel: 'quote_request',
    requiresHuman: false,
    recommendedWorkflowType: 'after_quote',
    nextAction: 'review_quote_follow_up',
    analysisHash: 'hash-1',
    signals: {},
    safeguards: {},
    ...overrides,
  };
}

function active(type = 'reengage', enrolledByName = 'AI chăm sóc khách hàng') {
  return {
    id: 'enrollment-old',
    workflowId: `workflow-${type}`,
    enrolledByName,
    workflow: { id: `workflow-${type}`, name: type, type },
  };
}

describe('CustomerAutomationOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_CUSTOMER_AUTOMATION_ENABLED = 'true';
    mocks.prisma.aiConversationInsight.findUnique.mockResolvedValue(insight());
    mocks.prisma.aiAuditLog.findFirst.mockResolvedValue(null);
    mocks.prisma.aiAuditLog.create.mockResolvedValue({});
    mocks.prisma.contactTag.findMany.mockResolvedValue([]);
    mocks.prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1', zaloAccountId: 'account-1', isPrivate: false, threadType: 'user',
    });
    mocks.prisma.message.findUnique.mockResolvedValue({ senderType: 'self' });
    mocks.prisma.contact.findFirst.mockResolvedValue({ consentStatus: 'implicit' });
    mocks.prisma.contact.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.friend.findFirst.mockResolvedValue({
      friendshipStatus: 'accepted', strangerBlocked: false, zaloAccountId: 'account-1',
    });
    mocks.prisma.followupEnrollment.findFirst.mockResolvedValue(null);
    mocks.prisma.followupWorkflow.findFirst.mockResolvedValue({
      id: 'workflow-after-quote', name: 'Auto quote', type: 'after_quote', status: 'active',
    });
    mocks.enroll.mockResolvedValue({ ok: true, enrollmentId: 'enrollment-new' });
    mocks.stop.mockResolvedValue(undefined);
    mocks.createWorkflow.mockResolvedValue({ id: 'workflow-generated' });
    mocks.setStatus.mockResolvedValue({});
    mocks.addTag.mockResolvedValue({ tag: { id: 'tag-1' }, contactTagId: 'ct-1' });
    mocks.removeTag.mockResolvedValue(undefined);
    mocks.prisma.followupLog.create.mockResolvedValue({});
  });

  it('normalizes workflow names and keeps the AI tag taxonomy controlled', () => {
    expect(normalizeAutomationWorkflowType('after-quote')).toBe('after_quote');
    expect(normalizeAutomationWorkflowType('post-sale-care')).toBe('post_sale');
    expect(desiredAutomatedTags('human_required', 'complaint')).toEqual([
      'Cần nhân viên xử lý', 'Khiếu nại',
    ]);
  });

  it('is idempotent for the same insight hash', async () => {
    mocks.prisma.aiAuditLog.findFirst.mockResolvedValue({
      metadata: { enabled: true, reason: 'workflow_enrolled', desiredWorkflowType: 'after_quote', enrollmentId: 'enrollment-1', actions: [] },
    });

    const result = await reconcileCustomerAutomation('insight-1');

    expect(result.outcome).toBe('already_processed');
    expect(mocks.prisma.conversation.findFirst).not.toHaveBeenCalled();
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it('stops an active workflow as soon as the customer replies', async () => {
    mocks.prisma.message.findUnique.mockResolvedValue({ senderType: 'contact' });
    mocks.prisma.followupEnrollment.findFirst.mockResolvedValue(active('after_quote'));

    const result = await reconcileCustomerAutomation('insight-1');

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'customer_replied' });
    expect(mocks.stop).toHaveBeenCalledWith(
      'enrollment-old',
      'customer_replied',
      expect.objectContaining({ actorType: 'system' }),
    );
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it('keeps a matching workflow and removes only stale AI-owned tags', async () => {
    mocks.prisma.followupEnrollment.findFirst.mockResolvedValue(active('after_quote'));
    mocks.prisma.contactTag.findMany.mockResolvedValue([
      { tagId: 'tag-cold', tag: { name: 'Khách đang nguội' } },
      { tagId: 'tag-quoted', tag: { name: 'Đã báo giá' } },
    ]);

    const result = await reconcileCustomerAutomation('insight-1');

    expect(result).toMatchObject({ outcome: 'no_change', reason: 'same_workflow_kept' });
    expect(mocks.prisma.contactTag.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ addedVia: 'ai_suggest', removedAt: null }),
    }));
    expect(mocks.removeTag).toHaveBeenCalledWith({ contactId: 'contact-1', tagId: 'tag-cold', removedBy: null });
    expect(mocks.removeTag).not.toHaveBeenCalledWith(expect.objectContaining({ tagId: 'tag-quoted' }));
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it('switches an AI-managed workflow when the customer stage changes', async () => {
    mocks.prisma.followupEnrollment.findFirst.mockResolvedValue(active('reengage'));

    const result = await reconcileCustomerAutomation('insight-1');

    expect(result).toMatchObject({ outcome: 'success', reason: 'workflow_switched', enrollmentId: 'enrollment-new' });
    expect(mocks.enroll).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'workflow-after-quote',
      onConflict: 'switch',
      reason: 'switched',
    }));
  });

  it('preserves a workflow selected manually by staff', async () => {
    mocks.prisma.followupEnrollment.findFirst.mockResolvedValue(active('reengage', 'Nguyễn Văn Sale'));

    const result = await reconcileCustomerAutomation('insight-1');

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'manual_workflow_preserved' });
    expect(mocks.enroll).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it('stops an AI-managed workflow when the new stage no longer needs follow-up', async () => {
    mocks.prisma.aiConversationInsight.findUnique.mockResolvedValue(insight({
      stage: 'discovery', intentLabel: 'product_inquiry', recommendedWorkflowType: null,
      nextAction: 'review_conversation', analysisHash: 'hash-discovery',
    }));
    mocks.prisma.followupEnrollment.findFirst.mockResolvedValue(active('after_quote'));

    const result = await reconcileCustomerAutomation('insight-1');

    expect(result).toMatchObject({ outcome: 'success', reason: 'workflow_no_longer_applicable', enrollmentId: null });
    expect(mocks.stop).toHaveBeenCalledWith(
      'enrollment-old',
      'no_longer_applicable',
      expect.objectContaining({ actorType: 'system' }),
    );
  });

  it('blocks customer automation and replaces stale sales tags for a vendor', async () => {
    mocks.prisma.aiConversationInsight.findUnique.mockResolvedValue(insight({
      stage: 'cold', intentLabel: 'product_inquiry', recommendedWorkflowType: null,
      nextAction: 'ignore_non_customer', analysisHash: 'hash-vendor',
      signals: {
        counterpartyRole: 'vendor',
        counterpartyConfidence: 0.94,
        counterpartyReason: 'Đối phương đang chào bán dịch vụ.',
      },
    }));
    mocks.prisma.followupEnrollment.findFirst.mockResolvedValue(active('after_quote'));
    mocks.prisma.contactTag.findMany.mockResolvedValue([
      { tagId: 'tag-quoted', tag: { name: 'Đã báo giá' } },
    ]);

    const result = await reconcileCustomerAutomation('insight-1');

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'not_a_customer' });
    expect(mocks.removeTag).toHaveBeenCalledWith({ contactId: 'contact-1', tagId: 'tag-quoted', removedBy: null });
    expect(mocks.addTag).toHaveBeenCalledWith(expect.objectContaining({ tagName: 'Người chào hàng' }));
    expect(mocks.stop).toHaveBeenCalledWith('enrollment-old', 'not_a_customer', expect.objectContaining({ actorType: 'system' }));
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it('does not stop a workflow that staff selected manually when classifying a vendor', async () => {
    mocks.prisma.aiConversationInsight.findUnique.mockResolvedValue(insight({
      stage: 'cold', intentLabel: 'product_inquiry', recommendedWorkflowType: null,
      nextAction: 'ignore_non_customer', analysisHash: 'hash-manual-vendor',
      signals: {
        counterpartyRole: 'vendor',
        counterpartyConfidence: 0.94,
        counterpartyReason: 'Đối phương đang chào bán dịch vụ.',
      },
    }));
    mocks.prisma.followupEnrollment.findFirst.mockResolvedValue(active('after_quote', 'Nguyễn Văn Sale'));

    const result = await reconcileCustomerAutomation('insight-1');

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'not_a_customer', enrollmentId: 'enrollment-old' });
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it('preserves tags and workflow when model fallback cannot confirm the customer role', async () => {
    mocks.prisma.aiConversationInsight.findUnique.mockResolvedValue(insight({
      analysisHash: 'hash-pending',
      signals: {
        counterpartyRole: 'unknown',
        counterpartyConfidence: 0.4,
        counterpartyReason: 'Chưa đủ dữ liệu.',
        counterpartyClassifierVersion: 2,
        workItemEligible: false,
        analysisModelFallback: true,
      },
    }));
    mocks.prisma.followupEnrollment.findFirst.mockResolvedValue(active('after_quote'));
    mocks.prisma.contactTag.findMany.mockResolvedValue([
      { tagId: 'tag-quoted', tag: { name: 'Đã báo giá' } },
    ]);

    const result = await reconcileCustomerAutomation('insight-1');

    expect(result).toMatchObject({ outcome: 'no_change', reason: 'analysis_pending', enrollmentId: 'enrollment-old' });
    expect(mocks.removeTag).not.toHaveBeenCalled();
    expect(mocks.addTag).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it('removes stale AI sales state when the current model explicitly remains uncertain', async () => {
    mocks.prisma.aiConversationInsight.findUnique.mockResolvedValue(insight({
      analysisHash: 'hash-unknown',
      signals: {
        counterpartyRole: 'unknown',
        counterpartyConfidence: 0.87,
        counterpartyReason: 'Chưa xác định được chiều mua bán.',
        counterpartyClassifierVersion: 2,
        workItemEligible: false,
      },
    }));
    mocks.prisma.followupEnrollment.findFirst.mockResolvedValue(active('after_quote'));
    mocks.prisma.contactTag.findMany.mockResolvedValue([
      { tagId: 'tag-negotiating', tag: { name: 'Đang thương lượng' } },
    ]);

    const result = await reconcileCustomerAutomation('insight-1');

    expect(result).toMatchObject({ outcome: 'success', reason: 'customer_identity_unconfirmed', enrollmentId: null });
    expect(mocks.removeTag).toHaveBeenCalledWith({ contactId: 'contact-1', tagId: 'tag-negotiating', removedBy: null });
    expect(mocks.stop).toHaveBeenCalledWith(
      'enrollment-old',
      'customer_identity_unconfirmed',
      expect.objectContaining({ actorType: 'system' }),
    );
  });

  it('provisions and activates a safe wait-first workflow when none exists', async () => {
    mocks.prisma.followupWorkflow.findFirst.mockResolvedValue(null);

    const result = await reconcileCustomerAutomation('insight-1');

    expect(result).toMatchObject({ outcome: 'success', reason: 'workflow_enrolled' });
    expect(mocks.createWorkflow).toHaveBeenCalledWith(
      'org-1',
      expect.any(Object),
      expect.objectContaining({
        type: 'after_quote',
        steps: expect.arrayContaining([
          expect.objectContaining({ key: 'start', nextKey: 'wait_1' }),
          expect.objectContaining({ key: 'wait_1', type: 'wait' }),
        ]),
      }),
    );
    expect(mocks.setStatus).toHaveBeenCalledWith('workflow-generated', 'org-1', 'active');
    expect(mocks.enroll).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'workflow-generated' }));
  });

  it('respects a manager-paused automatic workflow', async () => {
    mocks.prisma.followupWorkflow.findFirst.mockResolvedValue({
      id: 'workflow-paused', name: 'Auto quote', type: 'after_quote', status: 'paused', createdByName: 'AI chăm sóc khách hàng',
    });

    const result = await reconcileCustomerAutomation('insight-1');

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'workflow_not_active' });
    expect(mocks.enroll).not.toHaveBeenCalled();
    expect(mocks.setStatus).not.toHaveBeenCalled();
  });

  it('blocks opt-out and human-required cases without enrolling', async () => {
    mocks.prisma.aiConversationInsight.findUnique.mockResolvedValue(insight({
      stage: 'do_not_contact', intentLabel: 'complaint', requiresHuman: true,
      recommendedWorkflowType: null, nextAction: 'suppress_automation', analysisHash: 'hash-optout',
    }));
    mocks.prisma.followupEnrollment.findFirst.mockResolvedValue(active('after_quote'));

    const result = await reconcileCustomerAutomation('insight-1');

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'do_not_contact' });
    expect(mocks.prisma.contact.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ consentStatus: 'revoked', consentSource: 'ai_explicit_opt_out' }),
    }));
    expect(mocks.stop).toHaveBeenCalled();
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it('does not mutate tags for a private conversation', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue({
      id: 'conversation-1', zaloAccountId: 'account-1', isPrivate: true, threadType: 'user',
    });

    const result = await reconcileCustomerAutomation('insight-1');

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'conversation_not_eligible' });
    expect(mocks.addTag).not.toHaveBeenCalled();
    expect(mocks.removeTag).not.toHaveBeenCalled();
  });

  it('preserves the do-not-contact tag after consent was revoked', async () => {
    mocks.prisma.contact.findFirst.mockResolvedValue({ consentStatus: 'revoked' });
    mocks.prisma.contactTag.findMany.mockResolvedValue([
      { tagId: 'tag-dnc', tag: { name: 'Không liên hệ' } },
    ]);

    const result = await reconcileCustomerAutomation('insight-1');

    expect(result).toMatchObject({ outcome: 'blocked', reason: 'do_not_contact' });
    expect(mocks.removeTag).not.toHaveBeenCalledWith(expect.objectContaining({ tagId: 'tag-dnc' }));
  });
});
