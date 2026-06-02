<template>
  <!-- M14 — Popup "Chèn Khối tin nhắn" (Block content picker) — ship 2026-06-02.
       Sale bấm nút 🧩 trong toolbar chat → mở popup → pick 1 Block (action_type=send_message)
       → FE render template vars {gender}/{name}/{sale} dựa trên contact + currentUser
       → emit('select', rendered) → MessageThread fill vào composer textbox (KHÔNG auto-send).
       Pattern follow quick-template-popup.vue. -->
  <v-dialog
    :model-value="visible"
    max-width="560"
    scrollable
    @update:model-value="(v) => { if (!v) emit('close'); }"
  >
    <v-card class="block-picker-card" rounded="lg">
      <div class="bp-header">
        <div class="bp-title">
          <span class="bp-icon">🧩</span>
          <span>Chèn Khối tin nhắn</span>
        </div>
        <button class="bp-close" title="Đóng (Esc)" @click="emit('close')">
          <v-icon size="20">mdi-close</v-icon>
        </button>
      </div>

      <div class="bp-search">
        <v-icon size="18" color="grey">mdi-magnify</v-icon>
        <input
          ref="searchRef"
          v-model="searchQuery"
          type="text"
          class="bp-search-input"
          placeholder="Tìm Khối theo tên..."
          @keydown="onKey"
        />
      </div>

      <v-divider />

      <div class="bp-list-wrap">
        <div v-if="loading" class="bp-empty">
          <v-icon class="mdi mdi-loading mdi-spin" size="24" color="grey" />
          <div class="bp-empty-text">Đang tải danh sách Khối…</div>
        </div>

        <div v-else-if="loadError" class="bp-empty">
          <v-icon size="24" color="error">mdi-alert-circle-outline</v-icon>
          <div class="bp-empty-text">Không tải được danh sách Khối: {{ loadError }}</div>
        </div>

        <div v-else-if="!filtered.length" class="bp-empty">
          <v-icon size="24" color="grey">mdi-package-variant</v-icon>
          <div class="bp-empty-text">
            {{ blocks.length === 0
              ? 'Chưa có Khối "Gửi tin nhắn" nào. Tạo tại /automation/blocks.'
              : 'Không tìm thấy Khối phù hợp.' }}
          </div>
        </div>

        <ul v-else class="bp-list" role="listbox">
          <li
            v-for="(block, i) in filtered"
            :key="block.id"
            class="bp-item"
            :class="{ active: i === selectedIndex }"
            role="option"
            :aria-selected="i === selectedIndex"
            @click="selectBlock(block)"
            @mouseenter="selectedIndex = i"
          >
            <div class="bp-item-icon">📦</div>
            <div class="bp-item-body">
              <div class="bp-item-name">{{ block.name }}</div>
              <div class="bp-item-preview">{{ truncate(firstVariant(block), 80) || '(Khối chưa có nội dung)' }}</div>
              <div class="bp-item-meta">
                <span v-if="variantCount(block) > 1" class="bp-meta-chip" title="Số biến thể nội dung — random 1 khi chèn">
                  🎲 {{ variantCount(block) }} biến thể
                </span>
                <span v-if="block.folder?.name" class="bp-meta-chip bp-meta-folder">
                  📁 {{ block.folder.name }}
                </span>
                <span v-if="block.ownerNick?.displayName" class="bp-meta-chip bp-meta-owner">
                  👤 {{ block.ownerNick.displayName }}
                </span>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <v-divider v-if="previewText" />

      <div v-if="previewText" class="bp-preview">
        <div class="bp-preview-label">Xem trước (đã render biến):</div>
        <div class="bp-preview-text">{{ previewText }}</div>
      </div>

      <v-divider />

      <div class="bp-footer">
        <span class="bp-hint">↑↓ chọn · Enter chèn · Esc đóng</span>
        <v-btn
          color="primary"
          variant="flat"
          size="small"
          :disabled="!currentBlock"
          @click="currentBlock && selectBlock(currentBlock)"
        >Chèn vào ô soạn tin</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { listBlocks } from '@/api/automation/blocks';
import type { Block } from '@/api/automation/types';

interface ContactCtx {
  fullName?: string | null;
  gender?: string | null;
  phone?: string | null;
}

const props = defineProps<{
  visible: boolean;
  contact?: ContactCtx | null;
  currentUserName?: string | null;
  ownerNickId?: string | null;
}>();

const emit = defineEmits<{
  select: [renderedContent: string];
  close: [];
}>();

const blocks = ref<Block[]>([]);
const loading = ref(false);
const loadError = ref('');
const searchQuery = ref('');
const selectedIndex = ref(0);
const searchRef = ref<HTMLInputElement | null>(null);

async function fetchBlocks() {
  loading.value = true;
  loadError.value = '';
  try {
    // Lấy Block "Gửi tin nhắn" — limit 100 đủ dùng cho UI list.
    // Không filter ownerNickId mặc định: sale có thể chèn cả Block shared + Block riêng.
    blocks.value = await listBlocks({ actionType: 'send_message', limit: 100 });
  } catch (e: unknown) {
    loadError.value = e instanceof Error ? e.message : String(e);
    blocks.value = [];
  } finally {
    loading.value = false;
  }
}

// Mở popup → fetch (lazy), reset state, focus search.
watch(() => props.visible, async (open) => {
  if (!open) return;
  searchQuery.value = '';
  selectedIndex.value = 0;
  if (blocks.value.length === 0) await fetchBlocks();
  await nextTick();
  searchRef.value?.focus();
});

const filtered = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  let list = blocks.value;
  // Optional: ưu tiên Block của nick đang gửi lên đầu nếu có ownerNickId.
  if (props.ownerNickId) {
    list = [...list].sort((a, b) => {
      const aMatch = a.ownerNickId === props.ownerNickId ? 0 : 1;
      const bMatch = b.ownerNickId === props.ownerNickId ? 0 : 1;
      return aMatch - bMatch;
    });
  }
  if (!q) return list;
  return list.filter((b) => {
    if (b.name.toLowerCase().includes(q)) return true;
    const fv = firstVariant(b).toLowerCase();
    return fv.includes(q);
  });
});

watch(filtered, () => { selectedIndex.value = 0; });

const currentBlock = computed<Block | null>(() => filtered.value[selectedIndex.value] ?? null);

const previewText = computed(() => {
  if (!currentBlock.value) return '';
  const raw = pickRandomVariant(currentBlock.value);
  return renderGreetingVars(raw, props.contact ?? null, props.currentUserName ?? null);
});

function firstVariant(block: Block): string {
  const variants = (block.content?.textVariants as unknown);
  if (Array.isArray(variants) && variants.length > 0 && typeof variants[0] === 'string') {
    return variants[0];
  }
  return '';
}

function variantCount(block: Block): number {
  const variants = (block.content?.textVariants as unknown);
  return Array.isArray(variants) ? variants.length : 0;
}

function pickRandomVariant(block: Block): string {
  const variants = (block.content?.textVariants as unknown);
  if (!Array.isArray(variants) || variants.length === 0) return '';
  const idx = Math.floor(Math.random() * variants.length);
  const v = variants[idx];
  return typeof v === 'string' ? v : '';
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

// ── Render template vars ────────────────────────────────────────────────────
// Memory reference_greeting_template_vars (chốt 2026-05-28):
//   {gender} = Anh/Chị/Anh-Chị từ contact.gender (zalo profile)
//   {name}   = LAST WORD của contact.fullName (convention VN: tên đứng cuối)
//   {sale}   = LAST WORD của currentUser.fullName
// KHÔNG dùng cú pháp {{contact.fullName}} của template renderer BE — format single-brace.
function lastWord(name: string | null | undefined): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length === 0 ? '' : parts[parts.length - 1];
}

function resolveGender(gender: string | null | undefined): string {
  const g = (gender ?? '').toLowerCase();
  if (g === 'female' || g === 'f' || g === 'nu' || g === 'nữ') return 'Chị';
  if (g === 'male' || g === 'm' || g === 'nam') return 'Anh';
  return 'Anh/Chị';
}

function renderGreetingVars(
  template: string,
  contact: ContactCtx | null,
  saleFullName: string | null,
): string {
  if (!template) return '';
  const genderStr = resolveGender(contact?.gender);
  // Ưu tiên last word của fullName; nếu rỗng (KH chưa đặt tên) thì fallback "anh/chị".
  const nameStr = lastWord(contact?.fullName) || 'anh/chị';
  const saleStr = lastWord(saleFullName) || '';
  return template
    .replaceAll('{gender}', genderStr)
    .replaceAll('{name}', nameStr)
    .replaceAll('{sale}', saleStr);
}

function selectBlock(block: Block) {
  const raw = pickRandomVariant(block);
  const rendered = renderGreetingVars(raw, props.contact ?? null, props.currentUserName ?? null);
  if (!rendered.trim()) {
    // Khối rỗng — coi như no-op, không paste chuỗi rỗng vào composer.
    emit('close');
    return;
  }
  emit('select', rendered);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex.value = Math.min(selectedIndex.value + 1, filtered.value.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (currentBlock.value) selectBlock(currentBlock.value);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}
</script>

<style scoped>
.block-picker-card {
  display: flex;
  flex-direction: column;
  max-height: 78vh;
  background: #ffffff;
}

.bp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 10px;
}
.bp-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
}
.bp-icon { font-size: 18px; }
.bp-close {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  color: #6b7280;
}
.bp-close:hover { background: #f3f4f6; color: #111827; }

.bp-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 18px 12px;
  padding: 8px 12px;
  background: #f3f4f6;
  border-radius: 8px;
}
.bp-search-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 13px;
  color: #1f2937;
}

.bp-list-wrap {
  flex: 1 1 auto;
  overflow-y: auto;
  min-height: 120px;
  max-height: 360px;
  padding: 4px 8px;
}

.bp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 20px;
  color: #6b7280;
  text-align: center;
}
.bp-empty-text { font-size: 13px; }

.bp-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.bp-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s;
}
.bp-item:hover, .bp-item.active {
  background: #f3f4f6;
}
.bp-item-icon {
  font-size: 18px;
  flex-shrink: 0;
  margin-top: 2px;
}
.bp-item-body { flex: 1; min-width: 0; }
.bp-item-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #1f2937;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bp-item-preview {
  font-size: 12px;
  color: #6b7280;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bp-item-meta {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.bp-meta-chip {
  font-size: 11px;
  padding: 2px 8px;
  background: #e5e7eb;
  color: #374151;
  border-radius: 10px;
}
.bp-meta-folder { background: #fef3c7; color: #92400e; }
.bp-meta-owner { background: #dbeafe; color: #1e40af; }

.bp-preview {
  padding: 10px 18px;
  background: #f9fafb;
  max-height: 140px;
  overflow-y: auto;
}
.bp-preview-label {
  font-size: 11px;
  color: #6b7280;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.bp-preview-text {
  font-size: 13px;
  color: #1f2937;
  white-space: pre-wrap;
  line-height: 1.5;
}

.bp-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 18px;
  background: #ffffff;
}
.bp-hint {
  font-size: 11px;
  color: #9ca3af;
}
</style>
