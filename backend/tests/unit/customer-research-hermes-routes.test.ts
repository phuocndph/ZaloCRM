// SPDX-License-Identifier: AGPL-3.0-or-later
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ claim: vi.fn(), complete: vi.fn(), update: vi.fn(), setting: vi.fn() }));
vi.mock('../../src/modules/ai/research/research-hermes-service.js', () => ({ claimHermesTask: mocks.claim, completeHermesTask: mocks.complete, updateHermesTask: mocks.update }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: { appSetting: { upsert: mocks.setting } } }));
import { researchHermesRoutes } from '../../src/modules/ai/research/research-hermes-routes.js';
import { ResearchError } from '../../src/modules/ai/research/research-domain.js';
import { getTenantContext } from '../../src/shared/tenant/tenant-context.js';
async function app() {
  const server = Fastify();
  server.addHook('preHandler', async (r, reply) => {
    if (r.headers['x-api-key'] !== 'existing-key') return reply.code(401).send({ error: 'Invalid API key' });
    (r as any).orgId = 'o1';
  });
  await server.register(researchHermesRoutes); await server.ready(); return server;
}
beforeEach(() => { vi.resetAllMocks(); });
describe('Hermes external API', () => {
  it('inherits API-key authentication and rejects unauthenticated callers', async () => {
    const server = await app();
    expect((await server.inject({ method: 'POST', url: '/api/public/research/hermes/claim', payload: {} })).statusCode).toBe(401);
    expect(mocks.claim).not.toHaveBeenCalled(); await server.close();
  });
  it('derives the organization from auth and applies the tenant context', async () => {
    const server = await app();
    mocks.claim.mockImplementation(async (orgId) => { expect(orgId).toBe('o1'); expect(getTenantContext()?.orgId).toBe('o1'); return { task: null }; });
    const result = await server.inject({ method: 'POST', url: '/api/public/research/hermes/claim', headers: { 'x-api-key': 'existing-key' }, payload: {} });
    expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ task: null }); await server.close();
  });
  it('does not let callers choose an organization through claim input', async () => {
    const server = await app();
    const result = await server.inject({ method: 'POST', url: '/api/public/research/hermes/claim', headers: { 'x-api-key': 'existing-key' }, payload: { orgId: 'other' } });
    expect(result.statusCode).toBe(400); expect(mocks.claim).not.toHaveBeenCalled(); await server.close();
  });
  it('passes authenticated org and lease to result validation', async () => {
    const server = await app(); mocks.complete.mockResolvedValue({ status: 'completed' });
    const payload = { leaseToken: 'worker-token', result: { pains: [] } };
    const result = await server.inject({ method: 'POST', url: '/api/public/research/hermes/tasks/t1/complete', headers: { 'x-api-key': 'existing-key' }, payload });
    expect(result.statusCode).toBe(200); expect(mocks.complete).toHaveBeenCalledWith('o1', 't1', payload); await server.close();
  });
  it('returns a conflict for a cancelled lease, with no internal exception detail', async () => {
    const server = await app(); mocks.complete.mockRejectedValue(new ResearchError('Đã dừng', 409, 'RESEARCH_HERMES_LEASE_EXPIRED'));
    const result = await server.inject({ method: 'POST', url: '/api/public/research/hermes/tasks/t1/complete', headers: { 'x-api-key': 'existing-key' }, payload: { leaseToken: 'token', result: {} } });
    expect(result.statusCode).toBe(409); expect(result.json().code).toBe('RESEARCH_HERMES_LEASE_EXPIRED'); await server.close();
  });
  it('has no approval or arbitrary data-editing endpoint for Hermes', async () => {
    const server = await app();
    expect((await server.inject({ method: 'POST', url: '/api/public/research/hermes/tasks/t1/approve', headers: { 'x-api-key': 'existing-key' }, payload: {} })).statusCode).toBe(404);
    await server.close();
  });
});
