// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * group-scan-routes.ts — E1 Quét group (🟢 Community).
 * Routes: /api/v1/zalo-accounts/:accountId/group-scans
 *   POST   /                       — tạo scan (selected|all) + enqueue
 *   GET    /:scanId                — trạng thái scan
 *   GET    /:scanId/members        — roster (filter isFriend, phân trang)
 *
 * Auth/error: mirror group-routes.ts (authMiddleware + resolveAccount +
 * checkAccess('read') + handleError).
 */
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { resolveAccount, checkAccess, handleError } from './zalo-route-helpers.js';
import { enqueueGroupScan } from './group-scan-queue.js';

const MAX_GROUPS_PER_SCAN = 5000;

export async function groupScanRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  const BASE = '/api/v1/zalo-accounts/:accountId/group-scans';

  // ── Create scan ───────────────────────────────────────────────────────────
  app.post<{ Params: { accountId: string }; Body: { groupIds?: string[]; all?: boolean } }>(
    BASE,
    async (request, reply) => {
      const { accountId } = request.params;
      const { groupIds, all } = request.body ?? {};
      if (!all && (!Array.isArray(groupIds) || groupIds.length === 0)) {
        return reply.status(400).send({ error: 'groupIds array is required when all is not set' });
      }
      // Chặn payload khổng lồ (review #4): IN (...) lớn + job/row flood.
      if (Array.isArray(groupIds) && groupIds.length > MAX_GROUPS_PER_SCAN) {
        return reply
          .status(400)
          .send({ error: `too many groupIds (max ${MAX_GROUPS_PER_SCAN})` });
      }
      try {
        const account = await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'read'))) return;

        // Dedup in-flight (review #4): 1 nick chỉ 1 scan đang chạy — tránh 2 scan
        // cùng nick race upsert + flood job. Trả scan đang chạy thay vì tạo mới.
        const inFlight = await prisma.groupScan.findFirst({
          where: { zaloAccountId: accountId, orgId: account.orgId, state: { in: ['queued', 'running'] } },
          orderBy: { createdAt: 'desc' },
        });
        if (inFlight) {
          return reply.status(409).send({ error: 'a scan is already running for this account', scan: inFlight });
        }

        let ids: string[];
        let scope: string;
        if (all) {
          // Snapshot toàn bộ group nick đang tham gia → groupIds.
          const res = (await zaloOps.getAllGroups(accountId)) as {
            gridVerMap?: Record<string, string>;
          };
          ids = Object.keys(res?.gridVerMap ?? {});
          scope = 'all';
        } else {
          ids = [...new Set(groupIds!.map(String))];
          scope = 'selected';
        }

        const scan = await prisma.groupScan.create({
          data: {
            orgId: account.orgId,
            zaloAccountId: accountId,
            scope,
            groupIds: ids,
            state: 'queued',
            totalGroups: ids.length,
          },
        });

        await enqueueGroupScan(scan.id);
        return reply.status(201).send({ scan });
      } catch (err) {
        return handleError(reply, err, 'createGroupScan');
      }
    },
  );

  // ── Scan status ───────────────────────────────────────────────────────────
  app.get<{ Params: { accountId: string; scanId: string } }>(
    `${BASE}/:scanId`,
    async (request, reply) => {
      const { accountId, scanId } = request.params;
      try {
        await resolveAccount(accountId, request.user!.orgId);
        if (!(await checkAccess(request, reply, accountId, 'read'))) return;

        const scan = await prisma.groupScan.findFirst({
          where: { id: scanId, zaloAccountId: accountId, orgId: request.user!.orgId },
        });
        if (!scan) return reply.status(404).send({ error: 'Scan not found' });
        return { scan };
      } catch (err) {
        return handleError(reply, err, 'getGroupScan');
      }
    },
  );

  // ── Roster (members of scan's groups) ─────────────────────────────────────
  app.get<{
    Params: { accountId: string; scanId: string };
    Querystring: { isFriend?: string; page?: string; limit?: string };
  }>(`${BASE}/:scanId/members`, async (request, reply) => {
    const { accountId, scanId } = request.params;
    const { isFriend, page, limit } = request.query;
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'read'))) return;

      const scan = await prisma.groupScan.findFirst({
        where: { id: scanId, zaloAccountId: accountId, orgId: request.user!.orgId },
        select: { groupIds: true },
      });
      if (!scan) return reply.status(404).send({ error: 'Scan not found' });

      const groupIds: string[] = Array.isArray(scan.groupIds)
        ? (scan.groupIds as unknown[]).map(String)
        : [];

      const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit ?? '50', 10) || 50));

      const where: {
        zaloAccountId: string;
        groupId: { in: string[] };
        isFriend?: boolean;
      } = { zaloAccountId: accountId, groupId: { in: groupIds } };
      if (isFriend === 'true') where.isFriend = true;
      else if (isFriend === 'false') where.isFriend = false;

      const [members, total] = await Promise.all([
        prisma.groupMember.findMany({
          where,
          orderBy: { lastSeenAt: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.groupMember.count({ where }),
      ]);

      return { members, total, page: pageNum, limit: limitNum };
    } catch (err) {
      return handleError(reply, err, 'getGroupScanMembers');
    }
  });
}
