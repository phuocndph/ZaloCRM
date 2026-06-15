// Unit test — jobId đa-luồng (2 REGRESSION) + sendGap validator.
// Sequence recode Đợt 1 (eng-review TEST#1=A). Bug gốc: jobId thiếu sequenceId → 2
// luồng cùng (trigger,contact) đụng nhau → BullMQ nuốt luồng 2.

import { describe, it, expect } from 'vitest';
import {
  buildSequenceStepJobId,
  sequenceStepJobPrefix,
} from '../src/modules/automation/queues/queue-registry.js';
import { validateRuntimeRules } from '../src/modules/automation/sequences/types.js';

describe('buildSequenceStepJobId — REGRESSION đa-luồng + epoch', () => {
  it('có sequenceId + epoch (default 1) trong jobId', () => {
    expect(buildSequenceStepJobId('trig1', 'seqA', 'kh1', 0)).toBe('trig1-seqA-kh1-e1-0');
  });

  it('REGRESSION #1: 2 luồng KHÁC sequence, CÙNG (trigger,contact) → jobId KHÁC NHAU', () => {
    // Đây là bug gốc: trước đây cả 2 ra `trig1-kh1-0` → trùng → luồng 2 bị nuốt.
    const luong1 = buildSequenceStepJobId('trig1', 'seqA', 'kh1', 0);
    const luong2 = buildSequenceStepJobId('trig1', 'seqB', 'kh1', 0);
    expect(luong1).not.toBe(luong2);
    expect(luong1).toBe('trig1-seqA-kh1-e1-0');
    expect(luong2).toBe('trig1-seqB-kh1-e1-0');
  });

  it('REGRESSION #2: prefix đếm tách theo (trigger,sequence) — 2 luồng KHÔNG đếm lẫn', () => {
    const prefixA = sequenceStepJobPrefix('trig1', 'seqA');
    const prefixB = sequenceStepJobPrefix('trig1', 'seqB');
    expect(prefixA).toBe('trig1-seqA-');
    expect(prefixB).toBe('trig1-seqB-');
    // Job của luồng B KHÔNG khớp prefix luồng A (tryCompleteCampaign không đếm lẫn).
    const jobB = buildSequenceStepJobId('trig1', 'seqB', 'kh1', 2);
    expect(jobB.startsWith(prefixA)).toBe(false);
    expect(jobB.startsWith(prefixB)).toBe(true);
  });

  it('REGRESSION #3 (epoch): gắn LẠI cùng luồng (epoch khác) → jobId KHÁC → không đụng job cũ', () => {
    // Bug anh test 2026-06-15: gắn lại KH đã chạy xong, jobId step 0 trùng job cũ completed
    // → BullMQ dedup nuốt → không gửi. Epoch tách: lần 1 (e1) vs lần 2 (e2) khác mã.
    const lan1 = buildSequenceStepJobId('trig1', 'seqA', 'kh1', 0, 1);
    const lan2 = buildSequenceStepJobId('trig1', 'seqA', 'kh1', 0, 2);
    expect(lan1).toBe('trig1-seqA-kh1-e1-0');
    expect(lan2).toBe('trig1-seqA-kh1-e2-0');
    expect(lan1).not.toBe(lan2);
    // Cả 2 vẫn khớp prefix (trigger,sequence) → tryCompleteCampaign đếm đúng.
    const prefix = sequenceStepJobPrefix('trig1', 'seqA');
    expect(lan1.startsWith(prefix)).toBe(true);
    expect(lan2.startsWith(prefix)).toBe(true);
  });

  it('CÙNG (trigger,sequence,contact,epoch,step) → jobId TRÙNG (dedup giữ trong 1 lần gắn)', () => {
    expect(buildSequenceStepJobId('trig1', 'seqA', 'kh1', 1, 3)).toBe(
      buildSequenceStepJobId('trig1', 'seqA', 'kh1', 1, 3),
    );
  });

  it('KHÔNG chứa dấu ":" (BullMQ v5 cấm)', () => {
    expect(buildSequenceStepJobId('t', 's', 'c', 0, 5)).not.toContain(':');
  });
});

describe('validateRuntimeRules — luật 2 sendGap + luật 3 cooldown', () => {
  it('sendGap hợp lệ', () => {
    const r = validateRuntimeRules({ sendGap: { value: 30, unit: 'second' } });
    expect(r.ok).toBe(true);
  });
  it('sendGap.unit sai → lỗi', () => {
    const r = validateRuntimeRules({ sendGap: { value: 1, unit: 'week' } });
    expect(r.ok).toBe(false);
  });
  it('reEnrollCooldownDays âm → lỗi', () => {
    const r = validateRuntimeRules({ reEnrollCooldownDays: -1 });
    expect(r.ok).toBe(false);
  });
  it('rules rỗng → ok', () => {
    expect(validateRuntimeRules({}).ok).toBe(true);
    expect(validateRuntimeRules(null).ok).toBe(true);
  });
});
