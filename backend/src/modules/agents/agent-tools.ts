import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { createInternalAgentIdentity, type AgentExecutionScope } from '../../shared/internal-agent-identity.js';
import { checkZaloAccess } from '../zalo/zalo-access-middleware.js';
import { getOwnerScope } from '../rbac/owner-scope.js';
import { userHasGrant } from '../rbac/permission-group-service.js';
import { assertContactVisible, getContactScope } from '../contacts/contact-scope.js';
import { outboundDeliveryState } from '../chat/chat-helpers.js';
import { listConversationWorkItems, followupTasksForWorkItem, workItemMatchesIntegrationScope } from '../dashboard/conversation-work-item-service.js';
import type { WorkItemScope } from '../dashboard/conversation-work-item-service.js';
import { AgentError, AGENT_TOOLS, hashToken } from './agent-policy.js';
import type { AgentActor } from './agent-store.js';

export async function allowedAgentAccounts(actor: AgentActor, chat = false) {
  const rows = await prisma.zaloAccount.findMany({ where: { orgId: actor.orgId, id: { in: actor.config.accountIds }, archivedAt: null, privacyMode: 'sub' }, select: { id: true } });
  const access = await Promise.all(rows.map(async (row) => (await checkZaloAccess({ userId: actor.user.id, orgId: actor.orgId, role: actor.user.role, zaloAccountId: row.id, minPermission: chat ? 'chat' : 'read' })) === 'ok' ? row.id : null));
  return access.filter((id): id is string => !!id);
}
export async function availableAgentTools(actor: AgentActor) {
  const results = await Promise.all(AGENT_TOOLS.map(async (tool) => actor.config.permissions.includes(tool.permission)
    && await userHasGrant(actor.user.id, ...tool.grant) ? tool : null));
  return results.filter((tool): tool is typeof AGENT_TOOLS[number] => !!tool);
}
function conversationWhere(actor: AgentActor, accounts: string[]) {
  return { orgId: actor.orgId, deletedAt: null, isPrivate: false, zaloAccountId: { in: accounts }, zaloAccount: { privacyMode: 'sub', archivedAt: null } };
}
async function listConversationWhere(actor: AgentActor, accounts: string[]) {
  const scope = await getContactScope(actor.user.id, actor.orgId, actor.user.role);
  return { ...conversationWhere(actor, accounts), ...(scope.accessibleContactIds !== null ? {
    OR: [{ contactId: null }, { contactId: { in: scope.accessibleContactIds } }],
  } : {}) };
}
export async function agentDraftScopeFingerprint(actor: AgentActor) {
  const accounts = await allowedAgentAccounts(actor);
  const conversations = await prisma.conversation.findMany({ where: await listConversationWhere(actor, accounts), select: { id: true, contactId: true }, orderBy: { id: 'asc' } });
  return hashToken(JSON.stringify({ userId: actor.user.id, role: actor.user.role, accounts: accounts.sort(), conversations }));
}
export async function assertAgentConversation(actor: AgentActor, id: string, chat = false) {
  const accounts = await allowedAgentAccounts(actor, chat);
  const conversation = await prisma.conversation.findFirst({ where: { ...conversationWhere(actor, accounts), id }, select: { id: true, contactId: true, isVirtual: true, zaloAccount: { select: { status: true } } } });
  if (!conversation) throw new AgentError(404, 'AGENT_CONVERSATION_NOT_FOUND');
  if (conversation.contactId && !(await assertContactVisible({ userId: actor.user.id, orgId: actor.orgId, legacyRole: actor.user.role, contactId: conversation.contactId }))) throw new AgentError(404, 'AGENT_CONVERSATION_NOT_FOUND');
  if (chat && conversation.isVirtual) throw new AgentError(409, 'AGENT_VIRTUAL_CONVERSATION_SEND_FORBIDDEN');
  if (chat && conversation.zaloAccount.status !== 'connected') throw new AgentError(409, 'AGENT_NICK_DISCONNECTED');
  return conversation;
}
async function assigneeAllowed(actor: AgentActor, id: string) {
  const user = await prisma.user.findFirst({ where: { orgId: actor.orgId, id, isActive: true }, select: { id: true } });
  if (!user) throw new AgentError(404, 'AGENT_ASSIGNEE_NOT_FOUND');
  if (id === actor.user.id) return;
  const scope = await getOwnerScope({ userId: actor.user.id, orgId: actor.orgId, legacyRole: actor.user.role, resource: 'contact' });
  if (!scope.canViewAll && !scope.visibleUserIds.includes(id)) throw new AgentError(403, 'AGENT_ASSIGNEE_FORBIDDEN');
}
export async function prepareAgentTool(actor: AgentActor, name: string, args: Record<string, any>) {
  const tool = AGENT_TOOLS.find((row) => row.name === name);
  if (!tool || !actor.config.permissions.includes(tool.permission) || !(await userHasGrant(actor.user.id, ...tool.grant))) throw new AgentError(403, 'AGENT_PERMISSION_DENIED');
  if (name === 'update_work') {
    const item = await prisma.conversationWorkItem.findFirst({ where: { id: args.itemId, orgId: actor.orgId } });
    if (!item) throw new AgentError(404, 'AGENT_WORK_NOT_FOUND');
    await assigneeAllowed(actor, item.assigneeUserId);
    const metadata = item.metadata as { conversationIds?: string[]; signals?: { conversationId?: string }[] } | null;
    const ids = [item.conversationId, ...(metadata?.conversationIds ?? []), ...(metadata?.signals ?? []).map(s => s.conversationId)].filter((id): id is string => typeof id === 'string');
    if (!ids.length) throw new AgentError(403, 'AGENT_WORK_SCOPE_DENIED');
    for (const id of new Set(ids)) await assertAgentConversation(actor, id);
    const accounts = await allowedAgentAccounts(actor);
    if (!workItemMatchesIntegrationScope(item, new Set(ids), new Set(accounts))) throw new AgentError(403, 'AGENT_WORK_SCOPE_DENIED');
    const tasks = args.action === 'complete' ? followupTasksForWorkItem(item) : [];
    if (tasks.length && (!actor.config.permissions.includes('message_send') || !(await userHasGrant(actor.user.id, 'conversation', 'edit')))) throw new AgentError(403, 'AGENT_FOLLOWUP_SEND_PERMISSION_REQUIRED');
    const sendAccounts = tasks.length ? await allowedAgentAccounts(actor, true) : [];
    for (const task of tasks) {
      const enrollment = await prisma.followupEnrollment.findFirst({ where: { orgId: actor.orgId, id: task.enrollmentId, contactId: item.contactId, zaloAccountId: { in: accounts }, status: 'waiting_sale', currentStepKey: task.currentStepKey }, select: { id: true, zaloAccountId: true } });
      if (!enrollment) throw new AgentError(409, 'AGENT_FOLLOWUP_SCOPE_CHANGED');
      if (!sendAccounts.includes(enrollment.zaloAccountId)) throw new AgentError(403, 'AGENT_FOLLOWUP_CHAT_PERMISSION_REQUIRED');
      const sender = await prisma.zaloAccount.findFirst({ where: { id: enrollment.zaloAccountId, orgId: actor.orgId, archivedAt: null, privacyMode: 'sub' }, select: { status: true } });
      if (sender?.status !== 'connected') throw new AgentError(409, 'AGENT_NICK_DISCONNECTED');
    }
  }
  if (name === 'list_work') await assigneeAllowed(actor, args.assigneeUserId || actor.user.id);
  if (args.conversationId) {
    const conversation = await assertAgentConversation(actor, args.conversationId, name === 'send_message');
    if (name === 'send_message' && args.replyMessageId) {
      const message = await prisma.message.findFirst({ where: { id: args.replyMessageId, conversationId: conversation.id, isDeleted: false }, select: { id: true } });
      if (!message) throw new AgentError(404, 'AGENT_REPLY_NOT_FOUND');
    }
    if (['read_customer', 'read_notes', 'read_appointments', 'update_customer', 'set_customer_tags', 'add_note', 'create_appointment', 'update_appointment'].includes(name)) {
      if (!conversation.contactId) throw new AgentError(404, 'AGENT_CUSTOMER_NOT_FOUND');
      if (args.appointmentId) {
        const appointment = await prisma.appointment.findFirst({ where: { id: args.appointmentId, orgId: actor.orgId, contactId: conversation.contactId }, select: { id: true } });
        if (!appointment) throw new AgentError(404, 'AGENT_APPOINTMENT_NOT_FOUND');
      }
      return { tool, contactId: conversation.contactId };
    }
  }
  return { tool, contactId: null };
}
// Fixed mappings only: no external URL, path, headers, JWT or arbitrary HTTP proxy.
async function dispatch(app: FastifyInstance, actor: AgentActor, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown, agentScope?: AgentExecutionScope) {
  const identity = createInternalAgentIdentity({ ...actor.user, email: actor.user.email ?? '', agentScope }, method, url);
  try {
    const result = await app.inject({ method, url, headers: { 'x-crm-internal-agent': identity.key }, ...(payload ? { payload: payload as any } : {}) });
    const data = result.json() as Record<string, any>;
    // Mutation routes often include global contact notes/friends in their UI response.
    // Agents get only the receipt, not unrelated data they have no read permission for.
    const isDraft = url.endsWith('/generate');
    if (method !== 'GET' && !isDraft && result.statusCode < 400) {
      const source = data.item ?? data.note ?? data;
      const fields = ['id', 'status', 'deliveryState', 'echoId', 'pendingConfirmation', 'snoozedUntil', 'completedAt', 'queued', 'reason', 'messageId', 'conversationId'];
      return { statusCode: result.statusCode, data: Object.fromEntries(fields.filter(key => source[key] !== undefined).map(key => [key, source[key]])) };
    }
    return { statusCode: result.statusCode, data };
  } finally { identity.dispose(); }
}
export async function refreshAgentSendResult(actor: AgentActor, args: Record<string, unknown>, cached: { statusCode: number; data: unknown }) {
  const accounts = await allowedAgentAccounts(actor, true);
  const message = await prisma.message.findFirst({
    where: { conversationId: String(args.conversationId), clientEchoId: `agent:${actor.config.id}:${args.requestId}`, isDeleted: false,
      conversation: { ...conversationWhere(actor, accounts), isVirtual: false } },
    select: { id: true, conversationId: true, deliveryState: true, zaloMsgId: true, metadata: true },
  });
  if (!message) return cached;
  const deliveryState = outboundDeliveryState(message);
  const pending = deliveryState !== 'completed' && deliveryState !== 'accepted' && deliveryState !== 'failed';
  const metadata = message.metadata as { failReason?: unknown } | null;
  return { statusCode: pending ? 202 : 200, data: {
    id: message.id, conversationId: message.conversationId, deliveryState,
    echoId: `agent:${actor.config.id}:${args.requestId}`, pendingConfirmation: pending,
    ...(deliveryState === 'failed' && typeof metadata?.failReason === 'string' ? { reason: metadata.failReason } : {}),
  } };
}
export async function executeAgentTool(app: FastifyInstance, actor: AgentActor, name: string, args: Record<string, any>, contactId: string | null) {
  const accounts = await allowedAgentAccounts(actor);
  const skip = args.offset ?? 0;
  const take = args.limit ?? 30;
  if (name === 'list_assignees') {
    const scope = await getOwnerScope({ userId: actor.user.id, orgId: actor.orgId, legacyRole: actor.user.role, resource: 'contact' });
    const users = await prisma.user.findMany({ where: { orgId: actor.orgId, isActive: true, ...(scope.canViewAll ? {} : { id: { in: [...new Set([actor.user.id, ...scope.visibleUserIds])] } }) }, select: { id: true, fullName: true }, skip, take, orderBy: { id: 'asc' } });
    return { statusCode: 200, data: { assignees: users, nextOffset: users.length === take ? skip + take : null } };
  }
  if (name === 'list_work') {
    const conversations = await prisma.conversation.findMany({ where: await listConversationWhere(actor, accounts), select: { id: true } });
    const result = await listConversationWorkItems({ orgId: actor.orgId, assigneeUserId: args.assigneeUserId || actor.user.id,
      privacy: { viewerUserId: actor.user.id, orgId: actor.orgId, privacyUnlocked: false }, scope: args.scope as WorkItemScope, limit: take, offset: skip, query: args.q, allowedConversationIds: conversations.map((row) => row.id), allowedAccountIds: accounts });
    return { statusCode: 200, data: result };
  }
  if (name === 'list_conversations') {
    const data = await prisma.conversation.findMany({ where: await listConversationWhere(actor, accounts), skip, take, orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
      select: { id: true, zaloAccountId: true, contactId: true, groupName: true, threadType: true, lastMessageAt: true, isReplied: true, unreadCount: true } });
    return { statusCode: 200, data: { conversations: data, nextOffset: data.length === take ? skip + take : null } };
  }
  if (name === 'read_messages') {
    const data = await prisma.message.findMany({ where: { conversationId: args.conversationId, isDeleted: false, conversation: conversationWhere(actor, accounts) }, skip, take, orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      select: { id: true, senderType: true, senderName: true, content: true, contentType: true, sentAt: true, deliveryState: true } });
    return { statusCode: 200, data: { messages: data, nextOffset: data.length === take ? skip + take : null } };
  }
  if (name === 'read_customer') return { statusCode: 200, data: await prisma.contact.findFirst({ where: { orgId: actor.orgId, id: contactId! },
    select: { id: true, fullName: true, crmName: true, phone: true, email: true, statusId: true, assignedUserId: true, tags: true } }) };
  if (name === 'read_notes') return { statusCode: 200, data: { notes: await prisma.note.findMany({ where: { orgId: actor.orgId, contactId: contactId! }, skip, take, orderBy: { createdAt: 'desc' }, select: { id: true, body: true, authorUserId: true, createdAt: true } }) } };
  if (name === 'read_appointments') return { statusCode: 200, data: { appointments: await prisma.appointment.findMany({ where: { orgId: actor.orgId, contactId: contactId! }, skip, take, orderBy: { appointmentDate: 'desc' }, select: { id: true, title: true, appointmentDate: true, appointmentTime: true, status: true, notes: true, assignedUserId: true } }) } };
  const conv = encodeURIComponent(args.conversationId ?? '');
  switch (name) {
    case 'read_analysis': return dispatch(app, actor, 'GET', `/api/v1/ai/insights/conversations/${conv}`);
    case 'analyze_conversation': return dispatch(app, actor, 'POST', `/api/v1/ai/insights/conversations/${conv}/analyze`, {});
    case 'generate_reply_draft': return dispatch(app, actor, 'POST', `/api/v1/ai/replies/conversations/${conv}/generate`, {}, { allowedAccountIds: accounts });
    case 'update_work': return dispatch(app, actor, 'PATCH', `/api/v1/work-items/${encodeURIComponent(args.itemId)}`, { action: args.action, snoozeMinutes: args.snoozeMinutes }, { allowedAccountIds: await allowedAgentAccounts(actor, true) });
    case 'update_customer': return dispatch(app, actor, 'PUT', `/api/v1/contacts/${encodeURIComponent(contactId!)}`, { crmName: args.crmName, email: args.email, statusId: args.statusId });
    case 'set_customer_tags': return dispatch(app, actor, 'PUT', `/api/v1/contacts/${encodeURIComponent(contactId!)}/tags`, { tags: args.tags });
    case 'add_note': return dispatch(app, actor, 'POST', `/api/v1/contacts/${encodeURIComponent(contactId!)}/notes`, { body: args.body });
    case 'create_appointment': return dispatch(app, actor, 'POST', '/api/v1/appointments', { contactId, assignedUserId: actor.user.id, appointmentDate: args.appointmentDate, appointmentTime: args.appointmentTime, title: args.title, notes: args.notes, type: args.type });
    case 'update_appointment': return dispatch(app, actor, 'PUT', `/api/v1/appointments/${encodeURIComponent(args.appointmentId)}`, { status: args.status });
    case 'send_message': return dispatch(app, actor, 'POST', `/api/v1/conversations/${conv}/messages`, { content: args.content, replyMessageId: args.replyMessageId, echoId: `agent:${actor.config.id}:${args.requestId}` });
    default: throw new AgentError(404, 'AGENT_TOOL_NOT_FOUND');
  }
}
