// SPDX-License-Identifier: AGPL-3.0-or-later
import { api } from '@/api/index';

export type AiAgentStatus = 'draft' | 'pending_approval' | 'approved' | 'active' | 'inactive' | 'archived';
export type AiAgentAutoReplyMode = 'disabled' | 'shadow' | 'suggested';
export type AiAgentCapability =
  | 'read_conversation'
  | 'generate_reply'
  | 'extract_entities'
  | 'save_ai_message'
  | 'update_conversation_meta'
  | 'create_suggestion'
  | 'notify_internal';

export interface AiAgentPolicy {
  requireHumanReview: boolean;
  requireCitations: boolean;
  confidenceThreshold: number;
  maxReplyLength: number;
  handoffOnRisk: Array<'medium' | 'high' | 'critical'>;
}

export interface AiAgentEvaluationGate {
  passed: boolean;
  runId: string | null;
  completedAt: string | null;
  reason: 'passed' | 'evaluation_required' | 'evaluation_stale';
}

export interface AiAgentPersonaReference {
  id: string;
  name: string;
}

export interface AiAgentPromptVersionReference {
  id: string;
  version: number;
  status: string;
  prompt: { id: string; key: string; name: string; taskType: string } | null;
}

export interface AiAgentModelReference {
  id: string;
  name: string;
  provider: string;
  model: string;
  status: string;
}

export interface AiAgentSkillReference {
  id: string;
  key: string;
  name: string;
  riskTier: string;
}

export interface AiAgentRecord {
  id: string;
  key: string;
  name: string;
  status: AiAgentStatus;
  personaId: string | null;
  promptVersionId: string | null;
  modelConfigId: string | null;
  capabilities: AiAgentCapability[];
  policy: AiAgentPolicy;
  autoReplyMode: AiAgentAutoReplyMode;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  persona: AiAgentPersonaReference | null;
  promptVersion: AiAgentPromptVersionReference | null;
  modelConfig: AiAgentModelReference | null;
  createdBy: { id: string; fullName: string } | null;
  skills: AiAgentSkillReference[];
  evaluationGate: AiAgentEvaluationGate;
}

export interface AiAgentReferences {
  personas: AiAgentPersonaReference[];
  promptVersions: AiAgentPromptVersionReference[];
  modelConfigs: AiAgentModelReference[];
  skills: AiAgentSkillReference[];
  capabilities: AiAgentCapability[];
}

export interface AiAgentCreateInput {
  key: string;
  name: string;
  personaId: string | null;
  promptVersionId: string | null;
  modelConfigId: string | null;
  skillIds: string[];
  capabilities: AiAgentCapability[];
  policy: AiAgentPolicy;
  autoReplyMode: AiAgentAutoReplyMode;
}

export type AiAgentUpdateInput = Omit<AiAgentCreateInput, 'key'>;

export async function listAiAgents(status?: AiAgentStatus, signal?: AbortSignal): Promise<AiAgentRecord[]> {
  const response = await api.get<{ agents: AiAgentRecord[] }>('/ai/agents', {
    params: status ? { status } : undefined,
    signal,
  });
  return response.data.agents;
}

export async function getAiAgent(id: string, signal?: AbortSignal): Promise<AiAgentRecord> {
  const response = await api.get<AiAgentRecord>(`/ai/agents/${encodeURIComponent(id)}`, { signal });
  return response.data;
}

export async function listAiAgentReferences(signal?: AbortSignal): Promise<AiAgentReferences> {
  const response = await api.get<AiAgentReferences>('/ai/agents/references', { signal });
  return response.data;
}

export async function createAiAgent(input: AiAgentCreateInput): Promise<{ id: string; key: string; status: 'draft' }> {
  const response = await api.post<{ id: string; key: string; status: 'draft' }>('/ai/agents', input);
  return response.data;
}

export async function updateAiAgent(id: string, input: AiAgentUpdateInput): Promise<{ id: string; status: 'draft' }> {
  const response = await api.patch<{ id: string; status: 'draft' }>(`/ai/agents/${encodeURIComponent(id)}`, input);
  return response.data;
}

export async function archiveAiAgent(id: string): Promise<{ id: string; archived: true }> {
  const response = await api.delete<{ id: string; archived: true }>(`/ai/agents/${encodeURIComponent(id)}`);
  return response.data;
}

export async function submitAiAgent(id: string): Promise<{ id: string; status: 'pending_approval' }> {
  const response = await api.post<{ id: string; status: 'pending_approval' }>(`/ai/agents/${encodeURIComponent(id)}/submit`);
  return response.data;
}

export async function approveAiAgent(id: string, note?: string): Promise<{ id: string; status: 'approved' }> {
  const response = await api.post<{ id: string; status: 'approved' }>(`/ai/agents/${encodeURIComponent(id)}/approve`, { note });
  return response.data;
}

export async function activateAiAgent(id: string): Promise<{
  id: string;
  status: 'active';
  evaluationGate: AiAgentEvaluationGate;
}> {
  const response = await api.post<{
    id: string;
    status: 'active';
    evaluationGate: AiAgentEvaluationGate;
  }>(`/ai/agents/${encodeURIComponent(id)}/activate`);
  return response.data;
}

export async function deactivateAiAgent(id: string): Promise<{ id: string; status: 'inactive' }> {
  const response = await api.post<{ id: string; status: 'inactive' }>(`/ai/agents/${encodeURIComponent(id)}/deactivate`);
  return response.data;
}
