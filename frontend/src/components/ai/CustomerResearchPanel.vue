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

    <div v-if="currentProject?.executor === 'hermes'" class="hermes-connection" role="status">
      <span class="mdi mdi-robot-outline" aria-hidden="true" />
      <strong>Hermes Agent</strong>
      <span>{{ hermesStatus?.recentlySeen ? 'Đã liên lạc trong 2 phút gần đây' : 'Chưa thấy Hermes lấy việc gần đây' }}</span>
      <time v-if="hermesStatus?.lastSeenAt">{{ formatDate(hermesStatus.lastSeenAt) }}</time>
    </div>
    <section v-else-if="capabilities" class="capability-strip" aria-label="Trạng thái kết nối">
      <div class="cap-item" :class="{ ok: capabilities.search.configured, warn: !capabilities.search.configured }">
        <span class="mdi" :class="capabilities.search.configured ? 'mdi-magnify-check' : 'mdi-magnify-close'" />
        <div>
          <strong>Tìm trên Google</strong>
          <small>{{ capabilities.search.configured ? 'Đã bật sẵn sàng' : 'Chưa gắn mã kết nối Google (vẫn dán bài thủ công được)' }}</small>
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
                : 'Chưa mở danh sách trang web tự đọc (cần dán nội dung hoặc cấu hình tên miền)'
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
              <span>AI: {{ item.aiCalls }}/{{ item.maxAiCalls }} lượt</span>
              <span v-if="item.executor === 'hermes'">Hermes Agent</span>
              <span v-else>Chi phí: {{ formatMicrosToUsd(item.aiCostMicros) }}/{{ formatMicrosToUsd(item.maxAiCostMicros) }}</span>
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
                  <small>{{ currentProject.executor === 'hermes' ? 'Lượt tìm nguồn' : 'Lượt tìm Google' }}</small>
                  <strong>{{ currentProject.searchCalls }} / {{ currentProject.maxQueries }}</strong>
                </span>
                <span>
                  <small>Nguồn đã lưu</small>
                  <strong>{{ sources.length }} / {{ currentProject.maxSources }}</strong>
                </span>
                <span>
                  <small>{{ currentProject.executor === 'hermes' ? 'Lượt tổng hợp / viết' : 'Lượt gọi AI' }}</small>
                  <strong>{{ currentProject.aiCalls }} / {{ currentProject.maxAiCalls }}</strong>
                </span>
                <span v-if="currentProject.executor !== 'hermes'">
                  <small>Chi phí AI tối đa</small>
                  <strong>{{ formatMicrosToUsd(currentProject.aiCostMicros) }} / {{ formatMicrosToUsd(currentProject.maxAiCostMicros) }}</strong>
                </span>
              </div>
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
                  <small v-if="latestTask.errorCode">Mã thông báo: {{ friendlyErrorCode(latestTask.errorCode) }}</small>
                  <small v-else-if="currentProject.executor === 'hermes' && latestTask.status === 'queued'">Đang chờ Hermes lấy việc qua API.</small>
                  <small v-else-if="isTaskActive(latestTask)">{{ latestTask.checkpoint?.progress || 'Đang xử lý, kết quả sẽ tự cập nhật.' }}</small>
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
                  v-if="['failed', 'cancelled'].includes(latestTask.status)"
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
                  Bạn có thể bấm cho AI tự tìm trên Google theo yêu cầu của đợt tìm hiểu, hoặc dán trực tiếp bài viết/bình luận từ hội nhóm Facebook chủ khách sạn vào đây.
                </p>
              </div>
              <div class="action-group">
                <button
                  type="button"
                  class="button secondary"
                  :disabled="taskBusy || hasActiveTask || loading || !canEdit || (currentProject.executor !== 'hermes' && !capabilities?.search.configured)"
                  @click="triggerTask('discover')"
                >
                  <span class="mdi mdi-google" />
                  {{ currentProject.executor === 'hermes' ? 'Giao Hermes tìm thông tin' : 'Tìm nguồn trên Google' }}
                </button>
                <button
                  type="button"
                  class="button secondary"
                  v-if="currentProject.executor !== 'hermes'"
                  :disabled="taskBusy || hasActiveTask || !pendingWebSourceCount || !canEdit"
                  @click="triggerTask('collect')"
                >
                  <span class="mdi mdi-file-find-outline" />
                  2. Đọc các trang web ({{ pendingWebSourceCount }})
                </button>
                <button
                  type="button"
                  class="button primary"
                  :disabled="hasActiveTask"
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
              <p>Hãy bấm "Dán bài Facebook / Thêm nguồn" để thêm các bài tâm sự, hỏi đáp của chủ khách sạn hoặc bấm "Tìm nguồn trên Google".</p>
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
                    Bài viết từ Facebook không tự động quét để tránh vi phạm chính sách. Hãy mở bài, sao chép nội dung được phép dùng và bấm "Dán nội dung cho nguồn này".
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
                <h4>Danh sách nỗi đau & vấn đề của chủ khách sạn</h4>
                <p>
                  Mỗi vấn đề dưới đây đều kèm câu trích dẫn nguyên văn từ nguồn đã đọc. Bạn kiểm tra, chỉnh lại câu chữ nếu cần, rồi bấm <strong>Duyệt</strong> những vấn đề muốn dùng để viết bài.
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
                      <small>— Nguồn: {{ sourceTitleById(ev.sourceId) }}</small>
                    </li>
                  </ul>
                </div>

                <div v-if="pain.status === 'approved'" class="generate-bar">
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
          <label>
            <span>Bên thực hiện</span>
            <select v-model="projectForm.executor">
              <option value="hermes">Hermes Agent trên máy chủ của bạn</option>
              <option value="internal">AI đang cấu hình trong ZCRM</option>
            </select>
          </label>
          <p v-if="projectForm.executor === 'hermes'" class="hermes-note">Chi phí và công cụ tìm kiếm dùng theo cấu hình trên máy chủ Hermes. ZCRM giới hạn số lượt và số nguồn, không đo chi phí Hermes.</p>
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

          <label v-if="projectForm.executor !== 'hermes'">
            <span>Cấu hình mô hình AI sử dụng <b>*</b></span>
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
              placeholder="Nhập mã cấu hình AI đang hoạt động (Model Config ID)"
            />
            <small v-if="!availableModels.length">
              Gợi ý: Bạn có thể tạo và duyệt cấu hình AI có khai báo giá token trong mục "Mô hình & kết nối".
            </small>
          </label>

          <div class="form-row four">
            <label>
              <span>Tối đa lượt tìm Google</span>
              <input v-model.number="projectForm.maxQueries" type="number" min="1" max="20" required />
            </label>
            <label>
              <span>Tối đa số nguồn lưu</span>
              <input v-model.number="projectForm.maxSources" type="number" min="1" max="60" required />
            </label>
            <label>
              <span>Tối đa lượt gọi AI</span>
              <input v-model.number="projectForm.maxAiCalls" type="number" min="1" max="30" required />
            </label>
            <label v-if="projectForm.executor !== 'hermes'">
              <span>Trần chi phí AI (USD)</span>
              <input v-model.number="projectForm.maxUsd" type="number" min="0.1" max="100" step="0.1" required />
            </label>
          </div>
        </div>

        <footer>
          <button type="button" class="button secondary" @click="showCreateProjectModal = false">Hủy</button>
          <button type="submit" class="button primary" :disabled="saving">
            {{ saving ? 'Đang tạo…' : 'Tạo đợt tìm hiểu' }}
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
const hermesStatus = ref<{ lastSeenAt: string | null; recentlySeen: boolean } | null>(null);
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
  executor: 'hermes' as 'hermes' | 'internal',
  title: 'Tìm nỗi đau vận hành của chủ khách sạn',
  brief:
    'Tìm các khó khăn thực tế khi chủ và quản lý khách sạn Việt Nam vận hành khách sạn: nhân sự, buồng phòng, chi phí, giặt là, bảo trì và phản hồi của khách. Sau đó đánh dấu vấn đề liên quan đến chăn ga gối đệm, rèm, bảo vệ đệm và khăn Jolie’Fam.',
  modelConfigId: '',
  maxQueries: 5,
  maxSources: 30,
  maxAiCalls: 10,
  maxUsd: 1,
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
const canEdit = computed(() => authStore.canAccess('ai_knowledge', 'edit'));

const canApprove = computed(() => {
  const role = authStore.user?.role || '';
  return ['owner', 'admin'].includes(role) && authStore.canAccess('ai_knowledge', 'approve');
});

const latestTask = computed<ResearchTaskSummary | null>(() => {
  return currentProject.value?.tasks?.[0] ?? null;
});

const hasActiveTask = computed(() => {
  return !!currentProject.value?.tasks?.some((t) => isTaskActive(t));
});

const readSourceCount = computed(() => {
  return sources.value.filter((s) => s.status === 'read').length;
});

const pendingWebSourceCount = computed(() => {
  return sources.value.filter(
    (s) => s.kind === 'web' && ['pending', 'failed', 'blocked_domain'].includes(s.status),
  ).length;
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
    RESEARCH_HERMES_TIME_LIMIT: 'Hermes đã hết thời gian xử lý. Kiểm tra máy chủ Hermes rồi chạy lại.',
    RESEARCH_HERMES_FAILED: 'Hermes chưa hoàn thành. Kiểm tra công cụ và kết nối trên máy chủ Hermes.',
    RESEARCH_SEARCH_BUDGET: 'Đã dùng hết lượt tìm kiếm của đợt này.',
    RESEARCH_NO_SOURCES: 'Chưa có nguồn đọc được. Cần tìm hoặc dán nguồn trước khi tổng hợp.',
    RESEARCH_MODEL_PRICING_REQUIRED: 'Mô hình AI chưa khai báo đơn giá token (cần điền giá trong phần Mô hình & kết nối).',
    RESEARCH_AI_BUDGET: 'Đã chạm giới hạn số lượt gọi AI hoặc trần chi phí của đợt tìm hiểu này.',
    RESEARCH_SEARCH_NOT_CONFIGURED: 'Chưa cấu hình khóa tìm kiếm Google trên máy chủ.',
    RESEARCH_TIME_LIMIT: 'Lượt chạy quá 10 phút, bạn có thể bấm Chạy lại từ bước đã lưu.',
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

function painTitleById(painId: string): string {
  const found = pains.value.find((p) => p.id === painId);
  return found ? found.title : `Vấn đề #${painId.slice(0, 8)}`;
}

async function loadModelsSilently() {
  try {
    const result = await aiModelConnectionsApi.listModelConfigs();
    const approved = (result.modelConfigs || []).filter((m) => m.status === 'approved');
    availableModels.value = approved.length ? approved : result.modelConfigs || [];
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
    for (let page = 1; page <= 50; page++) {
      const batch = await fetchPage(page); rows.push(...batch);
      if (batch.length < 25) break;
    }
    return rows;
  };
  const [detail, sourceRows, painRows, contentRows] = await Promise.all([
    aiResearchApi.getProject(projectId),
    aiResearchApi.listSources(projectId),
    allPages((page) => aiResearchApi.listPains(projectId, page)),
    allPages((page) => aiResearchApi.listContents(projectId, page)),
  ]);
  if (disposed || version !== workspaceVersion || selectedProjectId.value !== projectId) return;
  currentProject.value = detail;
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
  if (detail.executor === 'hermes') {
    const state = await aiResearchApi.getHermesStatus().catch(() => null);
    if (!disposed && version === workspaceVersion) hermesStatus.value = state;
  }
}

function syncPolling() {
  if (hasActiveTask.value && !pollTimer) {
    pollTimer = setInterval(() => {
      if (selectedProjectId.value) {
        void loadProjectWorkspace(selectedProjectId.value).catch(() => {});
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
    const maxAiCostMicros = Math.max(1, Math.round((Number(projectForm.maxUsd) || 1) * 1_000_000));
    const created = await aiResearchApi.createProject({
      title: projectForm.title,
      brief: projectForm.brief,
      modelConfigId: projectForm.modelConfigId,
      executor: projectForm.executor,
      maxQueries: projectForm.maxQueries,
      maxSources: projectForm.maxSources,
      maxAiCalls: projectForm.maxAiCalls,
      maxAiCostMicros,
    });
    showCreateProjectModal.value = false;
    projects.value = [created, ...projects.value.filter((p) => p.id !== created.id)];
    selectedProjectId.value = created.id;
    activeStep.value = 'sources';
    await loadProjectWorkspace(created.id);
    showNotice('Đã tạo đợt tìm hiểu mới. Hãy thêm nguồn hoặc bấm tìm trên Google.');
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

async function triggerTask(kind: ResearchTaskKind, extra?: { painId?: string; format?: ResearchFormat }) {
  if (!selectedProjectId.value) return;
  taskBusy.value = true;
  try {
    await aiResearchApi.createTask(selectedProjectId.value, {
      kind,
      idempotencyKey: makeResearchIdempotencyKey(kind),
      ...extra,
    });
    await loadProjectWorkspace(selectedProjectId.value);
    showNotice(`Đã bắt đầu: ${TASK_KIND_LABELS[kind]}.`);
  } catch (err) {
    showNotice(extractErrorMessage(err, 'Không khởi chạy được công việc.'), false);
    await loadProjectWorkspace(selectedProjectId.value).catch(() => {});
  } finally {
    taskBusy.value = false;
  }
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
.hermes-connection { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 10px 0; border-bottom: 1px solid #dce4de; color: #285d42; font-size: 13px; }
.hermes-connection time { color: #64748b; }
.hermes-note { margin: 0; font-size: 13px; color: #475569; }
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
