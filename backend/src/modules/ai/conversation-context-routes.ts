import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { buildPrivacyContext } from '../privacy/redact.js';
import { AIErrorHandler } from './core/ai-error-handler.js';
import { ContextBuilderError, buildConversationContext } from './conversation-context-builder-service.js';

const settingsEdit = requireGrant('settings', 'edit');

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!['owner', 'admin'].includes(request.user!.role)) {
    return reply.status(403).send({ error: 'Admin access required', code: 'ADMIN_REQUIRED' });
  }
}

function handleError(reply: FastifyReply, error: unknown) {
  if (error instanceof ContextBuilderError) {
    return reply.status(error.statusCode).send({ error: error.message, code: error.code });
  }
  const normalized = AIErrorHandler.normalize(error);
  return reply.status(normalized.statusCode).send({ error: normalized.message, code: normalized.code });
}

export async function conversationContextRoutes(app: FastifyInstance) {
  app.get('/api/v1/ai/context/debug/:conversationId', { preHandler: [settingsEdit, requireAdmin] }, async (request, reply) => {
    try {
      const { conversationId } = request.params as { conversationId: string };
      const query = request.query as { maxTokens?: string; recentMessageLimit?: string };
      const privacy = await buildPrivacyContext(request);
      const context = await buildConversationContext(
        {
          orgId: request.user!.orgId,
          userId: request.user!.id,
          role: request.user!.role,
          privacyUnlocked: privacy.privacyUnlocked,
        },
        conversationId,
        {
          maxTokens: query.maxTokens ? Number(query.maxTokens) : undefined,
          recentMessageLimit: query.recentMessageLimit ? Number(query.recentMessageLimit) : undefined,
        },
      );
      return context;
    } catch (error) {
      return handleError(reply, error);
    }
  });
}
