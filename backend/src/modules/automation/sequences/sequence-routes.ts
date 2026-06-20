// Phase 7 — AutomationSequence CRUD routes.
//
// Sequence = multi-step drip with explicit delays. UI: vertical step diagram
// (anh chốt Q2 — không phải canvas, không phải flat list, mà là vertical flow
// với mỗi step là card + delay nằm giữa).
//
// Routes:
//   GET    /api/v1/automation/sequences             list
//   GET    /api/v1/automation/sequences/:id         detail (with steps + block refs)
//   POST   /api/v1/automation/sequences             create
//   PUT    /api/v1/automation/sequences/:id         update (steps/rules/name)
//   POST   /api/v1/automation/sequences/:id/enable  toggle on
//   POST   /api/v1/automation/sequences/:id/disable toggle off
//   POST   /api/v1/automation/sequences/:id/duplicate clone
//   DELETE /api/v1/automation/sequences/:id         hard delete (only if no campaigns)

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { requireGrant } from '../../rbac/rbac-middleware.js';
import { logger } from '../../../shared/utils/logger.js';
import {
  validateSteps,
  validateRuntimeRules,
  DEFAULT_RUNTIME_RULES,
  type SequenceStep,
  type SequenceRuntimeRules,
} from './types.js';
import { checkBlockReferences } from './block-refs.js';
import { getOwnerScope, applyOwnerScope } from '../../rbac/owner-scope.js';
// 2026-06-18 — Xem trước Sequence: tính giờ gửi từng bước (delay + né ngoài giờ).
import { stepDelayMs, nextAllowedTime, resolveWindowMinutes, etaCompleteAt } from '../engine/schedule-calculator.js';

// 2026-06-20 (anh chốt): TỔNG THỜI GIAN luồng = từ enroll tới gửi xong bước cuối, TÍNH CẢ
// thời gian chờ ngoài giờ (22:00–08:00) → "luồng mất mấy ngày thực". Neo vào đầu khung giờ
// của 1 ngày cố định (Thứ Hai 2026-01-05) để số ỔN ĐỊNH, không đổi theo thời điểm gọi API.
// Tái dùng etaCompleteAt (cùng calculator engine dùng) → khớp giờ gửi thật. ≤1 bước = 0.
function computeSequenceDurationMinutes(rawSteps: unknown, rawRules: unknown): number {
  const steps = (Array.isArray(rawSteps) ? rawSteps : []) as SequenceStep[];
  if (steps.length <= 1) return 0;
  const rules = (rawRules ?? {}) as SequenceRuntimeRules;
  const w = resolveWindowMinutes(rules);
  const startMin = w ? w.startMin : 0;
  const anchor = new Date(Date.UTC(2026, 0, 5, 0, 0, 0) - 7 * 3600_000 + startMin * 60_000);
  const eta = etaCompleteAt(steps, 0, anchor, rules);
  if (!eta) return 0;
  return Math.max(0, Math.round((eta.getTime() - anchor.getTime()) / 60_000));
}
// 2026-06-18 — Xem trước Sequence render bong bóng Ở BACKEND = đúng tin gửi thật:
// bóc block thành tin (resolveBlockContent) + thay đủ ~36 biến + dịch offset format (render-template).
import { resolveBlockContent } from '../blocks/resolve-block-content.js';
import { renderTemplate, renderTemplateDetailed, shiftStylesForRender } from '../blocks/render-template.js';

// 2026-06-04 — Khối Phase 1: sync JSON steps → sequence_steps FK table.
// Worker dual-read (sequence-step-worker.ts loadSequenceSteps): ưu tiên FK table,
// fallback JSON nếu rows empty. Dual-write window 2 tuần → drop JSON 2026-06-18.
async function syncSequenceStepsTable(sequenceId: string, steps: SequenceStep[]): Promise<void> {
  try {
    await prisma.sequenceStep.deleteMany({ where: { sequenceId } });
    if (steps.length === 0) return;
    for (const [idx, s] of steps.entries()) {
      await prisma.sequenceStep.create({
        data: {
          id: randomUUID(),
          sequenceId,
          blockId: s.blockId || null,
          stepOrder: idx,
          delayMinutes: s.delayMinutes ?? 0,
          jitterMinutes: s.delayJitterMinutes ?? 0,
          ...(s.exitCondition ? { exitCondition: s.exitCondition as unknown as object } : {}),
        },
      });
    }
  } catch (err) {
    logger.warn(`[sequence] syncSequenceStepsTable failed for ${sequenceId}: ${err}`);
    // Non-fatal: JSON write thành công, worker fallback đọc JSON cũ. Retry sweeper sau.
  }
}

const BASE = '/api/v1/automation/sequences';

// ── Helper cho Xem trước Sequence (2026-06-18) ──────────────────────────────
type PreviewBubble =
  | { type: 'text'; text: string; styles: Array<{ st: string; start: number; len: number }> }
  | { type: 'image'; url: string; caption: string }
  | { type: 'album'; items: Array<{ url: string; caption: string }> }
  | { type: 'file'; url: string; filename: string; caption: string }
  | { type: 'video'; url: string; thumbnailUrl: string; caption: string };

/**
 * Render 1 Khối thành các bong bóng ĐÚNG NHƯ TIN GỬI THẬT cho KH này:
 * bóc content (resolveBlockContent — chung path gửi) → thay đủ ~36 biến (renderTemplate) →
 * dịch offset format (shiftStylesForRender). nickId rỗng vẫn ra biến cấp-người (name/gender),
 * chỉ {sale}/{crm_*} fallback 'em'/tên thật.
 */
async function renderBlockBubbles(
  block: { actionType: string; content: unknown } | null,
  contactId: string,
  nickId: string,
): Promise<PreviewBubble[]> {
  if (!block) return [];
  const res = resolveBlockContent(block.actionType, (block.content ?? {}) as Record<string, unknown>);
  if (!res.ok) return [];
  const out: PreviewBubble[] = [];
  for (const m of res.resolved) {
    if (m.messageType === 'text') {
      const raw = m.payload.text ?? '';
      const rawStyles = Array.isArray(m.payload.styles) ? m.payload.styles : [];
      const { rendered, values } = await renderTemplateDetailed(raw, contactId, nickId);
      const shifted = rawStyles.length ? (shiftStylesForRender(raw, rawStyles, values) ?? []) : [];
      out.push({ type: 'text', text: rendered, styles: shifted });
    } else if (m.messageType === 'friend_request') {
      out.push({ type: 'text', text: await renderTemplate(m.payload.greeting ?? '', contactId, nickId), styles: [] });
    } else if (m.messageType === 'image') {
      out.push({ type: 'image', url: m.payload.url, caption: m.payload.caption ? await renderTemplate(m.payload.caption, contactId, nickId) : '' });
    } else if (m.messageType === 'album') {
      const items: Array<{ url: string; caption: string }> = [];
      for (const it of m.payload.items) items.push({ url: it.url, caption: it.caption ? await renderTemplate(it.caption, contactId, nickId) : '' });
      out.push({ type: 'album', items });
    } else if (m.messageType === 'file') {
      out.push({ type: 'file', url: m.payload.url, filename: m.payload.filename ?? 'Tệp đính kèm', caption: m.payload.caption ? await renderTemplate(m.payload.caption, contactId, nickId) : '' });
    } else if (m.messageType === 'video') {
      out.push({ type: 'video', url: m.payload.url, thumbnailUrl: m.payload.thumbnailUrl ?? '', caption: m.payload.caption ? await renderTemplate(m.payload.caption, contactId, nickId) : '' });
    }
  }
  return out;
}
/** Câu mô tả khung giờ gửi, vd "8:00–22:00" hoặc "cả ngày". */
function windowLabelOf(rules: SequenceRuntimeRules): string {
  const w = resolveWindowMinutes(rules);
  if (!w) return 'cả ngày';
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${fmt(w.startMin)}–${fmt(w.endMin)}`;
}
/** Câu mô tả giãn cách giữa 2 bước, vd "30–60 phút" / "1 giờ". */
function gapLabelOf(rules: SequenceRuntimeRules): string {
  const g = rules.sendGap;
  if (!g) return '—';
  const unit = g.unit === 'hour' ? 'giờ' : g.unit === 'second' ? 'giây' : 'phút';
  if (typeof g.min === 'number' && typeof g.max === 'number' && g.min !== g.max) {
    return `${g.min}–${g.max} ${unit}`;
  }
  const v = (g.value ?? g.min ?? g.max);
  return v != null ? `${v} ${unit}` : '—';
}

export async function sequenceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // List sequences (sidebar feed in /automation page)
  app.get(BASE, async (request: FastifyRequest) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;

    const where: Record<string, unknown> = { orgId: user.orgId };
    if (q.channel) where.channel = q.channel;
    if (q.enabled === 'true') where.enabled = true;
    if (q.enabled === 'false') where.enabled = false;
    // Phase Marketing Scope 2026-05-27
    const ownerScope = await getOwnerScope({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'sequence',
    });
    Object.assign(where, applyOwnerScope(ownerScope));

    const sequences = await prisma.automationSequence.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        createdBy: { select: { id: true, fullName: true } },
        _count: { select: { campaigns: true } },
      },
    });
    // Đính kèm "tổng thời gian luồng" (phút, đã tính cả ngoài giờ) → card hiện "≈ mấy ngày".
    const withDuration = sequences.map((seq) => ({
      ...seq,
      estimatedDurationMinutes: computeSequenceDurationMinutes(seq.steps, seq.runtimeRules),
    }));
    return { sequences: withDuration };
  });

  // Get one sequence with embedded block lookups for editor
  app.get(`${BASE}/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    // Phase Marketing Scope 2026-05-27: scope detail
    const ownerScope = await getOwnerScope({
      userId: user.id, orgId: user.orgId, legacyRole: user.role, resource: 'sequence',
    });
    const sWhere: any = { id, orgId: user.orgId };
    Object.assign(sWhere, applyOwnerScope(ownerScope));
    const sequence = await prisma.automationSequence.findFirst({
      where: sWhere,
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    if (!sequence) return reply.status(404).send({ error: 'sequence not found' });

    // Eager-load referenced blocks for the UI editor (avoid N+1 in client)
    const steps = Array.isArray(sequence.steps) ? (sequence.steps as unknown as SequenceStep[]) : [];
    const blockIds = Array.from(new Set(steps.map((s) => s.blockId)));
    const blocks = blockIds.length
      ? await prisma.block.findMany({
          where: { id: { in: blockIds }, orgId: user.orgId },
          select: {
            id: true, name: true, actionType: true, archivedAt: true,
            ownerNick: { select: { id: true, displayName: true } },
          },
        })
      : [];

    return { ...sequence, blocks };
  });

  // ── 2026-06-18 — XEM TRƯỚC tin nhắn Sequence sẽ gửi cho 1-2 KH ──────────────
  // Trả raw block (FE tái dùng logic render bong bóng) + GIỜ GỬI cụ thể từng bước
  // (giả lập enroll TỪ BÂY GIỜ: cộng dồn delay + né ngoài giờ, qua ngày thì sang mai).
  app.post(`${BASE}/:id/preview`, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { contactIds?: string[]; nickId?: string };
    const contactIds = (Array.isArray(body.contactIds) ? body.contactIds : []).slice(0, 2);
    const bodyNickId = typeof body.nickId === 'string' ? body.nickId : '';
    if (contactIds.length === 0) return reply.status(400).send({ error: 'contactIds_required' });

    const sequence = await prisma.automationSequence.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true, name: true, steps: true, runtimeRules: true },
    });
    if (!sequence) return reply.status(404).send({ error: 'sequence_not_found' });
    const rules = (sequence.runtimeRules ?? {}) as SequenceRuntimeRules;

    // Steps (dual-read: FK table ưu tiên, fallback JSON — như worker).
    let steps = (await prisma.sequenceStep.findMany({
      where: { sequenceId: id }, orderBy: { stepOrder: 'asc' },
      select: { blockId: true, delayMinutes: true, jitterMinutes: true },
    })).map((r) => ({ blockId: r.blockId, delayMinutes: r.delayMinutes, jitterMinutes: r.jitterMinutes ?? 0 }));
    if (steps.length === 0) {
      steps = (Array.isArray(sequence.steps) ? (sequence.steps as unknown as SequenceStep[]) : [])
        .map((s) => ({ blockId: s.blockId, delayMinutes: s.delayMinutes ?? 0, jitterMinutes: s.delayJitterMinutes ?? 0 }));
    }
    steps = steps.filter((s) => !!s.blockId);
    if (steps.length === 0) return reply.status(400).send({ error: 'sequence_empty' });

    // Blocks (content) + contacts.
    const blockIds = Array.from(new Set(steps.map((s) => s.blockId as string)));
    const [blocks, contacts] = await Promise.all([
      prisma.block.findMany({
        where: { id: { in: blockIds }, orgId: user.orgId },
        select: { id: true, name: true, actionType: true, content: true, archivedAt: true },
      }),
      prisma.contact.findMany({
        where: { id: { in: contactIds }, orgId: user.orgId },
        select: { id: true, fullName: true, crmName: true, gender: true },
      }),
    ]);
    const blockById = new Map(blocks.map((b) => [b.id, b]));

    // Per contact: cộng dồn giờ gửi + render bong bóng Ở BACKEND (= đúng tin gửi thật, đủ biến).
    const now = new Date();
    const previewContacts = await Promise.all(contacts.map(async (c) => {
      const name = c.fullName ?? c.crmName ?? 'bạn';
      // Nick để render {sale}/{crm_*}: ưu tiên nick từ chat (bodyNickId); else nick của Friend
      // đầu tiên của KH; else rỗng (vẫn ra name/gender cấp-người, {sale} fallback 'em').
      let nickId = bodyNickId;
      if (!nickId) {
        const fr = await prisma.friend.findFirst({ where: { contactId: c.id, orgId: user.orgId }, select: { zaloAccountId: true } });
        nickId = fr?.zaloAccountId ?? '';
      }
      let t = now;
      const stepsOut = [];
      for (let idx = 0; idx < steps.length; idx++) {
        const s = steps[idx];
        const gapMs = stepDelayMs(s.delayMinutes ?? 0, s.jitterMinutes ?? 0, () => 0.5);
        t = nextAllowedTime(new Date(t.getTime() + gapMs), rules);
        const block = s.blockId ? blockById.get(s.blockId) ?? null : null;
        const bubbles = await renderBlockBubbles(block, c.id, nickId);
        stepsOut.push({
          stepIdx: idx,
          delayMinutes: s.delayMinutes ?? 0,
          sendAt: t.toISOString(),
          blockName: block?.name ?? null,
          bubbles,
        });
      }
      return {
        contactId: c.id,
        name,
        steps: stepsOut,
        etaCompleteAt: stepsOut.length ? stepsOut[stepsOut.length - 1].sendAt : null,
      };
    }));

    return {
      sequence: {
        id: sequence.id,
        name: sequence.name,
        totalSteps: steps.length,
        windowLabel: windowLabelOf(rules),
        gapLabel: gapLabelOf(rules),
      },
      contacts: previewContacts,
    };
  });

  // Create sequence
  app.post(BASE, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as Record<string, any>;

      if (!body.name || typeof body.name !== 'string') {
        return reply.status(400).send({ error: 'name is required' });
      }

      const stepsValidation = validateSteps(body.steps ?? []);
      if (!stepsValidation.ok) {
        return reply.status(400).send({ error: 'steps invalid', detail: stepsValidation.error });
      }

      const rulesValidation = validateRuntimeRules(body.runtimeRules);
      if (!rulesValidation.ok) {
        return reply.status(400).send({ error: 'runtimeRules invalid', detail: rulesValidation.error });
      }

      // Check all referenced blocks exist in this org, not archived
      const refCheck = await checkBlockReferences(user.orgId, stepsValidation.steps);
      if (!refCheck.ok) {
        return reply.status(400).send({
          error: 'block references invalid',
          missingBlockIds: refCheck.missingBlockIds,
          archivedBlockIds: refCheck.archivedBlockIds,
        });
      }

      const sequence = await prisma.automationSequence.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          name: body.name.trim(),
          description: body.description ?? null,
          channel: body.channel ?? 'zalo_user',
          steps: stepsValidation.steps as unknown as object,
          runtimeRules: { ...DEFAULT_RUNTIME_RULES, ...rulesValidation.rules } as unknown as object,
          enabled: body.enabled ?? true,
          createdById: user.id,
        },
      });
      // 2026-06-04: dual-write FK table
      await syncSequenceStepsTable(sequence.id, stepsValidation.steps);
      return reply.status(201).send(sequence);
    } catch (error) {
      logger.error('[sequence] create error:', error);
      return reply.status(500).send({ error: 'Failed to create sequence' });
    }
  });

  // Update sequence — steps/rules/name can all change. Existing campaigns/tasks
  // keep their rulesSnapshot at activation time → edit is safe for in-flight runs.
  app.put(`${BASE}/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      const existing = await prisma.automationSequence.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'sequence not found' });

      const data: Record<string, unknown> = {};

      if (body.name !== undefined) data.name = body.name.trim();
      if (body.description !== undefined) data.description = body.description;
      if (body.channel !== undefined) data.channel = body.channel;
      if (body.enabled !== undefined) data.enabled = body.enabled;

      if (body.steps !== undefined) {
        const v = validateSteps(body.steps);
        if (!v.ok) return reply.status(400).send({ error: 'steps invalid', detail: v.error });
        const refCheck = await checkBlockReferences(user.orgId, v.steps);
        if (!refCheck.ok) {
          return reply.status(400).send({
            error: 'block references invalid',
            missingBlockIds: refCheck.missingBlockIds,
            archivedBlockIds: refCheck.archivedBlockIds,
          });
        }
        data.steps = v.steps as unknown as object;
      }

      if (body.runtimeRules !== undefined) {
        const v = validateRuntimeRules(body.runtimeRules);
        if (!v.ok) return reply.status(400).send({ error: 'runtimeRules invalid', detail: v.error });
        data.runtimeRules = v.rules as unknown as object;
      }

      const sequence = await prisma.automationSequence.update({ where: { id }, data });
      // 2026-06-04: dual-write FK table khi steps thay đổi
      if (body.steps !== undefined) {
        await syncSequenceStepsTable(sequence.id, sequence.steps as unknown as SequenceStep[]);
      }
      return sequence;
    } catch (error) {
      logger.error('[sequence] update error:', error);
      return reply.status(500).send({ error: 'Failed to update sequence' });
    }
  });

  // Enable/disable toggles
  app.post(`${BASE}/:id/enable`, async (request: FastifyRequest, reply: FastifyReply) => {
    return toggleEnabled(request, reply, true);
  });
  app.post(`${BASE}/:id/disable`, async (request: FastifyRequest, reply: FastifyReply) => {
    return toggleEnabled(request, reply, false);
  });

  // Duplicate
  app.post(`${BASE}/:id/duplicate`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const source = await prisma.automationSequence.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!source) return reply.status(404).send({ error: 'sequence not found' });

      const copy = await prisma.automationSequence.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          name: `${source.name} (copy)`,
          description: source.description,
          channel: source.channel,
          steps: source.steps as object,
          runtimeRules: source.runtimeRules as object,
          enabled: false, // copy starts disabled to avoid accidental double-run
          createdById: user.id,
        },
      });
      // 2026-06-04: dual-write FK table cho copy
      await syncSequenceStepsTable(copy.id, source.steps as unknown as SequenceStep[]);
      return reply.status(201).send(copy);
    } catch (error) {
      logger.error('[sequence] duplicate error:', error);
      return reply.status(500).send({ error: 'Failed to duplicate sequence' });
    }
  });

  // Hard delete — disallow if any campaigns exist (state machine integrity).
  // To free up: pause+complete campaigns first, or rename and disable.
  app.delete(`${BASE}/:id`, { preHandler: requireGrant('sequence', 'delete') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const existing = await prisma.automationSequence.findFirst({
        where: { id, orgId: user.orgId },
        include: { _count: { select: { campaigns: true } } },
      });
      if (!existing) return reply.status(404).send({ error: 'sequence not found' });

      if (existing._count.campaigns > 0) {
        return reply.status(409).send({
          error: 'sequence has campaigns',
          detail: `${existing._count.campaigns} campaign(s) reference this sequence. Disable instead, or remove campaigns first.`,
        });
      }

      await prisma.automationSequence.delete({ where: { id } });
      return { success: true };
    } catch (error) {
      logger.error('[sequence] delete error:', error);
      return reply.status(500).send({ error: 'Failed to delete sequence' });
    }
  });
}

async function toggleEnabled(request: FastifyRequest, reply: FastifyReply, enabled: boolean) {
  try {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const existing = await prisma.automationSequence.findFirst({
      where: { id, orgId: user.orgId },
      select: { id: true },
    });
    if (!existing) return reply.status(404).send({ error: 'sequence not found' });
    const sequence = await prisma.automationSequence.update({
      where: { id },
      data: { enabled },
    });
    return sequence;
  } catch (error) {
    logger.error('[sequence] toggle error:', error);
    return reply.status(500).send({ error: 'Failed to toggle sequence' });
  }
}
