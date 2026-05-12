/**
 * friend-routes.ts — REST API for Zalo friend management.
 * Ports openzca friend commands: queries, requests, management, privacy.
 * All routes scoped to /api/v1/zalo-accounts/:accountId/friends and require JWT auth.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { resolveAccount, checkAccess, handleError } from './zalo-route-helpers.js';
import { markFriendRequestSent, applyFriendTransition } from './friend-event-handler.js';
import { prisma } from '../../shared/database/prisma-client.js';
import { randomUUID } from 'node:crypto';

const BASE = '/api/v1/zalo-accounts/:accountId/friends';

export async function friendRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // ── DB-backed friend list (preferred over live for /friends UI) ───────────

  // GET .../friends-db?kind=friend|pending_friend|chatting_stranger|ghost|all&page=1&limit=25&search=...
  app.get(`${BASE}-db`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const {
      kind = 'all',
      page = '1',
      limit = '25',
      search = '',
    } = request.query as { kind?: string; page?: string; limit?: string; search?: string };
    const user = request.user!;
    if (!await checkAccess(request, reply, accountId, 'read')) return;
    try {
      await resolveAccount(accountId, user.orgId);

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 25));

      const where: any = { zaloAccountId: accountId, orgId: user.orgId };
      if (kind && kind !== 'all') where.relationshipKind = kind;
      if (search.trim()) {
        const q = search.trim();
        where.contact = {
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { crmName:  { contains: q, mode: 'insensitive' } },
            { phone:    { contains: q } },
          ],
        };
      }

      const [friends, total, countsRaw] = await Promise.all([
        prisma.friend.findMany({
          where,
          include: {
            contact: {
              select: {
                id: true, fullName: true, crmName: true, phone: true, email: true,
                avatarUrl: true, tags: true, leadScore: true, source: true,
                gender: true, status: true, province: true, district: true,
                birthYear: true,
              },
            },
            zaloAccount: { select: { id: true, displayName: true, phone: true } },
          },
          orderBy: [{ lastInboundAt: 'desc' }, { lastOutboundAt: 'desc' }, { createdAt: 'desc' }],
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
        }),
        prisma.friend.count({ where }),
        prisma.friend.groupBy({
          by: ['relationshipKind'],
          where: { zaloAccountId: accountId, orgId: user.orgId },
          _count: true,
        }),
      ]);

      const counts = Object.fromEntries(countsRaw.map((g) => [g.relationshipKind, g._count]));
      return { friends, total, counts, page: pageNum, limit: limitNum };
    } catch (err) {
      return handleError(reply, err, 'friends-db-list');
    }
  });

  // POST .../friends-db/sync — pull live friend list + sent requests, upsert into Friend table
  app.post(`${BASE}-db/sync`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const user = request.user!;
    if (!await checkAccess(request, reply, accountId, 'chat')) return;
    try {
      const account = await resolveAccount(accountId, user.orgId);

      // Pull live data
      const liveFriends = (await zaloOps.getAllFriends(accountId).catch(() => [])) as any[];
      const sentRequests = (await zaloOps.getSentFriendRequests(accountId).catch(() => [])) as any[];

      let createdContacts = 0;
      let upsertedFriends = 0;

      // Upsert each live friend (state=accepted)
      for (const f of liveFriends) {
        const uid = String(f.userId || f.uid || '');
        if (!uid) continue;
        // Find or create Contact
        let contact = await prisma.contact.findFirst({
          where: { orgId: user.orgId, zaloUid: uid },
          select: { id: true },
        });
        if (!contact) {
          contact = await prisma.contact.create({
            data: {
              id: randomUUID(),
              orgId: user.orgId,
              zaloUid: uid,
              fullName: f.zaloName || f.displayName || 'Unknown',
              avatarUrl: f.avatar || null,
              hasZalo: true,
            },
            select: { id: true },
          });
          createdContacts++;
        }
        await applyFriendTransition({
          orgId: user.orgId,
          zaloAccountId: accountId,
          contactId: contact.id,
          zaloUidInNick: uid,
          newFriendshipStatus: 'accepted',
        });
        upsertedFriends++;
      }

      // Upsert sent requests (state=pending_sent)
      for (const r of sentRequests) {
        const uid = String(r.uid || r.userId || '');
        if (!uid) continue;
        let contact = await prisma.contact.findFirst({
          where: { orgId: user.orgId, zaloUid: uid },
          select: { id: true },
        });
        if (!contact) {
          contact = await prisma.contact.create({
            data: {
              id: randomUUID(),
              orgId: user.orgId,
              zaloUid: uid,
              fullName: r.zaloName || r.displayName || 'Unknown',
              hasZalo: true,
            },
            select: { id: true },
          });
          createdContacts++;
        }
        await applyFriendTransition({
          orgId: user.orgId,
          zaloAccountId: accountId,
          contactId: contact.id,
          zaloUidInNick: uid,
          newFriendshipStatus: 'pending_sent',
        });
        upsertedFriends++;
      }

      return {
        nickId: accountId,
        nickDisplayName: account.displayName,
        liveFriends: liveFriends.length,
        sentRequests: sentRequests.length,
        upsertedFriends,
        createdContacts,
      };
    } catch (err) {
      return handleError(reply, err, 'friends-db-sync');
    }
  });

  // ── Friend Queries ────────────────────────────────────────────────────────

  // GET .../friends — list all friends
  app.get(BASE, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const user = request.user!;
    if (!await checkAccess(request, reply, accountId, 'read')) return;
    try {
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.getAllFriends(accountId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // GET .../friends/find?q=query — search user by phone/name
  app.get(`${BASE}/find`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const { q } = request.query as { q?: string };
    const user = request.user!;
    if (!q) return reply.status(400).send({ error: 'Query param q is required' });
    if (!await checkAccess(request, reply, accountId, 'read')) return;
    try {
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.findUser(accountId, q);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // GET .../friends/online — get online friends
  app.get(`${BASE}/online`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'read')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.getFriendOnlines(accountId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // GET .../friends/recommendations — friend suggestions
  app.get(`${BASE}/recommendations`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'read')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.getFriendRecommendations(accountId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // GET .../friends/aliases — all custom aliases
  app.get(`${BASE}/aliases`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'read')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.getAliasList(accountId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // ── Friend Requests ───────────────────────────────────────────────────────

  // GET .../friends/requests/sent — list sent friend requests
  // NOTE: Registered before :userId routes to avoid route conflicts
  app.get(`${BASE}/requests/sent`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'read')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.getSentFriendRequests(accountId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // GET .../friends/requests/:userId/status — check request status with a user
  app.get(`${BASE}/requests/:userId/status`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'read')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.getFriendRequestStatus(accountId, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // POST .../friends/requests — send friend request { userId, message? }
  app.post(`${BASE}/requests`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId } = request.params as { accountId: string };
    const { userId, message = '' } = request.body as { userId: string; message?: string };
    const user = request.user!;
    if (!userId) return reply.status(400).send({ error: 'userId is required' });
    if (!await checkAccess(request, reply, accountId, 'chat')) return;
    try {
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.sendFriendRequest(accountId, message, userId);
      await markFriendRequestSent(accountId, userId);
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // POST .../friends/requests/:userId/accept — accept incoming request
  app.post(`${BASE}/requests/:userId/accept`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.acceptFriendRequest(accountId, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // POST .../friends/requests/:userId/reject — reject incoming request
  app.post(`${BASE}/requests/:userId/reject`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.rejectFriendRequest(accountId, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // DELETE .../friends/requests/:userId — cancel sent request
  app.delete(`${BASE}/requests/:userId`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.cancelFriendRequest(accountId, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // ── Friend Management ─────────────────────────────────────────────────────

  // DELETE .../friends/:userId — remove friend
  app.delete(`${BASE}/:userId`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.removeFriend(accountId, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // PUT .../friends/:userId/alias — set custom alias { alias }
  app.put(`${BASE}/:userId/alias`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const { alias } = request.body as { alias: string };
    const user = request.user!;
    if (!alias) return reply.status(400).send({ error: 'alias is required' });
    if (!await checkAccess(request, reply, accountId, 'chat')) return;
    try {
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.changeFriendAlias(accountId, alias, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // DELETE .../friends/:userId/alias — remove custom alias
  app.delete(`${BASE}/:userId/alias`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.removeFriendAlias(accountId, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // ── Privacy ───────────────────────────────────────────────────────────────

  // POST .../friends/:userId/block — block user
  app.post(`${BASE}/:userId/block`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.blockUser(accountId, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // DELETE .../friends/:userId/block — unblock user
  app.delete(`${BASE}/:userId/block`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.unblockUser(accountId, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // POST .../friends/:userId/block-feed — block user from viewing feed
  app.post(`${BASE}/:userId/block-feed`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.blockViewFeed(accountId, true, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });

  // DELETE .../friends/:userId/block-feed — unblock user from viewing feed
  app.delete(`${BASE}/:userId/block-feed`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { accountId, userId } = request.params as { accountId: string; userId: string };
    const user = request.user!;
    try {
      if (!await checkAccess(request, reply, accountId, 'chat')) return;
      await resolveAccount(accountId, user.orgId);
      const data = await zaloOps.blockViewFeed(accountId, false, userId);
      return { data };
    } catch (err) {
      return handleError(reply, err, 'friend-op');
    }
  });
}
