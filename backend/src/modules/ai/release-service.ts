import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';

export const AI_RELEASE_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'production',
  'superseded',
  'rolled_back',
  'failed',
] as const;

export type AiReleaseStatus = (typeof AI_RELEASE_STATUSES)[number];
export type ReleaseActor = { orgId: string; userId: string };

export type ReleaseSnapshotRefs = {
  promptVersionIds?: string[];
  modelConfigIds?: string[];
  skillIds?: string[];
  knowledgeSourceIds?: string[];
  knowledgeDocumentIds?: string[];
};

type ReleaseSnapshot = {
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
};

type Db = any;

export class ReleaseError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = 'AI_RELEASE_ERROR',
  ) {
    super(message);
    this.name = 'ReleaseError';
  }
}

const activationSemantics = Object.freeze({
  activePointerOnly: true,
  componentProductionStateChanged: false,
});

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashJson(value: unknown): string {
  return sha256(stableStringify(value));
}

function normalizeIds(value: unknown, label: string, max: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ReleaseError(`${label} must be an array`, 400, 'RELEASE_SNAPSHOT_INVALID');
  const ids = [...new Set(value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean))];
  if (ids.length > max) throw new ReleaseError(`${label} exceeds the maximum of ${max}`, 400, 'RELEASE_SNAPSHOT_TOO_LARGE');
  return ids.sort();
}

function normalizeRefs(input: ReleaseSnapshotRefs): Required<ReleaseSnapshotRefs> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ReleaseError('snapshot is required', 400, 'RELEASE_SNAPSHOT_REQUIRED');
  }
  const refs = {
    promptVersionIds: normalizeIds(input.promptVersionIds, 'promptVersionIds', 100),
    modelConfigIds: normalizeIds(input.modelConfigIds, 'modelConfigIds', 50),
    skillIds: normalizeIds(input.skillIds, 'skillIds', 100),
    knowledgeSourceIds: normalizeIds(input.knowledgeSourceIds, 'knowledgeSourceIds', 200),
    knowledgeDocumentIds: normalizeIds(input.knowledgeDocumentIds, 'knowledgeDocumentIds', 500),
  };
  if (!Object.values(refs).some((ids) => ids.length > 0)) {
    throw new ReleaseError('Release snapshot must contain at least one component', 400, 'RELEASE_SNAPSHOT_EMPTY');
  }
  return refs;
}

function assertAllFound(label: string, requested: string[], rows: Array<{ id: string }>): void {
  const found = new Set(rows.map((row) => row.id));
  const missing = requested.filter((id) => !found.has(id));
  if (missing.length) {
    throw new ReleaseError(`${label} not found in this organization`, 404, 'RELEASE_COMPONENT_NOT_FOUND');
  }
}

async function resolveSnapshot(db: Db, orgId: string, input: ReleaseSnapshotRefs): Promise<ReleaseSnapshot> {
  const refs = normalizeRefs(input);
  const [promptVersions, modelConfigs, skills, knowledgeSources, knowledgeDocuments] = await Promise.all([
    refs.promptVersionIds.length ? db.aiPromptVersion.findMany({
      where: { id: { in: refs.promptVersionIds }, orgId, prompt: { deletedAt: null } },
      select: { id: true, promptId: true, version: true, status: true, contentHash: true },
    }) : [],
    refs.modelConfigIds.length ? db.aiModelConfig.findMany({
      where: { id: { in: refs.modelConfigIds }, orgId, deletedAt: null },
      select: { id: true, name: true, provider: true, model: true, status: true, parameters: true, dataPolicy: true },
    }) : [],
    refs.skillIds.length ? db.aiSkill.findMany({
      where: { id: { in: refs.skillIds }, orgId, deletedAt: null },
      select: { id: true, key: true, name: true, riskTier: true, config: true },
    }) : [],
    refs.knowledgeSourceIds.length ? db.aiKnowledgeSource.findMany({
      where: { id: { in: refs.knowledgeSourceIds }, orgId, deletedAt: null },
      select: { id: true, name: true, type: true, version: true, status: true, config: true, scope: true, lastIndexedAt: true },
    }) : [],
    refs.knowledgeDocumentIds.length ? db.aiKnowledgeDocument.findMany({
      where: { id: { in: refs.knowledgeDocumentIds }, orgId, deletedAt: null },
      select: { id: true, sourceId: true, title: true, version: true, status: true, contentHash: true, lastIndexedAt: true },
    }) : [],
  ]);

  assertAllFound('Prompt version', refs.promptVersionIds, promptVersions);
  assertAllFound('Model configuration', refs.modelConfigIds, modelConfigs);
  assertAllFound('Skill', refs.skillIds, skills);
  assertAllFound('Knowledge source', refs.knowledgeSourceIds, knowledgeSources);
  assertAllFound('Knowledge document', refs.knowledgeDocumentIds, knowledgeDocuments);

  return {
    schemaVersion: 1,
    promptVersions: promptVersions.map((row: any) => ({ ...row })).sort((a: any, b: any) => a.id.localeCompare(b.id)),
    modelConfigs: modelConfigs.map((row: any) => ({
      id: row.id,
      name: row.name,
      provider: row.provider,
      model: row.model,
      status: row.status,
      parametersHash: hashJson(row.parameters),
      dataPolicyHash: hashJson(row.dataPolicy),
    })).sort((a: any, b: any) => a.id.localeCompare(b.id)),
    skills: skills.map((row: any) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      riskTier: row.riskTier,
      configHash: hashJson(row.config),
    })).sort((a: any, b: any) => a.id.localeCompare(b.id)),
    knowledgeSources: knowledgeSources.map((row: any) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      version: row.version,
      status: row.status,
      configHash: hashJson(row.config),
      scopeHash: hashJson(row.scope),
      lastIndexedAt: row.lastIndexedAt?.toISOString?.() ?? null,
    })).sort((a: any, b: any) => a.id.localeCompare(b.id)),
    knowledgeDocuments: knowledgeDocuments.map((row: any) => ({
      id: row.id,
      sourceId: row.sourceId,
      title: row.title,
      version: row.version,
      status: row.status,
      contentHash: row.contentHash,
      lastIndexedAt: row.lastIndexedAt?.toISOString?.() ?? null,
    })).sort((a: any, b: any) => a.id.localeCompare(b.id)),
  };
}

function parseSnapshot(value: unknown): ReleaseSnapshot {
  const snapshot = objectValue(value);
  const arrays = ['promptVersions', 'modelConfigs', 'skills', 'knowledgeSources', 'knowledgeDocuments'];
  if (snapshot.schemaVersion !== 1 || arrays.some((key) => !Array.isArray(snapshot[key]))) {
    throw new ReleaseError('Stored release snapshot is invalid', 500, 'RELEASE_SNAPSHOT_CORRUPT');
  }
  return snapshot as unknown as ReleaseSnapshot;
}

function assertSnapshotIntegrity(release: any): ReleaseSnapshot {
  const snapshot = parseSnapshot(release.snapshot);
  if (hashJson(snapshot) !== release.snapshotHash) {
    throw new ReleaseError('Release snapshot integrity check failed', 409, 'RELEASE_SNAPSHOT_TAMPERED');
  }
  return snapshot;
}

function containsTarget(snapshot: ReleaseSnapshot, type: string, id: string): boolean {
  if (type === 'prompt') return snapshot.promptVersions.some((item) => item.id === id);
  if (type === 'model') return snapshot.modelConfigs.some((item) => item.id === id);
  if (type === 'skill') return snapshot.skills.some((item) => item.id === id);
  if (type === 'knowledge') {
    return snapshot.knowledgeSources.some((item) => item.id === id)
      || snapshot.knowledgeDocuments.some((item) => item.id === id);
  }
  return false;
}

async function requirePassingEvaluation(db: Db, orgId: string, evaluationRunId: string, snapshot: ReleaseSnapshot) {
  const run = await db.aiEvaluationRun.findFirst({
    where: { id: evaluationRunId, orgId },
    select: {
      id: true,
      status: true,
      completedAt: true,
      promptVersionId: true,
      modelConfigId: true,
      config: true,
      metrics: true,
    },
  });
  if (!run) throw new ReleaseError('Evaluation run not found in this organization', 404, 'RELEASE_EVALUATION_NOT_FOUND');
  const metrics = objectValue(run.metrics);
  if (run.status !== 'completed' || !run.completedAt || metrics.passed !== true) {
    throw new ReleaseError('Evaluation run has not completed with a passing result', 409, 'RELEASE_EVALUATION_NOT_PASSED');
  }
  const config = objectValue(run.config);
  const targetType = typeof config.targetType === 'string' ? config.targetType : '';
  const targetId = typeof config.targetId === 'string' ? config.targetId : '';
  const promptIncluded = !run.promptVersionId || snapshot.promptVersions.some((item) => item.id === run.promptVersionId);
  const modelIncluded = !run.modelConfigId || snapshot.modelConfigs.some((item) => item.id === run.modelConfigId);
  if (!targetType || !targetId || !containsTarget(snapshot, targetType, targetId) || !promptIncluded || !modelIncluded) {
    throw new ReleaseError('Evaluation target does not match the release snapshot', 409, 'RELEASE_EVALUATION_TARGET_MISMATCH');
  }
  return run;
}

async function lockOrg(db: Db, orgId: string): Promise<void> {
  await db.$executeRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtext($1), hashtext('ai_release'))",
    orgId,
  );
}

function view(release: any) {
  return { ...release, activationSemantics };
}

async function audit(
  db: Db,
  actor: ReleaseActor,
  release: any,
  eventType: string,
  outcome: string,
  metadata: Record<string, unknown> = {},
) {
  await db.aiAuditLog.create({
    data: {
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType,
      outcome,
      targetType: 'ai_release',
      targetId: release.id,
      inputHash: release.snapshotHash,
      outputHash: release.snapshotHash,
      metadata: {
        version: release.version,
        status: release.status,
        activePointerOnly: true,
        componentProductionStateChanged: false,
        ...metadata,
      } as Prisma.InputJsonValue,
    },
  });
}

async function releaseForUpdate(db: Db, actor: ReleaseActor, releaseId: string) {
  const release = await db.aiRelease.findFirst({ where: { id: releaseId, orgId: actor.orgId } });
  if (!release) throw new ReleaseError('Release not found', 404, 'RELEASE_NOT_FOUND');
  return release;
}

function requireStatus(release: any, expected: AiReleaseStatus): void {
  if (release.status !== expected) {
    throw new ReleaseError(
      `Release must be ${expected} for this transition`,
      409,
      'RELEASE_INVALID_TRANSITION',
    );
  }
}

export async function createRelease(
  actor: ReleaseActor,
  input: { snapshot: ReleaseSnapshotRefs; evaluationRunId?: string | null },
) {
  return tenantTransaction(async (tx) => {
    await lockOrg(tx, actor.orgId);
    const snapshot = await resolveSnapshot(tx, actor.orgId, input.snapshot);
    const snapshotHash = hashJson(snapshot);
    if (input.evaluationRunId) {
      await requirePassingEvaluation(tx, actor.orgId, input.evaluationRunId, snapshot);
    }
    const [latest, active] = await Promise.all([
      tx.aiRelease.findFirst({ where: { orgId: actor.orgId }, orderBy: { version: 'desc' }, select: { version: true } }),
      tx.aiRelease.findFirst({ where: { orgId: actor.orgId, status: 'production' }, select: { id: true } }),
    ]);
    const release = await tx.aiRelease.create({
      data: {
        orgId: actor.orgId,
        version: (latest?.version ?? 0) + 1,
        status: 'draft',
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        snapshotHash,
        evaluationRunId: input.evaluationRunId ?? null,
        previousReleaseId: active?.id ?? null,
        createdByUserId: actor.userId,
      },
    });
    await audit(tx, actor, release, 'release.created', 'success', {
      evaluationRunId: input.evaluationRunId ?? null,
      previousReleaseId: active?.id ?? null,
    });
    return view(release);
  });
}

export async function listReleases(
  orgId: string,
  options: { status?: AiReleaseStatus; limit?: number } = {},
) {
  const status = options.status;
  if (status && !AI_RELEASE_STATUSES.includes(status)) {
    throw new ReleaseError('Invalid release status', 400, 'RELEASE_STATUS_INVALID');
  }
  const releases = await prisma.aiRelease.findMany({
    where: { orgId, ...(status ? { status } : {}) },
    orderBy: { version: 'desc' },
    take: Math.max(1, Math.min(options.limit ?? 50, 200)),
  });
  return { releases: releases.map(view), activationSemantics };
}

export async function getRelease(orgId: string, releaseId: string) {
  const release = await prisma.aiRelease.findFirst({ where: { id: releaseId, orgId } });
  if (!release) throw new ReleaseError('Release not found', 404, 'RELEASE_NOT_FOUND');
  assertSnapshotIntegrity(release);
  return view(release);
}

export async function submitRelease(
  actor: ReleaseActor,
  releaseId: string,
  evaluationRunId?: string,
) {
  return tenantTransaction(async (tx) => {
    await lockOrg(tx, actor.orgId);
    const release = await releaseForUpdate(tx, actor, releaseId);
    requireStatus(release, 'draft');
    const snapshot = assertSnapshotIntegrity(release);
    const gateId = evaluationRunId?.trim() || release.evaluationRunId;
    if (!gateId) throw new ReleaseError('A passing evaluation run is required', 409, 'RELEASE_EVALUATION_REQUIRED');
    await requirePassingEvaluation(tx, actor.orgId, gateId, snapshot);
    const updated = await tx.aiRelease.update({
      where: { id: release.id },
      data: { status: 'pending_approval', evaluationRunId: gateId },
    });
    await audit(tx, actor, updated, 'release.submitted', 'success', { evaluationRunId: gateId });
    return view(updated);
  });
}

export async function approveRelease(actor: ReleaseActor, releaseId: string) {
  return tenantTransaction(async (tx) => {
    await lockOrg(tx, actor.orgId);
    const release = await releaseForUpdate(tx, actor, releaseId);
    requireStatus(release, 'pending_approval');
    if (release.createdByUserId === actor.userId) {
      throw new ReleaseError('Release creator cannot approve their own release', 403, 'RELEASE_MAKER_CHECKER_REQUIRED');
    }
    const snapshot = assertSnapshotIntegrity(release);
    if (!release.evaluationRunId) throw new ReleaseError('A passing evaluation run is required', 409, 'RELEASE_EVALUATION_REQUIRED');
    await requirePassingEvaluation(tx, actor.orgId, release.evaluationRunId, snapshot);
    const updated = await tx.aiRelease.update({
      where: { id: release.id },
      data: { status: 'approved', approvedByUserId: actor.userId, approvedAt: new Date() },
    });
    await audit(tx, actor, updated, 'release.approved', 'success', { createdByUserId: release.createdByUserId });
    return view(updated);
  });
}

export async function deployRelease(actor: ReleaseActor, releaseId: string) {
  return tenantTransaction(async (tx) => {
    await lockOrg(tx, actor.orgId);
    const release = await releaseForUpdate(tx, actor, releaseId);
    requireStatus(release, 'approved');
    const snapshot = assertSnapshotIntegrity(release);
    if (!release.evaluationRunId) throw new ReleaseError('A passing evaluation run is required', 409, 'RELEASE_EVALUATION_REQUIRED');
    await requirePassingEvaluation(tx, actor.orgId, release.evaluationRunId, snapshot);
    const active = await tx.aiRelease.findFirst({
      where: { orgId: actor.orgId, status: 'production', id: { not: release.id } },
    });
    if (active) {
      await tx.aiRelease.update({ where: { id: active.id }, data: { status: 'superseded' } });
    }
    const updated = await tx.aiRelease.update({
      where: { id: release.id },
      data: {
        status: 'production',
        previousReleaseId: active?.id ?? release.previousReleaseId,
        deployedByUserId: actor.userId,
        deployedAt: new Date(),
      },
    });
    await audit(tx, actor, updated, 'release.deployed', 'success', {
      previousReleaseId: active?.id ?? release.previousReleaseId ?? null,
      supersededReleaseId: active?.id ?? null,
    });
    return view(updated);
  });
}

export async function rollbackRelease(actor: ReleaseActor, releaseId: string) {
  return tenantTransaction(async (tx) => {
    await lockOrg(tx, actor.orgId);
    const release = await releaseForUpdate(tx, actor, releaseId);
    requireStatus(release, 'production');
    assertSnapshotIntegrity(release);
    if (!release.previousReleaseId) {
      throw new ReleaseError('Release has no previous release to restore', 409, 'RELEASE_ROLLBACK_TARGET_MISSING');
    }
    const previous = await tx.aiRelease.findFirst({
      where: { id: release.previousReleaseId, orgId: actor.orgId },
    });
    if (!previous || previous.status !== 'superseded') {
      throw new ReleaseError('Previous release is not available for rollback', 409, 'RELEASE_ROLLBACK_TARGET_INVALID');
    }
    assertSnapshotIntegrity(previous);
    const rolledBackAt = new Date();
    const rolledBackRelease = await tx.aiRelease.update({
      where: { id: release.id },
      data: { status: 'rolled_back', rolledBackByUserId: actor.userId, rolledBackAt },
    });
    const activeRelease = await tx.aiRelease.update({
      where: { id: previous.id },
      data: { status: 'production' },
    });
    await audit(tx, actor, rolledBackRelease, 'release.rolled_back', 'success', {
      restoredReleaseId: activeRelease.id,
      restoredVersion: activeRelease.version,
    });
    return {
      rolledBackRelease: view(rolledBackRelease),
      activeRelease: view(activeRelease),
      activationSemantics,
    };
  });
}

export const releaseInternals = {
  hashJson,
  stableStringify,
};
