<template>
  <section class="dwq" :class="{ 'dwq--mobile': mobile }" aria-label="Danh sách công việc khách hàng">
    <header class="dwq-head">
      <div class="dwq-heading">
        <div class="dwq-title"><ListTodoIcon :size="17" aria-hidden="true" /> Công việc khách hàng</div>
        <div v-if="aiAnalyzingCount > 0" class="dwq-ai-overview dwq-ai-overview--active">
          <LoaderCircleIcon :size="13" class="dwq-spin" aria-hidden="true" /> {{ aiAnalyzingCount }} hội thoại đang được AI phân tích
        </div>
        <div v-else-if="aiPendingCount > 0" class="dwq-ai-overview dwq-ai-overview--pending">
          <Clock3Icon :size="13" aria-hidden="true" /> {{ aiPendingCount }} hội thoại đang chờ AI phân tích
        </div>
        <div v-else-if="aiVerificationCount > 0" class="dwq-ai-overview dwq-ai-overview--verification">
          <BrainCircuitIcon :size="13" aria-hidden="true" /> {{ aiVerificationCount }} việc đã có kết quả AI và đang chờ xác minh
        </div>
        <div v-else-if="!loading && !error" class="dwq-ai-idle">AI: Không có tác vụ đang chạy</div>
      </div>
      <div class="dwq-ai-bar" role="status" aria-label="Tiến trình AI">
        <template v-if="analysisActivities.length">
          <button
            v-for="activity in analysisActivities"
            :key="activity.conversationId"
            class="dwq-ai-activity-row"
            :class="{ 'dwq-ai-activity-row--pending': activity.status === 'pending' }"
            type="button"
            :title="`${activity.name} · ${activity.nickName} · ${activity.step}`"
            :aria-label="`Mở hội thoại ${activity.name} trên nick ${activity.nickName}`"
            @click="openAnalysisConversation(activity.conversationId)"
          >
            <span class="dwq-ai-activity-copy">
              <LoaderCircleIcon v-if="activity.status === 'analyzing'" :size="14" class="dwq-spin" aria-hidden="true" />
              <Clock3Icon v-else :size="14" aria-hidden="true" />
              <strong class="dwq-ai-activity-name">{{ activity.name }}</strong>
              <span class="dwq-ai-activity-nick">{{ activity.nickName }}</span>
              <MessageCircleIcon :size="13" class="dwq-ai-activity-open" aria-hidden="true" />
            </span>
            <span class="dwq-ai-activity-step">{{ activity.step }}</span>
            <span class="dwq-ai-track" aria-hidden="true"><span /></span>
          </button>
        </template>
        <div v-else class="dwq-ai-bar-idle">
          <LoaderCircleIcon v-if="loading" :size="14" class="dwq-spin" aria-hidden="true" />
          <BrainCircuitIcon v-else :size="15" aria-hidden="true" />
          <span>{{ loading ? 'Đang tải trạng thái AI' : error ? 'Chưa tải được trạng thái AI' : 'Chưa có hội thoại đang phân tích' }}</span>
        </div>
      </div>
      <button class="dwq-icon-btn" type="button" title="Tải lại danh sách" aria-label="Tải lại danh sách" :disabled="loading" @click="refresh(false)">
        <RefreshCwIcon :size="16" :class="{ 'dwq-spin': loading }" aria-hidden="true" />
      </button>
    </header>

    <div v-if="!compact" class="dwq-tools">
      <SearchIcon :size="15" aria-hidden="true" />
      <input
        v-model="searchQuery"
        type="search"
        placeholder="Tìm khách, nhóm, nick..."
        aria-label="Tìm khách, nhóm hoặc nick"
      />
      <span v-if="summary.totalActive > 0" class="dwq-total">{{ summary.totalActive }} việc đang mở</span>
    </div>

    <div v-if="!compact && !hideTabs" class="dwq-tabs" role="tablist" aria-label="Lọc công việc">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        role="tab"
        :aria-selected="scope === tab.key"
        :class="{ active: scope === tab.key }"
        @click="scope = tab.key"
      >
        {{ tab.label }} <span>{{ counts[tab.key] ?? 0 }}</span>
      </button>
    </div>

    <div v-if="loading && !items.length" class="dwq-loading" aria-label="Đang tải công việc">
      <span v-for="n in 3" :key="n" />
    </div>
    <div v-else-if="error" class="dwq-state dwq-state--error">
      <AlertCircleIcon :size="18" aria-hidden="true" />
      <span>{{ error }}</span>
      <button type="button" @click="refresh(false)">Thử lại</button>
    </div>
    <div v-else-if="!items.length" class="dwq-state">
      <CircleCheckBigIcon :size="22" aria-hidden="true" />
      <strong>{{ emptyTitle }}</strong>
      <span>{{ emptyDescription }}</span>
    </div>

    <div v-else class="dwq-list">
      <article v-for="item in visibleItems" :key="item.id" class="dwq-row" :class="[`dwq-row--${item.priority}`, { 'dwq-row--selected': !!selectedConversationId && selectedConversationId === item.conversationId }]" tabindex="0" @click="openItem(item)" @keydown.enter.self="openItem(item)">
        <div class="dwq-avatar" aria-hidden="true">
          <img v-if="avatar(item) && !failedImages.has(item.id)" :src="avatar(item)!" alt="" loading="lazy" @error="failedImages.add(item.id)" />
          <span v-else>{{ initial(item) }}</span>
        </div>

        <div class="dwq-body">
          <div class="dwq-topline">
            <strong class="dwq-name">{{ contactName(item) }}</strong>
            <span class="dwq-priority" :class="`dwq-priority--${item.priority}`">{{ priorityLabel(item.priority) }}</span>
            <time v-if="deadline(item)" :class="{ overdue: deadline(item)?.overdue }" :datetime="item.dueAt || item.snoozedUntil || undefined">
              {{ deadline(item)?.label }}
            </time>
          </div>

          <div class="dwq-context" :class="{ 'dwq-context--verify': isVerification(item) }">
            <span>{{ contextLabel(item) }}</span>
            <p>{{ item.customerSituation || 'Chưa có đủ nội dung để xác định tình huống hiện tại.' }}</p>
          </div>
          <div class="dwq-next">
            <ArrowRightCircleIcon :size="15" aria-hidden="true" />
            <div><span>{{ isVerification(item) ? 'Cần xác minh' : 'Làm tiếp' }}</span><strong>{{ item.nextAction }}</strong></div>
          </div>
          <p v-if="item.reason" class="dwq-reason"><CircleHelpIcon :size="13" aria-hidden="true" /> {{ item.reason }}</p>

          <div class="dwq-meta">
            <span v-if="nickLabel(item)"><MessagesSquareIcon :size="13" aria-hidden="true" /> {{ nickLabel(item) }}</span>
            <span v-if="item.metadata?.isGroup"><UsersRoundIcon :size="13" aria-hidden="true" /> Nhóm bán hàng</span>
            <span v-if="(item.metadata?.unreadCount ?? 0) > 0"><MailIcon :size="13" aria-hidden="true" /> {{ item.metadata?.unreadCount }} tin chưa đọc</span>
            <span v-if="(item.metadata?.signalCount ?? 0) > 1"><Layers3Icon :size="13" aria-hidden="true" /> {{ item.metadata?.signalCount }} việc đã gộp</span>
            <span
              v-if="aiProgress(item)"
              class="dwq-ai-status"
              :class="`dwq-ai-status--${aiProgress(item)!.status}`"
              :title="aiProgress(item)!.detail"
            >
              <LoaderCircleIcon v-if="aiProgress(item)!.status === 'analyzing'" :size="13" class="dwq-spin" aria-hidden="true" />
              <BrainCircuitIcon v-else :size="13" aria-hidden="true" />
              AI: {{ aiProgress(item)!.label }}
            </span>
          </div>
          <p v-if="aiProgress(item)?.status === 'analyzing' || aiProgress(item)?.status === 'failed'" class="dwq-ai-step" role="status">
            {{ aiProgress(item)!.detail }}
          </p>
        </div>

        <div class="dwq-actions" @click.stop>
          <button v-if="item.conversationId" type="button" title="Mở hội thoại" aria-label="Mở hội thoại" @click="openItem(item)">
            <MessageCircleIcon :size="16" aria-hidden="true" />
          </button>
          <button v-else type="button" title="Mở hồ sơ khách hàng" aria-label="Mở hồ sơ khách hàng" @click="openItem(item)">
            <ContactRoundIcon :size="16" aria-hidden="true" />
          </button>
          <button v-if="item.conversationId" type="button" title="Mở AI và soạn nháp trả lời" aria-label="Mở AI và soạn nháp trả lời" @click="openAi(item)">
            <SparklesIcon :size="16" aria-hidden="true" />
          </button>
          <template v-if="item.status === 'completed'">
            <button type="button" title="Mở lại công việc" aria-label="Mở lại công việc" :disabled="mutatingId === item.id" @click="mutate(item, 'reopen')">
              <RotateCcwIcon :size="16" aria-hidden="true" />
            </button>
          </template>
          <template v-else>
            <div class="dwq-snooze-wrap">
              <button type="button" title="Hoãn công việc" aria-label="Hoãn công việc" :disabled="mutatingId === item.id" @click="toggleSnooze(item.id)">
                <Clock3Icon :size="16" aria-hidden="true" />
              </button>
              <div v-if="snoozeOpenId === item.id" class="dwq-snooze-menu">
                <button type="button" @click="snooze(item, 60)">Sau 1 giờ</button>
                <button type="button" @click="snooze(item, 180)">Sau 3 giờ</button>
                <button type="button" @click="snoozeTomorrow(item)">9:00 ngày mai</button>
              </div>
            </div>
            <button type="button" title="Đánh dấu đã xong" aria-label="Đánh dấu đã xong" :disabled="mutatingId === item.id" @click="mutate(item, 'complete')">
              <CheckIcon :size="17" aria-hidden="true" />
            </button>
          </template>
        </div>
      </article>
      <button v-if="hasMore && !compact" class="dwq-load-more" type="button" :disabled="loadingMore" @click="loadMore">
        <RefreshCwIcon v-if="loadingMore" :size="14" class="dwq-spin" aria-hidden="true" />
        {{ loadingMore ? 'Đang tải...' : 'Xem thêm công việc' }}
      </button>
    </div>

    <button v-if="compact" class="dwq-all" type="button" @click="openAll">
      Xem tất cả công việc <ArrowRightIcon :size="15" aria-hidden="true" />
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  AlertCircle as AlertCircleIcon,
  ArrowRight as ArrowRightIcon,
  ArrowRightCircle as ArrowRightCircleIcon,
  BrainCircuit as BrainCircuitIcon,
  Check as CheckIcon,
  CircleCheckBig as CircleCheckBigIcon,
  CircleHelp as CircleHelpIcon,
  Clock3 as Clock3Icon,
  ContactRound as ContactRoundIcon,
  Layers3 as Layers3Icon,
  LoaderCircle as LoaderCircleIcon,
  ListTodo as ListTodoIcon,
  Mail as MailIcon,
  MessageCircle as MessageCircleIcon,
  MessagesSquare as MessagesSquareIcon,
  Search as SearchIcon,
  UsersRound as UsersRoundIcon,
  RefreshCw as RefreshCwIcon,
  RotateCcw as RotateCcwIcon,
  Sparkles as SparklesIcon,
} from 'lucide-vue-next';
import { useToast } from '@/composables/use-toast';
import {
  useConversationWorkItems,
  type ConversationWorkItem,
  type AiProgressStatus,
  type WorkItemPriority,
  type WorkItemScope,
} from '@/composables/use-conversation-work-items';

const props = withDefaults(defineProps<{ asUserId?: string | null; mobile?: boolean; compact?: boolean; hideTabs?: boolean; initialScope?: WorkItemScope; previewEnabled?: boolean; selectedConversationId?: string | null }>(), {
  asUserId: null,
  mobile: false,
  compact: false,
  hideTabs: false,
  initialScope: 'now',
  previewEnabled: false,
  selectedConversationId: null,
});
const emit = defineEmits<{
  'scope-change': [scope: WorkItemScope];
  'preview-conversation': [conversationId: string, item: ConversationWorkItem | null];
  'item-updated': [item: ConversationWorkItem];
}>();

const router = useRouter();
const toast = useToast();
const { items, aiActivity, counts, summary, loading, loadingMore, hasMore, mutatingId, error, fetchItems, loadMore, updateItem, stopRealtime } = useConversationWorkItems();
const scope = ref<WorkItemScope>(props.initialScope);
const searchQuery = ref('');
const snoozeOpenId = ref<string | null>(null);
const failedImages = reactive(new Set<string>());
let timer: ReturnType<typeof setInterval> | null = null;
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const tabs: Array<{ key: WorkItemScope; label: string }> = [
  { key: 'now', label: 'Cần làm ngay' },
  { key: 'today', label: 'Còn lại hôm nay' },
  { key: 'waiting', label: 'Đang hoãn' },
  { key: 'upcoming', label: 'Sắp tới' },
  { key: 'verify', label: 'Cần xác minh' },
  { key: 'done', label: 'Đã xong' },
];

const emptyTitle = computed(() => ({
  now: 'Không có việc gấp',
  today: 'Đã xử lý hết việc hôm nay',
  waiting: 'Không có việc đang hoãn',
  upcoming: 'Chưa có việc sắp tới',
  verify: 'Không có việc cần xác minh',
  done: 'Chưa có việc đã hoàn thành',
})[scope.value]);
const emptyDescription = computed(() => scope.value === 'done'
  ? 'Chưa có công việc hoàn thành.'
  : scope.value === 'now'
    ? 'Không có việc đã đến hạn. Các lịch follow-up sau hôm nay nằm trong mục Sắp tới.'
    : 'Hiện chưa có công việc trong mục này.');
const visibleItems = computed(() => props.compact ? items.value.slice(0, 4) : items.value);
const analysisActivities = computed(() => {
  const activities = new Map<string, { conversationId: string; name: string; nickName: string; step: string; status: 'analyzing' | 'pending' }>();
  for (const activity of aiActivity.value) {
    activities.set(activity.conversationId, { ...activity, status: 'analyzing' });
  }
  for (const item of items.value) {
    const progress = aiProgress(item);
    if (!item.conversationId || activities.has(item.conversationId) || !progress
      || !['analyzing', 'pending', 'queued'].includes(progress.status)) continue;
    const analyzing = progress.status === 'analyzing';
    activities.set(item.conversationId, {
      conversationId: item.conversationId,
      name: item.metadata?.isGroup ? item.metadata.groupName || contactName(item) : contactName(item),
      nickName: item.conversation?.zaloAccount?.displayName || nickLabel(item),
      step: analyzing ? progress.detail : progress.status === 'queued' ? 'Đã xếp hàng · Chờ AI xử lý' : 'Chờ kết quả phân tích AI',
      status: analyzing ? 'analyzing' : 'pending',
    });
  }
  return [...activities.values()].sort((a, b) => Number(b.status === 'analyzing') - Number(a.status === 'analyzing'));
});
const aiAnalyzingCount = computed(() => analysisActivities.value.filter((activity) => activity.status === 'analyzing').length);
const aiPendingCount = computed(() => analysisActivities.value.filter((activity) => activity.status === 'pending').length);
const aiVerificationCount = computed(() => items.value.filter((item) => aiProgress(item)?.status === 'verification').length);

function refresh(quiet = true) {
  return fetchItems(scope.value, props.asUserId, quiet, searchQuery.value);
}

function contactName(item: ConversationWorkItem) {
  return item.metadata?.contactName || item.contact?.crmName || item.contact?.fullName || 'Khách hàng';
}

function contextLabel(item: ConversationWorkItem) {
  if (!item.metadata?.isGroup) return 'Tình huống';
  const sender = item.metadata.actionableSenderName?.trim();
  return sender || 'Thành viên';
}

function isVerification(item: ConversationWorkItem) {
  const actionKey = (item.metadata as (ConversationWorkItem['metadata'] & { actionKey?: string }) | null)?.actionKey;
  return item.kind === 'verification' || actionKey === 'clarify_latest_message' || actionKey === 'verify_customer_identity';
}

function avatar(item: ConversationWorkItem) {
  return item.metadata?.contactAvatar || item.contact?.avatarUrl || null;
}

function initial(item: ConversationWorkItem) {
  return contactName(item).trim().charAt(0).toUpperCase() || '?';
}

function priorityLabel(priority: WorkItemPriority) {
  return { critical: 'Khẩn cấp', high: 'Ưu tiên cao', normal: 'Bình thường', low: 'Theo dõi' }[priority];
}

function nickLabel(item: ConversationWorkItem) {
  const nicks = item.metadata?.nickNames?.filter(Boolean) ?? [];
  if (!nicks.length) return item.conversation?.zaloAccount?.displayName || '';
  if (nicks.length <= 2) return nicks.join(', ');
  return `${nicks.slice(0, 2).join(', ')} +${nicks.length - 2} nick`;
}

function aiProgress(item: ConversationWorkItem): { status: AiProgressStatus; label: string; detail: string } | null {
  const status = item.metadata?.aiStatus;
  if (status) {
    return {
      status,
      label: item.metadata?.aiStatusLabel || aiStatusLabel(status),
      detail: item.metadata?.aiStatusDetail || aiStatusDetail(status),
    };
  }
  if (item.confidence != null) {
    return { status: 'ready', label: 'AI đã phân tích xong', detail: 'AI đã phân tích hội thoại và tạo đề xuất xử lý cho nhân viên.' };
  }
  return null;
}

function aiStatusLabel(status: AiProgressStatus) {
  return {
    pending: 'Chờ kết quả phân tích AI',
    queued: 'Đang chờ AI xử lý',
    analyzing: 'AI đang phân tích tin nhắn mới',
    ready: 'AI đã phân tích xong',
    verification: 'Chờ nhân viên xác minh',
    failed: 'AI chưa phân tích thành công',
    not_applicable: 'Không cần AI phân tích',
  }[status];
}

function aiStatusDetail(status: AiProgressStatus) {
  return {
    pending: 'Chưa có kết quả cho tin nhắn mới nhất.',
    queued: 'Tin nhắn mới nhất đã được đưa vào hàng đợi phân tích.',
    analyzing: 'Hệ thống đang đọc tin nhắn mới để xác định tình huống và việc cần làm.',
    ready: 'AI đã phân tích hội thoại và tạo đề xuất xử lý cho nhân viên.',
    verification: 'Tin nhắn chưa đủ chắc chắn, cần nhân viên kiểm tra trước khi xử lý.',
    failed: 'Nhân viên vẫn có thể xử lý công việc trong khi hệ thống thử lại.',
    not_applicable: 'Việc này đến từ lịch hẹn, follow-up hoặc nội dung bị giới hạn quyền riêng tư.',
  }[status];
}

function deadline(item: ConversationWorkItem): { label: string; overdue: boolean } | null {
  const raw = item.status === 'snoozed' ? item.snoozedUntil : item.dueAt;
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  if (item.status === 'snoozed') {
    return { label: `Mở lại ${new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)}`, overdue: false };
  }
  if (abs < 60_000) return { label: diff < 0 ? 'Đến hạn' : 'Sắp đến hạn', overdue: diff < 0 };
  if (abs < 3_600_000) return { label: diff < 0 ? `Trễ ${Math.floor(abs / 60_000)} phút` : `Còn ${Math.ceil(abs / 60_000)} phút`, overdue: diff < 0 };
  if (abs < 86_400_000) return { label: diff < 0 ? `Trễ ${Math.floor(abs / 3_600_000)} giờ` : `Còn ${Math.ceil(abs / 3_600_000)} giờ`, overdue: diff < 0 };
  if (diff < 0) return { label: `Trễ ${Math.floor(abs / 86_400_000)} ngày`, overdue: true };
  return { label: new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date), overdue: diff < 0 };
}

function openItem(item: ConversationWorkItem) {
  snoozeOpenId.value = null;
  if (item.conversationId) {
    if (props.previewEnabled) { emit('preview-conversation', item.conversationId, item); return; }
    void router.push(props.mobile
      ? `/m/c/${item.conversationId}`
      : { name: 'Chat', params: { convId: item.conversationId } });
    return;
  }
  void router.push(props.mobile ? `/m/customers/${item.contactId}` : { path: '/contacts', query: { focus: item.contactId } });
}

function openAnalysisConversation(conversationId: string) {
  if (props.previewEnabled) {
    emit('preview-conversation', conversationId, items.value.find((item) => item.conversationId === conversationId) ?? null);
    return;
  }
  void router.push(props.mobile
    ? `/m/c/${conversationId}`
    : { name: 'Chat', params: { convId: conversationId } });
}

function openAi(item: ConversationWorkItem) {
  if (!item.conversationId) return;
  snoozeOpenId.value = null;
  void router.push(props.mobile
    ? { path: `/m/c/${item.conversationId}`, query: { ai: '1' } }
    : { name: 'Chat', params: { convId: item.conversationId }, query: { ai: '1' } });
}

function toggleSnooze(id: string) {
  snoozeOpenId.value = snoozeOpenId.value === id ? null : id;
}

function openAll() {
  void router.push(props.mobile ? '/m/work-items' : '/work-items');
}

async function mutate(item: ConversationWorkItem, action: 'complete' | 'reopen') {
  await performAction(item, action);
}

async function snooze(item: ConversationWorkItem, snoozeMinutes: number) {
  snoozeOpenId.value = null;
  await performAction(item, 'snooze', { snoozeMinutes });
}

async function snoozeTomorrow(item: ConversationWorkItem) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  snoozeOpenId.value = null;
  await performAction(item, 'snooze', { snoozedUntil: tomorrow.toISOString() });
}

async function performAction(item: ConversationWorkItem, action: 'complete' | 'reopen' | 'snooze', options?: { snoozeMinutes?: number; snoozedUntil?: string }) {
  if (mutatingId.value) return null;
  try {
    const updated = await updateItem(item.id, action, options);
    const result = { ...item, ...updated };
    emit('item-updated', result);
    toast.success(action === 'complete' ? 'Đã hoàn thành công việc' : action === 'reopen' ? 'Đã mở lại công việc' : 'Đã hoãn công việc');
    await refresh(true);
    return result;
  } catch {
    toast.error('Không cập nhật được công việc. Hãy tải lại danh sách và thử lại.');
    return null;
  }
}

function closeMenus(event: MouseEvent) {
  if (!(event.target as HTMLElement).closest('.dwq-snooze-wrap')) snoozeOpenId.value = null;
}

watch(scope, (value, previous) => {
  if (value !== previous) emit('scope-change', value);
  void refresh(false);
});
watch(() => props.initialScope, (value) => {
  if (value !== scope.value) scope.value = value;
});
watch(() => props.asUserId, () => void refresh(false));
watch(searchQuery, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void refresh(false), 250);
});
onMounted(() => {
  void refresh(false);
  let lastPollAt = Date.now();
  let polling = false;
  timer = setInterval(() => {
    const interval = aiAnalyzingCount.value > 0 ? 5_000 : aiPendingCount.value > 0 ? 15_000 : 60_000;
    if (document.visibilityState === 'hidden' || loading.value || polling || Date.now() - lastPollAt < interval) return;
    lastPollAt = Date.now();
    polling = true;
    void refresh(true).finally(() => { polling = false; });
  }, 5_000);
  document.addEventListener('click', closeMenus);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
  if (searchTimer) clearTimeout(searchTimer);
  stopRealtime();
  document.removeEventListener('click', closeMenus);
});

defineExpose({ refresh, counts, summary, items, mutatingId, performAction });
</script>

<style scoped>
.dwq { --dwq-border: var(--at-hairline, #e4e8ee); --dwq-text: var(--at-ink, #172033); --dwq-muted: var(--at-body, #5d6878); container-type: inline-size; background: #fff; border: 1px solid var(--dwq-border); border-radius: 8px; color: var(--dwq-text); }
.dwq-head { min-height: 68px; display: grid; grid-template-columns: minmax(200px, 1fr) minmax(260px, 1.7fr) 32px; align-items: center; gap: 16px; padding: 10px 14px; border-bottom: 1px solid var(--dwq-border); }
.dwq-heading { min-width: 0; }
.dwq-title { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 750; }
.dwq-ai-overview { display: inline-flex; align-items: center; gap: 5px; margin-top: 4px; font-size: 10px; font-weight: 650; }
.dwq-ai-overview--active { color: #087daf; }
.dwq-ai-overview--pending { color: #8a4b08; }
.dwq-ai-overview--verification { color: #667085; }
.dwq-ai-idle { margin-top: 4px; color: #667085; font-size: 10px; }
.dwq-ai-bar { min-width: 0; max-height: 172px; overflow-y: auto; scrollbar-width: thin; }
.dwq-ai-activity-row { display: block; width: 100%; min-width: 0; padding: 6px 2px; border: 0; border-bottom: 1px solid var(--dwq-border); background: transparent; color: #475467; font: inherit; text-align: left; cursor: pointer; }
.dwq-ai-activity-row:last-child { border-bottom: 0; }
.dwq-ai-activity-row:hover { background: #f4fbfd; }
.dwq-ai-activity-row:focus-visible { outline: 2px solid #087daf; outline-offset: -2px; }
.dwq-ai-activity-copy { display: flex; align-items: center; gap: 7px; font-size: 11px; min-width: 0; }
.dwq-ai-activity-copy svg { flex-shrink: 0; color: #087daf; }
.dwq-ai-activity-name { color: #172033; min-width: 0; overflow-wrap: anywhere; }
.dwq-ai-activity-nick { min-width: 0; margin-left: auto; color: #667085; font-size: 10px; overflow-wrap: anywhere; }
.dwq-ai-activity-step { display: block; margin: 3px 0 5px 21px; color: #087daf; font-size: 10px; line-height: 1.4; overflow-wrap: anywhere; }
.dwq-ai-track { display: block; position: relative; height: 3px; overflow: hidden; background: #dceff5; border-radius: 2px; }
.dwq-ai-track > span { display: block; width: 35%; height: 100%; background: #087daf; animation: dwq-ai-load 1.5s ease-in-out infinite; }
.dwq-ai-activity-row--pending .dwq-ai-activity-copy svg, .dwq-ai-activity-row--pending .dwq-ai-activity-step { color: #8a4b08; }
.dwq-ai-activity-row--pending .dwq-ai-track { background: #f2e9dc; }
.dwq-ai-activity-row--pending .dwq-ai-track > span { width: 0; animation: none; }
.dwq-ai-bar-idle { display: flex; align-items: center; gap: 7px; min-height: 38px; color: #667085; font-size: 11px; }
@keyframes dwq-ai-load { 0% { transform: translateX(-100%); } 100% { transform: translateX(290%); } }
@media (prefers-reduced-motion: reduce) { .dwq-ai-track > span, .dwq-spin { animation: none !important; } }
@container (max-width: 620px) {
  .dwq-head { grid-template-columns: minmax(0, 1fr) 32px; gap: 8px; }
  .dwq-head > .dwq-icon-btn { grid-column: 2; grid-row: 1; }
  .dwq-ai-bar { grid-column: 1 / -1; grid-row: 2; }
}
.dwq-icon-btn, .dwq-actions > button, .dwq-snooze-wrap > button { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 32px; border: 1px solid var(--dwq-border); border-radius: 6px; background: #fff; color: #4e5c6d; cursor: pointer; }
.dwq-icon-btn:hover, .dwq-actions button:hover:not(:disabled) { background: #f3f6f8; color: #087daf; }
.dwq-icon-btn:disabled, .dwq-actions button:disabled { opacity: .5; cursor: default; }
.dwq-spin { animation: dwq-spin .8s linear infinite; }
@keyframes dwq-spin { to { transform: rotate(360deg); } }
.dwq-tools { display: flex; align-items: center; gap: 7px; min-height: 42px; padding: 6px 10px; border-bottom: 1px solid var(--dwq-border); color: #667085; }
.dwq-tools input { min-width: 0; flex: 1; height: 30px; padding: 0 8px; border: 1px solid #d0d5dd; border-radius: 6px; color: #172033; background: #fff; font: inherit; font-size: 11.5px; outline: none; }
.dwq-tools input:focus { border-color: #087daf; box-shadow: 0 0 0 2px rgba(8, 125, 175, .12); }
.dwq-total { flex: 0 0 auto; color: #667085; font-size: 10.5px; white-space: nowrap; }
.dwq-tabs { display: flex; gap: 2px; padding: 7px 10px; overflow-x: auto; border-bottom: 1px solid var(--dwq-border); scrollbar-width: none; }
.dwq-tabs::-webkit-scrollbar { display: none; }
.dwq-tabs button { min-height: 30px; display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border: 0; border-radius: 6px; background: transparent; color: #667085; font: inherit; font-size: 11px; font-weight: 650; white-space: nowrap; cursor: pointer; }
.dwq-tabs button:hover { background: #f4f6f8; }
.dwq-tabs button.active { background: #e9f5fb; color: #087daf; }
.dwq-tabs span { min-width: 18px; padding: 1px 5px; border-radius: 999px; background: rgba(83, 96, 112, .1); font-size: 10px; text-align: center; }
.dwq-list { max-height: 520px; overflow-y: auto; }
.dwq-load-more { width: 100%; min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-top: 1px solid var(--dwq-border); background: #fff; color: #087daf; font: inherit; font-size: 11.5px; font-weight: 750; cursor: pointer; }
.dwq-load-more:hover:not(:disabled) { background: #f4fbfd; }
.dwq-load-more:disabled { opacity: .65; cursor: default; }
.dwq-all { width: 100%; min-height: 40px; display: flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-top: 1px solid var(--dwq-border); border-radius: 0 0 8px 8px; background: #fff; color: #087daf; font: inherit; font-size: 11.5px; font-weight: 750; cursor: pointer; }
.dwq-all:hover { background: #f4fbfd; }
.dwq-row { position: relative; display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 11px; padding: 12px 13px; border-bottom: 1px solid var(--dwq-border); cursor: pointer; }
.dwq-row:last-child { border-bottom: 0; }
.dwq-row:hover { background: #fbfcfd; }
.dwq-row--selected { background: #eef8fc; box-shadow: inset 0 0 0 1px #8bcde3; }
.dwq-row:focus-visible { outline: 2px solid #087daf; outline-offset: -2px; }
.dwq-row::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: #98a2b3; }
.dwq-row--critical::before { background: #d92d20; }
.dwq-row--high::before { background: #e47b14; }
.dwq-row--normal::before { background: #1570ef; }
.dwq-row--low::before { background: #667085; }
.dwq-avatar { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 50%; overflow: hidden; background: #e8f2f7; color: #176b91; font-size: 14px; font-weight: 750; }
.dwq-avatar img { width: 100%; height: 100%; object-fit: cover; }
.dwq-body { min-width: 0; }
.dwq-topline { min-height: 22px; display: flex; align-items: center; gap: 7px; }
.dwq-name { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.dwq-priority { flex-shrink: 0; padding: 2px 6px; border-radius: 4px; background: #f2f4f7; color: #475467; font-size: 9.5px; font-weight: 750; }
.dwq-priority--critical { background: #fee4e2; color: #b42318; }
.dwq-priority--high { background: #fff0da; color: #a15c07; }
.dwq-priority--normal { background: #eaf2ff; color: #175cd3; }
.dwq-topline time { margin-left: auto; flex-shrink: 0; color: #667085; font-size: 10px; }
.dwq-topline time.overdue { color: #b42318; font-weight: 700; }
.dwq-context { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 6px; margin-top: 5px; }
.dwq-context > span, .dwq-next span { color: #667085; font-size: 10px; font-weight: 650; }
.dwq-context p { margin: 0; color: #344054; font-size: 11.5px; line-height: 1.45; overflow-wrap: anywhere; }
.dwq-context p { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.dwq-context--verify p { color: #8a4b08; }
.dwq-next { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 5px; align-items: start; margin-top: 6px; color: #087daf; }
.dwq-next > div { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 6px; }
.dwq-next strong { color: #172033; font-size: 11.5px; line-height: 1.4; overflow-wrap: anywhere; }
.dwq-reason { display: flex; align-items: flex-start; gap: 5px; margin: 5px 0 0 21px; color: #667085; font-size: 10.5px; line-height: 1.4; }
.dwq-reason svg { flex-shrink: 0; margin-top: 1px; }
.dwq-meta { display: flex; flex-wrap: wrap; gap: 5px 10px; margin-top: 7px; color: #697586; font-size: 10px; }
.dwq-meta span { display: inline-flex; align-items: center; min-width: 0; gap: 4px; }
.dwq-ai-status { font-weight: 700; }
.dwq-ai-status--analyzing { color: #087daf; }
.dwq-ai-status--ready { color: #087443; }
.dwq-ai-status--verification { color: #a15c07; }
.dwq-ai-status--failed { color: #b42318; }
.dwq-ai-status--pending { color: #667085; }
.dwq-ai-status--not_applicable { color: #667085; }
.dwq-ai-step { margin: 5px 0 0; color: #475467; font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
.dwq-actions { display: flex; align-items: flex-start; gap: 5px; }
.dwq-snooze-wrap { position: relative; }
.dwq-snooze-menu { position: absolute; z-index: 20; top: 36px; right: 0; width: 142px; padding: 4px; border: 1px solid var(--dwq-border); border-radius: 7px; background: #fff; box-shadow: 0 10px 30px rgba(16, 24, 40, .16); }
.dwq-snooze-menu button { width: 100%; padding: 7px 8px; border: 0; border-radius: 5px; background: transparent; color: #344054; font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
.dwq-snooze-menu button:hover { background: #f2f4f7; }
.dwq-state { min-height: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 22px; color: #667085; text-align: center; }
.dwq-state strong { color: #344054; font-size: 13px; }
.dwq-state span { max-width: 380px; font-size: 11px; line-height: 1.5; }
.dwq-state--error { color: #b42318; }
.dwq-state button { margin-top: 4px; padding: 6px 10px; border: 1px solid #fda29b; border-radius: 6px; background: #fff; color: #b42318; font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
.dwq-loading { display: grid; gap: 10px; padding: 14px; }
.dwq-loading span { height: 70px; border-radius: 6px; background: #f0f2f5; animation: dwq-pulse .9s ease-in-out infinite alternate; }
@keyframes dwq-pulse { to { opacity: .5; } }
.dwq--mobile { margin: 0 var(--m-sp-4, 16px) var(--m-sp-3, 12px); border: 0; border-radius: var(--m-r-lg, 8px); box-shadow: var(--m-e1, 0 1px 3px rgba(16, 24, 40, .12)); }
@container (max-width: 780px) {
  .dwq-row { grid-template-columns: 36px minmax(0, 1fr); }
  .dwq-actions { grid-column: 2; justify-content: flex-end; }
  .dwq-topline { flex-wrap: wrap; }
  .dwq-name { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
}
.dwq--mobile .dwq-head { padding: 10px 12px; }
.dwq--mobile .dwq-tools { padding: 6px 8px; }
.dwq--mobile .dwq-total { display: none; }
.dwq--mobile .dwq-tabs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding: 6px 8px; overflow: visible; }
.dwq--mobile .dwq-tabs button { min-width: 0; justify-content: center; padding-inline: 5px; white-space: normal; text-align: center; line-height: 1.2; }
.dwq--mobile .dwq-list { max-height: none; }
.dwq--mobile .dwq-row { grid-template-columns: 36px minmax(0, 1fr); gap: 9px; padding: 11px 10px; }
.dwq--mobile .dwq-avatar { width: 36px; height: 36px; }
.dwq--mobile .dwq-priority { order: 3; }
.dwq--mobile .dwq-topline { flex-wrap: wrap; gap: 4px 6px; }
.dwq--mobile .dwq-name { max-width: calc(100% - 80px); }
.dwq--mobile .dwq-topline time { order: 2; }
.dwq--mobile .dwq-context { grid-template-columns: 1fr; gap: 1px; }
.dwq--mobile .dwq-context p { -webkit-line-clamp: 4; }
.dwq--mobile .dwq-next > div { grid-template-columns: 1fr; gap: 1px; }
.dwq--mobile .dwq-reason { display: none; }
.dwq--mobile .dwq-meta { margin-top: 6px; }
.dwq--mobile .dwq-actions { grid-column: 2; justify-content: flex-end; margin-top: -1px; }
@media (max-width: 720px) {
  .dwq-head { grid-template-columns: minmax(0, 1fr) 32px; gap: 8px; }
  .dwq-head > .dwq-icon-btn { grid-column: 2; grid-row: 1; }
  .dwq-ai-bar { grid-column: 1 / -1; grid-row: 2; }
  .dwq:not(.dwq--mobile) .dwq-row { grid-template-columns: 36px minmax(0, 1fr); }
  .dwq:not(.dwq--mobile) .dwq-actions { grid-column: 2; justify-content: flex-end; }
}
</style>
