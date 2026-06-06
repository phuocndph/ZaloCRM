// Phase Friend Invite Queue 2026-05-30 — Service "list Mục tiêu" cho org.
//
// GET /api/v1/automation/muc-tieu/list (+ alias /triggers/list-muc-tieu) gọi
// hàm `listMucTieuForOrg` này. Mỗi row trả về:
//   - meta (id, name, state, createdAt, createdBy, sourceList, sequenceName, nickCount)
//   - progress (processed / totalEntries) — đếm từ CustomerListEntry queueStatus
//   - counters (friendSent, friendAccepted, replyCount, blockCount) — aggregate
//     parallel từ FriendRequestOutbox + Friend + AutomationTask (Wave 3 stub 0)
//   - lastActivityAt — MAX(FriendRequestOutbox.createdAt) per trigger
//                      (note: outbox không có updatedAt, dùng createdAt làm proxy
//                       — chấp nhận approximation, ghi trong openIssues)
//
// Performance:
//   - 1 findMany triggers (with include)
//   - 1 groupBy state cho statusCounts (toàn bộ triggers của org)
//   - Per trigger: 6 song song qua Promise.all → batch hết qua Promise.all bên ngoài
//   - Default limit 50; không cursor pagination — defer Wave 4
//
// Wave 2 trigger CHƯA có cột stoppedReason trên AutomationTask → reply/block
// counters fallback = 0 (defensive). Khi engine ship stop-on-reply/block, đổi
// implement bên trong, không ảnh hưởng response shape.

import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { isFriendInviteSegmentSpec } from './skip-precompute.js';

// ── Types ──────────────────────────────────────────────────────────────────

// BE T4 2026-05-30 — `scheduled` là UI-derived state (KHÔNG persist trong DB).
// Khi DB row state='draft' AND scheduledAt != null → UI/list trả 'scheduled'.
// Cron sweep flip 'draft'→'active' khi tới giờ + clear scheduledAt.
export type MucTieuListState = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled' | 'scheduled';

export interface MucTieuListItem {
  id: string;
  name: string;
  state: MucTieuListState;
  createdAt: string;
  createdBy: { id: string; displayName: string };
  sourceList: { id: string; name: string; totalEntries: number } | null;
  sequenceName: string | null;
  nickCount: number;
  // Phase Friend Invite UI 2026-05-30 — FE adapter dùng nickIds[] để bulk-load
  // ZaloAccount (gom unique từ cả page → 1 GET /zalo-accounts) rồi map sang
  // { id, displayName } cho avatar group. Không bulk-load trên BE để giữ
  // service nhẹ + tránh N+1 join zaloAccount mỗi trigger.
  nickIds: string[];
  progress: { totalContacts: number; processed: number; percent: number };
  counters: {
    friendSent: number;
    friendAccepted: number;
    replyCount: number;
    blockCount: number;
  };
  // Phase Friend Invite UI 2026-05-30 — 5 counter mới hiển thị TRỰC TIẾP trên row list
  // (mockup Mục tiêu overview): Tổng KH / Có Zalo / Không Zalo / Đã xử lý / Hoàn tất KH.
  // - totalEntries = tổng CustomerListEntry gán cho trigger này
  // - hasZaloCount = entry.hasZalo=true
  // - noZaloCount  = entry.hasZalo=false
  // - processedCount = entry.queueStatus='processed' (đã pickup xong skip-precompute + friend-send)
  // - completedKHCount = KH đã đi qua hết Sequence (derive từ AutomationTask
  //   sequenceId=trigger.sequenceId AND state IN ('done','skipped')) → semantic "Hoàn tất"
  //   theo helper deriveKHFinalState ('sequence_done'). Aggregate per trigger.
  totalEntries: number;
  hasZaloCount: number;
  noZaloCount: number;
  processedCount: number;
  completedKHCount: number;
  // I3 2026-06-03 — sequence-aware "Còn X KH" (Phase 1 pending + Phase 2 campaign active).
  stillRunning: number;
  // 2026-06-05 — Phase 2 "đang chạy": số KH đang trong chuỗi bám đuổi (campaign active).
  enrollingSequence: number;
  // 2026-06-05 — alias = completedKHCount (số KH đã đi hết chuỗi). Tử số Phase 2.
  completedSequence: number;
  // I3 2026-06-03 — ETA dự đoán còn lại (Lai A→B). null nếu Mục tiêu không active.
  eta: MucTieuEta | null;
  lastActivityAt: string | null;
  // 2026-06-05 — Cột "Ngày kết thúc": ISO khi state='completed' (= updatedAt lúc flip),
  // null khi đang chạy/hẹn lịch (FE hiện ETA dự đoán thay thế).
  completedAt: string | null;
  // BE T4 2026-05-30 — ISO khi state='scheduled' (FE render countdown "Sẽ chạy lúc HH:mm dd/MM").
  // null khi trigger không lên lịch (chế độ "now").
  scheduledAt: string | null;
}

// I3 2026-06-03 — ETA payload. mode='formula' (A, Mục tiêu mới <1 ngày) | 'measured'
// (B, đo tốc độ thực ≥1 ngày) | 'stalled' (tốc độ gần đây = 0 → đình trệ).
export interface MucTieuEta {
  mode: 'formula' | 'measured' | 'stalled';
  etaDays: number | null;   // null khi stalled
  label: string;            // "⏱ Còn ~2.5 ngày (ước tính)" | "⏸ Đang đình trệ"
}

export interface MucTieuListResponse {
  items: MucTieuListItem[];
  total: number;
  filters: {
    statusCounts: {
      all: number;
      active: number;
      paused: number;
      completed: number;
      draft: number;
      // BE T4 2026-05-30 — `scheduled` count = state='draft' AND scheduledAt set (future).
      // `cancelled` count exposed cho UI filter chip riêng (mặc định "all" vẫn skip cancelled).
      scheduled: number;
      cancelled: number;
    };
  };
}

export interface ListMucTieuOptions {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

// ── Internal helpers ───────────────────────────────────────────────────────

// BE T4 2026-05-30 — 'scheduled' là UI-only state; KHÔNG có trong DB column.
// Filter status='scheduled' phải map sang `state='draft' AND scheduledAt IS NOT NULL`
// trong WHERE (xử lý ở listMucTieuForOrg). normalizeState cũng tính lại scheduled
// từ raw row (state + scheduledAt).
const VALID_STATES: ReadonlySet<MucTieuListState> = new Set([
  'draft',
  'active',
  'paused',
  'completed',
  'cancelled',
  'scheduled',
]);

function isValidState(s: string | undefined): s is MucTieuListState {
  return !!s && VALID_STATES.has(s as MucTieuListState);
}

function normalizeState(
  s: string | null | undefined,
  scheduledAt: Date | null | undefined = null,
): MucTieuListState {
  // 'scheduled' = draft + scheduledAt future (chưa tới giờ).
  if (s === 'draft' && scheduledAt && scheduledAt.getTime() > Date.now()) {
    return 'scheduled';
  }
  if (s && VALID_STATES.has(s as MucTieuListState)) return s as MucTieuListState;
  return 'draft';
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Trả danh sách Mục tiêu (friend_invite_to_list trigger) cho 1 org kèm
 * counters + progress + lastActivity.
 *
 * Anh chốt 2026-06-02: hiển thị MỌI state (kể cả cancelled) khi filter="all".
 * Sale cần UI ĐÚNG, không phải UI "sạch" — cancelled hữu ích để biết tại sao
 * 1 KH bị giam (vd: entries bị trigger cancelled cũ chiếm trigger_id).
 */
export async function listMucTieuForOrg(
  orgId: string,
  options: ListMucTieuOptions = {},
): Promise<MucTieuListResponse> {
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);
  const search = options.search?.trim() ?? '';
  const statusFilter = isValidState(options.status) ? options.status : null;

  // ── Base WHERE (always restrict to org + friend_invite event type) ──────
  const baseWhere: Prisma.AutomationTriggerWhereInput = {
    orgId,
    eventType: 'friend_invite_to_list',
  };

  // ── statusCounts (groupBy state across ALL friend_invite triggers of org)
  // Compute first so we have the global "all" count BEFORE applying status filter.
  const stateGroups = await prisma.automationTrigger.groupBy({
    by: ['state'],
    where: baseWhere,
    _count: { id: true },
  });
  const statusCounts = {
    all: 0,
    active: 0,
    paused: 0,
    completed: 0,
    draft: 0,
    scheduled: 0,
    cancelled: 0,
  };
  for (const g of stateGroups) {
    // Anh chốt 2026-06-02: "all" hiển thị MỌI Mục tiêu (kể cả cancelled) — sale cần thấy
    // sự thật, không phải UI "sạch". Cancelled hữu ích để biết tại sao 1 KH bị giam.
    statusCounts.all += g._count.id;
    if (g.state === 'active') statusCounts.active += g._count.id;
    else if (g.state === 'paused') statusCounts.paused += g._count.id;
    else if (g.state === 'completed') statusCounts.completed += g._count.id;
    else if (g.state === 'draft') statusCounts.draft += g._count.id;
    else if (g.state === 'cancelled') statusCounts.cancelled += g._count.id;
  }
  // BE T4 2026-05-30 — 'scheduled' = state='draft' AND scheduledAt IS NOT NULL.
  // Separate count query vì groupBy state không phân biệt được scheduled vs pure draft.
  // Lưu ý: scheduled count được TRỪ khỏi statusCounts.draft để 2 chip không cộng dồn
  // trùng. statusCounts.all giữ nguyên (scheduled là subset của draft, đã đếm).
  const scheduledCount = await prisma.automationTrigger.count({
    where: { ...baseWhere, state: 'draft', scheduledAt: { not: null } },
  });
  statusCounts.scheduled = scheduledCount;
  statusCounts.draft = Math.max(0, statusCounts.draft - scheduledCount);

  // ── Apply listing WHERE ───────────────────────────────────────────────────
  const listWhere: Prisma.AutomationTriggerWhereInput = { ...baseWhere };

  if (statusFilter === 'scheduled') {
    // BE T4 2026-05-30 — 'scheduled' không phải DB state, map sang composite.
    listWhere.state = 'draft';
    listWhere.scheduledAt = { not: null };
  } else if (statusFilter === 'draft') {
    // Draft "thuần tuý" — loại scheduled ra để FE chip không trùng count.
    listWhere.state = 'draft';
    listWhere.scheduledAt = null;
  } else if (statusFilter) {
    listWhere.state = statusFilter;
  }
  // Default (no statusFilter): KHÔNG skip gì cả — hiển thị tất cả Mục tiêu
  // (Anh chốt 2026-06-02: UI đúng > UI sạch). Cancelled chip hiển thị trên FE
  // với badge xám để phân biệt visual, nhưng KHÔNG ẩn khỏi danh sách "Tất cả".

  // Search matches trigger.name OR customerList.name. CustomerList is referenced
  // via segmentSpec.listId (JSON path) — we can't JOIN directly here, so we
  // resolve in two steps: (a) name LIKE, (b) collect listIds whose CustomerList
  // name matches, OR them into segmentSpec JSON contains predicate.
  if (search) {
    const matchingLists = await prisma.customerList.findMany({
      where: { orgId, name: { contains: search, mode: 'insensitive' } },
      select: { id: true },
      take: 500, // safety cap — large match sets fall back to name-only
    });
    const listIds = matchingLists.map((l) => l.id);
    const orClauses: Prisma.AutomationTriggerWhereInput[] = [
      { name: { contains: search, mode: 'insensitive' } },
    ];
    for (const lid of listIds) {
      orClauses.push({
        segmentSpec: {
          path: ['listId'],
          equals: lid,
        } as object,
      });
    }
    listWhere.OR = orClauses;
  }

  // ── Total count for pagination ──────────────────────────────────────────
  const total = await prisma.automationTrigger.count({ where: listWhere });

  // ── Fetch triggers page ─────────────────────────────────────────────────
  const triggers = await prisma.automationTrigger.findMany({
    where: listWhere,
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: limit,
    include: {
      createdBy: { select: { id: true, fullName: true } },
      // I3 2026-06-03 — steps cần cho ETA (tổng delayMinutes các bước chuỗi).
      sequence: { select: { id: true, name: true, steps: true } },
    },
  });

  if (triggers.length === 0) {
    return { items: [], total, filters: { statusCounts } };
  }

  // ── Bulk-load referenced CustomerLists (segmentSpec.listId) ────────────
  const listIdsReferenced = new Set<string>();
  for (const t of triggers) {
    const spec = t.segmentSpec;
    if (isFriendInviteSegmentSpec(spec)) listIdsReferenced.add(spec.listId);
  }
  const lists =
    listIdsReferenced.size > 0
      ? await prisma.customerList.findMany({
          where: { id: { in: [...listIdsReferenced] }, orgId },
          select: { id: true, name: true, totalEntries: true },
        })
      : [];
  const listById = new Map(lists.map((l) => [l.id, l]));

  // ── Per-trigger aggregates (parallel) ───────────────────────────────────
  const items = await Promise.all(
    triggers.map(async (t): Promise<MucTieuListItem> => {
      const spec = t.segmentSpec;
      const isValidSpec = isFriendInviteSegmentSpec(spec);
      const nickIds = isValidSpec ? spec.nickIds : [];
      const sourceListId = isValidSpec ? spec.listId : null;
      const sourceList = sourceListId ? listById.get(sourceListId) ?? null : null;

      const [
        processedCount,
        totalContactsCount,
        hasZaloCount,
        noZaloCount,
        friendSent,
        friendAccepted,
        replyCount,
        blockCount,
        lastOutbox,
      ] = await Promise.all([
        // #2 2026-06-06 — đếm hàng đợi per-trigger từ bảng nối; hasZalo (data khách) qua relation entry.
        // 1. processed entries for this trigger
        prisma.triggerQueueEntry.count({
          where: { triggerId: t.id, queueStatus: 'processed' },
        }),
        // 2. total entries assigned to this trigger (queue pool size)
        prisma.triggerQueueEntry.count({
          where: { triggerId: t.id },
        }),
        // 2a. hasZalo=true entries (đã quét + có Zalo)
        prisma.triggerQueueEntry.count({
          where: { triggerId: t.id, entry: { hasZalo: true } },
        }),
        // 2b. hasZalo=false entries (đã quét + không có Zalo / SDK 404)
        prisma.triggerQueueEntry.count({
          where: { triggerId: t.id, entry: { hasZalo: false } },
        }),
        // 3. friendSent — PER-KH (2026-06-05 fix). Trước dùng .count() = per-row
        // (đếm LƯỢT gửi, 1 KH gửi qua nhiều nick = nhiều row → phình mẫu số Phase 1).
        // groupBy distinct contactId = số KHÁCH đã được gửi lời mời (giống dashboard).
        prisma.friendRequestOutbox
          .groupBy({
            by: ['contactId'],
            where: {
              triggerId: t.id,
              sendStatus: { in: ['success', 'tentative'] },
              kind: 'FRIEND_REQUEST',
            },
          })
          .then((rows) => rows.length),
        // 4. friendAccepted — PER-KH (2026-06-05 fix). Trước dùng prisma.friend.count()
        // = đếm ROW Friend (1 KH × N nick = N row) → ra 3 khi chỉ 1 KH đồng ý. SAI.
        // ĐÚNG (giống dashboard accepted): DISTINCT contactId + JOIN ràng nick gửi =
        // nick accept (friends.zalo_account_id = outbox.nick_id) + status='accepted'.
        prisma.$queryRaw<Array<{ contact_id: string }>>`
          SELECT DISTINCT o.contact_id
          FROM friend_request_outbox o
          JOIN friends f
            ON f.contact_id = o.contact_id
           AND f.zalo_account_id = o.nick_id
           AND f.friendship_status = 'accepted'
          WHERE o.trigger_id = ${t.id}
            AND o.kind = 'FRIEND_REQUEST'
        `.then((rows) => rows.length),
        // 5. replyCount — Wave 3, AutomationTask.skipReason='reply'. Returns 0
        // defensively when the engine hasn't started writing this yet.
        safeTaskSkipReasonCount(orgId, t.id, 'reply'),
        // 6. blockCount — Wave 3, AutomationTask.skipReason='block'
        safeTaskSkipReasonCount(orgId, t.id, 'block'),
        // 7. lastActivityAt approximation — most-recent outbox row for trigger
        prisma.friendRequestOutbox.findFirst({
          where: { triggerId: t.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);

      // completedKHCount — KH đã đi hết Sequence (semantic deriveKHFinalState='sequence_done').
      // FIX v2 2026-06-03 (code-review CONFIRMED): bản fix I4 đếm AutomationCampaign
      // state='completed' SAI — 1 campaign phục vụ NHIỀU KH (campaign-materializer.ts:268
      // findFirst-then-reuse per trigger×sequence, segmentSnapshot chứa tất cả contactId).
      // → đếm campaign completed ra 0/1, KHÔNG phải số KH xong → tiến độ vẫn kẹt ~0%.
      // ĐÚNG: đếm distinct contactId có event 'sequence_step_sent' ở BƯỚC CUỐI
      // (metadata.stepIdx = totalSteps-1) → mỗi KH hoàn tất chuỗi tính 1. Bước cuối gửi
      // xong = KH đi hết sequence. Index idx_automation_event_log_trigger_contact_type cover.
      const seqStepsArr = Array.isArray(t.sequence?.steps) ? (t.sequence!.steps as unknown[]) : [];
      const totalStepsForTrigger = seqStepsArr.length;
      let completedKHCount = 0;
      if (totalStepsForTrigger > 0) {
        const lastStepIdx = totalStepsForTrigger - 1;
        const doneGroups = await prisma.automationEventLog.groupBy({
          by: ['contactId'],
          where: {
            orgId,
            triggerId: t.id,
            eventType: 'sequence_step_sent',
            contactId: { not: null },
            // metadata.stepIdx = bước cuối. Json path filter (Prisma Json equals).
            metadata: { path: ['stepIdx'], equals: lastStepIdx },
          },
        });
        completedKHCount = doneGroups.length;
      }

      // I3 2026-06-03 — ETA "Còn ~X ngày" (Lai A→B). stillRunning = KH chưa xong cả 2
      // phase: Phase 1 (queued_for_pickup + processing) + Phase 2 (campaign state='active').
      // Pattern giống detail (friend-invite-routes.ts:922-924). campaignStateGroups chỉ
      // còn dùng cho enrollingSequence (active) — campaign-level đếm KH đang trong chuỗi.
      const [campaignStateGroups, phase1Pending] = await Promise.all([
        prisma.automationCampaign.groupBy({
          by: ['state'],
          where: { orgId, triggerId: t.id, state: 'active' },
          _count: { id: true },
        }),
        prisma.triggerQueueEntry.count({
          where: { triggerId: t.id, queueStatus: { in: ['queued_for_pickup', 'processing'] } },
        }),
      ]);
      const enrollingSequence = campaignStateGroups.find((g) => g.state === 'active')?._count.id ?? 0;
      const stillRunning = phase1Pending + enrollingSequence;

      // ETA chỉ tính cho Mục tiêu đang chạy (active). Done/scheduled/paused → null.
      const etaInfo =
        normalizeState(t.state, t.scheduledAt) === 'active'
          ? await computeEtaForTrigger({
              orgId,
              triggerId: t.id,
              stillRunning,
              nickCount: nickIds.length,
              minFriendReqGapMs: t.minFriendReqGapMs ?? null,
              sequenceSteps: t.sequence?.steps ?? null,
              createdAt: t.createdAt,
            })
          : null;

      const percent =
        totalContactsCount > 0
          ? Math.min(100, Math.round((processedCount / totalContactsCount) * 100))
          : 0;

      return {
        id: t.id,
        name: t.name,
        // BE T4 2026-05-30 — derive 'scheduled' khi draft + scheduledAt future.
        state: normalizeState(t.state, t.scheduledAt),
        createdAt: t.createdAt.toISOString(),
        createdBy: {
          id: t.createdBy.id,
          displayName: t.createdBy.fullName,
        },
        sourceList: sourceList
          ? {
              id: sourceList.id,
              name: sourceList.name,
              totalEntries: sourceList.totalEntries,
            }
          : null,
        sequenceName: t.sequence?.name ?? null,
        nickCount: nickIds.length,
        // Phase Friend Invite UI 2026-05-30 — expose raw nickIds cho FE adapter bulk-load.
        nickIds,
        progress: {
          totalContacts: totalContactsCount,
          processed: processedCount,
          percent,
        },
        counters: {
          friendSent,
          friendAccepted,
          replyCount,
          blockCount,
        },
        // Phase Friend Invite UI 2026-05-30 — flat counters cho row list
        totalEntries: totalContactsCount,
        hasZaloCount,
        noZaloCount,
        processedCount,
        completedKHCount,
        // 2026-06-05 — alias completedSequence = completedKHCount (cùng query: distinct
        // contactId có event sequence_step_sent ở bước cuối). Đặt tên khớp dashboard để
        // FE tính Phase 2 = completedSequence / (enrollingSequence + completedSequence).
        completedSequence: completedKHCount,
        // I3 2026-06-03 — sequence-aware "Còn X KH" + ETA dự đoán còn lại.
        stillRunning,
        // 2026-06-05 — Cột Phase 2 cần tách "đang chạy": expose enrollingSequence
        // (đã tính ở line ~402, trước đây bị nuốt vào stillRunning rồi vứt). 0 query mới.
        enrollingSequence,
        eta: etaInfo,
        lastActivityAt: lastOutbox?.createdAt ? lastOutbox.createdAt.toISOString() : null,
        // 2026-06-05 — Cột "Ngày kết thúc": AutomationTrigger KHÔNG có cột completedAt.
        // Phương án A (0 query mới, anh chốt): khi state='completed' dùng updatedAt
        // (sweeper set NOW() lúc flip completed). Trigger đang chạy → null (FE hiện ETA
        // dự đoán thay thế). updatedAt có sẵn vì findMany dùng include (mọi scalar field).
        completedAt:
          normalizeState(t.state, t.scheduledAt) === 'completed'
            ? t.updatedAt.toISOString()
            : null,
        scheduledAt: t.scheduledAt ? t.scheduledAt.toISOString() : null,
      };
    }),
  );

  return {
    items,
    total,
    filters: { statusCounts },
  };
}

/**
 * Defensive helper: AutomationTask.skipReason='reply'/'block' chưa được engine
 * stop-on-reply ship (Wave 2). Bọc try/catch để 1 query lỗi không bể cả list.
 */
// FIX 2026-06-03 (I4): nguồn cũ đọc AutomationTask.skipReason đã DROP (migration
// 20260601182155) → stub trả 0 → cột "Phản hồi" LUÔN hiện 0 dù KH nhắn/chặn thật.
// Đổi sang đếm distinct contactId trong AutomationEventLog theo eventType — đây là
// nơi event-hooks.ts (customer_reply) + friend-event-handler.ts (customer_block) ghi
// thật. groupBy contactId để 1 KH nhắn nhiều lần chỉ tính 1 (semantic "bao nhiêu KH
// phản hồi", không phải "bao nhiêu lượt"). Index idx_automation_event_log_trigger_contact_type
// cover (triggerId, contactId, eventType).
async function safeTaskSkipReasonCount(
  orgId: string,
  triggerId: string,
  reason: 'reply' | 'block',
): Promise<number> {
  const eventType = reason === 'reply' ? 'customer_reply' : 'customer_block';
  try {
    const groups = await prisma.automationEventLog.groupBy({
      by: ['contactId'],
      where: {
        orgId,
        triggerId,
        eventType,
        contactId: { not: null },
      },
    });
    return groups.length;
  } catch (err) {
    logger.debug(
      `[muc-tieu-list] safeTaskSkipReasonCount(${reason}) for trigger=${triggerId} returned 0 (${err instanceof Error ? err.message : String(err)})`,
    );
    return 0;
  }
}

// ════════════════════════════════════════════════════════════════════════
// I3 2026-06-03 — ETA "Còn ~X ngày" cho Mục tiêu đang chạy (PHƯƠNG ÁN LAI A→B)
// ════════════════════════════════════════════════════════════════════════
// Anh chốt: mới chạy <1 ngày → công thức (A); ≥1 ngày → đo tốc độ thực (B);
// tốc độ gần đây = 0 → "đình trệ". Reaction-accept KHÔNG chi phối ETA (chuỗi không
// chờ accept — xem I2). 2 yếu tố chính: số KH còn lại ÷ tốc độ + tổng delay chuỗi.
const ETA_WORKING_HOURS_PER_DAY = 16;   // 6h–22h VN (M51.4)
const ETA_DEFAULT_DELAY_MIN = 30;       // fallback khi trigger chưa set gap
const ETA_MEASURE_WINDOW_DAYS = 5;      // cửa sổ đo tốc độ thực (B)

function etaFormatLabel(days: number, suffix: string): string {
  if (!Number.isFinite(days) || days <= 0) return `⏱ Sắp xong ${suffix}`;
  if (days < 1) {
    const hours = Math.round(days * 24);
    return `⏱ Còn ~${Math.max(1, hours)} giờ ${suffix}`;
  }
  if (days >= 100) return `⏱ Còn ~${Math.round(days)} ngày ${suffix}`;
  return `⏱ Còn ~${days.toFixed(1)} ngày ${suffix}`;
}

function etaSumSequenceDelayDays(steps: unknown): number {
  if (!Array.isArray(steps)) return 0;
  let totalMin = 0;
  for (const s of steps) {
    if (s && typeof s === 'object' && 'delayMinutes' in s) {
      const dm = (s as { delayMinutes: unknown }).delayMinutes;
      if (typeof dm === 'number' && Number.isFinite(dm) && dm >= 0) totalMin += dm;
    }
  }
  return totalMin / (60 * 24);
}

async function computeEtaForTrigger(input: {
  orgId: string;
  triggerId: string;
  stillRunning: number;
  nickCount: number;
  minFriendReqGapMs: number | null;
  sequenceSteps: unknown;
  createdAt: Date;
}): Promise<MucTieuEta | null> {
  const { orgId, triggerId, stillRunning, nickCount, minFriendReqGapMs, sequenceSteps, createdAt } = input;

  // FIX 2026-06-03 (code-review PLAUSIBLE): trả null (KHÔNG phải object "Sắp xong")
  // khi không còn KH chạy. FE chỉ check `v-if="item.eta"` → object non-null khiến
  // "⏱ Sắp xong" hiện vĩnh viễn trên trigger active đã hết KH. null → FE ẩn dòng ETA.
  if (stillRunning <= 0) {
    return null;
  }
  const nicks = Math.max(1, nickCount);
  const sequenceDelayDays = etaSumSequenceDelayDays(sequenceSteps);

  // ── Tuổi Mục tiêu (để chọn A hay B) ──
  const ageMs = Date.now() - createdAt.getTime();
  const ageDays = ageMs / (24 * 3600_000);

  // ── B: đo tốc độ thực từ AutomationEventLog (friend_request_sent + sequence_step_sent) ──
  // ≥1 ngày tuổi mới đủ dữ liệu. Đếm số event gửi trong cửa sổ gần nhất ÷ số ngày.
  if (ageDays >= 1) {
    try {
      const since = new Date(Date.now() - ETA_MEASURE_WINDOW_DAYS * 24 * 3600_000);
      const sentCount = await prisma.automationEventLog.count({
        where: {
          orgId,
          triggerId,
          eventType: { in: ['friend_request_sent', 'sequence_step_sent'] },
          createdAt: { gte: since },
        },
      });
      const windowDays = Math.min(ETA_MEASURE_WINDOW_DAYS, Math.max(1, ageDays));
      const ratePerDay = sentCount / windowDays;
      if (ratePerDay <= 0) {
        // Tốc độ gần đây = 0 → đình trệ (nick chết / pause hết / hết giờ gửi).
        return { mode: 'stalled', etaDays: null, label: '⏸ Đang đình trệ — kiểm tra nick' };
      }
      const etaDays = stillRunning / ratePerDay + sequenceDelayDays;
      return { mode: 'measured', etaDays, label: etaFormatLabel(etaDays, '(ước tính)') };
    } catch (err) {
      logger.debug(`[muc-tieu-list] ETA measured failed trigger=${triggerId}, fallback formula: ${err instanceof Error ? err.message : String(err)}`);
      // rơi xuống công thức A
    }
  }

  // ── A: công thức (Mục tiêu mới <1 ngày hoặc B lỗi) ──
  const delayMin = minFriendReqGapMs && minFriendReqGapMs > 0
    ? minFriendReqGapMs / 60_000
    : ETA_DEFAULT_DELAY_MIN;
  const perNickPerDay = (60 / Math.max(1, delayMin)) * ETA_WORKING_HOURS_PER_DAY;
  const systemPerDay = nicks * perNickPerDay;
  const etaDays = systemPerDay > 0 ? stillRunning / systemPerDay + sequenceDelayDays : 0;
  return { mode: 'formula', etaDays, label: etaFormatLabel(etaDays, '(sơ bộ)') };
}
