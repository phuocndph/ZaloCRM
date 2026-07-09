// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/// <reference lib="webworker" />
/**
 * sw.ts — Service Worker cho PWA Mobile (chiến lược injectManifest).
 *
 * Vì sao injectManifest chứ không generateSW: generateSW không cho phép tự viết
 * handler 'push' / 'notificationclick' — mà đó là lõi của Web Push.
 *
 * Trách nhiệm:
 *   1. Precache asset build (self.__WB_MANIFEST do vite-plugin-pwa chèn).
 *   2. Điều hướng offline → trả /offline.html.
 *   3. push        → hiện notification (title = tên khách, body đã che privacy ở server).
 *   4. notificationclick → focus tab đang mở đúng hội thoại, nếu không thì mở /m/c/:id.
 *   5. SELF-DESTRUCT: gỡ PWA chỉ cần đặt SW_KILL_SWITCH = true rồi deploy → SW tự
 *      unregister + xoá cache (rollback không cần user thao tác gì).
 */
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

// Trong module, `declare const self` che biến global `self` của lib DOM (không xung đột).
// __WB_MANIFEST do vite-plugin-pwa chèn lúc build.
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// ── Kill switch: bật true + deploy → mọi SW đã cài tự gỡ. Xem mục Rollback. ──
const SW_KILL_SWITCH = false;

const OFFLINE_URL = '/offline.html';

if (SW_KILL_SWITCH) {
  self.addEventListener('install', () => { void self.skipWaiting(); });
  self.addEventListener('activate', async () => {
    await self.registration.unregister();
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) (c as WindowClient).navigate((c as WindowClient).url);
  });
} else {
  cleanupOutdatedCaches();
  precacheAndRoute(self.__WB_MANIFEST);

  self.addEventListener('install', () => { void self.skipWaiting(); });
  self.addEventListener('activate', (event: ExtendableEvent) => {
    event.waitUntil(self.clients.claim());
  });

  // Điều hướng khi offline → trang offline (không để trắng/crash).
  self.addEventListener('fetch', (event: FetchEvent) => {
    if (event.request.mode !== 'navigate') return;
    event.respondWith(
      (async () => {
        try {
          return await fetch(event.request);
        } catch {
          const cached = await caches.match(OFFLINE_URL);
          return cached ?? new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
      })(),
    );
  });
}

// ── Web Push ───────────────────────────────────────────────────────────────
interface PushPayload {
  title?: string;
  body?: string;
  icon?: string | null;
  conversationId?: string;
  sentAt?: string;
}

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;
  let p: PushPayload = {};
  try { p = event.data.json() as PushPayload; } catch { p = { body: event.data.text() }; }

  const title = p.title || 'Tin nhắn mới';
  const convId = p.conversationId ?? '';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: p.body || '',
      icon: p.icon || '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      // tag theo hội thoại → tin mới cùng 1 khách thay thế noti cũ, không spam.
      tag: convId || 'zalocrm',
      renotify: !!convId,
      timestamp: p.sentAt ? Date.parse(p.sentAt) : Date.now(),
      data: { conversationId: convId, url: convId ? `/m/c/${convId}` : '/m' },
    } as NotificationOptions),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url: string = event.notification.data?.url ?? '/m';
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Đang mở app rồi → focus + điều hướng, không mở tab mới.
      for (const c of clients) {
        const wc = c as WindowClient;
        if (wc.url.includes(self.location.origin)) {
          await wc.focus();
          if ('navigate' in wc) await wc.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
