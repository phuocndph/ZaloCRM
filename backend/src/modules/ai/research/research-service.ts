// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma, tenantTransaction } from '../../../shared/database/prisma-client.js';
import { encryptToken, decryptToken } from '../../integrations/_shared/token-encryption.util.js';
import { aiClient, aiModelRegistry } from '../core/index.js';
import { AIErrorHandler } from '../core/ai-error-handler.js';
import { userHasGrant } from '../../rbac/permission-group-service.js';
import { enqueueResearchTask } from './research-queue.js';
import { searchGoogle, readPage } from './research-web.js';
import { facebookGroupLink, groupSearchQueries } from './research-group-discovery.js';
import { researchSearchKey } from './research-settings.js';
import { ResearchError, type ResearchActor, type Evidence, FORMATS, ROLES, object, text, member, hash, redact, normalize, canonicalUrl, facebookUrl, requireApprover, validatePains, RESEARCH_INSTRUCTIONS, PAIN_SCHEMA } from './research-domain.js';

type Tx = Parameters<Parameters<typeof tenantTransaction>[0]>[0];
const json = (value: unknown) => value as Prisma.InputJsonValue;
const ACTIVE = ['queued', 'running'];
export async function audit(tx: Tx, actor: ResearchActor, event: string, id: string, metadata: Record<string, unknown> = {}) {
  await tx.aiAuditLog.create({ data: { orgId: actor.orgId, actorUserId: actor.userId, eventType: `research.${event}`, outcome: 'success', targetType: 'customer_research', targetId: id, metadata: json(metadata) } });
}
export async function lockProject(tx: Tx, actor: ResearchActor, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.orgId}), hashtext(${id}))`;
  const project = await tx.customerResearchProject.findFirst({ where: { id, orgId: actor.orgId } });
  if (!project) throw new ResearchError('Không tìm thấy lần nghiên cứu.', 404, 'RESEARCH_NOT_FOUND');
  return project;
}
async function idle(tx: Tx, actor: ResearchActor, projectId: string) {
  if (await tx.customerResearchTask.count({ where: { orgId: actor.orgId, projectId, status: { in: ACTIVE } } })) throw new ResearchError('Hãy dừng hoặc chờ công việc đang chạy trước khi sửa dữ liệu.', 409, 'RESEARCH_BUSY');
}
export async function invalidate(tx: Tx, actor: ResearchActor, projectId: string) {
  await tx.customerResearchProject.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
  await tx.customerResearchPain.updateMany({ where: { orgId: actor.orgId, projectId, status: { in: ['draft', 'approved'] } }, data: { status: 'needs_review', approvedAt: null, approvedByUserId: null, revision: { increment: 1 } } });
  await tx.customerResearchContent.updateMany({ where: { orgId: actor.orgId, projectId, status: { in: ['draft', 'approved'] } }, data: { status: 'outdated', approvedAt: null, approvedByUserId: null } });
}
function projectDto(project: Awaited<ReturnType<typeof lockProject>>) { return { ...project, maxAiCostMicros: project.maxAiCostMicros.toString(), aiCostMicros: project.aiCostMicros.toString() }; }
export async function listResearchModels(actor: ResearchActor) {
  const models = await prisma.aiModelConfig.findMany({
    where: { orgId: actor.orgId, deletedAt: null, status: { in: ['active', 'approved', 'testing', 'submitted'] } },
    orderBy: { updatedAt: 'desc' }, select: { id: true, name: true, model: true, status: true },
  });
  const ready = [];
  for (const model of models) {
    try {
      await aiModelRegistry.resolve(actor.orgId, model.id, { purpose: 'customer_research' });
      ready.push({ id: model.id, displayName: model.name, externalModelId: model.model, status: model.status });
    } catch { /* Unavailable credentials or untested models cannot be selected. */ }
  }
  return ready;
}
export async function createProject(actor: ResearchActor, raw: unknown) {
  const b = object(raw);
  const executor = b.executor === undefined ? 'internal' : member(b.executor, ['internal', 'hermes'], 'Bên thực hiện');
  const modelConfigId = executor === 'hermes' ? 'hermes' : text(b.modelConfigId, 'Cấu hình AI', 100);
  if (executor === 'internal') await aiModelRegistry.resolve(actor.orgId, modelConfigId, { purpose: 'customer_research' });
  return tenantTransaction(async (tx) => {
    const project = await tx.customerResearchProject.create({ data: {
      orgId: actor.orgId, createdByUserId: actor.userId, title: text(b.title, 'Tên', 200), brief: text(b.brief, 'Yêu cầu', 5000), modelConfigId, executor,
      // Legacy columns remain for compatibility; they no longer constrain work.
      maxQueries: 5, maxSources: 30, maxAiCalls: 10, maxAiCostMicros: 1_000_000n,
    } });
    await audit(tx, actor, 'project_created', project.id); return projectDto(project);
  });
}
export async function useDirectResearch(actor: ResearchActor, projectId: string, raw: unknown) {
  const modelConfigId = text(object(raw).modelConfigId, 'AI sử dụng', 100);
  await aiModelRegistry.resolve(actor.orgId, modelConfigId, { purpose: 'customer_research' });
  return tenantTransaction(async (tx) => {
    const project = await lockProject(tx, actor, projectId);
    if (project.executor !== 'hermes') await idle(tx, actor, projectId);
    else await tx.customerResearchTask.updateMany({
      where: { orgId: actor.orgId, projectId, status: { in: ACTIVE } },
      data: { status: 'cancelled', cancelRequested: true, leaseToken: null, leaseUntil: null, completedAt: new Date() },
    });
    const updated = await tx.customerResearchProject.update({ where: { id: projectId }, data: { executor: 'internal', modelConfigId } });
    await audit(tx, actor, 'direct_execution_selected', projectId);
    return projectDto(updated);
  });
}

export async function listProjects(actor: ResearchActor, page = 1) {
  const rows = await prisma.customerResearchProject.findMany({ where: { orgId: actor.orgId }, take: 25, skip: (page - 1) * 25, orderBy: { createdAt: 'desc' } });
  return rows.map(projectDto);
}
export async function getProject(actor: ResearchActor, id: string) {
  const project = await prisma.customerResearchProject.findFirst({ where: { orgId: actor.orgId, id } });
  if (!project) throw new ResearchError('Không tìm thấy lần nghiên cứu.', 404, 'RESEARCH_NOT_FOUND');
  const [sources, pains, contents, tasks] = await Promise.all([
    prisma.customerResearchSource.groupBy({ by: ['status'], where: { orgId: actor.orgId, projectId: id }, _count: true }),
    prisma.customerResearchPain.groupBy({ by: ['status'], where: { orgId: actor.orgId, projectId: id }, _count: true }),
    prisma.customerResearchContent.groupBy({ by: ['status'], where: { orgId: actor.orgId, projectId: id }, _count: true }),
    prisma.customerResearchTask.findMany({ where: { orgId: actor.orgId, projectId: id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, kind: true, status: true, input: true, checkpoint: true, errorCode: true, cancelRequested: true, createdAt: true, completedAt: true } }),
  ]);
  return { ...projectDto(project), sources, pains, contents, tasks };
}
export async function listSources(actor: ResearchActor, projectId: string, page = 1) {
  await getProject(actor, projectId);
  const rows = await prisma.customerResearchSource.findMany({ where: { orgId: actor.orgId, projectId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 25, skip: (page - 1) * 25 });
  return rows.map(({ contentEncrypted, ...source }) => ({ ...source, content: contentEncrypted ? decryptToken(contentEncrypted) : null }));
}
export async function saveSource(tx: Tx, actor: ResearchActor, projectId: string, input: { title: string; url?: string; content?: string; kind?: string; speakerRole?: string; publishedAt?: Date | null; status?: string }) {
  await lockProject(tx, actor, projectId);
  const content = input.content ? redact(normalize(input.content)).slice(0, 12000) : null;
  const contentHash = content ? hash(content) : null;
  const url = input.url ? canonicalUrl(input.url) : null;
  const canonicalKey = hash(url ?? content ?? '');
  const existing = await tx.customerResearchSource.findUnique({ where: { orgId_projectId_canonicalKey: { orgId: actor.orgId, projectId, canonicalKey } } });
  if (existing?.contentHash || (existing && !content)) return { source: existing, changed: false };
  const duplicate = contentHash ? await tx.customerResearchSource.findFirst({ where: { orgId: actor.orgId, projectId, contentHash, duplicateOfId: null, ...(existing ? { id: { not: existing.id } } : {}) }, select: { id: true } }) : null;
  const data = { title: input.title, url, canonicalKey, kind: input.kind ?? (url && facebookUrl(url) ? 'facebook' : 'web'), status: duplicate ? 'duplicate' : content ? 'read' : input.status ?? (url && facebookUrl(url) ? 'requires_manual' : 'pending'), speakerRole: input.speakerRole ?? 'unknown', contentHash, duplicateOfId: duplicate?.id ?? null, contentEncrypted: content ? encryptToken(content) : null, readAt: content ? new Date() : null, publishedAt: input.publishedAt ?? null };
  const source = existing ? await tx.customerResearchSource.update({ where: { id: existing.id }, data }) : await tx.customerResearchSource.create({ data: { orgId: actor.orgId, projectId, ...data } });
  return { source, changed: true };
}
export async function addSource(actor: ResearchActor, projectId: string, raw: unknown) {
  const b = object(raw); const content = text(b.content, 'Nội dung nguồn', 40000, true); const url = text(b.url, 'Đường dẫn', 2000, true);
  if (!url && !content) throw new ResearchError('Cần đường dẫn hoặc nội dung nguồn.');
  if (content && b.permissionConfirmed !== true) throw new ResearchError('Cần xác nhận được quyền dùng nội dung nguồn.');
  const publishedAt = b.publishedAt ? new Date(text(b.publishedAt, 'Ngày đăng', 40)) : null;
  if (publishedAt && (Number.isNaN(publishedAt.getTime()) || publishedAt > new Date())) throw new ResearchError('Ngày đăng không hợp lệ.');
  return tenantTransaction(async (tx) => {
    await lockProject(tx, actor, projectId); await idle(tx, actor, projectId);
    const result = await saveSource(tx, actor, projectId, { title: redact(text(b.title, 'Tên nguồn', 300)), url: url || undefined, content: content || undefined, kind: content ? 'manual' : undefined, speakerRole: b.speakerRole === undefined ? 'unknown' : member(b.speakerRole, ROLES, 'Vai trò'), publishedAt });
    if (result.changed) { await invalidate(tx, actor, projectId); await audit(tx, actor, 'source_added', result.source.id, { contentHash: result.source.contentHash, manual: !!content }); }
    const { contentEncrypted: _, ...source } = result.source; return { ...source, duplicate: !result.changed };
  });
}
export async function listPains(actor: ResearchActor, projectId: string, page = 1) {
  await getProject(actor, projectId);
  return prisma.customerResearchPain.findMany({ where: { orgId: actor.orgId, projectId }, take: 25, skip: (page - 1) * 25, orderBy: [{ independentSources: 'desc' }, { createdAt: 'desc' }] });
}
export async function reviewPain(actor: ResearchActor, projectId: string, id: string, raw: unknown) {
  const b = object(raw);
  return tenantTransaction(async (tx) => {
    await lockProject(tx, actor, projectId); await idle(tx, actor, projectId);
    const pain = await tx.customerResearchPain.findFirst({ where: { id, projectId, orgId: actor.orgId } });
    if (!pain || ['merged', 'superseded'].includes(pain.status)) throw new ResearchError('Không tìm thấy vấn đề còn hiệu lực.', 404, 'RESEARCH_PAIN_NOT_FOUND');
    if (b.revision !== pain.revision) throw new ResearchError('Vấn đề đã thay đổi; hãy tải lại.', 409, 'RESEARCH_STALE_REVISION');
    const status = b.status === undefined ? 'draft' : member(b.status, ['draft', 'approved', 'rejected'], 'Trạng thái');
    if (status === 'approved') {
      requireApprover(actor);
      if (!await tx.customerResearchTask.findFirst({ where: { id: pain.taskId, orgId: actor.orgId, projectId, status: 'completed' } })) throw new ResearchError('Chờ lượt tổng hợp hoàn thành trước khi duyệt.', 409, 'RESEARCH_ANALYSIS_INCOMPLETE');
    }
    const detail = { ...object(pain.detail) };
    if (b.detail !== undefined) {
      const changes = object(b.detail);
      for (const field of ['audience', 'situation', 'impact', 'desire', 'uncertainty']) if (changes[field] !== undefined) detail[field] = redact(text(changes[field], field, 2000));
      if (changes.relevance !== undefined) detail.relevance = member(changes.relevance, ['direct', 'educational', 'outside', 'unknown'], 'Liên quan');
    }
    const updated = await tx.customerResearchPain.update({ where: { id }, data: { detail: json(detail), title: b.title === undefined ? pain.title : redact(text(b.title, 'Tên vấn đề', 200)), status, revision: { increment: 1 }, approvedAt: status === 'approved' ? new Date() : null, approvedByUserId: status === 'approved' ? actor.userId : null } });
    await tx.customerResearchContent.updateMany({ where: { orgId: actor.orgId, painId: id, status: { in: ['draft', 'approved'] } }, data: { status: 'outdated', approvedAt: null, approvedByUserId: null } });
    await audit(tx, actor, 'pain_reviewed', id, { status, revision: updated.revision }); return updated;
  });
}
export async function mergePains(actor: ResearchActor, projectId: string, targetId: string, raw: unknown) {
  const b = object(raw); const sourceId = text(b.sourceId, 'Vấn đề cần gộp', 100);
  if (targetId === sourceId) throw new ResearchError('Không thể tự gộp một vấn đề.');
  return tenantTransaction(async (tx) => {
    await lockProject(tx, actor, projectId); await idle(tx, actor, projectId);
    const rows = await tx.customerResearchPain.findMany({ where: { orgId: actor.orgId, projectId, id: { in: [targetId, sourceId] }, status: { notIn: ['merged', 'superseded'] } } });
    const target = rows.find((x) => x.id === targetId), source = rows.find((x) => x.id === sourceId);
    if (!target || !source) throw new ResearchError('Không tìm thấy vấn đề.', 404, 'RESEARCH_PAIN_NOT_FOUND');
    const taskIds = [...new Set([target.taskId, source.taskId])];
    if (await tx.customerResearchTask.count({ where: { orgId: actor.orgId, projectId, id: { in: taskIds }, status: 'completed' } }) !== taskIds.length) throw new ResearchError('Chỉ gộp kết quả từ lượt tổng hợp đã hoàn thành.', 409, 'RESEARCH_ANALYSIS_INCOMPLETE');
    if (b.targetRevision !== target.revision || b.sourceRevision !== source.revision) throw new ResearchError('Vấn đề đã thay đổi.', 409, 'RESEARCH_STALE_REVISION');
    const evidence = [...target.evidence as Evidence[], ...source.evidence as Evidence[]].filter((e, index, all) => all.findIndex((x) => x.sourceId === e.sourceId && x.quote === e.quote) === index);
    if (evidence.length > 30) throw new ResearchError('Quá nhiều bằng chứng để gộp; hãy tách vấn đề.');
    const updated = await tx.customerResearchPain.update({ where: { id: targetId }, data: { evidence: json(evidence), independentSources: new Set(evidence.map((e) => e.sourceId)).size, status: 'draft', approvedAt: null, approvedByUserId: null, revision: { increment: 1 } } });
    await tx.customerResearchPain.update({ where: { id: sourceId }, data: { status: 'merged', mergedIntoId: targetId, approvedAt: null, approvedByUserId: null, revision: { increment: 1 } } });
    await tx.customerResearchContent.updateMany({ where: { orgId: actor.orgId, painId: { in: [sourceId, targetId] }, status: { in: ['draft', 'approved'] } }, data: { status: 'outdated', approvedAt: null, approvedByUserId: null } });
    await audit(tx, actor, 'pains_merged', targetId, { sourceId }); return updated;
  });
}
export async function listContents(actor: ResearchActor, projectId: string, page = 1) {
  await getProject(actor, projectId);
  return prisma.customerResearchContent.findMany({ where: { orgId: actor.orgId, projectId }, orderBy: { createdAt: 'desc' }, take: 25, skip: (page - 1) * 25 });
}
export async function editContent(actor: ResearchActor, projectId: string, id: string, raw: unknown) {
  const b = object(raw);
  return tenantTransaction(async (tx) => {
    await lockProject(tx, actor, projectId); await idle(tx, actor, projectId);
    const old = await tx.customerResearchContent.findFirst({ where: { orgId: actor.orgId, projectId, id } });
    if (!old || old.status === 'archived') throw new ResearchError('Không tìm thấy bản nội dung hiện tại.', 404, 'RESEARCH_CONTENT_NOT_FOUND');
    const pain = await tx.customerResearchPain.findFirst({ where: { orgId: actor.orgId, projectId, id: old.painId, status: 'approved', revision: old.painRevision } });
    if (!pain) throw new ResearchError('Cần duyệt lại vấn đề và tạo nội dung mới.', 409, 'RESEARCH_PAIN_NOT_APPROVED');
    await tx.customerResearchContent.update({ where: { id }, data: { status: 'archived' } });
    const { id: _id, createdAt: _createdAt, ...fields } = old;
    const result = await tx.customerResearchContent.create({ data: { ...fields, evidence: json(old.evidence), missingInformation: json(old.missingInformation), rootId: old.rootId ?? old.id, version: old.version + 1, title: redact(text(b.title ?? old.title, 'Tiêu đề', 300)), body: redact(text(b.body, 'Nội dung', 20000)), status: 'draft', approvedAt: null, approvedByUserId: null } });
    await audit(tx, actor, 'content_edited', result.id, { previousId: old.id }); return result;
  });
}
export async function approveContent(actor: ResearchActor, projectId: string, id: string) {
  requireApprover(actor);
  return tenantTransaction(async (tx) => {
    await lockProject(tx, actor, projectId); await idle(tx, actor, projectId);
    const content = await tx.customerResearchContent.findFirst({ where: { orgId: actor.orgId, projectId, id, status: { in: ['draft', 'approved'] } } });
    if (!content) throw new ResearchError('Không tìm thấy bản nội dung có thể duyệt.', 404, 'RESEARCH_CONTENT_NOT_FOUND');
    if (!await tx.customerResearchPain.findFirst({ where: { orgId: actor.orgId, projectId, id: content.painId, status: 'approved', revision: content.painRevision } })) throw new ResearchError('Vấn đề đã thay đổi; cần tạo lại nội dung.', 409, 'RESEARCH_STALE_REVISION');
    const result = await tx.customerResearchContent.update({ where: { id }, data: { status: 'approved', approvedAt: new Date(), approvedByUserId: actor.userId } });
    await audit(tx, actor, 'content_approved', id); return result;
  });
}
export async function createTask(actor: ResearchActor, projectId: string, raw: unknown) {
  const b = object(raw); const kind = member(b.kind, ['research', 'discover_groups', 'discover', 'collect', 'analyze', 'generate', 'generate_batch'], 'Công việc');
  const key = text(b.idempotencyKey, 'Mã chống lặp', 120);
  const input: Record<string, unknown> = {};
  if (kind === 'research' && b.sourceMode !== undefined) input.sourceMode = member(b.sourceMode, ['saved'], 'Nguồn cần đọc');
  if (kind === 'generate_batch') {
    requireApprover(actor);
    if (!Array.isArray(b.pains) || !b.pains.length) throw new ResearchError('Hãy chọn ít nhất một vấn đề.');
    input.pains = b.pains.map((rawPain) => {
      const pain = object(rawPain);
      if (!Number.isInteger(pain.revision) || Number(pain.revision) < 1) throw new ResearchError('Phiên bản vấn đề không hợp lệ.');
      return { painId: text(pain.painId, 'Vấn đề', 100), revision: pain.revision as number };
    }).sort((a, b) => a.painId.localeCompare(b.painId));
    if (new Set((input.pains as any[]).map((p) => p.painId)).size !== (input.pains as any[]).length) throw new ResearchError('Một vấn đề được chọn nhiều lần.');
    input.format = member(b.format, FORMATS, 'Kiểu bài');
  }
  if (kind === 'generate') { input.painId = text(b.painId, 'Vấn đề', 100); input.format = member(b.format, FORMATS, 'Kiểu bài'); }
  const task = await tenantTransaction(async (tx) => {
    const project = await lockProject(tx, actor, projectId);
    const hermes = project.executor === 'hermes';
    if (hermes) input.executor = 'hermes';
    const existing = await tx.customerResearchTask.findUnique({ where: { orgId_projectId_idempotencyKey: { orgId: actor.orgId, projectId, idempotencyKey: key } } });
    if (existing) {
      const old = existing.input as Record<string, unknown>;
      if (existing.kind !== kind || old.painId !== input.painId || old.format !== input.format || old.sourceMode !== input.sourceMode || JSON.stringify(old.pains) !== JSON.stringify(input.pains)) throw new ResearchError('Mã chống lặp đã dùng cho công việc khác.', 409, 'RESEARCH_IDEMPOTENCY_CONFLICT');
      return existing;
    }
    await idle(tx, actor, projectId);
    if (hermes && ['research', 'discover_groups', 'generate_batch'].includes(kind)) throw new ResearchError('Chuyển đợt này sang chạy trực tiếp trong ZCRM trước.', 409, 'RESEARCH_DIRECT_REQUIRED');
    if (hermes && kind === 'collect') throw new ResearchError('Hermes đọc và gửi nguồn ngay trong bước tìm thông tin.');
    if (!hermes && (['discover', 'discover_groups'].includes(kind) || kind === 'research' && input.sourceMode !== 'saved') && !await researchSearchKey(actor.orgId)) throw new ResearchError('Chưa cấu hình dịch vụ tìm Google.', 409, 'RESEARCH_SEARCH_NOT_CONFIGURED');
    if (!hermes && kind !== 'discover_groups') await aiModelRegistry.resolve(actor.orgId, project.modelConfigId, { purpose: 'customer_research' });
    if (kind === 'generate_batch') {
      const selected = input.pains as Array<{ painId: string; revision: number }>;
      const rows = await tx.customerResearchPain.findMany({ where: { orgId: actor.orgId, projectId, id: { in: selected.map((p) => p.painId) }, status: { in: ['draft', 'approved', 'needs_review'] } } });
      if (rows.length !== selected.length || selected.some((p) => !rows.some((row) => row.id === p.painId && row.revision === p.revision))) throw new ResearchError('Vấn đề đã thay đổi; hãy tải lại trước khi chọn.', 409, 'RESEARCH_STALE_REVISION');
      const analysisIds = [...new Set(rows.map((p) => p.taskId))];
      if (await tx.customerResearchTask.count({ where: { orgId: actor.orgId, projectId, id: { in: analysisIds }, status: 'completed' } }) !== analysisIds.length) throw new ResearchError('Chờ tổng hợp hoàn thành trước khi tạo bài.', 409, 'RESEARCH_ANALYSIS_INCOMPLETE');
      const painRefs: Array<{ painId: string; painRevision: number }> = [];
      for (const selectedPain of selected) {
        const pain = rows.find((p) => p.id === selectedPain.painId)!;
        if (pain.status !== 'approved') {
          await tx.customerResearchPain.update({ where: { id: pain.id }, data: { status: 'approved', revision: { increment: 1 }, approvedAt: new Date(), approvedByUserId: actor.userId } });
          await tx.customerResearchContent.updateMany({ where: { orgId: actor.orgId, projectId, painId: pain.id, status: { in: ['draft', 'approved'] } }, data: { status: 'outdated', approvedAt: null, approvedByUserId: null } });
        }
        painRefs.push({ painId: pain.id, painRevision: pain.revision + (pain.status === 'approved' ? 0 : 1) });
      }
      input.painRefs = painRefs;
      await audit(tx, actor, 'selected_pains_approved', projectId, { painIds: selected.map((p) => p.painId) });
    }
    if (kind === 'generate') {
      const pain = await tx.customerResearchPain.findFirst({ where: { id: input.painId as string, orgId: actor.orgId, projectId, status: 'approved' } });
      if (!pain) throw new ResearchError('Cần chọn một vấn đề đã được duyệt.', 409, 'RESEARCH_PAIN_NOT_APPROVED');
      input.painRevision = pain.revision;
    }
    const created = await tx.customerResearchTask.create({ data: { orgId: actor.orgId, projectId, kind, input: json(input), idempotencyKey: key, createdByUserId: actor.userId } });
    await audit(tx, actor, 'task_created', created.id, { kind }); return created;
  });
  if (task.status === 'queued' && object(task.input).executor !== 'hermes') await enqueueResearchTask(actor.orgId, projectId, task.id);
  return { taskId: task.id, status: task.status };
}
export async function controlTask(actor: ResearchActor, projectId: string, id: string, action: 'cancel' | 'retry') {
  const result = await tenantTransaction(async (tx) => {
    const project = await lockProject(tx, actor, projectId);
    const task = await tx.customerResearchTask.findFirst({ where: { id, orgId: actor.orgId, projectId } });
    if (!task) throw new ResearchError('Không tìm thấy công việc.', 404, 'RESEARCH_TASK_NOT_FOUND');
    if (action === 'cancel') {
      if (!ACTIVE.includes(task.status)) return { taskId: id, status: task.status };
      await tx.customerResearchTask.update({ where: { id }, data: { cancelRequested: true, status: 'cancelled', completedAt: new Date(), leaseToken: null, leaseUntil: null } });
    } else {
      if (project.executor === 'internal' && object(task.input).executor === 'hermes') throw new ResearchError('Đợt này đã chuyển sang ZCRM. Bấm Bắt đầu tìm hiểu để chạy công việc mới.', 409, 'RESEARCH_DIRECT_REQUIRED');
      const expired = task.status === 'running' && !!task.leaseUntil && task.leaseUntil < new Date();
      if (!['failed', 'cancelled', 'queued'].includes(task.status) && !expired) throw new ResearchError('Công việc chưa thể chạy lại.', 409, 'RESEARCH_BUSY');
      if (await tx.customerResearchTask.count({ where: { orgId: actor.orgId, projectId, id: { not: id }, status: { in: ACTIVE } } })) throw new ResearchError('Đang có công việc khác.', 409, 'RESEARCH_BUSY');
      const cp = object(task.checkpoint);
      await tx.customerResearchTask.update({ where: { id }, data: { status: 'queued', cancelRequested: false, completedAt: null, errorCode: null, leaseToken: null, leaseUntil: null,
        ...(object(task.input).executor === 'hermes' ? { checkpoint: json({ ...cp, progress: 'Chờ Hermes nhận lại việc' }) } : {}) } });
    }
    await audit(tx, actor, `task_${action}`, id); return { taskId: id, status: action === 'cancel' ? 'cancelled' : 'queued' };
  });
  if (action === 'retry') {
    const task = await prisma.customerResearchTask.findFirst({ where: { id, orgId: actor.orgId, projectId } });
    if (task && object(task.input).executor !== 'hermes') await enqueueResearchTask(actor.orgId, projectId, id);
  }
  return result;
}
// A fencing token prevents a cancelled/stale worker committing results.
async function taskTransaction<T>(actor: ResearchActor, projectId: string, taskId: string, token: string, fn: (tx: Tx, project: Awaited<ReturnType<typeof lockProject>>) => Promise<T>) {
  return tenantTransaction(async (tx) => {
    const project = await lockProject(tx, actor, projectId);
    const task = await tx.customerResearchTask.findFirst({ where: { id: taskId, orgId: actor.orgId, projectId, status: 'running', leaseToken: token, cancelRequested: false } });
    if (!task) throw new ResearchError('Công việc đã dừng hoặc chuyển sang worker khác.', 409, 'RESEARCH_CANCELLED');
    return fn(tx, project);
  });
}
async function completeJson(actor: ResearchActor, projectId: string, taskId: string, token: string, system: string, data: unknown, schema: Record<string, unknown>) {
  const project = await prisma.customerResearchProject.findFirstOrThrow({ where: { orgId: actor.orgId, id: projectId } });
  const payload = JSON.stringify(data); const maxTokens = 5000;
  await taskTransaction(actor, projectId, taskId, token, async (tx) => {
    await tx.customerResearchProject.update({ where: { id: projectId }, data: { aiCalls: { increment: 1 } } });
  });
  const result = await aiClient.complete({ orgId: actor.orgId, modelConfigId: project.modelConfigId, taskType: 'customer_research', maxTokens, temperature: 0.2,
    messages: [{ role: 'system', content: system }, { role: 'user', content: payload }], structuredOutput: { name: 'customer_research', schema } });
  await tenantTransaction(async (tx) => {
    await lockProject(tx, actor, projectId);
    await tx.customerResearchProject.update({ where: { id: projectId }, data: { aiCostMicros: { increment: result.usage.costMicros } } });
    await audit(tx, actor, 'ai_call_completed', taskId, { requestId: result.requestId, costMicros: result.usage.costMicros.toString() });
  });
  return result.structured;
}
export async function processResearchTask(data: { orgId: string; projectId: string; taskId: string }) {
  const token = randomUUID();
  const task = await tenantTransaction(async (tx) => {
    await lockProject(tx, { orgId: data.orgId, userId: 'system', role: 'system' }, data.projectId);
    const task = await tx.customerResearchTask.findFirst({ where: { id: data.taskId, orgId: data.orgId, projectId: data.projectId } });
    if (!task || object(task.input).executor === 'hermes' || task.cancelRequested || !['queued', 'running'].includes(task.status) || (task.status === 'running' && task.leaseUntil && task.leaseUntil > new Date())) return null;
    const user = await tx.user.findFirst({ where: { id: task.createdByUserId, orgId: data.orgId, isActive: true }, select: { id: true } });
    if (!user || !await userHasGrant(user.id, 'ai_knowledge', 'edit')) {
      await tx.customerResearchTask.update({ where: { id: task.id }, data: { status: 'failed', errorCode: 'RESEARCH_PERMISSION_REVOKED', completedAt: new Date(), leaseToken: null, leaseUntil: null } });
      return null;
    }
    return tx.customerResearchTask.update({ where: { id: task.id }, data: { status: 'running', leaseToken: token, leaseUntil: new Date(Date.now() + 120000) } });
  });
  if (!task) return;
  const actor: ResearchActor = { orgId: data.orgId, userId: task.createdByUserId, role: 'system' };
  const heartbeat = setInterval(() => { void prisma.customerResearchTask.updateMany({ where: { id: task.id, orgId: data.orgId, leaseToken: token, status: 'running' }, data: { leaseUntil: new Date(Date.now() + 120000) } }).catch(() => {}); }, 20000);
  const guarded = <T>(fn: (tx: Tx, project: Awaited<ReturnType<typeof lockProject>>) => Promise<T>) => {
    return taskTransaction(actor, data.projectId, task.id, token, fn);
  };
  let cp = object(task.checkpoint);
  const storeCheckpoint = async (tx: Tx, value: Record<string, unknown>) => {
    cp = { ...cp, ...value };
    await tx.customerResearchTask.update({ where: { id: task.id }, data: { checkpoint: json(cp) } });
  };
  const checkpoint = (value: Record<string, unknown>) => guarded((tx) => storeCheckpoint(tx, value));
  const research = task.kind === 'research';
  const sourceOnly = research && object(task.input).sourceMode === 'saved';
  try {
    let project = await prisma.customerResearchProject.findFirstOrThrow({ where: { id: data.projectId, orgId: data.orgId } });
    if (task.kind === 'discover_groups' || task.kind === 'discover' || task.kind === 'collect' || (research && cp.stage !== 'analyze')) {
      await checkpoint({ stage: sourceOnly || task.kind === 'collect' ? 'collect' : 'discover', progress: sourceOnly || task.kind === 'collect' ? 'Đang chuẩn bị đọc các nguồn đã thêm' : 'Đang chuẩn bị câu tìm kiếm' });
      const searchKey = sourceOnly || task.kind === 'collect' ? '' : await researchSearchKey(actor.orgId);
      let queries = cp.queries as string[] | undefined;
      if (!queries && task.kind === 'discover_groups') {
        queries = groupSearchQueries([project.brief]);
        await checkpoint({ queries, groupQueries: queries, queryIndex: 0, groupDiscoveryIncluded: true });
      }
      if (!queries && (task.kind === 'discover' || research && !sourceOnly)) {
        const output = object(await completeJson(actor, project.id, task.id, token, `${RESEARCH_INSTRUCTIONS} Chỉ lập các câu tìm tiếng Việt về toàn bộ vận hành khách sạn, bao gồm câu tìm thảo luận thực tế, không đưa ra phát hiện.`, { brief: project.brief, maxQueries: 5 }, { type: 'object', properties: { queries: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string' } } }, required: ['queries'], additionalProperties: false }));
        if (!Array.isArray(output.queries) || !output.queries.length || output.queries.length > 5) throw new ResearchError('AI trả câu tìm không hợp lệ.', 502, 'RESEARCH_INVALID_AI_OUTPUT');
        queries = [...new Set(output.queries.map((q) => text(q, 'Câu tìm', 250)))];
        const targetedGroups = groupSearchQueries(queries);
        queries = [...targetedGroups, ...queries];
        await checkpoint({ queries, groupQueries: targetedGroups, queryIndex: 0, groupDiscoveryIncluded: true });
      }
      queries ??= [];
      for (let index = Number(cp.queryIndex ?? 0); index < queries.length; index++) {
        await guarded(async (tx) => {
          await tx.customerResearchProject.update({ where: { id: project.id }, data: { searchCalls: { increment: 1 } } });
        });
        const groupOnly = Array.isArray(cp.groupQueries) && cp.groupQueries.includes(queries[index]);
        await checkpoint({ progress: `${groupOnly ? 'Đang tìm hội nhóm và bài Facebook' : 'Đang tìm thông tin'}: ${index + 1}/${queries.length} câu tìm` });
        let results: Awaited<ReturnType<typeof searchGoogle>>;
        try { results = await searchGoogle(queries[index], searchKey); } catch (error) {
          if (error instanceof ResearchError && ['RESEARCH_SEARCH_AUTH_FAILED', 'RESEARCH_SEARCH_NOT_CONFIGURED'].includes(error.code)) throw error;
          await checkpoint({ queryIndex: index + 1, searchFailures: [...(Array.isArray(cp.searchFailures) ? cp.searchFailures : []), { queryIndex: index, code: error instanceof ResearchError ? error.code : 'RESEARCH_SEARCH_FAILED' }] });
          continue;
        }
        await guarded(async (tx) => {
          let changed = false;
          for (const item of results) {
            const group = facebookGroupLink(item.url);
            if (groupOnly && !group) continue;
            if (group) {
              await saveSource(tx, actor, project.id, { title: group.postUrl ? `Nhóm chứa bài: ${item.title}`.slice(0, 300) : item.title, url: group.groupUrl, kind: 'facebook_group', status: 'group_found' });
              if (group.postUrl) await saveSource(tx, actor, project.id, { title: item.title, url: group.postUrl, kind: 'facebook', status: 'requires_manual' });
              continue;
            }
            changed = (await saveSource(tx, actor, project.id, item)).changed || changed;
          }
          if (changed) await invalidate(tx, actor, project.id);
          await storeCheckpoint(tx, { queries, queryIndex: index + 1 });
        });
      }
      if (task.kind === 'discover_groups') {
        const groupCount = await prisma.customerResearchSource.count({ where: { orgId: actor.orgId, projectId: project.id, kind: 'facebook_group' } });
        await checkpoint({ groupCount });
      }
      const pending = task.kind === 'discover_groups' ? [] : await prisma.customerResearchSource.findMany({ where: { orgId: actor.orgId, projectId: project.id, status: { in: ['pending', 'failed', 'blocked'] }, url: { not: null } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      if (task.kind !== 'discover_groups') await checkpoint({ stage: 'collect', progress: `Đang đọc ${pending.length} nguồn thông tin` });
      for (const [index, source] of pending.entries()) {
        await checkpoint({ progress: `Đang đọc nguồn ${index + 1}/${pending.length}`, readingSourceId: source.id });
        try {
          const page = await readPage(source.url!);
          await guarded(async (tx) => {
            if (page.status === 'read' && page.content) {
              await saveSource(tx, actor, project.id, { title: page.title || source.title, url: source.url!, content: page.content, publishedAt: page.publishedAt });
              await invalidate(tx, actor, project.id);
            } else await tx.customerResearchSource.update({ where: { id: source.id }, data: { status: page.status, errorCode: page.errorCode } });
          });
        } catch (error) {
          if (error instanceof ResearchError && error.code === 'RESEARCH_CANCELLED') throw error;
          await guarded(async (tx) => { await tx.customerResearchSource.update({ where: { id: source.id }, data: { status: 'failed', errorCode: error instanceof ResearchError ? error.code : 'RESEARCH_PAGE_FAILED' } }); });
        }
      }
      if (research) {
        project = await prisma.customerResearchProject.findFirstOrThrow({ where: { id: data.projectId, orgId: data.orgId } });
        await checkpoint({ stage: 'analyze', progress: 'Đang tổng hợp các vấn đề có bằng chứng' });
      }
    }
    if (task.kind === 'analyze' || research) {
      const sources = await prisma.customerResearchSource.findMany({ where: { orgId: actor.orgId, projectId: project.id, status: 'read', duplicateOfId: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      if (!sources.length) {
        if (research) await checkpoint({ stage: 'discover', queryIndex: 0, progress: 'Chưa đọc được nguồn nào. Có thể tìm lại hoặc dán thêm nội dung.' });
        throw new ResearchError('Chưa có nguồn đọc được để tổng hợp.', 409, 'RESEARCH_NO_EVIDENCE');
      }
      if (!cp.started) {
        await guarded(async (tx) => {
          // Keep the previous approved analysis until the new one finishes successfully.
          await storeCheckpoint(tx, { started: true, batch: 0, sourceRevision: project.revision, stage: 'analyze' });
        });
      } else if (cp.sourceRevision !== project.revision) throw new ResearchError('Nguồn đã đổi; hãy bắt đầu lượt tổng hợp mới.', 409, 'RESEARCH_STALE_REVISION');
      for (let batch = Number(cp.batch ?? 0); batch * 5 < sources.length; batch++) {
        const group = sources.slice(batch * 5, batch * 5 + 5);
        await checkpoint({ progress: `Đang tổng hợp nguồn ${batch * 5 + 1}–${Math.min(sources.length, batch * 5 + 5)}/${sources.length}` });
        const input = group.map((s) => ({ id: s.id, title: s.title, url: s.url, speakerRole: s.speakerRole, publishedAt: s.publishedAt, text: decryptToken(s.contentEncrypted!) }));
        const output = await completeJson(actor, project.id, task.id, token, RESEARCH_INSTRUCTIONS, { brief: project.brief, sources: input }, PAIN_SCHEMA);
        const pains = validatePains(output, new Map(input.map((s) => [s.id, s.text])));
        await guarded(async (tx) => {
          for (const pain of pains) {
            const prior = await tx.customerResearchPain.findFirst({ where: { orgId: actor.orgId, projectId: project.id, taskId: task.id, title: pain.title } });
            const evidence = [...(prior?.evidence as Evidence[] ?? []), ...pain.evidence].filter((e, i, all) => all.findIndex((x) => x.sourceId === e.sourceId && x.quote === e.quote) === i);
            const { evidence: _, title, ...detail } = pain;
            const confirmedRole = group.some((s) => ['owner', 'manager'].includes(s.speakerRole) && evidence.some((e) => e.sourceId === s.id));
            const payload = { detail: json({ ...detail, certainty: confirmedRole ? 'operator_source' : 'needs_verification' }), evidence: json(evidence), independentSources: new Set(evidence.map((e) => e.sourceId)).size };
            if (prior) await tx.customerResearchPain.update({ where: { id: prior.id }, data: payload });
            else await tx.customerResearchPain.create({ data: { orgId: actor.orgId, projectId: project.id, taskId: task.id, title, ...payload } });
          }
          await storeCheckpoint(tx, { started: true, batch: batch + 1, sourceRevision: project.revision, sourceCount: sources.length });
        });
      }
    } else if (task.kind === 'generate' || task.kind === 'generate_batch') {
      const batchInput = object(task.input);
      const refs = task.kind === 'generate_batch' ? batchInput.painRefs as Array<{ painId: string; painRevision: number }> : [{ painId: batchInput.painId as string, painRevision: batchInput.painRevision as number }];
      for (let index = Number(cp.contentIndex ?? 0); index < refs.length; index++) {
        const input: Record<string, unknown> = { ...batchInput, ...refs[index] };
        await checkpoint({ stage: 'generate', progress: `Đang viết bài ${index + 1}/${refs.length}`, contentTotal: refs.length });
        const pain = await prisma.customerResearchPain.findFirst({ where: { id: input.painId as string, orgId: actor.orgId, projectId: project.id, status: 'approved', revision: input.painRevision as number } });
        if (!pain) throw new ResearchError('Vấn đề chưa duyệt hoặc đã thay đổi.', 409, 'RESEARCH_PAIN_NOT_APPROVED');
        const evidence = pain.evidence as Evidence[];
        const output = object(await completeJson(actor, project.id, task.id, token,
          `${RESEARCH_INSTRUCTIONS} Viết nội dung giáo dục tiếng Việt theo vấn đề đã duyệt, kiểu article/bài chia sẻ, zalo_message/tin ngắn hoặc checklist/danh sách kiểm tra. Không có dữ liệu sản phẩm đã duyệt nên KHÔNG nêu giá, công dụng, tiến độ, tỷ lệ tiết kiệm, cam kết Jolie’Fam hoặc lời chứng thực. Không suy nguyên nhân/giải pháp từ việc vấn đề tồn tại. Giải pháp chưa được chứng minh phải chuyển thành câu hỏi kiểm tra, kèm missingInformation. Không ghi danh tính tác giả nguồn. Không thêm URL. Chỉ dùng sourceIds được cung cấp.`,
          { format: input.format, pain: { title: pain.title, detail: pain.detail }, evidence },
          { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, sourceIds: { type: 'array', minItems: 1, items: { type: 'string' } }, missingInformation: { type: 'array', items: { type: 'string' } } }, required: ['title', 'body', 'sourceIds', 'missingInformation'], additionalProperties: false }));
        const title = redact(text(output.title, 'Tiêu đề', 300)), body = redact(text(output.body, 'Bài viết', 20000));
        if (!Array.isArray(output.sourceIds) || !output.sourceIds.length || output.sourceIds.some((id) => !evidence.some((e) => e.sourceId === id)) || !Array.isArray(output.missingInformation) || output.missingInformation.length > 20) throw new ResearchError('Nội dung AI dẫn nguồn sai.', 502, 'RESEARCH_INVALID_AI_OUTPUT');
        const missing = output.missingInformation.map((x) => redact(text(x, 'Thông tin cần bổ sung', 1000)));
        await guarded(async (tx) => {
          await tx.customerResearchContent.create({ data: { orgId: actor.orgId, projectId: project.id, painId: pain.id, taskId: task.id, format: input.format as string, title, body, evidence: json(evidence.filter((e) => (output.sourceIds as string[]).includes(e.sourceId))), missingInformation: json(missing), painRevision: pain.revision } });
          await storeCheckpoint(tx, { contentIndex: index + 1 });
        });
      }
      await guarded(async (tx) => {
        await storeCheckpoint(tx, { stage: 'completed', progress: `Đã tạo ${refs.length} bài nháp. Chờ anh duyệt trước khi dùng.` });
        await tx.customerResearchTask.update({ where: { id: task.id }, data: { status: 'completed', completedAt: new Date(), leaseToken: null, leaseUntil: null } });
        await audit(tx, actor, 'task_completed', task.id);
      });
      return;
    }
    await guarded(async (tx) => {
      if (task.kind === 'analyze' || research) {
        await tx.customerResearchPain.updateMany({ where: { orgId: actor.orgId, projectId: project.id, taskId: { not: task.id }, status: { in: ['draft', 'approved', 'needs_review'] } }, data: { status: 'superseded', approvedAt: null, approvedByUserId: null } });
        await tx.customerResearchContent.updateMany({ where: { orgId: actor.orgId, projectId: project.id, pain: { taskId: { not: task.id } }, status: { in: ['draft', 'approved'] } }, data: { status: 'outdated', approvedAt: null, approvedByUserId: null } });
      }
      await storeCheckpoint(tx, { stage: 'completed', progress: task.kind === 'discover_groups' ? `Đã tìm xong. Đợt này có ${Number(cp.groupCount ?? 0)} hội nhóm; chưa dùng đường dẫn nhóm làm bằng chứng.` : research || task.kind === 'analyze' ? 'Đã tổng hợp xong. Chọn các vấn đề muốn tạo bài.' : 'Đã đọc xong nguồn thông tin.' });
      await tx.customerResearchTask.update({ where: { id: task.id }, data: { status: 'completed', completedAt: new Date(), leaseToken: null, leaseUntil: null } });
      await audit(tx, actor, 'task_completed', task.id);
    });
  } catch (error) {
    await prisma.customerResearchTask.updateMany({ where: { id: task.id, orgId: actor.orgId, leaseToken: token, status: 'running' }, data: { status: 'failed', errorCode: error instanceof ResearchError ? error.code : AIErrorHandler.normalize(error).code, leaseToken: null, leaseUntil: null, completedAt: new Date() } });
  } finally { clearInterval(heartbeat); }
}
