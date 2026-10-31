import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  zaloAccount: { findMany: vi.fn() }, organization: { findUnique: vi.fn() },
  appointment: { findMany: vi.fn() },
  conversation: { findMany: vi.fn() },
  conversationWorkItem: { findMany: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: db }));

import {
  listConversationWorkItems,
  appointmentDueAt,
  collectAllPages,
  deriveConversationSignal,
  verificationSignal,
  isConversationEligibleForSalesWork,
  isContactWorkItemEligibleForAssignee,
  isVerificationCandidate,
  matchesWorkItemScope,
  sanitizeConversationWorkItemForViewer,
  followupTasksForWorkItem,
  workItemMatchesIntegrationScope,
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
  it('filters mixed-account aggregates before integration pagination, counts or updates', () => {
    const convs = new Set(['conv']); const accounts = new Set(['nick']);
    const row = { conversationId: 'conv', zaloAccountId: 'nick', metadata: { conversationIds: ['conv'], signals: [{ conversationId: 'conv', zaloAccountId: 'nick' }] } };
    expect(workItemMatchesIntegrationScope(row, convs, accounts)).toBe(true);
    expect(workItemMatchesIntegrationScope({ ...row, metadata: { conversationIds: ['conv', 'private'] } }, convs, accounts)).toBe(false);
    expect(workItemMatchesIntegrationScope({ ...row, metadata: { signals: [{ conversationId: 'conv', zaloAccountId: 'other' }] } }, convs, accounts)).toBe(false);
    expect(workItemMatchesIntegrationScope({ ...row, metadata: { signals: [{ conversationId: 'conv' }] } }, convs, accounts)).toBe(false);
    expect(workItemMatchesIntegrationScope({ conversationId: null, metadata: {} }, convs, accounts)).toBe(false);
  });
  it('keeps low-confidence image senders in verification work', () => {
    const conversation = {
      messages: [{ id: 'media', senderType: 'contact', contentType: 'image', content: '[image]' }],
      aiInsights: [{ sourceThroughMessageId: 'media', signals: { counterpartyRole: 'unknown', counterpartyConfidence: 0.4 } }],
    };
    expect(isConversationEligibleForSalesWork(conversation)).toBe(false);
    expect(isVerificationCandidate(conversation, true)).toBe(true);
    expect(isVerificationCandidate(conversation, false)).toBe(false);
    expect(isVerificationCandidate({ ...conversation, messages: [{ ...conversation.messages[0], isDeleted: true }] }, true)).toBe(false);
    expect(isVerificationCandidate({ ...conversation, messages: [{ ...conversation.messages[0], senderType: 'self' }] }, true)).toBe(false);
  });

  it('does not turn a confirmed vendor attachment into verification work', () => {
    expect(isVerificationCandidate({
      messages: [{ id: 'media', senderType: 'contact', contentType: 'file' }],
      aiInsights: [{ sourceThroughMessageId: 'media', signals: { counterpartyRole: 'vendor', counterpartyConfidence: 0.95 } }],
    }, true)).toBe(false);
  });

  it('separates ordinary manual media review from real escalation', () => {
    const input = conversationInput({
      lastMessageAt: new Date('2026-08-27T03:59:00Z'),
      insight: { requiresHuman: true, stage: 'needs_reply', intentLabel: 'unknown', nextAction: 'clarify_latest_message' },
    });
    expect(deriveConversationSignal(input).priority).toBe('normal');
    expect(deriveConversationSignal({ ...input, lastMessageAt: new Date('2026-08-27T02:00:00Z') }).priority).toBe('high');
    expect(deriveConversationSignal({ ...input, insight: { ...input.insight, intentLabel: 'complaint' } }).priority).toBe('critical');
    expect(deriveConversationSignal({ ...input, insight: { ...input.insight, nextAction: 'verify_payment_obligation' } }).priority).toBe('high');
  });
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

  it('does not pretend AI is running when the latest inbound message has no insight yet', () => {
    const signal = deriveConversationSignal(conversationInput({ insight: null }));

    expect(signal.metadata).toMatchObject({
      aiStatus: 'pending',
      aiStatusLabel: 'Chờ kết quả phân tích AI',
    });
  });

  it('exposes a ready state after the latest inbound message has an insight', () => {
    const signal = deriveConversationSignal(conversationInput({
      insight: { sourceThroughMessageId: 'message-1', stage: 'discovery', stageConfidence: 0.88 },
    }));

    expect(signal.metadata).toMatchObject({
      aiStatus: 'ready',
      aiStatusLabel: 'AI đã phân tích xong',
    });
  });

  it('exposes a verification state for uncertain customer identity', () => {
    const signal = verificationSignal({
      id: 'conversation-1',
      lastMessageAt: new Date('2026-08-27T03:00:00.000Z'),
      zaloAccountId: 'account-1',
      unreadCount: 1,
      messages: [{ id: 'message-1', senderType: 'contact', contentType: 'text', content: 'Tôi cần trao đổi thêm.' }],
      aiInsights: [{ sourceThroughMessageId: 'message-1' }],
    }, false);

    expect(signal.metadata).toMatchObject({
      aiStatus: 'verification',
      aiStatusLabel: 'Chờ nhân viên xác minh',
    });
  });

  it('labels image-only verification as content review instead of customer rejection', () => {
    const signal = verificationSignal({
      id: 'conversation-1',
      lastMessageAt: new Date('2026-08-27T03:00:00.000Z'),
      zaloAccountId: 'account-1',
      unreadCount: 1,
      messages: [{ id: 'message-image', senderType: 'contact', contentType: 'image', content: '[Hình ảnh]' }],
      aiInsights: [{ sourceThroughMessageId: 'message-image' }],
    }, false);

    expect(signal).toMatchObject({
      title: 'Xem nội dung ảnh hoặc tệp khách gửi',
      nextAction: 'Mở hội thoại, xem ảnh hoặc tệp và xác nhận khách đang cần hỗ trợ gì.',
      metadata: { actionKey: 'clarify_latest_message', contentVerification: true, aiStatus: 'verification' },
    });
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

  it('creates the same contact work candidate for every explicitly responsible user', () => {
    const responsibleUserIds = new Set(['primary-user', 'collaborator-user']);

    expect(isContactWorkItemEligibleForAssignee({
      assigneeUserId: 'primary-user', responsibleUserIds, hasAppointmentSignal: false, hasOwnerAccountSignal: false,
    })).toBe(true);
    expect(isContactWorkItemEligibleForAssignee({
      assigneeUserId: 'collaborator-user', responsibleUserIds, hasAppointmentSignal: false, hasOwnerAccountSignal: false,
    })).toBe(true);
    expect(isContactWorkItemEligibleForAssignee({
      assigneeUserId: 'unrelated-user', responsibleUserIds, hasAppointmentSignal: false, hasOwnerAccountSignal: true,
    })).toBe(false);
  });

  it('keeps unassigned contact work with the nick owner instead of every shared nick user', () => {
    const unassigned = new Set<string>();

    expect(isContactWorkItemEligibleForAssignee({
      assigneeUserId: 'nick-owner', responsibleUserIds: unassigned, hasAppointmentSignal: false, hasOwnerAccountSignal: true,
    })).toBe(true);
    expect(isContactWorkItemEligibleForAssignee({
      assigneeUserId: 'nick-reader', responsibleUserIds: unassigned, hasAppointmentSignal: false, hasOwnerAccountSignal: false,
    })).toBe(false);
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

  it('surfaces overdue verification work in the urgent queue', () => {
    const overdueVerification = {
      status: 'open',
      kind: 'verification',
      priority: 'normal',
      dueAt: new Date('2026-08-26T03:00:00.000Z'),
      metadata: { actionKey: 'verify_customer_identity' },
    };

    expect(matchesWorkItemScope(overdueVerification, 'now')).toBe(true);
    expect(matchesWorkItemScope(overdueVerification, 'verify')).toBe(true);
  });

  it('hides private conversations from non-owners and redacts main-nick work content', () => {
    const privateRow = {
      id: 'private-item',
      title: 'Trả lời khách hàng',
      customerSituation: 'Nội dung riêng tư',
      nextAction: 'Gửi báo giá',
      reason: 'Khách đang chờ',
      metadata: { contactName: 'Khách riêng', signalCount: 1 },
      conversation: {
        isPrivate: true,
        privateOwnerUserId: 'owner-user',
        zaloAccount: { privacyMode: 'sub', ownerUserId: 'owner-user' },
      },
    };
    const mainNickRow = {
      ...privateRow,
      id: 'main-nick-item',
      conversation: {
        isPrivate: false,
        privateOwnerUserId: null,
        zaloAccount: { privacyMode: 'main', ownerUserId: 'owner-user' },
      },
    };
    const viewer = { viewerUserId: 'other-user', orgId: 'org', privacyUnlocked: false };

    expect(sanitizeConversationWorkItemForViewer(privateRow, viewer)).toBeNull();
    expect(sanitizeConversationWorkItemForViewer(mainNickRow, viewer)).toMatchObject({
      title: 'Công việc trong hội thoại riêng tư',
      customerSituation: 'Nội dung hội thoại đang được bảo vệ.',
      metadata: { redacted: true, contactName: 'Khách riêng' },
    });
  });

  it('finds every waiting-sale task inside a grouped customer work item', () => {
    expect(followupTasksForWorkItem({ metadata: {
      enrollmentId: 'enrollment-primary',
      currentStepKey: 'sale_task_1',
      signals: [{
        kind: 'followup_sale',
        metadata: { enrollmentId: 'enrollment-secondary', currentStepKey: 'sale_task_2' },
      }],
    }})).toEqual([
      { enrollmentId: 'enrollment-primary', currentStepKey: 'sale_task_1' },
      { enrollmentId: 'enrollment-secondary', currentStepKey: 'sale_task_2' },
    ]);
  });
});

describe('combined work queue listing', () => {
  let organization = 0;
  const privacy = { viewerUserId: 'owner', orgId: 'org', privacyUnlocked: false };
  function row(id: string, assigneeUserId: string, extra: Record<string, unknown> = {}) {
    return {
      id, assigneeUserId, assignee: { id: assigneeUserId, fullName: assigneeUserId },
      status: 'open', kind: 'reply', priority: 'high', priorityScore: 80,
      title: id, dueAt: new Date(Date.now() - 60000), metadata: {}, conversation: null, ...extra,
    };
  }
  function input(extra: Record<string, unknown> = {}) {
    return { orgId: `combined-${++organization}`, assigneeUserId: 'owner', assigneeUserIds: ['owner', 'staff'], privacy, scope: 'all' as const, ...extra };
  }
  beforeEach(() => {
    vi.clearAllMocks();
    db.zaloAccount.findMany.mockResolvedValue([]);
    db.organization.findUnique.mockResolvedValue(null);
    db.appointment.findMany.mockResolvedValue([]);
    db.conversation.findMany.mockResolvedValue([]);
    db.conversationWorkItem.updateMany.mockResolvedValue({ count: 0 });
    db.$transaction.mockResolvedValue([]);
  });
  function setRows(rows: ReturnType<typeof row>[]) {
    db.conversationWorkItem.findMany.mockImplementation(async (args: any) => args.include ? rows : []);
  }
  it('queries all assignees in one globally ordered list, counts before paging, and returns their names', async () => {
    setRows([row('urgent-staff', 'staff', { priority: 'critical', priorityScore: 100 }), row('owner-task', 'owner'), row('staff-task', 'staff')]);
    const args = input({ limit: 1 });
    const first = await listConversationWorkItems(args);
    expect(first.items.map((item) => item.id)).toEqual(['urgent-staff']);
    expect(first.items[0].assignee).toEqual({ id: 'staff', fullName: 'staff' });
    expect(first).toMatchObject({ counts: { all: 3, now: 3 }, summary: { totalActive: 3, critical: 1 }, hasMore: true, nextOffset: 1 });
    const query = db.conversationWorkItem.findMany.mock.calls.find(([query]) => query.include)?.[0];
    expect(query).toMatchObject({ where: { orgId: args.orgId, assigneeUserId: { in: ['owner', 'staff'] } }, orderBy: [{ priorityScore: 'desc' }, { dueAt: { sort: 'asc', nulls: 'last' } }, { sourceEventAt: 'desc' }, { id: 'asc' }] });
    const next = await listConversationWorkItems({ ...args, offset: 1 });
    expect(next.items.map((item) => item.id)).toEqual(['owner-task']);
    expect(db.zaloAccount.findMany).toHaveBeenCalledTimes(2); // one reconciliation per person, reused on next page
  });
  it('removes private conversations and redacts locked nick content before counts and paging', async () => {
    const conversation = { isPrivate: false, privateOwnerUserId: null, zaloAccount: { privacyMode: 'sub', ownerUserId: 'staff' } };
    setRows([
      row('private', 'staff', { conversation: { ...conversation, isPrivate: true, privateOwnerUserId: 'staff' } }),
      row('locked', 'staff', { customerSituation: 'secret', conversation: { ...conversation, zaloAccount: { privacyMode: 'main', ownerUserId: 'staff' } } }),
      row('visible', 'owner', { conversation }),
    ]);
    const result = await listConversationWorkItems(input({ limit: 1 }));
    expect(result.counts.all).toBe(2);
    expect(result.items[0].id).toBe('locked');
    expect(result.items[0].customerSituation).not.toBe('secret');
    expect(result.items[0].metadata).toMatchObject({ redacted: true });
    expect(result.nextOffset).toBe(1);
  });
  it('checks private and locked secondary conversations in tasks merged across nicks', async () => {
    const source = { id: 'secondary', isPrivate: true, privateOwnerUserId: 'staff', zaloAccount: { privacyMode: 'sub', ownerUserId: 'staff' } };
    db.conversation.findMany.mockResolvedValue([source]);
    setRows([row('mixed', 'staff', { metadata: { conversationIds: ['secondary'], signals: [{ conversationId: 'secondary', title: 'private detail' }] } })]);
    expect((await listConversationWorkItems(input())).items).toEqual([]);
    db.conversation.findMany.mockResolvedValue([{ ...source, isPrivate: false, zaloAccount: { privacyMode: 'main', ownerUserId: 'staff' } }]);
    const result = await listConversationWorkItems(input());
    expect(result.items).toHaveLength(1);
    expect(result.items[0].metadata).toMatchObject({ redacted: true });
    expect(JSON.stringify(result.items)).not.toContain('private detail');
    db.conversation.findMany.mockResolvedValue([]);
    expect((await listConversationWorkItems(input())).items).toEqual([]);
  });
  it('searches employee names across the combined list', async () => {
    setRows([row('a', 'owner'), row('b', 'staff')]);
    expect((await listConversationWorkItems(input({ query: 'staff' }))).items.map((item) => item.id)).toEqual(['b']);
  });
  it('keeps integration conversation/account filters ahead of combined counts and paging', async () => {
    setRows([
      row('outside', 'staff', { conversationId: 'other', zaloAccountId: 'nick', metadata: {} }),
      row('inside', 'owner', { conversationId: 'allowed', zaloAccountId: 'nick', metadata: {} }),
    ]);
    const result = await listConversationWorkItems(input({ allowedConversationIds: ['allowed'], allowedAccountIds: ['nick'], limit: 1 }));
    expect(result.counts.all).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(['inside']);
    expect(result.hasMore).toBe(false);
  });
  it('does not reconcile anyone for an empty authorized set', async () => {
    setRows([]);
    const result = await listConversationWorkItems(input({ assigneeUserIds: [] }));
    expect(db.zaloAccount.findMany).not.toHaveBeenCalled();
    expect(db.conversationWorkItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ assigneeUserId: { in: [] } }) }));
    expect(result.counts.all).toBe(0);
  });
});
