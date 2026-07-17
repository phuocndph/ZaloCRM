// SPDX-License-Identifier: AGPL-3.0-or-later
import { api } from '@/api/index';

export type AiSkillRiskTier = 'low' | 'medium' | 'high';
export type AiSkillTone = 'warm' | 'clear' | 'reassuring' | 'concise' | 'calm_deescalating' | 'handoff';

export interface AiSkillDefinition {
  key: string;
  name: string;
  goal: string;
  activation: { intents: string[]; conditions: string[] };
  promptKey: string;
  knowledgeScope: { sourceTypes: string[]; tags?: string[] };
  allowedTools: string[];
  allowedActions: string[];
  approvalActions: string[];
  defaultTone: AiSkillTone;
  safetyRules: string[];
  handoffRules: string[];
  confidenceThreshold: number;
  confidenceModeThresholds?: {
    approval_required?: number;
    auto_send_allowed?: number;
    human_handoff?: number;
  };
  riskTier: AiSkillRiskTier;
}

export type AiSkillConfig = Omit<AiSkillDefinition, 'key' | 'name' | 'riskTier'>;

export interface AiSkillPromptSummary {
  id: string;
  key: string;
  name?: string;
  versions: Array<{ id: string; version: number; approvedAt?: string | null }>;
}

export interface AiSkillRecord {
  id: string;
  key: string;
  name: string;
  handlerType: string;
  config: Partial<AiSkillConfig> | null;
  riskTier: AiSkillRiskTier | string;
  createdAt: string;
  updatedAt: string;
  prompts: AiSkillPromptSummary[];
  createdBy?: { id: string; fullName: string } | null;
}

export type AiSkillUpdateInput = Omit<AiSkillDefinition, 'key'>;

export async function listAiSkills(signal?: AbortSignal): Promise<AiSkillRecord[]> {
  const response = await api.get<{ skills: AiSkillRecord[] }>('/ai/skills', { signal });
  return response.data.skills;
}

export async function getAiSkill(id: string, signal?: AbortSignal): Promise<AiSkillRecord> {
  const response = await api.get<AiSkillRecord>(`/ai/skills/${encodeURIComponent(id)}`, { signal });
  return response.data;
}

export async function createAiSkill(input: AiSkillDefinition): Promise<AiSkillRecord> {
  const response = await api.post<AiSkillRecord>('/ai/skills', input);
  return response.data;
}

export async function updateAiSkill(id: string, input: AiSkillUpdateInput): Promise<AiSkillRecord> {
  const response = await api.patch<AiSkillRecord>(`/ai/skills/${encodeURIComponent(id)}`, input);
  return response.data;
}

export async function archiveAiSkill(id: string): Promise<{ id: string; archived: true }> {
  const response = await api.delete<{ id: string; archived: true }>(`/ai/skills/${encodeURIComponent(id)}`);
  return response.data;
}

export async function syncAiSkillCatalog(): Promise<{ created: string[]; catalogSize: number }> {
  const response = await api.post<{ created: string[]; catalogSize: number }>('/ai/skills/catalog/sync');
  return response.data;
}
