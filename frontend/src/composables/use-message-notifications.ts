// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-message-notifications.ts — Thông báo tin nhắn NỔI cho DESKTOP (giống Zalo).
 *
 * Hai lớp:
 *   1. Thẻ nổi trong app (góc dưới-phải) — luôn dùng được khi đang mở CRM, không cần
 *      quyền trình duyệt. Bấm thẻ → mở đúng hội thoại.
 *   2. Native Notification (OS) — chỉ khi tab ở NỀN (document.hidden) và user đã cấp quyền.
 *
 * Vì sao socket RIÊNG (không dùng useChat): trên desktop socket của useChat chỉ sống khi
 * ChatView mở. Muốn thông báo chạy ở MỌI trang (dashboard, khách hàng…) thì cần 1 socket
 * sống ở tầng layout. Dùng chung createAppSocket nên vẫn 1 chỗ auth/refresh token.
 *
 * Riêng tư: server đã redact trước khi emit (emit-chat.ts). Tin bị che → hiện chung
 * "Bạn có tin nhắn mới", không lộ nội dung.
 */
import { ref } from 'vue';
import type { Socket } from 'socket.io-client';
import { createAppSocket } from '@/api/socket';
import { useChat } from '@/composables/use-chat';
import { router } from '@/router';

export interface NotifCard {
  id: string;
  convId: string;
  accountId: string | null;
  name: string;
  preview: string;
  avatarUrl: string | null;
  at: number;
}

const ENABLED_KEY = 'desktop.notify.enabled';
const SOUND_KEY = 'desktop.notify.sound';
const MAX_CARDS = 4;
const CARD_TTL_MS = 6500;

// ── State singleton (chia sẻ mọi nơi) ──
const enabled = ref(localStorage.getItem(ENABLED_KEY) !== 'false');
const soundEnabled = ref(localStorage.getItem(SOUND_KEY) !== 'false');
const nativeSupported =
  typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext;
const permission = ref<NotificationPermission>(
  nativeSupported ? Notification.permission : 'denied',
);
const cards = ref<NotifCard[]>([]);

let socket: Socket | null = null;
let started = false;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let audioCtx: AudioContext | null = null;

/** Nhãn preview theo loại tin (khi không phải text). */
function previewFor(message: any): string {
  if (message?.redacted) return 'Bạn có tin nhắn mới';
  const type = message?.contentType;
  const raw = typeof message?.content === 'string' ? message.content : '';
  if (type && type !== 'text') {
    const label: Record<string, string> = {
      image: '🖼 Hình ảnh', video: '🎬 Video', file: '📎 Tệp đính kèm',
      voice: '🎤 Tin nhắn thoại', audio: '🎤 Tin nhắn thoại', sticker: '😊 Sticker',
      gif: '🎞 GIF', link: '🔗 Liên kết', location: '📍 Vị trí', contact_card: '👤 Danh thiếp',
    };
    return label[type] || 'Tin nhắn mới';
  }
  const compact = raw.replace(/\s+/g, ' ').trim();
  if (!compact) return 'Tin nhắn mới';
  return compact.length > 90 ? `${compact.slice(0, 90)}…` : compact;
}

function beep() {
  if (!soundEnabled.value) return;
  try {
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    audioCtx ??= new Ctx();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = 'sine'; o.frequency.value = 880;
    const t = audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.start(t); o.stop(t + 0.3);
  } catch { /* audio bị chặn tới khi có tương tác — bỏ qua */ }
}

function dismiss(id: string) {
  cards.value = cards.value.filter((c) => c.id !== id);
  const t = timers.get(id);
  if (t) { clearTimeout(t); timers.delete(id); }
}

function pushCard(card: NotifCard) {
  // Gộp theo hội thoại: tin mới cùng 1 khách → thay thẻ cũ (cập nhật nội dung, đưa lên đầu,
  // reset đồng hồ tự ẩn) thay vì chồng nhiều thẻ gây spam — giống Zalo.
  if (card.convId) {
    const old = cards.value.find((c) => c.convId === card.convId);
    if (old) dismiss(old.id);
  }
  cards.value = [card, ...cards.value].slice(0, MAX_CARDS);
  const t = setTimeout(() => dismiss(card.id), CARD_TTL_MS);
  timers.set(card.id, t);
}

function openCard(card: NotifCard) {
  dismiss(card.id);
  window.focus();
  void router.push({ name: 'Chat', params: { convId: card.convId } });
}

function showNative(card: NotifCard) {
  if (!nativeSupported || permission.value !== 'granted') return;
  if (!document.hidden) return; // đang xem app → chỉ cần thẻ nổi
  try {
    const n = new Notification(card.name, {
      body: card.preview,
      icon: card.avatarUrl || '/pwa-192x192.png',
      tag: `conv-${card.convId}`, // gộp theo hội thoại, không spam
    });
    n.onclick = () => { window.focus(); void router.push({ name: 'Chat', params: { convId: card.convId } }); n.close(); };
  } catch { /* noop */ }
}

function onSocketMessage(payload: {
  conversationId?: string; accountId?: string; message?: any;
}) {
  if (!enabled.value) return;
  const message = payload?.message;
  const convId = payload?.conversationId;
  if (!message || !convId) return;
  // Chỉ tin ĐẾN (khách gửi) — bỏ tin mình gửi đi.
  if (message.senderType === 'self') return;

  // Đang MỞ đúng hội thoại đó (ở route /chat) và cửa sổ focus → không làm phiền (giống Zalo).
  // Phải kiểm tra route: selectedConvId là state singleton, GIỮ lại hội thoại mở gần nhất — nếu
  // chỉ so id thì rời sang trang khác vẫn bị bỏ qua nhầm cho đúng hội thoại đó.
  const onChatRoute = router.currentRoute.value.path.startsWith('/chat');
  const chat = useChat();
  if (!document.hidden && onChatRoute && chat.selectedConvId?.value === convId) return;

  const card: NotifCard = {
    id: String(message.id ?? `${convId}-${Date.now()}`),
    convId,
    accountId: payload.accountId ?? null,
    name: (message.senderName && String(message.senderName).trim()) || 'Tin nhắn mới',
    preview: previewFor(message),
    avatarUrl: (typeof message.avatarUrl === 'string' && message.avatarUrl) || null,
    at: Date.now(),
  };
  pushCard(card);
  beep();
  showNative(card);
}

export function useMessageNotifications() {
  /** Khởi động 1 lần ở tầng layout (DefaultLayout). Socket sống toàn app. */
  function start() {
    if (started) return;
    started = true;
    socket = createAppSocket();
    socket.on('chat:message', onSocketMessage);
  }

  function stop() {
    socket?.off('chat:message', onSocketMessage);
    socket?.disconnect();
    socket = null;
    started = false;
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    cards.value = [];
  }

  /** Bật: xin quyền native (nếu hỗ trợ) + bật cờ. Thẻ nổi vẫn chạy dù không có quyền OS. */
  async function enable(): Promise<{ ok: boolean; error?: string }> {
    enabled.value = true;
    localStorage.setItem(ENABLED_KEY, 'true');
    if (nativeSupported && permission.value !== 'granted') {
      try { permission.value = await Notification.requestPermission(); } catch { /* noop */ }
    }
    if (nativeSupported && permission.value === 'denied') {
      return { ok: true, error: 'Đã bật thẻ nổi trong app. Thông báo ngoài màn hình bị trình duyệt chặn — mở lại trong Cài đặt trình duyệt.' };
    }
    return { ok: true };
  }

  function disable() {
    enabled.value = false;
    localStorage.setItem(ENABLED_KEY, 'false');
    cards.value = [];
  }

  function setSound(v: boolean) {
    soundEnabled.value = v;
    localStorage.setItem(SOUND_KEY, String(v));
  }

  return {
    enabled, soundEnabled, permission, nativeSupported, cards,
    start, stop, enable, disable, setSound, dismiss, openCard,
  };
}
