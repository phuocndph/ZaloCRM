import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { aiPermissions } from './ai-control-plane-permissions.js';
import { AIErrorHandler } from './core/ai-error-handler.js';
import {
  ModelConfigError,
  type CreateModelConfigInput,
  type UpdateModelConfigInput,
} from './model-config-service.js';
import {
  createModelConfig,
  getModelConfig,
  listModelConfigs,
} from './model-config-manager-service.js';
import {
  cloneModelConfig,
  updateModelConfig,
} from './model-config-mutation-service.js';
import {
  approveModelConfig,
  archiveModelConfig,
  getModelConfigImpact,
  setDefaultModelConfig,
  submitModelConfig,
  testModelConfig,
} from './model-config-lifecycle-service.js';

const actor = (request: FastifyRequest) => ({
  orgId: request.user!.orgId,
  userId: request.user!.id,
});

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof ModelConfigError) {
    return reply.status(error.statusCode).send({ error: error.message, code: error.code });
  }
  const normalized = AIErrorHandler.normalize(error);
  return reply.status(normalized.statusCode).send({
    error: normalized.message,
    code: normalized.code,
    retryable: normalized.retryable,
  });
}

function createInput(body: CreateModelConfigInput): CreateModelConfigInput {
  return {
    connectionId: body.connectionId,
    logicalKey: body.logicalKey,
    displayName: body.displayName,
    externalModelId: body.externalModelId,
    parameters: body.parameters,
    capabilities: body.capabilities,
    dataPolicy: body.dataPolicy,
    fallbackModelConfigId: body.fallbackModelConfigId,
    changeNote: body.changeNote,
  };
}

function updateInput(body: UpdateModelConfigInput): UpdateModelConfigInput {
  return { ...createInput(body), expectedRevision: body.expectedRevision };
}

export async function modelConfigRoutes(app: FastifyInstance) {
  app.get('/api/v1/ai/model-configs', { preHandler: aiPermissions.model.access }, async (request, reply) => {
    try {
      const query = request.query as { status?: string; connectionId?: string; search?: string };
      return await listModelConfigs(request.user!.orgId, query);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/model-configs', { preHandler: aiPermissions.model.create }, async (request, reply) => {
    try {
      const created = await createModelConfig(
        actor(request),
        createInput((request.body ?? {}) as CreateModelConfigInput),
      );
      return reply.status(201).send(created);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/v1/ai/model-configs/:id/impact', { preHandler: aiPermissions.model.access }, async (request, reply) => {
    try {
      return await getModelConfigImpact(request.user!.orgId, (request.params as { id: string }).id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/v1/ai/model-configs/:id', { preHandler: aiPermissions.model.access }, async (request, reply) => {
    try {
      return await getModelConfig(request.user!.orgId, (request.params as { id: string }).id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.patch('/api/v1/ai/model-configs/:id', { preHandler: aiPermissions.model.edit }, async (request, reply) => {
    try {
      return await updateModelConfig(
        actor(request),
        (request.params as { id: string }).id,
        updateInput((request.body ?? {}) as UpdateModelConfigInput),
      );
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/model-configs/:id/clone', { preHandler: aiPermissions.model.create }, async (request, reply) => {
    try {
      const { changeNote } = (request.body ?? {}) as { changeNote?: unknown };
      const cloned = await cloneModelConfig(
        actor(request),
        (request.params as { id: string }).id,
        { changeNote },
      );
      return reply.status(201).send(cloned);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/model-configs/:id/test', {
    preHandler: aiPermissions.model.edit,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    try {
      return await testModelConfig(actor(request), (request.params as { id: string }).id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/model-configs/:id/submit', { preHandler: aiPermissions.model.edit }, async (request, reply) => {
    try {
      return await submitModelConfig(actor(request), (request.params as { id: string }).id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/model-configs/:id/approve', { preHandler: aiPermissions.model.approve }, async (request, reply) => {
    try {
      return await approveModelConfig(actor(request), (request.params as { id: string }).id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/model-configs/:id/archive', { preHandler: aiPermissions.model.delete }, async (request, reply) => {
    try {
      return await archiveModelConfig(actor(request), (request.params as { id: string }).id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/model-configs/:id/default', { preHandler: aiPermissions.model.edit }, async (request, reply) => {
    try {
      const { expectedRevision } = (request.body ?? {}) as { expectedRevision?: unknown };
      return await setDefaultModelConfig(
        actor(request),
        (request.params as { id: string }).id,
        expectedRevision,
      );
    } catch (error) {
      return fail(reply, error);
    }
  });
}
