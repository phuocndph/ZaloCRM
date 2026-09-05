// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * group-routes.ts — Group info, CRUD, and membership management.
 * Routes: /api/v1/zalo-accounts/:accountId/groups
 */
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { resolveAccount, checkAccess, handleError } from './zalo-route-helpers.js';
import { inferAutomaticGroupProfile } from './group-monitoring-policy.js';

type GroupInfo = {
  name?: string;
  groupName?: string;
  totalMember?: number;
  memberCount?: number;
  memVerList?: unknown[];
  type?: number;
};

async function syncDiscoveredGroupProfiles(input: {
  orgId: string;
  accountId: string;
  groupIds: string[];
  infoMap: Record<string, GroupInfo>;
}) {
  if (input.groupIds.length === 0) return;

  const conversations = await prisma.conversation.findMany({
    where: {
      orgId: input.orgId,
      zaloAccountId: input.accountId,
      threadType: 'group',
      externalThreadId: { in: input.groupIds },
    },
    select: {
      id: true,
      externalThreadId: true,
      groupName: true,
      groupSdkType: true,
      groupCategory: true,
      groupMonitoringEnabled: true,
      groupClassificationSource: true,
      groupClassificationConfidence: true,
      groupClassifiedAt: true,
    },
  });

  const updates = conversations.flatMap((conversation) => {
    const group = input.infoMap[conversation.externalThreadId ?? ''];
    const profile = inferAutomaticGroupProfile({
      name: group?.name || group?.groupName || conversation.groupName,
      sdkType: typeof group?.type === 'number' ? group.type : conversation.groupSdkType,
      current: conversation as any,
    });
    const changed = profile.groupSdkType !== conversation.groupSdkType
      || profile.groupCategory !== conversation.groupCategory
      || profile.groupMonitoringEnabled !== conversation.groupMonitoringEnabled
      || profile.groupClassificationSource !== conversation.groupClassificationSource
      || profile.groupClassificationConfidence !== conversation.groupClassificationConfidence
      || profile.groupClassifiedAt?.getTime() !== conversation.groupClassifiedAt?.getTime();
    if (!changed) return [];
    return [prisma.conversation.update({
      where: { id: conversation.id },
      data: profile,
    })];
  });

  if (updates.length > 0) await prisma.$transaction(updates);
}

export async function groupRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  const BASE = '/api/v1/zalo-accounts/:accountId/groups';

  // ── Group Info ──────────────────────────────────────────────────────────────

  app.get<{ Params: { accountId: string } }>(BASE, async (request, reply) => {
    const { accountId } = request.params;
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'read'))) return;
      // zca-js getAllGroups() trả OBJECT { gridVerMap:{id:ver}, gridInfoMap:{id:{...}} },
      // KHÔNG phải mảng. Trước đây trả thẳng object này → FE (group-list.vue,
      // chatbot listGroups) làm Array.isArray → false → danh sách nhóm luôn rỗng.
      // Chuẩn hoá thành mảng [{id,name,totalMember}]: gridVerMap là nguồn ID đầy đủ.
      const raw = (await zaloOps.getAllGroups(accountId)) as {
        gridVerMap?: Record<string, unknown>;
        gridInfoMap?: Record<string, GroupInfo>;
      } | null;
      const verMap = raw?.gridVerMap ?? {};
      const infoMap: Record<string, GroupInfo> = { ...(raw?.gridInfoMap ?? {}) };
      const ids = Object.keys(verMap).length ? Object.keys(verMap) : Object.keys(infoMap);

      // getAllGroups thường thiếu tên hoặc SDK type. Bù bằng getGroupInfo để vừa hiển thị
      // đủ tên vừa phân biệt chắc chắn standard group với community (type=2).
      // Chunk 50 id/call để tránh request quá lớn bị Zalo từ chối.
      const incomplete = ids.filter((id) =>
        !(infoMap[id]?.name || infoMap[id]?.groupName) || typeof infoMap[id]?.type !== 'number',
      );
      for (let i = 0; i < incomplete.length; i += 50) {
        const chunk = incomplete.slice(i, i + 50);
        try {
          const more = (await zaloOps.getGroupInfo(accountId, chunk)) as { gridInfoMap?: Record<string, GroupInfo> };
          Object.assign(infoMap, more?.gridInfoMap ?? {});
        } catch { /* giữ id, tên để trống — vẫn gán bot được */ }
      }

      await syncDiscoveredGroupProfiles({
        orgId: request.user!.orgId,
        accountId,
        groupIds: ids,
        infoMap,
      });

      const groups = ids.map((id) => {
        const g = infoMap[id] ?? {};
        return {
          id,
          name: g.name || g.groupName || '',
          totalMember:
            g.totalMember ?? g.memberCount ?? (Array.isArray(g.memVerList) ? g.memVerList.length : 0),
          sdkType: typeof g.type === 'number' ? g.type : null,
          type: g.type === 2 ? 'community' : 'group',
        };
      });
      return { groups };
    } catch (err) { return handleError(reply, err, 'getAllGroups'); }
  });

  app.get<{ Params: { accountId: string; groupId: string } }>(`${BASE}/:groupId`, async (request, reply) => {
    const { accountId, groupId } = request.params;
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'read'))) return;
      return { group: await zaloOps.getGroupInfo(accountId, groupId) };
    } catch (err) { return handleError(reply, err, 'getGroupInfo'); }
  });

  app.get<{ Params: { accountId: string; groupId: string } }>(`${BASE}/:groupId/members`, async (request, reply) => {
    const { accountId, groupId } = request.params;
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'read'))) return;
      // 1) getGroupInfo → memVerList ("uid_ver"); 2) getGroupMembersInfo(uids) → profile.
      const info = await zaloOps.getGroupInfo(accountId, groupId) as any;
      const grid = info?.gridInfoMap?.[groupId] ?? Object.values(info?.gridInfoMap ?? {})[0];
      const rawIds: string[] = Array.isArray(grid?.memVerList) ? grid.memVerList : [];
      const uids = [...new Set(rawIds.map((k) => String(k).split('_')[0]).filter(Boolean))];
      if (uids.length === 0) return { members: [] };
      const prof = await zaloOps.getGroupMembersInfo(accountId, uids) as any;
      const profiles = prof?.profiles ?? {};
      const members = Object.values(profiles).map((p: any) => ({
        uid: p.id,
        displayName: p.displayName || p.zaloName || p.id,
        avatar: p.avatar ?? null,
      }));
      return { members };
    } catch (err) { return handleError(reply, err, 'getGroupMembersInfo'); }
  });

  // ── Group CRUD ──────────────────────────────────────────────────────────────

  app.post<{ Params: { accountId: string }; Body: { name: string; memberIds: string[] } }>(BASE, async (request, reply) => {
    const { accountId } = request.params;
    const { name, memberIds } = request.body ?? {};
    if (!name || !Array.isArray(memberIds) || memberIds.length === 0) {
      return reply.status(400).send({ error: 'name and memberIds are required' });
    }
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'admin'))) return;
      return reply.status(201).send({ group: await zaloOps.createGroup(accountId, { name, memberIds }) });
    } catch (err) { return handleError(reply, err, 'createGroup'); }
  });

  app.patch<{ Params: { accountId: string; groupId: string }; Body: { name: string } }>(`${BASE}/:groupId/name`, async (request, reply) => {
    const { accountId, groupId } = request.params;
    const { name } = request.body ?? {};
    if (!name) return reply.status(400).send({ error: 'name is required' });
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'admin'))) return;
      return { result: await zaloOps.renameGroup(accountId, name, groupId) };
    } catch (err) { return handleError(reply, err, 'renameGroup'); }
  });

  app.patch<{ Params: { accountId: string; groupId: string }; Body: Record<string, unknown> }>(`${BASE}/:groupId/settings`, async (request, reply) => {
    const { accountId, groupId } = request.params;
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'admin'))) return;
      return { result: await zaloOps.updateGroupSettings(accountId, request.body ?? {}, groupId) };
    } catch (err) { return handleError(reply, err, 'updateGroupSettings'); }
  });

  // ── Membership ──────────────────────────────────────────────────────────────

  app.post<{ Params: { accountId: string; groupId: string }; Body: { userIds: string[] } }>(`${BASE}/:groupId/members`, async (request, reply) => {
    const { accountId, groupId } = request.params;
    const { userIds } = request.body ?? {};
    if (!Array.isArray(userIds) || userIds.length === 0) return reply.status(400).send({ error: 'userIds array is required' });
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'admin'))) return;
      return { result: await zaloOps.addUserToGroup(accountId, userIds, groupId) };
    } catch (err) { return handleError(reply, err, 'addUserToGroup'); }
  });

  app.delete<{ Params: { accountId: string; groupId: string }; Body: { userIds: string[] } }>(`${BASE}/:groupId/members`, async (request, reply) => {
    const { accountId, groupId } = request.params;
    const { userIds } = request.body ?? {};
    if (!Array.isArray(userIds) || userIds.length === 0) return reply.status(400).send({ error: 'userIds array is required' });
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'admin'))) return;
      return { result: await zaloOps.removeUserFromGroup(accountId, userIds, groupId) };
    } catch (err) { return handleError(reply, err, 'removeUserFromGroup'); }
  });

  app.post<{ Params: { accountId: string; groupId: string }; Body: { userId: string } }>(`${BASE}/:groupId/deputies`, async (request, reply) => {
    const { accountId, groupId } = request.params;
    const { userId } = request.body ?? {};
    if (!userId) return reply.status(400).send({ error: 'userId is required' });
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'admin'))) return;
      return { result: await zaloOps.addGroupDeputy(accountId, userId, groupId) };
    } catch (err) { return handleError(reply, err, 'addGroupDeputy'); }
  });

  app.delete<{ Params: { accountId: string; groupId: string; userId: string } }>(`${BASE}/:groupId/deputies/:userId`, async (request, reply) => {
    const { accountId, groupId, userId } = request.params;
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'admin'))) return;
      return { result: await zaloOps.removeGroupDeputy(accountId, userId, groupId) };
    } catch (err) { return handleError(reply, err, 'removeGroupDeputy'); }
  });

  app.post<{ Params: { accountId: string; groupId: string }; Body: { newOwnerId: string } }>(`${BASE}/:groupId/transfer`, async (request, reply) => {
    const { accountId, groupId } = request.params;
    const { newOwnerId } = request.body ?? {};
    if (!newOwnerId) return reply.status(400).send({ error: 'newOwnerId is required' });
    try {
      await resolveAccount(accountId, request.user!.orgId);
      if (!(await checkAccess(request, reply, accountId, 'admin'))) return;
      return { result: await zaloOps.changeGroupOwner(accountId, newOwnerId, groupId) };
    } catch (err) { return handleError(reply, err, 'changeGroupOwner'); }
  });
}
