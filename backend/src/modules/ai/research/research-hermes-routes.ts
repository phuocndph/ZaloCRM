// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withTenant } from '../../../shared/tenant/tenant-context.js';
import { prisma } from '../../../shared/database/prisma-client.js';
import { ResearchError } from './research-domain.js';
import { claimHermesTask, completeHermesTask, updateHermesTask } from './research-hermes-service.js';

// Registered inside publicApiRoutes: inherits its existing X-API-Key authentication.
export async function researchHermesRoutes(app: FastifyInstance) {
  async function execute(request: FastifyRequest, fn: (orgId: string) => Promise<unknown>, recordContact = true) {
    const orgId = (request as FastifyRequest & { orgId?: string }).orgId;
    if (!orgId) throw new ResearchError('Cần API key hợp lệ.', 401, 'RESEARCH_API_KEY_REQUIRED');
    return withTenant(orgId, async () => {
      if (recordContact) {
        const valuePlain = new Date().toISOString();
        await prisma.appSetting.upsert({ where: { orgId_settingKey: { orgId, settingKey: 'research_hermes_last_seen' } },
          create: { orgId, settingKey: 'research_hermes_last_seen', valuePlain }, update: { valuePlain } });
      }
      return fn(orgId);
    });
  }
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ResearchError) return reply.code(error.statusCode).send({ error: error.message, code: error.code });
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode && statusCode < 500) return reply.code(statusCode).send({ error: 'Yêu cầu không hợp lệ.' });
    return reply.code(500).send({ error: 'Không xử lý được công việc Hermes.', code: 'RESEARCH_HERMES_ERROR' });
  });
  app.post('/api/public/research/hermes/check', {
    bodyLimit: 2048, schema: { body: { type: 'object', maxProperties: 0 } },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, (r) => execute(r, async () => ({ ok: true, protocolVersion: 2, message: 'Kết nối nghiên cứu hợp lệ. Cần chạy bridge --watch để tự nhận việc.' }), false));
  app.post('/api/public/research/hermes/claim', {
    bodyLimit: 2048, schema: { body: { type: 'object', maxProperties: 0 } },
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, (r) => execute(r, claimHermesTask));
  for (const action of ['progress', 'complete', 'fail'] as const) {
    app.post<{ Params: { taskId: string } }>(`/api/public/research/hermes/tasks/:taskId/${action}`, {
      bodyLimit: action === 'complete' ? 1_000_000 : 4096,
      schema: { body: { type: 'object', required: ['leaseToken'], properties: { leaseToken: { type: 'string', minLength: 1, maxLength: 100 } }, maxProperties: 3 } },
      config: { rateLimit: { max: action === 'progress' ? 60 : 15, timeWindow: '1 minute' } },
    }, (r) => execute(r, (orgId) => action === 'complete'
      ? completeHermesTask(orgId, r.params.taskId, r.body)
      : updateHermesTask(orgId, r.params.taskId, r.body, action)));
  }
}
