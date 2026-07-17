<template>
  <section
    class="ai-readiness"
    :class="`ai-readiness--${displayState}`"
    :aria-busy="loading"
    aria-live="polite"
  >
    <template v-if="loading">
      <div class="ai-readiness__spinner" aria-hidden="true" />
      <div class="ai-readiness__body">
        <strong>Đang kiểm tra trạng thái Trợ lý AI…</strong>
        <span>Đang đọc cấu hình provider và mô hình.</span>
      </div>
    </template>

    <template v-else-if="loadError">
      <v-icon class="ai-readiness__icon" size="23">mdi-alert-octagon-outline</v-icon>
      <div class="ai-readiness__body">
        <strong>Không đọc được trạng thái Trợ lý AI</strong>
        <span>{{ loadError }}</span>
      </div>
      <button class="ai-readiness__button" type="button" @click="refresh">Thử lại</button>
    </template>

    <template v-else-if="readiness && viewModel">
      <v-icon class="ai-readiness__icon" size="23">{{ viewModel.icon }}</v-icon>
      <div class="ai-readiness__body">
        <div class="ai-readiness__title-row">
          <strong>{{ viewModel.title }}</strong>
          <span class="ai-readiness__badge">{{ statusLabel }}</span>
        </div>
        <span>{{ viewModel.description }}</span>
        <span v-if="connectionSummary" class="ai-readiness__summary">{{ connectionSummary }}</span>
        <ul v-if="visibleChecks.length" class="ai-readiness__checks">
          <li v-for="check in visibleChecks" :key="check.id">{{ check.message }}</li>
        </ul>
      </div>
      <div class="ai-readiness__actions">
        <button
          v-if="canTestConnection"
          class="ai-readiness__button"
          type="button"
          :disabled="testing"
          @click="testConnection"
        >
          {{ testing ? 'Đang kiểm tra…' : 'Kiểm tra kết nối' }}
        </button>
        <RouterLink class="ai-readiness__button ai-readiness__button--primary" :to="modelsRoute">
          {{ viewModel.ctaLabel }}
        </RouterLink>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  getAiReadiness,
  testAiProviderConnection,
  type AiReadinessResponse,
} from '@/api/ai-admin';
import {
  actionableReadinessChecks,
  toAiReadinessViewModel,
  type AiReadinessDisplayState,
} from './ai-readiness-view-model';

const props = withDefaults(defineProps<{
  autoLoad?: boolean;
  modelsRoute?: string;
  maxVisibleChecks?: number;
}>(), {
  autoLoad: true,
  // Current settings route. The new AI shell can override this with its Models route.
  modelsRoute: '/settings/dev/api',
  maxVisibleChecks: 3,
});

const emit = defineEmits<{
  loaded: [readiness: AiReadinessResponse];
}>();

const readiness = ref<AiReadinessResponse | null>(null);
const loading = ref(false);
const testing = ref(false);
const loadError = ref('');
let controller: AbortController | null = null;

const viewModel = computed(() => readiness.value
  ? toAiReadinessViewModel(readiness.value)
  : null);

const displayState = computed<AiReadinessDisplayState | 'loading'>(() => {
  if (loading.value) return 'loading';
  if (loadError.value) return 'error';
  return viewModel.value?.state ?? 'not-configured';
});

const visibleChecks = computed(() => {
  if (!readiness.value) return [];
  return actionableReadinessChecks(readiness.value.checks).slice(0, props.maxVisibleChecks);
});

const canTestConnection = computed(() => Boolean(
  readiness.value?.provider.id
  && readiness.value.provider.configured
  && readiness.value.provider.hasApiKey
  && readiness.value.provider.baseUrlConfigured
  && readiness.value.config.model,
));

const statusLabel = computed(() => {
  if (!readiness.value) return '';
  return ({
    ready: 'Sẵn sàng',
    disabled: 'Đang tắt',
    needs_test: 'Chưa xác minh',
    not_configured: 'Chưa cấu hình',
    error: 'Có lỗi',
  } as const)[readiness.value.status];
});

const connectionSummary = computed(() => {
  if (!readiness.value) return '';
  const provider = readiness.value.provider.name || readiness.value.config.provider;
  const model = readiness.value.model.id || readiness.value.config.model;
  const parts = [provider ? `Provider: ${provider}` : '', model ? `Model: ${model}` : ''].filter(Boolean);
  if (readiness.value.connection.status === 'connected' && readiness.value.connection.latencyMs != null) {
    parts.push(`Độ trễ: ${readiness.value.connection.latencyMs} ms`);
  }
  return parts.join(' · ');
});

function safeLoadError(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 403) return 'Bạn không có quyền xem cấu hình AI.';
  if (status === 404) return 'Máy chủ chưa hỗ trợ kiểm tra trạng thái AI.';
  return 'Không kết nối được máy chủ. Không có API key hoặc dữ liệu nhạy cảm nào được hiển thị.';
}

async function refresh() {
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  loadError.value = '';
  try {
    const result = await getAiReadiness(controller.signal);
    readiness.value = result;
    emit('loaded', result);
  } catch (error) {
    if ((error as { name?: string })?.name !== 'CanceledError') {
      loadError.value = safeLoadError(error);
    }
  } finally {
    loading.value = false;
  }
}

async function testConnection() {
  const providerId = readiness.value?.provider.id;
  if (!providerId || testing.value) return;
  testing.value = true;
  loadError.value = '';
  try {
    await testAiProviderConnection(providerId, readiness.value?.config.model);
    await refresh();
  } catch (error) {
    loadError.value = safeLoadError(error);
  } finally {
    testing.value = false;
  }
}

onMounted(() => {
  if (props.autoLoad) void refresh();
});

onBeforeUnmount(() => controller?.abort());

defineExpose({ refresh });
</script>

<style scoped>
.ai-readiness {
  --readiness-bg: #f8fafc;
  --readiness-border: #cbd5e1;
  --readiness-accent: #475569;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 13px 14px;
  border: 1px solid var(--readiness-border);
  border-left: 4px solid var(--readiness-accent);
  border-radius: 10px;
  background: var(--readiness-bg);
  color: #0f172a;
}

.ai-readiness--ready {
  --readiness-bg: #f0fdf4;
  --readiness-border: #bbf7d0;
  --readiness-accent: #15803d;
}

.ai-readiness--degraded,
.ai-readiness--not-configured {
  --readiness-bg: #fffbeb;
  --readiness-border: #fde68a;
  --readiness-accent: #b45309;
}

.ai-readiness--error {
  --readiness-bg: #fff1f2;
  --readiness-border: #fecdd3;
  --readiness-accent: #be123c;
}

.ai-readiness__icon {
  flex: 0 0 auto;
  color: var(--readiness-accent);
}

.ai-readiness__body {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  line-height: 1.45;
}

.ai-readiness__title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.ai-readiness__body > span {
  color: #475569;
}

.ai-readiness__summary {
  font-size: 12px;
  font-weight: 600;
  color: #334155 !important;
}

.ai-readiness__badge {
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--readiness-accent) 12%, white);
  color: var(--readiness-accent);
  font-size: 11px;
  font-weight: 700;
}

.ai-readiness__checks {
  margin: 3px 0 0;
  padding-left: 18px;
  color: #334155;
  font-size: 12px;
}

.ai-readiness__checks li + li {
  margin-top: 2px;
}

.ai-readiness__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
}

.ai-readiness__button {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  background: #fff;
  color: #334155;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

.ai-readiness__button:hover:not(:disabled) {
  border-color: var(--readiness-accent);
  color: var(--readiness-accent);
}

.ai-readiness__button--primary {
  border-color: var(--readiness-accent);
  background: var(--readiness-accent);
  color: #fff;
}

.ai-readiness__button--primary:hover {
  color: #fff;
  filter: brightness(.94);
}

.ai-readiness__button:disabled {
  cursor: wait;
  opacity: .65;
}

.ai-readiness__spinner {
  width: 21px;
  height: 21px;
  flex: 0 0 auto;
  border: 2px solid #cbd5e1;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: ai-readiness-spin .8s linear infinite;
}

@keyframes ai-readiness-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 700px) {
  .ai-readiness { flex-wrap: wrap; }
  .ai-readiness__actions { width: 100%; justify-content: flex-start; padding-left: 35px; }
}

@media (prefers-reduced-motion: reduce) {
  .ai-readiness__spinner { animation: none; }
}
</style>

