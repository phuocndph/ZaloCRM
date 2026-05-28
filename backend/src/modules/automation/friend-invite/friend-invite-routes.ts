// Phase Friend Invite Queue 2026-05-28 — Routes cho Mục tiêu friend_invite_to_list.
//
// Endpoints:
//   POST   /api/v1/automation/triggers/friend-invite       create Mục tiêu (draft state)
//   POST   /api/v1/automation/triggers/:id/activate        precompute + spawn workers
//   POST   /api/v1/automation/triggers/:id/pause           stop workers (state=paused)
//   POST   /api/v1/automation/triggers/:id/resume          re-spawn workers
//   POST   /api/v1/automation/triggers/:id/cancel          drain + cancel
//   GET    /api/v1/automation/triggers/:id/dashboard       counters + nick load + recent entries

import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { logger } from '../../../shared/utils/logger.js';
import { precomputeAndSeedPool, isFriendInviteSegmentSpec } from './skip-precompute.js';
import { startNickWorker, stopNickWorker, getNickWorkerState } from './nick-worker.js';

const BASE = '/api/v1/automation/triggers';

export async function friendInviteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── POST /friend-invite — Create draft trigger ────────────────────────────
  app.post<{
    Body: {
      name: string;
      listId: string;
      nickIds: string[];
      successorSequenceId: string;
      greetingTemplate: string;
      skipRules: { recencyDays: number; friendCap: number; entryStatuses: string[] };
      ruleOverrides?: Record<string, unknown>;
    };
  }>(`${BASE}/friend-invite`, async (request, reply) => {
    const user = request.user!;
    const body = request.body;

    // Validate
    if (!body.name?.trim()) return reply.status(400).send({ error: 'name_required' });
    if (!body.listId) return reply.status(400).send({ error: 'listId_required' });
    if (!Array.isArray(body.nickIds) || body.nickIds.length === 0)
      return reply.status(400).send({ error: 'nickIds_required' });
    if (!body.successorSequenceId)
      return reply.status(400).send({ error: 'successorSequenceId_required' });
    if (!body.greetingTemplate?.trim())
      return reply.status(400).send({ error: 'greetingTemplate_required' });
    if (body.greetingTemplate.length > 200)
      return reply.status(400).send({ error: 'greetingTemplate_too_long' });
    if (!body.greetingTemplate.includes('{name}'))
      return reply
        .status(400)
        .send({ error: 'greetingTemplate_missing_name', hint: 'Phải chứa biến {name}' });

    // Verify list belongs to org
    const list = await prisma.customerList.findFirst({
      where: { id: body.listId, orgId: user.orgId },
      select: { id: true, totalEntries: true },
    });
    if (!list) return reply.status(404).send({ error: 'list_not_found' });

    // Verify all nicks belong to org
    const nicks = await prisma.zaloAccount.findMany({
      where: { id: { in: body.nickIds }, orgId: user.orgId },
      select: { id: true },
    });
    if (nicks.length !== body.nickIds.length)
      return reply.status(400).send({ error: 'some_nicks_not_found' });

    // Verify sequence belongs to org
    const sequence = await prisma.automationSequence.findFirst({
      where: { id: body.successorSequenceId, orgId: user.orgId },
      select: { id: true, enabled: true },
    });
    if (!sequence) return reply.status(404).send({ error: 'sequence_not_found' });

    // Create trigger in 'draft' state. Activation happens via separate endpoint.
    const trigger = await prisma.automationTrigger.create({
      data: {
        orgId: user.orgId,
        name: body.name.trim(),
        category: 'general',
        eventType: 'friend_invite_to_list',
        bindingKind: 'sequence', // bound to successor sequence for UI consistency
        sequenceId: body.successorSequenceId, // also point sequenceId for UI
        successorSequenceId: body.successorSequenceId,
        greetingTemplate: body.greetingTemplate.trim(),
        segmentSpec: {
          kind: 'customer_list_pool',
          listId: body.listId,
          nickIds: body.nickIds,
          skipRules: body.skipRules,
        },
        ruleOverrides: {
          ...body.ruleOverrides,
          allowStrangerMessage: true, // Friend Invite sequences allow stranger messaging
        } as object,
        state: 'draft',
        enabled: false, // explicit activation required
        createdById: user.id,
      },
    });

    logger.info(
      `[friend-invite] trigger created id=${trigger.id} name="${trigger.name}" list=${body.listId} nicks=${body.nickIds.length}`,
    );

    return reply.status(201).send({ trigger: { id: trigger.id, name: trigger.name, state: trigger.state } });
  });

  // ── POST /:id/activate — Precompute + spawn workers ───────────────────────
  app.post<{ Params: { id: string } }>(`${BASE}/:id/activate`, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;

    const trigger = await prisma.automationTrigger.findFirst({
      where: { id, orgId: user.orgId, eventType: 'friend_invite_to_list' },
      select: { id: true, state: true, segmentSpec: true },
    });
    if (!trigger) return reply.status(404).send({ error: 'trigger_not_found' });
    if (trigger.state !== 'draft' && trigger.state !== 'paused')
      return reply.status(400).send({ error: 'invalid_state', current: trigger.state });

    const spec = trigger.segmentSpec;
    if (!isFriendInviteSegmentSpec(spec))
      return reply.status(500).send({ error: 'invalid_segment_spec' });

    // 1. Precompute skip rules + seed pool
    const precomputeResult = await precomputeAndSeedPool({
      triggerId: trigger.id,
      orgId: user.orgId,
      spec,
    });

    // 2. Flip trigger state → active
    await prisma.automationTrigger.update({
      where: { id: trigger.id },
      data: { state: 'active', enabled: true },
    });

    // 3. Spawn nick workers (idempotent — won't double-spawn)
    for (const nickId of spec.nickIds) {
      void startNickWorker(nickId, user.orgId).catch((err) =>
        logger.error(`[friend-invite] startNickWorker failed nick=${nickId}:`, err),
      );
    }

    return reply.send({
      ok: true,
      precompute: precomputeResult,
      workersSpawning: spec.nickIds.length,
    });
  });

  // ── POST /:id/pause ───────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(`${BASE}/:id/pause`, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;

    const trigger = await prisma.automationTrigger.findFirst({
      where: { id, orgId: user.orgId, eventType: 'friend_invite_to_list' },
      select: { id: true, state: true, segmentSpec: true },
    });
    if (!trigger) return reply.status(404).send({ error: 'trigger_not_found' });
    if (trigger.state !== 'active')
      return reply.status(400).send({ error: 'not_active', current: trigger.state });

    await prisma.automationTrigger.update({
      where: { id: trigger.id },
      data: { state: 'paused' },
    });

    // Stop workers for this trigger's nicks IF no other active trigger uses them
    const spec = trigger.segmentSpec;
    if (isFriendInviteSegmentSpec(spec)) {
      for (const nickId of spec.nickIds) {
        // Check if any other active trigger still uses this nick
        const otherActive = await prisma.automationTrigger.count({
          where: {
            orgId: user.orgId,
            id: { not: trigger.id },
            state: 'active',
            eventType: 'friend_invite_to_list',
            segmentSpec: {
              path: ['nickIds'],
              array_contains: nickId,
            } as object,
          },
        });
        if (otherActive === 0) {
          void stopNickWorker(nickId);
        }
      }
    }

    return reply.send({ ok: true, state: 'paused' });
  });

  // ── POST /:id/resume ──────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(`${BASE}/:id/resume`, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;

    const trigger = await prisma.automationTrigger.findFirst({
      where: { id, orgId: user.orgId, eventType: 'friend_invite_to_list' },
      select: { id: true, state: true, segmentSpec: true },
    });
    if (!trigger) return reply.status(404).send({ error: 'trigger_not_found' });
    if (trigger.state !== 'paused')
      return reply.status(400).send({ error: 'not_paused', current: trigger.state });

    await prisma.automationTrigger.update({
      where: { id: trigger.id },
      data: { state: 'active' },
    });

    const spec = trigger.segmentSpec;
    if (isFriendInviteSegmentSpec(spec)) {
      for (const nickId of spec.nickIds) {
        void startNickWorker(nickId, user.orgId);
      }
    }

    return reply.send({ ok: true, state: 'active' });
  });

  // ── POST /:id/cancel ──────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(`${BASE}/:id/cancel`, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;

    const trigger = await prisma.automationTrigger.findFirst({
      where: { id, orgId: user.orgId, eventType: 'friend_invite_to_list' },
      select: { id: true, state: true, segmentSpec: true },
    });
    if (!trigger) return reply.status(404).send({ error: 'trigger_not_found' });
    if (trigger.state === 'cancelled' || trigger.state === 'completed')
      return reply.status(400).send({ error: 'already_terminal', current: trigger.state });

    // Cancel pool entries — in-flight processing will be released by stuck sweeper
    await prisma.$transaction([
      prisma.automationTrigger.update({
        where: { id: trigger.id },
        data: { state: 'cancelled' },
      }),
      prisma.customerListEntry.updateMany({
        where: { triggerId: trigger.id, queueStatus: 'queued_for_pickup' },
        data: { queueStatus: 'cancelled' },
      }),
    ]);

    // Stop workers (if no other active trigger uses them)
    const spec = trigger.segmentSpec;
    if (isFriendInviteSegmentSpec(spec)) {
      for (const nickId of spec.nickIds) {
        void stopNickWorker(nickId);
      }
    }

    return reply.send({ ok: true, state: 'cancelled' });
  });

  // ── GET /:id/dashboard ────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(`${BASE}/:id/dashboard`, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params;

    const trigger = await prisma.automationTrigger.findFirst({
      where: { id, orgId: user.orgId, eventType: 'friend_invite_to_list' },
      include: {
        sequence: { select: { id: true, name: true } },
      },
    });
    if (!trigger) return reply.status(404).send({ error: 'trigger_not_found' });

    // Counters via single GROUP BY query
    const counts = await prisma.customerListEntry.groupBy({
      by: ['queueStatus'],
      where: { triggerId: trigger.id },
      _count: { id: true },
    });
    const counters: Record<string, number> = {
      total: 0,
      queued_for_pickup: 0,
      processing: 0,
      processed: 0,
      skipped_friend_cap: 0,
      skipped_recency: 0,
      skipped_status: 0,
      skipped_no_zalo: 0,
      failed_permanent: 0,
      failed_stuck: 0,
      cancelled: 0,
    };
    for (const c of counts) {
      counters.total += c._count.id;
      if (c.queueStatus) counters[c.queueStatus] = c._count.id;
    }

    // Outbox stats (sent + accepted)
    const sent = await prisma.friendRequestOutbox.count({
      where: { triggerId: trigger.id, sendStatus: { in: ['success', 'tentative'] } },
    });
    const accepted = await prisma.friendshipAttempt.count({
      where: {
        orgId: user.orgId,
        // attemptStateOnAccept is not on this model — using friend status instead
        // For now: count Friend rows with friendshipStatus='accepted' for the contacts in this trigger.
      },
    });

    // Nick load — per nick stats
    const spec = trigger.segmentSpec as { nickIds?: string[] } | null;
    const nickIds = spec?.nickIds ?? [];
    const nicks = await prisma.zaloAccount.findMany({
      where: { id: { in: nickIds }, orgId: user.orgId },
      select: { id: true, displayName: true, status: true, dailyFriendAddCap: true },
    });

    const nickStats = await Promise.all(
      nicks.map(async (nick) => {
        const sentToday = await prisma.friendRequestOutbox.count({
          where: {
            triggerId: trigger.id,
            nickId: nick.id,
            sendStatus: { in: ['success', 'tentative'] },
            createdAt: { gte: startOfDayVN() },
          },
        });
        const sentTotal = await prisma.friendRequestOutbox.count({
          where: { triggerId: trigger.id, nickId: nick.id, sendStatus: { in: ['success', 'tentative'] } },
        });
        const workerState = getNickWorkerState(nick.id);
        return {
          nickId: nick.id,
          displayName: nick.displayName,
          status: nick.status,
          dailyFriendAddCap: nick.dailyFriendAddCap,
          sentToday,
          sentTotal,
          workerRunning: workerState?.isRunning ?? false,
          workerBusy: workerState?.isBusy ?? false,
        };
      }),
    );

    return reply.send({
      trigger: {
        id: trigger.id,
        name: trigger.name,
        state: trigger.state,
        greetingTemplate: trigger.greetingTemplate,
        successorSequence: trigger.sequence,
        createdAt: trigger.createdAt,
      },
      counters: { ...counters, sent, accepted },
      nicks: nickStats,
    });
  });
}

function startOfDayVN(): Date {
  const now = new Date();
  const vnOffset = 7 * 60 * 60 * 1000;
  const vnNow = new Date(now.getTime() + vnOffset);
  vnNow.setUTCHours(0, 0, 0, 0);
  return new Date(vnNow.getTime() - vnOffset);
}
