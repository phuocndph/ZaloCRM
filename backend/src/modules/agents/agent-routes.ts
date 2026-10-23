import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { withTenant } from '../../shared/tenant/tenant-context.js';
import { authMiddleware, requireActiveUser } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { AgentError, AGENT_PERMISSIONS, AGENT_TOOLS, createAgentToken, publicAgentConfig, type AgentConfig } from './agent-policy.js';
import { agentSettingKey, authenticateAgent, saveAgent, reserveAgentOperation, finishAgentOperation } from './agent-store.js';
import { agentDraftScopeFingerprint, availableAgentTools, prepareAgentTool, executeAgentTool, refreshAgentSendResult } from './agent-tools.js';

function fail(reply: FastifyReply, error: unknown) {
  const expected = error instanceof AgentError;
  return reply.status(expected ? error.statusCode : 500).send({ error: expected ? error.code : 'AGENT_INTERNAL_ERROR' });
}
async function managementGate(request: FastifyRequest, reply: FastifyReply) {
  if (!['owner', 'admin'].includes(request.user.role)) return reply.status(403).send({ error: 'AGENT_ADMIN_REQUIRED' });
  const current = await prisma.user.findFirst({ where: { id: request.user.id, orgId: request.user.orgId, isActive: true }, select: { role: true } });
  if (!current || !['owner', 'admin'].includes(current.role)) return reply.status(403).send({ error: 'AGENT_ADMIN_REQUIRED' });
}
const properties = {
  name: { type: 'string', minLength: 1, maxLength: 80 }, userId: { type: 'string', minLength: 1, maxLength: 80 },
  enabled: { type: 'boolean' }, expiresAt: { type: 'string', format: 'date-time' },
  accountIds: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 80 } },
  permissions: { type: 'array', uniqueItems: true, items: { type: 'string', enum: [...AGENT_PERMISSIONS] } },
  maxWritesPerDay: { type: 'integer', minimum: 1, maximum: 1000 }, maxSendsPerDay: { type: 'integer', minimum: 0, maximum: 200 },
  confirmSensitive: { type: 'boolean' },
};
const settingsSchema = { type: 'object', additionalProperties: false, properties, required: ['name', 'userId', 'accountIds', 'permissions', 'expiresAt', 'maxWritesPerDay', 'maxSendsPerDay', 'enabled'] };
async function validateSettings(orgId: string, value: AgentConfig, confirmSensitive: boolean, previous?: AgentConfig) {
  if (!value.name) throw new AgentError(400, 'AGENT_NAME_REQUIRED');
  // Emergency off must still work if an employee/nick was archived or expiry passed.
  if (!value.enabled) return;
  const user = await prisma.user.findFirst({ where: { id: value.userId, orgId, isActive: true }, select: { id: true } });
  if (!user) throw new AgentError(400, 'AGENT_USER_INVALID');
  const accounts = await prisma.zaloAccount.count({ where: { orgId, id: { in: value.accountIds }, archivedAt: null, privacyMode: 'sub' } });
  if (accounts !== value.accountIds.length) throw new AgentError(400, 'AGENT_ACCOUNTS_INVALID');
  if (value.enabled && !value.accountIds.length) throw new AgentError(400, 'AGENT_ACCOUNTS_REQUIRED');
  const expiry = Date.parse(value.expiresAt);
  if (expiry <= Date.now() || expiry > Date.now() + 366 * 86400000) throw new AgentError(400, 'AGENT_EXPIRY_INVALID');
  const sensitive = value.permissions.some((p) => ['message_send', 'appointment_write', 'work_update', 'research_execute'].includes(p));
  const escalated = !previous || !previous.enabled || value.userId !== previous.userId
    || value.accountIds.some((id) => !previous.accountIds.includes(id))
    || value.permissions.some((p) => !previous.permissions.includes(p))
    || value.maxSendsPerDay > previous.maxSendsPerDay || value.maxWritesPerDay > previous.maxWritesPerDay;
  if (value.enabled && sensitive && escalated && !confirmSensitive) throw new AgentError(400, 'AGENT_SENSITIVE_CONFIRMATION_REQUIRED');
}
export async function agentSettingsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', requireActiveUser);
  app.addHook('preHandler', requireGrant('webhook', 'edit'));
  app.addHook('preHandler', managementGate);
  app.get('/api/v1/settings/agents', async (request, reply) => {
    try {
      const orgId = request.user.orgId;
      const [rows, users, accounts, audit] = await Promise.all([
        prisma.appSetting.findMany({ where: { orgId, settingKey: { startsWith: 'agent_connection:' } }, orderBy: { createdAt: 'desc' } }),
        prisma.user.findMany({ where: { orgId, isActive: true }, select: { id: true, fullName: true } }),
        prisma.zaloAccount.findMany({ where: { orgId, archivedAt: null, privacyMode: 'sub' }, select: { id: true, displayName: true, status: true } }),
        prisma.aiAuditLog.findMany({ where: { orgId, targetType: 'agent' }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, targetId: true, eventType: true, outcome: true, createdAt: true, metadata: true } }),
      ]);
      return { agents: rows.map((row) => publicAgentConfig(JSON.parse(row.valuePlain!) as AgentConfig)), users, accounts, audit };
    } catch (error) { return fail(reply, error); }
  });
  app.post('/api/v1/settings/agents', { schema: { body: settingsSchema } }, async (request, reply) => {
    try {
      const body = request.body as AgentConfig & { confirmSensitive?: boolean };
      const { id, token, tokenHash } = createAgentToken();
      const value: AgentConfig = { id, tokenHash, revokedAt: null, name: body.name.trim(), userId: body.userId,
        accountIds: body.accountIds, permissions: body.permissions, enabled: body.enabled, expiresAt: body.expiresAt,
        maxWritesPerDay: body.maxWritesPerDay, maxSendsPerDay: body.maxSendsPerDay };
      await validateSettings(request.user.orgId, value, body.confirmSensitive === true);
      await saveAgent(request.user.orgId, value, request.user.id);
      return reply.status(201).send({ agent: publicAgentConfig(value), token });
    } catch (error) { return fail(reply, error); }
  });
  async function load(orgId: string, id: string) {
    const row = await prisma.appSetting.findUnique({ where: { orgId_settingKey: { orgId, settingKey: agentSettingKey(id) } } });
    if (!row?.valuePlain) throw new AgentError(404, 'AGENT_NOT_FOUND');
    return JSON.parse(row.valuePlain) as AgentConfig;
  }
  app.put('/api/v1/settings/agents/:id', { schema: { body: settingsSchema } }, async (request, reply) => {
    try {
      const previous = await load(request.user.orgId, (request.params as { id: string }).id);
      if (previous.revokedAt) throw new AgentError(409, 'AGENT_REVOKED');
      const body = request.body as AgentConfig & { confirmSensitive?: boolean };
      const value: AgentConfig = { ...previous, name: body.name.trim(), userId: body.userId, accountIds: body.accountIds,
        permissions: body.permissions, enabled: body.enabled, expiresAt: body.expiresAt, maxWritesPerDay: body.maxWritesPerDay, maxSendsPerDay: body.maxSendsPerDay };
      await validateSettings(request.user.orgId, value, body.confirmSensitive === true, previous);
      await saveAgent(request.user.orgId, value, request.user.id, previous);
      return { agent: publicAgentConfig(value) };
    } catch (error) { return fail(reply, error); }
  });
  app.post('/api/v1/settings/agents/:id/rotate', async (request, reply) => {
    try {
      const value = await load(request.user.orgId, (request.params as { id: string }).id);
      if (value.revokedAt) throw new AgentError(409, 'AGENT_REVOKED');
      const previous = { ...value };
      const { token, tokenHash } = createAgentToken(value.id);
      value.tokenHash = tokenHash;
      await saveAgent(request.user.orgId, value, request.user.id, previous);
      return { token, agent: publicAgentConfig(value) };
    } catch (error) { return fail(reply, error); }
  });
  app.post('/api/v1/settings/agents/:id/revoke', async (request, reply) => {
    try {
      const value = await load(request.user.orgId, (request.params as { id: string }).id);
      const previous = { ...value };
      value.enabled = false;
      value.revokedAt = new Date().toISOString();
      await saveAgent(request.user.orgId, value, request.user.id, previous);
      return { agent: publicAgentConfig(value) };
    } catch (error) { return fail(reply, error); }
  });
}
function bearer(request: FastifyRequest) {
  const token = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '')?.[1];
  if (!token) throw new AgentError(401, 'AGENT_UNAUTHORIZED');
  return token;
}
export async function agentApiRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
  const rateLimit = { max: 120, timeWindow: '1 minute' };
  app.get('/api/agent/v1/tools', { config: { rateLimit } }, async (request, reply) => {
    try {
      const actor = await authenticateAgent(bearer(request));
      return await withTenant(actor.orgId, async () => ({ tools: (await availableAgentTools(actor)).map(({ name, description, inputSchema, write }) => ({ name, description, inputSchema, annotations: { readOnlyHint: !write, destructiveHint: !!write } })) }), { userId: actor.user.id, role: actor.user.role });
    } catch (error) { return fail(reply, error); }
  });
  for (const tool of AGENT_TOOLS) app.post(`/api/agent/v1/tools/${tool.name}`, { config: { rateLimit }, schema: { body: tool.inputSchema } }, async (request, reply) => {
    try {
      const token = bearer(request);
      const actor = await authenticateAgent(token);
      const args = request.body as Record<string, unknown>;
      return await withTenant(actor.orgId, async () => {
        try {
          const prepared = await prepareAgentTool(actor, tool.name, args);
          const scopeFingerprint = tool.name === 'generate_reply_draft' ? await agentDraftScopeFingerprint(actor) : undefined;
          const operation = tool.write ? await reserveAgentOperation(actor, tool.name, args, scopeFingerprint) : null;
          // Recheck after queue/quota work: toggles, revoked keys and scope changes are effective now.
          const current = await authenticateAgent(token);
          const latest = await prepareAgentTool(current, tool.name, args);
          if (scopeFingerprint && await agentDraftScopeFingerprint(current) !== scopeFingerprint) throw new AgentError(409, 'AGENT_OPERATION_SCOPE_CHANGED');
          if (operation?.cached) {
            const result = tool.name === 'send_message' ? await refreshAgentSendResult(current, args, operation.cached) : operation.cached;
            return reply.status(result.statusCode).send(result.data);
          }
          const result = await executeAgentTool(app, current, tool.name, args, latest.contactId ?? prepared.contactId);
          if (operation) await finishAgentOperation(current, operation, result);
          else await prisma.aiAuditLog.create({ data: { orgId: actor.orgId, actorUserId: actor.user.id, eventType: 'agent.read', outcome: 'success', targetType: 'agent', targetId: actor.config.id, metadata: { tool: tool.name } } });
          return reply.status(result.statusCode).send(result.data);
        } catch (error) {
          await prisma.aiAuditLog.create({ data: { orgId: actor.orgId, actorUserId: actor.user.id, eventType: 'agent.denied', outcome: 'failed', targetType: 'agent', targetId: actor.config.id,
            metadata: { tool: tool.name, code: error instanceof AgentError ? error.code : 'AGENT_INTERNAL_ERROR' } } });
          throw error;
        }
      }, { userId: actor.user.id, role: actor.user.role });
    } catch (error) { return fail(reply, error); }
  });
}
