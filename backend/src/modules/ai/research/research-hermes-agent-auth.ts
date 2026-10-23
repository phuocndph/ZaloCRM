// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyReply, FastifyRequest } from 'fastify';
import { withTenant } from '../../../shared/tenant/tenant-context.js';
import { authenticateAgent } from '../../agents/agent-store.js';
import { AgentError } from '../../agents/agent-policy.js';
import { userHasGrant } from '../../rbac/permission-group-service.js';

// Dedicated Agent credentials must never authorize unrelated legacy public API routes.
export async function authenticateHermesResearchAgent(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const route = request.routeOptions.url;
  const authorization = request.headers.authorization;
  if (!route?.startsWith('/api/public/research/hermes/') || !authorization) return false;
  try {
    const token = /^Bearer (\S+)$/.exec(authorization)?.[1];
    if (!token) throw new AgentError(401, 'AGENT_UNAUTHORIZED');
    const actor = await authenticateAgent(token);
    if (!actor.config.permissions.includes('research_execute')) throw new AgentError(403, 'AGENT_RESEARCH_PERMISSION_REQUIRED');
    const allowed = await withTenant(actor.orgId, () => userHasGrant(actor.user.id, 'ai_knowledge', 'edit'), { userId: actor.user.id, role: actor.user.role });
    if (!allowed) throw new AgentError(403, 'AGENT_RESEARCH_GRANT_REQUIRED');
    (request as FastifyRequest & { orgId: string }).orgId = actor.orgId;
  } catch (error) {
    if (error instanceof AgentError) reply.code(error.statusCode).send({ error: error.code });
    else reply.code(500).send({ error: 'AGENT_INTERNAL_ERROR' });
  }
  return true;
}
