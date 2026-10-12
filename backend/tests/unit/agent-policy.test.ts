import { describe, expect, it } from 'vitest';
import { AGENT_PERMISSIONS, AGENT_TOOLS, checkAgentToken, createAgentToken, publicAgentConfig, tokenId, type AgentConfig } from '../../src/modules/agents/agent-policy.js';
import { createInternalAgentIdentity, consumeInternalAgentIdentity } from '../../src/shared/internal-agent-identity.js';

describe('agent credentials and capabilities', () => {
  const key = createAgentToken();
  const config: AgentConfig = { id: key.id, tokenHash: key.tokenHash, name: 'Hermes', userId: 'user', accountIds: ['nick'], enabled: true, revokedAt: null, permissions: ['work_read'], expiresAt: '2099-01-01T00:00:00Z', maxSendsPerDay: 1, maxWritesPerDay: 10 };
  it('issues random independent credentials and exposes only hash at rest', () => {
    expect(createAgentToken().token).not.toBe(key.token);
    expect(tokenId(key.token)).toBe(key.id);
    expect(tokenId('zcrm_bad')).toBeNull();
    expect(checkAgentToken(config, key.token)).toBeUndefined();
    expect(publicAgentConfig(config)).not.toHaveProperty('tokenHash');
  });
  it.each([{ enabled: false }, { revokedAt: '2026-10-12T00:00:00Z' }, { expiresAt: '2000-01-01' }, { expiresAt: 'bad' }, { tokenHash: '' }])('rejects invalid credentials/config %j', (change) => {
    expect(() => checkAgentToken({ ...config, ...change }, key.token)).toThrow('AGENT_UNAUTHORIZED');
  });
  it('revokes the old token when rotated', () => {
    const next = createAgentToken(config.id);
    expect(() => checkAgentToken({ ...config, tokenHash: next.tokenHash }, key.token)).toThrow();
    expect(checkAgentToken({ ...config, tokenHash: next.tokenHash }, next.token)).toBeUndefined();
  });
  it('all tools have explicit permission/grant and mutations require idempotency', () => {
    for (const tool of AGENT_TOOLS) {
      expect(AGENT_PERMISSIONS).toContain(tool.permission);
      expect(tool.grant).toHaveLength(2);
      expect(tool.inputSchema.additionalProperties).toBe(false);
      if (tool.write) expect(tool.inputSchema.required).toContain('requestId');
    }
  });
  it('internal identity is one-use and bound to the exact HTTP operation', () => {
    const user = { id: 'user', orgId: 'org', role: 'member', email: '' };
    const entry = createInternalAgentIdentity(user, 'POST', '/api/v1/conversations/conv/messages');
    expect(consumeInternalAgentIdentity(entry.key, 'POST', '/api/v1/conversations/conv/messages')).toEqual(user);
    expect(consumeInternalAgentIdentity(entry.key, 'POST', '/api/v1/conversations/conv/messages')).toBeNull();
    const wrong = createInternalAgentIdentity(user, 'POST', '/allowed');
    expect(consumeInternalAgentIdentity(wrong.key, 'POST', '/api/v1/settings')).toBeNull();
    expect(consumeInternalAgentIdentity(wrong.key, 'POST', '/allowed')).toBeNull();
    const disposed = createInternalAgentIdentity(user, 'GET', '/allowed'); disposed.dispose();
    expect(consumeInternalAgentIdentity(disposed.key, 'GET', '/allowed')).toBeNull();
  });
});
