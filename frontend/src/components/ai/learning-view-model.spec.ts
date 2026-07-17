import { describe, expect, it } from 'vitest';
import type { LearningCandidate } from '@/api/ai-learning';
import {
  learningCandidatePreview,
  learningStatusLabel,
  learningStatusTone,
  maskSensitiveLearningText,
  safeLearningEvidence,
  safeLearningPayload,
} from './learning-view-model';

describe('Learning view model', () => {
  it('normalizes the legacy pending status for reviewers', () => {
    expect(learningStatusLabel('pending')).toBe('Chờ duyệt');
    expect(learningStatusTone('pending')).toBe('warning');
  });

  it('masks sensitive text again in the browser as defense in depth', () => {
    const result = maskSensitiveLearningText('Gọi 0901234567, email sale@example.com, otp: 123456');
    expect(result).not.toContain('0901234567');
    expect(result).not.toContain('sale@example.com');
    expect(result).not.toContain('123456');
  });

  it('whitelists display fields and never exposes nested context values', () => {
    const payload = safeLearningPayload({
      finalReply: 'Chào anh/chị',
      context: { apiKey: 'secret-value', rawCustomer: 'private' },
      outcome: { token: 'secret-token' },
      knowledgeRefs: [{ id: 'knowledge-1' }],
    });
    expect(payload.finalReply).toBe('Chào anh/chị');
    expect(payload.hiddenContextFields).toBe(2);
    expect(payload.hiddenOutcomeFields).toBe(1);
    expect(JSON.stringify(payload)).not.toContain('secret-value');
    expect(JSON.stringify(payload)).not.toContain('secret-token');
  });

  it('builds preview only from safe redacted text fields', () => {
    const candidate = {
      payload: { finalReply: 'Liên hệ 0901234567' },
    } as LearningCandidate;
    expect(learningCandidatePreview(candidate)).not.toContain('0901234567');
  });

  it('exposes only whitelisted evidence metadata', () => {
    const result = safeLearningEvidence([{
      transition: 'approved->published',
      note: 'Đã kiểm tra',
      materializedType: 'evaluation_case',
      materializedId: 'case-1',
      // Simulate an unexpected field from a legacy response.
      encryptedPayload: 'enc:do-not-render',
    } as never]);
    expect(result[0]).toEqual(expect.objectContaining({ materializationId: 'case-1' }));
    expect(JSON.stringify(result)).not.toContain('enc:do-not-render');
  });
});
