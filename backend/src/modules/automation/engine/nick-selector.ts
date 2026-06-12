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

export interface SequenceNickSelection {
  nickId: string;
  /** UID của KH trong nick này (zaloUidInNick) — gửi tin cần cái này */
  zaloUidInNick: string;
  reason: 'existing_friend';
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

  // 1. Friend rows gửi-được-ngay (accepted | pending_sent+hasConversation),
  //    nick đang connected. JOIN nick để lấy cap + status 1 query.
  const friends = await prisma.friend.findMany({
    where: {
      orgId,
      contactId,
      OR: [
        { friendshipStatus: 'accepted' },
        { friendshipStatus: 'pending_sent', hasConversation: true },
      ],
      zaloAccount: { status: 'connected' },
    },
    select: {
      zaloAccountId: true,
      zaloUidInNick: true,
      zaloAccount: { select: { dailyMessageCap: true } },
    },
  });

  // 2. Áp list nick được phép (phân quyền Zalo scope từ Mục tiêu).
  const scoped = allowed
    ? friends.filter((f) => allowed.has(f.zaloAccountId))
    : friends;

  if (scoped.length === 0) {
    // Phân biệt "không có nick connected trong list" vs "KH chưa là bạn nick nào".
    // Nếu KH có Friend row nhưng đều ngoài list/không connected → coi như no nick.
    return { nickId: null, reason: friends.length > 0 ? 'no_allowed_nick_connected' : 'no_friend_row' };
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
