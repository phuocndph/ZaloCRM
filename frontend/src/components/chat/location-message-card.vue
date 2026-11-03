<template>
  <section ref="card" class="location-card" aria-label="Vị trí được chia sẻ">
    <div v-if="location.coords" class="location-preview" :class="{ 'is-unavailable': mapState === 'failed' }">
      <iframe
        v-if="visible && mapState !== 'failed'"
        :key="attempt"
        :src="location.embedUrl"
        :title="`Bản đồ: ${location.title}`"
        class="location-map"
        referrerpolicy="no-referrer"
        tabindex="-1"
        @load="onMapLoad"
        @error="onMapError"
      />
      <a v-if="mapState !== 'failed'" :href="location.mapUrl" target="_blank" rel="noopener noreferrer"
        class="location-preview-link" :aria-label="`Mở bản đồ: ${location.title}`">
        <span class="location-preview-badge"><MapPinned :size="13" />Google Maps<ArrowUpRight :size="13" /></span>
      </a>
      <div v-if="mapState === 'loading'" class="location-map-state" role="status">
        <LoaderCircle :size="21" class="location-spinner" />
        <span>Đang tải bản đồ…</span>
      </div>
      <div v-else-if="mapState === 'failed'" class="location-map-state" role="status">
        <MapPinOff :size="24" />
        <span>Chưa tải được bản đồ</span>
        <button type="button" class="location-retry" @click="retryMap"><RefreshCw :size="13" />Thử lại</button>
      </div>
    </div>
    <div class="location-details">
      <div class="location-heading">
        <span class="location-pin"><MapPin :size="18" /></span>
        <div class="location-info">
          <div class="location-label">Vị trí đã gửi</div>
          <h3 class="location-title">{{ location.title }}</h3>
        </div>
        <button v-if="location.coords" type="button" class="location-copy" title="Sao chép vị trí"
          aria-label="Sao chép vị trí" @click.stop="copyLocation">
          <Check v-if="copyState === 'copied'" :size="16" /><Copy v-else :size="16" />
        </button>
      </div>
      <p v-if="location.address && location.address !== location.title" class="location-address">{{ location.address }}</p>
      <p v-if="location.coords" class="location-coordinates">{{ location.coords.lat.toFixed(6) }}, {{ location.coords.lng.toFixed(6) }}</p>
      <p v-else class="location-unavailable">Tin nhắn không kèm tọa độ hợp lệ.</p>
      <p v-if="copyState" class="location-copy-status" :class="{ 'is-error': copyState === 'failed' }" role="status" aria-live="polite">
        {{ copyState === 'copied' ? 'Đã sao chép địa điểm và tọa độ' : 'Không sao chép được. Hãy chọn địa chỉ hoặc tọa độ để sao chép.' }}
      </p>
    </div>
    <div v-if="location.coords" class="location-actions">
      <a :href="location.mapUrl" target="_blank" rel="noopener noreferrer" class="location-action"><ExternalLink :size="15" />Mở bản đồ</a>
      <a :href="location.directionsUrl" target="_blank" rel="noopener noreferrer" class="location-action primary"><Navigation :size="15" />Chỉ đường</a>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ArrowUpRight, Check, Copy, ExternalLink, LoaderCircle, MapPin, MapPinned, MapPinOff, Navigation, RefreshCw } from 'lucide-vue-next';
import { chatLocation } from '@/composables/chat-location';

const props = defineProps<{ content: unknown }>();
const location = computed(() => chatLocation(props.content));
const mapState = ref<'loading' | 'ready' | 'failed'>('loading');
const copyState = ref<'' | 'copied' | 'failed'>('');
const attempt = ref(0);
const card = ref<HTMLElement>();
const visible = ref(false);
let observer: IntersectionObserver | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

function restartMap() {
  clearTimeout(timeout);
  mapState.value = location.value.coords ? 'loading' : 'failed';
  if (visible.value && location.value.coords) timeout = setTimeout(onMapError, 15000);
}
function onMapLoad() { clearTimeout(timeout); mapState.value = 'ready'; }
function onMapError() { clearTimeout(timeout); mapState.value = 'failed'; }
function retryMap() { attempt.value++; restartMap(); }
watch(() => location.value.embedUrl, () => { attempt.value++; generation++; copyState.value = ''; restartMap(); }, { immediate: true });
onMounted(() => {
  const showMap = () => { visible.value = true; observer?.disconnect(); restartMap(); };
  if (!('IntersectionObserver' in window) || !card.value) { showMap(); return; }
  observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) showMap();
  }, { rootMargin: '100px' });
  observer.observe(card.value);
});
onBeforeUnmount(() => { generation++; clearTimeout(timeout); observer?.disconnect(); });

async function copyLocation() {
  const value = location.value;
  if (!value.coords) return;
  const currentGeneration = generation;
  const contents = [value.title, value.address !== value.title ? value.address : '', value.point, value.mapUrl].filter(Boolean).join('\n');
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(contents); copied = true; }
  } catch { /* HTTP deployments can still use the selection-based fallback. */ }
  if (!copied && currentGeneration === generation) {
    const activeElement = document.activeElement as HTMLElement | null;
    const field = document.createElement('textarea');
    field.value = contents;
    field.readOnly = true;
    field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.append(field);
    try { field.select(); copied = document.execCommand('copy'); } catch { /* Render failure below. */ }
    finally { field.remove(); activeElement?.focus({ preventScroll: true }); }
  }
  if (currentGeneration === generation) copyState.value = copied ? 'copied' : 'failed';
}
</script>

<style scoped>
.location-card { width: 320px; max-width: 100%; overflow: hidden; box-sizing: border-box; border: 1px solid #dce3e7; border-radius: 8px; background: #fff; color: #202c33; text-align: left; }
.location-preview { position: relative; width: 100%; aspect-ratio: 16 / 8; overflow: hidden; background: #f2f5f6; border-bottom: 1px solid #e8edef; }
.location-map { display: block; width: 100%; height: 100%; border: 0; pointer-events: none; }
.location-preview-link { position: absolute; inset: 0; z-index: 1; color: #27373e; }
.location-preview-link:focus-visible { outline: 3px solid #1786be; outline-offset: -3px; }
.location-preview-badge { position: absolute; right: 8px; bottom: 8px; display: inline-flex; align-items: center; gap: 5px; padding: 5px 7px; border: 1px solid #e1e7ea; border-radius: 4px; background: #fff; font-size: 10px; font-weight: 600; box-shadow: 0 1px 4px #00000012; }
.location-map-state { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: #f2f5f6; color: #647780; font-size: 12px; pointer-events: none; }
.location-retry { display: inline-flex; align-items: center; gap: 5px; border: 0; padding: 4px 7px; background: transparent; color: #0d759f; font: inherit; cursor: pointer; pointer-events: auto; }
.location-spinner { animation: location-spin 1.2s linear infinite; }
.location-details { padding: 12px; }
.location-heading { display: flex; align-items: flex-start; gap: 9px; }
.location-pin { display: grid; place-items: center; width: 32px; height: 32px; flex: 0 0 32px; background: #eaf5f1; border-radius: 6px; color: #16765b; }
.location-info { min-width: 0; flex: 1; }
.location-label { margin-bottom: 3px; color: #6b7b83; font-size: 10.5px; line-height: 1.3; }
.location-title { margin: 0; font-size: 13px; font-weight: 650; line-height: 1.45; overflow-wrap: anywhere; }
.location-copy { display: grid; place-items: center; width: 30px; height: 30px; flex: 0 0 30px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: #607781; cursor: pointer; }
.location-copy:hover { background: #edf5f6; color: #0a7c9c; }
.location-copy:focus-visible, .location-action:focus-visible, .location-retry:focus-visible { outline: 2px solid #1786be; outline-offset: 2px; }
.location-address { margin: 9px 0 0; font-size: 12px; line-height: 1.6; color: #52656f; overflow-wrap: anywhere; user-select: text; }
.location-coordinates { margin: 5px 0 0; color: #7b8c95; font-size: 10.5px; line-height: 1.5; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; user-select: text; }
.location-unavailable, .location-copy-status { margin: 7px 0 0; font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; color: #16765b; }
.location-unavailable, .location-copy-status.is-error { color: #94602e; }
.location-actions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; padding: 0 12px 12px; }
.location-action { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 6px; border: 1px solid #dce5e8; border-radius: 5px; color: #4c656f; background: #fff; text-decoration: none; font-size: 12px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
.location-action svg { flex-shrink: 0; }
.location-action:hover { background: #f3f7f8; }
.location-action.primary { background: #eaf5f1; border-color: #d2e8dd; color: #136c51; }
.location-action.primary:hover { background: #deeee5; }
@keyframes location-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .location-spinner { animation: none; } }
</style>
