// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-conversation-state.ts — Conversation State System per-USER (2026-07-10).
 *
 * Trạng thái hội thoại RIÊNG của chính user: ghim cá nhân, đánh dấu chưa đọc thủ công, và
 * (mở rộng) snooze/reminder/star/follow-up/VIP/priority/internal. Khác:
 *   • Ghim Zalo (chat:pinned) — cấp nick, đồng bộ app Zalo, chung mọi người.
 *   • unreadCount — chưa đọc THẬT; manual unread KHÔNG đụng vào nó.
 *
 * Backend là nguồn sự thật. FE chỉ hiển thị + gọi PATCH generic. Realtime nghe
 * 'conversation:state' (chỉ tới room user của mình).
 */
import { api } from '@/api/index';

export interface ConversationState {
  conversationId: string;
  isPinned: boolean;
  pinnedAt: string | null;
  isManualUnread: boolean;
  manualUnreadAt: string | null;
  /** Cửa mở rộng: state tương lai chưa có cột typed (snooze/reminder/star/…). */
  flags: Record<string, unknown>;
}

/** State trống (chưa từng đặt) — mọi cờ tắt. */
export function emptyConversationState(conversationId: string): ConversationState {
  return {
    conversationId,
    isPinned: false,
    pinnedAt: null,
    isManualUnread: false,
    manualUnreadAt: null,
    flags: {},
  };
}

/** Body PATCH — chỉ gửi field muốn đổi. */
export interface ConversationStatePatch {
  isPinned?: boolean;
  isManualUnread?: boolean;
  flags?: Record<string, unknown>;
}

const stateListeners = new Set<(state: ConversationState) => void>();

export function onConversationStateChange(listener: (state: ConversationState) => void): () => void {
  stateListeners.add(listener);
  return () => { stateListeners.delete(listener); };
}

export async function fetchConversationState(conversationId: string): Promise<ConversationState> {
  const res = await api.get<ConversationState>(`/conversations/${conversationId}/state`);
  return res.data;
}

/** Cập nhật generic — dùng cho mọi trạng thái (hiện tại + mở rộng). */
export async function patchConversationState(
  conversationId: string,
  patch: ConversationStatePatch,
): Promise<ConversationState> {
  const res = await api.patch<ConversationState>(`/conversations/${conversationId}/state`, patch);
  for (const listener of stateListeners) listener(res.data);
  return res.data;
}

// ── Tiện ích cho 2 trạng thái làm ngay (mỏng, gọi lại PATCH) ────────────────────
export const setPersonalPin = (id: string, pinned: boolean) =>
  patchConversationState(id, { isPinned: pinned });

export const setManualUnread = (id: string, unread: boolean) =>
  patchConversationState(id, { isManualUnread: unread });

export interface NotificationMuteState {
  mode: 'until' | 'forever';
  until: string | null;
  mutedAt: string;
}

export function notificationMuteOf(state: Pick<ConversationState, 'flags'> | null | undefined, nowMs = Date.now()): NotificationMuteState | null {
  const value = state?.flags?.notificationMute;
  if (!value || typeof value !== 'object') return null;
  const mute = value as Partial<NotificationMuteState>;
  if (mute.mode === 'forever') return { mode: 'forever', until: null, mutedAt: String(mute.mutedAt || '') };
  if (mute.mode !== 'until' || typeof mute.until !== 'string' || Number.isNaN(Date.parse(mute.until)) || Date.parse(mute.until) <= nowMs) return null;
  return { mode: 'until', until: mute.until, mutedAt: String(mute.mutedAt || '') };
}

export function isConversationNotificationMuted(state: Pick<ConversationState, 'flags'> | null | undefined, nowMs = Date.now()): boolean {
  return notificationMuteOf(state, nowMs) !== null;
}

export function setConversationNotificationMute(id: string, until: Date | null): Promise<ConversationState> {
  // Expiry is evaluated when reading the state, never by a delayed write that
  // could overwrite a newer setting from another tab or device.
  return patchConversationState(id, {
    flags: {
      notificationMute: {
        mode: until ? 'until' : 'forever',
        until: until?.toISOString() ?? null,
        mutedAt: new Date().toISOString(),
      },
    },
  });
}

export const clearConversationNotificationMute = (id: string) =>
  patchConversationState(id, { flags: { notificationMute: null } });
