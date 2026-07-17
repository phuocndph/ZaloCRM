<template>
  <section class="admin-center">
    <aside class="center-nav" aria-label="Điều hướng Trung tâm quản trị AI">
      <div v-for="group in navigation" :key="group.label" class="nav-group">
        <p class="nav-group-label">{{ group.label }}</p>
        <button
          v-for="item in group.items"
          :key="item.key"
          type="button"
          class="nav-item"
          :class="{ active: selected === item.key }"
          :aria-current="selected === item.key ? 'page' : undefined"
          @click="selectSection(item.key)"
        >
          <span class="nav-icon mdi" :class="item.icon" aria-hidden="true" />
          <span class="nav-label">{{ item.label }}</span>
          <span v-if="!item.available" class="pending-dot" title="Chưa triển khai" aria-label="Chưa triển khai" />
        </button>
      </div>
    </aside>

    <div class="center-main">
      <header class="center-header">
        <div class="section-heading">
          <div class="heading-row">
            <h2>{{ current.label }}</h2>
            <span v-if="!current.available" class="status-badge">Chưa triển khai</span>
          </div>
          <p>{{ current.description }}</p>
        </div>

        <div class="header-actions">
          <div v-if="showDateFilter" class="date-filter" aria-label="Khoảng thời gian báo cáo">
            <label>
              <span>Từ ngày</span>
              <input v-model="from" type="date" @change="loadCurrent" />
            </label>
            <label>
              <span>Đến ngày</span>
              <input v-model="to" type="date" @change="loadCurrent" />
            </label>
          </div>
          <button
            type="button"
            class="emergency-button"
            :class="{ active: emergency }"
            :disabled="emergencySaving || summaryLoading || !summary"
            @click="toggleEmergency"
          >
            <span class="mdi" :class="emergency ? 'mdi-play-circle-outline' : 'mdi-stop-circle-outline'" aria-hidden="true" />
            {{ emergencySaving ? 'Đang cập nhật…' : emergency ? 'Bật lại tự động trả lời' : 'Dừng tự động trả lời' }}
          </button>
        </div>
      </header>

      <div class="content-body">
        <template v-if="selected === 'overview'">
          <div v-if="summaryLoading" class="skeleton-grid" aria-label="Đang tải tổng quan">
            <div v-for="index in 8" :key="index" class="skeleton-card"><i /><i /></div>
          </div>

          <div v-else-if="error" class="state-card error-state" role="alert">
            <span class="mdi mdi-alert-circle-outline" aria-hidden="true" />
            <div><strong>Không tải được dữ liệu tổng quan</strong><p>{{ error }}</p></div>
            <button type="button" @click="loadSummary">Thử lại</button>
          </div>

          <div v-else-if="!summary" class="state-card">
            <span class="mdi mdi-chart-box-outline" aria-hidden="true" />
            <div><strong>Chưa có dữ liệu</strong><p>Chưa ghi nhận hoạt động AI trong khoảng thời gian đã chọn.</p></div>
          </div>

          <template v-else>
            <div class="metrics">
              <article v-for="item in cards" :key="item.label">
                <span>{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
                <small>{{ item.hint }}</small>
              </article>
            </div>

            <div v-if="summary.alerts?.length" class="alerts" aria-label="Cảnh báo AI">
              <p v-for="alert in summary.alerts" :key="alert.code" :class="alert.level">
                <span class="mdi mdi-alert-outline" aria-hidden="true" />
                {{ alert.message }}
              </p>
            </div>

            <div class="overview-grid">
              <section class="overview-card">
                <div class="card-heading"><h3>Ý định phổ biến</h3><span>{{ summary.topIntents?.length || 0 }} nhóm</span></div>
                <div v-if="summary.topIntents?.length" class="intent-list">
                  <div v-for="item in summary.topIntents" :key="item.label">
                    <span>{{ item.label }}</span><strong>{{ item.count }}</strong>
                  </div>
                </div>
                <p v-else class="inline-empty">Chưa có dữ liệu ý định trong khoảng thời gian này.</p>
              </section>
              <section class="overview-card knowledge-gap-card">
                <div class="card-heading"><h3>Kho tri thức còn thiếu</h3><span>Cần rà soát</span></div>
                <strong>{{ summary.metrics?.knowledgeGaps ?? 0 }}</strong>
                <p>Mục đang chờ quản trị viên xem xét hoặc phê duyệt.</p>
                <button type="button" @click="selectSection('knowledge')">Mở kho tri thức</button>
              </section>
            </div>
          </template>
        </template>

        <AgentManagerPanel v-else-if="selected === 'agents'" />
        <SkillManagerPanel v-else-if="selected === 'skills'" />
        <LearningManagerPanel v-else-if="selected === 'learning'" />
        <EvaluationManagerPanel v-else-if="selected === 'evaluations'" />
        <ReleaseManagerPanel v-else-if="selected === 'deploy'" />
        <PromptManagerPanel v-else-if="selected === 'prompts'" />
        <KnowledgeBasePanel v-else-if="selected === 'knowledge'" />
        <FeedbackManagerPanel v-else-if="selected === 'feedback'" />
        <ModelsConnectionsPanel v-else-if="selected === 'models'" />

        <template v-else-if="selected === 'audit'">
          <div class="audit-toolbar">
            <p>Nhật ký không hiển thị secret hoặc nội dung nhạy cảm.</p>
            <button type="button" :disabled="auditLoading" @click="loadAudit">
              <span class="mdi mdi-refresh" aria-hidden="true" />
              {{ auditLoading ? 'Đang tải…' : 'Làm mới nhật ký' }}
            </button>
          </div>
          <div v-if="auditLoading" class="list-loading">Đang tải nhật ký kiểm toán…</div>
          <div v-else-if="error" class="state-card error-state" role="alert">
            <span class="mdi mdi-alert-circle-outline" aria-hidden="true" />
            <div><strong>Không tải được nhật ký</strong><p>{{ error }}</p></div>
            <button type="button" @click="loadAudit">Thử lại</button>
          </div>
          <div v-else-if="!logs.length" class="state-card">
            <span class="mdi mdi-text-box-search-outline" aria-hidden="true" />
            <div><strong>Chưa có nhật ký</strong><p>Không có sự kiện quản trị AI trong khoảng thời gian đã chọn.</p></div>
          </div>
          <div v-else class="logs">
            <article v-for="log in logs" :key="log.id">
              <span class="audit-icon mdi mdi-shield-check-outline" aria-hidden="true" />
              <div><strong>{{ log.eventType }}</strong><p>{{ log.outcome }}</p></div>
              <time :datetime="log.createdAt">{{ formatDate(log.createdAt) }}</time>
            </article>
          </div>
        </template>

        <section v-else class="not-implemented">
          <div class="not-implemented-icon"><span class="mdi" :class="current.icon" aria-hidden="true" /></div>
          <span class="status-badge">Chưa triển khai</span>
          <h3>{{ current.label }} chưa sẵn sàng sử dụng</h3>
          <p>{{ current.description }}</p>
          <div class="implementation-note">
            <span class="mdi mdi-information-outline" aria-hidden="true" />
            <p>Mục này đang được xây dựng theo quy trình AI có kiểm soát. Chưa có thao tác nào tại đây tác động đến dữ liệu production.</p>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api/index';
import AgentManagerPanel from '@/components/ai/AgentManagerPanel.vue';
import FeedbackManagerPanel from '@/components/ai/FeedbackManagerPanel.vue';
import ModelsConnectionsPanel from '@/components/ai/ModelsConnectionsPanel.vue';
import KnowledgeBasePanel from '@/components/ai/KnowledgeBasePanel.vue';
import LearningManagerPanel from '@/components/ai/LearningManagerPanel.vue';
import EvaluationManagerPanel from '@/components/ai/EvaluationManagerPanel.vue';
import PromptManagerPanel from '@/components/ai/PromptManagerPanel.vue';
import ReleaseManagerPanel from '@/components/ai/ReleaseManagerPanel.vue';
import SkillManagerPanel from '@/components/ai/SkillManagerPanel.vue';

type SectionKey =
  | 'overview' | 'agents' | 'skills' | 'prompts' | 'knowledge'
  | 'learning' | 'evaluations' | 'auto_reply' | 'feedback' | 'logs'
  | 'usage' | 'models' | 'security' | 'audit' | 'deploy';

type NavigationItem = {
  key: SectionKey;
  label: string;
  description: string;
  icon: string;
  available: boolean;
};

type Summary = {
  metrics?: Record<string, number | string | null | undefined>;
  alerts?: Array<{ code: string; level: string; message: string }>;
  topIntents?: Array<{ label: string; count: number }>;
};

type AuditLog = {
  id: string;
  eventType: string;
  outcome: string;
  createdAt: string;
};

const navigation: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: 'Tổng quan',
    items: [
      { key: 'overview', label: 'Tổng quan vận hành', description: 'Theo dõi mức sử dụng, chất lượng, cảnh báo và trạng thái vận hành AI.', icon: 'mdi-view-dashboard-outline', available: true },
    ],
  },
  {
    label: 'Xây dựng',
    items: [
      { key: 'agents', label: 'Tác nhân AI', description: 'Quản lý tác nhân, vai trò, phạm vi dữ liệu và khả năng được cấp.', icon: 'mdi-account-cog-outline', available: true },
      { key: 'skills', label: 'Kỹ năng', description: 'Quản lý kỹ năng, quy tắc an toàn và ràng buộc tác vụ.', icon: 'mdi-puzzle-outline', available: true },
      { key: 'prompts', label: 'Lời nhắc', description: 'Quản lý phiên bản, kiểm thử, phê duyệt và khôi phục lời nhắc.', icon: 'mdi-message-text-outline', available: true },
      { key: 'knowledge', label: 'Kho tri thức', description: 'Quản lý nguồn, tài liệu, lập chỉ mục và phê duyệt kiến thức.', icon: 'mdi-book-open-page-variant-outline', available: true },
    ],
  },
  {
    label: 'Cải thiện',
    items: [
      { key: 'feedback', label: 'Phản hồi', description: 'Rà soát phản hồi của nhân viên và các mẫu học đang chờ duyệt.', icon: 'mdi-message-alert-outline', available: true },
      { key: 'learning', label: 'Học có kiểm soát', description: 'Kiểm duyệt dữ liệu đã che thông tin nhạy cảm trước khi đưa vào đánh giá.', icon: 'mdi-school-outline', available: true },
      { key: 'evaluations', label: 'Đánh giá', description: 'Quản lý bộ ca kiểm thử, lượt chạy, ngưỡng chất lượng và cổng áp dụng.', icon: 'mdi-clipboard-check-outline', available: true },
    ],
  },
  {
    label: 'Vận hành',
    items: [
      { key: 'auto_reply', label: 'Tự động trả lời', description: 'Quản lý chế độ mô phỏng, phạm vi, ngưỡng tin cậy và bàn giao cho nhân viên.', icon: 'mdi-reply-all-outline', available: false },
      { key: 'logs', label: 'Nhật ký chạy', description: 'Truy vết lượt chạy, lỗi, model, lời nhắc và nguồn tri thức đã sử dụng.', icon: 'mdi-text-box-search-outline', available: false },
      { key: 'usage', label: 'Sử dụng & chi phí', description: 'Theo dõi token, chi phí, ngân sách và xu hướng sử dụng theo tác vụ.', icon: 'mdi-chart-line', available: false },
    ],
  },
  {
    label: 'Quản trị',
    items: [
      { key: 'models', label: 'Mô hình & kết nối', description: 'Cấu hình nhà cung cấp, model, kết nối 9router và phương án dự phòng.', icon: 'mdi-connection', available: true },
      { key: 'security', label: 'Bảo mật', description: 'Quản lý quyền, dữ liệu riêng tư, chính sách và an toàn công cụ.', icon: 'mdi-shield-lock-outline', available: false },
      { key: 'audit', label: 'Kiểm toán', description: 'Theo dõi sự kiện quản trị AI không chứa secret hoặc payload nhạy cảm.', icon: 'mdi-file-document-check-outline', available: true },
      { key: 'deploy', label: 'Áp dụng & khôi phục', description: 'Áp dụng phiên bản đã đạt đánh giá và khôi phục về phiên bản đã duyệt.', icon: 'mdi-rocket-launch-outline', available: true },
    ],
  },
];

const allItems = navigation.flatMap((group) => group.items);
const validKeys = new Set<SectionKey>(allItems.map((item) => item.key));
const route = useRoute();
const router = useRouter();
const summary = ref<Summary | null>(null);
const logs = ref<AuditLog[]>([]);
const summaryLoading = ref(false);
const auditLoading = ref(false);
const emergencySaving = ref(false);
const auditLoaded = ref(false);
const error = ref('');
const to = ref(new Date().toISOString().slice(0, 10));
const from = ref(new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10));

const selected = computed<SectionKey>(() => {
  const raw = Array.isArray(route.params.section) ? route.params.section[0] : route.params.section;
  return raw && validKeys.has(raw as SectionKey) ? raw as SectionKey : 'overview';
});

const current = computed(() => allItems.find((item) => item.key === selected.value) || allItems[0]);
const showDateFilter = computed(() => selected.value === 'overview' || selected.value === 'audit');
const emergency = computed(() => !!summary.value?.alerts?.some((alert) => alert.code === 'EMERGENCY_STOP_ACTIVE'));

const cards = computed(() => {
  const metrics = summary.value?.metrics || {};
  return [
    { label: 'AI xử lý', value: metrics.aiProcessed ?? 0, hint: 'Lượt yêu cầu' },
    { label: 'Gợi ý', value: metrics.suggestions ?? 0, hint: 'Đã tạo' },
    { label: 'Nhân viên dùng', value: metrics.employeeUsed ?? 0, hint: 'Lượt chấp nhận' },
    { label: 'Tỷ lệ sửa', value: String(metrics.editRate ?? 0) + '%', hint: 'Trước khi gửi' },
    { label: 'Tự gửi', value: metrics.autoSent ?? 0, hint: 'Auto Reply' },
    { label: 'Bàn giao', value: metrics.handoffs ?? 0, hint: 'Cho nhân viên' },
    { label: 'Tỷ lệ lỗi', value: String(metrics.errorRate ?? 0) + '%', hint: 'Theo lượt chạy' },
    { label: 'Chi phí (µ)', value: metrics.costMicros ?? 0, hint: 'Trong kỳ' },
  ];
});

function errorText(errorValue: any, fallback: string) {
  return errorValue?.response?.data?.error || errorValue?.message || fallback;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('vi-VN');
}

function selectSection(key: SectionKey) {
  const path = key === 'overview'
    ? '/settings/crm/ai-assistant'
    : '/settings/crm/ai-assistant/' + key;
  void router.push(path);
}

async function loadSummary() {
  summaryLoading.value = true;
  error.value = '';
  try {
    const response = await api.get<Summary>('/ai/admin-center/summary', { params: { from: from.value, to: to.value } });
    summary.value = response.data;
  } catch (loadError) {
    error.value = errorText(loadError, 'Không tải được Trung tâm quản trị AI');
  } finally {
    summaryLoading.value = false;
  }
}

async function loadAudit() {
  auditLoading.value = true;
  error.value = '';
  try {
    const response = await api.get<{ logs: AuditLog[] }>('/ai/admin-center/audit', { params: { from: from.value, to: to.value } });
    logs.value = response.data.logs || [];
    auditLoaded.value = true;
  } catch (loadError) {
    error.value = errorText(loadError, 'Không tải được nhật ký kiểm toán');
  } finally {
    auditLoading.value = false;
  }
}

function loadCurrent() {
  if (selected.value === 'audit') void loadAudit();
  else void loadSummary();
}

async function toggleEmergency() {
  if (!summary.value || emergencySaving.value) return;
  const prompt = emergency.value
    ? 'Bật lại tính năng tự động trả lời? Các điều kiện vận hành hiện tại sẽ được áp dụng.'
    : 'Dừng toàn bộ tính năng tự động trả lời? Trợ lý gợi ý cho nhân viên vẫn hoạt động.';
  if (!window.confirm(prompt)) return;

  emergencySaving.value = true;
  error.value = '';
  try {
    await api.post('/ai/admin-center/emergency-stop', { enabled: !emergency.value });
    await loadSummary();
  } catch (updateError) {
    error.value = errorText(updateError, 'Không cập nhật được trạng thái tự động trả lời');
  } finally {
    emergencySaving.value = false;
  }
}

watch(selected, (value) => {
  error.value = '';
  if (value === 'audit' && !auditLoaded.value) void loadAudit();
});

onMounted(() => {
  const raw = Array.isArray(route.params.section) ? route.params.section[0] : route.params.section;
  if (raw && !validKeys.has(raw as SectionKey)) void router.replace('/settings/crm/ai-assistant');
  void loadSummary();
  if (selected.value === 'audit') void loadAudit();
});
</script>

<style scoped>
.admin-center {
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
  width: 100%;
  min-height: 680px;
  overflow: hidden;
  border: 1px solid #dbe4f0;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
}

.center-nav {
  padding: 12px 10px 20px;
  border-right: 1px solid #e2e8f0;
  background: #f8fafc;
  overflow-y: auto;
}

.nav-group + .nav-group { margin-top: 15px; }
.nav-group-label { margin: 0 8px 5px; color: #94a3b8; font-size: 10px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.nav-item { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 36px; padding: 7px 9px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: #475569; font: 500 12px/1.35 inherit; text-align: left; cursor: pointer; }
.nav-item:hover { background: #fff; color: #1e293b; }
.nav-item.active { border-color: #bfdbfe; background: #eaf2ff; color: #1d4ed8; font-weight: 700; }
.nav-icon { flex: 0 0 18px; width: 18px; font-size: 17px; text-align: center; }
.nav-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pending-dot { flex: 0 0 6px; width: 6px; height: 6px; margin-left: auto; border-radius: 50%; background: #cbd5e1; }

.center-main { min-width: 0; background: #fff; }
.center-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; min-height: 74px; padding: 16px 18px; border-bottom: 1px solid #e2e8f0; }
.section-heading { min-width: 220px; }
.heading-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.center-header h2 { margin: 0; color: #172033; font-size: 17px; line-height: 1.35; }
.center-header p { margin: 4px 0 0; color: #64748b; font-size: 12px; line-height: 1.5; }
.status-badge { display: inline-flex; align-items: center; padding: 3px 7px; border: 1px solid #fde68a; border-radius: 999px; background: #fffbeb; color: #92400e; font-size: 10px; font-weight: 700; white-space: nowrap; }
.header-actions { display: flex; align-items: flex-end; justify-content: flex-end; gap: 9px; flex-wrap: wrap; }
.date-filter { display: flex; gap: 7px; }
.date-filter label { display: flex; flex-direction: column; gap: 3px; color: #64748b; font-size: 9px; font-weight: 650; text-transform: uppercase; }
.date-filter input { box-sizing: border-box; min-height: 34px; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: #334155; font: 12px inherit; }
.emergency-button { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 6px 10px; border: 1px solid #fecaca; border-radius: 7px; background: #fff; color: #b91c1c; font: 650 11px inherit; cursor: pointer; }
.emergency-button:hover:not(:disabled) { background: #fff1f2; }
.emergency-button.active { border-color: #bbf7d0; background: #f0fdf4; color: #166534; }
.emergency-button:disabled { cursor: not-allowed; opacity: .55; }

.content-body { min-width: 0; padding: 16px; }
.content-body :deep(.pm), .content-body :deep(.kb), .content-body :deep(.feedback-manager) { margin-bottom: 0; }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 10px; }
.metrics article { min-height: 78px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 9px; background: #fff; }
.metrics span, .metrics small { display: block; color: #64748b; font-size: 11px; }
.metrics strong { display: block; margin: 4px 0 2px; color: #0f172a; font-size: 20px; line-height: 1.15; }
.metrics small { color: #94a3b8; font-size: 10px; }
.alerts { display: grid; gap: 7px; margin-top: 12px; }
.alerts p { display: flex; align-items: center; gap: 7px; margin: 0; padding: 9px 10px; border-radius: 7px; font-size: 12px; }
.alerts .warning { background: #fffbeb; color: #92400e; }
.alerts .critical { background: #fff1f2; color: #9f1239; }
.overview-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(240px, .6fr); gap: 12px; margin-top: 12px; }
.overview-card { min-height: 175px; padding: 14px; border: 1px solid #e2e8f0; border-radius: 9px; background: #fff; }
.card-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 9px; border-bottom: 1px solid #f1f5f9; }
.card-heading h3 { margin: 0; color: #334155; font-size: 13px; }
.card-heading span { color: #94a3b8; font-size: 10px; }
.intent-list div { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 2px; border-bottom: 1px solid #f1f5f9; color: #475569; font-size: 12px; }
.intent-list div:last-child { border-bottom: 0; }
.knowledge-gap-card > strong { display: block; margin-top: 16px; color: #0f172a; font-size: 28px; }
.knowledge-gap-card > p, .inline-empty { color: #64748b; font-size: 12px; line-height: 1.5; }
.knowledge-gap-card button { padding: 6px 9px; border: 1px solid #bfdbfe; border-radius: 6px; background: #eff6ff; color: #1d4ed8; font: 650 11px inherit; cursor: pointer; }

.skeleton-grid { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 10px; }
.skeleton-card { min-height: 78px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 9px; }
.skeleton-card i { display: block; width: 55%; height: 9px; margin-bottom: 12px; border-radius: 4px; background: #e2e8f0; animation: pulse 1.25s ease-in-out infinite; }
.skeleton-card i:last-child { width: 35%; height: 19px; }
@keyframes pulse { 50% { opacity: .45; } }

.state-card { display: flex; align-items: center; gap: 12px; min-height: 84px; padding: 16px; border: 1px dashed #cbd5e1; border-radius: 9px; background: #f8fafc; color: #64748b; }
.state-card > .mdi { font-size: 25px; }
.state-card strong { color: #334155; font-size: 13px; }
.state-card p { margin: 3px 0 0; font-size: 12px; }
.state-card button { margin-left: auto; padding: 6px 9px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; cursor: pointer; }
.error-state { border-style: solid; border-color: #fecaca; background: #fff7f7; color: #b91c1c; }
.error-state strong { color: #991b1b; }

.audit-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.audit-toolbar p { margin: 0; color: #64748b; font-size: 11px; }
.audit-toolbar button { display: inline-flex; align-items: center; gap: 5px; padding: 6px 9px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; font: 600 11px inherit; cursor: pointer; }
.audit-toolbar button:disabled { opacity: .55; }
.list-loading { padding: 36px; color: #64748b; font-size: 12px; text-align: center; }
.logs { overflow: hidden; border: 1px solid #e2e8f0; border-radius: 9px; }
.logs article { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
.logs article:last-child { border-bottom: 0; }
.audit-icon { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 7px; background: #f0fdf4; color: #15803d; font-size: 16px; }
.logs strong { color: #334155; font-size: 12px; }
.logs p { margin: 2px 0 0; color: #64748b; font-size: 11px; }
.logs time { color: #94a3b8; font-size: 10px; white-space: nowrap; }

.not-implemented { display: flex; flex-direction: column; align-items: center; max-width: 600px; margin: 46px auto; padding: 30px 24px; color: #64748b; text-align: center; }
.not-implemented-icon { display: grid; width: 54px; height: 54px; margin-bottom: 12px; place-items: center; border-radius: 16px; background: #f1f5f9; color: #64748b; font-size: 27px; }
.not-implemented h3 { margin: 12px 0 6px; color: #334155; font-size: 16px; }
.not-implemented > p { max-width: 520px; margin: 0; font-size: 12px; line-height: 1.6; }
.implementation-note { display: flex; align-items: flex-start; gap: 8px; margin-top: 18px; padding: 10px 12px; border: 1px solid #dbeafe; border-radius: 8px; background: #f8fbff; color: #475569; text-align: left; }
.implementation-note .mdi { color: #2563eb; font-size: 17px; }
.implementation-note p { margin: 0; font-size: 11px; line-height: 1.55; }

@media (max-width: 1100px) {
  .admin-center { grid-template-columns: 196px minmax(0, 1fr); }
  .metrics, .skeleton-grid { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
  .center-header { flex-direction: column; }
  .header-actions { justify-content: flex-start; width: 100%; }
}

@media (max-width: 760px) {
  .admin-center { display: block; min-height: 0; }
  .center-nav { display: flex; gap: 5px; padding: 9px; border-right: 0; border-bottom: 1px solid #e2e8f0; overflow-x: auto; }
  .nav-group { display: contents; }
  .nav-group-label { display: none; }
  .nav-item { flex: 0 0 auto; width: auto; white-space: nowrap; }
  .pending-dot { margin-left: 2px; }
  .center-header { padding: 14px 12px; }
  .content-body { padding: 10px; }
  .date-filter { width: 100%; }
  .date-filter label { flex: 1; }
  .date-filter input { width: 100%; }
  .overview-grid { grid-template-columns: 1fr; }
  .logs article { grid-template-columns: 32px minmax(0, 1fr); }
  .logs time { grid-column: 2; }
}

@media (max-width: 480px) {
  .metrics, .skeleton-grid { grid-template-columns: 1fr 1fr; }
  .header-actions, .emergency-button { width: 100%; }
  .emergency-button { justify-content: center; }
  .state-card { align-items: flex-start; flex-wrap: wrap; }
  .state-card button { margin-left: 0; }
}
</style>
