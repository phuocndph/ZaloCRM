/**
 * scoring/scoring-routes.ts — REST API cho Lead Scoring Engine.
 *
 * Endpoints:
 *   GET    /api/v1/scoring/config             — get org-level config
 *   PUT    /api/v1/scoring/config             — update weights/decay/flags
 *   GET    /api/v1/scoring/rules              — list signal rules
 *   PUT    /api/v1/scoring/rules/:id          — update 1 rule
 *   GET    /api/v1/scoring/stage-transitions  — list rules
 *   GET    /api/v1/scoring/stuck-thresholds   — list per-stage stuck
 *   GET    /api/v1/scoring/nba-templates      — list NBA templates
 *   POST   /api/v1/scoring/seed-defaults      — admin trigger seed (idempotent)
 *
 *   GET    /api/v1/friends/:id/score-breakdown — full breakdown for explainability
 *   POST   /api/v1/friends/:id/promote         — manual promote stage
 *   POST   /api/v1/scoring/recompute-all       — admin recompute all friends (sau khi đổi weights)
 *
 *   GET    /api/v1/leads/stuck                — stuck deals dashboard (PR4)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { logActivity } from '../activity/activity-logger.js';
import { getScoringConfig, invalidateCache } from './config-cache.js';
import { manualPromote, evaluateAndPromote } from './stage-promotion.js';
import { seedScoringDefaults } from './seed-defaults.js';
import { recomputeFriendFinalScore } from './scoring-hooks.js';

export async function scoringRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ──── Config ──────────────────────────────────────────────────────────

  app.get('/api/v1/scoring/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    try {
      const config = await getScoringConfig(user.orgId);
      return config;
    } catch (err) {
      logger.error({ err }, 'GET scoring config failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  app.put('/api/v1/scoring/config', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    if (user.role !== 'admin' && user.role !== 'owner') {
      return reply.status(403).send({ error: 'forbidden' });
    }
    const body = request.body as Record<string, any>;

    // Validate weights sum
    if (
      body.weightEngagement != null ||
      body.weightIntent != null ||
      body.weightFit != null ||
      body.weightVelocity != null
    ) {
      const existing = await prisma.scoringConfig.findUnique({ where: { orgId: user.orgId } });
      const e = body.weightEngagement ?? existing?.weightEngagement ?? 35;
      const i = body.weightIntent ?? existing?.weightIntent ?? 30;
      const f = body.weightFit ?? existing?.weightFit ?? 15;
      const v = body.weightVelocity ?? existing?.weightVelocity ?? 20;
      const sum = e + i + f + v;
      if (sum !== 100) {
        return reply.status(400).send({ error: 'weights_must_sum_100', got: sum });
      }
    }

    try {
      const updated = await prisma.scoringConfig.upsert({
        where: { orgId: user.orgId },
        update: {
          weightEngagement: body.weightEngagement,
          weightIntent: body.weightIntent,
          weightFit: body.weightFit,
          weightVelocity: body.weightVelocity,
          decayDay3to7: body.decayDay3to7,
          decayDay7to14: body.decayDay7to14,
          decayDay14to30: body.decayDay14to30,
          decayDay30to60: body.decayDay30to60,
          autoPromote: body.autoPromote,
          stuckDetectionEnabled: body.stuckDetectionEnabled,
          explainabilityEnabled: body.explainabilityEnabled,
        },
        create: {
          orgId: user.orgId,
          weightEngagement: body.weightEngagement ?? 35,
          weightIntent: body.weightIntent ?? 30,
          weightFit: body.weightFit ?? 15,
          weightVelocity: body.weightVelocity ?? 20,
        },
      });

      invalidateCache(user.orgId);

      logActivity({
        orgId: user.orgId,
        userId: user.id,
        action: 'scoring_config_update',
        entityType: 'scoring_config',
        entityId: updated.id,
        category: 'system',
        details: body,
      });

      return updated;
    } catch (err) {
      logger.error({ err }, 'PUT scoring config failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ──── Signal Rules ─────────────────────────────────────────────────────

  app.get('/api/v1/scoring/rules', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    try {
      const rules = await prisma.scoreSignalRule.findMany({
        where: { orgId: user.orgId },
        orderBy: [{ dimension: 'asc' }, { signalKey: 'asc' }],
      });
      return rules;
    } catch (err) {
      logger.error({ err }, 'GET scoring rules failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  app.put<{ Params: { id: string } }>(
    '/api/v1/scoring/rules/:id',
    async (request, reply: FastifyReply) => {
      const user = request.user!;
      if (user.role !== 'admin' && user.role !== 'owner') {
        return reply.status(403).send({ error: 'forbidden' });
      }
      const body = request.body as Record<string, any>;

      try {
        const rule = await prisma.scoreSignalRule.findUnique({
          where: { id: request.params.id },
        });
        if (!rule || rule.orgId !== user.orgId) {
          return reply.status(404).send({ error: 'rule_not_found' });
        }

        const updated = await prisma.scoreSignalRule.update({
          where: { id: request.params.id },
          data: {
            delta: body.delta,
            capPerDay: body.capPerDay,
            capTotal: body.capTotal,
            keywords: body.keywords,
            label: body.label,
            applicableStages: body.applicableStages,
            enabled: body.enabled,
          },
        });

        invalidateCache(user.orgId);

        logActivity({
          orgId: user.orgId,
          userId: user.id,
          action: 'scoring_rule_update',
          entityType: 'score_signal_rule',
          entityId: updated.id,
          category: 'system',
          details: { signalKey: updated.signalKey, changes: body },
        });

        return updated;
      } catch (err) {
        logger.error({ err }, 'PUT scoring rule failed');
        return reply.status(500).send({ error: 'internal_error' });
      }
    }
  );

  // ──── Stage Transitions + Stuck Thresholds + NBA (read-only for now) ──

  app.get('/api/v1/scoring/stage-transitions', async (request, reply) => {
    const user = request.user!;
    const rules = await prisma.stageTransitionRule.findMany({
      where: { orgId: user.orgId },
      orderBy: { fromStage: 'asc' },
    });
    return rules;
  });

  app.get('/api/v1/scoring/stuck-thresholds', async (request, reply) => {
    const user = request.user!;
    const t = await prisma.stuckThreshold.findMany({
      where: { orgId: user.orgId },
      orderBy: { stage: 'asc' },
    });
    return t;
  });

  app.get('/api/v1/scoring/nba-templates', async (request, reply) => {
    const user = request.user!;
    const tpl = await prisma.nbaTemplate.findMany({
      where: { orgId: user.orgId },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
    return tpl;
  });

  // ──── Seed defaults (admin idempotent) ────────────────────────────────

  app.post('/api/v1/scoring/seed-defaults', async (request, reply) => {
    const user = request.user!;
    if (user.role !== 'admin' && user.role !== 'owner') {
      return reply.status(403).send({ error: 'forbidden' });
    }
    try {
      const result = await seedScoringDefaults(user.orgId);
      return result;
    } catch (err) {
      logger.error({ err }, 'seed-defaults failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ──── Friend score breakdown (explainability) ─────────────────────────

  app.get<{ Params: { id: string } }>(
    '/api/v1/friends/:id/score-breakdown',
    async (request, reply) => {
      const user = request.user!;
      const friend = await prisma.friend.findUnique({
        where: { id: request.params.id },
        select: {
          id: true,
          orgId: true,
          leadScore: true,
          scoreBreakdown: true,
          scoreUpdatedAt: true,
          statusRef: { select: { name: true, color: true } },
          stageEnteredAt: true,
          stuckSince: true,
          autoTags: true,
          contact: {
            select: {
              id: true,
              fullName: true,
              crmName: true,
              leadScore: true,
              aggregateBreakdown: true,
            },
          },
        },
      });
      if (!friend) return reply.status(404).send({ error: 'friend_not_found' });
      if (friend.orgId !== user.orgId) return reply.status(403).send({ error: 'forbidden' });

      return friend;
    }
  );

  // ──── Manual promote ───────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>(
    '/api/v1/friends/:id/promote',
    async (request, reply) => {
      const user = request.user!;
      const body = request.body as { statusId: string; reason?: string };

      if (!body.statusId) {
        return reply.status(400).send({ error: 'statusId_required' });
      }

      const result = await manualPromote(
        user.orgId,
        user.id,
        request.params.id,
        body.statusId,
        body.reason
      );

      if (!result.ok) {
        return reply.status(400).send(result);
      }
      return result;
    }
  );

  // ──── Re-evaluate auto-promote (admin trigger) ────────────────────────

  app.post<{ Params: { id: string } }>(
    '/api/v1/friends/:id/evaluate-promote',
    async (request, reply) => {
      const user = request.user!;
      const friend = await prisma.friend.findUnique({
        where: { id: request.params.id },
        select: { orgId: true },
      });
      if (!friend || friend.orgId !== user.orgId) {
        return reply.status(404).send({ error: 'friend_not_found' });
      }
      const result = await evaluateAndPromote(request.params.id);
      return result;
    }
  );

  // ──── Stuck Detection Dashboard ────────────────────────────────────────

  /**
   * GET /api/v1/leads/stuck — Stuck deals dashboard data.
   * Response shape:
   *   {
   *     totalStuck: 10,
   *     byStage: [
   *       { stage: "Mới", thresholdDays: 7, alertLabel: "...", nbaTemplateKey: "...",
   *         friends: [{ friendId, contactId, contactName, score, daysInStage,
   *                     daysSinceLastInbound, autoTags, nbaTemplate? }] }
   *       ...
   *     ]
   *   }
   */
  app.get('/api/v1/leads/stuck', async (request, reply) => {
    const user = request.user!;
    try {
      const thresholds = await prisma.stuckThreshold.findMany({
        where: { orgId: user.orgId, enabled: true },
        orderBy: { stage: 'asc' },
      });

      const stuckFriends = await prisma.friend.findMany({
        where: {
          orgId: user.orgId,
          stuckSince: { not: null },
        },
        select: {
          id: true,
          contactId: true,
          leadScore: true,
          stuckSince: true,
          stageEnteredAt: true,
          createdAt: true,
          lastInboundAt: true,
          autoTags: true,
          zaloDisplayName: true,
          aliasInNick: true,
          statusRef: { select: { id: true, name: true, color: true } },
          contact: {
            select: {
              id: true,
              fullName: true,
              crmName: true,
              avatarUrl: true,
              phone: true,
            },
          },
        },
        orderBy: { stuckSince: 'asc' },
      });

      // Group by stage
      const byStageMap = new Map<
        string,
        {
          stage: string;
          color: string | null;
          thresholdDays: number;
          alertLabel: string;
          nbaTemplateKey: string | null;
          friends: any[];
        }
      >();

      for (const t of thresholds) {
        byStageMap.set(t.stage, {
          stage: t.stage,
          color: null,
          thresholdDays: t.thresholdDays,
          alertLabel: t.alertLabel,
          nbaTemplateKey: t.nbaTemplateKey,
          friends: [],
        });
      }

      for (const f of stuckFriends) {
        const stageName = f.statusRef?.name;
        if (!stageName) continue;
        const group = byStageMap.get(stageName);
        if (!group) continue;

        if (!group.color && f.statusRef?.color) group.color = f.statusRef.color;

        const referenceTime = f.stageEnteredAt ?? f.createdAt;
        const daysInStage = Math.floor((Date.now() - referenceTime.getTime()) / (24 * 3600 * 1000));
        const daysSinceLastInbound = f.lastInboundAt
          ? Math.floor((Date.now() - f.lastInboundAt.getTime()) / (24 * 3600 * 1000))
          : null;

        group.friends.push({
          friendId: f.id,
          contactId: f.contactId,
          contactName:
            f.aliasInNick ||
            f.zaloDisplayName ||
            f.contact?.crmName ||
            f.contact?.fullName ||
            'Khách hàng',
          contactAvatar: f.contact?.avatarUrl ?? null,
          phone: f.contact?.phone ?? null,
          score: f.leadScore,
          daysInStage,
          daysSinceLastInbound,
          stuckSince: f.stuckSince,
          autoTags: f.autoTags ?? [],
        });
      }

      // Attach NBA template content
      const allTemplateKeys = Array.from(byStageMap.values())
        .map((g) => g.nbaTemplateKey)
        .filter((k): k is string => !!k);
      const templates =
        allTemplateKeys.length > 0
          ? await prisma.nbaTemplate.findMany({
              where: { orgId: user.orgId, key: { in: allTemplateKeys }, enabled: true },
            })
          : [];
      const templateMap = new Map(templates.map((t) => [t.key, t]));

      const byStage = Array.from(byStageMap.values())
        .map((g) => ({
          ...g,
          friends: g.friends.sort((a, b) => b.daysInStage - a.daysInStage), // most stuck first
          nbaTemplate: g.nbaTemplateKey ? templateMap.get(g.nbaTemplateKey) ?? null : null,
        }))
        .filter((g) => g.friends.length > 0);

      return {
        totalStuck: stuckFriends.length,
        byStage,
      };
    } catch (err) {
      logger.error({ err }, 'GET /leads/stuck failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  /**
   * POST /api/v1/leads/stuck/scan — admin trigger stuck detection scan now.
   * Don't wait for daily cron.
   */
  app.post('/api/v1/leads/stuck/scan', async (request, reply) => {
    const user = request.user!;
    if (user.role !== 'admin' && user.role !== 'owner') {
      return reply.status(403).send({ error: 'forbidden' });
    }
    try {
      const { runStuckDetectionForOrg } = await import('./stuck-detection.js');
      const result = await runStuckDetectionForOrg(user.orgId);
      return result;
    } catch (err) {
      logger.error({ err }, 'manual stuck scan failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });

  // ──── Recompute final scores (after weights change) ───────────────────

  app.post('/api/v1/scoring/recompute-all', async (request, reply) => {
    const user = request.user!;
    if (user.role !== 'admin' && user.role !== 'owner') {
      return reply.status(403).send({ error: 'forbidden' });
    }
    try {
      // Get all friends with scoreBreakdown set
      const friends = await prisma.friend.findMany({
        where: { orgId: user.orgId, scoreUpdatedAt: { not: null } },
        select: { id: true },
        take: 5000, // safety limit
      });

      let updated = 0;
      let unchanged = 0;
      for (const f of friends) {
        const r = await recomputeFriendFinalScore(user.orgId, f.id);
        if (!r) continue;
        if (r.delta !== 0) updated++;
        else unchanged++;
      }

      return { total: friends.length, updated, unchanged };
    } catch (err) {
      logger.error({ err }, 'recompute-all failed');
      return reply.status(500).send({ error: 'internal_error' });
    }
  });
}
