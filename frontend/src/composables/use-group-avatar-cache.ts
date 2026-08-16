// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import { reactive } from 'vue';
import { api } from '@/api';

// Cache UID → avatar URL toàn app (persist qua các lần MessageThread re-mount).
// undefined = chưa tra; '' = đã tra, không có; string = avatar URL.
const cache = reactive<Record<string, string>>({});
const pending = new Set<string>();
const accessOrder = new Map<string, number>();
let accessCounter = 0;
const MAX_CACHE_ENTRIES = 500;

function touch(uid: string) {
  accessOrder.delete(uid);
  accessOrder.set(uid, ++accessCounter);
}

function evictLeastRecentlyUsed() {
  while (accessOrder.size > MAX_CACHE_ENTRIES) {
    const oldestUid = accessOrder.keys().next().value as string | undefined;
    if (!oldestUid) return;
    accessOrder.delete(oldestUid);
    delete cache[oldestUid];
  }
}

// 2026-06-11 — accountId = nick của hội thoại nhóm. Truyền xuống để BE CHỈ gọi đúng
// nick đó thay vì thử 30-50 nick (per-nick UID) → tránh lag + đốt quota Zalo trên product.
async function fetchBatch(uids: string[], accountId?: string) {
  const toFetch = Array.from(new Set(uids))
    .filter(u => typeof u === 'string' && u.length > 0 && cache[u] === undefined && !pending.has(u));
  if (toFetch.length === 0) return;
  toFetch.forEach(u => pending.add(u));
  try {
    const res = await api.post('/zalo-user-info/batch', { uids: toFetch, ...(accountId ? { accountId } : {}) });
    const users = (res.data?.users || {}) as Record<string, { avatar?: string } | null>;
    for (const uid of toFetch) {
      cache[uid] = users[uid]?.avatar || '';
      touch(uid);
    }
    evictLeastRecentlyUsed();
  } catch (err) {
    console.error('[group-avatar-cache] batch fetch failed:', err);
    toFetch.forEach(u => { cache[u] = ''; touch(u); });
    evictLeastRecentlyUsed();
  } finally {
    toFetch.forEach(u => pending.delete(u));
  }
}

export const groupAvatarStore = {
  has: (uid: string) => {
    const found = cache[uid] !== undefined;
    if (found) touch(uid);
    return found;
  },
  get: (uid: string) => {
    const value = cache[uid];
    if (value !== undefined) touch(uid);
    return value;
  },
  fetchBatch,
};
