import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { aiPermissions } from './ai-control-plane-permissions.js';
import { AIErrorHandler } from './core/ai-error-handler.js';
import {
  AI_RELEASE_STATUSES,
  ReleaseError,
  approveRelease,
  createRelease,
  deployRelease,
  getRelease,
  listReleases,
  rollbackRelease,
  submitRelease,
  type AiReleaseStatus,
  type ReleaseSnapshotRefs,
} from './release-service.js';

function actor(request: FastifyRequest) {
  return { orgId: request.user!.orgId, userId: request.user!.id };
}

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof ReleaseError) {
    return reply.status(error.statusCode).send({ error: error.message, code: error.code });
  }
  const normalized = AIErrorHandler.normalize(error);
  return reply.status(normalized.statusCode).send({ error: normalized.message, code: normalized.code });
}

export async function releaseRoutes(app: FastifyInstance) {
  app.get('/api/v1/ai/releases', { preHandler: aiPermissions.deployment.access }, async (request, reply) => {
    try {
      const query = request.query as { status?: string; limit?: string };
      if (query.status && !AI_RELEASE_STATUSES.includes(query.status as AiReleaseStatus)) {
        return reply.status(400).send({ error: 'Invalid release status', code: 'RELEASE_STATUS_INVALID' });
      }
      return await listReleases(request.user!.orgId, {
        status: query.status as AiReleaseStatus | undefined,
        limit: query.limit ? Number(query.limit) : undefined,
      });
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/releases', { preHandler: aiPermissions.deployment.create }, async (request, reply) => {
    try {
      const body = (request.body ?? {}) as {
        snapshot?: ReleaseSnapshotRefs;
        evaluationRunId?: string | null;
      };
      if (!body.snapshot) {
        return reply.status(400).send({ error: 'snapshot is required', code: 'RELEASE_SNAPSHOT_REQUIRED' });
      }
      const created = await createRelease(actor(request), {
        snapshot: body.snapshot,
        evaluationRunId: body.evaluationRunId,
      });
      return reply.status(201).send(created);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/v1/ai/releases/:id', { preHandler: aiPermissions.deployment.access }, async (request, reply) => {
    try {
      return await getRelease(request.user!.orgId, (request.params as { id: string }).id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/releases/:id/submit', { preHandler: aiPermissions.deployment.create }, async (request, reply) => {
    try {
      const body = (request.body ?? {}) as { evaluationRunId?: string };
      return await submitRelease(actor(request), (request.params as { id: string }).id, body.evaluationRunId);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/releases/:id/approve', { preHandler: aiPermissions.deployment.approve }, async (request, reply) => {
    try {
      return await approveRelease(actor(request), (request.params as { id: string }).id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/releases/:id/deploy', {
    preHandler: aiPermissions.deployment.deploy,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    try {
      return await deployRelease(actor(request), (request.params as { id: string }).id);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/releases/:id/rollback', {
    preHandler: aiPermissions.deployment.rollback,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    try {
      return await rollbackRelease(actor(request), (request.params as { id: string }).id);
    } catch (error) {
      return fail(reply, error);
    }
  });
}
