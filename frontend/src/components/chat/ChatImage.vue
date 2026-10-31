<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <img v-if="currentUrl" :key="currentUrl" :src="currentUrl" :alt="alt" :loading="loading" decoding="async" @error="onError" @click="emit('preview', currentUrl, $event)">
  <div v-else class="chat-image-failed" role="status">
    <span>Ảnh không tải được</span>
    <button type="button" @click.stop="retry">Tải lại ảnh</button>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
const props = withDefaults(defineProps<{ sources: string[]; identity?: string; alt?: string; loading?: 'lazy' | 'eager' }>(), { alt: 'Hình ảnh', identity: '', loading: 'lazy' });
const emit = defineEmits<{ preview: [url: string, event: MouseEvent] }>();
const index = ref(0);
const currentUrl = computed(() => props.sources[index.value] || '');
watch(() => JSON.stringify([props.identity, props.sources]), () => { index.value = 0; });
function onError(event: Event) {
  // A late error from a replaced image must not fail the new source.
  if ((event.target as HTMLImageElement).getAttribute('src') === currentUrl.value) index.value++;
}
function retry() { index.value = 0; }
</script>
<style scoped>
.chat-image-failed { display: flex !important; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 100px; padding: 12px; border: 1px solid #d8dee8; background: #f5f7fa; color: #667085; font-size: 12px; text-align: center; }
.chat-image-failed button { padding: 5px 9px; border: 1px solid #cbd2dc; border-radius: 5px; background: white; color: #235c80; cursor: pointer; font: inherit; }
</style>
