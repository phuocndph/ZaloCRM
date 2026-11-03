<template>
  <button type="button" title="Sao chép ảnh" aria-label="Sao chép ảnh" :aria-busy="copyingImage"
    :disabled="!url || copyingImage" @click.stop="copyImage(url)">
    <LoaderCircle v-if="copyingImage" :size="18" class="copy-image-spin" />
    <Copy v-else :size="18" />
  </button>
</template>
<script setup lang="ts">
import { Copy, LoaderCircle } from 'lucide-vue-next';
import { useImageClipboard } from '@/composables/image-clipboard';
defineProps<{ url: string }>();
const { copyingImage, copyImage } = useImageClipboard();
</script>
<style scoped>
button { display: inline-flex; align-items: center; justify-content: center; }
button:disabled { opacity: .5; cursor: default; }
.copy-image-spin { animation: copy-image-spin 1s linear infinite; }
@keyframes copy-image-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .copy-image-spin { animation: none; } }
</style>
