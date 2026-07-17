// SPDX-License-Identifier: AGPL-3.0-or-later
import { api } from '@/api/index';

export type LearningCandidateStatus =
  | 'collected'
  | 'filtered'
  | 'pending'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'published';

export type LearningCandidateKind =
  | 'used_reply_pattern'
  | 'edited_reply_pattern'
  | 'knowledge_gap'
  | 'question_pattern'
  | 'prompt_improvement'
  | 'skill_improvement'
  | 'evaluation_case';

export type LearningRiskTier = 'low' | 'medium' | 'high';

export interface LearningCandidatePayload {
  version?: number;
  kind?: LearningCandidateKind | string;
  feedbackId?: string;
  type?: string;
  selectionStatus?: string;
  proposedReply?: string;
  finalReply?: string;
  reason?: string;
  editDistance?: number;
  knowledgeRefs?: unknown[];
  context?: Record<string, unknown>;
  outcome?: Record<string, unknown>;
}

export interface LearningEvidence {
  feedbackId?: string;
  type?: string;
  selectionStatus?: string;
  quoteGenerated?: boolean;
  orderGenerated?: boolean;
  redacted?: boolean;
  transition?: string;
  note?: string;
  at?: string;
  materializedType?: string;
  materializedId?: string;
  productionChanged?: boolean;
}

/**
 * Intentionally excludes payloadEncrypted. The Learning UI must only consume
 * the server-provided redacted payload and whitelisted evidence metadata.
 */
export interface LearningCandidate {
  id: string;
  kind: LearningCandidateKind | string;
  status: LearningCandidateStatus;
  riskTier: LearningRiskTier | string;
  payloadHash: string;
  payload: LearningCandidatePayload | null;
  evidence: LearningEvidence[];
  reviewedAt: string | null;
  createdAt: string;
  feedbackId: string | null;
}

export interface LearningInsights {
  feedbackCounts: Record<string, number>;
  recommendations: Array<{
    target: 'prompt' | 'knowledge' | 'skill' | 'evaluation' | string;
    condition: number;
    action: string;
  }>;
  automaticProductionChange: false;
}

export interface LearningCollectionResult {
  scanned: number;
  created: number;
  filtered: number;
  duplicates: number;
}

export interface LearningMaterializationResult {
  materialization: {
    type: 'evaluation_case';
    id: string;
    key: string;
    status: string;
  } | null;
  productionChanged: false;
  idempotent: boolean;
}

export async function getLearningInsights(): Promise<LearningInsights> {
  return (await api.get<LearningInsights>('/ai/learning/insights')).data;
}

export async function listLearningCandidates(options: {
  status?: LearningCandidateStatus;
  limit?: number;
} = {}): Promise<LearningCandidate[]> {
  const response = await api.get<{ candidates: LearningCandidate[] }>('/ai/learning/candidates', {
    params: options,
  });
  return response.data.candidates;
}

export async function collectLearningCandidates(options: {
  limit?: number;
  since?: string;
} = {}): Promise<LearningCollectionResult> {
  return (await api.post<LearningCollectionResult>('/ai/learning/collect', options)).data;
}

export async function transitionLearningCandidate(
  candidateId: string,
  status: Exclude<LearningCandidateStatus, 'pending'>,
  note: string,
): Promise<void> {
  // Deliberately discard the route response: older backend versions returned
  // the Prisma row, which can include encrypted bytes. They never enter UI state.
  await api.post(`/ai/learning/candidates/${encodeURIComponent(candidateId)}/transition`, {
    status,
    note,
  });
}

export async function materializeLearningCandidate(
  candidateId: string,
  note: string,
): Promise<LearningMaterializationResult> {
  const response = await api.post<{
    materialization?: LearningMaterializationResult['materialization'];
    productionChanged?: boolean;
    idempotent?: boolean;
  }>(`/ai/learning/candidates/${encodeURIComponent(candidateId)}/transition`, {
    status: 'published',
    note,
  });

  // Whitelist only safe materialization metadata. Never forward candidate or
  // encrypted payload fields that a legacy backend response may contain.
  return {
    materialization: response.data.materialization ?? null,
    productionChanged: false,
    idempotent: response.data.idempotent === true,
  };
}

