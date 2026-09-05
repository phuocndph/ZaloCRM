<template>
  <aside class="gmp" aria-label="Theo dõi nhóm bằng AI">
    <header class="gmp-head">
      <div>
        <span class="gmp-eyebrow">Theo dõi nhóm</span>
        <strong>{{ conversation.groupName || 'Nhóm Zalo' }}</strong>
      </div>
      <button type="button" title="Đóng" aria-label="Đóng" @click="$emit('close')">
        <XIcon :size="18" aria-hidden="true" />
      </button>
    </header>

    <div class="gmp-body">
      <section class="gmp-section">
        <div class="gmp-section-title">
          <ShieldCheckIcon :size="17" aria-hidden="true" />
          <span>Phạm vi AI</span>
        </div>
        <p v-if="isCommunity" class="gmp-notice gmp-notice--blocked">
          Đây là nhóm cộng đồng. Hệ thống tự loại khỏi AI để tránh tạo hàng loạt công việc nhiễu.
        </p>
        <p v-else class="gmp-notice">
          AI chỉ tạo việc khi xác định được đúng thành viên, đúng yêu cầu và tin nhắn làm bằng chứng. AI không tự gửi tin, gắn tag hay chạy follow-up trong nhóm.
        </p>
      </section>

      <section class="gmp-section">
        <label class="gmp-label" for="group-category">Loại nhóm</label>
        <select id="group-category" v-model="category" :disabled="saving || isCommunity">
          <option v-for="option in categoryOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <span class="gmp-help">Chỉ nhóm Bán hàng và Chăm sóc khách hàng có thể bật theo dõi.</span>

        <label class="gmp-toggle" :class="{ disabled: !canEnable || saving }">
          <span>
            <strong>Theo dõi yêu cầu trong nhóm</strong>
            <small>{{ enabled ? 'AI đang đọc tin mới và gom việc cần xử lý.' : 'Không phân tích hoặc tạo công việc từ nhóm này.' }}</small>
          </span>
          <input v-model="enabled" type="checkbox" :disabled="!canEnable || saving" />
          <i aria-hidden="true" />
        </label>

        <div class="gmp-actions">
          <button class="gmp-save" type="button" :disabled="saving || !dirty" @click="save">
            <SaveIcon :size="16" aria-hidden="true" />
            {{ saving ? 'Đang lưu...' : 'Lưu cấu hình' }}
          </button>
          <button v-if="conversation.groupMonitoringEnabled" type="button" :disabled="analyzing" @click="analyzeNow">
            <RefreshCwIcon :size="16" :class="{ spin: analyzing }" aria-hidden="true" />
            Phân tích ngay
          </button>
        </div>
      </section>

      <section class="gmp-section gmp-status">
        <div class="gmp-section-title">
          <UsersRoundIcon :size="17" aria-hidden="true" />
          <span>Trạng thái nhóm</span>
        </div>
        <dl>
          <div><dt>Thành viên</dt><dd>{{ conversation.groupMembersCount ?? 'Chưa rõ' }}</dd></div>
          <div><dt>Nhận diện</dt><dd>{{ sourceLabel }}</dd></div>
          <div><dt>AI theo dõi</dt><dd :class="conversation.groupMonitoringEnabled ? 'on' : ''">{{ conversation.groupMonitoringEnabled ? 'Đang bật' : 'Đang tắt' }}</dd></div>
        </dl>
      </section>

      <ConversationInsightCard
        v-if="conversation.groupMonitoringEnabled"
        :conversation-id="conversation.id"
        :private-blocked="false"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RefreshCw as RefreshCwIcon, Save as SaveIcon, ShieldCheck as ShieldCheckIcon, UsersRound as UsersRoundIcon, X as XIcon } from 'lucide-vue-next';
import { api } from '@/api';
import { useToast } from '@/composables/use-toast';
import type { Conversation } from '@/composables/use-chat';
import ConversationInsightCard from './ConversationInsightCard.vue';

type Category = NonNullable<Conversation['groupCategory']>;

const props = defineProps<{ conversation: Conversation }>();
const emit = defineEmits<{ close: []; updated: [patch: Partial<Conversation>] }>();
const toast = useToast();
const category = ref<Category>('unknown');
const enabled = ref(false);
const saving = ref(false);
const analyzing = ref(false);

const categoryOptions: Array<{ value: Category; label: string }> = [
  { value: 'sales', label: 'Bán hàng' },
  { value: 'customer_care', label: 'Chăm sóc khách hàng' },
  { value: 'internal', label: 'Nội bộ' },
  { value: 'supplier', label: 'Nhà cung cấp / đối tác' },
  { value: 'unknown', label: 'Chưa xác định' },
];
const isCommunity = computed(() => props.conversation.groupSdkType === 2 || props.conversation.groupCategory === 'community');
const canEnable = computed(() => !isCommunity.value && ['sales', 'customer_care'].includes(category.value));
const dirty = computed(() => category.value !== (props.conversation.groupCategory || 'unknown') || enabled.value !== !!props.conversation.groupMonitoringEnabled);
const sourceLabel = computed(() => ({ sdk: 'Zalo xác định', rule: 'Hệ thống tự nhận diện', manual: 'Nhân viên thiết lập', unclassified: 'Chưa phân loại' }[props.conversation.groupClassificationSource || 'unclassified']));

watch(() => props.conversation.id, sync, { immediate: true });
watch(() => props.conversation.groupCategory, sync);
watch(category, () => { if (!canEnable.value) enabled.value = false; });

function sync() {
  category.value = props.conversation.groupCategory || 'unknown';
  enabled.value = !!props.conversation.groupMonitoringEnabled;
}

async function save() {
  saving.value = true;
  try {
    const { data } = await api.patch(`/ai/insights/conversations/${props.conversation.id}/group-monitoring`, {
      category: category.value,
      enabled: enabled.value,
    });
    const patch = data.groupMonitoring as Partial<Conversation>;
    emit('updated', patch);
    toast.success('Đã lưu cấu hình theo dõi nhóm');
  } catch (error: any) {
    toast.error(error?.response?.data?.error || 'Không lưu được cấu hình nhóm');
  } finally {
    saving.value = false;
  }
}

async function analyzeNow() {
  analyzing.value = true;
  try {
    await api.post(`/ai/insights/conversations/${props.conversation.id}/analyze`);
    toast.success('Đã đưa nhóm vào hàng đợi phân tích');
  } catch (error: any) {
    toast.error(error?.response?.data?.error || 'Không thể phân tích nhóm lúc này');
  } finally {
    analyzing.value = false;
  }
}
</script>

<style scoped>
.gmp { height: 100%; display: flex; flex-direction: column; background: #fff; border-left: 1px solid #e4e8ee; color: #172033; }
.gmp-head { min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #e4e8ee; }
.gmp-head > div { min-width: 0; display: grid; gap: 2px; }
.gmp-head strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.gmp-eyebrow { color: #667085; font-size: 10px; font-weight: 700; text-transform: uppercase; }
.gmp-head button { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; background: transparent; color: #667085; cursor: pointer; }
.gmp-head button:hover { background: #f2f4f7; color: #172033; }
.gmp-body { min-height: 0; overflow-y: auto; padding-bottom: 16px; }
.gmp-section { padding: 14px; border-bottom: 1px solid #edf0f3; }
.gmp-section-title { display: flex; align-items: center; gap: 7px; margin-bottom: 9px; color: #344054; font-size: 12px; font-weight: 750; }
.gmp-notice { margin: 0; padding: 9px 10px; border-left: 3px solid #1570ef; background: #eff6ff; color: #344054; font-size: 11.5px; line-height: 1.5; }
.gmp-notice--blocked { border-color: #d92d20; background: #fff1f0; }
.gmp-label { display: block; margin-bottom: 5px; color: #344054; font-size: 11.5px; font-weight: 700; }
select { width: 100%; height: 36px; padding: 0 9px; border: 1px solid #d0d5dd; border-radius: 6px; background: #fff; color: #172033; font: inherit; font-size: 12px; }
.gmp-help { display: block; margin-top: 5px; color: #667085; font-size: 10.5px; line-height: 1.4; }
.gmp-toggle { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 36px; gap: 10px; align-items: center; margin-top: 14px; cursor: pointer; }
.gmp-toggle span { display: grid; gap: 2px; }
.gmp-toggle strong { font-size: 12px; }
.gmp-toggle small { color: #667085; font-size: 10.5px; line-height: 1.4; }
.gmp-toggle input { position: absolute; opacity: 0; pointer-events: none; }
.gmp-toggle i { width: 36px; height: 20px; border-radius: 10px; background: #98a2b3; transition: background .15s; }
.gmp-toggle i::after { content: ''; display: block; width: 16px; height: 16px; margin: 2px; border-radius: 50%; background: #fff; transition: transform .15s; }
.gmp-toggle input:checked + i { background: #087daf; }
.gmp-toggle input:checked + i::after { transform: translateX(16px); }
.gmp-toggle.disabled { opacity: .55; cursor: default; }
.gmp-actions { display: flex; gap: 7px; margin-top: 14px; }
.gmp-actions button { min-height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 10px; border: 1px solid #d0d5dd; border-radius: 6px; background: #fff; color: #344054; font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; }
.gmp-actions button:disabled { opacity: .5; cursor: default; }
.gmp-actions .gmp-save { border-color: #087daf; background: #087daf; color: #fff; }
.gmp-status dl { display: grid; gap: 7px; margin: 0; }
.gmp-status dl > div { display: flex; justify-content: space-between; gap: 12px; font-size: 11.5px; }
.gmp-status dt { color: #667085; }
.gmp-status dd { margin: 0; font-weight: 700; text-align: right; }
.gmp-status dd.on { color: #067647; }
.spin { animation: gmp-spin .8s linear infinite; }
@keyframes gmp-spin { to { transform: rotate(360deg); } }
</style>
