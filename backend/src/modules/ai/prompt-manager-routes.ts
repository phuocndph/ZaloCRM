import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { AIErrorHandler } from './core/ai-error-handler.js';
import {
  PromptManagerError,
  createPrompt,
  createPromptVersion,
  deletePrompt,
  getPromptDetail,
  listPromptSkills,
  listPrompts,
  previewPromptVersion,
  rollbackPrompt,
  testPromptVersion,
  transitionPromptVersion,
  updatePrompt,
  type PromptScope,
  type PromptStatus,
} from './prompt-manager-service.js';

const settingsEdit = requireGrant('settings', 'edit');

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!['owner', 'admin'].includes(request.user!.role)) {
    return reply.status(403).send({ error: 'Admin access required', code: 'ADMIN_REQUIRED' });
  }
}

const guards = [settingsEdit, requireAdmin];

function actor(request: FastifyRequest) {
  return { orgId: request.user!.orgId, userId: request.user!.id };
}

function handleError(reply: FastifyReply, error: unknown) {
  if (error instanceof PromptManagerError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }
  const normalized = AIErrorHandler.normalize(error);
  return reply.status(normalized.statusCode).send({ error: normalized.message, code: normalized.code });
}

export async function promptManagerRoutes(app: FastifyInstance) {
  app.get('/api/v1/ai/prompts', { preHandler: guards }, async (request, reply) => {
    try {
      const query = request.query as { scope?: string; skillId?: string };
      return { prompts: await listPrompts(request.user!.orgId, query) };
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.get('/api/v1/ai/prompts/skills', { preHandler: guards }, async (request, reply) => {
    try {
      return { skills: await listPromptSkills(request.user!.orgId) };
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.get('/api/v1/ai/prompts/model-configs', { preHandler: guards }, async (request, reply) => {
    try {
      const configs = await prisma.aiModelConfig.findMany({
        where: { orgId: request.user!.orgId, deletedAt: null, status: { in: ['active', 'approved'] } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, provider: true, model: true, status: true },
      });
      return { modelConfigs: configs };
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post('/api/v1/ai/prompts', { preHandler: guards }, async (request, reply) => {
    try {
      const body = request.body as {
        key?: string; name?: string; taskType?: string; scope?: PromptScope;
        skillId?: string | null; content?: string; changeNote?: string;
      };
      const created = await createPrompt(actor(request), body);
      return reply.status(201).send(created);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.get('/api/v1/ai/prompts/:id', { preHandler: guards }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await getPromptDetail(request.user!.orgId, id);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.patch('/api/v1/ai/prompts/:id', { preHandler: guards }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await updatePrompt(actor(request), id, request.body as {
        name?: string; taskType?: string; scope?: PromptScope; skillId?: string | null;
      });
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.delete('/api/v1/ai/prompts/:id', { preHandler: guards }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      return await deletePrompt(actor(request), id);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post('/api/v1/ai/prompts/:id/versions', { preHandler: guards }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const created = await createPromptVersion(actor(request), id, request.body as {
        content?: string; changeNote?: string;
        inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown>;
      });
      return reply.status(201).send(created);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post('/api/v1/ai/prompts/:id/versions/:versionId/status', { preHandler: guards }, async (request, reply) => {
    try {
      const { id, versionId } = request.params as { id: string; versionId: string };
      const { status } = request.body as { status?: PromptStatus };
      if (!status) return reply.status(400).send({ error: 'status is required' });
      return await transitionPromptVersion(actor(request), id, versionId, status);
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post('/api/v1/ai/prompts/:id/versions/:versionId/preview', { preHandler: guards }, async (request, reply) => {
    try {
      const { id, versionId } = request.params as { id: string; versionId: string };
      const { variables } = (request.body ?? {}) as { variables?: Record<string, unknown> };
      return await previewPromptVersion(actor(request), id, versionId, variables ?? {});
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post('/api/v1/ai/prompts/:id/versions/:versionId/test', { preHandler: guards }, async (request, reply) => {
    try {
      const { id, versionId } = request.params as { id: string; versionId: string };
      return await testPromptVersion(actor(request), id, versionId, request.body as {
        variables?: Record<string, unknown>; testInput?: string; modelConfigId?: string;
      });
    } catch (error) {
      return handleError(reply, error);
    }
  });

  app.post('/api/v1/ai/prompts/:id/rollback', { preHandler: guards }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { versionId } = request.body as { versionId?: string };
      if (!versionId) return reply.status(400).send({ error: 'versionId is required' });
      return await rollbackPrompt(actor(request), id, versionId);
    } catch (error) {
      return handleError(reply, error);
    }
  });
}
