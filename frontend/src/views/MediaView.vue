<template>
  <div class="media-page">
    <!-- Top bar -->
    <header class="m-top">
      <h1 class="m-title">Kho phương tiện</h1>
      <div class="m-tools">
        <div class="m-search">
          <span class="i">🔍</span>
          <input v-model="search" placeholder="Tìm ảnh, tag dự án…" @input="debouncedReload" />
        </div>
        <button class="btn-dark" @click="triggerUpload">+ Tải lên</button>
        <input ref="fileInput" type="file" multiple accept="image/*,video/*,.pdf,.xlsx,.docx,.zip" hidden @change="onFilesPicked" />
      </div>
    </header>

    <!-- Tabs -->
    <nav class="m-tabs">
      <button v-for="t in tabs" :key="t.kind" class="tab" :class="{ on: activeKind === t.kind }" @click="setKind(t.kind)">{{ t.label }}</button>
    </nav>

    <!-- Filter row — LEVER 1: Quyền (Loại = tabs ở trên) + nút Lọc sâu -->
    <div class="m-filter">
      <span class="crumb">Tất cả<template v-if="activeFolder"> ▸ <b>{{ activeFolderName }}</b></template></span>
      <span v-for="tag in activeTags" :key="tag" class="chip coral" @click="toggleTag(tag)">● {{ tag }} ✕</span>
      <button class="lvl2-btn" :class="{ on: showLever2 }" @click="showLever2 = !showLever2">⚙ Lọc sâu</button>
      <div class="vis-toggle">
        <span :class="{ on: visFilter === '' }" @click="setVis('')">Tất cả</span>
        <span :class="{ on: visFilter === 'public' }" @click="setVis('public')">🌐 Công khai</span>
        <span :class="{ on: visFilter === 'private' }" @click="setVis('private')">🔒 Riêng tư</span>
      </div>
    </div>

    <!-- LEVER 2: Sắp xếp / Thời gian / Size / Tag (ẩn/hiện) -->
    <div v-if="showLever2" class="m-lever2">
      <select v-model="sortBy" class="lv2-sel" @change="reload">
        <option value="recent">⏱ Gần đây dùng</option>
        <option value="newest">🆕 Mới tải lên</option>
        <option value="most_used">🔥 Hay dùng nhất</option>
        <option value="name">🔤 Tên A→Z</option>
      </select>
      <select v-model="sinceBy" class="lv2-sel" @change="reload">
        <option value="">📅 Mọi lúc</option>
        <option value="7d">7 ngày</option>
        <option value="30d">30 ngày</option>
        <option value="90d">90 ngày</option>
      </select>
      <select v-model="sizeBy" class="lv2-sel" @change="reload">
        <option value="">⚖ Mọi cỡ</option>
        <option value="small">&lt; 1MB</option>
        <option value="medium">1–10MB</option>
        <option value="large">&gt; 10MB</option>
      </select>
      <input v-model="tagInput" class="lv2-tag" placeholder="🏷 lọc theo tag" @keyup.enter="applyTagFilter" @input="debouncedReload" />
    </div>

    <div class="m-work">
      <!-- Folder tree -->
      <aside class="m-tree">
        <div class="tree-ttl">Thư mục
          <button class="addf" title="Tạo thư mục" @click="onCreateFolder">＋</button>
        </div>
        <div class="f" :class="{ on: !activeFolder }" @click="setFolder(null)">📁 Tất cả</div>
        <div v-for="f in folders" :key="f.id" class="f" :class="{ on: activeFolder === f.id }" @click="setFolder(f.id)">
          📁 {{ f.name }} <span v-if="f.visibility === 'private'" class="lk">🔒</span>
        </div>
      </aside>

      <!-- Grid / empty / loading -->
      <div class="m-grid-wrap">
        <!-- Dải "Hay dùng nhất" (GĐ4 đo hiệu quả) -->
        <div v-if="!loading && stats && stats.topUsed.length" class="m-stats">
          <div class="ms-head">
            <span>📊 Hay dùng nhất</span>
            <span class="ms-sum">{{ stats.totalAssets }} ảnh · đã gửi {{ stats.totalUsage }} lần</span>
          </div>
          <div class="ms-row">
            <div v-for="t in stats.topUsed.slice(0, 6)" :key="t.id" class="ms-item" :title="t.name">
              <img v-if="t.thumbnailUrl" :src="t.thumbnailUrl" alt="" />
              <span v-else class="ms-ph">🖼</span>
              <span class="ms-badge">{{ t.usageCount }}</span>
            </div>
          </div>
        </div>

        <div v-if="loading" class="m-empty"><div class="spin"></div> Đang tải…</div>

        <div v-else-if="items.length === 0" class="m-empty">
          <div class="empty-ic">🖼</div>
          <div class="empty-ttl">Kho ảnh của bạn đang trống</div>
          <div class="empty-sub">Tải ảnh hay dùng (bảng giá, mặt bằng, brochure) để gửi khách 1 chạm.</div>
          <button class="btn-dark" @click="triggerUpload">+ Tải ảnh đầu tiên</button>
          <div class="empty-hint">💡 Hoặc chuột phải ảnh trong chat → <b>Lưu vào Media</b></div>
        </div>

        <!-- TỆP: list detail theo dòng (sale phân biệt được tệp nào — anh chốt 2026-06-12) -->
        <div v-else-if="activeKind === 'file'" class="m-flist">
          <div v-for="a in items" :key="a.id" class="frow" :class="{ sel: selected?.id === a.id }" @click="select(a)">
            <span class="ficon" :style="{ background: fileIcon(a.name).bg, color: fileIcon(a.name).fg }">{{ fileIcon(a.name).label }}</span>
            <div class="finfo">
              <div class="fname" :title="a.name">{{ a.name }}</div>
              <div class="fmeta">
                {{ fmtSize(a.sizeBytes) }} · {{ a.visibility === 'public' ? '🌐 Công khai' : '🔒 Riêng tư' }} · đã dùng {{ a.usageCount }}
              </div>
            </div>
          </div>
        </div>

        <!-- ẢNH/VIDEO: grid thẻ thumbnail -->
        <div v-else class="m-grid">
          <div v-for="a in items" :key="a.id" class="card" :class="{ sel: selected?.id === a.id }" @click="select(a)">
            <div class="thumb">
              <img v-if="a.thumbnailUrl" :src="a.thumbnailUrl" loading="lazy" alt="" />
              <span v-else class="ph">{{ a.kind === 'video' ? '🎬' : a.kind === 'file' ? '📄' : '🖼' }}</span>
              <span v-if="a.kind === 'video'" class="play-ic">▶</span>
              <span v-if="a.kind === 'video' && a.durationSec" class="dur">{{ fmtDuration(a.durationSec) }}</span>
              <span v-if="a.visibility === 'private'" class="badge">🔒</span>
            </div>
            <div class="meta">
              <div class="fn" :title="a.name">{{ a.name }}</div>
              <div class="stat" :class="a.visibility === 'public' ? 'pub' : 'lk'">
                {{ a.visibility === 'public' ? '🌐 Công khai' : '🔒 Riêng tư' }} · {{ a.usageCount }} lần
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Detail panel (PA3) -->
      <MediaDetailPanel
        v-if="selected"
        :asset="selected"
        :folders="folders"
        @close="selected = null"
        @updated="onAssetUpdated"
        @archived="onAssetArchived"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { listMedia, uploadMedia, listMediaFolders, createMediaFolder, mediaStats, type MediaAssetItem, type MediaFolder } from '@/api/media';
import { useToast } from '@/composables/use-toast';
import MediaDetailPanel from '@/components/media/MediaDetailPanel.vue';

const toast = useToast();

const tabs = [
  { kind: 'image', label: 'Ảnh' },
  { kind: 'album', label: 'Album' },
  { kind: 'file', label: 'Tệp' },
  { kind: 'video', label: 'Video' },
];
const activeKind = ref<'image' | 'album' | 'file' | 'video'>('image');
const items = ref<MediaAssetItem[]>([]);
const folders = ref<MediaFolder[]>([]);
const loading = ref(false);
const search = ref('');
const visFilter = ref<'' | 'public' | 'private'>('');
const activeFolder = ref<string | null>(null);
const activeTags = ref<string[]>([]);
const selected = ref<MediaAssetItem | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

// LEVER 2 (lọc sâu — anh chốt 2026-06-12).
const showLever2 = ref(false);
const sortBy = ref<'recent' | 'newest' | 'most_used' | 'name'>('recent');
const sinceBy = ref<'' | '7d' | '30d' | '90d'>('');
const sizeBy = ref<'' | 'small' | 'medium' | 'large'>('');
const tagInput = ref('');

const activeFolderName = computed(() => folders.value.find((f) => f.id === activeFolder.value)?.name ?? '');

function sizeRange(): { sizeMin?: number; sizeMax?: number } {
  const MB = 1024 * 1024;
  if (sizeBy.value === 'small') return { sizeMax: MB };
  if (sizeBy.value === 'medium') return { sizeMin: MB, sizeMax: 10 * MB };
  if (sizeBy.value === 'large') return { sizeMin: 10 * MB };
  return {};
}
function applyTagFilter() {
  const t = tagInput.value.trim();
  if (t && !activeTags.value.includes(t)) activeTags.value = [...activeTags.value, t];
  tagInput.value = '';
  reload();
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedReload() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(reload, 300);
}

async function reload() {
  loading.value = true;
  try {
    // Album tab dùng folders; còn lại list assets theo kind.
    const kind = activeKind.value === 'album' ? undefined : activeKind.value;
    items.value = await listMedia({
      kind,
      q: search.value || undefined,
      visibility: visFilter.value || undefined,
      folderId: activeFolder.value || undefined,
      tag: activeTags.value[0] || tagInput.value.trim() || undefined,
      // Lever 2.
      sort: sortBy.value,
      since: sinceBy.value || undefined,
      ...sizeRange(),
    });
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Không tải được kho');
  } finally {
    loading.value = false;
  }
}

async function loadFolders() {
  try { folders.value = await listMediaFolders(); } catch { /* ignore */ }
}

function setKind(k: any) { activeKind.value = k; selected.value = null; reload(); }
function setVis(v: any) { visFilter.value = v; reload(); }
function setFolder(id: string | null) { activeFolder.value = id; reload(); }
function toggleTag(tag: string) { activeTags.value = activeTags.value.filter((t) => t !== tag); reload(); }
function select(a: MediaAssetItem) { selected.value = a; }

// Định dạng thời lượng video: 95s → "1:35".
function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Icon + màu theo định dạng tệp (sale nhận diện nhanh PDF/Excel/Word).
function fileIcon(name: string): { label: string; bg: string; fg: string } {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return { label: 'PDF', bg: '#fdecec', fg: '#c0392b' };
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { label: 'XLS', bg: '#e7f4ec', fg: '#1e7e45' };
  if (['doc', 'docx'].includes(ext)) return { label: 'DOC', bg: '#e8effb', fg: '#1a5cc0' };
  if (['ppt', 'pptx'].includes(ext)) return { label: 'PPT', bg: '#fdeee4', fg: '#c75b1e' };
  if (['zip', 'rar', '7z'].includes(ext)) return { label: 'ZIP', bg: '#f0eef9', fg: '#6b4fb0' };
  return { label: (ext || 'FILE').slice(0, 4).toUpperCase(), bg: '#eef0f2', fg: '#41454d' };
}
function fmtSize(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  const MB = 1024 * 1024;
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function triggerUpload() { fileInput.value?.click(); }
async function onFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (!files.length) return;
  try {
    const res = await uploadMedia(files, { visibility: 'private', folderId: activeFolder.value ?? undefined });
    const dup = res.assets.filter((a) => a.deduped).length;
    toast.success(dup > 0 ? `Đã tải ${res.assets.length} tệp (${dup} đã có sẵn, không tốn thêm dung lượng)` : `Đã tải ${res.assets.length} tệp lên kho`);
    reload();
  } catch (err: any) {
    toast.warning(err?.response?.data?.error || 'Tải lên thất bại');
  } finally {
    input.value = '';
  }
}

async function onCreateFolder() {
  const name = window.prompt('Tên thư mục mới:');
  if (!name?.trim()) return;
  try {
    await createMediaFolder(name.trim(), 'private');
    toast.success('Đã tạo thư mục');
    loadFolders();
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Không tạo được thư mục');
  }
}

function onAssetUpdated(patch: Partial<MediaAssetItem>) {
  if (!selected.value) return;
  Object.assign(selected.value, patch);
  const it = items.value.find((x) => x.id === selected.value!.id);
  if (it) Object.assign(it, patch);
}
function onAssetArchived(id: string) {
  items.value = items.value.filter((x) => x.id !== id);
  selected.value = null;
  toast.success('Đã xóa khỏi kho');
}

const stats = ref<{ totalAssets: number; totalUsage: number; topUsed: Array<{ id: string; name: string; kind: string; usageCount: number; thumbnailUrl: string | null }> } | null>(null);
async function loadStats() {
  try { stats.value = await mediaStats(); } catch { /* phụ */ }
}

onMounted(() => { reload(); loadFolders(); loadStats(); });
</script>

<style scoped>
.media-page {
  --ink:#181d26; --body:#333840; --muted:#41454d; --hairline:#dddddd;
  --canvas:#fff; --soft:#f8fafc; --strong:#e0e2e6; --coral:#aa2d00; --success:#006400;
  --r-sm:6px; --r-md:10px; --pill:9999px;
  display:flex; flex-direction:column; height:100%; background:var(--canvas); color:var(--body); font-size:14px;
}
.m-top { display:flex; align-items:center; justify-content:space-between; padding:16px 24px 12px; border-bottom:1px solid var(--hairline); }
.m-title { font-size:20px; font-weight:400; color:var(--ink); margin:0; }
.m-tools { display:flex; gap:10px; align-items:center; }
.m-search { display:flex; align-items:center; gap:7px; border:1px solid var(--hairline); border-radius:var(--r-sm); padding:6px 12px; width:240px; }
.m-search input { border:none; outline:none; font-size:13px; width:100%; background:transparent; color:var(--body); }
.btn-dark { background:var(--ink); color:#fff; border:none; border-radius:var(--r-md); padding:8px 16px; font-size:13.5px; font-weight:500; cursor:pointer; }
.m-tabs { display:flex; gap:2px; padding:0 24px; border-bottom:1px solid var(--hairline); }
.tab { padding:11px 16px; font-size:14px; color:var(--muted); border:none; background:none; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; }
.tab.on { color:var(--ink); font-weight:500; border-bottom-color:var(--ink); }
.m-filter { display:flex; align-items:center; gap:10px; padding:12px 24px; border-bottom:1px solid var(--hairline); flex-wrap:wrap; }
.crumb { color:var(--muted); font-size:13px; }
.crumb b { color:var(--ink); font-weight:500; }
.chip { display:inline-flex; align-items:center; gap:5px; border:1px solid var(--hairline); border-radius:var(--pill); padding:4px 11px; font-size:12.5px; cursor:pointer; }
.chip.coral { background:#fbe9e2; border-color:#f0c4b3; color:var(--coral); }
.vis-toggle { margin-left:auto; display:inline-flex; border:1px solid var(--hairline); border-radius:var(--pill); overflow:hidden; font-size:12.5px; }
.vis-toggle span { padding:5px 13px; cursor:pointer; color:var(--muted); }
.vis-toggle span.on { background:var(--ink); color:#fff; }
.lvl2-btn { border:1px solid var(--hairline); background:var(--canvas); border-radius:var(--pill); padding:5px 12px; font-size:12.5px; cursor:pointer; color:var(--muted); }
.lvl2-btn.on { background:var(--ink); color:#fff; border-color:var(--ink); }
.m-lever2 { display:flex; gap:8px; align-items:center; padding:10px 24px; border-bottom:1px solid var(--hairline); flex-wrap:wrap; background:var(--soft); }
.lv2-sel { border:1px solid var(--hairline); border-radius:var(--r-sm,6px); padding:5px 10px; font-size:12.5px; color:var(--ink); background:var(--canvas); outline:none; }
.lv2-tag { border:1px solid var(--hairline); border-radius:var(--r-sm,6px); padding:5px 11px; font-size:12.5px; width:150px; outline:none; }
.thumb .play-ic { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:34px; height:34px; border-radius:9999px; background:rgba(0,0,0,.5); color:#fff; font-size:14px; display:flex; align-items:center; justify-content:center; pointer-events:none; }
.thumb .dur { position:absolute; bottom:6px; right:6px; background:rgba(0,0,0,.7); color:#fff; border-radius:4px; padding:1px 6px; font-size:10.5px; font-variant-numeric:tabular-nums; }
.m-work { display:flex; flex:1; overflow:hidden; min-height:0; }
.m-tree { width:180px; border-right:1px solid var(--hairline); padding:14px 12px; flex-shrink:0; overflow:auto; }
.tree-ttl { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin-bottom:8px; font-weight:500; display:flex; justify-content:space-between; align-items:center; }
.addf { border:none; background:none; cursor:pointer; color:var(--ink); font-size:16px; line-height:1; }
.f { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:var(--r-sm); font-size:13px; color:var(--body); cursor:pointer; }
.f.on { background:var(--soft); color:var(--ink); font-weight:500; }
.f .lk { margin-left:auto; font-size:11px; }
.m-grid-wrap { flex:1; padding:16px 24px; overflow:auto; min-width:0; }
.m-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); gap:14px; }
/* TỆP — list detail theo dòng (anh chốt: grid card không phân biệt được tệp nào). */
.m-flist { display:flex; flex-direction:column; border:1px solid var(--hairline); border-radius:var(--r-md); overflow:hidden; background:var(--canvas); }
.frow { display:flex; align-items:center; gap:13px; padding:11px 14px; border-bottom:1px solid var(--hairline); cursor:pointer; }
.frow:last-child { border-bottom:none; }
.frow:hover { background:var(--soft); }
.frow.sel { background:#eef2fb; }
.ficon { width:46px; height:46px; flex-shrink:0; border-radius:9px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; letter-spacing:.02em; }
.finfo { flex:1; min-width:0; }
.fname { font-size:14px; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:2px; }
.fmeta { font-size:12px; color:var(--muted); }
.card { border:1px solid var(--hairline); border-radius:var(--r-md); overflow:hidden; cursor:pointer; background:var(--canvas); }
.card.sel { border-color:var(--ink); box-shadow:0 0 0 2px var(--ink); }
.thumb { height:108px; background:var(--strong); position:relative; display:flex; align-items:center; justify-content:center; }
.thumb img { width:100%; height:100%; object-fit:cover; }
.thumb .ph { font-size:28px; color:var(--muted); }
.thumb .badge { position:absolute; top:6px; right:6px; background:rgba(24,29,38,.82); color:#fff; border-radius:var(--pill); padding:2px 7px; font-size:10.5px; }
.meta { padding:8px 10px; }
.fn { font-size:12.5px; color:var(--ink); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stat { font-size:11px; margin-top:3px; }
.stat.pub { color:var(--success); }
.stat.lk { color:var(--coral); }
.m-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:var(--muted); padding:60px 20px; text-align:center; }
.empty-ic { font-size:48px; opacity:.6; }
.empty-ttl { font-size:17px; color:var(--ink); font-weight:500; }
.empty-sub { font-size:13px; max-width:340px; }
.empty-hint { margin-top:10px; background:#f5e9d4; border:1px solid #e6d3ad; color:#6b5520; padding:6px 16px; border-radius:var(--pill); font-size:12px; }
.spin { width:18px; height:18px; border:2px solid var(--strong); border-top-color:var(--ink); border-radius:50%; animation:spin .7s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
/* Dải Hay dùng nhất (GĐ4) */
.m-stats { background:var(--soft); border:1px solid var(--hairline); border-radius:var(--r-md); padding:10px 14px; margin-bottom:16px; }
.ms-head { display:flex; align-items:center; justify-content:space-between; font-size:12.5px; color:var(--ink); font-weight:500; margin-bottom:8px; }
.ms-sum { color:var(--muted); font-weight:400; font-size:11.5px; }
.ms-row { display:flex; gap:10px; }
.ms-item { position:relative; width:54px; height:54px; border-radius:var(--r-sm); overflow:hidden; border:1px solid var(--hairline); flex-shrink:0; }
.ms-item img { width:100%; height:100%; object-fit:cover; }
.ms-item .ms-ph { display:flex; align-items:center; justify-content:center; height:100%; font-size:20px; background:var(--strong); }
.ms-badge { position:absolute; bottom:2px; right:2px; background:var(--ink); color:#fff; border-radius:9999px; padding:1px 6px; font-size:10px; font-weight:500; }
</style>
