import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: {} }));
import { followupSignal } from '../../src/modules/dashboard/conversation-work-item-service.js';

const LEGACY_TITLE = 'Gọi hoặc nhắn trực tiếp để làm rõ vướng mắc sau báo giá';
function enrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'enrollment', workflowId: 'workflow', zaloAccountId: 'nick', currentStepKey: 'sale',
    messagesSent: 2, saleTaskTitle: LEGACY_TITLE, updatedAt: new Date('2026-08-20T00:00:00Z'),
    workflow: { name: 'Sau báo giá' }, ...overrides,
  };
}
function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'thread', zaloAccountId: 'nick', lastMessageAt: new Date('2026-08-26T00:00:00Z'),
    zaloAccount: { status: 'connected' },
    messages: [
      { senderType: 'contact', contentType: 'text', content: 'Giá cao hơn bên khác, có giảm giá không?' },
      { senderType: 'self', contentType: 'text', content: 'Em đã gửi báo giá cho anh.' },
    ], ...overrides,
  };
}

describe('situation-aware follow-up presentation', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-27T04:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it.each(['Hẹn gọi lúc 15h để xác nhận kích thước', `${LEGACY_TITLE}.`])('preserves an explicit manual title exactly: %s', (title) => {
    const signal = followupSignal(enrollment({ saleTaskTitle: title }), conversation());
    expect(signal.title).toBe(title);
    expect(signal.nextAction).toBe(title);
  });

  it('reconfirms current needs rather than asking whether an old quote was read', () => {
    const signal = followupSignal(enrollment(), conversation({
      lastMessageAt: new Date('2026-08-12T03:59:59Z'),
      messages: [{ senderType: 'self', contentType: 'text', content: 'Em đã gửi báo giá cho anh.' }],
    }));
    expect(signal.title).toBe('Xác nhận lại nhu cầu hiện tại');
    expect(signal.nextAction).toContain('nhu cầu hiện tại');
    expect(signal.nextAction).not.toMatch(/đã xem báo giá chưa/iu);
    expect(signal.metadata.followupSituation).toBe('stale');
  });

  it.each([
    null,
    conversation({ messages: [] }),
    conversation({ messages: [{ senderType: 'self', contentType: 'file', content: 'Báo giá.pdf' }] }),
    conversation({ messages: [{ senderType: 'contact', contentType: 'text', content: 'Cho tôi xin báo giá' }] }),
    conversation({ messages: [{ senderType: 'self', contentType: 'text', content: 'Em sẽ gửi báo giá sau.' }] }),
    conversation({ messages: [{ senderType: 'self', contentType: 'text', content: 'Em chưa gửi báo giá.' }] }),
  ])('requires manual context verification without evidence that a quote was sent (%#)', (thread) => {
    const signal = followupSignal(enrollment(), thread);
    expect(signal.title).toBe('Xác minh bối cảnh trước khi liên hệ');
    expect(signal.metadata).toMatchObject({ followupSituation: 'unknown', manualOnly: true });
    expect(signal.customerSituation).not.toContain('đã gửi báo giá');
    expect(signal.nextAction).toContain('bối cảnh');
  });

  it.each([
    [{ senderType: 'contact', contentType: 'text', content: 'Cho tôi hỏi giá bao nhiêu?' }],
    [{ senderType: 'contact', contentType: 'text', content: 'Kích thước cao hơn mẫu cũ' }],
    [{ senderType: 'self', contentType: 'text', content: 'Giá cao hơn bên khác' }],
    [{ senderType: 'contact', contentType: 'text', content: 'Giá cao', isDeleted: true }],
    [{ senderType: 'contact', contentType: 'file', content: 'giá cao.pdf' }],
    [...Array.from({ length: 11 }, () => ({ senderType: 'contact', contentType: 'text', content: 'Cảm ơn' })),
      { senderType: 'self', contentType: 'text', content: 'Em đã gửi báo giá.' },
      { senderType: 'contact', contentType: 'text', content: 'Giá cao' }],
  ].map((messages) => ({ messages })))('uses ordinary follow-up without a valid recent inbound price objection (%#)', ({ messages }) => {
    const quote = { senderType: 'self', contentType: 'text', content: 'Em đã gửi báo giá.' };
    const signal = followupSignal(enrollment(), conversation({ messages: messages.length > 12 ? messages : [...messages, quote] }));
    expect(signal.title).toBe('Liên hệ theo dõi nhu cầu khách hàng');
    expect(signal.metadata.followupSituation).toBe('ordinary');
  });

  it('does not read hidden conversation content or leak its manual title', () => {
    const hidden = conversation({ redacted: true });
    Object.defineProperty(hidden, 'messages', { get() { throw new Error('hidden content read'); } });
    const signal = followupSignal(enrollment({ saleTaskTitle: 'Giá bí mật cần thương lượng' }), hidden);
    expect(signal.title).toBe('Công việc follow-up trong hội thoại riêng tư');
    expect(JSON.stringify(signal)).not.toContain('Giá bí mật');
    expect(signal.metadata.redacted).toBe(true);
  });

  it('does not analyze individual redacted messages', () => {
    const signal = followupSignal(enrollment(), conversation({ messages: [
      { senderType: 'contact', contentType: 'text', redacted: true, get content() { throw new Error('redacted text read'); } },
    ] }));
    expect(signal.metadata.followupSituation).toBe('unknown');
  });

  it('adds a sync check for a disconnected nick without increasing urgency', () => {
    const online = followupSignal(enrollment(), conversation());
    const offline = followupSignal(enrollment(), conversation({ zaloAccount: { status: 'disconnected' } }));
    expect(offline.nextAction).toContain('Kiểm tra kết nối và đồng bộ nick trước khi liên hệ');
    expect(offline.priority).toBe(online.priority);
    expect(offline.priorityScore).toBe(online.priorityScore);
    expect(offline.metadata.nickDisconnected).toBe(true);
    expect(offline.title).toBe(online.title);
  });

  it('keeps due/event dates at the earliest creation of the current sale step across reconciliations', () => {
    const row = enrollment({ logs: [
      { eventType: 'sale_task_created', stepKey: 'other', createdAt: new Date('2026-08-01T00:00:00Z') },
      { eventType: 'sale_task_done', stepKey: 'sale', createdAt: new Date('2026-08-02T00:00:00Z') },
      { eventType: 'sale_task_created', stepKey: 'sale', createdAt: new Date('2026-08-19T00:00:00Z') },
      { eventType: 'sale_task_created', stepKey: 'sale', createdAt: new Date('2026-08-18T00:00:00Z') },
    ] });
    for (const time of ['2026-08-27T04:00:00Z', '2026-08-28T04:00:00Z']) {
      vi.setSystemTime(new Date(time));
      const signal = followupSignal(row, conversation());
      expect(signal.dueAt?.toISOString()).toBe('2026-08-18T00:00:00.000Z');
      expect(signal.eventAt).toEqual(signal.dueAt);
    }
  });

  it('falls back to enrollment updatedAt when no current-step creation log exists', () => {
    const row = enrollment({ logs: [{ eventType: 'sale_task_created', stepKey: 'other', createdAt: new Date('2026-08-01T00:00:00Z') }] });
    const signal = followupSignal(row, null);
    expect(signal.dueAt).toEqual(row.updatedAt);
    expect(signal.eventAt).toEqual(row.updatedAt);
  });

  it('replaces the exact legacy task with current-need/spec clarification for a price objection', () => {
    const signal = followupSignal(enrollment(), conversation());
    expect(signal.title).toBe('Xác nhận nhu cầu hiện tại và làm rõ chênh lệch giá');
    expect(signal.nextAction).toContain('quy cách');
    expect(signal.nextAction).toContain('nhu cầu hiện tại');
    expect(signal.nextAction).not.toMatch(/đề xuất giảm giá|chiết khấu|đã xem báo giá chưa/iu);
    expect(signal.metadata).toMatchObject({ followupSituation: 'price_objection', manualOnly: true });
    expect(signal.key).toBe(`followup:enrollment:sale:2:${LEGACY_TITLE}`);
    expect(signal.metadata).toMatchObject({ enrollmentId: 'enrollment', currentStepKey: 'sale' });
  });
});
