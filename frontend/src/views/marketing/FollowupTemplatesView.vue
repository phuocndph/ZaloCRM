<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- Kho chiến dịch mẫu. Mẫu là dữ liệu TĨNH ở backend (bất biến) → "Sử dụng mẫu" tạo ra
     một chiến dịch NHÁP độc lập; sửa chiến dịch không đụng mẫu gốc.
     "Yêu thích" lưu localStorage (không cần bảng DB). -->
<template>
  <div class="ft-wrap">
    <div class="ft-head">
      <div>
        <div class="ft-crumb">
          <button class="ft-back" @click="goBack">‹ Chiến dịch</button>
        </div>
        <h2 class="ft-title">Kho chiến dịch mẫu</h2>
        <p class="ft-sub">Chọn một mẫu có sẵn thay vì tạo từ đầu. Bạn vẫn chỉnh sửa được trước khi kích hoạt.</p>
      </div>
    </div>

    <!-- Tìm kiếm + lọc -->
    <div class="ft-filters">
      <input v-model="search" class="ft-search" type="search" placeholder="Tìm theo tên, mục tiêu, thẻ…" />
      <div class="ft-chips">
        <button class="ft-chip" :class="{ on: category === null && !favOnly }" @click="category = null; favOnly = false">Tất cả</button>
        <button class="ft-chip" :class="{ on: favOnly }" @click="favOnly = !favOnly">★ Yêu thích ({{ favorites.size }})</button>
        <button
          v-for="c in categories" :key="c" class="ft-chip"
          :class="{ on: category === c }" @click="category = category === c ? null : c; favOnly = false"
        >{{ c }}</button>
      </div>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" />

    <div v-else-if="!filtered.length" class="ft-empty">Không có mẫu nào khớp bộ lọc.</div>

    <!-- Lưới thẻ -->
    <div v-else class="ft-grid">
      <div v-for="t in filtered" :key="t.key" class="ft-card" @click="openDetail(t.key)">
        <div class="ft-card-top">
          <span class="ft-cat">{{ t.category }}</span>
          <button class="ft-fav" :class="{ on: favorites.has(t.key) }" :aria-label="'Yêu thích ' + t.name" @click.stop="toggleFav(t.key)">
            {{ favorites.has(t.key) ? '★' : '☆' }}
          </button>
        </div>
        <h3 class="ft-name">{{ t.name }}</h3>
        <p class="ft-desc">{{ t.shortDescription }}</p>

        <dl class="ft-meta">
          <div><dt>Mục tiêu</dt><dd>{{ t.goal }}</dd></div>
          <div><dt>Đối tượng</dt><dd>{{ t.audience }}</dd></div>
        </dl>

        <div class="ft-stats">
          <span>⏱ ~{{ t.estimatedDays }} ngày</span>
          <span>🔢 {{ t.stepCount }} bước</span>
          <span>✉️ {{ t.sendCount }} tin</span>
        </div>

        <div class="ft-tags">
          <span v-for="tag in t.tags" :key="tag" class="ft-tag">{{ tag }}</span>
        </div>
      </div>
    </div>

    <!-- Dialog chi tiết -->
    <v-dialog v-model="detailOpen" max-width="760" scrollable>
      <v-card v-if="detail">
        <v-card-title class="ft-dlg-title">
          <div>
            <div class="text-h6">{{ detail.name }}</div>
            <div class="ft-dlg-sub">{{ detail.category }} · ~{{ detail.estimatedDays }} ngày · {{ detail.stepCount }} bước · {{ detail.sendCount }} tin</div>
          </div>
          <v-btn icon="mdi-close" variant="text" size="small" @click="detailOpen = false" />
        </v-card-title>

        <v-card-text class="ft-dlg-body">
          <section class="ft-sec">
            <h4>Giới thiệu</h4>
            <p>{{ detail.intro }}</p>
          </section>

          <section class="ft-sec">
            <h4>Khi nào nên sử dụng</h4>
            <ul><li v-for="(w, i) in detail.whenToUse" :key="i">{{ w }}</li></ul>
          </section>

          <section class="ft-sec">
            <h4>Luồng hoạt động</h4>
            <div class="ft-flow">
              <template v-for="(s, i) in detail.steps" :key="s.key">
                <div class="ft-node" :class="'ty-' + s.type">
                  <span class="ft-node-ico">{{ stepIcon(s.type) }}</span>
                  <div class="ft-node-body">
                    <div class="ft-node-title">{{ stepTitle(s) }}</div>
                    <div class="ft-node-explain">{{ s.explain }}</div>
                    <div v-if="s.transition" class="ft-node-trans">→ {{ s.transition }}</div>
                  </div>
                </div>
                <div v-if="i < detail.steps.length - 1" class="ft-arrow">↓</div>
              </template>
            </div>
          </section>

          <section class="ft-sec">
            <h4>Điều kiện kết thúc</h4>
            <ul><li v-for="(e, i) in detail.endConditions" :key="i">{{ e }}</li></ul>
          </section>

          <section class="ft-sec">
            <h4>Kết quả mong muốn</h4>
            <p>{{ detail.expectedOutcome }}</p>
          </section>

          <section class="ft-sec ft-guard">
            <h4>Giới hạn an toàn của mẫu</h4>
            <p>
              Gửi trong khung {{ minToTime(detail.config.sendWindowStart) }}–{{ minToTime(detail.config.sendWindowEnd) }},
              tối thiểu {{ Math.round((detail.config.minGapMinutes ?? 1440) / 60) }} giờ giữa 2 tin,
              tối đa <b>{{ detail.config.maxMessages }}</b> tin/khách.
              Dừng khi khách có thẻ: {{ (detail.config.stopOnTags || []).join(', ') || '—' }}<span v-if="detail.config.stopOnPurchase">, hoặc đã mua hàng</span>.
            </p>
          </section>
        </v-card-text>

        <v-card-actions class="ft-dlg-actions">
          <button class="ft-fav-lg" :class="{ on: favorites.has(detail.key) }" @click="toggleFav(detail.key)">
            {{ favorites.has(detail.key) ? '★ Đã thích' : '☆ Yêu thích' }}
          </button>
          <v-spacer />
          <v-btn @click="detailOpen = false">Đóng</v-btn>
          <v-btn color="primary" variant="flat" :loading="using" @click="useTemplate(detail.key)">Sử dụng mẫu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';

interface TemplateSummary {
  key: string; name: string; category: string; tags: string[];
  goal: string; audience: string; shortDescription: string;
  estimatedDays: number; stepCount: number; sendCount: number;
}
interface TemplateStep { key: string; type: string; config?: any; explain: string; transition?: string | null }
interface TemplateDetail extends TemplateSummary {
  intro: string; whenToUse: string[]; endConditions: string[]; expectedOutcome: string;
  config: { maxMessages: number; stopOnTags: string[]; stopOnPurchase: boolean; sendWindowStart?: number; sendWindowEnd?: number; minGapMinutes?: number };
  steps: TemplateStep[];
}

const FAV_KEY = 'followup.templates.favorites';

const router = useRouter();
const toast = useToast();
const templates = ref<TemplateSummary[]>([]);
const categories = ref<string[]>([]);
const loading = ref(true);
const search = ref('');
const category = ref<string | null>(null);
const favOnly = ref(false);
const favorites = ref<Set<string>>(new Set());

const detailOpen = ref(false);
const detail = ref<TemplateDetail | null>(null);
const using = ref(false);

function loadFavorites() {
  try { favorites.value = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); }
  catch { favorites.value = new Set(); }
}
function toggleFav(key: string) {
  const next = new Set(favorites.value);
  next.has(key) ? next.delete(key) : next.add(key);
  favorites.value = next;
  localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return templates.value.filter((t) => {
    if (favOnly.value && !favorites.value.has(t.key)) return false;
    if (category.value && t.category !== category.value) return false;
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) ||
      t.goal.toLowerCase().includes(q) ||
      t.shortDescription.toLowerCase().includes(q) ||
      t.tags.some((x) => x.toLowerCase().includes(q))
    );
  });
});

function stepIcon(type: string) {
  return ({ start: '▶', send: '✉️', wait: '⏳', condition: '❓', tag_add: '🏷️', tag_remove: '🧹', sale_task: '📞', end: '⏹' } as Record<string, string>)[type] ?? '•';
}
function stepTitle(s: TemplateStep) {
  const c = s.config ?? {};
  if (s.type === 'send') return 'Gửi tin nhắn';
  if (s.type === 'wait') return `Chờ ${c.amount} ${c.unit === 'hour' ? 'giờ' : c.unit === 'week' ? 'tuần' : 'ngày'}`;
  if (s.type === 'condition') return `Điều kiện: ${condLabel(c.check, c.tag)}`;
  if (s.type === 'tag_add') return `Gắn thẻ "${c.tag}"`;
  if (s.type === 'tag_remove') return `Gỡ thẻ "${c.tag}"`;
  if (s.type === 'sale_task') return `Giao việc Sale: ${c.title}`;
  if (s.type === 'start') return 'Bắt đầu';
  return 'Kết thúc';
}
function condLabel(check: string, tag?: string) {
  return ({
    replied: 'Đã phản hồi', not_replied: 'Chưa phản hồi',
    is_friend: 'Đã là bạn', not_friend: 'Chưa là bạn',
    has_tag: `Có thẻ "${tag}"`, no_tag: `Không có thẻ "${tag}"`,
  } as Record<string, string>)[check] ?? check;
}
function minToTime(m?: number) {
  const v = m ?? 0;
  return `${Math.floor(v / 60).toString().padStart(2, '0')}:${(v % 60).toString().padStart(2, '0')}`;
}

async function load() {
  loading.value = true;
  try {
    const res = await api.get('/followup/templates');
    templates.value = res.data.templates ?? [];
    categories.value = res.data.categories ?? [];
  } catch {
    toast.error('Không tải được kho mẫu');
  } finally {
    loading.value = false;
  }
}

async function openDetail(key: string) {
  detail.value = null;
  detailOpen.value = true;
  try {
    const res = await api.get(`/followup/templates/${key}`);
    detail.value = res.data.template;
  } catch {
    toast.error('Không tải được chi tiết mẫu');
    detailOpen.value = false;
  }
}

async function useTemplate(key: string) {
  using.value = true;
  try {
    const res = await api.post(`/followup/templates/${key}/use`);
    const id = res.data.workflow?.id;
    detailOpen.value = false;
    toast.success('Đã tạo chiến dịch nháp từ mẫu — bạn có thể chỉnh sửa trước khi kích hoạt');
    if (id) router.push({ name: 'CE.FollowupBuilder', params: { id } });
  } catch {
    toast.error('Không tạo được chiến dịch từ mẫu');
  } finally {
    using.value = false;
  }
}

function goBack() { router.push({ name: 'CE.Followup' }); }

onMounted(() => { loadFavorites(); load(); });
</script>

<style scoped>
.ft-wrap { padding: 18px 24px; height: 100%; overflow-y: auto; }
.ft-crumb { margin-bottom: 2px; }
.ft-back { border: 0; background: none; color: var(--smax-primary, #1786be); font-size: 13px; font-weight: 600; cursor: pointer; padding: 0; }
.ft-title { font-size: 20px; font-weight: 700; }
.ft-sub { font-size: 13px; color: var(--smax-grey-700, #5a6478); margin-top: 2px; }

.ft-filters { margin: 16px 0 14px; }
.ft-search { width: 100%; max-width: 420px; border: 1px solid var(--smax-grey-200, #ebedf0); border-radius: 10px; padding: 9px 14px; font-size: 14px; outline: none; }
.ft-search:focus { border-color: var(--smax-primary, #1786be); }
.ft-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.ft-chip { border: 0; background: var(--smax-grey-100, #f5f6fa); color: var(--smax-grey-700, #5a6478); border-radius: 999px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
.ft-chip.on { background: var(--smax-primary, #1786be); color: #fff; }

.ft-empty { padding: 50px; text-align: center; color: var(--smax-grey-700); }
.ft-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.ft-card { background: var(--smax-bg, #fff); border-radius: 14px; padding: 16px; box-shadow: 0 1px 3px rgba(15,23,42,.06); cursor: pointer; transition: box-shadow .15s, transform .1s; display: flex; flex-direction: column; }
.ft-card:hover { box-shadow: 0 6px 18px rgba(15,23,42,.10); transform: translateY(-1px); }
.ft-card-top { display: flex; align-items: center; justify-content: space-between; }
.ft-cat { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--smax-primary-700, #0b5880); background: var(--smax-primary-soft, #e4f1f8); border-radius: 6px; padding: 2px 8px; }
.ft-fav { border: 0; background: none; font-size: 19px; line-height: 1; color: #cbd5e1; cursor: pointer; }
.ft-fav.on { color: #f59e0b; }
.ft-name { font-size: 16px; font-weight: 700; margin: 10px 0 4px; }
.ft-desc { font-size: 13px; color: var(--smax-grey-700, #5a6478); line-height: 1.5; min-height: 39px; }
.ft-meta { margin: 10px 0 0; font-size: 12.5px; }
.ft-meta div { display: flex; gap: 6px; margin-bottom: 3px; }
.ft-meta dt { color: var(--smax-grey-700, #5a6478); flex-shrink: 0; }
.ft-meta dt::after { content: ':'; }
.ft-meta dd { margin: 0; color: var(--smax-text, #212121); }
.ft-stats { display: flex; gap: 12px; font-size: 12px; color: var(--smax-grey-700, #5a6478); margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--smax-grey-100, #f5f6fa); }
.ft-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.ft-tag { font-size: 11px; background: var(--smax-grey-100, #f5f6fa); color: var(--smax-grey-700, #5a6478); border-radius: 6px; padding: 2px 7px; }

.ft-dlg-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.ft-dlg-sub { font-size: 12.5px; color: var(--smax-grey-700, #5a6478); margin-top: 2px; }
.ft-dlg-body { max-height: 64vh; }
.ft-sec { margin-bottom: 18px; }
.ft-sec h4 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--smax-grey-700, #5a6478); margin-bottom: 6px; }
.ft-sec p { font-size: 13.5px; line-height: 1.6; margin: 0; }
.ft-sec ul { margin: 0; padding-left: 18px; font-size: 13.5px; line-height: 1.7; }
.ft-guard p { background: rgba(255,145,0,.08); border-radius: 8px; padding: 10px 12px; font-size: 13px; }

.ft-flow { display: flex; flex-direction: column; align-items: stretch; }
.ft-node { display: flex; gap: 10px; background: var(--smax-grey-50, #fafbfc); border: 1px solid var(--smax-grey-200, #ebedf0); border-radius: 10px; padding: 10px 12px; }
.ft-node.ty-condition { border-color: rgba(103,58,183,.35); background: rgba(103,58,183,.04); }
.ft-node.ty-sale_task { border-color: rgba(255,145,0,.4); background: rgba(255,145,0,.05); }
.ft-node.ty-send { border-color: rgba(23,134,190,.3); background: rgba(23,134,190,.04); }
.ft-node-ico { font-size: 16px; line-height: 1.3; }
.ft-node-title { font-weight: 700; font-size: 13.5px; }
.ft-node-explain { font-size: 12.5px; color: var(--smax-grey-700, #5a6478); line-height: 1.5; margin-top: 2px; }
.ft-node-trans { font-size: 11.5px; color: var(--smax-primary-700, #0b5880); margin-top: 3px; }
.ft-arrow { text-align: center; color: var(--smax-grey-300, #d4d8de); font-size: 15px; line-height: 1.4; }

.ft-dlg-actions { padding: 12px 16px; }
.ft-fav-lg { border: 1px solid var(--smax-grey-200, #ebedf0); background: none; border-radius: 8px; padding: 7px 14px; font-size: 13px; font-weight: 600; color: var(--smax-grey-700, #5a6478); cursor: pointer; }
.ft-fav-lg.on { color: #b45309; border-color: #fcd34d; background: #fffbeb; }
</style>
