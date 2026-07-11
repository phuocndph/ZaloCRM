import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { buildPrivacyContext } from '../privacy/redact.js';
import { AIErrorHandler } from './core/ai-error-handler.js';
import { ContextBuilderError, EmotionEngineError, analyzeConversationEmotion } from './emotion-engine-service.js';
const settingsEdit = requireGrant('settings', 'edit');
async function requireAdmin(request: FastifyRequest, reply: FastifyReply) { if (!['owner', 'admin'].includes(request.user!.role)) return reply.status(403).send({ error: 'Admin access required', code: 'ADMIN_REQUIRED' }); }
function fail(reply: FastifyReply, error: unknown) { if (error instanceof EmotionEngineError || error instanceof ContextBuilderError) return reply.status(error.statusCode).send({ error: error.message, code: error.code }); const normalized = AIErrorHandler.normalize(error); return reply.status(normalized.statusCode).send({ error: normalized.message, code: normalized.code }); }
export async function emotionEngineRoutes(app: FastifyInstance) { app.post('/api/v1/ai/emotion/conversations/:conversationId/analyze', { preHandler: [settingsEdit, requireAdmin] }, async (request, reply) => { try { const privacy = await buildPrivacyContext(request); const body = (request.body ?? {}) as { modelConfigId?: string; maxTokens?: number }; return await analyzeConversationEmotion({ orgId: request.user!.orgId, userId: request.user!.id, role: request.user!.role, privacyUnlocked: privacy.privacyUnlocked }, (request.params as { conversationId: string }).conversationId, body); } catch (error) { return fail(reply, error); } }); }
