import { describe, expect, it, vi } from 'vitest';
import samples from '../fixtures/emotion-engine-samples.json' with { type: 'json' };
vi.mock('../../src/modules/ai/conversation-context-builder-service.js', () => ({ buildConversationContext: vi.fn(), ContextBuilderError: class ContextBuilderError extends Error {} }));
import { analyzeEmotionMessages } from '../../src/modules/ai/emotion-engine-service.js';
describe('EmotionEngine', () => {
  it.each(samples)('classifies contextual Vietnamese messages as $emotion', async ({ messages, emotion }) => { expect((await analyzeEmotionMessages(messages)).emotion).toBe(emotion); });
  it('does not label one isolated negative word as angry', async () => { const output = await analyzeEmotionMessages(['Tệ']); expect(output.emotion).toBe('neutral'); expect(output.escalation_required).toBe(false); });
  it('requires escalation for strong angry or disappointed context', async () => { const angry = await analyzeEmotionMessages(['Tôi rất tức vì chờ ba ngày', 'Giải quyết ngay cho tôi']); const disappointed = await analyzeEmotionMessages(['Hàng khác mô tả', 'Thật vọng, không hài lòng']); expect(angry).toMatchObject({ emotion: 'angry', escalation_required: true, suggested_tone: 'handoff' }); expect(disappointed.escalation_required).toBe(true); });
  it('keeps no model call path deterministic', async () => { const output = await analyzeEmotionMessages(['Cảm ơn shop nhiều nhé']); expect(output.emotion).toBe('satisfied'); });
});
