// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { ref } from 'vue';
import type { Socket } from 'socket.io-client';
import { api } from '@/api/index';
import { createAppSocket } from '@/api/socket';
import { router } from '@/router';
import { useToast } from '@/composables/use-toast';
import {
  accountAlertFingerprint,
  accountAlertMessage,
  isZaloAccountOut,
  type AccountAlertNotification,
} from './zalo-account-alert-rules';

const notifications = ref<AccountAlertNotification[]>([]);
const POLL_MS = 60_000;
const OUT_CONFIRM_DELAY_MS = 8_000;
const SEEN_PREFIX = 'zalocrm:zalo-out-alert:';

let socket: Socket | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let delayedRefresh: ReturnType<typeof setTimeout> | null = null;
let started = false;
let requestInFlight: Promise<void> | null = null;

function seenKey(accountId: string): string {
  return `${SEEN_PREFIX}${accountId}`;
}

function showNativeAlert(notification: AccountAlertNotification) {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
  if (!document.hidden || Notification.permission !== 'granted') return;
  const accountId = notification.accountId || notification.id;
  try {
    const native = new Notification(notification.title, {
      body: notification.detail,
      icon: '/pwa-192x192.png',
      tag: `zalo-out-${accountId}`,
      requireInteraction: true,
    });
    native.onclick = () => {
      window.focus();
      void router.push(notification.actionUrl || '/settings/channels/zalo');
      native.close();
    };
  } catch { /* Trình duyệt chặn native notification — toast trong app vẫn hoạt động. */ }
}

function announce(notification: AccountAlertNotification) {
  if (!notification.accountId || notification.shouldAlert === false) return;
  const fingerprint = accountAlertFingerprint(notification);
  const key = seenKey(notification.accountId);
  if (localStorage.getItem(key) === fingerprint) return;
  localStorage.setItem(key, fingerprint);

  const toast = useToast();
  toast.pushWithAction(
    accountAlertMessage(notification),
    {
      label: notification.actionLabel || 'Kết nối lại',
      handler: async () => {
        await router.push(notification.actionUrl || '/settings/channels/zalo');
      },
    },
    'error',
    12_000,
  );
  showNativeAlert(notification);
}

async function loadNotifications(announceNew = true): Promise<void> {
  if (requestInFlight) return requestInFlight;
  requestInFlight = (async () => {
    try {
      const response = await api.get<{ notifications?: AccountAlertNotification[] }>('/notifications');
      const next = Array.isArray(response.data.notifications) ? response.data.notifications : [];
      notifications.value = next;
      if (announceNew) next.filter(isZaloAccountOut).forEach(announce);
    } catch {
      // Chuông thông báo không được làm hỏng shell khi mạng chập chờn.
    } finally {
      requestInFlight = null;
    }
  })();
  return requestInFlight;
}

function scheduleRefresh(delayMs: number) {
  if (delayedRefresh) clearTimeout(delayedRefresh);
  delayedRefresh = setTimeout(() => {
    delayedRefresh = null;
    void loadNotifications(true);
  }, delayMs);
}

function onDisconnected() {
  // Event "early" có thể là một nhịp flap rồi tự hồi. Chờ trạng thái DB/pool ổn định
  // trước khi báo để tránh nick vừa chớp offline đã làm cả đội nhận cảnh báo giả.
  scheduleRefresh(OUT_CONFIRM_DELAY_MS);
}

function onReconnectFailed() {
  scheduleRefresh(250);
}

function onConnected(payload: { accountId?: string }) {
  if (payload?.accountId) localStorage.removeItem(seenKey(payload.accountId));
  scheduleRefresh(250);
}

function onVisibilityChange() {
  if (!document.hidden) void loadNotifications(true);
}

export function useZaloAccountAlerts() {
  function start() {
    if (started) return;
    started = true;
    socket = createAppSocket();
    socket.on('zalo:disconnected', onDisconnected);
    socket.on('zalo:reconnect-failed', onReconnectFailed);
    socket.on('zalo:connected', onConnected);
    document.addEventListener('visibilitychange', onVisibilityChange);
    pollTimer = setInterval(() => {
      if (!document.hidden) void loadNotifications(true);
    }, POLL_MS);
    void loadNotifications(true);
  }

  function stop() {
    socket?.off('zalo:disconnected', onDisconnected);
    socket?.off('zalo:reconnect-failed', onReconnectFailed);
    socket?.off('zalo:connected', onConnected);
    socket?.disconnect();
    socket = null;
    if (pollTimer) clearInterval(pollTimer);
    if (delayedRefresh) clearTimeout(delayedRefresh);
    pollTimer = null;
    delayedRefresh = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    started = false;
  }

  return {
    notifications,
    start,
    stop,
    refresh: (announceNew = false) => loadNotifications(announceNew),
  };
}
