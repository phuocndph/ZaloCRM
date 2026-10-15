import { onScopeDispose, ref, watch, type Ref } from 'vue';
import { api } from '@/api';
import { createAppSocket } from '@/api/socket';
import type { Socket } from 'socket.io-client';
import { desktopBridge } from './desktop-bridge';
import { isConversationNotificationMuted } from './use-conversation-state';
import type { Conversation } from './use-chat';

export function eligibleDesktopUnread(row: Conversation & { redacted?: boolean; zaloNotificationsMuted?: boolean; zaloMutedUntil?: string | null }): boolean {
  return row.unreadCount > 0 && !row.conversationPrivate && !row.redacted
    && row.zaloAccount?.privacyMode !== 'main' && !isConversationNotificationMuted(row.userState)
    && !(row.zaloNotificationsMuted && (!row.zaloMutedUntil || Date.parse(row.zaloMutedUntil) > Date.now()));
}

export function useDesktopUnread(owner: Ref<string>, enabled: Ref<boolean> = ref(true)) {
  const desktop = desktopBridge();
  if (desktop?.role !== 'main' || !desktop.syncUnread) return;
  let generation = 0, running = false, socket: Socket | null = null, controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null, poll: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | undefined;
  function schedule() {
    if (!owner.value || !enabled.value || timer) return;
    timer = setTimeout(() => { timer = null; void sync(); }, 750);
  }
  async function sync() {
    if (running || !owner.value || !enabled.value) { if (running) schedule(); return; }
    running = true;
    const currentOwner = owner.value, currentGeneration = generation;
    const abort = new AbortController(); controller = abort;
    try {
      const before = await desktop!.state();
      if (!before?.signedIn || before.revision === undefined) return;
      const counts = new Map<string, number>();
      let cursor: string | null = null, page = 1;
      const cursors = new Set<string>();
      while (true) {
        const response = await api.get('/conversations', { params: { unread: 'true', limit: 100, ...(cursor ? { cursor } : { page }) }, signal: abort.signal });
        const data: { conversations: Conversation[]; hasMore: boolean; nextCursor?: string } = response.data;
        if (abort.signal.aborted || currentGeneration !== generation || currentOwner !== owner.value) return;
        const rows: Conversation[] = data.conversations ?? [];
        for (const row of rows) if (eligibleDesktopUnread(row)) counts.set(row.id, row.unreadCount);
        if (!data.hasMore || !rows.length) break;
        cursor = typeof data.nextCursor === 'string' ? data.nextCursor : null;
        if (cursor && cursors.has(cursor)) throw new Error('repeated cursor');
        if (cursor) cursors.add(cursor);
        page++;
      }
      if (currentGeneration !== generation || currentOwner !== owner.value || abort.signal.aborted) return;
      // A message/read event that occurred during this scan wins over stale totals.
      const accepted = await desktop!.syncUnread!([...counts].map(([convId, count]) => ({ convId, count })), before.revision);
      if (!accepted && currentGeneration === generation) schedule();
    } catch {
      // Keep the last valid badge on network failure. Never replace it with zero.
    } finally {
      running = false; if (controller === abort) controller = null;
    }
  }
  function stop() {
    ++generation; controller?.abort(); socket?.disconnect(); socket = null;
    if (timer) clearTimeout(timer); timer = null;
    if (poll) clearInterval(poll); poll = null;
    unsubscribe?.(); unsubscribe = undefined;
  }
  watch([owner, enabled], ([value, notificationsEnabled]) => {
    stop(); if (!value || !notificationsEnabled) { desktop.clear(); return; }
    socket = createAppSocket({ onReconnect: schedule });
    for (const event of ['chat:message', 'chat:read', 'conversation:state', 'chat:deleted']) socket.on(event, schedule);
    for (const event of ['zalo:access-changed', 'privacy:mode-changed', 'conversation:privacy-changed']) socket.on(event, () => { ++generation; controller?.abort(); desktop.clear(); schedule(); });
    unsubscribe = desktop.onSyncRequest?.(schedule);
    poll = setInterval(schedule, 30_000); schedule();
  }, { immediate: true });
  window.addEventListener('online', schedule);
  onScopeDispose(() => { stop(); window.removeEventListener('online', schedule); });
}
