import { describe, expect, it } from 'vitest';
import type { AiReleaseRecord } from '@/api/ai-releases';
import {
  filterAiReleases,
  releaseActionStates,
  releaseComponentCount,
  releaseErrorMessage,
  releaseLifecycleIndex,
  releaseSnapshotCounts,
  releaseStatusMeta,
} from './release-manager-view-model';

function record(overrides: Partial<AiReleaseRecord> = {}): AiReleaseRecord {
  return {
    id: 'release-1',
    version: 4,
    status: 'draft',
    snapshot: {
      schemaVersion: 1,
      promptVersions: [{ id: 'prompt-version-1', promptId: 'prompt-1', version: 2, status: 'production', contentHash: 'hash' }],
      modelConfigs: [{ id: 'model-1', name: '9Router chính', provider: 'openai-compatible', model: 'model-a', status: 'active', parametersHash: 'hash', dataPolicyHash: 'hash' }],
      skills: [{ id: 'skill-1', key: 'sales.reply', name: 'Tư vấn bán hàng', riskTier: 'low', configHash: 'hash' }],
      knowledgeSources: [{ id: 'source-1', name: 'Bảng giá Q3', type: 'price_list', version: 3, status: 'published', configHash: 'hash', scopeHash: 'hash', lastIndexedAt: null }],
      knowledgeDocuments: [],
    },
    snapshotHash: 'snapshot-hash',
    evaluationRunId: 'run-1',
    previousReleaseId: 'release-0',
    createdByUserId: 'maker-1',
    approvedByUserId: null,
    deployedByUserId: null,
    rolledBackByUserId: null,
    createdAt: '2026-07-01T00:00:00Z',
    approvedAt: null,
    deployedAt: null,
    rolledBackAt: null,
    activationSemantics: { activePointerOnly: true, componentProductionStateChanged: false },
    ...overrides,
  };
}

describe('release manager view model', () => {
  it('labels the complete lifecycle in Vietnamese', () => {
    expect(releaseStatusMeta('draft').label).toBe('Bản nháp');
    expect(releaseStatusMeta('pending_approval').label).toContain('Chờ duyệt');
    expect(releaseStatusMeta('production')).toMatchObject({ label: 'Đang áp dụng', tone: 'live' });
    expect(releaseStatusMeta('rolled_back').shortLabel).toContain('rollback');
    expect(releaseStatusMeta('failed').tone).toBe('danger');
    expect(releaseStatusMeta('superseded').label).toBe('Đã được thay thế');
  });

  it('exposes only valid lifecycle actions', () => {
    expect(releaseActionStates(record()).map((item) => item.action)).toEqual(['submit']);
    expect(releaseActionStates(record({ status: 'pending_approval' })).map((item) => item.action)).toEqual(['approve']);
    expect(releaseActionStates(record({ status: 'approved' })).map((item) => item.action)).toEqual(['deploy']);
    expect(releaseActionStates(record({ status: 'production' })).map((item) => item.action)).toEqual(['rollback']);
    expect(releaseActionStates(record({ status: 'rolled_back' }))).toEqual([]);
  });

  it('blocks submit without an evaluation and rollback without a previous release', () => {
    expect(releaseActionStates(record({ evaluationRunId: null }))[0]).toMatchObject({ enabled: false });
    expect(releaseActionStates(record({ status: 'production', previousReleaseId: null }))[0]).toMatchObject({ enabled: false });
  });

  it('summarizes and searches all snapshot component types', () => {
    expect(releaseSnapshotCounts(record())).toEqual({ prompts: 1, models: 1, skills: 1, knowledge: 1 });
    expect(releaseComponentCount(record())).toBe(4);
    expect(filterAiReleases([record()], 'bảng giá', '')).toHaveLength(1);
    expect(filterAiReleases([record()], '9router', '')).toHaveLength(1);
    expect(filterAiReleases([record()], '', 'approved')).toHaveLength(0);
  });

  it('maps backend safety errors to actionable messages', () => {
    expect(releaseErrorMessage({ response: { data: { code: 'RELEASE_MAKER_CHECKER_REQUIRED' } } }))
      .toContain('không được tự phê duyệt');
    expect(releaseErrorMessage({ response: { data: { code: 'RELEASE_EVALUATION_TARGET_MISMATCH' } } }))
      .toContain('không khớp');
    expect(releaseErrorMessage({ response: { data: { error: 'Thông báo riêng' } } })).toBe('Thông báo riêng');
  });

  it('tracks the controlled happy-path lifecycle', () => {
    expect(['draft', 'pending_approval', 'approved', 'production'].map((status) => releaseLifecycleIndex(status as AiReleaseRecord['status'])))
      .toEqual([0, 1, 2, 3]);
    expect(releaseLifecycleIndex('failed')).toBe(-1);
  });
});
