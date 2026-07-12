<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- MAppointmentsView — Lịch hẹn cho /m. Tái dùng /appointments (+today/upcoming), quyền +
     timezone giữ ở backend. Segment Hôm nay / Sắp tới / Tất cả; card + pull-to-refresh. -->
<template>
  <div class="map mc-scroll">
    <MPageHeader title="Lịch hẹn" :count="items.length || null">
      <template #below>
        <div class="map-seg">
          <button v-for="s in SEGMENTS" :key="s.key" class="map-seg-btn" :class="{ on: segment === s.key }" @click="setSegment(s.key)">{{ s.label }}</button>
        </div>
      </template>
    </MPageHeader>

    <div
      ref="scroller" class="map-list m-scroll"
      @touchstart.passive="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd"
    >
      <div v-if="pullY > 0" class="map-pull" :style="{ height: pullY + 'px' }">
        {{ pullY > PULL_THRESHOLD ? 'Thả để tải lại' : 'Kéo xuống để tải lại' }}
      </div>

      <template v-if="loading && !items.length">
        <div v-for="n in 6" :key="n" class="map-card map-card--skel">
          <div class="m-skel map-sk-time" />
          <div class="map-body"><div class="m-skel map-sk-l1" /><div class="m-skel map-sk-l2" /></div>
        </div>
      </template>

      <MState v-else-if="error" variant="error" :message="error" @retry="load" />
      <MState v-else-if="!items.length" variant="empty" :message="emptyMsg">
        <template #icon><CalendarClockIcon :size="30" :stroke-width="1.5" /></template>
      </MState>

      <button
        v-for="(a, idx) in items"
        :key="a.id"
        class="map-card"
        :style="idx < 12 ? { animationDelay: idx * 16 + 'ms' } : undefined"
        @click="open(a)"
      >
        <div class="map-time">
          <span class="map-hh">{{ (a.appointmentTime || '').slice(0, 5) || '-' }}</span>
          <span class="map-dd">{{ dateShort(a) }}</span>
        </div>
        <div class="map-body">
          <div class="map-line1">
            <span class="map-cust">{{ custName(a) }}</span>
            <span class="m-chip" :class="`m-chip--${statusMeta(a.status).variant}`">{{ statusMeta(a.status).label }}</span>
          </div>
          <div class="map-line2">{{ a.emoji ? a.emoji + ' ' : '' }}{{ a.title || a.type || 'Lịch hẹn' }}</div>
          <div v-if="a.assignedUser?.fullName || a.location" class="map-meta">
            <span v-if="a.location" class="map-meta-i"><MapPinIcon :size="11" :stroke-width="2" /> {{ a.location }}</span>
            <span v-if="a.assignedUser?.fullName" class="map-meta-i"><UserIcon :size="11" :stroke-width="2" /> {{ a.assignedUser.fullName }}</span>
          </div>
        </div>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CalendarClock as CalendarClockIcon, MapPin as MapPinIcon, User as UserIcon } from 'lucide-vue-next';
import {
  useMobileAppointments, apptStatusMeta, apptCustomerName, type MAppointment, type ApptSegment,
} from '@/composables/use-mobile-appointments';
import MPageHeader from '@/components/mobile/MPageHeader.vue';
import MState from '@/components/mobile/MState.vue';

defineOptions({ name: 'MAppointmentsView' });

const route = useRoute();
const router = useRouter();
const { items, loading, error, segment, load, setSegment } = useMobileAppointments();

const SEGMENTS: Array<{ key: ApptSegment; label: string }> = [
  { key: 'today', label: 'Hôm nay' },
  { key: 'upcoming', label: 'Sắp tới' },
  { key: 'all', label: 'Tất cả' },
];
const emptyMsg = computed(() =>
  segment.value === 'today' ? 'Hôm nay chưa có lịch hẹn.' : segment.value === 'upcoming' ? 'Chưa có lịch hẹn sắp tới.' : 'Chưa có lịch hẹn nào.',
);

function statusMeta(s?: string) { return apptStatusMeta(s); }
function custName(a: MAppointment) { return apptCustomerName(a); }
function dateShort(a: MAppointment) {
  try { return new Date(a.appointmentDate).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }); } catch { return ''; }
}
function open(a: MAppointment) { router.push({ name: 'M.AppointmentDetail', params: { id: a.id } }); }

// Pull-to-refresh
const scroller = ref<HTMLElement | null>(null);
const PULL_THRESHOLD = 64;
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
async function onTouchEnd() { if (pullY.value > PULL_THRESHOLD) await load(); pullY.value = 0; pulling = false; }

onMounted(() => {
  const seg = route.query.seg as string | undefined;
  if (seg === 'today' || seg === 'upcoming' || seg === 'all') segment.value = seg;
  void load();
});
</script>

<style scoped>
.map { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--m-surface); }
.map-seg { display: flex; gap: var(--m-sp-2); margin-top: var(--m-sp-2); }
.map-seg-btn { border: 0; background: var(--m-surface-2); color: var(--m-text-2); border-radius: var(--m-r-full); padding: 7px 15px; font-size: var(--m-fs-sm); font-weight: var(--m-fw-semibold); cursor: pointer; transition: background var(--m-dur-fast) var(--m-ease); }
.map-seg-btn:active { transform: scale(0.96); }
.map-seg-btn.on { background: var(--m-brand); color: var(--m-brand-ink); }

.map-list { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: var(--m-sp-2) 0 env(safe-area-inset-bottom, 0px); }
.map-pull { display: flex; align-items: center; justify-content: center; font-size: var(--m-fs-xs); color: var(--m-text-2); }

.map-card {
  display: flex; gap: var(--m-sp-3); width: 100%; text-align: left;
  padding: 11px var(--m-sp-4); border: 0; background: none; cursor: pointer; align-items: center; min-height: 74px;
}
.map-card + .map-card { box-shadow: inset 0 1px 0 var(--m-border); }
.map-card:active { background: var(--m-surface-2); }
.map-card--skel { animation: none; pointer-events: none; }
.map-sk-time { width: 52px; height: 40px; border-radius: var(--m-r-sm); flex-shrink: 0; }
.map-sk-l1 { height: 14px; width: 55%; margin-bottom: 8px; } .map-sk-l2 { height: 12px; width: 70%; }

.map-time { flex-shrink: 0; width: 54px; display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 6px 0; border-radius: var(--m-r-md); background: var(--m-brand-soft); }
.map-hh { font-size: var(--m-fs-md); font-weight: var(--m-fw-bold); color: var(--m-brand-strong); }
.map-dd { font-size: var(--m-fs-2xs); color: var(--m-brand-strong); opacity: 0.8; }
.map-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.map-line1 { display: flex; align-items: center; justify-content: space-between; gap: var(--m-sp-2); }
.map-cust { font-size: var(--m-fs-md); font-weight: var(--m-fw-semibold); color: var(--m-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.map-line2 { font-size: var(--m-fs-sm); color: var(--m-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.map-meta { display: flex; gap: var(--m-sp-3); flex-wrap: wrap; margin-top: 1px; }
.map-meta-i { display: inline-flex; align-items: center; gap: 3px; font-size: var(--m-fs-2xs); color: var(--m-text-3); }
</style>
