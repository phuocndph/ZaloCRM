import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: {} }));
import { generateReplyDraft, replyGeneratorInternals, type ReplyInput } from '../../src/modules/ai/reply-generator-service.js';

describe('ReplyGenerator skill routing', () => {
  const skill = (id: string, key: string, intents: string[], confidenceThreshold = .55) => ({ id, key, name: key, riskTier: 'medium', config: { activation: { intents, conditions: [] }, confidenceThreshold, knowledgeScope: { sourceTypes: [] } }, deletedAt: null });
  it('selects the intent-specific skill before the generic fallback', () => {
    const selected = replyGeneratorInternals.selectRuntimeSkill([
      skill('generic', 'general_assistant', ['price_inquiry']),
      skill('price', 'price_inquiry', ['price_inquiry']),
    ], { primary_intent: 'price_inquiry', confidence: .92, suggested_skill: 'price_inquiry' });
    expect(selected?.id).toBe('price');
  });
  it('honors an explicitly requested linked skill', () => {
    const selected = replyGeneratorInternals.selectRuntimeSkill([
      skill('generic', 'general_assistant', ['complaint']),
      skill('complaint', 'complaint_handling', ['complaint']),
    ], { primary_intent: 'complaint', confidence: .95 }, 'generic');
    expect(selected?.id).toBe('generic');
  });
  it('normalizes confidence mode thresholds to percentage values', () => {
    const definition = replyGeneratorInternals.skillDefinition({
      ...skill('generic', 'general_assistant', ['unknown']),
      config: { confidenceModeThresholds: { approval_required: .65, auto_send_allowed: 90, human_handoff: .45 } },
    });
    expect(definition.confidenceModeThresholds).toEqual({ approval_required: 65, auto_send_allowed: 90, human_handoff: 45 });
  });
});
const base: ReplyInput = { context: { conversationId: 'c1', orgId: 'o1', generatedAt: '', tokenBudget: 100, tokenEstimate: 1, truncated: false, truncation: { droppedSections: [], droppedMessages: 0, originalTokenEstimate: 1 }, access: { allowed: true, contentVisible: true } as any, sources: [], sections: [{ id: 'recent_messages', title: '', priority: 1, tokenEstimate: 1, sources: [], items: [{ senderType: 'contact', content: 'Cho mình xin báo giá' }] }] }, customerMemory: [], intent: { primary_intent: 'price_inquiry', confidence: .9 }, emotion: { emotion: 'interested', confidence: .8, intensity: .4, suggested_tone: 'warm' }, knowledgeResults: [], skill: { id: 's1', key: 'price_inquiry', name: 'Price', config: { key: 'price_inquiry', name: 'Price', goal: '', activation: { intents: ['price_inquiry'], conditions: [] }, promptKey: 'skill.price_inquiry', knowledgeScope: { sourceTypes: ['price_list'] }, allowedTools: [], allowedActions: ['suggest_reply'], approvalActions: ['send_price_commitment'], defaultTone: 'clear', safetyRules: [], handoffRules: [], confidenceThreshold: .78, riskTier: 'medium' } } };
describe('ReplyGenerator', () => { it('blocks an unsupported price promise and requires human review', async () => { const output = await generateReplyDraft(base); expect(output.requires_human).toBe(true); expect(output.do_not_send_reason).toContain('nguồn kiến thức'); expect(output.reply_text).not.toMatch(/giá là|giảm giá/i); }); it('returns citations when approved knowledge is supplied', async () => { const output = await generateReplyDraft({ ...base, intent: { primary_intent: 'product_inquiry', confidence: .9 }, skill: { ...base.skill, key: 'product_advisor', config: { ...base.skill.config, confidenceThreshold: .6 } }, knowledgeResults: [{ excerpt: 'Sản phẩm có bảo hành 12 tháng.', citation: { sourceId: 'k1', documentId: 'd1', chunkId: 'c1', sourceType: 'policy' } }] }); expect(output.sources).toHaveLength(1); expect(output.requires_human).toBe(false); expect(output.reply_text).toContain('bảo hành'); }); it('asks clarification when required information is missing', async () => { const output = await generateReplyDraft({ ...base, intent: { primary_intent: 'product_inquiry', confidence: .9, missing_information: ['product_or_variant'] }, skill: { ...base.skill, key: 'product_advisor', config: { ...base.skill.config, confidenceThreshold: .6 } } }); expect(output.reply_text).toContain('product_or_variant'); }); it('applies user tone preference without sending', async () => { const output = await generateReplyDraft({ ...base, employeeTone: 'professional' }); expect(output.reply_text).toMatch(/^Xin chào/); expect(output.suggested_actions).toContain('review_before_send'); }); });
