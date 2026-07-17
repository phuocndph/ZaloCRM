import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { aiPermissions } from './ai-control-plane-permissions.js';
import { AIErrorHandler } from './core/ai-error-handler.js';
import { EvaluationEngineError, seedInitialEvaluationCases, type EvaluationTarget } from './evaluation-engine-service.js';
import {
  AI_EVALUATION_RUN_STATUSES,
  AI_EVALUATION_TARGETS,
  getEvaluationRun,
  listEvaluationRuns,
  type AiEvaluationRunStatus,
} from './evaluation-history-service.js';
import { runServerEvaluation } from './evaluation-server-runner-service.js';
const actor = (request: FastifyRequest) => ({ orgId: request.user!.orgId, userId: request.user!.id });
function fail(reply: FastifyReply, error: unknown) { if (error instanceof EvaluationEngineError) return reply.status(error.statusCode).send({ error: error.message, code: error.code }); const normalized = AIErrorHandler.normalize(error); return reply.status(normalized.statusCode).send({ error: normalized.message, code: normalized.code }); }
export async function evaluationEngineRoutes(app: FastifyInstance) {
  app.post('/api/v1/ai/evaluations/seed-initial-suite', { preHandler: aiPermissions.evaluation.create }, async (request, reply) => { try { return await seedInitialEvaluationCases(actor(request)); } catch (error) { return fail(reply, error); } });
  app.get('/api/v1/ai/evaluations/runs', { preHandler: aiPermissions.evaluation.access }, async (request, reply) => {
    try {
      const query = request.query as { status?: string; targetType?: string; targetId?: string; limit?: string };
      if (query.status && !AI_EVALUATION_RUN_STATUSES.includes(query.status as AiEvaluationRunStatus)) {
        return reply.status(400).send({ error: 'Invalid evaluation run status', code: 'EVALUATION_STATUS_INVALID' });
      }
      if (query.targetType && !AI_EVALUATION_TARGETS.includes(query.targetType as EvaluationTarget)) {
        return reply.status(400).send({ error: 'Invalid evaluation target type', code: 'EVALUATION_TARGET_INVALID' });
      }
      return await listEvaluationRuns(request.user!.orgId, {
        status: query.status as AiEvaluationRunStatus | undefined,
        targetType: query.targetType as EvaluationTarget | undefined,
        targetId: query.targetId,
        limit: query.limit ? Number(query.limit) : undefined,
      });
    } catch (error) {
      return fail(reply, error);
    }
  });
  app.get('/api/v1/ai/evaluations/runs/:id', { preHandler: aiPermissions.evaluation.access }, async (request, reply) => {
    try {
      return await getEvaluationRun(request.user!.orgId, (request.params as { id: string }).id);
    } catch (error) {
      return fail(reply, error);
    }
  });
  app.post(
    '/api/v1/ai/evaluations/runs',
    { preHandler: aiPermissions.evaluation.create },
    async (request, reply) => {
      try {
        const body = request.body as {
          name?: string;
          targetType?: EvaluationTarget;
          targetId?: string;
          promptVersionId?: string;
          modelConfigId?: string;
          threshold?: number;
          outputs?: unknown;
        };

        if (body.outputs !== undefined) {
          return reply.status(400).send({
            error: 'Client-provided outputs are not accepted. Evaluation runs on the server.',
            code: 'CLIENT_OUTPUTS_NOT_ALLOWED',
          });
        }
        if (!body.name || !body.targetType || !body.targetId) {
          return reply.status(400).send({
            error: 'name, targetType and targetId are required',
            code: 'EVALUATION_INPUT_REQUIRED',
          });
        }

        return await runServerEvaluation(actor(request), {
          name: body.name,
          targetType: body.targetType,
          targetId: body.targetId,
          promptVersionId: body.promptVersionId,
          modelConfigId: body.modelConfigId,
          threshold: body.threshold,
        });
      } catch (error) {
        return fail(reply, error);
      }
    },
  );
}