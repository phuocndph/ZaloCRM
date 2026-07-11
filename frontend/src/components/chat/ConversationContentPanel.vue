<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  ConversationContentPanel — "Quản lý nội dung hội thoại" (Conversation Content Library
  2026-07-11). Cảm hứng Zalo: Tin đã ghim / Tìm trong hội thoại / Ảnh & Video / File / Link.
  Mọi dữ liệu lấy per-conversation từ backend (đã gate quyền + redact). Không tự mở link,
  không tải file gốc để render lưới (chỉ thumbnail/URL). Emit 'jump' để nhảy tới tin gốc.
-->
<template>
  <div class="ccp">
    <!-- ── Tabs ── -->
    <nav class="ccp-tabs" role="tablist">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="ccp-tab"
        :class="{ active: tab === t.key }"
        role="tab"
        :aria-selected="tab === t.key"
        :title="t.label"
        @click="switchTab(t.key)"
      >
        <component :is="t.icon" :size="15" :stroke-width="1.9" />
        <span class="ccp-tab-label">{{ t.label }}</span>
      </button>
    </nav>

    <div class="ccp-body">
      <!-- ════════ TÌM KIẾM ════════ -->
      <div v-if="tab === 'search'" class="ccp-pane">
        <div class="ccp-search-bar">
          <SearchIcon class="ccp-search-ic" :size="15" :stroke-width="1.9" />
          <input
            ref="searchInputRef"
            v-model="searchQ"
            class="ccp-search-input"
            type="text"
            placeholder="Tìm trong hội thoại này…"
            @input="onSearchInput"
          />
          <button v-if="searchQ" class="ccp-search-clear" title="Xóa" @click="clearSearch">
            <XIcon :size="14" :stroke-width="2" />
          </button>
        </div>

        <div class="ccp-filters">
          <button
            v-for="f in SEARCH_TYPES"
            :key="f.key"
            class="ccp-chip"
            :class="{ on: searchType === f.key }"
            @click="setSearchType(f.key)"
          >{{ f.label }}</button>
        </div>
        <div class="ccp-filters ccp-filters--adv">
          <select v-model="searchSender" class="ccp-select" title="Người gửi" @change="runSearch(true)">
            <option value="all">Mọi người</option>
            <option value="contact">Khách gửi</option>
            <option value="self">Mình gửi</option>
          </select>
          <input v-model="dateFrom" type="date" class="ccp-date" title="Từ ngày" @change="runSearch(true)" />
          <input v-model="dateTo" type="date" class="ccp-date" title="Đến ngày" @change="runSearch(true)" />
        </div>

        <div class="ccp-list" @scroll="onListScroll($event, 'search')">
          <div v-if="loading && page === 1" class="ccp-skeletons">
            <div v-for="n in 6" :key="n" class="ccp-sk-row" />
          </div>
          <div v-else-if="error" class="ccp-state">
            <AlertTriangleIcon :size="26" :stroke-width="1.6" />
            <p>Không tải được kết quả.</p>
            <button class="ccp-retry" @click="runSearch(true)">Thử lại</button>
          </div>
          <div v-else-if="searchDirty && !hasQueryOrFilter" class="ccp-state">
            <SearchIcon :size="26" :stroke-width="1.4" />
            <p>Nhập từ khóa để tìm trong hội thoại.</p>
          </div>
          <div v-else-if="items.length === 0" class="ccp-state">
            <InboxIcon :size="26" :stroke-width="1.4" />
            <p>Không có kết quả phù hợp.</p>
          </div>
          <template v-else>
            <div class="ccp-count">{{ total }} kết quả</div>
            <button
              v-for="m in items"
              :key="m.id"
              class="ccp-result"
              @click="jump(m.id)"
            >
              <span class="ccp-result-ic" :class="`t-${typeMeta(m).key}`">
                <component :is="typeMeta(m).icon" :size="14" :stroke-width="1.9" />
              </span>
              <span class="ccp-result-body">
                <span class="ccp-result-top">
                  <span class="ccp-result-sender">{{ senderLabel(m) }}</span>
                  <span class="ccp-result-time">{{ fmtTime(m.sentAt) }}</span>
                </span>
                <!-- eslint-disable-next-line vue/no-v-html -->
                <span class="ccp-result-snippet" v-html="snippet(m)"></span>
              </span>
            </button>
            <div v-if="loading && page > 1" class="ccp-loadmore-spin">Đang tải…</div>
          </template>
        </div>
      </div>

      <!-- ════════ TIN ĐÃ GHIM ════════ -->
      <div v-else-if="tab === 'pinned'" class="ccp-pane">
        <div class="ccp-list">
          <div v-if="loading" class="ccp-skeletons"><div v-for="n in 4" :key="n" class="ccp-sk-card" /></div>
          <div v-else-if="error" class="ccp-state">
            <AlertTriangleIcon :size="26" :stroke-width="1.6" />
            <p>Không tải được tin đã ghim.</p>
            <button class="ccp-retry" @click="loadPinned">Thử lại</button>
          </div>
          <div v-else-if="pinned.length === 0" class="ccp-state">
            <PinIcon :size="26" :stroke-width="1.4" />
            <p>Chưa có tin nào được ghim.</p>
            <span class="ccp-hint">Chuột phải một tin → “Ghim tin nhắn”.</span>
          </div>
          <template v-else>
            <div class="ccp-pin-card" v-for="p in pinned" :key="p.pinId">
              <div class="ccp-pin-head">
                <span class="ccp-result-ic" :class="p.message ? `t-${typeMeta(p.message).key}` : 't-text'">
                  <component :is="p.message ? typeMeta(p.message).icon : FileTextIcon" :size="14" :stroke-width="1.9" />
                </span>
                <span class="ccp-pin-sender">{{ p.message ? senderLabel(p.message) : 'Tin nhắn' }}</span>
                <span class="ccp-pin-time">{{ p.message ? fmtTime(p.message.sentAt) : '' }}</span>
                <button class="ccp-unpin" title="Bỏ ghim" @click="onUnpin(p)">
                  <XIcon :size="14" :stroke-width="2" />
                </button>
              </div>
              <div v-if="p.missing || !p.message" class="ccp-pin-missing">
                Tin gốc không còn khả dụng.
              </div>
              <div v-else-if="p.message.isDeleted" class="ccp-pin-missing">Tin đã bị thu hồi.</div>
              <div v-else-if="p.message.redacted" class="ccp-pin-missing">🔒 Nội dung riêng tư.</div>
              <div v-else class="ccp-pin-preview">{{ previewText(p.message) }}</div>
              <div class="ccp-pin-foot">
                <span class="ccp-pin-by">
                  <PinIcon :size="11" :stroke-width="2" /> {{ p.pinnedByName }} · {{ fmtTime(p.pinnedAt) }}
                </span>
                <button v-if="p.message && !p.missing" class="ccp-jump" @click="jump(p.message!.id)">
                  Xem trong hội thoại
                </button>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- ════════ ẢNH & VIDEO ════════ -->
      <div v-else-if="tab === 'media'" class="ccp-pane">
        <div class="ccp-list" @scroll="onListScroll($event, 'media')">
          <div v-if="loading && page === 1" class="ccp-media-grid">
            <div v-for="n in 9" :key="n" class="ccp-sk-tile" />
          </div>
          <div v-else-if="error" class="ccp-state">
            <AlertTriangleIcon :size="26" :stroke-width="1.6" />
            <p>Không tải được media.</p>
            <button class="ccp-retry" @click="loadMedia(true)">Thử lại</button>
          </div>
          <div v-else-if="items.length === 0" class="ccp-state">
            <ImageIcon :size="26" :stroke-width="1.4" />
            <p>Chưa có ảnh hoặc video.</p>
          </div>
          <template v-else>
            <div class="ccp-media-grid">
              <button
                v-for="m in items"
                :key="m.id"
                class="ccp-tile"
                :title="fmtTime(m.sentAt)"
                @click="onMediaClick(m)"
              >
                <img
                  v-if="mediaThumb(m)"
                  :src="mediaThumb(m)!"
                  loading="lazy"
                  alt="media"
                  class="ccp-tile-img"
                  @error="onImgError"
                />
                <span v-else class="ccp-tile-fallback"><ImageOffIcon :size="20" :stroke-width="1.6" /></span>
                <span v-if="m.contentType === 'video'" class="ccp-tile-play"><PlayIcon :size="16" :stroke-width="2" /></span>
              </button>
            </div>
            <div v-if="loading && page > 1" class="ccp-loadmore-spin">Đang tải…</div>
          </template>
        </div>
      </div>

      <!-- ════════ FILE ════════ -->
      <div v-else-if="tab === 'files'" class="ccp-pane">
        <div class="ccp-search-bar ccp-search-bar--slim">
          <SearchIcon class="ccp-search-ic" :size="14" :stroke-width="1.9" />
          <input v-model="fileQ" class="ccp-search-input" placeholder="Tìm theo tên file…" @input="onFileSearchInput" />
          <button class="ccp-sortbtn" :title="`Sắp xếp: ${fileSort === 'newest' ? 'Mới nhất' : 'Cũ nhất'}`" @click="toggleFileSort">
            <ArrowUpDownIcon :size="13" :stroke-width="1.9" />
          </button>
        </div>
        <div class="ccp-list" @scroll="onListScroll($event, 'files')">
          <div v-if="loading && page === 1" class="ccp-skeletons"><div v-for="n in 5" :key="n" class="ccp-sk-row" /></div>
          <div v-else-if="error" class="ccp-state">
            <AlertTriangleIcon :size="26" :stroke-width="1.6" />
            <p>Không tải được danh sách file.</p>
            <button class="ccp-retry" @click="loadFiles(true)">Thử lại</button>
          </div>
          <div v-else-if="items.length === 0" class="ccp-state">
            <PaperclipIcon :size="26" :stroke-width="1.4" />
            <p>Chưa có file nào.</p>
          </div>
          <template v-else>
            <div class="ccp-file-row" v-for="m in items" :key="m.id">
              <span class="ccp-file-ic"><FileIcon :size="18" :stroke-width="1.7" /></span>
              <span class="ccp-file-info">
                <span class="ccp-file-name" :title="fileInfo(m)?.name">{{ fileInfo(m)?.name || 'Tệp' }}</span>
                <span class="ccp-file-meta">
                  {{ fileInfo(m)?.size || '' }}<template v-if="fileInfo(m)?.size"> · </template>{{ senderLabel(m) }} · {{ fmtTime(m.sentAt) }}
                </span>
              </span>
              <span class="ccp-file-actions">
                <a
                  v-if="fileInfo(m)?.href && !m.redacted"
                  :href="fileInfo(m)!.href"
                  target="_blank"
                  rel="noopener"
                  class="ccp-icon-btn"
                  title="Tải xuống"
                  download
                ><DownloadIcon :size="15" :stroke-width="1.9" /></a>
                <button class="ccp-icon-btn" title="Xem trong hội thoại" @click="jump(m.id)">
                  <CornerUpLeftIcon :size="15" :stroke-width="1.9" />
                </button>
              </span>
            </div>
            <div v-if="loading && page > 1" class="ccp-loadmore-spin">Đang tải…</div>
          </template>
        </div>
      </div>

      <!-- ════════ LINK ════════ -->
      <div v-else-if="tab === 'links'" class="ccp-pane">
        <div class="ccp-list" @scroll="onListScroll($event, 'links')">
          <div v-if="loading && page === 1" class="ccp-skeletons"><div v-for="n in 5" :key="n" class="ccp-sk-row" /></div>
          <div v-else-if="error" class="ccp-state">
            <AlertTriangleIcon :size="26" :stroke-width="1.6" />
            <p>Không tải được danh sách link.</p>
            <button class="ccp-retry" @click="loadLinks(true)">Thử lại</button>
          </div>
          <div v-else-if="items.length === 0" class="ccp-state">
            <LinkIcon :size="26" :stroke-width="1.4" />
            <p>Chưa có link nào.</p>
          </div>
          <template v-else>
            <div class="ccp-link-row" v-for="m in items" :key="m.id">
              <span class="ccp-link-ic"><LinkIcon :size="16" :stroke-width="1.8" /></span>
              <span class="ccp-link-body">
                <span v-if="linkInfo(m)?.title" class="ccp-link-title">{{ linkInfo(m)!.title }}</span>
                <a
                  v-if="linkInfo(m)?.url && !m.redacted"
                  :href="linkInfo(m)!.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="ccp-link-url"
                >{{ linkInfo(m)!.domain }}</a>
                <span v-else class="ccp-link-url ccp-link-url--muted">🔒 Riêng tư</span>
                <span class="ccp-link-meta">{{ senderLabel(m) }} · {{ fmtTime(m.sentAt) }}</span>
              </span>
              <button class="ccp-icon-btn" title="Xem trong hội thoại" @click="jump(m.id)">
                <CornerUpLeftIcon :size="15" :stroke-width="1.9" />
              </button>
            </div>
            <div v-if="loading && page > 1" class="ccp-loadmore-spin">Đang tải…</div>
          </template>
        </div>
      </div>
    </div>

    <!-- ── Lightbox ảnh trong panel (prev/next/tải/xem trong hội thoại) ── -->
    <Teleport to="body">
      <div v-if="lightbox.open" class="ccp-lb" @click.self="lightbox.open = false" @keydown.esc="lightbox.open = false">
        <button class="ccp-lb-close" title="Đóng (Esc)" @click="lightbox.open = false"><XIcon :size="22" :stroke-width="2" /></button>
        <button v-if="mediaItems.length > 1" class="ccp-lb-nav prev" :disabled="lightbox.index <= 0" @click.stop="lbStep(-1)"><ChevronLeftIcon :size="26" :stroke-width="2" /></button>
        <img v-if="lightbox.url" :src="lightbox.url" alt="ảnh" class="ccp-lb-img" @click.stop />
        <button v-if="mediaItems.length > 1" class="ccp-lb-nav next" :disabled="lightbox.index >= mediaItems.length - 1" @click.stop="lbStep(1)"><ChevronRightIcon :size="26" :stroke-width="2" /></button>
        <div class="ccp-lb-bar" @click.stop>
          <a v-if="lightbox.url" :href="lightbox.url" target="_blank" rel="noopener" download class="ccp-lb-btn"><DownloadIcon :size="15" :stroke-width="1.9" /> Tải</a>
          <button class="ccp-lb-btn" @click="jumpFromLightbox"><CornerUpLeftIcon :size="15" :stroke-width="1.9" /> Xem trong hội thoại</button>
          <span class="ccp-lb-count">{{ lightbox.index + 1 }} / {{ mediaItems.length }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import {
  Search as SearchIcon, X as XIcon, Pin as PinIcon, Image as ImageIcon,
  ImageOff as ImageOffIcon, Play as PlayIcon, Paperclip as PaperclipIcon,
  File as FileIcon, FileText as FileTextIcon, Link as LinkIcon, Download as DownloadIcon,
  CornerUpLeft as CornerUpLeftIcon, AlertTriangle as AlertTriangleIcon, Inbox as InboxIcon,
  ArrowUpDown as ArrowUpDownIcon, ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon,
  Video as VideoIcon, MessageSquare as MessageSquareIcon,
} from 'lucide-vue-next';
import {
  useConversationContent, isCanceled,
  type PinnedItem, type ContentSearchType, type SenderFilter,
} from '@/composables/use-conversation-content';
import type { Message } from '@/composables/use-chat';
import { useToast } from '@/composables/use-toast';

const props = defineProps<{
  conversationId: string;
  /** Tab mở đầu — header "Tìm" mở thẳng tab search. */
  initialTab?: TabKey;
}>();

const emit = defineEmits<{
  jump: [messageId: string];
  'pinned-ids': [ids: string[]];
}>();

type TabKey = 'pinned' | 'search' | 'media' | 'files' | 'links';
const TABS: Array<{ key: TabKey; label: string; icon: any }> = [
  { key: 'search', label: 'Tìm', icon: SearchIcon },
  { key: 'pinned', label: 'Đã ghim', icon: PinIcon },
  { key: 'media', label: 'Ảnh/Video', icon: ImageIcon },
  { key: 'files', label: 'File', icon: PaperclipIcon },
  { key: 'links', label: 'Link', icon: LinkIcon },
];
const SEARCH_TYPES: Array<{ key: ContentSearchType; label: string }> = [
  { key: 'all', label: 'Tất cả' },
  { key: 'text', label: 'Tin nhắn' },
  { key: 'media', label: 'Ảnh/Video' },
  { key: 'file', label: 'File' },
  { key: 'link', label: 'Link' },
  { key: 'pinned', label: 'Đã ghim' },
];

const api = useConversationContent();
const toast = useToast();

const tab = ref<TabKey>(props.initialTab || 'search');
const loading = ref(false);
const error = ref(false);
const items = ref<Message[]>([]);
const total = ref(0);
const page = ref(1);
const hasMore = ref(false);
const pinned = ref<PinnedItem[]>([]);

// Search state
const searchInputRef = ref<HTMLInputElement | null>(null);
const searchQ = ref('');
const searchType = ref<ContentSearchType>('all');
const searchSender = ref<SenderFilter>('all');
const dateFrom = ref('');
const dateTo = ref('');
const searchDirty = ref(true);
let searchTimer: ReturnType<typeof setTimeout> | null = null;

// File tab state
const fileQ = ref('');
const fileSort = ref<'newest' | 'oldest'>('newest');
let fileTimer: ReturnType<typeof setTimeout> | null = null;

const mediaItems = computed(() => items.value.filter((m) => m.contentType === 'image' && mediaThumb(m)));
const lightbox = ref<{ open: boolean; index: number; url: string | null; msgId: string | null }>({
  open: false, index: 0, url: null, msgId: null,
});

const hasQueryOrFilter = computed(
  () => !!searchQ.value.trim() || searchType.value !== 'all' || searchSender.value !== 'all' || !!dateFrom.value || !!dateTo.value,
);

// ── Content parsers (khớp logic message-bubble, gọn cho panel) ──
function parseJson(c: string | null): Record<string, any> | null {
  if (!c || !c.startsWith('{')) return null;
  try { return JSON.parse(c); } catch { return null; }
}
function mediaThumb(m: Message): string | null {
  if (m.redacted) return null;
  const c = m.content || '';
  if (m.contentType === 'image') {
    if (c.startsWith('http')) return c;
    const p = parseJson(c);
    return p?.thumbUrl || p?.thumb || p?.normalUrl || p?.hdUrl || p?.href || null;
  }
  if (m.contentType === 'video') {
    const p = parseJson(c);
    return p?.thumb || p?.thumbUrl || null;
  }
  return null;
}
function fullImageUrl(m: Message): string | null {
  const p = parseJson(m.content);
  return p?.hdUrl || p?.href || p?.normalUrl || mediaThumb(m);
}
function fileInfo(m: Message): { name: string; size: string; href: string } | null {
  const p = parseJson(m.content);
  if (!p) return null;
  const fmt = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b > 0 ? `${Math.round(b / 1024)} KB` : '');
  const name = p.name || p.title || 'Tệp';
  const size = fmt(typeof p.size === 'number' ? p.size : parseInt(p.params?.fileSize || '0', 10) || 0);
  const href = p.href || '';
  return { name, size, href };
}
function linkInfo(m: Message): { url: string; domain: string; title: string } | null {
  const c = m.content || '';
  let url: string | null = null;
  let title = '';
  const p = parseJson(c);
  if (p) { url = p.href || p.url || p.link || null; title = p.title || p.description || ''; }
  if (!url) { const mt = c.match(/https?:\/\/[^\s<>"')\]]+/i); url = mt ? mt[0] : null; }
  if (!url) return null;
  let domain = url;
  try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }
  return { url, domain, title };
}
function previewText(m: Message): string {
  if (m.redacted) return '🔒 Nội dung riêng tư';
  const t = m.contentType;
  if (t === 'image') return '🖼️ Hình ảnh';
  if (t === 'video') return '🎬 Video';
  if (t === 'file') return `📎 ${fileInfo(m)?.name || 'Tệp'}`;
  if (t === 'sticker') return '😊 Sticker';
  if (t === 'link') return `🔗 ${linkInfo(m)?.title || linkInfo(m)?.domain || 'Liên kết'}`;
  const p = parseJson(m.content);
  if (p) return p.title || p.text || p.description || (m.content ?? '');
  return (m.content || '').replace(/\s+/g, ' ').trim() || '(trống)';
}
function typeMeta(m: Message): { key: string; icon: any } {
  const t = m.contentType;
  if (t === 'image') return { key: 'media', icon: ImageIcon };
  if (t === 'video') return { key: 'media', icon: VideoIcon };
  if (t === 'file') return { key: 'file', icon: FileIcon };
  if (t === 'link') return { key: 'link', icon: LinkIcon };
  return { key: 'text', icon: MessageSquareIcon };
}
function senderLabel(m: Message): string {
  if (m.senderType === 'self') return 'Bạn';
  return m.senderName || 'Khách';
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function snippet(m: Message): string {
  const raw = previewText(m);
  const q = searchQ.value.trim();
  const text = raw.length > 160 ? raw.slice(0, 160) + '…' : raw;
  if (!q) return escapeHtml(text);
  // Highlight không phân biệt hoa/thường (khớp behavior backend ILIKE).
  const esc = escapeHtml(text);
  try {
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
    return esc.replace(re, '<mark>$1</mark>');
  } catch { return esc; }
}

const nowRef = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval> | null = null;
function fmtTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = nowRef.value - d;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'vừa xong';
  if (min < 60) return `${min} phút`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} giờ`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} ngày`;
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// ── Data loaders ──
function resetList() { items.value = []; total.value = 0; page.value = 1; hasMore.value = false; error.value = false; }

async function runSearch(reset = true) {
  searchDirty.value = false;
  if (!hasQueryOrFilter.value) { resetList(); return; }
  if (reset) resetList();
  loading.value = true;
  try {
    const res = await api.search(props.conversationId, {
      q: searchQ.value.trim() || undefined,
      type: searchType.value,
      senderType: searchSender.value,
      from: dateFrom.value || undefined,
      to: dateTo.value || undefined,
      page: page.value,
      limit: 30,
    });
    items.value = reset ? res.items : [...items.value, ...res.items];
    total.value = res.total;
    hasMore.value = res.hasMore;
  } catch (e) {
    if (!isCanceled(e)) error.value = true;
  } finally {
    loading.value = false;
  }
}

async function loadPinned() {
  loading.value = true; error.value = false;
  try {
    pinned.value = await api.listPinned(props.conversationId);
    emit('pinned-ids', pinned.value.filter((p) => p.message).map((p) => p.message!.id));
  } catch (e) {
    if (!isCanceled(e)) error.value = true;
  } finally { loading.value = false; }
}

async function loadMedia(reset = true) {
  if (reset) resetList();
  loading.value = true;
  try {
    const res = await api.listMedia(props.conversationId, page.value, 40);
    items.value = reset ? res.items : [...items.value, ...res.items];
    total.value = res.total; hasMore.value = res.hasMore;
  } catch (e) { if (!isCanceled(e)) error.value = true; } finally { loading.value = false; }
}

async function loadFiles(reset = true) {
  if (reset) resetList();
  loading.value = true;
  try {
    const res = await api.listFiles(props.conversationId, { page: page.value, limit: 40, q: fileQ.value.trim() || undefined, sort: fileSort.value });
    items.value = reset ? res.items : [...items.value, ...res.items];
    total.value = res.total; hasMore.value = res.hasMore;
  } catch (e) { if (!isCanceled(e)) error.value = true; } finally { loading.value = false; }
}

async function loadLinks(reset = true) {
  if (reset) resetList();
  loading.value = true;
  try {
    const res = await api.listLinks(props.conversationId, page.value, 40);
    items.value = reset ? res.items : [...items.value, ...res.items];
    total.value = res.total; hasMore.value = res.hasMore;
  } catch (e) { if (!isCanceled(e)) error.value = true; } finally { loading.value = false; }
}

// ── Interaction ──
function switchTab(t: TabKey) {
  if (tab.value === t) return;
  tab.value = t;
  loadForTab();
}
function loadForTab() {
  resetList();
  if (tab.value === 'pinned') loadPinned();
  else if (tab.value === 'media') loadMedia(true);
  else if (tab.value === 'files') loadFiles(true);
  else if (tab.value === 'links') loadLinks(true);
  else if (tab.value === 'search') { searchDirty.value = true; if (hasQueryOrFilter.value) runSearch(true); }
}

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(true), 300);
}
function clearSearch() { searchQ.value = ''; runSearch(true); }
function setSearchType(t: ContentSearchType) { searchType.value = t; runSearch(true); }

function onFileSearchInput() {
  if (fileTimer) clearTimeout(fileTimer);
  fileTimer = setTimeout(() => loadFiles(true), 300);
}
function toggleFileSort() { fileSort.value = fileSort.value === 'newest' ? 'oldest' : 'newest'; loadFiles(true); }

// Infinite scroll: chạm đáy → tải trang kế (không tải toàn bộ lịch sử).
function onListScroll(e: Event, kind: TabKey) {
  const el = e.target as HTMLElement;
  if (loading.value || !hasMore.value) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
    page.value += 1;
    if (kind === 'search') runSearch(false);
    else if (kind === 'media') loadMedia(false);
    else if (kind === 'files') loadFiles(false);
    else if (kind === 'links') loadLinks(false);
  }
}

function jump(messageId: string) { emit('jump', messageId); }

function onMediaClick(m: Message) {
  if (m.contentType === 'video') { jump(m.id); return; }
  const mi = mediaItems.value;
  const lbIdx = mi.findIndex((x) => x.id === m.id);
  lightbox.value = { open: true, index: lbIdx < 0 ? 0 : lbIdx, url: fullImageUrl(m), msgId: m.id };
}
function lbStep(dir: number) {
  const mi = mediaItems.value;
  const ni = lightbox.value.index + dir;
  if (ni < 0 || ni >= mi.length) return;
  lightbox.value.index = ni;
  lightbox.value.url = fullImageUrl(mi[ni]);
  lightbox.value.msgId = mi[ni].id;
}
function jumpFromLightbox() { if (lightbox.value.msgId) { jump(lightbox.value.msgId); lightbox.value.open = false; } }

function onImgError(e: Event) { (e.target as HTMLImageElement).classList.add('img-broken'); }

async function onUnpin(p: PinnedItem) {
  if (!p.message) { pinned.value = pinned.value.filter((x) => x.pinId !== p.pinId); return; }
  const mid = p.message.id;
  pinned.value = pinned.value.filter((x) => x.pinId !== p.pinId); // optimistic
  emit('pinned-ids', pinned.value.filter((x) => x.message).map((x) => x.message!.id));
  try {
    await api.unpin(props.conversationId, mid);
  } catch {
    toast.push('Bỏ ghim thất bại — tải lại danh sách');
    loadPinned();
  }
}

function onLightboxKey(e: KeyboardEvent) {
  if (!lightbox.value.open) return;
  if (e.key === 'Escape') lightbox.value.open = false;
  else if (e.key === 'ArrowLeft') lbStep(-1);
  else if (e.key === 'ArrowRight') lbStep(1);
}

// Cho phép parent gọi mở tab cụ thể (header "Tìm" / menu "Tin đã ghim").
function openTab(t: TabKey) { switchTab(t); if (t === 'search') requestAnimationFrame(() => searchInputRef.value?.focus()); }
defineExpose({ openTab, reloadPinned: loadPinned });

watch(() => props.conversationId, () => loadForTab());

onMounted(() => {
  window.addEventListener('keydown', onLightboxKey);
  nowTimer = setInterval(() => { nowRef.value = Date.now(); }, 30000);
  loadForTab();
  if (tab.value === 'search') requestAnimationFrame(() => searchInputRef.value?.focus());
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onLightboxKey);
  if (nowTimer) clearInterval(nowTimer);
  if (searchTimer) clearTimeout(searchTimer);
  if (fileTimer) clearTimeout(fileTimer);
});
</script>

<style scoped>
.ccp { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--smax-bg, #fff); }

/* Tabs */
.ccp-tabs { display: flex; gap: 2px; padding: 6px 8px; border-bottom: 1px solid var(--smax-grey-200, #ebedf0); flex-shrink: 0; }
.ccp-tab {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 6px 2px; border: none; background: transparent; cursor: pointer;
  color: var(--chat-meta, #6b7688); font-size: 10.5px; font-weight: 500; border-radius: 8px;
  transition: background 0.12s, color 0.12s;
}
.ccp-tab:hover { background: var(--smax-grey-100, #f5f6fa); }
.ccp-tab.active { color: var(--smax-primary, #1786be); background: var(--smax-primary-soft, #e4f1f8); }
.ccp-tab:focus-visible { outline: 2px solid var(--smax-primary-soft); outline-offset: -2px; }
.ccp-tab-label { line-height: 1; white-space: nowrap; }

.ccp-body { flex: 1; min-height: 0; display: flex; }
.ccp-pane { flex: 1; min-height: 0; display: flex; flex-direction: column; }

/* Search bar */
.ccp-search-bar {
  display: flex; align-items: center; gap: 7px; margin: 8px 10px 6px;
  padding: 7px 10px; border: 1.5px solid var(--smax-grey-300, #d4d8de); border-radius: 10px;
  background: var(--smax-bg, #fff); transition: border-color 0.14s, box-shadow 0.14s;
}
.ccp-search-bar:focus-within { border-color: var(--smax-primary, #1786be); box-shadow: 0 0 0 3px rgba(23,134,190,0.12); }
.ccp-search-bar--slim { margin: 8px 10px; padding: 6px 9px; }
.ccp-search-ic { color: var(--chat-meta, #6b7688); flex-shrink: 0; }
.ccp-search-input { flex: 1; border: none; outline: none; font-size: 13px; background: transparent; color: var(--smax-text); font-family: inherit; min-width: 0; }
.ccp-search-clear, .ccp-sortbtn { border: none; background: transparent; cursor: pointer; color: var(--chat-meta); display: flex; padding: 2px; border-radius: 5px; }
.ccp-search-clear:hover, .ccp-sortbtn:hover { background: var(--smax-grey-100); color: var(--smax-text); }

/* Filters */
.ccp-filters { display: flex; flex-wrap: wrap; gap: 5px; padding: 0 10px 6px; }
.ccp-filters--adv { align-items: center; }
.ccp-chip {
  border: 1px solid var(--smax-grey-200, #ebedf0); background: var(--smax-bg); color: var(--chat-meta);
  border-radius: 999px; padding: 3px 10px; font-size: 11.5px; cursor: pointer; font-family: inherit;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}
.ccp-chip:hover { background: var(--smax-grey-100); }
.ccp-chip.on { background: var(--smax-primary-soft); color: var(--smax-primary); border-color: var(--smax-primary); font-weight: 600; }
.ccp-select, .ccp-date {
  border: 1px solid var(--smax-grey-200, #ebedf0); border-radius: 7px; padding: 3px 6px; font-size: 11.5px;
  color: var(--smax-text); background: var(--smax-bg); font-family: inherit; cursor: pointer;
}

/* List */
.ccp-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 10px 12px; }
.ccp-list::-webkit-scrollbar { width: 8px; }
.ccp-list::-webkit-scrollbar-thumb { background: rgba(15,23,42,0.14); border-radius: 999px; border: 2px solid transparent; background-clip: content-box; }
.ccp-count { font-size: 11px; color: var(--chat-meta); padding: 4px 2px 8px; }

/* Search result row */
.ccp-result {
  display: flex; gap: 10px; width: 100%; text-align: left; align-items: flex-start;
  padding: 8px; border: none; background: transparent; cursor: pointer; border-radius: 9px; font-family: inherit;
  transition: background 0.1s;
}
.ccp-result:hover { background: var(--smax-grey-100, #f5f6fa); }
.ccp-result-ic {
  width: 26px; height: 26px; border-radius: 7px; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; color: #fff;
}
.ccp-result-ic.t-text { background: #94a3b8; }
.ccp-result-ic.t-media { background: #10b981; }
.ccp-result-ic.t-file { background: #f59e0b; }
.ccp-result-ic.t-link { background: #6366f1; }
.ccp-result-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ccp-result-top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.ccp-result-sender { font-size: 12px; font-weight: 600; color: var(--smax-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ccp-result-time { font-size: 10.5px; color: var(--chat-time, #8a94a6); flex-shrink: 0; }
.ccp-result-snippet { font-size: 12.5px; color: var(--chat-meta, #6b7688); line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
.ccp-result-snippet :deep(mark) { background: #fde68a; color: #7c2d12; border-radius: 2px; padding: 0 1px; }

/* Pinned card */
.ccp-pin-card { border: 1px solid var(--smax-grey-200, #ebedf0); border-radius: 11px; padding: 9px 11px; margin-bottom: 8px; background: var(--smax-bg); }
.ccp-pin-head { display: flex; align-items: center; gap: 7px; }
.ccp-pin-sender { font-size: 12px; font-weight: 600; color: var(--smax-text); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ccp-pin-time { font-size: 10.5px; color: var(--chat-time); }
.ccp-unpin { border: none; background: transparent; cursor: pointer; color: var(--chat-meta); display: flex; padding: 3px; border-radius: 6px; }
.ccp-unpin:hover { background: rgba(239,68,68,0.1); color: #dc2626; }
.ccp-pin-preview { font-size: 12.5px; color: var(--smax-text); margin: 6px 0; line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; word-break: break-word; }
.ccp-pin-missing { font-size: 12px; color: var(--chat-meta); font-style: italic; margin: 6px 0; }
.ccp-pin-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; }
.ccp-pin-by { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; color: var(--chat-meta); }
.ccp-jump, .ccp-retry { border: none; background: var(--smax-primary-soft, #e4f1f8); color: var(--smax-primary, #1786be); font-size: 11.5px; font-weight: 600; padding: 4px 10px; border-radius: 7px; cursor: pointer; font-family: inherit; }
.ccp-jump:hover, .ccp-retry:hover { filter: brightness(0.96); }

/* Media grid */
.ccp-media-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.ccp-tile { position: relative; aspect-ratio: 1/1; border: none; padding: 0; border-radius: 8px; overflow: hidden; cursor: pointer; background: var(--smax-grey-100, #f5f6fa); }
.ccp-tile-img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.18s; }
.ccp-tile:hover .ccp-tile-img { transform: scale(1.05); }
.ccp-tile-img.img-broken { opacity: 0.3; }
.ccp-tile-fallback { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--chat-meta); }
.ccp-tile-play { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff; background: rgba(0,0,0,0.25); }

/* File / Link rows */
.ccp-file-row, .ccp-link-row { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 9px; transition: background 0.1s; }
.ccp-file-row:hover, .ccp-link-row:hover { background: var(--smax-grey-100, #f5f6fa); }
.ccp-file-ic { width: 34px; height: 34px; border-radius: 8px; background: rgba(245,158,11,0.12); color: #d97706; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ccp-link-ic { width: 34px; height: 34px; border-radius: 8px; background: rgba(99,102,241,0.12); color: #4f46e5; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.ccp-file-info, .ccp-link-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.ccp-file-name, .ccp-link-title { font-size: 12.5px; font-weight: 600; color: var(--smax-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ccp-file-meta, .ccp-link-meta { font-size: 10.5px; color: var(--chat-meta); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ccp-link-url { font-size: 12px; color: var(--smax-primary, #1786be); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ccp-link-url:hover { text-decoration: underline; }
.ccp-link-url--muted { color: var(--chat-meta); }
.ccp-file-actions { display: flex; gap: 2px; flex-shrink: 0; }
.ccp-icon-btn { width: 30px; height: 30px; border: none; background: transparent; color: var(--chat-meta); display: flex; align-items: center; justify-content: center; border-radius: 7px; cursor: pointer; text-decoration: none; }
.ccp-icon-btn:hover { background: var(--smax-grey-200, #ebedf0); color: var(--smax-primary); }

/* States */
.ccp-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 40px 20px; color: var(--chat-meta, #6b7688); text-align: center; }
.ccp-state p { font-size: 13px; margin: 0; }
.ccp-hint { font-size: 11px; color: var(--chat-time); }
.ccp-loadmore-spin { text-align: center; font-size: 11.5px; color: var(--chat-meta); padding: 10px; }

/* Skeletons */
.ccp-skeletons { padding: 6px 0; }
.ccp-sk-row { height: 44px; border-radius: 9px; margin-bottom: 8px; background: linear-gradient(90deg, #eef1f5, #f6f8fa, #eef1f5); background-size: 200% 100%; animation: ccp-shimmer 1.2s infinite; }
.ccp-sk-card { height: 88px; border-radius: 11px; margin-bottom: 8px; background: linear-gradient(90deg, #eef1f5, #f6f8fa, #eef1f5); background-size: 200% 100%; animation: ccp-shimmer 1.2s infinite; }
.ccp-sk-tile { aspect-ratio: 1/1; border-radius: 8px; background: linear-gradient(90deg, #eef1f5, #f6f8fa, #eef1f5); background-size: 200% 100%; animation: ccp-shimmer 1.2s infinite; }
.ccp-media-grid .ccp-sk-tile { grid-column: span 1; }
@keyframes ccp-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .ccp-sk-row, .ccp-sk-card, .ccp-sk-tile { animation: none; } }

/* Lightbox */
.ccp-lb { position: fixed; inset: 0; z-index: 3000; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; }
.ccp-lb-img { max-width: 90vw; max-height: 82vh; border-radius: 8px; box-shadow: 0 8px 40px rgba(0,0,0,0.5); }
.ccp-lb-close { position: absolute; top: 16px; right: 16px; width: 40px; height: 40px; border-radius: 50%; border: none; background: rgba(255,255,255,0.15); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.ccp-lb-close:hover { background: rgba(255,255,255,0.28); }
.ccp-lb-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 46px; height: 46px; border-radius: 50%; border: none; background: rgba(255,255,255,0.15); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.ccp-lb-nav:hover:not(:disabled) { background: rgba(255,255,255,0.3); }
.ccp-lb-nav:disabled { opacity: 0.25; cursor: default; }
.ccp-lb-nav.prev { left: 20px; }
.ccp-lb-nav.next { right: 20px; }
.ccp-lb-bar { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.5); padding: 8px 14px; border-radius: 12px; }
.ccp-lb-btn { display: inline-flex; align-items: center; gap: 5px; border: none; background: rgba(255,255,255,0.15); color: #fff; font-size: 12.5px; padding: 6px 12px; border-radius: 8px; cursor: pointer; text-decoration: none; font-family: inherit; }
.ccp-lb-btn:hover { background: rgba(255,255,255,0.28); }
.ccp-lb-count { color: #cbd5e1; font-size: 12px; }

@media (max-width: 640px) {
  .ccp-media-grid { grid-template-columns: repeat(4, 1fr); }
  .ccp-tab-label { font-size: 10px; }
}
</style>
