// ════════════════════════════════════════════════════════════════════════
// ensureUidForPair — SEQ-C1 (Sequence recode Đợt 1, 2026-06-13)
// ════════════════════════════════════════════════════════════════════════
//
// Đảm bảo cặp (nick, KH) có UID gửi-được TRƯỚC khi enqueue sequence. Đây là điểm
// nối SEQ-C1: KH chưa là bạn nick → tìm UID qua SĐT (zaloOps.findUser) → lưu Friend
// row → trả UID. Tái dùng findUser có sẵn (zalo-operations.ts:580), KHÔNG viết mới.
//
// Thứ tự fallback (anh chốt D4 — resolve NGAY lúc gắn):
//   1. Friend(nick,KH).zaloUidInNick có sẵn → dùng luôn (KH đang chat với chính nick đó).
//   2. Chưa có → Contact.phone rỗng → NO_PHONE.
//   3. Có SĐT → findUser:
//        - found  → UPSERT Friend (zaloUidInNick) ATOMIC → trả uid.
//        - no_zalo → NO_ZALO.
//        - cap/offline → LOOKUP_CAPPED / NOT_CONNECTED.
//
// ⚠️ Codex #4 (eng-review): upsert PHẢI atomic + KHÔNG đè UID hợp lệ bằng null. Vì
// Friend.zaloUidInNick là NOT NULL + unique(zaloAccountId, zaloUidInNick), ta chỉ tạo
// Friend row KHI đã có UID hợp lệ (không tạo row "tạm" rỗng).
//
// ⚠️ Codex #4 race: nhiều job cùng cặp gọi đồng thời → findUser trùng. Chấp nhận ở
// Đợt 1 (cap friend_lookup tự chặn; kết quả idempotent vì upsert theo unique key). Tải
// test nhỏ nên không thêm lock; ghi chú để Đợt sau nếu cần dedup findUser.

import { randomUUID, createHash } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { zaloOps } from '../../../shared/zalo-operations.js';

export type EnsureUidFail =
  | 'NO_PHONE' // KH chưa có số điện thoại trong hệ thống
  | 'NO_ZALO' // SĐT không có Zalo / findUser không thấy
  | 'LOOKUP_CAPPED' // nick hết lượt tìm Zalo hôm nay (rate limit)
  | 'NOT_CONNECTED' // nick CRM chưa kết nối Zalo
  | 'LOOKUP_FAILED'; // lỗi khác khi findUser

export type EnsureUidResult =
  | { ok: true; uid: string; source: 'existing_friend' | 'phone_lookup' }
  | { ok: false; code: EnsureUidFail; detail: string };

/** Hash SĐT (khớp friend-routes.ts:23 để PhoneSearchEvent dedup nhất quán). */
function hashPhone(phone: string): string {
  return createHash('sha256').update(phone.trim()).digest('hex');
}

/**
 * Đảm bảo (nick, KH) có UID gửi-được. Resolve qua SĐT + persist Friend row nếu cần.
 *
 * @returns { ok:true, uid } khi gửi-được, hoặc { ok:false, code } với lý do rõ để
 *          caller (manual-enroll / nick-selector) báo sale.
 */
export async function ensureUidForPair(args: {
  orgId: string;
  nickId: string;
  contactId: string;
}): Promise<EnsureUidResult> {
  const { orgId, nickId, contactId } = args;

  // ── Bước 1: Friend row đã có UID? ──────────────────────────────────────
  const existing = await prisma.friend.findFirst({
    where: { orgId, zaloAccountId: nickId, contactId },
    select: { id: true, zaloUidInNick: true },
  });
  if (existing?.zaloUidInNick) {
    return { ok: true, uid: existing.zaloUidInNick, source: 'existing_friend' };
  }

  // ── Bước 2: cần SĐT để tìm UID ─────────────────────────────────────────
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, orgId },
    select: { phone: true },
  });
  const phone = contact?.phone?.trim();
  if (!phone) {
    return {
      ok: false,
      code: 'NO_PHONE',
      detail: 'Khách chưa có số điện thoại — không tìm được Zalo để bám đuổi bằng nick này.',
    };
  }

  // ── Bước 3: findUser qua SĐT (tái dùng zaloOps, category friend_lookup) ──
  const phoneHash = hashPhone(phone);
  let uid: string | null = null;
  let zaloName: string | null = null;
  try {
    const raw = await zaloOps.findUser(nickId, phone);
    const u = (raw as Record<string, unknown>) || {};
    uid = String(u.uid || u.userId || '') || null;
    zaloName = String(u.zaloName || u.display_name || u.displayName || '') || null;
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    // Khớp friend-routes.ts:322 — phân loại lỗi nick (không phải KH chặn).
    if (e?.code === 'NOT_CONNECTED') {
      await logSearch(orgId, nickId, phoneHash, 'error', null, e.code);
      return { ok: false, code: 'NOT_CONNECTED', detail: 'Nick Zalo chưa kết nối. Vào Quản lý nick để kết nối lại.' };
    }
    if (e?.code === 'RATE_LIMITED') {
      await logSearch(orgId, nickId, phoneHash, 'rate_limited', null, e.code);
      return { ok: false, code: 'LOOKUP_CAPPED', detail: 'Nick đã hết lượt tìm Zalo hôm nay. Thử nick khác hoặc mai.' };
    }
    // Zalo phổ biến throw cho phone lạ → coi như không có Zalo (friend-routes.ts:339).
    await logSearch(orgId, nickId, phoneHash, 'no_zalo', null, e?.code ?? null);
    return { ok: false, code: 'NO_ZALO', detail: 'Số này không có Zalo / không tìm được. Chọn nick khác hoặc bỏ qua.' };
  }

  if (!uid) {
    await logSearch(orgId, nickId, phoneHash, 'no_zalo', null, null);
    return { ok: false, code: 'NO_ZALO', detail: 'Số này không có Zalo. Chọn nick khác hoặc bỏ qua.' };
  }

  await logSearch(orgId, nickId, phoneHash, 'found_zalo', uid, null);

  // ── Bước 4: UPSERT Friend row với UID hợp lệ (ATOMIC, không đè null) ────
  // unique(zaloAccountId, zaloUidInNick) đảm bảo idempotent: 2 job cùng resolve ra
  // cùng uid → upsert no-op. Friend row "lạ" (chưa kết bạn) → friendshipStatus='none'.
  await persistFriendUid({ orgId, nickId, contactId, uid, zaloName });

  return { ok: true, uid, source: 'phone_lookup' };
}

/** Ghi PhoneSearchEvent (audit + cache + đếm cap). Fire-and-forget, non-fatal. */
async function logSearch(
  orgId: string,
  accountId: string,
  phoneHash: string,
  result: string,
  foundUid: string | null,
  errorCode: string | null,
): Promise<void> {
  await prisma.phoneSearchEvent
    .create({
      data: { id: randomUUID(), orgId, accountId, phoneHash, result, foundUid, errorCode },
    })
    .catch((e) => logger.warn(`[ensure-uid] logSearch failed: ${(e as Error).message}`));
}

/**
 * Upsert Friend(nick, KH) với UID đã resolve. ATOMIC theo unique(zaloAccountId,
 * zaloUidInNick). Nếu đã có Friend row khác (cùng cặp, UID khác) → tạo row mới cho
 * identity này (đúng model KH Cha/Con: 1 KH có nhiều Friend identity per nick).
 */
async function persistFriendUid(args: {
  orgId: string;
  nickId: string;
  contactId: string;
  uid: string;
  zaloName: string | null;
}): Promise<void> {
  const { orgId, nickId, contactId, uid, zaloName } = args;
  try {
    await prisma.friend.upsert({
      where: { zaloAccountId_zaloUidInNick: { zaloAccountId: nickId, zaloUidInNick: uid } },
      // KHÔNG đè UID/identity hợp lệ — chỉ cập nhật tên hiển thị nếu trước rỗng.
      update: zaloName ? { zaloDisplayName: zaloName } : {},
      create: {
        id: randomUUID(),
        orgId,
        contactId,
        zaloAccountId: nickId,
        zaloUidInNick: uid,
        friendshipStatus: 'none', // KH lạ — gửi qua hộp người lạ (allowStrangerMessage)
        relationshipKind: 'none',
        zaloDisplayName: zaloName,
      },
    });
  } catch (e) {
    logger.error(`[ensure-uid] persistFriendUid failed nick=${nickId} contact=${contactId}: ${(e as Error).message}`);
    throw e; // caller cần biết persist fail (không enqueue mù).
  }
}
