<template>
  <section class="models-connections" aria-labelledby="models-connections-title">
    <header class="page-header">
      <div>
        <h2 id="models-connections-title">Mô hình & kết nối API</h2>
        <p>Kết nối nhà cung cấp, kiểm tra khả năng hoạt động và quản lý mô hình dùng chung cho AI.</p>
      </div>
      <button class="button secondary" type="button" :disabled="isRefreshing" @click="refreshAll">
        <span aria-hidden="true">↻</span>
        {{ isRefreshing ? 'Đang tải…' : 'Làm mới' }}
      </button>
    </header>

    <div class="section-tabs" role="tablist" aria-label="Cấu hình AI">
      <button
        id="connections-tab"
        type="button"
        role="tab"
        :aria-selected="activeTab === 'connections'"
        aria-controls="connections-panel"
        :class="{ active: activeTab === 'connections' }"
        @click="activeTab = 'connections'"
      >
        Kết nối API
        <span class="count">{{ connections.length }}</span>
      </button>
      <button
        id="models-tab"
        type="button"
        role="tab"
        :aria-selected="activeTab === 'models'"
        aria-controls="models-panel"
        :class="{ active: activeTab === 'models' }"
        @click="activeTab = 'models'"
      >
        Mô hình
        <span class="count">{{ models.length }}</span>
      </button>
    </div>

    <div v-if="notice.message" class="notice" :class="notice.tone" role="status">
      <span class="notice-icon" aria-hidden="true">{{ notice.tone === 'success' ? '✓' : '!' }}</span>
      <span>{{ notice.message }}</span>
      <button type="button" aria-label="Đóng thông báo" @click="clearNotice">×</button>
    </div>

    <div v-if="readiness" class="readiness" :class="readiness.tone">
      <span class="readiness-icon" aria-hidden="true">{{ readiness.icon }}</span>
      <div>
        <strong>{{ readiness.title }}</strong>
        <p>{{ readiness.description }}</p>
      </div>
      <button class="button secondary" type="button" @click="readiness.action">
        {{ readiness.actionLabel }}
      </button>
    </div>

    <div
      v-show="activeTab === 'connections'"
      id="connections-panel"
      role="tabpanel"
      aria-labelledby="connections-tab"
      class="tab-panel"
    >
      <div class="toolbar">
        <div>
          <h3>Kết nối API</h3>
          <p>Mỗi API key được lưu riêng, không hiển thị lại sau khi lưu.</p>
        </div>
        <button class="button primary" type="button" @click="openCreateConnection">
          <span aria-hidden="true">＋</span> Thêm kết nối
        </button>
      </div>

      <div v-if="connectionsLoading" class="skeleton-grid" aria-label="Đang tải kết nối">
        <div v-for="index in 2" :key="index" class="skeleton-card" />
      </div>

      <div v-else-if="connectionsForbidden" class="state-card forbidden" role="alert">
        <span class="state-icon" aria-hidden="true">🔒</span>
        <h4>Bạn chưa có quyền xem kết nối API</h4>
        <p>Nhờ quản trị viên cấp quyền xem cấu hình AI. API key luôn được bảo vệ bằng quyền riêng.</p>
      </div>

      <div v-else-if="connectionsError" class="state-card error" role="alert">
        <span class="state-icon" aria-hidden="true">!</span>
        <h4>Không tải được kết nối</h4>
        <p>{{ connectionsError }}</p>
        <button class="button secondary" type="button" @click="loadConnections">Thử lại</button>
      </div>

      <div v-else-if="connections.length === 0" class="state-card empty">
        <span class="state-icon" aria-hidden="true">⌁</span>
        <h4>Chưa có kết nối API</h4>
        <p>Thêm 9Router hoặc một endpoint tương thích OpenAI để bắt đầu cấu hình mô hình.</p>
        <button class="button primary" type="button" @click="openCreateConnection">Thêm kết nối đầu tiên</button>
      </div>

      <div v-else class="card-grid">
        <article v-for="connection in connections" :key="connection.id" class="config-card">
          <header class="card-header">
            <div class="identity">
              <span class="provider-mark" aria-hidden="true">{{ providerInitial(connection) }}</span>
              <div>
                <h4>{{ connection.name }}</h4>
                <p>{{ providerLabel(connection) }}</p>
              </div>
            </div>
            <span class="status-badge" :class="connectionStatusMeta(connection.status).tone">
              <span aria-hidden="true">{{ connectionStatusMeta(connection.status).icon }}</span>
              {{ connectionStatusMeta(connection.status).label }}
            </span>
          </header>

          <dl class="details">
            <div>
              <dt>Endpoint</dt>
              <dd class="truncate" :title="connection.baseUrl || 'Mặc định theo adapter'">
                {{ connection.baseUrl || 'Mặc định theo adapter' }}
              </dd>
            </div>
            <div>
              <dt>API key</dt>
              <dd>
                <span v-if="connection.apiKeyConfigured">•••• {{ connection.apiKeyLast4 || 'đã lưu' }}</span>
                <span v-else class="danger-text">Chưa cấu hình</span>
              </dd>
            </div>
            <div>
              <dt>Kiểm tra gần nhất</dt>
              <dd>{{ formatDate(connection.lastTestedAt) }}</dd>
            </div>
            <div>
              <dt>Độ trễ</dt>
              <dd>{{ connection.lastLatencyMs == null ? '—' : `${connection.lastLatencyMs} ms` }}</dd>
            </div>
          </dl>

          <p v-if="connection.lastErrorCode" class="inline-error">
            <span aria-hidden="true">!</span>
            {{ connectionErrorLabel(connection.lastErrorCode) }}
          </p>

          <div class="impact-line">
            <span>{{ connection.modelConfigCount }} mô hình đang liên kết</span>
            <span>Phiên bản khóa {{ connection.credentialVersion }}</span>
          </div>

          <footer class="card-actions">
            <button
              class="button primary compact"
              type="button"
              :disabled="busyConnectionId === connection.id || !connection.apiKeyConfigured"
              @click="testConnection(connection)"
            >
              {{ busyConnectionId === connection.id ? 'Đang kiểm tra…' : 'Kiểm tra' }}
            </button>
            <button
              class="button secondary compact"
              type="button"
              :disabled="busyConnectionId === connection.id || !connection.apiKeyConfigured"
              @click="discoverConnectionModels(connection)"
            >
              Xem mô hình
            </button>
            <button class="button ghost compact" type="button" @click="openEditConnection(connection)">Sửa</button>
            <button class="button ghost compact" type="button" @click="openSecretDialog(connection)">
              {{ connection.apiKeyConfigured ? 'Xoay khóa' : 'Thêm khóa' }}
            </button>
          </footer>
        </article>
      </div>
    </div>

    <div
      v-show="activeTab === 'models'"
      id="models-panel"
      role="tabpanel"
      aria-labelledby="models-tab"
      class="tab-panel"
    >
      <div class="toolbar">
        <div>
          <h3>Mô hình</h3>
          <p>Chỉ mô hình đã kiểm tra và phê duyệt mới được dùng trong luồng AI.</p>
        </div>
        <button
          class="button primary"
          type="button"
          :disabled="connectedConnections.length === 0"
          @click="openCreateModel()"
        >
          <span aria-hidden="true">＋</span> Thêm mô hình
        </button>
      </div>

      <div v-if="modelsLoading" class="skeleton-grid" aria-label="Đang tải mô hình">
        <div v-for="index in 2" :key="index" class="skeleton-card" />
      </div>

      <div v-else-if="modelsForbidden" class="state-card forbidden" role="alert">
        <span class="state-icon" aria-hidden="true">🔒</span>
        <h4>Bạn chưa có quyền xem mô hình</h4>
        <p>Bạn vẫn có thể sử dụng các tính năng AI được quản trị viên phân quyền.</p>
      </div>

      <div v-else-if="modelsError" class="state-card error" role="alert">
        <span class="state-icon" aria-hidden="true">!</span>
        <h4>Không tải được danh sách mô hình</h4>
        <p>{{ modelsError }}</p>
        <button class="button secondary" type="button" @click="loadModels">Thử lại</button>
      </div>

      <div v-else-if="models.length === 0" class="state-card empty">
        <span class="state-icon" aria-hidden="true">◇</span>
        <h4>Chưa có mô hình AI</h4>
        <p v-if="connectedConnections.length === 0">Hãy kiểm tra thành công một kết nối API trước.</p>
        <p v-else>Chọn mô hình từ kết nối đã xác minh để đưa vào quy trình kiểm tra và phê duyệt.</p>
        <button
          class="button primary"
          type="button"
          @click="connectedConnections.length ? openCreateModel() : (activeTab = 'connections')"
        >
          {{ connectedConnections.length ? 'Thêm mô hình đầu tiên' : 'Đi tới kết nối API' }}
        </button>
      </div>

      <div v-else class="models-table-wrap">
        <table class="models-table">
          <thead>
            <tr>
              <th>Mô hình</th>
              <th>Kết nối</th>
              <th>Khả năng</th>
              <th>Trạng thái</th>
              <th>Cập nhật</th>
              <th><span class="sr-only">Thao tác</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="model in models" :key="model.id">
              <td data-label="Mô hình">
                <div class="model-name">
                  <strong>{{ model.displayName }}</strong>
                  <span>{{ model.externalModelId }} · v{{ model.version }}</span>
                  <span v-if="model.isDefault" class="default-label">Mặc định</span>
                </div>
              </td>
              <td data-label="Kết nối">{{ modelConnectionName(model) }}</td>
              <td data-label="Khả năng">
                <div class="capabilities">
                  <span v-for="capability in capabilityLabels(model.capabilities)" :key="capability">
                    {{ capability }}
                  </span>
                  <span v-if="capabilityLabels(model.capabilities).length === 0" class="muted">Chưa khai báo</span>
                </div>
              </td>
              <td data-label="Trạng thái">
                <span class="status-badge" :class="modelStatusMeta(model.status).tone">
                  <span aria-hidden="true">{{ modelStatusMeta(model.status).icon }}</span>
                  {{ modelStatusMeta(model.status).label }}
                </span>
              </td>
              <td data-label="Cập nhật">{{ formatDate(model.updatedAt) }}</td>
              <td class="model-actions">
                <button
                  v-if="canEditModel(model)"
                  class="text-action"
                  type="button"
                  @click="openEditModel(model)"
                >Sửa</button>
                <button
                  v-if="model.status === 'draft' || model.status === 'testing'"
                  class="text-action"
                  type="button"
                  :disabled="busyModelId === model.id"
                  @click="runModelTest(model)"
                >Kiểm tra</button>
                <button
                  v-if="model.status === 'testing'"
                  class="text-action"
                  type="button"
                  :disabled="busyModelId === model.id"
                  @click="runModelAction(model, 'submit')"
                >Gửi duyệt</button>
                <button
                  v-if="model.status === 'submitted'"
                  class="text-action"
                  type="button"
                  :disabled="busyModelId === model.id"
                  @click="runModelAction(model, 'approve')"
                >Phê duyệt</button>
                <button
                  v-if="model.status === 'approved' && !model.isDefault"
                  class="text-action"
                  type="button"
                  :disabled="busyModelId === model.id"
                  @click="runModelAction(model, 'default')"
                >Đặt mặc định</button>
                <button
                  class="text-action"
                  type="button"
                  :disabled="busyModelId === model.id"
                  @click="runModelAction(model, 'clone')"
                >Nhân bản</button>
                <button
                  v-if="model.status !== 'archived'"
                  class="text-action danger"
                  type="button"
                  :disabled="busyModelId === model.id || model.isDefault"
                  :title="model.isDefault ? 'Hãy chọn mô hình mặc định khác trước khi lưu trữ.' : undefined"
                  @click="runModelAction(model, 'archive')"
                >Lưu trữ</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="connectionDialog.open" class="dialog-backdrop" @click.self="closeConnectionDialog">
      <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="connection-dialog-title" @submit.prevent="saveConnection">
        <header>
          <div>
            <h3 id="connection-dialog-title">{{ connectionDialog.id ? 'Sửa kết nối' : 'Thêm kết nối API' }}</h3>
            <p>API key được thêm ở bước riêng sau khi lưu thông tin kết nối.</p>
          </div>
          <button class="icon-button" type="button" aria-label="Đóng" @click="closeConnectionDialog">×</button>
        </header>

        <div class="form-grid">
          <label class="field full">
            <span>Tên hiển thị <b aria-hidden="true">*</b></span>
            <input v-model.trim="connectionDialog.name" required maxlength="160" placeholder="Ví dụ: 9Router nội bộ" />
          </label>

          <label class="field">
            <span>Loại kết nối <b aria-hidden="true">*</b></span>
            <select v-model="connectionDialog.preset" :disabled="Boolean(connectionDialog.id)" @change="applyConnectionPreset">
              <option value="9router">9Router</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
          </label>

          <label class="field">
            <span>Mã kết nối <b aria-hidden="true">*</b></span>
            <input
              v-model.trim="connectionDialog.key"
              required
              maxlength="80"
              pattern="[a-z0-9][a-z0-9_.-]{1,79}"
              :disabled="Boolean(connectionDialog.id)"
              placeholder="9router-primary"
            />
            <small>Dùng chữ thường, số, dấu gạch ngang hoặc gạch dưới.</small>
          </label>

          <label class="field full">
            <span>Base URL <b aria-hidden="true">*</b></span>
            <input v-model.trim="connectionDialog.baseUrl" required type="url" placeholder="http://host.docker.internal:20128/v1" />
            <small>Nếu 9Router chạy trên Windows host, container dùng host.docker.internal thay cho localhost.</small>
          </label>
        </div>

        <p v-if="connectionDialog.error" class="form-error" role="alert">{{ connectionDialog.error }}</p>

        <footer>
          <button class="button secondary" type="button" :disabled="connectionDialog.saving" @click="closeConnectionDialog">Hủy</button>
          <button class="button primary" type="submit" :disabled="connectionDialog.saving">
            {{ connectionDialog.saving ? 'Đang lưu…' : 'Lưu kết nối' }}
          </button>
        </footer>
      </form>
    </div>

    <div v-if="secretDialog.open" class="dialog-backdrop" @click.self="closeSecretDialog">
      <form class="dialog narrow" role="dialog" aria-modal="true" aria-labelledby="secret-dialog-title" @submit.prevent="saveSecret">
        <header>
          <div>
            <h3 id="secret-dialog-title">{{ secretDialog.hasSecret ? 'Xoay API key' : 'Thêm API key' }}</h3>
            <p>{{ secretDialog.connectionName }}</p>
          </div>
          <button class="icon-button" type="button" aria-label="Đóng" @click="closeSecretDialog">×</button>
        </header>

        <div class="security-callout">
          <span aria-hidden="true">🔐</span>
          <p>Khóa chỉ được gửi một lần để mã hóa. Bạn sẽ không thể xem hoặc sao chép lại sau khi lưu.</p>
        </div>

        <label class="field full">
          <span>API key mới <b aria-hidden="true">*</b></span>
          <div class="password-field">
            <input
              v-model="secretDialog.apiKey"
              required
              minlength="4"
              autocomplete="new-password"
              :type="secretDialog.reveal ? 'text' : 'password'"
              placeholder="Nhập API key"
            />
            <button type="button" @click="secretDialog.reveal = !secretDialog.reveal">
              {{ secretDialog.reveal ? 'Ẩn' : 'Hiện' }}
            </button>
          </div>
        </label>

        <label class="confirm-line">
          <input v-model="secretDialog.confirmed" type="checkbox" />
          <span v-if="secretDialog.hasSecret">Tôi hiểu khóa hiện tại sẽ ngừng được sử dụng sau khi xoay khóa.</span>
          <span v-else>Tôi xác nhận đây là khóa dành cho kết nối này.</span>
        </label>

        <p v-if="secretDialog.error" class="form-error" role="alert">{{ secretDialog.error }}</p>

        <footer>
          <button class="button secondary" type="button" :disabled="secretDialog.saving" @click="closeSecretDialog">Hủy</button>
          <button class="button primary" type="submit" :disabled="secretDialog.saving || !secretDialog.confirmed">
            {{ secretDialog.saving ? 'Đang lưu…' : 'Lưu & kiểm tra' }}
          </button>
        </footer>
      </form>
    </div>

    <div v-if="discoveryDialog.open" class="dialog-backdrop" @click.self="closeDiscoveryDialog">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="discovery-dialog-title">
        <header>
          <div>
            <h3 id="discovery-dialog-title">Mô hình từ {{ discoveryDialog.connectionName }}</h3>
            <p>Chọn một mô hình để tạo cấu hình quản trị.</p>
          </div>
          <button class="icon-button" type="button" aria-label="Đóng" @click="closeDiscoveryDialog">×</button>
        </header>

        <div v-if="discoveryDialog.loading" class="discovery-state">Đang tải danh sách mô hình…</div>
        <div v-else-if="discoveryDialog.error" class="state-card error compact-state" role="alert">
          <h4>Không lấy được danh sách</h4>
          <p>{{ discoveryDialog.error }}</p>
        </div>
        <div v-else-if="discoveryDialog.models.length === 0" class="discovery-state">
          Kết nối không trả về mô hình nào.
        </div>
        <div v-else class="discovered-list">
          <button
            v-for="model in discoveryDialog.models"
            :key="model.id"
            type="button"
            @click="selectDiscoveredModel(model)"
          >
            <span><strong>{{ model.name }}</strong><small>{{ model.id }}</small></span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>
    </div>

    <div v-if="modelDialog.open" class="dialog-backdrop" @click.self="closeModelDialog">
      <form class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="model-dialog-title" @submit.prevent="saveModel">
        <header>
          <div>
            <h3 id="model-dialog-title">{{ modelDialog.id ? 'Sửa mô hình' : 'Thêm mô hình' }}</h3>
            <p>Lưu bản nháp trước khi kiểm tra và gửi phê duyệt.</p>
          </div>
          <button class="icon-button" type="button" aria-label="Đóng" @click="closeModelDialog">×</button>
        </header>

        <div class="form-grid">
          <label class="field full">
            <span>Kết nối <b aria-hidden="true">*</b></span>
            <select v-model="modelDialog.connectionId" required @change="onModelConnectionChange">
              <option value="" disabled>Chọn kết nối đã xác minh</option>
              <option
                v-for="connection in modelDialogConnections"
                :key="connection.id"
                :value="connection.id"
                :disabled="connection.status !== 'connected' && connection.id !== modelDialog.connectionId"
              >
                {{ connection.name }}{{ connection.status === 'connected' ? '' : ' — không sẵn sàng' }}
              </option>
            </select>
          </label>

          <label class="field">
            <span>Tên hiển thị <b aria-hidden="true">*</b></span>
            <input v-model.trim="modelDialog.displayName" required maxlength="160" placeholder="Ví dụ: Trợ lý bán hàng" />
          </label>

          <label class="field">
            <span>Mã logic <b aria-hidden="true">*</b></span>
            <input v-model.trim="modelDialog.logicalKey" required maxlength="80" pattern="[a-z0-9][a-z0-9_.-]{1,79}" placeholder="sales-assistant" />
          </label>

          <label class="field full">
            <span>Model ID <b aria-hidden="true">*</b></span>
            <div class="select-with-action">
              <input v-model.trim="modelDialog.externalModelId" required maxlength="256" list="discovered-model-options" placeholder="Chọn hoặc nhập model ID" />
              <button class="button secondary" type="button" :disabled="!modelDialog.connectionId || modelDialog.discovering" @click="discoverForModelDialog">
                {{ modelDialog.discovering ? 'Đang tải…' : 'Tải từ API' }}
              </button>
            </div>
            <datalist id="discovered-model-options">
              <option v-for="model in modelDialog.discoveredModels" :key="model.id" :value="model.id">{{ model.name }}</option>
            </datalist>
          </label>

          <fieldset class="field full capabilities-field">
            <legend>Khả năng</legend>
            <div>
              <label><input v-model="modelDialog.capabilities.text" type="checkbox" /> Văn bản</label>
              <label><input v-model="modelDialog.capabilities.vision" type="checkbox" /> Hình ảnh</label>
              <label><input v-model="modelDialog.capabilities.tools" type="checkbox" /> Công cụ</label>
              <label><input v-model="modelDialog.capabilities.structuredOutput" type="checkbox" /> Dữ liệu có cấu trúc</label>
              <label><input v-model="modelDialog.capabilities.embeddings" type="checkbox" /> Embedding</label>
            </div>
          </fieldset>

          <label class="field">
            <span>Context window</span>
            <input v-model.number="modelDialog.contextWindow" type="number" min="1" step="1" placeholder="128000" />
          </label>

          <label class="field">
            <span>Output token tối đa</span>
            <input v-model.number="modelDialog.maxOutputTokens" type="number" min="1" step="1" placeholder="4096" />
          </label>

          <label class="field">
            <span>Temperature</span>
            <input v-model.number="modelDialog.temperature" type="number" min="0" max="2" step="0.1" placeholder="0.2" />
          </label>

          <label class="field">
            <span>Timeout (ms)</span>
            <input v-model.number="modelDialog.timeoutMs" type="number" min="1000" max="120000" step="1000" placeholder="30000" />
          </label>

          <label class="field full">
            <span>Ngân sách token/ngày</span>
            <input v-model.number="modelDialog.dailyTokenBudget" type="number" min="0" step="1000" placeholder="Để trống nếu chưa giới hạn" />
          </label>
        </div>

        <p v-if="modelDialog.error" class="form-error" role="alert">{{ modelDialog.error }}</p>

        <footer>
          <button class="button secondary" type="button" :disabled="modelDialog.saving" @click="closeModelDialog">Hủy</button>
          <button class="button primary" type="submit" :disabled="modelDialog.saving">
            {{ modelDialog.saving ? 'Đang lưu…' : 'Lưu bản nháp' }}
          </button>
        </footer>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  AiConfigurationApiError,
  aiModelConnectionsApi,
  type AiModelCapabilities,
  type AiModelConfig,
  type DiscoveredModel,
  type ModelConfigStatus,
  type ProviderConnection,
  type ProviderConnectionStatus,
} from '@/api/ai-model-connections'

type TabKey = 'connections' | 'models'
type NoticeTone = 'success' | 'error' | 'warning'
type ModelAction = 'clone' | 'submit' | 'approve' | 'archive' | 'default'

const activeTab = ref<TabKey>('connections')
const connections = ref<ProviderConnection[]>([])
const models = ref<AiModelConfig[]>([])
const defaultModelConfigId = ref<string | null>(null)
const aiConfigRevision = ref<string | null>(null)
const connectionsLoading = ref(true)
const modelsLoading = ref(true)
const connectionsError = ref('')
const modelsError = ref('')
const connectionsForbidden = ref(false)
const modelsForbidden = ref(false)
const busyConnectionId = ref<string | null>(null)
const busyModelId = ref<string | null>(null)
const notice = reactive<{ tone: NoticeTone; message: string }>({ tone: 'success', message: '' })

const connectionDialog = reactive({
  open: false,
  id: '',
  name: '',
  key: '',
  preset: '9router',
  adapter: 'openai_compatible',
  vendor: '9router',
  baseUrl: 'http://host.docker.internal:20128/v1',
  saving: false,
  error: '',
})

const secretDialog = reactive({
  open: false,
  connectionId: '',
  connectionName: '',
  hasSecret: false,
  apiKey: '',
  confirmed: false,
  reveal: false,
  saving: false,
  error: '',
})

const discoveryDialog = reactive({
  open: false,
  connectionId: '',
  connectionName: '',
  loading: false,
  error: '',
  models: [] as DiscoveredModel[],
})

const emptyCapabilities = (): AiModelCapabilities => ({
  text: true,
  vision: false,
  tools: false,
  structuredOutput: false,
  embeddings: false,
})

const modelDialog = reactive({
  open: false,
  id: '',
  revision: 0,
  connectionId: '',
  logicalKey: '',
  displayName: '',
  externalModelId: '',
  parameters: {} as Record<string, unknown>,
  capabilities: emptyCapabilities(),
  contextWindow: null as number | null,
  maxOutputTokens: null as number | null,
  temperature: 0.2 as number | null,
  timeoutMs: 30000 as number | null,
  dailyTokenBudget: null as number | null,
  discoveredModels: [] as DiscoveredModel[],
  discovering: false,
  saving: false,
  error: '',
})

const connectedConnections = computed(() => connections.value.filter((item) => item.status === 'connected'))
const modelDialogConnections = computed(() => [...connections.value].sort((left, right) => {
  if (left.id === modelDialog.connectionId) return -1
  if (right.id === modelDialog.connectionId) return 1
  if (left.status === 'connected' && right.status !== 'connected') return -1
  if (right.status === 'connected' && left.status !== 'connected') return 1
  return left.name.localeCompare(right.name, 'vi')
}))
const isRefreshing = computed(() => connectionsLoading.value || modelsLoading.value)

const readiness = computed(() => {
  if (
    connectionsLoading.value
    || modelsLoading.value
    || connectionsForbidden.value
    || modelsForbidden.value
    || Boolean(connectionsError.value)
    || Boolean(modelsError.value)
  ) return null
  if (connections.value.length === 0) {
    return {
      tone: 'warning', icon: '1', title: 'AI chưa thể hoạt động',
      description: 'Chưa có kết nối API. Hãy thêm 9Router hoặc nhà cung cấp tương thích.',
      actionLabel: 'Thêm kết nối', action: openCreateConnection,
    }
  }
  if (connectedConnections.value.length === 0) {
    return {
      tone: 'warning', icon: '2', title: 'Kết nối chưa sẵn sàng',
      description: 'Thêm API key và kiểm tra kết nối thành công trước khi tạo mô hình.',
      actionLabel: 'Kiểm tra kết nối', action: () => { activeTab.value = 'connections' },
    }
  }
  const defaultModel = models.value.find((model) => (
    model.id === defaultModelConfigId.value || model.isDefault
  ))
  if (!defaultModel) {
    return {
      tone: 'info', icon: '3', title: 'Chưa có mô hình mặc định',
      description: models.value.length
        ? 'Kiểm tra, phê duyệt và đặt làm mặc định. Đưa vào Production tại Áp dụng & khôi phục.'
        : 'Tạo mô hình từ kết nối đã xác minh.',
      actionLabel: models.value.length ? 'Xem mô hình' : 'Thêm mô hình',
      action: () => { activeTab.value = 'models'; if (!models.value.length) openCreateModel() },
    }
  }
  if (
    defaultModel.connectionId
    && !connections.value.some((connection) => (
      connection.id === defaultModel.connectionId && connection.status === 'connected'
    ))
  ) {
    return {
      tone: 'warning', icon: '!', title: 'Mô hình mặc định chưa sẵn sàng',
      description: 'Kết nối của mô hình mặc định đang lỗi hoặc đã bị tắt. Hãy kiểm tra kết nối hoặc chọn mô hình khác.',
      actionLabel: 'Kiểm tra cấu hình', action: () => { activeTab.value = 'connections' },
    }
  }
  return null
})

function errorText(error: unknown, fallback: string): string {
  if (error instanceof AiConfigurationApiError) {
    const known: Record<string, string> = {
      AI_SECRET_MISSING: 'Kết nối chưa có API key.',
      AI_CONNECTION_AUTH_FAILED: 'API key không hợp lệ hoặc đã hết hiệu lực.',
      AI_CONNECTION_TIMEOUT: 'Kết nối quá thời gian chờ. Hãy kiểm tra endpoint.',
      AI_CONNECTION_RATE_LIMITED: 'Nhà cung cấp đang giới hạn yêu cầu. Hãy thử lại sau.',
      AI_BASE_URL_NOT_ALLOWED: 'Endpoint này không được chính sách bảo mật cho phép.',
      AI_MODEL_NOT_FOUND: 'Không tìm thấy mô hình trên kết nối đã chọn.',
      AI_MODEL_NOT_APPROVED: 'Mô hình chưa được phê duyệt.',
      AI_MODEL_CAPABILITY_MISMATCH: 'Mô hình không hỗ trợ khả năng được khai báo.',
    }
    return (error.code && known[error.code]) || error.message || fallback
  }
  return error instanceof Error ? error.message : fallback
}

function isForbidden(error: unknown): boolean {
  return error instanceof AiConfigurationApiError && error.status === 403
}

async function loadConnections(): Promise<void> {
  connectionsLoading.value = true
  connectionsError.value = ''
  connectionsForbidden.value = false
  try {
    connections.value = await aiModelConnectionsApi.listConnections()
  } catch (error) {
    if (isForbidden(error)) connectionsForbidden.value = true
    else connectionsError.value = errorText(error, 'Không thể tải kết nối API.')
  } finally {
    connectionsLoading.value = false
  }
}

async function loadModels(): Promise<void> {
  modelsLoading.value = true
  modelsError.value = ''
  modelsForbidden.value = false
  try {
    const result = await aiModelConnectionsApi.listModelConfigs()
    models.value = result.modelConfigs
    defaultModelConfigId.value = result.defaultModelConfigId
    aiConfigRevision.value = result.aiConfigRevision
  } catch (error) {
    if (isForbidden(error)) modelsForbidden.value = true
    else modelsError.value = errorText(error, 'Không thể tải mô hình.')
  } finally {
    modelsLoading.value = false
  }
}

async function refreshAll(): Promise<void> {
  await Promise.all([loadConnections(), loadModels()])
}

function clearNotice(): void {
  notice.message = ''
}

function showNotice(message: string, tone: NoticeTone = 'success'): void {
  notice.tone = tone
  notice.message = message
}

function resetConnectionDialog(): void {
  Object.assign(connectionDialog, {
    open: false, id: '', name: '', key: '', preset: '9router', adapter: 'openai_compatible',
    vendor: '9router', baseUrl: 'http://host.docker.internal:20128/v1', saving: false, error: '',
  })
}

function openCreateConnection(): void {
  activeTab.value = 'connections'
  resetConnectionDialog()
  connectionDialog.open = true
}

function openEditConnection(connection: ProviderConnection): void {
  Object.assign(connectionDialog, {
    open: true,
    id: connection.id,
    name: connection.name,
    key: connection.key,
    preset: connection.vendor === '9router' ? '9router' : 'openai-compatible',
    adapter: connection.adapter,
    vendor: connection.vendor || '',
    baseUrl: connection.baseUrl || '',
    saving: false,
    error: '',
  })
}

function closeConnectionDialog(): void {
  if (!connectionDialog.saving) resetConnectionDialog()
}

function applyConnectionPreset(): void {
  if (connectionDialog.preset === '9router') {
    connectionDialog.adapter = 'openai_compatible'
    connectionDialog.vendor = '9router'
    connectionDialog.baseUrl = 'http://host.docker.internal:20128/v1'
    if (!connectionDialog.key) connectionDialog.key = '9router-primary'
  } else {
    connectionDialog.adapter = 'openai_compatible'
    connectionDialog.vendor = ''
    connectionDialog.baseUrl = ''
  }
}

async function saveConnection(): Promise<void> {
  connectionDialog.saving = true
  connectionDialog.error = ''
  try {
    let saved: ProviderConnection
    if (connectionDialog.id) {
      saved = await aiModelConnectionsApi.updateConnection(connectionDialog.id, {
        name: connectionDialog.name,
        adapter: connectionDialog.adapter,
        vendor: connectionDialog.vendor || null,
        baseUrl: connectionDialog.baseUrl,
      })
    } else {
      saved = await aiModelConnectionsApi.createConnection({
        name: connectionDialog.name,
        key: connectionDialog.key,
        adapter: connectionDialog.adapter,
        vendor: connectionDialog.vendor || null,
        baseUrl: connectionDialog.baseUrl,
      })
    }
    const created = !connectionDialog.id
    resetConnectionDialog()
    await loadConnections()
    showNotice(created ? 'Đã tạo kết nối. Hãy thêm API key để kiểm tra.' : 'Đã cập nhật kết nối.')
    if (created && saved?.id) openSecretDialog(saved)
  } catch (error) {
    connectionDialog.error = isForbidden(error)
      ? 'Bạn có thể xem nhưng chưa có quyền tạo hoặc sửa kết nối.'
      : errorText(error, 'Không thể lưu kết nối.')
  } finally {
    connectionDialog.saving = false
  }
}

function openSecretDialog(connection: ProviderConnection): void {
  Object.assign(secretDialog, {
    open: true,
    connectionId: connection.id,
    connectionName: connection.name,
    hasSecret: connection.apiKeyConfigured,
    apiKey: '',
    confirmed: false,
    reveal: false,
    saving: false,
    error: '',
  })
}

function closeSecretDialog(): void {
  if (secretDialog.saving) return
  Object.assign(secretDialog, {
    open: false, connectionId: '', connectionName: '', hasSecret: false, apiKey: '',
    confirmed: false, reveal: false, saving: false, error: '',
  })
}

async function saveSecret(): Promise<void> {
  if (!secretDialog.confirmed) return
  secretDialog.saving = true
  secretDialog.error = ''
  const connectionId = secretDialog.connectionId
  try {
    await aiModelConnectionsApi.updateConnectionSecret(connectionId, secretDialog.apiKey)
    secretDialog.saving = false
    closeSecretDialog()
    await loadConnections()
    showNotice('API key đã được mã hóa. Đang kiểm tra kết nối…')
    const connection = connections.value.find((item) => item.id === connectionId)
    if (connection) await testConnection(connection)
  } catch (error) {
    secretDialog.error = isForbidden(error)
      ? 'Bạn chưa có quyền quản lý API key.'
      : errorText(error, 'Không thể lưu API key.')
  } finally {
    secretDialog.saving = false
  }
}

async function testConnection(connection: ProviderConnection): Promise<void> {
  busyConnectionId.value = connection.id
  clearNotice()
  try {
    const result = await aiModelConnectionsApi.testConnection(connection.id)
    await loadConnections()
    if (result.probe.completionVerified) {
      showNotice('Kết nối và phản hồi hoàn chỉnh hoạt động bình thường.')
    } else {
      showNotice('Đã kết nối và đọc được model nhưng chưa xác minh được phản hồi hoàn chỉnh.', 'warning')
    }
  } catch (error) {
    showNotice(
      isForbidden(error) ? 'Bạn chưa có quyền kiểm tra kết nối.' : errorText(error, 'Kiểm tra kết nối thất bại.'),
      'error',
    )
    await loadConnections()
  } finally {
    busyConnectionId.value = null
  }
}

function openDiscoveryDialog(connection: ProviderConnection): void {
  Object.assign(discoveryDialog, {
    open: true,
    connectionId: connection.id,
    connectionName: connection.name,
    loading: true,
    error: '',
    models: [],
  })
}

async function discoverConnectionModels(connection: ProviderConnection): Promise<void> {
  openDiscoveryDialog(connection)
  busyConnectionId.value = connection.id
  try {
    discoveryDialog.models = await aiModelConnectionsApi.discoverModels(connection.id)
  } catch (error) {
    discoveryDialog.error = isForbidden(error)
      ? 'Bạn chưa có quyền tải danh sách mô hình.'
      : errorText(error, 'Không thể tải danh sách mô hình.')
  } finally {
    discoveryDialog.loading = false
    busyConnectionId.value = null
  }
}

function closeDiscoveryDialog(): void {
  Object.assign(discoveryDialog, {
    open: false, connectionId: '', connectionName: '', loading: false, error: '', models: [],
  })
}

function selectDiscoveredModel(model: DiscoveredModel): void {
  const connectionId = discoveryDialog.connectionId
  closeDiscoveryDialog()
  openCreateModel(connectionId, model)
}

function resetModelDialog(): void {
  Object.assign(modelDialog, {
    open: false, id: '', revision: 0, connectionId: '', logicalKey: '', displayName: '', externalModelId: '',
    parameters: {},
    capabilities: emptyCapabilities(), contextWindow: null, maxOutputTokens: null, temperature: 0.2,
    timeoutMs: 30000, dailyTokenBudget: null, discoveredModels: [], discovering: false,
    saving: false, error: '',
  })
}

function openCreateModel(connectionId = connectedConnections.value[0]?.id || '', discovered?: DiscoveredModel): void {
  activeTab.value = 'models'
  resetModelDialog()
  Object.assign(modelDialog, {
    open: true,
    connectionId,
    externalModelId: discovered?.id || '',
    displayName: discovered?.name || '',
  })
}

function openEditModel(model: AiModelConfig): void {
  Object.assign(modelDialog, {
    open: true,
    id: model.id,
    revision: model.revision,
    connectionId: model.connectionId || '',
    logicalKey: model.logicalKey || '',
    displayName: model.displayName,
    externalModelId: model.externalModelId,
    parameters: { ...(model.parameters || {}) },
    capabilities: { ...emptyCapabilities(), ...model.capabilities },
    contextWindow: nullableNumber(model.parameters?.contextWindow),
    maxOutputTokens: nullableNumber(model.parameters?.maxOutputTokens),
    temperature: nullableNumber(model.parameters?.temperature),
    timeoutMs: nullableNumber(model.parameters?.timeoutMs),
    dailyTokenBudget: nullableNumber(model.parameters?.dailyTokenBudget),
    discoveredModels: [],
    discovering: false,
    saving: false,
    error: '',
  })
}

function closeModelDialog(): void {
  if (!modelDialog.saving) resetModelDialog()
}

function onModelConnectionChange(): void {
  modelDialog.externalModelId = ''
  modelDialog.discoveredModels = []
}

async function discoverForModelDialog(): Promise<void> {
  if (!modelDialog.connectionId) return
  modelDialog.discovering = true
  modelDialog.error = ''
  try {
    modelDialog.discoveredModels = await aiModelConnectionsApi.discoverModels(modelDialog.connectionId)
    if (modelDialog.discoveredModels.length === 0) modelDialog.error = 'Kết nối không trả về mô hình nào.'
  } catch (error) {
    modelDialog.error = errorText(error, 'Không thể tải mô hình từ API.')
  } finally {
    modelDialog.discovering = false
  }
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? null : Number(value)
}

async function saveModel(): Promise<void> {
  modelDialog.saving = true
  modelDialog.error = ''
  const input = {
    connectionId: modelDialog.connectionId,
    logicalKey: modelDialog.logicalKey,
    displayName: modelDialog.displayName,
    externalModelId: modelDialog.externalModelId,
    capabilities: { ...modelDialog.capabilities },
    parameters: {
      ...modelDialog.parameters,
      contextWindow: nullableNumber(modelDialog.contextWindow),
      maxOutputTokens: nullableNumber(modelDialog.maxOutputTokens),
      temperature: nullableNumber(modelDialog.temperature),
      timeoutMs: nullableNumber(modelDialog.timeoutMs),
      dailyTokenBudget: nullableNumber(modelDialog.dailyTokenBudget),
    },
  }
  try {
    if (modelDialog.id) {
      await aiModelConnectionsApi.updateModelConfig(modelDialog.id, {
        ...input,
        expectedRevision: modelDialog.revision,
      })
    }
    else await aiModelConnectionsApi.createModelConfig(input)
    resetModelDialog()
    await loadModels()
    showNotice('Đã lưu bản nháp mô hình. Hãy kiểm tra trước khi gửi duyệt.')
  } catch (error) {
    modelDialog.error = isForbidden(error)
      ? 'Bạn có thể xem nhưng chưa có quyền tạo hoặc sửa mô hình.'
      : errorText(error, 'Không thể lưu mô hình.')
  } finally {
    modelDialog.saving = false
  }
}

async function runModelTest(model: AiModelConfig): Promise<void> {
  busyModelId.value = model.id
  try {
    const result = await aiModelConnectionsApi.testModelConfig(model.id)
    await loadModels()
    if (result.probe.completionVerified) {
      showNotice('Mô hình đã phản hồi hoàn chỉnh và sẵn sàng gửi duyệt.')
    } else {
      showNotice('Đã đọc được mô hình nhưng chưa xác minh được phản hồi hoàn chỉnh.', 'warning')
    }
  } catch (error) {
    showNotice(isForbidden(error) ? 'Bạn chưa có quyền kiểm tra mô hình.' : errorText(error, 'Kiểm tra mô hình thất bại.'), 'error')
    await loadModels()
  } finally {
    busyModelId.value = null
  }
}

async function runModelAction(model: AiModelConfig, action: ModelAction): Promise<void> {
  busyModelId.value = model.id
  const labels: Record<ModelAction, string> = {
    clone: 'Đã tạo bản nháp mới từ mô hình.',
    submit: 'Đã gửi mô hình để phê duyệt.',
    approve: 'Đã phê duyệt mô hình.',
    archive: 'Đã lưu trữ mô hình.',
    default: 'Đã đặt mô hình mặc định.',
  }
  try {
    if (action === 'archive') {
      const impact = await aiModelConnectionsApi.getModelConfigImpact(model.id)
      if (!impact.canArchive) {
        showNotice(
          impact.blockingReasons.join(' ') || 'Mô hình đang được sử dụng nên chưa thể lưu trữ.',
          'warning',
        )
        return
      }
      const linkedCount = impact.counts.agents + impact.counts.releases + impact.counts.fallbackFor
      const suffix = linkedCount > 0 ? ' Các liên kết lịch sử vẫn được giữ lại.' : ''
      if (
        typeof window !== 'undefined'
        && !window.confirm('Lưu trữ mô hình “' + model.displayName + '”?' + suffix)
      ) return
    }
    if (action === 'clone') await aiModelConnectionsApi.cloneModelConfig(model.id)
    if (action === 'submit') await aiModelConnectionsApi.submitModelConfig(model.id)
    if (action === 'approve') await aiModelConnectionsApi.approveModelConfig(model.id)
    if (action === 'archive') await aiModelConnectionsApi.archiveModelConfig(model.id)
    if (action === 'default') {
      const result = await aiModelConnectionsApi.setDefaultModelConfig(model.id, aiConfigRevision.value)
      defaultModelConfigId.value = result.defaultModelConfigId
      aiConfigRevision.value = result.aiConfigRevision
    }
    await loadModels()
    showNotice(labels[action])
  } catch (error) {
    showNotice(
      isForbidden(error) ? 'Bạn chưa có quyền thực hiện thao tác này.' : errorText(error, 'Không thể cập nhật mô hình.'),
      'error',
    )
  } finally {
    busyModelId.value = null
  }
}

function connectionStatusMeta(status: ProviderConnectionStatus | string) {
  const map: Record<string, { label: string; tone: string; icon: string }> = {
    draft: { label: 'Bản nháp', tone: 'neutral', icon: '○' },
    needs_test: { label: 'Cần kiểm tra', tone: 'warning', icon: '!' },
    connected: { label: 'Đã kết nối', tone: 'success', icon: '✓' },
    failed: { label: 'Lỗi kết nối', tone: 'danger', icon: '!' },
    disabled: { label: 'Đã tắt', tone: 'neutral', icon: '–' },
  }
  return map[status] || { label: status || 'Không rõ', tone: 'neutral', icon: '?' }
}

function modelStatusMeta(status: ModelConfigStatus | string) {
  const map: Record<string, { label: string; tone: string; icon: string }> = {
    draft: { label: 'Bản nháp', tone: 'neutral', icon: '○' },
    testing: { label: 'Đã kiểm tra', tone: 'info', icon: '✓' },
    submitted: { label: 'Chờ duyệt', tone: 'warning', icon: '…' },
    approved: { label: 'Đã duyệt', tone: 'success', icon: '✓' },
    archived: { label: 'Đã lưu trữ', tone: 'neutral', icon: '□' },
  }
  return map[status] || { label: status || 'Không rõ', tone: 'neutral', icon: '?' }
}

function providerLabel(connection: ProviderConnection): string {
  if (connection.vendor === '9router') return '9Router · OpenAI-compatible'
  return connection.vendor || connection.adapter || 'OpenAI-compatible'
}

function providerInitial(connection: ProviderConnection): string {
  return connection.vendor === '9router' ? '9R' : connection.name.slice(0, 2).toUpperCase()
}

function connectionErrorLabel(code: string): string {
  const labels: Record<string, string> = {
    AI_SECRET_MISSING: 'Chưa có API key',
    AI_CONNECTION_AUTH_FAILED: 'API key không hợp lệ',
    AI_CONNECTION_TIMEOUT: 'Endpoint quá thời gian chờ',
    AI_CONNECTION_RATE_LIMITED: 'Đang bị giới hạn yêu cầu',
    AI_BASE_URL_NOT_ALLOWED: 'Endpoint bị chặn bởi chính sách',
  }
  return labels[code] || `Mã lỗi: ${code}`
}

function formatDate(value: string | null): string {
  if (!value) return 'Chưa kiểm tra'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function capabilityLabels(capabilities: AiModelCapabilities): string[] {
  const labels: Array<[keyof AiModelCapabilities, string]> = [
    ['text', 'Văn bản'], ['vision', 'Hình ảnh'], ['tools', 'Công cụ'],
    ['structuredOutput', 'Cấu trúc'], ['embeddings', 'Embedding'],
  ]
  return labels.filter(([key]) => capabilities?.[key]).map(([, label]) => label)
}

function modelConnectionName(model: AiModelConfig): string {
  return model.connection?.name || connections.value.find((item) => item.id === model.connectionId)?.name || 'Không tìm thấy'
}

function canEditModel(model: AiModelConfig): boolean {
  return model.status === 'draft' || model.status === 'testing'
}

onMounted(refreshAll)
</script>

<style scoped>
.models-connections {
  --ink: #172033;
  --muted: #607086;
  --line: #d8e0ea;
  --soft: #f6f8fb;
  --brand: #087ea4;
  --brand-dark: #075d79;
  color: var(--ink);
  font-size: 14px;
  line-height: 1.5;
}

.page-header,
.toolbar,
.card-header,
.dialog > header,
.dialog > footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

h2, h3, h4, p { margin: 0; }
h2 { font-size: 20px; line-height: 1.35; }
h3 { font-size: 17px; line-height: 1.4; }
h4 { font-size: 15px; line-height: 1.4; }
.page-header p, .toolbar p, .dialog header p { color: var(--muted); margin-top: 4px; }

.section-tabs {
  display: flex;
  gap: 4px;
  margin-top: 24px;
  padding-bottom: 1px;
  border-bottom: 1px solid var(--line);
}

.section-tabs button {
  min-height: 42px;
  padding: 8px 16px;
  color: #42536a;
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}

.section-tabs button.active { color: var(--brand-dark); border-bottom-color: var(--brand); }
.section-tabs button:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible {
  outline: 3px solid rgba(8, 126, 164, .25);
  outline-offset: 2px;
}

.count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 23px;
  min-height: 23px;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: #e9eef5;
  font-size: 12px;
}

.tab-panel { padding-top: 24px; }
.toolbar { align-items: center; margin-bottom: 16px; }
.button {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px 14px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: white;
  color: var(--ink);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}
.button:disabled { cursor: not-allowed; opacity: .55; }
.button.primary { color: #fff; background: var(--brand); border-color: var(--brand); }
.button.primary:hover:not(:disabled) { background: var(--brand-dark); }
.button.secondary { color: #24354b; border-color: #b9c5d4; }
.button.secondary:hover:not(:disabled) { background: #f1f5f9; }
.button.ghost { color: var(--brand-dark); background: transparent; }
.button.compact { min-height: 36px; padding: 6px 10px; font-size: 13px; }

.notice, .readiness {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding: 12px 16px;
  border: 1px solid;
  border-radius: 8px;
}
.notice.success { color: #14532d; background: #f0fdf4; border-color: #86efac; }
.notice.error { color: #8b1e2d; background: #fff1f2; border-color: #fda4af; }
.notice.warning { color: #713f12; background: #fffbeb; border-color: #fcd34d; }
.notice button { margin-left: auto; border: 0; background: transparent; color: inherit; font-size: 22px; cursor: pointer; }
.notice-icon, .readiness-icon {
  display: inline-flex;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 2px solid currentColor;
  border-radius: 50%;
  font-weight: 800;
}

.readiness.warning { color: #713f12; background: #fffbeb; border-color: #f5c762; }
.readiness.info { color: #164e63; background: #ecfeff; border-color: #67e8f9; }
.readiness div { flex: 1; }
.readiness p { margin-top: 2px; color: inherit; opacity: .9; }

.card-grid, .skeleton-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.config-card {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 1px 2px rgba(16, 24, 40, .04);
}
.identity { display: flex; align-items: center; min-width: 0; gap: 12px; }
.identity p { color: var(--muted); font-size: 12px; }
.provider-mark {
  display: inline-flex;
  flex: 0 0 42px;
  width: 42px;
  height: 42px;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  color: #075985;
  background: #e0f2fe;
  font-weight: 800;
}
.status-badge {
  display: inline-flex;
  width: max-content;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border: 1px solid;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
.status-badge.success { color: #166534; background: #f0fdf4; border-color: #86efac; }
.status-badge.warning { color: #854d0e; background: #fefce8; border-color: #fde047; }
.status-badge.danger { color: #9f1239; background: #fff1f2; border-color: #fda4af; }
.status-badge.info { color: #075985; background: #f0f9ff; border-color: #7dd3fc; }
.status-badge.neutral { color: #475569; background: #f8fafc; border-color: #cbd5e1; }

.details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
  margin: 16px 0;
}
.details div { min-width: 0; }
.details dt { color: var(--muted); font-size: 12px; }
.details dd { margin: 2px 0 0; font-weight: 600; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.danger-text, .inline-error { color: #a1122f; }
.inline-error { display: flex; gap: 7px; margin: -4px 0 12px; font-size: 13px; }
.impact-line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid #edf1f5;
  color: var(--muted);
  font-size: 12px;
}
.card-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }

.state-card {
  display: flex;
  min-height: 230px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  border: 1px dashed #b7c3d2;
  border-radius: 10px;
  background: #fbfcfe;
  text-align: center;
}
.state-card p { max-width: 560px; margin: 6px 0 16px; color: var(--muted); }
.state-card.error { color: #8b1e2d; border-color: #f0a1ad; background: #fff8f8; }
.state-card.forbidden { color: #374151; background: #f8fafc; }
.state-icon { margin-bottom: 8px; font-size: 28px; }
.state-card.compact-state { min-height: 150px; }
.skeleton-card {
  height: 255px;
  border-radius: 10px;
  background: linear-gradient(90deg, #eef2f6 25%, #f8fafc 50%, #eef2f6 75%);
  background-size: 200% 100%;
  animation: pulse 1.4s infinite;
}
@keyframes pulse { to { background-position: -200% 0; } }

.models-table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; }
.models-table { width: 100%; border-collapse: collapse; background: #fff; }
.models-table th, .models-table td { padding: 12px 14px; border-bottom: 1px solid #e7ecf2; text-align: left; vertical-align: top; }
.models-table th { color: #53657b; background: #f7f9fc; font-size: 12px; font-weight: 750; white-space: nowrap; }
.models-table tbody tr:last-child td { border-bottom: 0; }
.model-name { display: grid; min-width: 170px; gap: 2px; }
.model-name > span { color: var(--muted); font-size: 12px; }
.model-name .default-label { width: max-content; margin-top: 3px; padding: 2px 6px; border-radius: 999px; color: #075985; background: #e0f2fe; font-weight: 700; }
.capabilities { display: flex; max-width: 240px; flex-wrap: wrap; gap: 4px; }
.capabilities > span { padding: 2px 6px; border-radius: 4px; color: #334155; background: #edf2f7; font-size: 12px; }
.capabilities > span.muted { color: var(--muted); background: transparent; }
.model-actions { min-width: 150px; text-align: right !important; }
.text-action { min-height: 32px; padding: 4px 6px; border: 0; color: #075d79; background: transparent; font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
.text-action.danger { color: #a1122f; }
.text-action:disabled { color: #94a3b8; cursor: not-allowed; }

.dialog-backdrop {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, .52);
}
.dialog {
  width: min(640px, 100%);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 20px;
  border: 0;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 24px 60px rgba(15, 23, 42, .22);
}
.dialog.narrow { width: min(500px, 100%); }
.dialog.wide { width: min(760px, 100%); }
.dialog > header { padding-bottom: 16px; border-bottom: 1px solid var(--line); }
.dialog > footer { justify-content: flex-end; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line); }
.icon-button { display: inline-flex; min-width: 40px; min-height: 40px; align-items: center; justify-content: center; border: 0; border-radius: 6px; color: #475569; background: transparent; font-size: 24px; cursor: pointer; }
.icon-button:hover { background: #f1f5f9; }

.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 20px; }
.field { display: grid; min-width: 0; gap: 6px; }
.field.full { grid-column: 1 / -1; }
.field > span, .field legend { color: #334155; font-size: 13px; font-weight: 700; }
.field b { color: #b4233b; }
.field small { color: var(--muted); font-size: 12px; line-height: 1.45; }
.field input, .field select {
  width: 100%;
  min-height: 42px;
  box-sizing: border-box;
  padding: 8px 11px;
  border: 1px solid #b9c5d4;
  border-radius: 7px;
  color: var(--ink);
  background: #fff;
  font: inherit;
}
.field input:disabled, .field select:disabled { color: #64748b; background: #f1f5f9; }
.password-field, .select-with-action { display: flex; align-items: stretch; gap: 8px; }
.password-field input, .select-with-action input { flex: 1; min-width: 0; }
.password-field button { min-width: 58px; border: 1px solid #b9c5d4; border-radius: 7px; color: #334155; background: #f8fafc; font: inherit; font-weight: 650; cursor: pointer; }
.security-callout { display: flex; gap: 10px; margin: 16px 0; padding: 12px; border-radius: 8px; color: #164e63; background: #ecfeff; }
.confirm-line { display: flex; align-items: flex-start; gap: 9px; margin-top: 16px; color: #475569; }
.confirm-line input, .capabilities-field input { width: 17px; height: 17px; margin-top: 2px; accent-color: var(--brand); }
.form-error { margin-top: 14px; padding: 10px 12px; border-radius: 7px; color: #8b1e2d; background: #fff1f2; }
.capabilities-field { margin: 0; padding: 12px; border: 1px solid var(--line); border-radius: 8px; }
.capabilities-field > div { display: flex; flex-wrap: wrap; gap: 10px 18px; }
.capabilities-field label { display: inline-flex; align-items: center; gap: 7px; color: #334155; }
.discovery-state { padding: 40px 16px; color: var(--muted); text-align: center; }
.discovered-list { display: grid; gap: 8px; margin-top: 16px; }
.discovered-list button { display: flex; min-height: 54px; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: #fff; text-align: left; cursor: pointer; }
.discovered-list button:hover { border-color: var(--brand); background: #f0fafd; }
.discovered-list button span:first-child { display: grid; min-width: 0; }
.discovered-list small { overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }

@media (max-width: 960px) {
  .card-grid, .skeleton-grid { grid-template-columns: 1fr; }
  .readiness { align-items: flex-start; flex-wrap: wrap; }
  .readiness .button { margin-left: 40px; }
}

@media (max-width: 700px) {
  .page-header, .toolbar { align-items: stretch; flex-direction: column; }
  .page-header .button, .toolbar .button { width: 100%; }
  .section-tabs { overflow-x: auto; }
  .section-tabs button { flex: 1 0 auto; }
  .details, .form-grid { grid-template-columns: 1fr; }
  .field.full { grid-column: auto; }
  .models-table-wrap { border: 0; overflow: visible; }
  .models-table, .models-table tbody, .models-table tr, .models-table td { display: block; }
  .models-table thead { display: none; }
  .models-table tr { margin-bottom: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 9px; background: #fff; }
  .models-table td { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 10px; padding: 7px 0; border: 0; }
  .models-table td::before { content: attr(data-label); color: var(--muted); font-size: 12px; font-weight: 700; }
  .models-table td.model-actions { display: flex; min-width: 0; flex-wrap: wrap; justify-content: flex-start; padding-top: 10px; border-top: 1px solid #edf1f5; text-align: left !important; }
  .impact-line { flex-direction: column; gap: 3px; }
  .dialog { padding: 16px; }
  .password-field, .select-with-action { flex-direction: column; }
  .select-with-action .button { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-card { animation: none; }
}
</style>
