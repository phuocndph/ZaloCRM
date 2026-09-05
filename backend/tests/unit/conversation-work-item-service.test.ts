import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: {} }));

import {
  appointmentDueAt,
  collectAllPages,
  deriveConversationSignal,
  isConversationEligibleForSalesWork,
  isVerificationCandidate,
  matchesWorkItemScope,
} from '../../src/modules/dashboard/conversation-work-item-service.js';

function conversationInput(overrides: Record<string, unknown> = {}) {
  return {
    unreadCount: 1,
    lastMessageAt: new Date('2026-08-27T03:00:00.000Z'),
    messagePreview: 'Khách đang chờ phản hồi',
    redacted: false,
    insight: null,
    conversationId: 'conversation-1',
    zaloAccountId: 'account-1',
    latestMessageId: 'message-1',
    ...overrides,
  };
}

describe('ConversationWorkItemService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T04:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('ranks complaints and human requests as critical', () => {
    const signal = deriveConversationSignal(conversationInput({
      insight: {
        stage: 'human_required',
        intentLabel: 'complaint',
        requiresHuman: true,
        nextAction: 'assign_to_human',
        summary: { summaryRedacted: JSON.stringify({ currentDiscussion: 'Khách đang khiếu nại giao sai hàng.' }) },
      },
    }));

    expect(signal).toMatchObject({ priority: 'critical', priorityScore: 100, kind: 'human_required' });
    expect(signal.customerSituation).toContain('khiếu nại');
  });

  it('ranks payment conversations as high priority', () => {
    const signal = deriveConversationSignal(conversationInput({
      insight: { stage: 'payment_pending', intentLabel: 'payment_inquiry', nextAction: 'verify_payment_obligation' },
    }));

    expect(signal.priority).toBe('high');
    expect(signal.nextAction).toBe('Xác minh đơn hàng hoặc công nợ');
  });

  it('turns a confirmed order into a high-priority order task', () => {
    const signal = deriveConversationSignal(conversationInput({
      insight: {
        stage: 'won', intentLabel: 'order_intent', nextAction: 'confirm_order_details',
        summary: { summaryRedacted: JSON.stringify({ currentDiscussion: 'Khách đã chốt lấy 20 cái ga.' }) },
      },
    }));

    expect(signal).toMatchObject({
      priority: 'high',
      nextAction: 'Xác nhận thông tin và lên đơn',
    });
  });

  it('filters a vendor even if generic intent detection looks commercial', () => {
    expect(isConversationEligibleForSalesWork({
      messages: [{ senderType: 'contact', content: 'Bên em chuyên cung cấp dịch vụ quảng cáo, xin gửi anh báo giá.' }],
      aiInsights: [{
        stage: 'needs_reply', intentLabel: 'quote_request',
        signals: {
          counterpartyRole: 'vendor',
          counterpartyConfidence: 0.94,
          counterpartyReason: 'Đang chào bán dịch vụ.',
        },
      }],
    })).toBe(false);
  });

  it('keeps a real buyer request without waiting for model classification', () => {
    expect(isConversationEligibleForSalesWork({
      messages: [{ senderType: 'contact', content: 'Cho tôi xin báo giá 30 bộ chăn ga khách sạn.' }],
      aiInsights: [],
    })).toBe(true);
  });

  it('uses the newest message instead of a stale non-customer classification', () => {
    expect(isConversationEligibleForSalesWork({
      messages: [{ id: 'message-new', senderType: 'contact', content: 'Cho tôi xin báo giá 30 bộ chăn ga khách sạn.' }],
      aiInsights: [{
        sourceThroughMessageId: 'message-old', stage: 'cold', intentLabel: 'spam',
        signals: {
          counterpartyRole: 'vendor',
          counterpartyConfidence: 0.94,
          counterpartyReason: 'Phân loại từ tin nhắn cũ.',
        },
      }],
    })).toBe(true);
  });

  it('routes a new image to verification instead of reusing a stale customer assessment', () => {
    expect(isConversationEligibleForSalesWork({
      messages: [
        { id: 'message-image', senderType: 'contact', contentType: 'image', content: '[image]' },
        { id: 'message-old', senderType: 'contact', contentType: 'text', content: 'Cho tôi xin báo giá 20 bộ.' },
      ],
      aiInsights: [{
        sourceThroughMessageId: 'message-old',
        signals: {
          counterpartyRole: 'customer',
          counterpartyConfidence: 0.96,
          counterpartyReason: 'Khách đang mua hàng.',
        },
      }],
    })).toBe(false);
  });

  it('does not create verification work for an accepted-friend e-card', () => {
    expect(isVerificationCandidate({
      messages: [{
        id: 'message-friend-accepted',
        senderType: 'contact',
        contentType: 'image',
        content: 'Lan\nLan đã đồng ý kết bạn\nhttps://res-zalo.zadn.vn/upload/media/2018/4/23/ecard_newfriend_1_VN_2x_1524478415422.png',
      }],
      aiInsights: [],
    }, true)).toBe(false);
  });

  it('does not use an old unknown assessment to verify an unrelated short greeting', () => {
    expect(isVerificationCandidate({
      messages: [
        { id: 'message-new', senderType: 'contact', contentType: 'text', content: 'Chào bạn' },
        { id: 'message-old', senderType: 'contact', contentType: 'text', content: 'Tôi gửi bạn thông tin tham khảo.' },
      ],
      aiInsights: [{
        sourceThroughMessageId: 'message-old',
        signals: { counterpartyRole: 'unknown', counterpartyConfidence: 0.95 },
      }],
    }, true)).toBe(false);
  });

  it('does not revive a stale customer task for an unclear newer text', () => {
    expect(isConversationEligibleForSalesWork({
      messages: [
        { id: 'message-new', senderType: 'contact', contentType: 'text', content: 'Vâng, cảm ơn bạn.' },
        { id: 'message-old', senderType: 'contact', contentType: 'text', content: 'Cho tôi xin báo giá 20 bộ.' },
      ],
      aiInsights: [{
        sourceThroughMessageId: 'message-old',
        stage: 'quoted',
        intentLabel: 'quote_request',
        signals: { counterpartyRole: 'customer', counterpartyConfidence: 0.96 },
      }],
    })).toBe(false);
  });

  it('never creates sales work from a latest staff/system message', () => {
    expect(isConversationEligibleForSalesWork({
      messages: [{ id: 'message-self', senderType: 'self', contentType: 'text', content: 'Em đã gửi báo giá.' }],
      aiInsights: [{
        sourceThroughMessageId: 'message-self',
        stage: 'quoted',
        intentLabel: 'quote_request',
        signals: { counterpartyRole: 'customer', counterpartyConfidence: 0.96 },
      }],
    })).toBe(false);
    expect(isConversationEligibleForSalesWork({
      messages: [{ id: 'message-system', senderType: 'system', contentType: 'image', content: 'Lan đã đồng ý kết bạn' }],
      aiInsights: [],
    })).toBe(false);
  });

  it('ignores a withdrawn inbound message when deciding whether work is needed', () => {
    expect(isConversationEligibleForSalesWork({
      messages: [{ id: 'message-deleted', senderType: 'contact', contentType: 'text', content: 'Cho tôi xin báo giá 30 bộ.', isDeleted: true }],
      aiInsights: [{
        sourceThroughMessageId: 'message-deleted',
        stage: 'qualified',
        intentLabel: 'quote_request',
        signals: { counterpartyRole: 'customer', counterpartyConfidence: 0.96 },
      }],
    })).toBe(false);
  });

  it('closes a stale reply task immediately after staff sends a message', () => {
    expect(isConversationEligibleForSalesWork({
      messages: [
        { id: 'message-self', senderType: 'self', contentType: 'text', content: 'Dạ em đã cập nhật đơn.' },
        { id: 'message-old', senderType: 'contact', contentType: 'text', content: 'Cho tôi xin báo giá 20 bộ.' },
      ],
      aiInsights: [{
        sourceThroughMessageId: 'message-old',
        signals: {
          counterpartyRole: 'customer',
          counterpartyConfidence: 0.96,
          counterpartyReason: 'Khách đang mua hàng.',
        },
      }],
    })).toBe(false);
  });

  it('reads a new buyer request instead of keeping a stale vendor role', () => {
    expect(isConversationEligibleForSalesWork({
      messages: [
        { id: 'message-new', senderType: 'contact', contentType: 'text', content: 'Cho tôi xin báo giá 30 bộ chăn ga.' },
        { id: 'message-old', senderType: 'contact', contentType: 'text', content: 'Bên em xin phép giới thiệu dịch vụ.' },
      ],
      aiInsights: [{
        sourceThroughMessageId: 'message-old',
        signals: {
          counterpartyRole: 'vendor',
          counterpartyConfidence: 0.94,
          counterpartyReason: 'Đang chào bán dịch vụ.',
        },
      }],
    })).toBe(true);
  });

  it('does not turn an unclear greeting into an urgent customer task', () => {
    expect(isConversationEligibleForSalesWork({
      messages: [{ senderType: 'contact', content: 'Chào bạn' }],
      aiInsights: [],
    })).toBe(false);
  });

  it('keeps an explicitly unknown contact out even if the intent is commercial', () => {
    expect(isConversationEligibleForSalesWork({
      messages: [{ id: 'message-1', senderType: 'contact', content: 'Tôi gửi bạn thông tin tham khảo.' }],
      aiInsights: [{
        sourceThroughMessageId: 'message-1', stage: 'discovery', intentLabel: 'product_inquiry',
        signals: {
          counterpartyRole: 'unknown',
          counterpartyConfidence: 0.91,
          counterpartyReason: 'Không đủ bằng chứng xác định vai trò.',
        },
      }],
    })).toBe(false);
  });

  it('combines the stored appointment date and organization wall-clock time', () => {
    expect(appointmentDueAt(new Date('2026-08-27T00:00:00.000Z'), '15:30', '+07:00').toISOString())
      .toBe('2026-08-27T08:30:00.000Z');
  });

  it('collects every page instead of silently cutting off older work sources', async () => {
    const pages = [
      [{ id: '1' }, { id: '2' }],
      [{ id: '3' }, { id: '4' }],
      [{ id: '5' }],
    ];
    const fetchPage = vi.fn(async () => pages.shift() ?? []);
    await expect(collectAllPages(2, fetchPage)).resolves.toEqual([
      { id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' },
    ]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('keeps snoozed and completed items out of active scopes', () => {
    const open = { status: 'open', priority: 'normal', kind: 'appointment', dueAt: new Date('2026-08-27T08:00:00.000Z') };
    const snoozed = { ...open, status: 'snoozed', snoozedUntil: new Date('2026-08-27T10:00:00.000Z') };
    const done = { ...open, status: 'completed' };
    const dismissed = { ...open, status: 'dismissed' };
    const futureHigh = { ...open, priority: 'high', dueAt: new Date('2026-08-28T08:00:00.000Z') };

    expect(matchesWorkItemScope(open, 'today')).toBe(true);
    expect(matchesWorkItemScope(open, 'now')).toBe(false);
    expect(matchesWorkItemScope(futureHigh, 'now')).toBe(false);
    expect(matchesWorkItemScope(futureHigh, 'upcoming')).toBe(true);
    expect(matchesWorkItemScope(snoozed, 'waiting')).toBe(true);
    expect(matchesWorkItemScope(snoozed, 'today')).toBe(false);
    expect(matchesWorkItemScope(done, 'done')).toBe(true);
    expect(matchesWorkItemScope(dismissed, 'now')).toBe(false);
    expect(matchesWorkItemScope(dismissed, 'today')).toBe(false);
    expect(matchesWorkItemScope(dismissed, 'done')).toBe(false);
    expect(matchesWorkItemScope(dismissed, 'all')).toBe(false);
  });

  it('keeps urgent and remaining-today scopes mutually exclusive', () => {
    const overdueReply = { status: 'open', priority: 'high', kind: 'reply', dueAt: new Date('2026-08-27T03:00:00.000Z') };
    const laterToday = { status: 'open', priority: 'normal', kind: 'appointment', dueAt: new Date('2026-08-27T08:00:00.000Z') };

    expect(matchesWorkItemScope(overdueReply, 'now')).toBe(true);
    expect(matchesWorkItemScope(overdueReply, 'today')).toBe(false);
    expect(matchesWorkItemScope(laterToday, 'now')).toBe(false);
    expect(matchesWorkItemScope(laterToday, 'today')).toBe(true);
  });
});
