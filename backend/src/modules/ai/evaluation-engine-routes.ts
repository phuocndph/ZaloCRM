import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { AIErrorHandler } from './core/ai-error-handler.js';
import { EvaluationEngineError, runEvaluation, seedInitialEvaluationCases, type EvaluationTarget } from './evaluation-engine-service.js';
const settingsEdit = requireGrant('settings', 'edit');
const actor = (request: FastifyRequest) => ({ orgId: request.user!.orgId, userId: request.user!.id });
async function requireAdmin(request: FastifyRequest, reply: FastifyReply) { if (!['owner', 'admin'].includes(request.user!.role)) return reply.status(403).send({ error: 'Admin access required', code: 'ADMIN_REQUIRED' }); }
function fail(reply: FastifyReply, error: unknown) { if (error instanceof EvaluationEngineError) return reply.status(error.statusCode).send({ error: error.message, code: error.code }); const normalized = AIErrorHandler.normalize(error); return reply.status(normalized.statusCode).send({ error: normalized.message, code: normalized.code }); }
export async function evaluationEngineRoutes(app: FastifyInstance) {
  app.post('/api/v1/ai/evaluations/seed-initial-suite', { preHandler: [settingsEdit, requireAdmin] }, async (request, reply) => { try { return await seedInitialEvaluationCases(actor(request)); } catch (error) { return fail(reply, error); } });
  app.post('/api/v1/ai/evaluations/runs', { preHandler: [settingsEdit, requireAdmin] }, async (request, reply) => { try { const body = request.body as { name?: string; targetType?: EvaluationTarget; targetId?: string; promptVersionId?: string; modelConfigId?: string; outputs?: Record<string, any>; threshold?: number }; if (!body.name || !body.targetType || !body.targetId || !body.outputs) return reply.status(400).send({ error: 'name, targetType, targetId and outputs are required' }); return await runEvaluation(actor(request), { name: body.name, targetType: body.targetType, targetId: body.targetId, promptVersionId: body.promptVersionId, modelConfigId: body.modelConfigId, outputs: body.outputs, threshold: body.threshold }); } catch (error) { return fail(reply, error); } });
}