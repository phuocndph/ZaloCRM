// Sequence nick selector — Luồng Mục Tiêu (viết lại 2026-06-12).
//
// ════════════════════════════════════════════════════════════════════════
// LỊCH SỬ: file cũ có pickNickForTask() phục vụ task-worker.ts (DB-polling,
// đã XÓA cùng AutomationTask). Nhánh request_friend cũ đếm cap qua
// AutomationTask stub (luôn 0) — dead code, gỡ luôn. File giờ chỉ còn 1 hàm
// chọn nick cho đường event → sequence (materializeFromEvent).
// ════════════════════════════════════════════════════════════════════════
//
// CHỌN NICK (anh chốt 2026-06-12 — xem [[feedback_zalocrm_multi_sequence_rule]]):
//   1. List nick được phép = trigger.segmentSpec.nickIds (sale cấu hình lúc tạo
//      Mục tiêu — ĐÂY là tầng phân quyền Zalo scope; runtime không lọc owner thêm).
//      Nếu list rỗng → mọi nick connected trong org đều ứng viên.
//   2. Lọc: nick connected + còn quota gửi tin hôm nay.
//   3. ĐỢT NÀY (chờ TODO SEQ-C1 findUser-qua-phone): chỉ chọn nick ĐÃ có Friend
//      row gửi-được-ngay với KH (accepted, hoặc pending_sent + hasConversation).
//      KH chưa quan hệ nick nào → trả null, materializer skip ghi lý do rõ.
//   4. Bốc NGẪU NHIÊN 1 nick trong số ứng viên (rải tải, tránh dồn 1 nick → Zalo
//      nghi spam). Nick này sẽ đi HẾT luồng cho KH đó (sequence-step-worker mang
//      nickId theo mọi step — không bốc lại giữa chừng).

import { prisma } from '../../../shared/database/prisma-client.js';
import { peekQuota } from '../queues/quota-lua.js';
import { ensureUidForPair } from './ensure-uid.js';

export interface SequenceNickSelection {
  nickId: string;
  /** UID của KH trong nick này (zaloUidInNick) — gửi tin cần cái này */
  zaloUidInNick: string;
  reason: 'existing_friend' | 'resolved_uid';
}

/**
 * MANUAL (anh chốt D4 + 5 trụ cột #1): gắn tay khi đang chat → dùng CHÍNH nick đó.
 * ensureUidForPair resolve UID (có sẵn / tìm qua SĐT → tạo Friend row). KHÔNG random.
 *
 * @returns selection nếu gửi-được, hoặc { nickId:null, reason } với lý do rõ để
 *          manual-enroll báo sale NGAY (NO_PHONE/NO_ZALO/LOOKUP_CAPPED/NOT_CONNECTED).
 */
export async function resolveManualNickForContact(args: {
  orgId: string;
  nickId: string;
  contactId: string;
}): Promise<SequenceNickSelection | { nickId: null; reason: string }> {
  const r = await ensureUidForPair(args);
  if (!r.ok) return { nickId: null, reason: r.code };
  return {
    nickId: args.nickId,
    zaloUidInNick: r.uid,
    reason: r.source === 'existing_friend' ? 'existing_friend' : 'resolved_uid',
  };
}

/**
 * Chọn 1 nick để gắn KH vào sequence bám đuổi.
 *
 * @param allowedNickIds  trigger.segmentSpec.nickIds — null/empty = không giới hạn
 * @returns nick đã chọn + UID KH trong nick đó, hoặc null nếu không có nick gửi-được.
 *
 * Lý do trả null (materializer dùng để ghi skip reason):
 *   - 'no_allowed_nick_connected'   : list nick không có cái nào connected
 *   - 'no_friend_row'               : KH chưa quan hệ nick nào (chờ SEQ-C1 findUser)
 *   - 'all_nicks_capped'            : nick có Friend row nhưng đều đầy cap ngày
 */
export async function pickSequenceNickForContact(args: {
  orgId: string;
  contactId: string;
  allowedNickIds?: string[] | null;
}): Promise<SequenceNickSelection | { nickId: null; reason: string }> {
  const { orgId, contactId } = args;
  const allowed =
    args.allowedNickIds && args.allowedNickIds.length > 0
      ? new Set(args.allowedNickIds)
      : null;

  // 1. Friend rows gửi-được-ngay — 2026-06-13 (gửi bất chấp): KHÔNG còn ép
  //    accepted/pending. MỌI Friend row đều ứng viên (KH lạ gửi vào hộp người lạ).
  //    KH chưa có Friend row với nick nào trong list → thử ensureUidForPair (SEQ-C1)
  //    để KHÔNG skip âm thầm khách lạ (lỗi cũ).
  const friends = await prisma.friend.findMany({
    where: {
      orgId,
      contactId,
      strangerBlocked: { not: true }, // bỏ cặp KH đã bật chặn tin lạ
      // FIX code-review #4: loại KH đã CHẶN/XÓA/TỪ CHỐI nick (filter cũ OR[accepted|
      // pending+chat] ngầm loại các status này — filter mới phải loại lại tường minh).
      friendshipStatus: { notIn: ['blocked', 'removed', 'rejected'] },
      zaloAccount: { status: 'connected' },
    },
    select: {
      zaloAccountId: true,
      zaloUidInNick: true,
      zaloAccount: { select: { dailyMessageCap: true } },
    },
  });

  // 2. Áp list nick được phép (phân quyền Zalo scope từ Mục tiêu).
  let scoped = allowed
    ? friends.filter((f) => allowed.has(f.zaloAccountId))
    : friends;

  // 3. KH chưa có Friend row gửi-được trong list → THỬ resolve UID qua SĐT cho từng
  //    nick được phép (SEQ-C1). Nick đầu tiên resolve được → dùng. KHÔNG skip âm thầm.
  if (scoped.length === 0) {
    const candidateNickIds = await resolveCandidateNickIds(orgId, allowed);
    for (const nid of candidateNickIds) {
      const r = await ensureUidForPair({ orgId, nickId: nid, contactId });
      if (r.ok) {
        const nick = await prisma.zaloAccount.findUnique({ where: { id: nid }, select: { dailyMessageCap: true } });
        scoped = [{ zaloAccountId: nid, zaloUidInNick: r.uid, zaloAccount: { dailyMessageCap: nick?.dailyMessageCap ?? 0 } }];
        break;
      }
    }
  }

  if (scoped.length === 0) {
    // Resolve thất bại mọi nick → ghi lý do rõ (no_zalo/no_phone), KHÔNG skip im.
    return { nickId: null, reason: 'no_sendable_nick_after_lookup' };
  }

  // 3. Lọc nick còn quota gửi tin hôm nay (cap=0 nghĩa là disable → luôn cho qua).
  const underCap: SequenceNickSelection[] = [];
  for (const f of scoped) {
    const cap = f.zaloAccount?.dailyMessageCap ?? 0;
    if (cap <= 0) {
      underCap.push({ nickId: f.zaloAccountId, zaloUidInNick: f.zaloUidInNick, reason: 'existing_friend' });
      continue;
    }
    const { capped } = await peekQuota(f.zaloAccountId, 'message', cap);
    if (!capped) {
      underCap.push({ nickId: f.zaloAccountId, zaloUidInNick: f.zaloUidInNick, reason: 'existing_friend' });
    }
  }

  if (underCap.length === 0) {
    return { nickId: null, reason: 'all_nicks_capped' };
  }

  // 4. Bốc NGẪU NHIÊN 1 nick (rải tải cross-nick).
  const picked = underCap[Math.floor(Math.random() * underCap.length)];
  return picked;
}

/**
 * Danh sách nickId ứng viên để thử resolve UID (KH chưa có Friend row nào trong list).
 * = các nick trong allowedNickIds đang connected; nếu list rỗng → mọi nick connected
 * trong org. Giới hạn 10 để không đốt cap friend_lookup khi list lớn.
 */
async function resolveCandidateNickIds(orgId: string, allowed: Set<string> | null): Promise<string[]> {
  const nicks = await prisma.zaloAccount.findMany({
    where: {
      orgId,
      status: 'connected',
      ...(allowed ? { id: { in: [...allowed] } } : {}),
    },
    select: { id: true },
    take: 10,
  });
  return nicks.map((n) => n.id);
}
