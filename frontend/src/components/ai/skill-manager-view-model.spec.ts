import { describe, expect, it } from 'vitest';
import type { AiSkillRecord } from '@/api/ai-skills';
import { filterAiSkills, parseList, skillDefinitionOf, skillReadiness } from './skill-manager-view-model';

function record(overrides: Partial<AiSkillRecord> = {}): AiSkillRecord {
  return {
    id: 'skill-1', key: 'quote_assistant', name: 'Quote Assistant', handlerType: 'skill_definition',
    riskTier: 'high', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    config: { goal: 'Tạo nháp báo giá', promptKey: 'skill.quote', activation: { intents: ['quote_request'], conditions: [] } },
    prompts: [{ id: 'prompt-1', key: 'skill.quote', versions: [{ id: 'version-1', version: 1 }] }],
    ...overrides,
  };
}

describe('Skill manager view model', () => {
  it('normalizes legacy or partial config without inventing capabilities', () => {
    const definition = skillDefinitionOf(record({ config: { goal: 'Tư vấn' }, riskTier: 'unknown' }));
    expect(definition.riskTier).toBe('low');
    expect(definition.allowedTools).toEqual([]);
    expect(definition.activation).toEqual({ intents: [], conditions: [] });
    expect(definition.confidenceThreshold).toBe(0.8);
  });

  it('derives readiness from required config and a linked production prompt', () => {
    expect(skillReadiness(record())).toBe('ready');
    expect(skillReadiness(record({ prompts: [] }))).toBe('needs_prompt');
    expect(skillReadiness(record({ config: { goal: '', promptKey: '' } }))).toBe('incomplete');
  });

  it('filters by text, risk and derived readiness', () => {
    const skills = [record(), record({ id: 'skill-2', key: 'faq', name: 'FAQ', riskTier: 'low', prompts: [] })];
    expect(filterAiSkills(skills, { search: 'quote_request', riskTier: 'high', readiness: 'ready' })).toEqual([skills[0]]);
    expect(filterAiSkills(skills, { search: '', riskTier: '', readiness: 'needs_prompt' })).toEqual([skills[1]]);
  });

  it('parses comma/newline lists and removes duplicates', () => {
    expect(parseList('context.read, knowledge.search\nCONTEXT.READ')).toEqual(['context.read', 'knowledge.search']);
  });
});
