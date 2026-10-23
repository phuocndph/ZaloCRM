// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const db: any = { $executeRaw: vi.fn() };
  for (const name of ['customerResearchProject', 'customerResearchTask', 'customerResearchSource', 'customerResearchPain', 'customerResearchContent', 'user', 'aiAuditLog']) {
    db[name] = Object.fromEntries(['findMany','findFirst','findFirstOrThrow','findUnique','count','create','update','updateMany'].map((x) => [x, vi.fn()]));
  }
  return { db, permission: vi.fn(), saveSource: vi.fn(), invalidate: vi.fn(), audit: vi.fn() };
});
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: mocks.db, tenantTransaction: (fn: any) => fn(mocks.db) }));
vi.mock('../../src/modules/rbac/permission-group-service.js', () => ({ userHasGrant: mocks.permission }));
vi.mock('../../src/modules/integrations/_shared/token-encryption.util.js', () => ({ decryptToken: (s: string) => s.replace(/^enc:/, '') }));
vi.mock('../../src/modules/ai/research/research-service.js', () => ({
  lockProject: (tx: any, actor: any, id: string) => tx.customerResearchProject.findFirst({ where: { id, orgId: actor.orgId } }),
  saveSource: mocks.saveSource, invalidate: mocks.invalidate, audit: mocks.audit,
}));
import { claimHermesTask, updateHermesTask, completeHermesTask } from '../../src/modules/ai/research/research-hermes-service.js';
let project: any, task: any;
const quote = 'Khách sạn thường thiếu khăn sạch vào giờ nhận phòng đông khách.';
const source = { id: 's1', title: 'Source', url: 'https://example.org/post', speakerRole: 'unknown', contentEncrypted: `enc:${quote}` };
const pain = { title: 'Thiếu khăn', audience: 'Quản lý', situation: 'Giờ nhận phòng', impact: 'Chưa rõ', desire: 'Đủ khăn sạch', uncertainty: 'Chưa rõ nguyên nhân', relevance: 'direct', evidence: [{ sourceId: 's1', quote }] };
beforeEach(() => {
  vi.resetAllMocks();
  project = { id: 'p1', orgId: 'o1', executor: 'hermes', title: 'Hotel', brief: 'Hotel operations', revision: 1, searchCalls: 0, aiCalls: 0, maxQueries: 5, maxSources: 30, maxAiCalls: 10 };
  task = { id: 't1', orgId: 'o1', projectId: 'p1', createdByUserId: 'u1', kind: 'analyze', status: 'queued', input: { executor: 'hermes' }, checkpoint: {}, leaseToken: null, leaseUntil: null, cancelRequested: false };
  mocks.db.customerResearchProject.findFirst.mockImplementation(async () => ({ ...project }));
  mocks.db.customerResearchTask.findMany.mockImplementation(async () => [{ ...task }]);
  mocks.db.customerResearchTask.findFirst.mockImplementation(async ({ where }: any) => where.orgId === task.orgId && where.id === task.id ? { ...task } : null);
  mocks.db.customerResearchTask.findFirstOrThrow.mockImplementation(async () => ({ ...task }));
  mocks.db.customerResearchTask.update.mockImplementation(async ({ data }: any) => { Object.assign(task, data); return { ...task }; });
  mocks.db.customerResearchSource.findMany.mockResolvedValue([source]);
  mocks.db.customerResearchSource.count.mockResolvedValue(1);
  mocks.db.user.findFirst.mockResolvedValue({ id: 'u1' });
  mocks.permission.mockResolvedValue(true);
  mocks.saveSource.mockResolvedValue({ changed: true });
});
async function claim() { return (await claimHermesTask('o1')).task!; }
describe('Hermes research ownership and result gates', () => {
  it('assigns the next source batch with exact text and a private lease', async () => {
    const result = await claim();
    expect(result).toMatchObject({ kind: 'analyze', skill: 'zcrm-summarize-hotel-pains', leaseSeconds: 120, input: { sources: [expect.objectContaining({ content: quote })] } });
    expect(result).not.toHaveProperty('apiKey');
    expect(task.status).toBe('running');
    expect(mocks.db.customerResearchProject.update).toHaveBeenCalledWith(expect.objectContaining({ data: { aiCalls: { increment: 1 } } }));
  });
  it('does not give a live task to another poller', async () => {
    await claim(); expect((await claimHermesTask('o1')).task).toBeNull();
  });
  it('fences old workers after an expired lease is reclaimed without charging twice', async () => {
    const first = await claim(); task.leaseUntil = new Date(0);
    const second = await claim(); expect(second.leaseToken).not.toBe(first.leaseToken);
    await expect(completeHermesTask('o1', 't1', { leaseToken: first.leaseToken, result: { pains: [pain] } })).rejects.toMatchObject({ code: 'RESEARCH_HERMES_LEASE_EXPIRED' });
    expect(mocks.db.customerResearchProject.update).toHaveBeenCalledTimes(1);
  });
  it('does not assign work for internal projects', async () => {
    project.executor = 'internal'; expect((await claimHermesTask('o1')).task).toBeNull();
  });
  it('rejects results from another organization', async () => {
    await expect(completeHermesTask('other', 't1', { leaseToken: 'x', result: {} })).rejects.toMatchObject({ code: 'RESEARCH_TASK_NOT_FOUND' });
  });
  it('rejects fabricated quotes atomically before replacing findings', async () => {
    const claimed = await claim();
    await expect(completeHermesTask('o1', 't1', { leaseToken: claimed.leaseToken, result: { pains: [{ ...pain, evidence: [{ sourceId: 's1', quote: 'This fabricated quotation is absent from the real source.' }] }] } })).rejects.toMatchObject({ code: 'RESEARCH_INVALID_EVIDENCE' });
    expect(mocks.db.customerResearchPain.create).not.toHaveBeenCalled();
    expect(mocks.db.customerResearchPain.updateMany).not.toHaveBeenCalled();
  });
  it('stores valid pains as drafts and makes repeated completion idempotent', async () => {
    const claimed = await claim(), body = { leaseToken: claimed.leaseToken, result: { pains: [pain] } };
    expect(await completeHermesTask('o1', 't1', body)).toMatchObject({ status: 'completed', duplicate: false });
    expect(await completeHermesTask('o1', 't1', body)).toMatchObject({ duplicate: true });
    expect(mocks.db.customerResearchPain.create).toHaveBeenCalledTimes(1);
    const data = mocks.db.customerResearchPain.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('approvedAt'); expect(data.detail.certainty).toBe('needs_verification');
  });
  it('rejects a changed result or wrong receipt after completion', async () => {
    const claimed = await claim(); await completeHermesTask('o1', 't1', { leaseToken: claimed.leaseToken, result: { pains: [pain] } });
    await expect(completeHermesTask('o1', 't1', { leaseToken: 'different', result: { pains: [pain] } })).rejects.toMatchObject({ code: 'RESEARCH_HERMES_LEASE_EXPIRED' });
  });
  it('blocks cancelled work and revoked creators', async () => {
    const claimed = await claim(); task.cancelRequested = true;
    await expect(updateHermesTask('o1', 't1', { leaseToken: claimed.leaseToken, message: 'Working' }, 'progress')).rejects.toMatchObject({ code: 'RESEARCH_HERMES_LEASE_EXPIRED' });
    task.cancelRequested = false; mocks.permission.mockResolvedValue(false);
    await expect(completeHermesTask('o1', 't1', { leaseToken: claimed.leaseToken, result: { pains: [] } })).rejects.toMatchObject({ code: 'RESEARCH_PERMISSION_REVOKED' });
  });
  it('recovers without cumulative attempt, deadline, search or AI caps', async () => {
    task.checkpoint = { attempts: 300, deadline: 1 };
    project.aiCalls = 500; project.searchCalls = 500;
    const result = await claim();
    expect(result).not.toHaveProperty('deadline'); expect(task.status).toBe('running');
    expect(task.checkpoint.attempts).toBe(301);
    await updateHermesTask('o1', 't1', { leaseToken: result.leaseToken, message: 'Still working' }, 'progress');
  });
  it('continues discovery with exhausted legacy quotas and more than sixty saved sources', async () => {
    task.kind = 'discover'; project.searchCalls = 500; project.aiCalls = 500;
    mocks.db.customerResearchSource.count.mockResolvedValue(500);
    const claimed = await claim();
    const first = { leaseToken: claimed.leaseToken, batch: 0, result: { sources: [{ title: 'S', url: source.url, content: quote, permissionConfirmed: true }], hasMore: true, nextSearch: 'Tìm thêm về bảo trì' } };
    const response = await completeHermesTask('o1', 't1', first);
    expect(response).toMatchObject({ status: 'running', task: { batch: 1, input: { nextSearch: 'Tìm thêm về bảo trì' } } });
    expect(await completeHermesTask('o1', 't1', first)).toMatchObject({ duplicate: true });
    expect(mocks.saveSource).toHaveBeenCalledTimes(1);
    expect(await completeHermesTask('o1', 't1', { leaseToken: claimed.leaseToken, batch: 1, result: { sources: [], hasMore: false } })).toMatchObject({ status: 'completed' });
  });
  it('processes all 66 sources, recovers a batch and ignores duplicate submissions', async () => {
    const sources = Array.from({ length: 66 }, (_, i) => ({ ...source, id: `s${i}` }));
    mocks.db.customerResearchSource.findMany.mockImplementation(async ({ skip = 0, take = sources.length }: any) => sources.slice(skip, skip + take));
    mocks.db.customerResearchSource.count.mockResolvedValue(sources.length);
    let claimed = await claim();
    let total = 0;
    while (true) {
      total += claimed.input.sources.length;
      const body = { leaseToken: claimed.leaseToken, batch: claimed.batch, result: { pains: [] } };
      const response = await completeHermesTask('o1', 't1', body);
      if (response.status === 'completed') break;
      expect(mocks.db.customerResearchPain.updateMany).not.toHaveBeenCalled();
      expect(await completeHermesTask('o1', 't1', body)).toMatchObject({ duplicate: true, task: { batch: claimed.batch + 1 } });
      if (claimed.batch === 0) {
        task.leaseUntil = new Date(0);
        const recovered = await claim();
        expect(recovered.batch).toBe(1);
        await expect(completeHermesTask('o1', 't1', body)).rejects.toMatchObject({ code: 'RESEARCH_HERMES_LEASE_EXPIRED' });
        claimed = recovered;
      } else claimed = response.task!;
    }
    expect(total).toBe(66); expect(task.status).toBe('completed');
    expect(mocks.db.customerResearchPain.updateMany).toHaveBeenCalledTimes(1);
  });
  it('refuses old bridges for multiple batches instead of silently skipping sources', async () => {
    mocks.db.customerResearchSource.count.mockResolvedValue(66);
    const claimed = await claim();
    await expect(completeHermesTask('o1', 't1', { leaseToken: claimed.leaseToken, result: { pains: [] } })).rejects.toMatchObject({ code: 'RESEARCH_HERMES_BATCH_REQUIRED' });
  });
  it('extends a valid lease and stores a redacted progress message', async () => {
    const claimed = await claim();
    await updateHermesTask('o1', 't1', { leaseToken: claimed.leaseToken, message: 'Đọc bài test@example.org' }, 'progress');
    expect(task.checkpoint.progress).toContain('[email đã ẩn]');
  });
  it('requires authorized access and keeps imported author roles unknown', async () => {
    task.kind = 'discover'; const claimed = await claim();
    await expect(completeHermesTask('o1', 't1', { leaseToken: claimed.leaseToken, result: { sources: [{ title: 'S', url: source.url, content: quote }] } })).rejects.toThrow();
    await completeHermesTask('o1', 't1', { leaseToken: claimed.leaseToken, result: { sources: [{ title: 'S', url: source.url, content: quote, permissionConfirmed: true, speakerRole: 'owner' }] } });
    expect(mocks.saveSource).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'p1', expect.objectContaining({ speakerRole: 'unknown', kind: 'hermes' }));
  });
  it('does not assign generation for an unapproved pain', async () => {
    task.kind = 'generate'; task.input = { executor: 'hermes', painId: 'pain1', painRevision: 1, format: 'article' };
    mocks.db.customerResearchPain.findFirst.mockResolvedValue(null);
    expect((await claimHermesTask('o1')).task).toBeNull(); expect(task.errorCode).toBe('RESEARCH_PAIN_NOT_APPROVED');
  });
  it('rechecks approval and sources when receiving a content draft', async () => {
    task.kind = 'generate'; task.input = { executor: 'hermes', painId: 'pain1', painRevision: 1, format: 'article' };
    mocks.db.customerResearchPain.findFirst.mockResolvedValue({ id: 'pain1', revision: 1, title: 'Pain', detail: {}, evidence: pain.evidence });
    const claimed = await claim();
    await expect(completeHermesTask('o1', 't1', { leaseToken: claimed.leaseToken, result: { title: 'T', body: 'Body', sourceIds: ['foreign'], missingInformation: [] } })).rejects.toMatchObject({ code: 'RESEARCH_INVALID_EVIDENCE' });
    await completeHermesTask('o1', 't1', { leaseToken: claimed.leaseToken, result: { title: 'T', body: 'Body', sourceIds: ['s1'], missingInformation: [] } });
    expect(mocks.db.customerResearchContent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ painRevision: 1, format: 'article' }) }));
  });
});
