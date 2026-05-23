/**
 * stores/privacy.ts — Pinia store cho Phase Riêng Tư.
 *
 * State: hasPin, isUnlocked, expiresAt, activeSessions.
 * Cookie management: HttpOnly nên frontend KHÔNG đọc/ghi cookie. Status từ API.
 */
import { defineStore } from 'pinia';
import { api } from '@/api/index';

export interface PrivacyStatus {
  hasPin: boolean;
  lockedUntil: string | null;
  activeSessionCount: number;
  // Phase Privacy v2 2026-05-23: ipAddress raw cho user thấy device session của mình.
  activeSessions: Array<{
    id: string;
    expiresAt: string;
    userAgent: string | null;
    ipAddress: string | null;
    unlockedAt: string;
  }>;
}

export const usePrivacyStore = defineStore('privacy', {
  state: () => ({
    hasPin: false,
    lockedUntil: null as string | null,
    activeSessionCount: 0,
    activeSessions: [] as PrivacyStatus['activeSessions'],
    loading: false,
    lastChecked: 0,
  }),
  getters: {
    isUnlocked: (state) => state.activeSessionCount > 0,
    remainingMinutes: (state) => {
      if (state.activeSessions.length === 0) return 0;
      const exp = new Date(state.activeSessions[0].expiresAt).getTime();
      return Math.max(0, Math.floor((exp - Date.now()) / 60000));
    },
  },
  actions: {
    async fetchStatus(force = false) {
      // Cache 30s
      if (!force && Date.now() - this.lastChecked < 30000) return;
      this.loading = true;
      try {
        const { data } = await api.get<PrivacyStatus>('/privacy/status');
        this.hasPin = data.hasPin;
        this.lockedUntil = data.lockedUntil;
        this.activeSessionCount = data.activeSessionCount;
        this.activeSessions = data.activeSessions;
        this.lastChecked = Date.now();
      } finally {
        this.loading = false;
      }
    },
    async setupPin(currentPassword: string, pin: string) {
      await api.post('/privacy/setup-pin', { currentPassword, pin });
      await this.fetchStatus(true);
    },
    async unlock(pin: string, durationMinutes: 5 | 15 | 480 | 720) {
      // HttpOnly cookie set by server, frontend chỉ track expiresAt
      const { data } = await api.post<{ ok: boolean; expiresAt: string }>('/privacy/unlock', {
        pin,
        durationMinutes,
      });
      await this.fetchStatus(true);
      return data;
    },
    async lock() {
      try {
        await api.post('/privacy/lock');
      } catch { /* best effort */ }
      await this.fetchStatus(true);
    },
    async flipNickPrivacyMode(zaloAccountId: string, mode: 'main' | 'sub') {
      await api.patch(`/zalo-accounts/${zaloAccountId}/privacy-mode`, { mode });
    },
    // Phase Privacy v2 2026-05-23 — đổi PIN bằng PIN cũ (KHÔNG cần password).
    async changePin(oldPin: string, newPin: string) {
      await api.post('/privacy/change-pin', { oldPin, newPin });
      await this.fetchStatus(true);
    },
  },
});
