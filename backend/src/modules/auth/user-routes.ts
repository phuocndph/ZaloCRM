/**
 * User management routes — CRUD for users within an org.
 * All routes require authentication via authMiddleware.
 * Role-based access: owner > admin > member.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from './auth-middleware.js';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { logger } from '../../shared/utils/logger.js';

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/users — list all users in org
  app.get('/api/v1/users', async (request: FastifyRequest) => {
    const user = request.user!;
    const users = await prisma.user.findMany({
      where: { orgId: user.orgId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        teamId: true,
        createdAt: true,
        team: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return { users };
  });

  // POST /api/v1/users — create user (owner/admin only)
  app.post('/api/v1/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (!['owner', 'admin'].includes(currentUser.role)) {
      return reply.status(403).send({ error: 'Không có quyền' });
    }

    const { email, fullName, password, role = 'member', teamId } = request.body as any;
    if (!email || !fullName || !password) {
      return reply.status(400).send({ error: 'Email, họ tên, mật khẩu là bắt buộc' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.status(400).send({ error: 'Email đã tồn tại' });

    if (role === 'owner') return reply.status(400).send({ error: 'Không thể tạo thêm owner' });
    if (role === 'admin' && currentUser.role !== 'owner') {
      return reply.status(403).send({ error: 'Chỉ owner có thể tạo admin' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        orgId: currentUser.orgId,
        email,
        fullName,
        passwordHash,
        role,
        teamId: teamId || null,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    logger.info(`User created: ${user.email} by ${currentUser.email}`);
    return user;
  });

  // PUT /api/v1/users/:id — update user info
  app.put('/api/v1/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    const { id } = request.params as { id: string };

    if (!['owner', 'admin'].includes(currentUser.role) && currentUser.id !== id) {
      return reply.status(403).send({ error: 'Không có quyền' });
    }

    const { fullName, email, role, teamId, isActive } = request.body as any;

    if (id === currentUser.id && role && role !== currentUser.role) {
      return reply.status(400).send({ error: 'Không thể thay đổi role của chính mình' });
    }

    const updateData: any = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined && currentUser.role === 'owner') updateData.role = role;
    if (teamId !== undefined) updateData.teamId = teamId || null;
    if (isActive !== undefined && currentUser.role === 'owner') updateData.isActive = isActive;

    const user = await prisma.user.update({
      where: { id, orgId: currentUser.orgId },
      data: updateData,
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        teamId: true,
      },
    });

    return user;
  });

  // PUT /api/v1/users/:id/password — reset password (owner/admin only)
  app.put('/api/v1/users/:id/password', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (!['owner', 'admin'].includes(currentUser.role)) {
      return reply.status(403).send({ error: 'Không có quyền' });
    }

    const { id } = request.params as { id: string };
    const { password } = request.body as { password: string };
    if (!password || password.length < 6) {
      return reply.status(400).send({ error: 'Mật khẩu tối thiểu 6 ký tự' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id, orgId: currentUser.orgId },
      data: { passwordHash },
    });

    return { success: true };
  });

  // DELETE /api/v1/users/:id — deactivate user (owner only)
  app.delete('/api/v1/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (currentUser.role !== 'owner') {
      return reply.status(403).send({ error: 'Chỉ owner có quyền xóa nhân viên' });
    }

    const { id } = request.params as { id: string };
    if (id === currentUser.id) {
      return reply.status(400).send({ error: 'Không thể xóa chính mình' });
    }

    await prisma.user.update({
      where: { id, orgId: currentUser.orgId },
      data: { isActive: false },
    });

    return { success: true };
  });

  // Phase Privacy v2 2026-05-23 — admin sửa maxPrivacyNicks per user.
  // PATCH /api/v1/users/:id/max-privacy-nicks { maxPrivacyNicks: 1-10 }
  // Permission: org admin/owner only.
  app.patch('/api/v1/users/:id/max-privacy-nicks', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (currentUser.role !== 'owner' && currentUser.role !== 'admin') {
      return reply.status(403).send({ error: 'Chỉ admin/owner sửa được maxPrivacyNicks' });
    }
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { maxPrivacyNicks?: number };
    const max = body.maxPrivacyNicks;
    if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > 10) {
      return reply.status(400).send({ error: 'maxPrivacyNicks phải là số nguyên 1-10' });
    }

    const target = await prisma.user.findFirst({
      where: { id, orgId: currentUser.orgId },
      select: { id: true },
    });
    if (!target) return reply.status(404).send({ error: 'User không tồn tại trong org' });

    await prisma.user.update({
      where: { id },
      data: { maxPrivacyNicks: max },
    });

    return { ok: true, userId: id, maxPrivacyNicks: max };
  });

  // Phase Privacy v2 2026-05-23 — user pick nick "liên lạc nội bộ" của mình.
  // PATCH /api/v1/me/internal-contact { zaloAccountId: string | null }
  // Constraint: nick phải user OWN (ownerUserId === current user).
  app.patch('/api/v1/me/internal-contact', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    const body = (request.body ?? {}) as { zaloAccountId?: string | null };
    const accountId = body.zaloAccountId ?? null;

    if (accountId !== null) {
      // Verify nick exists in org AND user owns it
      const nick = await prisma.zaloAccount.findFirst({
        where: { id: accountId, orgId: currentUser.orgId },
        select: { id: true, ownerUserId: true },
      });
      if (!nick) return reply.status(404).send({ error: 'Nick không tồn tại trong org' });
      if (nick.ownerUserId !== currentUser.id) {
        return reply.status(403).send({ error: 'Chỉ chọn được nick mình OWN làm liên lạc nội bộ' });
      }
    }

    await prisma.user.update({
      where: { id: currentUser.id },
      data: { internalContactZaloAccountId: accountId },
    });

    return { ok: true, internalContactZaloAccountId: accountId };
  });

  // Phase Privacy v2 2026-05-23 — GET /me/internal-contact (load current value).
  // Auto-default: nếu user chưa có internalContactZaloAccountId + có ≥1 nick own
  //   → pick nick có nhiều friend nhất, persist, return.
  // Sale có thể override thủ công sau qua PATCH /me/internal-contact.
  app.get('/api/v1/me/internal-contact', async (request: FastifyRequest) => {
    const currentUser = request.user!;
    let me = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: {
        internalContactZaloAccountId: true,
        maxPrivacyNicks: true,
        internalContactNick: {
          select: { id: true, displayName: true, avatarUrl: true, zaloUid: true, status: true },
        },
      },
    });

    if (!me) {
      return { internalContactZaloAccountId: null, internalContactNick: null, maxPrivacyNicks: 2, autoDefaulted: false };
    }

    let autoDefaulted = false;
    if (!me.internalContactZaloAccountId) {
      // Auto-pick: nick own có nhiều friend nhất.
      const candidates = await prisma.zaloAccount.findMany({
        where: { ownerUserId: currentUser.id, orgId: currentUser.orgId },
        select: { id: true, _count: { select: { friends: true } } },
      });
      if (candidates.length > 0) {
        const best = candidates.reduce((acc, c) =>
          (c._count?.friends ?? 0) > (acc._count?.friends ?? 0) ? c : acc,
        );
        await prisma.user.update({
          where: { id: currentUser.id },
          data: { internalContactZaloAccountId: best.id },
        });
        // Reload
        me = await prisma.user.findUnique({
          where: { id: currentUser.id },
          select: {
            internalContactZaloAccountId: true,
            maxPrivacyNicks: true,
            internalContactNick: {
              select: { id: true, displayName: true, avatarUrl: true, zaloUid: true, status: true },
            },
          },
        });
        autoDefaulted = true;
      }
    }

    return {
      internalContactZaloAccountId: me?.internalContactZaloAccountId ?? null,
      internalContactNick: me?.internalContactNick ?? null,
      maxPrivacyNicks: me?.maxPrivacyNicks ?? 2,
      autoDefaulted,
    };
  });
}
