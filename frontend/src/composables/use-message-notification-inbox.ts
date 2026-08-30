// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { ref } from 'vue';
import { api } from '@/api/index';

export interface MessageNotificationItem {
  id: string;
  conversationId: string;
  messageId: string;
  zaloAccountId: string;
  title: string;
  context: string;
  preview: string;
  avatarUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

const notifications = ref<MessageNotificationItem[]>([]);
const unreadCount = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
let refreshPromise: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleStarted = false;

async function refresh(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    loading.value = notifications.value.length === 0;
    error.value = null;
    try {
      const { data } = await api.get('/message-notifications', { params: { limit: 100 } });
      notifications.value = Array.isArray(data?.notifications) ? data.notifications : [];
      unreadCount.value = Math.max(0, Number(data?.unreadCount ?? 0));
    } catch {
      error.value = 'Không tải được thông báo. Kiểm tra kết nối rồi thử lại.';
    } finally {
      loading.value = false;
    }
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function scheduleRefresh(delay = 450) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refresh();
  }, delay);
}

async function markRead(id: string): Promise<void> {
  const item = notifications.value.find((entry) => entry.id === id);
  const changed = !!item && !item.readAt;
  if (changed) {
    item.readAt = new Date().toISOString();
    unreadCount.value = Math.max(0, unreadCount.value - 1);
  }
  try {
    await api.patch(`/message-notifications/${encodeURIComponent(id)}/read`);
  } catch {
    if (changed) void refresh();
  }
}

async function markConversationRead(conversationId: string): Promise<void> {
  if (!conversationId) return;
  const now = new Date().toISOString();
  let localChanged = 0;
  for (const item of notifications.value) {
    if (item.conversationId === conversationId && !item.readAt) {
      item.readAt = now;
      localChanged += 1;
    }
  }
  unreadCount.value = Math.max(0, unreadCount.value - localChanged);
  try {
    const { data } = await api.post('/message-notifications/read-conversation', { conversationId });
    const serverChanged = Math.max(0, Number(data?.updated ?? 0));
    unreadCount.value = Math.max(0, unreadCount.value - Math.max(0, serverChanged - localChanged));
  } catch {
    if (localChanged) void refresh();
  }
}

async function markAllRead(): Promise<void> {
  const now = new Date().toISOString();
  notifications.value.forEach((item) => { item.readAt ??= now; });
  unreadCount.value = 0;
  try {
    await api.post('/message-notifications/read-all');
  } catch {
    void refresh();
  }
}

function onResume() {
  if (document.visibilityState === 'visible') void refresh();
}

function startAutoRefresh() {
  if (lifecycleStarted || typeof window === 'undefined') return;
  lifecycleStarted = true;
  window.addEventListener('online', onResume);
  window.addEventListener('pageshow', onResume);
  document.addEventListener('visibilitychange', onResume);
  void refresh();
}

function stopAutoRefresh() {
  if (!lifecycleStarted || typeof window === 'undefined') return;
  lifecycleStarted = false;
  window.removeEventListener('online', onResume);
  window.removeEventListener('pageshow', onResume);
  document.removeEventListener('visibilitychange', onResume);
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  notifications.value = [];
  unreadCount.value = 0;
  error.value = null;
}

export function useMessageNotificationInbox() {
  return {
    notifications,
    unreadCount,
    loading,
    error,
    refresh,
    scheduleRefresh,
    markRead,
    markConversationRead,
    markAllRead,
    startAutoRefresh,
    stopAutoRefresh,
  };
}
