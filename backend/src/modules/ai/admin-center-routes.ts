import type { FastifyInstance, FastifyReply } from 'fastify';
import { AIErrorHandler } from './core/ai-error-handler.js';
import { AiAdminCenterError, adminCenterAudit, adminCenterSummary, setAdminEmergencyStop } from './admin-center-service.js';
import { AiReadinessError, getAiReadiness, testProviderConnection } from './ai-readiness-service.js';
import { aiPermissions } from './ai-control-plane-permissions.js';

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof AiAdminCenterError || error instanceof AiReadinessError) {
    return reply.status(error.statusCode).send({ error: error.message, code: error.code });
  }
  const normalized = AIErrorHandler.normalize(error);
  return reply.status(normalized.statusCode).send({ error: normalized.message, code: normalized.code });
}

export async function adminCenterRoutes(app: FastifyInstance) {
  app.get('/api/v1/ai/admin/readiness', { preHandler: aiPermissions.overview.access }, async (request, reply) => {
    try {
      return await getAiReadiness(request.user!.orgId);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/admin/providers/:provider/test', {
    preHandler: aiPermissions.model.manageSecret,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    try {
      const { provider } = request.params as { provider: string };
      const body = (request.body ?? {}) as { model?: string };
      const result = await testProviderConnection(request.user!.orgId, provider, body.model);
      return result.ok ? result : reply.status(502).send(result);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/v1/ai/admin-center/summary', { preHandler: aiPermissions.overview.access }, async (request, reply) => {
    try {
      const query = request.query as { from?: string; to?: string };
      return await adminCenterSummary(request.user!.orgId, query);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get('/api/v1/ai/admin-center/audit', { preHandler: aiPermissions.audit.access }, async (request, reply) => {
    try {
      const query = request.query as { from?: string; to?: string; limit?: string };
      return {
        logs: await adminCenterAudit(request.user!.orgId, {
          from: query.from,
          to: query.to,
          limit: query.limit ? Number(query.limit) : undefined,
        }),
      };
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.post('/api/v1/ai/admin-center/emergency-stop', { preHandler: aiPermissions.autoReply.emergencyStop }, async (request, reply) => {
    try {
      const body = request.body as { enabled?: boolean };
      if (typeof body.enabled !== 'boolean') {
        return reply.status(400).send({ error: 'enabled boolean is required' });
      }
      return await setAdminEmergencyStop(
        { orgId: request.user!.orgId, userId: request.user!.id },
        body.enabled,
      );
    } catch (error) {
      return fail(reply, error);
    }
  });
}
