// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * use-outreach.ts — API + realtime cho Outreach Campaign (🟢 Community).
 */
import { ref, onMounted, onUnmounted } from 'vue';
import { type Socket } from 'socket.io-client';
import { createAppSocket } from '@/api/socket';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api/index';

export interface OutreachTemplate {
  id?: string;
  title?: string | null;
  content: string;
  weight: number;
  imageAssetIds: string[];
  isActive?: boolean;
}

export interface OutreachCampaign {
  id: string;
  name: string;
  description?: string | null;
  customerListId: string;
  zaloAccountId: string;
  enableAutoAdd: boolean;
  addFriendMessage?: string | null;
  addDelayMinMs: number; addDelayMaxMs: number; maxAddPerDay: number;
  enableAutoMessage: boolean;
  waitAfterAddMinMs: number; waitAfterAddMaxMs: number;
  msgDelayMinMs: number; msgDelayMaxMs: number; maxMsgPerDay: number;
  filterRequireTags?: string[];
  filterExcludeTags?: string[];
  filterSkipChattedDays?: number | null;
  filterFriendRelation?: 'any' | 'friend_only' | 'non_friend_only';
  state: string;
  runCount: number;
  totalTarget: number; totalAdded: number; totalAddFailed: number;
  totalMsgSent: number; totalMsgFailed: number; totalSkipped: number;
  createdAt: string;
  templates?: OutreachTemplate[];
}

export interface OutreachRun {
  id: string; runNumber: number; state: 'running' | 'completed' | 'cancelled';
  action: 'start' | 'restart'; startedByName: string | null;
  startedAt: string; completedAt: string | null;
}

export interface OutreachLog {
  id: string; phone: string; actionType: string; status: string;
  resultData?: any; errorMessage?: string | null; durationMs?: number | null;
  executedAt?: string | null; createdAt: string;
}

export interface ImageAsset {
  id: string; name: string; thumbnailUrl: string | null;
  sizeBytes: number | null; createdAt: string | null;
}

export interface ProgressPayload {
  campaignId: string; state: string;
  totalTarget: number; totalAdded: number; totalAddFailed: number;
  totalMsgSent: number; totalMsgFailed: number; totalSkipped: number;
}

export interface OutreachPhone {
  id: string; entryId: string; phone: string;
  overallStatus: 'waiting' | 'processing' | 'success' | 'skipped';
  friendStatus: 'none' | 'success' | 'already_friend' | 'waiting' | 'failed';
  messageStatus: 'none' | 'sent' | 'waiting' | 'failed';
  note: string | null; updatedAt: string;
}
export interface PhoneSummary { total: number; success: number; waiting: number; processing: number; skipped: number }

export interface AudiencePreviewItem {
  name: string | null; phone: string; tags: string[]; eligible: boolean; reason: string | null;
}
export interface AudiencePreview {
  total: number; eligible: number; skipped: number; items: AudiencePreviewItem[];
}
export interface AudienceFilterPayload {
  customerListId: string; zaloAccountId: string;
  requireTags?: string[]; excludeTags?: string[];
  skipChattedDays?: number | null; friendRelation?: string;
  search?: string; limit?: number;
}
export interface PhonePayload {
  campaignId: string; entryId: string; phone: string;
  overallStatus: OutreachPhone['overallStatus'];
  friendStatus: OutreachPhone['friendStatus'];
  messageStatus: OutreachPhone['messageStatus'];
  note: string | null; updatedAt: string;
}

export function useOutreach() {
  const campaigns = ref<OutreachCampaign[]>([]);
  const loading = ref(false);

  async function fetchCampaigns() {
    loading.value = true;
    try {
      const { data } = await api.get('/outreach/campaigns');
      campaigns.value = data?.campaigns ?? [];
    } finally { loading.value = false; }
  }

  async function getCampaign(id: string): Promise<OutreachCampaign | null> {
    try { const { data } = await api.get(`/outreach/campaigns/${id}`); return data?.campaign ?? null; }
    catch { return null; }
  }

  async function createCampaign(payload: Partial<OutreachCampaign> & { templates?: OutreachTemplate[] }) {
    const { data } = await api.post('/outreach/campaigns', payload);
    return data?.campaign ?? null;
  }

  const control = (id: string, action: 'start' | 'pause' | 'resume' | 'cancel') =>
    api.post(`/outreach/campaigns/${id}/${action}`);

  const restart = (id: string) => api.post(`/outreach/campaigns/${id}/restart`);

  const remove = (id: string) => api.delete(`/outreach/campaigns/${id}`);

  async function previewAudience(payload: AudienceFilterPayload): Promise<AudiencePreview> {
    const { data } = await api.post('/outreach/audience/preview', payload);
    return data as AudiencePreview;
  }

  async function getRuns(id: string): Promise<OutreachRun[]> {
    try { const { data } = await api.get(`/outreach/campaigns/${id}/runs`); return data?.runs ?? []; }
    catch { return []; }
  }

  async function getProgress(id: string) {
    const { data } = await api.get(`/outreach/campaigns/${id}/progress`);
    return data;
  }

  async function getLogs(id: string, opts: { page?: number; limit?: number; action?: string; status?: string } = {}) {
    const params = new URLSearchParams();
    if (opts.page) params.set('page', String(opts.page));
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.action) params.set('action', opts.action);
    if (opts.status) params.set('status', opts.status);
    const { data } = await api.get(`/outreach/campaigns/${id}/logs?${params}`);
    return data as { logs: OutreachLog[]; pagination: { page: number; limit: number; total: number } };
  }

  async function fetchImageAssets(): Promise<ImageAsset[]> {
    try {
      const { data } = await api.get('/media?kind=image&limit=200');
      return (data?.items ?? []).map((i: any) => ({
        id: i.id, name: i.name, thumbnailUrl: i.thumbnailUrl ?? i.url ?? null,
        sizeBytes: i.sizeBytes ?? null, createdAt: i.createdAt ?? null,
      }));
    } catch { return []; }
  }

  async function getPhones(id: string, opts: { page?: number; limit?: number; search?: string; status?: string; sort?: string } = {}) {
    const params = new URLSearchParams();
    if (opts.page) params.set('page', String(opts.page));
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.search) params.set('search', opts.search);
    if (opts.status) params.set('status', opts.status);
    if (opts.sort) params.set('sort', opts.sort);
    const { data } = await api.get(`/outreach/campaigns/${id}/phones?${params}`);
    return data as { phones: OutreachPhone[]; pagination: { page: number; limit: number; total: number }; summary: PhoneSummary };
  }

  return { campaigns, loading, fetchCampaigns, getCampaign, createCampaign, control, restart, remove, previewAudience, getRuns, getProgress, getLogs, getPhones, fetchImageAssets };
}

// ── Realtime progress ──
let socket: Socket | null = null;
let joined = false;
function ensureSocket(): Socket {
  if (!socket) {
    socket = createAppSocket();
    socket.on('connect', () => {
      const orgId = useAuthStore().user?.orgId;
      if (orgId) { socket!.emit('org:join', { orgId }); joined = true; }
    });
  }
  if (socket.connected && !joined) {
    const orgId = useAuthStore().user?.orgId;
    if (orgId) { socket.emit('org:join', { orgId }); joined = true; }
  }
  return socket;
}

export function useOutreachSocket(handler: (p: ProgressPayload) => void): void {
  const wrapped = (p: ProgressPayload) => { try { handler(p); } catch (e) { console.error('[outreach-socket]', e); } };
  onMounted(() => { ensureSocket().on('outreach:progress', wrapped); });
  onUnmounted(() => { socket?.off('outreach:progress', wrapped); });
}

/** Subscribe cập nhật trạng thái TỪNG SỐ realtime (1 số = 1 dòng, cập nhật tại chỗ). */
export function useOutreachPhoneSocket(handler: (p: PhonePayload) => void): void {
  const wrapped = (p: PhonePayload) => { try { handler(p); } catch (e) { console.error('[outreach-phone-socket]', e); } };
  onMounted(() => { ensureSocket().on('outreach:phone', wrapped); });
  onUnmounted(() => { socket?.off('outreach:phone', wrapped); });
}
