<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <Teleport to="body">
    <div class="jf-ui jf-workspace-backdrop" @click.self="requestClose">
      <section ref="dialog" class="jf-workspace" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1">
        <header class="jf-workspace-head"><h2 :id="titleId">{{ title }}</h2><button type="button" aria-label="Đóng cửa sổ mua hàng" :disabled="closing" @click="requestClose">Đóng</button></header>
        <div ref="content" class="jf-workspace-body"><slot /></div>
      </section>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, useId, watch, nextTick } from 'vue';
import './commerce.css';
const props = defineProps<{ title: string; beforeClose?: () => Promise<boolean> }>();
const emit = defineEmits<{ close: [] }>();
const titleId = useId(), dialog = ref<HTMLElement>(), content = ref<HTMLElement>(), closing = ref(false);
const originalFocus = document.activeElement as HTMLElement | null;
const previousOverflow = document.body.style.overflow;
async function requestClose() {
  if (closing.value) return;
  closing.value = true;
  try { if (!props.beforeClose || await props.beforeClose()) emit('close'); }
  finally { closing.value = false; }
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); void requestClose(); }
  if (event.key !== 'Tab') return;
  const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]') || [])].filter(el => el.getClientRects().length > 0);
  const first = controls[0], last = controls.at(-1);
  if (!first) { event.preventDefault(); dialog.value?.focus(); return; }
  const outside = !dialog.value?.contains(document.activeElement);
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value || outside)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value || outside)) { event.preventDefault(); first.focus(); }
}
watch(() => props.title, async () => { await nextTick(); if (content.value) content.value.scrollTop = 0; if (dialog.value && !dialog.value.contains(document.activeElement)) dialog.value.focus(); });
onMounted(() => { document.body.style.overflow = 'hidden'; dialog.value?.focus(); document.addEventListener('keydown', keyboard, true); });
onBeforeUnmount(() => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keyboard, true); void nextTick(() => { if (originalFocus?.isConnected) originalFocus.focus({ preventScroll: true }); }); });
</script>
<style scoped>
.jf-workspace-backdrop { position: fixed; inset: 0; z-index: 2500; background: #17203366; display: grid; place-items: center; padding: 24px; }
.jf-workspace { background: var(--surface, #fff); width: min(1040px, 100%); max-height: 90dvh; display: flex; flex-direction: column; border-radius: 9px; box-shadow: 0 16px 48px #17203326; overflow: hidden; outline: none; }
.jf-workspace-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 24px; border-bottom: 1px solid var(--line); flex-shrink: 0; }
.jf-workspace-body { padding: 24px; overflow-y: auto; overscroll-behavior: contain; min-height: 0; }
@media(max-width: 600px) { .jf-workspace-backdrop { padding: 0; } .jf-workspace { width: 100%; height: 100dvh; max-height: 100dvh; border-radius: 0; } .jf-workspace-head, .jf-workspace-body { padding: 16px; } }
</style>
