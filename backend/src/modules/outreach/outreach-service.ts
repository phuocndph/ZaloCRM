// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * outreach-service.ts — Outreach Campaign primitives (🟢 Community).
 *
 * Tự động kết bạn + nhắn tin cho tập khách hàng ĐÃ ĐỒNG Ý (CustomerList).
 * Tái dùng: attemptFriendRequest() (campaign-service), zaloOps.sendMessage/sendImage,
 * downloadMediaToTemp() (chat-media-helpers), MediaAsset/MediaBlob.
 *
 * An toàn: tôn trọng AUTOMATION_STUB_MODE (mô phỏng, không gọi Zalo thật) + rate
 * limit theo ngày (maxAddPerDay / maxMsgPerDay đếm từ OutreachLog).
 */
import type { Server } from 'socket.io';
import { prisma } from '../../shared/database/prisma-client.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { downloadMediaToTemp } from '../chat/chat-media-helpers.js';
import { logger } from '../../shared/utils/logger.js';

export const STUB_MODE = () => process.env.AUTOMATION_STUB_MODE === 'true';

/** Random integer trong [min,max] (ms). Bảo vệ min<=max. */
export function randDelay(min: number, max: number): number {
  const lo = Math.max(0, Math.min(min, max));
  const hi = Math.max(min, max);
  return Math.floor(lo + Math.random() * (hi - lo));
}

/** Chọn 1 template theo weight (port selectRandomTemplate). null nếu không có. */
export async function selectWeightedTemplate(campaignId: string) {
  const templates = await prisma.outreachTemplate.findMany({
    where: { campaignId, isActive: true },
  });
  if (templates.length === 0) return null;
  const totalWeight = templates.reduce((s, t) => s + Math.max(1, t.weight), 0);
  let r = Math.random() * totalWeight;
  for (const t of templates) {
    r -= Math.max(1, t.weight);
    if (r <= 0) return t;
  }
  return templates[0];
}

/** Thay biến {{name}}, {{phone}} trong nội dung template. */
export function renderTemplate(
  content: string,
  ctx: { name?: string | null; phone?: string | null },
): string {
  return content
    .replace(/\{\{\s*name\s*\}\}/gi, ctx.name?.trim() || 'bạn')
    .replace(/\{\{\s*phone\s*\}\}/gi, ctx.phone?.trim() || '');
}

/**
 * Chọn ngẫu nhiên 1 ảnh trong imageAssetIds → tải về temp local path gửi được.
 * Trả về { path, cleanup } hoặc null (không có ảnh / lỗi tải).
 */
async function resolveImageAsset(
  orgId: string,
  assetId: string,
): Promise<{ path: string; cleanup: () => Promise<void> } | null> {
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, orgId, kind: 'image', archivedAt: null },
    include: { blobs: { where: { variantType: 'original' }, take: 1 } },
  });
  const blob = asset?.blobs?.[0];
  if (!blob?.publicUrl) return null;
  try {
    return await downloadMediaToTemp({ url: blob.publicUrl }, 'image');
  } catch (err) {
    logger.warn(`[outreach] tải ảnh ${assetId} thất bại: ${(err as Error)?.message ?? err}`);
    return null;
  }
}

/** Đếm số hành động THÀNH CÔNG trong 24h qua cho campaign + loại → check rate limit ngày. */
export async function countActionsToday(
  campaignId: string,
  actionType: 'add_friend' | 'send_message',
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return prisma.outreachLog.count({
    where: { campaignId, actionType, status: 'success', createdAt: { gte: since } },
  });
}

/** Ghi 1 dòng OutreachLog. */
export async function writeLog(data: {
  campaignId: string;
  entryId?: string | null;
  contactId?: string | null;
  phone: string;
  actionType: 'add_friend' | 'send_message';
  status: 'success' | 'failed' | 'skipped';
  resultData?: unknown;
  errorMessage?: string | null;
  durationMs?: number;
}) {
  await prisma.outreachLog.create({
    data: {
      campaignId: data.campaignId,
      entryId: data.entryId ?? null,
      contactId: data.contactId ?? null,
      phone: data.phone,
      actionType: data.actionType,
      status: data.status,
      resultData: (data.resultData ?? undefined) as any,
      errorMessage: data.errorMessage ?? null,
      durationMs: data.durationMs ?? null,
      executedAt: new Date(),
    },
  });
}

/** Emit tiến độ campaign tới org room (FE subscribe outreach:progress). */
export async function emitProgress(io: Server | null, orgId: string, campaignId: string) {
  if (!io) return;
  const c = await prisma.outreachCampaign.findUnique({ where: { id: campaignId } });
  if (!c) return;
  io.to(`org:${orgId}`).emit('outreach:progress', {
    campaignId,
    state: c.state,
    totalTarget: c.totalTarget,
    totalAdded: c.totalAdded,
    totalAddFailed: c.totalAddFailed,
    totalMsgSent: c.totalMsgSent,
    totalMsgFailed: c.totalMsgFailed,
    totalSkipped: c.totalSkipped,
  });
}

/**
 * Gửi tới zaloUid theo thứ tự: (1) TEXT trước, (2) TẤT CẢ ảnh của template dạng ALBUM sau.
 * Text và ảnh TÁCH RIÊNG (2 tin) — không gộp caption. Nhiều ảnh → 1 album (zca-js gửi
 * mảng attachments thành nhóm ảnh). threadType=0 (1-1). STUB_MODE → mô phỏng.
 */
export async function sendCampaignMessage(args: {
  zaloAccountId: string;
  zaloUid: string;
  text: string;
  imageAssetIds: string[];
  orgId: string;
  io: Server | null;
}): Promise<{ ok: boolean; msgId?: string; usedImage: boolean; imageCount: number; error?: string }> {
  const imageIds = args.imageAssetIds ?? [];
  if (STUB_MODE()) {
    logger.info(`[outreach][STUB] text + ${imageIds.length} ảnh (album) → uid=${args.zaloUid}`);
    return { ok: true, msgId: `stub-${Date.now()}`, usedImage: imageIds.length > 0, imageCount: imageIds.length };
  }

  // ── 1) Gửi TEXT trước ──
  let msgId = '';
  try {
    if (args.text?.trim()) {
      const r: any = await zaloOps.sendMessage(args.zaloAccountId, args.zaloUid, 0, { msg: args.text }, args.io);
      msgId = String(r?.msgId || r?.data?.msgId || '');
    }
  } catch (err) {
    // Text lỗi (bị chặn / chưa là bạn) → dừng, không gửi ảnh.
    return { ok: false, usedImage: false, imageCount: 0, error: 'Text: ' + ((err as Error)?.message ?? String(err)) };
  }

  // ── 2) Gửi ẢNH (ALBUM) sau — tất cả ảnh của template, KHÔNG caption ──
  if (!imageIds.length) return { ok: true, msgId, usedImage: false, imageCount: 0 };
  const cleanups: Array<() => Promise<void>> = [];
  const paths: string[] = [];
  for (const id of imageIds) {
    const img = await resolveImageAsset(args.orgId, id);
    if (img) { paths.push(img.path); cleanups.push(img.cleanup); }
  }
  if (!paths.length) {
    // Text đã gửi nhưng không tải được ảnh nào → báo lỗi ảnh.
    return { ok: false, msgId, usedImage: false, imageCount: 0, error: 'Không tải được ảnh đính kèm' };
  }
  try {
    // Mảng nhiều path → zca-js gửi thành 1 ALBUM (nhóm ảnh). caption='' vì text gửi riêng.
    await zaloOps.sendImage(args.zaloAccountId, args.zaloUid, 0, paths, args.io, '');
    return { ok: true, msgId, usedImage: true, imageCount: paths.length };
  } catch (err) {
    return { ok: false, msgId, usedImage: false, imageCount: 0, error: 'Ảnh: ' + ((err as Error)?.message ?? String(err)) };
  } finally {
    for (const cl of cleanups) await cl().catch(() => {});
  }
}
