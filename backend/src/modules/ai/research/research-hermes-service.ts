// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../../../shared/database/prisma-client.js';
import { decryptToken } from '../../integrations/_shared/token-encryption.util.js';
import { userHasGrant } from '../../rbac/permission-group-service.js';
import { audit, lockProject, invalidate, saveSource } from './research-service.js';
import { ResearchError, object, text, hash, redact, normalize, canonicalUrl, validatePains, type ResearchActor, type Evidence, RESEARCH_INSTRUCTIONS } from './research-domain.js';

type Tx = Parameters<Parameters<typeof tenantTransaction>[0]>[0];
const json = (v: unknown) => v as Prisma.InputJsonValue;
const LEASE_MS = 120_000;
const TIME_MS = 15 * 60_000;
const MAX_ATTEMPTS = 3;

function sameToken(actual: string | null, supplied: string) {
  if (!actual) return false;
  const expected = Buffer.from(actual), received = Buffer.from(supplied);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
async function creatorAllowed(tx: Tx, actor: ResearchActor) {
  const user = await tx.user.findFirst({ where: { id: actor.userId, orgId: actor.orgId, isActive: true }, select: { id: true } });
  return !!user && await userHasGrant(actor.userId, 'ai_knowledge', 'edit');
}
function taskActor(orgId: string, createdByUserId: string): ResearchActor {
  return { orgId, userId: createdByUserId, role: 'system' };
}
function sourceDto(s: { id: string; title: string; url: string | null; speakerRole: string; contentEncrypted: string | null }) {
  return { id: s.id, title: s.title, url: s.url, speakerRole: s.speakerRole, content: s.contentEncrypted ? decryptToken(s.contentEncrypted) : '' };
}

export async function claimHermesTask(orgId: string) {
  const candidates = await prisma.customerResearchTask.findMany({
    where: { orgId, cancelRequested: false, project: { executor: 'hermes' },
      OR: [{ status: 'queued' }, { status: 'running', leaseUntil: { lt: new Date() } }] },
    orderBy: { createdAt: 'asc' }, take: 20,
  });
  for (const candidate of candidates) {
    const claimed = await tenantTransaction(async (tx) => {
      const actor = taskActor(orgId, candidate.createdByUserId);
      const project = await lockProject(tx, actor, candidate.projectId);
      const task = await tx.customerResearchTask.findFirst({ where: { id: candidate.id, orgId, projectId: project.id } });
      if (!task || project.executor !== 'hermes' || object(task.input).executor !== 'hermes' || task.cancelRequested ||
        !['queued', 'running'].includes(task.status) || (task.status === 'running' && task.leaseUntil && task.leaseUntil > new Date())) return null;
      const cp = object(task.checkpoint), input = object(task.input);
      const attempts = Number(cp.attempts ?? 0);
      const deadline = typeof cp.deadline === 'number' ? cp.deadline : Date.now() + TIME_MS;
      let failure: string | null = null;
      if (!await creatorAllowed(tx, actor)) failure = 'RESEARCH_PERMISSION_REVOKED';
      else if (attempts >= MAX_ATTEMPTS || Date.now() >= deadline) failure = 'RESEARCH_HERMES_TIME_LIMIT';
      else if (!cp.reserved && task.kind === 'discover' && project.searchCalls >= project.maxQueries) failure = 'RESEARCH_SEARCH_BUDGET';
      else if (!cp.reserved && ['analyze', 'generate'].includes(task.kind) && project.aiCalls >= project.maxAiCalls) failure = 'RESEARCH_AI_BUDGET';
      const sources = await tx.customerResearchSource.findMany({ where: { orgId, projectId: project.id, status: 'read', duplicateOfId: null }, take: 60 });
      let pain = null;
      if (task.kind === 'generate') {
        pain = await tx.customerResearchPain.findFirst({ where: { orgId, projectId: project.id, id: input.painId as string, status: 'approved', revision: input.painRevision as number } });
        if (!pain) failure = 'RESEARCH_PAIN_NOT_APPROVED';
      } else if (task.kind === 'analyze' && sources.length === 0) failure = 'RESEARCH_NO_SOURCES';
      if (failure) {
        await tx.customerResearchTask.update({ where: { id: task.id }, data: { status: 'failed', errorCode: failure, completedAt: new Date(), leaseToken: null, leaseUntil: null } });
        return null;
      }
      const sourceCount = await tx.customerResearchSource.count({ where: { orgId, projectId: project.id } });
      const searchLimit = task.kind === 'discover' ? (typeof cp.maxSearches === 'number' ? cp.maxSearches : project.maxQueries - project.searchCalls) : 0;
      if (!cp.reserved) {
        if (task.kind === 'discover') await tx.customerResearchProject.update({ where: { id: project.id }, data: { searchCalls: { increment: searchLimit } } });
        else await tx.customerResearchProject.update({ where: { id: project.id }, data: { aiCalls: { increment: 1 } } });
      }
      const leaseToken = randomUUID();
      await tx.customerResearchTask.update({ where: { id: task.id }, data: {
        status: 'running', leaseToken, leaseUntil: new Date(Date.now() + LEASE_MS), errorCode: null,
        checkpoint: json({ ...cp, attempts: attempts + 1, deadline, reserved: true, maxSearches: searchLimit, sourceRevision: project.revision, progress: 'Hermes đã nhận việc' }),
      } });
      await audit(tx, actor, 'hermes_claimed', task.id, { attempt: attempts + 1 });
      return { taskId: task.id, projectId: project.id, kind: task.kind, leaseToken,
        leaseSeconds: LEASE_MS / 1000, deadline: new Date(deadline).toISOString(),
        skill: task.kind === 'discover' ? 'zcrm-find-hotel-pains' : task.kind === 'analyze' ? 'zcrm-summarize-hotel-pains' : 'zcrm-write-hotel-content',
        brief: project.brief, title: project.title, instructions: RESEARCH_INSTRUCTIONS,
        limits: { maxSearches: searchLimit, maxSources: Math.max(0, project.maxSources - sourceCount), maxAttempts: MAX_ATTEMPTS, billing: 'external_not_metered_by_zcrm' },
        input: { format: input.format, pain: pain ? { id: pain.id, title: pain.title, detail: pain.detail, evidence: pain.evidence } : null,
          sources: task.kind === 'discover' ? [] : sources.map(sourceDto) },
      };
    });
    if (claimed) return { task: claimed };
  }
  return { task: null };
}

async function lockedTask(tx: Tx, orgId: string, taskId: string) {
  const found = await tx.customerResearchTask.findFirst({ where: { id: taskId, orgId } });
  if (!found) throw new ResearchError('Không tìm thấy công việc.', 404, 'RESEARCH_TASK_NOT_FOUND');
  const actor = taskActor(orgId, found.createdByUserId);
  const project = await lockProject(tx, actor, found.projectId);
  const task = await tx.customerResearchTask.findFirstOrThrow({ where: { id: taskId, orgId, projectId: project.id } });
  if (project.executor !== 'hermes' || object(task.input).executor !== 'hermes') throw new ResearchError('Công việc không giao cho Hermes.', 403, 'RESEARCH_HERMES_FORBIDDEN');
  return { task, project, actor };
}
function assertLease(task: { status: string; cancelRequested: boolean; leaseToken: string | null; leaseUntil: Date | null; checkpoint: unknown }, token: string) {
  if (task.status !== 'running' || task.cancelRequested || !sameToken(task.leaseToken, token) ||
    !task.leaseUntil || task.leaseUntil <= new Date() || Date.now() >= Number(object(task.checkpoint).deadline ?? 0)) {
    throw new ResearchError('Công việc đã dừng hoặc hết thời gian nhận kết quả.', 409, 'RESEARCH_HERMES_LEASE_EXPIRED');
  }
}
export async function updateHermesTask(orgId: string, taskId: string, raw: unknown, action: 'progress' | 'fail') {
  const b = object(raw), token = text(b.leaseToken, 'Mã nhận việc', 100);
  return tenantTransaction(async (tx) => {
    const { task, actor } = await lockedTask(tx, orgId, taskId);
    assertLease(task, token);
    if (!await creatorAllowed(tx, actor)) throw new ResearchError('Người giao việc không còn quyền.', 403, 'RESEARCH_PERMISSION_REVOKED');
    if (action === 'fail') {
      await tx.customerResearchTask.update({ where: { id: taskId }, data: { status: 'failed', errorCode: 'RESEARCH_HERMES_FAILED', leaseToken: null, leaseUntil: null, completedAt: new Date(), checkpoint: json({ ...object(task.checkpoint), progress: redact(text(b.message, 'Lý do', 500)) }) } });
      await audit(tx, actor, 'hermes_failed', taskId);
      return { taskId, status: 'failed' };
    }
    const progress = redact(text(b.message, 'Tiến độ', 500));
    await tx.customerResearchTask.update({ where: { id: taskId }, data: { leaseUntil: new Date(Date.now() + LEASE_MS), checkpoint: json({ ...object(task.checkpoint), progress }) } });
    return { taskId, status: 'running', leaseSeconds: LEASE_MS / 1000 };
  });
}

export async function completeHermesTask(orgId: string, taskId: string, raw: unknown) {
  const b = object(raw), token = text(b.leaseToken, 'Mã nhận việc', 100), result = object(b.result);
  const resultHash = hash(JSON.stringify(result));
  return tenantTransaction(async (tx) => {
    const { task, project, actor } = await lockedTask(tx, orgId, taskId);
    const cp = object(task.checkpoint), input = object(task.input);
    if (task.status === 'completed' && cp.resultHash === resultHash && cp.receipt === hash(token)) return { taskId, status: 'completed', duplicate: true };
    assertLease(task, token);
    if (!await creatorAllowed(tx, actor)) throw new ResearchError('Người giao việc không còn quyền.', 403, 'RESEARCH_PERMISSION_REVOKED');
    if (project.revision !== cp.sourceRevision) throw new ResearchError('Nguồn đã thay đổi.', 409, 'RESEARCH_STALE_REVISION');
    if (task.kind === 'discover') {
      if (!Array.isArray(result.sources) || result.sources.length > project.maxSources) throw new ResearchError('Danh sách nguồn vượt giới hạn.');
      let changed = false;
      for (const rawSource of result.sources) {
        const s = object(rawSource);
        if (s.permissionConfirmed !== true) throw new ResearchError('Nguồn cần được phép sử dụng.');
        const publishedAt = s.publishedAt ? new Date(text(s.publishedAt, 'Ngày đăng', 40)) : null;
        if (publishedAt && (!Number.isFinite(publishedAt.getTime()) || publishedAt > new Date())) throw new ResearchError('Ngày đăng không hợp lệ.');
        const saved = await saveSource(tx, actor, project.id, { title: redact(text(s.title, 'Tên nguồn', 300)), url: canonicalUrl(text(s.url, 'Đường dẫn', 2000)),
          content: text(s.content, 'Nội dung đã đọc', 12000), kind: 'hermes', speakerRole: 'unknown', publishedAt });
        changed = changed || saved.changed;
      }
      if (changed) await invalidate(tx, actor, project.id);
    } else if (task.kind === 'analyze') {
      const sources = await tx.customerResearchSource.findMany({ where: { orgId, projectId: project.id, status: 'read', duplicateOfId: null }, take: 60 });
      const pains = validatePains(result, new Map(sources.map((s) => [s.id, decryptToken(s.contentEncrypted!)])));
      for (const pain of pains) {
        const { title, evidence, ...detail } = pain;
        const confirmed = sources.some((s) => ['owner', 'manager'].includes(s.speakerRole) && evidence.some((e) => e.sourceId === s.id));
        await tx.customerResearchPain.create({ data: { orgId, projectId: project.id, taskId, title, evidence: json(evidence), detail: json({ ...detail, certainty: confirmed ? 'operator_source' : 'needs_verification' }), independentSources: new Set(evidence.map((e) => e.sourceId)).size } });
      }
      await tx.customerResearchPain.updateMany({ where: { orgId, projectId: project.id, taskId: { not: taskId }, status: { in: ['draft', 'approved', 'needs_review'] } }, data: { status: 'superseded', approvedAt: null, approvedByUserId: null } });
      await tx.customerResearchContent.updateMany({ where: { orgId, projectId: project.id, status: { in: ['draft', 'approved'] } }, data: { status: 'outdated', approvedAt: null, approvedByUserId: null } });
    } else if (task.kind === 'generate') {
      const pain = await tx.customerResearchPain.findFirst({ where: { orgId, projectId: project.id, id: input.painId as string, status: 'approved', revision: input.painRevision as number } });
      if (!pain) throw new ResearchError('Vấn đề chưa được duyệt hoặc đã đổi.', 409, 'RESEARCH_PAIN_NOT_APPROVED');
      const evidence = pain.evidence as Evidence[];
      if (!Array.isArray(result.sourceIds) || !result.sourceIds.length || result.sourceIds.length > 30 || result.sourceIds.some((id) => !evidence.some((e) => e.sourceId === id)) ||
        !Array.isArray(result.missingInformation) || result.missingInformation.length > 20) throw new ResearchError('Bài viết phải dẫn đúng nguồn đã duyệt.', 400, 'RESEARCH_INVALID_EVIDENCE');
      await tx.customerResearchContent.create({ data: { orgId, projectId: project.id, taskId, painId: pain.id, painRevision: pain.revision, format: input.format as string,
        title: redact(text(result.title, 'Tiêu đề', 300)), body: redact(text(result.body, 'Bài viết', 20000)),
        evidence: json(evidence.filter((e) => (result.sourceIds as string[]).includes(e.sourceId))),
        missingInformation: json(result.missingInformation.map((s) => redact(text(s, 'Thông tin cần bổ sung', 1000)))) } });
    } else throw new ResearchError('Loại công việc không hỗ trợ.');
    await tx.customerResearchTask.update({ where: { id: taskId }, data: { status: 'completed', completedAt: new Date(), leaseToken: null, leaseUntil: null,
      checkpoint: json({ ...cp, resultHash, receipt: hash(token), progress: 'Hermes đã hoàn thành; chờ kiểm tra kết quả' }) } });
    await audit(tx, actor, 'hermes_completed', taskId, { kind: task.kind });
    return { taskId, status: 'completed', duplicate: false };
  }, { timeout: 20000 });
}
