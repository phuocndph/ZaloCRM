import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { buildPrivacyContext, canSeeConversationContent, isConversationPrivateFor } from '../privacy/redact.js';
import { getOwnerScope } from '../rbac/owner-scope.js';
import {
  listConversationLoadOverview,
  listConversationAnalysisActivity,
  listConversationWorkItems,
  reconcileConversationWorkItems,
  updateConversationWorkItem,
  type WorkItemScope,
} from './conversation-work-item-service.js';

type JwtUser = { id: string; role: string; orgId: string };

async function canViewAssignee(user: JwtUser, assigneeUserId: string) {
  if (user.id === assigneeUserId || user.role === 'owner' || user.role === 'admin') return true;
  const scope = await getOwnerScope({ userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'conversation' });
  return scope.canViewAll || scope.visibleUserIds.includes(assigneeUserId);
}

function validScope(value: unknown): value is WorkItemScope {
  return ['now', 'today', 'waiting', 'upcoming', 'verify', 'done', 'all'].includes(String(value));
}

export async function conversationWorkItemRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  app.get('/api/v1/work-items/overview', async (request, reply) => {
    const user = request.user as JwtUser;
    const query = request.query as { q?: string; includeCompleted?: string };
    const scope = await getOwnerScope({ userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'conversation' });
    const visibleUserIds = scope.canViewAll
      ? (await prisma.user.findMany({ where: { orgId: user.orgId, isActive: true }, select: { id: true } })).map((row) => row.id)
      : scope.visibleUserIds;
    // Luôn làm mới materialized queue trước khi hiển thị tổng quan để nút tải lại
    // phản ánh tin nhắn/phân công mới, không phải chờ cron 2 phút.
    await Promise.all(visibleUserIds.map((assigneeUserId) => reconcileConversationWorkItems({
      orgId: user.orgId,
      assigneeUserId,
      privacy: { viewerUserId: assigneeUserId, orgId: user.orgId, privacyUnlocked: false },
    }).catch(() => [])));
    const result = await listConversationLoadOverview({
      orgId: user.orgId,
      visibleUserIds,
      viewerUserId: user.id,
      query: query.q,
      includeCompleted: query.includeCompleted === 'true',
    });
    return { ...result, canViewAll: scope.canViewAll };
  });

  app.get('/api/v1/work-items', async (request, reply) => {
    const user = request.user as JwtUser;
    const query = request.query as { audience?: string; asUserId?: string; scope?: string; limit?: string; offset?: string; q?: string };
    const viewingAll = query.audience === 'all';
    const ownerScope = await getOwnerScope({ userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'conversation' });
    const assignees = await prisma.user.findMany({
      where: {
        orgId: user.orgId,
        isActive: true,
        ...(ownerScope.canViewAll ? {} : { id: { in: ownerScope.visibleUserIds } }),
      },
      select: { id: true, fullName: true },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    });
    const assigneeUserId = query.asUserId || user.id;
    if ((query.asUserId || !viewingAll) && !ownerScope.canViewAll && !ownerScope.visibleUserIds.includes(assigneeUserId)) {
      return reply.status(403).send({ error: 'Bạn không có quyền xem công việc của nhân viên này', code: 'WORK_ITEMS_FORBIDDEN' });
    }
    const assignee = assignees.find((row) => row.id === assigneeUserId);
    if ((query.asUserId || !viewingAll) && !assignee) {
      return reply.status(404).send({ error: 'Không tìm thấy nhân viên', code: 'ASSIGNEE_NOT_FOUND' });
    }
    const assigneeUserIds = viewingAll && !query.asUserId ? assignees.map((row) => row.id) : [assigneeUserId];
    const privacy = await buildPrivacyContext(request);
    const scope = validScope(query.scope) ? query.scope : 'now';
    const limit = Number(query.limit);
    const offset = Number(query.offset);
    const result = await listConversationWorkItems({
      orgId: user.orgId,
      assigneeUserId,
      ...(viewingAll ? { assigneeUserIds } : {}),
      privacy,
      scope,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
      query: query.q,
    });
    const activities = await Promise.all(assigneeUserIds.map((id) => listConversationAnalysisActivity({ orgId: user.orgId, assigneeUserId: id })));
    const aiActivity = [...new Map(activities.flat().map((activity) => [activity.conversationId, activity])).values()];
    return { ...result, assignee: viewingAll && !query.asUserId ? null : assignee, assignees, viewingAll: viewingAll && !query.asUserId, aiActivity };
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
      select: {
        id: true,
        assigneeUserId: true,
        conversation: {
          select: {
            isPrivate: true,
            privateOwnerUserId: true,
            zaloAccount: { select: { privacyMode: true, ownerUserId: true } },
          },
        },
      },
    });
    if (!existing) return reply.status(404).send({ error: 'Không tìm thấy công việc', code: 'WORK_ITEM_NOT_FOUND' });
    if (!(await canViewAssignee(user, existing.assigneeUserId))) {
      return reply.status(403).send({ error: 'Bạn không có quyền cập nhật công việc này', code: 'WORK_ITEM_FORBIDDEN' });
    }
    const privacy = await buildPrivacyContext(request);
    if (existing.conversation && (
      isConversationPrivateFor(existing.conversation, privacy.viewerUserId)
      || !canSeeConversationContent(existing.conversation, privacy)
    )) {
      return reply.status(403).send({ error: 'Công việc thuộc nội dung riêng tư chưa được mở khóa', code: 'WORK_ITEM_PRIVATE' });
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
      const item = await updateConversationWorkItem({
        orgId: user.orgId,
        itemId,
        action: body.action,
        snoozedUntil,
        actor: { actorId: user.id },
        allowedFollowupAccountIds: request.agentScope?.allowedAccountIds,
      });
      return { item };
    } catch (error) {
      if ((error as Error).message === 'WORK_ITEM_STALE') {
        return reply.status(409).send({ error: 'Bước Follow-up đã thay đổi. Hãy tải lại danh sách trước khi hoàn thành.', code: 'WORK_ITEM_STALE' });
      }
      if ((error as Error).message === 'SNOOZE_TIME_INVALID') {
        return reply.status(400).send({ error: 'Thời gian hoãn phải nằm trong tương lai', code: 'SNOOZE_TIME_INVALID' });
      }
      throw error;
    }
  });
}
