// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * outreach-routes.ts — REST cho Outreach Campaign (🟢 Community).
 * Prefix /api/v1/outreach. Auth + tenant (orgId từ JWT).
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { startCampaign, pauseCampaign, resumeCampaign, cancelCampaign, restartCampaign } from './outreach-queue.js';
import { evaluateAudience, type FriendRelation } from './outreach-audience.js';

export async function outreachRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // Helper: campaign thuộc org hiện tại
  async function ownedCampaign(id: string, orgId: string) {
    return prisma.outreachCampaign.findFirst({ where: { id, orgId } });
  }

  // ── POST /campaigns — tạo campaign (draft) ──
  app.post<{ Body: {
    name: string; description?: string; customerListId: string; zaloAccountId: string;
    enableAutoAdd?: boolean; addFriendMessage?: string;
    addDelayMinMs?: number; addDelayMaxMs?: number; maxAddPerDay?: number;
    enableAutoMessage?: boolean; waitAfterAddMinMs?: number; waitAfterAddMaxMs?: number;
    msgDelayMinMs?: number; msgDelayMaxMs?: number; maxMsgPerDay?: number;
    filterRequireTags?: string[]; filterExcludeTags?: string[];
    filterSkipChattedDays?: number | null; filterFriendRelation?: string;
    templates?: Array<{ title?: string; content: string; weight?: number; imageAssetIds?: string[] }>;
  } }>('/api/v1/outreach/campaigns', async (request, reply) => {
    const user = request.user!;
    const b = request.body ?? ({} as typeof request.body);
    // ── Validation per-field (mirror rule FE) — trả errors{} theo từng ô ──
    const errors: Record<string, string> = {};
    const name = (b.name ?? '').trim();
    if (name.length < 3) errors.name = 'Tên chiến dịch bắt buộc (3-100 ký tự)';
    else if (name.length > 100) errors.name = 'Tên chiến dịch tối đa 100 ký tự';
    if (!b.customerListId) errors.customerListId = 'Vui lòng chọn danh sách SĐT';
    if (!b.zaloAccountId) errors.zaloAccountId = 'Vui lòng chọn nick Zalo gửi';
    if (b.enableAutoAdd !== false) {
      const msg = (b.addFriendMessage ?? '').trim();
      if (msg.length < 5) errors.addFriendMessage = 'Lời mời kết bạn bắt buộc (5-500 ký tự)';
      else if (msg.length > 500) errors.addFriendMessage = 'Lời mời kết bạn tối đa 500 ký tự';
      if ((b.addDelayMinMs ?? 0) >= (b.addDelayMaxMs ?? 0)) errors.addDelay = 'Delay tối thiểu phải nhỏ hơn delay tối đa';
    }
    const tpls = (b.templates ?? []).filter(t => t?.content?.trim());
    if (!tpls.length) errors.templates = 'Cần ít nhất 1 mẫu tin nhắn có nội dung';
    if (b.enableAutoMessage !== false) {
      if ((b.msgDelayMinMs ?? 0) >= (b.msgDelayMaxMs ?? 0)) errors.msgDelay = 'Delay tối thiểu phải nhỏ hơn delay tối đa';
      if ((b.waitAfterAddMaxMs ?? 0) <= (b.waitAfterAddMinMs ?? 0)) errors.waitDelay = 'Thời gian chờ: max phải lớn hơn min';
    }
    if (Object.keys(errors).length) {
      return reply.status(400).send({ success: false, error: 'VALIDATION_ERROR', errors });
    }
    // Validate list + nick thuộc org
    const [list, nick] = await Promise.all([
      prisma.customerList.findFirst({ where: { id: b.customerListId, orgId: user.orgId }, select: { id: true } }),
      prisma.zaloAccount.findFirst({ where: { id: b.zaloAccountId, orgId: user.orgId }, select: { id: true } }),
    ]);
    if (!list) return reply.status(400).send({ success: false, error: 'VALIDATION_ERROR', errors: { customerListId: 'Danh sách SĐT không hợp lệ' } });
    if (!nick) return reply.status(400).send({ success: false, error: 'VALIDATION_ERROR', errors: { zaloAccountId: 'Nick Zalo không hợp lệ' } });

    const campaign = await prisma.outreachCampaign.create({
      data: {
        orgId: user.orgId, createdById: user.id, name: b.name.trim(), description: b.description ?? null,
        customerListId: b.customerListId, zaloAccountId: b.zaloAccountId,
        enableAutoAdd: b.enableAutoAdd ?? true, addFriendMessage: b.addFriendMessage ?? null,
        addDelayMinMs: b.addDelayMinMs ?? 2000, addDelayMaxMs: b.addDelayMaxMs ?? 5000, maxAddPerDay: b.maxAddPerDay ?? 100,
        enableAutoMessage: b.enableAutoMessage ?? true,
        waitAfterAddMinMs: b.waitAfterAddMinMs ?? 60000, waitAfterAddMaxMs: b.waitAfterAddMaxMs ?? 120000,
        msgDelayMinMs: b.msgDelayMinMs ?? 3000, msgDelayMaxMs: b.msgDelayMaxMs ?? 8000, maxMsgPerDay: b.maxMsgPerDay ?? 500,
        // Điều kiện gửi (rỗng/'any' = không lọc).
        filterRequireTags: Array.isArray(b.filterRequireTags) ? b.filterRequireTags.filter(Boolean) : [],
        filterExcludeTags: Array.isArray(b.filterExcludeTags) ? b.filterExcludeTags.filter(Boolean) : [],
        filterSkipChattedDays: b.filterSkipChattedDays != null && b.filterSkipChattedDays > 0 ? Math.floor(b.filterSkipChattedDays) : null,
        filterFriendRelation: ['friend_only', 'non_friend_only'].includes(b.filterFriendRelation ?? '') ? b.filterFriendRelation! : 'any',
        templates: b.templates?.length ? {
          create: b.templates.filter(t => t.content?.trim()).map(t => ({
            title: t.title ?? null, content: t.content, weight: Math.max(1, t.weight ?? 1),
            imageAssetIds: Array.isArray(t.imageAssetIds) ? t.imageAssetIds : [],
          })),
        } : undefined,
      },
      include: { templates: true },
    });
    return reply.status(201).send({ success: true, campaign });
  });

  // ── POST /audience/preview — đếm + danh sách theo Điều kiện gửi (dùng lúc tạo, trước khi lưu) ──
  app.post<{ Body: {
    customerListId: string; zaloAccountId: string;
    requireTags?: string[]; excludeTags?: string[];
    skipChattedDays?: number | null; friendRelation?: string;
    search?: string; limit?: number;
  } }>('/api/v1/outreach/audience/preview', async (request, reply) => {
    const user = request.user!;
    const b = request.body ?? ({} as typeof request.body);
    if (!b.customerListId || !b.zaloAccountId) {
      return reply.status(400).send({ error: 'customerListId + zaloAccountId bắt buộc' });
    }
    const [list, nick] = await Promise.all([
      prisma.customerList.findFirst({ where: { id: b.customerListId, orgId: user.orgId }, select: { id: true } }),
      prisma.zaloAccount.findFirst({ where: { id: b.zaloAccountId, orgId: user.orgId }, select: { id: true } }),
    ]);
    if (!list || !nick) return reply.status(400).send({ error: 'Tệp hoặc nick không hợp lệ' });

    const rel = (['friend_only', 'non_friend_only'].includes(b.friendRelation ?? '') ? b.friendRelation : 'any') as FriendRelation;
    const evaluated = await evaluateAudience(user.orgId, b.customerListId, b.zaloAccountId, {
      requireTags: Array.isArray(b.requireTags) ? b.requireTags.filter(Boolean) : [],
      excludeTags: Array.isArray(b.excludeTags) ? b.excludeTags.filter(Boolean) : [],
      skipChattedDays: b.skipChattedDays != null && b.skipChattedDays > 0 ? Math.floor(b.skipChattedDays) : null,
      friendRelation: rel,
    });

    const total = evaluated.length;
    const eligible = evaluated.filter((e) => e.eligible).length;
    const skipped = total - eligible;

    // Danh sách preview: lọc theo search (tên/SĐT), giới hạn để dialog không quá tải.
    const q = (b.search ?? '').trim().toLowerCase();
    const limit = Math.min(Math.max(b.limit ?? 300, 1), 1000);
    const items = evaluated
      .filter((e) => !q || (e.name ?? '').toLowerCase().includes(q) || e.phone.includes(q))
      .slice(0, limit)
      .map((e) => ({ name: e.name, phone: e.phone, tags: e.tags, eligible: e.eligible, reason: e.reason }));

    return { total, eligible, skipped, items };
  });

  // ── GET /campaigns — danh sách ──
  app.get('/api/v1/outreach/campaigns', async (request) => {
    const user = request.user!;
    const campaigns = await prisma.outreachCampaign.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { templates: true } } },
    });
    return { campaigns };
  });

  // ── GET /campaigns/:id — chi tiết + templates ──
  app.get<{ Params: { id: string } }>('/api/v1/outreach/campaigns/:id', async (request, reply) => {
    const user = request.user!;
    const campaign = await prisma.outreachCampaign.findFirst({
      where: { id: request.params.id, orgId: user.orgId },
      include: { templates: { orderBy: { createdAt: 'asc' } } },
    });
    if (!campaign) return reply.status(404).send({ error: 'not_found' });
    return { campaign };
  });

  // ── Templates CRUD ──
  app.post<{ Params: { id: string }; Body: { title?: string; content: string; weight?: number; imageAssetIds?: string[] } }>(
    '/api/v1/outreach/campaigns/:id/templates', async (request, reply) => {
      const user = request.user!;
      if (!(await ownedCampaign(request.params.id, user.orgId))) return reply.status(404).send({ error: 'not_found' });
      if (!request.body?.content?.trim()) return reply.status(400).send({ error: 'content_required' });
      const tpl = await prisma.outreachTemplate.create({
        data: {
          campaignId: request.params.id, title: request.body.title ?? null, content: request.body.content,
          weight: Math.max(1, request.body.weight ?? 1),
          imageAssetIds: Array.isArray(request.body.imageAssetIds) ? request.body.imageAssetIds : [],
        },
      });
      return reply.status(201).send({ success: true, template: tpl });
    });

  app.patch<{ Params: { id: string; tid: string }; Body: { title?: string; content?: string; weight?: number; imageAssetIds?: string[]; isActive?: boolean } }>(
    '/api/v1/outreach/campaigns/:id/templates/:tid', async (request, reply) => {
      const user = request.user!;
      if (!(await ownedCampaign(request.params.id, user.orgId))) return reply.status(404).send({ error: 'not_found' });
      const b = request.body ?? {};
      const tpl = await prisma.outreachTemplate.update({
        where: { id: request.params.tid },
        data: {
          ...(b.title !== undefined && { title: b.title }),
          ...(b.content !== undefined && { content: b.content }),
          ...(b.weight !== undefined && { weight: Math.max(1, b.weight) }),
          ...(b.imageAssetIds !== undefined && { imageAssetIds: b.imageAssetIds }),
          ...(b.isActive !== undefined && { isActive: b.isActive }),
        },
      });
      return { success: true, template: tpl };
    });

  app.delete<{ Params: { id: string; tid: string } }>(
    '/api/v1/outreach/campaigns/:id/templates/:tid', async (request, reply) => {
      const user = request.user!;
      if (!(await ownedCampaign(request.params.id, user.orgId))) return reply.status(404).send({ error: 'not_found' });
      await prisma.outreachTemplate.delete({ where: { id: request.params.tid } });
      return { success: true };
    });

  // Helper lấy tên người thực hiện (operation log).
  async function userName(userId: string): Promise<string | undefined> {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    return u?.fullName ?? undefined;
  }

  // ── Điều khiển: start / pause / resume / cancel ──
  app.post<{ Params: { id: string } }>('/api/v1/outreach/campaigns/:id/start', async (request, reply) => {
    const user = request.user!;
    const c = await ownedCampaign(request.params.id, user.orgId);
    if (!c) return reply.status(404).send({ error: 'not_found' });
    if (c.state === 'running') return reply.status(400).send({ error: 'already_running' });
    try {
      const enqueued = await startCampaign(c.id, { userId: user.id, userName: await userName(user.id), action: 'start' });
      return { success: true, state: 'running', enqueued };
    } catch (err) {
      logger.error({ err }, '[outreach] start failed');
      return reply.status(500).send({ error: 'start_failed' });
    }
  });

  // ── Chạy lại từ đầu — CHỈ khi completed/cancelled ──
  app.post<{ Params: { id: string } }>('/api/v1/outreach/campaigns/:id/restart', async (request, reply) => {
    const user = request.user!;
    const c = await ownedCampaign(request.params.id, user.orgId);
    if (!c) return reply.status(404).send({ error: 'not_found' });
    if (c.state !== 'completed' && c.state !== 'cancelled') {
      return reply.status(400).send({ success: false, error: 'CANNOT_RESTART', message: 'Chiến dịch đang chạy, không thể chạy lại.' });
    }
    try {
      const total = await restartCampaign(c.id, user.id, await userName(user.id));
      return { success: true, state: 'running', total, runCount: (c.runCount ?? 0) + 1 };
    } catch (err) {
      logger.error({ err }, '[outreach] restart failed');
      return reply.status(500).send({ success: false, error: 'restart_failed' });
    }
  });

  // ── Lịch sử chạy (Lần chạy 1/2/3…) ──
  app.get<{ Params: { id: string } }>('/api/v1/outreach/campaigns/:id/runs', async (request, reply) => {
    const user = request.user!;
    if (!(await ownedCampaign(request.params.id, user.orgId))) return reply.status(404).send({ error: 'not_found' });
    const runs = await prisma.outreachRun.findMany({ where: { campaignId: request.params.id }, orderBy: { runNumber: 'desc' } });
    return { runs };
  });

  // ── DELETE /campaigns/:id — xoá chiến dịch (CHỈ khi completed/cancelled) ──
  app.delete<{ Params: { id: string } }>('/api/v1/outreach/campaigns/:id', async (request, reply) => {
    const user = request.user!;
    const c = await ownedCampaign(request.params.id, user.orgId);
    if (!c) return reply.status(404).send({ error: 'not_found' });
    if (c.state !== 'completed' && c.state !== 'cancelled') {
      return reply.status(400).send({ success: false, error: 'CANNOT_DELETE', message: 'Chỉ có thể xoá chiến dịch đã hoàn thành hoặc đã dừng.' });
    }
    try {
      // Cascade xoá templates + logs + phones + runs (onDelete: Cascade trong schema).
      await prisma.outreachCampaign.delete({ where: { id: c.id } });
      logger.info({ campaignId: c.id, userId: user.id }, '[outreach] campaign deleted');
      return { success: true };
    } catch (err) {
      logger.error({ err }, '[outreach] delete failed');
      return reply.status(500).send({ success: false, error: 'delete_failed' });
    }
  });

  for (const [action, fn] of [
    ['pause', pauseCampaign], ['resume', resumeCampaign], ['cancel', cancelCampaign],
  ] as const) {
    app.post<{ Params: { id: string } }>(`/api/v1/outreach/campaigns/:id/${action}`, async (request, reply) => {
      const user = request.user!;
      if (!(await ownedCampaign(request.params.id, user.orgId))) return reply.status(404).send({ error: 'not_found' });
      await fn(request.params.id);
      return { success: true };
    });
  }

  // ── GET /campaigns/:id/progress ──
  app.get<{ Params: { id: string } }>('/api/v1/outreach/campaigns/:id/progress', async (request, reply) => {
    const user = request.user!;
    const c = await ownedCampaign(request.params.id, user.orgId);
    if (!c) return reply.status(404).send({ error: 'not_found' });
    const processed = c.totalAdded + c.totalAddFailed + c.totalSkipped;
    const pct = c.totalTarget > 0 ? Math.round((processed / c.totalTarget) * 1000) / 10 : 0;
    return {
      state: c.state,
      progress: { current: processed, total: c.totalTarget, percentage: pct },
      statistics: {
        totalAdded: c.totalAdded, totalAddFailed: c.totalAddFailed, totalSkipped: c.totalSkipped,
        totalMsgSent: c.totalMsgSent, totalMsgFailed: c.totalMsgFailed,
      },
    };
  });

  // ── GET /campaigns/:id/logs ──
  app.get<{ Params: { id: string }; Querystring: { page?: string; limit?: string; action?: string; status?: string } }>(
    '/api/v1/outreach/campaigns/:id/logs', async (request, reply) => {
      const user = request.user!;
      if (!(await ownedCampaign(request.params.id, user.orgId))) return reply.status(404).send({ error: 'not_found' });
      const page = Math.max(1, parseInt(request.query.page ?? '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? '20', 10) || 20));
      const where: Record<string, unknown> = { campaignId: request.params.id };
      if (request.query.action) where.actionType = request.query.action;
      if (request.query.status) where.status = request.query.status;
      const [logs, total] = await Promise.all([
        prisma.outreachLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
        prisma.outreachLog.count({ where }),
      ]);
      return { logs, pagination: { page, limit, total } };
    });

  // ── GET /campaigns/:id/phones — 1 SỐ = 1 DÒNG (per-phone state) ──
  // Phân trang + search theo SĐT + filter overall + sort (updatedAt|phone) + summary
  // đếm toàn tập (Total/Success/Waiting/Skipped). Tối ưu cho hàng chục nghìn số (index).
  app.get<{ Params: { id: string }; Querystring: { page?: string; limit?: string; search?: string; status?: string; sort?: string } }>(
    '/api/v1/outreach/campaigns/:id/phones', async (request, reply) => {
      const user = request.user!;
      if (!(await ownedCampaign(request.params.id, user.orgId))) return reply.status(404).send({ error: 'not_found' });
      const q = request.query;
      const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(q.limit ?? '50', 10) || 50));
      const where: Record<string, unknown> = { campaignId: request.params.id };
      if (q.search?.trim()) where.phone = { contains: q.search.trim() };
      if (q.status && ['waiting', 'processing', 'success', 'skipped'].includes(q.status)) where.overallStatus = q.status;
      const orderBy = q.sort === 'phone' ? { phone: 'asc' as const } : { updatedAt: 'desc' as const };
      const [phones, total, groups] = await Promise.all([
        prisma.outreachPhone.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit }),
        prisma.outreachPhone.count({ where }),
        prisma.outreachPhone.groupBy({ by: ['overallStatus'], where: { campaignId: request.params.id }, _count: true }),
      ]);
      const summary = { total: 0, success: 0, waiting: 0, processing: 0, skipped: 0 };
      for (const g of groups) {
        const n = typeof g._count === 'number' ? g._count : 0;
        if (g.overallStatus in summary) (summary as Record<string, number>)[g.overallStatus] = n;
        summary.total += n;
      }
      return { phones, pagination: { page, limit, total }, summary };
    });
}
