import { onScopeDispose, ref, watch, type Ref } from 'vue';
import { api } from '@/api';
import { createAppSocket } from '@/api/socket';
import type { Conversation } from './use-chat';

export function useDesktopConversations(search: Ref<string>, unread: Ref<boolean>, accountId: Ref<string>) {
  const rows = ref<Conversation[]>([]);
  const accounts = ref<Array<{ id: string; displayName: string | null }>>([]);
  const loading = ref(false), loadingMore = ref(false), hasMore = ref(false), offline = ref(false);
  const error = ref('');
  const accessRevision = ref(0);
  let cursor: string | null = null, page = 1, generation = 0, disposed = false;
  let request: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let refreshQueued = false;
  async function refresh(append = false) {
    if (disposed || (append && (loading.value || loadingMore.value || !hasMore.value))) return;
    if (request) { if (!append) refreshQueued = true; return; }
    const current = new AbortController(); request = current;
    const revision = ++generation;
    if (append) loadingMore.value = true; else loading.value = true;
    error.value = '';
    try {
      // On background refresh retain the already loaded range, not only page one.
      const target = append ? 1 : Math.max(1, Math.ceil(rows.value.length / 50));
      let collected: Conversation[] = [], next = append ? cursor : null;
      let more = false, lastPage = append ? page : 0;
      for (let index = 0; index < target; index++) {
        const result = await api.get('/conversations', { params: {
          limit: 50, search: search.value.trim().slice(0, 120), unread: unread.value ? 'true' : undefined,
          accountId: accountId.value || undefined,
          ...(next ? { cursor: next } : { page: lastPage + 1 }),
        }, signal: current.signal });
        if (disposed || current.signal.aborted || revision !== generation) return;
        const incoming = Array.isArray(result.data.conversations) ? result.data.conversations : [];
        collected.push(...incoming); lastPage++;
        more = result.data.hasMore === true && incoming.length > 0;
        const previous = next;
        next = typeof result.data.nextCursor === 'string' ? result.data.nextCursor : null;
        if (previous && next === previous) more = false;
        if (!more) break;
      }
      const combined = append ? [...rows.value, ...collected] : collected;
      rows.value = [...new Map(combined.map((row) => [row.id, row])).values()];
      cursor = next; page = lastPage; hasMore.value = more;
    } catch {
      if (!disposed && !current.signal.aborted && revision === generation) error.value = 'Không tải được danh sách hội thoại.';
    } finally {
      if (request === current) {
        loading.value = false; loadingMore.value = false; request = null;
        if (refreshQueued) { refreshQueued = false; schedule(); }
      }
    }
  }
  async function loadAccounts() {
    try {
      const { data } = await api.get('/zalo-accounts');
      if (!disposed) accounts.value = Array.isArray(data) ? data.map((row) => ({ id: row.id, displayName: row.displayName })) : [];
    } catch { if (!disposed) accounts.value = []; }
  }
  function schedule() {
    if (disposed || timer) return;
    timer = setTimeout(() => { timer = null; void refresh(); }, 500);
  }
  function cancelRefresh() {
    ++generation; request?.abort(); request = null; refreshQueued = false;
    loading.value = false; loadingMore.value = false;
    if (timer) clearTimeout(timer); timer = null;
    if (debounce) clearTimeout(debounce); debounce = null;
  }
  function invalidate() {
    cancelRefresh(); rows.value = []; accounts.value = []; cursor = null; page = 1; hasMore.value = false;
    accessRevision.value++;
    void loadAccounts(); schedule();
  }
  watch([search, unread, accountId], () => {
    cancelRefresh(); rows.value = []; cursor = null; page = 1; hasMore.value = false;
    debounce = setTimeout(() => { debounce = null; void refresh(); }, 220);
  });
  const socket = createAppSocket({ onStatusChange: (status) => { offline.value = status !== 'connected'; }, onReconnect: () => { void loadAccounts(); schedule(); } });
  for (const event of ['chat:message', 'chat:read', 'chat:deleted', 'chat:message-edited', 'conversation:state', 'chat:group-info-updated']) socket.on(event, schedule);
  for (const event of ['zalo:access-changed', 'privacy:mode-changed', 'conversation:privacy-changed']) socket.on(event, invalidate);
  const resume = () => { if (!document.hidden) schedule(); };
  window.addEventListener('focus', resume); window.addEventListener('online', resume);
  const poll = setInterval(resume, 30_000);
  void refresh(); void loadAccounts();
  onScopeDispose(() => {
    disposed = true; cancelRefresh(); socket.disconnect(); clearInterval(poll);
    window.removeEventListener('focus', resume); window.removeEventListener('online', resume);
  });
  return { rows, accounts, loading, loadingMore, error, hasMore, offline, accessRevision, refresh, loadMore: () => refresh(true) };
}
