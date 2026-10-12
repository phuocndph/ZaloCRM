import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ actor: null as any, stored: null as any, save: vi.fn(), execute: vi.fn(), refresh: vi.fn(), reserve: vi.fn(), finish: vi.fn(), audit: vi.fn(), authCount: 0, revokeDuring: false }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: {
  user: { findUnique: vi.fn(async () => ({ isActive: true, jwtTokenVersion: 0 })), findFirst: vi.fn(async () => ({ id: 'user', role: 'owner' })), findMany: vi.fn(async () => []) },
  zaloAccount: { count: vi.fn(async () => 1), findMany: vi.fn(async () => []) },
  appSetting: { findUnique: vi.fn(async () => ({ valuePlain: JSON.stringify(mocks.stored) })), findMany: vi.fn(async () => [{ valuePlain: JSON.stringify(mocks.stored) }]) },
  aiAuditLog: { findMany: vi.fn(async () => []), create: mocks.audit },
} }));
vi.mock('../../src/modules/rbac/permission-group-service.js', () => ({ userHasGrant: async () => true }));
vi.mock('../../src/modules/agents/agent-store.js', async () => {
  const policy = await import('../../src/modules/agents/agent-policy.js');
  return { agentSettingKey: (id: string) => 'agent_connection:' + id, saveAgent: mocks.save, reserveAgentOperation: mocks.reserve, finishAgentOperation: mocks.finish,
    authenticateAgent: async (token: string) => { mocks.authCount++; policy.checkAgentToken({ ...mocks.actor.config, ...(mocks.revokeDuring && mocks.authCount > 1 ? { enabled: false } : {}) }, token); return mocks.actor; } };
});
vi.mock('../../src/modules/agents/agent-tools.js', async () => {
  const policy = await import('../../src/modules/agents/agent-policy.js');
  return { agentDraftScopeFingerprint: async () => 'scope', availableAgentTools: async (actor: any) => policy.AGENT_TOOLS.filter(t => actor.config.permissions.includes(t.permission)),
    prepareAgentTool: async (actor: any, name: string) => { const tool = policy.AGENT_TOOLS.find(t => t.name === name)!; if (!actor.config.permissions.includes(tool.permission)) throw new policy.AgentError(403, 'AGENT_PERMISSION_DENIED'); return { tool, contactId: 'contact' }; }, executeAgentTool: mocks.execute, refreshAgentSendResult: mocks.refresh };
});
import { agentApiRoutes, agentSettingsRoutes } from '../../src/modules/agents/agent-routes.js';
import { authMiddleware } from '../../src/modules/auth/auth-middleware.js';
import { createAgentToken } from '../../src/modules/agents/agent-policy.js';
import { createInternalAgentIdentity } from '../../src/shared/internal-agent-identity.js';
const key = createAgentToken();
const requestId = '96b2beb7-d95a-49bf-a852-9656589871dc';
let app: ReturnType<typeof Fastify>;
let ownerToken: string;
beforeEach(async () => {
  vi.clearAllMocks(); mocks.authCount = 0; mocks.revokeDuring = false;
  const config = { id: key.id, tokenHash: key.tokenHash, name: 'Hermes', userId: 'user', accountIds: ['nick'], enabled: true, revokedAt: null, permissions: ['work_read'], expiresAt: '2026-11-12T00:00:00Z', maxSendsPerDay: 10, maxWritesPerDay: 100 };
  mocks.actor = { orgId: 'org', user: { id: 'user', orgId: 'org', role: 'owner', email: '' }, config }; mocks.stored = config;
  mocks.execute.mockResolvedValue({ statusCode: 200, data: { items: [] } }); mocks.reserve.mockResolvedValue({ key: 'operation', fingerprint: 'hash', cached: null });
  mocks.refresh.mockImplementation(async (_actor, _args, cached) => cached);
  app = Fastify(); await app.register(jwt, { secret: 'test-secret-at-least-thirty-two-bytes' });
  await app.register(agentApiRoutes); await app.register(agentSettingsRoutes);
  app.get('/protected', { preHandler: authMiddleware }, async (req) => ({ id: req.user.id }));
  ownerToken = app.jwt.sign({ id: 'user', email: '', role: 'owner', orgId: 'org', tv: 0 });
});
afterEach(async () => { await app.close(); });
const agentHeaders = () => ({ authorization: 'Bearer ' + key.token });
describe('machine and settings APIs', () => {
  it('does not require a UI session, but refuses anonymous requests and ordinary UI JWTs', async () => {
    expect((await app.inject('/api/agent/v1/tools')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/agent/v1/tools', headers: { authorization: 'Bearer ' + ownerToken } })).statusCode).toBe(401);
    const reply = await app.inject({ url: '/api/agent/v1/tools', headers: agentHeaders() });
    expect(reply.statusCode).toBe(200); expect(reply.json().tools.map((t: any) => t.name)).toEqual(['list_assignees', 'list_work']);
    expect(reply.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ url: '/protected', headers: agentHeaders() })).statusCode).toBe(401);
  });
  it('rejects disabled tool calls before executing CRM operations', async () => {
    const result = await app.inject({ method: 'POST', url: '/api/agent/v1/tools/send_message', headers: agentHeaders(), payload: { conversationId: 'conv', content: 'hello', requestId } });
    expect(result.statusCode).toBe(403); expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it('validates requestIds and limits, does not offer an arbitrary-route proxy', async () => {
    for (const payload of [{ conversationId: 'conv', content: 'hello' }, { conversationId: 'conv', content: 'hello', requestId: 'bad' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/agent/v1/tools/send_message', headers: agentHeaders(), payload })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'POST', url: '/api/agent/v1/tools/delete_database', headers: agentHeaders(), payload: {} })).statusCode).toBe(404);
  });
  it('checks revocation once more after quota reservation', async () => {
    mocks.actor.config.permissions = ['message_send']; mocks.revokeDuring = true;
    expect((await app.inject({ method: 'POST', url: '/api/agent/v1/tools/send_message', headers: agentHeaders(), payload: { conversationId: 'conv', content: 'hello', requestId } })).statusCode).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('returns cached operation without executing a duplicate', async () => {
    mocks.actor.config.permissions = ['message_send']; mocks.reserve.mockResolvedValue({ cached: { statusCode: 200, data: { id: 'sent-once' } } });
    const result = await app.inject({ method: 'POST', url: '/api/agent/v1/tools/send_message', headers: agentHeaders(), payload: { conversationId: 'conv', content: 'hello', requestId } });
    expect(result.json()).toEqual({ id: 'sent-once' }); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('rechecks revocation before returning a cached result', async () => {
    mocks.actor.config.permissions = ['message_send']; mocks.revokeDuring = true;
    mocks.reserve.mockResolvedValue({ cached: { statusCode: 202, data: { deliveryState: 'uncertain' } } });
    const result = await app.inject({ method: 'POST', url: '/api/agent/v1/tools/send_message', headers: agentHeaders(), payload: { conversationId: 'conv', content: 'hello', requestId } });
    expect(result.statusCode).toBe(401); expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('returns the latest delivery receipt rather than the cached pending response', async () => {
    mocks.actor.config.permissions = ['message_send'];
    mocks.reserve.mockResolvedValue({ cached: { statusCode: 202, data: { deliveryState: 'uncertain' } } });
    mocks.refresh.mockResolvedValue({ statusCode: 200, data: { id: 'message', deliveryState: 'completed', pendingConfirmation: false } });
    const result = await app.inject({ method: 'POST', url: '/api/agent/v1/tools/send_message', headers: agentHeaders(), payload: { conversationId: 'conv', content: 'hello', requestId } });
    expect(result.statusCode).toBe(200); expect(result.json().deliveryState).toBe('completed');
    expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
  });
  it('hides token hashes in settings and forbids non-admin management', async () => {
    const response = await app.inject({ url: '/api/v1/settings/agents', headers: { authorization: 'Bearer ' + ownerToken } });
    expect(response.statusCode).toBe(200); expect(response.body).not.toContain(key.tokenHash);
    const memberToken = app.jwt.sign({ id: 'user', email: '', role: 'member', orgId: 'org' });
    expect((await app.inject({ url: '/api/v1/settings/agents', headers: { authorization: 'Bearer ' + memberToken } })).statusCode).toBe(403);
  });
  it('requires explicit confirmation before enabling sensitive permissions', async () => {
    const { id: _id, tokenHash: _hash, revokedAt: _revoked, ...payload } = { ...mocks.stored, permissions: ['message_send'] };
    expect((await app.inject({ method: 'PUT', url: '/api/v1/settings/agents/' + key.id, headers: { authorization: 'Bearer ' + ownerToken }, payload })).statusCode).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'PUT', url: '/api/v1/settings/agents/' + key.id, headers: { authorization: 'Bearer ' + ownerToken }, payload: { ...payload, confirmSensitive: true } })).statusCode).toBe(200);
  });
  it('allows emergency-off even when the old scope/expiry is no longer valid', async () => {
    const { id: _id, tokenHash: _hash, revokedAt: _revoked, ...payload } = { ...mocks.stored, enabled: false, expiresAt: '2000-01-01T00:00:00Z' };
    expect((await app.inject({ method: 'PUT', url: '/api/v1/settings/agents/' + key.id, headers: { authorization: 'Bearer ' + ownerToken }, payload })).statusCode).toBe(200);
  });
  it('accepts internal one-use identities but not a forged network header', async () => {
    const cap = createInternalAgentIdentity({ ...mocks.actor.user, email: '' }, 'GET', '/protected');
    expect((await app.inject({ url: '/protected', headers: { 'x-crm-internal-agent': cap.key } })).json()).toEqual({ id: 'user' });
    expect((await app.inject({ url: '/protected', headers: { 'x-crm-internal-agent': cap.key } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/protected', headers: { 'x-crm-internal-agent': 'forged' } })).statusCode).toBe(401);
  });
});
