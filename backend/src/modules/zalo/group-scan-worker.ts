// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
// ════════════════════════════════════════════════════════════════════════
// E1 Quét group (🟢 Community) — group-scan worker processor.
// ════════════════════════════════════════════════════════════════════════
//
// processGroupScan(scanId): loop từng groupId trong scan.groupIds (resume từ
// resumeCursor) → getGroupInfo (memberIds + totalMember + hasMoreMember +
// currentMems profiles + adminIds) → chunk 50 enrich profile → join Friend theo
// lô → upsert GroupMember (unique [zaloAccountId, groupId, memberUid]).
//
// State machine: queued → running → (completed | partial | failed).
//   - 1 group lỗi → continue group khác → final state=partial.
//   - resumeCursor = groupId xử lý CUỐI (đã xong) → crash/retry skip group đã done.
//
// Rate-limit: zaloOps.getGroupInfo/getGroupMembersInfo đã qua rate-limiter
// (category group_read/query). KHÔNG thêm limiter thứ 2. Burst group_read /
// session-expire ném lỗi → BullMQ retry/backoff (xem group-scan-queue.ts) lo.

import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloOps } from '../../shared/zalo-operations.js';

const CHUNK_SIZE = 50;

interface MemberProfile {
  uid: string;
  displayName: string | null;
  zaloName: string | null;
  avatarUrl: string | null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function processGroupScan(scanId: string): Promise<void> {
  const scan = await prisma.groupScan.findUnique({ where: { id: scanId } });
  if (!scan) {
    logger.warn(`[group-scan-worker] scan ${scanId} not found — skip`);
    return;
  }
  const { orgId, zaloAccountId } = scan;
  const groupIds: string[] = Array.isArray(scan.groupIds)
    ? (scan.groupIds as unknown[]).map(String)
    : [];

  // Resume: bỏ qua group đã xử lý xong (resumeCursor = group cuối đã done).
  let startIdx = 0;
  if (scan.resumeCursor) {
    const idx = groupIds.indexOf(scan.resumeCursor);
    if (idx >= 0) startIdx = idx + 1; // group ở resumeCursor đã xong → bắt đầu sau nó
  }

  await prisma.groupScan.update({
    where: { id: scanId },
    data: {
      state: 'running',
      startedAt: scan.startedAt ?? new Date(),
      totalGroups: groupIds.length,
    },
  });

  let anyFailed = false;
  let anyTruncated = false;

  for (let i = startIdx; i < groupIds.length; i++) {
    const groupId = groupIds[i];
    try {
      const added = await scanOneGroup(orgId, zaloAccountId, groupId);
      if (added.truncated) anyTruncated = true;
      // Cập nhật tiến độ + resumeCursor SAU khi group xong (atomic increment).
      // Member của group truncated VẪN được đếm (đã upsert) — chỉ scan = partial.
      await prisma.groupScan.update({
        where: { id: scanId },
        data: {
          resumeCursor: groupId,
          scannedGroups: { increment: 1 },
          memberCount: { increment: added.members },
          friendCount: { increment: added.friends },
        },
      });
    } catch (err) {
      anyFailed = true;
      logger.error(
        `[group-scan-worker] scan=${scanId} group=${groupId} failed: ${(err as Error).message}`,
      );
      // Vẫn ghi cursor để resume không lặp lại group lỗi này; group khác tiếp tục.
      await prisma.groupScan.update({
        where: { id: scanId },
        data: { resumeCursor: groupId, error: (err as Error).message.slice(0, 500) },
      });
      // NOTE: KHÔNG re-throw — 1 group lỗi không hủy cả scan (AC #7 → state=partial).
    }
  }

  // partial khi có group lỗi HOẶC roster thiếu (truncated); completed nếu đầy đủ.
  const finalState = anyFailed || anyTruncated ? 'partial' : 'completed';
  await prisma.groupScan.update({
    where: { id: scanId },
    data: { state: finalState, completedAt: new Date() },
  });
  logger.info(`[group-scan-worker] scan=${scanId} done state=${finalState}`);
}

/**
 * Quét 1 group → upsert toàn bộ member vào GroupMember. Trả số member đã xử lý
 * (để cộng vào memberCount). Ném lỗi nếu getGroupInfo fail (caller xử per-group).
 */
async function scanOneGroup(
  orgId: string,
  zaloAccountId: string,
  groupId: string,
): Promise<{ members: number; friends: number; truncated: boolean }> {
  // ── 1. getGroupInfo → memberIds, totalMember, hasMoreMember, profiles inline ──
  const info = await zaloOps.getGroupInfo(zaloAccountId, groupId);
  const gridInfo = (info as { gridInfoMap?: Record<string, unknown> })?.gridInfoMap?.[groupId] as
    | {
        memberIds?: string[];
        memVerList?: string[]; // ["<uid>_<version>", ...] — nguồn roster THẬT của zca-js
        adminIds?: string[];
        creatorId?: string;
        currentMems?: Array<{ id: string; dName?: string; zaloName?: string; avatar?: string }>;
        hasMoreMember?: number;
        totalMember?: number;
      }
    | undefined;

  if (!gridInfo) {
    throw new Error(`getGroupInfo returned no gridInfoMap entry for ${groupId}`);
  }

  // FIX (test server thật 2026-06-22): zca-js getGroupInfo trả `memberIds` RỖNG;
  // roster THẬT nằm ở `memVerList` (mỗi phần tử "<uid>_<version>"). `currentMems`
  // cũng thường rỗng. Lấy uid = phần trước dấu '_' đầu (uid là số, không chứa '_').
  // Gộp cả 3 nguồn cho chắc, dedup ở dưới.
  const memFromVer = (Array.isArray(gridInfo.memVerList) ? gridInfo.memVerList : [])
    .map((e) => String(e).split('_')[0])
    .filter((id) => id.length > 0);
  const memFromCurrent = (Array.isArray(gridInfo.currentMems) ? gridInfo.currentMems : [])
    .map((m) => m?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  let memberIds = [
    ...(Array.isArray(gridInfo.memberIds) ? gridInfo.memberIds : []),
    ...memFromVer,
    ...memFromCurrent,
  ];
  const adminIds = new Set<string>([
    ...(Array.isArray(gridInfo.adminIds) ? gridInfo.adminIds : []),
    ...(gridInfo.creatorId ? [gridInfo.creatorId] : []),
  ]);
  const totalMember = typeof gridInfo.totalMember === 'number' ? gridInfo.totalMember : memberIds.length;
  const hasMore = typeof gridInfo.hasMoreMember === 'number' ? gridInfo.hasMoreMember : 0;

  // ── PAGINATION (AC #3: KHÔNG âm thầm thiếu member) ──────────────────────────
  // SDK zca-js getGroupInfo trả `hasMoreMember` (số member còn thiếu) nhưng KHÔNG
  // expose API phân trang member-list nào (apis/getGroupInfo.d.ts: chỉ nhận groupId,
  // trả 1 lần; getGroupMembersInfo nhận memberId[] để LẤY PROFILE, không phải để
  // PHÂN TRANG roster). Best-effort: dùng đúng memberIds SDK trả; nếu hasMore>0 hoặc
  // memberIds < totalMember thì roster THIẾU → ném lỗi để scan thành 'partial' (FE
  // thấy không-đầy-đủ) thay vì giả completed. memberCount vẫn = số thực upsert được
  // (chính xác), không tô vẽ totalMember.
  // TODO(pagination): khi zca-js thêm API lấy member theo trang (vd getGroupMembers
  // (groupId, {page})), fetch tiếp phần còn lại ở đây rồi gộp vào memberIds.
  const truncated = hasMore > 0 || (totalMember > 0 && memberIds.length < totalMember);

  // Dedup memberIds phòng SDK trả trùng.
  memberIds = [...new Set(memberIds)];

  // ── 2. Profile map: ưu tiên currentMems inline; enrich phần thiếu qua chunk 50 ──
  const profiles = new Map<string, MemberProfile>();
  for (const m of gridInfo.currentMems ?? []) {
    if (!m?.id) continue;
    profiles.set(m.id, {
      uid: m.id,
      displayName: m.dName ?? null,
      zaloName: m.zaloName ?? null,
      avatarUrl: m.avatar ?? null,
    });
  }

  const now = new Date();
  let upserted = 0;
  let friendsFound = 0;

  for (const batch of chunk(memberIds, CHUNK_SIZE)) {
    // Enrich: member chưa có profile inline → getGroupMembersInfo (rate-limited).
    const missing = batch.filter((uid) => !profiles.has(uid));
    if (missing.length > 0) {
      try {
        // wrapper đã FIX nhận memberId[] → truyền đúng các uid thiếu profile để enrich.
        const res = (await zaloOps.getGroupMembersInfo(zaloAccountId, missing)) as {
          profiles?: Record<string, { id?: string; displayName?: string; zaloName?: string; avatar?: string }>;
        };
        for (const [uid, p] of Object.entries(res?.profiles ?? {})) {
          if (!profiles.has(uid)) {
            profiles.set(uid, {
              uid,
              displayName: p.displayName ?? null,
              zaloName: p.zaloName ?? null,
              avatarUrl: p.avatar ?? null,
            });
          }
        }
      } catch (err) {
        // Enrich là best-effort — không có profile vẫn upsert memberUid (roster
        // đúng số). Log rồi tiếp.
        logger.warn(
          `[group-scan-worker] enrich profiles group=${groupId} failed: ${(err as Error).message}`,
        );
      }
    }

    // ── 3. Join Friend theo lô (AC #5) ──
    const friendRows = await prisma.friend.findMany({
      where: {
        zaloAccountId,
        zaloUidInNick: { in: batch },
        friendshipStatus: 'accepted',
      },
      select: { zaloUidInNick: true },
    });
    const friendSet = new Set(friendRows.map((r) => r.zaloUidInNick));

    // ── 4. Upsert từng member (unique [zaloAccountId, groupId, memberUid]) ──
    for (const uid of batch) {
      const prof = profiles.get(uid);
      const isFriend = friendSet.has(uid);
      if (isFriend) friendsFound++;
      const data = {
        displayName: prof?.displayName ?? null,
        zaloName: prof?.zaloName ?? null,
        avatarUrl: prof?.avatarUrl ?? null,
        isAdmin: adminIds.has(uid),
        isFriend,
        friendCheckedAt: now,
        lastSeenAt: now,
      };
      await prisma.groupMember.upsert({
        where: {
          zaloAccountId_groupId_memberUid: { zaloAccountId, groupId, memberUid: uid },
        },
        create: { orgId, zaloAccountId, groupId, memberUid: uid, ...data },
        update: data, // re-scan = update lastSeenAt/isFriend, KHÔNG tạo row trùng (AC #4)
      });
      upserted++;
    }
  }

  // Roster thiếu (community lớn, SDK không phân trang member): KHÔNG ném — thành viên
  // đã upsert vẫn được ĐẾM, chỉ đánh dấu truncated để scan = partial (AC #3 không
  // silently complete). Ném chỉ dành cho lỗi API thật (caller bắt → failed group).
  if (truncated) {
    logger.warn(
      `[group-scan-worker] group ${groupId} roster incomplete: ${upserted}/${totalMember} (hasMoreMember=${hasMore}, no paginated member API)`,
    );
  }

  return { members: upserted, friends: friendsFound, truncated };
}
