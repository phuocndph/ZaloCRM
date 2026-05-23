/**
 * user-assignment-routes.ts — D7 User assignment endpoints
 *
 * Endpoints cho admin gán user vào dept + permission group + list users (filter).
 * Dùng cho frontend Settings → Users page (mirror Getfly Quản lý người dùng).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { seedDefaultPermissionGroups, migrateLegacyUsersToPermissionGroups } from './seed-default-groups.js';
import { userHasGrant } from './permission-group-service.js';
import type { Resource, Action } from './permission-types.js';

function requireGrant(resource: Resource, action: Action) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const allowed = await userHasGrant(user.userId ?? user.id, resource, action);
    if (!allowed) return reply.status(403).send({ error: `Forbidden: ${resource}.${action}` });
  };
}

export async function registerUserAssignmentRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/rbac/users — list users với filter dept/group
  // Mirror Getfly Quản lý người dùng UI (columns: tên đăng nhập, họ tên, email, phòng ban, nhóm quyền)
  app.get('/api/v1/rbac/users', {
    preHandler: [authMiddleware, requireGrant('user', 'access')],
  }, async (request, reply) => {
    const user = (request as any).user;
    const query = request.query as { departmentId?: string; permissionGroupId?: string; q?: string };

    const where: any = { orgId: user.orgId };
    if (query.permissionGroupId) where.permissionGroupId = query.permissionGroupId;
    if (query.q) {
      where.OR = [
        { fullName: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true, // legacy
        permissionGroupId: true,
        permissionGroup: { select: { id: true, name: true, isSystem: true } },
        departmentMember: {
          select: {
            departmentId: true,
            deptRole: true,
            department: { select: { id: true, name: true, path: true } },
          },
        },
        // Phase Privacy v2 2026-05-23 — cột "🏠 Liên lạc nội bộ" trong UsersRbacView
        maxPrivacyNicks: true,
        internalContactZaloAccountId: true,
        internalContactNick: {
          select: { id: true, displayName: true, avatarUrl: true, zaloUid: true, status: true },
        },
        isActive: true,
      },
      orderBy: { fullName: 'asc' },
    });

    // Filter by dept (post-query vì departmentMember nested)
    const filtered = query.departmentId
      ? users.filter((u) => u.departmentMember?.departmentId === query.departmentId)
      : users;

    return reply.send({ users: filtered });
  });

  // PATCH /api/v1/rbac/users/:id/permission-group — gán user vào permission group
  app.patch('/api/v1/rbac/users/:id/permission-group', {
    preHandler: [authMiddleware, requireGrant('user', 'edit')],
  }, async (request, reply) => {
    const user = (request as any).user;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { permissionGroupId?: string | null };

    // Validate target user ∈ org
    const target = await prisma.user.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!target) return reply.status(404).send({ error: 'User không tồn tại' });

    // Validate permission group ∈ org (nếu set)
    if (body.permissionGroupId) {
      const grp = await prisma.permissionGroup.findFirst({
        where: { id: body.permissionGroupId, orgId: user.orgId, archivedAt: null },
        select: { id: true },
      });
      if (!grp) return reply.status(400).send({ error: 'Nhóm quyền không tồn tại' });
    }

    await prisma.user.update({
      where: { id },
      data: { permissionGroupId: body.permissionGroupId ?? null },
    });
    return reply.send({ ok: true });
  });

  // POST /api/v1/admin/rbac/seed-default-groups — admin endpoint seed 7 group
  app.post('/api/v1/admin/rbac/seed-default-groups', {
    preHandler: [authMiddleware, requireGrant('permission_group', 'create')],
  }, async (request, reply) => {
    const user = (request as any).user;
    try {
      const result = await seedDefaultPermissionGroups(user.orgId);
      return reply.send({ ok: true, ...result });
    } catch (e: any) {
      return reply.status(500).send({ error: e.message });
    }
  });

  // POST /api/v1/admin/rbac/migrate-legacy-users — map legacy users.role → permission_group_id
  app.post('/api/v1/admin/rbac/migrate-legacy-users', {
    preHandler: [authMiddleware, requireGrant('user', 'edit')],
  }, async (request, reply) => {
    const user = (request as any).user;
    try {
      const result = await migrateLegacyUsersToPermissionGroups(user.orgId);
      return reply.send({ ok: true, ...result });
    } catch (e: any) {
      return reply.status(500).send({ error: e.message });
    }
  });

  // POST /api/v1/admin/rbac/create-test-users — tạo 6 test user (CEO/Manager/Sale Senior/Sale × 2/Marketing)
  // Dùng cho D14-15 e2e test scenario "leader xem KH cấp dưới"
  app.post('/api/v1/admin/rbac/create-test-users', {
    preHandler: [authMiddleware, requireGrant('user', 'create')],
  }, async (request, reply) => {
    const user = (request as any).user;
    try {
      // Đảm bảo default groups đã seed
      await seedDefaultPermissionGroups(user.orgId);

      const groups = await prisma.permissionGroup.findMany({
        where: { orgId: user.orgId, isSystem: true },
        select: { id: true, name: true },
      });
      const grpByName = Object.fromEntries(groups.map((g) => [g.name, g.id]));

      const testUsers = [
        { email: 'test-ceo@rbac.local', fullName: 'TEST CEO Nguyễn Văn A', role: 'admin', group: 'CEO' },
        { email: 'test-manager@rbac.local', fullName: 'TEST Trưởng phòng Trần B', role: 'admin', group: 'Trưởng phòng' },
        { email: 'test-deputy@rbac.local', fullName: 'TEST Phó phòng Lê C', role: 'member', group: 'Trưởng phòng' },
        { email: 'test-sale-sr@rbac.local', fullName: 'TEST Sale Senior Phạm D', role: 'member', group: 'Sale Senior' },
        { email: 'test-sale-1@rbac.local', fullName: 'TEST Sale Nguyễn E', role: 'member', group: 'Sale' },
        { email: 'test-sale-2@rbac.local', fullName: 'TEST Sale Hoàng F', role: 'member', group: 'Sale' },
        { email: 'test-mkt@rbac.local', fullName: 'TEST Marketing Đỗ G', role: 'member', group: 'Marketing' },
      ];

      const { default: bcrypt } = await import('bcryptjs');
      const defaultHash = await bcrypt.hash('Test@1234', 10);

      const created: Array<{ id: string; email: string; group: string }> = [];
      for (const tu of testUsers) {
        const exists = await prisma.user.findUnique({ where: { email: tu.email }, select: { id: true } });
        if (exists) continue;
        const newUser = await prisma.user.create({
          data: {
            id: crypto.randomUUID(),
            orgId: user.orgId,
            email: tu.email,
            passwordHash: defaultHash,
            fullName: tu.fullName,
            role: tu.role,
            permissionGroupId: grpByName[tu.group] ?? null,
            isActive: true,
          },
          select: { id: true, email: true },
        });
        created.push({ id: newUser.id, email: newUser.email, group: tu.group });
      }

      return reply.send({ ok: true, created, defaultPassword: 'Test@1234' });
    } catch (e: any) {
      return reply.status(500).send({ error: e.message });
    }
  });
}
