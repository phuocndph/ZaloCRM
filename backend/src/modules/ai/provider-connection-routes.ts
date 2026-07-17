import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { aiPermissions } from './ai-control-plane-permissions.js';
import { AIErrorHandler } from './core/ai-error-handler.js';
import {
  ProviderConnectionError,
  createProviderConnection,
  deleteProviderConnection,
  discoverProviderConnectionModels,
  getProviderConnection,
  getProviderConnectionImpact,
  listProviderConnections,
  revokeProviderConnectionSecret,
  setProviderConnectionSecret,
  testProviderConnection,
  updateProviderConnection,
  type CreateProviderConnectionInput,
  type UpdateProviderConnectionInput,
} from './provider-connection-service.js';

const actor = (request: FastifyRequest) => ({
  orgId: request.user!.orgId,
  userId: request.user!.id,
});

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof ProviderConnectionError) {
    return reply.status(error.statusCode).send({ error: error.message, code: error.code });
  }
  const normalized = AIErrorHandler.normalize(error);
  return reply.status(normalized.statusCode).send({
    error: normalized.message,
    code: normalized.code,
    retryable: normalized.retryable,
  });
}

export async function providerConnectionRoutes(app: FastifyInstance) {
  app.get('/api/v1/ai/provider-connections', { preHandler: aiPermissions.model.access }, async (request, reply) => {
    try {
      const query = request.query as { status?: string; vendor?: string; search?: string };
      return {
        connections: await listProviderConnections(request.user!.orgId, query),
      };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/provider-connections', { preHandler: aiPermissions.model.create }, async (request, reply) => {
    try {
      // API keys are deliberately ignored here. They can only be written via
      // the manage_secret-protected endpoint below.
      const body = (request.body ?? {}) as CreateProviderConnectionInput;
      const created = await createProviderConnection(actor(request), {
        key: body.key,
        name: body.name,
        adapter: body.adapter,
        vendor: body.vendor,
        baseUrl: body.baseUrl,
      });
      return reply.status(201).send(created);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/v1/ai/provider-connections/:id/impact', { preHandler: aiPermissions.model.access }, async (request, reply) => {
    try {
      return await getProviderConnectionImpact(
        request.user!.orgId,
        (request.params as { id: string }).id,
      );
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/v1/ai/provider-connections/:id/models', {
    preHandler: aiPermissions.model.manageSecret,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    try {
      return await discoverProviderConnectionModels(
        request.user!.orgId,
        (request.params as { id: string }).id,
      );
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/provider-connections/:id/test', {
    preHandler: aiPermissions.model.manageSecret,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    try {
      return await testProviderConnection(
        actor(request),
        (request.params as { id: string }).id,
        (request.body ?? {}) as { model?: unknown },
      );
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/v1/ai/provider-connections/:id', { preHandler: aiPermissions.model.access }, async (request, reply) => {
    try {
      return await getProviderConnection(
        request.user!.orgId,
        (request.params as { id: string }).id,
      );
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.patch('/api/v1/ai/provider-connections/:id', { preHandler: aiPermissions.model.edit }, async (request, reply) => {
    try {
      return await updateProviderConnection(
        actor(request),
        (request.params as { id: string }).id,
        (request.body ?? {}) as UpdateProviderConnectionInput,
      );
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.put('/api/v1/ai/provider-connections/:id/secret', { preHandler: aiPermissions.model.manageSecret }, async (request, reply) => {
    try {
      const { apiKey } = (request.body ?? {}) as { apiKey?: unknown };
      return await setProviderConnectionSecret(
        actor(request),
        (request.params as { id: string }).id,
        apiKey,
      );
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete('/api/v1/ai/provider-connections/:id/secret', { preHandler: aiPermissions.model.manageSecret }, async (request, reply) => {
    try {
      return await revokeProviderConnectionSecret(
        actor(request),
        (request.params as { id: string }).id,
      );
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.delete('/api/v1/ai/provider-connections/:id', { preHandler: aiPermissions.model.delete }, async (request, reply) => {
    try {
      return await deleteProviderConnection(
        actor(request),
        (request.params as { id: string }).id,
      );
    } catch (error) {
      return fail(reply, error);
    }
  });
}
