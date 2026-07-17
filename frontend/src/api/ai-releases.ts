// SPDX-License-Identifier: AGPL-3.0-or-later
import { api } from '@/api/index';

export type AiReleaseStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'production'
  | 'superseded'
  | 'rolled_back'
  | 'failed';

export interface AiReleaseSnapshotRefs {
  promptVersionIds?: string[];
  modelConfigIds?: string[];
  skillIds?: string[];
  knowledgeSourceIds?: string[];
  knowledgeDocumentIds?: string[];
}

export interface AiReleaseSnapshot {
  schemaVersion: 1;
  promptVersions: Array<{
    id: string;
    promptId: string;
    version: number;
    status: string;
    contentHash: string;
  }>;
  modelConfigs: Array<{
    id: string;
    name: string;
    provider: string;
    model: string;
    status: string;
    parametersHash: string;
    dataPolicyHash: string;
  }>;
  skills: Array<{
    id: string;
    key: string;
    name: string;
    riskTier: string;
    configHash: string;
  }>;
  knowledgeSources: Array<{
    id: string;
    name: string;
    type: string;
    version: number;
    status: string;
    configHash: string;
    scopeHash: string;
    lastIndexedAt: string | null;
  }>;
  knowledgeDocuments: Array<{
    id: string;
    sourceId: string;
    title: string;
    version: number;
    status: string;
    contentHash: string | null;
    lastIndexedAt: string | null;
  }>;
}

export interface AiReleaseActivationSemantics {
  activePointerOnly: true;
  componentProductionStateChanged: false;
}

export interface AiReleaseRecord {
  id: string;
  orgId?: string;
  version: number;
  status: AiReleaseStatus;
  snapshot: AiReleaseSnapshot;
  snapshotHash: string;
  evaluationRunId: string | null;
  previousReleaseId: string | null;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  deployedByUserId: string | null;
  rolledBackByUserId: string | null;
  createdAt: string;
  approvedAt: string | null;
  deployedAt: string | null;
  rolledBackAt: string | null;
  activationSemantics: AiReleaseActivationSemantics;
}

export interface AiReleaseListResult {
  releases: AiReleaseRecord[];
  activationSemantics: AiReleaseActivationSemantics;
}

export async function listAiReleases(options: {
  status?: AiReleaseStatus;
  limit?: number;
  signal?: AbortSignal;
} = {}): Promise<AiReleaseListResult> {
  const response = await api.get<AiReleaseListResult>('/ai/releases', {
    params: {
      ...(options.status ? { status: options.status } : {}),
      ...(options.limit ? { limit: options.limit } : {}),
    },
    signal: options.signal,
  });
  return response.data;
}

export async function getAiRelease(id: string, signal?: AbortSignal): Promise<AiReleaseRecord> {
  const response = await api.get<AiReleaseRecord>(`/ai/releases/${encodeURIComponent(id)}`, { signal });
  return response.data;
}

export async function createAiRelease(input: {
  snapshot: AiReleaseSnapshotRefs;
  evaluationRunId?: string | null;
}): Promise<AiReleaseRecord> {
  const response = await api.post<AiReleaseRecord>('/ai/releases', input);
  return response.data;
}

export async function submitAiRelease(id: string, evaluationRunId?: string): Promise<AiReleaseRecord> {
  const response = await api.post<AiReleaseRecord>(
    `/ai/releases/${encodeURIComponent(id)}/submit`,
    evaluationRunId ? { evaluationRunId } : {},
  );
  return response.data;
}

export async function approveAiRelease(id: string): Promise<AiReleaseRecord> {
  const response = await api.post<AiReleaseRecord>(`/ai/releases/${encodeURIComponent(id)}/approve`);
  return response.data;
}

export async function deployAiRelease(id: string): Promise<AiReleaseRecord> {
  const response = await api.post<AiReleaseRecord>(`/ai/releases/${encodeURIComponent(id)}/deploy`);
  return response.data;
}

export async function rollbackAiRelease(id: string): Promise<{
  rolledBackRelease: AiReleaseRecord;
  activeRelease: AiReleaseRecord;
  activationSemantics: AiReleaseActivationSemantics;
}> {
  const response = await api.post<{
    rolledBackRelease: AiReleaseRecord;
    activeRelease: AiReleaseRecord;
    activationSemantics: AiReleaseActivationSemantics;
  }>(`/ai/releases/${encodeURIComponent(id)}/rollback`);
  return response.data;
}
