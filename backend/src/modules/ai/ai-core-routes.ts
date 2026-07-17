import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { aiPermissions } from './ai-control-plane-permissions.js';
import { AIErrorHandler, aiClient } from './core/index.js';

export async function aiCoreRoutes(app: FastifyInstance) {
  app.post(
    '/api/v1/ai/internal/test-connection',
    {
      preHandler: aiPermissions.model.manageSecret,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as { modelConfigId?: string };
      if (!body.modelConfigId) return reply.status(400).send({ error: 'modelConfigId is required' });
      try {
        const result = await aiClient.complete({
          orgId: request.user!.orgId,
          modelConfigId: body.modelConfigId,
          taskType: 'connection_test',
          messages: [
            { role: 'system', content: 'This is a connectivity test. Do not include secrets or user data.' },
            { role: 'user', content: 'Reply with OK.' },
          ],
          maxTokens: 8,
          temperature: 0,
        });
        return {
          ok: true,
          requestId: result.requestId,
          provider: result.provider,
          model: result.model,
          usedFallback: result.usedFallback,
          latencyMs: result.usage.latencyMs,
          usage: {
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            cachedInputTokens: result.usage.cachedInputTokens,
            costMicros: result.usage.costMicros.toString(),
          },
        };
      } catch (error) {
        const normalized = AIErrorHandler.normalize(error);
        return reply.status(normalized.statusCode).send({
          ok: false,
          error: AIErrorHandler.publicBody(normalized),
        });
      }
    },
  );
}
