import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ settings: new Map<string, any>(), audit: vi.fn(), user: vi.fn(), transaction: vi.fn() }));
vi.mock('../../src/config/index.js', () => ({ config: { encryptionKey: 'test-encryption-key' } }));
vi.mock('../../src/shared/tenant/tenant-context.js', () => ({ runSystemQuery: (fn: any) => fn(), withTenant: (_org: string, fn: any) => fn() }));
vi.mock('../../src/shared/database/prisma-client.js', () => {
  const settings = {
    findFirst: vi.fn(async ({ where }: any) => mocks.settings.get(where.settingKey)),
    findUnique: vi.fn(async ({ where }: any) => where.id ? mocks.settings.get('agent_connection:' + where.id) : mocks.settings.get(where.orgId_settingKey.settingKey)),
    create: vi.fn(async ({ data }: any) => { mocks.settings.set(data.settingKey, data); return data; }),
    upsert: vi.fn(async ({ where, create, update }: any) => { const key = where.orgId_settingKey.settingKey; const value = mocks.settings.has(key) ? { ...mocks.settings.get(key), ...update } : create; mocks.settings.set(key, value); return value; }),
    update: vi.fn(async ({ where, data }: any) => { const key = where.orgId_settingKey.settingKey; mocks.settings.set(key, { ...mocks.settings.get(key), ...data }); }),
  };
  const prisma = { appSetting: settings, user: { findFirst: mocks.user }, aiAuditLog: { create: mocks.audit } };
  return { prisma, tenantTransaction: (fn: any, options: any) => { mocks.transaction(options); return fn(prisma); } };
});
import { authenticateAgent, agentSettingKey, reserveAgentOperation, finishAgentOperation, saveAgent } from '../../src/modules/agents/agent-store.js';
import { createAgentToken, type AgentConfig } from '../../src/modules/agents/agent-policy.js';
const key = createAgentToken();
let actor: any;
const args = { requestId: 'request', conversationId: 'conv', content: 'private text' };
beforeEach(() => {
  vi.clearAllMocks(); mocks.settings.clear();
  const config: AgentConfig = { id: key.id, tokenHash: key.tokenHash, name: 'Hermes', userId: 'user', accountIds: ['nick'], enabled: true, revokedAt: null, permissions: ['message_send'], expiresAt: '2099-01-01T00:00:00Z', maxSendsPerDay: 1, maxWritesPerDay: 3 };
  actor = { orgId: 'org', user: { id: 'user', role: 'member', orgId: 'org' }, config };
  mocks.settings.set(agentSettingKey(key.id), { orgId: 'org', settingKey: agentSettingKey(key.id), valuePlain: JSON.stringify(config) });
  mocks.user.mockResolvedValue(actor.user);
});
describe('agent storage and replay protection', () => {
  it('authenticates active backing users, and rejects their lock immediately', async () => {
    expect((await authenticateAgent(key.token)).orgId).toBe('org');
    mocks.user.mockResolvedValue(null); await expect(authenticateAgent(key.token)).rejects.toThrow('AGENT_USER_INACTIVE');
  });
  it('reserves quota atomically, blocks concurrent retries and caches encrypted result', async () => {
    const op = await reserveAgentOperation(actor, 'send_message', args);
    expect(mocks.transaction).toHaveBeenCalledWith({ isolationLevel: 'Serializable' });
    await expect(reserveAgentOperation(actor, 'send_message', args)).rejects.toThrow('AGENT_OPERATION_PENDING_OR_UNCERTAIN');
    await finishAgentOperation(actor, op, { statusCode: 200, data: { content: 'private result' } });
    expect(JSON.stringify([...mocks.settings.values()])).not.toContain('private result');
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain('private text');
    const retry = await reserveAgentOperation(actor, 'send_message', args);
    expect(retry.cached).toEqual({ statusCode: 200, data: { content: 'private result' } });
    await expect(reserveAgentOperation(actor, 'send_message', { ...args, requestId: 'other' })).rejects.toThrow('AGENT_DAILY_LIMIT');
  });
  it('canonicalizes argument order but refuses reuse for different message content', async () => {
    const op = await reserveAgentOperation(actor, 'send_message', args);
    await finishAgentOperation(actor, op, { statusCode: 200, data: {} });
    expect((await reserveAgentOperation(actor, 'send_message', { content: args.content, conversationId: args.conversationId, requestId: args.requestId })).cached).not.toBeNull();
    await expect(reserveAgentOperation(actor, 'send_message', { ...args, content: 'changed' })).rejects.toThrow('AGENT_REQUEST_ID_REUSED');
  });
  it('uses an independent write budget for non-message mutations', async () => {
    actor.config.maxWritesPerDay = 1;
    mocks.settings.get(agentSettingKey(key.id)).valuePlain = JSON.stringify(actor.config);
    await reserveAgentOperation(actor, 'add_note', args);
    await expect(reserveAgentOperation(actor, 'add_note', { ...args, requestId: 'other' })).rejects.toThrow('AGENT_DAILY_LIMIT');
  });
  it('never replays an AI draft after the trusted source scope changes', async () => {
    const operation = await reserveAgentOperation(actor, 'generate_reply_draft', args, 'old-scope');
    await finishAgentOperation(actor, operation, { statusCode: 200, data: { reply_text: 'private derived content' } });
    expect((await reserveAgentOperation(actor, 'generate_reply_draft', args, 'old-scope')).cached).not.toBeNull();
    await expect(reserveAgentOperation(actor, 'generate_reply_draft', args, 'new-scope')).rejects.toThrow('AGENT_OPERATION_SCOPE_CHANGED');
  });
  it('does not replay a legacy draft cached before source-scope enforcement', async () => {
    const operation = await reserveAgentOperation(actor, 'generate_reply_draft', args);
    await finishAgentOperation(actor, operation, { statusCode: 200, data: { reply_text: 'unscoped draft' } });
    await expect(reserveAgentOperation(actor, 'generate_reply_draft', args, 'current-scope')).rejects.toThrow('AGENT_OPERATION_SCOPE_CHANGED');
  });
  it('refuses stale quota/config snapshots and does not undo revocation via old edits', async () => {
    mocks.settings.get(agentSettingKey(key.id)).valuePlain = JSON.stringify({ ...actor.config, enabled: false });
    await expect(reserveAgentOperation(actor, 'send_message', args)).rejects.toThrow('AGENT_SETTINGS_CHANGED');
    await expect(saveAgent('org', { ...actor.config, name: 'changed' }, 'admin', actor.config)).rejects.toThrow('AGENT_SETTINGS_CHANGED');
  });
});
