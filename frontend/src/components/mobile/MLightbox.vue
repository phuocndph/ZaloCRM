<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- MLightbox — xem ảnh toàn màn hình cho mobile. Double-tap zoom, kéo khi zoom, vuốt xuống
     đóng, nút tải/đóng. Ảnh giữ tỷ lệ (object-fit contain), skeleton + fallback lỗi. -->
<template>
  <Teleport to="body">
    <div v-if="open" class="mlb" @click.self="close">
      <div class="mlb-top">
        <button class="mlb-btn" aria-label="Đóng" @click="close"><XIcon :size="24" :stroke-width="2" /></button>
        <span v-if="urls.length > 1" class="mlb-count">{{ currentIndex + 1 }} / {{ urls.length }}</span>
        <a v-if="url" class="mlb-btn" :href="url" target="_blank" rel="noopener" download aria-label="Tải ảnh"><DownloadIcon :size="22" :stroke-width="2" /></a>
      </div>
      <div
        class="mlb-stage"
        :style="{ transform: `translateY(${dragY}px)`, opacity: dragOpacity }"
        @touchstart.passive="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @dblclick="toggleZoom"
      >
        <div v-if="loading" class="mlb-skel m-skel" />
        <img
          v-show="!errored"
          :src="url || ''"
          alt="ảnh"
          class="mlb-img"
          :style="imgStyle"
          @load="loading = false"
          @error="errored = true; loading = false"
        />
        <div v-if="errored" class="mlb-err"><ImageOffIcon :size="40" :stroke-width="1.4" /><span>Không tải được ảnh</span></div>
        <button v-if="urls.length > 1" class="mlb-nav mlb-prev" :disabled="currentIndex <= 0" aria-label="Ảnh trước" @click.stop="navigate('prev')"><ChevronLeftIcon :size="30" :stroke-width="2" /></button>
        <button v-if="urls.length > 1" class="mlb-nav mlb-next" :disabled="currentIndex >= urls.length - 1" aria-label="Ảnh sau" @click.stop="navigate('next')"><ChevronRightIcon :size="30" :stroke-width="2" /></button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { X as XIcon, Download as DownloadIcon, ImageOff as ImageOffIcon, ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon } from 'lucide-vue-next';

const props = withDefaults(defineProps<{ open: boolean; url: string | null; urls?: string[] }>(), { urls: () => [] });
const emit = defineEmits<{ close: []; select: [url: string] }>();

const loading = ref(true);
const errored = ref(false);
const zoomed = ref(false);
const dragY = ref(0);
const panX = ref(0);
const panY = ref(0);
let startY = 0;
let startX = 0;
let lastX = 0;
let lastY = 0;
let dragging = false;

const imgStyle = computed(() => ({ transform: zoomed.value ? 'translate(' + panX.value + 'px, ' + panY.value + 'px) scale(2)' : 'scale(1)', transition: zoomed.value ? 'none' : undefined }));
const dragOpacity = computed(() => (dragY.value > 0 ? Math.max(0.3, 1 - dragY.value / 320) : 1));
const urls = computed(() => props.urls ?? []);
const currentIndex = computed(() => Math.max(0, urls.value.indexOf(props.url || '')));

watch(() => [props.open, props.url] as const, ([open]) => {
  if (open) { loading.value = true; errored.value = false; zoomed.value = false; dragY.value = 0; panX.value = 0; panY.value = 0; }
});

function close() { emit('close'); }
function toggleZoom() { zoomed.value = !zoomed.value; if (!zoomed.value) { panX.value = 0; panY.value = 0; } }
function navigate(direction: 'prev' | 'next') {
  const nextIndex = currentIndex.value + (direction === 'next' ? 1 : -1);
  const nextUrl = urls.value[nextIndex];
  if (nextUrl) emit('select', nextUrl);
}

// Vuốt XUỐNG để đóng (chỉ khi CHƯA zoom).
function onTouchStart(e: TouchEvent) { if (e.touches.length > 1) { dragging = false; return; } dragging = true; startY = e.touches[0].clientY; startX = e.touches[0].clientX; lastX = e.touches[0].clientX; lastY = e.touches[0].clientY; }
function onTouchMove(e: TouchEvent) {
  if (!dragging || e.touches.length > 1) return;
  const touch = e.touches[0];
  lastX = touch.clientX;
  lastY = touch.clientY;
  if (zoomed.value) {
    panX.value += touch.clientX - startX;
    panY.value += touch.clientY - startY;
    startX = touch.clientX;
    startY = touch.clientY;
    e.preventDefault();
    return;
  }
  const dx = touch.clientX - startX;
  const dy = touch.clientY - startY;
  if (Math.abs(dx) > Math.abs(dy)) return;
  if (dy > 0) { dragY.value = dy; e.preventDefault(); }
}
function onTouchEnd() {
  if (!dragging) return;
  dragging = false;
  const dx = lastX - startX;
  const dy = lastY - startY;
  if (!zoomed.value && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) navigate(dx < 0 ? 'next' : 'prev');
  else if (dragY.value > 110) close();
  dragY.value = 0;
}
</script>

<style scoped>
.mlb { position: fixed; inset: 0; z-index: 4000; background: rgba(0,0,0,0.97); display: flex; flex-direction: column; animation: mlb-fade 0.2s ease; }
@keyframes mlb-fade { from { opacity: 0; } to { opacity: 1; } }
.mlb-top {
  position: absolute; top: 0; left: 0; right: 0; z-index: 2;
  display: flex; align-items: center; justify-content: space-between;
  padding: calc(env(safe-area-inset-top, 0px) + 8px) 12px 14px;
  background: linear-gradient(to bottom, rgba(0,0,0,0.5), transparent); /* scrim để nút thấy rõ trên ảnh sáng */
  pointer-events: none;
}
.mlb-btn {
  pointer-events: auto;
  width: 42px; height: 42px; display: inline-flex; align-items: center; justify-content: center;
  border: 0; background: rgba(255,255,255,0.16); backdrop-filter: blur(6px); color: #fff; border-radius: 999px;
  text-decoration: none; transition: transform 0.1s ease, background 0.12s ease;
}
.mlb-btn:active { background: rgba(255,255,255,0.3); transform: scale(0.92); }
.mlb-count { color: #fff; font-size: 13px; font-weight: 600; text-shadow: 0 1px 3px rgba(0,0,0,0.55); }
.mlb-stage { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; transition: transform 0.05s linear; overflow: hidden; touch-action: none; overscroll-behavior: none; }
.mlb-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 44px; height: 52px; border: 0; border-radius: 999px; background: rgba(0,0,0,0.42); color: #fff; display: grid; place-items: center; }
.mlb-nav:disabled { opacity: 0.25; }
.mlb-prev { left: 8px; }
.mlb-next { right: 8px; }
.mlb-skel { width: 60vw; height: 40vh; border-radius: 12px; }
.mlb-img { max-width: 100vw; max-height: 100dvh; object-fit: contain; transition: transform var(--m-dur-base, 220ms) var(--m-ease, ease); }
.mlb-err { display: flex; flex-direction: column; align-items: center; gap: 10px; color: #9aa7b4; font-size: 14px; }
</style>
