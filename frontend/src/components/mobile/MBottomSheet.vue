<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- MBottomSheet — bottom sheet dùng chung cho mobile (menu hành động, filter, forward…).
     Trượt lên, backdrop mờ, kéo xuống để đóng, safe-area đáy, khoá cuộn nền. -->
<template>
  <Teleport to="body">
    <transition name="mbs">
      <div v-if="modelValue" class="mbs" @click.self="close">
        <div class="mbs-panel" :style="{ transform: `translateY(${dragY}px)` }">
          <div class="mbs-head" @touchstart.passive="onStart" @touchmove="onMove" @touchend="onEnd">
            <div class="mbs-grip"><span /></div>
            <div v-if="title" class="mbs-title">{{ title }}</div>
          </div>
          <div class="mbs-body"><slot /></div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';

const props = defineProps<{ modelValue: boolean; title?: string }>();
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>();

const dragY = ref(0);
let startY = 0; let startX = 0; let dragging = false;

watch(() => props.modelValue, (v) => {
  dragY.value = 0;
  // Khoá cuộn nền khi mở.
  document.body.style.overflow = v ? 'hidden' : '';
});


onUnmounted(() => {
  if (props.modelValue) document.body.style.overflow = '';
});
function close() { emit('update:modelValue', false); }
function onStart(e: TouchEvent) { dragging = true; startY = e.touches[0].clientY; startX = e.touches[0].clientX; }
function onMove(e: TouchEvent) { if (!dragging) return; const touch = e.touches[0]; const dx = touch.clientX - startX; const dy = touch.clientY - startY; if (Math.abs(dx) > Math.abs(dy)) { dragging = false; dragY.value = 0; return; } if (dy > 0) { dragY.value = dy; e.preventDefault(); } }
function onEnd() { if (!dragging) return; dragging = false; if (dragY.value > 90) close(); else dragY.value = 0; }
</script>

<style scoped>
.mbs { position: fixed; inset: 0; z-index: 3500; background: var(--m-overlay, rgba(17,24,39,0.45)); display: flex; align-items: flex-end; }
.mbs-panel {
  width: 100%; background: var(--m-surface, #fff);
  border-radius: var(--m-r-xl, 22px) var(--m-r-xl, 22px) 0 0;
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 8px);
  box-shadow: var(--m-e3);
  max-height: 82dvh; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; touch-action: pan-y;
  transition: transform 0.08s linear;
}
.mbs-head { touch-action: none; }
.mbs-grip { display: flex; justify-content: center; padding: 9px 0 4px; }
.mbs-grip span { width: 40px; height: 4px; border-radius: 999px; background: var(--m-border-strong, #d6dce3); }
.mbs-title { text-align: center; font-size: var(--m-fs-sm, 13px); font-weight: var(--m-fw-semibold, 600); color: var(--m-text-2, #5b6675); padding: 2px 0 8px; }
.mbs-body { padding: 4px 0 8px; }

.mbs-enter-active, .mbs-leave-active { transition: opacity var(--m-dur-base, 220ms) var(--m-ease, ease); }
.mbs-enter-from, .mbs-leave-to { opacity: 0; }
.mbs-enter-active .mbs-panel, .mbs-leave-active .mbs-panel { transition: transform var(--m-dur-base, 220ms) var(--m-ease, ease); }
.mbs-enter-from .mbs-panel, .mbs-leave-to .mbs-panel { transform: translateY(100%); }
@media (prefers-reduced-motion: reduce) { .mbs-enter-from .mbs-panel, .mbs-leave-to .mbs-panel { transform: none; } }
</style>
