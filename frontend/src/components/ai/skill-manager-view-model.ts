import type { AiSkillDefinition, AiSkillRecord, AiSkillRiskTier, AiSkillTone } from '@/api/ai-skills';

export type AiSkillReadiness = 'ready' | 'needs_prompt' | 'incomplete';
export type AiSkillFilter = { search: string; riskTier: '' | AiSkillRiskTier; readiness: '' | AiSkillReadiness };

const TONES: AiSkillTone[] = ['warm', 'clear', 'reassuring', 'concise', 'calm_deescalating', 'handoff'];

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];
}

function threshold(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function skillDefinitionOf(skill: AiSkillRecord): AiSkillDefinition {
  const config = skill.config || {};
  const activation = config.activation || { intents: [], conditions: [] };
  const knowledgeScope = config.knowledgeScope || { sourceTypes: [] };
  const riskTier = ['low', 'medium', 'high'].includes(skill.riskTier) ? skill.riskTier as AiSkillRiskTier : 'low';
  const defaultTone = TONES.includes(config.defaultTone as AiSkillTone) ? config.defaultTone as AiSkillTone : 'clear';

  return {
    key: skill.key,
    name: skill.name,
    goal: typeof config.goal === 'string' ? config.goal : '',
    activation: { intents: strings(activation.intents), conditions: strings(activation.conditions) },
    promptKey: typeof config.promptKey === 'string' ? config.promptKey : '',
    knowledgeScope: { sourceTypes: strings(knowledgeScope.sourceTypes), tags: strings(knowledgeScope.tags) },
    allowedTools: strings(config.allowedTools),
    allowedActions: strings(config.allowedActions),
    approvalActions: strings(config.approvalActions),
    defaultTone,
    safetyRules: strings(config.safetyRules),
    handoffRules: strings(config.handoffRules),
    confidenceThreshold: threshold(config.confidenceThreshold, 0.8),
    confidenceModeThresholds: config.confidenceModeThresholds,
    riskTier,
  };
}

export function hasProductionPrompt(skill: AiSkillRecord): boolean {
  return skill.prompts.some((prompt) => prompt.versions.length > 0);
}

export function skillReadiness(skill: AiSkillRecord): AiSkillReadiness {
  const definition = skillDefinitionOf(skill);
  if (!definition.goal.trim() || !definition.promptKey.trim()) return 'incomplete';
  if (!hasProductionPrompt(skill)) return 'needs_prompt';
  return 'ready';
}

export function riskLabel(tier: AiSkillRiskTier): string {
  return ({ low: 'Rủi ro thấp', medium: 'Rủi ro vừa', high: 'Rủi ro cao' })[tier];
}

export function readinessLabel(value: AiSkillReadiness): string {
  return ({ ready: 'Sẵn sàng', needs_prompt: 'Thiếu prompt production', incomplete: 'Thiếu cấu hình' })[value];
}

export function parseList(value: string): string[] {
  const seen = new Set<string>();
  return value.split(/[\n,]/).map((item) => item.trim()).filter((item) => {
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function listText(items: string[] | undefined): string {
  return (items || []).join('\n');
}

export function filterAiSkills(skills: AiSkillRecord[], filter: AiSkillFilter): AiSkillRecord[] {
  const search = filter.search.trim().toLocaleLowerCase();
  return skills.filter((skill) => {
    const definition = skillDefinitionOf(skill);
    const haystack = [skill.name, skill.key, definition.goal, definition.promptKey, ...definition.activation.intents].join(' ').toLocaleLowerCase();
    return (!search || haystack.includes(search))
      && (!filter.riskTier || definition.riskTier === filter.riskTier)
      && (!filter.readiness || skillReadiness(skill) === filter.readiness);
  });
}
