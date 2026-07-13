// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyen Tien Loc
/**
 * Lightweight mobile conversation list for the PWA shell.
 * Calls GET /conversations directly because desktop useChat carries extra filters and no mobile paging.
 */
import { ref, computed } from 'vue';
import { api } from '@/api/index';
import type { ConversationState } from '@/composables/use-conversation-state';

const PAGE_SIZE = 30;

export interface MConversation {
  id: string;
  unreadCount?: number;
  lastMessageAt?: string | null;
  threadType?: string;
  groupName?: string | null;
  groupAvatarUrl?: string | null;
  groupMembersCount?: number | null;
  groupMemberAvatars?: Array<{ uid: string; name?: string | null; avatarUrl: string }>;
  contact?: { id?: string; fullName?: string | null; crmName?: string | null; avatarUrl?: string | null } | null;
  zaloAccount?: { id?: string; displayName?: string | null } | null;
  messages?: Array<{
    content?: string | null;
    contentType?: string | null;
    senderType?: string | null;
    /** Tin đã thu hồi — preview hiện nhãn "đã thu hồi" thay vì nội dung gốc (như desktop). */
    isDeleted?: boolean | null;
  }>;
  userState?: ConversationState;
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
  const unrepliedOnly = ref(false);
  const tagFilter = ref('');
  const error = ref<string | null>(null);

  const hasMore = computed(() => items.value.length < total.value);
  const isUnread = (c: MConversation) => (c.unreadCount ?? 0) > 0 || c.userState?.isManualUnread === true;
  const displayItems = computed(() => {
    const pinned: MConversation[] = [];
    const rest: MConversation[] = [];
    const source = unreadOnly.value ? items.value.filter(isUnread) : items.value;
    for (const c of source) (c.userState?.isPinned ? pinned : rest).push(c);
    pinned.sort((a, b) => {
      const ta = a.userState?.pinnedAt ? Date.parse(a.userState.pinnedAt) : 0;
      const tb = b.userState?.pinnedAt ? Date.parse(b.userState.pinnedAt) : 0;
      return tb - ta;
    });
    return [...pinned, ...rest];
  });
  const totalUnread = computed(() => items.value.reduce((s, c) => s + (isUnread(c) ? Math.max(c.unreadCount ?? 0, 1) : 0), 0));

  function params(p: number) {
    const q: Record<string, string> = { page: String(p), limit: String(PAGE_SIZE) };
    if (search.value.trim()) q.search = search.value.trim();
    if (unreadOnly.value) q.unread = 'true';
    if (unrepliedOnly.value) q.unreplied = 'true';
    if (tagFilter.value) q.tags = tagFilter.value;
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
      const seen = new Set(items.value.map((c) => c.id));
      items.value.push(...incoming.filter((c) => !seen.has(c.id)));
      total.value = data.total ?? total.value;
      page.value = next;
    } catch {
      // Loading the next page should not block the current list.
    } finally {
      loadingMore.value = false;
    }
  }

  function applyIncoming(
    payload: { conversationId: string; message: Record<string, unknown> },
    activeConvId: string | null,
  ) {
    const idx = items.value.findIndex((c) => c.id === payload.conversationId);
    if (idx === -1) {
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
    items.value.splice(idx, 1);
    items.value.unshift(conv);
  }

  function applyState(convId: string, state: ConversationState) {
    const conv = items.value.find((c) => c.id === convId);
    if (conv) conv.userState = state;
  }

  function markRead(convId: string) {
    const conv = items.value.find((c) => c.id === convId);
    if (!conv) return;
    conv.unreadCount = 0;
    if (conv.userState?.isManualUnread) {
      conv.userState = { ...conv.userState, isManualUnread: false, manualUnreadAt: null };
      void setManualUnread(convId, false).catch(() => {});
    }
  }

  async function patchState(convId: string, patch: { isPinned?: boolean; isManualUnread?: boolean }) {
    const { data } = await api.patch<ConversationState>(`/conversations/${convId}/state`, patch);
    applyState(convId, data);
    return data;
  }

  async function setPinned(convId: string, pinned: boolean) {
    const conv = items.value.find((c) => c.id === convId);
    const prev = conv?.userState;
    if (conv) {
      conv.userState = {
        conversationId: convId,
        isPinned: pinned,
        pinnedAt: pinned ? new Date().toISOString() : null,
        isManualUnread: prev?.isManualUnread ?? false,
        manualUnreadAt: prev?.manualUnreadAt ?? null,
        flags: prev?.flags ?? {},
      };
    }
    try { return await patchState(convId, { isPinned: pinned }); }
    catch (err) { if (conv) conv.userState = prev; throw err; }
  }

  async function setManualUnread(convId: string, unread: boolean) {
    const conv = items.value.find((c) => c.id === convId);
    const prev = conv?.userState;
    if (conv) {
      conv.userState = {
        conversationId: convId,
        isPinned: prev?.isPinned ?? false,
        pinnedAt: prev?.pinnedAt ?? null,
        isManualUnread: unread,
        manualUnreadAt: unread ? new Date().toISOString() : null,
        flags: prev?.flags ?? {},
      };
    }
    try { return await patchState(convId, { isManualUnread: unread }); }
    catch (err) { if (conv) conv.userState = prev; throw err; }
  }

  return {
    items, displayItems, loading, loadingMore, total, search, unreadOnly, unrepliedOnly, tagFilter, error,
    hasMore, totalUnread, isUnread,
    load, loadMore, applyIncoming, markRead, setPinned, setManualUnread,
  };
}

/** Tin nhắn cuối có phải tin ĐÃ THU HỒI không (để làm nhạt preview). */
export function isRecalledPreview(conv: MConversation): boolean {
  return conv.messages?.[0]?.isDeleted === true;
}

export function previewText(conv: MConversation): string {
  const m = conv.messages?.[0];
  if (!m) return 'Chưa có tin nhắn';
  if (conv.redacted) return '🔒 Nội dung riêng tư';
  // Tin thu hồi — hiện NHÃN, không hiện nội dung gốc (đồng bộ với bản desktop).
  if (m.isDeleted) return '🔂 Tin nhắn đã thu hồi';
  const kind = m.contentType ?? 'text';
  if (kind === 'image') return '🖼️ Hình ảnh';
  if (kind === 'video') return '🎬 Video';
  if (kind === 'sticker') return '🎴 Sticker';
  if (kind === 'voice' || kind === 'audio') return '🎤 Tin thoại';
  if (kind === 'file') return '📎 Tệp';
  const prefix = m.senderType === 'self' ? 'Bạn: ' : '';
  return prefix + (m.content || '').replace(/\s+/g, ' ').slice(0, 60);
}

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
