// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
// ════════════════════════════════════════════════════════════════════════════
// Follow-up Workflow Engine (🟢 Community) — chạy 1 enrollment qua các bước.
//
// Bước: start | send | wait | condition | tag_add | tag_remove | sale_task | end.
// An toàn gửi: khung giờ (send window), khoảng cách tối thiểu (min-gap), trần số
// tin (max-messages). Điều kiện dừng + Goal kiểm TRƯỚC mỗi bước → KHÔNG gửi sau khi
// đã dừng/đạt Goal. Bước "Chờ" và hoãn theo khung giờ dùng BullMQ delayed job.
//
// Tái dùng đường gửi Zalo THẬT: sendCampaignMessage + renderTemplate + STUB_MODE
// từ module outreach (đã kiểm chứng). STUB_MODE=1 → mô phỏng, không bắn Zalo.
// ════════════════════════════════════════════════════════════════════════════

import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { sendCampaignMessage, renderTemplate, STUB_MODE } from '../outreach/outreach-service.js';
import { scheduleAdvance, cancelScheduledJob } from './followup-queue.js';

// ── Config types (đọc từ FollowupStep.config Json) ──────────────────────────
export type WaitUnit = 'hour' | 'day' | 'week';
export type ConditionCheck =
  | 'replied' | 'not_replied' | 'is_friend' | 'not_friend' | 'has_tag' | 'no_tag';

interface WaitConfig { amount: number; unit: WaitUnit }
interface SendConfig { content: string; imageAssetIds?: string[] }
interface ConditionConfig { check: ConditionCheck; tag?: string; trueKey?: string; falseKey?: string }
interface TagStepConfig { tag: string }
interface SaleTaskConfig { title: string; note?: string }

const WAIT_UNIT_MS: Record<WaitUnit, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

const MAX_SYNC_STEPS = 100; // chặn vòng lặp vô hạn do condition trỏ vòng.

// ── Trạng thái KH dùng cho điều kiện/goal/stop (đọc 1 lần, cập nhật khi gắn/xoá tag) ──
interface ContactState {
  contactId: string;
  zaloUid: string | null;
  fullName: string | null;
  phone: string | null;
  tags: string[];
  isFriend: boolean;
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  return [];
}

async function loadContactState(contactId: string, zaloAccountId: string): Promise<ContactState | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, zaloUid: true, fullName: true, phone: true, tags: true },
  });
  if (!contact) return null;
  const friend = await prisma.friend.findFirst({
    where: { zaloAccountId, contactId },
    select: { friendshipStatus: true },
  });
  return {
    contactId,
    zaloUid: contact.zaloUid,
    fullName: contact.fullName ?? null,
    phone: contact.phone ?? null,
    tags: parseTags(contact.tags),
    isFriend: friend?.friendshipStatus === 'accepted',
  };
}

/** KH đã phản hồi (có tin INBOUND) kể từ mốc `since`? (senderType='contact'). */
async function hasRepliedSince(contactId: string, zaloAccountId: string, since: Date): Promise<boolean> {
  const conv = await prisma.conversation.findFirst({
    where: { contactId, zaloAccountId },
    select: { id: true },
  });
  if (!conv) return false;
  const msg = await prisma.message.findFirst({
    where: { conversationId: conv.id, senderType: 'contact', sentAt: { gt: since } },
    select: { id: true },
  });
  return !!msg;
}

// ── Ghi log timeline/nhật ký ────────────────────────────────────────────────
async function log(
  e: { id: string; orgId: string; workflowId: string; contactId: string },
  eventType: string,
  message: string,
  opts?: { stepKey?: string | null; stepType?: string | null; detail?: unknown; actorType?: 'system' | 'sale'; actorId?: string | null; actorName?: string | null },
) {
  await prisma.followupLog.create({
    data: {
      orgId: e.orgId, enrollmentId: e.id, workflowId: e.workflowId, contactId: e.contactId,
      eventType, message,
      stepKey: opts?.stepKey ?? null, stepType: opts?.stepType ?? null,
      detail: (opts?.detail ?? undefined) as any,
      actorType: opts?.actorType ?? 'system', actorId: opts?.actorId ?? null, actorName: opts?.actorName ?? null,
    },
  }).catch((err) => logger.warn(`[followup] log lỗi: ${(err as Error)?.message ?? err}`));
}

// ── Khung giờ gửi (send window) theo timezone workflow ──────────────────────
/** Phút-trong-ngày của `date` tại timezone `tz` (0..1439). */
function minutesOfDayInTz(date: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date);
    const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return (hh % 24) * 60 + mm;
  } catch {
    return date.getHours() * 60 + date.getMinutes();
  }
}

/** ms cần chờ để tới lần gửi hợp lệ kế tiếp trong [startMin,endMin]. 0 = đang trong khung. */
function msUntilSendWindow(now: Date, startMin: number, endMin: number, tz: string): number {
  if (startMin >= endMin) return 0; // cấu hình sai → coi như luôn hợp lệ (không chặn)
  const cur = minutesOfDayInTz(now, tz);
  if (cur >= startMin && cur < endMin) return 0;
  // Trước khung hôm nay → chờ tới startMin; sau khung → chờ tới startMin ngày mai.
  let deltaMin: number;
  if (cur < startMin) deltaMin = startMin - cur;
  else deltaMin = (1440 - cur) + startMin;
  return deltaMin * 60_000;
}

// ── Counters ────────────────────────────────────────────────────────────────
const RUNNING_STATES = ['running', 'waiting', 'waiting_sale'] as const;

export async function recountWorkflow(workflowId: string): Promise<void> {
  const rows = await prisma.followupEnrollment.groupBy({
    by: ['status'],
    where: { workflowId },
    _count: { _all: true },
  });
  const by = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  const totalEnrolled = rows.reduce((s, r) => s + r._count._all, 0);
  await prisma.followupWorkflow.update({
    where: { id: workflowId },
    data: {
      totalEnrolled,
      totalRunning: by('running'),
      totalWaiting: by('waiting'),
      totalWaitingSale: by('waiting_sale'),
      totalCompleted: by('completed'),
      totalStopped: by('stopped'),
      totalGoalReached: by('goal_reached'),
    },
  }).catch(() => {});
}

// ── Finalize helpers ────────────────────────────────────────────────────────
type EnrollmentRow = Awaited<ReturnType<typeof prisma.followupEnrollment.findUnique>>;

async function finalize(
  enr: NonNullable<EnrollmentRow>,
  status: 'completed' | 'stopped' | 'goal_reached',
  stopReason: string | null,
  message: string,
) {
  if (enr.jobId) await cancelScheduledJob(enr.jobId).catch(() => {});
  await prisma.followupEnrollment.update({
    where: { id: enr.id },
    data: { status, stopReason, completedAt: new Date(), currentStepKey: null, nextRunAt: null, jobId: null },
  });
  await log(enr, status === 'goal_reached' ? 'goal_reached' : status === 'completed' ? 'completed' : 'stopped', message);
  await recountWorkflow(enr.workflowId);
}

/** Sau khi đạt Goal/hoàn tất: gắn tag Goal (nếu có) + tự chuyển workflow kế tiếp (nếu có). */
async function afterGoalOrComplete(
  enr: NonNullable<EnrollmentRow>,
  wf: { goalTagOnReach: string | null; nextWorkflowId: string | null },
) {
  if (wf.goalTagOnReach) {
    await addContactTag(enr.contactId, wf.goalTagOnReach).catch(() => {});
    await log(enr, 'tag_added', `Gắn tag "${wf.goalTagOnReach}" (đạt mục tiêu)`);
  }
  if (wf.nextWorkflowId) {
    try {
      await enrollContact({
        workflowId: wf.nextWorkflowId, contactId: enr.contactId, zaloAccountId: enr.zaloAccountId,
        actorType: 'system', reason: 'switched',
      });
      await log(enr, 'switched_workflow', 'Tự chuyển sang workflow kế tiếp');
    } catch (err) {
      logger.warn(`[followup] chuyển workflow kế tiếp lỗi: ${(err as Error)?.message ?? err}`);
    }
  }
}

// ── Tag ops (thao tác trên contact.tags — nhất quán với audience/stop-tag) ────
async function addContactTag(contactId: string, tag: string): Promise<void> {
  const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { tags: true } });
  const tags = parseTags(c?.tags);
  if (!tags.includes(tag)) {
    await prisma.contact.update({ where: { id: contactId }, data: { tags: [...tags, tag] } });
  }
}
async function removeContactTag(contactId: string, tag: string): Promise<void> {
  const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { tags: true } });
  const tags = parseTags(c?.tags);
  if (tags.includes(tag)) {
    await prisma.contact.update({ where: { id: contactId }, data: { tags: tags.filter((t) => t !== tag) } });
  }
}

// ── Điều kiện dừng + Goal ───────────────────────────────────────────────────
function checkStop(
  wf: { stopOnPurchase: boolean; stopOnTags: string[] },
  state: ContactState,
): { reason: string; message: string } | null {
  for (const t of wf.stopOnTags) {
    if (state.tags.includes(t)) return { reason: 'do_not_disturb', message: `Dừng - có tag "${t}"` };
  }
  if (wf.stopOnPurchase && state.tags.includes('Đã mua')) {
    return { reason: 'purchased', message: 'Dừng - khách đã mua hàng' };
  }
  return null;
}

async function checkGoal(
  wf: { goalType: string; goalTag: string | null },
  enr: NonNullable<EnrollmentRow>,
  state: ContactState,
): Promise<boolean> {
  switch (wf.goalType) {
    case 'replied':
      return hasRepliedSince(enr.contactId, enr.zaloAccountId, enr.startedAt);
    case 'purchased':
      return state.tags.includes('Đã mua');
    case 'has_tag':
      return !!wf.goalTag && state.tags.includes(wf.goalTag);
    default:
      return false; // none | requested_quote | custom → đạt thủ công qua API
  }
}

// ── Load workflow + steps ────────────────────────────────────────────────────
async function loadWorkflowSteps(workflowId: string) {
  const wf = await prisma.followupWorkflow.findUnique({ where: { id: workflowId } });
  if (!wf) return null;
  const steps = await prisma.followupStep.findMany({ where: { workflowId }, orderBy: { orderIndex: 'asc' } });
  const map = new Map(steps.map((s) => [s.key, s]));
  return { wf, steps, map };
}

function findStartKey(steps: { key: string; type: string }[]): string | null {
  return steps.find((s) => s.type === 'start')?.key ?? steps[0]?.key ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// advanceEnrollment — chạy enrollment từ currentStepKey cho tới khi phải CHỜ
// (wait / hoãn khung giờ / hoãn min-gap / chờ Sale) hoặc kết thúc.
// ════════════════════════════════════════════════════════════════════════════
export async function advanceEnrollment(enrollmentId: string): Promise<void> {
  let enr = await prisma.followupEnrollment.findUnique({ where: { id: enrollmentId } });
  if (!enr) return;
  if (enr.status === 'completed' || enr.status === 'stopped' || enr.status === 'goal_reached') return;

  const loaded = await loadWorkflowSteps(enr.workflowId);
  if (!loaded) { await finalize(enr, 'stopped', 'manual', 'Dừng - workflow không tồn tại'); return; }
  const { wf, map } = loaded;

  let state = await loadContactState(enr.contactId, enr.zaloAccountId);
  if (!state) { await finalize(enr, 'stopped', 'manual', 'Dừng - không tìm thấy khách hàng'); return; }

  for (let i = 0; i < MAX_SYNC_STEPS; i++) {
    // 1) Goal — kiểm TRƯỚC điều kiện dừng. Lý do: "khách đã mua" vừa là điều kiện dừng
    //    vừa có thể LÀ mục tiêu; nếu chạy checkStop trước thì workflow có Goal="đã mua"
    //    sẽ kết thúc dạng "stopped" và KHÔNG gắn tag Goal / KHÔNG chuyển workflow kế.
    //    Đạt Goal = dừng thành công → ưu tiên. (Vẫn không gửi thêm tin sau khi dừng.)
    if (await checkGoal(wf, enr, state)) {
      await finalize(enr, 'goal_reached', 'goal', 'Đạt mục tiêu - dừng workflow');
      await afterGoalOrComplete(enr, wf);
      return;
    }

    // 2) Điều kiện dừng — kiểm trước mỗi bước.
    const stop = checkStop(wf, state);
    if (stop) { await finalize(enr, 'stopped', stop.reason, stop.message); return; }

    const stepKey = enr.currentStepKey;
    const step = stepKey ? map.get(stepKey) : undefined;
    if (!step) { await finalize(enr, 'completed', 'completed', 'Hoàn thành workflow'); await afterGoalOrComplete(enr, wf); return; }

    const cfg = (step.config ?? {}) as Record<string, unknown>;

    switch (step.type) {
      case 'start': {
        enr = await setCurrent(enr, step.nextKey, 'running');
        continue;
      }
      case 'condition': {
        const c = cfg as unknown as ConditionConfig;
        const pass = await evalCondition(c, enr, state);
        const nextKey = pass ? (c.trueKey ?? null) : (c.falseKey ?? null);
        await log(enr, 'condition_eval', `Điều kiện "${conditionLabel(c.check, c.tag)}": ${pass ? 'ĐÚNG → nhánh A' : 'SAI → nhánh B'}`, { stepKey: step.key, stepType: 'condition' });
        enr = await setCurrent(enr, nextKey, 'running');
        continue;
      }
      case 'tag_add': {
        const t = (cfg as unknown as TagStepConfig).tag;
        if (t) { await addContactTag(enr.contactId, t); if (!state.tags.includes(t)) state.tags.push(t); await log(enr, 'tag_added', `Gắn tag "${t}"`, { stepKey: step.key, stepType: 'tag_add' }); }
        enr = await setCurrent(enr, step.nextKey, 'running');
        continue;
      }
      case 'tag_remove': {
        const t = (cfg as unknown as TagStepConfig).tag;
        if (t) { await removeContactTag(enr.contactId, t); state.tags = state.tags.filter((x) => x !== t); await log(enr, 'tag_removed', `Xóa tag "${t}"`, { stepKey: step.key, stepType: 'tag_remove' }); }
        enr = await setCurrent(enr, step.nextKey, 'running');
        continue;
      }
      case 'wait': {
        const w = cfg as unknown as WaitConfig;
        const ms = Math.max(60_000, (Number(w.amount) || 0) * (WAIT_UNIT_MS[w.unit] ?? WAIT_UNIT_MS.day));
        await log(enr, 'waited', `Chờ ${w.amount} ${waitUnitLabel(w.unit)}`, { stepKey: step.key, stepType: 'wait' });
        enr = await setCurrent(enr, step.nextKey, 'waiting'); // sau chờ → chạy bước kế
        await schedule(enr, ms);
        return;
      }
      case 'send': {
        const s = cfg as unknown as SendConfig;
        // Trần số tin
        if (enr.messagesSent >= wf.maxMessages) {
          await finalize(enr, 'stopped', 'max_messages', `Dừng - đã đạt trần ${wf.maxMessages} tin`);
          return;
        }
        const now = new Date();
        // Khung giờ gửi
        const winWait = msUntilSendWindow(now, wf.sendWindowStart, wf.sendWindowEnd, wf.timezone);
        if (winWait > 0) {
          await prisma.followupEnrollment.update({ where: { id: enr.id }, data: { status: 'waiting' } });
          enr.status = 'waiting';
          await schedule(enr, winWait); // GIỮ nguyên currentStepKey (thử lại bước gửi)
          return;
        }
        // Khoảng cách tối thiểu
        if (enr.lastMessageAt) {
          const gapMs = wf.minGapMinutes * 60_000;
          const since = now.getTime() - enr.lastMessageAt.getTime();
          if (since < gapMs) {
            await prisma.followupEnrollment.update({ where: { id: enr.id }, data: { status: 'waiting' } });
            enr.status = 'waiting';
            await schedule(enr, gapMs - since);
            return;
          }
        }
        // Gửi thật
        const text = renderTemplate(s.content ?? '', { name: state.fullName, phone: state.phone });
        if (!state.zaloUid) {
          await log(enr, 'message_failed', 'Không gửi được - khách chưa có Zalo UID', { stepKey: step.key, stepType: 'send' });
        } else {
          const res = await sendCampaignMessage({
            zaloAccountId: enr.zaloAccountId, zaloUid: state.zaloUid, text,
            imageAssetIds: Array.isArray(s.imageAssetIds) ? s.imageAssetIds : [], orgId: enr.orgId, io: null,
          });
          if (res.ok) {
            enr = await prisma.followupEnrollment.update({
              where: { id: enr.id },
              data: { messagesSent: { increment: 1 }, lastMessageAt: now },
            });
            await log(enr, 'message_sent', `Đã gửi tin: "${text.slice(0, 80)}"`, { stepKey: step.key, stepType: 'send', detail: { msgId: res.msgId } });
          } else {
            await log(enr, 'message_failed', `Gửi thất bại: ${res.error ?? 'không rõ'}`, { stepKey: step.key, stepType: 'send' });
          }
        }
        enr = await setCurrent(enr, step.nextKey, 'running');
        continue;
      }
      case 'sale_task': {
        const st = cfg as unknown as SaleTaskConfig;
        await prisma.followupEnrollment.update({
          where: { id: enr.id },
          data: { status: 'waiting_sale', saleTaskTitle: st.title ?? 'Công việc cho Sale', nextRunAt: null },
        });
        await log(enr, 'sale_task_created', `Giao việc cho Sale: ${st.title ?? 'Xử lý khách'}`, { stepKey: step.key, stepType: 'sale_task', detail: { note: st.note } });
        await recountWorkflow(enr.workflowId);
        return; // chờ Sale hoàn thành (API completeSaleTask) → tiếp bước nextKey
      }
      case 'end':
      default: {
        await finalize(enr, 'completed', 'completed', 'Hoàn thành workflow');
        await afterGoalOrComplete(enr, wf);
        return;
      }
    }
  }
  // Chạm trần bước đồng bộ → có thể cấu hình vòng lặp; dừng an toàn.
  logger.warn(`[followup] enrollment=${enrollmentId} vượt ${MAX_SYNC_STEPS} bước đồng bộ → dừng an toàn`);
  if (enr) await finalize(enr, 'stopped', 'manual', 'Dừng - workflow lặp quá nhiều bước');
}

async function evalCondition(c: ConditionConfig, enr: NonNullable<EnrollmentRow>, state: ContactState): Promise<boolean> {
  switch (c.check) {
    case 'replied': return hasRepliedSince(enr.contactId, enr.zaloAccountId, enr.startedAt);
    case 'not_replied': return !(await hasRepliedSince(enr.contactId, enr.zaloAccountId, enr.startedAt));
    case 'is_friend': return state.isFriend;
    case 'not_friend': return !state.isFriend;
    case 'has_tag': return !!c.tag && state.tags.includes(c.tag);
    case 'no_tag': return !!c.tag && !state.tags.includes(c.tag);
    default: return false;
  }
}

function conditionLabel(check: ConditionCheck, tag?: string): string {
  switch (check) {
    case 'replied': return 'Đã phản hồi';
    case 'not_replied': return 'Chưa phản hồi';
    case 'is_friend': return 'Đã là bạn';
    case 'not_friend': return 'Chưa là bạn';
    case 'has_tag': return `Có tag "${tag ?? ''}"`;
    case 'no_tag': return `Không có tag "${tag ?? ''}"`;
    default: return check;
  }
}
function waitUnitLabel(u: WaitUnit): string { return u === 'hour' ? 'giờ' : u === 'week' ? 'tuần' : 'ngày'; }

/** Đặt currentStepKey + status, trả enrollment mới. */
async function setCurrent(enr: NonNullable<EnrollmentRow>, nextKey: string | null, status: string): Promise<NonNullable<EnrollmentRow>> {
  return prisma.followupEnrollment.update({
    where: { id: enr.id },
    data: { currentStepKey: nextKey, status },
  });
}

/** Đặt lịch chạy tiếp (BullMQ delayed). Lưu jobId để huỷ khi dừng. */
async function schedule(enr: NonNullable<EnrollmentRow>, delayMs: number): Promise<void> {
  if (enr.jobId) await cancelScheduledJob(enr.jobId).catch(() => {});
  const nextRunAt = new Date(Date.now() + delayMs);
  const jobId = await scheduleAdvance(enr.id, delayMs);
  await prisma.followupEnrollment.update({ where: { id: enr.id }, data: { nextRunAt, jobId } });
}

// ════════════════════════════════════════════════════════════════════════════
// Public: enroll / stop / completeSaleTask
// ════════════════════════════════════════════════════════════════════════════
export interface EnrollOpts {
  workflowId: string;
  contactId: string;
  zaloAccountId: string;
  actorType?: 'system' | 'sale';
  actorId?: string | null;
  actorName?: string | null;
  reason?: string;       // 'switched' khi tự chuyển
  onConflict?: 'keep' | 'switch'; // KH đang trong workflow khác
}

export interface EnrollResult {
  ok: boolean;
  enrollmentId?: string;
  conflict?: { enrollmentId: string; workflowId: string; workflowName: string };
  error?: string;
}

/** Enroll 1 KH vào workflow. Đảm bảo MỖI KH chỉ 1 workflow đang chạy. */
export async function enrollContact(opts: EnrollOpts): Promise<EnrollResult> {
  const wf = await prisma.followupWorkflow.findUnique({ where: { id: opts.workflowId } });
  if (!wf) return { ok: false, error: 'workflow_not_found' };
  if (wf.status !== 'active') return { ok: false, error: 'workflow_not_active' };

  // Đang tham gia workflow khác?
  const active = await prisma.followupEnrollment.findFirst({
    where: { orgId: wf.orgId, contactId: opts.contactId, status: { in: [...RUNNING_STATES] } },
    orderBy: { createdAt: 'desc' },
  });
  if (active) {
    if (opts.onConflict !== 'switch' && opts.reason !== 'switched') {
      const other = await prisma.followupWorkflow.findUnique({ where: { id: active.workflowId }, select: { name: true } });
      return { ok: false, conflict: { enrollmentId: active.id, workflowId: active.workflowId, workflowName: other?.name ?? '' } };
    }
    await stopEnrollment(active.id, 'switched', { actorType: opts.actorType, actorId: opts.actorId, actorName: opts.actorName });
  }

  const steps = await prisma.followupStep.findMany({ where: { workflowId: wf.id }, select: { key: true, type: true } });
  const startKey = findStartKey(steps);
  if (!startKey) return { ok: false, error: 'workflow_has_no_steps' };

  // friendId (nếu có) để hiển thị/đối chiếu.
  const friend = await prisma.friend.findFirst({
    where: { zaloAccountId: opts.zaloAccountId, contactId: opts.contactId },
    select: { id: true },
  });

  const enr = await prisma.followupEnrollment.create({
    data: {
      orgId: wf.orgId, workflowId: wf.id, workflowVersion: wf.version,
      contactId: opts.contactId, friendId: friend?.id ?? null, zaloAccountId: opts.zaloAccountId,
      status: 'running', currentStepKey: startKey,
      enrolledById: opts.actorId ?? null, enrolledByName: opts.actorName ?? null,
    },
  });
  await log(enr, 'enrolled', 'Bắt đầu workflow', { actorType: opts.actorType ?? 'system', actorId: opts.actorId, actorName: opts.actorName });
  await recountWorkflow(wf.id);
  await advanceEnrollment(enr.id);
  return { ok: true, enrollmentId: enr.id };
}

export async function stopEnrollment(
  enrollmentId: string,
  reason: string,
  actor?: { actorType?: 'system' | 'sale'; actorId?: string | null; actorName?: string | null },
): Promise<void> {
  const enr = await prisma.followupEnrollment.findUnique({ where: { id: enrollmentId } });
  if (!enr || enr.status === 'completed' || enr.status === 'stopped' || enr.status === 'goal_reached') return;
  if (enr.jobId) await cancelScheduledJob(enr.jobId).catch(() => {});
  await prisma.followupEnrollment.update({
    where: { id: enr.id },
    data: { status: 'stopped', stopReason: reason, completedAt: new Date(), nextRunAt: null, jobId: null },
  });
  const msg = reason === 'sale_stopped' ? 'Sale dừng workflow' : reason === 'switched' ? 'Chuyển sang workflow khác' : 'Đã dừng workflow';
  await log(enr, 'stopped', msg, { actorType: actor?.actorType ?? 'system', actorId: actor?.actorId, actorName: actor?.actorName });
  await recountWorkflow(enr.workflowId);
}

/** Sale hoàn thành task → workflow tiếp tục từ bước kế của sale_task. */
export async function completeSaleTask(
  enrollmentId: string,
  actor?: { actorId?: string | null; actorName?: string | null },
): Promise<boolean> {
  const enr = await prisma.followupEnrollment.findUnique({ where: { id: enrollmentId } });
  if (!enr || enr.status !== 'waiting_sale' || !enr.currentStepKey) return false;
  const step = await prisma.followupStep.findUnique({
    where: { workflowId_key: { workflowId: enr.workflowId, key: enr.currentStepKey } },
    select: { nextKey: true },
  });
  await log(enr, 'sale_task_done', 'Sale hoàn thành công việc → tiếp tục', { actorType: 'sale', actorId: actor?.actorId, actorName: actor?.actorName });
  await prisma.followupEnrollment.update({
    where: { id: enr.id },
    data: { status: 'running', currentStepKey: step?.nextKey ?? null, saleTaskTitle: null },
  });
  await recountWorkflow(enr.workflowId);
  await advanceEnrollment(enr.id);
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// Dry-run — mô phỏng đường đi của 1 KH, KHÔNG gửi/ghi DB.
// ════════════════════════════════════════════════════════════════════════════
export interface SimStep { key: string; type: string; label: string; note?: string }

export async function simulateWorkflow(workflowId: string, contactId: string): Promise<{ ok: boolean; error?: string; steps: SimStep[]; endReason: string }> {
  const loaded = await loadWorkflowSteps(workflowId);
  if (!loaded) return { ok: false, error: 'workflow_not_found', steps: [], endReason: '' };
  const { wf, steps, map } = loaded;
  const state = await loadContactState(contactId, '' /* nick chưa biết ở dry-run */);
  const tags = state?.tags ?? [];
  const isFriend = state?.isFriend ?? false;

  const trace: SimStep[] = [];
  let key = findStartKey(steps);
  let msgCount = 0;
  let endReason = 'Kết thúc workflow';
  for (let i = 0; i < MAX_SYNC_STEPS && key; i++) {
    const step = map.get(key);
    if (!step) break;
    const cfg = (step.config ?? {}) as Record<string, unknown>;
    if (step.type === 'start') { trace.push({ key: step.key, type: 'start', label: 'Bắt đầu' }); key = step.nextKey; continue; }
    if (step.type === 'send') {
      msgCount++;
      const overLimit = msgCount > wf.maxMessages;
      trace.push({ key: step.key, type: 'send', label: 'Gửi tin nhắn', note: overLimit ? `Vượt trần ${wf.maxMessages} tin → dừng` : `Tin #${msgCount}` });
      if (overLimit) { endReason = `Dừng - đạt trần ${wf.maxMessages} tin`; break; }
      key = step.nextKey; continue;
    }
    if (step.type === 'wait') { const w = cfg as unknown as WaitConfig; trace.push({ key: step.key, type: 'wait', label: `Chờ ${w.amount} ${waitUnitLabel(w.unit)}` }); key = step.nextKey; continue; }
    if (step.type === 'condition') {
      const c = cfg as unknown as ConditionConfig;
      let pass = false;
      if (c.check === 'is_friend') pass = isFriend;
      else if (c.check === 'not_friend') pass = !isFriend;
      else if (c.check === 'has_tag') pass = !!c.tag && tags.includes(c.tag);
      else if (c.check === 'no_tag') pass = !!c.tag && !tags.includes(c.tag);
      // replied/not_replied tính theo mốc enroll. Mô phỏng đứng ở thời điểm VỪA enroll
      // ⇒ khách CHƯA phản hồi. (Nếu coi cả hai là SAI, mọi nhánh "Chưa phản hồi" sẽ
      // kết thúc sớm và trace mất hết phần thân workflow.)
      else if (c.check === 'replied') pass = false;
      else if (c.check === 'not_replied') pass = true;
      else pass = false;
      trace.push({ key: step.key, type: 'condition', label: `Điều kiện: ${conditionLabel(c.check, c.tag)}`, note: pass ? 'ĐÚNG → nhánh A' : 'SAI → nhánh B' });
      key = pass ? (c.trueKey ?? null) : (c.falseKey ?? null); continue;
    }
    if (step.type === 'tag_add') { trace.push({ key: step.key, type: 'tag_add', label: `Gắn tag "${(cfg as any).tag ?? ''}"` }); key = step.nextKey; continue; }
    if (step.type === 'tag_remove') { trace.push({ key: step.key, type: 'tag_remove', label: `Xóa tag "${(cfg as any).tag ?? ''}"` }); key = step.nextKey; continue; }
    if (step.type === 'sale_task') { trace.push({ key: step.key, type: 'sale_task', label: `Giao Sale: ${(cfg as any).title ?? ''}`, note: 'Tạm dừng chờ Sale' }); key = step.nextKey; continue; }
    // end
    trace.push({ key: step.key, type: 'end', label: 'Kết thúc' });
    endReason = 'Kết thúc workflow'; key = null;
  }
  return { ok: true, steps: trace, endReason };
}
