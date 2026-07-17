// SPDX-License-Identifier: AGPL-3.0-or-later
import { api } from '@/api/index';

export type AiEvaluationTarget = 'prompt' | 'model' | 'agent' | 'skill' | 'knowledge' | 'policy';
export type AiEvaluationCriterion =
  | 'accuracy'
  | 'groundedness'
  | 'policy_compliance'
  | 'tone'
  | 'emotion_appropriateness'
  | 'helpfulness'
  | 'sales_effectiveness'
  | 'conciseness'
  | 'hallucination'
  | 'privacy'
  | 'handoff_correctness';

export interface AiEvaluationRunInput {
  name: string;
  targetType: AiEvaluationTarget;
  targetId: string;
  promptVersionId?: string;
  modelConfigId?: string;
  threshold?: number;
}

export interface AiEvaluationCaseResult {
  key: string;
  score: number;
  criteria: Partial<Record<AiEvaluationCriterion, number>>;
}

export interface AiEvaluationRunResult {
  runId: string;
  passed: boolean;
  averageScore: number;
  threshold: number;
  criticalFailures: string[];
  results: AiEvaluationCaseResult[];
  promptVersionId: string;
  modelConfigId: string;
  executionSource: 'server';
  clientOutputsAccepted: false;
  generationFailures: Array<{ key: string; code: string }>;
}

export type AiEvaluationRunStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface AiEvaluationHistoryRun {
  id: string;
  name: string;
  status: AiEvaluationRunStatus;
  agentId: string | null;
  promptVersionId: string | null;
  modelConfigId: string | null;
  datasetVersion: string | null;
  config: {
    targetType: AiEvaluationTarget | null;
    targetId: string | null;
    threshold: number | null;
    suite: string | null;
  };
  metrics: {
    averageScore: number | null;
    threshold: number | null;
    passed: boolean | null;
    criticalFailures: string[];
    caseCount: number | null;
  };
  agent: { id: string; name: string; status: string } | null;
  promptVersion: {
    id: string;
    version: number;
    status: string;
    prompt: { key: string; name: string } | null;
  } | null;
  modelConfig: { id: string; name: string; provider: string; model: string; status: string } | null;
  createdBy: { id: string; fullName: string } | null;
  resultCount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AiEvaluationHistoryCaseResult {
  id: string;
  status: string;
  score: number | null;
  metrics: {
    criteria: Partial<Record<AiEvaluationCriterion, number>>;
    policyViolations: string[];
  };
  errorCode: string | null;
  evaluationCase: { id: string; key: string; name: string; taskType: string; tags: string[] };
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AiEvaluationHistoryDetail extends AiEvaluationHistoryRun {
  results: AiEvaluationHistoryCaseResult[];
}

export interface AiEvaluationHistoryFilters {
  status?: AiEvaluationRunStatus;
  targetType?: AiEvaluationTarget;
  targetId?: string;
  limit?: number;
}
export interface AiEvaluationPromptReference {
  id: string;
  key: string;
  name: string;
  taskType: string;
  scope: string;
  versions: Array<{
    id: string;
    version: number;
    status: string;
    approvedAt?: string | null;
    updatedAt?: string | null;
  }>;
}

export interface AiEvaluationModelReference {
  id: string;
  name: string;
  provider: string;
  model: string;
  status: string;
}

export interface AiEvaluationKnowledgeReference {
  id: string;
  name: string;
  type: string;
  status: string;
  version: number;
  lastIndexedAt?: string | null;
}

export async function seedInitialEvaluationSuite(): Promise<{ count: number; keys: string[] }> {
  const response = await api.post<{ count: number; keys: string[] }>('/ai/evaluations/seed-initial-suite');
  return response.data;
}

/** Server generates every case output. This contract intentionally has no outputs field. */
export async function runServerEvaluation(input: AiEvaluationRunInput): Promise<AiEvaluationRunResult> {
  const response = await api.post<AiEvaluationRunResult>('/ai/evaluations/runs', input);
  return response.data;
}

export async function listEvaluationRuns(
  filters: AiEvaluationHistoryFilters = {},
  signal?: AbortSignal,
): Promise<AiEvaluationHistoryRun[]> {
  const response = await api.get<{ runs: AiEvaluationHistoryRun[] }>('/ai/evaluations/runs', {
    params: filters,
    signal,
  });
  return response.data.runs;
}

export async function getEvaluationRun(
  runId: string,
  signal?: AbortSignal,
): Promise<AiEvaluationHistoryDetail> {
  const response = await api.get<{ run: AiEvaluationHistoryDetail }>(`/ai/evaluations/runs/${encodeURIComponent(runId)}`, { signal });
  return response.data.run;
}
export async function listEvaluationPrompts(signal?: AbortSignal): Promise<AiEvaluationPromptReference[]> {
  const response = await api.get<{ prompts: AiEvaluationPromptReference[] }>('/ai/prompts', { signal });
  return response.data.prompts;
}

export async function listEvaluationModels(signal?: AbortSignal): Promise<AiEvaluationModelReference[]> {
  const response = await api.get<{ modelConfigs: AiEvaluationModelReference[] }>('/ai/prompts/model-configs', { signal });
  return response.data.modelConfigs;
}

export async function listEvaluationKnowledgeSources(signal?: AbortSignal): Promise<AiEvaluationKnowledgeReference[]> {
  const response = await api.get<{ sources: AiEvaluationKnowledgeReference[] }>('/ai/knowledge/sources', { signal });
  return response.data.sources;
}
