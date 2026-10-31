// SPDX-License-Identifier: AGPL-3.0-or-later
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const service = Object.fromEntries(['listResearchModels','listProjects','createProject','getProject','listSources','addSource','listPains','reviewPain','mergePains','listContents','editContent','approveContent','createTask','controlTask','useDirectResearch'].map((name) => [name, vi.fn()]));
  return { service, task: vi.fn(), saveKey: vi.fn(), capabilities: vi.fn() };
});
vi.mock('../../src/modules/ai/research/research-settings.js', () => ({ researchCapabilities: mocks.capabilities, saveResearchSearchKey: mocks.saveKey }));
vi.mock('../../src/modules/ai/research/research-service.js', () => mocks.service);
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: { customerResearchTask: { findFirst: mocks.task } } }));
vi.mock('../../src/modules/ai/ai-control-plane-permissions.js', () => ({ aiPermissions: { model: { manageSecret: async (r: any, reply: any) => { if (r.headers['x-deny'] === 'manageSecret') reply.code(403).send({ code: 'RBAC_FORBIDDEN' }); } }, knowledge: Object.fromEntries(['access','create','edit','approve'].map((action) => [action, async (request: any, reply: any) => { if (request.headers['x-deny'] === action) reply.code(403).send({ code: 'RBAC_FORBIDDEN' }); }])) } }));
vi.mock('../../src/modules/integrations/_shared/token-encryption.util.js', () => ({ getTokenEncryptionKeyReadiness: () => ({ ready: false }) }));
import { researchRoutes } from '../../src/modules/ai/research/research-routes.js';
import { ResearchError } from '../../src/modules/ai/research/research-domain.js';
async function app() {
  const server = Fastify();
  server.addHook('preHandler', async (request, reply) => {
    if (!request.headers.authorization) return reply.code(401).send({ error: 'unauthorized' });
    request.user = { id: 'user-a', orgId: 'org-a', role: 'owner' } as any;
  });
  await server.register(researchRoutes); await server.ready(); return server;
}
beforeEach(() => { vi.clearAllMocks(); });
describe('research API boundaries', () => {
  it('lists research-ready models with research access and scopes them to the authenticated tenant', async () => {
    const server = await app(); mocks.service.listResearchModels.mockResolvedValue([{ id: 'tested', status: 'testing' }]);
    const result = await server.inject({ url: '/api/v1/ai/research/models', headers: { authorization: 'test' } });
    expect(result.statusCode).toBe(200); expect(result.json().models).toEqual([{ id: 'tested', status: 'testing' }]);
    expect(mocks.service.listResearchModels).toHaveBeenCalledWith({ orgId: 'org-a', userId: 'user-a', role: 'owner' });
    const denied = await server.inject({ url: '/api/v1/ai/research/models', headers: { authorization: 'test', 'x-deny': 'access' } });
    expect(denied.statusCode).toBe(403); await server.close();
  });
  it('requires the parent authentication hook', async () => {
    const server = await app();
    expect((await server.inject({ url: '/api/v1/ai/research/projects' })).statusCode).toBe(401);
    expect(mocks.service.listProjects).not.toHaveBeenCalled(); await server.close();
  });
  it('enforces resource grants before reading source content', async () => {
    const server = await app();
    const result = await server.inject({ url: '/api/v1/ai/research/projects/p/sources', headers: { authorization: 'test', 'x-deny': 'access' } });
    expect(result.statusCode).toBe(403); expect(mocks.service.listSources).not.toHaveBeenCalled(); await server.close();
  });
  it('accepts source pages past the old sixty-source total', async () => {
    const server = await app(); mocks.service.listSources.mockResolvedValue([]);
    const result = await server.inject({ url: '/api/v1/ai/research/projects/p/sources?page=4', headers: { authorization: 'test' } });
    expect(result.statusCode).toBe(200);
    expect(mocks.service.listSources).toHaveBeenCalledWith({ orgId: 'org-a', userId: 'user-a', role: 'owner' }, 'p', 4);
    await server.close();
  });
  it('requires the approval grant in addition to edit for approving pains', async () => {
    const server = await app();
    const result = await server.inject({ method: 'PATCH', url: '/api/v1/ai/research/projects/p/pains/x', headers: { authorization: 'test', 'x-deny': 'approve' }, payload: { status: 'approved', revision: 1 } });
    expect(result.statusCode).toBe(403); expect(mocks.service.reviewPain).not.toHaveBeenCalled(); await server.close();
  });
  it('accepts jobs asynchronously with the authenticated organization', async () => {
    const server = await app(); mocks.service.createTask.mockResolvedValue({ taskId: 'task-a', status: 'queued' });
    const result = await server.inject({ method: 'POST', url: '/api/v1/ai/research/projects/p/tasks', headers: { authorization: 'test' }, payload: { kind: 'analyze', idempotencyKey: 'run-1' } });
    expect(result.statusCode).toBe(202); expect(mocks.service.createTask).toHaveBeenCalledWith({ orgId: 'org-a', userId: 'user-a', role: 'owner' }, 'p', { kind: 'analyze', idempotencyKey: 'run-1' }); await server.close();
  });
  it('scopes task polling by project and organization and returns 404 for another tenant', async () => {
    const server = await app(); mocks.task.mockResolvedValue(null);
    const result = await server.inject({ url: '/api/v1/ai/research/projects/p/tasks/foreign', headers: { authorization: 'test' } });
    expect(result.statusCode).toBe(404); expect(mocks.task).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'foreign', projectId: 'p', orgId: 'org-a' } })); await server.close();
  });
  it('preserves useful input errors but does not leak provider/database secrets', async () => {
    const server = await app();
    mocks.service.createProject.mockRejectedValueOnce(new ResearchError('Tên còn thiếu.'));
    const input = { method: 'POST' as const, url: '/api/v1/ai/research/projects', headers: { authorization: 'test' }, payload: {} };
    expect((await server.inject(input)).json()).toMatchObject({ error: 'Tên còn thiếu.' });
    mocks.service.createProject.mockRejectedValueOnce(new Error('postgresql://secret:password@internal'));
    const result = await server.inject(input); expect(result.body).not.toContain('password'); expect(result.statusCode).toBe(502); await server.close();
  });
  it('requires approval permission before atomically selecting pains for writing', async () => {
    const server = await app();
    const result = await server.inject({ method: 'POST', url: '/api/v1/ai/research/projects/p/tasks', headers: { authorization: 'test', 'x-deny': 'approve' }, payload: { kind: 'generate_batch', pains: [{ painId: 'x', revision: 1 }], format: 'article', idempotencyKey: 'batch' } });
    expect(result.statusCode).toBe(403); expect(mocks.service.createTask).not.toHaveBeenCalled(); await server.close();
  });
  it('protects the search credential behind secret-management permissions', async () => {
    const server = await app();
    const result = await server.inject({ method: 'POST', url: '/api/v1/ai/research/search-connection', headers: { authorization: 'test', 'x-deny': 'manageSecret' }, payload: { apiKey: 'secret-key' } });
    expect(result.statusCode).toBe(403); expect(mocks.saveKey).not.toHaveBeenCalled(); await server.close();
  });
  it('passes only authenticated organization context to the direct-execution switch', async () => {
    const server = await app(); mocks.service.useDirectResearch.mockResolvedValue({ executor: 'internal' });
    const response = await server.inject({ method: 'POST', url: '/api/v1/ai/research/projects/p/direct', headers: { authorization: 'test' }, payload: { modelConfigId: 'local' } });
    expect(response.statusCode).toBe(200); expect(mocks.service.useDirectResearch).toHaveBeenCalledWith({ orgId: 'org-a', userId: 'user-a', role: 'owner' }, 'p', { modelConfigId: 'local' }); await server.close();
  });
  it('validates pagination without accepting unbounded reads', async () => {
    const server = await app();
    expect((await server.inject({ url: '/api/v1/ai/research/projects?page=-1', headers: { authorization: 'test' } })).statusCode).toBe(400);
    expect(mocks.service.listProjects).not.toHaveBeenCalled(); await server.close();
  });
});
