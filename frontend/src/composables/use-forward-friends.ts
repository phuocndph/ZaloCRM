// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-forward-friends.ts — tìm BẠN BÈ của nick nguồn để chuyển tiếp, không chỉ những người
 * đã từng chat qua CRM.
 *
 * Vì sao cần: danh sách đích cũ chỉ lấy từ `conversations` (hội thoại đã có) → muốn chuyển
 * tiếp cho một người bạn chưa từng nhắn qua CRM thì không tìm thấy.
 *
 * Tái dùng API sẵn có (KHÔNG thêm endpoint mới):
 *   - GET  /zalo-accounts/:id/friends-db?kind=all&search=…  → tìm bạn bè của nick
 *   - POST /friends/:id/ensure-conversation                 → lấy/tạo hội thoại (idempotent)
 *
 * Hội thoại chỉ được tạo khi user BẤM chuyển tiếp (không tạo lúc chỉ tick chọn).
 */
import { ref } from 'vue';
import { api } from '@/api/index';

export interface ForwardFriend {
  id: string;
  zaloUidInNick: string;
  zaloDisplayName: string | null;
  zaloAvatarUrl: string | null;
  hasConversation: boolean;
  contact?: { id: string; fullName: string | null; phone: string | null } | null;
}

export function forwardFriendName(f: ForwardFriend): string {
  return f.zaloDisplayName || f.contact?.fullName || `KH-${f.zaloUidInNick.slice(-4)}`;
}

export function useForwardFriends() {
  const friends = ref<ForwardFriend[]>([]);
  const searching = ref(false);
  let seq = 0;

  /** Tìm bạn bè của nick. `excludeContactIds`: bỏ những người đã hiện ở mục Hội thoại. */
  async function searchFriends(
    accountId: string | null | undefined,
    query: string,
    excludeContactIds: Set<string> = new Set(),
  ): Promise<void> {
    const q = query.trim();
    if (!accountId || q.length < 1) { friends.value = []; searching.value = false; return; }
    const mine = ++seq;
    searching.value = true;
    try {
      const res = await api.get<{ friends?: ForwardFriend[] }>(
        `/zalo-accounts/${accountId}/friends-db`,
        { params: { kind: 'all', page: 1, limit: 25, search: q } },
      );
      if (mine !== seq) return; // kết quả cũ, bỏ
      friends.value = (res.data?.friends || []).filter(
        (f) => !(f.contact?.id && excludeContactIds.has(f.contact.id)),
      );
    } catch {
      if (mine === seq) friends.value = [];
    } finally {
      if (mine === seq) searching.value = false;
    }
  }

  function clear() { friends.value = []; searching.value = false; seq++; }

  /**
   * Đổi danh sách friendId → conversationId (tạo hội thoại nếu chưa có).
   * Trả về mảng convId lấy được; friend nào lỗi thì bỏ qua (không chặn cả lượt gửi).
   */
  async function ensureConversations(friendIds: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const fid of friendIds) {
      try {
        const res = await api.post<{ conversationId: string }>(`/friends/${fid}/ensure-conversation`, {});
        if (res.data?.conversationId) out.push(res.data.conversationId);
      } catch { /* bỏ qua friend lỗi */ }
    }
    return out;
  }

  return { friends, searching, searchFriends, ensureConversations, clear };
}
