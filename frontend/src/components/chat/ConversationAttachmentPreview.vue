<template>
  <v-dialog :model-value="!!attachment" max-width="1040" @update:model-value="!$event && close()">
    <section class="cap" aria-label="Xem tệp đính kèm">
      <header class="cap-head">
        <strong :title="attachment?.name">{{ attachment?.name }}</strong>
        <span v-if="attachment?.kind === 'image' && images.length > 1">{{ imageIndex + 1 }}/{{ images.length }}</span>
        <button type="button" title="Tải xuống" aria-label="Tải xuống" :disabled="downloading" @click="download">
          <LoaderCircle v-if="downloading" :size="18" class="spin" /><Download v-else :size="18" />
        </button>
        <button ref="closeButton" type="button" title="Đóng bản xem trước" aria-label="Đóng bản xem trước" @click="close"><X :size="18" /></button>
      </header>
      <div class="cap-body">
        <div v-if="loading" class="cap-state" role="status"><LoaderCircle :size="22" class="spin" /> Đang tải bản xem trước</div>
        <div v-else-if="error" class="cap-state" role="alert"><FileWarning :size="24" /><span>{{ error }}</span></div>
        <template v-else-if="attachment?.kind === 'image'">
          <img :src="attachment.url" :alt="attachment.name" @error="error = 'Không tải được ảnh.'" />
          <button v-if="images.length > 1" class="cap-nav cap-prev" type="button" title="Ảnh trước" aria-label="Ảnh trước" :disabled="imageIndex <= 0" @click="step(-1)"><ChevronLeft :size="24" /></button>
          <button v-if="images.length > 1" class="cap-nav cap-next" type="button" title="Ảnh sau" aria-label="Ảnh sau" :disabled="imageIndex >= images.length - 1" @click="step(1)"><ChevronRight :size="24" /></button>
        </template>
        <video v-else-if="attachment?.kind === 'video'" :src="attachment.url" controls @error="error = 'Không tải được video.'" />
        <iframe v-else-if="previewUrl" :src="previewUrl" title="Nội dung PDF" />
        <div v-else-if="rows.length" class="cap-sheet">
          <table><tbody><tr v-for="(row, index) in rows" :key="index"><td v-for="(cell, column) in row" :key="column">{{ cell }}</td></tr></tbody></table>
        </div>
        <pre v-else-if="text !== null">{{ text }}</pre>
        <div v-else class="cap-state"><FileText :size="24" /><span>Định dạng này chưa hỗ trợ xem trước. Bạn có thể tải tệp xuống để mở.</span></div>
      </div>
      <footer v-if="sheetName" class="cap-foot">{{ sheetName }} · Tối đa 200 dòng, 30 cột</footer>
    </section>
  </v-dialog>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue';
import { ChevronLeft, ChevronRight, Download, FileText, FileWarning, LoaderCircle, X } from 'lucide-vue-next';
import { api } from '@/api';
import { useToast } from '@/composables/use-toast';

type Attachment = { url: string; name: string; kind: 'image' | 'video' | 'file' };
const toast = useToast();
const attachment = ref<Attachment | null>(null);
const images = ref<string[]>([]);
const imageIndex = ref(0);
const loading = ref(false);
const downloading = ref(false);
const error = ref('');
const previewUrl = ref('');
const rows = ref<string[][]>([]);
const text = ref<string | null>(null);
const sheetName = ref('');
const closeButton = ref<HTMLButtonElement | null>(null);
let sequence = 0;
let controller: AbortController | null = null;
let downloadController: AbortController | null = null;
const downloads = new Map<string, ReturnType<typeof setTimeout>>();

function close() {
  ++sequence;
  controller?.abort();
  downloadController?.abort();
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
  attachment.value = null;
  images.value = [];
  loading.value = false;
  downloading.value = false;
  error.value = '';
  rows.value = [];
  text.value = null;
  sheetName.value = '';
}

async function open(url: string, name: string, kind: Attachment['kind'] = 'file', gallery: string[] = []) {
  close();
  const request = sequence;
  attachment.value = { url, name, kind };
  images.value = gallery;
  imageIndex.value = Math.max(0, gallery.indexOf(url));
  void nextTick(() => closeButton.value?.focus());
  if (kind !== 'file') return;
  const extension = (name.split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] || url.split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (!['pdf', 'xlsx', 'txt', 'csv'].includes(extension)) return;
  const current = new AbortController();
  controller = current;
  loading.value = true;
  try {
    const { data } = await api.get<Blob>(extension === 'xlsx' ? '/media/download' : '/media/preview', {
      params: { url, name }, responseType: 'blob', timeout: 120_000, signal: current.signal,
    });
    if (request !== sequence || current.signal.aborted) return;
    if (extension === 'pdf') {
      previewUrl.value = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
    } else if (extension === 'xlsx') {
      const ExcelJS = (await import('exceljs')).default;
      if (request !== sequence || current.signal.aborted) return;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await data.arrayBuffer());
      if (request !== sequence || current.signal.aborted) return;
      const sheet = workbook.worksheets[0];
      if (sheet) {
        sheetName.value = sheet.name;
        rows.value = Array.from({ length: Math.min(sheet.rowCount, 200) }, (_, row) =>
          Array.from({ length: Math.min(sheet.columnCount, 30) }, (_, column) => sheet.getCell(row + 1, column + 1).text),
        );
      }
      if (!rows.value.length) error.value = 'Tệp Excel không có dữ liệu.';
    } else {
      const contents = await data.text();
      if (request === sequence && !current.signal.aborted) text.value = contents;
    }
  } catch {
    if (request === sequence && !current.signal.aborted) error.value = 'Không đọc được bản xem trước. Bạn có thể tải tệp xuống để mở.';
  } finally {
    if (request === sequence) loading.value = false;
  }
}

function step(direction: number) {
  const index = imageIndex.value + direction;
  if (!images.value[index] || !attachment.value) return;
  imageIndex.value = index;
  attachment.value.url = images.value[index];
  error.value = '';
}

async function download() {
  if (!attachment.value || downloading.value) return;
  const file = { ...attachment.value };
  const request = sequence;
  const current = new AbortController();
  downloadController = current;
  downloading.value = true;
  try {
    const { data } = await api.get<Blob>('/media/download', {
      params: { url: file.url, name: file.name }, responseType: 'blob', timeout: 120_000, signal: current.signal,
    });
    if (request !== sequence || current.signal.aborted) return;
    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    downloads.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 4000));
  } catch {
    if (request === sequence && !current.signal.aborted) toast.error('Không tải được tệp. Vui lòng thử lại.');
  } finally {
    if (request === sequence) downloading.value = false;
  }
}

onBeforeUnmount(() => {
  close();
  for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); }
});
defineExpose({ open, close });
</script>

<style scoped>
.cap { display: flex; flex-direction: column; max-height: 90dvh; background: #fff; color: #172033; border-radius: 8px; overflow: hidden; }
.cap-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid #e4e7ec; }
.cap-head strong { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
.cap-head span { flex-shrink: 0; font-size: 12px; color: #667085; }
.cap button { display: grid; place-items: center; width: 34px; height: 34px; flex-shrink: 0; border: 1px solid #e4e7ec; border-radius: 6px; color: #475467; background: #fff; cursor: pointer; }
.cap button:disabled { opacity: .4; cursor: default; }
.cap-body { position: relative; display: flex; align-items: center; justify-content: center; min-height: 250px; height: 70dvh; min-width: 0; overflow: auto; background: #f4f6f8; }
.cap-body img, .cap-body video { display: block; max-width: 100%; max-height: 100%; object-fit: contain; }
.cap-body iframe { width: 100%; height: 100%; border: 0; }
.cap-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px; color: #667085; text-align: center; font-size: 13px; }
.cap-nav { position: absolute; top: 50%; }
.cap-prev { left: 12px; }
.cap-next { right: 12px; }
.cap-sheet { width: 100%; height: 100%; overflow: auto; }
.cap-sheet table { border-collapse: collapse; min-width: 100%; background: #fff; font-size: 12px; }
.cap-sheet td { min-width: 80px; max-width: 320px; padding: 8px; border: 1px solid #d0d5dd; white-space: pre-wrap; overflow-wrap: anywhere; vertical-align: top; }
.cap-body pre { align-self: stretch; width: 100%; margin: 0; padding: 16px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
.cap-foot { padding: 8px 14px; border-top: 1px solid #e4e7ec; color: #667085; font-size: 11px; }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
