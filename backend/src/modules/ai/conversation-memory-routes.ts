import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { buildPrivacyContext } from '../privacy/redact.js';
import { AIErrorHandler } from './core/ai-error-handler.js';
import {
  ConversationMemoryError,
  ContextBuilderError,
  deleteCustomerMemory,
  listCustomerMemories,
  proposeCustomerMemoriesFromConversation,
  refreshConversationSummary,
  updateCustomerMemory,
  upsertCustomerMemory,
  type MemoryActor,
} from './conversation-memory-service.js';

const settingsEdit = requireGrant('settings', 'edit');

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!['owner', 'admin'].includes(request.user!.role)) {
    return reply.status(403).send({ error: 'Admin access required', code: 'ADMIN_REQUIRED' });
  }
}

async function actorFromRequest(request: FastifyRequest): Promise<MemoryActor> {
  const privacy = await buildPrivacyContext(request);
  return {
    orgId: request.user!.orgId,
    userId: request.user!.id,
    role: request.user!.role,
    privacyUnlocked: privacy.privacyUnlocked,
  };
}

function handleMemoryError(reply: FastifyReply, error: unknown) {
  if (error instanceof ConversationMemoryError || error instanceof ContextBuilderError) {
    return reply.status(error.statusCode).send({ error: error.message, code: error.code });
  }
  const normalized = AIErrorHandler.normalize(error);
  return reply.status(normalized.statusCode).send({ error: normalized.message, code: normalized.code });
}

export async function conversationMemoryRoutes(app: FastifyInstance) {
  app.post('/api/v1/ai/memory/conversations/:conversationId/summary/refresh', { preHandler: [settingsEdit, requireAdmin] }, async (request, reply) => {
    try {
      const { conversationId } = request.params as { conversationId: string };
      const body = (request.body ?? {}) as {
        modelConfigId?: string;
        force?: boolean;
        maxTokens?: number;
        minNewMessages?: number;
        idleMs?: number;
      };
      return await refreshConversationSummary(await actorFromRequest(request), conversationId, {
        modelConfigId: body.modelConfigId,
        force: !!body.force,
        maxTokens: body.maxTokens,
        minNewMessages: body.minNewMessages,
        idleMs: body.idleMs,
      });
    } catch (error) {
      return handleMemoryError(reply, error);
    }
  });

  app.post('/api/v1/ai/memory/conversations/:conversationId/propose', { preHandler: [settingsEdit, requireAdmin] }, async (request, reply) => {
    try {
      const { conversationId } = request.params as { conversationId: string };
      const body = (request.body ?? {}) as { modelConfigId?: string; maxTokens?: number };
      return await proposeCustomerMemoriesFromConversation(await actorFromRequest(request), conversationId, body);
    } catch (error) {
      return handleMemoryError(reply, error);
    }
  });

  app.get('/api/v1/ai/memory/contacts/:contactId', { preHandler: [settingsEdit, requireAdmin] }, async (request, reply) => {
    try {
      const { contactId } = request.params as { contactId: string };
      return await listCustomerMemories(await actorFromRequest(request), contactId);
    } catch (error) {
      return handleMemoryError(reply, error);
    }
  });

  app.post('/api/v1/ai/memory/contacts/:contactId', { preHandler: [settingsEdit, requireAdmin] }, async (request, reply) => {
    try {
      const { contactId } = request.params as { contactId: string };
      return await upsertCustomerMemory(await actorFromRequest(request), contactId, {
        ...((request.body ?? {}) as Record<string, unknown>),
        source: 'manual',
      } as any);
    } catch (error) {
      return handleMemoryError(reply, error);
    }
  });

  app.patch('/api/v1/ai/memory/:memoryId', { preHandler: [settingsEdit, requireAdmin] }, async (request, reply) => {
    try {
      const { memoryId } = request.params as { memoryId: string };
      return await updateCustomerMemory(await actorFromRequest(request), memoryId, (request.body ?? {}) as any);
    } catch (error) {
      return handleMemoryError(reply, error);
    }
  });

  app.delete('/api/v1/ai/memory/:memoryId', { preHandler: [settingsEdit, requireAdmin] }, async (request, reply) => {
    try {
      const { memoryId } = request.params as { memoryId: string };
      const body = (request.body ?? {}) as { reason?: string };
      return await deleteCustomerMemory(await actorFromRequest(request), memoryId, body.reason);
    } catch (error) {
      return handleMemoryError(reply, error);
    }
  });
}
