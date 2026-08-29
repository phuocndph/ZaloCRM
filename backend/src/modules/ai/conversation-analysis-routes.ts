import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { buildPrivacyContext } from '../privacy/redact.js';
import { AIErrorHandler } from './core/ai-error-handler.js';
import {
  ContextBuilderError,
  getLatestConversationInsight,
} from './conversation-analysis-service.js';
import { enqueueConversationAnalysis } from './conversation-analysis-queue.js';
import { getAiReadiness } from './ai-readiness-service.js';
import { checkZaloAccess } from '../zalo/zalo-access-middleware.js';

const conversationAccess = requireGrant('conversation', 'access');

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof ContextBuilderError) {
    return reply.status(error.statusCode).send({ error: error.message, code: error.code });
  }
  const normalized = AIErrorHandler.normalize(error);
  return reply.status(normalized.statusCode).send({ error: normalized.message, code: normalized.code });
}

async function assertConversationAccess(request: FastifyRequest, reply: FastifyReply, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, orgId: request.user!.orgId, deletedAt: null },
    select: {
      id: true,
      contactId: true,
      threadType: true,
      isPrivate: true,
      privateOwnerUserId: true,
      zaloAccountId: true,
      zaloAccount: { select: { displayName: true, status: true, privacyMode: true } },
    },
  });
  if (!conversation) {
    reply.status(404).send({ error: 'Conversation not found' });
    return null;
  }
  const access = await checkZaloAccess({
    userId: request.user!.id,
    orgId: request.user!.orgId,
    role: request.user!.role,
    zaloAccountId: conversation.zaloAccountId,
    minPermission: 'read',
  });
  if (access !== 'ok') {
    reply.status(403).send({ error: 'Không có quyền truy cập tài khoản Zalo này' });
    return null;
  }
  return conversation;
}

export async function conversationAnalysisRoutes(app: FastifyInstance) {
  app.get(
    '/api/v1/ai/insights/conversations/:conversationId',
    { preHandler: conversationAccess },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const privacy = await buildPrivacyContext(request);
        const conversationId = (request.params as { conversationId: string }).conversationId;
        const conversation = await assertConversationAccess(request, reply, conversationId);
        if (!conversation) return;
        const insight = await getLatestConversationInsight(
          {
            orgId: request.user!.orgId,
            userId: request.user!.id,
            role: request.user!.role,
            privacyUnlocked: privacy.privacyUnlocked,
          },
          conversationId,
        );
        const aiReadiness = await getAiReadiness(request.user!.orgId);
        return {
          insight,
          readiness: {
            aiStatus: aiReadiness.status,
            accountStatus: conversation?.zaloAccount.status ?? 'unknown',
            accountName: conversation?.zaloAccount.displayName ?? null,
          },
        };
      } catch (error) {
        return fail(reply, error);
      }
    },
  );

  // Existing conversations do not have a new inbound event to trigger the
  // debounced worker. This endpoint lets the chat UI backfill the latest
  // analysis immediately after AI is configured or when a user requests it.
  app.post(
    '/api/v1/ai/insights/conversations/:conversationId/analyze',
    { preHandler: conversationAccess },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const privacy = await buildPrivacyContext(request);
        const conversationId = (request.params as { conversationId: string }).conversationId;
        const conversation = await assertConversationAccess(request, reply, conversationId);
        if (!conversation) return;
        if (conversation.threadType !== 'user' || !conversation.contactId) {
          return reply.status(400).send({ error: 'Chỉ hỗ trợ phân tích hội thoại khách hàng 1-1.' });
        }
        if (conversation.isPrivate || conversation.zaloAccount.privacyMode === 'main') {
          return reply.status(403).send({ error: 'Cuộc hội thoại riêng tư không được AI đọc.', code: 'PRIVACY_LOCKED' });
        }
        // buildPrivacyContext is intentionally evaluated before queueing so the
        // request follows the same privacy boundary as the GET endpoint.
        void privacy;
        const latestActivity = await prisma.message.findFirst({
          where: { conversationId, senderType: { in: ['contact', 'self'] }, isDeleted: false },
          orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
          select: { id: true },
        });
        if (!latestActivity) {
          return { queued: false, status: 'skipped', reason: 'no_messages', insight: null };
        }
        const aiReadiness = await getAiReadiness(request.user!.orgId);
        if (['disabled', 'not_configured', 'error'].includes(aiReadiness.status)) {
          return {
            queued: false,
            status: 'skipped',
            reason: 'ai_not_ready',
            readiness: aiReadiness.status,
            insight: null,
          };
        }
        const result = await enqueueConversationAnalysis(
          { orgId: request.user!.orgId, conversationId, messageId: latestActivity.id, force: true },
          { immediate: true },
        );
        return { ...result, status: result.queued ? 'queued' : 'skipped', conversationId, messageId: latestActivity.id };
      } catch (error) {
        return fail(reply, error);
      }
    },
  );
}
