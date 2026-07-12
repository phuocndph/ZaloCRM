<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- MCustomersView — danh sách Khách hàng cho /m. Tái dùng GET /contacts (quyền backend).
     Tìm kiếm, infinite scroll, pull-to-refresh, skeleton, empty/error, FAB (nếu có quyền tạo). -->
<template>
  <div class="mcu mc-scroll">
    <MPageHeader
      title="Khách hàng"
      :count="total || null"
      searchable
      :search="search"
      search-placeholder="Tìm tên, SĐT, mã…"
      @update:search="onSearch"
    />

    <div
      ref="scroller"
      class="mcu-list m-scroll"
      @scroll.passive="onScroll"
      @touchstart.passive="onTouchStart" @touchmove.passive="onTouchMove" @touchend="onTouchEnd"
    >
      <div v-if="pullY > 0" class="mcu-pull" :style="{ height: pullY + 'px' }">
        {{ pullY > PULL_THRESHOLD ? 'Thả để tải lại' : 'Kéo xuống để tải lại' }}
      </div>

      <!-- Skeleton -->
      <template v-if="loading && !items.length">
        <div v-for="n in 8" :key="n" class="mcu-card mcu-card--skel">
          <div class="m-skel mcu-sk-av" />
          <div class="mcu-body"><div class="m-skel mcu-sk-l1" /><div class="m-skel mcu-sk-l2" /></div>
        </div>
      </template>

      <MState v-else-if="error" variant="error" :message="error" @retry="load" />
      <MState
        v-else-if="!items.length"
        variant="empty"
        :message="search ? 'Không tìm thấy khách hàng phù hợp.' : 'Chưa có khách hàng nào.'"
      >
        <template #icon><UsersIcon :size="30" :stroke-width="1.5" /></template>
      </MState>

      <button
        v-for="(c, idx) in items"
        :key="c.id"
        class="mcu-card"
        :style="idx < 12 ? { animationDelay: idx * 16 + 'ms' } : undefined"
        @click="open(c)"
      >
        <div class="mcu-avatar" :style="avatarStyle(c)">
          <img v-if="c.avatarUrl" :src="c.avatarUrl" alt="" loading="lazy" />
          <span v-else>{{ initial(c) }}</span>
        </div>
        <div class="mcu-body">
          <div class="mcu-line1">
            <span class="mcu-name">{{ name(c) }}</span>
            <span
              v-if="status(c)"
              class="mcu-status"
              :style="statusStyle(c)"
            >{{ status(c)!.name }}</span>
          </div>
          <div class="mcu-line2">
            <PhoneIcon :size="12" :stroke-width="2" class="mcu-mini-ic" />
            <span class="mcu-phone">{{ c.phone || 'Chưa có SĐT' }}</span>
          </div>
          <div v-if="hasMeta(c)" class="mcu-meta">
            <span v-if="c.tags && c.tags.length" class="m-chip m-chip--brand">{{ c.tags[0] }}</span>
            <span v-if="c.assignedUser?.fullName" class="m-chip"><UserIcon :size="10" :stroke-width="2.2" /> {{ c.assignedUser.fullName }}</span>
            <span v-if="c.source" class="m-chip">{{ c.source }}</span>
          </div>
        </div>
      </button>

      <div v-if="loadingMore" class="mcu-more">Đang tải thêm…</div>
      <div v-else-if="!hasMore && items.length" class="mcu-end">Hết danh sách</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Users as UsersIcon, Phone as PhoneIcon, User as UserIcon } from 'lucide-vue-next';
import {
  useMobileCustomers, customerName, customerStatus, type MCustomer,
} from '@/composables/use-mobile-customers';
import MPageHeader from '@/components/mobile/MPageHeader.vue';
import MState from '@/components/mobile/MState.vue';

defineOptions({ name: 'MCustomersView' });

const router = useRouter();
const { items, loading, loadingMore, error, search, total, hasMore, load, loadMore } = useMobileCustomers();


function name(c: MCustomer) { return customerName(c); }
function status(c: MCustomer) { return customerStatus(c); }
function initial(c: MCustomer) { return name(c).trim().charAt(0).toUpperCase(); }
function hasMeta(c: MCustomer) { return !!(c.tags?.length || c.assignedUser?.fullName || c.source); }

// Avatar gradient ổn định theo id (không có ảnh) — dịu, hiện đại.
function avatarStyle(c: MCustomer) {
  if (c.avatarUrl) return {};
  let h = 0; for (const ch of c.id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { background: `linear-gradient(135deg, hsl(${h} 62% 62%), hsl(${(h + 40) % 360} 58% 46%))` };
}
function statusStyle(c: MCustomer) {
  const s = status(c);
  const color = s?.color || '#8a95a4';
  return { color, background: color + '1f' };
}

function open(c: MCustomer) { router.push({ name: 'M.CustomerDetail', params: { id: c.id } }); }

// ── Tìm kiếm (debounce) ──
let searchTimer: ReturnType<typeof setTimeout>;
function onSearch(v: string) {
  search.value = v;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => load(), 350);
}

// ── Infinite scroll ──
const scroller = ref<HTMLElement | null>(null);
function onScroll() {
  const el = scroller.value;
  if (!el) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) void loadMore();
}

// ── Pull to refresh ──
const PULL_THRESHOLD = 64;
const pullY = ref(0);
let startY = 0;
let pulling = false;
function onTouchStart(e: TouchEvent) { const el = scroller.value; pulling = !!el && el.scrollTop <= 0; startY = e.touches[0].clientY; }
function onTouchMove(e: TouchEvent) { if (!pulling) return; const dy = e.touches[0].clientY - startY; pullY.value = dy > 0 ? Math.min(dy * 0.5, 90) : 0; }
async function onTouchEnd() { if (pullY.value > PULL_THRESHOLD) await load(); pullY.value = 0; pulling = false; }

onMounted(() => void load());
</script>

<style scoped>
.mcu { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--m-surface); position: relative; }
.mcu-list { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: env(safe-area-inset-bottom, 0px); }
.mcu-pull { display: flex; align-items: center; justify-content: center; font-size: var(--m-fs-xs); color: var(--m-text-2); }

.mcu-card {
  display: flex; gap: var(--m-sp-3); width: 100%; text-align: left;
  padding: 11px var(--m-sp-4); border: 0; background: none; cursor: pointer;
  min-height: 76px; align-items: center;
  animation: m-rise var(--m-dur-base) var(--m-ease) both;
  transition: background var(--m-dur-fast) var(--m-ease);
}
.mcu-card + .mcu-card { box-shadow: inset 0 1px 0 var(--m-border); }
.mcu-card:active { background: var(--m-surface-2); }
.mcu-card--skel { animation: none; pointer-events: none; }
.mcu-sk-av { width: 52px; height: 52px; border-radius: var(--m-r-full); flex-shrink: 0; }
.mcu-sk-l1 { height: 14px; width: 50%; margin-bottom: 9px; }
.mcu-sk-l2 { height: 12px; width: 72%; }

.mcu-avatar {
  position: relative; width: 52px; height: 52px; flex-shrink: 0; border-radius: var(--m-r-full);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: var(--m-fw-semibold); font-size: 19px;
}
.mcu-avatar img { width: 100%; height: 100%; border-radius: var(--m-r-full); object-fit: cover; }
.mcu-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.mcu-line1 { display: flex; align-items: center; justify-content: space-between; gap: var(--m-sp-2); }
.mcu-name { font-size: var(--m-fs-md); font-weight: var(--m-fw-semibold); color: var(--m-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mcu-status { flex-shrink: 0; font-size: var(--m-fs-2xs); font-weight: var(--m-fw-semibold); padding: 2px 8px; border-radius: var(--m-r-full); white-space: nowrap; }
.mcu-line2 { display: flex; align-items: center; gap: 5px; }
.mcu-mini-ic { color: var(--m-text-3); flex-shrink: 0; }
.mcu-phone { font-size: var(--m-fs-sm); color: var(--m-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mcu-meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 1px; }
.mcu-more { padding: var(--m-sp-4); text-align: center; font-size: var(--m-fs-sm); color: var(--m-text-2); }
.mcu-end { padding: var(--m-sp-4); text-align: center; font-size: var(--m-fs-xs); color: var(--m-text-3); }
</style>
