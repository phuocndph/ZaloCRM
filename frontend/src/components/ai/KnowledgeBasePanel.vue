<template>
  <section class="kb-shell">
    <header class="kb-header">
      <div class="kb-heading">
        <span class="heading-icon mdi mdi-book-open-page-variant-outline" aria-hidden="true" />
        <div>
          <div class="heading-title"><h2>Kho tri thức</h2><span>Knowledge Base</span></div>
          <p>Quản lý nội dung AI theo một quy trình thống nhất, có đánh giá và kiểm soát trước khi sử dụng.</p>
        </div>
      </div>
      <div class="header-actions">
        <button type="button" class="button secondary" :disabled="loading" @click="loadAll">
          <span class="mdi mdi-refresh" :class="{ spinning: loading }" />
          {{ loading ? 'Đang tải…' : 'Làm mới' }}
        </button>
        <button type="button" class="button primary" @click="showCreateSource = true">
          <span class="mdi mdi-plus" /> Tạo nguồn
        </button>
      </div>
    </header>

    <Transition name="notice">
      <div v-if="notice" class="notice" :class="{ error: !noticeOk }" role="status">
        <span class="mdi" :class="noticeOk ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline'" />
        <span>{{ notice }}</span>
        <button type="button" aria-label="Đóng thông báo" @click="notice = ''">×</button>
      </div>
    </Transition>

    <section class="metrics" aria-label="Tổng quan Kho tri thức">
      <article><span class="metric-icon blue mdi mdi-database-outline" /><div><small>Nguồn kiến thức</small><strong>{{ sources.length }}</strong><em>{{ draftSourceCount }} nguồn đang Draft</em></div></article>
      <article><span class="metric-icon violet mdi mdi-file-document-multiple-outline" /><div><small>Tổng tài liệu</small><strong>{{ allDocuments.length }}</strong><em>{{ indexedCount }} đã được index</em></div></article>
      <article><span class="metric-icon amber mdi mdi-clipboard-clock-outline" /><div><small>Cần xử lý</small><strong>{{ attentionCount }}</strong><em>Chưa index hoặc chưa đạt</em></div></article>
      <article><span class="metric-icon green mdi mdi-check-decagram-outline" /><div><small>Đang được AI dùng</small><strong>{{ publishedCount }}</strong><em>{{ publishReadyCount }} sẵn sàng Publish</em></div></article>
    </section>

    <section class="lifecycle-card">
      <div class="lifecycle-copy"><span class="mdi mdi-sign-direction" /><div><strong>Quy trình xuất bản</strong><small>Mỗi tài liệu đi lần lượt qua ba cổng kiểm soát.</small></div></div>
      <div class="lifecycle-steps">
        <span><i>1</i><b>Index</b><small>Đọc và chia nội dung</small></span><em class="mdi mdi-chevron-right" />
        <span><i>2</i><b>Đánh giá</b><small>Kiểm tra bằng model</small></span><em class="mdi mdi-chevron-right" />
        <span><i>3</i><b>Publish</b><small>Cho phép AI truy xuất</small></span>
      </div>
    </section>

    <section class="toolbar">
      <label class="search-field">
        <span class="mdi mdi-magnify" />
        <input v-model.trim="sourceSearch" type="search" placeholder="Tìm theo tên hoặc loại nguồn…" />
        <button v-if="sourceSearch" type="button" aria-label="Xóa tìm kiếm" @click="sourceSearch = ''">×</button>
      </label>
      <label class="filter-field"><span>Trạng thái</span><select v-model="sourceFilter"><option value="all">Tất cả nguồn</option><option value="draft">Đang Draft</option><option value="published">Đã Publish</option><option value="attention">Cần xử lý</option></select></label>
      <span class="filter-count">{{ filteredSources.length }}/{{ sources.length }} nguồn</span>
    </section>

    <div class="workspace">
      <aside class="source-panel">
        <div class="panel-title"><div><strong>Danh sách nguồn</strong><small>Chọn một nguồn để xem tài liệu</small></div><span>{{ filteredSources.length }}</span></div>
        <div v-if="loading && !sources.length" class="source-skeleton"><i v-for="item in 5" :key="item" /></div>
        <div v-else-if="!filteredSources.length" class="compact-empty"><span class="mdi mdi-database-search-outline" /><strong>Không tìm thấy nguồn</strong><small>Thử thay đổi từ khóa hoặc bộ lọc.</small></div>
        <div v-else class="source-list">
          <button
            v-for="source in filteredSources"
            :key="source.id"
            type="button"
            class="source-item"
            :class="{ active: selectedSourceId === source.id }"
            @click="selectedSourceId = source.id"
          >
            <span class="source-icon mdi" :class="sourceIcon(source.type)" />
            <span class="source-copy">
              <strong>{{ source.name }}</strong>
              <small>{{ typeLabel(source.type) }} · {{ sourceDocumentCount(source.id) }} tài liệu</small>
              <span class="mini-progress"><i :style="{ width: sourceProgress(source.id) + '%' }" /></span>
            </span>
            <span class="source-side"><i class="status-dot" :class="source.status" /><small>{{ source.status === 'published' ? 'Live' : 'Draft' }}</small><em class="mdi mdi-chevron-right" /></span>
          </button>
        </div>
      </aside>

      <main class="detail-panel">
        <div v-if="!selected" class="detail-empty"><span class="mdi mdi-book-open-blank-variant-outline" /><h3>Chọn một nguồn kiến thức</h3><p>Thông tin nguồn, tài liệu và trạng thái xuất bản sẽ hiển thị tại đây.</p><button type="button" class="button primary" @click="showCreateSource = true">Tạo nguồn đầu tiên</button></div>
        <template v-else>
          <header class="source-header">
            <div class="source-identity">
              <span class="large-source-icon mdi" :class="sourceIcon(selected.type)" />
              <div>
                <div class="source-name-row"><h3>{{ selected.name }}</h3><span class="status-badge" :class="selected.status">{{ selected.status === 'published' ? 'Đã Publish' : 'Draft' }}</span></div>
                <p>{{ typeLabel(selected.type) }} · Phiên bản {{ selected.version }} · Cập nhật {{ formatDate(selected.updatedAt) }}</p>
              </div>
            </div>
            <button type="button" class="button primary compact" @click="showDocumentForm = !showDocumentForm"><span class="mdi" :class="showDocumentForm ? 'mdi-close' : 'mdi-file-plus-outline'" />{{ showDocumentForm ? 'Đóng' : 'Thêm tài liệu' }}</button>
          </header>

          <div v-if="isSampleSource" class="sample-warning"><span class="mdi mdi-flask-outline" /><div><strong>Đây là nguồn dữ liệu mẫu</strong><p>Hãy thay nội dung mô phỏng bằng dữ liệu doanh nghiệp đã xác nhận trước khi Publish.</p></div></div>

          <Transition name="form-slide">
            <form v-if="showDocumentForm" class="document-form" @submit.prevent="createDocument">
              <div class="form-heading"><div><h4>Thêm tài liệu mới</h4><p>Tài liệu sẽ được lưu ở Draft và index tự động.</p></div><span class="mdi mdi-file-document-plus-outline" /></div>
              <div class="form-row two"><label><span>Tiêu đề <b>*</b></span><input v-model.trim="documentForm.title" required maxlength="180" placeholder="Ví dụ: Chính sách bảo hành 2026" /></label><label><span>Tên file hoặc URL gốc</span><input v-model.trim="documentForm.fileName" maxlength="300" placeholder="Tùy chọn" /></label></div>
              <label><span>Loại nội dung</span><select v-model="documentForm.mimeType"><option value="text/plain">Nội dung văn bản</option><option value="application/pdf">PDF qua API/integration</option><option value="application/vnd.openxmlformats-officedocument.wordprocessingml.document">Word qua API/integration</option><option value="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">Excel qua API/integration</option></select></label>
              <label><span>Nội dung đã kiểm tra <b>*</b></span><textarea v-model="documentForm.content" required rows="9" placeholder="Dán nội dung chính xác cần cung cấp cho AI…" /><small>Không đưa API key, mật khẩu, token hoặc dữ liệu hội thoại riêng tư vào đây.</small></label>
              <div class="form-actions"><button type="button" class="button secondary" @click="resetDocumentForm">Hủy</button><button type="submit" class="button primary" :disabled="saving"><span class="mdi mdi-content-save-check-outline" />{{ saving ? 'Đang lưu…' : 'Lưu Draft & Index' }}</button></div>
            </form>
          </Transition>

          <section class="documents-section">
            <div class="section-heading"><div><h4>Tài liệu trong nguồn</h4><p>Theo dõi trạng thái và thực hiện bước tiếp theo cho từng tài liệu.</p></div><div class="document-summary"><span>{{ documents.length }} tài liệu</span><span>{{ selectedPublishedCount }} published</span></div></div>

            <div v-if="loading" class="document-skeleton"><i v-for="item in 3" :key="item" /></div>
            <div v-else-if="!documents.length" class="documents-empty"><span class="mdi mdi-file-document-plus-outline" /><h4>Chưa có tài liệu</h4><p>Thêm nội dung đầu tiên vào nguồn này để bắt đầu quy trình.</p><button type="button" class="button primary" @click="showDocumentForm = true">Thêm tài liệu</button></div>
            <div v-else class="document-list">
              <article v-for="document in documents" :key="document.id" class="document-card">
                <div class="document-main">
                  <span class="document-icon mdi mdi-file-document-outline" :class="documentState(document).tone" />
                  <div class="document-copy">
                    <div class="document-title-row"><h5>{{ document.title }}</h5><span class="document-state" :class="documentState(document).tone"><i class="mdi" :class="documentState(document).icon" />{{ documentState(document).label }}</span></div>
                    <p>Phiên bản {{ document.version }} · {{ document._count.chunks }} chunk · cập nhật {{ formatDate(document.updatedAt) }}</p>
                    <div class="document-flow" aria-label="Tiến độ tài liệu">
                      <span :class="stepClass(document, 'index')"><i class="mdi" :class="stepIcon(document, 'index')" />Index</span><em />
                      <span :class="stepClass(document, 'evaluation')"><i class="mdi" :class="stepIcon(document, 'evaluation')" />Đánh giá<small v-if="document.evaluation.score != null">{{ document.evaluation.score }}/100</small></span><em />
                      <span :class="stepClass(document, 'publish')"><i class="mdi" :class="stepIcon(document, 'publish')" />Publish</span>
                    </div>
                  </div>
                </div>
                <div class="document-actions">
                  <button type="button" class="button detail-action" :disabled="detailLoading && activeDetailDocument?.id === document.id" @click="openDocumentDetail(document)"><span class="mdi mdi-eye-outline" />Xem chi tiết</button>
                  <button v-if="document.lastIndexedAt" type="button" class="icon-button" title="Index lại tài liệu" :disabled="busyId === document.id" @click="reindex(document)"><span class="mdi mdi-database-refresh-outline" /></button>
                  <button type="button" class="button" :class="primaryAction(document).tone" :disabled="busyId === document.id" @click="runPrimaryAction(document)"><span class="mdi" :class="busyId === document.id ? 'mdi-loading spinning' : primaryAction(document).icon" />{{ busyId === document.id ? 'Đang xử lý…' : primaryAction(document).label }}</button>
                </div>
              </article>
            </div>
          </section>
        </template>
      </main>
    </div>

    <section class="retrieval-card">
      <header><div><span class="mdi mdi-text-search" /><div><h3>Kiểm tra Retrieval</h3><p>Xem AI có tìm đúng đoạn nội dung trước khi Publish hay không.</p></div></div><label class="draft-toggle"><input v-model="includeDraft" type="checkbox" /><span /><b>Bao gồm Draft</b></label></header>
      <div class="retrieval-search"><span class="mdi mdi-magnify" /><input v-model.trim="searchQuery" placeholder="Ví dụ: Chính sách bảo hành hiện tại là gì?" @keyup.enter="searchKnowledge" /><button type="button" class="button primary" :disabled="searchLoading || searchQuery.length < 2" @click="searchKnowledge">{{ searchLoading ? 'Đang tìm…' : 'Tìm kiếm' }}</button></div>
      <div v-if="results.length" class="retrieval-results"><article v-for="result in results" :key="result.citation.chunkId"><div><strong>{{ result.citation.documentTitle }}</strong><span>Điểm {{ result.score }}</span></div><small>{{ result.citation.sourceName }} · v{{ result.citation.documentVersion }}</small><p>{{ result.excerpt }}</p></article></div>
      <p v-else class="retrieval-empty"><span class="mdi mdi-information-outline" />Nhập một câu hỏi để kiểm tra nội dung mà AI sẽ truy xuất.</p>
    </section>

    <div v-if="showCreateSource" class="modal-backdrop" @click.self="showCreateSource = false">
      <form class="source-modal" @submit.prevent="createSource">
        <header><div><span class="mdi mdi-database-plus-outline" /><div><h3>Tạo nguồn kiến thức</h3><p>Nhóm các tài liệu cùng chủ đề và phạm vi sử dụng.</p></div></div><button type="button" aria-label="Đóng" @click="showCreateSource = false">×</button></header>
        <div class="modal-body">
          <label><span>Tên nguồn <b>*</b></span><input v-model.trim="sourceForm.name" required maxlength="160" placeholder="Ví dụ: Chính sách bán hàng 2026" /></label>
          <div class="form-row two"><label><span>Loại nguồn</span><select v-model="sourceForm.type"><option v-for="item in sourceTypes" :key="item" :value="item">{{ typeLabel(item) }}</option></select></label><label><span>Độ ưu tiên</span><input v-model.number="sourceForm.priority" type="number" min="-100" max="100" /></label></div>
          <label><span>Thẻ phân loại</span><input v-model.trim="sourceForm.tags" placeholder="Ví dụ: san-pham, 2026, noi-bo" /><small>Cách nhau bằng dấu phẩy.</small></label>
        </div>
        <footer><button type="button" class="button secondary" @click="showCreateSource = false">Hủy</button><button type="submit" class="button primary" :disabled="saving">{{ saving ? 'Đang tạo…' : 'Tạo nguồn Draft' }}</button></footer>
      </form>
    </div>

    <div v-if="activeDetailDocument" class="detail-drawer-backdrop" @click.self="closeDocumentDetail">
      <aside class="document-drawer" role="dialog" aria-modal="true" :aria-labelledby="`document-detail-${activeDetailDocument.id}`">
        <header class="drawer-header">
          <div class="drawer-heading">
            <span class="document-icon mdi mdi-file-document-outline" :class="documentState(activeDetailDocument).tone" />
            <div>
              <div class="drawer-title-row">
                <h3 :id="`document-detail-${activeDetailDocument.id}`">{{ activeDetailDocument.title }}</h3>
                <span class="document-state" :class="documentState(activeDetailDocument).tone"><i class="mdi" :class="documentState(activeDetailDocument).icon" />{{ documentState(activeDetailDocument).label }}</span>
              </div>
              <p>{{ activeDetailDocument.source.name }} · Phiên bản {{ activeDetailDocument.version }}</p>
            </div>
          </div>
          <button type="button" class="drawer-close" aria-label="Đóng chi tiết tài liệu" @click="closeDocumentDetail"><span class="mdi mdi-close" /></button>
        </header>

        <div class="drawer-body">
          <div v-if="detailLoading" class="detail-loading"><span class="mdi mdi-loading spinning" /><strong>Đang tải nội dung tài liệu…</strong></div>
          <div v-else-if="detailError" class="detail-error"><span class="mdi mdi-alert-circle-outline" /><strong>Không tải được chi tiết</strong><p>{{ detailError }}</p><button type="button" class="button secondary" @click="openDocumentDetail(activeDetailDocument)">Thử lại</button></div>
          <template v-else-if="documentDetail">
            <section class="detail-progress-card">
              <div><strong>Tiến trình tài liệu</strong><small>Mỗi bước hoàn tất mới cho phép AI sử dụng nội dung.</small></div>
              <div class="document-flow detail-flow" aria-label="Tiến độ tài liệu">
                <span :class="stepClass(activeDetailDocument, 'index')"><i class="mdi" :class="stepIcon(activeDetailDocument, 'index')" />Index</span><em />
                <span :class="stepClass(activeDetailDocument, 'evaluation')"><i class="mdi" :class="stepIcon(activeDetailDocument, 'evaluation')" />Đánh giá<small v-if="activeDetailDocument.evaluation.score != null">{{ activeDetailDocument.evaluation.score }}/100</small></span><em />
                <span :class="stepClass(activeDetailDocument, 'publish')"><i class="mdi" :class="stepIcon(activeDetailDocument, 'publish')" />Publish</span>
              </div>
            </section>

            <section class="detail-section">
              <div class="detail-section-title"><span class="mdi mdi-information-outline" /><h4>Thông tin tài liệu</h4></div>
              <div class="detail-metadata-grid">
                <article><small>Loại nội dung</small><strong>{{ mimeTypeLabel(documentDetail.mimeType) }}</strong></article>
                <article><small>Ngôn ngữ</small><strong>{{ documentDetail.language?.toUpperCase() || 'VI' }}</strong></article>
                <article><small>Số đoạn Index</small><strong>{{ documentDetail._count.chunks }} chunk</strong></article>
                <article><small>Ngày tạo</small><strong>{{ formatDate(documentDetail.createdAt) }}</strong></article>
                <article><small>Index gần nhất</small><strong>{{ formatDate(documentDetail.lastIndexedAt) }}</strong></article>
                <article><small>Người phê duyệt</small><strong>{{ documentDetail.approvedBy?.fullName || 'Chưa phê duyệt' }}</strong></article>
              </div>
              <div v-if="documentDetail.contentRef || documentDetail.tags.length" class="detail-reference-row">
                <span v-if="documentDetail.contentRef"><i class="mdi mdi-link-variant" />{{ documentDetail.contentRef }}</span>
                <span v-for="tag in documentDetail.tags" :key="tag"><i class="mdi mdi-tag-outline" />{{ tag }}</span>
              </div>
            </section>

            <section class="detail-section content-section">
              <div class="detail-section-title">
                <span class="mdi mdi-text-box-outline" />
                <div><h4>Nội dung đầy đủ</h4><small>{{ documentDetail.content.length.toLocaleString('vi-VN') }} ký tự</small></div>
                <button type="button" class="button secondary compact copy-button" @click="copyDocumentContent"><span class="mdi mdi-content-copy" />Sao chép</button>
              </div>
              <pre class="document-content">{{ documentDetail.content }}</pre>
            </section>
          </template>
        </div>

        <footer class="drawer-footer">
          <button type="button" class="button secondary" @click="closeDocumentDetail">Đóng</button>
          <button v-if="activeDetailDocument.status !== 'published'" type="button" class="button" :class="primaryAction(activeDetailDocument).tone" @click="runDetailPrimaryAction"><span class="mdi" :class="primaryAction(activeDetailDocument).icon" />{{ primaryAction(activeDetailDocument).label }}</button>
        </footer>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';

type EvaluationStatus = 'not_run' | 'failed' | 'stale' | 'passed';
type Source = {
  id: string; name: string; type: string; status: string; version: number;
  tags?: string[]; priority?: number; updatedAt: string; lastIndexedAt?: string | null;
  _count?: { documents: number };
};
type KnowledgeDocument = {
  id: string; sourceId: string; title: string; status: string; version: number;
  lastIndexedAt?: string | null; updatedAt: string; approvedAt?: string | null;
  _count: { chunks: number };
  evaluation: { status: EvaluationStatus; runId: string | null; score: number | null; completedAt: string | null };
  source: { id: string; name: string; type: string; status: string };
};
type KnowledgeDocumentDetail = {
  id: string; sourceId: string; externalId?: string | null; title: string; status: string;
  contentRef?: string | null; version: number; mimeType?: string | null; language?: string | null;
  effectiveFrom?: string | null; effectiveTo?: string | null; priority: number; tags: string[];
  lastIndexedAt?: string | null; approvedAt?: string | null; createdAt: string; updatedAt: string;
  content: string; _count: { chunks: number };
  source: { id: string; name: string; type: string; status: string };
  createdBy?: { id: string; fullName: string } | null;
  approvedBy?: { id: string; fullName: string } | null;
};
type RetrievalResult = {
  score: number; excerpt: string;
  citation: { chunkId: string; documentTitle: string; documentVersion: number; sourceName: string };
};

const router = useRouter();
const sources = ref<Source[]>([]);
const allDocuments = ref<KnowledgeDocument[]>([]);
const selectedSourceId = ref('');
const sourceSearch = ref('');
const sourceFilter = ref<'all' | 'draft' | 'published' | 'attention'>('all');
const loading = ref(false);
const saving = ref(false);
const busyId = ref('');
const showCreateSource = ref(false);
const showDocumentForm = ref(false);
const notice = ref('');
const noticeOk = ref(true);
const searchQuery = ref('');
const includeDraft = ref(true);
const searchLoading = ref(false);
const results = ref<RetrievalResult[]>([]);
const activeDetailDocument = ref<KnowledgeDocument | null>(null);
const documentDetail = ref<KnowledgeDocumentDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref('');
let noticeTimer: number | undefined;

const sourceTypes = ['product', 'price_list', 'policy', 'faq', 'website', 'article', 'pdf', 'word', 'excel', 'text', 'manual', 'consultation_script', 'complaint_process'];
const sourceForm = reactive({ name: '', type: 'manual', tags: '', priority: 0 });
const documentForm = reactive({ title: '', fileName: '', mimeType: 'text/plain', content: '' });

const selected = computed(() => sources.value.find((source) => source.id === selectedSourceId.value) ?? null);
const documents = computed(() => allDocuments.value.filter((document) => document.sourceId === selectedSourceId.value));
const publishedCount = computed(() => allDocuments.value.filter((document) => document.status === 'published').length);
const indexedCount = computed(() => allDocuments.value.filter((document) => document._count.chunks > 0 && document.lastIndexedAt).length);
const publishReadyCount = computed(() => allDocuments.value.filter((document) => document.status !== 'published' && document.evaluation.status === 'passed').length);
const attentionCount = computed(() => allDocuments.value.filter((document) => document.status !== 'published' && (document._count.chunks === 0 || document.evaluation.status !== 'passed')).length);
const draftSourceCount = computed(() => sources.value.filter((source) => source.status !== 'published').length);
const selectedPublishedCount = computed(() => documents.value.filter((document) => document.status === 'published').length);
const isSampleSource = computed(() => selected.value?.name.includes('[MẪU TEST]') ?? false);
const filteredSources = computed(() => {
  const query = sourceSearch.value.toLocaleLowerCase('vi');
  return sources.value.filter((source) => {
    const sourceDocuments = allDocuments.value.filter((document) => document.sourceId === source.id);
    const matchesQuery = !query || `${source.name} ${source.type} ${(source.tags ?? []).join(' ')}`.toLocaleLowerCase('vi').includes(query);
    const matchesStatus = sourceFilter.value === 'all'
      || (sourceFilter.value === 'draft' && source.status !== 'published')
      || (sourceFilter.value === 'published' && source.status === 'published')
      || (sourceFilter.value === 'attention' && sourceDocuments.some((document) => document.status !== 'published'));
    return matchesQuery && matchesStatus;
  });
});

const typeNames: Record<string, string> = {
  product: 'Sản phẩm & dịch vụ', price_list: 'Bảng giá', policy: 'Chính sách', faq: 'Câu hỏi thường gặp',
  website: 'Website', article: 'Bài viết', pdf: 'Tài liệu PDF', word: 'Tài liệu Word', excel: 'Bảng tính Excel',
  text: 'Văn bản', manual: 'Tài liệu thủ công', consultation_script: 'Kịch bản tư vấn', complaint_process: 'Quy trình khiếu nại',
};
const typeIcons: Record<string, string> = {
  product: 'mdi-package-variant-closed', price_list: 'mdi-tag-text-outline', policy: 'mdi-shield-check-outline', faq: 'mdi-frequently-asked-questions',
  website: 'mdi-web', article: 'mdi-newspaper-variant-outline', pdf: 'mdi-file-pdf-box', word: 'mdi-file-word-outline', excel: 'mdi-file-excel-outline',
  text: 'mdi-text-box-outline', manual: 'mdi-book-edit-outline', consultation_script: 'mdi-forum-outline', complaint_process: 'mdi-account-alert-outline',
};

function typeLabel(type: string) { return typeNames[type] ?? type; }
function sourceIcon(type: string) { return typeIcons[type] ?? 'mdi-database-outline'; }
function sourceDocumentCount(sourceId: string) { return allDocuments.value.filter((document) => document.sourceId === sourceId).length; }
function sourceProgress(sourceId: string) {
  const list = allDocuments.value.filter((document) => document.sourceId === sourceId);
  if (!list.length) return 0;
  return Math.round(list.filter((document) => document.status === 'published').length / list.length * 100);
}
function formatDate(value?: string | null) {
  if (!value) return 'chưa có';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
function mimeTypeLabel(mimeType?: string | null) {
  if (!mimeType || mimeType === 'text/plain') return 'Văn bản';
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.includes('word')) return 'Word';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'Excel';
  return mimeType;
}
function errorText(error: any, fallback = 'Có lỗi xảy ra') { return error?.response?.data?.error || error?.message || fallback; }
function showNotice(message: string, success = true) {
  window.clearTimeout(noticeTimer);
  notice.value = message; noticeOk.value = success;
  noticeTimer = window.setTimeout(() => { if (notice.value === message) notice.value = ''; }, 6500);
}

function documentState(document: KnowledgeDocument) {
  if (document.status === 'published') return { label: 'Đang sử dụng', tone: 'published', icon: 'mdi-check-decagram-outline' };
  if (!document.lastIndexedAt || !document._count.chunks) return { label: 'Chưa index', tone: 'blocked', icon: 'mdi-database-alert-outline' };
  if (document.evaluation.status === 'failed') return { label: 'Đánh giá chưa đạt', tone: 'failed', icon: 'mdi-close-circle-outline' };
  if (document.evaluation.status === 'stale') return { label: 'Cần đánh giá lại', tone: 'warning', icon: 'mdi-clock-alert-outline' };
  if (document.evaluation.status === 'passed') return { label: 'Sẵn sàng Publish', tone: 'ready', icon: 'mdi-check-circle-outline' };
  return { label: 'Chờ đánh giá', tone: 'waiting', icon: 'mdi-clipboard-clock-outline' };
}
function stepClass(document: KnowledgeDocument, step: 'index' | 'evaluation' | 'publish') {
  const indexed = Boolean(document.lastIndexedAt && document._count.chunks);
  const evaluated = document.evaluation.status === 'passed';
  const published = document.status === 'published';
  if ((step === 'index' && indexed) || (step === 'evaluation' && evaluated) || (step === 'publish' && published)) return 'complete';
  if ((step === 'index' && !indexed) || (step === 'evaluation' && indexed && !evaluated) || (step === 'publish' && evaluated && !published)) return 'active';
  return 'blocked';
}
function stepIcon(document: KnowledgeDocument, step: 'index' | 'evaluation' | 'publish') {
  const state = stepClass(document, step);
  return state === 'complete' ? 'mdi-check-circle' : state === 'active' ? 'mdi-circle-slice-8' : 'mdi-circle-outline';
}
function primaryAction(document: KnowledgeDocument) {
  if (document.status === 'published') return { label: 'Đã Publish', tone: 'action-complete', icon: 'mdi-check' };
  if (!document.lastIndexedAt || !document._count.chunks) return { label: 'Index ngay', tone: 'action-index', icon: 'mdi-database-arrow-up-outline' };
  if (document.evaluation.status !== 'passed') return { label: document.evaluation.status === 'stale' ? 'Đánh giá lại' : 'Đánh giá', tone: 'action-evaluate', icon: 'mdi-clipboard-check-outline' };
  return { label: 'Duyệt Publish', tone: 'action-publish', icon: 'mdi-publish' };
}

async function loadAll() {
  if (loading.value) return;
  loading.value = true;
  try {
    const [sourceResponse, documentResponse] = await Promise.all([
      api.get<{ sources: Source[] }>('/ai/knowledge/sources'),
      api.get<{ documents: KnowledgeDocument[] }>('/ai/knowledge/documents'),
    ]);
    sources.value = sourceResponse.data.sources;
    allDocuments.value = documentResponse.data.documents;
    if (activeDetailDocument.value) activeDetailDocument.value = allDocuments.value.find((document) => document.id === activeDetailDocument.value?.id) ?? null;
    if (!sources.value.some((source) => source.id === selectedSourceId.value)) selectedSourceId.value = sources.value[0]?.id ?? '';
  } catch (error) { showNotice(errorText(error, 'Không tải được Kho tri thức'), false); }
  finally { loading.value = false; }
}
async function createSource() {
  if (saving.value) return;
  saving.value = true;
  try {
    const response = await api.post<Source>('/ai/knowledge/sources', { ...sourceForm, tags: sourceForm.tags.split(',').map((item) => item.trim()).filter(Boolean) });
    selectedSourceId.value = response.data.id;
    Object.assign(sourceForm, { name: '', type: 'manual', tags: '', priority: 0 });
    showCreateSource.value = false;
    await loadAll();
    selectedSourceId.value = response.data.id;
    showNotice('Đã tạo nguồn kiến thức ở trạng thái Draft.');
  } catch (error) { showNotice(errorText(error), false); }
  finally { saving.value = false; }
}
function resetDocumentForm() {
  Object.assign(documentForm, { title: '', fileName: '', mimeType: 'text/plain', content: '' });
  showDocumentForm.value = false;
}
async function createDocument() {
  if (!selected.value || saving.value) return;
  saving.value = true;
  let createdId = '';
  try {
    const response = await api.post<{ id: string }>(`/ai/knowledge/sources/${selected.value.id}/documents`, documentForm);
    createdId = response.data.id;
    await api.post(`/ai/knowledge/documents/${createdId}/reindex`);
    resetDocumentForm();
    showNotice('Đã lưu Draft và index tài liệu. Bước tiếp theo là chạy Đánh giá.');
  } catch (error) {
    showNotice(createdId ? `Đã lưu Draft nhưng index chưa thành công: ${errorText(error)}` : errorText(error), false);
  } finally {
    saving.value = false;
    await loadAll();
  }
}
async function reindex(document: KnowledgeDocument) {
  if (busyId.value) return;
  const warning = document.status === 'published'
    ? 'Index lại sẽ đưa tài liệu đang Publish về Draft và yêu cầu đánh giá lại. Tiếp tục?'
    : document.evaluation.status === 'passed'
      ? 'Index lại sẽ làm evaluation hiện tại hết hiệu lực. Tiếp tục?'
      : 'Index lại tài liệu này?';
  if (!window.confirm(warning)) return;
  busyId.value = document.id;
  try {
    const response = await api.post<{ chunkCount: number }>(`/ai/knowledge/documents/${document.id}/reindex`);
    showNotice(`Đã index ${response.data.chunkCount} chunk. Hãy chạy Đánh giá trước khi Publish.`);
    await loadAll();
  } catch (error) { showNotice(errorText(error), false); }
  finally { busyId.value = ''; }
}
function evaluate(document: KnowledgeDocument) {
  void router.push({ path: '/settings/crm/ai-assistant/evaluations', query: { targetType: 'knowledge', targetId: document.id } });
}
async function publishDocument(document: KnowledgeDocument) {
  if (busyId.value || !window.confirm(`Publish “${document.title}” để AI bắt đầu sử dụng?`)) return;
  busyId.value = document.id;
  try {
    await api.post(`/ai/knowledge/documents/${document.id}/publish`);
    showNotice('Đã Publish tài liệu. AI có thể truy xuất nội dung còn hiệu lực.');
    await loadAll();
  } catch (error: any) {
    const code = error?.response?.data?.code;
    if (code === 'KNOWLEDGE_EVALUATION_REQUIRED') showNotice('Tài liệu chưa đạt evaluation. Hãy bấm Đánh giá trước.', false);
    else if (code === 'KNOWLEDGE_EVALUATION_STALE') showNotice('Evaluation đã cũ do tài liệu thay đổi. Hãy Đánh giá lại.', false);
    else showNotice(errorText(error), false);
  } finally { busyId.value = ''; }
}
function runPrimaryAction(document: KnowledgeDocument) {
  if (document.status === 'published') return;
  if (!document.lastIndexedAt || !document._count.chunks) void reindex(document);
  else if (document.evaluation.status !== 'passed') evaluate(document);
  else void publishDocument(document);
}
async function openDocumentDetail(document: KnowledgeDocument) {
  activeDetailDocument.value = document;
  documentDetail.value = null;
  detailError.value = '';
  detailLoading.value = true;
  try {
    const response = await api.get<KnowledgeDocumentDetail>(`/ai/knowledge/documents/${document.id}`);
    if (activeDetailDocument.value?.id === document.id) documentDetail.value = response.data;
  } catch (error) {
    if (activeDetailDocument.value?.id === document.id) detailError.value = errorText(error, 'Không đọc được nội dung tài liệu');
  } finally {
    if (activeDetailDocument.value?.id === document.id) detailLoading.value = false;
  }
}
function closeDocumentDetail() {
  activeDetailDocument.value = null;
  documentDetail.value = null;
  detailError.value = '';
  detailLoading.value = false;
}
async function copyDocumentContent() {
  if (!documentDetail.value?.content) return;
  try {
    await navigator.clipboard.writeText(documentDetail.value.content);
    showNotice('Đã sao chép nội dung tài liệu.');
  } catch { showNotice('Trình duyệt không cho phép sao chép tự động.', false); }
}
function runDetailPrimaryAction() {
  const document = activeDetailDocument.value;
  if (!document || document.status === 'published') return;
  closeDocumentDetail();
  runPrimaryAction(document);
}
function handleDetailKeydown(event: KeyboardEvent) { if (event.key === 'Escape' && activeDetailDocument.value) closeDocumentDetail(); }
async function searchKnowledge() {
  if (searchLoading.value || searchQuery.value.length < 2) return;
  searchLoading.value = true;
  try {
    const response = await api.post<{ results: RetrievalResult[] }>('/ai/knowledge/search/test', { query: searchQuery.value, includeDraft: includeDraft.value });
    results.value = response.data.results;
    if (!results.value.length) showNotice('Không tìm thấy đoạn nội dung phù hợp với câu hỏi này.', false);
  } catch (error) { showNotice(errorText(error), false); }
  finally { searchLoading.value = false; }
}

onMounted(() => {
  window.addEventListener('keydown', handleDetailKeydown);
  void loadAll();
});
onBeforeUnmount(() => {
  window.clearTimeout(noticeTimer);
  window.removeEventListener('keydown', handleDetailKeydown);
});
</script>

<style scoped>
.kb-shell{--kb-ink:#172033;--kb-muted:#64748b;--kb-line:#dbe4f0;--kb-blue:#2563eb;display:grid;gap:12px;color:#334155}.kb-header{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:17px 18px;border:1px solid var(--kb-line);border-radius:13px;background:#fff}.kb-heading{display:flex;align-items:center;gap:12px;min-width:0}.heading-icon{display:grid;flex:0 0 42px;width:42px;height:42px;place-items:center;border-radius:12px;background:linear-gradient(145deg,#eff6ff,#dbeafe);color:#1d4ed8;font-size:22px}.heading-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.heading-title h2{margin:0;color:var(--kb-ink);font-size:18px}.heading-title span{padding:3px 6px;border-radius:5px;background:#f1f5f9;color:#64748b;font:9px Consolas,monospace}.kb-heading p{margin:3px 0 0;color:var(--kb-muted);font-size:11px;line-height:1.45}.header-actions,.form-actions,.document-actions{display:flex;align-items:center;gap:7px}.button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:7px 11px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#475569;font:650 11px inherit;cursor:pointer;white-space:nowrap}.button:hover:not(:disabled){border-color:#94a3b8;background:#f8fafc}.button.primary{border-color:var(--kb-blue);background:var(--kb-blue);color:#fff}.button.secondary{background:#fff}.button.compact{min-height:32px;padding:6px 9px}.button:disabled{cursor:not-allowed;opacity:.55}.spinning{animation:spin .8s linear infinite}.notice{display:flex;align-items:center;gap:7px;padding:10px 12px;border:1px solid #bbf7d0;border-radius:9px;background:#f0fdf4;color:#166534;font-size:11px}.notice.error{border-color:#fecaca;background:#fff1f2;color:#991b1b}.notice>button{margin-left:auto;border:0;background:transparent;color:inherit;font-size:17px;cursor:pointer}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.metrics article{display:flex;align-items:center;gap:11px;min-height:76px;padding:12px 13px;border:1px solid var(--kb-line);border-radius:11px;background:#fff}.metric-icon{display:grid;flex:0 0 38px;width:38px;height:38px;place-items:center;border-radius:10px;font-size:19px}.metric-icon.blue{background:#eff6ff;color:#2563eb}.metric-icon.violet{background:#f5f3ff;color:#7c3aed}.metric-icon.amber{background:#fffbeb;color:#d97706}.metric-icon.green{background:#f0fdf4;color:#16a34a}.metrics small,.metrics em{display:block;color:#64748b;font-size:10px;font-style:normal}.metrics strong{display:block;margin:2px 0;color:#0f172a;font-size:20px;line-height:1}.metrics em{color:#94a3b8;font-size:9px}.lifecycle-card{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:10px 14px;border:1px solid #c7d2fe;border-radius:10px;background:linear-gradient(90deg,#f8faff,#f5f3ff)}.lifecycle-copy{display:flex;align-items:center;gap:8px;min-width:190px}.lifecycle-copy>.mdi{color:#4f46e5;font-size:21px}.lifecycle-copy strong,.lifecycle-copy small{display:block}.lifecycle-copy strong{color:#3730a3;font-size:11px}.lifecycle-copy small{margin-top:2px;color:#64748b;font-size:9px}.lifecycle-steps{display:flex;align-items:center;justify-content:flex-end;gap:8px}.lifecycle-steps>span{display:grid;grid-template-columns:24px auto;column-gap:6px;align-items:center}.lifecycle-steps i{grid-row:1/3;display:grid;width:22px;height:22px;place-items:center;border-radius:50%;background:#e0e7ff;color:#4338ca;font-size:9px;font-style:normal;font-weight:800}.lifecycle-steps b{color:#334155;font-size:10px}.lifecycle-steps small{color:#94a3b8;font-size:8px}.lifecycle-steps>em{color:#a5b4fc;font-size:16px}.toolbar{display:flex;align-items:center;gap:9px;padding:9px;border:1px solid var(--kb-line);border-radius:10px;background:#fff}.search-field{display:flex;align-items:center;flex:1;gap:7px;min-width:200px;padding:0 9px;border:1px solid #cbd5e1;border-radius:7px}.search-field>.mdi{color:#94a3b8}.search-field input{flex:1;min-width:0;height:34px;border:0;outline:0;color:#334155;font:11px inherit}.search-field button{border:0;background:transparent;color:#94a3b8;cursor:pointer}.filter-field{display:flex;align-items:center;gap:7px}.filter-field span,.filter-count{color:#64748b;font-size:9px;font-weight:700;text-transform:uppercase}.filter-field select{min-height:34px;padding:6px 28px 6px 8px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#475569;font:11px inherit}.filter-count{margin-left:auto;padding-right:4px;color:#94a3b8}.workspace{display:grid;grid-template-columns:300px minmax(0,1fr);min-height:590px;overflow:hidden;border:1px solid var(--kb-line);border-radius:12px;background:#fff}.source-panel{min-width:0;border-right:1px solid var(--kb-line);background:#f8fafc}.panel-title{display:flex;align-items:center;justify-content:space-between;padding:13px 12px;border-bottom:1px solid var(--kb-line);background:#fff}.panel-title strong,.panel-title small{display:block}.panel-title strong{color:#334155;font-size:11px}.panel-title small{margin-top:2px;color:#94a3b8;font-size:9px}.panel-title>span{display:grid;min-width:23px;height:23px;place-items:center;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:9px;font-weight:800}.source-list{max-height:690px;padding:7px;overflow:auto}.source-item{display:grid;width:100%;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:8px;margin-bottom:4px;padding:9px;border:1px solid transparent;border-radius:9px;background:transparent;text-align:left;cursor:pointer}.source-item:hover{background:#fff}.source-item.active{border-color:#bfdbfe;background:#eff6ff;box-shadow:0 1px 2px rgba(37,99,235,.06)}.source-icon{display:grid;width:32px;height:32px;place-items:center;border-radius:8px;background:#fff;color:#64748b;font-size:16px;box-shadow:0 0 0 1px #e2e8f0}.source-item.active .source-icon{background:#dbeafe;color:#1d4ed8;box-shadow:none}.source-copy{min-width:0}.source-copy strong,.source-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-copy strong{color:#334155;font-size:10px}.source-copy small{margin:2px 0 5px;color:#94a3b8;font-size:8px}.mini-progress{display:block;height:3px;overflow:hidden;border-radius:99px;background:#e2e8f0}.mini-progress i{display:block;height:100%;border-radius:inherit;background:#22c55e}.source-side{display:grid;grid-template-columns:6px auto 12px;align-items:center;gap:4px}.source-side small{color:#94a3b8;font-size:7px;text-transform:uppercase}.source-side em{color:#94a3b8;font-size:12px}.status-dot{width:6px;height:6px;border-radius:50%;background:#f59e0b}.status-dot.published{background:#22c55e}.source-skeleton{display:grid;gap:8px;padding:12px}.source-skeleton i,.document-skeleton i{display:block;border-radius:8px;background:linear-gradient(90deg,#e2e8f0,#f1f5f9,#e2e8f0);background-size:200% 100%;animation:shimmer 1.2s infinite}.source-skeleton i{height:52px}.compact-empty,.detail-empty,.documents-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;color:#94a3b8;text-align:center}.compact-empty{min-height:280px;padding:20px}.compact-empty>.mdi{font-size:28px}.compact-empty strong{margin-top:8px;color:#64748b;font-size:11px}.compact-empty small{margin-top:3px;font-size:9px}.detail-panel{min-width:0;background:#fff}.detail-empty{min-height:550px;padding:30px}.detail-empty>.mdi{font-size:48px;color:#cbd5e1}.detail-empty h3{margin:12px 0 4px;color:#475569;font-size:15px}.detail-empty p{max-width:420px;margin:0 0 15px;font-size:11px}.source-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 17px;border-bottom:1px solid var(--kb-line)}.source-identity{display:flex;align-items:center;gap:10px;min-width:0}.large-source-icon{display:grid;flex:0 0 40px;width:40px;height:40px;place-items:center;border-radius:10px;background:#f1f5f9;color:#475569;font-size:20px}.source-name-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.source-name-row h3{margin:0;color:var(--kb-ink);font-size:15px}.source-identity p{margin:3px 0 0;color:#94a3b8;font-size:9px}.status-badge,.document-state{display:inline-flex;align-items:center;gap:3px;border-radius:999px;font-size:8px;font-weight:750}.status-badge{padding:3px 7px;background:#fef3c7;color:#92400e}.status-badge.published{background:#dcfce7;color:#166534}.sample-warning{display:flex;align-items:flex-start;gap:9px;margin:12px 14px 0;padding:9px 10px;border:1px solid #fde68a;border-radius:8px;background:#fffbeb;color:#92400e}.sample-warning>.mdi{font-size:17px}.sample-warning strong{font-size:10px}.sample-warning p{margin:2px 0 0;font-size:9px;line-height:1.45}.document-form{display:grid;gap:10px;margin:12px 14px 0;padding:14px;border:1px solid #bfdbfe;border-radius:10px;background:#f8fbff}.form-heading{display:flex;align-items:flex-start;justify-content:space-between}.form-heading h4{margin:0;color:#1e3a8a;font-size:12px}.form-heading p{margin:2px 0 0;color:#64748b;font-size:9px}.form-heading>.mdi{color:#3b82f6;font-size:22px}.document-form label,.modal-body label{display:flex;flex-direction:column;gap:4px;color:#475569;font-size:9px;font-weight:700}.document-form label>b,.document-form label span b,.modal-body label span b{color:#dc2626}.document-form input,.document-form select,.document-form textarea,.modal-body input,.modal-body select{box-sizing:border-box;width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#334155;font:11px inherit;outline:0}.document-form textarea{resize:vertical;font-family:Consolas,monospace;line-height:1.5}.document-form input:focus,.document-form select:focus,.document-form textarea:focus,.modal-body input:focus,.modal-body select:focus{border-color:#60a5fa;box-shadow:0 0 0 3px #dbeafe}.document-form label>small,.modal-body label>small{color:#94a3b8;font-size:8px;font-weight:400}.form-row{display:grid;gap:9px}.form-row.two{grid-template-columns:1fr 1fr}.form-actions{justify-content:flex-end}.documents-section{padding:15px 14px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.section-heading h4{margin:0;color:#334155;font-size:12px}.section-heading p{margin:2px 0 0;color:#94a3b8;font-size:9px}.document-summary{display:flex;gap:5px}.document-summary span{padding:3px 6px;border-radius:5px;background:#f1f5f9;color:#64748b;font-size:8px}.documents-empty{min-height:300px;border:1px dashed #cbd5e1;border-radius:9px;background:#fafcff}.documents-empty>.mdi{font-size:34px}.documents-empty h4{margin:9px 0 3px;color:#64748b;font-size:12px}.documents-empty p{margin:0 0 12px;font-size:9px}.document-list{display:grid;gap:8px}.document-card{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;transition:border-color .15s,box-shadow .15s}.document-card:hover{border-color:#cbd5e1;box-shadow:0 3px 10px rgba(15,23,42,.04)}.document-main{display:flex;align-items:flex-start;gap:10px;min-width:0}.document-icon{display:grid;flex:0 0 36px;width:36px;height:36px;place-items:center;border-radius:9px;background:#f1f5f9;color:#64748b;font-size:18px}.document-icon.published{background:#dcfce7;color:#16a34a}.document-icon.ready{background:#dbeafe;color:#2563eb}.document-icon.failed{background:#fee2e2;color:#dc2626}.document-icon.warning,.document-icon.waiting{background:#fef3c7;color:#d97706}.document-copy{min-width:0}.document-title-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.document-title-row h5{max-width:560px;margin:0;overflow:hidden;color:#334155;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.document-state{padding:3px 6px}.document-state.published{background:#dcfce7;color:#166534}.document-state.ready{background:#dbeafe;color:#1d4ed8}.document-state.failed{background:#fee2e2;color:#991b1b}.document-state.warning,.document-state.waiting{background:#fef3c7;color:#92400e}.document-state.blocked{background:#f1f5f9;color:#64748b}.document-copy>p{margin:3px 0 8px;color:#94a3b8;font-size:8px}.document-flow{display:flex;align-items:center;gap:5px}.document-flow>span{display:inline-flex;align-items:center;gap:3px;color:#94a3b8;font-size:8px}.document-flow>span small{padding-left:2px;font-size:7px}.document-flow>span.complete{color:#16a34a}.document-flow>span.active{color:#2563eb;font-weight:700}.document-flow>em{width:20px;height:1px;background:#e2e8f0}.icon-button{display:grid;flex:0 0 33px;width:33px;height:33px;place-items:center;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#64748b;cursor:pointer}.icon-button:hover{background:#f8fafc;color:#334155}.action-index{border-color:#cbd5e1;background:#f8fafc;color:#475569}.action-evaluate{border-color:#c4b5fd;background:#f5f3ff;color:#6d28d9}.action-publish{border-color:#86efac;background:#f0fdf4;color:#15803d}.action-complete{border-color:#bbf7d0;background:#f0fdf4;color:#166534;cursor:default}.document-skeleton{display:grid;gap:8px}.document-skeleton i{height:82px}.retrieval-card{overflow:hidden;border:1px solid var(--kb-line);border-radius:11px;background:#fff}.retrieval-card>header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid var(--kb-line)}.retrieval-card>header>div{display:flex;align-items:center;gap:8px}.retrieval-card>header .mdi{color:#7c3aed;font-size:20px}.retrieval-card h3{margin:0;color:#334155;font-size:12px}.retrieval-card header p{margin:2px 0 0;color:#94a3b8;font-size:9px}.draft-toggle{display:flex;align-items:center;gap:6px;cursor:pointer}.draft-toggle input{display:none}.draft-toggle>span{position:relative;width:27px;height:15px;border-radius:999px;background:#cbd5e1}.draft-toggle>span:after{position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;background:#fff;content:'';transition:left .15s}.draft-toggle input:checked+span{background:#7c3aed}.draft-toggle input:checked+span:after{left:14px}.draft-toggle b{color:#64748b;font-size:9px}.retrieval-search{display:flex;align-items:center;gap:7px;margin:12px 14px;padding-left:9px;border:1px solid #cbd5e1;border-radius:8px}.retrieval-search>.mdi{color:#94a3b8}.retrieval-search input{flex:1;min-width:0;height:37px;border:0;outline:0;font:11px inherit}.retrieval-search .button{margin-right:3px;min-height:31px}.retrieval-results{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:0 14px 14px}.retrieval-results article{padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#fafcff}.retrieval-results article>div{display:flex;align-items:center;justify-content:space-between;gap:8px}.retrieval-results strong{color:#334155;font-size:10px}.retrieval-results article>div span{padding:2px 5px;border-radius:4px;background:#ede9fe;color:#6d28d9;font-size:8px}.retrieval-results small{display:block;margin-top:2px;color:#94a3b8;font-size:8px}.retrieval-results p{margin:7px 0 0;color:#475569;font-size:9px;line-height:1.55}.retrieval-empty{display:flex;align-items:center;gap:5px;margin:0;padding:0 14px 13px;color:#94a3b8;font-size:9px}.modal-backdrop{position:fixed;z-index:2500;inset:0;display:grid;padding:20px;place-items:center;background:rgba(15,23,42,.42);backdrop-filter:blur(2px)}.source-modal{width:min(520px,100%);overflow:hidden;border-radius:13px;background:#fff;box-shadow:0 24px 60px rgba(15,23,42,.22)}.source-modal>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:15px 16px;border-bottom:1px solid #e2e8f0}.source-modal>header>div{display:flex;gap:9px}.source-modal>header .mdi{display:grid;width:34px;height:34px;place-items:center;border-radius:9px;background:#eff6ff;color:#2563eb;font-size:18px}.source-modal h3{margin:0;color:#172033;font-size:14px}.source-modal header p{margin:2px 0 0;color:#64748b;font-size:9px}.source-modal header>button{border:0;background:transparent;color:#94a3b8;font-size:20px;cursor:pointer}.modal-body{display:grid;gap:11px;padding:16px}.source-modal>footer{display:flex;justify-content:flex-end;gap:7px;padding:11px 16px;border-top:1px solid #e2e8f0;background:#f8fafc}.notice-enter-active,.notice-leave-active,.form-slide-enter-active,.form-slide-leave-active{transition:opacity .18s,transform .18s}.notice-enter-from,.notice-leave-to{opacity:0;transform:translateY(-5px)}.form-slide-enter-from,.form-slide-leave-to{opacity:0;transform:translateY(-5px)}@keyframes spin{to{transform:rotate(360deg)}}@keyframes shimmer{to{background-position:-200% 0}}
/* Readability scale: keep operational data compact without dropping below a comfortable UI size. */
.heading-title h2{font-size:21px}.heading-title span{font-size:11px}.kb-heading p{font-size:13px;line-height:1.55}.button{min-height:38px;font-size:13px}.button.compact{min-height:36px;font-size:12px}.metrics small{font-size:12px}.metrics strong{font-size:23px}.metrics em{font-size:11px}.lifecycle-copy strong{font-size:13px}.lifecycle-copy small{font-size:11px}.lifecycle-steps b{font-size:12px}.lifecycle-steps small{font-size:10px}.search-field input,.filter-field select{font-size:13px}.filter-field span,.filter-count{font-size:11px}.panel-title strong{font-size:13px}.panel-title small{font-size:11px}.panel-title>span{font-size:11px}.source-copy strong{font-size:12px}.source-copy small{font-size:10px}.source-side small{font-size:9px}.detail-empty h3{font-size:17px}.detail-empty p{font-size:13px;line-height:1.55}.source-name-row h3{font-size:17px}.source-identity p{font-size:11px}.status-badge,.document-state{font-size:10px}.sample-warning strong{font-size:12px}.sample-warning p{font-size:11px;line-height:1.55}.form-heading h4{font-size:14px}.form-heading p{font-size:11px}.document-form label,.modal-body label{font-size:12px}.document-form input,.document-form select,.document-form textarea,.modal-body input,.modal-body select{font-size:13px}.document-form label>small,.modal-body label>small{font-size:10px;line-height:1.5}.section-heading h4{font-size:14px}.section-heading p{font-size:11px}.document-summary span{font-size:10px}.documents-empty h4{font-size:14px}.documents-empty p{font-size:11px}.document-title-row h5{font-size:14px;line-height:1.4}.document-copy>p{font-size:11px}.document-flow>span{font-size:10px}.document-flow>span small{font-size:9px}.retrieval-card h3{font-size:14px}.retrieval-card header p{font-size:11px}.draft-toggle b{font-size:11px}.retrieval-search input{font-size:13px}.retrieval-results strong{font-size:12px}.retrieval-results small{font-size:10px}.retrieval-results p,.retrieval-empty{font-size:11px;line-height:1.55}.source-modal h3{font-size:16px}.source-modal header p{font-size:11px}
.detail-action{border-color:#bfdbfe;background:#eff6ff;color:#1d4ed8}.detail-drawer-backdrop{position:fixed;z-index:2600;inset:0;display:flex;justify-content:flex-end;background:rgba(15,23,42,.46);backdrop-filter:blur(2px)}.document-drawer{display:flex;width:min(760px,100%);height:100%;flex-direction:column;background:#f8fafc;box-shadow:-18px 0 50px rgba(15,23,42,.18);animation:drawer-in .2s ease-out}.drawer-header{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:18px 20px;border-bottom:1px solid #dbe4f0;background:#fff}.drawer-heading{display:flex;align-items:flex-start;gap:11px;min-width:0}.drawer-heading>.document-icon{margin-top:1px}.drawer-heading>div{min-width:0}.drawer-title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.drawer-title-row h3{max-width:560px;margin:0;overflow-wrap:anywhere;color:#172033;font-size:19px;line-height:1.4}.drawer-heading p{margin:5px 0 0;color:#64748b;font-size:12px}.drawer-close{display:grid;flex:0 0 38px;width:38px;height:38px;place-items:center;border:1px solid #dbe4f0;border-radius:8px;background:#fff;color:#64748b;font-size:20px;cursor:pointer}.drawer-close:hover{background:#f1f5f9;color:#172033}.drawer-body{display:grid;align-content:start;flex:1;gap:14px;min-height:0;padding:16px;overflow:auto}.detail-loading,.detail-error{display:flex;min-height:360px;flex-direction:column;align-items:center;justify-content:center;padding:30px;color:#64748b;text-align:center}.detail-loading>.mdi,.detail-error>.mdi{margin-bottom:10px;color:#2563eb;font-size:34px}.detail-loading strong,.detail-error strong{font-size:14px}.detail-error>.mdi{color:#dc2626}.detail-error p{max-width:460px;margin:6px 0 14px;color:#64748b;font-size:12px;line-height:1.55}.detail-progress-card{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 15px;border:1px solid #c7d2fe;border-radius:10px;background:linear-gradient(90deg,#f8faff,#f5f3ff)}.detail-progress-card>div:first-child strong,.detail-progress-card>div:first-child small{display:block}.detail-progress-card>div:first-child strong{color:#3730a3;font-size:13px}.detail-progress-card>div:first-child small{margin-top:3px;color:#64748b;font-size:11px}.detail-flow{justify-content:flex-end;white-space:nowrap}.detail-flow>span{font-size:12px}.detail-flow>span small{font-size:10px}.detail-section{padding:16px;border:1px solid #dbe4f0;border-radius:10px;background:#fff}.detail-section-title{display:flex;align-items:center;gap:8px;margin-bottom:13px}.detail-section-title>.mdi{color:#2563eb;font-size:20px}.detail-section-title h4{margin:0;color:#334155;font-size:14px}.detail-section-title small{display:block;margin-top:2px;color:#64748b;font-size:11px}.detail-metadata-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.detail-metadata-grid article{min-width:0;padding:11px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc}.detail-metadata-grid small,.detail-metadata-grid strong{display:block}.detail-metadata-grid small{margin-bottom:4px;color:#64748b;font-size:11px}.detail-metadata-grid strong{overflow:hidden;color:#27364d;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.detail-reference-row{display:flex;gap:7px;margin-top:10px;flex-wrap:wrap}.detail-reference-row>span{display:inline-flex;max-width:100%;align-items:center;gap:4px;padding:5px 8px;border-radius:6px;background:#f1f5f9;color:#526177;font-size:11px;overflow-wrap:anywhere}.content-section{min-height:300px}.content-section .detail-section-title{margin-bottom:11px}.copy-button{margin-left:auto}.document-content{box-sizing:border-box;max-height:52vh;margin:0;overflow:auto;padding:18px;border:1px solid #d5dfec;border-radius:9px;background:#fbfdff;color:#243247;font:14px/1.75 Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;letter-spacing:.01em;overflow-wrap:anywhere;white-space:pre-wrap}.drawer-footer{display:flex;justify-content:flex-end;gap:8px;padding:13px 16px;border-top:1px solid #dbe4f0;background:#fff}@keyframes drawer-in{from{transform:translateX(32px);opacity:.7}to{transform:translateX(0);opacity:1}}
@media(max-width:1100px){.metrics{grid-template-columns:repeat(2,1fr)}.workspace{grid-template-columns:260px minmax(0,1fr)}.lifecycle-card{align-items:flex-start;flex-direction:column}.lifecycle-steps{width:100%;justify-content:flex-start}.document-card{align-items:flex-start;flex-direction:column}.document-actions{align-self:flex-end}}
@media(max-width:760px){.kb-header{align-items:flex-start;flex-direction:column}.header-actions{width:100%}.header-actions .button{flex:1}.metrics{grid-template-columns:1fr 1fr}.metrics article{padding:10px}.metric-icon{display:none}.lifecycle-steps{align-items:flex-start}.lifecycle-steps>span{grid-template-columns:22px auto}.lifecycle-steps small{display:none}.toolbar{align-items:stretch;flex-direction:column}.filter-field{justify-content:space-between}.filter-field select{flex:1}.filter-count{display:none}.workspace{display:block}.source-panel{border-right:0;border-bottom:1px solid var(--kb-line)}.source-list{display:flex;max-height:none;gap:6px;overflow-x:auto}.source-item{flex:0 0 245px}.detail-empty{min-height:300px}.source-header{align-items:flex-start;flex-direction:column}.source-header>.button{width:100%}.form-row.two{grid-template-columns:1fr}.document-title-row h5{max-width:100%;white-space:normal}.document-flow>em{width:10px}.document-actions{width:100%;flex-wrap:wrap}.document-actions>.button{flex:1}.retrieval-results{grid-template-columns:1fr}.document-drawer{width:100%}.drawer-header{padding:13px}.drawer-body{padding:10px}.detail-progress-card{align-items:flex-start;flex-direction:column}.detail-flow{width:100%;justify-content:flex-start}.detail-metadata-grid{grid-template-columns:1fr 1fr}.document-content{max-height:52vh}}
@media(max-width:480px){.metrics{grid-template-columns:1fr}.metrics article{min-height:60px}.lifecycle-steps>em{display:none}.lifecycle-steps{display:grid;grid-template-columns:1fr 1fr 1fr}.lifecycle-steps>span{display:flex;align-items:center}.document-main{width:100%}.document-icon{display:none}.document-flow{flex-wrap:wrap}.retrieval-card>header{align-items:flex-start;flex-direction:column}.retrieval-search{align-items:stretch;flex-direction:column;padding:9px}.retrieval-search input{width:100%}.retrieval-search .button{margin:0}.source-modal{max-height:calc(100vh - 30px);overflow:auto}.drawer-heading>.document-icon{display:grid}.drawer-title-row{align-items:flex-start;flex-direction:column}.detail-metadata-grid{grid-template-columns:1fr}.drawer-footer>.button{flex:1}}
@media(prefers-reduced-motion:reduce){.spinning,.source-skeleton i,.document-skeleton i{animation:none}}
</style>
