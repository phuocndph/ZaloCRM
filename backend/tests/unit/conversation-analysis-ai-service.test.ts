import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  getObjectBuffer: vi.fn(),
  keyFromPublicUrl: vi.fn(),
}));

vi.mock('../../src/modules/ai/core/index.js', () => ({
  aiClient: { complete: mocks.complete },
}));
vi.mock('../../src/shared/storage/minio-client.js', () => ({
  getObjectBuffer: mocks.getObjectBuffer,
  keyFromPublicUrl: mocks.keyFromPublicUrl,
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
    mocks.getObjectBuffer.mockResolvedValue(null);
    mocks.keyFromPublicUrl.mockReturnValue('');
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
        counterparty: {
          role: 'prospect',
          confidence: 0.92,
          reason: 'Đối phương đang hỏi giá và cân nhắc mua sản phẩm.',
        },
        memories: [{
          key: 'interested_product',
          value: 'Khách quan tâm ga kích thước 120x200x22 cm.',
          confidence: 0.9,
          evidenceMessageIds: ['message-1'],
        }],
        groupAction: null,
      },
      model: 'gpt-test',
      provider: 'f5quota',
      usage: { inputTokens: 500, outputTokens: 250, cachedInputTokens: 0, estimatedCostUsd: 0 },
    });
  });

  it('prepares a compact chronological transcript with explicit speakers', () => {
    const prepared = prepareConversationAnalysisInput(context());

    expect(prepared.previousSummary).toEqual({ currentDiscussion: 'Khách đã hỏi báo giá.' });
    expect(prepared.conversationState.contactIsWaitingForReply).toBe(true);
    expect(prepared.transcript.map((message) => [message.messageId, message.speaker])).toEqual([
      ['message-1', 'Người liên hệ'],
      ['message-2', 'Nhân viên'],
      ['message-3', 'Người liên hệ'],
    ]);
    expect(prepared.conversationState.latestContactMessage?.messageId).toBe('message-3');
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
    expect(request.messages[1].content).toContain('Người liên hệ');
    expect(request.messages[0].content).toContain('không được mặc định mọi người liên hệ đều là khách hàng');
    expect(result.summary.currentDiscussion).toContain('Khách đang kiểm tra');
    expect(result.counterparty).toMatchObject({ role: 'prospect' });
    expect(result.memories).toEqual([
      expect.objectContaining({
        key: 'interested_product',
        value: 'Khách quan tâm ga kích thước 120x200x22 cm.',
        evidence: [expect.objectContaining({ messageId: 'message-1' })],
      }),
    ]);
  });

  it('attaches recent customer images as optimized vision input', async () => {
    const imageContext = context();
    const recent = imageContext.sections.find((section) => section.id === 'recent_messages')!;
    recent.items = [
      ...(recent.items as any[]),
      {
        id: 'message-image', senderType: 'contact', contentType: 'image', content: '[Hình ảnh]',
        mediaUrl: '/files/media/customer-image.png', sentAt: '2026-08-28T09:03:00.000Z',
      },
    ];
    mocks.keyFromPublicUrl.mockReturnValue('media/customer-image.png');
    mocks.getObjectBuffer.mockResolvedValue(await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#ffffff' },
    }).png().toBuffer());

    await analyzePreparedConversation({
      orgId: 'org-1', modelConfigId: 'model-1', context: imageContext,
    });

    const request = mocks.complete.mock.calls[0][0];
    expect(Array.isArray(request.messages[1].content)).toBe(true);
    expect(request.messages[1].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text' }),
      expect.objectContaining({
        type: 'image_url',
        image_url: expect.objectContaining({ url: expect.stringMatching(/^data:image\/jpeg;base64,/) }),
      }),
    ]));
  });

  it('keeps group sender identity and rejects customer memories for group analysis', async () => {
    const groupContext = context();
    groupContext.sections = [
      {
        id: 'group_profile', title: 'Group profile', priority: 98, tokenEstimate: 20,
        items: { groupName: 'Nhóm bán hàng', category: 'sales', monitoringEnabled: true }, sources: ['conversation-1'],
      },
      {
        id: 'recent_messages', title: 'Recent messages', priority: 92, tokenEstimate: 80,
        items: [
          { id: 'group-message-1', senderType: 'contact', senderUid: 'member-1', senderName: 'Nguyễn An', content: 'Cho tôi xin báo giá 20 bộ', sentAt: '2026-08-28T09:00:00.000Z' },
          { id: 'group-message-2', senderType: 'contact', senderUid: 'vendor-1', senderName: 'Nhà cung cấp', content: 'Bên em chuyên vận chuyển giá tốt', sentAt: '2026-08-28T09:01:00.000Z' },
        ],
        sources: ['group-message-1', 'group-message-2'],
      },
    ];
    const directOutput = (await mocks.complete()).structured;
    mocks.complete.mockReset().mockResolvedValue({
      structured: {
        ...directOutput,
        counterparty: { role: 'prospect', confidence: 0.95, reason: 'Nguyễn An đang hỏi mua sản phẩm.' },
        groupAction: {
          actionable: true,
          senderUid: 'member-1',
          senderName: 'Nguyễn An',
          messageId: 'group-message-1',
          request: 'Nguyễn An cần báo giá 20 bộ sản phẩm.',
          requiredAction: 'Kiểm tra quy cách và gửi báo giá 20 bộ cho Nguyễn An trong nhóm.',
          reason: 'Thành viên đã nêu nhu cầu mua và số lượng cụ thể.',
        },
      },
      model: 'gpt-test', provider: 'f5quota',
      usage: { inputTokens: 500, outputTokens: 250, cachedInputTokens: 0, estimatedCostUsd: 0 },
    });

    const result = await analyzePreparedConversation({ orgId: 'org-1', modelConfigId: 'model-1', context: groupContext });

    expect(result.preparedInput.conversationKind).toBe('group');
    expect(result.preparedInput.transcript[0]).toMatchObject({ senderUid: 'member-1', senderName: 'Nguyễn An' });
    expect(result.groupAction).toMatchObject({ senderUid: 'member-1', messageId: 'group-message-1' });
    expect(result.memories).toEqual([]);
    expect(mocks.complete.mock.calls[0][0].messages[1].content).toContain('Đây là HỘI THOẠI NHÓM');
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
