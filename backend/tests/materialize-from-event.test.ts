// FIX 2026-06-12 — Regression test cho viết lại materializeFromEvent → BullMQ
// (vết gãy #2). Trước đây hàm ghi vào AutomationTask stub (đã drop) → 0 việc thật
// → Mục tiêu kích bằng SỰ KIỆN không bám đuổi được KH. Giờ enqueue BullMQ thật.
//
// Phủ các nhánh anh chốt (D4/D5/D7):
//   - sequence-bound: chọn nick + enqueueSequenceStart  (happy path)
//   - đa-luồng: KH ở Luồng A vẫn vào được Luồng B (KHÔNG còn mutex chặn)  ← D5
//   - block-bound: skip CÓ CẢNH BÁO (không nuốt im)  ← D7
//   - no nick (KH chưa là bạn nick nào): skip ghi lý do, KHÔNG enqueue
//   - nick scope: truyền segmentSpec.nickIds xuống selector

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock nick-selector: bắt args + điều khiển kết quả ────────────────────────
const pickSequenceNickForContact = vi.fn();
vi.mock('../src/modules/automation/engine/nick-selector.js', () => ({
  pickSequenceNickForContact: (...a: unknown[]) => (pickSequenceNickForContact as any)(...a),
}));

// ── Mock enqueueSequenceStart: bắt mọi lần enqueue ───────────────────────────
const enqueueSequenceStart = vi.fn(async () => undefined);
vi.mock('../src/modules/automation/queues/sequence-step-worker.js', () => ({
  enqueueSequenceStart: (...a: unknown[]) => (enqueueSequenceStart as any)(...a),
}));

// queue-registry (chỉ cần tồn tại — materializeSequenceForContact path không test ở đây)
vi.mock('../src/modules/automation/queues/queue-registry.js', () => ({
  buildSequenceStepJobId: (t: string, c: string, i: number) => `${t}-${c}-${i}`,
  getSequenceStepQueue: () => ({ add: vi.fn(), getJob: vi.fn(async () => null) }),
}));

// segment-resolver: trả contactIds cố định
vi.mock('../src/modules/automation/engine/segment-resolver.js', () => ({
  resolveSegmentToContactIds: vi.fn(async () => ({ contactIds: ['c1'], rejected: [] })),
}));

// ── Mock prisma ──────────────────────────────────────────────────────────────
const db = {
  triggers: [] as any[],
  campaignFindFirst: null as any,
  block: { id: 'b1', archivedAt: null } as any,
};
vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    automationTrigger: { findMany: vi.fn(async () => db.triggers) },
    automationCampaign: {
      findFirst: vi.fn(async () => db.campaignFindFirst),
      create: vi.fn(async () => ({ id: 'camp1' })),
    },
    block: { findFirst: vi.fn(async () => db.block) },
  },
}));

import { materializeFromEvent } from '../src/modules/automation/engine/campaign-materializer.js';

function seqTrigger(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    bindingKind: 'sequence',
    sequenceId: 's1',
    blockId: null,
    eventFilter: null,
    segmentSpec: null,
    ruleOverrides: null,
    sequence: { id: 's1', enabled: true, steps: [{ stepId: 'st1', blockId: 'b1', delayMinutes: 5 }], runtimeRules: {} },
    ...over,
  };
}

const event = { type: 'silent_x_days', orgId: 'org1', occurredAt: new Date(0), contactId: 'c1' } as any;

beforeEach(() => {
  pickSequenceNickForContact.mockReset();
  enqueueSequenceStart.mockClear();
  db.triggers = [];
  db.campaignFindFirst = null;
  db.block = { id: 'b1', archivedAt: null };
});

describe('materializeFromEvent → BullMQ (vết gãy #2)', () => {
  it('sequence-bound: chọn nick + enqueueSequenceStart (happy path)', async () => {
    db.triggers = [seqTrigger()];
    pickSequenceNickForContact.mockResolvedValue({ nickId: 'n1', zaloUidInNick: 'u1', reason: 'existing_friend' });

    const r = await materializeFromEvent(event);

    expect(enqueueSequenceStart).toHaveBeenCalledTimes(1);
    expect(enqueueSequenceStart).toHaveBeenCalledWith(
      expect.objectContaining({ triggerId: 't1', contactId: 'c1', sequenceId: 's1', nickId: 'n1', startDelayMinutes: 5 }),
    );
    expect(r.tasksEnqueued).toBe(1);
  });

  it('D5 đa-luồng: KHÔNG có mutex chặn — mỗi Mục tiêu enqueue độc lập', async () => {
    // 2 trigger khác sequence cho cùng KH → cả 2 phải enqueue (không cái nào bị skip vì "đang ở luồng khác")
    db.triggers = [seqTrigger({ id: 'tA', sequenceId: 'sA', sequence: { id: 'sA', enabled: true, steps: [{ stepId: 'x', blockId: 'b1', delayMinutes: 0 }], runtimeRules: {} } }),
                   seqTrigger({ id: 'tB', sequenceId: 'sB', sequence: { id: 'sB', enabled: true, steps: [{ stepId: 'y', blockId: 'b1', delayMinutes: 0 }], runtimeRules: {} } })];
    pickSequenceNickForContact.mockResolvedValue({ nickId: 'n1', zaloUidInNick: 'u1', reason: 'existing_friend' });

    const r = await materializeFromEvent(event);

    expect(enqueueSequenceStart).toHaveBeenCalledTimes(2); // cả 2 luồng, không bị mutex chặn
    expect(r.tasksEnqueued).toBe(2);
  });

  it('no nick (KH chưa là bạn nick nào): skip ghi lý do, KHÔNG enqueue', async () => {
    db.triggers = [seqTrigger()];
    pickSequenceNickForContact.mockResolvedValue({ nickId: null, reason: 'no_friend_row' });

    const r = await materializeFromEvent(event);

    expect(enqueueSequenceStart).not.toHaveBeenCalled();
    expect(r.tasksEnqueued).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.reasons.some((x) => x.includes('no_sendable_nick') && x.includes('no_friend_row'))).toBe(true);
  });

  it('nick scope: truyền segmentSpec.nickIds xuống selector', async () => {
    db.triggers = [seqTrigger({ segmentSpec: { nickIds: ['nA', 'nB'] } })];
    pickSequenceNickForContact.mockResolvedValue({ nickId: 'nA', zaloUidInNick: 'u1', reason: 'existing_friend' });

    await materializeFromEvent(event);

    expect(pickSequenceNickForContact).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org1', contactId: 'c1', allowedNickIds: ['nA', 'nB'] }),
    );
  });

  it('D7 block-bound: skip CÓ CẢNH BÁO, KHÔNG enqueue, KHÔNG nuốt im', async () => {
    db.triggers = [seqTrigger({ id: 'tBlk', bindingKind: 'block', sequenceId: null, blockId: 'b1', sequence: null })];

    const r = await materializeFromEvent(event);

    expect(enqueueSequenceStart).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
    expect(r.reasons.some((x) => x.includes('block-bound'))).toBe(true);
  });

  it('sequence disabled: skip, KHÔNG enqueue', async () => {
    db.triggers = [seqTrigger({ sequence: { id: 's1', enabled: false, steps: [], runtimeRules: {} } })];

    const r = await materializeFromEvent(event);

    expect(enqueueSequenceStart).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
  });
});
