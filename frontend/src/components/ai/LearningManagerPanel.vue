<template>
  <section class="learning-manager">
    <header class="learning-manager__header">
      <div>
        <h2>Học có kiểm soát</h2>
        <p>Biến phản hồi đã che dữ liệu thành ca đánh giá nháp qua quy trình có người duyệt.</p>
      </div>
      <div class="learning-manager__header-actions">
        <button type="button" :disabled="loading || collecting" @click="load">
          <v-icon size="16">mdi-refresh</v-icon>
          Làm mới
        </button>
        <button class="primary" type="button" :disabled="loading || collecting" @click="collect">
          <v-icon size="16">mdi-database-import-outline</v-icon>
          {{ collecting ? 'Đang thu thập…' : 'Thu thập từ phản hồi' }}
        </button>
      </div>
    </header>

    <div class="learning-manager__guardrail">
      <v-icon size="19">mdi-shield-check-outline</v-icon>
      <div>
        <strong>Không tự thay đổi production</strong>
        <span>Duyệt và “Tạo ca đánh giá nháp” không sửa prompt, model, kho tri thức hoặc Auto Reply.</span>
      </div>
    </div>

    <div v-if="insights" class="learning-insights">
      <article>
        <span>Phản hồi đã ghi nhận</span>
        <strong>{{ feedbackTotal }}</strong>
      </article>
      <article v-for="item in activeRecommendations" :key="`${item.target}:${item.action}`">
        <span>{{ recommendationTarget(item.target) }}</span>
        <strong>{{ item.condition }}</strong>
        <small>{{ recommendationAction(item.action) }}</small>
      </article>
    </div>

    <div class="learning-manager__toolbar">
      <label>
        <span>Trạng thái</span>
        <select v-model="statusFilter" @change="reconcileSelection">
          <option value="all">Tất cả</option>
          <option value="pending_review">Chờ duyệt</option>
          <option value="approved">Đã duyệt</option>
          <option value="published">Đã tạo ca đánh giá</option>
          <option value="rejected">Đã từ chối</option>
          <option value="filtered">Đã lọc</option>
          <option value="collected">Đã thu thập</option>
        </select>
      </label>
      <span>{{ visibleCandidates.length }} / {{ candidates.length }} đề xuất</span>
    </div>

    <p v-if="error" class="learning-message learning-message--error" role="alert">{{ error }}</p>
    <p v-if="notice" class="learning-message learning-message--success" role="status">{{ notice }}</p>

    <div v-if="loading" class="learning-empty" aria-busy="true">
      <span class="learning-spinner" aria-hidden="true" />
      Đang tải dữ liệu học có kiểm soát…
    </div>
    <div v-else-if="visibleCandidates.length === 0" class="learning-empty">
      <v-icon size="30">mdi-database-search-outline</v-icon>
      <strong>Không có đề xuất ở trạng thái này</strong>
      <span>Thu thập từ phản hồi hoặc chọn trạng thái khác để rà soát.</span>
    </div>

    <div v-else class="learning-workspace">
      <aside class="learning-list" aria-label="Danh sách đề xuất học">
        <button
          v-for="candidate in visibleCandidates"
          :key="candidate.id"
          type="button"
          :class="{ active: candidate.id === selectedId }"
          @click="selectCandidate(candidate.id)"
        >
          <div class="learning-list__title">
            <strong>{{ learningKindLabel(candidate.kind) }}</strong>
            <span class="risk" :class="`risk--${riskTone(candidate.riskTier)}`">
              {{ learningRiskLabel(candidate.riskTier) }}
            </span>
          </div>
          <p>{{ learningCandidatePreview(candidate) }}</p>
          <div class="learning-list__meta">
            <span class="status" :class="`status--${learningStatusTone(candidate.status)}`">
              {{ learningStatusLabel(candidate.status) }}
            </span>
            <time :datetime="candidate.createdAt">{{ formatDate(candidate.createdAt) }}</time>
          </div>
        </button>
      </aside>

      <article v-if="selectedCandidate && safePayload" class="learning-detail">
        <header class="learning-detail__header">
          <div>
            <span>Đề xuất học</span>
            <h3>{{ learningKindLabel(selectedCandidate.kind) }}</h3>
          </div>
          <div class="learning-detail__badges">
            <span class="status" :class="`status--${learningStatusTone(selectedCandidate.status)}`">
              {{ learningStatusLabel(selectedCandidate.status) }}
            </span>
            <span class="risk" :class="`risk--${riskTone(selectedCandidate.riskTier)}`">
              {{ learningRiskLabel(selectedCandidate.riskTier) }}
            </span>
          </div>
        </header>

        <dl class="learning-detail__metadata">
          <div><dt>Mã đề xuất</dt><dd>{{ selectedCandidate.id }}</dd></div>
          <div><dt>Loại phản hồi</dt><dd>{{ feedbackTypeLabel(safePayload.feedbackType) }}</dd></div>
          <div><dt>Mức chỉnh sửa</dt><dd>{{ safePayload.editDistance ?? 'Không có' }}</dd></div>
          <div><dt>Tạo lúc</dt><dd>{{ formatDate(selectedCandidate.createdAt) }}</dd></div>
        </dl>

        <section class="redacted-payload">
          <div class="redacted-payload__title">
            <v-icon size="18">mdi-eye-lock-outline</v-icon>
            <div>
              <h4>Nội dung đã che dữ liệu</h4>
              <p>Chỉ các trường văn bản an toàn được hiển thị; dữ liệu mã hóa không được tải vào state giao diện.</p>
            </div>
          </div>

          <div v-if="safePayload.proposedReply" class="payload-field">
            <span>Gợi ý ban đầu</span>
            <p>{{ safePayload.proposedReply }}</p>
          </div>
          <div v-if="safePayload.finalReply" class="payload-field payload-field--highlight">
            <span>Nội dung sau chỉnh sửa</span>
            <p>{{ safePayload.finalReply }}</p>
          </div>
          <div v-if="safePayload.reason" class="payload-field">
            <span>Lý do phản hồi</span>
            <p>{{ safePayload.reason }}</p>
          </div>
          <p v-if="!safePayload.proposedReply && !safePayload.finalReply && !safePayload.reason" class="payload-empty">
            Không có trường văn bản an toàn để hiển thị.
          </p>
          <div class="payload-protected">
            <v-icon size="16">mdi-lock-outline</v-icon>
            <span>
              Đã ẩn {{ safePayload.hiddenContextFields }} trường ngữ cảnh,
              {{ safePayload.hiddenOutcomeFields }} trường kết quả và chỉ ghi nhận
              {{ safePayload.knowledgeRefCount }} tham chiếu kiến thức.
            </span>
          </div>
        </section>

        <section class="learning-evidence">
          <h4>Bằng chứng và lịch sử kiểm duyệt</h4>
          <p v-if="safeEvidence.length === 0" class="payload-empty">Chưa có bằng chứng được ghi nhận.</p>
          <ol v-else>
            <li v-for="(item, index) in safeEvidence" :key="`${item.label}:${index}`">
              <span class="learning-evidence__dot" />
              <div>
                <strong>{{ item.label }}</strong>
                <p>{{ item.detail }}</p>
                <small v-if="item.at">{{ formatDate(item.at) }}</small>
                <small v-if="item.materializationId">Mã ca đánh giá: {{ item.materializationId }}</small>
              </div>
            </li>
          </ol>
        </section>

        <section v-if="canReview || canTriage || canMaterialize" class="learning-decision">
          <label for="learning-review-note">Ghi chú kiểm duyệt <b>*</b></label>
          <textarea
            id="learning-review-note"
            v-model="reviewNote"
            rows="3"
            maxlength="500"
            placeholder="Nêu căn cứ duyệt/từ chối hoặc mục tiêu của ca đánh giá…"
          />
          <small>{{ reviewNote.trim().length }}/500 · Ghi chú cũng được che dữ liệu nhạy cảm ở máy chủ.</small>

          <div v-if="canReview" class="learning-decision__actions">
            <button type="button" :disabled="isActing" @click="review('rejected')">Từ chối</button>
            <button class="success" type="button" :disabled="isActing" @click="review('approved')">
              {{ isActing ? 'Đang xử lý…' : 'Duyệt cho đánh giá' }}
            </button>
          </div>

          <div v-else-if="canTriage" class="learning-decision__actions">
            <button type="button" :disabled="isActing" @click="triageNegative">
              {{ normalizedSelectedStatus === 'collected' ? 'Đánh dấu đã lọc' : 'Loại đề xuất' }}
            </button>
            <button class="primary" type="button" :disabled="isActing" @click="moveToReview">
              Đưa vào hàng chờ duyệt
            </button>
          </div>

          <template v-else-if="canMaterialize">
            <div class="materialization-explanation">
              <strong>Bước tiếp theo chỉ tạo Evaluation Case ở trạng thái Draft.</strong>
              <span>Không triển khai model/prompt, không sửa kho tri thức và không bật tự động trả lời.</span>
            </div>
            <div class="learning-decision__actions">
              <RouterLink :to="evaluationsRoute">Mở khu vực Đánh giá</RouterLink>
              <button class="primary" type="button" :disabled="isActing" @click="materialize">
                {{ isActing ? 'Đang tạo…' : 'Tạo ca đánh giá nháp' }}
              </button>
            </div>
          </template>
        </section>

        <section v-if="normalizedSelectedStatus === 'published'" class="materialized-result">
          <v-icon size="20">mdi-file-check-outline</v-icon>
          <div>
            <strong>Đã chuyển thành ca đánh giá nháp</strong>
            <span>Thao tác này idempotent và không tạo thay đổi production.</span>
            <RouterLink :to="evaluationsRoute">Xem các ca đánh giá</RouterLink>
          </div>
        </section>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  collectLearningCandidates,
  getLearningInsights,
  listLearningCandidates,
  materializeLearningCandidate,
  transitionLearningCandidate,
  type LearningCandidate,
  type LearningCandidateStatus,
  type LearningInsights,
} from '@/api/ai-learning';
import {
  learningCandidatePreview,
  learningKindLabel,
  learningRiskLabel,
  learningStatusLabel,
  learningStatusTone,
  normalizeLearningStatus,
  safeLearningEvidence,
  safeLearningPayload,
} from './learning-view-model';

withDefaults(defineProps<{
  evaluationsRoute?: string;
}>(), {
  evaluationsRoute: '/settings/crm/ai-assistant/evaluations',
});

const candidates = ref<LearningCandidate[]>([]);
const insights = ref<LearningInsights | null>(null);
const loading = ref(false);
const collecting = ref(false);
const actingId = ref('');
const error = ref('');
const notice = ref('');
const selectedId = ref('');
const statusFilter = ref<'all' | Exclude<LearningCandidateStatus, 'pending'>>('all');
const reviewNote = ref('');

const visibleCandidates = computed(() => candidates.value.filter((candidate) => (
  statusFilter.value === 'all'
  || normalizeLearningStatus(candidate.status) === statusFilter.value
)));

const selectedCandidate = computed(() => (
  candidates.value.find((candidate) => candidate.id === selectedId.value) ?? null
));
const safePayload = computed(() => selectedCandidate.value
  ? safeLearningPayload(selectedCandidate.value.payload)
  : null);
const safeEvidence = computed(() => safeLearningEvidence(selectedCandidate.value?.evidence ?? []));
const normalizedSelectedStatus = computed(() => selectedCandidate.value
  ? normalizeLearningStatus(selectedCandidate.value.status)
  : null);
const canReview = computed(() => normalizedSelectedStatus.value === 'pending_review');
const canTriage = computed(() => ['collected', 'filtered'].includes(normalizedSelectedStatus.value ?? ''));
const canMaterialize = computed(() => normalizedSelectedStatus.value === 'approved');
const isActing = computed(() => actingId.value === selectedId.value);
const feedbackTotal = computed(() => Object.values(insights.value?.feedbackCounts ?? {})
  .reduce((sum, value) => sum + Number(value || 0), 0));
const activeRecommendations = computed(() => (insights.value?.recommendations ?? [])
  .filter((item) => item.condition > 0));

function riskTone(risk: string) {
  return ['low', 'medium', 'high'].includes(risk) ? risk : 'medium';
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Không rõ' : date.toLocaleString('vi-VN');
}

function feedbackTypeLabel(value: string) {
  return ({
    good: 'Phản hồi tốt',
    edited: 'Đã chỉnh sửa',
    incorrect_information: 'Sai thông tin',
    context_mismatch: 'Sai ngữ cảnh',
    missing_emotion: 'Thiếu cảm xúc',
    too_long: 'Quá dài',
    too_short: 'Quá ngắn',
    too_robotic: 'Quá máy móc',
    too_pushy: 'Quá thúc ép',
    policy_violation: 'Vi phạm chính sách',
  } as Record<string, string>)[value] || value || 'Không rõ';
}

function recommendationTarget(target: string) {
  return ({ prompt: 'Cần rà soát prompt', knowledge: 'Cần rà soát kiến thức', skill: 'Cần rà soát kỹ năng', evaluation: 'Nguồn ca đánh giá' } as Record<string, string>)[target] || target;
}

function recommendationAction(action: string) {
  return ({
    review_prompt_variant: 'Xem biến thể prompt',
    review_knowledge_source: 'Kiểm tra nguồn kiến thức',
    review_skill_rules: 'Kiểm tra quy tắc kỹ năng',
    generate_reviewed_test_cases: 'Tạo test case đã duyệt',
  } as Record<string, string>)[action] || action;
}

function safeErrorMessage(value: unknown) {
  const response = (value as { response?: { status?: number; data?: { code?: string } } })?.response;
  const code = response?.data?.code;
  if (response?.status === 403) return 'Bạn không có quyền thực hiện thao tác Learning này.';
  if (code === 'APPROVAL_REQUIRED') return 'Đề xuất phải được duyệt trước khi tạo ca đánh giá.';
  if (code === 'INVALID_TRANSITION') return 'Trạng thái đề xuất đã thay đổi. Hãy tải lại danh sách.';
  if (code === 'CANDIDATE_CONFLICT') return 'Một người khác vừa xử lý đề xuất này. Hãy tải lại.';
  if (code === 'CANDIDATE_NOT_FOUND') return 'Không tìm thấy đề xuất hoặc đề xuất không thuộc tổ chức này.';
  return 'Không thể hoàn tất thao tác Learning. Vui lòng thử lại.';
}

function selectCandidate(id: string) {
  selectedId.value = id;
  reviewNote.value = '';
  error.value = '';
  notice.value = '';
}

function reconcileSelection() {
  const visible = visibleCandidates.value;
  if (!visible.some((candidate) => candidate.id === selectedId.value)) {
    selectedId.value = visible[0]?.id ?? '';
    reviewNote.value = '';
  }
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [candidateData, insightData] = await Promise.all([
      listLearningCandidates({ limit: 200 }),
      getLearningInsights(),
    ]);
    candidates.value = candidateData;
    insights.value = insightData;
    reconcileSelection();
  } catch (value) {
    error.value = safeErrorMessage(value);
  } finally {
    loading.value = false;
  }
}

async function reloadCandidates() {
  candidates.value = await listLearningCandidates({ limit: 200 });
  reconcileSelection();
}

async function collect() {
  if (!confirm('Thu thập phản hồi thành đề xuất chờ duyệt? Thao tác này không thay đổi production.')) return;
  collecting.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await collectLearningCandidates({ limit: 200 });
    notice.value = `Đã quét ${result.scanned} phản hồi: tạo ${result.created}, lọc ${result.filtered}, bỏ qua ${result.duplicates} bản trùng.`;
    await load();
  } catch (value) {
    error.value = safeErrorMessage(value);
  } finally {
    collecting.value = false;
  }
}

function requireReviewNote(): string | null {
  const note = reviewNote.value.trim();
  if (note.length < 3) {
    error.value = 'Vui lòng nhập ghi chú kiểm duyệt ít nhất 3 ký tự.';
    return null;
  }
  return note;
}

async function review(status: 'approved' | 'rejected') {
  const candidate = selectedCandidate.value;
  const note = requireReviewNote();
  if (!candidate || !note) return;
  const verb = status === 'approved' ? 'duyệt đề xuất này cho bước đánh giá' : 'từ chối đề xuất này';
  if (!confirm(`Xác nhận ${verb}? Không có thay đổi production.`)) return;
  actingId.value = candidate.id;
  error.value = '';
  notice.value = '';
  try {
    await transitionLearningCandidate(candidate.id, status, note);
    notice.value = status === 'approved'
      ? 'Đã duyệt. Đề xuất vẫn chưa tác động production và đang chờ tạo ca đánh giá.'
      : 'Đã từ chối và lưu căn cứ kiểm duyệt.';
    await reloadCandidates();
  } catch (value) {
    error.value = safeErrorMessage(value);
  } finally {
    actingId.value = '';
  }
}

async function moveToReview() {
  const candidate = selectedCandidate.value;
  const note = requireReviewNote();
  if (!candidate || !note) return;
  if (!confirm('Đưa đề xuất này vào hàng chờ người quản trị duyệt?')) return;
  actingId.value = candidate.id;
  error.value = '';
  try {
    await transitionLearningCandidate(candidate.id, 'pending_review', note);
    notice.value = 'Đã đưa đề xuất vào hàng chờ duyệt.';
    await reloadCandidates();
  } catch (value) {
    error.value = safeErrorMessage(value);
  } finally {
    actingId.value = '';
  }
}

async function triageNegative() {
  const candidate = selectedCandidate.value;
  const note = requireReviewNote();
  if (!candidate || !note) return;
  const target = normalizedSelectedStatus.value === 'collected' ? 'filtered' : 'rejected';
  const message = target === 'filtered'
    ? 'Đánh dấu đề xuất này là chưa đủ dữ liệu để duyệt?'
    : 'Từ chối đề xuất đã lọc này?';
  if (!confirm(message)) return;
  actingId.value = candidate.id;
  error.value = '';
  notice.value = '';
  try {
    await transitionLearningCandidate(candidate.id, target, note);
    notice.value = target === 'filtered'
      ? 'Đã đánh dấu đề xuất là chưa đủ dữ liệu.'
      : 'Đã từ chối đề xuất và lưu căn cứ kiểm duyệt.';
    await reloadCandidates();
  } catch (value) {
    error.value = safeErrorMessage(value);
  } finally {
    actingId.value = '';
  }
}
async function materialize() {
  const candidate = selectedCandidate.value;
  const note = requireReviewNote();
  if (!candidate || !note) return;
  if (!confirm('Chỉ tạo một Evaluation Case ở trạng thái Draft. Không áp dụng prompt/model, không sửa kho tri thức và không bật Auto Reply. Tiếp tục?')) return;
  actingId.value = candidate.id;
  error.value = '';
  notice.value = '';
  try {
    const result = await materializeLearningCandidate(candidate.id, note);
    const caseId = result.materialization?.id ? ` (${result.materialization.id})` : '';
    notice.value = result.idempotent
      ? `Ca đánh giá nháp đã tồn tại${caseId}; hệ thống không tạo bản trùng.`
      : `Đã tạo ca đánh giá nháp${caseId}. Production không thay đổi.`;
    await reloadCandidates();
  } catch (value) {
    error.value = safeErrorMessage(value);
  } finally {
    actingId.value = '';
  }
}

onMounted(() => void load());
</script>

<style scoped>
.learning-manager { overflow: hidden; border: 1px solid #dbe4f0; border-radius: 12px; background: #fff; color: #172033; }
.learning-manager__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px 18px; border-bottom: 1px solid #e2e8f0; }
.learning-manager h2, .learning-manager h3, .learning-manager h4, .learning-manager p { margin: 0; }
.learning-manager__header h2 { margin-bottom: 4px; font-size: 18px; }
.learning-manager__header p { color: #64748b; font-size: 12px; }
.learning-manager__header-actions, .learning-decision__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.learning-manager button, .learning-manager select, .learning-manager textarea, .learning-manager a { font: inherit; }
.learning-manager button, .learning-decision__actions a { display: inline-flex; min-height: 34px; align-items: center; justify-content: center; gap: 5px; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: #334155; font-size: 12px; font-weight: 600; text-decoration: none; cursor: pointer; }
.learning-manager button:hover:not(:disabled), .learning-decision__actions a:hover { border-color: #2563eb; color: #1d4ed8; }
.learning-manager button:disabled { cursor: wait; opacity: .6; }
.learning-manager button.primary { border-color: #2563eb; background: #2563eb; color: #fff; }
.learning-manager button.success { border-color: #15803d; background: #15803d; color: #fff; }
.learning-manager__guardrail { display: flex; gap: 10px; margin: 12px 14px 0; padding: 10px 12px; border: 1px solid #bbf7d0; border-radius: 9px; background: #f0fdf4; color: #166534; }
.learning-manager__guardrail div { display: flex; flex-direction: column; gap: 2px; }
.learning-manager__guardrail strong { font-size: 13px; }
.learning-manager__guardrail span { font-size: 12px; }
.learning-insights { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 8px; padding: 12px 14px; }
.learning-insights article { display: flex; min-height: 70px; flex-direction: column; justify-content: center; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
.learning-insights span, .learning-insights small { color: #64748b; font-size: 11px; }
.learning-insights strong { margin: 2px 0; font-size: 20px; }
.learning-manager__toolbar { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 10px 14px; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
.learning-manager__toolbar label { display: flex; flex-direction: column; gap: 4px; color: #64748b; font-size: 11px; }
.learning-manager__toolbar select { min-width: 190px; padding: 7px 30px 7px 9px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: #1e293b; font-size: 12px; }
.learning-manager__toolbar > span { color: #64748b; font-size: 12px; }
.learning-message { margin: 10px 14px 0 !important; padding: 9px 11px; border-radius: 7px; font-size: 12px; }
.learning-message--error { background: #fff1f2; color: #be123c; }
.learning-message--success { background: #ecfdf5; color: #047857; }
.learning-empty { display: flex; min-height: 220px; align-items: center; justify-content: center; flex-direction: column; gap: 7px; color: #64748b; font-size: 13px; }
.learning-spinner { width: 24px; height: 24px; border: 2px solid #cbd5e1; border-top-color: #2563eb; border-radius: 50%; animation: learning-spin .8s linear infinite; }
@keyframes learning-spin { to { transform: rotate(360deg); } }
.learning-workspace { display: grid; min-height: 560px; grid-template-columns: minmax(260px, 34%) minmax(0, 1fr); }
.learning-list { max-height: 720px; overflow: auto; border-right: 1px solid #e2e8f0; background: #f8fafc; }
.learning-list > button { display: block; width: 100%; min-height: 0; padding: 12px 13px; border: 0; border-bottom: 1px solid #e2e8f0; border-radius: 0; background: transparent; text-align: left; }
.learning-list > button:hover, .learning-list > button.active { background: #eff6ff; color: inherit; }
.learning-list > button.active { box-shadow: inset 3px 0 #2563eb; }
.learning-list__title, .learning-list__meta, .learning-detail__header, .learning-detail__badges { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.learning-list__title strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.learning-list p { display: -webkit-box; overflow: hidden; margin: 7px 0 !important; color: #475569; font-size: 12px; font-weight: 400; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.learning-list__meta time { color: #94a3b8; font-size: 10px; }
.status, .risk { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 999px; font-size: 10px; font-weight: 700; white-space: nowrap; }
.status--warning, .risk--medium { background: #fef3c7; color: #92400e; }
.status--success, .risk--low { background: #dcfce7; color: #166534; }
.status--danger, .risk--high { background: #ffe4e6; color: #be123c; }
.status--info { background: #dbeafe; color: #1d4ed8; }
.status--neutral { background: #e2e8f0; color: #475569; }
.learning-detail { min-width: 0; padding: 16px 18px 22px; }
.learning-detail__header { align-items: flex-start; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; }
.learning-detail__header > div:first-child > span { color: #64748b; font-size: 11px; text-transform: uppercase; }
.learning-detail__header h3 { margin-top: 2px; font-size: 17px; }
.learning-detail__badges { justify-content: flex-end; }
.learning-detail__metadata { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; margin: 12px 0; }
.learning-detail__metadata div { min-width: 0; }
.learning-detail__metadata dt { color: #64748b; font-size: 10px; text-transform: uppercase; }
.learning-detail__metadata dd { overflow: hidden; margin: 2px 0 0; color: #334155; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.redacted-payload { padding: 13px; border: 1px solid #bfdbfe; border-radius: 9px; background: #f8fbff; }
.redacted-payload__title { display: flex; gap: 8px; color: #1d4ed8; }
.redacted-payload__title h4 { font-size: 13px; }
.redacted-payload__title p { margin-top: 2px !important; color: #64748b; font-size: 11px; }
.payload-field { margin-top: 11px; padding: 10px; border: 1px solid #e2e8f0; border-radius: 7px; background: #fff; }
.payload-field--highlight { border-color: #bbf7d0; background: #f0fdf4; }
.payload-field > span { color: #64748b; font-size: 10px; font-weight: 700; text-transform: uppercase; }
.payload-field p { margin-top: 5px !important; color: #1e293b; font-size: 13px; line-height: 1.55; white-space: pre-wrap; }
.payload-empty { padding: 12px 0; color: #94a3b8; font-size: 12px; }
.payload-protected { display: flex; align-items: center; gap: 6px; margin-top: 10px; color: #64748b; font-size: 11px; }
.learning-evidence { margin-top: 16px; }
.learning-evidence h4 { font-size: 13px; }
.learning-evidence ol { margin: 10px 0 0; padding: 0; list-style: none; }
.learning-evidence li { position: relative; display: flex; gap: 9px; padding: 0 0 12px; }
.learning-evidence li:not(:last-child)::before { position: absolute; top: 10px; bottom: -1px; left: 4px; width: 1px; background: #cbd5e1; content: ''; }
.learning-evidence__dot { z-index: 1; width: 9px; height: 9px; flex: 0 0 auto; margin-top: 4px; border: 2px solid #fff; border-radius: 50%; background: #3b82f6; box-shadow: 0 0 0 1px #3b82f6; }
.learning-evidence li strong { font-size: 12px; }
.learning-evidence li p { margin: 2px 0 !important; color: #475569; font-size: 11px; }
.learning-evidence li small { display: block; color: #94a3b8; font-size: 10px; }
.learning-decision { margin-top: 14px; padding: 13px; border: 1px solid #dbe4f0; border-radius: 9px; background: #f8fafc; }
.learning-decision > label { display: block; margin-bottom: 5px; color: #334155; font-size: 12px; font-weight: 700; }
.learning-decision > label b { color: #be123c; }
.learning-decision textarea { width: 100%; box-sizing: border-box; resize: vertical; padding: 9px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: #1e293b; font-size: 12px; line-height: 1.5; }
.learning-decision > small { display: block; margin: 4px 0 10px; color: #64748b; font-size: 10px; }
.learning-decision__actions { align-items: center; justify-content: flex-end; }
.materialization-explanation { display: flex; flex-direction: column; gap: 3px; margin: 10px 0; padding: 9px; border-radius: 7px; background: #fffbeb; color: #92400e; font-size: 11px; }
.materialized-result { display: flex; gap: 9px; margin-top: 14px; padding: 11px; border: 1px solid #bbf7d0; border-radius: 8px; background: #f0fdf4; color: #166534; }
.materialized-result div { display: flex; flex-direction: column; gap: 2px; }
.materialized-result strong { font-size: 12px; }
.materialized-result span, .materialized-result a { color: #166534; font-size: 11px; }
@media (max-width: 860px) { .learning-workspace { grid-template-columns: 1fr; } .learning-list { max-height: 280px; border-right: 0; border-bottom: 1px solid #e2e8f0; } }
@media (max-width: 620px) { .learning-manager__header { flex-direction: column; } .learning-manager__header-actions { width: 100%; } .learning-manager__toolbar { align-items: stretch; flex-direction: column; } .learning-manager__toolbar select { width: 100%; } .learning-detail__metadata { grid-template-columns: 1fr; } .learning-detail__header { flex-direction: column; } .learning-detail__badges { justify-content: flex-start; } .learning-decision__actions { justify-content: stretch; } .learning-decision__actions > * { flex: 1; } }
@media (prefers-reduced-motion: reduce) { .learning-spinner { animation: none; } }
</style>
