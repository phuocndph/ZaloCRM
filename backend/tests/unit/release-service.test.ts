import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx: any = {
    $executeRawUnsafe: vi.fn(),
    aiPromptVersion: { findMany: vi.fn() },
    aiModelConfig: { findMany: vi.fn() },
    aiSkill: { findMany: vi.fn() },
    aiKnowledgeSource: { findMany: vi.fn() },
    aiKnowledgeDocument: { findMany: vi.fn() },
    aiEvaluationRun: { findFirst: vi.fn() },
    aiRelease: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    aiAuditLog: { create: vi.fn() },
  };
  return { tx, tenantTransaction: vi.fn() };
});

vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: mocks.tx,
  tenantTransaction: mocks.tenantTransaction,
}));

import {
  approveRelease,
  createRelease,
  deployRelease,
  releaseInternals,
  rollbackRelease,
  submitRelease,
} from '../../src/modules/ai/release-service.js';

const maker = { orgId: 'org-1', userId: 'maker-1' };
const checker = { orgId: 'org-1', userId: 'checker-1' };
const refs = {
  promptVersionIds: ['prompt-v1'],
  modelConfigIds: ['model-1'],
  skillIds: ['skill-1'],
  knowledgeSourceIds: ['source-1'],
  knowledgeDocumentIds: ['doc-1'],
};

function snapshot() {
  return {
    schemaVersion: 1,
    promptVersions: [{ id: 'prompt-v1', promptId: 'prompt-1', version: 3, status: 'approved', contentHash: 'content-hash' }],
    modelConfigs: [{
      id: 'model-1', name: 'Router', provider: 'openai', model: 'router-model', status: 'active',
      parametersHash: releaseInternals.hashJson({ temperature: 0.2 }),
      dataPolicyHash: releaseInternals.hashJson({ allowContent: true }),
    }],
    skills: [{
      id: 'skill-1', key: 'reply', name: 'Reply', riskTier: 'low',
      configHash: releaseInternals.hashJson({ threshold: 0.8 }),
    }],
    knowledgeSources: [{
      id: 'source-1', name: 'FAQ', type: 'faq', version: 2, status: 'published',
      configHash: releaseInternals.hashJson({}), scopeHash: releaseInternals.hashJson({ visibility: 'org' }),
      lastIndexedAt: '2026-07-15T00:00:00.000Z',
    }],
    knowledgeDocuments: [{
      id: 'doc-1', sourceId: 'source-1', title: 'FAQ v2', version: 2, status: 'published',
      contentHash: 'doc-hash', lastIndexedAt: '2026-07-15T00:00:00.000Z',
    }],
  };
}

function release(status: string, overrides: Record<string, unknown> = {}) {
  const storedSnapshot = snapshot();
  return {
    id: 'release-2',
    orgId: 'org-1',
    version: 2,
    status,
    snapshot: storedSnapshot,
    snapshotHash: releaseInternals.hashJson(storedSnapshot),
    evaluationRunId: 'eval-1',
    previousReleaseId: 'release-1',
    createdByUserId: 'maker-1',
    approvedByUserId: status === 'approved' || status === 'production' ? 'checker-1' : null,
    approvedAt: status === 'approved' || status === 'production' ? new Date() : null,
    deployedByUserId: status === 'production' ? 'deployer-1' : null,
    deployedAt: status === 'production' ? new Date() : null,
    rolledBackByUserId: null,
    rolledBackAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('AI release service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tenantTransaction.mockImplementation(async (callback: any) => callback(mocks.tx));
    mocks.tx.$executeRawUnsafe.mockResolvedValue(1);
    mocks.tx.aiPromptVersion.findMany.mockResolvedValue([
      { id: 'prompt-v1', promptId: 'prompt-1', version: 3, status: 'approved', contentHash: 'content-hash' },
    ]);
    mocks.tx.aiModelConfig.findMany.mockResolvedValue([
      { id: 'model-1', name: 'Router', provider: 'openai', model: 'router-model', status: 'active', parameters: { temperature: 0.2 }, dataPolicy: { allowContent: true } },
    ]);
    mocks.tx.aiSkill.findMany.mockResolvedValue([
      { id: 'skill-1', key: 'reply', name: 'Reply', riskTier: 'low', config: { threshold: 0.8 } },
    ]);
    mocks.tx.aiKnowledgeSource.findMany.mockResolvedValue([
      { id: 'source-1', name: 'FAQ', type: 'faq', version: 2, status: 'published', config: {}, scope: { visibility: 'org' }, lastIndexedAt: new Date('2026-07-15T00:00:00.000Z') },
    ]);
    mocks.tx.aiKnowledgeDocument.findMany.mockResolvedValue([
      { id: 'doc-1', sourceId: 'source-1', title: 'FAQ v2', version: 2, status: 'published', contentHash: 'doc-hash', lastIndexedAt: new Date('2026-07-15T00:00:00.000Z') },
    ]);
    mocks.tx.aiEvaluationRun.findFirst.mockResolvedValue({
      id: 'eval-1',
      status: 'completed',
      completedAt: new Date(),
      promptVersionId: 'prompt-v1',
      modelConfigId: 'model-1',
      config: { targetType: 'prompt', targetId: 'prompt-v1' },
      metrics: { passed: true },
    });
    mocks.tx.aiAuditLog.create.mockResolvedValue({});
    mocks.tx.aiRelease.update.mockImplementation(async ({ where, data }: any) => ({
      ...release(data.status ?? 'draft', { id: where.id }),
      ...data,
    }));
  });

  it('creates a canonical immutable manifest with a sha256 hash and next org version', async () => {
    mocks.tx.aiRelease.findFirst.mockImplementation(async ({ where, orderBy }: any) => {
      if (orderBy?.version) return { version: 4 };
      if (where.status === 'production') return { id: 'release-production' };
      return null;
    });
    mocks.tx.aiRelease.create.mockImplementation(async ({ data }: any) => ({ id: 'release-5', ...data }));

    const result = await createRelease(maker, { snapshot: refs, evaluationRunId: 'eval-1' });
    const data = mocks.tx.aiRelease.create.mock.calls[0][0].data;

    expect(data).toMatchObject({
      orgId: 'org-1', version: 5, status: 'draft', evaluationRunId: 'eval-1',
      previousReleaseId: 'release-production', createdByUserId: 'maker-1',
    });
    expect(data.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.snapshot.modelConfigs[0]).not.toHaveProperty('parameters');
    expect(data.snapshot.modelConfigs[0].parametersHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.activationSemantics).toEqual({ activePointerOnly: true, componentProductionStateChanged: false });
    expect(mocks.tx.aiAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'release.created', targetId: 'release-5' }),
    }));
  });

  it('rejects a component reference that cannot be resolved inside the organization', async () => {
    mocks.tx.aiSkill.findMany.mockResolvedValue([]);

    await expect(createRelease(maker, { snapshot: refs })).rejects.toMatchObject({
      code: 'RELEASE_COMPONENT_NOT_FOUND', statusCode: 404,
    });
    expect(mocks.tx.aiRelease.create).not.toHaveBeenCalled();
  });

  it('rejects a forged or unrelated passing evaluation target', async () => {
    mocks.tx.aiEvaluationRun.findFirst.mockResolvedValue({
      id: 'eval-forged', status: 'completed', completedAt: new Date(),
      promptVersionId: 'prompt-other', modelConfigId: 'model-1',
      config: { targetType: 'prompt', targetId: 'prompt-other' }, metrics: { passed: true },
    });

    await expect(createRelease(maker, { snapshot: refs, evaluationRunId: 'eval-forged' })).rejects.toMatchObject({
      code: 'RELEASE_EVALUATION_TARGET_MISMATCH', statusCode: 409,
    });
    expect(mocks.tx.aiRelease.create).not.toHaveBeenCalled();
  });

  it('does not allow the creator to approve their own submitted release', async () => {
    mocks.tx.aiRelease.findFirst.mockResolvedValue(release('pending_approval'));

    await expect(approveRelease(maker, 'release-2')).rejects.toMatchObject({
      code: 'RELEASE_MAKER_CHECKER_REQUIRED', statusCode: 403,
    });
    expect(mocks.tx.aiRelease.update).not.toHaveBeenCalled();
  });

  it('never changes snapshot or snapshotHash while submitting', async () => {
    mocks.tx.aiRelease.findFirst.mockResolvedValue(release('draft'));

    await submitRelease(maker, 'release-2', 'eval-1');

    const data = mocks.tx.aiRelease.update.mock.calls[0][0].data;
    expect(data).toEqual({ status: 'pending_approval', evaluationRunId: 'eval-1' });
    expect(data).not.toHaveProperty('snapshot');
    expect(data).not.toHaveProperty('snapshotHash');
  });

  it('refuses a transition if the stored immutable snapshot hash was changed', async () => {
    mocks.tx.aiRelease.findFirst.mockResolvedValue(release('draft', { snapshotHash: '0'.repeat(64) }));

    await expect(submitRelease(maker, 'release-2', 'eval-1')).rejects.toMatchObject({
      code: 'RELEASE_SNAPSHOT_TAMPERED', statusCode: 409,
    });
    expect(mocks.tx.aiRelease.update).not.toHaveBeenCalled();
  });

  it('atomically supersedes the only production pointer before deploying the approved release', async () => {
    const target = release('approved');
    const active = release('production', { id: 'release-1', version: 1, previousReleaseId: null });
    mocks.tx.aiRelease.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.id === 'release-2') return target;
      if (where.status === 'production') return active;
      return null;
    });

    const result = await deployRelease({ orgId: 'org-1', userId: 'deployer-1' }, 'release-2');

    expect(mocks.tx.aiRelease.update.mock.calls[0][0]).toEqual({
      where: { id: 'release-1' }, data: { status: 'superseded' },
    });
    expect(mocks.tx.aiRelease.update.mock.calls[1][0]).toEqual(expect.objectContaining({
      where: { id: 'release-2' },
      data: expect.objectContaining({ status: 'production', previousReleaseId: 'release-1', deployedByUserId: 'deployer-1' }),
    }));
    expect(result.activationSemantics.componentProductionStateChanged).toBe(false);
  });

  it('atomically rolls production back to its previous superseded release', async () => {
    const current = release('production');
    const previous = release('superseded', { id: 'release-1', version: 1, previousReleaseId: null });
    mocks.tx.aiRelease.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.id === 'release-2') return current;
      if (where.id === 'release-1') return previous;
      return null;
    });

    const result = await rollbackRelease({ orgId: 'org-1', userId: 'operator-1' }, 'release-2');

    expect(mocks.tx.aiRelease.update.mock.calls[0][0]).toEqual(expect.objectContaining({
      where: { id: 'release-2' }, data: expect.objectContaining({ status: 'rolled_back', rolledBackByUserId: 'operator-1' }),
    }));
    expect(mocks.tx.aiRelease.update.mock.calls[1][0]).toEqual({
      where: { id: 'release-1' }, data: { status: 'production' },
    });
    expect(result.activeRelease).toMatchObject({ id: 'release-1', status: 'production' });
    expect(mocks.tx.aiAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'release.rolled_back' }),
    }));
  });
});
