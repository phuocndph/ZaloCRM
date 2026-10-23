// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findFirst: vi.fn(), findFirstOrThrow: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() });
  const db: any = { customerResearchProject: model(), customerResearchSource: model(), customerResearchPain: model(), customerResearchContent: model(), customerResearchTask: model(), user: model(), aiAuditLog: { create: vi.fn() }, $executeRaw: vi.fn() };
  return { db, enqueue: vi.fn(), complete: vi.fn(), resolve: vi.fn(), permission: vi.fn() };
});
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.db, tenantTransaction: (fn: any) => fn(mocks.db) }));
vi.mock('../../src/modules/ai/core/index.js', () => ({ aiClient: { complete: mocks.complete }, aiModelRegistry: { resolve: mocks.resolve } }));
vi.mock('../../src/modules/ai/research/research-queue.js', () => ({ enqueueResearchTask: mocks.enqueue }));
vi.mock('../../src/modules/rbac/permission-group-service.js', () => ({ userHasGrant: mocks.permission }));
vi.mock('../../src/modules/integrations/_shared/token-encryption.util.js', () => ({ encryptToken: (s: string) => `enc:${s}`, decryptToken: (s: string) => s.replace(/^enc:/, '') }));
import { createProject, getProject, addSource, reviewPain, mergePains, approveContent, editContent, createTask, controlTask, processResearchTask } from '../../src/modules/ai/research/research-service.js';
const actor = { orgId: 'org-a', userId: 'user-a', role: 'owner' };
let project: any, task: any;
const quote = 'Tôi quản lý khách sạn thường xuyên thiếu khăn sạch trong giờ cao điểm.';
const validPain = { title: 'Thiếu khăn', audience: 'Quản lý khách sạn', situation: 'Giờ cao điểm', impact: 'Chưa rõ', desire: 'Cần đủ khăn', uncertainty: 'Cần kiểm tra nguyên nhân', relevance: 'direct', evidence: [{ sourceId: 'source-a', quote }] };
beforeEach(() => {
  vi.resetAllMocks();
  project = { id: 'project-a', orgId: 'org-a', title: 'Vận hành', brief: 'Khó khăn khách sạn', modelConfigId: 'model-a', maxQueries: 5, maxSources: 30, maxAiCalls: 10, aiCalls: 0, maxAiCostMicros: 1000000n, aiCostMicros: 0n, searchCalls: 0, revision: 1 };
  task = { id: 'task-a', orgId: 'org-a', projectId: project.id, kind: 'analyze', status: 'queued', createdByUserId: actor.userId, checkpoint: {}, input: {}, cancelRequested: false, leaseToken: null, leaseUntil: null };
  mocks.db.customerResearchProject.findFirst.mockImplementation(async ({ where }: any) => where.orgId === actor.orgId && where.id === project.id ? { ...project } : null);
  mocks.db.customerResearchProject.findFirstOrThrow.mockImplementation(async () => ({ ...project }));
  mocks.db.customerResearchProject.update.mockImplementation(async ({ data }: any) => { for (const [key, value] of Object.entries(data) as any) project[key] = value?.increment !== undefined ? project[key] + value.increment : value; return { ...project }; });
  mocks.db.customerResearchTask.count.mockResolvedValue(0);
  mocks.db.customerResearchTask.findUnique.mockResolvedValue(null);
  mocks.db.customerResearchTask.findFirst.mockImplementation(async ({ where }: any) => {
    if (where.id !== task.id || where.orgId !== actor.orgId || where.projectId !== project.id) return null;
    if (where.leaseToken && (task.leaseToken !== where.leaseToken || task.status !== 'running' || task.cancelRequested)) return null;
    if (typeof where.status === 'string' && task.status !== where.status) return null;
    return { ...task };
  });
  mocks.db.customerResearchTask.update.mockImplementation(async ({ data }: any) => { Object.assign(task, data); return { ...task }; });
  mocks.db.customerResearchTask.updateMany.mockImplementation(async ({ where, data }: any) => { if (where.leaseToken && where.leaseToken !== task.leaseToken) return { count: 0 }; Object.assign(task, data); return { count: 1 }; });
  mocks.db.customerResearchSource.count.mockResolvedValue(0);
  mocks.db.customerResearchSource.findUnique.mockResolvedValue(null); mocks.db.customerResearchSource.findFirst.mockResolvedValue(null);
  mocks.db.customerResearchSource.create.mockImplementation(async ({ data }: any) => ({ id: 'source-a', ...data }));
  mocks.db.customerResearchPain.findFirst.mockResolvedValue(null); mocks.db.customerResearchPain.findMany.mockResolvedValue([]);
  mocks.db.customerResearchPain.updateMany.mockResolvedValue({ count: 0 }); mocks.db.customerResearchContent.updateMany.mockResolvedValue({ count: 0 });
  mocks.db.user.findFirst.mockResolvedValue({ id: actor.userId }); mocks.permission.mockResolvedValue(true);
  mocks.resolve.mockResolvedValue({ inputCostPerMillion: 1, outputCostPerMillion: 2, maxRetries: 0 });
  mocks.complete.mockResolvedValue({ structured: { pains: [validPain] }, usage: { costMicros: 20n }, requestId: 'request-a' });
});
describe('research workflow service', () => {
  it('creates a Hermes project without resolving a local provider', async () => {
    mocks.db.customerResearchProject.create.mockImplementation(async ({ data }: any) => ({ id: project.id, ...data, aiCostMicros: 0n }));
    const result = await createProject(actor, { title: 'Hermes', brief: 'Hotel operations', executor: 'hermes' });
    expect(result).toMatchObject({ executor: 'hermes', modelConfigId: 'hermes' });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('leaves Hermes work in the database for API polling rather than local execution', async () => {
    project.executor = 'hermes';
    mocks.db.customerResearchTask.create.mockImplementation(async ({ data }: any) => ({ ...task, ...data }));
    await createTask(actor, project.id, { kind: 'discover', idempotencyKey: 'hermes-task' });
    expect(mocks.db.customerResearchTask.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ input: { executor: 'hermes' } }) }));
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('local workers refuse a Hermes task even if misdelivered to Redis', async () => {
    task.input = { executor: 'hermes' };
    await processResearchTask({ orgId: actor.orgId, projectId: project.id, taskId: task.id });
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(task.status).toBe('queued');
  });
  it('rejects access to another organization before loading evidence', async () => {
    await expect(getProject({ ...actor, orgId: 'org-b' }, project.id)).rejects.toMatchObject({ code: 'RESEARCH_NOT_FOUND' });
    expect(mocks.db.customerResearchSource.groupBy).not.toHaveBeenCalled();
  });
  it('creates a project with bounded settings and serialized monetary fields', async () => {
    mocks.db.customerResearchProject.create.mockImplementation(async ({ data }: any) => ({ id: project.id, ...data, aiCostMicros: 0n }));
    const result = await createProject(actor, { title: 'Khó khăn', brief: 'Vận hành khách sạn', modelConfigId: 'model-a' });
    expect(result.maxAiCostMicros).toBe('1000000');
    expect(mocks.db.customerResearchProject.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orgId: actor.orgId, maxSources: 30, maxQueries: 5 }) }));
  });
  it('requires permission confirmation for manual content', async () => {
    await expect(addSource(actor, project.id, { title: 'Group', content: quote })).rejects.toThrow();
    expect(mocks.db.customerResearchSource.create).not.toHaveBeenCalled();
  });
  it('encrypts manual evidence and invalidates old approvals', async () => {
    const result = await addSource(actor, project.id, { title: 'Bài nhóm', url: 'https://facebook.com/groups/1/posts/2', content: quote, permissionConfirmed: true, speakerRole: 'manager' });
    expect(mocks.db.customerResearchSource.create.mock.calls[0][0].data.contentEncrypted).toBe(`enc:${quote}`);
    expect(result).not.toHaveProperty('contentEncrypted'); expect(mocks.db.customerResearchPain.updateMany).toHaveBeenCalled();
  });
  it('marks reposted content as duplicate rather than independent evidence', async () => {
    mocks.db.customerResearchSource.findFirst.mockResolvedValue({ id: 'original' });
    const result = await addSource(actor, project.id, { title: 'Repost', content: quote, permissionConfirmed: true });
    expect(result).toMatchObject({ status: 'duplicate', duplicateOfId: 'original' });
  });
  it('reuses a repeated source without incrementing the revision', async () => {
    mocks.db.customerResearchSource.findUnique.mockResolvedValue({ id: 'source-a', contentHash: 'existing', contentEncrypted: 'enc:test' });
    expect(await addSource(actor, project.id, { title: 'Bài', content: quote, permissionConfirmed: true })).toMatchObject({ duplicate: true });
    expect(mocks.db.customerResearchProject.update).not.toHaveBeenCalled();
  });
  it('prevents source edits during background work', async () => {
    mocks.db.customerResearchTask.count.mockResolvedValue(1);
    await expect(addSource(actor, project.id, { title: 'Bài', content: quote, permissionConfirmed: true })).rejects.toMatchObject({ code: 'RESEARCH_BUSY' });
  });
  it('rejects stale pain revisions', async () => {
    mocks.db.customerResearchPain.findFirst.mockResolvedValue({ id: 'pain-a', revision: 2, detail: {}, status: 'draft' });
    await expect(reviewPain(actor, project.id, 'pain-a', { revision: 1, status: 'approved' })).rejects.toMatchObject({ code: 'RESEARCH_STALE_REVISION' });
  });
  it('does not approve partial results from failed analysis', async () => {
    mocks.db.customerResearchPain.findFirst.mockResolvedValue({ id: 'pain-a', taskId: task.id, revision: 1, detail: {}, status: 'draft' });
    task.status = 'failed';
    await expect(reviewPain(actor, project.id, 'pain-a', { revision: 1, status: 'approved' })).rejects.toMatchObject({ code: 'RESEARCH_ANALYSIS_INCOMPLETE' });
  });
  it('blocks generation for an unapproved or foreign pain before queueing', async () => {
    await expect(createTask(actor, project.id, { kind: 'generate', painId: 'foreign', format: 'article', idempotencyKey: 'a' })).rejects.toMatchObject({ code: 'RESEARCH_PAIN_NOT_APPROVED' });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('reuses a completed task for an identical idempotency key', async () => {
    mocks.db.customerResearchTask.findUnique.mockResolvedValue({ ...task, status: 'completed', kind: 'analyze', input: {} });
    expect(await createTask(actor, project.id, { kind: 'analyze', idempotencyKey: 'same' })).toMatchObject({ taskId: task.id, status: 'completed' });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('rejects idempotency key reuse for a different operation', async () => {
    mocks.db.customerResearchTask.findUnique.mockResolvedValue({ ...task, kind: 'generate', input: { painId: 'p1', format: 'article' } });
    await expect(createTask(actor, project.id, { kind: 'analyze', idempotencyKey: 'same' })).rejects.toMatchObject({ code: 'RESEARCH_IDEMPOTENCY_CONFLICT' });
  });
  it('revokes the worker token immediately on cancellation', async () => {
    task.status = 'running'; task.leaseToken = 'old-worker';
    await controlTask(actor, project.id, task.id, 'cancel');
    expect(task).toMatchObject({ status: 'cancelled', leaseToken: null, cancelRequested: true });
  });
  it('requires a current approved pain to approve a content draft', async () => {
    mocks.db.customerResearchContent.findFirst.mockResolvedValue({ id: 'content-a', painId: 'pain-a', painRevision: 1 });
    await expect(approveContent(actor, project.id, 'content-a')).rejects.toMatchObject({ code: 'RESEARCH_STALE_REVISION' });
  });
  it('preserves the old content body and creates an unapproved new version', async () => {
    const old = { id: 'content-a', orgId: actor.orgId, projectId: project.id, painId: 'pain-a', taskId: task.id, format: 'article', title: 'Title', body: 'Original', evidence: [], missingInformation: [], status: 'approved', version: 1, rootId: null, painRevision: 3 };
    mocks.db.customerResearchContent.findFirst.mockResolvedValue(old); mocks.db.customerResearchPain.findFirst.mockResolvedValue({ id: 'pain-a', revision: 3, status: 'approved' });
    mocks.db.customerResearchContent.create.mockImplementation(async ({ data }: any) => data);
    const result = await editContent(actor, project.id, old.id, { body: 'Revised content' });
    expect(result).toMatchObject({ rootId: old.id, version: 2, status: 'draft', approvedAt: null, body: 'Revised content' });
    expect(mocks.db.customerResearchContent.update).toHaveBeenCalledWith({ where: { id: old.id }, data: { status: 'archived' } });
  });
  it('blocks a revoked user before any model call', async () => {
    mocks.permission.mockResolvedValue(false);
    await processResearchTask({ orgId: actor.orgId, projectId: project.id, taskId: task.id });
    expect(task).toMatchObject({ status: 'failed', errorCode: 'RESEARCH_PERMISSION_REVOKED' }); expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('reserves and checks budget before spending on AI', async () => {
    project.maxAiCostMicros = 1n;
    mocks.db.customerResearchSource.findMany.mockResolvedValue([{ id: 'source-a', contentEncrypted: `enc:${quote}` }]);
    await processResearchTask({ orgId: actor.orgId, projectId: project.id, taskId: task.id });
    expect(task).toMatchObject({ status: 'failed', errorCode: 'RESEARCH_AI_BUDGET' }); expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('fails invented AI evidence without persisting a pain', async () => {
    mocks.db.customerResearchSource.findMany.mockResolvedValue([{ id: 'source-a', contentEncrypted: `enc:${quote}` }]);
    mocks.complete.mockResolvedValue({ structured: { pains: [{ ...validPain, evidence: [{ sourceId: 'source-a', quote: 'Invented words not found in the real source' }] }] }, usage: { costMicros: 20n } });
    await processResearchTask({ orgId: actor.orgId, projectId: project.id, taskId: task.id });
    expect(task).toMatchObject({ status: 'failed', errorCode: 'RESEARCH_INVALID_EVIDENCE' }); expect(mocks.db.customerResearchPain.create).not.toHaveBeenCalled();
    expect(mocks.db.customerResearchPain.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.customerResearchContent.updateMany).not.toHaveBeenCalled();
  });
  it('commits an evidenced analysis and source scope checkpoint', async () => {
    mocks.db.customerResearchSource.findMany.mockResolvedValue([{ id: 'source-a', speakerRole: 'unknown', contentEncrypted: `enc:${quote}` }]);
    await processResearchTask({ orgId: actor.orgId, projectId: project.id, taskId: task.id });
    expect(task.status).toBe('completed'); expect(task.checkpoint).toMatchObject({ sourceCount: 1, batch: 1 });
    expect(mocks.db.customerResearchPain.create.mock.calls[0][0].data).toMatchObject({ independentSources: 1, detail: { certainty: 'needs_verification' } });
  });
  it('discards AI output returned after cancellation', async () => {
    task.kind = 'generate'; task.input = { painId: 'pain-a', painRevision: 1, format: 'article' };
    mocks.db.customerResearchPain.findFirst.mockResolvedValue({ id: 'pain-a', revision: 1, title: 'Khăn', detail: {}, evidence: [{ sourceId: 'source-a', quote }] });
    mocks.complete.mockImplementation(async () => {
      await controlTask(actor, project.id, task.id, 'cancel');
      return { structured: { title: 'Khăn', body: 'Kiểm tra đồ vải.', sourceIds: ['source-a'], missingInformation: [] }, usage: { costMicros: 20n } };
    });
    await processResearchTask({ orgId: actor.orgId, projectId: project.id, taskId: task.id });
    expect(task.status).toBe('cancelled'); expect(mocks.db.customerResearchContent.create).not.toHaveBeenCalled();
    expect(mocks.db.aiAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'research.ai_call_completed' }) }));
  });
});

describe('research generation and resumption', () => {
  it('persists a sourced content draft and completes the task in the same transaction', async () => {
    task.kind = 'generate'; task.input = { painId: 'pain-a', painRevision: 2, format: 'checklist' };
    mocks.db.customerResearchPain.findFirst.mockResolvedValue({ id: 'pain-a', revision: 2, title: 'Khăn', detail: {}, evidence: [{ sourceId: 'source-a', quote }] });
    mocks.complete.mockResolvedValue({ structured: { title: 'Kiểm tra khăn', body: 'Hỏi lại quy trình giặt và số lượng đang dùng.', sourceIds: ['source-a'], missingInformation: ['Chưa có quy trình giặt xác nhận'] }, usage: { costMicros: 20n } });
    await processResearchTask({ orgId: actor.orgId, projectId: project.id, taskId: task.id });
    expect(task.status).toBe('completed');
    expect(mocks.db.customerResearchContent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ orgId: actor.orgId, projectId: project.id, painId: 'pain-a', painRevision: 2, format: 'checklist', evidence: [{ sourceId: 'source-a', quote }], missingInformation: ['Chưa có quy trình giặt xác nhận'] }) });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('rejects a draft citing sources outside the approved evidence set', async () => {
    task.kind = 'generate'; task.input = { painId: 'pain-a', painRevision: 2, format: 'article' };
    mocks.db.customerResearchPain.findFirst.mockResolvedValue({ id: 'pain-a', revision: 2, title: 'Khăn', detail: {}, evidence: [{ sourceId: 'source-a', quote }] });
    mocks.complete.mockResolvedValue({ structured: { title: 'T', body: 'B', sourceIds: ['foreign-source'], missingInformation: [] }, usage: { costMicros: 20n } });
    await processResearchTask({ orgId: actor.orgId, projectId: project.id, taskId: task.id });
    expect(task.errorCode).toBe('RESEARCH_INVALID_AI_OUTPUT'); expect(mocks.db.customerResearchContent.create).not.toHaveBeenCalled();
  });
  it('does not resume an analysis checkpoint after sources changed', async () => {
    task.checkpoint = { started: true, batch: 1, sourceRevision: 1 }; project.revision = 2;
    mocks.db.customerResearchSource.findMany.mockResolvedValue([{ id: 'source-a', contentEncrypted: `enc:${quote}` }]);
    await processResearchTask({ orgId: actor.orgId, projectId: project.id, taskId: task.id });
    expect(task.errorCode).toBe('RESEARCH_STALE_REVISION'); expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('does not spend when the logical AI-call cap has been reached', async () => {
    project.aiCalls = project.maxAiCalls;
    mocks.db.customerResearchSource.findMany.mockResolvedValue([{ id: 'source-a', contentEncrypted: `enc:${quote}` }]);
    await processResearchTask({ orgId: actor.orgId, projectId: project.id, taskId: task.id });
    expect(task.errorCode).toBe('RESEARCH_AI_BUDGET'); expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('requires known model pricing instead of silently disabling the money bound', async () => {
    mocks.resolve.mockResolvedValue({ inputCostPerMillion: 0, outputCostPerMillion: 0, maxRetries: 0 });
    mocks.db.customerResearchSource.findMany.mockResolvedValue([{ id: 'source-a', contentEncrypted: `enc:${quote}` }]);
    await processResearchTask({ orgId: actor.orgId, projectId: project.id, taskId: task.id });
    expect(task.errorCode).toBe('RESEARCH_MODEL_PRICING_REQUIRED'); expect(mocks.complete).not.toHaveBeenCalled();
  });
});
