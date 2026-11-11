// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * zalo-label-diff.ts: so sánh thuần (không I/O) trạng thái label của một friend,
 * để sync label bỏ qua các friend không đổi thay vì ghi lại toàn bộ mỗi lần.
 */

export type FriendLabelSnapshot = { id: number; name: string; color: string; emoji: string | null };

/**
 * true khi label Zalo và tag mirror đang lưu của một friend đã khớp đúng kết quả sync.
 * So từng trường (không so chuỗi JSON) vì JSONB không giữ thứ tự khoá. Dữ liệu đang lưu
 * không phải mảng (null, dạng cũ) → coi là đã đổi để được ghi lại cho chuẩn.
 */
export function isFriendLabelStateUnchanged(
  storedLabels: unknown,
  nextLabels: FriendLabelSnapshot[],
  storedCrmTags: unknown,
  nextCrmTags: string[],
): boolean {
  if (!Array.isArray(storedLabels) || !Array.isArray(storedCrmTags)) return false;
  if (storedLabels.length !== nextLabels.length || storedCrmTags.length !== nextCrmTags.length) return false;
  for (let i = 0; i < nextLabels.length; i++) {
    const a = storedLabels[i] as Partial<FriendLabelSnapshot> | null;
    const b = nextLabels[i];
    if (!a || typeof a !== 'object') return false;
    if (a.id !== b.id || a.name !== b.name || a.color !== b.color || (a.emoji ?? null) !== (b.emoji ?? null)) return false;
  }
  for (let i = 0; i < nextCrmTags.length; i++) {
    if (storedCrmTags[i] !== nextCrmTags[i]) return false;
  }
  return true;
}
