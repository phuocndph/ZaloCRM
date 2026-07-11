import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { decryptToken, encryptToken } from '../integrations/_shared/token-encryption.util.js';
import { aiClient } from './core/index.js';
import { PromptRenderer } from './core/prompt-renderer.js';
import { requirePassingEvaluation } from './evaluation-engine-service.js';

export type PromptScope = 'system' | 'skill';
export type PromptStatus = 'draft' | 'testing' | 'production' | 'archived';

export class PromptManagerError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = 'PromptManagerError';
  }
}

type Actor = { orgId: string; userId: string };
type JsonObject = Record<string, unknown>;

const renderer = new PromptRenderer();
const VERSION_STATUSES = new Set<PromptStatus>(['draft', 'testing', 'production', 'archived']);

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function encryptContent(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(encryptToken(value));
}

function decryptContent(value: Uint8Array): string {
  return decryptToken(Buffer.from(value).toString('utf8'));
}

function assertContent(content: unknown): asserts content is string {
  if (typeof content !== 'string' || !content.trim()) throw new PromptManagerError('Prompt content is required');
  if (content.length > 100_000) throw new PromptManagerError('Prompt content exceeds 100000 characters');
}

async function assertSkill(orgId: string, scope: PromptScope, skillId?: string | null) {
  if (scope === 'system') {
    if (skillId) throw new PromptManagerError('System prompt cannot be linked to a skill');
    return;
  }
  if (!skillId) throw new PromptManagerError('skillId is required for skill prompt');
  const skill = await prisma.aiSkill.findFirst({ where: { id: skillId, orgId, deletedAt: null }, select: { id: true } });
  if (!skill) throw new PromptManagerError('AI skill not found', 404);
}

async function audit(
  tx: any,
  actor: Actor,
  eventType: string,
  promptId: string,
  metadata: JsonObject,
  outcome = 'success',
) {
  await tx.aiAuditLog.create({
    data: {
      orgId: actor.orgId,
      actorUserId: actor.userId,
      eventType,
      outcome,
      targetType: 'ai_prompt',
      targetId: promptId,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

function versionDto(version: {
  id: string;
  version: number;
  status: string;
  contentEncrypted: Uint8Array;
  contentHash: string;
  inputSchema: unknown;
  outputSchema: unknown;
  changeNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  createdBy: { id: string; fullName: string } | null;
  approvedBy: { id: string; fullName: string } | null;
}) {
  const content = decryptContent(version.contentEncrypted);
  return {
    ...version,
    content,
    contentEncrypted: undefined,
    variables: renderer.variables(content),
  };
}

export async function listPrompts(orgId: string, filter: { scope?: string; skillId?: string } = {}) {
  return prisma.aiPrompt.findMany({
    where: {
      orgId,
      deletedAt: null,
      ...(filter.scope === 'system' || filter.scope === 'skill' ? { scope: filter.scope } : {}),
      ...(filter.skillId ? { skillId: filter.skillId } : {}),
    },
    orderBy: [{ scope: 'asc' }, { name: 'asc' }],
    select: {
      id: true, key: true, name: true, taskType: true, scope: true, skillId: true, createdAt: true, updatedAt: true,
      skill: { select: { id: true, key: true, name: true } },
      versions: {
        orderBy: { version: 'desc' },
        select: { id: true, version: true, status: true, approvedAt: true, updatedAt: true },
      },
    },
  });
}

export async function listPromptSkills(orgId: string) {
  return prisma.aiSkill.findMany({
    where: { orgId, deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, key: true, name: true },
  });
}

export async function getPromptDetail(orgId: string, promptId: string) {
  const prompt = await prisma.aiPrompt.findFirst({
    where: { id: promptId, orgId, deletedAt: null },
    include: {
      skill: { select: { id: true, key: true, name: true } },
      versions: {
        orderBy: { version: 'desc' },
        include: {
          createdBy: { select: { id: true, fullName: true } },
          approvedBy: { select: { id: true, fullName: true } },
        },
      },
    },
  });
  if (!prompt) throw new PromptManagerError('Prompt not found', 404);
  return { ...prompt, versions: prompt.versions.map(versionDto) };
}

export async function createPrompt(
  actor: Actor,
  input: { key?: string; name?: string; taskType?: string; scope?: PromptScope; skillId?: string | null; content?: string; changeNote?: string },
) {
  const key = input.key?.trim();
  const name = input.name?.trim();
  const taskType = input.taskType?.trim();
  const scope = input.scope ?? 'system';
  if (!key || !/^[a-z0-9][a-z0-9_.-]{1,99}$/.test(key)) throw new PromptManagerError('Prompt key is invalid');
  if (!name) throw new PromptManagerError('Prompt name is required');
  if (!taskType) throw new PromptManagerError('taskType is required');
  assertContent(input.content);
  await assertSkill(actor.orgId, scope, input.skillId);
  const content = input.content.trim();
  const variables = renderer.variables(content);
  return prisma.$transaction(async (tx) => {
    const prompt = await tx.aiPrompt.create({
      data: {
        orgId: actor.orgId,
        key,
        name,
        taskType,
        scope,
        skillId: scope === 'skill' ? input.skillId : null,
        createdByUserId: actor.userId,
        versions: {
          create: {
            orgId: actor.orgId,
            version: 1,
            status: 'draft',
            contentEncrypted: encryptContent(content),
            contentHash: hash(content),
            previewRedacted: content.slice(0, 240),
            inputSchema: { type: 'object', required: variables },
            changeNote: input.changeNote?.trim() || 'Initial draft',
            createdByUserId: actor.userId,
          },
        },
      },
      select: { id: true, key: true },
    });
    await audit(tx, actor, 'prompt.created', prompt.id, { key, scope, skillId: input.skillId ?? null, version: 1 });
    return prompt;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updatePrompt(
  actor: Actor,
  promptId: string,
  input: { name?: string; taskType?: string; scope?: PromptScope; skillId?: string | null },
) {
  const current = await prisma.aiPrompt.findFirst({ where: { id: promptId, orgId: actor.orgId, deletedAt: null } });
  if (!current) throw new PromptManagerError('Prompt not found', 404);
  const scope = input.scope ?? current.scope as PromptScope;
  const skillId = input.skillId !== undefined ? input.skillId : current.skillId;
  await assertSkill(actor.orgId, scope, skillId);
  return prisma.$transaction(async (tx) => {
    const prompt = await tx.aiPrompt.update({
      where: { id: promptId },
      data: {
        name: input.name?.trim() || undefined,
        taskType: input.taskType?.trim() || undefined,
        scope,
        skillId: scope === 'skill' ? skillId : null,
      },
    });
    await audit(tx, actor, 'prompt.metadata_updated', promptId, {
      name: prompt.name, taskType: prompt.taskType, scope: prompt.scope, skillId: prompt.skillId,
    });
    return prompt;
  });
}

export async function createPromptVersion(
  actor: Actor,
  promptId: string,
  input: { content?: string; changeNote?: string; inputSchema?: JsonObject; outputSchema?: JsonObject },
) {
  assertContent(input.content);
  const content = input.content.trim();
  const variables = renderer.variables(content);
  return prisma.$transaction(async (tx) => {
    const prompt = await tx.aiPrompt.findFirst({
      where: { id: promptId, orgId: actor.orgId, deletedAt: null },
      select: { id: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true } } },
    });
    if (!prompt) throw new PromptManagerError('Prompt not found', 404);
    const version = (prompt.versions[0]?.version ?? 0) + 1;
    const created = await tx.aiPromptVersion.create({
      data: {
        orgId: actor.orgId,
        promptId,
        version,
        status: 'draft',
        contentEncrypted: encryptContent(content),
        contentHash: hash(content),
        previewRedacted: content.slice(0, 240),
        inputSchema: (input.inputSchema ?? { type: 'object', required: variables }) as Prisma.InputJsonValue,
        outputSchema: input.outputSchema as Prisma.InputJsonValue | undefined,
        changeNote: input.changeNote?.trim() || null,
        createdByUserId: actor.userId,
      },
    });
    await audit(tx, actor, 'prompt.version_created', promptId, { version, contentHash: created.contentHash, variables });
    return { id: created.id, version };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function transitionPromptVersion(
  actor: Actor,
  promptId: string,
  versionId: string,
  status: PromptStatus,
) {
  if (!VERSION_STATUSES.has(status) || !['testing', 'production'].includes(status)) {
    throw new PromptManagerError('Only testing or production transitions are allowed');
  }
  if (status === 'production') await requirePassingEvaluation(actor.orgId, 'prompt', versionId);
  return prisma.$transaction(async (tx) => {
    const version = await tx.aiPromptVersion.findFirst({
      where: { id: versionId, promptId, orgId: actor.orgId, prompt: { deletedAt: null } },
    });
    if (!version) throw new PromptManagerError('Prompt version not found', 404);
    if (status === 'testing' && version.status !== 'draft') {
      throw new PromptManagerError('Only Draft can move to Testing');
    }
    if (status === 'production' && version.status !== 'testing') {
      throw new PromptManagerError('Only Testing can be approved for Production');
    }
    if (status === 'production') {
      await tx.aiPromptVersion.updateMany({
        where: { promptId, status: 'production' },
        data: { status: 'archived' },
      });
    }
    const updated = await tx.aiPromptVersion.update({
      where: { id: versionId },
      data: status === 'production'
        ? { status, approvedByUserId: actor.userId, approvedAt: new Date() }
        : { status },
    });
    await audit(tx, actor, status === 'production' ? 'prompt.production_approved' : 'prompt.testing_started', promptId, {
      version: updated.version, status,
    });
    return { id: updated.id, version: updated.version, status: updated.status };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function previewPromptVersion(
  actor: Actor,
  promptId: string,
  versionId: string,
  variables: JsonObject,
) {
  const version = await prisma.aiPromptVersion.findFirst({
    where: { id: versionId, promptId, orgId: actor.orgId, prompt: { deletedAt: null } },
    select: { contentEncrypted: true, contentHash: true, version: true, status: true },
  });
  if (!version) throw new PromptManagerError('Prompt version not found', 404);
  const template = decryptContent(version.contentEncrypted);
  const requiredVariables = renderer.variables(template);
  const rendered = renderer.render(template, variables);
  return { version: version.version, status: version.status, templateHash: version.contentHash, requiredVariables, rendered };
}

export async function testPromptVersion(
  actor: Actor,
  promptId: string,
  versionId: string,
  input: { variables?: JsonObject; testInput?: string; modelConfigId?: string },
) {
  if (!input.modelConfigId) throw new PromptManagerError('modelConfigId is required');
  const preview = await previewPromptVersion(actor, promptId, versionId, input.variables ?? {});
  if (preview.status === 'archived') throw new PromptManagerError('Archived prompt cannot be tested');
  try {
    const result = await aiClient.complete({
      orgId: actor.orgId,
      modelConfigId: input.modelConfigId,
      taskType: 'prompt_test',
      messages: [
        { role: 'system', content: preview.rendered },
        { role: 'user', content: input.testInput?.trim() || 'Test this prompt with a minimal safe response.' },
      ],
      maxTokens: 500,
    });
    await prisma.$transaction((tx) => audit(tx, actor, 'prompt.version_tested', promptId, {
      version: preview.version,
      modelConfigId: input.modelConfigId,
      requestId: result.requestId,
      inputHash: hash(input.testInput ?? ''),
    }));
    return {
      requestId: result.requestId,
      output: result.text,
      provider: result.provider,
      model: result.model,
      usedFallback: result.usedFallback,
      usage: { ...result.usage, costMicros: result.usage.costMicros.toString() },
    };
  } catch (error) {
    await prisma.$transaction((tx) => audit(tx, actor, 'prompt.version_tested', promptId, {
      version: preview.version, modelConfigId: input.modelConfigId,
    }, 'failed'));
    throw error;
  }
}

export async function rollbackPrompt(actor: Actor, promptId: string, sourceVersionId: string) {
  await requirePassingEvaluation(actor.orgId, 'prompt', sourceVersionId);
  return prisma.$transaction(async (tx) => {
    const prompt = await tx.aiPrompt.findFirst({
      where: { id: promptId, orgId: actor.orgId, deletedAt: null },
      select: {
        id: true,
        versions: { orderBy: { version: 'desc' }, select: {
          id: true, version: true, status: true, contentEncrypted: true, contentHash: true,
          previewRedacted: true, inputSchema: true, outputSchema: true,
        } },
      },
    });
    if (!prompt) throw new PromptManagerError('Prompt not found', 404);
    const source = prompt.versions.find((version) => version.id === sourceVersionId);
    if (!source) throw new PromptManagerError('Rollback source version not found', 404);
    if (source.status === 'production') throw new PromptManagerError('Selected version is already Production');
    const nextVersion = (prompt.versions[0]?.version ?? 0) + 1;
    await tx.aiPromptVersion.updateMany({ where: { promptId, status: 'production' }, data: { status: 'archived' } });
    const restored = await tx.aiPromptVersion.create({
      data: {
        orgId: actor.orgId,
        promptId,
        version: nextVersion,
        status: 'production',
        contentEncrypted: Uint8Array.from(source.contentEncrypted),
        contentHash: source.contentHash,
        previewRedacted: source.previewRedacted,
        inputSchema: source.inputSchema as Prisma.InputJsonValue | undefined,
        outputSchema: source.outputSchema as Prisma.InputJsonValue | undefined,
        changeNote: `Rollback from version ${source.version}`,
        createdByUserId: actor.userId,
        approvedByUserId: actor.userId,
        approvedAt: new Date(),
      },
    });
    await audit(tx, actor, 'prompt.rolled_back', promptId, {
      sourceVersion: source.version, productionVersion: nextVersion, contentHash: source.contentHash,
    });
    return { id: restored.id, version: restored.version, status: restored.status };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function deletePrompt(actor: Actor, promptId: string) {
  return prisma.$transaction(async (tx) => {
    const prompt = await tx.aiPrompt.findFirst({ where: { id: promptId, orgId: actor.orgId, deletedAt: null } });
    if (!prompt) throw new PromptManagerError('Prompt not found', 404);
    await tx.aiPromptVersion.updateMany({ where: { promptId, status: 'production' }, data: { status: 'archived' } });
    await tx.aiPrompt.update({ where: { id: promptId }, data: { deletedAt: new Date() } });
    await audit(tx, actor, 'prompt.deleted', promptId, { key: prompt.key });
    return { ok: true };
  });
}

export async function getProductionPrompt(orgId: string, key: string, variables: JsonObject) {
  const prompt = await prisma.aiPrompt.findFirst({
    where: { orgId, key, deletedAt: null },
    select: {
      id: true,
      versions: {
        where: { status: 'production', approvedAt: { not: null }, approvedByUserId: { not: null } },
        take: 1,
        select: { id: true, version: true, contentEncrypted: true, contentHash: true },
      },
    },
  });
  const version = prompt?.versions[0];
  if (!prompt || !version) throw new PromptManagerError('Approved Production prompt not found', 404);
  const content = decryptContent(version.contentEncrypted);
  return {
    promptId: prompt.id,
    versionId: version.id,
    version: version.version,
    contentHash: version.contentHash,
    rendered: renderer.render(content, variables),
  };
}
