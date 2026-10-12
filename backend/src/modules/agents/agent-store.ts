import { prisma, tenantTransaction } from '../../shared/database/prisma-client.js';
import { runSystemQuery, withTenant } from '../../shared/tenant/tenant-context.js';
import { encrypt, decrypt } from '../../shared/crypto/aes-gcm.js';
import { config as appConfig } from '../../config/index.js';
import { AgentError, checkAgentToken, tokenId, hashToken, type AgentConfig } from './agent-policy.js';

export const agentSettingKey = (id: string) => `agent_connection:${id}`;
const encryptionKey = () => hashToken(appConfig.encryptionKey);
export async function authenticateAgent(token: string) {
  const id = tokenId(token);
  if (!id) throw new AgentError(401, 'AGENT_UNAUTHORIZED');
  // Only credential lookup crosses tenants; business queries use its organization.
  const row = await runSystemQuery(() => prisma.appSetting.findUnique({ where: { id } }));
  if (!row?.valuePlain || row.settingKey !== agentSettingKey(id)) throw new AgentError(401, 'AGENT_UNAUTHORIZED');
  const config = JSON.parse(row.valuePlain) as AgentConfig;
  if (config.id !== id) throw new AgentError(401, 'AGENT_UNAUTHORIZED');
  checkAgentToken(config, token);
  const user = await withTenant(row.orgId, () => prisma.user.findFirst({
    where: { id: config.userId, orgId: row.orgId, isActive: true },
    select: { id: true, role: true, orgId: true, email: true, jwtTokenVersion: true },
  }));
  if (!user) throw new AgentError(401, 'AGENT_USER_INACTIVE');
  return { config, user, orgId: row.orgId };
}
export type AgentActor = Awaited<ReturnType<typeof authenticateAgent>>;
export async function saveAgent(orgId: string, config: AgentConfig, actorUserId: string, previous?: AgentConfig) {
  await tenantTransaction(async (tx) => {
    if (previous) {
      const current = await tx.appSetting.findUnique({ where: { orgId_settingKey: { orgId, settingKey: agentSettingKey(config.id) } } });
      if (current?.valuePlain !== JSON.stringify(previous)) throw new AgentError(409, 'AGENT_SETTINGS_CHANGED');
    }
    await tx.appSetting.upsert({ where: { orgId_settingKey: { orgId, settingKey: agentSettingKey(config.id) } },
      create: { id: config.id, orgId, settingKey: agentSettingKey(config.id), valuePlain: JSON.stringify(config) },
      update: { valuePlain: JSON.stringify(config) } });
    await tx.aiAuditLog.create({ data: { orgId, actorUserId, eventType: 'agent.settings', outcome: 'success', targetType: 'agent', targetId: config.id,
      metadata: { enabled: config.enabled, revoked: !!config.revokedAt, permissions: config.permissions, accountIds: config.accountIds, userId: config.userId } } });
  }, { isolationLevel: 'Serializable' });
}
type CachedOperation = { state: 'running' | 'done'; fingerprint: string; scopeFingerprint?: string; statusCode?: number; encryptedResult?: string };
export async function reserveAgentOperation(actor: AgentActor, tool: string, args: Record<string, unknown>, scopeFingerprint?: string) {
  const { config, orgId } = actor;
  const key = `agent_operation:${config.id}:${args.requestId}`;
  const fingerprint = hashToken(JSON.stringify({ tool, args: Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b))) }));
  for (let attempt = 0; ; attempt++) {
    try {
      return await tenantTransaction(async (tx) => {
        const current = await tx.appSetting.findUnique({ where: { orgId_settingKey: { orgId, settingKey: agentSettingKey(config.id) } } });
        if (current?.valuePlain !== JSON.stringify(config)) throw new AgentError(409, 'AGENT_SETTINGS_CHANGED');
        const existing = await tx.appSetting.findUnique({ where: { orgId_settingKey: { orgId, settingKey: key } } });
        if (existing?.valuePlain) {
          const operation = JSON.parse(existing.valuePlain) as CachedOperation;
          if (operation.fingerprint !== fingerprint) throw new AgentError(409, 'AGENT_REQUEST_ID_REUSED');
          if (scopeFingerprint && operation.scopeFingerprint !== scopeFingerprint) throw new AgentError(409, 'AGENT_OPERATION_SCOPE_CHANGED');
          if (operation.state !== 'done') throw new AgentError(409, 'AGENT_OPERATION_PENDING_OR_UNCERTAIN');
          return { key, fingerprint, scopeFingerprint, cached: { statusCode: operation.statusCode!, data: JSON.parse(decrypt(operation.encryptedResult!, encryptionKey())) } };
        }
        const counterKey = `agent_quota:${config.id}:${new Date().toISOString().slice(0, 10)}`;
        const counterRow = await tx.appSetting.findUnique({ where: { orgId_settingKey: { orgId, settingKey: counterKey } } });
        const counter = JSON.parse(counterRow?.valuePlain ?? '{"writes":0,"sends":0}') as { writes: number; sends: number };
        if (counter.writes >= config.maxWritesPerDay || (tool === 'send_message' && counter.sends >= config.maxSendsPerDay)) throw new AgentError(429, 'AGENT_DAILY_LIMIT');
        counter.writes++;
        if (tool === 'send_message') counter.sends++;
        const valuePlain = JSON.stringify(counter);
        await tx.appSetting.upsert({ where: { orgId_settingKey: { orgId, settingKey: counterKey } }, create: { orgId, settingKey: counterKey, valuePlain }, update: { valuePlain } });
        await tx.appSetting.create({ data: { orgId, settingKey: key, valuePlain: JSON.stringify({ state: 'running', fingerprint, scopeFingerprint }) } });
        await tx.aiAuditLog.create({ data: { orgId, actorUserId: actor.user.id, eventType: 'agent.operation', outcome: 'started', targetType: 'agent', targetId: config.id, metadata: { tool, requestId: String(args.requestId) } } });
        return { key, fingerprint, scopeFingerprint, cached: null };
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (attempt < 2 && ['P2034', 'P2002'].includes((error as { code?: string }).code ?? '')) continue;
      throw error;
    }
  }
}
export async function finishAgentOperation(actor: AgentActor, operation: { key: string; fingerprint: string; scopeFingerprint?: string }, result: { statusCode: number; data: unknown }) {
  const encryptedResult = encrypt(JSON.stringify(result.data), encryptionKey());
  await tenantTransaction(async (tx) => {
    await tx.appSetting.update({ where: { orgId_settingKey: { orgId: actor.orgId, settingKey: operation.key } },
      data: { valuePlain: JSON.stringify({ state: 'done', fingerprint: operation.fingerprint, scopeFingerprint: operation.scopeFingerprint, statusCode: result.statusCode, encryptedResult }) } });
    await tx.aiAuditLog.create({ data: { orgId: actor.orgId, actorUserId: actor.user.id, eventType: 'agent.operation', outcome: result.statusCode < 400 ? 'success' : 'failed', targetType: 'agent', targetId: actor.config.id, metadata: { statusCode: result.statusCode } } });
  });
}
