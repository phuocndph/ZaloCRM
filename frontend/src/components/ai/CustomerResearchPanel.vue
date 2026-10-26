<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <section class="research-shell">
    <header class="research-header">
      <div class="research-heading">
        <span class="heading-icon mdi mdi-compass-rose" aria-hidden="true" />
        <div>
          <div class="heading-title">
            <h2>Tìm nỗi đau chủ khách sạn & Tạo bài chia sẻ</h2>
            <span class="scope-pill">Jolie’Fam · Zalo cá nhân</span>
          </div>
          <p>
            Thu thập khó khăn thật khi vận hành khách sạn từ Google và hội nhóm Facebook, chọn vấn đề đúng thực tế rồi để AI soạn sẵn nội dung chia sẻ.
          </p>
        </div>
      </div>

      <div class="header-actions">
        <button type="button" class="button secondary" :disabled="loading" @click="reloadAll">
          <span class="mdi mdi-refresh" :class="{ spinning: loading }" />
          {{ loading ? 'Đang tải…' : 'Làm mới' }}
        </button>
        <button type="button" class="button primary" @click="openCreateProjectModal">
          <span class="mdi mdi-plus" />
          Tạo đợt tìm hiểu mới
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

    <section v-if="currentProject?.executor === 'hermes'" class="direct-switch" role="status">
      <div><strong>Chuyển đợt này sang AI trong ZCRM</strong><p>Giữ nguồn và bài đã lưu. Công việc cũ đang chờ hoặc chạy qua Hermes sẽ dừng khi chuyển.</p></div>
      <select v-if="availableModels.length" v-model="projectForm.modelConfigId" aria-label="AI dùng khi chuyển sang ZCRM">
        <option v-for="model in availableModels" :key="model.id" :value="model.id">{{ model.displayName }}</option>
      </select>
      <input v-else v-model.trim="projectForm.modelConfigId" placeholder="Mã AI đã cấu hình trong ZCRM" aria-label="AI dùng khi chuyển sang ZCRM" />
      <button class="button primary" type="button" :disabled="taskBusy || !canEdit || !projectForm.modelConfigId" @click="switchToDirect">Chạy trực tiếp trong ZCRM</button>
    </section>
    <section v-if="capabilities" class="capability-strip" aria-label="Trạng thái kết nối">
      <div class="cap-item" :class="{ ok: capabilities.search.configured, warn: !capabilities.search.configured }">
        <span class="mdi" :class="capabilities.search.configured ? 'mdi-magnify-check' : 'mdi-magnify-close'" />
        <div>
          <strong>Tìm trên Google</strong>
          <small>{{ capabilities.search.configured ? 'Đã có mã kết nối' : 'Chưa có mã tìm kiếm (vẫn có thể dán nội dung để tổng hợp)' }}</small>
        </div>
      </div>

      <div class="cap-item" :class="{ ok: capabilities.publicWeb.allowedDomains.length > 0, warn: capabilities.publicWeb.allowedDomains.length === 0 }">
        <span class="mdi mdi-web" />
        <div>
          <strong>Đọc trang web công khai</strong>
          <small>
            {{
              capabilities.publicWeb.allowedDomains.length
                ? `Cho phép tự đọc ${capabilities.publicWeb.allowedDomains.length} tên miền (${capabilities.publicWeb.allowedDomains.slice(0, 3).join(', ')})`
                : 'Tự đọc trang công khai; bỏ qua trang chặn truy cập'
            }}
          </small>
        </div>
      </div>

      <div class="cap-item ok">
        <span class="mdi mdi-facebook" />
        <div>
          <strong>Hội nhóm Facebook</strong>
          <small>Dán bài viết hoặc bình luận thủ công để đảm bảo đúng bài thật và có quyền sử dụng</small>
        </div>
      </div>
    </section>

    <details v-if="canManageSearch" class="search-setup" :open="!!capabilities && !capabilities.search.configured">
      <summary>Thiết lập tìm kiếm Google</summary>
      <form @submit.prevent="saveSearchConnection">
        <label>Mã kết nối Serper <input v-model.trim="searchApiKey" type="password" autocomplete="new-password" required placeholder="Dán mã kết nối tìm kiếm" /></label>
        <button class="button secondary" type="submit" :disabled="saving || !searchApiKey">Lưu kết nối</button>
        <small>Mã được lưu bảo mật. Phần viết và tổng hợp dùng AI đã cấu hình trong ZCRM.</small>
      </form>
    </details>
    <div class="research-workspace">
      <aside class="project-sidebar">
        <div class="sidebar-header">
          <div>
            <strong>Các đợt tìm hiểu</strong>
            <small>Mỗi đợt là một chủ đề cần tìm hiểu</small>
          </div>
          <span class="count-badge">{{ projects.length }}</span>
        </div>

        <div v-if="loading && !projects.length" class="sidebar-empty">
          Đang tải danh sách…
        </div>

        <div v-else-if="!projects.length" class="sidebar-empty">
          <span class="mdi mdi-folder-search-outline" />
          <strong>Chưa có đợt tìm hiểu nào</strong>
          <small>Bấm "Tạo đợt tìm hiểu mới" để bắt đầu tìm vấn đề của chủ khách sạn.</small>
        </div>

        <div v-else class="project-list">
          <button
            v-for="item in projects"
            :key="item.id"
            type="button"
            class="project-card"
            :class="{ active: selectedProjectId === item.id }"
            @click="selectProject(item.id)"
          >
            <strong>{{ item.title }}</strong>
            <p>{{ item.brief }}</p>
            <div class="project-meta">
              <span>AI: {{ item.aiCalls }} lượt</span>
              <span>{{ item.executor === 'hermes' ? 'Đợt cũ — cần chuyển sang ZCRM' : 'AI trong ZCRM' }}</span>
              <span v-if="item.executor !== 'hermes'">Chi phí: {{ formatMicrosToUsd(item.aiCostMicros) }}</span>
            </div>
          </button>
        </div>
      </aside>

      <div class="project-main">
        <div v-if="!currentProject" class="empty-main">
          <span class="mdi mdi-lightbulb-on-outline" />
          <h3>Bắt đầu tìm hiểu nỗi đau khách hàng</h3>
          <p>
            Chọn một đợt tìm hiểu ở cột bên trái hoặc tạo mới để thu thập bài viết về khó khăn khi vận hành khách sạn, duyệt các vấn đề đáng chú ý và tạo bài chia sẻ gửi qua Zalo cá nhân.
          </p>
          <button type="button" class="button primary" @click="openCreateProjectModal">
            <span class="mdi mdi-plus" />
            Tạo đợt tìm hiểu đầu tiên
          </button>
        </div>

        <template v-else>
          <section class="project-summary-card">
            <div class="summary-top">
              <div>
                <h3>{{ currentProject.title }}</h3>
                <p class="brief-text">{{ currentProject.brief }}</p>
              </div>
              <div class="budget-pills">
                <span>
                  <small>{{ currentProject.executor === 'hermes' ? 'Phần tìm nguồn đã giao' : 'Lượt tìm Google' }}</small>
                  <strong>{{ currentProject.searchCalls }}</strong>
                </span>
                <span>
                  <small>Nguồn đã lưu</small>
                  <strong>{{ sources.length }}</strong>
                </span>
                <span>
                  <small>{{ currentProject.executor === 'hermes' ? 'Lượt tổng hợp / viết' : 'Lượt gọi AI' }}</small>
                  <strong>{{ currentProject.aiCalls }}</strong>
                </span>
                <span v-if="currentProject.executor !== 'hermes'">
                  <small>Chi phí AI đã ghi nhận</small>
                  <strong>{{ formatMicrosToUsd(currentProject.aiCostMicros) }}</strong>
                </span>
              </div>
            </div>

            <label v-if="currentProject.executor !== 'hermes' && availableModels.length && canEdit" class="project-model">
              AI dùng cho đợt này
              <select :value="currentProject.modelConfigId" :disabled="taskBusy || hasActiveTask" aria-label="Đổi AI dùng cho đợt này" @change="changeProjectModel">
                <option v-if="!availableModels.some((model) => model.id === currentProject?.modelConfigId)" :value="currentProject.modelConfigId" disabled>AI cũ không còn sẵn sàng — hãy chọn lại</option>
                <option v-for="model in availableModels" :key="model.id" :value="model.id">{{ model.displayName }}</option>
              </select>
            </label>
            <div v-if="currentProject.executor !== 'hermes'" class="research-start">
              <div><strong>Tự tìm → đọc nguồn → tổng hợp vấn đề</strong><p>Kết quả tự lưu dù anh đóng trang. Chọn vấn đề sau khi tổng hợp xong để tạo bài.</p></div>
              <button type="button" class="button primary" :disabled="taskBusy || hasActiveTask || !canEdit || !capabilities?.search.configured || !capabilities?.encryption" @click="triggerTask('research')">{{ activePains.length ? 'Tìm và tổng hợp lại' : 'Bắt đầu tìm hiểu' }}</button>
              <small v-if="!capabilities?.search.configured">Cần thiết lập tìm kiếm Google phía trên, hoặc dán nguồn để tổng hợp.</small>
              <small v-else-if="!capabilities?.encryption">Máy chủ chưa sẵn sàng lưu nguồn bảo mật. Cần kiểm tra cấu hình mã hóa.</small>
            </div>
            <div v-if="latestTask" class="task-banner" :class="latestTask.status">
              <div class="task-info">
                <span
                  class="mdi"
                  :class="{
                    'mdi-loading spinning': isTaskActive(latestTask),
                    'mdi-check-circle-outline': latestTask.status === 'completed',
                    'mdi-alert-circle-outline': latestTask.status === 'failed',
                    'mdi-cancel': latestTask.status === 'cancelled',
                  }"
                />
                <div>
                  <strong>{{ TASK_KIND_LABELS[latestTask.kind] || latestTask.kind }}: {{ TASK_STATUS_LABELS[latestTask.status] || latestTask.status }}</strong>
                  <small v-if="latestTask.errorCode">Cần xử lý: {{ friendlyErrorCode(latestTask.errorCode) }}</small>
                  <small v-else-if="latestTask.status === 'queued' && currentProject.executor !== 'hermes'">{{ queuedTooLong ? 'Bộ xử lý chưa nhận việc. Hệ thống đang thử lại; cần kiểm tra máy chủ nếu tình trạng kéo dài.' : 'Công việc đã lưu. ZCRM đang chuẩn bị xử lý.' }}</small>
                  <small v-else-if="latestTask.checkpoint?.progress">{{ latestTask.checkpoint.progress }}</small>
                  <small v-else-if="isTaskActive(latestTask)">{{ currentProject.executor === 'hermes' ? 'Chuyển sang AI trong ZCRM để tiếp tục.' : 'ZCRM đang chuẩn bị xử lý, kết quả sẽ tự cập nhật.' }}</small>
                  <small v-else>Cập nhật lúc {{ formatDate(latestTask.completedAt || latestTask.createdAt) }}</small>
                </div>
              </div>
              <div class="task-actions">
                <button
                  v-if="isTaskActive(latestTask)"
                  type="button"
                  class="button danger-outline"
                  :disabled="taskBusy"
                  @click="handleCancelTask(latestTask.id)"
                >
                  Dừng việc này
                </button>
                <button
                  v-if="['failed', 'cancelled'].includes(latestTask.status) && currentProject.executor !== 'hermes' && latestTask.input?.executor !== 'hermes'"
                  type="button"
                  class="button secondary"
                  :disabled="taskBusy || hasActiveTask"
                  @click="handleRetryTask(latestTask.id)"
                >
                  Chạy lại từ bước dở
                </button>
              </div>
            </div>
          </section>

          <ol v-if="latestTask?.kind === 'research'" class="research-progress" aria-label="Tiến độ tìm hiểu">
            <li v-for="phase in workflowPhases" :key="phase.key" :class="{ current: latestTask.checkpoint?.stage === phase.key, finished: latestTask.status === 'completed' }">{{ phase.label }}</li>
          </ol>
          <nav class="step-tabs" aria-label="Các bước thực hiện">
            <button
              type="button"
              class="step-tab"
              :class="{ active: activeStep === 'sources' }"
              @click="activeStep = 'sources'"
            >
              <span class="step-num">1</span>
              <div>
                <strong>Nguồn thông tin ({{ sources.length }})</strong>
                <small>{{ readSourceCount }} nguồn đã đọc nội dung</small>
              </div>
            </button>

            <button
              type="button"
              class="step-tab"
              :class="{ active: activeStep === 'pains' }"
              @click="activeStep = 'pains'"
            >
              <span class="step-num">2</span>
              <div>
                <strong>Nỗi đau khách hàng ({{ activePains.length }})</strong>
                <small>{{ approvedPainCount }} vấn đề đã duyệt</small>
              </div>
            </button>

            <button
              type="button"
              class="step-tab"
              :class="{ active: activeStep === 'contents' }"
              @click="activeStep = 'contents'"
            >
              <span class="step-num">3</span>
              <div>
                <strong>Bài viết chia sẻ ({{ visibleContents.length }})</strong>
                <small>{{ approvedContentCount }} bài đã duyệt dùng</small>
              </div>
            </button>
          </nav>

          <section v-if="activeStep === 'sources'" class="step-panel">
            <div class="panel-action-bar">
              <div>
                <h4>Thu thập bài viết & thảo luận thực tế</h4>
                <p>
                  Bấm Bắt đầu tìm hiểu để tự tìm và tổng hợp. Có thể bổ sung bài viết hoặc bình luận anh được phép dùng từ hội nhóm Facebook.
                </p>
              </div>
              <div class="action-group">
                <button v-if="sources.length && currentProject.executor !== 'hermes'" type="button" class="button secondary" :disabled="taskBusy || hasActiveTask || !canEdit || !capabilities?.encryption" @click="triggerTask('research', { sourceMode: 'saved' })">Đọc và tổng hợp nguồn đã thêm</button>
                <button
                  type="button"
                  class="button primary"
                  :disabled="hasActiveTask || !canEdit"
                  @click="showAddSourceModal = true"
                >
                  <span class="mdi mdi-plus" />
                  Dán bài Facebook / Thêm nguồn
                </button>
              </div>
            </div>

            <div v-if="readSourceCount > 0" class="next-step-callout">
              <div>
                <strong>Đã có {{ readSourceCount }} nguồn đọc xong nội dung.</strong>
                <span>Bạn có thể chuyển sang bước tổng hợp để AI rút ra các nỗi đau của chủ khách sạn kèm câu trích dẫn nguyên văn.</span>
              </div>
              <button
                type="button"
                class="button primary"
                :disabled="taskBusy || hasActiveTask"
                @click="startAnalyzeFromSources"
              >
                <span class="mdi mdi-sparkles" />
                Chạy AI tổng hợp nỗi đau
              </button>
            </div>

            <div v-if="!sources.length" class="state-empty">
              <span class="mdi mdi-text-box-plus-outline" />
              <strong>Chưa có nguồn thông tin nào</strong>
              <p>Hãy bấm "Dán bài Facebook / Thêm nguồn" để thêm các bài tâm sự, hỏi đáp của chủ khách sạn hoặc bấm "Bắt đầu tìm hiểu".</p>
            </div>

            <div v-else class="source-grid">
              <article v-for="source in sources" :key="source.id" class="source-card">
                <div class="source-card-top">
                  <div class="source-title-block">
                    <span class="kind-badge" :class="source.kind">
                      {{ source.kind === 'facebook' ? 'Facebook' : source.kind === 'manual' ? 'Nhập tay' : 'Trang web' }}
                    </span>
                    <span class="status-pill" :class="source.status">
                      {{ SOURCE_STATUS_LABELS[source.status] || source.status }}
                    </span>
                    <span class="role-pill">
                      Người viết: {{ SPEAKER_ROLE_LABELS[source.speakerRole] || 'Chưa rõ' }}
                    </span>
                  </div>
                  <time :datetime="source.createdAt">{{ formatDate(source.createdAt) }}</time>
                </div>

                <h5>{{ source.title }}</h5>

                <a
                  v-if="source.url"
                  :href="source.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="source-link"
                >
                  {{ source.url }}
                </a>

                <p v-if="source.content" class="source-excerpt">
                  {{ expandedSourceId === source.id ? source.content : truncate(source.content, 260) }}
                </p>
                <p v-else class="source-missing">
                  <template v-if="source.status === 'requires_manual'">
                    Bài Facebook này cần bổ sung nội dung để đọc được. Hãy mở bài, sao chép nội dung được phép dùng và bấm "Dán nội dung cho nguồn này".
                  </template>
                  <template v-else-if="source.status === 'blocked_domain'">
                    Tên miền này chưa nằm trong danh sách cho phép tự đọc. Bạn có thể dán nội dung thủ công nếu cần.
                  </template>
                  <template v-else>
                    Chưa có nội dung chi tiết.
                  </template>
                </p>

                <div class="source-card-actions">
                  <button
                    v-if="source.content && source.content.length > 260"
                    type="button"
                    class="link-btn"
                    @click="expandedSourceId = expandedSourceId === source.id ? null : source.id"
                  >
                    {{ expandedSourceId === source.id ? 'Thu gọn nội dung' : 'Xem toàn bộ nội dung' }}
                  </button>
                  <button
                    v-if="!source.content && source.url"
                    type="button"
                    class="button secondary small"
                    :disabled="hasActiveTask"
                    @click="prefillManualSource(source)"
                  >
                    Dán nội dung cho nguồn này
                  </button>
                </div>
              </article>
            </div>
          </section>
          <section v-else-if="activeStep === 'pains'" class="step-panel">
            <div class="panel-action-bar">
              <div>
                <h4>Chọn vấn đề muốn viết bài</h4>
                <p>
                  Kiểm tra bằng chứng rồi chọn các vấn đề phù hợp. Nút <strong>Duyệt và tạo bài</strong> xác nhận các vấn đề đã chọn và lần lượt viết bản nháp. Bài viết vẫn chờ anh duyệt trước khi dùng.
                </p>
              </div>
              <div class="action-group">
                <button
                  type="button"
                  class="button primary"
                  :disabled="taskBusy || hasActiveTask || readSourceCount === 0"
                  @click="triggerTask('analyze')"
                >
                  <span class="mdi mdi-sparkles" />
                  AI tổng hợp lại từ {{ readSourceCount }} nguồn đã đọc
                </button>
              </div>
            </div>

            <div v-if="canApprove && currentProject.executor !== 'hermes' && activePains.length" class="batch-write">
              <label><input type="checkbox" :checked="allPainsSelected" :disabled="hasActiveTask || taskBusy" @change="toggleAllPains" /> Chọn tất cả vấn đề có thể dùng</label>
              <select v-model="batchFormat" aria-label="Kiểu bài cho các vấn đề đã chọn"><option value="zalo_message">Tin nhắn Zalo ngắn</option><option value="article">Bài chia sẻ kinh nghiệm</option><option value="checklist">Danh sách kiểm tra</option></select>
              <button class="button primary" type="button" :disabled="!selectedPains.length || taskBusy || hasActiveTask" @click="generateSelectedPains">Duyệt và tạo bài ({{ selectedPains.length }})</button>
            </div>
            <div v-if="!activePains.length" class="state-empty">
              <span class="mdi mdi-clipboard-text-search-outline" />
              <strong>Chưa có vấn đề nào được tổng hợp</strong>
              <p>Cần ít nhất 1 nguồn đã có nội dung ở Bước 1, sau đó bấm "AI tổng hợp lại" để AI bóc tách các nỗi đau của chủ khách sạn.</p>
            </div>

            <div v-else class="pain-list">
              <article v-for="pain in activePains" :key="pain.id" class="pain-card" :class="pain.status">
                <header class="pain-card-header">
                  <div class="pain-badges">
                    <span class="status-pill" :class="pain.status">
                      {{ PAIN_STATUS_LABELS[pain.status] || pain.status }}
                    </span>
                    <span class="relevance-pill" :class="pain.detail?.relevance || 'unknown'">
                      {{ RELEVANCE_LABELS[pain.detail?.relevance || 'unknown'] }}
                    </span>
                    <span class="source-count-pill">
                      {{ pain.independentSources }} nguồn khác nhau
                    </span>
                    <span v-if="pain.detail?.certainty === 'operator_source'" class="certainty-pill verified">
                      Từ chủ / quản lý khách sạn
                    </span>
                    <span v-else class="certainty-pill">
                      Cần đối chiếu thêm thực tế
                    </span>
                  </div>
                </header>

                <label v-if="canApprove && currentProject.executor !== 'hermes' && pain.status !== 'rejected'" class="select-pain"><input v-model="selectedPainIds" type="checkbox" :value="pain.id" :disabled="hasActiveTask || taskBusy" :aria-label="`Chọn vấn đề: ${pain.title}`" /> Chọn để tạo bài</label>
                <h5>{{ pain.title }}</h5>

                <dl class="pain-detail-grid">
                  <div>
                    <dt>Ai đang gặp vấn đề này?</dt>
                    <dd>{{ pain.detail?.audience || '—' }}</dd>
                  </div>
                  <div>
                    <dt>Hoàn cảnh xảy ra</dt>
                    <dd>{{ pain.detail?.situation || '—' }}</dd>
                  </div>
                  <div>
                    <dt>Hậu quả / Thiệt hại khi vận hành</dt>
                    <dd>{{ pain.detail?.impact || '—' }}</dd>
                  </div>
                  <div>
                    <dt>Kết quả mà chủ khách sạn mong muốn</dt>
                    <dd>{{ pain.detail?.desire || '—' }}</dd>
                  </div>
                  <div class="full-span">
                    <dt>Điểm chưa chắc chắn / Cần hỏi thêm khách</dt>
                    <dd>{{ pain.detail?.uncertainty || '—' }}</dd>
                  </div>
                </dl>

                <div class="evidence-box">
                  <strong>Bằng chứng nguyên văn từ nguồn thu thập ({{ pain.evidence?.length || 0 }} đoạn trích):</strong>
                  <ul>
                    <li v-for="(ev, idx) in pain.evidence" :key="`${ev.sourceId}-${idx}`">
                      <blockquote>“{{ ev.quote }}”</blockquote>
                      <a v-if="sourceUrlById(ev.sourceId)" :href="sourceUrlById(ev.sourceId)!" target="_blank" rel="noopener noreferrer">{{ sourceTitleById(ev.sourceId) }}</a>
                      <small v-else>— Nguồn: {{ sourceTitleById(ev.sourceId) }}</small>
                    </li>
                  </ul>
                </div>

                <div v-if="pain.status === 'approved' && currentProject.executor !== 'hermes'" class="generate-bar">
                  <div class="generate-label">
                    <span class="mdi mdi-check-decagram" />
                    <strong>Vấn đề này đã duyệt — Chọn kiểu bài để AI viết nháp:</strong>
                  </div>
                  <div class="generate-controls">
                    <select v-model="selectedFormatByPain[pain.id]" aria-label="Chọn kiểu bài viết">
                      <option value="zalo_message">Tin nhắn Zalo cá nhân (ngắn gọn, gần gũi)</option>
                      <option value="article">Bài chia sẻ kinh nghiệm (chi tiết)</option>
                      <option value="checklist">Danh sách kiểm tra cho chủ khách sạn (Checklist)</option>
                    </select>
                    <button
                      type="button"
                      class="button primary"
                      :disabled="taskBusy || hasActiveTask"
                      @click="handleGenerateContent(pain)"
                    >
                      <span class="mdi mdi-pen-plus" />
                      Tạo bài viết ngay
                    </button>
                  </div>
                </div>

                <footer class="pain-actions">
                  <button
                    v-if="canApprove && pain.status !== 'approved'"
                    type="button"
                    class="button approve-btn"
                    :disabled="saving || hasActiveTask"
                    @click="quickReviewPain(pain, 'approved')"
                  >
                    <span class="mdi mdi-check" />
                    Duyệt vấn đề này
                  </button>
                  <button
                    v-if="pain.status !== 'rejected'"
                    type="button"
                    class="button secondary"
                    :disabled="saving || hasActiveTask"
                    @click="quickReviewPain(pain, 'rejected')"
                  >
                    Bỏ qua
                  </button>
                  <button
                    type="button"
                    class="button secondary"
                    :disabled="saving || hasActiveTask"
                    @click="openEditPainModal(pain)"
                  >
                    <span class="mdi mdi-pencil-outline" />
                    Sửa nội dung
                  </button>
                  <button
                    v-if="activePains.length > 1"
                    type="button"
                    class="button secondary"
                    :disabled="saving || hasActiveTask"
                    @click="openMergePainModal(pain)"
                  >
                    <span class="mdi mdi-call-merge" />
                    Gộp vấn đề trùng
                  </button>
                </footer>
              </article>
            </div>
          </section>

          <section v-else class="step-panel">
            <div class="panel-action-bar">
              <div>
                <h4>Kho bài viết chia sẻ & kịch bản nhắn Zalo cá nhân</h4>
                <p>
                  Nội dung được AI soạn từ các nỗi đau đã duyệt, không tự bịa giá bán hay cam kết quá đà. Bạn có thể chỉnh sửa lại câu chữ, bấm <strong>Duyệt bài</strong> rồi sao chép gửi cho khách trên Zalo cá nhân.
                </p>
              </div>
            </div>

            <div v-if="!visibleContents.length" class="state-empty">
              <span class="mdi mdi-file-document-edit-outline" />
              <strong>Chưa có bài viết nào</strong>
              <p>Hãy sang Bước 2 (Nỗi đau khách hàng), bấm <strong>Duyệt</strong> một vấn đề rồi bấm <strong>Tạo bài viết ngay</strong>.</p>
            </div>

            <div v-else class="content-list">
              <article v-for="item in visibleContents" :key="item.id" class="content-card" :class="item.status">
                <header class="content-card-header">
                  <div class="content-badges">
                    <span class="format-badge">{{ FORMAT_LABELS[item.format] || item.format }}</span>
                    <span class="status-pill" :class="item.status">
                      {{ CONTENT_STATUS_LABELS[item.status] || item.status }}
                    </span>
                    <span class="version-badge">Phiên bản v{{ item.version }}</span>
                  </div>
                  <time :datetime="item.createdAt">{{ formatDate(item.createdAt) }}</time>
                </header>

                <div class="pain-origin">
                  <span>Viết cho nỗi đau:</span>
                  <strong>{{ painTitleById(item.painId) }}</strong>
                </div>

                <h5>{{ item.title }}</h5>

                <pre class="content-body-box">{{ item.body }}</pre>

                <div v-if="item.missingInformation?.length" class="missing-info-box">
                  <strong>Những điểm cần bạn kiểm tra hoặc điền thêm thực tế trước khi gửi khách:</strong>
                  <ul>
                    <li v-for="(info, idx) in item.missingInformation" :key="idx">{{ info }}</li>
                  </ul>
                </div>

                <div v-if="item.evidence?.length" class="evidence-mini">
                  <small>Dựa trên {{ item.evidence.length }} trích dẫn thực tế từ nguồn đã thu thập.</small>
                </div>

                <footer class="content-actions">
                  <button
                    v-if="canApprove && item.status === 'draft'"
                    type="button"
                    class="button approve-btn"
                    :disabled="saving || hasActiveTask"
                    @click="handleApproveContent(item)"
                  >
                    <span class="mdi mdi-check" />
                    Duyệt bài viết này
                  </button>
                  <button
                    v-if="item.status !== 'archived' && item.status !== 'outdated'"
                    type="button"
                    class="button secondary"
                    :disabled="saving || hasActiveTask"
                    @click="openEditContentModal(item)"
                  >
                    <span class="mdi mdi-pencil-outline" />
                    Chỉnh sửa (Tạo bản mới)
                  </button>
                  <button
                    type="button"
                    class="button secondary"
                    @click="copyContentToClipboard(item)"
                  >
                    <span class="mdi mdi-content-copy" />
                    {{ item.status === 'approved' ? 'Sao chép bài đã duyệt' : 'Sao chép bản nháp' }}
                  </button>
                </footer>
              </article>
            </div>
          </section>
        </template>
      </div>
    </div>

    <div v-if="showCreateProjectModal" class="modal-backdrop" @click.self="showCreateProjectModal = false">
      <form class="research-modal" @submit.prevent="handleCreateProject">
        <header>
          <div>
            <h3>Tạo đợt tìm hiểu nỗi đau khách hàng</h3>
            <p>Đặt mục tiêu cụ thể để AI tìm đúng vấn đề của chủ và quản lý khách sạn.</p>
          </div>
          <button type="button" aria-label="Đóng" @click="showCreateProjectModal = false">×</button>
        </header>

        <div class="modal-body">
          <p class="help-text">Chạy bằng AI trong ZCRM. Khi đã có kết nối tìm kiếm, tạo đợt sẽ tự tìm, đọc và tổng hợp.</p>
          <label>
            <span>Tên đợt tìm hiểu <b>*</b></span>
            <input
              v-model.trim="projectForm.title"
              required
              maxlength="200"
              placeholder="Ví dụ: Nỗi đau giặt ủi & hao hụt chăn ga của khách sạn 2-4 sao"
            />
          </label>

          <label>
            <span>Mô tả chi tiết những gì cần tìm <b>*</b></span>
            <textarea
              v-model.trim="projectForm.brief"
              rows="4"
              required
              maxlength="5000"
              placeholder="Ví dụ: Tìm các vấn đề thực tế khiến chủ khách sạn, homestay đau đầu khi vận hành buồng phòng, giặt là, chăn ga gối đệm nhanh ố vàng, khăn tắm nhanh thô ráp, khách phàn nàn mùi ẩm..."
            />
          </label>

          <label>
            <span>AI dùng để tìm hiểu và viết bài <b>*</b></span>
            <select v-if="availableModels.length" v-model="projectForm.modelConfigId" required>
              <option v-for="m in availableModels" :key="m.id" :value="m.id">
                {{ m.displayName }} ({{ m.externalModelId }}){{ m.isDefault ? ' — Mặc định' : '' }}
              </option>
            </select>
            <input
              v-else
              v-model.trim="projectForm.modelConfigId"
              required
              maxlength="100"
              placeholder="Nhập mã AI đã được thiết lập trong ZCRM"
            />
            <small v-if="!availableModels.length">
              Gợi ý: Bạn có thể tạo và duyệt cấu hình AI trong mục "Mô hình & kết nối".
            </small>
          </label>

          <p class="help-text">Xử lý liên tục các việc đã giao, không dừng vì ngân sách hoặc số lượt. Nhiều nguồn sẽ được chia nhỏ để làm tiếp. Bạn có thể dừng công việc khi cần.</p>
        </div>

        <footer>
          <button type="button" class="button secondary" @click="showCreateProjectModal = false">Hủy</button>
          <button type="submit" class="button primary" :disabled="saving">
            {{ saving ? 'Đang tạo…' : capabilities?.search.configured && capabilities?.encryption ? 'Tạo và bắt đầu tìm hiểu' : 'Tạo đợt để thêm nguồn' }}
          </button>
        </footer>
      </form>
    </div>

    <div v-if="showAddSourceModal" class="modal-backdrop" @click.self="showAddSourceModal = false">
      <form class="research-modal" @submit.prevent="handleAddSource">
        <header>
          <div>
            <h3>Dán bài viết từ hội nhóm Facebook hoặc thêm trang web</h3>
            <p>Số điện thoại và email cá nhân trong bài sẽ tự động được ẩn trước khi lưu.</p>
          </div>
          <button type="button" aria-label="Đóng" @click="showAddSourceModal = false">×</button>
        </header>

        <div class="modal-body">
          <label>
            <span>Tiêu đề gợi nhớ nguồn này <b>*</b></span>
            <input
              v-model.trim="sourceForm.title"
              required
              maxlength="300"
              placeholder="Ví dụ: Chủ khách sạn Đà Nẵng than phiền khăn tắm bị ố vàng sau 2 tháng"
            />
          </label>

          <div class="form-row two">
            <label>
              <span>Đường dẫn bài gốc (HTTPS, nếu có)</span>
              <input
                v-model.trim="sourceForm.url"
                type="url"
                maxlength="2000"
                placeholder="https://www.facebook.com/groups/..."
              />
            </label>

            <label>
              <span>Người viết bài này là ai?</span>
              <select v-model="sourceForm.speakerRole">
                <option v-for="(label, role) in SPEAKER_ROLE_LABELS" :key="role" :value="role">
                  {{ label }}
                </option>
              </select>
            </label>
          </div>

          <label>
            <span>Nội dung bài viết / bình luận thực tế</span>
            <textarea
              v-model.trim="sourceForm.content"
              rows="7"
              maxlength="40000"
              placeholder="Dán nguyên văn nội dung bài đăng và các bình luận đáng chú ý của chủ/quản lý khách sạn tại đây..."
            />
            <small>Nếu chỉ nhập đường dẫn trang web công khai mà để trống nội dung, hệ thống sẽ đọc trang đó ở bước "Đọc các trang web".</small>
          </label>

          <label v-if="sourceForm.content" class="checkbox-row">
            <input v-model="sourceForm.permissionConfirmed" type="checkbox" required />
            <span>Tôi xác nhận nội dung này được phép sử dụng để nghiên cứu nội bộ và làm tư liệu viết bài.</span>
          </label>
        </div>

        <footer>
          <button type="button" class="button secondary" @click="showAddSourceModal = false">Hủy</button>
          <button type="submit" class="button primary" :disabled="saving">
            {{ saving ? 'Đang lưu…' : 'Lưu nguồn thông tin' }}
          </button>
        </footer>
      </form>
    </div>

    <div v-if="editingPain" class="modal-backdrop" @click.self="editingPain = null">
      <form class="research-modal" @submit.prevent="handleSavePainEdit">
        <header>
          <div>
            <h3>Chỉnh sửa thông tin nỗi đau khách hàng</h3>
            <p>Chỉnh lại câu chữ cho sát thực tế trước khi duyệt dùng để viết bài.</p>
          </div>
          <button type="button" aria-label="Đóng" @click="editingPain = null">×</button>
        </header>

        <div class="modal-body">
          <label>
            <span>Tên vấn đề / Nỗi đau <b>*</b></span>
            <input v-model.trim="painEditForm.title" required maxlength="200" />
          </label>

          <div class="form-row two">
            <label>
              <span>Ai đang gặp vấn đề này? <b>*</b></span>
              <input v-model.trim="painEditForm.audience" required maxlength="500" />
            </label>
            <label>
              <span>Mức độ liên quan tới Jolie’Fam</span>
              <select v-model="painEditForm.relevance">
                <option v-for="(label, rel) in RELEVANCE_LABELS" :key="rel" :value="rel">
                  {{ label }}
                </option>
              </select>
            </label>
          </div>

          <label>
            <span>Hoàn cảnh xảy ra <b>*</b></span>
            <textarea v-model.trim="painEditForm.situation" rows="2" required maxlength="2000" />
          </label>

          <label>
            <span>Hậu quả / Thiệt hại <b>*</b></span>
            <textarea v-model.trim="painEditForm.impact" rows="2" required maxlength="2000" />
          </label>

          <label>
            <span>Mong muốn của chủ khách sạn <b>*</b></span>
            <textarea v-model.trim="painEditForm.desire" rows="2" required maxlength="2000" />
          </label>

          <label>
            <span>Điểm chưa chắc chắn / Cần hỏi thêm <b>*</b></span>
            <textarea v-model.trim="painEditForm.uncertainty" rows="2" required maxlength="1000" />
          </label>

          <label>
            <span>Trạng thái sau khi lưu</span>
            <select v-model="painEditForm.status">
              <option value="draft">Giữ ở trạng thái Chờ duyệt</option>
              <option v-if="canApprove" value="approved">Duyệt luôn vấn đề này</option>
              <option value="rejected">Bỏ qua vấn đề này</option>
            </select>
          </label>
        </div>

        <footer>
          <button type="button" class="button secondary" @click="editingPain = null">Hủy</button>
          <button type="submit" class="button primary" :disabled="saving">
            {{ saving ? 'Đang lưu…' : 'Lưu thay đổi' }}
          </button>
        </footer>
      </form>
    </div>

    <div v-if="mergingTargetPain" class="modal-backdrop" @click.self="mergingTargetPain = null">
      <form class="research-modal" @submit.prevent="handleMergePain">
        <header>
          <div>
            <h3>Gộp hai vấn đề trùng nhau</h3>
            <p>Bằng chứng của vấn đề được chọn bên dưới sẽ được cộng dồn vào: <strong>{{ mergingTargetPain.title }}</strong></p>
          </div>
          <button type="button" aria-label="Đóng" @click="mergingTargetPain = null">×</button>
        </header>

        <div class="modal-body">
          <label>
            <span>Chọn vấn đề muốn gộp vào <b>*</b></span>
            <select v-model="mergeSourcePainId" required>
              <option value="" disabled>-- Chọn một vấn đề --</option>
              <option
                v-for="candidate in mergeCandidatePains"
                :key="candidate.id"
                :value="candidate.id"
              >
                {{ candidate.title }} ({{ candidate.independentSources }} nguồn)
              </option>
            </select>
          </label>
        </div>

        <footer>
          <button type="button" class="button secondary" @click="mergingTargetPain = null">Hủy</button>
          <button type="submit" class="button primary" :disabled="saving || !mergeSourcePainId">
            {{ saving ? 'Đang gộp…' : 'Gộp vấn đề' }}
          </button>
        </footer>
      </form>
    </div>

    <div v-if="editingContent" class="modal-backdrop" @click.self="editingContent = null">
      <form class="research-modal" @submit.prevent="handleSaveContentEdit">
        <header>
          <div>
            <h3>Chỉnh sửa bài viết (Tạo phiên bản v{{ editingContent.version + 1 }})</h3>
            <p>Phiên bản cũ vẫn được lưu lại để đối chiếu khi cần.</p>
          </div>
          <button type="button" aria-label="Đóng" @click="editingContent = null">×</button>
        </header>

        <div class="modal-body">
          <label>
            <span>Tiêu đề bài viết <b>*</b></span>
            <input v-model.trim="contentEditForm.title" required maxlength="300" />
          </label>

          <label>
            <span>Nội dung chi tiết <b>*</b></span>
            <textarea v-model.trim="contentEditForm.body" rows="12" required maxlength="20000" />
          </label>
        </div>

        <footer>
          <button type="button" class="button secondary" @click="editingContent = null">Hủy</button>
          <button type="submit" class="button primary" :disabled="saving">
            {{ saving ? 'Đang lưu…' : 'Lưu thành phiên bản mới' }}
          </button>
        </footer>
      </form>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { aiModelConnectionsApi, type AiModelConfig } from '@/api/ai-model-connections';
import {
  aiResearchApi,
  CONTENT_STATUS_LABELS,
  FORMAT_LABELS,
  formatMicrosToUsd,
  makeResearchIdempotencyKey,
  PAIN_STATUS_LABELS,
  RELEVANCE_LABELS,
  SOURCE_STATUS_LABELS,
  SPEAKER_ROLE_LABELS,
  TASK_KIND_LABELS,
  TASK_STATUS_LABELS,
  type ResearchCapabilities,
  type ResearchContent,
  type ResearchFormat,
  type ResearchPain,
  type ResearchProject,
  type ResearchProjectDetail,
  type ResearchRelevance,
  type ResearchSource,
  type ResearchSpeakerRole,
  type ResearchTaskKind,
  type ResearchTaskSummary,
} from '@/api/ai-research';

const authStore = useAuthStore();

const loading = ref(false);
const saving = ref(false);
const taskBusy = ref(false);
const notice = ref('');
const noticeOk = ref(true);

const capabilities = ref<ResearchCapabilities | null>(null);
const searchApiKey = ref('');
const selectedPainIds = ref<string[]>([]);
const batchFormat = ref<ResearchFormat>('zalo_message');
const workflowPhases = [{ key: 'discover', label: '1. Tìm nguồn' }, { key: 'collect', label: '2. Đọc nội dung' }, { key: 'analyze', label: '3. Tổng hợp vấn đề' }];
const availableModels = ref<AiModelConfig[]>([]);
const projects = ref<ResearchProject[]>([]);
const selectedProjectId = ref<string>('');
const currentProject = ref<ResearchProjectDetail | null>(null);
const sources = ref<ResearchSource[]>([]);
const pains = ref<ResearchPain[]>([]);
const contents = ref<ResearchContent[]>([]);

const activeStep = ref<'sources' | 'pains' | 'contents'>('sources');
const expandedSourceId = ref<string | null>(null);
const selectedFormatByPain = reactive<Record<string, ResearchFormat>>({});

const showCreateProjectModal = ref(false);
const showAddSourceModal = ref(false);
const editingPain = ref<ResearchPain | null>(null);
const mergingTargetPain = ref<ResearchPain | null>(null);
const mergeSourcePainId = ref('');
const editingContent = ref<ResearchContent | null>(null);

const projectForm = reactive({
  executor: 'internal' as const,
  title: 'Tìm nỗi đau vận hành của chủ khách sạn',
  brief:
    'Tìm các khó khăn thực tế khi chủ và quản lý khách sạn Việt Nam vận hành khách sạn: nhân sự, buồng phòng, chi phí, giặt là, bảo trì và phản hồi của khách. Sau đó đánh dấu vấn đề liên quan đến chăn ga gối đệm, rèm, bảo vệ đệm và khăn Jolie’Fam.',
  modelConfigId: '',
});

const sourceForm = reactive<{
  title: string;
  url: string;
  content: string;
  speakerRole: ResearchSpeakerRole;
  permissionConfirmed: boolean;
}>({
  title: '',
  url: '',
  content: '',
  speakerRole: 'unknown',
  permissionConfirmed: false,
});

const painEditForm = reactive<{
  title: string;
  audience: string;
  situation: string;
  impact: string;
  desire: string;
  uncertainty: string;
  relevance: ResearchRelevance;
  status: 'draft' | 'approved' | 'rejected';
}>({
  title: '',
  audience: '',
  situation: '',
  impact: '',
  desire: '',
  uncertainty: '',
  relevance: 'direct',
  status: 'draft',
});

const contentEditForm = reactive({
  title: '',
  body: '',
});

let pollTimer: ReturnType<typeof setInterval> | null = null;
let workspaceVersion = 0;
let disposed = false;
let polling = false;
const pendingTaskKeys = new Map<string, string>();
const canManageSearch = computed(() => ['owner', 'admin'].includes(authStore.user?.role || '') && authStore.canAccess('ai_model', 'manage_secret'));
const canEdit = computed(() => authStore.canAccess('ai_knowledge', 'edit'));

const canApprove = computed(() => {
  const role = authStore.user?.role || '';
  return ['owner', 'admin'].includes(role) && authStore.canAccess('ai_knowledge', 'approve');
});

const latestTask = computed<ResearchTaskSummary | null>(() => {
  return currentProject.value?.tasks?.[0] ?? null;
});

const queuedTooLong = computed(() => latestTask.value?.status === 'queued' && Date.now() - Date.parse(latestTask.value.createdAt) > 60_000);

const hasActiveTask = computed(() => {
  return !!currentProject.value?.tasks?.some((t) => isTaskActive(t));
});

const readSourceCount = computed(() => {
  return sources.value.filter((s) => s.status === 'read').length;
});

const activePains = computed(() => {
  return pains.value.filter((p) => !['merged', 'superseded'].includes(p.status));
});

const approvedPainCount = computed(() => {
  return activePains.value.filter((p) => p.status === 'approved').length;
});

const visibleContents = computed(() => {
  return contents.value.filter((c) => c.status !== 'archived');
});

const approvedContentCount = computed(() => {
  return visibleContents.value.filter((c) => c.status === 'approved').length;
});

const selectablePains = computed(() => activePains.value.filter((p) => p.status !== 'rejected'));
const selectedPains = computed(() => selectablePains.value.filter((p) => selectedPainIds.value.includes(p.id)));
const allPainsSelected = computed(() => selectablePains.value.length > 0 && selectedPains.value.length === selectablePains.value.length);
function toggleAllPains() { selectedPainIds.value = allPainsSelected.value ? [] : selectablePains.value.map((p) => p.id); }

const mergeCandidatePains = computed(() => {
  if (!mergingTargetPain.value) return [];
  return activePains.value.filter((p) => p.id !== mergingTargetPain.value?.id);
});

function isTaskActive(task: ResearchTaskSummary | null | undefined): boolean {
  return !!task && (task.status === 'queued' || task.status === 'running');
}

function showNotice(message: string, ok = true) {
  notice.value = message;
  noticeOk.value = ok;
}

function extractErrorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
  return anyErr?.response?.data?.error || anyErr?.response?.data?.message || anyErr?.message || fallback;
}

function friendlyErrorCode(code: string): string {
  const map: Record<string, string> = {
    AUTHENTICATION: 'Kết nối AI bị từ chối. Kiểm tra mã kết nối AI đang dùng.',
    CONFIGURATION: 'AI của đợt này chưa sẵn sàng. Chọn lại AI đã thiết lập trong ZCRM.',
    RATE_LIMITED: 'Dịch vụ AI đang nhận quá nhiều yêu cầu. Chờ một lúc rồi tiếp tục từ bước dở.',
    TIMEOUT: 'AI phản hồi quá lâu. Có thể tiếp tục từ bước dở.',
    PROVIDER_UNAVAILABLE: 'Chưa kết nối được dịch vụ AI. Thử lại khi kết nối trở lại.',
    CIRCUIT_OPEN: 'Kết nối AI đang tạm gián đoạn. Chờ một lúc rồi thử lại.',
    INVALID_RESPONSE: 'AI trả kết quả chưa hợp lệ. Hãy chạy lại phần đang dở.',
    UNKNOWN: 'Chưa hoàn thành công việc. Hãy thử lại hoặc kiểm tra kết nối AI.',
    RESEARCH_SEARCH_FAILED: 'Chưa lấy được kết quả tìm kiếm. Kiểm tra kết nối Google rồi thử lại.',
    RESEARCH_STALE_REVISION: 'Nguồn hoặc vấn đề đã thay đổi. Bắt đầu lượt tổng hợp mới để dùng dữ liệu hiện tại.',

    RESEARCH_SEARCH_AUTH_FAILED: 'Mã Serper bị từ chối. Kiểm tra và lưu lại mã kết nối tìm kiếm phía trên.',
    RESEARCH_DIRECT_REQUIRED: 'Đợt cũ cần chuyển sang AI trong ZCRM rồi bắt đầu công việc mới.',
    RESEARCH_NO_EVIDENCE: 'Chưa đọc được nguồn nào. Hãy thử tìm lại hoặc dán nội dung để tổng hợp.',
    RESEARCH_QUEUE_UNAVAILABLE: 'Đã lưu công việc. ZCRM sẽ tự nhận lại khi bộ xử lý kết nối được; có thể bấm Chạy lại.',
    RESEARCH_HERMES_BATCH_REQUIRED: 'Cần cập nhật bộ kết nối Hermes trên máy chủ rồi chạy lại.',
    RESEARCH_HERMES_TIME_LIMIT: 'Đây là thông báo từ bản cũ. Bấm Chạy lại để tiếp tục theo cách xử lý mới.',
    RESEARCH_HERMES_FAILED: 'Hermes chưa hoàn thành. Kiểm tra công cụ và kết nối trên máy chủ Hermes.',
    RESEARCH_SEARCH_BUDGET: 'Đây là thông báo từ bản cũ. Bấm Chạy lại để tiếp tục theo cách xử lý mới.',
    RESEARCH_NO_SOURCES: 'Chưa có nguồn đọc được. Cần tìm hoặc dán nguồn trước khi tổng hợp.',
    RESEARCH_MODEL_PRICING_REQUIRED: 'Đây là thông báo từ bản cũ. Bấm Chạy lại để tiếp tục theo cách xử lý mới.',
    RESEARCH_AI_BUDGET: 'Đây là thông báo từ bản cũ. Bấm Chạy lại để tiếp tục theo cách xử lý mới.',
    RESEARCH_SEARCH_NOT_CONFIGURED: 'Chưa cấu hình khóa tìm kiếm Google trên máy chủ.',
    RESEARCH_TIME_LIMIT: 'Đây là thông báo từ bản cũ. Bấm Chạy lại để tiếp tục theo cách xử lý mới.',
    RESEARCH_PERMISSION_REVOKED: 'Tài khoản không còn quyền chạy tác vụ này.',
    RESEARCH_INVALID_AI_OUTPUT: 'Kết quả AI trả về chưa khớp định dạng bằng chứng, hãy bấm Chạy lại.',
    RESEARCH_INVALID_EVIDENCE: 'AI trích dẫn câu không nằm nguyên văn trong nguồn, hệ thống đã chặn để tránh bịa thông tin.',
  };
  return map[code] || code;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('vi-VN');
  } catch {
    return iso;
  }
}

function truncate(value: string, max = 240): string {
  if (!value || value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function sourceTitleById(sourceId: string): string {
  const found = sources.value.find((s) => s.id === sourceId);
  return found ? found.title : `Nguồn #${sourceId.slice(0, 8)}`;
}

function sourceUrlById(sourceId: string): string | null { return sources.value.find((s) => s.id === sourceId)?.url || null; }

async function saveSearchConnection() {
  saving.value = true;
  try {
    await aiResearchApi.saveSearchConnection(searchApiKey.value);
    searchApiKey.value = '';
    capabilities.value = await aiResearchApi.getCapabilities();
    showNotice('Đã lưu mã kết nối tìm kiếm. Có thể bắt đầu tìm hiểu.');
  } catch (error) { showNotice(extractErrorMessage(error, 'Chưa lưu được kết nối tìm kiếm.'), false); }
  finally { saving.value = false; }
}
async function changeProjectModel(event: Event) {
  projectForm.modelConfigId = (event.target as HTMLSelectElement).value;
  await switchToDirect();
}
async function switchToDirect() {
  if (!selectedProjectId.value) return;
  taskBusy.value = true;
  try {
    await aiResearchApi.useDirect(selectedProjectId.value, projectForm.modelConfigId);
    await loadProjectWorkspace(selectedProjectId.value);
    showNotice('Đã lưu AI dùng cho đợt này trong ZCRM. Nguồn và bài cũ được giữ lại.');
  } catch (error) { showNotice(extractErrorMessage(error, 'Chưa chuyển được đợt này.'), false); }
  finally { taskBusy.value = false; }
}
async function generateSelectedPains() {
  const selected = selectedPains.value.map((p) => ({ painId: p.id, revision: p.revision }));
  if (!selected.length) return;
  const started = await triggerTask('generate_batch', { pains: selected, format: batchFormat.value });
  if (started) { selectedPainIds.value = []; activeStep.value = 'contents'; }
}

function painTitleById(painId: string): string {
  const found = pains.value.find((p) => p.id === painId);
  return found ? found.title : `Vấn đề #${painId.slice(0, 8)}`;
}

async function loadModelsSilently() {
  try {
    const result = await aiModelConnectionsApi.listModelConfigs();
    availableModels.value = (result.modelConfigs || []).filter((m) => ['approved', 'active'].includes(m.status));
    if (!projectForm.modelConfigId && availableModels.value.length > 0) {
      const def = availableModels.value.find((m) => m.isDefault) || availableModels.value[0];
      if (def) projectForm.modelConfigId = def.id;
    }
  } catch {
    // Không chặn màn hình nếu người dùng không có quyền đọc danh sách model admin
  }
}

async function loadProjectWorkspace(projectId: string) {
  if (!projectId) return;
  const version = ++workspaceVersion;
  const allPages = async <T,>(fetchPage: (page: number) => Promise<T[]>) => {
    const rows: T[] = [];
    for (let page = 1; ; page++) {
      const batch = await fetchPage(page); rows.push(...batch);
      if (batch.length < 25) break;
    }
    return rows;
  };
  const [detail, sourceRows, painRows, contentRows] = await Promise.all([
    aiResearchApi.getProject(projectId),
    allPages((page) => aiResearchApi.listSources(projectId, page)),
    allPages((page) => aiResearchApi.listPains(projectId, page)),
    allPages((page) => aiResearchApi.listContents(projectId, page)),
  ]);
  if (disposed || version !== workspaceVersion || selectedProjectId.value !== projectId) return;
  const previousTask = currentProject.value?.tasks?.[0];
  currentProject.value = detail;
  const newest = detail.tasks?.[0];
  if (newest?.kind === 'research' && (!previousTask || previousTask.id !== newest.id || previousTask.status !== newest.status || previousTask.checkpoint?.stage !== newest.checkpoint?.stage) && (newest.status === 'completed' || newest.checkpoint?.stage === 'analyze')) activeStep.value = 'pains';
  const index = projects.value.findIndex((p) => p.id === detail.id);
  if (index >= 0) projects.value[index] = detail;
  sources.value = sourceRows;
  pains.value = painRows;
  contents.value = contentRows;

  for (const pain of painRows) {
    if (!selectedFormatByPain[pain.id]) {
      selectedFormatByPain[pain.id] = 'zalo_message';
    }
  }

  syncPolling();

}

function syncPolling() {
  if (hasActiveTask.value && !pollTimer) {
    pollTimer = setInterval(() => {
      if (selectedProjectId.value && !polling) {
        polling = true;
        void loadProjectWorkspace(selectedProjectId.value).catch(() => {}).finally(() => { polling = false; });
      }
    }, 3500);
  } else if (!hasActiveTask.value && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function reloadAll() {
  loading.value = true;
  try {
    const [caps, projectRows] = await Promise.all([
      aiResearchApi.getCapabilities(),
      aiResearchApi.listProjects(),
      loadModelsSilently(),
    ]);
    capabilities.value = caps;
    projects.value = projectRows;

    if (!selectedProjectId.value && projectRows.length > 0) {
      selectedProjectId.value = projectRows[0].id;
    }

    if (selectedProjectId.value) {
      await loadProjectWorkspace(selectedProjectId.value);
    }
  } catch (err) {
    showNotice(extractErrorMessage(err, 'Không tải được dữ liệu nghiên cứu khách hàng.'), false);
  } finally {
    loading.value = false;
  }
}

async function selectProject(projectId: string) {
  if (saving.value || taskBusy.value) return;
  selectedProjectId.value = projectId;
  currentProject.value = null;
  selectedPainIds.value = [];
  sources.value = []; pains.value = []; contents.value = [];
  loading.value = true;
  try {
    await loadProjectWorkspace(projectId);
  } catch (err) {
    showNotice(extractErrorMessage(err, 'Không tải được thông tin đợt tìm hiểu.'), false);
  } finally {
    loading.value = false;
  }
}

function openCreateProjectModal() {
  showCreateProjectModal.value = true;
}

async function handleCreateProject() {
  saving.value = true;
  try {
    const created = await aiResearchApi.createProject({
      title: projectForm.title,
      brief: projectForm.brief,
      modelConfigId: projectForm.modelConfigId,
      executor: projectForm.executor,
    });
    showCreateProjectModal.value = false;
    projects.value = [created, ...projects.value.filter((p) => p.id !== created.id)];
    selectedProjectId.value = created.id;
    activeStep.value = 'sources';
    await loadProjectWorkspace(created.id);
    if (capabilities.value?.search.configured && capabilities.value.encryption) await triggerTask('research');
    else showNotice('Đã tạo đợt tìm hiểu. Có thể dán nguồn để tổng hợp hoặc thiết lập tìm kiếm Google.');
  } catch (err) {
    showNotice(extractErrorMessage(err, 'Không tạo được đợt tìm hiểu.'), false);
  } finally {
    saving.value = false;
  }
}

function prefillManualSource(source: ResearchSource) {
  sourceForm.title = source.title;
  sourceForm.url = source.url || '';
  sourceForm.content = '';
  sourceForm.speakerRole = source.speakerRole || 'unknown';
  sourceForm.permissionConfirmed = false;
  showAddSourceModal.value = true;
}

async function handleAddSource() {
  if (!selectedProjectId.value) return;
  saving.value = true;
  try {
    const added = await aiResearchApi.addSource(selectedProjectId.value, {
      title: sourceForm.title,
      url: sourceForm.url || undefined,
      content: sourceForm.content || undefined,
      speakerRole: sourceForm.speakerRole,
      permissionConfirmed: sourceForm.content ? sourceForm.permissionConfirmed : undefined,
    });
    showAddSourceModal.value = false;
    sourceForm.title = '';
    sourceForm.url = '';
    sourceForm.content = '';
    sourceForm.speakerRole = 'unknown';
    sourceForm.permissionConfirmed = false;
    await loadProjectWorkspace(selectedProjectId.value);
    showNotice(
      added.duplicate
        ? 'Nguồn này đã tồn tại sẵn trong đợt tìm hiểu.'
        : 'Đã lưu nguồn thông tin thành công.',
    );
  } catch (err) {
    showNotice(extractErrorMessage(err, 'Không lưu được nguồn thông tin.'), false);
  } finally {
    saving.value = false;
  }
}

async function triggerTask(kind: ResearchTaskKind, extra?: { sourceMode?: 'saved'; painId?: string; pains?: Array<{ painId: string; revision: number }>; format?: ResearchFormat }) {
  if (!selectedProjectId.value || currentProject.value?.executor === 'hermes') return false;
  taskBusy.value = true;
  const signature = JSON.stringify([selectedProjectId.value, kind, extra]);
  const key = pendingTaskKeys.get(signature) || makeResearchIdempotencyKey(kind);
  pendingTaskKeys.set(signature, key);
  try {
    await aiResearchApi.createTask(selectedProjectId.value, {
      kind,
      idempotencyKey: key,
      ...extra,
    });
    pendingTaskKeys.delete(signature);
    await loadProjectWorkspace(selectedProjectId.value);
    showNotice(`Đã bắt đầu: ${TASK_KIND_LABELS[kind]}.`);
    return true;
  } catch (err) {
    showNotice(extractErrorMessage(err, 'Không khởi chạy được công việc.'), false);
    await loadProjectWorkspace(selectedProjectId.value).catch(() => {});
  } finally {
    taskBusy.value = false;
  }
  return false;
}

async function startAnalyzeFromSources() {
  activeStep.value = 'pains';
  await triggerTask('analyze');
}

async function handleCancelTask(taskId: string) {
  if (!selectedProjectId.value) return;
  taskBusy.value = true;
  try {
    await aiResearchApi.cancelTask(selectedProjectId.value, taskId);
    await loadProjectWorkspace(selectedProjectId.value);
    showNotice('Đã gửi yêu cầu dừng công việc.');
  } catch (err) {
    showNotice(extractErrorMessage(err, 'Không dừng được công việc.'), false);
  } finally {
    taskBusy.value = false;
  }
}

async function handleRetryTask(taskId: string) {
  if (!selectedProjectId.value) return;
  taskBusy.value = true;
  try {
    await aiResearchApi.retryTask(selectedProjectId.value, taskId);
    await loadProjectWorkspace(selectedProjectId.value);
    showNotice('Đã cho chạy lại công việc.');
  } catch (err) {
    showNotice(extractErrorMessage(err, 'Không chạy lại được công việc.'), false);
  } finally {
    taskBusy.value = false;
  }
}

async function quickReviewPain(pain: ResearchPain, status: 'approved' | 'rejected') {
  if (!selectedProjectId.value) return;
  saving.value = true;
  try {
    await aiResearchApi.reviewPain(selectedProjectId.value, pain.id, {
      revision: pain.revision,
      status,
    });
    await loadProjectWorkspace(selectedProjectId.value);
    showNotice(status === 'approved' ? 'Đã duyệt vấn đề này. Bạn có thể bấm Tạo bài viết ngay!' : 'Đã đánh dấu bỏ qua vấn đề này.');
  } catch (err) {
    showNotice(extractErrorMessage(err, 'Không cập nhật được trạng thái vấn đề.'), false);
  } finally {
    saving.value = false;
  }
}

function openEditPainModal(pain: ResearchPain) {
  editingPain.value = pain;
  painEditForm.title = pain.title;
  painEditForm.audience = pain.detail?.audience || '';
  painEditForm.situation = pain.detail?.situation || '';
  painEditForm.impact = pain.detail?.impact || '';
  painEditForm.desire = pain.detail?.desire || '';
  painEditForm.uncertainty = pain.detail?.uncertainty || '';
  painEditForm.relevance = pain.detail?.relevance || 'direct';
  painEditForm.status = pain.status === 'approved' || pain.status === 'rejected' ? pain.status : 'draft';
}

async function handleSavePainEdit() {
  if (!selectedProjectId.value || !editingPain.value) return;
  saving.value = true;
  try {
    await aiResearchApi.reviewPain(selectedProjectId.value, editingPain.value.id, {
      revision: editingPain.value.revision,
      title: painEditForm.title,
      status: painEditForm.status,
      detail: {
        audience: painEditForm.audience,
        situation: painEditForm.situation,
        impact: painEditForm.impact,
        desire: painEditForm.desire,
        uncertainty: painEditForm.uncertainty,
        relevance: painEditForm.relevance,
      },
    });
    editingPain.value = null;
    await loadProjectWorkspace(selectedProjectId.value);
    showNotice('Đã lưu nội dung vấn đề.');
  } catch (err) {
    showNotice(extractErrorMessage(err, 'Không lưu được chỉnh sửa vấn đề.'), false);
  } finally {
    saving.value = false;
  }
}

function openMergePainModal(targetPain: ResearchPain) {
  mergingTargetPain.value = targetPain;
  mergeSourcePainId.value = '';
}

async function handleMergePain() {
  if (!selectedProjectId.value || !mergingTargetPain.value || !mergeSourcePainId.value) return;
  const sourcePain = pains.value.find((p) => p.id === mergeSourcePainId.value);
  if (!sourcePain) return;

  saving.value = true;
  try {
    await aiResearchApi.mergePain(selectedProjectId.value, mergingTargetPain.value.id, {
      sourceId: sourcePain.id,
      targetRevision: mergingTargetPain.value.revision,
      sourceRevision: sourcePain.revision,
    });
    mergingTargetPain.value = null;
    await loadProjectWorkspace(selectedProjectId.value);
    showNotice('Đã gộp hai vấn đề lại làm một. Hãy kiểm tra và duyệt lại vấn đề sau khi gộp.');
  } catch (err) {
    showNotice(extractErrorMessage(err, 'Không gộp được hai vấn đề này.'), false);
  } finally {
    saving.value = false;
  }
}

async function handleGenerateContent(pain: ResearchPain) {
  const format = selectedFormatByPain[pain.id] || 'zalo_message';
  activeStep.value = 'contents';
  await triggerTask('generate', { painId: pain.id, format });
}

function openEditContentModal(content: ResearchContent) {
  editingContent.value = content;
  contentEditForm.title = content.title;
  contentEditForm.body = content.body;
}

async function handleSaveContentEdit() {
  if (!selectedProjectId.value || !editingContent.value) return;
  saving.value = true;
  try {
    await aiResearchApi.editContent(selectedProjectId.value, editingContent.value.id, {
      title: contentEditForm.title,
      body: contentEditForm.body,
    });
    editingContent.value = null;
    await loadProjectWorkspace(selectedProjectId.value);
    showNotice('Đã tạo phiên bản bài viết mới.');
  } catch (err) {
    showNotice(extractErrorMessage(err, 'Không lưu được bài viết.'), false);
  } finally {
    saving.value = false;
  }
}

async function handleApproveContent(content: ResearchContent) {
  if (!selectedProjectId.value) return;
  saving.value = true;
  try {
    await aiResearchApi.approveContent(selectedProjectId.value, content.id);
    await loadProjectWorkspace(selectedProjectId.value);
    showNotice('Đã duyệt bài viết. Bạn có thể sao chép để gửi qua Zalo cá nhân.');
  } catch (err) {
    showNotice(extractErrorMessage(err, 'Không duyệt được bài viết.'), false);
  } finally {
    saving.value = false;
  }
}

async function copyContentToClipboard(content: ResearchContent) {
  const fullText = `${content.title}\n\n${content.body}`.trim();
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(fullText);
      showNotice('Đã sao chép nội dung bài viết vào bộ nhớ tạm.');
      return;
    }
  } catch {
    // Fallback phía dưới
  }
  showNotice('Trình duyệt không cho sao chép tự động, bạn hãy bôi đen đoạn văn để chép nhé.', false);
}

onMounted(() => {
  void reloadAll();
});

onBeforeUnmount(() => {
  disposed = true;
  workspaceVersion++;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});
</script>
<style scoped>
.project-model { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 12px 0; font-size: 13px; font-weight: 600; }
.project-model select { padding: 8px; max-width: 100%; background: white; border: 1px solid #cbd5e1; border-radius: 7px; }
.direct-switch, .research-start, .batch-write { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 16px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; margin-bottom: 16px; }
.direct-switch p, .research-start p { margin: 4px 0 0; font-size: 13px; color: #475569; }
.research-start > div { flex: 1 1 280px; }
.research-start > small { flex-basis: 100%; color: #92400e; }
.direct-switch select, .batch-write select { max-width: 100%; padding: 9px; background: white; border: 1px solid #cbd5e1; border-radius: 7px; }
.search-setup { padding: 14px 18px; margin-bottom: 18px; background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; }
.search-setup summary { cursor: pointer; font-weight: 650; }
.search-setup form { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; margin-top: 12px; }
.search-setup input { display: block; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; margin-top: 5px; }
.search-setup small { flex-basis: 100%; color: #64748b; }
.research-progress { display: flex; flex-wrap: wrap; gap: 10px; padding: 0; list-style: none; }
.research-progress li { padding: 9px 14px; background: #e2e8f0; border-radius: 8px; color: #475569; }
.research-progress li.current { background: #dbeafe; color: #1d4ed8; font-weight: 700; }
.research-progress li.finished { background: #dcfce7; color: #166534; }
.select-pain, .batch-write label { display: flex; align-items: center; gap: 8px; font-weight: 600; }

.research-shell :is(input, select, textarea, button) { max-width: 100%; }
.research-shell :is(p, strong, dd, small, time) { overflow-wrap: anywhere; }
.research-shell label { min-width: 0; }
.research-shell button:focus-visible { outline: 2px solid #0284c7; outline-offset: 2px; }
.research-shell {
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: #1e293b;
}

.research-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.research-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  min-width: 0;
  flex: 1;
}

.heading-icon {
  display: grid;
  width: 40px;
  height: 40px;
  flex: 0 0 40px;
  place-items: center;
  border-radius: 8px;
  background: #e0f2fe;
  color: #0369a1;
  font-size: 22px;
}

.heading-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.heading-title h2 {
  margin: 0;
  color: #0f172a;
  font-size: 18px;
  line-height: 1.3;
}

.scope-pill {
  padding: 3px 8px;
  border-radius: 6px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
  font-size: 12px;
  font-weight: 600;
}

.research-heading p {
  margin: 4px 0 0;
  color: #475569;
  font-size: 13px;
  line-height: 1.5;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.capability-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.cap-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.cap-item.ok {
  border-color: #cbd5e1;
  background: #ffffff;
}

.cap-item.warn {
  border-color: #fde68a;
  background: #fffbeb;
}

.cap-item > .mdi {
  font-size: 18px;
  color: #0284c7;
  margin-top: 2px;
}

.cap-item strong {
  display: block;
  font-size: 13px;
  color: #0f172a;
}

.cap-item small {
  display: block;
  margin-top: 2px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.4;
}

.notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  background: #f0fdf4;
  color: #166534;
  font-size: 13px;
}

.notice.error {
  border-color: #fecaca;
  background: #fef2f2;
  color: #991b1b;
}

.notice button {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: 18px;
  cursor: pointer;
}

.research-workspace {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.project-sidebar {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid #f1f5f9;
  background: #f8fafc;
}

.sidebar-header strong {
  display: block;
  font-size: 13px;
  color: #0f172a;
}

.sidebar-header small {
  color: #64748b;
  font-size: 12px;
}

.count-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #334155;
  font-size: 12px;
  font-weight: 600;
}

.sidebar-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 28px 14px;
  text-align: center;
  color: #64748b;
}

.sidebar-empty .mdi {
  font-size: 28px;
  color: #94a3b8;
}

.project-list {
  display: flex;
  flex-direction: column;
  max-height: 640px;
  overflow-y: auto;
}

.project-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  padding: 12px;
  border: 0;
  border-bottom: 1px solid #f1f5f9;
  background: #ffffff;
  text-align: left;
  cursor: pointer;
}

.project-card:hover {
  background: #f8fafc;
}

.project-card.active {
  background: #f0f9ff;
  border-left: 3px solid #0284c7;
}

.project-card strong {
  color: #0f172a;
  font-size: 13px;
  line-height: 1.35;
}

.project-card p {
  margin: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.project-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: #475569;
  font-size: 11px;
  font-weight: 600;
}

.project-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.empty-main,
.state-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 36px 20px;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  text-align: center;
  color: #475569;
}

.empty-main .mdi,
.state-empty .mdi {
  font-size: 32px;
  color: #0284c7;
}

.empty-main h3 {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
}

.empty-main p,
.state-empty p {
  max-width: 560px;
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}

.project-summary-card {
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
}

.summary-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.summary-top h3 {
  margin: 0 0 4px;
  color: #0f172a;
  font-size: 16px;
}

.brief-text {
  margin: 0;
  color: #475569;
  font-size: 13px;
  line-height: 1.5;
  max-width: 680px;
}

.budget-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.budget-pills span {
  display: flex;
  flex-direction: column;
  padding: 6px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #f8fafc;
  min-width: 110px;
}

.budget-pills small {
  color: #64748b;
  font-size: 11px;
}

.budget-pills strong {
  color: #0f172a;
  font-size: 13px;
}

.task-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
}

.task-banner.queued,
.task-banner.running {
  border-color: #bae6fd;
  background: #f0f9ff;
  color: #0369a1;
}

.task-banner.completed {
  border-color: #bbf7d0;
  background: #f0fdf4;
  color: #166534;
}

.task-banner.failed {
  border-color: #fecaca;
  background: #fef2f2;
  color: #991b1b;
}

.task-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.task-info strong {
  display: block;
  font-size: 13px;
}

.task-info small {
  display: block;
  font-size: 12px;
  opacity: 0.9;
}

.step-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.step-tab {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  text-align: left;
  cursor: pointer;
}

.step-tab.active {
  border-color: #0284c7;
  background: #f0f9ff;
}

.step-num {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border-radius: 999px;
  background: #e2e8f0;
  color: #0f172a;
  font-weight: 700;
  font-size: 13px;
}

.step-tab.active .step-num {
  background: #0284c7;
  color: #ffffff;
}

.step-tab strong {
  display: block;
  color: #0f172a;
  font-size: 13px;
}

.step-tab small {
  color: #64748b;
  font-size: 12px;
}

.step-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
}

.panel-action-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding-bottom: 12px;
  border-bottom: 1px solid #f1f5f9;
}

.panel-action-bar h4 {
  margin: 0 0 4px;
  color: #0f172a;
  font-size: 15px;
}

.panel-action-bar p {
  margin: 0;
  color: #475569;
  font-size: 13px;
  max-width: 680px;
  line-height: 1.5;
}

.action-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.next-step-callout {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border: 1px solid #bae6fd;
  border-radius: 8px;
  background: #f0f9ff;
}

.next-step-callout strong {
  display: block;
  color: #0c4a6e;
  font-size: 13px;
}

.next-step-callout span {
  color: #0369a1;
  font-size: 12px;
}

.source-grid,
.pain-list,
.content-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.source-card,
.pain-card,
.content-card {
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #ffffff;
}

.pain-card.approved,
.content-card.approved {
  border-color: #86efac;
  background: #fcfffd;
}

.source-card-top,
.pain-card-header,
.content-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.source-title-block,
.pain-badges,
.content-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.kind-badge,
.status-pill,
.role-pill,
.relevance-pill,
.source-count-pill,
.certainty-pill,
.format-badge,
.version-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.kind-badge {
  background: #f1f5f9;
  color: #334155;
}

.kind-badge.facebook {
  background: #dbeafe;
  color: #1d4ed8;
}

.status-pill {
  background: #f1f5f9;
  color: #475569;
}

.status-pill.read,
.status-pill.approved {
  background: #dcfce7;
  color: #166534;
}

.status-pill.requires_manual,
.status-pill.needs_review,
.status-pill.outdated {
  background: #fef3c7;
  color: #92400e;
}

.status-pill.failed,
.status-pill.rejected {
  background: #fee2e2;
  color: #991b1b;
}

.role-pill,
.source-count-pill,
.version-badge {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  color: #475569;
}

.relevance-pill.direct {
  background: #e0f2fe;
  color: #0369a1;
}

.relevance-pill.educational {
  background: #f0fdf4;
  color: #15803d;
}

.certainty-pill {
  background: #fffbeb;
  color: #b45309;
}

.certainty-pill.verified {
  background: #dcfce7;
  color: #166534;
}

.format-badge {
  background: #e0f2fe;
  color: #0369a1;
}

.source-card h5,
.pain-card h5,
.content-card h5 {
  margin: 0 0 6px;
  color: #0f172a;
  font-size: 15px;
  line-height: 1.4;
}

.source-link {
  display: inline-block;
  margin-bottom: 8px;
  color: #0284c7;
  font-size: 12px;
  word-break: break-all;
}

.source-excerpt {
  margin: 0;
  padding: 10px;
  border-radius: 6px;
  background: #f8fafc;
  color: #334155;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.source-missing {
  margin: 0;
  color: #b45309;
  font-size: 13px;
}

.source-card-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}

.pain-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 10px 0;
  padding: 12px;
  border-radius: 8px;
  background: #f8fafc;
}

.pain-detail-grid .full-span {
  grid-column: 1 / -1;
}

.pain-detail-grid dt {
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.pain-detail-grid dd {
  margin: 3px 0 0;
  color: #0f172a;
  font-size: 13px;
  line-height: 1.5;
}

.evidence-box {
  margin-top: 10px;
  padding: 10px 12px;
  border-left: 3px solid #0284c7;
  border-radius: 6px;
  background: #f0f9ff;
}

.evidence-box strong {
  display: block;
  margin-bottom: 6px;
  color: #0c4a6e;
  font-size: 12px;
}

.evidence-box ul {
  margin: 0;
  padding-left: 18px;
}

.evidence-box li {
  margin-bottom: 6px;
}

.evidence-box blockquote {
  margin: 0;
  color: #0f172a;
  font-size: 13px;
  font-style: italic;
}

.evidence-box small {
  color: #475569;
  font-size: 12px;
}

.generate-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  background: #f0fdf4;
}

.generate-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #166534;
  font-size: 13px;
}

.generate-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.generate-controls select {
  padding: 7px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #ffffff;
  color: #0f172a;
  font-size: 13px;
}

.pain-actions,
.content-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #f1f5f9;
}

.pain-origin {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  color: #475569;
  font-size: 12px;
}

.content-body-box {
  margin: 8px 0;
  padding: 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  color: #0f172a;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}

.missing-info-box {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid #fde68a;
  border-radius: 6px;
  background: #fffbeb;
  color: #92400e;
  font-size: 13px;
}

.missing-info-box strong {
  display: block;
  margin-bottom: 4px;
}

.missing-info-box ul {
  margin: 0;
  padding-left: 18px;
}

.evidence-mini {
  margin-top: 6px;
  color: #64748b;
}

.button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.button.primary {
  background: #0284c7;
  color: #ffffff;
}

.button.primary:hover:not(:disabled) {
  background: #0369a1;
}

.button.approve-btn {
  background: #16a34a;
  color: #ffffff;
}

.button.approve-btn:hover:not(:disabled) {
  background: #15803d;
}

.button.secondary {
  border-color: #cbd5e1;
  background: #ffffff;
  color: #334155;
}

.button.secondary:hover:not(:disabled) {
  background: #f8fafc;
}

.button.danger-outline {
  border-color: #fca5a5;
  background: #ffffff;
  color: #b91c1c;
}

.button.small {
  padding: 5px 9px;
  font-size: 12px;
}

.link-btn {
  border: 0;
  background: transparent;
  color: #0284c7;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.45);
}

.research-modal {
  width: min(680px, 100%);
  max-height: 90vh;
  overflow-y: auto;
  border-radius: 8px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  box-shadow: 0 20px 35px rgba(15, 23, 42, 0.18);
}

.research-modal header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid #e2e8f0;
}

.research-modal header h3 {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
}

.research-modal header p {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 12px;
}

.research-modal header button {
  border: 0;
  background: transparent;
  color: #64748b;
  font-size: 22px;
  cursor: pointer;
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
}

.modal-body label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
}

.modal-body label b {
  color: #dc2626;
}

.modal-body label small {
  font-weight: 400;
  color: #64748b;
  font-size: 12px;
}

.modal-body input[type='text'],
.modal-body input[type='url'],
.modal-body input[type='number'],
.modal-body input:not([type]),
.modal-body select,
.modal-body textarea {
  padding: 8px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  color: #0f172a;
  background: #ffffff;
}

.modal-body .checkbox-row {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}

.form-row.two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.form-row.four {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.research-modal footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 960px) {
  .capability-strip,
  .step-tabs,
  .pain-detail-grid,
  .form-row.two,
  .form-row.four {
    grid-template-columns: 1fr;
  }

  .research-workspace {
    grid-template-columns: 1fr;
  }
}
</style>
