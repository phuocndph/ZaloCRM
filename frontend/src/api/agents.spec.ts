// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
import { AGENT_PERMISSION_OPTIONS, newAgentForm, needsAgentConfirmation } from './agents';
import type { AgentConnection } from './agents';
describe('agent settings defaults and permission escalation', () => {
  it('starts disconnected with no nick and no operation granted', () => {
    const value = newAgentForm(); expect(value.enabled).toBe(false); expect(value.permissions).toEqual([]); expect(value.accountIds).toEqual([]);
    expect(AGENT_PERMISSION_OPTIONS).toHaveLength(13);
    expect(AGENT_PERMISSION_OPTIONS.some((p) => p.key === 'research_execute')).toBe(true);
  });
  it('asks for confirmation on dangerous grants but not revocation', () => {
    const previous: AgentConnection = { ...newAgentForm(), id: 'agent', revokedAt: null, enabled: true, permissions: ['work_read'], accountIds: ['nick'] };
    expect(needsAgentConfirmation({ ...previous, permissions: ['work_read', 'message_send'] }, previous)).toBe(true);
    expect(needsAgentConfirmation({ ...previous, permissions: ['work_read', 'research_execute'] }, previous)).toBe(true);
    const sensitive: AgentConnection = { ...previous, permissions: ['message_send'] };
    expect(needsAgentConfirmation({ ...sensitive, accountIds: ['nick', 'other'] }, sensitive)).toBe(true);
    expect(needsAgentConfirmation({ ...sensitive, enabled: false }, sensitive)).toBe(false);
    expect(needsAgentConfirmation(sensitive, sensitive)).toBe(false);
    expect(needsAgentConfirmation({ ...sensitive, userId: 'other' }, sensitive)).toBe(true);
  });
});
