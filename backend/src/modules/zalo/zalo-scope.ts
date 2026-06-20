// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Zalo account scope helper — quyết định user được thấy nick nào.
 *
 * Quy tắc (anh chốt 2026-05-22):
 *   - role='owner' (Chủ tổ chức) → tất cả nick trong org
 *   - Trưởng phòng / Phó phòng của dept X → nick của user thuộc dept X + tất cả dept con
 *     (cascade theo dept tree materialized path)
 *   - Member thường → chỉ nick mà user là ownerUserId HOẶC được grant ZaloAccountAccess
 *
 * Output: array of zaloAccount IDs user được phép xem.
 * Caller dùng `where: { id: { in: ids }, orgId: ... }` để filter list.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

export interface ZaloScope {
  /** Account IDs user được phép xem (read scope) */
  accessibleIds: string[];
  /** True nếu user có quyền manage org-wide (bulk actions, edit any) */
  isOrgAdmin: boolean;
  /** Set của account IDs mà user là owner (owns the nick) — dùng để gate Action buttons */
  ownedIds: Set<string>;
}

export async function getZaloScope(userId: string, orgId: string, legacyRole: string): Promise<ZaloScope> {
  const isOrgAdmin = legacyRole === 'owner' || legacyRole === 'admin';

  // Org admin → tất cả accounts (trừ nick đã xóa mềm).
  // 2026-06-10 FIX: lọc archivedAt → nick đã xóa KHÔNG còn trong accessibleIds, nên
  // mọi picker/màn hình dùng getZaloScope tự động hết pick được nick đã xóa.
  if (isOrgAdmin) {
    const all = await prisma.zaloAccount.findMany({
      where: { orgId, archivedAt: null },
      select: { id: true, ownerUserId: true },
    });
    return {
      accessibleIds: all.map((a) => a.id),
      isOrgAdmin: true,
      ownedIds: new Set(all.filter((a) => a.ownerUserId === userId).map((a) => a.id)),
    };
  }

  // Load user's dept membership
  const me = await prisma.user.findFirst({
    where: { id: userId, orgId },
    select: {
      id: true,
      departmentMember: {
        select: {
          deptRole: true,
          departmentId: true,
          department: { select: { id: true, path: true } },
        },
      },
    },
  });

  // Build set of "manageable" userIds (chính mình + nếu là leader/deputy thì + sale thuộc dept subtree)
  const visibleUserIds = new Set<string>([userId]);

  if (me?.departmentMember && (me.departmentMember.deptRole === 'leader' || me.departmentMember.deptRole === 'deputy')) {
    const myDept = me.departmentMember.department;
    // Find all descendant dept IDs via materialized path LIKE
    const subtreeDepts = await prisma.department.findMany({
      where: { orgId, path: { startsWith: myDept.path } },
      select: { id: true },
    });
    const subtreeDeptIds = subtreeDepts.map((d) => d.id);

    // All users in those depts
    const subtreeMembers = await prisma.departmentMember.findMany({
      where: { departmentId: { in: subtreeDeptIds } },
      select: { userId: true },
    });
    for (const m of subtreeMembers) visibleUserIds.add(m.userId);
  }

  // Accounts owned by any of visible users (trừ nick đã xóa mềm — 2026-06-10).
  const ownedAccounts = await prisma.zaloAccount.findMany({
    where: { orgId, ownerUserId: { in: Array.from(visibleUserIds) }, archivedAt: null },
    select: { id: true, ownerUserId: true },
  });

  // PLUS accounts user được grant access explicit (qua ZaloAccountAccess) — trừ nick đã xóa.
  const grantedAccess = await prisma.zaloAccountAccess.findMany({
    where: { userId, zaloAccount: { orgId, archivedAt: null } },
    select: { zaloAccountId: true },
  });

  const accessibleIds = Array.from(
    new Set([...ownedAccounts.map((a) => a.id), ...grantedAccess.map((g) => g.zaloAccountId)]),
  );

  return {
    accessibleIds,
    isOrgAdmin: false,
    ownedIds: new Set(ownedAccounts.filter((a) => a.ownerUserId === userId).map((a) => a.id)),
  };
}

/**
 * Quick check: user có quyền manage (edit/delete/disconnect) account này không?
 * Rule: owner-of-nick HOẶC org admin.
 */
export function canManageAccount(
  accountOwnerUserId: string | null,
  userId: string,
  legacyRole: string,
): boolean {
  if (legacyRole === 'owner' || legacyRole === 'admin') return true;
  return accountOwnerUserId === userId;
}

/**
 * Phase Zalo Account Mutation Gate 2026-05-27 — gate cho mọi mutation
 * (POST/PUT/PATCH/DELETE) trên `:id` của ZaloAccount.
 *
 * Quy tắc: chỉ OWNER của nick hoặc ORG admin/owner mới được mutate.
 * Trưởng phòng KHÔNG được delete/login/proxy nick cấp dưới (đọc OK qua
 * requireAccountVisible).
 *
 * Sử dụng trong Fastify route preHandler hoặc đầu handler:
 *   const account = await requireAccountManagement(request, reply, accountId);
 *   if (!account) return;  // reply đã send 401/403/404
 *
 * Trả về account row { id, ownerUserId, orgId, status, ... } nếu pass,
 * hoặc null nếu đã reply error (caller phải return ngay).
 */
export async function requireAccountManagement(
  request: FastifyRequest,
  reply: FastifyReply,
  accountId: string,
): Promise<{ id: string; ownerUserId: string | null; orgId: string; status: string } | null> {
  const user = (request as any).user;
  if (!user) {
    reply.status(401).send({ error: 'Unauthorized' });
    return null;
  }
  // NOTE: KHÔNG lọc archivedAt ở đây — gate này dùng cho cả route /restore (cần tìm
  // được nick đã archived để khôi phục). Việc "ẩn nick đã xóa khỏi list/picker" do
  // getZaloScope + các endpoint LIST lo (đã lọc archivedAt 2026-06-10).
  const account = await prisma.zaloAccount.findFirst({
    where: { id: accountId, orgId: user.orgId },
    select: { id: true, ownerUserId: true, orgId: true, status: true },
  });
  if (!account) {
    reply.status(404).send({ error: 'Account not found' });
    return null;
  }
  if (!canManageAccount(account.ownerUserId, user.id, user.role)) {
    reply.status(403).send({
      error: 'Bạn không có quyền thao tác trên nick này',
      code: 'not_account_owner',
    });
    return null;
  }
  return account;
}

/**
 * Phase Zalo Account Mutation Gate 2026-05-27 — gate cho mọi READ endpoint
 * trên `:id` (uptime, status, labels-overview, friends-db nick-id, ...).
 *
 * Quy tắc: id PHẢI thuộc `getZaloScope().accessibleIds` (owner + ACL grant +
 * dept-subtree cascade nếu leader/deputy). Khác với requireAccountManagement,
 * trưởng phòng ĐƯỢC đọc nick cấp dưới.
 */
export async function requireAccountVisible(
  request: FastifyRequest,
  reply: FastifyReply,
  accountId: string,
): Promise<{ id: string; ownerUserId: string | null; orgId: string } | null> {
  const user = (request as any).user;
  if (!user) {
    reply.status(401).send({ error: 'Unauthorized' });
    return null;
  }
  const account = await prisma.zaloAccount.findFirst({
    where: { id: accountId, orgId: user.orgId },
    select: { id: true, ownerUserId: true, orgId: true },
  });
  if (!account) {
    reply.status(404).send({ error: 'Account not found' });
    return null;
  }
  const scope = await getZaloScope(user.id, user.orgId, user.role);
  if (!scope.isOrgAdmin && !scope.accessibleIds.includes(accountId)) {
    reply.status(403).send({
      error: 'Bạn không có quyền xem nick này',
      code: 'not_in_scope',
    });
    return null;
  }
  return account;
}
