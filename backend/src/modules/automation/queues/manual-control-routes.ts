// ════════════════════════════════════════════════════════════════════════
// Luồng Mục Tiêu M9 — Manual control endpoints (2026-06-01)
// ════════════════════════════════════════════════════════════════════════
//
// 5 endpoint sale chat /chat dùng để pause/stop/resume/enroll 1 KH ad-hoc
// vào Mục tiêu hệ thống "Bám đuổi khách hàng thủ công".
//
// Endpoints (Section 22.4 design doc):
//   POST /api/v1/automation/triggers/:tid/contacts/:cid/pause
//   POST /api/v1/automation/triggers/:tid/contacts/:cid/stop
//   POST /api/v1/automation/triggers/:tid/contacts/:cid/resume
//   POST /api/v1/chat/contacts/:cid/manual-enroll
//   GET  /api/v1/contacts/:cid/automation-status

import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import {
  onManualPause,
  onManualStop,
  onManualResume,
  getContactPauseRemaining,
} from './event-hooks.js';
import { enqueueSequenceStart } from './sequence-step-worker.js';

export async function registerManualControlRoutes(app: FastifyInstance): Promise<void> {
  // ── POST pause-contact ──
  app.post<{
    Params: { tid: string; cid: string };
    Body: { hours: number; reason?: string };
  }>(
    '/api/v1/automation/triggers/:tid/contacts/:cid/pause',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tid, cid } = request.params;
      const { hours, reason } = request.body;
      const orgId = request.user!.orgId;

      // Verify trigger thuộc org
      const trigger = await prisma.automationTrigger.findFirst({
        where: { id: tid, orgId },
        select: { id: true },
      });
      if (!trigger) {
        reply.code(404);
        return { error: 'Mục tiêu không tồn tại' };
      }

      await onManualPause({
        orgId,
        triggerId: tid,
        contactId: cid,
        hours: Math.max(1, Math.min(720, hours)), // clamp 1h - 30 ngày
        reason,
        byUserId: request.user!.id,
      });

      return {
        ok: true,
        triggerId: tid,
        contactId: cid,
        pausedHours: hours,
      };
    },
  );

  // ── POST stop-contact ──
  app.post<{
    Params: { tid: string; cid: string };
    Body: { reason: string };
  }>(
    '/api/v1/automation/triggers/:tid/contacts/:cid/stop',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tid, cid } = request.params;
      const { reason } = request.body;
      const orgId = request.user!.orgId;

      if (!reason || reason.trim().length === 0) {
        reply.code(400);
        return { error: 'Lý do dừng bắt buộc nhập' };
      }

      const trigger = await prisma.automationTrigger.findFirst({
        where: { id: tid, orgId },
        select: { id: true },
      });
      if (!trigger) {
        reply.code(404);
        return { error: 'Mục tiêu không tồn tại' };
      }

      await onManualStop({
        orgId,
        triggerId: tid,
        contactId: cid,
        reason,
        byUserId: request.user!.id,
      });

      return {
        ok: true,
        triggerId: tid,
        contactId: cid,
      };
    },
  );

  // ── POST resume-contact ──
  app.post<{
    Params: { tid: string; cid: string };
  }>(
    '/api/v1/automation/triggers/:tid/contacts/:cid/resume',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { tid, cid } = request.params;
      const orgId = request.user!.orgId;

      const trigger = await prisma.automationTrigger.findFirst({
        where: { id: tid, orgId },
        select: { id: true },
      });
      if (!trigger) {
        reply.code(404);
        return { error: 'Mục tiêu không tồn tại' };
      }

      await onManualResume({
        orgId,
        triggerId: tid,
        contactId: cid,
        byUserId: request.user!.id,
      });

      return { ok: true };
    },
  );

  // ── POST manual-enroll (sale chat / chat enroll vào system trigger) ──
  app.post<{
    Params: { cid: string };
    Body: { sequenceId: string; nickId: string; reason: string };
  }>(
    '/api/v1/chat/contacts/:cid/manual-enroll',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { cid } = request.params;
      const { sequenceId, nickId, reason } = request.body;
      const orgId = request.user!.orgId;
      const userId = request.user!.id;

      if (!reason || reason.trim().length === 0) {
        reply.code(400);
        return { error: 'Lý do bám đuổi bắt buộc nhập' };
      }

      // Find system trigger "Bám đuổi khách hàng thủ công" trong org
      const systemTrigger = await prisma.automationTrigger.findFirst({
        where: {
          orgId,
          isSystemTrigger: true,
          systemKind: 'manual_chat_followup',
        },
        select: { id: true, name: true },
      });

      if (!systemTrigger) {
        reply.code(500);
        return { error: 'Mục tiêu hệ thống không tồn tại (chưa seed?)' };
      }

      // Verify sequence + nick thuộc org
      const [sequence, nick, contact] = await Promise.all([
        prisma.automationSequence.findFirst({
          where: { id: sequenceId, orgId, enabled: true },
          select: { id: true, name: true, steps: true },
        }),
        prisma.zaloAccount.findFirst({
          where: { id: nickId, orgId, status: 'connected' },
          select: { id: true, displayName: true },
        }),
        prisma.contact.findFirst({
          where: { id: cid, orgId },
          select: { id: true, fullName: true },
        }),
      ]);

      if (!sequence) {
        reply.code(404);
        return { error: 'Sequence không tồn tại hoặc đã tắt' };
      }
      if (!nick) {
        reply.code(404);
        return { error: 'Nick Zalo không tồn tại hoặc chưa kết nối' };
      }
      if (!contact) {
        reply.code(404);
        return { error: 'Khách hàng không tồn tại' };
      }

      // Find/create CustomerListEntry với manual enroll meta
      // (M9 system trigger không có listId — tạo entry pseudo qua existing customer list
      //  hoặc default org list. Đơn giản nhất: tạo entry với customerListId=null
      //  thông qua direct contact reference)
      //
      // Đơn giản M9: KHÔNG dùng CustomerListEntry queue path. Trực tiếp enqueue
      // sequence-step start với nick override.

      await enqueueSequenceStart({
        triggerId: systemTrigger.id,
        contactId: cid,
        sequenceId: sequence.id,
        nickId: nick.id,
        orgId,
        startDelayMinutes: 0, // Manual = gửi ngay
      });

      // Log enrollment event
      await prisma.automationEventLog.create({
        data: {
          orgId,
          triggerId: systemTrigger.id,
          contactId: cid,
          nickId: nick.id,
          eventType: 'manual_enroll',
          detail: `by ${userId} sequence=${sequence.name} reason=${reason}`,
        },
      });

      logger.info(
        `[manual-enroll] user=${userId} contact=${contact.fullName} sequence=${sequence.name} nick=${nick.displayName}`,
      );

      return {
        ok: true,
        systemTriggerId: systemTrigger.id,
        sequenceId: sequence.id,
        nickId: nick.id,
        contactId: cid,
        contactName: contact.fullName,
      };
    },
  );

  // ── GET automation-status (1 KH đang trong N luồng nào) ──
  app.get<{
    Params: { cid: string };
  }>(
    '/api/v1/contacts/:cid/automation-status',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { cid } = request.params;
      const orgId = request.user!.orgId;

      // Find all event logs for contact grouped by trigger
      // Latest 30 ngày
      const since = new Date(Date.now() - 30 * 86400_000);
      const events = await prisma.automationEventLog.findMany({
        where: {
          contactId: cid,
          orgId,
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          triggerId: true,
          eventType: true,
          detail: true,
          createdAt: true,
        },
      });

      // Group by trigger, find latest state
      const byTrigger = new Map<string, {
        triggerId: string;
        latestEvent: string;
        latestAt: Date;
        currentStep: number | null;
        totalSteps: number | null;
        pausedUntil: Date | null;
      }>();

      for (const evt of events) {
        if (!evt.triggerId) continue;
        if (!byTrigger.has(evt.triggerId)) {
          byTrigger.set(evt.triggerId, {
            triggerId: evt.triggerId,
            latestEvent: evt.eventType,
            latestAt: evt.createdAt,
            currentStep: null,
            totalSteps: null,
            pausedUntil: null,
          });
        }
        const stateRef = byTrigger.get(evt.triggerId)!;
        // Parse step "N/M"
        const stepMatch = evt.detail?.match(/step (\d+)\/(\d+)/);
        if (stepMatch && stateRef.currentStep === null) {
          stateRef.currentStep = parseInt(stepMatch[1], 10);
          stateRef.totalSteps = parseInt(stepMatch[2], 10);
        }
      }

      // Check Redis pause for each trigger
      const result = await Promise.all(
        [...byTrigger.values()].map(async (s) => {
          const pauseMs = await getContactPauseRemaining(s.triggerId, cid);
          const pausedUntil = pauseMs > 0 ? new Date(Date.now() + pauseMs) : null;

          // Load trigger name
          const trigger = await prisma.automationTrigger.findUnique({
            where: { id: s.triggerId },
            select: { name: true, isSystemTrigger: true, systemKind: true },
          });

          return {
            triggerId: s.triggerId,
            triggerName: trigger?.name ?? '',
            isSystemTrigger: trigger?.isSystemTrigger ?? false,
            systemKind: trigger?.systemKind,
            latestEvent: s.latestEvent,
            latestAt: s.latestAt,
            currentStep: s.currentStep,
            totalSteps: s.totalSteps,
            pausedUntilMs: pauseMs,
            pausedUntil,
            stopped: s.latestEvent === 'manual_stop' || s.latestEvent === 'customer_block',
          };
        }),
      );

      return { contactId: cid, triggers: result };
    },
  );

  logger.info('[manual-control-routes] registered 5 endpoints');
}
