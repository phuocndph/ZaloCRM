import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
}));

vi.mock('../../src/modules/ai/core/index.js', () => ({
  aiClient: { complete: mocks.complete },
}));

import {
  analyzePreparedConversation,
  prepareConversationAnalysisInput,
} from '../../src/modules/ai/conversation-analysis-ai-service.js';
import type { ConversationContext } from '../../src/modules/ai/conversation-context-builder-service.js';

function context(): ConversationContext {
  return {
    conversationId: 'conversation-1',
    orgId: 'org-1',
    generatedAt: '2026-08-28T10:00:00.000Z',
    tokenBudget: 2600,
    tokenEstimate: 500,
    truncated: false,
    truncation: { droppedSections: [], droppedMessages: 0, originalTokenEstimate: 500 },
    access: {
      allowed: true,
      contentVisible: true,
      reason: 'ok',
      scope: 'conversation',
      userId: 'owner-1',
      role: 'owner',
      privacy: { conversationPrivate: false, privacyUnlocked: false },
    },
    sections: [
      {
        id: 'customer_profile', title: 'Customer profile', priority: 90, tokenEstimate: 20,
        items: { contactId: 'contact-1', displayName: 'Khách A' }, sources: ['contact-1'],
      },
      {
        id: 'sales_state', title: 'Sales state', priority: 86, tokenEstimate: 20,
        items: { contactStatus: 'Mới', isReplied: false }, sources: ['contact-1'],
      },
      {
        id: 'conversation_summary', title: 'Previous summary', priority: 95, tokenEstimate: 30,
        items: { summary: JSON.stringify({ currentDiscussion: 'Khách đã hỏi báo giá.' }) }, sources: ['summary-1'],
      },
      {
        id: 'recent_messages', title: 'Recent messages', priority: 92, tokenEstimate: 100,
        items: [
          { id: 'message-1', senderType: 'contact', content: 'ga 120x200x22cm gia bao nhieu', sentAt: '2026-08-28T09:00:00.000Z' },
          { id: 'message-2', senderType: 'self', content: 'Giá 250.000 đồng một chiếc ạ.', sentAt: '2026-08-28T09:01:00.000Z' },
          { id: 'message-3', senderType: 'contact', content: 'de toi kiem tra con thieu khung noi khong', sentAt: '2026-08-28T09:02:00.000Z' },
        ],
        sources: ['message-1', 'message-2', 'message-3'],
      },
    ],
    sources: [],
  };
}

describe('ConversationAnalysisAiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.complete.mockResolvedValue({
      structured: {
        summary: {
          currentDiscussion: 'Khách đang kiểm tra xem còn thiếu khung nối cho ga 120x200x22 cm hay không.',
          unansweredQuestions: [],
          currentProduct: 'Ga 120x200x22 cm',
          currentEmotion: 'Đang cân nhắc',
        },
        intent: {
          primary_intent: 'follow_up_response',
          secondary_intents: ['product_inquiry'],
          confidence: 0.87,
          missing_information: [],
          requires_human: false,
          reason: 'Khách cho biết sẽ kiểm tra lại trước khi phản hồi.',
        },
        emotion: {
          emotion: 'hesitant',
          confidence: 0.79,
          intensity: 0.35,
          suggested_tone: 'reassuring',
          escalation_required: false,
          explanation: 'Khách đang cân nhắc và chưa đưa ra quyết định cuối cùng.',
        },
        memories: [{
          key: 'interested_product',
          value: 'Khách quan tâm ga kích thước 120x200x22 cm.',
          confidence: 0.9,
          evidenceMessageIds: ['message-1'],
        }],
      },
      model: 'gpt-test',
      provider: 'f5quota',
      usage: { inputTokens: 500, outputTokens: 250, cachedInputTokens: 0, estimatedCostUsd: 0 },
    });
  });

  it('prepares a compact chronological transcript with explicit speakers', () => {
    const prepared = prepareConversationAnalysisInput(context());

    expect(prepared.previousSummary).toEqual({ currentDiscussion: 'Khách đã hỏi báo giá.' });
    expect(prepared.conversationState.customerIsWaitingForReply).toBe(true);
    expect(prepared.transcript.map((message) => [message.messageId, message.speaker])).toEqual([
      ['message-1', 'Khách hàng'],
      ['message-2', 'Nhân viên'],
      ['message-3', 'Khách hàng'],
    ]);
    expect(prepared.conversationState.latestCustomerMessage?.messageId).toBe('message-3');
  });

  it('uses one Vietnamese prompt and keeps only memory evidence present in the transcript', async () => {
    const result = await analyzePreparedConversation({
      orgId: 'org-1',
      modelConfigId: 'model-1',
      runId: 'run-1',
      context: context(),
    });

    expect(mocks.complete).toHaveBeenCalledTimes(1);
    const request = mocks.complete.mock.calls[0][0];
    expect(request.taskType).toBe('conversation_analysis_combined');
    expect(request.messages[0].content).toContain('tiếng Việt tự nhiên, chuẩn UTF-8 và có dấu đầy đủ');
    expect(request.messages[0].content).toContain('Nếu chủ đề đã đổi, không trộn chủ đề cũ');
    expect(request.messages[1].content).toContain('Khách hàng');
    expect(result.summary.currentDiscussion).toContain('Khách đang kiểm tra');
    expect(result.memories).toEqual([
      expect.objectContaining({
        key: 'interested_product',
        value: 'Khách quan tâm ga kích thước 120x200x22 cm.',
        evidence: [expect.objectContaining({ messageId: 'message-1' })],
      }),
    ]);
  });

  it('repairs English or unaccented display text before it can be persisted', async () => {
    const accented = (await mocks.complete()).structured;
    mocks.complete.mockReset()
      .mockResolvedValueOnce({
        structured: {
          ...accented,
          summary: { ...accented.summary, currentDiscussion: 'Khach dang kiem tra xem con thieu khung noi khong.' },
          memories: [{
            key: 'communication_style',
            value: 'Customer prefers direct brief messages.',
            confidence: 0.8,
            evidenceMessageIds: ['message-3'],
          }],
        },
        model: 'gpt-test', provider: 'f5quota',
        usage: { inputTokens: 500, outputTokens: 250, cachedInputTokens: 0, estimatedCostUsd: 0 },
      })
      .mockResolvedValueOnce({
        structured: accented,
        model: 'gpt-test', provider: 'f5quota',
        usage: { inputTokens: 100, outputTokens: 100, cachedInputTokens: 0, estimatedCostUsd: 0 },
      });

    const result = await analyzePreparedConversation({
      orgId: 'org-1', modelConfigId: 'model-1', context: context(),
    });

    expect(mocks.complete).toHaveBeenCalledTimes(2);
    expect(mocks.complete.mock.calls[1][0].taskType).toBe('conversation_analysis_language_repair');
    expect(result.summary.currentDiscussion).toContain('Khách đang kiểm tra');
    expect(result.memories[0]?.value).toContain('Khách quan tâm');
  });
});
