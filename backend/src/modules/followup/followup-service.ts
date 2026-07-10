// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
// ════════════════════════════════════════════════════════════════════════════
// Follow-up Workflow (🟢 Community) — service: CRUD + versioning + thống kê + dữ
// liệu cho tab chat. Versioning: workflow đang có KH chạy → sửa = tạo VERSION MỚI
// (workflow cũ giữ nguyên phục vụ KH đang chạy).
// ════════════════════════════════════════════════════════════════════════════

import { prisma } from '../../shared/database/prisma-client.js';
import { recountWorkflow, stopEnrollment } from './followup-engine.js';

const RUNNING_STATES = ['running', 'waiting', 'waiting_sale'];

export interface StepInput {
  key: string;
  type: string;
  orderIndex?: number;
  label?: string | null;
  config?: unknown;
  nextKey?: string | null;
}

export interface WorkflowInput {
  name: string;
  description?: string | null;
  type?: string;
  goalType?: string;
  goalTag?: string | null;
  goalTagOnReach?: string | null;
  nextWorkflowId?: string | null;
  sendWindowStart?: number;
  sendWindowEnd?: number;
  minGapMinutes?: number;
  maxMessages?: number;
  timezone?: string;
  stopOnPurchase?: boolean;
  stopOnTags?: string[];
  steps?: StepInput[];
}

function sanitizeSteps(steps: StepInput[] | undefined): StepInput[] {
  if (!Array.isArray(steps)) return [];
  return steps
    .filter((s) => s && typeof s.key === 'string' && typeof s.type === 'string')
    .map((s, i) => ({
      key: s.key,
      type: s.type,
      orderIndex: s.orderIndex ?? i,
      label: s.label ?? null,
      config: s.config ?? {},
      nextKey: s.nextKey ?? null,
    }));
}

function workflowData(b: WorkflowInput) {
  const data: Record<string, unknown> = {};
  if (b.name !== undefined) data.name = b.name.trim();
  if (b.description !== undefined) data.description = b.description;
  if (b.type !== undefined) data.type = b.type;
  if (b.goalType !== undefined) data.goalType = b.goalType;
  if (b.goalTag !== undefined) data.goalTag = b.goalTag;
  if (b.goalTagOnReach !== undefined) data.goalTagOnReach = b.goalTagOnReach;
  if (b.nextWorkflowId !== undefined) data.nextWorkflowId = b.nextWorkflowId;
  if (b.sendWindowStart !== undefined) data.sendWindowStart = clampInt(b.sendWindowStart, 0, 1439, 480);
  if (b.sendWindowEnd !== undefined) data.sendWindowEnd = clampInt(b.sendWindowEnd, 1, 1440, 1080);
  if (b.minGapMinutes !== undefined) data.minGapMinutes = clampInt(b.minGapMinutes, 0, 1_000_000, 1440);
  if (b.maxMessages !== undefined) data.maxMessages = clampInt(b.maxMessages, 1, 1000, 5);
  if (b.timezone !== undefined) data.timezone = b.timezone || 'Asia/Ho_Chi_Minh';
  if (b.stopOnPurchase !== undefined) data.stopOnPurchase = !!b.stopOnPurchase;
  if (b.stopOnTags !== undefined) data.stopOnTags = Array.isArray(b.stopOnTags) ? b.stopOnTags.filter(Boolean) : [];
  return data;
}
function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

async function replaceSteps(workflowId: string, steps: StepInput[]): Promise<void> {
  const clean = sanitizeSteps(steps);
  await prisma.$transaction([
    prisma.followupStep.deleteMany({ where: { workflowId } }),
    ...(clean.length
      ? [prisma.followupStep.createMany({
          data: clean.map((s) => ({
            workflowId, key: s.key, type: s.type, orderIndex: s.orderIndex ?? 0,
            label: s.label ?? null, config: (s.config ?? {}) as any, nextKey: s.nextKey ?? null,
          })),
        })]
      : []),
  ]);
}

// ── Create ──────────────────────────────────────────────────────────────────
export async function createWorkflow(orgId: string, user: { id?: string; fullName?: string }, b: WorkflowInput) {
  const wf = await prisma.followupWorkflow.create({
    data: {
      orgId, createdById: user.id ?? null, createdByName: user.fullName ?? null,
      name: (b.name ?? 'Workflow mới').trim() || 'Workflow mới',
      status: 'draft',
      ...workflowData(b),
    } as any,
  });
  await prisma.followupWorkflow.update({ where: { id: wf.id }, data: { rootId: wf.id } });
  if (b.steps) await replaceSteps(wf.id, b.steps);
  return getWorkflow(wf.id, orgId);
}

// ── Update (có versioning) ────────────────────────────────────────────────────
export async function updateWorkflow(id: string, orgId: string, b: WorkflowInput) {
  const wf = await prisma.followupWorkflow.findFirst({ where: { id, orgId } });
  if (!wf) return { error: 'not_found' as const };

  const runningCount = await prisma.followupEnrollment.count({
    where: { workflowId: id, status: { in: RUNNING_STATES } },
  });

  // Đang có KH chạy + workflow active → tạo VERSION MỚI (không sửa bản đang phục vụ KH).
  if (runningCount > 0 && wf.status === 'active') {
    const clone = await prisma.followupWorkflow.create({
      data: {
        orgId, createdById: wf.createdById, createdByName: wf.createdByName,
        name: wf.name, description: wf.description, type: wf.type,
        goalType: wf.goalType, goalTag: wf.goalTag, goalTagOnReach: wf.goalTagOnReach, nextWorkflowId: wf.nextWorkflowId,
        sendWindowStart: wf.sendWindowStart, sendWindowEnd: wf.sendWindowEnd,
        minGapMinutes: wf.minGapMinutes, maxMessages: wf.maxMessages, timezone: wf.timezone,
        stopOnPurchase: wf.stopOnPurchase, stopOnTags: wf.stopOnTags,
        status: 'active', version: wf.version + 1, rootId: wf.rootId ?? wf.id, isLatest: true,
        ...workflowData(b),
      } as any,
    });
    // Bản cũ: không còn là latest (giữ nguyên phục vụ KH đang chạy).
    await prisma.followupWorkflow.update({ where: { id: wf.id }, data: { isLatest: false } });
    const srcSteps = b.steps ?? (await prisma.followupStep.findMany({ where: { workflowId: wf.id } })).map((s) => ({
      key: s.key, type: s.type, orderIndex: s.orderIndex, label: s.label, config: s.config, nextKey: s.nextKey,
    }));
    await replaceSteps(clone.id, srcSteps as StepInput[]);
    return { ...(await getWorkflow(clone.id, orgId)), newVersion: true };
  }

  // Chưa có KH chạy (hoặc draft) → sửa tại chỗ.
  await prisma.followupWorkflow.update({ where: { id }, data: workflowData(b) as any });
  if (b.steps) await replaceSteps(id, b.steps);
  return getWorkflow(id, orgId);
}

export async function setStatus(id: string, orgId: string, status: 'draft' | 'active' | 'paused' | 'archived') {
  const wf = await prisma.followupWorkflow.findFirst({ where: { id, orgId }, select: { id: true } });
  if (!wf) return { error: 'not_found' as const };
  await prisma.followupWorkflow.update({ where: { id }, data: { status } });
  return getWorkflow(id, orgId);
}

// ════════════════════════════════════════════════════════════════════════════
// Xoá chiến dịch — 2 mức.
//
// Lý do 2 mức (đã kiểm chứng trong schema): steps/enrollments/logs đều onDelete: Cascade.
// Xoá cứng một chiến dịch ĐANG/ĐÃ có khách ⇒ xoá luôn timeline chăm sóc của khách thật,
// không khôi phục được. Nên:
//   - Có enrollment  → LƯU TRỮ (archive): giữ toàn bộ lịch sử, dừng mọi KH đang chạy.
//   - Chưa từng có   → XOÁ VĨNH VIỄN được.
// ════════════════════════════════════════════════════════════════════════════

/** Tất cả version cùng gốc (rootId) của 1 chiến dịch. */
async function versionIdsOf(id: string, orgId: string): Promise<string[] | null> {
  const wf = await prisma.followupWorkflow.findFirst({ where: { id, orgId }, select: { id: true, rootId: true } });
  if (!wf) return null;
  const rootId = wf.rootId ?? wf.id;
  const rows = await prisma.followupWorkflow.findMany({
    where: { orgId, OR: [{ id: rootId }, { rootId }] },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export interface DeletePreview {
  workflowId: string;
  name: string;
  status: string;
  versions: number;
  enrollments: number;      // tổng, mọi version
  activeEnrollments: number; // đang running/waiting/waiting_sale
  referencedBy: number;      // số chiến dịch khác đang trỏ nextWorkflowId tới nó
  canPurge: boolean;         // đủ điều kiện xoá vĩnh viễn?
}

/** Thông tin để UI hiển thị cảnh báo TRƯỚC khi xoá. */
export async function previewDelete(id: string, orgId: string): Promise<DeletePreview | { error: 'not_found' }> {
  const ids = await versionIdsOf(id, orgId);
  if (!ids) return { error: 'not_found' };
  const wf = await prisma.followupWorkflow.findFirst({ where: { id, orgId }, select: { name: true, status: true } });
  const [enrollments, activeEnrollments, referencedBy] = await Promise.all([
    prisma.followupEnrollment.count({ where: { workflowId: { in: ids } } }),
    prisma.followupEnrollment.count({ where: { workflowId: { in: ids }, status: { in: RUNNING_STATES } } }),
    prisma.followupWorkflow.count({ where: { orgId, nextWorkflowId: { in: ids }, id: { notIn: ids } } }),
  ]);
  return {
    workflowId: id, name: wf?.name ?? '', status: wf?.status ?? '',
    versions: ids.length, enrollments, activeEnrollments, referencedBy,
    canPurge: enrollments === 0,
  };
}

/**
 * LƯU TRỮ: ẩn khỏi danh sách + DỪNG mọi khách đang chạy (huỷ job BullMQ, ghi log).
 * Giữ nguyên enrollments/logs → tra cứu lịch sử được. Có thể bỏ lưu trữ bằng setStatus.
 */
export async function archiveWorkflow(
  id: string, orgId: string,
  actor?: { actorId?: string | null; actorName?: string | null },
): Promise<{ ok: true; stoppedEnrollments: number; versions: number } | { error: 'not_found' }> {
  const ids = await versionIdsOf(id, orgId);
  if (!ids) return { error: 'not_found' };

  // Dừng KH đang chạy TRƯỚC (stopEnrollment tự huỷ job BullMQ đã hẹn giờ).
  const running = await prisma.followupEnrollment.findMany({
    where: { workflowId: { in: ids }, status: { in: RUNNING_STATES } },
    select: { id: true },
  });
  for (const e of running) {
    await stopEnrollment(e.id, 'sale_stopped', { actorType: 'sale', ...actor });
  }
  // Lưu trữ TẤT CẢ version (nếu chỉ archive bản latest, bản cũ vẫn phục vụ KH).
  await prisma.followupWorkflow.updateMany({ where: { id: { in: ids } }, data: { status: 'archived' } });
  return { ok: true, stoppedEnrollments: running.length, versions: ids.length };
}

/**
 * XOÁ VĨNH VIỄN — chỉ khi KHÔNG có enrollment nào ở bất kỳ version nào.
 * Trước khi xoá phải gỡ tham chiếu treo: `nextWorkflowId` là String thường (KHÔNG phải FK),
 * nên chiến dịch khác vẫn trỏ tới ID đã chết → chuỗi Goal gãy im lặng. Ta set NULL.
 */
export async function deleteWorkflow(
  id: string, orgId: string,
): Promise<{ ok: true; deletedVersions: number; unlinked: number } | { error: 'not_found' | 'has_enrollments'; enrollments?: number }> {
  const ids = await versionIdsOf(id, orgId);
  if (!ids) return { error: 'not_found' };

  const enrollments = await prisma.followupEnrollment.count({ where: { workflowId: { in: ids } } });
  if (enrollments > 0) return { error: 'has_enrollments', enrollments };

  // Gỡ nextWorkflowId treo ở các chiến dịch KHÁC.
  const { count: unlinked } = await prisma.followupWorkflow.updateMany({
    where: { orgId, nextWorkflowId: { in: ids }, id: { notIn: ids } },
    data: { nextWorkflowId: null },
  });
  // Cascade sẽ xoá steps (không có enrollment/log vì đã chặn ở trên).
  const { count } = await prisma.followupWorkflow.deleteMany({ where: { id: { in: ids }, orgId } });
  return { ok: true, deletedVersions: count, unlinked };
}

// ── Read ──────────────────────────────────────────────────────────────────
export async function listWorkflows(orgId: string) {
  const rows = await prisma.followupWorkflow.findMany({
    where: { orgId, isLatest: true, status: { not: 'archived' } },
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { steps: true } } },
  });
  return rows.map((w) => ({
    id: w.id, name: w.name, type: w.type, status: w.status, version: w.version,
    goalType: w.goalType, stepCount: w._count.steps,
    totalRunning: w.totalRunning, totalWaiting: w.totalWaiting, totalWaitingSale: w.totalWaitingSale,
    totalCompleted: w.totalCompleted, totalStopped: w.totalStopped, totalGoalReached: w.totalGoalReached,
    createdByName: w.createdByName, createdAt: w.createdAt, updatedAt: w.updatedAt,
  }));
}

export async function getWorkflow(id: string, orgId: string) {
  const wf = await prisma.followupWorkflow.findFirst({ where: { id, orgId } });
  if (!wf) return null;
  const steps = await prisma.followupStep.findMany({ where: { workflowId: id }, orderBy: { orderIndex: 'asc' } });
  return { ...wf, steps };
}

export async function getStats(id: string, orgId: string) {
  const wf = await prisma.followupWorkflow.findFirst({ where: { id, orgId }, select: { id: true } });
  if (!wf) return null;
  await recountWorkflow(id);
  const w = await prisma.followupWorkflow.findUnique({ where: { id } });
  return {
    running: w?.totalRunning ?? 0,
    waiting: w?.totalWaiting ?? 0,
    waitingSale: w?.totalWaitingSale ?? 0,
    completed: w?.totalCompleted ?? 0,
    stopped: w?.totalStopped ?? 0,
    goalReached: w?.totalGoalReached ?? 0,
    total: w?.totalEnrolled ?? 0,
  };
}

export async function listEnrollments(workflowId: string, orgId: string, opts?: { status?: string; search?: string }) {
  const wf = await prisma.followupWorkflow.findFirst({ where: { id: workflowId, orgId }, select: { id: true } });
  if (!wf) return null;
  const rows = await prisma.followupEnrollment.findMany({
    where: { workflowId, ...(opts?.status ? { status: opts.status } : {}) },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  });
  const contactIds = [...new Set(rows.map((r) => r.contactId))];
  const contacts = contactIds.length
    ? await prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, fullName: true, phone: true, tags: true } })
    : [];
  const cmap = new Map(contacts.map((c) => [c.id, c]));
  let out = rows.map((r) => {
    const c = cmap.get(r.contactId);
    return {
      id: r.id, contactId: r.contactId, contactName: c?.fullName ?? '(Không tên)', phone: c?.phone ?? null,
      status: r.status, currentStepKey: r.currentStepKey, messagesSent: r.messagesSent,
      nextRunAt: r.nextRunAt, saleTaskTitle: r.saleTaskTitle, goalReached: r.goalReached, stopReason: r.stopReason,
      startedAt: r.startedAt, updatedAt: r.updatedAt,
    };
  });
  if (opts?.search) {
    const q = opts.search.toLowerCase();
    out = out.filter((r) => r.contactName.toLowerCase().includes(q) || (r.phone ?? '').includes(q));
  }
  return out;
}

// ── Dữ liệu cho tab Follow-up ở chat (theo contact) ─────────────────────────
export async function getContactFollowup(contactId: string, orgId: string) {
  const enr = await prisma.followupEnrollment.findFirst({
    where: { orgId, contactId },
    orderBy: { createdAt: 'desc' },
  });
  if (!enr) return { enrollment: null, workflow: null, timeline: [] };
  const wf = await prisma.followupWorkflow.findUnique({
    where: { id: enr.workflowId },
    select: { id: true, name: true, type: true, maxMessages: true },
  });
  const timeline = await prisma.followupLog.findMany({
    where: { enrollmentId: enr.id },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  return {
    enrollment: {
      id: enr.id, status: enr.status, currentStepKey: enr.currentStepKey,
      messagesSent: enr.messagesSent, nextRunAt: enr.nextRunAt, saleTaskTitle: enr.saleTaskTitle,
      goalReached: enr.goalReached, stopReason: enr.stopReason, startedAt: enr.startedAt,
    },
    workflow: wf,
    timeline: timeline.map((t) => ({
      id: t.id, eventType: t.eventType, message: t.message, stepType: t.stepType,
      actorType: t.actorType, actorName: t.actorName, createdAt: t.createdAt,
    })),
  };
}

/** Danh sách workflow ACTIVE để chọn khi enroll KH từ chat. */
export async function listActiveWorkflows(orgId: string) {
  const rows = await prisma.followupWorkflow.findMany({
    where: { orgId, status: 'active', isLatest: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, type: true },
  });
  return rows;
}
