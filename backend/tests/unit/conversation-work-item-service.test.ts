import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: {} }));

import {
  appointmentDueAt,
  deriveConversationSignal,
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

  it('combines the stored appointment date and organization wall-clock time', () => {
    expect(appointmentDueAt(new Date('2026-08-27T00:00:00.000Z'), '15:30', '+07:00').toISOString())
      .toBe('2026-08-27T08:30:00.000Z');
  });

  it('keeps snoozed and completed items out of active scopes', () => {
    const open = { status: 'open', priority: 'normal', kind: 'appointment', dueAt: new Date('2026-08-27T08:00:00.000Z') };
    const snoozed = { ...open, status: 'snoozed', snoozedUntil: new Date('2026-08-27T10:00:00.000Z') };
    const done = { ...open, status: 'completed' };
    const futureHigh = { ...open, priority: 'high', dueAt: new Date('2026-08-28T08:00:00.000Z') };

    expect(matchesWorkItemScope(open, 'today')).toBe(true);
    expect(matchesWorkItemScope(open, 'now')).toBe(false);
    expect(matchesWorkItemScope(futureHigh, 'now')).toBe(false);
    expect(matchesWorkItemScope(futureHigh, 'upcoming')).toBe(true);
    expect(matchesWorkItemScope(snoozed, 'waiting')).toBe(true);
    expect(matchesWorkItemScope(snoozed, 'today')).toBe(false);
    expect(matchesWorkItemScope(done, 'done')).toBe(true);
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
