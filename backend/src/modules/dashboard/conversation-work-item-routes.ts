import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { buildPrivacyContext } from '../privacy/redact.js';
import { getOwnerScope } from '../rbac/owner-scope.js';
import {
  listConversationWorkItems,
  updateConversationWorkItem,
  type WorkItemScope,
} from './conversation-work-item-service.js';

type JwtUser = { id: string; role: string; orgId: string };

async function canViewAssignee(user: JwtUser, assigneeUserId: string) {
  if (user.id === assigneeUserId || user.role === 'owner' || user.role === 'admin') return true;
  const scope = await getOwnerScope({ userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'contact' });
  return scope.canViewAll || scope.visibleUserIds.includes(assigneeUserId);
}

function validScope(value: unknown): value is WorkItemScope {
  return ['now', 'today', 'waiting', 'upcoming', 'done', 'all'].includes(String(value));
}

export async function conversationWorkItemRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/work-items', async (request, reply) => {
    const user = request.user as JwtUser;
    const query = request.query as { asUserId?: string; scope?: string; limit?: string };
    const assigneeUserId = query.asUserId || user.id;
    if (!(await canViewAssignee(user, assigneeUserId))) {
      return reply.status(403).send({ error: 'Bạn không có quyền xem công việc của nhân viên này', code: 'WORK_ITEMS_FORBIDDEN' });
    }
    const assignee = await prisma.user.findFirst({
      where: { id: assigneeUserId, orgId: user.orgId, isActive: true },
      select: { id: true, fullName: true },
    });
    if (!assignee) return reply.status(404).send({ error: 'Không tìm thấy nhân viên', code: 'ASSIGNEE_NOT_FOUND' });
    const privacy = await buildPrivacyContext(request);
    const scope = validScope(query.scope) ? query.scope : 'now';
    const limit = Number(query.limit);
    const result = await listConversationWorkItems({
      orgId: user.orgId,
      assigneeUserId,
      privacy,
      scope,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return { ...result, assignee };
  });

  app.patch('/api/v1/work-items/:itemId', async (request, reply) => {
    const user = request.user as JwtUser;
    const itemId = (request.params as { itemId: string }).itemId;
    const body = (request.body ?? {}) as { action?: 'complete' | 'snooze' | 'reopen'; snoozedUntil?: string; snoozeMinutes?: number };
    if (!body.action || !['complete', 'snooze', 'reopen'].includes(body.action)) {
      return reply.status(400).send({ error: 'Thao tác không hợp lệ', code: 'WORK_ITEM_ACTION_INVALID' });
    }
    const existing = await prisma.conversationWorkItem.findFirst({
      where: { id: itemId, orgId: user.orgId },
      select: { id: true, assigneeUserId: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Không tìm thấy công việc', code: 'WORK_ITEM_NOT_FOUND' });
    if (!(await canViewAssignee(user, existing.assigneeUserId))) {
      return reply.status(403).send({ error: 'Bạn không có quyền cập nhật công việc này', code: 'WORK_ITEM_FORBIDDEN' });
    }
    let snoozedUntil: Date | null = null;
    if (body.action === 'snooze') {
      snoozedUntil = body.snoozedUntil
        ? new Date(body.snoozedUntil)
        : new Date(Date.now() + Math.max(15, Math.min(7 * 24 * 60, Number(body.snoozeMinutes) || 120)) * 60_000);
      if (Number.isNaN(snoozedUntil.getTime()) || snoozedUntil <= new Date()) {
        return reply.status(400).send({ error: 'Thời gian hoãn phải nằm trong tương lai', code: 'SNOOZE_TIME_INVALID' });
      }
    }
    try {
      const item = await updateConversationWorkItem({ orgId: user.orgId, itemId, action: body.action, snoozedUntil });
      return { item };
    } catch (error) {
      if ((error as Error).message === 'SNOOZE_TIME_INVALID') {
        return reply.status(400).send({ error: 'Thời gian hoãn phải nằm trong tương lai', code: 'SNOOZE_TIME_INVALID' });
      }
      throw error;
    }
  });
}
