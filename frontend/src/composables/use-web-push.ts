// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-web-push.ts — đăng ký/huỷ Web Push (VAPID) từ trình duyệt.
 *
 * Ràng buộc thực tế (không né được):
 *   - Cần secure context: https hoặc localhost. Nơi khác → isSupported = false.
 *   - iOS: chỉ chạy khi PWA đã "Thêm vào màn hình chính" (iOS 16.4+). Mở trong tab
 *     Safari thì `PushManager` không tồn tại → ta báo rõ cho user thay vì im lặng.
 *
 * VAPID public key lấy từ server (không hardcode). Private key KHÔNG BAO GIỜ rời server.
 */
import { ref } from 'vue';
import { api } from '@/api/index';

const SOUND_KEY = 'mobile.notification.sound';

/** base64url (VAPID public key) → Uint8Array cho applicationServerKey. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Chuỗi mô tả máy để user nhận ra thiết bị trong danh sách (không nhạy cảm). */
function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/i.test(ua)) return 'iPhone/iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Macintosh/i.test(ua)) return 'Mac';
  return 'Thiết bị khác';
}

export function useWebPush() {
  const supported = ref(
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    window.isSecureContext,
  );
  const enabled = ref(false);
  const busy = ref(false);
  const permission = ref<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  );
  const soundEnabled = ref(localStorage.getItem(SOUND_KEY) !== 'false');

  function setSound(v: boolean) {
    soundEnabled.value = v;
    localStorage.setItem(SOUND_KEY, String(v));
  }

  async function getSubscription(): Promise<PushSubscription | null> {
    if (!supported.value) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  /** Đồng bộ trạng thái nút bật/tắt với thực tế trình duyệt. */
  async function refresh() {
    if (!supported.value) { enabled.value = false; return; }
    permission.value = Notification.permission;
    enabled.value = !!(await getSubscription()) && permission.value === 'granted';
  }

  async function enable(): Promise<{ ok: boolean; error?: string }> {
    if (!supported.value) {
      return { ok: false, error: 'Thiết bị/trình duyệt này chưa hỗ trợ. Trên iPhone cần "Thêm vào màn hình chính" trước.' };
    }
    busy.value = true;
    try {
      permission.value = await Notification.requestPermission();
      if (permission.value !== 'granted') {
        return { ok: false, error: 'Bạn đã từ chối quyền thông báo. Bật lại trong Cài đặt trình duyệt.' };
      }
      const { data } = await api.get('/push/vapid-public-key');
      const key: string | undefined = data?.publicKey;
      if (!key) return { ok: false, error: 'Máy chủ chưa cấu hình VAPID key.' };

      const reg = await navigator.serviceWorker.ready;
      // Đã có subscription cũ với key khác → huỷ trước, tránh gửi thất bại về sau.
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe().catch(() => {});

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      await api.post('/push/subscriptions', {
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
        userAgent: navigator.userAgent,
        deviceName: deviceName(),
      });
      enabled.value = true;
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.response?.data?.error || 'Không bật được thông báo' };
    } finally {
      busy.value = false;
    }
  }

  async function disable(): Promise<void> {
    busy.value = true;
    try {
      const sub = await getSubscription();
      if (sub) {
        await api.delete('/push/subscriptions', { data: { endpoint: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      enabled.value = false;
    } finally {
      busy.value = false;
    }
  }

  return { supported, enabled, busy, permission, soundEnabled, setSound, refresh, enable, disable };
}
