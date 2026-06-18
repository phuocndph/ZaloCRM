<!--
  SequenceFlowMap.vue — Hiển thị các BƯỚC của 1 sequence dạng "đường đua" (2026-06-18).
  Thay chuỗi NGANG cũ (tràn khi 15-20 bước). Dùng chung cho /marketing/sequences + Mục tiêu wizard.

  Thu gọn: dải mini-map — mỗi ô = 1 bước (màu theo loại hành động), uốn xuống hàng kế chạy
  ngược lại (rắn bò / U-turn) khi nhiều bước → KHÔNG bao giờ cuộn ngang, vừa MỌI bề rộng.
  Bấm "Xem chi tiết" → mở list dọc (số · loại · tên · thời điểm gửi).

  Props: steps = FlowStep[] (parent tự map từ step thật → shape chuẩn này, component thuần).
-->
<template>
  <div class="sfm">
    <div v-if="!steps.length" class="sfm-empty">Chưa có bước nào</div>
    <template v-else>
      <!-- DẢI ĐƯỜNG ĐUA -->
      <div ref="trackEl" class="sfm-track">
        <template v-for="(row, r) in rows" :key="r">
          <div class="sfm-lane" :class="{ rtl: r % 2 === 1 }">
            <div
              v-for="st in row"
              :key="st.no"
              class="sfm-seg"
              :class="'c-' + st.category"
              :style="{ width: segW + 'px' }"
              :title="`Bước ${st.no} · ${st.label}: ${st.name}${st.when ? ' · ' + st.when : ''}`"
            >{{ st.no }}</div>
          </div>
          <div v-if="r < rows.length - 1" class="sfm-bend" :class="r % 2 === 0 ? 'right' : 'left'"><i></i></div>
        </template>
      </div>

      <div class="sfm-foot">
        <div class="sfm-legend">
          <span v-for="c in legend" :key="c.key" class="sfm-lg"><i class="sfm-dot" :class="'c-' + c.key"></i>{{ c.label }}</span>
        </div>
        <button type="button" class="sfm-toggle" @click="open = !open">
          {{ open ? 'Thu gọn ▴' : `Xem chi tiết ${steps.length} bước ▾` }}
        </button>
      </div>

      <!-- CHI TIẾT (timeline dọc) -->
      <div v-if="open" class="sfm-detail">
        <div v-for="st in steps" :key="st.no" class="sfm-drow">
          <div class="sfm-dn" :class="'c-' + st.category">{{ st.no }}</div>
          <div class="sfm-dty" :class="'t-' + st.category">{{ st.label }}</div>
          <div class="sfm-dnm">{{ st.name }}</div>
          <div class="sfm-dwhen">{{ st.when }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
// Type chia sẻ cho parent (export trong <script setup> KHÔNG hợp lệ → để ở <script> thường;
// vẫn import được từ file .vue này).
export type FlowCategory = 'message' | 'friend' | 'tag' | 'status' | 'other';
export interface FlowStep {
  no: number;          // số thứ tự bước (1-based)
  category: FlowCategory;
  label: string;       // nhãn loại hành động (vd "Gửi tin nhắn")
  name: string;        // tên khối/bước
  when: string;        // thời điểm gửi (vd "Ngay" / "+1 ngày")
}
</script>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps<{ steps: FlowStep[] }>();

const open = ref(false);
const trackEl = ref<HTMLElement | null>(null);
const trackW = ref(600);
const SEG_MIN = 44;
const GAP = 4;

const perRow = computed(() => Math.max(1, Math.floor((trackW.value + GAP) / (SEG_MIN + GAP))));
const segW = computed(() => Math.max(SEG_MIN, Math.floor((trackW.value - (perRow.value - 1) * GAP) / perRow.value)));
const rows = computed<FlowStep[][]>(() => {
  const out: FlowStep[][] = [];
  for (let i = 0; i < props.steps.length; i += perRow.value) out.push(props.steps.slice(i, i + perRow.value));
  return out;
});

const CAT_LABEL: Record<FlowCategory, string> = {
  message: 'Tin nhắn', friend: 'Kết bạn', tag: 'Gán tag', status: 'Trạng thái', other: 'Khác',
};
const legend = computed(() => {
  const present = new Set(props.steps.map((s) => s.category));
  return (Object.keys(CAT_LABEL) as FlowCategory[]).filter((k) => present.has(k)).map((k) => ({ key: k, label: CAT_LABEL[k] }));
});

let ro: ResizeObserver | null = null;
onMounted(() => {
  if (trackEl.value) {
    trackW.value = trackEl.value.clientWidth || 600;
    ro = new ResizeObserver(() => { if (trackEl.value) trackW.value = trackEl.value.clientWidth; });
    ro.observe(trackEl.value);
  }
});
onBeforeUnmount(() => { ro?.disconnect(); });
</script>

<style scoped>
/* Màu theo loại hành động (token HS global) */
.c-message { background: var(--brand, #1786be); }
.c-friend  { background: #0e9488; }
.c-tag     { background: #1f9d6b; }
.c-status  { background: #c77d11; }
.c-other   { background: #8a93a6; }
.t-message { color: var(--brand, #1786be); }
.t-friend  { color: #0e9488; }
.t-tag     { color: #1f9d6b; }
.t-status  { color: #c77d11; }
.t-other   { color: #8a93a6; }

.sfm { width: 100%; }
.sfm-empty { font-size: 12.5px; color: var(--ink-3, #6b7488); padding: 6px 0; }

/* Đường đua */
.sfm-track { display: flex; flex-direction: column; }
.sfm-lane { display: flex; gap: 4px; align-items: stretch; }
.sfm-lane.rtl { flex-direction: row-reverse; }
.sfm-seg {
  height: 30px; border-radius: 7px; flex: none; display: grid; place-items: center;
  font-size: 11px; font-weight: 700; color: #fff; opacity: .94; cursor: default;
}
.sfm-bend { height: 15px; display: flex; }
.sfm-bend.right { justify-content: flex-end; }
.sfm-bend.left { justify-content: flex-start; }
.sfm-bend i { display: block; width: 32px; height: 15px; border: 4px solid #c3cdda; border-top: none; }
.sfm-bend.right i { border-left: none; border-radius: 0 0 12px 0; }
.sfm-bend.left i { border-right: none; border-radius: 0 0 0 12px; }

.sfm-foot { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 9px; }
.sfm-legend { display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px; color: var(--ink-2, #475066); }
.sfm-lg { display: inline-flex; align-items: center; gap: 5px; }
.sfm-dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
.sfm-toggle { margin-left: auto; background: none; border: none; color: var(--brand, #1786be); font-weight: 600; font-size: 12.5px; cursor: pointer; padding: 2px 0; }

/* Chi tiết */
.sfm-detail { margin-top: 9px; border-top: 1px solid var(--line, #e7eaf0); padding-top: 8px; }
.sfm-drow { display: grid; grid-template-columns: 24px 78px 1fr auto; gap: 10px; align-items: center; padding: 4px 0; font-size: 12.5px; }
.sfm-dn { width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 11px; }
.sfm-dty { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .2px; }
.sfm-dnm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--ink, #141a24); }
.sfm-dwhen { font-size: 11.5px; color: var(--ink-3, #6b7488); white-space: nowrap; }
</style>
