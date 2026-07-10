// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * followup-routes.ts — REST cho Follow-up Workflow (🟢 Community).
 * Prefix /api/v1/followup. Auth + tenant (orgId từ JWT).
 *
 * Marketing: CRUD workflow, publish/pause, thống kê, danh sách KH, chạy thử.
 * Chat: trạng thái + timeline theo contact, enroll/dừng/hoàn thành-task.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import {
  createWorkflow, updateWorkflow, setStatus, listWorkflows, getWorkflow, getStats,
  listEnrollments, getContactFollowup, listActiveWorkflows, type WorkflowInput,
  previewDelete, archiveWorkflow, deleteWorkflow,
} from './followup-service.js';
import {
  listTemplates, listCategories, getTemplate, templateDetail, templateToWorkflowInput,
} from './followup-templates.js';
import {
  enrollContact, stopEnrollment, completeSaleTask, simulateWorkflow,
} from './followup-engine.js';

type JwtUser = { id: string; email: string; role: string; orgId: string };

export async function followupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  async function displayName(userId: string): Promise<string | undefined> {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null);
    return u?.fullName ?? undefined;
  }

  // ══════════ Marketing: Workflow CRUD ══════════
  app.get('/api/v1/followup/workflows', async (request) => {
    const user = request.user as JwtUser;
    return { success: true, workflows: await listWorkflows(user.orgId) };
  });

  app.get<{ Params: { id: string } }>('/api/v1/followup/workflows/:id', async (request, reply) => {
    const user = request.user as JwtUser;
    const wf = await getWorkflow(request.params.id, user.orgId);
    if (!wf) return reply.status(404).send({ success: false, error: 'not_found' });
    return { success: true, workflow: wf };
  });

  app.post<{ Body: WorkflowInput }>('/api/v1/followup/workflows', async (request, reply) => {
    const user = request.user as JwtUser;
    const b = request.body ?? ({} as WorkflowInput);
    if (!b.name || b.name.trim().length < 2) {
      return reply.status(400).send({ success: false, error: 'VALIDATION_ERROR', errors: { name: 'Tên workflow bắt buộc (≥ 2 ký tự)' } });
    }
    const wf = await createWorkflow(user.orgId, { id: user.id, fullName: await displayName(user.id) }, b);
    return reply.status(201).send({ success: true, workflow: wf });
  });

  app.put<{ Params: { id: string }; Body: WorkflowInput }>('/api/v1/followup/workflows/:id', async (request, reply) => {
    const user = request.user as JwtUser;
    const res = await updateWorkflow(request.params.id, user.orgId, request.body ?? {});
    if (res && 'error' in res && res.error === 'not_found') return reply.status(404).send({ success: false, error: 'not_found' });
    return { success: true, workflow: res };
  });

  // Publish / pause / archive
  app.post<{ Params: { id: string }; Body: { status: 'draft' | 'active' | 'paused' | 'archived' } }>(
    '/api/v1/followup/workflows/:id/status', async (request, reply) => {
      const user = request.user as JwtUser;
      const status = request.body?.status;
      if (!['draft', 'active', 'paused', 'archived'].includes(status)) {
        return reply.status(400).send({ success: false, error: 'invalid_status' });
      }
      const res = await setStatus(request.params.id, user.orgId, status);
      if (res && 'error' in res) return reply.status(404).send({ success: false, error: 'not_found' });
      return { success: true, workflow: res };
    });

  app.get<{ Params: { id: string } }>('/api/v1/followup/workflows/:id/stats', async (request, reply) => {
    const user = request.user as JwtUser;
    const stats = await getStats(request.params.id, user.orgId);
    if (!stats) return reply.status(404).send({ success: false, error: 'not_found' });
    return { success: true, stats };
  });

  app.get<{ Params: { id: string }; Querystring: { status?: string; search?: string } }>(
    '/api/v1/followup/workflows/:id/enrollments', async (request, reply) => {
      const user = request.user as JwtUser;
      const rows = await listEnrollments(request.params.id, user.orgId, {
        status: request.query?.status, search: request.query?.search,
      });
      if (rows === null) return reply.status(404).send({ success: false, error: 'not_found' });
      return { success: true, enrollments: rows };
    });

  // Chạy thử (dry-run) — mô phỏng, KHÔNG gửi.
  app.post<{ Params: { id: string }; Body: { contactId: string } }>(
    '/api/v1/followup/workflows/:id/simulate', async (request, reply) => {
      const user = request.user as JwtUser;
      const wf = await getWorkflow(request.params.id, user.orgId);
      if (!wf) return reply.status(404).send({ success: false, error: 'not_found' });
      const contactId = request.body?.contactId;
      if (!contactId) return reply.status(400).send({ success: false, error: 'contact_required' });
      const c = await prisma.contact.findFirst({ where: { id: contactId, orgId: user.orgId }, select: { id: true } });
      if (!c) return reply.status(404).send({ success: false, error: 'contact_not_found' });
      const result = await simulateWorkflow(request.params.id, contactId);
      return { success: true, ...result };
    });

  // Danh sách workflow active (để chọn khi enroll từ chat).
  app.get('/api/v1/followup/active', async (request) => {
    const user = request.user as JwtUser;
    return { success: true, workflows: await listActiveWorkflows(user.orgId) };
  });

  // ══════════ Xoá chiến dịch — 2 mức ══════════

  // Xem trước hậu quả (UI dùng để hiện cảnh báo đúng ngữ cảnh).
  app.get<{ Params: { id: string } }>('/api/v1/followup/workflows/:id/delete-preview', async (request, reply) => {
    const user = request.user as JwtUser;
    const res = await previewDelete(request.params.id, user.orgId);
    if ('error' in res) return reply.status(404).send({ success: false, error: 'not_found' });
    return { success: true, preview: res };
  });

  // Lưu trữ: giữ lịch sử, dừng mọi KH đang chạy.
  app.post<{ Params: { id: string } }>('/api/v1/followup/workflows/:id/archive', async (request, reply) => {
    const user = request.user as JwtUser;
    const res = await archiveWorkflow(request.params.id, user.orgId, { actorId: user.id, actorName: await displayName(user.id) });
    if ('error' in res) return reply.status(404).send({ success: false, error: 'not_found' });
    return { success: true, ...res };
  });

  // Xoá vĩnh viễn: CHỈ khi chưa từng có khách nào (server tự chặn, không tin UI).
  app.delete<{ Params: { id: string } }>('/api/v1/followup/workflows/:id', async (request, reply) => {
    const user = request.user as JwtUser;
    const res = await deleteWorkflow(request.params.id, user.orgId);
    if ('error' in res) {
      if (res.error === 'not_found') return reply.status(404).send({ success: false, error: 'not_found' });
      return reply.status(409).send({
        success: false, error: 'has_enrollments', enrollments: res.enrollments,
        message: 'Chiến dịch đã có khách hàng tham gia — hãy dùng "Lưu trữ" để giữ lịch sử.',
      });
    }
    return { success: true, ...res };
  });

  // ══════════ Kho chiến dịch mẫu (template = code, bất biến) ══════════

  app.get('/api/v1/followup/templates', async () => ({
    success: true, templates: listTemplates(), categories: listCategories(),
  }));

  app.get<{ Params: { key: string } }>('/api/v1/followup/templates/:key', async (request, reply) => {
    const t = getTemplate(request.params.key);
    if (!t) return reply.status(404).send({ success: false, error: 'template_not_found' });
    return { success: true, template: templateDetail(t) };
  });

  // Tạo chiến dịch NHÁP từ mẫu → FE mở builder cho user sửa trước khi Kích hoạt.
  // Chiến dịch là bản SAO độc lập; sửa mẫu về sau không ảnh hưởng nó.
  app.post<{ Params: { key: string }; Body: { name?: string } }>(
    '/api/v1/followup/templates/:key/use',
    async (request, reply) => {
      const user = request.user as JwtUser;
      const t = getTemplate(request.params.key);
      if (!t) return reply.status(404).send({ success: false, error: 'template_not_found' });
      const input = templateToWorkflowInput(t);
      if (request.body?.name?.trim()) input.name = request.body.name.trim();
      const wf = await createWorkflow(user.orgId, { id: user.id, fullName: await displayName(user.id) }, input);
      return reply.status(201).send({ success: true, workflow: wf, fromTemplate: t.key });
    },
  );

  // ══════════ Enrollment control ══════════
  app.post<{ Body: { workflowId: string; contactId: string; zaloAccountId: string; onConflict?: 'keep' | 'switch' } }>(
    '/api/v1/followup/enroll', async (request, reply) => {
      const user = request.user as JwtUser;
      const b = request.body ?? ({} as any);
      if (!b.workflowId || !b.contactId || !b.zaloAccountId) {
        return reply.status(400).send({ success: false, error: 'missing_params' });
      }
      // Ownership: workflow + contact thuộc org.
      const [wf, contact] = await Promise.all([
        prisma.followupWorkflow.findFirst({ where: { id: b.workflowId, orgId: user.orgId }, select: { id: true } }),
        prisma.contact.findFirst({ where: { id: b.contactId, orgId: user.orgId }, select: { id: true } }),
      ]);
      if (!wf || !contact) return reply.status(404).send({ success: false, error: 'not_found' });

      const res = await enrollContact({
        workflowId: b.workflowId, contactId: b.contactId, zaloAccountId: b.zaloAccountId,
        actorType: 'sale', actorId: user.id, actorName: await displayName(user.id),
        onConflict: b.onConflict,
      });
      if (!res.ok) {
        if (res.conflict) return reply.status(409).send({ success: false, error: 'already_in_workflow', conflict: res.conflict });
        return reply.status(400).send({ success: false, error: res.error });
      }
      return { success: true, enrollmentId: res.enrollmentId };
    });

  app.post<{ Params: { id: string } }>('/api/v1/followup/enrollments/:id/stop', async (request, reply) => {
    const user = request.user as JwtUser;
    const enr = await prisma.followupEnrollment.findFirst({ where: { id: request.params.id, orgId: user.orgId }, select: { id: true } });
    if (!enr) return reply.status(404).send({ success: false, error: 'not_found' });
    await stopEnrollment(request.params.id, 'sale_stopped', { actorType: 'sale', actorId: user.id, actorName: await displayName(user.id) });
    return { success: true };
  });

  app.post<{ Params: { id: string } }>('/api/v1/followup/enrollments/:id/complete-task', async (request, reply) => {
    const user = request.user as JwtUser;
    const enr = await prisma.followupEnrollment.findFirst({ where: { id: request.params.id, orgId: user.orgId }, select: { id: true } });
    if (!enr) return reply.status(404).send({ success: false, error: 'not_found' });
    const ok = await completeSaleTask(request.params.id, { actorId: user.id, actorName: await displayName(user.id) });
    if (!ok) return reply.status(400).send({ success: false, error: 'not_waiting_sale' });
    return { success: true };
  });

  // ══════════ Chat: theo contact ══════════
  app.get<{ Params: { contactId: string } }>('/api/v1/followup/contacts/:contactId', async (request, reply) => {
    const user = request.user as JwtUser;
    const contact = await prisma.contact.findFirst({ where: { id: request.params.contactId, orgId: user.orgId }, select: { id: true } });
    if (!contact) return reply.status(404).send({ success: false, error: 'not_found' });
    return { success: true, ...(await getContactFollowup(request.params.contactId, user.orgId)) };
  });
}
