<template>
  <section class="ci-card" aria-live="polite">
    <header class="ci-head">
      <div class="ci-title">
        <BrainCircuitIcon :size="18" :stroke-width="1.9" aria-hidden="true" />
        <div>
          <strong>Việc cần xử lý</strong>
          <small>AI đã đọc và chắt lọc hội thoại</small>
        </div>
      </div>
      <div class="ci-head-actions">
        <button
          class="ci-refresh"
          type="button"
          :disabled="loading || privateBlocked || !conversationId"
          title="Phân tích lại hội thoại"
          aria-label="Phân tích lại hội thoại"
          @click="refresh"
        >
          <RefreshCwIcon :size="16" :class="{ spinning: loading }" aria-hidden="true" />
        </button>
      </div>
    </header>

    <div v-if="privateBlocked" class="ci-state">
      Hội thoại riêng tư không được AI đọc hoặc ghi nhớ.
    </div>
    <template v-else>
      <div v-if="readiness" class="ci-readiness" aria-label="Trạng thái cập nhật phân tích">
        <div v-if="readiness.accountStatus !== 'connected'" class="ci-notice ci-notice--error">
          <WifiOffIcon :size="16" aria-hidden="true" />
          <span><strong>{{ accountName }} đang mất kết nối.</strong> Chưa thể nhận tin nhắn mới để tự cập nhật ghi chú.</span>
        </div>
        <div v-if="readiness.aiStatus !== 'ready'" class="ci-notice ci-notice--warning">
          <TriangleAlertIcon :size="16" aria-hidden="true" />
          <span><strong>AI nâng cao chưa sẵn sàng.</strong> {{ aiReadinessDescription }}</span>
        </div>
      </div>

      <div v-if="loading && !insight" class="ci-loading" aria-label="Đang tải phân tích">
        <strong>AI đang đọc và tóm tắt hội thoại...</strong>
        <small>AI đang phân tích nội dung hiện tại, việc khách đang chờ và ghi nhớ liên quan.</small>
        <span /><span /><span />
      </div>
      <div v-else-if="error" class="ci-state ci-state--error">
        <AlertCircleIcon :size="17" aria-hidden="true" />
        <span>{{ error }}</span>
        <button class="ci-retry" type="button" @click="refresh">Thử lại</button>
      </div>
      <div v-else-if="!insight" class="ci-state ci-state--empty">
        <strong>Chưa có ghi chú phân tích</strong>
        <span>{{ emptyDescription }}</span>
        <button
          v-if="['ready', 'needs_test'].includes(readiness?.aiStatus || '')"
          class="ci-analyze"
          type="button"
          :disabled="loading"
          @click="analyzeNow"
        >Phân tích ngay</button>
      </div>

      <template v-else>
      <div class="ci-stage-line">
        <span class="ci-stage-pill" :class="`ci-stage-pill--${stageTone}`">{{ stageLabel }}</span>
        <span v-if="insight.requiresHuman" class="ci-urgent-pill">Cần nhân viên xử lý</span>
      </div>

      <section class="ci-brief ci-brief--need">
        <div class="ci-brief-icon"><MessageSquareTextIcon :size="18" aria-hidden="true" /></div>
        <div>
          <span class="ci-label">Khách đang cần gì</span>
          <p>{{ customerNeed }}</p>
        </div>
      </section>

      <section class="ci-brief ci-brief--action" :class="{ 'ci-brief--urgent': insight.requiresHuman }">
        <div class="ci-brief-icon"><ArrowRightCircleIcon :size="19" aria-hidden="true" /></div>
        <div>
          <span class="ci-label">Nhân viên cần làm ngay</span>
          <strong>{{ nextActionLabel }}</strong>
          <p v-if="insight.nextAction.reason">{{ insight.nextAction.reason }}</p>
        </div>
      </section>

      <section class="ci-attention">
        <div class="ci-block-title"><NotebookTabsIcon :size="16" aria-hidden="true" /> Điều cần chú ý</div>
        <ul v-if="attentionItems.length">
          <li v-for="item in attentionItems" :key="item">{{ item }}</li>
        </ul>
        <p v-else>Chưa có lưu ý đặc biệt.</p>
      </section>

      <section v-if="automationLabel" class="ci-automation" :class="`ci-automation--${automationTone}`">
        <WorkflowIcon :size="16" aria-hidden="true" />
        <div>
          <span class="ci-label">Theo dõi tự động</span>
          <strong>{{ automationLabel }}</strong>
        </div>
      </section>

      <footer class="ci-foot">
        <span>AI cập nhật</span>
        <time :datetime="insight.updatedAt">{{ updatedLabel }}</time>
      </footer>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import {
  AlertCircle as AlertCircleIcon,
  ArrowRightCircle as ArrowRightCircleIcon,
  BrainCircuit as BrainCircuitIcon,
  MessageSquareText as MessageSquareTextIcon,
  NotebookTabs as NotebookTabsIcon,
  RefreshCw as RefreshCwIcon,
  TriangleAlert as TriangleAlertIcon,
  WifiOff as WifiOffIcon,
  Workflow as WorkflowIcon,
} from 'lucide-vue-next';
import { useConversationInsight } from '@/composables/use-conversation-insight';

const props = withDefaults(defineProps<{
  conversationId?: string | null;
  privateBlocked?: boolean;
}>(), {
  conversationId: null,
  privateBlocked: false,
});

const { insight, readiness, loading, error, fetchInsight, analyzeInsight, clear } = useConversationInsight();

const STAGE_LABELS: Record<string, string> = {
  needs_reply: 'Cần trả lời',
  discovery: 'Đang tìm hiểu',
  qualified: 'Khách tiềm năng',
  quoted: 'Đã báo giá',
  negotiating: 'Đang thương lượng',
  payment_pending: 'Chờ thanh toán',
  won: 'Đã chốt',
  post_sale: 'Chăm sóc sau bán',
  cold: 'Đang nguội',
  human_required: 'Cần nhân viên xử lý',
  do_not_contact: 'Không liên hệ',
};

const ACTION_LABELS: Record<string, string> = {
  reply_customer: 'Trả lời khách hàng',
  review_conversation: 'Rà lại cuộc hội thoại',
  suppress_automation: 'Dừng mọi follow-up tự động',
  assign_to_human: 'Chuyển nhân viên xử lý',
  verify_payment_obligation: 'Xác minh đơn hoặc công nợ',
  confirm_order_details: 'Xác nhận và lên đơn',
  prepare_quote: 'Chuẩn bị báo giá',
  review_quote_follow_up: 'Xem lại nội dung báo giá để follow-up',
  review_post_sale_care: 'Kiểm tra trước khi chăm sóc sau bán',
};

const MEMORY_LABELS: Record<string, string> = {
  customer_type: 'Loại khách hàng',
  long_term_need: 'Nhu cầu dài hạn',
  interested_product: 'Sản phẩm quan tâm',
  previous_order: 'Đơn hàng trước',
  confirmed_budget: 'Ngân sách đã xác nhận',
  communication_style: 'Cách trao đổi phù hợp',
  rejection_reason: 'Lý do từ chối',
  important_complaint: 'Khiếu nại quan trọng',
  explicit_remember_request: 'Điều khách yêu cầu ghi nhớ',
  preferred_product: 'Sản phẩm quan tâm',
  budget_range: 'Ngân sách',
  preferred_contact_time: 'Thời gian liên hệ',
  communication_preference: 'Cách trao đổi mong muốn',
  important_date: 'Mốc thời gian quan trọng',
  objection: 'Vướng mắc',
  personal_context: 'Bối cảnh khách hàng',
};

const ATTENTION_MEMORY_KEYS = new Set([
  'customer_type',
  'long_term_need',
  'confirmed_budget',
  'budget_range',
  'communication_style',
  'communication_preference',
  'preferred_contact_time',
  'important_date',
  'objection',
  'rejection_reason',
  'important_complaint',
  'explicit_remember_request',
  'personal_context',
]);

const stageLabel = computed(() => STAGE_LABELS[insight.value?.stage || ''] || 'Chưa xác định');
const nextActionLabel = computed(() => ACTION_LABELS[insight.value?.nextAction.key || ''] || 'Rà lại cuộc hội thoại');
const discussion = computed(() => insight.value?.summary?.content?.currentDiscussion?.trim() || '');
const unansweredQuestions = computed(() =>
  (insight.value?.summary?.content?.unansweredQuestions || []).filter(Boolean).slice(0, 4),
);
const memoryCandidates = computed(() => insight.value?.memoryCandidates
  .filter((memory) => memory.status === 'candidate' && ATTENTION_MEMORY_KEYS.has(memory.key))
  .slice(0, 5) || []);
const customerNeed = computed(() => discussion.value || insight.value?.stageReason?.trim() || 'AI chưa xác định rõ nhu cầu hiện tại của khách.');
const attentionItems = computed(() => [
  ...unansweredQuestions.value.map((question) => `Cần làm rõ: ${question}`),
  ...memoryCandidates.value.map((memory) => `${memoryKeyLabel(memory.key)}: ${memory.valueRedacted || 'chưa có nội dung'}`),
].slice(0, 5));
const automationLabel = computed(() => {
  const automation = insight.value?.automation;
  if (!automation) return '';
  const reason = automation.reason || '';
  if (automation.enabled === false || reason === 'automation_disabled') return 'Đang tắt';
  if (['workflow_enrolled', 'workflow_switched', 'same_workflow_kept'].includes(reason)) return 'AI đã tự lên lịch chăm sóc';
  if (reason === 'customer_replied') return 'Đã dừng để nhân viên trả lời khách';
  if (reason === 'manual_workflow_preserved') return 'Giữ nguyên lịch do nhân viên đã chọn';
  if (reason === 'workflow_not_active') return 'Chiến dịch tự động đang được quản lý tạm dừng';
  if (reason === 'workflow_no_longer_applicable') return 'Đã dừng lịch cũ vì tình huống khách đã thay đổi';
  if (reason === 'not_a_messageable_friend') return 'Chưa gửi vì khách chưa đủ điều kiện nhận tin';
  if (['human_required', 'payment_requires_verification', 'order_requires_staff_processing'].includes(reason)) return 'Đang chờ nhân viên xử lý';
  if (['do_not_contact', 'customer_not_interested'].includes(reason)) return 'Đã dừng liên hệ tự động';
  if (reason === 'no_safe_workflow_required') return 'Chưa cần lên lịch chăm sóc';
  if (automation.outcome === 'failed') return 'Tự động hóa đang gặp lỗi';
  return 'AI đã cập nhật trạng thái chăm sóc';
});
const automationTone = computed(() => {
  const reason = insight.value?.automation?.reason || '';
  if (insight.value?.automation?.outcome === 'failed') return 'danger';
  if (['workflow_enrolled', 'workflow_switched', 'same_workflow_kept'].includes(reason)) return 'success';
  if (['human_required', 'payment_requires_verification', 'order_requires_staff_processing', 'customer_replied'].includes(reason)) return 'warning';
  return 'neutral';
});
const accountName = computed(() => readiness.value?.accountName?.trim() || 'Nick Zalo đang dùng');
const aiReadinessDescription = computed(() => ({
  disabled: 'AI đang tắt nên chưa thể tạo phân tích mới.',
  not_configured: 'Cần hoàn tất cấu hình AI trước khi tạo phân tích mới.',
  needs_test: 'Kết nối AI chưa được xác minh; kết quả dự phòng có thể kém chính xác hơn.',
  error: 'Kết nối AI đang lỗi; kết quả dự phòng có thể kém chính xác hơn.',
  ready: '',
})[readiness.value?.aiStatus || 'ready']);
const emptyDescription = computed(() => {
  if (readiness.value && readiness.value.accountStatus !== 'connected') return 'Nick đang ngoại tuyến nhưng AI vẫn có thể phân tích các tin nhắn đã lưu.';
  if (readiness.value && readiness.value.aiStatus !== 'ready') return 'Hoàn tất cấu hình AI; ghi chú sẽ cập nhật sau tin nhắn mới của khách.';
  return 'Cuộc trò chuyện cũ chưa có dữ liệu. Bạn có thể phân tích ngay để AI tóm tắt nội dung và đề xuất việc tiếp theo.';
});
const stageTone = computed(() => {
  if (insight.value?.requiresHuman || ['human_required', 'do_not_contact'].includes(insight.value?.stage || '')) return 'danger';
  if (['qualified', 'quoted', 'negotiating'].includes(insight.value?.stage || '')) return 'warm';
  if (['won', 'post_sale'].includes(insight.value?.stage || '')) return 'success';
  return 'info';
});
const updatedLabel = computed(() => {
  if (!insight.value?.updatedAt) return '';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(insight.value.updatedAt));
});

function memoryKeyLabel(key: string) {
  return MEMORY_LABELS[key] || key.replaceAll('_', ' ');
}

function refresh() {
  if (props.conversationId && !props.privateBlocked) void analyzeInsight(props.conversationId);
}

function analyzeNow() {
  if (props.conversationId && !props.privateBlocked) void analyzeInsight(props.conversationId);
}

watch(
  () => [props.conversationId, props.privateBlocked] as const,
  ([conversationId, privateBlocked]) => {
    if (!conversationId || privateBlocked) {
      clear();
      return;
    }
    void fetchInsight(conversationId);
  },
  { immediate: true },
);
</script>

<style scoped>
.ci-card {
  width: 100%;
  color: var(--smax-text, #172033);
  background: var(--smax-white, #fff);
}
.ci-head {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--smax-grey-200, #e5e7eb);
}
.ci-title, .ci-head-actions, .ci-block-title, .ci-foot {
  display: flex;
  align-items: center;
}
.ci-title { min-width: 0; gap: 8px; }
.ci-title > div { min-width: 0; display: grid; gap: 1px; }
.ci-title strong { color: #172033; font-size: 13px; line-height: 1.3; }
.ci-title small { color: #667085; font-size: 10px; line-height: 1.3; }
.ci-head-actions { flex-shrink: 0; gap: 6px; }
.ci-refresh {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #526174;
  cursor: pointer;
}
.ci-refresh:hover:not(:disabled) { background: #f2f4f7; color: #0b78bb; }
.ci-refresh:disabled { opacity: .48; cursor: default; }
.spinning { animation: ci-spin .8s linear infinite; }
@keyframes ci-spin { to { transform: rotate(360deg); } }
.ci-state {
  min-height: 88px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 18px 16px;
  color: #667085;
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}
.ci-state--error { color: #b42318; }
.ci-state--empty { flex-direction: column; gap: 4px; }
.ci-state--empty strong { color: #344054; font-size: 13px; }
.ci-state--empty span { max-width: 280px; }
.ci-analyze {
  min-height: 32px;
  margin-top: 8px;
  padding: 6px 12px;
  border: 1px solid #1570ef;
  border-radius: 6px;
  background: #1570ef;
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.ci-analyze:hover:not(:disabled) { background: #125dcc; }
.ci-analyze:disabled { opacity: .55; cursor: default; }
.ci-retry {
  min-height: 30px;
  padding: 5px 10px;
  border: 1px solid #fda29b;
  border-radius: 6px;
  background: #fff;
  color: #b42318;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.ci-readiness { display: grid; gap: 1px; border-bottom: 1px solid var(--smax-grey-200, #e5e7eb); }
.ci-notice {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 7px;
  padding: 9px 12px;
  font-size: 11px;
  line-height: 1.45;
}
.ci-notice svg { margin-top: 1px; }
.ci-notice strong { font-weight: 750; }
.ci-notice--error { background: #fff6f5; color: #912018; }
.ci-notice--warning { background: #fffaeb; color: #854a0e; }
.ci-loading { display: grid; gap: 8px; padding: 16px; }
.ci-loading strong { color: #344054; font-size: 12px; }
.ci-loading small { color: #667085; font-size: 11px; }
.ci-loading span { height: 12px; border-radius: 4px; background: #eef1f5; animation: ci-pulse 1.1s ease-in-out infinite alternate; }
.ci-loading span:nth-child(2) { width: 82%; }
.ci-loading span:nth-child(3) { width: 60%; }
@keyframes ci-pulse { to { opacity: .45; } }
.ci-stage-line {
  min-height: 38px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 7px 13px;
  border-bottom: 1px solid var(--smax-grey-200, #e5e7eb);
  background: #fafbfc;
}
.ci-stage-pill, .ci-urgent-pill {
  display: inline-flex;
  align-items: center;
  min-height: 23px;
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 750;
}
.ci-stage-pill--danger, .ci-urgent-pill { background: #fee4e2; color: #b42318; }
.ci-stage-pill--warm { background: #fff0da; color: #9a5705; }
.ci-stage-pill--success { background: #dcfae6; color: #067647; }
.ci-stage-pill--info { background: #eaf2ff; color: #175cd3; }
.ci-label { color: #667085; font-size: 10px; line-height: 1.3; }
.ci-brief {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 9px;
  padding: 13px 14px;
  border-bottom: 1px solid var(--smax-grey-200, #e5e7eb);
}
.ci-brief--need { background: #fff; }
.ci-brief--action { background: #f1faf5; box-shadow: inset 3px 0 #079455; }
.ci-brief--urgent { background: #fff6f5; box-shadow: inset 3px 0 #d92d20; }
.ci-brief-icon {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: #eef4ff;
  color: #175cd3;
}
.ci-brief--action .ci-brief-icon { background: #dcfae6; color: #067647; }
.ci-brief--urgent .ci-brief-icon { background: #fee4e2; color: #b42318; }
.ci-brief strong { display: block; margin: 3px 0 4px; color: #172033; font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
.ci-brief p { margin: 3px 0 0; color: #344054; font-size: 12px; line-height: 1.55; white-space: pre-line; overflow-wrap: anywhere; }
.ci-attention { padding: 13px 14px; border-bottom: 1px solid var(--smax-grey-200, #e5e7eb); background: #fff; }
.ci-block-title { gap: 6px; margin-bottom: 6px; color: #344054; font-size: 11px; font-weight: 700; }
.ci-attention ul { margin: 0; padding-left: 18px; color: #344054; font-size: 11.5px; line-height: 1.5; }
.ci-attention li + li { margin-top: 5px; }
.ci-attention p { margin: 0; color: #667085; font-size: 11.5px; }
.ci-automation {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 7px;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--smax-grey-200, #e5e7eb);
  color: #475467;
  background: #f8fafc;
}
.ci-automation > div { min-width: 0; display: grid; gap: 2px; }
.ci-automation strong { color: #344054; font-size: 11.5px; line-height: 1.4; overflow-wrap: anywhere; }
.ci-automation--success { color: #067647; background: #f1faf5; }
.ci-automation--success strong { color: #067647; }
.ci-automation--warning { color: #b54708; background: #fffaeb; }
.ci-automation--warning strong { color: #93370d; }
.ci-automation--danger { color: #b42318; background: #fff6f5; }
.ci-automation--danger strong { color: #b42318; }
.ci-foot {
  min-height: 34px;
  gap: 4px;
  padding: 8px 14px;
  color: #667085;
  font-size: 10px;
}
.ci-foot time { white-space: nowrap; }
@media (max-width: 480px) {
  .ci-head { padding: 10px 12px; }
  .ci-foot { align-items: flex-start; flex-wrap: wrap; }
  .ci-state--error { flex-wrap: wrap; }
  .ci-retry { width: 100%; }
}
</style>
