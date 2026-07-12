<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- MOverviewView — Tổng quan cho nhân viên trên /m. Tái dùng GET /dashboard/action-hub/me
     (quyền + scope giữ ở backend). Ưu tiên số liệu + việc cần xử lý, KHÔNG bê dashboard desktop. -->
<template>
  <div class="mov mc-scroll">
    <MPageHeader title="Tổng quan" />

    <div ref="scroller" class="mov-body m-scroll"
      @touchstart.passive="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
      <div v-if="pullY > 0" class="map-pull" :style="{ height: pullY + 'px' }">{{ pullY > 64 ? 'Thả để tải lại' : 'Kéo xuống...' }}</div>

      <!-- Lời chào -->
      <section class="mov-hello">
        <div class="mov-hi">{{ greeting }}, {{ firstName }}</div>
        <div class="mov-date">{{ todayLabel }}<span v-if="realtimeOffline" class="mov-off"> - mất kết nối</span></div>
      </section>

      <template v-if="loading && !me">
        <div class="mov-grid"><div v-for="n in 4" :key="n" class="m-skel mov-sk-tile" /></div>
      </template>
      <MState v-else-if="error" variant="error" :message="error" @retry="load" />

      <template v-else-if="me">
        <!-- Khối ưu tiên -->
        <section class="mov-grid">
          <button class="mov-tile" :class="{ hot: kUnreplied > 0 }" @click="go('/m')">
            <span class="mov-num">{{ kUnreplied }}</span><span class="mov-lbl">Tin chưa trả lời</span>
          </button>
          <button class="mov-tile" @click="setSeg('today')">
            <span class="mov-num">{{ kToday }}</span><span class="mov-lbl">Lịch hẹn hôm nay</span>
          </button>
          <button class="mov-tile" :class="{ warn: kOverdue > 0 }" @click="setSeg('all')">
            <span class="mov-num">{{ kOverdue }}</span><span class="mov-lbl">Lịch quá hạn</span>
          </button>
          <button class="mov-tile" @click="go('/m/customers')">
            <span class="mov-num">{{ kDormant }}</span><span class="mov-lbl">Khách cần chăm</span>
          </button>
        </section>

        <!-- Chỉ số ngắn -->
        <section class="mov-stats">
          <div class="mov-stat"><span class="mov-stat-n">{{ me.kpi.totalContacts ?? 0 }}</span><span class="mov-stat-l">Tổng khách</span></div>
          <div class="mov-stat"><span class="mov-stat-n">{{ me.kpi.closedThisMonth ?? 0 }}</span><span class="mov-stat-l">Chốt tháng này</span></div>
          <div class="mov-stat"><span class="mov-stat-n">{{ me.kpi.followSessions ?? 0 }}</span><span class="mov-stat-l">Đang theo dõi</span></div>
        </section>

        <!-- Khách cần xử lý -->
        <section v-if="(me.urgent || []).length" class="mov-urgent">
          <div class="mov-sec-title">Cần xử lý ngay</div>
          <button v-for="u in me.urgent.slice(0, 6)" :key="u.conversationId" class="mov-urow" @click="go(`/m/c/${u.conversationId}`)">
            <div class="mov-uav">
              <img v-if="u.contactAvatar" :src="u.contactAvatar" alt="" loading="lazy" />
              <span v-else>{{ (u.contactName || '?').charAt(0).toUpperCase() }}</span>
            </div>
            <div class="mov-ubody">
              <div class="mov-uname">{{ u.isPrivateNick ? 'Riêng tư - ' : '' }}{{ u.contactName || 'Khách' }}</div>
              <div class="mov-uprev">{{ u.redacted ? 'Nội dung riêng tư' : (u.messagePreview || '') }}</div>
            </div>
            <span v-if="u.unreadCount" class="m-badge">{{ u.unreadCount > 99 ? '99+' : u.unreadCount }}</span>
          </button>
        </section>

        <!-- Hành động nhanh -->
        <section class="mov-quick">
          <button class="mov-qa" @click="go('/m')"><MessageCircleIcon :size="20" :stroke-width="1.9" /><span>Mở chat</span></button>
          <button class="mov-qa" @click="go('/m/customers')"><UsersIcon :size="20" :stroke-width="1.9" /><span>Khách hàng</span></button>
          <button class="mov-qa" @click="go('/m/appointments')"><CalendarClockIcon :size="20" :stroke-width="1.9" /><span>Lịch hẹn</span></button>
        </section>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { MessageCircle as MessageCircleIcon, Users as UsersIcon, CalendarClock as CalendarClockIcon } from 'lucide-vue-next';
import { api } from '@/api/index';
import { useAuthStore } from '@/stores/auth';
import { useChat } from '@/composables/use-chat';
import MPageHeader from '@/components/mobile/MPageHeader.vue';
import MState from '@/components/mobile/MState.vue';

defineOptions({ name: 'MOverviewView' });

const router = useRouter();
const auth = useAuthStore();
const { realtimeOffline } = useChat();

const me = ref<any>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const firstName = computed(() => (auth.user?.fullName || 'bạn').trim().split(/\s+/).pop());
const greeting = computed(() => { const h = new Date().getHours(); return h < 11 ? 'Chào buổi sáng' : h < 14 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'; });
const todayLabel = computed(() => new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }));

const split = (s: any) => (s ? (s.public ?? 0) + (s.private ?? 0) : 0);
const kUnreplied = computed(() => split(me.value?.kpi?.unreplied));
const kToday = computed(() => split(me.value?.kpi?.todayAppointments));
const kDormant = computed(() => split(me.value?.kpi?.dormantContacts));
const kOverdue = computed(() => (me.value?.reminders?.overdue || []).length);

function go(path: string) { router.push(path); }
function setSeg(seg: string) { router.push({ path: '/m/appointments', query: { seg } }); }

async function load() {
  loading.value = true; error.value = null;
  try { me.value = (await api.get('/dashboard/action-hub/me')).data; }
  catch { error.value = 'Không tải được dữ liệu tổng quan'; }
  finally { loading.value = false; }
}

// Pull-to-refresh
const scroller = ref<HTMLElement | null>(null);
const pullY = ref(0);
let startY = 0;
let startX = 0; let pulling = false;
function onTouchStart(e: TouchEvent) { const el = scroller.value; pulling = !!el && el.scrollTop <= 0; startY = e.touches[0].clientY; startX = e.touches[0].clientX; }
function onTouchMove(e: TouchEvent) {
  if (!pulling) return;
  const touch = e.touches[0];
  const dx = touch.clientX - startX;
  const dy = touch.clientY - startY;
  if (Math.abs(dx) > Math.abs(dy)) {
    pulling = false;
    pullY.value = 0;
    return;
  }
  pullY.value = dy > 0 ? Math.min(dy * 0.5, 90) : 0;
  if (pullY.value > 0) e.preventDefault();
}
async function onTouchEnd() { if (pullY.value > 64) await load(); pullY.value = 0; pulling = false; }

onMounted(() => void load());
</script>

<style scoped>
.mov { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--m-bg); }
.mov-body { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: calc(var(--m-sp-4) + env(safe-area-inset-bottom, 0px)); }
.map-pull { display: flex; align-items: center; justify-content: center; font-size: var(--m-fs-xs); color: var(--m-text-2); }
.mov-hello { padding: var(--m-sp-4) var(--m-sp-4) var(--m-sp-2); }
.mov-hi { font-size: var(--m-fs-lg); font-weight: var(--m-fw-bold); color: var(--m-text); }
.mov-date { font-size: var(--m-fs-sm); color: var(--m-text-2); margin-top: 2px; }
.mov-off { color: var(--m-danger); font-weight: var(--m-fw-semibold); }

.mov-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--m-sp-2); padding: var(--m-sp-2) var(--m-sp-4); }
.mov-sk-tile { height: 82px; border-radius: var(--m-r-lg); }
.mov-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 14px; border: 0; border-radius: var(--m-r-lg); background: var(--m-surface); box-shadow: var(--m-e1); cursor: pointer; text-align: left; }
.mov-tile:active { background: var(--m-surface-2); }
.mov-tile.hot { background: var(--m-brand-soft); }
.mov-tile.warn { background: var(--m-warning-soft); }
.mov-num { font-size: 26px; font-weight: var(--m-fw-bold); color: var(--m-text); line-height: 1.1; }
.mov-tile.hot .mov-num { color: var(--m-brand-strong); }
.mov-lbl { font-size: var(--m-fs-xs); color: var(--m-text-2); }

.mov-stats { display: flex; gap: var(--m-sp-2); padding: var(--m-sp-1) var(--m-sp-4) var(--m-sp-3); }
.mov-stat { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 12px 6px; background: var(--m-surface); border-radius: var(--m-r-md); box-shadow: var(--m-e1); }
.mov-stat-n { font-size: var(--m-fs-lg); font-weight: var(--m-fw-bold); color: var(--m-text); }
.mov-stat-l { font-size: var(--m-fs-2xs); color: var(--m-text-3); text-align: center; }

.mov-sec-title { font-size: var(--m-fs-sm); font-weight: var(--m-fw-bold); color: var(--m-text-2); padding: var(--m-sp-2) var(--m-sp-4) 6px; }
.mov-urgent { background: var(--m-surface); margin: 0 var(--m-sp-4) var(--m-sp-3); border-radius: var(--m-r-lg); overflow: hidden; box-shadow: var(--m-e1); }
.mov-urow { display: flex; align-items: center; gap: var(--m-sp-3); width: 100%; padding: 10px var(--m-sp-3); border: 0; background: none; cursor: pointer; text-align: left; }
.mov-urow + .mov-urow { box-shadow: inset 0 1px 0 var(--m-border); }
.mov-urow:active { background: var(--m-surface-2); }
.mov-uav { width: 40px; height: 40px; border-radius: var(--m-r-full); flex-shrink: 0; background: linear-gradient(135deg, #8fb7ff, #1f6fd6); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: var(--m-fw-semibold); }
.mov-uav img { width: 100%; height: 100%; border-radius: var(--m-r-full); object-fit: cover; }
.mov-ubody { flex: 1; min-width: 0; }
.mov-uname { font-size: var(--m-fs-sm); font-weight: var(--m-fw-semibold); color: var(--m-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mov-uprev { font-size: var(--m-fs-xs); color: var(--m-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.mov-quick { display: flex; gap: var(--m-sp-2); padding: 0 var(--m-sp-4) var(--m-sp-4); }
.mov-qa { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 12px 4px; border: 0; border-radius: var(--m-r-md); background: var(--m-surface); box-shadow: var(--m-e1); color: var(--m-brand); font-size: var(--m-fs-xs); font-weight: var(--m-fw-semibold); cursor: pointer; }
.mov-qa:active { transform: scale(0.96); }
</style>
