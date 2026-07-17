import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { aiPermissions } from './ai-control-plane-permissions.js';
import { AIErrorHandler } from './core/ai-error-handler.js';
import {
  AgentManagerError,
  activateAgent,
  approveAgent,
  archiveAgent,
  createAgent,
  deactivateAgent,
  getAgentDetail,
  listAgentReferences,
  listAgents,
  submitAgentForApproval,
  updateAgent,
  type AgentInput,
} from './agent-manager-service.js';

const actor = (request: FastifyRequest) => ({
  orgId: request.user!.orgId,
  userId: request.user!.id,
});

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof AgentManagerError) {
    return reply.status(error.statusCode).send({ error: error.message, code: error.code });
  }
  const normalized = AIErrorHandler.normalize(error);
  return reply.status(normalized.statusCode).send({ error: normalized.message, code: normalized.code });
}

export async function agentManagerRoutes(app: FastifyInstance) {
  app.get('/api/v1/ai/agents', { preHandler: aiPermissions.agent.access }, async (request, reply) => {
    try {
      const query = request.query as { status?: string };
      return { agents: await listAgents(request.user!.orgId, query) };
    } catch (error) { return fail(reply, error); }
  });

  app.get('/api/v1/ai/agents/references', { preHandler: aiPermissions.agent.access }, async (request, reply) => {
    try { return await listAgentReferences(request.user!.orgId); }
    catch (error) { return fail(reply, error); }
  });

  app.get('/api/v1/ai/agents/:id', { preHandler: aiPermissions.agent.access }, async (request, reply) => {
    try { return await getAgentDetail(request.user!.orgId, (request.params as { id: string }).id); }
    catch (error) { return fail(reply, error); }
  });

  app.post('/api/v1/ai/agents', { preHandler: aiPermissions.agent.create }, async (request, reply) => {
    try { return reply.status(201).send(await createAgent(actor(request), request.body as AgentInput)); }
    catch (error) { return fail(reply, error); }
  });

  app.patch('/api/v1/ai/agents/:id', { preHandler: aiPermissions.agent.edit }, async (request, reply) => {
    try { return await updateAgent(actor(request), (request.params as { id: string }).id, request.body as AgentInput); }
    catch (error) { return fail(reply, error); }
  });

  app.delete('/api/v1/ai/agents/:id', { preHandler: aiPermissions.agent.delete }, async (request, reply) => {
    try { return await archiveAgent(actor(request), (request.params as { id: string }).id); }
    catch (error) { return fail(reply, error); }
  });

  app.post('/api/v1/ai/agents/:id/submit', { preHandler: aiPermissions.agent.edit }, async (request, reply) => {
    try { return await submitAgentForApproval(actor(request), (request.params as { id: string }).id); }
    catch (error) { return fail(reply, error); }
  });

  app.post('/api/v1/ai/agents/:id/approve', { preHandler: aiPermissions.agent.approve }, async (request, reply) => {
    try {
      const { note } = (request.body ?? {}) as { note?: string };
      return await approveAgent(actor(request), (request.params as { id: string }).id, note);
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/v1/ai/agents/:id/activate', { preHandler: aiPermissions.agent.approve }, async (request, reply) => {
    try { return await activateAgent(actor(request), (request.params as { id: string }).id); }
    catch (error) { return fail(reply, error); }
  });

  app.post('/api/v1/ai/agents/:id/deactivate', { preHandler: aiPermissions.agent.edit }, async (request, reply) => {
    try { return await deactivateAgent(actor(request), (request.params as { id: string }).id); }
    catch (error) { return fail(reply, error); }
  });
}
