// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConversationInsightCard from './ConversationInsightCard.vue';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/api', () => ({ api: { get: mocks.get, post: mocks.post } }));

describe('ConversationInsightCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the insight and explains the automatic follow-up state', async () => {
    mocks.get.mockResolvedValue({
      data: {
        readiness: { aiStatus: 'ready', accountStatus: 'connected', accountName: 'Nick bán hàng' },
        insight: {
          id: 'insight-1', version: 1, mode: 'automatic_followup', stage: 'quoted', stageConfidence: 0.88,
          stageReason: 'Khách đã nhận báo giá.', intent: { label: 'quote_request', confidence: 0.9 },
          emotion: { label: 'interested', confidence: 0.8, intensity: 0.4 }, requiresHuman: false,
          nextAction: { key: 'review_quote_follow_up', reason: 'Kiểm tra báo giá trước khi follow-up.', workflowType: 'after_quote' },
          signals: {}, safeguards: { autoSendAllowed: false, workflowEnrollmentAllowed: false, crmStatusMutationAllowed: false },
          automation: { enabled: true, outcome: 'success', reason: 'workflow_enrolled', enrollmentId: 'enrollment-1', updatedAt: '2026-08-26T08:01:00Z' },
          summary: {
            id: 'summary-1', version: 1, sourceThroughMessageId: 'message-1', createdAt: '2026-08-26T08:00:00Z',
            content: { currentDiscussion: 'Khách đang cân nhắc báo giá.', unansweredQuestions: ['Thời gian giao hàng là khi nào?'] },
          },
          memoryCandidates: [
            { id: 'memory-1', key: 'budget_range', valueRedacted: '3-4 triệu', status: 'candidate', confidence: 0.8, updatedAt: '2026-08-26T08:00:00Z' },
          ],
          createdAt: '2026-08-26T08:00:00Z', updatedAt: '2026-08-26T08:01:00Z',
        },
      },
    });

    const wrapper = mount(ConversationInsightCard, { props: { conversationId: 'conversation-1' } });
    await flushPromises();

    expect(wrapper.text()).toContain('Việc cần xử lý');
    expect(wrapper.text()).toContain('Khách đang cần gì');
    expect(wrapper.text()).toContain('Khách đang cân nhắc báo giá.');
    expect(wrapper.text()).toContain('Nhân viên cần làm ngay');
    expect(wrapper.text()).toContain('Xem lại nội dung báo giá để follow-up');
    expect(wrapper.text()).toContain('Điều cần chú ý');
    expect(wrapper.text()).toContain('Cần làm rõ: Thời gian giao hàng là khi nào?');
    expect(wrapper.text()).toContain('Ngân sách: 3-4 triệu');
    expect(wrapper.text()).toContain('Theo dõi tự động');
    expect(wrapper.text()).toContain('AI đã tự lên lịch chăm sóc');
    expect(wrapper.text()).not.toMatch(/Độ tin cậy|Ý định|Cảm xúc|Priority|Engagement|Lead Score/);
    expect(wrapper.text()).not.toMatch(/Gửi ngay|Tự gửi|Kích hoạt workflow/);
  });

  it('shows a concrete order task instead of asking staff to interpret the sales stage', async () => {
    mocks.get.mockResolvedValue({
      data: {
        readiness: { aiStatus: 'ready', accountStatus: 'connected', accountName: 'Nick bán hàng' },
        insight: {
          id: 'insight-order', version: 2, mode: 'shadow', stage: 'won', stageConfidence: 0.95,
          stageReason: 'Khách đã chốt sản phẩm và số lượng cụ thể.',
          intent: { label: 'order_intent', confidence: 0.95 },
          emotion: { label: 'interested', confidence: 0.8, intensity: 0.4 }, requiresHuman: false,
          nextAction: {
            key: 'confirm_order_details',
            reason: 'Kiểm tra quy cách, số lượng, thông tin giao nhận và tạo hoặc hoàn tất đơn hàng.',
            workflowType: null,
          },
          signals: {}, safeguards: {},
          summary: {
            id: 'summary-order', version: 2, sourceThroughMessageId: 'message-order', createdAt: '2026-08-29T00:00:00Z',
            content: { currentDiscussion: 'Khách đã chốt lấy 20 cái ga.', unansweredQuestions: [] },
          },
          memoryCandidates: [
            { id: 'memory-product', key: 'interested_product', valueRedacted: 'Ga 120x200x22cm', status: 'candidate', confidence: 0.9, updatedAt: '2026-08-29T00:00:00Z' },
            { id: 'memory-order', key: 'previous_order', valueRedacted: 'Khách vừa chốt 20 cái ga', status: 'candidate', confidence: 0.9, updatedAt: '2026-08-29T00:00:00Z' },
          ], createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-29T00:01:00Z',
        },
      },
    });

    const wrapper = mount(ConversationInsightCard, { props: { conversationId: 'conversation-order' } });
    await flushPromises();

    expect(wrapper.text()).toContain('Đã chốt');
    expect(wrapper.text()).toContain('Xác nhận và lên đơn');
    expect(wrapper.text()).not.toContain('Chuẩn bị báo giá');
    expect(wrapper.text()).not.toContain('Đơn hàng trước');
    expect(wrapper.text()).not.toContain('Sản phẩm quan tâm');
  });

  it('does not present an unconfirmed contact as mandatory sales work', async () => {
    mocks.get.mockResolvedValue({
      data: {
        readiness: { aiStatus: 'ready', accountStatus: 'connected', accountName: 'Nick bán hàng' },
        insight: {
          id: 'insight-unknown', version: 3, mode: 'automatic_followup', stage: 'needs_reply', stageConfidence: 0.91,
          stageReason: 'Chưa có đủ bằng chứng xác định đây là khách mua hàng.',
          intent: { label: 'unknown', confidence: 0.7 },
          emotion: { label: 'neutral', confidence: 0.8, intensity: 0.1 }, requiresHuman: false,
          nextAction: {
            key: 'verify_customer_identity',
            reason: 'Chỉ xem thủ công khi có thêm bằng chứng người liên hệ đang mua hàng.',
            workflowType: null,
          },
          signals: {
            counterpartyClassifierVersion: 2,
            counterpartyRole: 'unknown',
            workItemEligible: false,
          },
          safeguards: { autoSendAllowed: false, workflowEnrollmentAllowed: false, autoTagMutationAllowed: false },
          automation: {
            enabled: true, outcome: 'success', reason: 'customer_identity_unconfirmed',
            enrollmentId: null, updatedAt: '2026-08-30T08:01:00Z',
          },
          summary: {
            id: 'summary-unknown', version: 3, sourceThroughMessageId: 'message-image', createdAt: '2026-08-30T08:00:00Z',
            content: { currentDiscussion: 'Người liên hệ chỉ gửi hai ảnh, chưa có nội dung xác nhận nhu cầu mua hàng.', unansweredQuestions: [] },
          },
          memoryCandidates: [], createdAt: '2026-08-30T08:00:00Z', updatedAt: '2026-08-30T08:01:00Z',
        },
      },
    });

    const wrapper = mount(ConversationInsightCard, { props: { conversationId: 'conversation-unknown' } });
    await flushPromises();

    expect(wrapper.text()).toContain('Chưa tạo việc chăm sóc');
    expect(wrapper.text()).toContain('AI không đưa vào danh sách công việc');
    expect(wrapper.text()).toContain('Hướng xử lý');
    expect(wrapper.text()).not.toContain('Nhân viên cần làm ngay');
    expect(wrapper.text()).toContain('Không tự động chăm sóc khi chưa rõ vai trò');
  });

  it('explains why an empty insight cannot update when Zalo and AI are unavailable', async () => {
    mocks.get.mockResolvedValue({
      data: {
        insight: null,
        readiness: { aiStatus: 'error', accountStatus: 'disconnected', accountName: 'Minh Roomqc' },
      },
    });

    const wrapper = mount(ConversationInsightCard, { props: { conversationId: 'conversation-offline' } });
    await flushPromises();

    expect(wrapper.text()).toContain('Minh Roomqc đang mất kết nối.');
    expect(wrapper.text()).toContain('AI nâng cao chưa sẵn sàng.');
    expect(wrapper.text()).toContain('Chưa có ghi chú phân tích');
    expect(wrapper.text()).toContain('Nick đang ngoại tuyến nhưng AI vẫn có thể phân tích các tin nhắn đã lưu.');
  });

  it('does not request insight content for a private conversation', async () => {
    const wrapper = mount(ConversationInsightCard, {
      props: { conversationId: 'conversation-private', privateBlocked: true },
    });
    await flushPromises();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Hội thoại riêng tư không được AI đọc hoặc ghi nhớ.');
  });

  it('queues an immediate analysis for an existing conversation without insight', async () => {
    mocks.get.mockResolvedValue({
      data: {
        insight: null,
        readiness: { aiStatus: 'ready', accountStatus: 'connected', accountName: 'Nick bán hàng' },
      },
    });
    mocks.post.mockResolvedValue({ data: { queued: false, reason: 'no_inbound_messages' } });

    const wrapper = mount(ConversationInsightCard, { props: { conversationId: 'conversation-old' } });
    await flushPromises();

    expect(mocks.post).toHaveBeenCalledWith(
      '/ai/insights/conversations/conversation-old/analyze',
      {},
      { timeout: 15_000 },
    );
    expect(wrapper.text()).toContain('Chưa có ghi chú phân tích');
    expect(wrapper.text()).toContain('Phân tích ngay');
  });
});
