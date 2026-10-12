import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ accounts: vi.fn(), sender: vi.fn(), conversation: vi.fn(), conversations: vi.fn(), access: vi.fn(), grant: vi.fn(), visible: vi.fn(), work: vi.fn(), user: vi.fn(), scope: vi.fn(), appointment: vi.fn(), enrollment: vi.fn(), messages: vi.fn(), listWork: vi.fn(), tasks: vi.fn() }));
vi.mock('../../src/shared/database/prisma-client.js', () => ({ prisma: { zaloAccount: { findMany: mocks.accounts, findFirst: mocks.sender }, conversation: { findFirst: mocks.conversation, findMany: mocks.conversations }, conversationWorkItem: { findFirst: mocks.work }, user: { findFirst: mocks.user }, appointment: { findFirst: mocks.appointment }, followupEnrollment: { findFirst: mocks.enrollment }, message: { findFirst: mocks.messages } } }));
vi.mock('../../src/modules/zalo/zalo-access-middleware.js', () => ({ checkZaloAccess: mocks.access }));
vi.mock('../../src/modules/rbac/permission-group-service.js', () => ({ userHasGrant: mocks.grant }));
vi.mock('../../src/modules/rbac/owner-scope.js', () => ({ getOwnerScope: mocks.scope }));
vi.mock('../../src/modules/contacts/contact-scope.js', () => ({ assertContactVisible: mocks.visible, getContactScope: async () => ({ accessibleContactIds: null }) }));
vi.mock('../../src/modules/dashboard/conversation-work-item-service.js', () => ({ listConversationWorkItems: mocks.listWork, followupTasksForWorkItem: mocks.tasks, workItemMatchesIntegrationScope: () => true }));
import { allowedAgentAccounts, availableAgentTools, assertAgentConversation, prepareAgentTool, executeAgentTool, refreshAgentSendResult, agentDraftScopeFingerprint } from '../../src/modules/agents/agent-tools.js';
import { consumeInternalAgentIdentity } from '../../src/shared/internal-agent-identity.js';
import { AGENT_PERMISSIONS, AGENT_TOOLS } from '../../src/modules/agents/agent-policy.js';
const actor = { orgId: 'org', user: { id: 'user', orgId: 'org', role: 'member', email: '' }, config: { id: 'agent', accountIds: ['nick'], permissions: [...AGENT_PERMISSIONS] } } as any;
beforeEach(() => {
  vi.clearAllMocks(); mocks.accounts.mockResolvedValue([{ id: 'nick' }]); mocks.access.mockResolvedValue('ok'); mocks.grant.mockResolvedValue(true);
  mocks.conversation.mockResolvedValue({ id: 'conv', contactId: 'contact', zaloAccount: { status: 'connected' } }); mocks.visible.mockResolvedValue(true);
  mocks.work.mockResolvedValue({ id: 'work', assigneeUserId: 'user', conversationId: 'conv', metadata: { conversationIds: ['conv'] } });
  mocks.user.mockResolvedValue({ id: 'user' }); mocks.scope.mockResolvedValue({ canViewAll: false, visibleUserIds: ['user'] }); mocks.tasks.mockReturnValue([]);
  mocks.enrollment.mockResolvedValue({ id: 'enrollment', zaloAccountId: 'nick', zaloAccount: { status: 'connected' } });
  mocks.sender.mockResolvedValue({ status: 'connected' });
  mocks.messages.mockResolvedValue(null);
  mocks.conversations.mockResolvedValue([{ id: 'conv', contactId: 'contact' }]);
});
describe('agent authorization', () => {
  it.each(AGENT_TOOLS.map(t => [t.name, t.permission]))('denies %s when its toggle is off', async (name, permission) => {
    await expect(prepareAgentTool({ ...actor, config: { ...actor.config, permissions: AGENT_PERMISSIONS.filter(p => p !== permission) } }, name, {})).rejects.toThrow('AGENT_PERMISSION_DENIED');
  });
  it('intersects configured permissions with current CRM permissions', async () => {
    mocks.grant.mockResolvedValue(false); expect(await availableAgentTools(actor)).toEqual([]);
    await expect(prepareAgentTool(actor, 'read_messages', { conversationId: 'conv' })).rejects.toThrow('AGENT_PERMISSION_DENIED');
  });
  it('limits queries to organization and non-private unarchived selected nicks', async () => {
    await assertAgentConversation(actor, 'conv');
    expect(mocks.accounts).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'org', id: { in: ['nick'] }, privacyMode: 'sub', archivedAt: null } }));
    expect(mocks.conversation.mock.calls[0][0].where).toMatchObject({ orgId: 'org', deletedAt: null, isPrivate: false, zaloAccountId: { in: ['nick'] } });
  });
  it('removes nicks inaccessible to the backing user', async () => {
    mocks.access.mockResolvedValue('denied'); expect(await allowedAgentAccounts(actor)).toEqual([]);
  });
  it('fails closed for private, deleted, cross-tenant or excluded conversations', async () => {
    mocks.conversation.mockResolvedValue(null); await expect(assertAgentConversation(actor, 'hidden')).rejects.toThrow('AGENT_CONVERSATION_NOT_FOUND');
  });
  it('respects customer access and connected sender', async () => {
    mocks.visible.mockResolvedValue(false); await expect(assertAgentConversation(actor, 'conv')).rejects.toThrow();
    mocks.visible.mockResolvedValue(true); mocks.conversation.mockResolvedValue({ id: 'conv', contactId: 'contact', zaloAccount: { status: 'disconnected' } });
    await expect(assertAgentConversation(actor, 'conv', true)).rejects.toThrow('AGENT_NICK_DISCONNECTED');
  });
  it('checks every contributing conversation on aggregated work', async () => {
    mocks.work.mockResolvedValue({ assigneeUserId: 'user', conversationId: 'conv', metadata: { conversationIds: ['conv', 'other'] } });
    mocks.conversation.mockImplementation(async ({ where }) => where.id === 'other' ? null : { id: 'conv', contactId: null, zaloAccount: { status: 'connected' } });
    await expect(prepareAgentTool(actor, 'update_work', { itemId: 'work', action: 'complete' })).rejects.toThrow('AGENT_CONVERSATION_NOT_FOUND');
  });
  it('requires send permission before completing a followup that may send', async () => {
    mocks.tasks.mockReturnValue([{ enrollmentId: 'enrollment' }]);
    await expect(prepareAgentTool({ ...actor, config: { ...actor.config, permissions: ['work_update'] } }, 'update_work', { itemId: 'work', action: 'complete' })).rejects.toThrow('AGENT_FOLLOWUP_SEND_PERMISSION_REQUIRED');
  });
  it('requires chat access on every followup sender, even when the Agent send toggle is on', async () => {
    mocks.tasks.mockReturnValue([{ enrollmentId: 'enrollment', currentStepKey: 'sale' }]);
    mocks.access.mockImplementation(async ({ minPermission }) => minPermission === 'read' ? 'ok' : 'insufficient');
    await expect(prepareAgentTool(actor, 'update_work', { itemId: 'work', action: 'complete' })).rejects.toThrow('AGENT_FOLLOWUP_CHAT_PERMISSION_REQUIRED');
    mocks.access.mockResolvedValue('ok');
    await expect(prepareAgentTool(actor, 'update_work', { itemId: 'work', action: 'complete' })).resolves.toMatchObject({ tool: { name: 'update_work' } });
  });
  it('checks connected followup senders but does not require chat access for ordinary work', async () => {
    mocks.tasks.mockReturnValue([{ enrollmentId: 'enrollment', currentStepKey: 'sale' }]);
    mocks.sender.mockResolvedValue({ status: 'disconnected' });
    await expect(prepareAgentTool(actor, 'update_work', { itemId: 'work', action: 'complete' })).rejects.toThrow('AGENT_NICK_DISCONNECTED');
    mocks.tasks.mockReturnValue([]); mocks.access.mockImplementation(async ({ minPermission }) => minPermission === 'read' ? 'ok' : 'insufficient');
    await expect(prepareAgentTool(actor, 'update_work', { itemId: 'work', action: 'snooze' })).resolves.toMatchObject({ tool: { name: 'update_work' } });
  });
  it('allows reading virtual conversations but blocks sending before reserving any operation', async () => {
    mocks.conversation.mockResolvedValue({ id: 'conv', contactId: 'contact', isVirtual: true, zaloAccount: { status: 'connected' } });
    await expect(prepareAgentTool(actor, 'read_messages', { conversationId: 'conv' })).resolves.toBeDefined();
    await expect(prepareAgentTool(actor, 'send_message', { conversationId: 'conv' })).rejects.toThrow('AGENT_VIRTUAL_CONVERSATION_SEND_FORBIDDEN');
  });
  it('passes the current allowed accounts through a trusted one-use identity, never the external payload', async () => {
    const app = { inject: vi.fn(async ({ method, url, headers, payload }) => {
      const identity = consumeInternalAgentIdentity(headers['x-crm-internal-agent'], method, url);
      expect(identity?.agentScope).toEqual({ allowedAccountIds: ['nick'] });
      expect(payload).toEqual({});
      return { statusCode: 200, json: () => ({ reply_text: 'Draft' }) };
    }) } as any;
    await executeAgentTool(app, actor, 'generate_reply_draft', { conversationId: 'conv', allowedAccountIds: ['other'] }, null);
    expect(app.inject).toHaveBeenCalledOnce();
  });
  it.each(['completed', 'accepted', 'failed', 'uncertain', 'submitting'])('refreshes a cached send from the durable outbox (%s) without sending again', async (deliveryState) => {
    mocks.messages.mockResolvedValue({ id: 'message', conversationId: 'conv', deliveryState, metadata: { failReason: 'Blocked', content: 'secret' } });
    const result = await refreshAgentSendResult(actor, { conversationId: 'conv', requestId: 'request' }, { statusCode: 202, data: { deliveryState: 'uncertain' } });
    const pending = ['uncertain', 'submitting'].includes(deliveryState);
    expect(result.statusCode).toBe(pending ? 202 : 200);
    expect(result.data).toMatchObject({ id: 'message', deliveryState, pendingConfirmation: pending });
    expect(result.data).not.toHaveProperty('metadata');
    expect(mocks.messages).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ clientEchoId: 'agent:agent:request', conversation: expect.objectContaining({ orgId: 'org', isPrivate: false, isVirtual: false, zaloAccountId: { in: ['nick'] } }) }) }));
  });
  it('does not infer delivery or retry a send if its outbox record is absent', async () => {
    const cached = { statusCode: 202, data: { id: 'message', deliveryState: 'uncertain' } };
    expect(await refreshAgentSendResult(actor, { conversationId: 'conv', requestId: 'request' }, cached)).toEqual(cached);
  });
  it('invalidates draft replay when a source conversation becomes hidden or the backing employee changes', async () => {
    mocks.conversations.mockResolvedValue([{ id: 'conv', contactId: 'contact' }, { id: 'source', contactId: 'contact' }]);
    const original = await agentDraftScopeFingerprint(actor);
    expect(await agentDraftScopeFingerprint(actor)).toBe(original);
    mocks.conversations.mockResolvedValue([{ id: 'conv', contactId: 'contact' }]);
    expect(await agentDraftScopeFingerprint(actor)).not.toBe(original);
    expect(await agentDraftScopeFingerprint({ ...actor, user: { ...actor.user, id: 'other' } })).not.toBe(original);
    expect(mocks.conversations.mock.calls[0][0].where).toMatchObject({ isPrivate: false, deletedAt: null, zaloAccount: { privacyMode: 'sub', archivedAt: null } });
  });
  it('uses the existing outbox reconciliation rule when remote confirmation arrives before the state update', async () => {
    mocks.messages.mockResolvedValue({ id: 'message', conversationId: 'conv', deliveryState: 'uncertain', zaloMsgId: 'remote-confirmed' });
    expect(await refreshAgentSendResult(actor, { conversationId: 'conv', requestId: 'request' }, { statusCode: 202, data: {} }))
      .toMatchObject({ statusCode: 200, data: { deliveryState: 'accepted', pendingConfirmation: false } });
  });
  it('does not accept another customer appointment or quote', async () => {
    mocks.appointment.mockResolvedValue(null); await expect(prepareAgentTool(actor, 'update_appointment', { conversationId: 'conv', appointmentId: 'other' })).rejects.toThrow('AGENT_APPOINTMENT_NOT_FOUND');
    mocks.messages.mockResolvedValue(null); await expect(prepareAgentTool(actor, 'send_message', { conversationId: 'conv', replyMessageId: 'other' })).rejects.toThrow('AGENT_REPLY_NOT_FOUND');
  });
  it('routes sends to the existing CRM outbox and never forwards arbitrary payload fields', async () => {
    const app = { inject: vi.fn().mockResolvedValue({ statusCode: 200, json: () => ({ id: 'sent' }) }) } as any;
    await executeAgentTool(app, actor, 'send_message', { conversationId: 'conv', content: 'Hello', requestId: 'request', url: 'https://evil', assignedUserId: 'other', echoId: 'evil' }, null);
    expect(app.inject).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', url: '/api/v1/conversations/conv/messages', payload: { content: 'Hello', replyMessageId: undefined, echoId: 'agent:agent:request' } }));
    expect(JSON.stringify(app.inject.mock.calls)).not.toContain('https://evil');
  });
  it('does not leak customer details through a mutation response', async () => {
    const app = { inject: vi.fn().mockResolvedValue({ statusCode: 200, json: () => ({ id: 'contact', notes: [{ body: 'hidden' }], friends: [{ zaloAccountId: 'other' }] }) }) } as any;
    const result = await executeAgentTool(app, actor, 'update_customer', { conversationId: 'conv', crmName: 'Name' }, 'contact');
    expect(result.data).toEqual({ id: 'contact' });
  });
});
