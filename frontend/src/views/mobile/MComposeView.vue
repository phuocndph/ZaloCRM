<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- MComposeView — Soạn tin mới trên /m. Chọn nick → tìm bạn bè của nick → chạm mở chat.
     Tái dùng API desktop: GET /zalo-accounts/:id/friends-db + POST /friends/:id/ensure-conversation.
     Bản gọn cho mobile (không kèm tra Zalo/ tạo KH mới — để desktop lo luồng nâng cao). -->
<template>
  <div class="mcp">
    <header class="mcp-head">
      <button class="m-iconbtn" aria-label="Quay lại" @click="goBack">
        <ChevronLeftIcon :size="26" :stroke-width="2.2" />
      </button>
      <div class="mcp-title">Soạn tin mới</div>
    </header>

    <!-- Chọn nick gửi (ẩn nếu chỉ có 1 nick) -->
    <div v-if="accounts.length > 1" class="mcp-nicks">
      <button
        v-for="a in accounts" :key="a.id"
        class="mcp-nick" :class="{ on: a.id === selectedAccountId }"
        @click="selectAccount(a.id)"
      >
        <span class="mcp-nick-av">
          <img v-if="a.avatarUrl" :src="a.avatarUrl" alt="" referrerpolicy="no-referrer" />
          <span v-else>{{ (a.displayName || '?').charAt(0).toUpperCase() }}</span>
        </span>
        <span class="mcp-nick-name">{{ a.displayName || 'Nick' }}</span>
      </button>
    </div>
    <div v-else-if="accounts.length === 1" class="mcp-nick-single">
      Gửi từ nick: <b>{{ accounts[0].displayName || 'Nick' }}</b>
    </div>

    <!-- Ô tìm -->
    <div class="mcp-search">
      <SearchIcon :size="18" :stroke-width="2" />
      <input
        ref="searchInput" v-model="query" type="search"
        :placeholder="selectedAccountId ? 'Tìm tên, số điện thoại…' : 'Chưa có nick để gửi'"
        :disabled="!selectedAccountId"
        @input="onSearchInput"
      />
      <button v-if="query" class="mcp-clear" aria-label="Xóa" @click="clearQuery"><XIcon :size="16" :stroke-width="2.4" /></button>
    </div>

    <!-- Kết quả -->
    <div class="mcp-list">
      <div v-if="!selectedAccountId" class="mcp-state">Chưa có nick CRM nào để soạn tin.</div>
      <div v-else-if="searching" class="mcp-state">Đang tìm…</div>
      <div v-else-if="!query.trim()" class="mcp-state">Gõ tên hoặc số điện thoại để tìm bạn bè của nick.</div>
      <div v-else-if="!friends.length" class="mcp-state">Không tìm thấy ai phù hợp trong nick này.</div>

      <button
        v-for="f in friends" :key="f.id"
        class="mcp-row" :disabled="openingId === f.id"
        @click="openChat(f)"
      >
        <div class="mcp-av">
          <img v-if="f.zaloAvatarUrl && !imgFailed.has(f.id)" :src="f.zaloAvatarUrl" alt="" referrerpolicy="no-referrer" loading="lazy" @error="imgFailed.add(f.id)" />
          <span v-else>{{ friendInitial(f) }}</span>
        </div>
        <div class="mcp-body">
          <div class="mcp-name">{{ friendName(f) }}</div>
          <div class="mcp-meta">
            <span v-if="f.contact?.phone" class="mcp-phone">{{ f.contact.phone }}</span>
            <span class="mcp-tag" :class="f.hasConversation ? 'is-chat' : 'is-kb'">{{ f.hasConversation ? 'Đang chat' : 'Chỉ kết bạn' }}</span>
          </div>
        </div>
        <LoaderIcon v-if="openingId === f.id" :size="18" :stroke-width="2.4" class="mcp-spin" />
        <ChevronRightIcon v-else :size="18" :stroke-width="2" class="mcp-go" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  ChevronLeft as ChevronLeftIcon, Search as SearchIcon, X as XIcon,
  ChevronRight as ChevronRightIcon, Loader2 as LoaderIcon,
} from 'lucide-vue-next';
import { api } from '@/api/index';
import { useZaloAccounts } from '@/composables/use-zalo-accounts';
import { useWorkScope } from '@/composables/use-work-scope';
import { useToast } from '@/composables/use-toast';

interface FriendRow {
  id: string;
  zaloUidInNick: string;
  zaloDisplayName: string | null;
  zaloAvatarUrl: string | null;
  hasConversation: boolean;
  contact?: { id: string; fullName: string | null; phone: string | null } | null;
}

const router = useRouter();
const toast = useToast();
const { accounts, fetchAccounts } = useZaloAccounts();
const workScope = useWorkScope();

const selectedAccountId = ref<string | null>(null);
const query = ref('');
const friends = ref<FriendRow[]>([]);
const searching = ref(false);
const openingId = ref<string | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const imgFailed = reactive(new Set<string>()); // avatar lỗi → chữ cái đầu
let searchTimer: ReturnType<typeof setTimeout> | null = null;

function goBack() { router.push({ name: 'M.Conversations' }); }
function friendName(f: FriendRow) {
  return f.zaloDisplayName || f.contact?.fullName || `KH-${f.zaloUidInNick.slice(-4)}`;
}
function friendInitial(f: FriendRow) { return friendName(f).trim().charAt(0).toUpperCase() || '?'; }

function selectAccount(id: string) {
  if (selectedAccountId.value === id) return;
  selectedAccountId.value = id;
  friends.value = [];
  if (query.value.trim()) void runSearch();
}
function clearQuery() {
  query.value = '';
  friends.value = [];
  searchInput.value?.focus();
}
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  if (!query.value.trim()) { friends.value = []; return; }
  searchTimer = setTimeout(() => void runSearch(), 250);
}

async function runSearch() {
  const acc = selectedAccountId.value;
  const q = query.value.trim();
  if (!acc || !q) { friends.value = []; return; }
  searching.value = true;
  try {
    const res = await api.get<{ friends?: FriendRow[] }>(
      `/zalo-accounts/${acc}/friends-db`,
      { params: { kind: 'all', page: 1, limit: 25, search: q } },
    );
    // Chỉ giữ kết quả của lần gõ hiện tại (chống race).
    if (acc === selectedAccountId.value && q === query.value.trim()) {
      friends.value = res.data?.friends || [];
    }
  } catch {
    if (acc === selectedAccountId.value) friends.value = [];
  } finally {
    if (acc === selectedAccountId.value) searching.value = false;
  }
}

async function openChat(f: FriendRow) {
  if (openingId.value) return;
  openingId.value = f.id;
  try {
    const res = await api.post<{ conversationId: string; created: boolean }>(
      `/friends/${f.id}/ensure-conversation`, {},
    );
    const convId = res.data?.conversationId;
    if (!convId) { toast.error('Không mở được cuộc trò chuyện'); return; }
    router.push({ name: 'M.Chat', params: { convId } });
  } catch (err: any) {
    toast.error(err?.response?.data?.error || 'Không mở được cuộc trò chuyện');
  } finally {
    openingId.value = null;
  }
}

onMounted(async () => {
  if (!accounts.value.length) await fetchAccounts();
  // Ưu tiên nick đang ở Phạm vi xem, nếu không có thì nick đầu.
  const scoped = workScope.scopeAccountId?.() ?? null;
  selectedAccountId.value = (scoped && accounts.value.some((a) => a.id === scoped))
    ? scoped
    : (accounts.value[0]?.id ?? null);
  setTimeout(() => searchInput.value?.focus(), 120);
});
</script>

<style scoped>
.mcp { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--m-bg); }
.mcp-head {
  display: flex; align-items: center; gap: 6px;
  padding: calc(env(safe-area-inset-top, 0px) + 8px) var(--m-sp-2) 8px;
  background: var(--m-surface); border-bottom: 1px solid var(--m-border);
}
.mcp-title { font-size: var(--m-fs-lg); font-weight: var(--m-fw-bold); color: var(--m-text); }

.mcp-nicks { display: flex; gap: var(--m-sp-2); overflow-x: auto; padding: var(--m-sp-2) var(--m-sp-3); background: var(--m-surface); border-bottom: 1px solid var(--m-border); }
.mcp-nick { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; padding: 5px 12px 5px 5px; border: 1.5px solid transparent; border-radius: var(--m-r-full); background: var(--m-surface-2); color: var(--m-text-2); cursor: pointer; }
.mcp-nick.on { border-color: var(--m-brand); background: var(--m-brand-soft); color: var(--m-brand-strong); }
.mcp-nick-av { width: 26px; height: 26px; border-radius: 50%; overflow: hidden; background: var(--m-brand); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: var(--m-fw-bold); flex-shrink: 0; }
.mcp-nick-av img { width: 100%; height: 100%; object-fit: cover; }
.mcp-nick-name { font-size: var(--m-fs-sm); font-weight: var(--m-fw-semibold); white-space: nowrap; }
.mcp-nick-single { padding: 8px var(--m-sp-4); font-size: var(--m-fs-sm); color: var(--m-text-2); background: var(--m-surface); border-bottom: 1px solid var(--m-border); }

.mcp-search { display: flex; align-items: center; gap: var(--m-sp-2); margin: var(--m-sp-3) var(--m-sp-3) var(--m-sp-2); padding: 0 12px; min-height: 44px; border-radius: var(--m-r-full); background: var(--m-surface-2); color: var(--m-text-3); }
.mcp-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--m-text); font: inherit; }
.mcp-clear { display: inline-flex; border: 0; background: none; color: var(--m-text-3); padding: 2px; cursor: pointer; }

.mcp-list { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: calc(var(--m-sp-6) + env(safe-area-inset-bottom, 0px)); }
.mcp-state { padding: 28px var(--m-sp-4); text-align: center; color: var(--m-text-3); font-size: var(--m-fs-sm); }

.mcp-row { display: flex; align-items: center; gap: var(--m-sp-3); width: 100%; padding: 11px var(--m-sp-4); border: 0; background: none; cursor: pointer; text-align: left; }
.mcp-row + .mcp-row { box-shadow: inset 0 1px 0 var(--m-border); }
.mcp-row:active { background: var(--m-surface-2); }
.mcp-row:disabled { opacity: 0.6; }
.mcp-av { width: 44px; height: 44px; border-radius: 50%; overflow: hidden; flex-shrink: 0; background: linear-gradient(135deg, #8fb7ff, #1f6fd6); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: var(--m-fw-bold); }
.mcp-av img { width: 100%; height: 100%; object-fit: cover; }
.mcp-body { flex: 1; min-width: 0; }
.mcp-name { font-size: var(--m-fs-md); font-weight: var(--m-fw-semibold); color: var(--m-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mcp-meta { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.mcp-phone { font-size: var(--m-fs-xs); color: var(--m-text-3); }
.mcp-tag { font-size: var(--m-fs-2xs); font-weight: var(--m-fw-semibold); padding: 1px 7px; border-radius: var(--m-r-full); }
.mcp-tag.is-chat { background: #dcfce7; color: #15803d; }
.mcp-tag.is-kb { background: var(--m-warning-soft); color: #a16207; }
.mcp-go { color: var(--m-text-3); flex-shrink: 0; }
.mcp-spin { color: var(--m-brand); flex-shrink: 0; animation: mcp-rot 0.7s linear infinite; }
@keyframes mcp-rot { to { transform: rotate(360deg); } }
</style>
