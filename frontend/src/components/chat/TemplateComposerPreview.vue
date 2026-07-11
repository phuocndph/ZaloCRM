<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  TemplateComposerPreview — Xem trước & gửi chuỗi tin nhắn theo BLOCK (2026-07-11).

  Mở khi chọn mẫu có ảnh/nhiều bước. TUYỆT ĐỐI không gửi gì lúc mở — chỉ hiển thị các block
  theo thứ tự để sale sửa text / xoá ảnh / sắp xếp / bật-tắt rồi bấm "Gửi toàn bộ". Khi gửi:
  tuần tự theo thứ tự, chờ block trước xong mới gửi block sau, có delay, dừng khi lỗi (retry/
  bỏ qua/huỷ), idempotency bằng echoId (không gửi trùng khi retry), tiến trình 2/4, nút Dừng.
-->
<template>
  <div class="tcp">
    <div class="tcp-head">
      <div class="tcp-title">
        <v-icon size="16">mdi-format-list-numbered</v-icon>
        Xem trước chuỗi tin · {{ plannedCount }} tin
      </div>
      <div v-if="sending" class="tcp-progress">Đang gửi {{ sentCount }}/{{ plannedCount }}…</div>
      <button class="tcp-x" title="Đóng" :disabled="sending" @click="onCancel">×</button>
    </div>

    <div class="tcp-list">
      <div
        v-for="(b, i) in blocks"
        :key="b.id"
        class="tcp-block"
        :class="[`st-${b.status || 'pending'}`, { disabled: !b.enabled }]"
      >
        <div class="tcp-block-bar">
          <span class="tcp-idx">{{ i + 1 }}</span>
          <span class="tcp-type">{{ typeLabel(b) }}</span>
          <span class="tcp-status" :class="`st-${b.status || 'pending'}`">{{ statusLabel(b.status) }}</span>
          <span class="tcp-tools">
            <button title="Lên" :disabled="sending || i === 0" @click="move(i, -1)"><v-icon size="15">mdi-arrow-up</v-icon></button>
            <button title="Xuống" :disabled="sending || i === blocks.length - 1" @click="move(i, 1)"><v-icon size="15">mdi-arrow-down</v-icon></button>
            <button v-if="b.type === 'text'" title="Nhân bản" :disabled="sending" @click="duplicate(i)"><v-icon size="15">mdi-content-copy</v-icon></button>
            <button :title="b.enabled ? 'Tắt gửi block này' : 'Bật gửi'" :disabled="sending" @click="b.enabled = !b.enabled">
              <v-icon size="15">{{ b.enabled ? 'mdi-eye-outline' : 'mdi-eye-off-outline' }}</v-icon>
            </button>
            <button title="Xoá block" :disabled="sending" @click="removeBlock(i)"><v-icon size="15">mdi-close</v-icon></button>
          </span>
        </div>

        <!-- Text -->
        <template v-if="b.type === 'text'">
          <textarea v-model="b.content" class="tcp-text" rows="2" :disabled="sending" placeholder="Nội dung tin…"></textarea>
          <button v-if="canSplit(b)" class="tcp-split" :disabled="sending" @click="splitBlock(i)">
            <v-icon size="13">mdi-call-split</v-icon> Tách theo dòng trống thành nhiều tin
          </button>
        </template>

        <!-- Delay -->
        <div v-else-if="b.type === 'delay'" class="tcp-delay">
          <v-icon size="15">mdi-timer-sand</v-icon> Chờ
          <input v-model.number="b.delayMs" type="number" min="0" max="10000" step="100" class="tcp-delay-inp" :disabled="sending" /> ms
        </div>

        <!-- Ảnh / album / file / video -->
        <div v-else class="tcp-atts">
          <div v-for="(a, ai) in b.attachments" :key="ai" class="tcp-att">
            <img v-if="a.kind === 'image' && (a.thumb || a.url)" :src="a.thumb || a.url" class="tcp-att-thumb" alt="" />
            <span v-else class="tcp-att-file"><v-icon size="18">{{ a.kind === 'video' ? 'mdi-video-outline' : 'mdi-file-outline' }}</v-icon></span>
            <button class="tcp-att-x" title="Xoá ảnh này" :disabled="sending" @click="removeAtt(b, ai)">×</button>
            <span v-if="!a.assetId" class="tcp-att-warn" title="Ảnh không có trong Kho Media — không gửi được">!</span>
          </div>
          <span v-if="!b.attachments || b.attachments.length === 0" class="tcp-empty-att">Chưa có ảnh</span>
        </div>

        <div v-if="b.error" class="tcp-error">
          {{ b.error }}
          <span class="tcp-error-acts">
            <button @click="retryFrom(i)">Gửi lại</button>
            <button @click="skipAndContinue(i)">Bỏ qua & tiếp</button>
          </span>
        </div>
      </div>
    </div>

    <div class="tcp-add">
      <button :disabled="sending" @click="addText"><v-icon size="14">mdi-text-box-plus-outline</v-icon> Thêm đoạn text</button>
      <button :disabled="sending" @click="addDelay"><v-icon size="14">mdi-timer-plus-outline</v-icon> Thêm khoảng chờ</button>
      <label class="tcp-defdelay">
        Delay mặc định
        <select v-model.number="defaultDelayMs" :disabled="sending">
          <option :value="0">0</option>
          <option :value="300">300ms</option>
          <option :value="500">500ms</option>
          <option :value="1000">1000ms</option>
        </select>
      </label>
    </div>

    <div class="tcp-foot">
      <button v-if="!sending" class="tcp-btn tcp-ghost" @click="onCancel">Huỷ</button>
      <button v-else class="tcp-btn tcp-stop" @click="stop">■ Dừng phần còn lại</button>
      <span class="tcp-spacer"></span>
      <button
        v-if="!sending"
        class="tcp-btn tcp-send"
        :disabled="plannedCount === 0 || !canSend"
        :title="!canSend ? 'Bạn không có quyền gửi trong hội thoại này' : ''"
        @click="sendAll()"
      >Gửi toàn bộ ({{ plannedCount }})</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { api } from '@/api/index';
import { sendMediaToConversation } from '@/api/media';
import { useToast } from '@/composables/use-toast';
import {
  newBlockId, sendableBlocks, splitTextByBlankLines,
  type TemplateBlock,
} from '@/composables/use-template-blocks';

const props = defineProps<{
  conversationId: string;
  initialBlocks: TemplateBlock[];
  canSend: boolean;
}>();
const emit = defineEmits<{ cancel: []; done: [] }>();

const toast = useToast();
const blocks = ref<TemplateBlock[]>(props.initialBlocks.map((b) => ({ ...b, status: 'pending', error: null })));
const sending = ref(false);
const defaultDelayMs = ref(300);
let stopped = false;

// echoId ổn định / block (idempotency) — sinh 1 lần, retry dùng lại → server dedup, không gửi trùng.
const echoIds = new Map<string, string>();
function echoFor(id: string): string {
  if (!echoIds.has(id)) echoIds.set(id, `tpl_${id}_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`);
  return echoIds.get(id)!;
}

const plannedCount = computed(() => sendableBlocks(blocks.value).filter((b) => b.type !== 'delay').length);
const sentCount = computed(() => blocks.value.filter((b) => b.status === 'sent' && b.type !== 'delay').length);

function typeLabel(b: TemplateBlock): string {
  return b.type === 'text' ? 'Text' : b.type === 'image_album' ? `Album ${b.attachments?.length ?? 0} ảnh`
    : b.type === 'image' ? 'Ảnh' : b.type === 'video' ? 'Video' : b.type === 'file' ? 'File' : 'Chờ';
}
function statusLabel(s?: string): string {
  return ({ sending: 'Đang gửi', sent: 'Đã gửi', failed: 'Lỗi', skipped: 'Bỏ qua', cancelled: 'Đã huỷ' } as Record<string, string>)[s || ''] || '';
}
function canSplit(b: TemplateBlock): boolean { return b.type === 'text' && splitTextByBlankLines(b.content || '').length > 1; }

// ── Chỉnh sửa block (trước khi gửi) ──
function move(i: number, dir: number) {
  const j = i + dir;
  if (j < 0 || j >= blocks.value.length) return;
  const arr = blocks.value;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}
function removeBlock(i: number) { blocks.value.splice(i, 1); }
function duplicate(i: number) {
  const b = blocks.value[i];
  blocks.value.splice(i + 1, 0, { ...b, id: newBlockId(), status: 'pending', error: null });
}
function removeAtt(b: TemplateBlock, ai: number) {
  b.attachments?.splice(ai, 1);
  if (b.attachments && b.attachments.length > 1) b.type = 'image_album';
  else if (b.attachments && b.attachments.length === 1) b.type = b.attachments[0].kind === 'image' ? 'image' : b.attachments[0].kind === 'video' ? 'video' : 'file';
}
function addText() { blocks.value.push({ id: newBlockId(), type: 'text', content: '', enabled: true, status: 'pending' }); }
function addDelay() { blocks.value.push({ id: newBlockId(), type: 'delay', delayMs: defaultDelayMs.value, enabled: true, status: 'pending' }); }
function splitBlock(i: number) {
  const b = blocks.value[i];
  const parts = splitTextByBlankLines(b.content || '');
  if (parts.length < 2) return;
  const newOnes: TemplateBlock[] = parts.map((p) => ({ id: newBlockId(), type: 'text', content: p, enabled: true, status: 'pending' }));
  blocks.value.splice(i, 1, ...newOnes);
}

// ── Gửi tuần tự ──
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendTextBlock(b: TemplateBlock) {
  await api.post(`/conversations/${props.conversationId}/messages`, {
    content: b.content,
    echoId: echoFor(b.id), // idempotency: retry cùng echoId → BE dedup
  });
}
async function sendMediaBlock(b: TemplateBlock) {
  for (const a of b.attachments ?? []) {
    if (!a.assetId) throw new Error('Ảnh không có trong Kho Media — không gửi được');
    await sendMediaToConversation(a.assetId, props.conversationId);
  }
}

async function runPlan(fromBlockId?: string) {
  if (!props.canSend) { toast.push('Bạn không có quyền gửi trong hội thoại này'); return; }
  sending.value = true;
  stopped = false;
  // Reset lỗi cũ (giữ trạng thái 'sent' để KHÔNG gửi lại — chống trùng khi retry).
  for (const b of blocks.value) if (b.status === 'failed') b.error = null;

  const plan = sendableBlocks(blocks.value);
  let started = !fromBlockId;
  for (const b of plan) {
    if (fromBlockId && b.id === fromBlockId) started = true;
    if (!started) continue;
    if (b.status === 'sent') continue; // đã gửi thành công → bỏ qua (idempotent resume)
    if (stopped) { b.status = 'cancelled'; continue; }
    b.status = 'sending';
    try {
      if (b.type === 'delay') { await sleep(b.delayMs ?? 0); b.status = 'sent'; continue; }
      if (b.type === 'text') await sendTextBlock(b);
      else await sendMediaBlock(b);
      b.status = 'sent';
      b.error = null;
      if (defaultDelayMs.value > 0) await sleep(defaultDelayMs.value);
    } catch (e: any) {
      b.status = 'failed';
      b.error = e?.response?.data?.error || e?.message || 'Gửi thất bại';
      sending.value = false;
      return; // DỪNG khi lỗi (mặc định) — chờ sale chọn retry/bỏ qua/huỷ
    }
  }
  sending.value = false;
  const allSent = plan.every((b) => b.status === 'sent' || b.status === 'skipped' || b.status === 'cancelled');
  if (allSent && !stopped) { toast.push('Đã gửi xong chuỗi tin'); emit('done'); }
}

function sendAll() { void runPlan(); }
function retryFrom(i: number) { void runPlan(blocks.value[i].id); }
function skipAndContinue(i: number) {
  blocks.value[i].status = 'skipped';
  blocks.value[i].error = null;
  // Tiếp tục từ block KẾ TIẾP trong kế hoạch.
  const plan = sendableBlocks(blocks.value);
  const idx = plan.findIndex((b) => b.id === blocks.value[i].id);
  const next = plan[idx + 1];
  if (next) void runPlan(next.id); else { sending.value = false; }
}
function stop() {
  stopped = true;
  for (const b of blocks.value) if (b.status === 'pending') b.status = 'cancelled';
  toast.push('Đã dừng — các tin chưa gửi được huỷ');
}
function onCancel() { if (sending.value) return; emit('cancel'); }
</script>

<style scoped>
.tcp { display: flex; flex-direction: column; background: var(--smax-bg, #fff); border: 1px solid var(--smax-grey-200, #ebedf0); border-radius: 12px; box-shadow: 0 -2px 12px rgba(15,23,42,.06); max-height: 46vh; overflow: hidden; }
.tcp-head { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--smax-grey-200, #ebedf0); flex-shrink: 0; }
.tcp-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--smax-text); }
.tcp-progress { font-size: 12px; color: var(--smax-primary, #1786be); font-weight: 600; }
.tcp-x { margin-left: auto; border: none; background: transparent; font-size: 22px; line-height: 1; color: var(--chat-meta, #6b7688); cursor: pointer; width: 28px; height: 28px; border-radius: 6px; }
.tcp-x:hover:not(:disabled) { background: var(--smax-grey-100, #f5f6fa); }
.tcp-list { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 7px; }
.tcp-block { border: 1px solid var(--smax-grey-200, #ebedf0); border-radius: 10px; padding: 7px 9px; background: #fff; }
.tcp-block.disabled { opacity: .5; }
.tcp-block.st-sent { border-color: #86efac; background: #f0fdf4; }
.tcp-block.st-sending { border-color: var(--smax-primary); }
.tcp-block.st-failed { border-color: #fca5a5; background: #fef2f2; }
.tcp-block.st-cancelled { border-color: #d4d4d8; }
.tcp-block-bar { display: flex; align-items: center; gap: 7px; }
.tcp-idx { width: 20px; height: 20px; border-radius: 50%; background: var(--smax-grey-100, #f5f6fa); color: var(--chat-meta); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.tcp-type { font-size: 11.5px; font-weight: 600; color: var(--smax-text); }
.tcp-status { font-size: 10.5px; font-weight: 600; }
.tcp-status.st-sent { color: #16a34a; }
.tcp-status.st-sending { color: var(--smax-primary); }
.tcp-status.st-failed { color: #dc2626; }
.tcp-tools { margin-left: auto; display: flex; gap: 1px; }
.tcp-tools button { border: none; background: transparent; color: var(--chat-meta); cursor: pointer; width: 26px; height: 26px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
.tcp-tools button:hover:not(:disabled) { background: var(--smax-grey-100, #f5f6fa); color: var(--smax-text); }
.tcp-tools button:disabled { opacity: .35; cursor: default; }
.tcp-text { width: 100%; margin-top: 6px; border: 1px solid var(--smax-grey-200, #ebedf0); border-radius: 8px; padding: 6px 9px; font-size: 13px; font-family: inherit; resize: vertical; color: var(--smax-text); line-height: 1.45; }
.tcp-text:focus { outline: none; border-color: var(--smax-primary); }
.tcp-split { margin-top: 5px; display: inline-flex; align-items: center; gap: 4px; border: none; background: transparent; color: var(--smax-primary); font-size: 11.5px; cursor: pointer; padding: 2px 0; }
.tcp-delay { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12.5px; color: var(--chat-meta); }
.tcp-delay-inp { width: 72px; border: 1px solid var(--smax-grey-200); border-radius: 6px; padding: 3px 6px; font-size: 12px; }
.tcp-atts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.tcp-att { position: relative; width: 54px; height: 54px; border-radius: 8px; overflow: hidden; border: 1px solid var(--smax-grey-200); background: var(--smax-grey-100); }
.tcp-att-thumb { width: 100%; height: 100%; object-fit: cover; }
.tcp-att-file { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--chat-meta); }
.tcp-att-x { position: absolute; top: 1px; right: 1px; width: 17px; height: 17px; border-radius: 50%; border: none; background: rgba(0,0,0,.55); color: #fff; font-size: 12px; line-height: 1; cursor: pointer; }
.tcp-att-warn { position: absolute; bottom: 1px; left: 1px; width: 16px; height: 16px; border-radius: 50%; background: #f59e0b; color: #fff; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.tcp-empty-att { font-size: 11.5px; color: var(--chat-meta); font-style: italic; }
.tcp-error { margin-top: 6px; font-size: 11.5px; color: #dc2626; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tcp-error-acts { display: flex; gap: 6px; }
.tcp-error-acts button { border: 1px solid #fca5a5; background: #fff; color: #b91c1c; border-radius: 6px; padding: 2px 8px; font-size: 11px; cursor: pointer; }
.tcp-add { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-top: 1px solid var(--smax-grey-100, #f5f6fa); flex-wrap: wrap; }
.tcp-add > button { display: inline-flex; align-items: center; gap: 4px; border: 1px dashed var(--smax-grey-300, #d4d8de); background: #fff; color: var(--smax-primary); border-radius: 8px; padding: 5px 9px; font-size: 12px; cursor: pointer; }
.tcp-defdelay { margin-left: auto; font-size: 11.5px; color: var(--chat-meta); display: inline-flex; align-items: center; gap: 5px; }
.tcp-defdelay select { border: 1px solid var(--smax-grey-200); border-radius: 6px; padding: 3px 5px; font-size: 12px; }
.tcp-foot { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--smax-grey-200, #ebedf0); flex-shrink: 0; }
.tcp-spacer { flex: 1; }
.tcp-btn { padding: 8px 16px; border-radius: 9px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
.tcp-send { background: var(--smax-primary, #1786be); color: #fff; }
.tcp-send:disabled { opacity: .5; cursor: not-allowed; }
.tcp-ghost { background: var(--smax-grey-100, #f5f6fa); color: var(--smax-text); }
.tcp-stop { background: rgba(239,68,68,.12); color: #dc2626; }
@media (max-width: 640px) { .tcp { max-height: 60vh; } }
</style>
