// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyInstance, FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { aiPermissions } from '../ai-control-plane-permissions.js';
import { AIErrorHandler } from '../core/ai-error-handler.js';
import { getTokenEncryptionKeyReadiness } from '../../integrations/_shared/token-encryption.util.js';
import { prisma } from '../../../shared/database/prisma-client.js';
import { ResearchError, type ResearchActor } from './research-domain.js';
import { researchCapabilities, saveResearchSearchKey } from './research-settings.js';
import * as service from './research-service.js';

type Params = { projectId: string; id: string };
function actor(request: FastifyRequest): ResearchActor { return { orgId: request.user!.orgId, userId: request.user!.id, role: request.user!.role }; }
export async function researchRoutes(app: FastifyInstance) {
  const prefix = '/api/v1/ai/research';
  function route(method: 'GET' | 'POST' | 'PATCH', path: string, guard: preHandlerHookHandler, handler: (request: FastifyRequest, params: Params) => Promise<unknown>) {
    app.route({ method, url: prefix + path, preHandler: guard, bodyLimit: 128000,
      config: { rateLimit: { max: method === 'GET' ? 60 : 10, timeWindow: '1 minute' } },
      schema: { ...(method !== 'GET' ? { body: { type: 'object', maxProperties: 20 } } : {}),
        querystring: { type: 'object', properties: { page: { type: 'integer', minimum: 1, maximum: 10000, default: 1 } }, additionalProperties: false } },
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        try { const result = await handler(request, request.params as Params); return reply.code(method === 'POST' && path.endsWith('/tasks') ? 202 : 200).send(result); }
        catch (error) {
          if (error instanceof ResearchError) return reply.code(error.statusCode).send({ error: error.message, code: error.code });
          const normalized = AIErrorHandler.normalize(error);
          return reply.code(normalized.statusCode).send({ error: 'Không hoàn thành được thao tác nghiên cứu.', code: normalized.code });
        }
      },
    });
  }
  const access = aiPermissions.knowledge.access, edit = aiPermissions.knowledge.edit, approve = aiPermissions.knowledge.approve;
  const reviewGuard = async (r: FastifyRequest, reply: FastifyReply) => {
    await edit(r, reply);
    if (!reply.sent && (r.body as { status?: string } | undefined)?.status === 'approved') await approve(r, reply);
  };
  const page = (r: FastifyRequest) => (r.query as { page: number }).page;
  route('GET', '/hermes-status', access, async (r) => {
    const setting = await prisma.appSetting.findUnique({ where: { orgId_settingKey: { orgId: actor(r).orgId, settingKey: 'research_hermes_last_seen' } } });
    const lastSeenAt = setting?.valuePlain ?? null;
    return { lastSeenAt, recentlySeen: !!lastSeenAt && Date.now() - Date.parse(lastSeenAt) < 120000 };
  });
  route('GET', '/models', access, async (r) => ({ models: await service.listResearchModels(actor(r)) }));
  route('GET', '/capabilities', access, async (r) => ({ ...await researchCapabilities(actor(r).orgId), encryption: getTokenEncryptionKeyReadiness().ready }));
  route('POST', '/search-connection', aiPermissions.model.manageSecret, async (r) => saveResearchSearchKey(actor(r), r.body));
  route('POST', '/projects/:projectId/direct', edit, async (r, p) => service.useDirectResearch(actor(r), p.projectId, r.body));
  route('GET', '/projects', access, async (r) => ({ projects: await service.listProjects(actor(r), page(r)) }));
  route('POST', '/projects', aiPermissions.knowledge.create, async (r) => service.createProject(actor(r), r.body));
  route('GET', '/projects/:projectId', access, async (r, p) => service.getProject(actor(r), p.projectId));
  route('GET', '/projects/:projectId/sources', access, async (r, p) => ({ sources: await service.listSources(actor(r), p.projectId, page(r)) }));
  route('POST', '/projects/:projectId/sources', edit, async (r, p) => service.addSource(actor(r), p.projectId, r.body));
  route('GET', '/projects/:projectId/pains', access, async (r, p) => ({ pains: await service.listPains(actor(r), p.projectId, page(r)) }));
  route('PATCH', '/projects/:projectId/pains/:id', reviewGuard, async (r, p) => service.reviewPain(actor(r), p.projectId, p.id, r.body));
  route('POST', '/projects/:projectId/pains/:id/merge', edit, async (r, p) => service.mergePains(actor(r), p.projectId, p.id, r.body));
  route('GET', '/projects/:projectId/contents', access, async (r, p) => ({ contents: await service.listContents(actor(r), p.projectId, page(r)) }));
  route('PATCH', '/projects/:projectId/contents/:id', edit, async (r, p) => service.editContent(actor(r), p.projectId, p.id, r.body));
  route('POST', '/projects/:projectId/contents/:id/approve', approve, async (r, p) => service.approveContent(actor(r), p.projectId, p.id));
  const taskGuard = async (r: FastifyRequest, reply: FastifyReply) => {
    await edit(r, reply);
    if (!reply.sent && (r.body as { kind?: string })?.kind === 'generate_batch') await approve(r, reply);
  };
  route('POST', '/projects/:projectId/tasks', taskGuard, async (r, p) => service.createTask(actor(r), p.projectId, r.body));
  route('GET', '/projects/:projectId/tasks/:id', access, async (r, p) => {
    const task = await prisma.customerResearchTask.findFirst({ where: { orgId: actor(r).orgId, projectId: p.projectId, id: p.id }, select: { id: true, projectId: true, kind: true, status: true, input: true, checkpoint: true, errorCode: true, cancelRequested: true, createdAt: true, completedAt: true } });
    if (!task) throw new ResearchError('Không tìm thấy công việc.', 404, 'RESEARCH_TASK_NOT_FOUND'); return task;
  });
  route('POST', '/projects/:projectId/tasks/:id/cancel', edit, async (r, p) => service.controlTask(actor(r), p.projectId, p.id, 'cancel'));
  route('POST', '/projects/:projectId/tasks/:id/retry', edit, async (r, p) => service.controlTask(actor(r), p.projectId, p.id, 'retry'));
}
