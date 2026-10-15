<template>
  <div class="voice-message">
    <div class="voice-player" :class="{ playing: isPlaying }">
      <button type="button" class="voice-play" :aria-label="isPlaying || loading ? 'Tạm dừng ghi âm' : 'Phát ghi âm'" :title="isPlaying || loading ? 'Tạm dừng' : 'Phát ghi âm'" :disabled="!source" @click.stop="togglePlay">
        <LoaderCircle v-if="loading" :size="18" class="spin" /><Pause v-else-if="isPlaying" :size="18" /><Play v-else :size="18" />
      </button>
      <input class="voice-seek" type="range" aria-label="Tua ghi âm" min="0" :max="totalSec || 1" step="0.1" :value="currentSec" :disabled="!totalSec || !!error" @input="seek" />
      <span class="voice-dur">{{ displayTime }}</span>
      <button type="button" class="voice-download" title="Tải ghi âm" aria-label="Tải ghi âm" :disabled="downloading || !source" @click.stop="download"><LoaderCircle v-if="downloading" :size="16" class="spin" /><Download v-else :size="16" /></button>
      <audio v-if="source" :key="source" ref="audioEl" :src="source" preload="metadata" @loadedmetadata="onMeta" @durationchange="onMeta" @timeupdate="onTime" @playing="isPlaying = true; loading = false" @pause="isPlaying = false" @ended="onEnded" @error="onError" @waiting="loading = true" @canplay="loading = false" />
    </div>
    <div v-if="error || !source" class="voice-error" role="alert"><span>{{ error || 'Ghi âm chưa có đường dẫn tải.' }}</span><button v-if="source" type="button" @click.stop="retry">Thử lại</button></div>
    <div v-if="downloadError" class="voice-error" role="alert">{{ downloadError }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Download, LoaderCircle, Pause, Play } from 'lucide-vue-next';
import { api } from '@/api';
const props = defineProps<{ audioUrl: string; fallbackUrls?: string[]; durationMs?: number }>();
const audioEl = ref<HTMLAudioElement | null>(null);
const candidates = computed(() => [...new Set([props.audioUrl, ...(props.fallbackUrls || [])].filter(Boolean))]);
const index = ref(0);
const source = computed(() => candidates.value[index.value] || '');
const currentSec = ref(0), totalSec = ref(0), isPlaying = ref(false), loading = ref(false), error = ref('');
const downloading = ref(false), downloadError = ref('');
let generation = 0, disposed = false, wanted = false;
let downloadController: AbortController | null = null;
let downloadObjectUrl = '';
let downloadTimer: ReturnType<typeof setTimeout> | undefined;
const displayTime = computed(() => {
  const seconds = Math.floor(isPlaying.value || currentSec.value > 0 ? currentSec.value : totalSec.value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
});
watch(() => JSON.stringify(candidates.value), () => {
  generation++; wanted = false; audioEl.value?.pause(); index.value = 0; currentSec.value = 0;
  totalSec.value = Number.isFinite(props.durationMs) ? Math.max(0, (props.durationMs || 0) / 1000) : 0;
  isPlaying.value = false; loading.value = false; error.value = ''; downloadError.value = '';
  downloadController?.abort(); downloading.value = false;
}, { immediate: true });
function onMeta() { const duration = audioEl.value?.duration; if (duration && Number.isFinite(duration)) totalSec.value = duration; }
function onTime() { currentSec.value = audioEl.value?.currentTime || 0; }
function onEnded() { wanted = false; isPlaying.value = false; loading.value = false; currentSec.value = 0; }
async function play() {
  const element = audioEl.value, revision = generation;
  if (!element || disposed) return;
  loading.value = true; error.value = '';
  try { await element.play(); if (!disposed && revision === generation && element === audioEl.value && wanted) isPlaying.value = true; }
  catch (cause) {
    if (disposed || revision !== generation || element !== audioEl.value || !wanted) return;
    const name = (cause as Error).name;
    if (name === 'NotSupportedError') await onError();
    else { loading.value = false; isPlaying.value = false; error.value = 'Không phát được ghi âm. Bấm Thử lại hoặc tải tệp xuống.'; }
  }
}
function togglePlay() {
  if (isPlaying.value || loading.value) { wanted = false; generation++; audioEl.value?.pause(); isPlaying.value = false; loading.value = false; }
  else { wanted = true; void play(); }
}
async function onError(event?: Event) {
  if (event && event.target !== audioEl.value) return;
  if (disposed) return;
  generation++; isPlaying.value = false; loading.value = false;
  if (index.value + 1 < candidates.value.length) { index.value++; currentSec.value = 0; await nextTick(); if (wanted) void play(); }
  else error.value = 'Không tải hoặc phát được ghi âm. Bấm Thử lại hoặc tải tệp xuống.';
}
async function retry() {
  generation++; index.value = 0; error.value = ''; currentSec.value = 0; wanted = true;
  await nextTick(); audioEl.value?.load(); void play();
}
function seek(event: Event) {
  const element = audioEl.value;
  if (!element || !totalSec.value) return;
  try { element.currentTime = Math.min(totalSec.value, Math.max(0, Number((event.target as HTMLInputElement).value))); onTime(); } catch { /* Metadata may still be loading. */ }
}
function releaseDownload() { if (downloadObjectUrl) URL.revokeObjectURL(downloadObjectUrl); downloadObjectUrl = ''; }
async function download() {
  if (!source.value || downloading.value) return;
  const url = source.value, revision = generation;
  const ext = new URL(url, window.location.origin).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'audio';
  const name = `ghi-am.${ext}`;
  const controller = new AbortController(); downloadController = controller;
  downloading.value = true; downloadError.value = '';
  try {
    const { data } = await api.get<Blob>('/media/download', { params: { url, name }, responseType: 'blob', timeout: 120000, signal: controller.signal });
    if (disposed || revision !== generation || controller.signal.aborted) return;
    clearTimeout(downloadTimer); releaseDownload(); downloadObjectUrl = URL.createObjectURL(data);
    const link = document.createElement('a'); link.href = downloadObjectUrl; link.download = name; document.body.append(link); link.click(); link.remove();
    downloadTimer = setTimeout(releaseDownload, 60000);
  } catch { if (!disposed && !controller.signal.aborted && revision === generation) downloadError.value = 'Không tải được ghi âm. Hãy thử lại.'; }
  finally { if (downloadController === controller) downloading.value = false; }
}
onBeforeUnmount(() => { disposed = true; generation++; wanted = false; audioEl.value?.pause(); downloadController?.abort(); clearTimeout(downloadTimer); releaseDownload(); });
</script>

<style scoped>
.voice-message { max-width: 100%; min-width: 0; }
.voice-player { display: flex; align-items: center; gap: 8px; width: 252px; max-width: 100%; padding: 6px 8px; border-radius: 8px; background: var(--smax-grey-100, #eef2f5); color: #276582; }
.voice-play, .voice-download { display: grid; place-items: center; flex: 0 0 32px; width: 32px; height: 32px; border: 0; border-radius: 50%; cursor: pointer; background: #137ca2; color: #fff; }
.voice-download { width: 24px; height: 28px; flex-basis: 24px; background: transparent; color: #276582; border-radius: 4px; }
.voice-play:disabled, .voice-download:disabled { opacity: .6; cursor: default; }
.voice-seek { min-width: 0; width: 85px; flex: 1; accent-color: #137ca2; cursor: pointer; }
.voice-dur { font-size: 11px; font-variant-numeric: tabular-nums; min-width: 30px; white-space: nowrap; }
.voice-error { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; max-width: 252px; padding: 5px 0 0; font-size: 11px; color: var(--smax-text, #535e69); }
.voice-error button { padding: 3px 5px; border: 1px solid #a9b9c4; border-radius: 4px; background: #fff; color: #276582; cursor: pointer; }
.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
</style>
