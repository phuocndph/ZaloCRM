// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * group-info-sync-cron.ts — Làm tươi avatar/tên/sĩ số nhóm Zalo định kỳ.
 *
 * Vấn đề: Conversation.groupAvatarUrl là URL Zalo CDN — HẾT HẠN theo thời gian.
 * Hiện chỉ cập nhật THỤ ĐỘNG khi có tin nhắn group mới (message-handler.ts:994).
 * Nhóm im lặng lâu → URL cũ mãi → ảnh vỡ. Job này CHỦ ĐỘNG refresh.
 *
 * Mỗi 6h (avatar/tên nhóm đổi chậm, không cần 15' như friend-sync):
 *  - Query connected ZaloAccount (status='connected')
 *  - Với mỗi nick: lấy các Conversation threadType='group' → gọi getGroupInfo
 *  - Mirror avatar Zalo CDN → S3 nội bộ (mirrorRemoteMediaUrl, dedup content-hash) →
 *    lưu URL ỔN ĐỊNH thay URL CDN hết hạn. Mirror lỗi → fallback URL CDN thô.
 *  - Diff-then-update: chỉ ghi groupName/groupAvatarUrl/groupMembersCount khi ĐỔI,
 *    KHÔNG ghi đè bằng rỗng/null (giữ giá trị cũ nếu SDK trả trống — y guard ở
 *    message-handler.ts:996-998). Passive-path (message-handler) KHÔNG ghi đè URL nội
 *    bộ đã mirror (guard isLocalStorageUrl) → tránh flip-flop CDN↔S3.
 *
 * Mutex chống overlap; sequential + stagger để tránh burst Zalo rate-limit.
 * Cap MAX_GROUPS_PER_TICK chặn tick quá nặng (log phần bị bỏ → tick sau xử lý).
 * Errors per-group/per-account catch để 1 nhóm lỗi không break vòng lặp.
 */
import cron from 'node-cron';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { runSystemQuery, withTenant } from '../../shared/tenant/tenant-context.js';
import { buildGroupUpdates } from './group-info-refresh.js';

// 6h: avatar/tên nhóm đổi chậm. URL CDN thường sống nhiều giờ → 6h đủ tươi.
const CRON_SCHEDULE = '0 */6 * * *';

// Stagger giữa mỗi getGroupInfo (group read nặng hơn friend) → tránh burst rate-limit.
const STAGGER_MS = 300;

// Trần số group xử lý mỗi tick — chặn tick quá nặng khi có rất nhiều nhóm.
// Vượt trần → bỏ phần dư (log lại), tick sau (6h) sẽ tiếp tục.
const MAX_GROUPS_PER_TICK = 800;

let cronRunning = false;
let cronTask: ReturnType<typeof cron.schedule> | null = null;

/** Start cron làm tươi group info. Idempotent — đã start thì no-op. */
export function startGroupInfoSyncCron(): void {
  if (cronTask) {
    logger.info('[group-info-sync-cron] Already started, skipping');
    return;
  }
  cronTask = cron.schedule(CRON_SCHEDULE, async () => {
    if (cronRunning) {
      logger.warn('[group-info-sync-cron] Previous cycle still running, skipping this tick');
      return;
    }
    cronRunning = true;
    const startedAt = Date.now();
    try {
      await runCronCycle();
    } catch (err) {
      logger.error('[group-info-sync-cron] Unexpected cycle error:', err);
    } finally {
      cronRunning = false;
      logger.info(`[group-info-sync-cron] Cycle completed in ${Date.now() - startedAt}ms`);
    }
  });
  logger.info(`[group-info-sync-cron] Started, schedule="${CRON_SCHEDULE}"`);
}

/** Stop cron (test cleanup / graceful shutdown). */
export function stopGroupInfoSyncCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    logger.info('[group-info-sync-cron] Stopped');
  }
}

/** Single cycle: iterate connected accounts sequential với stagger. */
async function runCronCycle(): Promise<void> {
  // Cross-org sweep mọi nick connected → runSystemQuery. Per-account bọc withTenant.
  const accounts = await runSystemQuery(() =>
    prisma.zaloAccount.findMany({
      where: { status: 'connected' },
      select: { id: true, orgId: true, displayName: true },
    }),
  );

  if (accounts.length === 0) {
    logger.info('[group-info-sync-cron] No connected accounts, nothing to sync');
    return;
  }

  logger.info(`[group-info-sync-cron] Starting cycle: ${accounts.length} connected account(s)`);

  let totalGroups = 0;
  let totalRefreshed = 0;
  let totalErrors = 0;
  let totalSkipped = 0;

  for (const acc of accounts) {
    if (totalGroups >= MAX_GROUPS_PER_TICK) {
      totalSkipped++; // còn nick chưa xử lý → đếm để log
      continue;
    }
    try {
      const stat = await refreshAccountGroups(acc.id, acc.orgId, MAX_GROUPS_PER_TICK - totalGroups);
      totalGroups += stat.processed;
      totalRefreshed += stat.refreshed;
      totalErrors += stat.errors;
      totalSkipped += stat.skipped;
    } catch (err) {
      totalErrors++;
      logger.error(`[group-info-sync-cron] Account ${acc.id} (${acc.displayName}) failed:`, err);
    }
  }

  logger.info(
    `[group-info-sync-cron] Cycle stats: accounts=${accounts.length} groups=${totalGroups} ` +
      `refreshed=${totalRefreshed} errors=${totalErrors} skipped=${totalSkipped} (cap=${MAX_GROUPS_PER_TICK})`,
  );
}

/**
 * Refresh group info cho 1 nick. `budget` = số group tối đa còn được xử lý tick này.
 * Trả thống kê để cycle tổng hợp. Mọi lỗi per-group nuốt tại đây.
 */
async function refreshAccountGroups(
  accountId: string,
  orgId: string,
  budget: number,
): Promise<{ processed: number; refreshed: number; errors: number; skipped: number }> {
  const stat = { processed: 0, refreshed: 0, errors: 0, skipped: 0 };

  // Đọc + ghi Conversation trong tenant context (RLS-correct).
  const groups = await withTenant(orgId, () =>
    prisma.conversation.findMany({
      where: { zaloAccountId: accountId, threadType: 'group', externalThreadId: { not: null } },
      select: {
        id: true,
        externalThreadId: true,
        groupName: true,
        groupAvatarUrl: true,
        groupMembersCount: true,
      },
    }),
  );

  for (const g of groups) {
    if (stat.processed >= budget) {
      stat.skipped++;
      continue;
    }
    stat.processed++;
    const groupId = g.externalThreadId!;
    try {
      // Core dùng chung với path tức thì (group-info-refresh): getGroupInfo + mirror + diff.
      const updates = await buildGroupUpdates(accountId, groupId, g);
      if (updates) {
        await withTenant(orgId, () =>
          prisma.conversation.update({ where: { id: g.id }, data: updates }),
        );
        stat.refreshed++;
      }
    } catch (err) {
      stat.errors++;
      logger.warn(`[group-info-sync-cron] Group ${groupId} (acc ${accountId}) refresh failed:`, err);
    }
    // Stagger giữa các group → tránh burst Zalo rate-limit.
    if (STAGGER_MS > 0) await new Promise((r) => setTimeout(r, STAGGER_MS));
  }

  return stat;
}

/** Export cho test injection — chạy 1 cycle trực tiếp, không scheduling. */
export async function runGroupInfoSyncCycleNow(): Promise<void> {
  return runCronCycle();
}
