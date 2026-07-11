import { describe, expect, it } from 'vitest';
import samples from '../fixtures/intent-engine-samples.json' with { type: 'json' };
vi.mock('../../src/modules/ai/conversation-context-builder-service.js', () => ({
  buildConversationContext: vi.fn(),
  ContextBuilderError: class ContextBuilderError extends Error {},
}));
import { analyzeIntentText } from '../../src/modules/ai/intent-engine-service.js';

describe('IntentEngine', () => {
  it.each(samples)('classifies Vietnamese sample as $primary_intent', async ({ text, primary_intent }) => {
    const output = await analyzeIntentText(text);
    expect(output.primary_intent).toBe(primary_intent);
  });
  it('extracts entities and keeps discount request as human-required', async () => {
    const output = await analyzeIntentText('Cho mình giảm giá 10 cái model X, ngân sách 3.8 triệu');
    expect(output.primary_intent).toBe('discount_request');
    expect(output.requires_human).toBe(true);
    expect(output.extracted_entities.quantity).toBe(10);
    expect(output.extracted_entities.amount).toContain('3.8');
  });
  it('returns unknown below threshold and does not invent a skill', async () => {
    const output = await analyzeIntentText('hmm abc xyz lkj');
    expect(output).toMatchObject({ primary_intent: 'unknown', suggested_skill: null });
    expect(output.confidence).toBeLessThan(0.58);
  });
  it('does not invoke a model without an explicitly selected model configuration', async () => {
    const output = await analyzeIntentText('alo');
    expect(output.primary_intent).toBe('greeting');
  });
});
