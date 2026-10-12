import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ generate: vi.fn(), updateWork: vi.fn(), work: vi.fn() }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: { conversationWorkItem: { findFirst: mocks.work } } }));
vi.mock('../../src/modules/privacy/redact.js', () => ({
  buildPrivacyContext: async () => ({ privacyUnlocked: false }), canSeeConversationContent: () => true, isConversationPrivateFor: () => false,
}));
vi.mock('../../src/modules/ai/core/ai-error-handler.js', () => ({ AIErrorHandler: { normalize: () => ({ statusCode: 500, message: 'error' }) } }));
vi.mock('../../src/modules/ai/reply-generator-service.js', () => ({
  generateConversationReply: mocks.generate, ContextBuilderError: class extends Error {}, ReplyGeneratorError: class extends Error {}, SkillFrameworkError: class extends Error {},
}));
vi.mock('../../src/modules/rbac/owner-scope.js', () => ({ getOwnerScope: async () => ({ canViewAll: false, visibleUserIds: ['user'] }) }));
vi.mock('../../src/modules/dashboard/conversation-work-item-service.js', () => ({ updateConversationWorkItem: mocks.updateWork }));

import { createInternalAgentIdentity } from '../../src/shared/internal-agent-identity.js';
import { authMiddleware } from '../../src/modules/auth/auth-middleware.js';
import { replyGeneratorRoutes } from '../../src/modules/ai/reply-generator-routes.js';
import { conversationWorkItemRoutes } from '../../src/modules/dashboard/conversation-work-item-routes.js';

let app: ReturnType<typeof Fastify>;
const user = { id: 'user', orgId: 'org', role: 'member', email: '' };
beforeEach(async () => {
  vi.clearAllMocks(); mocks.generate.mockResolvedValue({ reply_text: 'Draft' }); mocks.updateWork.mockResolvedValue({ id: 'work' });
  mocks.work.mockResolvedValue({ id: 'work', assigneeUserId: 'user', conversation: null });
  app = Fastify(); await app.register(jwt, { secret: 'scope-test-secret-at-least-thirty-two-bytes' });
  await app.register(async child => { child.addHook('preHandler', authMiddleware); await replyGeneratorRoutes(child); });
  await app.register(conversationWorkItemRoutes);
});
afterEach(async () => { await app.close(); });

describe('trusted internal Agent scope', () => {
  it('carries the scope through the real draft route and cannot broaden it from the request body', async () => {
    const url = '/api/v1/ai/replies/conversations/conv/generate';
    const capability = createInternalAgentIdentity({ ...user, agentScope: { allowedAccountIds: ['nick'] } }, 'POST', url);
    const result = await app.inject({ method: 'POST', url, headers: { 'x-crm-internal-agent': capability.key }, payload: { allowedAccountIds: ['evil'], agentScope: { allowedAccountIds: ['evil'] } } });
    expect(result.statusCode).toBe(200);
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ userId: 'user', orgId: 'org', allowedAccountIds: ['nick'] });
    expect((await app.inject({ method: 'POST', url, headers: { 'x-crm-internal-agent': capability.key }, payload: {} })).statusCode).toBe(401);
  });
  it('does not trust scope fields in ordinary JWTs, arbitrary headers or UI payloads', async () => {
    const token = app.jwt.sign({ ...user, typ: 'access', agentScope: { allowedAccountIds: ['evil'] } });
    const result = await app.inject({ method: 'POST', url: '/api/v1/ai/replies/conversations/conv/generate', headers: { authorization: `Bearer ${token}`, 'x-crm-agent-scope': '["evil"]' }, payload: { allowedAccountIds: ['evil'] } });
    expect(result.statusCode).toBe(200);
    expect(mocks.generate.mock.calls[0][0].allowedAccountIds).toBeUndefined();
  });
  it('forwards the permitted sender scope to the actual work completion service', async () => {
    const url = '/api/v1/work-items/work';
    const capability = createInternalAgentIdentity({ ...user, agentScope: { allowedAccountIds: ['nick'] } }, 'PATCH', url);
    expect((await app.inject({ method: 'PATCH', url, headers: { 'x-crm-internal-agent': capability.key }, payload: { action: 'complete', allowedFollowupAccountIds: ['evil'] } })).statusCode).toBe(200);
    expect(mocks.updateWork).toHaveBeenCalledWith(expect.objectContaining({ allowedFollowupAccountIds: ['nick'], actor: { actorId: 'user' } }));
  });
});
