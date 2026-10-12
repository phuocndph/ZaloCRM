<template>
  <section class="wlo" aria-label="Theo dõi phân công hội thoại">
    <header class="wlo-head">
      <div>
        <div class="wlo-title"><UsersRoundIcon :size="17" aria-hidden="true" /> Phân công hội thoại</div>
        <p>Ai đang phụ trách hội thoại nào và còn bao nhiêu việc cần xử lý.</p>
      </div>
      <button class="wlo-refresh" type="button" title="Tải lại" aria-label="Tải lại" :disabled="loading" @click="refresh">
        <RefreshCwIcon :size="16" :class="{ spin: loading }" aria-hidden="true" />
        <span>Tải lại</span>
      </button>
    </header>

    <div class="wlo-summary" aria-label="Tổng quan tải công việc">
      <div><strong>{{ visibleSummary.activeConversations }}</strong><span>Hội thoại đang có việc</span></div>
      <div><strong>{{ visibleSummary.activeAssignees }}</strong><span>Người đang xử lý</span></div>
      <div><strong>{{ visibleSummary.totalWorkItems }}</strong><span>Tín hiệu công việc</span></div>
      <div class="wlo-summary--danger"><strong>{{ visibleSummary.overdueConversations }}</strong><span>Hội thoại quá hạn</span></div>
    </div>

    <div class="wlo-tools">
      <label class="wlo-search">
        <SearchIcon :size="15" aria-hidden="true" />
        <input v-model="search" type="search" placeholder="Tìm khách, nhóm, nick hoặc nhân viên..." aria-label="Tìm trong phân công hội thoại" />
      </label>
      <label class="wlo-filter">
        <span>Người phụ trách</span>
        <select v-model="selectedAssignee" aria-label="Lọc theo người phụ trách">
          <option value="">Tất cả</option>
          <option v-for="person in data.assignees" :key="person.id" :value="person.id">{{ person.fullName }} ({{ person.conversationCount }})</option>
        </select>
      </label>
    </div>

    <div v-if="loading && !loaded" class="wlo-state">Đang tải phân công...</div>
    <div v-else-if="error" class="wlo-state wlo-state--error">{{ error }} <button type="button" @click="refresh">Thử lại</button></div>
    <div v-else-if="!filteredItems.length" class="wlo-state">Chưa có hội thoại nào trong phạm vi đang xem.</div>
    <div v-else class="wlo-table-wrap">
      <table class="wlo-table">
        <thead>
          <tr>
            <th>Người phụ trách</th>
            <th>Hội thoại</th>
            <th>Nick Zalo</th>
            <th>Trạng thái</th>
            <th>Cập nhật</th>
            <th aria-label="Mở hội thoại" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in filteredItems" :key="item.key" @click="openConversation(item)">
            <td>
              <div class="wlo-person">
                <img v-if="item.assignee.avatarUrl" :src="item.assignee.avatarUrl" alt="" loading="lazy" />
                <span v-else>{{ initials(item.assignee.fullName) }}</span>
                <strong>{{ item.assignee.fullName }}</strong>
              </div>
            </td>
            <td>
              <div class="wlo-conversation">
                <strong>{{ item.conversationLabel }}</strong>
                <span>{{ item.contactName }}<template v-if="item.threadType === 'group'"> · Nhóm</template><template v-if="item.workItemCount > 1"> · {{ item.workItemCount }} việc</template></span>
              </div>
            </td>
            <td>
              <span class="wlo-nick">{{ item.nickName || 'Chưa xác định' }}</span>
              <span v-if="item.nickStatus" class="wlo-status" :class="`wlo-status--${item.nickStatus}`">{{ accountStatus(item.nickStatus) }}</span>
            </td>
            <td>
              <span class="wlo-priority" :class="`wlo-priority--${item.highestPriority}`">{{ priorityLabel(item.highestPriority) }}</span>
              <span v-if="item.status === 'snoozed'" class="wlo-muted">Đang hoãn</span>
              <span v-else-if="item.dueAt && new Date(item.dueAt).getTime() <= Date.now()" class="wlo-overdue"><CircleAlertIcon :size="13" aria-hidden="true" /> Quá hạn</span>
            </td>
            <td>
              <time v-if="item.lastMessageAt" :datetime="item.lastMessageAt">{{ formatDate(item.lastMessageAt) }}</time>
              <span v-if="item.unreadCount > 0" class="wlo-unread">{{ item.unreadCount }} chưa đọc</span>
            </td>
            <td class="wlo-open"><MessageCircleIcon :size="17" aria-hidden="true" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api';
import { createAppSocket } from '@/api/socket';
import type { Socket } from 'socket.io-client';
import { CircleAlert as CircleAlertIcon, MessageCircle as MessageCircleIcon, RefreshCw as RefreshCwIcon, Search as SearchIcon, UsersRound as UsersRoundIcon } from 'lucide-vue-next';

type LoadItem = {
  key: string;
  conversationId: string | null;
  contactId: string;
  contactName: string;
  conversationLabel: string;
  threadType: string;
  nickName: string | null;
  nickStatus: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  workItemCount: number;
  highestPriority: string;
  status: string;
  dueAt: string | null;
  assignee: { id: string; fullName: string; avatarUrl: string | null };
};
type LoadPerson = { id: string; fullName: string; avatarUrl: string | null; conversationCount: number; workItemCount: number; overdueCount: number };
type Overview = { summary: { activeConversations: number; activeAssignees: number; overdueConversations: number; totalWorkItems: number }; assignees: LoadPerson[]; items: LoadItem[] };

const router = useRouter();
const data = ref<Overview>({ summary: { activeConversations: 0, activeAssignees: 0, overdueConversations: 0, totalWorkItems: 0 }, assignees: [], items: [] });
const search = ref('');
const selectedAssignee = ref('');
const loading = ref(false);
const loaded = ref(false);
const error = ref('');
let timer: ReturnType<typeof setInterval> | null = null;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let socket: Socket | null = null;

const filteredItems = computed(() => data.value.items.filter((item) => !selectedAssignee.value || item.assignee.id === selectedAssignee.value));
const visibleSummary = computed(() => ({
  activeConversations: filteredItems.value.length,
  activeAssignees: new Set(filteredItems.value.map((item) => item.assignee.id)).size,
  totalWorkItems: filteredItems.value.reduce((sum, item) => sum + item.workItemCount, 0),
  overdueConversations: filteredItems.value.filter((item) => item.status === 'open' && !!item.dueAt && new Date(item.dueAt).getTime() <= Date.now()).length,
}));

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const { data: result } = await api.get<Overview>('/work-items/overview', { params: search.value.trim() ? { q: search.value.trim() } : undefined });
    data.value = result;
    loaded.value = true;
  } catch {
    error.value = 'Không tải được danh sách phân công hội thoại.';
  } finally {
    loading.value = false;
  }
}

function openConversation(item: LoadItem) {
  if (item.conversationId) void router.push({ name: 'Chat', params: { convId: item.conversationId } });
  else void router.push({ path: '/contacts', query: { focus: item.contactId } });
}
function initials(value: string) { return value.trim().split(/\s+/).map((part) => part[0]).join('').slice(-2).toUpperCase() || '?'; }
function priorityLabel(value: string) { return ({ critical: 'Khẩn cấp', high: 'Ưu tiên cao', normal: 'Bình thường', low: 'Theo dõi' } as Record<string, string>)[value] || value; }
function accountStatus(value: string) { return value === 'connected' ? 'Đã kết nối' : value === 'disconnected' ? 'Mất kết nối' : value; }
function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void refresh(), 250);
});
onMounted(() => {
  void refresh();
  timer = setInterval(() => void refresh(), 30_000);
  socket = createAppSocket();
  socket.on('work-items:updated', () => void refresh());
  socket.on('chat:message', () => void refresh());
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
  if (searchTimer) clearTimeout(searchTimer);
  socket?.disconnect();
  socket = null;
});
</script>

<style scoped>
.wlo { background: #fff; border: 1px solid #e4e7ec; border-radius: 8px; color: #172033; overflow: hidden; }
.wlo-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px 18px; border-bottom: 1px solid #e4e7ec; }
.wlo-title { display: flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 800; }
.wlo-head p { margin: 5px 0 0; color: #667085; font-size: 12px; }
.wlo-refresh { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; padding: 0 10px; border: 1px solid #d0d5dd; border-radius: 6px; background: #fff; color: #344054; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.wlo-refresh:hover:not(:disabled) { border-color: #087daf; color: #087daf; }
.wlo-refresh:disabled { opacity: .55; cursor: default; }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.wlo-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: #e4e7ec; border-bottom: 1px solid #e4e7ec; }
.wlo-summary > div { display: flex; flex-direction: column; gap: 3px; padding: 13px 16px; background: #fff; }
.wlo-summary strong { font-size: 22px; line-height: 1; }
.wlo-summary span { color: #667085; font-size: 11px; }
.wlo-summary--danger strong { color: #c4320a; }
.wlo-tools { display: flex; align-items: end; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #e4e7ec; }
.wlo-search { display: flex; align-items: center; gap: 8px; flex: 1; min-height: 34px; padding: 0 10px; border: 1px solid #d0d5dd; border-radius: 6px; color: #667085; }
.wlo-search input { width: 100%; border: 0; outline: 0; color: #172033; font: inherit; font-size: 12px; }
.wlo-filter { display: flex; flex-direction: column; gap: 4px; min-width: 190px; color: #667085; font-size: 11px; font-weight: 700; }
.wlo-filter select { min-height: 34px; padding: 0 9px; border: 1px solid #d0d5dd; border-radius: 6px; background: #fff; color: #344054; font: inherit; font-size: 12px; }
.wlo-table-wrap { overflow-x: auto; }
.wlo-table { width: 100%; border-collapse: collapse; min-width: 820px; }
.wlo-table th { padding: 10px 14px; background: #f8fafc; color: #667085; font-size: 10px; font-weight: 800; letter-spacing: .04em; text-align: left; text-transform: uppercase; white-space: nowrap; }
.wlo-table td { padding: 12px 14px; border-top: 1px solid #eef1f4; vertical-align: middle; font-size: 12px; }
.wlo-table tbody tr { cursor: pointer; }
.wlo-table tbody tr:hover { background: #f8fbfc; }
.wlo-person { display: flex; align-items: center; gap: 8px; min-width: 145px; }
.wlo-person img, .wlo-person > span { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }
.wlo-person > span { display: inline-flex; align-items: center; justify-content: center; background: #e4f3f7; color: #087daf; font-size: 10px; font-weight: 800; }
.wlo-person strong, .wlo-conversation strong { display: block; color: #172033; font-weight: 750; }
.wlo-conversation { min-width: 190px; }
.wlo-conversation span, .wlo-muted, .wlo-unread, .wlo-overdue, .wlo-status { display: block; margin-top: 4px; color: #667085; font-size: 11px; }
.wlo-nick { color: #344054; font-weight: 650; white-space: nowrap; }
.wlo-status--connected { color: #087443; }
.wlo-status--disconnected { color: #b42318; }
.wlo-priority { display: inline-block; padding: 3px 6px; border-radius: 4px; background: #eef2f6; color: #475467; font-size: 10px; font-weight: 800; white-space: nowrap; }
.wlo-priority--critical { background: #fee4e2; color: #b42318; }
.wlo-priority--high { background: #fff0d6; color: #a15c00; }
.wlo-overdue { display: flex; align-items: center; gap: 3px; color: #b42318; font-weight: 700; }
.wlo-unread { color: #087daf; font-weight: 700; white-space: nowrap; }
.wlo-open { width: 42px; color: #087daf; text-align: center; }
.wlo-state { padding: 42px 18px; color: #667085; font-size: 13px; text-align: center; }
.wlo-state--error { color: #b42318; }
.wlo-state button { margin-left: 8px; border: 0; background: transparent; color: #087daf; font: inherit; font-weight: 750; cursor: pointer; }
@media (max-width: 720px) { .wlo-head { padding: 14px; } .wlo-refresh span { display: none; } .wlo-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } .wlo-tools { align-items: stretch; flex-direction: column; padding: 12px; } .wlo-filter { min-width: 0; } }
</style>
