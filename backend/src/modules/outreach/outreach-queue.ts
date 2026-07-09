// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
// ════════════════════════════════════════════════════════════════════════════
// Outreach Campaign (🟢 Community) — BullMQ queue + worker.
// Self-contained COMMUNITY queue (KHÔNG import _ee). Redis dựng tại chỗ từ
// process.env.REDIS_URL (mirror group-scan-queue.ts).
//
// 2 job:
//   add_friend  — reuse attemptFriendRequest(); success + enableAutoMessage →
//                 enqueue send_message với delay rand(waitAfterAdd).
//   send_message — chọn template theo weight → render biến → ảnh random → gửi.
//
// Điều khiển: pause/resume = queue.pause()/resume(); cancel = drain + state check.
// An toàn: AUTOMATION_STUB_MODE mô phỏng, không gọi Zalo thật.
// ════════════════════════════════════════════════════════════════════════════

import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { attemptFriendRequest } from '../campaign/campaign-service.js';
import { resolveOrCreateContact } from '../contacts/resolve-contact.js';
import {
  STUB_MODE, randDelay, selectWeightedTemplate, renderTemplate,
  sendCampaignMessage, countActionsToday, writeLog, emitProgress,
} from './outreach-service.js';
import { evaluateAudience, orderEligibleByChat, filterFromCampaign, type EvaluatedEntry } from './outreach-audience.js';

export const OUTREACH_QUEUE = 'outreach';

const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: { age: 86400, count: 2000 },
  removeOnFail: { age: 604800 },
  attempts: 2,
  backoff: { type: 'exponential' as const, delay: 15_000 },
};

type AddFriendJob = { kind: 'add_friend'; campaignId: string; entryId: string; seq: number };
type SendMessageJob = {
  kind: 'send_message'; campaignId: string; entryId: string; seq: number;
  contactId: string | null; zaloUid: string; phone: string; name: string | null;
};
type OutreachJob = AddFriendJob | SendMessageJob;

// ── io (set từ app.ts để worker emit socket) ──
let ioRef: Server | null = null;
export function setOutreachIO(io: Server) { ioRef = io; }

// ── Redis connection (BullMQ-tuned, lazy) ──
let connection: Redis | null = null;
function getConnection(): Redis {
  if (!connection) {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    connection = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    });
    connection.on('error', (err: Error) => logger.error(`[outreach-queue] redis error: ${err.message}`));
    logger.info('[outreach-queue] redis connection created');
  }
  return connection;
}

let queueInstance: Queue<OutreachJob> | null = null;
function getQueue(): Queue<OutreachJob> {
  if (!queueInstance) {
    queueInstance = new Queue<OutreachJob>(OUTREACH_QUEUE, {
      connection: getConnection() as ConnectionOptions,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queueInstance.on('error', (err) => logger.error(`[outreach-queue] queue error: ${err.message}`));
    logger.info('[outreach-queue] queue initialized');
  }
  return queueInstance;
}

// ── Điều khiển campaign ──────────────────────────────────────────────────────

/**
 * Seed dòng per-số cho khách BỊ BỎ theo Điều kiện gửi: overall='skipped' + note=lý do,
 * seq=-1 (KHÔNG bao giờ được finishPhone chọn vì nó chỉ đi tới seq>=0). Không enqueue.
 * Idempotent (restart): createMany skipDuplicates + raw update ép trạng thái skipped.
 */
async function seedSkipped(campaignId: string, skipped: EvaluatedEntry[]) {
  if (!skipped.length) return;
  await prisma.outreachPhone.createMany({
    data: skipped.map((e) => ({
      campaignId, entryId: e.id, phone: e.phone, seq: -1,
      overallStatus: 'skipped', friendStatus: 'none', messageStatus: 'none',
      note: e.reason ? `Bỏ qua - ${e.reason}` : 'Bỏ qua - không đủ điều kiện',
    })),
    skipDuplicates: true,
  });
  const entryIds = skipped.map((e) => e.id);
  const notes = skipped.map((e) => (e.reason ? `Bỏ qua - ${e.reason}` : 'Bỏ qua - không đủ điều kiện'));
  await prisma.$executeRawUnsafe(
    `UPDATE outreach_phones AS p
       SET seq = -1, overall_status='skipped', friend_status='none', message_status='none', note = t.note, updated_at=now()
     FROM unnest($1::text[], $2::text[]) AS t(entry_id, note)
     WHERE p.campaign_id = $3 AND p.entry_id = t.entry_id`,
    entryIds, notes, campaignId,
  );
  // Ghi audit log cho từng khách bị bỏ (hiện trong lịch sử chiến dịch) — batch 1 query.
  await prisma.outreachLog.createMany({
    data: skipped.map((e) => ({
      campaignId, entryId: e.id, contactId: e.contactId, phone: e.phone,
      actionType: 'add_friend', status: 'skipped',
      errorMessage: e.reason ? `Bỏ qua - ${e.reason}` : 'Bỏ qua - không đủ điều kiện',
    })),
  }).catch(() => {});
}

/** Tạo/RESET dòng per-số + gán seq theo thứ tự (idempotent — chạy lại không tạo trùng). */
async function seedPhones(campaignId: string, ordered: Array<{ id: string; phone: string }>) {
  await prisma.outreachPhone.createMany({
    data: ordered.map((e, i) => ({
      campaignId, entryId: e.id, phone: e.phone, seq: i,
      overallStatus: 'waiting', friendStatus: 'none', messageStatus: 'none',
    })),
    skipDuplicates: true,
  });
  if (ordered.length) {
    // RESET trạng thái + cập nhật seq cho dòng đã tồn tại (restart) — 1 query.
    const entryIds = ordered.map((e) => e.id);
    const seqs = ordered.map((_, i) => i);
    await prisma.$executeRawUnsafe(
      `UPDATE outreach_phones AS p
         SET seq = t.seq, overall_status='waiting', friend_status='none', message_status='none', note=NULL, updated_at=now()
       FROM unnest($1::text[], $2::int[]) AS t(entry_id, seq)
       WHERE p.campaign_id = $3 AND p.entry_id = t.entry_id`,
      entryIds, seqs, campaignId,
    );
  }
}

async function createRun(campaignId: string, runNumber: number, action: 'start' | 'restart', userId?: string | null, userName?: string | null) {
  await prisma.outreachRun.create({
    data: { campaignId, runNumber, action, startedById: userId ?? null, startedByName: userName ?? null, state: 'running' },
  }).catch((e) => logger.warn(`[outreach] createRun lỗi: ${(e as Error)?.message ?? e}`));
}

/** Đóng lần chạy hiện tại (state 'running' mới nhất) → completed/cancelled. */
async function closeRun(campaignId: string, state: 'completed' | 'cancelled') {
  const run = await prisma.outreachRun.findFirst({ where: { campaignId, state: 'running' }, orderBy: { runNumber: 'desc' } });
  if (run) await prisma.outreachRun.update({ where: { id: run.id }, data: { state, completedAt: new Date() } }).catch(() => {});
}

/**
 * Bắt đầu (hoặc chạy lại) campaign. RESET counters + trạng thái từng số về "Chờ lượt",
 * tăng runCount, tạo bản ghi lịch sử (OutreachRun), enqueue số ĐẦU theo thứ tự chat-time.
 * TUẦN TỰ: mỗi số hoàn tất mới enqueue số kế (finishPhone) → không song song.
 */
export async function startCampaign(campaignId: string, opts?: { userId?: string; userName?: string; action?: 'start' | 'restart' }): Promise<number> {
  const c = await prisma.outreachCampaign.findUnique({ where: { id: campaignId } });
  if (!c) throw new Error('campaign_not_found');

  // Điều kiện gửi: chỉ khách ĐỦ ĐIỀU KIỆN vào hàng đợi; khách bị bỏ ghi rõ lý do (không enqueue).
  const evaluated = await evaluateAudience(c.orgId, c.customerListId, c.zaloAccountId, filterFromCampaign(c));
  const eligible = orderEligibleByChat(evaluated.filter((e) => e.eligible)); // chat cũ nhất trước
  const skipped = evaluated.filter((e) => !e.eligible);
  const ordered = eligible.map((e) => ({ id: e.id, phone: e.phone }));
  const newRun = (c.runCount ?? 0) + 1;

  await prisma.outreachCampaign.update({
    where: { id: campaignId },
    data: {
      state: 'running', totalTarget: ordered.length, startedAt: new Date(), completedAt: null, runCount: newRun,
      totalAdded: 0, totalAddFailed: 0, totalMsgSent: 0, totalMsgFailed: 0, totalSkipped: 0,
    },
  });
  await createRun(campaignId, newRun, opts?.action ?? 'start', opts?.userId, opts?.userName);

  // Seed dòng "Bỏ qua" (theo filter) trước — luôn hiện trong bảng dù không có ai đủ điều kiện.
  await seedSkipped(campaignId, skipped);

  if (ordered.length === 0) {
    await prisma.outreachCampaign.update({ where: { id: campaignId }, data: { state: 'completed', completedAt: new Date() } });
    await closeRun(campaignId, 'completed');
    await emitProgress(ioRef, c.orgId, campaignId);
    return 0;
  }

  await seedPhones(campaignId, ordered);

  const queue = getQueue();
  await queue.resume().catch(() => {});
  await queue.add(
    'add_friend',
    { kind: 'add_friend', campaignId, entryId: ordered[0].id, seq: 0 },
    { delay: STUB_MODE() ? 500 : randDelay(c.addDelayMinMs, c.addDelayMaxMs) },
  );
  logger.info(`[outreach] campaign=${campaignId} run#${newRun} (${opts?.action ?? 'start'}): ${ordered.length} đủ điều kiện, ${skipped.length} bỏ qua theo filter.`);
  return ordered.length;
}

/** Chạy lại từ đầu — CHỈ khi completed/cancelled. Reuse campaign, không xoá/không tạo trùng. */
export async function restartCampaign(campaignId: string, userId?: string, userName?: string): Promise<number> {
  const c = await prisma.outreachCampaign.findUnique({ where: { id: campaignId }, select: { state: true } });
  if (!c) throw new Error('campaign_not_found');
  if (c.state !== 'completed' && c.state !== 'cancelled') throw new Error('cannot_restart_running');
  return startCampaign(campaignId, { userId, userName, action: 'restart' });
}

export async function pauseCampaign(campaignId: string): Promise<void> {
  await prisma.outreachCampaign.update({ where: { id: campaignId }, data: { state: 'paused' } });
  await getQueue().pause();
}

export async function resumeCampaign(campaignId: string): Promise<void> {
  await prisma.outreachCampaign.update({ where: { id: campaignId }, data: { state: 'running' } });
  await getQueue().resume();
}

export async function cancelCampaign(campaignId: string): Promise<void> {
  await prisma.outreachCampaign.update({
    where: { id: campaignId },
    data: { state: 'cancelled', completedAt: new Date() },
  });
  await closeRun(campaignId, 'cancelled');
  await getQueue().drain().catch(() => {}); // xoá job waiting/delayed
}

/**
 * Kết thúc xử lý 1 số → chuyển sang SỐ KẾ TIẾP theo seq (thứ tự chat-time). Hết số → hoàn tất
 * + đóng lần chạy. Gọi ở finally của cả 2 processor → không treo, không song song.
 */
async function finishPhone(campaignId: string, seq: number) {
  const c = await prisma.outreachCampaign.findUnique({ where: { id: campaignId } });
  if (!c || c.state === 'cancelled' || c.state === 'completed') return;
  const next = await prisma.outreachPhone.findFirst({
    where: { campaignId, seq: { gt: seq } },
    orderBy: { seq: 'asc' },
    select: { entryId: true, seq: true },
  });
  if (next) {
    await getQueue().add(
      'add_friend',
      { kind: 'add_friend', campaignId, entryId: next.entryId, seq: next.seq },
      { delay: STUB_MODE() ? 500 : randDelay(c.addDelayMinMs, c.addDelayMaxMs) },
    );
  } else {
    await prisma.outreachCampaign.update({
      where: { id: campaignId },
      data: { state: 'completed', completedAt: new Date() },
    }).catch(() => {});
    await closeRun(campaignId, 'completed');
    await emitProgress(ioRef, c.orgId, campaignId);
  }
}

// ── Job processors ───────────────────────────────────────────────────────────

type AddState = 'sent' | 'already_friend' | 'pending' | 'no_zalo' | 'invalid' | 'failed';

/** Suy overall từ friend + message. */
function derivePhoneOverall(friend: string, message: string, enableAutoMessage: boolean): 'success' | 'waiting' | 'skipped' {
  if (friend === 'failed' || message === 'failed') return 'skipped';
  if (message === 'sent') return 'success';
  if (!enableAutoMessage && (friend === 'success' || friend === 'already_friend')) return 'success';
  return 'waiting';
}

/**
 * Cập nhật TẠI CHỖ trạng thái 1 số (1 số = 1 dòng). Merge friend/message với dòng cũ,
 * suy overall, upsert, rồi emit socket 'outreach:phone' để UI cập nhật realtime đúng dòng.
 */
async function upsertPhone(
  c: NonNullable<Awaited<ReturnType<typeof prisma.outreachCampaign.findUnique>>>,
  entryId: string, phone: string,
  patch: { friendStatus?: string; messageStatus?: string; note?: string | null; overall?: 'waiting' | 'processing' | 'success' | 'skipped' },
) {
  const existing = await prisma.outreachPhone.findUnique({
    where: { campaignId_entryId: { campaignId: c.id, entryId } },
  });
  const friend = patch.friendStatus ?? existing?.friendStatus ?? 'none';
  const message = patch.messageStatus ?? existing?.messageStatus ?? 'none';
  const note = patch.note !== undefined ? patch.note : existing?.note ?? null;
  // overall: override tường minh (vd 'processing' khi bắt đầu xử lý) hoặc suy từ friend+message.
  const overall = patch.overall ?? derivePhoneOverall(friend, message, c.enableAutoMessage);
  await prisma.outreachPhone.upsert({
    where: { campaignId_entryId: { campaignId: c.id, entryId } },
    create: { campaignId: c.id, entryId, phone, friendStatus: friend, messageStatus: message, overallStatus: overall, note },
    update: { phone, friendStatus: friend, messageStatus: message, overallStatus: overall, note },
  });
  ioRef?.to(`org:${c.orgId}`).emit('outreach:phone', {
    campaignId: c.id, entryId, phone,
    overallStatus: overall, friendStatus: friend, messageStatus: message, note,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Xử lý 1 job add_friend — BỌC try/catch toàn bộ: mọi lỗi bất ngờ đều được ghi log
 * "failed" + tăng counter + maybeComplete → campaign KHÔNG BAO GIỜ TREO. Mỗi entry
 * luôn tăng đúng 1 counter (added | skipped | addFailed).
 */
async function processAddFriend(data: AddFriendJob) {
  const started = Date.now();
  let c: Awaited<ReturnType<typeof prisma.outreachCampaign.findUnique>> = null;
  let counted = false;
  let messageEnqueued = false; // đã enqueue tin → job tin sẽ chuyển số kế; chưa → finally chuyển
  try {
    c = await prisma.outreachCampaign.findUnique({ where: { id: data.campaignId } });
    if (!c || c.state === 'cancelled' || c.state === 'completed') return;

    const entry = await prisma.customerListEntry.findUnique({
      where: { id: data.entryId },
      select: { id: true, contactId: true, phoneE164: true, phoneLocal: true, phoneRaw: true, phoneValid: true, nameRaw: true, zaloName: true },
    });
    if (!entry) { await recordAdd(c, data.entryId, '', null, 'failed', 'entry_not_found', started); counted = true; return; }
    const phone = entry.phoneLocal || entry.phoneE164 || entry.phoneRaw || '';
    const name = entry.zaloName || entry.nameRaw || null;

    // Đánh dấu "Đang xử lý" ngay khi bắt đầu xử lý số này (UI hiện realtime).
    await upsertPhone(c, entry.id, phone, { overall: 'processing' });

    // SĐT không hợp lệ → BỎ QUA (không gọi Zalo), vẫn báo cáo.
    if (!entry.phoneValid || !entry.phoneE164) {
      await recordAdd(c, entry.id, phone, null, 'invalid', 'Bỏ qua - SĐT không hợp lệ', started); counted = true; return;
    }
    // Rate limit ngày
    if (await countActionsToday(data.campaignId, 'add_friend') >= c.maxAddPerDay) {
      await recordAdd(c, entry.id, phone, entry.contactId, 'no_zalo', 'Bỏ qua - đã đạt giới hạn kết bạn/ngày', started); counted = true; return;
    }

    // Đảm bảo có Contact (nhiều entry chưa gắn). Tạo/khớp theo SĐT rồi lưu lại.
    let contactId = entry.contactId;
    if (!contactId) {
      try {
        const resolved = await resolveOrCreateContact({ orgId: c.orgId, phone, fallbackFullName: name });
        contactId = resolved.id;
        await prisma.customerListEntry.update({ where: { id: entry.id }, data: { contactId } }).catch(() => {});
      } catch (err) { logger.warn(`[outreach] resolveContact lỗi ${phone}: ${(err as Error)?.message ?? err}`); }
    }

    let zaloUid: string | null = null;
    let state: AddState = 'failed';
    let note: string | null = null;
    if (STUB_MODE()) {
      state = 'sent'; zaloUid = `stub-uid-${entry.id.slice(0, 8)}`;
      logger.info(`[outreach][STUB] add_friend phone=${phone}`);
    } else if (!contactId) {
      state = 'failed'; note = 'cannot_resolve_contact';
    } else if (c.enableAutoAdd) {
      const outcome = await attemptFriendRequest({
        orgId: c.orgId, zaloAccountId: c.zaloAccountId, contactId,
        phone, message: c.addFriendMessage || 'Xin chào! Kết bạn để mình gửi thông tin nhé.',
      });
      if (outcome.ok) { zaloUid = outcome.zaloUid; state = outcome.state; }
      else if (outcome.state === 'no_zalo') { state = 'no_zalo'; note = 'Bỏ qua - số không dùng Zalo (tài khoản không tồn tại)'; }
      else { state = 'failed'; note = (outcome as any).errorDetail ?? outcome.state; }
    } else {
      const contact = await prisma.contact.findUnique({ where: { id: contactId }, select: { zaloUid: true } });
      zaloUid = contact?.zaloUid ?? null;
      state = zaloUid ? 'sent' : 'no_zalo';
      if (!zaloUid) note = 'Bỏ qua - chưa có Zalo UID để nhắn';
    }

    const defaultNote: Record<AddState, string | null> = {
      sent: null, already_friend: 'Bỏ qua - đã là bạn bè',
      pending: 'Bỏ qua - đã gửi lời mời, chờ chấp nhận',
      no_zalo: 'Bỏ qua - số không dùng Zalo', invalid: 'Bỏ qua - SĐT không hợp lệ', failed: null,
    };
    await recordAdd(c, entry.id, phone, contactId, state, note ?? defaultNote[state], started, zaloUid);
    counted = true;

    // Kết bạn ok (sent/already_friend/pending) + có uid + bật nhắn → enqueue tin cho CHÍNH số này.
    // Job tin xong sẽ finishPhone → chuyển số kế (đảm bảo TUẦN TỰ: kết bạn → nhắn → số kế).
    const proceed = (state === 'sent' || state === 'already_friend' || state === 'pending') && !!zaloUid;
    if (proceed && c.enableAutoMessage) {
      try {
        await getQueue().add(
          'send_message',
          { kind: 'send_message', campaignId: c.id, entryId: entry.id, seq: data.seq, contactId, zaloUid: zaloUid!, phone, name },
          { delay: STUB_MODE() ? 800 : randDelay(c.waitAfterAddMinMs, c.waitAfterAddMaxMs) },
        );
        messageEnqueued = true;
      } catch (enqErr) {
        await prisma.outreachCampaign.update({ where: { id: c.id }, data: { totalMsgFailed: { increment: 1 } } });
        await writeLog({ campaignId: c.id, entryId: entry.id, contactId, phone, actionType: 'send_message', status: 'failed', errorMessage: 'Không xếp được hàng tin: ' + ((enqErr as Error)?.message ?? enqErr) });
        await emitProgress(ioRef, c.orgId, c.id);
      }
    }
  } catch (err) {
    logger.error(`[outreach] processAddFriend crash entry=${data.entryId}: ${(err as Error)?.message ?? err}`);
    if (c && !counted) {
      try { await recordAdd(c, data.entryId, '', null, 'failed', 'Lỗi bất ngờ: ' + ((err as Error)?.message ?? String(err)), started); } catch { /* ignore */ }
    }
  } finally {
    // Chưa enqueue tin (bỏ qua/lỗi/không nhắn) → tự chuyển số kế NGAY. Đã enqueue tin →
    // để job tin chuyển. Luôn tiến tới số kế/hoàn tất → KHÔNG BAO GIỜ TREO.
    if (!messageEnqueued) await finishPhone(data.campaignId, data.seq).catch(() => {});
  }
}

/** Ghi counter + log + emit cho 1 kết quả add_friend. */
async function recordAdd(
  c: NonNullable<Awaited<ReturnType<typeof prisma.outreachCampaign.findUnique>>>,
  entryId: string, phone: string, contactId: string | null,
  state: AddState, note: string | null, started: number, zaloUid?: string | null,
) {
  // Nhóm "đi tiếp nhắn tin" (sent/already_friend/pending) → totalAdded để maybeComplete
  // đếm đúng số tin kỳ vọng (tránh hoàn tất sớm làm job nhắn bị bỏ). no_zalo/invalid →
  // Bỏ qua. failed → Kết bạn lỗi. (KHÔNG có trường hợp nào rơi vào "Kết bạn lỗi" oan.)
  const proceeds = state === 'sent' || state === 'already_friend' || state === 'pending';
  const counter =
    proceeds ? { totalAdded: { increment: 1 } }
    : state === 'failed' ? { totalAddFailed: { increment: 1 } }
    : { totalSkipped: { increment: 1 } }; // no_zalo, invalid
  const logStatus: 'success' | 'skipped' | 'failed' =
    proceeds ? 'success' : state === 'failed' ? 'failed' : 'skipped';
  await prisma.outreachCampaign.update({ where: { id: c.id }, data: counter });
  await writeLog({
    campaignId: c.id, entryId, contactId, phone, actionType: 'add_friend',
    status: logStatus, resultData: state !== 'failed' ? { state, zaloUid } : undefined,
    errorMessage: note, durationMs: Date.now() - started,
  });
  // Cập nhật dòng per-số (cột "Kết bạn" + overall + note).
  const friendStatus =
    state === 'sent' ? 'success'
    : state === 'already_friend' ? 'already_friend'
    : state === 'pending' ? 'waiting'
    : 'failed'; // no_zalo | invalid | failed
  await upsertPhone(c, entryId, phone, { friendStatus, note });
  await emitProgress(ioRef, c.orgId, c.id);
}

/** Xử lý 1 job send_message — bọc try/catch/finally. finally → finishPhone chuyển số kế. */
async function processSendMessage(data: SendMessageJob) {
  const started = Date.now();
  let c: Awaited<ReturnType<typeof prisma.outreachCampaign.findUnique>> = null;
  let counted = false;
  try {
    c = await prisma.outreachCampaign.findUnique({ where: { id: data.campaignId } });
    if (!c || c.state === 'cancelled' || c.state === 'completed') return;

    if (await countActionsToday(data.campaignId, 'send_message') >= c.maxMsgPerDay) {
      await prisma.outreachCampaign.update({ where: { id: c.id }, data: { totalSkipped: { increment: 1 } } });
      await writeLog({ campaignId: c.id, entryId: data.entryId, contactId: data.contactId, phone: data.phone, actionType: 'send_message', status: 'skipped', errorMessage: 'Bỏ qua - đã đạt giới hạn tin/ngày' });
      counted = true; await upsertPhone(c, data.entryId, data.phone, { messageStatus: 'failed', note: 'Đã đạt giới hạn tin/ngày' }); await emitProgress(ioRef, c.orgId, c.id); return;
    }

    const tpl = await selectWeightedTemplate(c.id);
    if (!tpl) {
      await prisma.outreachCampaign.update({ where: { id: c.id }, data: { totalMsgFailed: { increment: 1 } } });
      await writeLog({ campaignId: c.id, entryId: data.entryId, contactId: data.contactId, phone: data.phone, actionType: 'send_message', status: 'failed', errorMessage: 'Không có mẫu tin khả dụng' });
      counted = true; await upsertPhone(c, data.entryId, data.phone, { messageStatus: 'failed', note: 'Không có mẫu tin' }); await emitProgress(ioRef, c.orgId, c.id); return;
    }

    const text = renderTemplate(tpl.content, { name: data.name, phone: data.phone });
    const res = await sendCampaignMessage({
      zaloAccountId: c.zaloAccountId, zaloUid: data.zaloUid, text,
      imageAssetIds: tpl.imageAssetIds, orgId: c.orgId, io: ioRef,
    });
    await prisma.outreachCampaign.update({
      where: { id: c.id },
      data: res.ok ? { totalMsgSent: { increment: 1 } } : { totalMsgFailed: { increment: 1 } },
    });
    counted = true;
    await writeLog({
      campaignId: c.id, entryId: data.entryId, contactId: data.contactId, phone: data.phone,
      actionType: 'send_message', status: res.ok ? 'success' : 'failed',
      resultData: res.ok ? { msgId: res.msgId, text, usedImage: res.usedImage, imageCount: res.imageCount } : undefined,
      // Lỗi gửi (vd chặn tin / chưa là bạn) → báo cáo rõ, KHÔNG crash chiến dịch.
      errorMessage: res.ok ? null : ('Lỗi nhắn tin: ' + (res.error ?? 'không rõ')), durationMs: Date.now() - started,
    });
    // Cập nhật dòng per-số (cột "Nhắn tin" + overall). success → message 'sent' (overall
    // success); lỗi → message 'failed' (overall skipped) + note "Không gửi được tin".
    await upsertPhone(c, data.entryId, data.phone, res.ok
      ? { messageStatus: 'sent' }
      : { messageStatus: 'failed', note: 'Không gửi được tin: ' + (res.error ?? 'không rõ') });
    await emitProgress(ioRef, c.orgId, c.id);
  } catch (err) {
    logger.error(`[outreach] processSendMessage crash entry=${data.entryId}: ${(err as Error)?.message ?? err}`);
    if (c && !counted) {
      try {
        await prisma.outreachCampaign.update({ where: { id: c.id }, data: { totalMsgFailed: { increment: 1 } } });
        await writeLog({ campaignId: c.id, entryId: data.entryId, contactId: data.contactId, phone: data.phone, actionType: 'send_message', status: 'failed', errorMessage: 'Lỗi bất ngờ: ' + ((err as Error)?.message ?? String(err)), durationMs: Date.now() - started });
        await upsertPhone(c, data.entryId, data.phone, { messageStatus: 'failed', note: 'Lỗi bất ngờ khi nhắn' });
        await emitProgress(ioRef, c.orgId, c.id);
      } catch { /* ignore */ }
    }
  } finally {
    // Nhắn xong (hoặc lỗi) → chuyển số kế tiếp. Đảm bảo tuần tự + không treo.
    await finishPhone(data.campaignId, data.seq).catch(() => {});
  }
}

// ── Worker lifecycle ─────────────────────────────────────────────────────────
let workerInstance: Worker<OutreachJob> | null = null;
let workerConnection: Redis | null = null;

export function startOutreachWorker(): Worker<OutreachJob> {
  if (workerInstance) { logger.warn('[outreach-worker] already started'); return workerInstance; }
  workerConnection = getConnection().duplicate();
  workerInstance = new Worker<OutreachJob>(
    OUTREACH_QUEUE,
    async (job: Job<OutreachJob>) => {
      if (job.data.kind === 'add_friend') return processAddFriend(job.data);
      if (job.data.kind === 'send_message') return processSendMessage(job.data);
    },
    {
      connection: workerConnection as ConnectionOptions,
      concurrency: 1, // tuần tự per-nick — tránh burst → Zalo anti-spam
    },
  );
  workerInstance.on('failed', (job, err) => {
    logger.error(`[outreach-worker] failed job=${job?.name} attempt=${job?.attemptsMade}: ${err.message}`);
  });
  workerInstance.on('error', (err) => logger.error(`[outreach-worker] error: ${err.message}`));
  logger.info('[outreach-worker] started');
  return workerInstance;
}

export async function stopOutreachWorker(): Promise<void> {
  if (workerInstance) { await workerInstance.close(); workerInstance = null; }
  if (workerConnection) { await workerConnection.quit(); workerConnection = null; }
  if (queueInstance) { await queueInstance.close(); queueInstance = null; }
  if (connection) { await connection.quit(); connection = null; }
}
