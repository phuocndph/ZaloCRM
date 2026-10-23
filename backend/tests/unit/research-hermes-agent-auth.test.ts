// SPDX-License-Identifier: AGPL-3.0-or-later
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), grant: vi.fn() }));
vi.mock('../../src/modules/agents/agent-store.js', () => ({ authenticateAgent: mocks.authenticate }));
vi.mock('../../src/modules/rbac/permission-group-service.js', () => ({ userHasGrant: mocks.grant }));
import { authenticateHermesResearchAgent } from '../../src/modules/ai/research/research-hermes-agent-auth.js';
import { AgentError } from '../../src/modules/agents/agent-policy.js';
const servers: ReturnType<typeof Fastify>[] = [];
async function app() {
  const server = Fastify(); servers.push(server);
  server.addHook('preHandler', async (r, reply) => {
    const handled = await authenticateHermesResearchAgent(r, reply);
    if (!handled) reply.code(401).send({ error: 'Legacy public key required' });
  });
  for (const url of ['/api/public/research/hermes/claim', '/api/public/research/hermes/tasks/task/complete', '/api/public/contacts']) {
    server.post(url, async (r) => ({ orgId: (r as any).orgId }));
  }
  await server.ready(); return server;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ config: { permissions: ['research_execute'] }, orgId: 'org-a', user: { id: 'user-a', role: 'member' } });
  mocks.grant.mockResolvedValue(true);
});
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); });
describe('existing scoped Agent key for research', () => {
  it('accepts an explicitly enabled research scope and uses authenticated organization', async () => {
    const server = await app();
    const result = await server.inject({ method: 'POST', url: '/api/public/research/hermes/claim', headers: { authorization: 'Bearer zcrm_agent.test' }, payload: {} });
    expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ orgId: 'org-a' });
    expect(mocks.grant).toHaveBeenCalledWith('user-a', 'ai_knowledge', 'edit');
  });
  it('does not silently grant research access to existing Agent keys', async () => {
    mocks.authenticate.mockResolvedValue({ config: { permissions: ['work_read'] }, orgId: 'org-a', user: { id: 'user-a', role: 'owner' } });
    const server = await app();
    const result = await server.inject({ method: 'POST', url: '/api/public/research/hermes/claim', headers: { authorization: 'Bearer token' }, payload: {} });
    expect(result.statusCode).toBe(403); expect(mocks.grant).not.toHaveBeenCalled();
  });
  it('rechecks backing employee grants on result submission', async () => {
    mocks.grant.mockResolvedValue(false); const server = await app();
    expect((await server.inject({ method: 'POST', url: '/api/public/research/hermes/tasks/task/complete', headers: { authorization: 'Bearer token' }, payload: {} })).statusCode).toBe(403);
  });
  it('rejects revoked keys without falling back to a legacy key', async () => {
    mocks.authenticate.mockRejectedValue(new AgentError(401, 'AGENT_UNAUTHORIZED'));
    const server = await app();
    expect((await server.inject({ method: 'POST', url: '/api/public/research/hermes/claim', headers: { authorization: 'Bearer revoked', 'x-api-key': 'legacy' }, payload: {} })).statusCode).toBe(401);
  });
  it('never authorizes contacts or other legacy APIs with an Agent key', async () => {
    const server = await app();
    expect((await server.inject({ method: 'POST', url: '/api/public/contacts', headers: { authorization: 'Bearer token' }, payload: {} })).statusCode).toBe(401);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });
});
