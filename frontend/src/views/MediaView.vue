<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="media-page">
    <!-- Top bar -->
    <header class="m-top">
      <h1 class="m-title">Kho phương tiện</h1>
      <div v-if="activeKind !== 'r2'" class="m-tools">
        <div class="m-search">
          <span class="i">🔍</span>
          <input v-model="search" placeholder="Tìm ảnh, tag dự án…" @input="debouncedReload" />
        </div>
        <button class="btn-dark" :disabled="folderUploadSaving || fileUploadSaving" @click="triggerUpload">+ Tải nhiều tệp</button>
        <button class="btn-folder-upload" :disabled="folderUploadSaving" @click="openFolderUploadDialog"><FolderUpIcon :size="15" :stroke-width="1.9" /> {{ folderUploadSaving ? 'Đang tải thư mục…' : 'Tải cả thư mục' }}</button>
        <button v-if="!trashMode" class="btn-multi" :class="{ on: multiMode }" :title="multiMode ? 'Tắt chọn nhiều mục' : 'Chọn nhiều mục trong kho'" @click="toggleMultiMode">
          <CheckSquareIcon :size="15" :stroke-width="1.9" /> Chọn nhiều
        </button>
        <button class="btn-trash" :class="{ on: trashMode }" :title="trashMode ? 'Đóng thùng rác' : 'Mở thùng rác'" @click="trashMode ? closeTrash() : openTrash()">
          <Trash2Icon :size="15" :stroke-width="1.9" /> Thùng rác
        </button>
        <input ref="fileInput" type="file" multiple accept="image/*,video/*,.pdf,.txt,.csv,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.zip,.rar,.7z" hidden @change="onFilesPicked" />
        <input ref="folderInput" type="file" webkitdirectory directory multiple hidden @change="onFolderFilesPicked" />
      </div>
    </header>

    <!-- Tabs -->
    <nav class="m-tabs">
      <button v-for="t in tabs" :key="t.kind" class="tab" :class="{ on: activeKind === t.kind }" @click="setKind(t.kind)">{{ t.label }}</button>
    </nav>

    <R2StorageManager v-if="activeKind === 'r2'" class="r2-storage-view" />


    <!-- ════════ THÙNG RÁC (GĐ13a) ════════ -->
    <section v-if="trashMode" class="m-trash">
      <div class="trash-bar">
        <span class="trash-ttl"><Trash2Icon :size="16" :stroke-width="1.9" /> Thùng rác · {{ trashItems.length }} mục</span>
        <span class="trash-note">Đồ trong đây giữ 30 ngày rồi tự dọn. File gốc luôn được giữ — lịch sử chat đã gửi không bị ảnh hưởng.</span>
        <button class="trash-empty" :disabled="trashItems.length === 0" @click="onEmptyTrash">Dọn sạch</button>
        <button class="trash-close" title="Đóng" @click="closeTrash"><XIcon :size="15" :stroke-width="2" /></button>
      </div>

      <div v-if="trashLoading" class="m-empty"><div class="spin"></div> Đang tải…</div>
      <div v-else-if="trashItems.length === 0" class="m-empty">
        <div class="empty-ic"><Trash2Icon :size="40" :stroke-width="1.4" /></div>
        <div class="empty-ttl">Thùng rác trống</div>
        <div class="empty-sub">File anh xóa khỏi kho sẽ nằm đây 30 ngày, khôi phục lại được trước khi tự dọn.</div>
      </div>

      <div v-else class="m-grid">
        <div v-for="a in trashItems" :key="a.id" class="card trash-card">
          <div class="thumb">
            <img v-if="a.thumbnailUrl" :src="a.thumbnailUrl" loading="lazy" alt="" />
            <span v-else class="ph"><component :is="kindIcon(a.kind)" :size="26" :stroke-width="1.6" /></span>
            <span class="purge-badge" :class="{ soon: a.daysUntilPurge <= 3 }">còn {{ a.daysUntilPurge }} ngày</span>
          </div>
          <div class="meta">
            <div class="fn" :title="a.name">{{ a.name }}</div>
            <div class="trash-acts">
              <button class="t-restore" @click="onRestore(a)"><RotateCcwIcon :size="13" :stroke-width="1.9" /> Khôi phục</button>
              <button class="t-perm" title="Xóa vĩnh viễn" @click="onPermanentDelete(a)"><Trash2Icon :size="13" :stroke-width="1.9" /></button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Filter row — LEVER 1: Quyền (Loại = tabs ở trên) + nút Lọc sâu -->
    <div v-if="!trashMode && activeKind !== 'r2'" class="m-filter">
      <span class="crumb">Tất cả<template v-if="activeFolder"> ▸ <b>{{ activeFolderName }}</b></template></span>
      <span v-for="tag in activeTags" :key="tag" class="chip coral" @click="toggleTag(tag)">#{{ tag }} <XIcon :size="11" :stroke-width="2.2" /></span>

      <button class="lvl2-btn" :class="{ on: showLever2 }" @click="showLever2 = !showLever2">⚙ Lọc sâu</button>
      <div class="vis-toggle">
        <span :class="{ on: visFilter === '' }" @click="setVis('')">Tất cả</span>
        <span :class="{ on: visFilter === 'public' }" @click="setVis('public')"><GlobeIcon :size="12" :stroke-width="2" /> Công khai</span>
        <span :class="{ on: visFilter === 'private' }" @click="setVis('private')"><LockIcon :size="12" :stroke-width="2" /> Riêng tư</span>
      </div>
    </div>

    <!-- LEVER 2: Sắp xếp / Thời gian / Size / Tag (ẩn/hiện) -->
    <div v-if="showLever2 && !trashMode && activeKind !== 'r2'" class="m-lever2">
      <select v-model="ownerFilter" class="lv2-sel" @change="applyFilters">
        <option value="">Mọi người sở hữu</option>
        <option v-for="u in uploaders" :key="u.id" :value="u.id">{{ u.name }} ({{ u.count }})</option>
      </select>

      <select v-model="sortBy" class="lv2-sel" @change="applyFilters">
        <option value="recent">Gần đây dùng</option>
        <option value="newest">Mới tải lên</option>
        <option value="most_used">Hay dùng nhất</option>
        <option value="name">Tên A→Z</option>
      </select>
      <select v-model="sinceBy" class="lv2-sel" @change="applyFilters">
        <option value="">Mọi lúc</option>
        <option value="7d">7 ngày</option>
        <option value="30d">30 ngày</option>
        <option value="90d">90 ngày</option>
      </select>
      <select v-model="sizeBy" class="lv2-sel" @change="applyFilters">
        <option value="">Mọi cỡ</option>
        <option value="small">&lt; 1MB</option>
        <option value="medium">1–10MB</option>
        <option value="large">&gt; 10MB</option>
      </select>
      <input v-model="tagInput" class="lv2-tag" placeholder="Lọc theo tag…" @keyup.enter="applyTagFilter" @input="debouncedReload" />
    </div>

    <div v-if="!trashMode && activeKind !== 'r2'" class="m-work">
      <!-- Folder tree -->
      <aside class="m-tree">
        <div class="tree-ttl">Thư mục
          <button class="addf" title="Tạo thư mục" @click="onCreateFolder">＋</button>
        </div>
        <div class="f" :class="{ on: !activeFolder }" @click="setFolder(null)"><FolderIcon :size="13" :stroke-width="1.9" /> Tất cả</div>
        <div v-for="f in folderTree" :key="f.id" class="f" :class="{ on: activeFolder === f.id }" :style="{ paddingLeft: `${8 + f.depth * 16}px` }" @click="setFolder(f.id)">
          <FolderIcon :size="13" :stroke-width="1.9" /> {{ f.name }} <span class="folder-count">{{ f.assetCount }}</span> <component :is="f.visibility === 'public' ? GlobeIcon : LockIcon" class="folder-visibility-icon" :class="f.visibility" :size="11" :stroke-width="2" :title="f.visibility === 'public' ? 'Thư mục công khai' : 'Thư mục riêng tư'" />
        </div>
      </aside>

      <!-- Grid / empty / loading -->
      <div class="m-grid-wrap">
        <!-- GĐ12: thanh thao tác hàng loạt (hiện khi chọn nhiều + có ảnh chọn) -->
        <div v-if="multiMode && picked.size > 0" class="bulk-bar">
          <span class="bulk-cnt">Đã chọn {{ picked.size }}</span>
          <select v-model="bulkFolderId" class="bulk-sel" @change="onBulkFolder">
            <option value="__none">Gán thư mục…</option>
            <option value="">— Bỏ khỏi thư mục —</option>
            <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
          </select>
          <input v-model="bulkTag" class="bulk-tag" placeholder="Gán tag rồi Enter" @keyup.enter="onBulkTag" />
          <button class="bulk-trash" @click="onBulkTrash"><Trash2Icon :size="13" :stroke-width="1.9" /> Xóa {{ picked.size }} mục</button>
          <button class="bulk-clear" @click="clearPicked">Bỏ chọn</button>
        </div>

        <!-- Dải "Hay dùng nhất" đã GỠ 2026-06-15 (Anh chốt) — sẽ build module báo cáo riêng. -->

        <div v-if="loading" class="m-empty"><div class="spin"></div> Đang tải…</div>

        <div v-else-if="items.length === 0" class="m-empty">
          <div class="empty-ic"><ImageIcon :size="44" :stroke-width="1.4" /></div>
          <div class="empty-ttl">Kho ảnh của bạn đang trống</div>
          <div class="empty-sub">Tải ảnh hay dùng (bảng giá, mặt bằng, brochure) để gửi khách 1 chạm.</div>
          <button class="btn-dark" @click="triggerUpload">+ Tải ảnh đầu tiên</button>
          <div class="empty-hint"><LightbulbIcon :size="13" :stroke-width="1.9" /> Hoặc chuột phải ảnh trong chat → <b>Lưu vào Media</b></div>
        </div>

        <!-- TỆP: list detail theo dòng (sale phân biệt được tệp nào — anh chốt 2026-06-12) -->
        <div v-else-if="activeKind === 'file'" class="m-flist">
          <div v-for="a in items" :key="a.id" class="frow" :class="{ sel: selected?.id === a.id }" @click="select(a)">
            <span class="ficon" :style="{ background: fileIcon(a.name).bg, color: fileIcon(a.name).fg }">{{ fileIcon(a.name).label }}</span>
            <div class="finfo">
              <div class="fname" :title="a.name">{{ a.name }}</div>
              <div class="fmeta">
                {{ fmtSize(a.sizeBytes) }} · {{ a.visibility === 'public' ? 'Công khai' : 'Riêng tư' }} · đã dùng {{ a.usageCount }}
              </div>
              <div v-if="a.folderId" class="fmeta folder-meta" :title="folderPath(a.folderId)">
                <FolderIcon :size="11" :stroke-width="2" /> {{ folderPath(a.folderId) }} · {{ kindLabel(a.kind) }}
              </div>
              <div class="fmeta src-row" :title="sourceLabel(a)">
                <component :is="sourceIcon(a)" :size="11" :stroke-width="2" /> {{ sourceLabel(a) }}
              </div>
            </div>
          </div>
        </div>

        <!-- ẢNH/VIDEO: grid thẻ thumbnail -->
        <div v-else class="m-grid">
          <div v-for="a in items" :key="a.id" class="card" :class="{ sel: selected?.id === a.id, picked: picked.has(a.id) }" @click="onCardClick(a)">
            <div class="thumb">
              <img v-if="a.thumbnailUrl" :src="a.thumbnailUrl" loading="lazy" alt="" />
              <span v-else class="ph"><component :is="kindIcon(a.kind)" :size="26" :stroke-width="1.6" /></span>
              <span v-if="a.kind === 'video'" class="play-ic">▶</span>
              <span v-if="a.kind === 'video' && a.durationSec" class="dur">{{ fmtDuration(a.durationSec) }}</span>
              <span v-if="a.visibility === 'private'" class="badge"><LockIcon :size="11" :stroke-width="2.2" /></span>
              <span v-if="multiMode" class="pick-tick" :class="{ on: picked.has(a.id) }">{{ picked.has(a.id) ? '✓' : '' }}</span>
            </div>
            <div class="meta">
              <div class="fn" :title="a.name">{{ a.name }}</div>
              <!-- NGUỒN: ảnh từ nick nào / sale nào (2026-06-15). Lucide icon, không emoji. -->
              <div class="src" :title="sourceLabel(a)">
                <component :is="sourceIcon(a)" :size="11" :stroke-width="2" />
                <span>{{ sourceLabel(a) }}</span>
              </div>
              <div v-if="a.folderId" class="src folder-meta" :title="folderPath(a.folderId)">
                <FolderIcon :size="11" :stroke-width="2" />
                <span>{{ folderPath(a.folderId) }}</span>
              </div>
              <div class="stat" :class="a.visibility === 'public' ? 'pub' : 'lk'">
                <component :is="a.visibility === 'public' ? GlobeIcon : LockIcon" :size="11" :stroke-width="2" />
                {{ kindLabel(a.kind) }} · {{ a.visibility === 'public' ? 'Công khai' : 'Riêng tư' }} · {{ a.usageCount }} lần
              </div>
            </div>
          </div>
        </div>

        <!-- Phân trang (anh chốt 2026-06-16): nút chuyển trang + tổng số mục, tránh load lag. -->
        <div v-if="!loading && total > 0" class="m-pager">
          <button class="pg-btn" :disabled="page === 0" @click="goPage(-1)">‹ Trước</button>
          <span class="pg-num">Trang {{ page + 1 }}/{{ totalPages }} · {{ total }} mục</span>
          <button class="pg-btn" :disabled="page + 1 >= totalPages" @click="goPage(1)">Sau ›</button>
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

    <div v-if="fileUploadDialogOpen" class="folder-modal-backdrop" @click.self="closeFileUploadDialog">
      <section class="folder-upload-modal file-upload-modal" role="dialog" aria-modal="true" aria-labelledby="file-upload-title">
        <header class="folder-modal-head">
          <div>
            <h2 id="file-upload-title">Tải nhiều tệp</h2>
            <p>Chọn nhiều tệp cùng lúc, kéo thả hoặc thêm tiếp trước khi tải lên.</p>
          </div>
          <button class="folder-modal-close" type="button" title="Đóng" :disabled="fileUploadSaving" @click="closeFileUploadDialog"><XIcon :size="16" :stroke-width="2" /></button>
        </header>

        <button
          class="folder-dropzone"
          :class="{ over: fileDragOver }"
          type="button"
          :disabled="fileUploadSaving"
          @click="triggerFilePicker"
          @dragenter.prevent="fileDragOver = true"
          @dragover.prevent="fileDragOver = true"
          @dragleave.prevent="fileDragOver = false"
          @drop.prevent="onFileDrop"
        >
          <UploadCloudIcon :size="28" :stroke-width="1.6" />
          <strong>Kéo nhiều tệp vào đây</strong>
          <span>hoặc bấm để chọn nhiều tệp từ máy tính</span>
        </button>
        <div class="upload-access">
          <div class="upload-access-copy"><strong>Quyền truy cập</strong><span>Áp dụng cho toàn bộ tệp trong lần tải này.</span></div>
          <div class="access-segmented" role="radiogroup" aria-label="Quyền truy cập tệp tải lên">
            <button type="button" :class="{ on: fileUploadVisibility === 'private' }" :aria-pressed="fileUploadVisibility === 'private'" :disabled="fileUploadSaving" @click="fileUploadVisibility = 'private'"><LockIcon :size="13" :stroke-width="2" /> Riêng tư</button>
            <button type="button" :class="{ on: fileUploadVisibility === 'public' }" :aria-pressed="fileUploadVisibility === 'public'" :disabled="fileUploadSaving" @click="fileUploadVisibility = 'public'"><GlobeIcon :size="13" :stroke-width="2" /> Công khai</button>
          </div>
        </div>

        <div v-if="fileUploadQueue.length" class="folder-upload-summary">
          <span>{{ fileUploadQueue.length }} tệp</span>
          <span>{{ fmtSize(fileUploadTotalBytes) }}</span>
        </div>
        <div v-if="fileUploadQueue.length" class="folder-upload-list">
          <div v-for="entry in fileUploadQueue" :key="entry.id" class="folder-upload-row">
            <FileIcon :size="17" :stroke-width="1.8" />
            <div>
              <strong :title="entry.file.name">{{ entry.file.name }}</strong>
              <span>{{ fmtSize(entry.file.size) }}</span>
            </div>
            <button type="button" title="Bỏ tệp này" :disabled="fileUploadSaving" @click="removeQueuedFile(entry.id)"><XIcon :size="15" :stroke-width="2" /></button>
          </div>
        </div>
        <p v-else class="folder-upload-empty">Chưa có tệp nào trong danh sách.</p>

        <footer class="folder-modal-actions folder-upload-actions">
          <button class="folder-cancel" type="button" :disabled="fileUploadSaving" @click="triggerFilePicker">Thêm tệp</button>
          <button class="folder-submit" type="button" :disabled="fileUploadSaving || fileUploadQueue.length === 0" @click="uploadQueuedFiles">
            {{ fileUploadSaving ? `Đang tải ${fileUploadQueue.length} tệp…` : `Tải lên ${fileUploadQueue.length} tệp` }}
          </button>
        </footer>
      </section>
    </div>    <div v-if="folderUploadDialogOpen" class="folder-modal-backdrop" @click.self="closeFolderUploadDialog">
      <section class="folder-upload-modal" role="dialog" aria-modal="true" aria-labelledby="folder-upload-title">
        <header class="folder-modal-head">
          <div>
            <h2 id="folder-upload-title">Tải cả thư mục</h2>
            <p>Chọn một thư mục gốc. Tên thư mục, thư mục con và vị trí ảnh sẽ được giữ nguyên.</p>
          </div>
          <button class="folder-modal-close" type="button" title="Đóng" :disabled="folderUploadSaving" @click="closeFolderUploadDialog"><XIcon :size="16" :stroke-width="2" /></button>
        </header>

        <button
          class="folder-dropzone"
          :class="{ over: folderDragOver }"
          type="button"
          :disabled="folderUploadSaving"
          @click="triggerFolderPicker"
          @dragenter.prevent="folderDragOver = true"
          @dragover.prevent="folderDragOver = true"
          @dragleave.prevent="folderDragOver = false"
          @drop.prevent="onFolderDrop"
        >
          <FolderUpIcon :size="28" :stroke-width="1.6" />
          <strong>Kéo thư mục gốc vào đây</strong>
          <span>hoặc bấm “Chọn thư mục” để hệ thống tự tạo đúng cấu trúc trên máy tính</span>
        </button>
        <div class="upload-access">
          <div class="upload-access-copy"><strong>Quyền của cả thư mục</strong><span>Áp dụng cho thư mục gốc, mọi thư mục con và toàn bộ tệp bên trong.</span></div>
          <div class="access-segmented" role="radiogroup" aria-label="Quyền truy cập thư mục tải lên">
            <button type="button" :class="{ on: folderUploadVisibility === 'private' }" :aria-pressed="folderUploadVisibility === 'private'" :disabled="folderUploadSaving" @click="folderUploadVisibility = 'private'"><LockIcon :size="13" :stroke-width="2" /> Riêng tư</button>
            <button type="button" :class="{ on: folderUploadVisibility === 'public' }" :aria-pressed="folderUploadVisibility === 'public'" :disabled="folderUploadSaving" @click="folderUploadVisibility = 'public'"><GlobeIcon :size="13" :stroke-width="2" /> Công khai</button>
          </div>
        </div>

        <div v-if="folderUploadQueue.length" class="folder-upload-summary">
          <span>{{ folderUploadQueue.length }} thư mục</span>
          <span>{{ folderUploadFileCount }} tệp · {{ fmtSize(folderUploadTotalBytes) }}</span>
        </div>
        <div v-if="folderUploadQueue.length" class="folder-upload-list">
          <div v-for="batch in folderUploadQueue" :key="batch.id" class="folder-upload-row">
            <FolderIcon :size="17" :stroke-width="1.8" />
            <div>
              <strong :title="batch.name">{{ batch.name }}</strong>
              <span>{{ batch.files.length }} tệp · {{ fmtSize(batch.sizeBytes) }}</span>
            </div>
            <button type="button" title="Bỏ thư mục này" :disabled="folderUploadSaving" @click="removeQueuedFolder(batch.id)"><XIcon :size="15" :stroke-width="2" /></button>
          </div>
        </div>
        <p v-else class="folder-upload-empty">Chưa có thư mục nào trong danh sách.</p>

        <footer class="folder-modal-actions folder-upload-actions">
          <button class="folder-cancel" type="button" :disabled="folderUploadSaving" @click="triggerFolderPicker">Chọn thư mục</button>
          <button class="folder-submit" type="button" :disabled="folderUploadSaving || folderUploadQueue.length === 0" @click="uploadQueuedFolders">
            {{ folderUploadSaving ? `Đang tải ${folderUploadFileCount} tệp…` : `Tải lên ${folderUploadFileCount} tệp` }}
          </button>
        </footer>
      </section>
    </div>
    <div v-if="folderDialogOpen" class="folder-modal-backdrop" @click.self="closeFolderDialog">
      <section class="folder-modal" role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title">
        <header class="folder-modal-head">
          <div>
            <h2 id="folder-dialog-title">Tạo thư mục</h2>
            <p>Nhóm ảnh, tệp và video để tìm lại nhanh hơn.</p>
          </div>
          <button class="folder-modal-close" type="button" title="Đóng" @click="closeFolderDialog"><XIcon :size="16" :stroke-width="2" /></button>
        </header>
        <label class="folder-field">
          <span>Tên thư mục</span>
          <input
            v-model="folderName"
            autofocus
            maxlength="80"
            placeholder="Ví dụ: Bảng giá 2026"
            @keyup.enter="submitFolder"
          />
        </label>
        <div class="upload-access folder-create-access">
          <div class="upload-access-copy"><strong>Quyền của thư mục</strong><span>Riêng tư chỉ bạn sử dụng; Công khai cho mọi người trong tổ chức.</span></div>
          <div class="access-segmented" role="radiogroup" aria-label="Quyền truy cập thư mục mới">
            <button type="button" :class="{ on: folderVisibility === 'private' }" :aria-pressed="folderVisibility === 'private'" :disabled="folderSaving" @click="folderVisibility = 'private'"><LockIcon :size="13" :stroke-width="2" /> Riêng tư</button>
            <button type="button" :class="{ on: folderVisibility === 'public' }" :aria-pressed="folderVisibility === 'public'" :disabled="folderSaving" @click="folderVisibility = 'public'"><GlobeIcon :size="13" :stroke-width="2" /> Công khai</button>
          </div>
        </div>
        <p v-if="folderDialogError" class="folder-error">{{ folderDialogError }}</p>
        <footer class="folder-modal-actions">
          <button class="folder-cancel" type="button" @click="closeFolderDialog">Hủy</button>
          <button class="folder-submit" type="button" :disabled="folderSaving || !folderName.trim()" @click="submitFolder">
            {{ folderSaving ? 'Đang tạo…' : 'Tạo thư mục' }}
          </button>
        </footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  listMediaPaged, listMediaUploaders, uploadMedia, listMediaFolders, createMediaFolder,
  listTrash, restoreMedia, permanentDeleteMedia, emptyTrash,
  archiveMedia, bulkUpdateMedia,
  type MediaAssetItem, type MediaFolder, type TrashItem, MediaUploadError,
} from '@/api/media';
import { useToast } from '@/composables/use-toast';
import MediaDetailPanel from '@/components/media/MediaDetailPanel.vue';
import R2StorageManager from '@/components/media/R2StorageManager.vue';
import {
  Trash2 as Trash2Icon, RotateCcw as RotateCcwIcon, X as XIcon, CheckSquare as CheckSquareIcon,
  Globe as GlobeIcon, Lock as LockIcon, Smartphone as NickIcon, Upload as UploadIcon,
  Image as ImageIcon, FileText as FileIcon, Video as VideoIcon, Folder as FolderIcon, FolderUp as FolderUpIcon,
  Lightbulb as LightbulbIcon, UploadCloud as UploadCloudIcon,
} from 'lucide-vue-next';

// Icon placeholder theo loại media (thay emoji 🎬📄🖼 — Lucide, thống nhất 2026-06-15).
function kindIcon(kind: string) {
  return kind === 'video' ? VideoIcon : kind === 'file' ? FileIcon : ImageIcon;
}

const toast = useToast();

// Nhãn + icon NGUỒN ảnh (2026-06-15): "nick nào · sale nào" hoặc "Tải lên thủ công · sale".
function sourceLabel(a: MediaAssetItem): string {
  const sale = a.ownerName ? ` · ${a.ownerName}` : '';
  if (a.source === 'saved_from_chat' && a.sourceNickName) return `${a.sourceNickName}${sale}`;
  if (a.source === 'saved_from_chat') return `Lưu từ chat${sale}`;
  return `Tải lên thủ công${sale}`;
}
function sourceIcon(a: MediaAssetItem) {
  return a.source === 'saved_from_chat' && a.sourceNickName ? NickIcon : UploadIcon;
}

const tabs = [
  { kind: 'image', label: 'Ảnh' },
  { kind: 'album', label: 'Album' },
  { kind: 'file', label: 'Tệp' },
  { kind: 'video', label: 'Video' },
  { kind: 'r2', label: 'Quản lý lưu trữ' },
] as const;
const activeKind = ref<'image' | 'album' | 'file' | 'video' | 'r2'>('image');
const items = ref<MediaAssetItem[]>([]);
const folders = ref<MediaFolder[]>([]);
const loading = ref(false);
const search = ref('');
const visFilter = ref<'' | 'public' | 'private'>('');
const activeFolder = ref<string | null>(null);
const activeTags = ref<string[]>([]);
const selected = ref<MediaAssetItem | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);
const folderUploadSaving = ref(false);
const fileUploadSaving = ref(false);
const fileUploadDialogOpen = ref(false);
const fileDragOver = ref(false);
type MediaVisibility = 'private' | 'public';
const fileUploadVisibility = ref<MediaVisibility>('private');

type FileUploadEntry = { id: string; file: File };
const fileUploadQueue = ref<FileUploadEntry[]>([]);
const fileUploadTotalBytes = computed(() => fileUploadQueue.value.reduce((sum, entry) => sum + entry.file.size, 0));
const folderUploadDialogOpen = ref(false);
const folderDragOver = ref(false);
const folderUploadVisibility = ref<MediaVisibility>('private');

type FolderUploadFile = { file: File; relativePath: string };
type FolderUploadBatch = { id: string; name: string; files: FolderUploadFile[]; sizeBytes: number };
const folderUploadQueue = ref<FolderUploadBatch[]>([]);
const folderUploadFileCount = computed(() => folderUploadQueue.value.reduce((sum, batch) => sum + batch.files.length, 0));
const folderUploadTotalBytes = computed(() => folderUploadQueue.value.reduce((sum, batch) => sum + batch.sizeBytes, 0));
const folderDialogOpen = ref(false);
const folderName = ref('');
const folderSaving = ref(false);
const folderDialogError = ref('');
const folderVisibility = ref<MediaVisibility>('private');

// LEVER 2 (lọc sâu — anh chốt 2026-06-12).
const showLever2 = ref(false);
const sortBy = ref<'recent' | 'newest' | 'most_used' | 'name'>('recent');
const sinceBy = ref<'' | '7d' | '30d' | '90d'>('');
const sizeBy = ref<'' | 'small' | 'medium' | 'large'>('');
const tagInput = ref('');

// Lọc theo người sở hữu ảnh + phân trang (anh chốt 2026-06-16: /media load nhiều ảnh lag,
// cần nút chuyển trang; thêm lọc theo người upload). Tái dùng BE skip/total/ownerUserId.
const ownerFilter = ref('');
const uploaders = ref<Array<{ id: string; name: string; count: number }>>([]);
const PAGE_SIZE = 40;
const page = ref(0);
const total = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

const activeFolderName = computed(() => folders.value.find((f) => f.id === activeFolder.value)?.name ?? '');
const folderTree = computed(() => {
  const byParent = new Map<string | null, MediaFolder[]>();
  for (const folder of folders.value) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }
  for (const siblings of byParent.values()) siblings.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const output: Array<MediaFolder & { depth: number }> = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of byParent.get(parentId) ?? []) {
      output.push({ ...folder, depth });
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 0);
  return output;
});


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
  applyFilters();
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedReload() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyFilters, 300);
}

// Đổi bộ lọc → luôn về trang 1 (tránh kẹt ở "trang 5" rỗng khi kết quả co lại).
function applyFilters() { page.value = 0; reload(); }
function goPage(delta: number) {
  const next = page.value + delta;
  if (next < 0 || next >= totalPages.value) return;
  page.value = next;
  reload();
}

async function reload() {
  loading.value = true;
  try {
    // Album tab dùng folders; còn lại list assets theo kind.
    const kind = activeKind.value === 'album' ? undefined : activeKind.value;
    const res = await listMediaPaged({
      kind,
      q: search.value || undefined,
      visibility: visFilter.value || undefined,
      folderId: activeFolder.value || undefined,
      tag: activeTags.value[0] || tagInput.value.trim() || undefined,
      ownerUserId: ownerFilter.value || undefined,
      // Lever 2.
      sort: sortBy.value,
      since: sinceBy.value || undefined,
      limit: PAGE_SIZE,
      skip: page.value * PAGE_SIZE,
      ...sizeRange(),
    });
    items.value = res.items;
    total.value = res.total;
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Không tải được kho');
  } finally {
    loading.value = false;
  }
}

// Danh sách người sở hữu ảnh (đổ vào dropdown lọc) — khớp kind + visibility đang xem.
async function loadUploaders() {
  try {
    uploaders.value = await listMediaUploaders({
      kind: activeKind.value === 'album' ? undefined : activeKind.value,
      visibility: visFilter.value || undefined,
    });
  } catch { /* ignore — dropdown rỗng vẫn dùng lọc khác */ }
}

async function loadFolders() {
  try { folders.value = await listMediaFolders(); } catch { /* ignore */ }
}

function setKind(k: 'image' | 'album' | 'file' | 'video' | 'r2') {
  activeKind.value = k;
  selected.value = null;
  if (k === 'r2') { trashMode.value = false; return; }
  if (trashMode.value) loadTrash();
  else { applyFilters(); loadUploaders(); }
}
function setVis(v: any) { visFilter.value = v; applyFilters(); loadUploaders(); }function setFolder(id: string | null) { activeFolder.value = id; applyFilters(); }
function toggleTag(tag: string) { activeTags.value = activeTags.value.filter((t) => t !== tag); applyFilters(); }
function select(a: MediaAssetItem) { selected.value = a; }

// ── GĐ12: Chọn nhiều + thao tác hàng loạt ───────────────────────────────────
const multiMode = ref(false);
const picked = ref<Set<string>>(new Set());
const bulkFolderId = ref('__none');
const bulkTag = ref('');

function toggleMultiMode() {
  multiMode.value = !multiMode.value;
  if (!multiMode.value) clearPicked();
  else selected.value = null; // tắt panel chi tiết khi vào chế độ chọn nhiều
}
function clearPicked() { picked.value = new Set(); }
function onCardClick(a: MediaAssetItem) {
  if (!multiMode.value) { select(a); return; }
  const next = new Set(picked.value);
  if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
  picked.value = next;
}
async function onBulkFolder() {
  const v = bulkFolderId.value;
  if (v === '__none' || picked.value.size === 0) return;
  try {
    const folderId = v === '' ? null : v;
    const res = await bulkUpdateMedia([...picked.value], { folderId });
    toast.success(`Đã gán thư mục cho ${res.updated} mục`);
    bulkFolderId.value = '__none';
    clearPicked(); reload();
  } catch (e: any) { toast.warning(e?.response?.data?.error || 'Gán thư mục thất bại'); }
}
async function onBulkTag() {
  const t = bulkTag.value.trim();
  if (!t || picked.value.size === 0) return;
  try {
    const res = await bulkUpdateMedia([...picked.value], { addTags: [t] });
    toast.success(`Đã gán tag "${t}" cho ${res.updated} mục`);
    bulkTag.value = ''; reload();
  } catch (e: any) { toast.warning(e?.response?.data?.error || 'Gán tag thất bại'); }
}
async function onBulkTrash() {
  const ids = [...picked.value];
  if (ids.length === 0) return;
  if (!window.confirm(`Chuyển ${ids.length} mục vào Thùng rác?\n(Khôi phục được trong 30 ngày. Lịch sử chat đã gửi không bị ảnh hưởng.)`)) return;
  try {
    // Tái dùng archiveMedia (DELETE /media/:id = vào thùng rác) — chạy tuần tự cho an toàn.
    let ok = 0;
    for (const id of ids) { try { await archiveMedia(id); ok++; } catch { /* skip lỗi lẻ */ } }
    toast.success(`Đã chuyển ${ok}/${ids.length} mục vào Thùng rác`);
    clearPicked(); reload();
  } catch (e: any) { toast.warning(e?.response?.data?.error || 'Xóa hàng loạt thất bại'); }
}

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

function currentFolderVisibility(): MediaVisibility {
  return folders.value.find((folder) => folder.id === activeFolder.value)?.visibility === 'public' ? 'public' : 'private';
}

function triggerUpload() {
  if (folderUploadSaving.value || fileUploadSaving.value) return;
  if (!fileUploadQueue.value.length) fileUploadVisibility.value = currentFolderVisibility();
  fileUploadDialogOpen.value = true;
  fileDragOver.value = false;
}
function closeFileUploadDialog() {
  if (fileUploadSaving.value) return;
  fileUploadDialogOpen.value = false;
  fileUploadQueue.value = [];
  fileDragOver.value = false;
}
function triggerFilePicker() { fileInput.value?.click(); }
function queueFiles(files: File[]) {
  const unique = new Map(fileUploadQueue.value.map((entry) => [`${entry.file.name}|${entry.file.size}|${entry.file.lastModified}|${entry.file.type}`, entry]));
  for (const file of files) unique.set(`${file.name}|${file.size}|${file.lastModified}|${file.type}`, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`, file });
  fileUploadQueue.value = [...unique.values()];
  fileUploadDialogOpen.value = true;
}
function onFileDrop(event: DragEvent) {
  fileDragOver.value = false;
  queueFiles(Array.from(event.dataTransfer?.files ?? []));
}
function removeQueuedFile(id: string) {
  fileUploadQueue.value = fileUploadQueue.value.filter((entry) => entry.id !== id);
}
function openFolderUploadDialog() {
  if (folderUploadSaving.value) return;
  if (!folderUploadQueue.value.length) folderUploadVisibility.value = currentFolderVisibility();
  folderUploadDialogOpen.value = true;
  folderDragOver.value = false;
}
function closeFolderUploadDialog() {
  if (folderUploadSaving.value) return;
  folderUploadDialogOpen.value = false;
  folderUploadQueue.value = [];
  folderDragOver.value = false;
}
type DirectoryPickerEntry = {
  kind: 'file' | 'directory';
  name: string;
  getFile?: () => Promise<File>;
  values?: () => AsyncIterable<DirectoryPickerEntry>;
};

async function collectDirectoryHandle(handle: DirectoryPickerEntry, prefix = ''): Promise<FolderUploadFile[]> {
  const path = prefix ? `${prefix}/${handle.name}` : handle.name;
  if (handle.kind === 'file') return handle.getFile ? [{ file: await handle.getFile(), relativePath: path }] : [];
  const result: FolderUploadFile[] = [];
  if (!handle.values) return result;
  for await (const child of handle.values()) result.push(...await collectDirectoryHandle(child, path));
  return result;
}

async function triggerFolderPicker() {
  if (folderUploadSaving.value) return;
  const picker = (window as Window & { showDirectoryPicker?: () => Promise<DirectoryPickerEntry> }).showDirectoryPicker;
  if (!picker) {
    // Một số in-app browser không có showDirectoryPicker nhưng vẫn hỗ trợ
    // bộ chọn thư mục Chromium qua webkitdirectory. Đây là input riêng,
    // tuyệt đối không dùng lại input chọn từng tệp.
    folderInput.value?.click();
    return;
  }
  try {
    const root = await picker();
    const files = await collectDirectoryHandle(root);
    queueFolderFiles(files);
  } catch (error: any) {
    // Người dùng bấm Cancel thì không hiện cảnh báo; không rơi về bộ chọn từng tệp.
    if (error?.name === 'AbortError') return;
    toast.warning('Không mở được bộ chọn thư mục. Hãy kéo nguyên thư mục vào vùng tải lên hoặc thử Chrome/Edge.');
  }
}

function uploadSummary(assets: Array<{ kind: string; deduped: boolean; compressed: boolean }>): string {
  const images = assets.filter((asset) => asset.kind === 'image').length;
  const videos = assets.filter((asset) => asset.kind === 'video').length;
  const files = assets.filter((asset) => asset.kind === 'file').length;
  const compressed = assets.filter((asset) => asset.compressed).length;
  const deduplicated = assets.filter((asset) => asset.deduped).length;
  const kinds = [images ? `${images} ảnh` : '', videos ? `${videos} video` : '', files ? `${files} tệp` : ''].filter(Boolean).join(', ');
  const details = [kinds, compressed ? `${compressed} ảnh đã nén WebP` : '', deduplicated ? `${deduplicated} tệp đã có sẵn` : ''].filter(Boolean).join(' · ');
  return details ? `Đã tải ${assets.length} mục: ${details}` : `Đã tải ${assets.length} mục`;
}

function uploadErrorMessage(error: any): string {
  const message = error?.response?.data?.error;
  if (message) return message;
  if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
    return 'Máy chủ xử lý tải lên quá lâu. Tệp có thể vẫn đang được xử lý; hãy chờ rồi tải lại danh sách trước khi thử lại.';
  }
  if (error?.code === 'ERR_NETWORK') return 'Không kết nối được máy chủ khi đang tải. Kiểm tra mạng hoặc thử lại sau.';
  return 'Tải lên thất bại. Vui lòng thử lại.';
}

function onFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  queueFiles(Array.from(input.files ?? []));
  input.value = '';
}

function onFolderFilesPicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (!files.length) return;
  queueFolderFiles(files.map((file) => ({
    file,
    relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  })));
}

async function uploadQueuedFiles() {
  if (!fileUploadQueue.value.length || fileUploadSaving.value) return;
  fileUploadSaving.value = true;
  const files = fileUploadQueue.value.map((entry) => entry.file);
  try {
    const res = await uploadMedia(files, { visibility: fileUploadVisibility.value, folderId: activeFolder.value ?? undefined });
    toast.success(uploadSummary(res.assets));
    fileUploadQueue.value = [];
    fileUploadDialogOpen.value = false;
    reload();
  } catch (err: any) {
    const uploadedAssets = err instanceof MediaUploadError ? err.uploadedAssets : [];
    if (uploadedAssets.length) {
      toast.warning(uploadSummary(uploadedAssets) + '. Các tệp còn lại chưa tải: ' + uploadErrorMessage(err.cause));
      fileUploadQueue.value = files.slice(uploadedAssets.length).map((file) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`, file }));
      reload();
    } else {
      toast.warning(uploadErrorMessage(err));
    }
  } finally {
    fileUploadSaving.value = false;
  }
}
function relativeFolderParts(path: string): string[] {
  return path.split('/').slice(0, -1).map((part) => part.trim()).filter(Boolean);
}

function kindLabel(kind: string): string {
  return kind === 'video' ? 'Video' : kind === 'file' ? 'Tệp' : 'Ảnh';
}

function folderPath(folderId: string | null | undefined): string {
  if (!folderId) return 'Chưa phân loại';
  const names: string[] = [];
  const seen = new Set<string>();
  let current = folders.value.find((folder) => folder.id === folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? folders.value.find((folder) => folder.id === current!.parentId) : undefined;
  }
  return names.length ? names.join(' / ') : 'Chưa phân loại';
}

function queueFolderFiles(entries: FolderUploadFile[]) {
  const grouped = new Map<string, FolderUploadFile[]>();
  for (const entry of entries) {
    const parts = entry.relativePath.split('/').filter(Boolean);
    if (parts.length < 2) continue;
    const rootName = parts[0];
    const group = grouped.get(rootName) ?? [];
    group.push({ ...entry, relativePath: parts.join('/') });
    grouped.set(rootName, group);
  }
  if (!grouped.size) {
    toast.warning('Không tìm thấy tệp trong thư mục đã chọn');
    return;
  }
  const next = [...folderUploadQueue.value];
  for (const [name, files] of grouped) {
    const existing = next.find((batch) => batch.name === name);
    const unique = new Map((existing?.files ?? []).map((entry) => [`${entry.relativePath}|${entry.file.size}|${entry.file.lastModified}`, entry]));
    for (const entry of files) unique.set(`${entry.relativePath}|${entry.file.size}|${entry.file.lastModified}`, entry);
    const mergedFiles = [...unique.values()];
    const batch = { id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`, name, files: mergedFiles, sizeBytes: mergedFiles.reduce((sum, entry) => sum + entry.file.size, 0) };
    const index = existing ? next.indexOf(existing) : -1;
    if (index >= 0) next[index] = batch;
    else next.push(batch);
  }
  folderUploadQueue.value = next;
  folderUploadDialogOpen.value = true;
}

interface FolderEntryLike {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, error?: (error: unknown) => void) => void;
  createReader?: () => { readEntries: (success: (entries: FolderEntryLike[]) => void, error?: (error: unknown) => void) => void };
}

function readDroppedFile(entry: FolderEntryLike): Promise<File> {
  return new Promise((resolve, reject) => entry.file?.(resolve, reject));
}
function readDroppedDirectory(entry: FolderEntryLike): Promise<FolderEntryLike[]> {
  return new Promise((resolve, reject) => {
    const reader = entry.createReader?.();
    if (!reader) return resolve([]);
    const all: FolderEntryLike[] = [];
    const readNext = () => reader.readEntries((entries) => {
      if (!entries.length) return resolve(all);
      all.push(...entries);
      readNext();
    }, reject);
    readNext();
  });
}
async function collectDroppedEntry(entry: FolderEntryLike, prefix = ''): Promise<FolderUploadFile[]> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) return [{ file: await readDroppedFile(entry), relativePath: path }];
  if (!entry.isDirectory) return [];
  const children = await readDroppedDirectory(entry);
  const result: FolderUploadFile[] = [];
  for (const child of children) result.push(...await collectDroppedEntry(child, path));
  return result;
}
async function onFolderDrop(e: DragEvent) {
  folderDragOver.value = false;
  const items = Array.from(e.dataTransfer?.items ?? []);
  const entries = items.reduce<FolderEntryLike[]>((all, item) => {
    const getEntry = (item as unknown as { webkitGetAsEntry?: () => FolderEntryLike | null }).webkitGetAsEntry;
    const entry = getEntry?.() ?? null;
    if (entry?.isDirectory) all.push(entry);
    return all;
  }, []);
  if (!entries.length) {
    toast.warning('Hãy kéo thư mục từ máy tính vào đây');
    return;
  }
  try {
    const files: FolderUploadFile[] = [];
    for (const entry of entries) files.push(...await collectDroppedEntry(entry));
    queueFolderFiles(files);
  } catch {
    toast.warning('Không đọc được thư mục đã kéo vào');
  }
}

function removeQueuedFolder(id: string) {
  if (folderUploadSaving.value) return;
  folderUploadQueue.value = folderUploadQueue.value.filter((batch) => batch.id !== id);
}

async function onCreateFolder() {
  folderName.value = '';
  folderDialogError.value = '';
  folderVisibility.value = currentFolderVisibility();
  folderDialogOpen.value = true;
}

async function ensureFolderPath(parts: string[], folderByPath: Map<string, string>, visibility: MediaVisibility): Promise<string | null> {
  let parentId = activeFolder.value;
  let path = parentId ? `selected:${parentId}` : 'root';
  for (const name of parts) {
    path += `/${name}`;
    const known = folderByPath.get(path);
    if (known) { parentId = known; continue; }
    let created: MediaFolder;
    try {
      created = (await createMediaFolder(name, visibility, parentId)).folder;
    } catch (error: any) {
      if (error?.response?.status !== 409) throw error;
      await loadFolders();
      const existing = folders.value.find((folder) => folder.parentId === parentId && folder.name === name);
      if (!existing) throw error;
      created = existing;
    }
    folders.value = [...folders.value.filter((folder) => folder.id !== created.id), created];
    folderByPath.set(path, created.id);
    parentId = created.id;
  }
  return parentId;
}

async function uploadQueuedFolders() {
  if (!folderUploadQueue.value.length || folderUploadSaving.value) return;
  folderUploadSaving.value = true;
  try {
    const folderByPath = new Map<string, string>();
    const groups = new Map<string | null, File[]>();
    for (const batch of folderUploadQueue.value) {
      for (const entry of batch.files) {
        const folderId = await ensureFolderPath(relativeFolderParts(entry.relativePath), folderByPath, folderUploadVisibility.value);
        const group = groups.get(folderId) ?? [];
        group.push(entry.file);
        groups.set(folderId, group);
      }
    }
    let uploaded = 0;
    const uploadedAssets: Array<{ kind: string; deduped: boolean; compressed: boolean }> = [];
    for (const [folderId, groupedFiles] of groups) {
      const result = await uploadMedia(groupedFiles, { visibility: folderUploadVisibility.value, folderId: folderId ?? undefined });
      uploaded += result.assets.length;
      uploadedAssets.push(...result.assets);
    }
    const queueCount = folderUploadQueue.value.length;
    const folderNames = folderUploadQueue.value.map((batch) => batch.name).slice(0, 3).join(', ');
    const moreFolders = queueCount > 3 ? ` và ${queueCount - 3} thư mục khác` : '';
    toast.success(`${uploadSummary(uploadedAssets)} từ ${queueCount} thư mục: ${folderNames}${moreFolders}`);
    folderUploadQueue.value = [];
    folderUploadDialogOpen.value = false;
    await loadFolders();
    reload();
  } catch (error: any) {
    const uploadedAssets = error instanceof MediaUploadError ? error.uploadedAssets : [];
    if (uploadedAssets.length) {
      toast.warning(uploadSummary(uploadedAssets) + '. Các tệp còn lại chưa tải: ' + uploadErrorMessage(error.cause));
      reload();
    } else {
      toast.warning(uploadErrorMessage(error));
    }
  } finally {
    folderUploadSaving.value = false;
  }
}
function closeFolderDialog() {
  if (folderSaving.value) return;
  folderDialogOpen.value = false;
  folderDialogError.value = '';
}

async function submitFolder() {
  const name = folderName.value.trim();
  if (!name) {
    folderDialogError.value = 'Vui lòng nhập tên thư mục.';
    return;
  }
  if (name.length > 80) {
    folderDialogError.value = 'Tên thư mục tối đa 80 ký tự.';
    return;
  }
  folderSaving.value = true;
  folderDialogError.value = '';
  try {
    const res = await createMediaFolder(name, folderVisibility.value);
    folders.value = [...folders.value.filter((folder) => folder.id !== res.folder.id), res.folder]
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    folderDialogOpen.value = false;
    toast.success('Đã tạo thư mục');
  } catch (e: any) {
    folderDialogError.value = e?.response?.data?.error || 'Không tạo được thư mục.';
  } finally {
    folderSaving.value = false;
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
  toast.success('Đã chuyển vào Thùng rác');
}

// ── GĐ13a: Thùng rác ────────────────────────────────────────────────────────
const trashMode = ref(false);
const trashItems = ref<TrashItem[]>([]);
const trashLoading = ref(false);

async function loadTrash() {
  trashLoading.value = true;
  try {
    const kind = activeKind.value === 'album' ? undefined : activeKind.value;
    const res = await listTrash({ kind });
    trashItems.value = res.items;
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Không tải được thùng rác');
  } finally {
    trashLoading.value = false;
  }
}
function openTrash() { trashMode.value = true; selected.value = null; loadTrash(); }
function closeTrash() { trashMode.value = false; reload(); }

async function onRestore(a: TrashItem) {
  try {
    await restoreMedia(a.id);
    trashItems.value = trashItems.value.filter((x) => x.id !== a.id);
    toast.success(`Đã khôi phục "${a.name}" về kho`);
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Khôi phục thất bại');
  }
}
async function onPermanentDelete(a: TrashItem) {
  if (!window.confirm(`Xóa vĩnh viễn "${a.name}"? Sẽ KHÔNG khôi phục được nữa.\n(Lịch sử chat đã gửi không bị ảnh hưởng.)`)) return;
  try {
    await permanentDeleteMedia(a.id);
    trashItems.value = trashItems.value.filter((x) => x.id !== a.id);
    toast.success('Đã xóa vĩnh viễn khỏi kho');
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Xóa vĩnh viễn thất bại');
  }
}
async function onEmptyTrash() {
  if (trashItems.value.length === 0) return;
  if (!window.confirm(`Dọn sạch Thùng rác (${trashItems.value.length} mục)? Sẽ KHÔNG khôi phục được.\n(Lịch sử chat đã gửi không bị ảnh hưởng.)`)) return;
  try {
    const res = await emptyTrash();
    toast.success(`Đã dọn ${res.deleted} mục${res.hasMore ? ' (còn nữa, bấm lại để dọn tiếp)' : ''}`);
    loadTrash();
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Dọn thùng rác thất bại');
  }
}

// Dải "Hay dùng nhất" (mediaStats) đã GỠ 2026-06-15 — build module báo cáo riêng sau.

onMounted(() => { reload(); loadFolders(); loadUploaders(); });
</script>

<style scoped>
.media-page {
  --ink:#181d26; --body:#333840; --muted:#41454d; --hairline:#dddddd;
  --canvas:#fff; --soft:#f8fafc; --strong:#e0e2e6; --coral:#aa2d00; --success:#006400;
  --r-sm:6px; --r-md:10px; --pill:9999px;
  /* Chiều cao CỐ ĐỊNH theo viewport (trừ topnav 48px) — v-main chỉ có min-height nên
     height:100% không phân giải → flex chain hỏng, cột 3 detail không cuộn được, accordion
     mở ra tràn khỏi màn (anh báo 2026-06-16). Cố định height → .p-body cuộn đúng. */
  display:flex; flex-direction:column; height:calc(100vh - var(--smax-topnav-h, 48px)); min-height:0; overflow:hidden;
  background:var(--canvas); color:var(--body); font-size:14px;
}
.m-top { display:flex; align-items:center; justify-content:space-between; padding:16px 24px 12px; border-bottom:1px solid var(--hairline); }
.m-title { font-size:20px; font-weight:400; color:var(--ink); margin:0; }
.m-tools { display:flex; gap:10px; align-items:center; }
.m-search { display:flex; align-items:center; gap:7px; border:1px solid var(--hairline); border-radius:var(--r-sm); padding:6px 12px; width:240px; }
.m-search input { border:none; outline:none; font-size:13px; width:100%; background:transparent; color:var(--body); }
.btn-dark { background:var(--ink); color:#fff; border:none; border-radius:var(--r-md); padding:8px 16px; font-size:13.5px; font-weight:500; cursor:pointer; }
.btn-dark:disabled, .btn-folder-upload:disabled { opacity:.5; cursor:default; }
.btn-folder-upload { display:inline-flex; align-items:center; gap:6px; background:#fff; color:var(--ink); border:1px solid var(--hairline); border-radius:var(--r-md); padding:7px 13px; font-size:13px; font-weight:600; cursor:pointer; }
.btn-folder-upload:hover { border-color:#1786be; color:#1786be; }
.m-tabs { display:flex; gap:2px; padding:0 24px; border-bottom:1px solid var(--hairline); }
.tab { padding:11px 16px; font-size:14px; color:var(--muted); border:none; background:none; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-1px; }
.tab.on { color:var(--ink); font-weight:500; border-bottom-color:var(--ink); }
.chat-cleanup-bar { display:flex; align-items:center; gap:10px; padding:10px 24px; border-bottom:1px solid #f0d0c8; background:#fff7f5; flex-wrap:wrap; }
.cleanup-copy { display:flex; flex-direction:column; gap:2px; min-width:210px; }
.cleanup-copy b { font-size:13px; color:#7a271a; }
.cleanup-copy span { font-size:11.5px; color:#8a4b3f; }
.cleanup-select { min-width:270px; max-width:430px; flex:1; border:1px solid #e8b5aa; border-radius:var(--r-sm,6px); padding:7px 10px; font-size:13px; color:var(--ink); background:#fff; outline:none; }
.cleanup-delete { display:inline-flex; align-items:center; justify-content:center; gap:6px; border:1px solid #b42318; background:#b42318; color:#fff; border-radius:var(--r-sm,6px); padding:7px 13px; font-size:13px; font-weight:700; cursor:pointer; }
.cleanup-delete:disabled { opacity:.42; cursor:default; background:#fff; color:#8a4b3f; border-color:#e8b5aa; }
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
.scope-chip { background:#eef2fb; border-color:#cbd8ff; color:#1f3a8a; }
.scope-trash { display:inline-flex; align-items:center; gap:5px; border:1px solid #f0c8c2; background:#fff; color:#b42318; border-radius:var(--pill); padding:5px 12px; font-size:12.5px; font-weight:600; cursor:pointer; }
.scope-trash:hover { background:#b42318; color:#fff; border-color:#b42318; }
.lv2-scope { min-width:220px; max-width:320px; }
.thumb .play-ic { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:34px; height:34px; border-radius:9999px; background:rgba(0,0,0,.5); color:#fff; font-size:14px; display:flex; align-items:center; justify-content:center; pointer-events:none; }
.thumb .dur { position:absolute; bottom:6px; right:6px; background:rgba(0,0,0,.7); color:#fff; border-radius:4px; padding:1px 6px; font-size:10.5px; font-variant-numeric:tabular-nums; }
.m-work { display:flex; flex:1; overflow:hidden; min-height:0; }
.r2-storage-view { flex:1 1 auto; align-self:stretch; width:100%; min-width:0; min-height:0; }
.m-tree { width:180px; border-right:1px solid var(--hairline); padding:14px 12px; flex-shrink:0; overflow:auto; }
.tree-ttl { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin-bottom:8px; font-weight:500; display:flex; justify-content:space-between; align-items:center; }
.addf { border:none; background:none; cursor:pointer; color:var(--ink); font-size:16px; line-height:1; }
.f { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:var(--r-sm); font-size:13px; color:var(--body); cursor:pointer; }
.f.on { background:var(--soft); color:var(--ink); font-weight:500; }
.f .lk { margin-left:auto; font-size:11px; }
.f .folder-visibility-icon { margin-left:6px; color:#6f7782; flex:0 0 auto; }
.f .folder-visibility-icon.public { color:#1786be; }
.m-grid-wrap { flex:1; padding:16px 24px; overflow:auto; min-width:0; }
.m-pager { display:flex; align-items:center; justify-content:center; gap:14px; padding:16px 0 4px; }
.pg-btn { border:1px solid var(--hairline); background:var(--canvas); border-radius:var(--r-sm,6px); padding:6px 14px; font-size:13px; cursor:pointer; color:var(--ink); }
.pg-btn:disabled { opacity:.4; cursor:default; }
.pg-num { font-size:12.5px; color:var(--muted,#8b93a7); font-variant-numeric:tabular-nums; white-space:nowrap; }
/* GĐ12a (HD-first 1366): cell co theo cỡ màn. 1366 ô nhỏ (sale màn nhỏ thấy nhiều ảnh
   hơn, đỡ cuộn) → 1920 vừa → 2560 ô to thoáng. minmax auto-fill giữ lưới không vỡ. */
.m-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:12px; }
@media (min-width:1600px) { .m-grid { grid-template-columns:repeat(auto-fill, minmax(170px, 1fr)); gap:14px; } }
@media (min-width:2200px) { .m-grid { grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:16px; } }
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
.thumb .ph { color:var(--muted); display:flex; align-items:center; justify-content:center; }
.thumb .badge { position:absolute; top:6px; right:6px; background:rgba(24,29,38,.82); color:#fff; border-radius:var(--pill); padding:3px 6px; display:inline-flex; align-items:center; }
.meta { padding:8px 10px; }
.fn { font-size:12.5px; color:var(--ink); font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stat { font-size:11px; margin-top:3px; }
.stat.pub { color:var(--success); }
.stat.lk { color:var(--coral); }
.m-empty { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:var(--muted); padding:60px 20px; text-align:center; }
.empty-ic { opacity:.5; color:var(--muted); display:flex; align-items:center; justify-content:center; }
.empty-ttl { font-size:17px; color:var(--ink); font-weight:500; }
.empty-sub { font-size:13px; max-width:340px; }
.empty-hint { margin-top:10px; background:#f5e9d4; border:1px solid #e6d3ad; color:#6b5520; padding:6px 16px; border-radius:var(--pill); font-size:12px; display:inline-flex; align-items:center; gap:6px; }
.spin { width:18px; height:18px; border:2px solid var(--strong); border-top-color:var(--ink); border-radius:50%; animation:spin .7s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
/* Dải "Hay dùng nhất" đã GỠ 2026-06-15 — build module báo cáo riêng sau. */

/* NGUỒN ảnh: nick nào / sale nào (2026-06-15) — Lucide icon, không emoji. */
.src { display:flex; align-items:center; gap:4px; font-size:11px; color:var(--muted); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.src span { overflow:hidden; text-overflow:ellipsis; }
.src-row { display:flex; align-items:center; gap:4px; margin-top:2px; }
.stat { display:flex; align-items:center; gap:4px; }

/* ── GĐ13a: Thùng rác ── */
.btn-trash { display:inline-flex; align-items:center; gap:6px; background:#fff; color:var(--muted); border:1px solid var(--hairline); border-radius:var(--r-md); padding:7px 13px; font-size:13px; font-weight:500; cursor:pointer; }
.btn-trash:hover { border-color:#1786be; color:#1786be; }
.btn-trash.on { background:#1786be; border-color:#1786be; color:#fff; }
.m-trash { flex:1; display:flex; flex-direction:column; padding:14px 24px; overflow:auto; min-height:0; }
.trash-bar { display:flex; align-items:center; gap:12px; padding:9px 13px; background:#fff8ec; border:1px solid #ffe3b3; border-radius:var(--r-md); margin-bottom:14px; }
.trash-ttl { display:inline-flex; align-items:center; gap:6px; font-size:13.5px; font-weight:700; color:#92400e; flex-shrink:0; }
.trash-note { font-size:11.5px; color:#7a5a1e; flex:1; line-height:1.4; }
.trash-empty { background:#fff; border:1px solid #e0a93f; color:#92400e; border-radius:var(--r-sm); padding:5px 12px; font-size:12px; font-weight:600; cursor:pointer; flex-shrink:0; }
.trash-empty:disabled { opacity:.45; cursor:default; }
.trash-close { background:none; border:none; cursor:pointer; color:#92400e; display:inline-flex; padding:3px; flex-shrink:0; }
.trash-card { cursor:default; }
.purge-badge { position:absolute; top:5px; left:5px; background:rgba(20,26,36,.72); color:#fff; font-size:10px; font-weight:600; border-radius:5px; padding:1px 6px; }
.purge-badge.soon { background:#c0392b; }
.trash-acts { display:flex; gap:5px; margin-top:4px; }
.t-restore { flex:1; display:inline-flex; align-items:center; justify-content:center; gap:4px; background:#e4f1f8; color:#1786be; border:1px solid #cfe6f3; border-radius:var(--r-sm); padding:5px 8px; font-size:11.5px; font-weight:600; cursor:pointer; }
.t-restore:hover { background:#1786be; color:#fff; border-color:#1786be; }
.t-perm { background:#fff; color:#c0392b; border:1px solid #f0c8c2; border-radius:var(--r-sm); padding:5px 9px; cursor:pointer; display:inline-flex; align-items:center; }
.t-perm:hover { background:#c0392b; color:#fff; border-color:#c0392b; }

/* Tạo thư mục dùng modal trong app thay vì window.prompt (không ổn định trong IAB/PWA). */
.folder-modal-backdrop { position:fixed; inset:0; z-index:40; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(15,23,42,.34); }
.folder-modal { width:min(420px, 100%); border:1px solid #d9dee5; border-radius:10px; background:#fff; box-shadow:0 18px 50px rgba(15,23,42,.2); color:var(--ink); }
.folder-modal-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; padding:18px 18px 12px; border-bottom:1px solid var(--hairline); }
.folder-modal-head h2 { margin:0; font-size:17px; font-weight:600; }
.folder-modal-head p { margin:5px 0 0; color:var(--muted); font-size:12px; }
.folder-modal-close { display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border:1px solid var(--hairline); border-radius:6px; background:#fff; color:var(--muted); cursor:pointer; }
.folder-field { display:flex; flex-direction:column; gap:6px; padding:18px; }
.folder-field span { color:var(--ink); font-size:12.5px; font-weight:600; }
.folder-field input { width:100%; box-sizing:border-box; border:1px solid #cfd5dc; border-radius:6px; padding:9px 10px; outline:none; color:var(--ink); font-size:13px; }
.folder-field input:focus { border-color:#1786be; box-shadow:0 0 0 2px rgba(23,134,190,.12); }
.folder-error { margin:-7px 18px 0; color:#b42318; font-size:12px; }
.folder-modal-actions { display:flex; justify-content:flex-end; gap:8px; padding:12px 18px 18px; }
.folder-cancel, .folder-submit { border-radius:6px; padding:8px 13px; font-size:13px; font-weight:600; cursor:pointer; }
.folder-cancel { border:1px solid var(--hairline); background:#fff; color:var(--muted); }
.folder-submit { border:1px solid var(--ink); background:var(--ink); color:#fff; }
.folder-submit:disabled { opacity:.45; cursor:default; }

.folder-upload-modal { width:min(560px, 100%); max-height:min(760px, calc(100vh - 40px)); overflow:auto; border:1px solid #d9dee5; border-radius:10px; background:#fff; box-shadow:0 18px 50px rgba(15,23,42,.2); color:var(--ink); }
.folder-dropzone { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; width:calc(100% - 36px); min-height:132px; margin:18px; border:1.5px dashed #b8c5d0; border-radius:8px; background:#f8fafc; color:var(--muted); cursor:pointer; }
.folder-dropzone:hover, .folder-dropzone.over { border-color:#1786be; background:#eef8fc; color:#0b5880; }
.folder-dropzone strong { color:var(--ink); font-size:13.5px; }
.folder-dropzone span { font-size:12px; }
.folder-dropzone:disabled { opacity:.55; cursor:default; }
.upload-access { display:flex; align-items:center; justify-content:space-between; gap:16px; margin:0 18px 14px; padding:10px 12px; border:1px solid #dce3e9; border-radius:7px; background:#fbfcfd; }
.upload-access-copy { display:flex; flex-direction:column; gap:3px; min-width:0; }
.upload-access-copy strong { color:var(--ink); font-size:12.5px; }
.upload-access-copy span { color:var(--muted); font-size:11.5px; line-height:1.35; }
.access-segmented { display:inline-flex; flex:0 0 auto; border:1px solid #cfd8df; border-radius:6px; overflow:hidden; background:#fff; }
.access-segmented button { display:inline-flex; align-items:center; gap:5px; border:0; border-right:1px solid #dbe2e7; background:#fff; color:var(--muted); padding:7px 10px; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap; }
.access-segmented button:last-child { border-right:0; }
.access-segmented button.on { background:#1c2733; color:#fff; }
.access-segmented button:not(.on):hover { color:#1786be; background:#f2f8fb; }
.access-segmented button:disabled { opacity:.5; cursor:default; }
.folder-create-access { margin-top:0; margin-bottom:4px; }
.folder-upload-summary { display:flex; justify-content:space-between; gap:10px; margin:0 18px 8px; color:var(--muted); font-size:12.5px; font-weight:600; }
.folder-upload-list { display:flex; flex-direction:column; gap:6px; max-height:260px; overflow:auto; margin:0 18px; }
.folder-upload-row { display:flex; align-items:center; gap:10px; min-width:0; padding:9px 10px; border:1px solid var(--hairline); border-radius:7px; background:#fff; }
.folder-upload-row > svg { flex:0 0 auto; color:#1786be; }
.folder-upload-row > div { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; }
.folder-upload-row strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
.folder-upload-row span { color:var(--muted); font-size:11.5px; }
.folder-upload-row button { display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; width:28px; height:28px; border:1px solid var(--hairline); border-radius:6px; background:#fff; color:var(--muted); cursor:pointer; }
.folder-upload-row button:hover { color:#b42318; border-color:#e8b5aa; }
.folder-upload-row button:disabled { opacity:.45; cursor:default; }
.folder-upload-empty { margin:0 18px 8px; color:var(--muted); font-size:12.5px; }
.folder-upload-actions { justify-content:space-between; }
.folder-upload-actions .folder-cancel { margin-right:auto; }
.folder-cancel:disabled, .folder-submit:disabled, .folder-modal-close:disabled { opacity:.45; cursor:default; }
/* ── GĐ12: Chọn nhiều + thao tác hàng loạt ── */
.btn-multi { display:inline-flex; align-items:center; gap:6px; background:#fff; color:var(--muted); border:1px solid var(--hairline); border-radius:var(--r-md); padding:7px 13px; font-size:13px; font-weight:500; cursor:pointer; }
.btn-multi:hover { border-color:#1786be; color:#1786be; }
.btn-multi.on { background:#1786be; border-color:#1786be; color:#fff; }
.pick-tick { position:absolute; top:6px; left:6px; width:22px; height:22px; border-radius:6px; border:2px solid #fff; background:rgba(20,26,36,.35); color:#fff; font-size:13px; font-weight:800; display:flex; align-items:center; justify-content:center; box-shadow:0 1px 3px rgba(0,0,0,.25); }
.pick-tick.on { background:#1786be; }
.card.picked { border-color:#1786be; box-shadow:0 0 0 2px #d4ecf7; }
.bulk-bar { display:flex; align-items:center; gap:10px; background:#e4f1f8; border:1px solid #b9ddf0; border-radius:var(--r-md); padding:9px 13px; margin-bottom:14px; }
.bulk-cnt { font-size:13px; font-weight:700; color:#0b5880; flex-shrink:0; }
.bulk-sel, .bulk-tag { border:1px solid #b9ddf0; border-radius:var(--r-sm); padding:6px 10px; font-size:12.5px; background:#fff; color:var(--ink); outline:none; }
.bulk-tag { width:150px; }
.bulk-trash { display:inline-flex; align-items:center; gap:5px; background:#fff; border:1px solid #f0c8c2; color:#c0392b; border-radius:var(--r-sm); padding:6px 11px; font-size:12.5px; font-weight:600; cursor:pointer; }
.bulk-trash:hover { background:#c0392b; color:#fff; border-color:#c0392b; }
.bulk-clear { margin-left:auto; background:none; border:none; color:#0b5880; font-size:12.5px; font-weight:600; cursor:pointer; }
.folder-count { margin-left: auto; min-width: 18px; text-align: center; color: var(--muted); font-size: 11px; }
.folder-meta { color: #526273; }
.folder-meta svg { flex: 0 0 auto; color: #1786be; }
</style>
