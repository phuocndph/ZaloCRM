// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../../../shared/database/prisma-client.js';
import { decryptToken } from '../../integrations/_shared/token-encryption.util.js';
import { userHasGrant } from '../../rbac/permission-group-service.js';
import { audit, lockProject, invalidate, saveSource } from './research-service.js';
import { ResearchError, object, text, hash, redact, canonicalUrl, validatePains, type ResearchActor, type Evidence, RESEARCH_INSTRUCTIONS } from './research-domain.js';

type Tx = Parameters<Parameters<typeof tenantTransaction>[0]>[0];
const json = (v: unknown) => v as Prisma.InputJsonValue;
const LEASE_MS = 120_000;
const SOURCE_BATCH = 5;

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

// Small messages keep the model context manageable; the next batch is automatic.
async function taskEnvelope(tx: Tx, orgId: string, project: Awaited<ReturnType<typeof lockProject>>, task: {
  id: string; kind: string; input: unknown; checkpoint: unknown; leaseToken: string | null;
}) {
  const cp = object(task.checkpoint), input = object(task.input);
  const batch = Number(cp.batch ?? 0);
  const pain = task.kind === 'generate' ? await tx.customerResearchPain.findFirst({ where: {
    orgId, projectId: project.id, id: input.painId as string, status: 'approved', revision: input.painRevision as number,
  } }) : null;
  if (task.kind === 'generate' && !pain) throw new ResearchError('Vấn đề chưa được duyệt hoặc đã đổi.', 409, 'RESEARCH_PAIN_NOT_APPROVED');
  const sources = task.kind === 'discover' ? [] : await tx.customerResearchSource.findMany({
    where: { orgId, projectId: project.id, status: 'read', duplicateOfId: null,
      ...(pain ? { id: { in: (pain.evidence as Evidence[]).map((e) => e.sourceId) } } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    ...(task.kind === 'analyze' ? { skip: batch * SOURCE_BATCH, take: SOURCE_BATCH + 1 } : {}),
  });
  if (task.kind === 'analyze' && !sources.length) throw new ResearchError('Chưa có nguồn để tổng hợp.', 409, 'RESEARCH_NO_SOURCES');
  return { taskId: task.id, projectId: project.id, kind: task.kind, leaseToken: task.leaseToken!,
    leaseSeconds: LEASE_MS / 1000, batch, protocolVersion: 2,
    skill: task.kind === 'discover' ? 'zcrm-find-hotel-pains' : task.kind === 'analyze' ? 'zcrm-summarize-hotel-pains' : 'zcrm-write-hotel-content',
    brief: project.brief, title: project.title, instructions: RESEARCH_INSTRUCTIONS,
    limits: { billing: 'external_not_metered_by_zcrm' },
    input: { format: input.format, nextSearch: cp.nextSearch ?? null,
      pain: pain ? { id: pain.id, title: pain.title, detail: pain.detail, evidence: pain.evidence } : null,
      sources: (task.kind === 'analyze' ? sources.slice(0, SOURCE_BATCH) : sources).map(sourceDto) },
    hasMoreSources: task.kind === 'analyze' && sources.length > SOURCE_BATCH,
  };
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
      const cp = object(task.checkpoint), attempts = Number(cp.attempts ?? 0);
      let envelope;
      try {
        if (!await creatorAllowed(tx, actor)) throw new ResearchError('Người giao việc không còn quyền.', 403, 'RESEARCH_PERMISSION_REVOKED');
        if (cp.sourceRevision !== undefined && cp.sourceRevision !== project.revision) throw new ResearchError('Nguồn đã thay đổi.', 409, 'RESEARCH_STALE_REVISION');
        envelope = await taskEnvelope(tx, orgId, project, task);
      } catch (error) {
        if (!(error instanceof ResearchError)) throw error;
        await tx.customerResearchTask.update({ where: { id: task.id }, data: { status: 'failed', errorCode: error.code, completedAt: new Date(), leaseToken: null, leaseUntil: null } });
        return null;
      }
      if (!cp.reserved) await tx.customerResearchProject.update({ where: { id: project.id }, data:
        task.kind === 'discover' ? { searchCalls: { increment: 1 } } : { aiCalls: { increment: 1 } } });
      const leaseToken = randomUUID();
      await tx.customerResearchTask.update({ where: { id: task.id }, data: {
        status: 'running', leaseToken, leaseUntil: new Date(Date.now() + LEASE_MS), errorCode: null,
        checkpoint: json({ ...cp, attempts: attempts + 1, batch: envelope.batch, reserved: true,
          sourceRevision: project.revision, progress: 'Hermes đã nhận việc' }),
      } });
      await audit(tx, actor, 'hermes_claimed', task.id, { attempt: attempts + 1, batch: envelope.batch });
      return { ...envelope, leaseToken };
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
    !task.leaseUntil || task.leaseUntil <= new Date()) {
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
    // A batch number distinguishes a retry after a lost response from new work.
    if (b.batch !== undefined && b.batch === cp.lastBatch && cp.lastResultHash === resultHash && cp.lastReceipt === hash(token)) {
      return { taskId, status: 'running', duplicate: true, task: await taskEnvelope(tx, orgId, project, task) };
    }
    const batch = Number(cp.batch ?? 0);
    if ((b.batch !== undefined && b.batch !== batch) || (b.batch === undefined && (batch > 0 || task.kind === 'analyze' &&
      await tx.customerResearchSource.count({ where: { orgId, projectId: project.id, status: 'read', duplicateOfId: null } }) > SOURCE_BATCH))) {
      throw new ResearchError('Cần dùng bridge Hermes mới và gửi đúng phần đang xử lý.', 409, 'RESEARCH_HERMES_BATCH_REQUIRED');
    }
    let more = false;
    let nextSearch: string | null = null;
    if (task.kind === 'discover') {
      if (!Array.isArray(result.sources)) throw new ResearchError('Danh sách nguồn không hợp lệ.');
      more = result.hasMore === true;
      nextSearch = more ? text(result.nextSearch, 'Phần cần tìm tiếp', 2000) : null;
      if (more && b.batch === undefined) throw new ResearchError('Cần cập nhật bridge để nhận phần tiếp theo.', 409, 'RESEARCH_HERMES_BATCH_REQUIRED');
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
      const rows = await tx.customerResearchSource.findMany({ where: { orgId, projectId: project.id, status: 'read', duplicateOfId: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: batch * SOURCE_BATCH, take: SOURCE_BATCH + 1 });
      more = rows.length > SOURCE_BATCH;
      const sources = rows.slice(0, SOURCE_BATCH);
      const pains = validatePains(result, new Map(sources.map((s) => [s.id, decryptToken(s.contentEncrypted!)])));
      for (const pain of pains) {
        const { title, evidence, ...detail } = pain;
        const confirmed = sources.some((s) => ['owner', 'manager'].includes(s.speakerRole) && evidence.some((e) => e.sourceId === s.id));
        await tx.customerResearchPain.create({ data: { orgId, projectId: project.id, taskId, title, evidence: json(evidence), detail: json({ ...detail, certainty: confirmed ? 'operator_source' : 'needs_verification' }), independentSources: new Set(evidence.map((e) => e.sourceId)).size } });
      }
      if (!more) {
        await tx.customerResearchPain.updateMany({ where: { orgId, projectId: project.id, taskId: { not: taskId }, status: { in: ['draft', 'approved', 'needs_review'] } }, data: { status: 'superseded', approvedAt: null, approvedByUserId: null } });
        await tx.customerResearchContent.updateMany({ where: { orgId, projectId: project.id, status: { in: ['draft', 'approved'] } }, data: { status: 'outdated', approvedAt: null, approvedByUserId: null } });
      }
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
    if (more) {
      // Discovery changed the source revision; pin the next batch to that revision.
      const current = await lockProject(tx, actor, project.id);
      const checkpoint = { ...cp, batch: batch + 1, lastBatch: batch, lastResultHash: resultHash, lastReceipt: hash(token),
        nextSearch, sourceRevision: current.revision, progress: `Đã xong phần ${batch + 1}; đang xử lý tiếp` };
      await tx.customerResearchTask.update({ where: { id: taskId }, data: { checkpoint: json(checkpoint), leaseUntil: new Date(Date.now() + LEASE_MS) } });
      await tx.customerResearchProject.update({ where: { id: project.id }, data:
        task.kind === 'discover' ? { searchCalls: { increment: 1 } } : { aiCalls: { increment: 1 } } });
      await audit(tx, actor, 'hermes_batch_completed', taskId, { batch });
      return { taskId, status: 'running', duplicate: false, task: await taskEnvelope(tx, orgId, current, { ...task, checkpoint }) };
    }
    await tx.customerResearchTask.update({ where: { id: taskId }, data: { status: 'completed', completedAt: new Date(), leaseToken: null, leaseUntil: null,
      checkpoint: json({ ...cp, resultHash, receipt: hash(token), progress: 'Hermes đã hoàn thành; chờ kiểm tra kết quả' }) } });
    await audit(tx, actor, 'hermes_completed', taskId, { kind: task.kind });
    return { taskId, status: 'completed', duplicate: false };
  }, { timeout: 20000 });
}
