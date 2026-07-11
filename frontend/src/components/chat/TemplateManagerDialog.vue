<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  TemplateManagerDialog — Quản lý Mẫu tin nhắn (2026-07-11).
  Tạo/sửa/xoá mẫu + thư mục, chèn biến cá nhân hoá, đính kèm ảnh/file từ Kho Media,
  gõ tắt (shortcut), phạm vi công khai/riêng tư. Mở từ composer ("Quản lý mẫu" / "Lưu thành mẫu").
-->
<template>
  <v-dialog :model-value="modelValue" max-width="880" @update:model-value="$emit('update:modelValue', $event)">
    <div class="tmg">
      <div class="tmg-head">
        <div class="tmg-title"><v-icon size="18">mdi-message-flash-outline</v-icon> Quản lý mẫu tin nhắn</div>
        <button class="tmg-x" @click="close">×</button>
      </div>

      <div class="tmg-body">
        <!-- Cột trái: danh sách + thư mục -->
        <aside class="tmg-list">
          <button class="tmg-new" @click="startCreate()"><v-icon size="15">mdi-plus</v-icon> Mẫu mới</button>
          <div class="tmg-folders">
            <button class="tmg-fchip" :class="{ on: folderFilter === '' }" @click="folderFilter = ''">Tất cả</button>
            <button v-for="f in folders" :key="f.id" class="tmg-fchip" :class="{ on: folderFilter === f.id }" @click="folderFilter = f.id">{{ f.name }}</button>
            <button class="tmg-fchip tmg-fchip--add" title="Thêm thư mục" @click="addFolder"><v-icon size="13">mdi-folder-plus-outline</v-icon></button>
          </div>
          <div class="tmg-items">
            <div v-if="loading" class="tmg-muted">Đang tải…</div>
            <div v-else-if="visibleTemplates.length === 0" class="tmg-muted">Chưa có mẫu nào.</div>
            <button
              v-for="t in visibleTemplates"
              :key="t.id"
              class="tmg-item"
              :class="{ on: form.id === t.id }"
              @click="startEdit(t)"
            >
              <span class="tmg-item-name">
                {{ t.name }}
                <span v-if="t.shortcut" class="tmg-sc">/{{ t.shortcut }}</span>
              </span>
              <span class="tmg-item-sub">{{ (t.content || '').slice(0, 60) }}</span>
              <span class="tmg-item-meta">
                <v-icon size="11">{{ t.visibility === 'private' ? 'mdi-lock-outline' : 'mdi-account-group-outline' }}</v-icon>
                <span v-if="(t.attachments || []).length"><v-icon size="11">mdi-paperclip</v-icon>{{ t.attachments!.length }}</span>
                <span class="tmg-use">{{ t.usageCount ?? 0 }} dùng</span>
              </span>
            </button>
          </div>
        </aside>

        <!-- Cột phải: form -->
        <section class="tmg-form">
          <div class="tmg-row">
            <label>Tên mẫu</label>
            <input v-model="form.name" class="tmg-inp" placeholder="VD: Chào khách mới" />
          </div>
          <div class="tmg-row2">
            <div class="tmg-col">
              <label>Gõ tắt (/)</label>
              <input v-model="form.shortcut" class="tmg-inp" placeholder="chaokhach" />
            </div>
            <div class="tmg-col">
              <label>Thư mục</label>
              <select v-model="form.folderId" class="tmg-inp">
                <option :value="null">— Không —</option>
                <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
              </select>
            </div>
            <div class="tmg-col">
              <label>Phạm vi</label>
              <select v-model="form.visibility" class="tmg-inp">
                <option value="private">Riêng tôi</option>
                <option value="public">Cả nhóm</option>
              </select>
            </div>
          </div>

          <!-- Chọn cách soạn: Đơn giản (1 ô) hoặc Nhiều bước (so le ảnh–tin tuỳ ý) -->
          <div class="tmg-modebar">
            <button class="tmg-mode" :class="{ on: form.mode === 'simple' }" @click="setMode('simple')">Đơn giản</button>
            <button class="tmg-mode" :class="{ on: form.mode === 'blocks' }" @click="setMode('blocks')">Nhiều bước · so le ảnh–tin</button>
          </div>

          <!-- ── CHẾ ĐỘ ĐƠN GIẢN ── -->
          <template v-if="form.mode === 'simple'">
            <div class="tmg-row">
              <label>Nội dung</label>
              <div class="tmg-varbar">
                <span class="tmg-varlbl">Chèn biến:</span>
                <button v-for="v in VARS" :key="v.code" class="tmg-var" :title="`${v.label} (vd: ${v.example})`" @click="insertVar(v.code)">{{ v.code }}</button>
              </div>
              <textarea ref="contentRef" v-model="form.content" class="tmg-area" rows="6" placeholder="Xin chào {gender} {name}, em là {sale} bên..."></textarea>
              <label class="tmg-split">
                <input v-model="form.splitMessages" type="checkbox" />
                Gửi nhiều tin: mỗi đoạn cách nhau bằng dòng trống là 1 tin riêng
                <span v-if="form.splitMessages && splitCount > 1" class="tmg-split-n">→ {{ splitCount }} tin</span>
              </label>
            </div>
            <div class="tmg-row">
              <label>Đính kèm (ảnh/file từ Kho Media)</label>
              <div class="tmg-atts">
                <div v-for="(a, i) in form.attachments" :key="i" class="tmg-att">
                  <img v-if="a.kind === 'image' && (a.thumb || a.url)" :src="a.thumb || a.url" class="tmg-att-thumb" alt="" />
                  <v-icon v-else size="18">mdi-file-outline</v-icon>
                  <span class="tmg-att-name">{{ a.name || 'tệp' }}</span>
                  <button class="tmg-att-x" @click="form.attachments.splice(i, 1)">×</button>
                </div>
                <button class="tmg-att-add" @click="openPicker('simple')"><v-icon size="15">mdi-plus</v-icon> Thêm từ Kho</button>
              </div>
            </div>
          </template>

          <!-- ── CHẾ ĐỘ NHIỀU BƯỚC (block builder) ── -->
          <template v-else>
            <div class="tmg-row">
              <label>Chuỗi tin ({{ form.blocks.length }} bước) — kéo thứ tự bằng nút ▲▼, so le ảnh và text tuỳ ý</label>
              <div class="tmg-blks">
                <div v-for="(b, i) in form.blocks" :key="b.id" class="tmg-blk" :class="`k-${b.type}`">
                  <div class="tmg-blk-bar">
                    <span class="tmg-blk-idx">{{ i + 1 }}</span>
                    <span class="tmg-blk-type">{{ blkLabel(b) }}</span>
                    <span class="tmg-blk-tools">
                      <button title="Lên" :disabled="i === 0" @click="moveBlk(i, -1)"><v-icon size="14">mdi-arrow-up</v-icon></button>
                      <button title="Xuống" :disabled="i === form.blocks.length - 1" @click="moveBlk(i, 1)"><v-icon size="14">mdi-arrow-down</v-icon></button>
                      <button title="Xoá" @click="form.blocks.splice(i, 1)"><v-icon size="14">mdi-close</v-icon></button>
                    </span>
                  </div>
                  <!-- text -->
                  <template v-if="b.type === 'text'">
                    <div class="tmg-varbar tmg-varbar--sm">
                      <button v-for="v in VARS" :key="v.code" class="tmg-var" :title="v.label" @click="insertVarBlk(b, v.code)">{{ v.code }}</button>
                    </div>
                    <textarea v-model="b.content" class="tmg-area tmg-area--sm" rows="2" placeholder="Nội dung tin…"></textarea>
                  </template>
                  <!-- delay -->
                  <div v-else-if="b.type === 'delay'" class="tmg-blk-delay">
                    Chờ <input v-model.number="b.delayMs" type="number" min="0" max="10000" step="100" class="tmg-delay-inp" /> ms trước khi gửi tin kế
                  </div>
                  <!-- ảnh/album -->
                  <div v-else class="tmg-blk-atts">
                    <div v-for="(a, ai) in b.attachments" :key="ai" class="tmg-att tmg-att--sm">
                      <img v-if="a.kind === 'image' && (a.thumb || a.url)" :src="a.thumb || a.url" class="tmg-att-thumb" alt="" />
                      <v-icon v-else size="16">mdi-file-outline</v-icon>
                      <button class="tmg-att-x" @click="removeBlkAtt(b, ai)">×</button>
                    </div>
                    <button class="tmg-att-add tmg-att-add--sm" @click="openPicker(i)"><v-icon size="14">mdi-plus</v-icon> Ảnh</button>
                  </div>
                </div>
                <div v-if="form.blocks.length === 0" class="tmg-muted">Chưa có bước nào — thêm đoạn text hoặc ảnh bên dưới.</div>
              </div>
              <div class="tmg-blk-add">
                <button @click="addTextBlk"><v-icon size="14">mdi-text-box-plus-outline</v-icon> Đoạn text</button>
                <button @click="openPicker('new')"><v-icon size="14">mdi-image-plus-outline</v-icon> Ảnh</button>
                <button @click="addDelayBlk"><v-icon size="14">mdi-timer-plus-outline</v-icon> Khoảng chờ</button>
              </div>
            </div>
          </template>

          <!-- Bộ chọn Kho Media dùng chung (đơn giản + block) -->
          <div v-if="mediaPickerOpen" class="tmg-picker">
            <input v-model="mediaQuery" class="tmg-inp tmg-picker-search" placeholder="Tìm trong Kho Media…" @input="debouncedMedia" />
            <div v-if="mediaLoading" class="tmg-muted">Đang tải…</div>
            <div v-else class="tmg-picker-grid">
              <button v-for="m in mediaList" :key="m.id" class="tmg-pick" :title="m.name" @click="pickMedia(m)">
                <img v-if="m.kind === 'image' && (m.thumbnailUrl || m.url)" :src="m.thumbnailUrl || m.url || ''" alt="" />
                <span v-else class="tmg-pick-file"><v-icon size="18">mdi-file-outline</v-icon></span>
              </button>
              <div v-if="mediaList.length === 0" class="tmg-muted">Kho trống.</div>
            </div>
          </div>

          <div class="tmg-actions">
            <button v-if="form.id" class="tmg-btn tmg-del" :disabled="saving" @click="onDelete">Xoá</button>
            <span class="tmg-spacer"></span>
            <button class="tmg-btn tmg-ghost" @click="resetForm">Làm mới</button>
            <button class="tmg-btn tmg-save" :disabled="saving || !canSave" @click="onSave">
              {{ saving ? 'Đang lưu…' : form.id ? 'Lưu thay đổi' : 'Tạo mẫu' }}
            </button>
          </div>
        </section>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useMessageTemplates, type MessageTemplate } from '@/composables/use-message-templates';
import { listMedia, type MediaAssetItem } from '@/api/media';
import { TEMPLATE_VARIABLES } from '@/constants/template-variables';
import { splitTextByBlankLines, newBlockId, type TemplateBlock } from '@/composables/use-template-blocks';
import { useToast } from '@/composables/use-toast';

const props = defineProps<{ modelValue: boolean; initialContent?: string }>();
const emit = defineEmits<{ 'update:modelValue': [v: boolean]; saved: [] }>();

const toast = useToast();
const {
  templates, folders, loading, saving,
  fetchTemplates, fetchFolders, createTemplate, updateTemplate, deleteTemplate, createFolder,
} = useMessageTemplates();

// Bộ biến rút gọn cho thanh chèn nhanh (nhóm hay dùng).
const VARS = TEMPLATE_VARIABLES.filter((v) =>
  ['{gender}', '{name}', '{name_full}', '{crm_full}', '{sale}', '{sale_full}', '{phone}', '{email}'].includes(v.code),
);

interface AttItem { kind: 'image' | 'file'; assetId?: string; url: string; name?: string; thumb?: string }
interface FormState {
  id: string | null; name: string; shortcut: string; folderId: string | null;
  visibility: 'public' | 'private'; content: string; attachments: AttItem[]; splitMessages: boolean;
  mode: 'simple' | 'blocks'; blocks: TemplateBlock[];
}
const emptyForm = (): FormState => ({ id: null, name: '', shortcut: '', folderId: null, visibility: 'private', content: '', attachments: [], splitMessages: false, mode: 'simple', blocks: [] });
const form = ref<FormState>(emptyForm());
const folderFilter = ref('');
const contentRef = ref<HTMLTextAreaElement | null>(null);

const visibleTemplates = computed(() =>
  folderFilter.value ? templates.value.filter((t) => t.folderId === folderFilter.value) : templates.value,
);
const canSave = computed(() => {
  if (!form.value.name.trim()) return false;
  if (form.value.mode === 'blocks') return form.value.blocks.some((b) => (b.type === 'text' && b.content?.trim()) || (b.attachments && b.attachments.length) || b.type === 'delay');
  return !!(form.value.content.trim() || form.value.attachments.length);
});
const splitCount = computed(() => splitTextByBlankLines(form.value.content).length);

// ── Block builder (chế độ nhiều bước) ──
function setMode(m: 'simple' | 'blocks') {
  if (form.value.mode === m) return;
  if (m === 'blocks') {
    // Chuyển sang: hạt giống từ nội dung đơn giản (tách theo dòng trống) + đính kèm.
    if (form.value.blocks.length === 0) {
      const texts = form.value.splitMessages ? splitTextByBlankLines(form.value.content) : (form.value.content.trim() ? [form.value.content] : []);
      form.value.blocks = texts.map((t) => ({ id: newBlockId(), type: 'text', content: t, enabled: true } as TemplateBlock));
      const imgs = form.value.attachments.filter((a) => a.kind === 'image');
      if (imgs.length) form.value.blocks.push({ id: newBlockId(), type: imgs.length > 1 ? 'image_album' : 'image', attachments: imgs as any, enabled: true });
      for (const o of form.value.attachments.filter((a) => a.kind !== 'image')) form.value.blocks.push({ id: newBlockId(), type: o.kind === 'file' ? 'file' : 'image', attachments: [o] as any, enabled: true });
    }
  }
  form.value.mode = m;
}
function blkLabel(b: TemplateBlock): string {
  return b.type === 'text' ? 'Đoạn text' : b.type === 'image_album' ? `Album ${b.attachments?.length ?? 0} ảnh` : b.type === 'image' ? 'Ảnh' : b.type === 'delay' ? 'Khoảng chờ' : b.type === 'file' ? 'File' : 'Video';
}
function moveBlk(i: number, dir: number) { const j = i + dir; if (j < 0 || j >= form.value.blocks.length) return; const a = form.value.blocks; [a[i], a[j]] = [a[j], a[i]]; }
function addTextBlk() { form.value.blocks.push({ id: newBlockId(), type: 'text', content: '', enabled: true }); }
function addDelayBlk() { form.value.blocks.push({ id: newBlockId(), type: 'delay', delayMs: 500, enabled: true }); }
function insertVarBlk(b: TemplateBlock, code: string) { b.content = (b.content || '') + code; }
function removeBlkAtt(b: TemplateBlock, ai: number) {
  b.attachments?.splice(ai, 1);
  if (b.attachments && b.attachments.length > 1) b.type = 'image_album';
  else if (b.attachments && b.attachments.length === 1) b.type = b.attachments[0].kind === 'image' ? 'image' : b.attachments[0].kind === 'video' ? 'video' : 'file';
}

/** Payload blocks khi lưu: chế độ blocks → dùng thẳng; đơn giản → derive như cũ (backward-compat). */
function buildBlocks(): TemplateBlock[] | null {
  if (form.value.mode === 'blocks') {
    const clean = form.value.blocks.filter((b) => (b.type === 'text' && b.content?.trim()) || (b.attachments && b.attachments.length) || b.type === 'delay');
    return clean.length > 1 ? clean : null; // ≤1 bước → để backward-compat (content+attachments)
  }
  const texts = form.value.splitMessages ? splitTextByBlankLines(form.value.content) : (form.value.content.trim() ? [form.value.content] : []);
  const images = form.value.attachments.filter((a) => a.kind === 'image');
  const others = form.value.attachments.filter((a) => a.kind !== 'image');
  if (texts.length <= 1 && others.length === 0) return null;
  const blocks: TemplateBlock[] = texts.map((t) => ({ id: newBlockId(), type: 'text', content: t, enabled: true }));
  if (images.length) blocks.push({ id: newBlockId(), type: images.length > 1 ? 'image_album' : 'image', attachments: images as any, enabled: true });
  for (const o of others) blocks.push({ id: newBlockId(), type: o.kind === 'file' ? 'file' : 'image', attachments: [o] as any, enabled: true });
  return blocks;
}

/** Đồng bộ content/attachments từ blocks khi lưu ở chế độ blocks (để search + backward-compat FE cũ). */
function syncSimpleFromBlocks() {
  if (form.value.mode !== 'blocks') return;
  form.value.content = form.value.blocks.filter((b) => b.type === 'text').map((b) => b.content || '').join('\n\n');
  form.value.attachments = form.value.blocks.filter((b) => b.attachments?.length).flatMap((b) => b.attachments as AttItem[]);
}

async function reload() {
  await Promise.all([fetchTemplates({ includeArchived: false }), fetchFolders()]);
}

function resetForm() { form.value = emptyForm(); }
function startCreate() { resetForm(); }
function startEdit(t: MessageTemplate) {
  // Mẫu nhiều bước: gộp các block text (nối bằng dòng trống) + gom đính kèm để form sửa được.
  const blocks = (t as any).blocks as Array<any> | null | undefined;
  let content = t.contentRich?.text ?? t.content ?? '';
  let attachments = ((t as any).attachments ?? []) as AttItem[];
  let split = false;
  let loadedBlocks: TemplateBlock[] = [];
  let mode: 'simple' | 'blocks' = 'simple';
  if (Array.isArray(blocks) && blocks.length) {
    const texts = blocks.filter((b) => b.type === 'text').map((b) => b.content || '');
    content = texts.join('\n\n');
    split = texts.length > 1;
    attachments = blocks.filter((b) => b.attachments?.length).flatMap((b) => b.attachments as AttItem[]);
    loadedBlocks = blocks.map((b) => ({ id: b.id || newBlockId(), type: b.type, content: b.content, attachments: b.attachments, delayMs: b.delayMs, enabled: b.enabled !== false })) as TemplateBlock[];
    mode = 'blocks'; // mẫu đã có blocks → mở thẳng chế độ nhiều bước để sửa so le
  }
  form.value = {
    id: t.id, name: t.name, shortcut: t.shortcut || '', folderId: t.folderId ?? null,
    visibility: (t.visibility as 'public' | 'private') || 'private',
    content, attachments, splitMessages: split, mode, blocks: loadedBlocks,
  };
}

function insertVar(code: string) {
  const el = contentRef.value;
  if (!el) { form.value.content += code; return; }
  const s = el.selectionStart ?? form.value.content.length;
  const e = el.selectionEnd ?? s;
  form.value.content = form.value.content.slice(0, s) + code + form.value.content.slice(e);
  requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + code.length; });
}

async function addFolder() {
  const name = window.prompt('Tên thư mục mới:');
  if (!name?.trim()) return;
  try { await createFolder({ name: name.trim(), visibility: 'public' }); await fetchFolders(); }
  catch { toast.push('Tạo thư mục thất bại'); }
}

async function onSave() {
  syncSimpleFromBlocks(); // chế độ blocks → cập nhật content/attachments phẳng cho search + FE cũ
  const payload = {
    name: form.value.name.trim(),
    shortcut: form.value.shortcut.trim() || null,
    content: form.value.content,
    folderId: form.value.folderId,
    visibility: form.value.visibility,
    attachments: form.value.attachments,
    blocks: buildBlocks(), // null nếu 1 bước → backward-compat; mảng nếu nhiều bước
  };
  try {
    if (form.value.id) await updateTemplate(form.value.id, payload);
    else await createTemplate(payload);
    toast.push(form.value.id ? 'Đã lưu mẫu' : 'Đã tạo mẫu');
    await reload();
    emit('saved');
    resetForm();
  } catch { toast.push('Lưu mẫu thất bại'); }
}

async function onDelete() {
  if (!form.value.id) return;
  if (!window.confirm('Xoá mẫu này?')) return;
  try { await deleteTemplate(form.value.id); toast.push('Đã xoá mẫu'); await reload(); emit('saved'); resetForm(); }
  catch { toast.push('Xoá thất bại'); }
}

// ── Media picker ──
const mediaPickerOpen = ref(false);
const mediaList = ref<MediaAssetItem[]>([]);
const mediaLoading = ref(false);
const mediaQuery = ref('');
let mediaTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedMedia() { if (mediaTimer) clearTimeout(mediaTimer); mediaTimer = setTimeout(loadMedia, 300); }
async function loadMedia() {
  mediaLoading.value = true;
  try { mediaList.value = await listMedia({ q: mediaQuery.value.trim() || undefined, limit: 24, sort: 'recent' }); }
  catch { mediaList.value = []; }
  finally { mediaLoading.value = false; }
}
watch(mediaPickerOpen, (v) => { if (v && mediaList.value.length === 0) void loadMedia(); });

// Đích chèn ảnh: 'simple' = đính kèm mẫu đơn giản; số = block index; 'new' = tạo block ảnh mới.
const pickerTarget = ref<'simple' | 'new' | number>('simple');
function openPicker(target: 'simple' | 'new' | number) {
  pickerTarget.value = target;
  mediaPickerOpen.value = true;
  if (mediaList.value.length === 0) void loadMedia();
}
function pickMedia(m: MediaAssetItem) {
  const att: AttItem = { kind: m.kind === 'file' ? 'file' : 'image', assetId: m.id, url: m.url || '', name: m.name, thumb: m.thumbnailUrl || m.url || undefined };
  const tgt = pickerTarget.value;
  if (tgt === 'simple') {
    if (!form.value.attachments.some((a) => a.assetId === m.id)) form.value.attachments.push(att);
  } else if (tgt === 'new') {
    form.value.blocks.push({ id: newBlockId(), type: att.kind === 'file' ? 'file' : 'image', attachments: [att as any], enabled: true });
  } else if (typeof tgt === 'number') {
    const b = form.value.blocks[tgt];
    if (b) {
      b.attachments = b.attachments || [];
      if (!b.attachments.some((a) => a.assetId === m.id)) b.attachments.push(att as any);
      if (b.attachments.length > 1 && b.type === 'image') b.type = 'image_album';
    }
  }
}

function close() { emit('update:modelValue', false); }

watch(() => props.modelValue, (open) => {
  if (open) {
    void reload();
    // Mở kèm nội dung từ composer ("Lưu thành mẫu") → prefill create form.
    if (props.initialContent && props.initialContent.trim()) {
      resetForm();
      form.value.content = props.initialContent;
    }
  }
});

onMounted(() => { if (props.modelValue) void reload(); });
</script>

<style scoped>
.tmg { background: var(--smax-bg, #fff); border-radius: 14px; overflow: hidden; }
.tmg-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--smax-grey-200, #ebedf0); }
.tmg-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: var(--smax-text); }
.tmg-x { border: none; background: transparent; font-size: 24px; line-height: 1; color: var(--chat-meta, #6b7688); cursor: pointer; width: 32px; height: 32px; border-radius: 7px; }
.tmg-x:hover { background: var(--smax-grey-100, #f5f6fa); }
.tmg-body { display: grid; grid-template-columns: 300px 1fr; min-height: 460px; }
.tmg-list { border-right: 1px solid var(--smax-grey-200, #ebedf0); display: flex; flex-direction: column; min-height: 0; padding: 10px; gap: 8px; }
.tmg-new { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 8px; border: 1px dashed var(--smax-primary, #1786be); color: var(--smax-primary, #1786be); background: var(--smax-primary-soft, #e4f1f8); border-radius: 9px; font-weight: 600; font-size: 13px; cursor: pointer; }
.tmg-folders { display: flex; flex-wrap: wrap; gap: 4px; }
.tmg-fchip { font-size: 11px; padding: 3px 9px; border: 1px solid var(--smax-grey-200, #ebedf0); background: #fff; border-radius: 999px; color: var(--chat-meta); cursor: pointer; }
.tmg-fchip.on { background: var(--smax-primary-soft); color: var(--smax-primary); border-color: var(--smax-primary); font-weight: 600; }
.tmg-fchip--add { color: var(--smax-primary); }
.tmg-items { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.tmg-item { display: flex; flex-direction: column; gap: 2px; text-align: left; padding: 8px 9px; border: none; background: transparent; border-radius: 8px; cursor: pointer; }
.tmg-item:hover { background: var(--smax-grey-100, #f5f6fa); }
.tmg-item.on { background: var(--smax-primary-soft, #e4f1f8); }
.tmg-item-name { font-size: 13px; font-weight: 600; color: var(--smax-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tmg-sc { font-size: 10.5px; color: #0f6ea3; background: #eef6fb; padding: 0 5px; border-radius: 5px; margin-left: 4px; font-family: ui-monospace, monospace; }
.tmg-item-sub { font-size: 11px; color: var(--chat-meta); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tmg-item-meta { display: flex; align-items: center; gap: 8px; font-size: 10.5px; color: var(--chat-time, #8a94a6); }
.tmg-use { margin-left: auto; }
.tmg-muted { color: var(--chat-meta); font-size: 12.5px; padding: 12px 4px; font-style: italic; }
.tmg-form { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; max-height: 70vh; }
.tmg-row { display: flex; flex-direction: column; gap: 5px; }
.tmg-row2 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.tmg-col { display: flex; flex-direction: column; gap: 5px; }
.tmg-form label { font-size: 12px; font-weight: 600; color: var(--chat-meta); }
.tmg-inp { border: 1.5px solid var(--smax-grey-300, #d4d8de); border-radius: 8px; padding: 7px 10px; font-size: 13px; font-family: inherit; color: var(--smax-text); background: #fff; }
.tmg-inp:focus { outline: none; border-color: var(--smax-primary); box-shadow: 0 0 0 3px rgba(23,134,190,.12); }
.tmg-varbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.tmg-varlbl { font-size: 11px; color: var(--chat-meta); }
.tmg-var { font-size: 11px; font-family: ui-monospace, monospace; padding: 2px 7px; border: 1px solid var(--smax-grey-200); background: #f7f9fc; border-radius: 6px; color: #0f6ea3; cursor: pointer; }
.tmg-var:hover { background: var(--smax-primary-soft); border-color: var(--smax-primary); }
.tmg-area { border: 1.5px solid var(--smax-grey-300, #d4d8de); border-radius: 10px; padding: 10px 12px; font-size: 13.5px; line-height: 1.5; font-family: inherit; resize: vertical; color: var(--smax-text); }
.tmg-area:focus { outline: none; border-color: var(--smax-primary); box-shadow: 0 0 0 3px rgba(23,134,190,.12); }
.tmg-split { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--chat-meta); font-weight: 500; cursor: pointer; }
.tmg-split-n { color: var(--smax-primary); font-weight: 600; }

/* Mode toggle + block builder */
.tmg-modebar { display: inline-flex; background: var(--smax-grey-100, #f5f6fa); border-radius: 9px; padding: 3px; gap: 3px; }
.tmg-mode { border: none; background: transparent; padding: 6px 12px; border-radius: 7px; font-size: 12.5px; font-weight: 600; color: var(--chat-meta); cursor: pointer; }
.tmg-mode.on { background: #fff; color: var(--smax-primary); box-shadow: 0 1px 3px rgba(15,23,42,.1); }
.tmg-blks { display: flex; flex-direction: column; gap: 7px; }
.tmg-blk { border: 1px solid var(--smax-grey-200, #ebedf0); border-radius: 10px; padding: 7px 9px; background: #fff; }
.tmg-blk.k-text { border-left: 3px solid #94a3b8; }
.tmg-blk.k-image, .tmg-blk.k-image_album { border-left: 3px solid #10b981; }
.tmg-blk.k-delay { border-left: 3px solid #f59e0b; }
.tmg-blk-bar { display: flex; align-items: center; gap: 7px; }
.tmg-blk-idx { width: 19px; height: 19px; border-radius: 50%; background: var(--smax-grey-100); color: var(--chat-meta); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.tmg-blk-type { font-size: 11.5px; font-weight: 600; color: var(--smax-text); }
.tmg-blk-tools { margin-left: auto; display: flex; gap: 1px; }
.tmg-blk-tools button { border: none; background: transparent; color: var(--chat-meta); cursor: pointer; width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
.tmg-blk-tools button:hover:not(:disabled) { background: var(--smax-grey-100); color: var(--smax-text); }
.tmg-blk-tools button:disabled { opacity: .3; cursor: default; }
.tmg-varbar--sm { margin-top: 5px; gap: 3px; }
.tmg-area--sm { margin-top: 4px; }
.tmg-blk-delay { margin-top: 6px; font-size: 12.5px; color: var(--chat-meta); display: flex; align-items: center; gap: 6px; }
.tmg-delay-inp { width: 72px; border: 1px solid var(--smax-grey-200); border-radius: 6px; padding: 3px 6px; font-size: 12px; }
.tmg-blk-atts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.tmg-att--sm { position: relative; width: 46px; height: 46px; padding: 0; overflow: hidden; border-radius: 8px; justify-content: center; }
.tmg-att--sm .tmg-att-thumb { width: 100%; height: 100%; border-radius: 0; }
.tmg-att--sm .tmg-att-x { position: absolute; top: 1px; right: 1px; width: 16px; height: 16px; border-radius: 50%; background: rgba(0,0,0,.55); color: #fff; font-size: 11px; }
.tmg-att-add--sm { padding: 5px 8px; font-size: 11.5px; }
.tmg-blk-add { display: flex; gap: 7px; margin-top: 8px; flex-wrap: wrap; }
.tmg-blk-add button { display: inline-flex; align-items: center; gap: 4px; border: 1px dashed var(--smax-grey-300, #d4d8de); background: #fff; color: var(--smax-primary); border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
.tmg-atts { display: flex; flex-wrap: wrap; gap: 8px; }
.tmg-att { display: inline-flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--smax-grey-200); border-radius: 9px; font-size: 12px; color: var(--smax-text); background: #fff; }
.tmg-att-thumb { width: 26px; height: 26px; object-fit: cover; border-radius: 5px; }
.tmg-att-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tmg-att-x { border: none; background: transparent; color: var(--chat-meta); cursor: pointer; font-size: 15px; line-height: 1; }
.tmg-att-add { display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px; border: 1px dashed var(--smax-grey-300); background: #fff; border-radius: 9px; font-size: 12px; color: var(--smax-primary); cursor: pointer; }
.tmg-picker { margin-top: 8px; border: 1px solid var(--smax-grey-200); border-radius: 10px; padding: 8px; }
.tmg-picker-search { width: 100%; margin-bottom: 8px; }
.tmg-picker-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; max-height: 180px; overflow-y: auto; }
.tmg-pick { aspect-ratio: 1/1; border: 1px solid var(--smax-grey-200); border-radius: 7px; overflow: hidden; cursor: pointer; padding: 0; background: var(--smax-grey-100); }
.tmg-pick img { width: 100%; height: 100%; object-fit: cover; }
.tmg-pick-file { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--chat-meta); }
.tmg-actions { display: flex; align-items: center; gap: 8px; margin-top: auto; padding-top: 6px; }
.tmg-spacer { flex: 1; }
.tmg-btn { padding: 8px 16px; border-radius: 9px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
.tmg-save { background: var(--smax-primary, #1786be); color: #fff; }
.tmg-save:disabled { opacity: .5; cursor: not-allowed; }
.tmg-ghost { background: var(--smax-grey-100, #f5f6fa); color: var(--smax-text); }
.tmg-del { background: rgba(239,68,68,.1); color: #dc2626; }
@media (max-width: 640px) { .tmg-body { grid-template-columns: 1fr; } .tmg-row2 { grid-template-columns: 1fr; } .tmg-picker-grid { grid-template-columns: repeat(4, 1fr); } }
</style>
