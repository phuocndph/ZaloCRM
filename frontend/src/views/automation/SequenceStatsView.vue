<!--
═══════════════════════════════════════════════════════════════════════
 Luồng Mục Tiêu M10 — Sequence Stats Dashboard (2026-06-02)
═══════════════════════════════════════════════════════════════════════

 Tab Thống kê cho 1 Sequence. Hero KPI + Funnel per-step + Outcome donut + Health alert.

 6 endpoints wire (BE đã ship Day 1+2):
   GET /automation/sequences/:id/stats/overview     (60s cache)
   GET .../stats/outcomes?range=24h|7d|30d                 (5min cache)
   GET .../stats/funnel?range=7d|30d                       (60s cache)
   GET .../stats/funnel/:stepIdx/skip-breakdown
   GET .../stats/health                                    (30s cache)
   GET .../stats/health/nicks                              (30s cache)

 Mockup reference: 02-sequence-detail-thong-ke.html
-->

<template>
  <div class="stats-page">
    <!-- Page header -->
    <div class="page-header">
      <div>
        <div class="breadcrumb">
          <RouterLink to="/marketing/sequences">Sequences</RouterLink>
          <span class="sep">›</span>
          <span>{{ sequenceName }}</span>
        </div>
        <h1>📊 {{ sequenceName }} — Thống kê</h1>
      </div>
      <button class="back-btn" @click="goBack">← Quay lại</button>
    </div>

    <!-- Loading state -->
    <div v-if="loadingOverview && !overview" class="loading-state">
      <div class="spinner" /> Đang tải...
    </div>

    <template v-else-if="overview">
      <!-- Health alert banner -->
      <div v-if="healthAlerts.length > 0" class="alert-banner" :class="`alert-${healthLevel}`">
        <div class="alert-header">
          ⚠️ Cảnh báo HEALTH ({{ healthAlerts.length }} vấn đề)
        </div>
        <ul class="alert-items">
          <li v-for="(msg, idx) in healthAlerts" :key="idx">{{ msg }}</li>
        </ul>
      </div>

      <!-- Filter bar -->
      <div class="filter-bar">
        <div class="range-buttons">
          <button
            v-for="r in ['24h', '7d', '30d', 'all']"
            :key="r"
            class="range-btn"
            :class="{ active: range === r }"
            @click="setRange(r as RangeType)"
          >
            {{ rangeLabel(r) }}
          </button>
        </div>
        <label class="toggle-system">
          <input type="checkbox" v-model="includeSystem" @change="refetchAll" />
          <span>Bao gồm KH enroll thủ công</span>
          <small>(M9 Mục tiêu hệ thống)</small>
        </label>
      </div>

      <!-- KPI Hero row 1 -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">📨 Đã enroll</div>
          <div class="kpi-value">{{ formatNum(overview.enroll30d) }}</div>
          <div class="kpi-sub">
            contact <span class="delta">+{{ formatNum(overview.enroll24h) }} / 24h</span>
          </div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">▶️ Đang chạy</div>
          <div class="kpi-value">{{ formatNum(activeCount) }}</div>
          <div class="kpi-sub">{{ activePercent }}% — step trung bình {{ avgStep }}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">✅ Hoàn tất</div>
          <div class="kpi-value">{{ formatNum(overview.completedCached) }}</div>
          <div class="kpi-sub">{{ completedPercent }}% — full path</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">❌ Bỏ dở</div>
          <div class="kpi-value">{{ formatNum(droppedCount) }}</div>
          <div class="kpi-sub">{{ droppedPercent }}% — skip + fail</div>
        </div>
      </div>

      <!-- KPI Hero row 2 -->
      <div class="kpi-grid row-2">
        <div class="kpi-card">
          <div class="kpi-label">📈 Enroll mới</div>
          <div class="kpi-value">
            {{ formatNum(overview.enroll24h) }}
            <span class="unit">/ 24h</span>
          </div>
          <div class="kpi-sub">7d: {{ formatNum(overview.enroll7d) }} · 30d: {{ formatNum(overview.enroll30d) }}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">💬 Tin đã gửi</div>
          <div class="kpi-value">
            {{ formatNum(overview.sentMessagesTotal) }}
          </div>
          <div class="kpi-sub">Tổng số tin đã gửi</div>
        </div>
        <div class="kpi-card kpi-donut" v-if="outcomes">
          <div class="donut-wrap">
            <div class="donut" :style="donutStyle(outcomes.rates.replyRate)">
              <div class="donut-value">{{ outcomes.rates.replyRate.toFixed(1) }}%</div>
            </div>
          </div>
          <div>
            <div class="kpi-label">💬 Tỷ lệ Reply</div>
            <div class="kpi-sub">
              {{ formatNum(outcomes.reply) }} / {{ formatNum(outcomes.totalEnrolled) }} trong chuỗi
            </div>
          </div>
        </div>
      </div>

      <!-- FUNNEL section -->
      <div class="section" v-if="funnel">
        <div class="section-header">
          <span>🔻 Funnel theo bước</span>
          <span class="right">{{ rangeLabel(range) }} · Cache 60s</span>
        </div>

        <div
          v-for="step in funnel.steps"
          :key="step.stepIdx"
          class="funnel-row"
        >
          <div class="step-name">
            Bước {{ step.stepIdx + 1 }}
            <span class="sub" v-if="getStepLabel(step.stepIdx)">"{{ getStepLabel(step.stepIdx) }}"</span>
          </div>
          <div class="funnel-bar">
            <div class="funnel-fill" :style="{ width: funnelPct(step) + '%' }">
              {{ formatNum(step.entered) }}
            </div>
          </div>
          <div class="funnel-stats">
            <span>📨 Gửi: {{ formatNum(step.sent) }}</span>
            <span>⏭ Skip: {{ formatNum(step.skipped) }} · ❌ Fail: {{ formatNum(step.failed) }}</span>
          </div>
          <div class="drop-pct" :class="dropClass(step.dropOffPct)">
            {{ step.stepIdx === 0 ? '100%' : `↓ ${step.dropOffPct}%` }}
          </div>
        </div>
      </div>

      <!-- OUTCOME cards -->
      <div class="section" v-if="outcomes">
        <div class="section-header">
          <span>💬 OUTCOME (Reaction + Block + Friend)</span>
          <span class="right">Cache 5 phút</span>
        </div>
        <div class="outcome-grid">
          <div class="outcome-card">
            <div class="outcome-label">Reply rate</div>
            <div class="outcome-icon">💬</div>
            <div class="outcome-value">{{ outcomes.rates.replyRate.toFixed(1) }}%</div>
            <div class="outcome-count">{{ formatNum(outcomes.reply) }} / {{ formatNum(outcomes.totalEnrolled) }}</div>
          </div>
          <div class="outcome-card">
            <div class="outcome-label">Thả tim (+)</div>
            <div class="outcome-icon">❤️👍🌹</div>
            <div class="outcome-value success">{{ outcomes.rates.positiveReactionRate.toFixed(1) }}%</div>
            <div class="outcome-count">{{ formatNum(outcomes.reactionPositive) }} / {{ formatNum(outcomes.totalEnrolled) }}</div>
          </div>
          <div class="outcome-card">
            <div v-if="outcomes.rates.negativeReactionRate > 0.2" class="outcome-alert">⚠️</div>
            <div class="outcome-label">Phản ứng tiêu cực</div>
            <div class="outcome-icon">😡👎</div>
            <div class="outcome-value" :class="outcomes.rates.negativeReactionRate > 0.2 ? 'danger' : ''">
              {{ outcomes.rates.negativeReactionRate.toFixed(1) }}%
            </div>
            <div class="outcome-count">
              {{ formatNum(outcomes.reactionNegative) }} / {{ formatNum(outcomes.totalEnrolled) }}
              <span v-if="outcomes.rates.negativeReactionRate > 0.2"> — > 0.2% warning</span>
            </div>
          </div>
          <div class="outcome-card">
            <div class="outcome-label">KH chặn nick</div>
            <div class="outcome-icon">🚫</div>
            <div class="outcome-value" :class="outcomes.rates.blockRate > 2 ? 'danger' : 'warning'">
              {{ outcomes.rates.blockRate.toFixed(1) }}%
            </div>
            <div class="outcome-count">
              {{ formatNum(outcomes.block) }} / {{ formatNum(outcomes.totalEnrolled) }}
            </div>
          </div>
        </div>
        <div v-if="outcomes.friendAccept > 0 || outcomes.friendReject > 0" class="friend-stat">
          🤝 <strong>Friend accept rate:</strong>
          {{ friendAcceptRate.toFixed(1) }}%
          ({{ formatNum(outcomes.friendAccept) }} /
          {{ formatNum(outcomes.friendAccept + outcomes.friendReject) }} lời mời)
        </div>
      </div>

      <!-- HEALTH section -->
      <div class="section" v-if="health">
        <div class="section-header">
          <span>❤️‍🩹 HEALTH (sức khoẻ realtime)</span>
          <span class="right">30s polling · Page Visibility API</span>
        </div>

        <div class="health-row">
          <div class="health-stat">
            <div class="key">Worker heartbeat</div>
            <div class="val" :class="heartbeatClass">
              {{ health.workerHeartbeatSec >= 0 ? `✓ ${formatTimeAgo(health.workerHeartbeatSec)}` : '— never' }}
            </div>
          </div>
          <div class="health-stat">
            <div class="key">Tasks kẹt</div>
            <div class="val" :class="stuckClass">{{ health.stuckTaskCount }}</div>
          </div>
          <div class="health-stat">
            <div class="key">Failed rate 24h</div>
            <div class="val" :class="failedClass">{{ health.failedRate24h.toFixed(1) }}%</div>
          </div>
          <div class="health-stat">
            <div class="key">Total finished 24h</div>
            <div class="val">{{ formatNum(health.totalFinished24h) }}</div>
          </div>
        </div>

        <!-- Top problem nicks -->
        <div v-if="problemNicks.length > 0" class="nick-section">
          <div class="nick-title">🔧 Top {{ problemNicks.length }} nick có vấn đề:</div>
          <table class="nick-table">
            <thead>
              <tr>
                <th>Nick</th>
                <th>Attempts 24h</th>
                <th>Failed</th>
                <th>Error rate</th>
                <th>Cap %</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="nick in problemNicks" :key="nick.nickId">
                <td class="nick-name">{{ nick.nickName }}</td>
                <td>{{ nick.attempts24h }}</td>
                <td>{{ nick.failed24h }}</td>
                <td class="error-rate" :class="nick.errorRate >= 50 ? 'danger' : nick.errorRate >= 20 ? 'warning' : ''">
                  {{ nick.errorRate.toFixed(1) }}%
                </td>
                <td>{{ nick.capPct.toFixed(0) }}%</td>
                <td>
                  <span class="status-pill" :class="nickStatusClass(nick)">
                    {{ nick.status === 'connected' ? '✓ connected' : nick.status }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Skip breakdown -->
        <div v-if="health.skipReasonBreakdown24h.length > 0" class="nick-section">
          <div class="nick-title">📊 Skip reason 24h (categorize):</div>
          <div
            v-for="cat in health.skipReasonBreakdown24h"
            :key="cat.category"
            class="skip-breakdown-row"
          >
            <div class="skip-cat-dot" :class="`cat-${cat.category}`" />
            <div class="cat-label">{{ categoryLabel(cat.category) }}</div>
            <div class="cat-count">{{ formatNum(cat.count) }}</div>
            <div class="cat-pct">{{ skipPct(cat.count) }}%</div>
          </div>
        </div>
      </div>

      <!-- Footer reconcile info -->
      <div class="footer-note">
        Cached counters last synced:
        <strong>{{ formatSyncTime(overview.countersLastSyncedAt) }}</strong>
        <a v-if="isAdmin" href="#" @click.prevent="reconcileNow">[Admin] Manual reconcile drift</a>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';
import { api } from '@/api/index';

// ── Types ──
type RangeType = '24h' | '7d' | '30d' | 'all';

interface Overview {
  sequenceId: string;
  sequenceName: string;
  enrolledTotal: number;
  enrolledCached: number;
  completedTotal: number;
  completedCached: number;
  blockCount: number;
  replyCount: number;
  enroll24h: number;
  enroll7d: number;
  enroll30d: number;
  sentMessagesTotal: number;
  countersLastSyncedAt: string | null;
  includeSystemTrigger: boolean;
}

interface Outcomes {
  sequenceId: string;
  range: '24h' | '7d' | '30d';
  totalEnrolled: number;
  totalSent: number;
  reply: number;
  reactionPositive: number;
  reactionNegative: number;
  block: number;
  friendAccept: number;
  friendReject: number;
  rates: {
    replyRate: number;
    positiveReactionRate: number;
    negativeReactionRate: number;
    blockRate: number;
  };
}

interface FunnelStep {
  stepIdx: number;
  entered: number;
  sent: number;
  skipped: number;
  failed: number;
  replied: number;
  dropOffPct: number;
}

interface Funnel {
  sequenceId: string;
  range: string;
  steps: FunnelStep[];
  totalSteps: number;
}

interface Health {
  sequenceId: string;
  workerHeartbeatSec: number;
  stuckTaskCount: number;
  failedRate24h: number;
  failedCount24h: number;
  totalFinished24h: number;
  skipReasonBreakdown24h: Array<{ category: string; count: number }>;
  alertLevel: 'green' | 'yellow' | 'red';
  alerts: string[];
}

interface NickHealth {
  nickId: string;
  nickName: string;
  attempts24h: number;
  failed24h: number;
  errorRate: number;
  capUsed: number;
  capLimit: number;
  capPct: number;
  status: string;
}

// ── Route + state ──
const route = useRoute();
const router = useRouter();
const sequenceId = computed(() => String(route.params.id ?? ''));
const range = ref<RangeType>('7d');
const includeSystem = ref(false);

const overview = ref<Overview | null>(null);
const outcomes = ref<Outcomes | null>(null);
const funnel = ref<Funnel | null>(null);
const health = ref<Health | null>(null);
const problemNicks = ref<NickHealth[]>([]);
const sequenceSteps = ref<Array<{ name?: string; blockId?: string }>>([]);

const loadingOverview = ref(false);
const isAdmin = ref(false); // TODO: từ auth store

// ── Computed ──
const sequenceName = computed(() => overview.value?.sequenceName ?? 'Đang tải...');

const activeCount = computed(() => {
  if (!overview.value) return 0;
  return Math.max(0, overview.value.enroll30d - overview.value.completedCached - droppedCount.value);
});
const activePercent = computed(() => percentOfEnroll(activeCount.value));
const completedPercent = computed(() =>
  overview.value ? percentOfEnroll(overview.value.completedCached) : 0,
);
const droppedCount = computed(() => {
  if (!outcomes.value) return 0;
  return outcomes.value.block;
});
const droppedPercent = computed(() => percentOfEnroll(droppedCount.value));
const avgStep = computed(() => {
  if (!funnel.value || funnel.value.totalSteps === 0) return '0/0';
  // approximation: average step idx of sent steps
  let total = 0;
  let count = 0;
  for (const step of funnel.value.steps) {
    total += step.sent * (step.stepIdx + 1);
    count += step.sent;
  }
  if (count === 0) return `0/${funnel.value.totalSteps}`;
  return `${(total / count).toFixed(1)}/${funnel.value.totalSteps}`;
});

const friendAcceptRate = computed(() => {
  if (!outcomes.value) return 0;
  const total = outcomes.value.friendAccept + outcomes.value.friendReject;
  return total > 0 ? (outcomes.value.friendAccept / total) * 100 : 0;
});

const healthAlerts = computed(() => health.value?.alerts ?? []);
const healthLevel = computed(() => health.value?.alertLevel ?? 'green');

const heartbeatClass = computed(() => {
  if (!health.value || health.value.workerHeartbeatSec < 0) return '';
  if (health.value.workerHeartbeatSec > 600) return 'danger';
  if (health.value.workerHeartbeatSec > 60) return 'warning';
  return 'success';
});

const stuckClass = computed(() => {
  if (!health.value) return '';
  if (health.value.stuckTaskCount > 5) return 'danger';
  if (health.value.stuckTaskCount > 0) return 'warning';
  return 'success';
});

const failedClass = computed(() => {
  if (!health.value) return '';
  if (health.value.failedRate24h >= 20) return 'danger';
  if (health.value.failedRate24h >= 10) return 'warning';
  return '';
});

// ── Helpers ──
function formatNum(n: number): string {
  if (n >= 1000) return n.toLocaleString('vi-VN');
  return String(n);
}

function percentOfEnroll(n: number): number {
  if (!overview.value || overview.value.enroll30d === 0) return 0;
  return Math.round((n / overview.value.enroll30d) * 100);
}

function rangeLabel(r: string): string {
  switch (r) {
    case '24h': return '24h';
    case '7d': return '7 ngày';
    case '30d': return '30 ngày';
    case 'all': return 'Tất cả';
    default: return r;
  }
}

function funnelPct(step: FunnelStep): number {
  if (!funnel.value || funnel.value.steps.length === 0) return 0;
  const max = funnel.value.steps[0].entered;
  if (max === 0) return 0;
  return Math.round((step.entered / max) * 100);
}

function dropClass(pct: number): string {
  if (pct >= 25) return 'high';
  if (pct >= 15) return 'mid';
  return '';
}

function getStepLabel(idx: number): string {
  return sequenceSteps.value[idx]?.name ?? '';
}

function formatTimeAgo(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}

function formatSyncTime(iso: string | null): string {
  if (!iso) return 'chưa sync';
  const d = new Date(iso);
  const diffH = (Date.now() - d.getTime()) / 3600_000;
  if (diffH < 1) return `${Math.floor(diffH * 60)} phút trước`;
  if (diffH < 24) return `${Math.floor(diffH)} giờ trước`;
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function donutStyle(pct: number): Record<string, string> {
  const deg = Math.min(360, (pct / 100) * 360);
  return {
    background: `conic-gradient(#0068ff 0deg ${deg}deg, #f4f5f7 ${deg}deg 360deg)`,
  };
}

function nickStatusClass(nick: NickHealth): string {
  if (nick.status === 'connected') return 'connected';
  if (nick.errorRate >= 50) return 'danger';
  return 'warning';
}

function categoryLabel(cat: string): string {
  switch (cat) {
    case 'benign': return 'Benign (already_friend, no_zalo, stop_on_accept)';
    case 'throttle': return 'Throttle (giờ ngoài, gap nick, recency)';
    case 'capacity': return 'Capacity (quota_capped, cap_message)';
    case 'config_error': return '⚠️ Config error (block_archived, rule_disabled)';
    default: return cat;
  }
}

function skipPct(count: number): number {
  if (!health.value) return 0;
  const total = health.value.skipReasonBreakdown24h.reduce((sum, c) => sum + c.count, 0);
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

// ── Fetch ──
async function fetchOverview(): Promise<void> {
  if (!sequenceId.value) return;
  loadingOverview.value = true;
  try {
    const res = await api.get<Overview>(
      `/automation/sequences/${sequenceId.value}/stats/overview`,
      { params: { includeSystemTrigger: includeSystem.value } },
    );
    overview.value = res.data;
  } catch (err) {
    console.error('[stats/overview] fetch failed', err);
  } finally {
    loadingOverview.value = false;
  }
}

async function fetchOutcomes(): Promise<void> {
  if (!sequenceId.value) return;
  try {
    const apiRange = range.value === 'all' ? '30d' : range.value;
    const res = await api.get<Outcomes>(
      `/automation/sequences/${sequenceId.value}/stats/outcomes`,
      { params: { range: apiRange, includeSystemTrigger: includeSystem.value } },
    );
    outcomes.value = res.data;
  } catch (err) {
    console.error('[stats/outcomes] fetch failed', err);
  }
}

async function fetchFunnel(): Promise<void> {
  if (!sequenceId.value) return;
  try {
    const apiRange = range.value === '30d' || range.value === 'all' ? '30d' : '7d';
    const res = await api.get<Funnel>(
      `/automation/sequences/${sequenceId.value}/stats/funnel`,
      { params: { range: apiRange, includeSystemTrigger: includeSystem.value } },
    );
    funnel.value = res.data;
  } catch (err) {
    console.error('[stats/funnel] fetch failed', err);
  }
}

async function fetchHealth(): Promise<void> {
  if (!sequenceId.value) return;
  try {
    const [healthRes, nicksRes] = await Promise.all([
      api.get<Health>(`/automation/sequences/${sequenceId.value}/stats/health`, {
        params: { includeSystemTrigger: includeSystem.value },
      }),
      api.get<NickHealth[]>(`/automation/sequences/${sequenceId.value}/stats/health/nicks`, {
        params: { includeSystemTrigger: includeSystem.value },
      }),
    ]);
    health.value = healthRes.data;
    problemNicks.value = nicksRes.data ?? [];
  } catch (err) {
    console.error('[stats/health] fetch failed', err);
  }
}

async function fetchSequenceMeta(): Promise<void> {
  if (!sequenceId.value) return;
  try {
    const res = await api.get<{
      id: string;
      name: string;
      steps: Array<{ name?: string; blockId?: string }>;
    }>(`/automation/sequences/${sequenceId.value}`);
    sequenceSteps.value = res.data.steps ?? [];
  } catch (err) {
    console.error('[sequence meta] fetch failed', err);
  }
}

async function refetchAll(): Promise<void> {
  await Promise.all([fetchOverview(), fetchOutcomes(), fetchFunnel(), fetchHealth()]);
}

function setRange(r: RangeType): void {
  range.value = r;
  void Promise.all([fetchOutcomes(), fetchFunnel()]);
}

function goBack(): void {
  router.push('/marketing/sequences');
}

async function reconcileNow(): Promise<void> {
  try {
    await api.post('/automation/sequences/stats/reconcile-counters');
    await fetchOverview();
    window.alert('Reconcile xong. Đã refresh dữ liệu.');
  } catch (err) {
    console.error('[reconcile] failed', err);
    window.alert('Lỗi reconcile. Chỉ Owner + Admin được phép.');
  }
}

// ── Lifecycle ──
let healthPollHandle: number | null = null;

function startHealthPoll(): void {
  if (healthPollHandle != null) return;
  healthPollHandle = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void fetchHealth();
    }
  }, 30_000);
}

function stopHealthPoll(): void {
  if (healthPollHandle != null) {
    window.clearInterval(healthPollHandle);
    healthPollHandle = null;
  }
}

onMounted(async () => {
  await fetchSequenceMeta();
  await refetchAll();
  startHealthPoll();
});

onUnmounted(stopHealthPoll);

watch(sequenceId, () => {
  void fetchSequenceMeta();
  void refetchAll();
});
</script>

<style scoped>
.stats-page {
  max-width: 1366px;
  margin: 0 auto;
  padding: 24px;
  font-size: 13px;
  color: #172b4d;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.page-header h1 {
  margin: 4px 0 0;
  font-size: 20px;
  font-weight: 700;
}
.breadcrumb {
  font-size: 12px;
  color: #6b778c;
}
.breadcrumb a {
  color: #0068ff;
  text-decoration: none;
}
.breadcrumb .sep { margin: 0 4px; }
.back-btn {
  padding: 8px 12px;
  background: white;
  border: 1px solid #c1c7d0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
}
.back-btn:hover { background: #ebf3ff; }

.loading-state {
  text-align: center;
  padding: 64px;
  color: #6b778c;
}
.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e5e7eb;
  border-top-color: #0068ff;
  border-radius: 50%;
  display: inline-block;
  margin-bottom: 12px;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Alert banner */
.alert-banner {
  border: 1px solid;
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 12px;
  box-shadow: 0 1px 2px rgba(9, 30, 66, 0.08);
}
.alert-banner.alert-red {
  background: #ffebe6;
  border-color: #de350b;
  color: #de350b;
}
.alert-banner.alert-yellow {
  background: #fff7e6;
  border-color: #ff8b00;
  color: #ff8b00;
}
.alert-header {
  font-weight: 600;
  font-size: 13px;
}
.alert-items {
  margin: 6px 0 0 0;
  padding-left: 20px;
  font-size: 12px;
}

/* Filter bar */
.filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: white;
  border: 1px solid #dfe1e6;
  border-radius: 6px;
  padding: 10px 16px;
  margin-bottom: 12px;
  box-shadow: 0 1px 2px rgba(9, 30, 66, 0.08);
}
.range-buttons { display: flex; gap: 4px; }
.range-btn {
  padding: 5px 12px;
  background: white;
  border: 1px solid #c1c7d0;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  color: #42526e;
  font-family: inherit;
}
.range-btn.active {
  background: #0068ff;
  color: white;
  border-color: #0068ff;
  font-weight: 600;
}
.toggle-system {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #42526e;
  cursor: pointer;
}
.toggle-system input { cursor: pointer; }
.toggle-system small {
  font-size: 11px;
  color: #6b778c;
}

/* KPI grid */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 12px;
}
.kpi-grid.row-2 {
  grid-template-columns: repeat(3, 1fr);
}
.kpi-card {
  background: white;
  border: 1px solid #dfe1e6;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(9, 30, 66, 0.08);
  padding: 12px 14px;
}
.kpi-label {
  font-size: 11px;
  color: #6b778c;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  margin-bottom: 4px;
}
.kpi-value {
  font-size: 26px;
  font-weight: 700;
  line-height: 1.1;
}
.kpi-value .unit {
  font-size: 12px;
  color: #6b778c;
  font-weight: 400;
}
.kpi-sub {
  font-size: 11px;
  color: #6b778c;
  margin-top: 4px;
}
.kpi-sub .delta {
  color: #00875a;
  font-weight: 600;
}
.kpi-donut {
  display: flex;
  align-items: center;
  gap: 12px;
}
.donut-wrap { flex-shrink: 0; }
.donut {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  position: relative;
}
.donut::after {
  content: '';
  position: absolute;
  inset: 8px;
  background: white;
  border-radius: 50%;
}
.donut-value {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 11px;
  color: #172b4d;
  z-index: 2;
}

/* Section */
.section {
  background: white;
  border: 1px solid #dfe1e6;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(9, 30, 66, 0.08);
  padding: 16px;
  margin-bottom: 12px;
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #dfe1e6;
}
.section-header .right {
  font-size: 11px;
  color: #6b778c;
  font-weight: 400;
}

/* Funnel */
.funnel-row {
  display: grid;
  grid-template-columns: 140px 1fr 200px 80px;
  gap: 12px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed #dfe1e6;
}
.funnel-row:last-child { border-bottom: none; }
.step-name {
  font-weight: 500;
  color: #172b4d;
}
.step-name .sub {
  font-size: 11px;
  color: #6b778c;
  font-weight: 400;
  display: block;
}
.funnel-bar {
  height: 24px;
  background: #f4f5f7;
  border-radius: 4px;
  position: relative;
  overflow: hidden;
}
.funnel-fill {
  height: 100%;
  background: linear-gradient(90deg, #0068ff, #4c9aff);
  border-radius: 4px;
  display: flex;
  align-items: center;
  padding-left: 10px;
  color: white;
  font-weight: 600;
  font-size: 12px;
  transition: width 0.3s ease;
}
.funnel-stats {
  font-size: 11px;
  color: #6b778c;
  display: flex;
  flex-direction: column;
}
.drop-pct {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  background: #f4f5f7;
  color: #6b778c;
}
.drop-pct.high {
  background: #ffebe6;
  color: #de350b;
}
.drop-pct.mid {
  background: #fff7e6;
  color: #ff8b00;
}

/* Outcome */
.outcome-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.outcome-card {
  background: white;
  border: 1px solid #dfe1e6;
  border-radius: 6px;
  padding: 12px;
  text-align: center;
  position: relative;
}
.outcome-label {
  font-size: 11px;
  color: #6b778c;
  text-transform: uppercase;
  font-weight: 600;
  margin-bottom: 6px;
}
.outcome-value {
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
}
.outcome-value.danger { color: #de350b; }
.outcome-value.success { color: #00875a; }
.outcome-value.warning { color: #ff8b00; }
.outcome-count {
  font-size: 11px;
  color: #6b778c;
  margin: 4px 0 8px;
}
.outcome-icon {
  font-size: 20px;
  margin: 4px 0;
}
.outcome-alert {
  position: absolute;
  top: 6px;
  right: 6px;
  background: #de350b;
  color: white;
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
}
.friend-stat {
  margin-top: 12px;
  padding: 10px;
  background: #e3fcef;
  border-left: 3px solid #00875a;
  border-radius: 4px;
  font-size: 12px;
}

/* Health */
.health-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #dfe1e6;
}
.health-row:last-child { border-bottom: none; }
.health-stat .key {
  color: #6b778c;
  font-size: 11px;
}
.health-stat .val {
  font-size: 16px;
  font-weight: 700;
  color: #172b4d;
  margin-top: 2px;
}
.health-stat .val.danger { color: #de350b; }
.health-stat .val.warning { color: #ff8b00; }
.health-stat .val.success { color: #00875a; }

.nick-section { margin-top: 16px; }
.nick-title {
  font-size: 12px;
  font-weight: 600;
  color: #42526e;
  margin-bottom: 8px;
}
.nick-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
  font-size: 12px;
}
.nick-table th {
  background: #f4f5f7;
  padding: 6px 10px;
  text-align: left;
  font-weight: 600;
  font-size: 11px;
  color: #6b778c;
  text-transform: uppercase;
  border-bottom: 1px solid #dfe1e6;
}
.nick-table td {
  padding: 8px 10px;
  border-bottom: 1px solid #dfe1e6;
}
.nick-table .nick-name {
  font-weight: 600;
  color: #172b4d;
}
.error-rate.danger { color: #de350b; font-weight: 600; }
.error-rate.warning { color: #ff8b00; font-weight: 600; }
.status-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
}
.status-pill.connected { background: #e3fcef; color: #00875a; }
.status-pill.warning { background: #fff7e6; color: #ff8b00; }
.status-pill.danger { background: #ffebe6; color: #de350b; }

/* Skip breakdown */
.skip-breakdown-row {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px dashed #dfe1e6;
}
.skip-breakdown-row:last-child { border-bottom: none; }
.skip-cat-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}
.skip-cat-dot.cat-benign { background: #6b778c; }
.skip-cat-dot.cat-throttle { background: #ff8b00; }
.skip-cat-dot.cat-capacity { background: #5b21b6; }
.skip-cat-dot.cat-config_error { background: #de350b; }
.cat-label { flex: 1; font-size: 12px; }
.cat-count { font-weight: 600; color: #172b4d; }
.cat-pct {
  font-size: 11px;
  color: #6b778c;
  min-width: 40px;
  text-align: right;
}

/* Footer */
.footer-note {
  text-align: center;
  color: #6b778c;
  font-size: 11px;
  margin-top: 16px;
}
.footer-note strong { color: #42526e; }
.footer-note a {
  color: #0068ff;
  margin-left: 8px;
  text-decoration: none;
}
</style>
