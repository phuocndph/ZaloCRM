// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-mobile-conversations.ts — danh sách hội thoại cho PWA Mobile.
 *
 * Vì sao KHÔNG dùng `useChat().fetchConversations`: hàm đó kéo theo work-scope,
 * inbox filter, folder, tag… (bộ máy của desktop) và luôn lấy top-N, KHÔNG phân trang.
 * Ở đây gọi thẳng `GET /conversations` — endpoint SẴN CÓ, đã hỗ trợ page/limit/search/unread.
 * Không thêm API mới, không nhân bản logic desktop.
 *
 * Realtime: nghe `chat:message` trên socket ĐANG CÓ (do useChat().initSocket dựng).
 */
import { ref, computed } from 'vue';
import { api } from '@/api/index';

const PAGE_SIZE = 30;

/** Chỉ lấy các field mobile cần — bám theo response thật của GET /conversations. */
export interface MConversation {
  id: string;
  unreadCount?: number;
  lastMessageAt?: string | null;
  threadType?: string;
  contact?: { id?: string; fullName?: string | null; crmName?: string | null; avatarUrl?: string | null } | null;
  zaloAccount?: { id?: string; displayName?: string | null } | null;
  messages?: Array<{ content?: string | null; contentType?: string | null; senderType?: string | null }>;
  redacted?: boolean;
  [k: string]: unknown;
}

export function useMobileConversations() {
  const items = ref<MConversation[]>([]);
  const loading = ref(false);
  const loadingMore = ref(false);
  const page = ref(1);
  const total = ref(0);
  const search = ref('');
  const unreadOnly = ref(false);
  const error = ref<string | null>(null);

  const hasMore = computed(() => items.value.length < total.value);
  const totalUnread = computed(() => items.value.reduce((s, c) => s + (c.unreadCount ?? 0), 0));

  function params(p: number) {
    const q: Record<string, string> = { page: String(p), limit: String(PAGE_SIZE) };
    if (search.value.trim()) q.search = search.value.trim();
    if (unreadOnly.value) q.unread = 'true';
    return q;
  }

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await api.get('/conversations', { params: params(1) });
      items.value = data.conversations ?? [];
      total.value = data.total ?? items.value.length;
      page.value = 1;
    } catch {
      error.value = 'Không tải được danh sách hội thoại';
    } finally {
      loading.value = false;
    }
  }

  async function loadMore() {
    if (loadingMore.value || !hasMore.value) return;
    loadingMore.value = true;
    try {
      const next = page.value + 1;
      const { data } = await api.get('/conversations', { params: params(next) });
      const incoming: MConversation[] = data.conversations ?? [];
      // Chống trùng khi có tin mới đẩy conv nhảy trang giữa 2 lần fetch.
      const seen = new Set(items.value.map((c) => c.id));
      items.value.push(...incoming.filter((c) => !seen.has(c.id)));
      total.value = data.total ?? total.value;
      page.value = next;
    } catch {
      /* im lặng — cuộn thêm thất bại không nên chặn UI */
    } finally {
      loadingMore.value = false;
    }
  }

  /**
   * Tin mới từ socket → cập nhật preview + thời gian + badge, đẩy hội thoại lên đầu.
   * `activeConvId`: hội thoại đang mở → KHÔNG tăng badge chưa đọc.
   */
  function applyIncoming(
    payload: { conversationId: string; message: Record<string, unknown> },
    activeConvId: string | null,
  ) {
    const idx = items.value.findIndex((c) => c.id === payload.conversationId);
    if (idx === -1) {
      // Hội thoại chưa có trong danh sách (vd lần đầu khách nhắn) → nạp lại trang 1.
      void load();
      return;
    }
    const conv = items.value[idx];
    const msg = payload.message as { senderType?: string; content?: string; contentType?: string; sentAt?: string };
    conv.messages = [{ content: msg.content ?? '', contentType: msg.contentType ?? 'text', senderType: msg.senderType ?? 'contact' }];
    conv.lastMessageAt = msg.sentAt ?? new Date().toISOString();
    const isInbound = msg.senderType !== 'self';
    if (isInbound && payload.conversationId !== activeConvId) {
      conv.unreadCount = (conv.unreadCount ?? 0) + 1;
    }
    // Mới nhất lên đầu.
    items.value.splice(idx, 1);
    items.value.unshift(conv);
  }

  /** Đánh dấu đã đọc tại chỗ (khi mở hội thoại) — server đã tự mark-read. */
  function markRead(convId: string) {
    const conv = items.value.find((c) => c.id === convId);
    if (conv) conv.unreadCount = 0;
  }

  return {
    items, loading, loadingMore, total, search, unreadOnly, error,
    hasMore, totalUnread,
    load, loadMore, applyIncoming, markRead,
  };
}

/** Rút gọn nội dung tin cuối để hiển thị 1 dòng. */
export function previewText(conv: MConversation): string {
  const m = conv.messages?.[0];
  if (!m) return 'Chưa có tin nhắn';
  if (conv.redacted) return '🔒 Nội dung riêng tư';
  const kind = m.contentType ?? 'text';
  if (kind === 'image') return '🖼️ Hình ảnh';
  if (kind === 'video') return '🎬 Video';
  if (kind === 'sticker') return '🎴 Sticker';
  if (kind === 'voice' || kind === 'audio') return '🎤 Tin thoại';
  if (kind === 'file') return '📎 Tệp';
  const prefix = m.senderType === 'self' ? 'Bạn: ' : '';
  return prefix + (m.content || '').replace(/\s+/g, ' ').slice(0, 60);
}

/** Thời gian ngắn gọn kiểu Zalo/Messenger. */
export function shortTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return 'vừa xong';
  if (diffMin < 60) return `${diffMin} phút`;
  if (d.toDateString() === now.toDateString()) {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return 'Hôm qua';
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
}
