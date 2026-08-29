<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <aside class="info-panel">
    <!-- Compact identity header. Scoring stays in the analysis layer, not in the
         employee's daily task surface. -->
    <header class="ip-header">
      <button class="ip-close" title="Đóng" @click="$emit('close')">×</button>
      <div class="ip-contact-head">
        <Avatar
          :src="props.contact?.avatarUrl"
          :name="headerFullName"
          :size="48"
          :gradient-seed="props.contact?.id || headerFullName"
          class="ip-avatar-big"
        />
        <div class="ip-contact-main">
          <div class="ip-name-line" :title="headerFullName">{{ headerFullName }}</div>
          <div v-if="senderNickName" class="ip-nick-line">Đang chăm qua {{ senderNickName }}</div>
          <div class="ip-care-row-inline">
            <ContactDealStageSelector
              v-if="props.contact?.id"
              :contact-id="props.contact.id"
              :current-status-id="(props.contact as { statusId?: string | null }).statusId ?? null"
              :org-id="orgId"
              @updated="onDealStageUpdatedPanel"
            />
          </div>
        </div>
      </div>
    </header>

    <!-- 2026-06-01: Wrapper conditional cho mainTab='profile' — content cũ giữ nguyên -->
    <template v-if="mainTab === 'profile'">
    <!-- ════════ Tab bar ════════ -->
    <nav class="ip-tabs">
      <button
        class="ip-tab"
        :class="{ active: activeTab === 'activity', 'badge-bump': badgeBump }"
        data-fly-target="activity-tab"
        @click="activeTab = 'activity'"
      >
        <span class="ic"><ActivityIcon :size="15" :stroke-width="2" /></span> Cần làm
        <span v-if="activityBadgeCount || pendingAptBump" class="tab-badge">{{ (activityBadgeCount ?? 0) + pendingAptBump }}</span>
      </button>
      <button
        class="ip-tab"
        :class="{ active: activeTab === 'profile' }"
        @click="activeTab = 'profile'"
      >
        <span class="ic"><UserIcon :size="15" :stroke-width="2" /></span> Thông tin
      </button>
      <button
        class="ip-tab"
        :class="{ active: activeTab === 'crm' }"
        @click="activeTab = 'crm'"
      >
        <span class="ic"><TargetIcon :size="15" :stroke-width="2" /></span> Chăm sóc
      </button>
    </nav>

    <!-- ════════ Tab content (scroll) ════════ -->
    <div class="ip-tab-content">

      <!-- ══════ TAB 1: HỒ SƠ ══════ -->
      <div v-show="activeTab === 'profile'" class="tab-pane">
        <!-- Inline form: collapsed (Tên Zalo + SĐT) hoặc expanded (full 9 rows). Auto-collapse sau 5s. -->
        <section class="ip-form" :class="{ collapsed: !infoExpanded }">
          <!-- Always visible: Tên Zalo -->
          <div class="ip-form-row">
            <span class="ip-icon">👤</span>
            <span class="ip-label">Tên Zalo</span>
            <input v-model="form.fullName" placeholder="Tên Zalo cung cấp" @blur="saveContact" />
          </div>

          <!-- Always visible: SĐT chính. Hiển thị '0359 944 488' (+tooltip +84) khi không focus,
               raw khi focus để sửa. Giá trị lưu giữ raw → backend normalizePhone tự chuẩn hoá. -->
          <div class="ip-form-row">
            <span class="ip-icon">📞</span>
            <span class="ip-label">SĐT</span>
            <div class="phone-cell">
              <input
                :value="phoneFocused ? form.phone : displayPhone(form.phone)"
                :title="form.phone ? displayPhoneIntl(form.phone) : ''"
                placeholder="SĐT chính"
                @focus="phoneFocused = true"
                @input="form.phone = ($event.target as HTMLInputElement).value"
                @blur="phoneFocused = false; saveContact()"
              />
              <button
                v-if="form.phone && infoExpanded"
                class="show-extra-phones"
                :title="showExtraPhones ? 'Ẩn SĐT phụ' : 'Hiện SĐT phụ'"
                @click="showExtraPhones = !showExtraPhones"
              >
                {{ showExtraPhones ? '−' : '+' }} {{ form.phonesExtra.length }}
              </button>
            </div>
          </div>

          <!--
            Toggle 1 nút, 3-state cycle:
              hidden → click → auto (countdown 5s)
              auto → click → sticky (ghim 📌, cancel countdown)
              sticky → click → hidden
          -->
          <button class="info-expand-toggle" :class="{ 'is-sticky': isSticky }" @click="toggleInfoExpand">
            <span v-if="!infoExpanded">▾ Xem đầy đủ</span>
            <span v-else-if="isSticky">▴ Thu gọn <span class="sticky-badge" title="Đã ghim — không tự thu">📌</span></span>
            <span v-else>📌 Ghim mở (tự thu sau {{ collapseRemain }}s)</span>
          </button>

          <!-- Expanded fields -->
          <template v-if="infoExpanded">
            <div class="ip-form-row">
              <span class="ip-icon">✏</span>
              <span class="ip-label" title="Tên gợi nhớ Zalo per-pair — sync 2-way với Zalo Real">Tên gợi nhớ</span>
              <input
                :value="aliasDraft"
                placeholder="Sync với Zalo Real"
                @input="aliasDraft = ($event.target as HTMLInputElement).value"
                @blur="saveAlias"
                @keydown.enter.prevent="saveAlias"
              />
            </div>
            <div class="ip-form-row">
              <span class="ip-icon">📅</span>
              <span class="ip-label">Ngày sinh</span>
              <input type="date" v-model="form.birthDate" @blur="saveContact" />
            </div>
            <div class="ip-form-row">
              <span class="ip-icon">⚧</span>
              <span class="ip-label">Giới tính</span>
              <select v-model="form.gender" @change="saveContact">
                <option :value="null">Không rõ</option>
                <option value="female">Nữ</option>
                <option value="male">Nam</option>
                <option value="other">Khác</option>
              </select>
            </div>
            <!-- SĐT phụ — list động nhãn tự nhập (phụ/vợ/viber...) + số. Anh chốt 2026-06-06.
                 Thay 2 ô cố định SĐT 2/3 (vỡ UI). Lưu vào contacts.phonesExtra (JSON). -->
            <template v-if="showExtraPhones">
              <div
                v-for="(p, idx) in form.phonesExtra"
                :key="'pex-' + idx"
                class="ip-form-row sub phone-extra-row"
              >
                <input
                  v-model="p.label"
                  class="pex-label"
                  placeholder="nhãn (phụ, vợ, viber...)"
                  @blur="saveContact"
                />
                <input
                  v-model="p.phone"
                  class="pex-phone"
                  placeholder="Số điện thoại"
                  @blur="saveContact"
                />
                <button class="pex-remove" title="Xoá số này" @click="removeExtraPhone(idx)">×</button>
              </div>
              <button class="pex-add" type="button" @click="addExtraPhone">+ Thêm SĐT</button>
            </template>
            <!-- 3 field Email · Địa chỉ · Nghề: ẨN khỏi cột 4 (quick view chat panel).
                 Schema giữ nguyên — data vẫn lưu/edit qua tab "Hồ sơ KH tổng hợp" (phase sau).
                 Xem ContactProfileView.vue stub + use-contact-profile.ts composable. -->
            <button
              v-if="contact?.id"
              class="info-fullprofile-link"
              type="button"
              :title="'Xem hồ sơ KH tổng hợp (email, địa chỉ, nghề, ...)'"
              @click="openFullProfile"
            >
              <span>✨ Xem hồ sơ KH tổng hợp →</span>
            </button>
          </template>
        </section>

        <v-alert v-if="saveSuccess" type="success" density="compact" class="mx-3 my-2" closable
          @click:close="saveSuccess = false">
          Đã lưu thành công!
        </v-alert>
        <v-alert v-if="saveError" type="error" density="compact" class="mx-3 my-2" closable
          @click:close="saveError = false">
          Lưu thất bại, thử lại.
        </v-alert>

      </div>

      <!-- Chăm sóc: dữ liệu vận hành và lịch sử, không hiển thị điểm phân tích. -->
      <div v-show="activeTab === 'crm'" class="tab-pane care-tab">
        <section class="care-section care-overview">
          <div class="care-section-title">
            <Clock3Icon :size="17" aria-hidden="true" />
            <span>Liên hệ gần nhất</span>
          </div>
          <div v-if="cockpitLoading.cockpit" class="crm-w-loading">
            <div class="crm-spinner" /><span>Đang tải thông tin chăm sóc...</span>
          </div>
          <div v-else class="care-facts">
            <div class="care-fact">
              <span class="care-fact-label">Khách nhắn gần nhất</span>
              <strong>{{ cockpit?.lastInboundAt ? relativeTime(cockpit.lastInboundAt) : 'Chưa có tin nhắn' }}</strong>
              <p v-if="cockpit?.lastInboundPreview || cockpit?.lastInboundType">
                {{ careMessagePreview(cockpit.lastInboundType, cockpit.lastInboundPreview) }}
              </p>
            </div>
            <div class="care-fact">
              <span class="care-fact-label">Nhân viên trả lời gần nhất</span>
              <strong>{{ cockpit?.lastOutboundAt ? relativeTime(cockpit.lastOutboundAt) : 'Chưa trả lời khách' }}</strong>
              <p v-if="cockpit?.lastOutboundPreview || cockpit?.lastOutboundType">
                {{ careMessagePreview(cockpit.lastOutboundType, cockpit.lastOutboundPreview) }}
              </p>
            </div>
            <div class="care-fact care-fact--appointment">
              <span class="care-fact-label">Lịch hẹn tiếp theo</span>
              <strong v-if="cockpit?.nextAppointment">
                {{ shortDateTime(cockpit.nextAppointment.at) }} · {{ relativeFuture(cockpit.nextAppointment.at) }}
              </strong>
              <strong v-else>Chưa có lịch hẹn</strong>
              <p v-if="cockpit?.nextAppointment?.title">{{ cockpit.nextAppointment.title }}</p>
            </div>
          </div>
        </section>

        <section v-if="cockpit?.getflyLink?.linked" class="care-section care-linked-crm">
          <div class="care-section-title">
            <Link2Icon :size="17" aria-hidden="true" />
            <span>CRM đã liên kết</span>
          </div>
          <div class="care-linked-row">
            <strong>Getfly</strong>
            <span>GF-{{ cockpit.getflyLink.getflyId }}</span>
            <small v-if="cockpit.getflyLink.linkedAt">Liên kết {{ shortDateTime(cockpit.getflyLink.linkedAt) }}</small>
          </div>
        </section>

        <div class="care-timeline">
          <CustomerTimelineSection
            :contact-id="props.contactId"
            :contact-name="headerFullName"
            @appointment-created="onAppointmentCreated"
          />
        </div>

        <section class="care-section">
          <div class="care-section-title">
            <UsersRoundIcon :size="17" aria-hidden="true" />
            <span>Người phụ trách</span>
          </div>
          <div class="cung-cham-list">
            <div v-for="acc in cungChamList" :key="acc.user?.id || acc.createdAt" class="cung-cham-row">
              <div class="cc-avatar-circle" :style="{ background: ccAvatarColor(acc.user?.fullName || acc.user?.email || '') }">
                {{ ccInitial(acc.user?.fullName || acc.user?.email || '?') }}
              </div>
              <div class="cc-info">
                <div class="cc-name">
                  {{ acc.user?.fullName || acc.user?.email || 'Sale' }}
                  <span v-if="acc.role === 'primary'" class="cc-role-primary">Phụ trách chính</span>
                  <span v-else class="cc-role-collab">Cùng chăm</span>
                </div>
                <div v-if="ccDateLabel(acc.createdAt)" class="cc-meta">Theo dõi từ {{ ccDateLabel(acc.createdAt) }}</div>
              </div>
            </div>
          </div>
          <div v-if="cungChamList.length === 0" class="crm-w-empty">Chưa gán nhân viên phụ trách.</div>
        </section>

        <section class="care-section care-team-section">
          <div class="care-section-title">
            <MessagesSquareIcon :size="17" aria-hidden="true" />
            <span>Tài khoản Zalo cùng chăm</span>
          </div>
          <div v-if="teammatesLoading" class="crm-w-loading">
            <div class="crm-spinner" /><span>Đang tải...</span>
          </div>
          <div v-else-if="teammatesFiltered.length" class="team-list">
            <div v-for="t in teammatesFiltered" :key="t.friendId" class="team-card">
              <div class="team-card-head">
                <Avatar :src="t.nick.avatarUrl" :name="t.nick.displayName || 'Nick'" :size="32" :gradient-seed="t.friendId" platform="zalo" />
                <div class="team-card-info">
                  <div class="team-name">{{ t.owner?.fullName || 'Sale chưa rõ' }}</div>
                  <div class="team-sub">Qua {{ t.nick.displayName || 'tài khoản Zalo' }} · {{ teammateStatus(t) }}</div>
                </div>
              </div>
              <div class="team-counts">
                <span>Khách gửi <strong>{{ t.totalInbound }}</strong> tin</span>
                <span>Nhân viên gửi <strong>{{ t.totalOutbound }}</strong> tin</span>
              </div>
              <button
                class="crm-btn-handoff"
                :disabled="!t.owner"
                :title="!t.owner ? 'Nick chưa gán cho sale nào' : ''"
                @click="onOpenHandoff(t)"
              >
                <MessageSquareShareIcon :size="15" aria-hidden="true" />
                Nhờ {{ shortName(t.owner?.fullName) || 'nhân viên' }} phối hợp
              </button>
            </div>
          </div>
          <div v-else class="crm-w-empty">Không có tài khoản khác cùng chăm khách này.</div>
        </section>
      </div>

      <!-- Sales handoff modal -->
      <SalesHandoffModal
        v-model="handoffOpen"
        :contact-name="headerFullName"
        :target-name="handoffContext.targetName"
        :target-user-id="handoffContext.targetUserId"
        :target-zalo-account-name="handoffContext.targetZaloAccountName"
        :sender-zalo-account-id="props.activeZaloAccountId ?? null"
        :sender-nick-name="senderNickName"
        :initial-content="handoffContent"
        :source="handoffSource"
        :loading="handoffLoading"
        @regenerate="onRegenerateHandoff"
      />

      <!-- Daily staff brief: AI translates signals into plain-language work. -->
      <div v-show="activeTab === 'activity'" class="tab-pane">
        <ConversationInsightCard
          v-if="props.conversationId"
          :conversation-id="props.conversationId"
          :private-blocked="props.conversationPrivateBlocked"
        />

        <!-- Automation cards cũ đã migrate sang Tab FOLLOW-UP (M9 Luồng Mục Tiêu 2026-06-02) -->
        <!-- Xem AutomationCardList ở tab FOLLOW-UP line 469 thay vì render tại tab Profile -->
        <!--<AutomationCardList :cards="automationCards" @action="onAutomationAction" @attach="onAttachAutomation" />-->

        <!-- Lịch hẹn -->
        <ChatAppointments
          v-if="props.contactId"
          :contact-id="props.contactId"
          :contact-name="headerFullName"
          :appointments="actionableAppointments"
          @refresh="reloadAppointments"
        />

      </div>
    </div>
    </template>
    <!-- /v-if mainTab=profile -->

    <!-- ════════ TAB AUTOMATION — danh sách Khối Marketing để gửi (2026-06-07) ════════ -->
    <div v-if="mainTab === 'media'" class="main-tab-body main-tab-body--no-padding">
      <MediaTabPanel
        v-if="props.conversationId"
        :conversation-id="props.conversationId"
        :contact="props.contact"
        :owner-nick-id="props.activeZaloAccountId"
        :nick-name="props.activeZaloAccountName"
      />
      <div v-else class="main-tab-placeholder">
        <div class="mtp-icon">🗂️</div>
        <h3>Media</h3>
        <p>Chưa chọn hội thoại để gửi ảnh/video/tệp/khối cho khách.</p>
      </div>
    </div>

    <!-- ════════ TAB AI (placeholder) ════════ -->
    <div v-if="mainTab === 'ai'" class="main-tab-body">
      <div class="main-tab-placeholder">
        <div class="mtp-icon">✨</div>
        <h3>Trợ lý AI Bất động sản</h3>
        <p>Hỏi đáp về sản phẩm, dự án BĐS, giá, ưu đãi để tư vấn KH.</p>
        <div class="mtp-coming">🚧 Đang phát triển — kết nối knowledge base BĐS HS Holding</div>
      </div>
    </div>

    <!-- ════════ TAB FOLLOW-UP — Luồng Mục Tiêu M9 wire 2026-06-02 ════════ -->
    <div v-if="mainTab === 'followup'" class="main-tab-body main-tab-body--no-padding">
      <!-- Follow-up Workflow (CE) — engine chăm sóc/bám đuổi nhiều bước. -->
      <FollowupPanel
        v-if="contact?.id"
        :contact-id="contact.id"
        :zalo-account-id="props.activeZaloAccountId || null"
      />
      <!-- Luồng Sequence là tính năng bản Enterprise — ở Community các API Sequence
           không tồn tại (modal báo "Lỗi tải danh sách Sequence"). Chỉ hiện khi là EE. -->
      <AutomationCardList
        v-if="contact?.id && isExtension"
        ref="automationCardListRef"
        :contact-id="contact.id"
        :nick-id="props.activeZaloAccountId || null"
        :nick-name="props.activeZaloAccountName || null"
        @add-flow="openAddFlowModal"
      />
      <div v-if="!contact?.id" class="main-tab-placeholder">
        <div class="mtp-icon">🎯</div>
        <h3>Luồng bám đuổi</h3>
        <p>Chưa chọn khách hàng để xem các luồng đang chạy.</p>
      </div>
    </div>

    <!-- Modal "+ Gắn thêm luồng" — mount qua Teleport để overlay full viewport -->
    <AddFlowModal
      v-if="showAddFlowModal && contact && isExtension"
      :contact-id="contact.id"
      :contact-name="contact.fullName || contact.crmName || ''"
      :nick-id="props.activeZaloAccountId || ''"
      :nick-name="props.activeZaloAccountName || ''"
      @close="closeAddFlowModal"
      @enrolled="onEnrolled"
    />

    <!-- ════════ Bottom 4-tab strip (Profile / Automation / AI / Follow-up) ════════ -->
    <nav class="bottom-tabs" role="tablist" aria-label="Chuyển tab chính">
      <button
        class="bottom-tab"
        :class="{ active: mainTab === 'profile' }"
        role="tab"
        :aria-selected="mainTab === 'profile'"
        title="Profile — Hồ sơ, CRM, Lịch hẹn, Điểm"
        @click="mainTab = 'profile'"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>
        <span class="bt-label">PROFILE</span>
      </button>
      <button
        class="bottom-tab"
        :class="{ active: mainTab === 'media' }"
        role="tab"
        :aria-selected="mainTab === 'media'"
        title="Media — Gửi ảnh/video/tệp/khối cho KH"
        @click="mainTab = 'media'"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
        <span class="bt-label">MEDIA</span>
      </button>
      <button
        class="bottom-tab"
        :class="{ active: mainTab === 'ai' }"
        role="tab"
        :aria-selected="mainTab === 'ai'"
        title="AI — Trợ lý hỏi đáp sản phẩm BĐS"
        @click="mainTab = 'ai'"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>
        <span class="bt-label">AI</span>
      </button>
      <button
        class="bottom-tab"
        :class="{ active: mainTab === 'followup' }"
        role="tab"
        :aria-selected="mainTab === 'followup'"
        title="Follow-up — Luồng bám đuổi KH"
        @click="mainTab = 'followup'"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
        <span class="bt-label">FOLLOW-UP</span>
      </button>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onBeforeUnmount, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import type { Contact } from '@/composables/use-contacts';
import type { AiSentiment } from '@/composables/use-chat';
import { useChatContactPanel } from '@/composables/use-chat-contact-panel';
import { displayPhone, displayPhoneIntl } from '@/composables/use-phone-format';
import ChatAppointments from './ChatAppointments.vue';
import ConversationInsightCard from './ConversationInsightCard.vue';
import AutomationCardList from './AutomationCardList.vue';
import FollowupPanel from './FollowupPanel.vue';
import { isExtension } from '@ee/edition';
import AddFlowModal from './AddFlowModal.vue';
import MediaTabPanel from './MediaTabPanel.vue';
import Avatar from '@/components/ui/Avatar.vue';
import ContactDealStageSelector from '@/components/chat/ContactDealStageSelector.vue';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/composables/use-toast';
import { api } from '@/api';
// Icon top-tab — Lucide line (anh chốt 2026-06-08, đồng bộ bottom-tab SVG).
import {
  Clock3 as Clock3Icon,
  Link2 as Link2Icon,
  MessageSquareShare as MessageSquareShareIcon,
  MessagesSquare as MessagesSquareIcon,
  User as UserIcon,
  Target as TargetIcon,
  Activity as ActivityIcon,
  UsersRound as UsersRoundIcon,
} from 'lucide-vue-next';
import CustomerTimelineSection from './CustomerTimelineSection.vue';
import SalesHandoffModal from './SalesHandoffModal.vue';
import { useContactCockpit, type Teammate } from '@/composables/use-contact-cockpit';
import { notificationPreview } from '@/composables/message-notification-utils';

const props = defineProps<{
  contactId: string | null;
  contact: Contact | null;
  // Nick CRM đang xem KH này — dùng để xác định Friend row "active" cho per-pair tag.
  activeZaloAccountId?: string | null;
  // Tên hiển thị nick CRM đang online — hiển thị trong modal handoff ("Từ nick: ...")
  activeZaloAccountName?: string | null;
  // Conversation hiện tại — dùng cho phân tích hội thoại ở tab Cần làm.
  conversationId?: string | null;
  conversationPrivateBlocked?: boolean;
  // Friend.id của cặp (contact × activeZaloAccount). Cần để fetch score breakdown per-pair.
  friendId?: string | null;
  // Friendship per-pair (nick × KH) — chứa aliasInNick để sync 2-way với Zalo Real.
  friendship?: { id?: string; aliasInNick?: string | null } | null;
  aiSummary: string;
  aiSummaryLoading: boolean;
  aiSentiment: AiSentiment | null;
  aiSentimentLoading: boolean;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
  'refresh-ai-summary': [];
  'refresh-ai-sentiment': [];
  'status-changed': [statusId: string | null];
}>();

// orgId cho ContactDealStageSelector (trạng thái cột 4 cạnh UID — sync với cột 3).
const _authStorePanel = useAuthStore();
const orgId = computed(() => _authStorePanel.user?.orgId ?? null);

// Đổi trạng thái ở cột 4 → cập nhật local contact + emit để cột 3 sync (cùng tab).
// Cross-device đã do BE emit friend:updated lo (ChatView listen).
function onDealStageUpdatedPanel(newStatusId: string | null) {
  if (props.contact) {
    (props.contact as { statusId?: string | null }).statusId = newStatusId;
  }
  emit('status-changed', newStatusId);
}

const {
  form, saveSuccess, saveError,
  contactAppointments,
  saveContact, reloadAppointments,
} = useChatContactPanel(
  () => props.contactId,
  () => props.contact,
  () => emit('saved'),
);

// ════════ Tên gợi nhớ Zalo (per-pair, sync 2-way với Zalo Real) ════════
// Bound to Friend.aliasInNick — PATCH /friends/:id sẽ:
//   1. Update DB
//   2. Fire-and-forget call api.changeFriendAlias / removeFriendAlias → push Zalo Real
const aliasDraft = ref('');
watch(() => props.friendship?.aliasInNick, (v) => {
  aliasDraft.value = v || '';
}, { immediate: true });

const aliasToast = useToast();
async function saveAlias() {
  const friendId = props.friendship?.id;
  if (!friendId) return;
  const trimmed = aliasDraft.value.trim();
  const newAlias = trimmed.length ? trimmed : null;
  if (newAlias === (props.friendship?.aliasInNick || null)) return;  // no-op
  try {
    await api.patch(`/friends/${friendId}`, { aliasInNick: newAlias });
    aliasToast.success(newAlias ? `Đã đổi tên gợi nhớ → "${newAlias}"` : 'Đã xoá tên gợi nhớ');
    emit('saved');  // parent refetch để lấy alias mới + reflect lên cột 2 + header
  } catch (err) {
    aliasToast.error('Lưu tên gợi nhớ thất bại');
  }
}

// ════════ Tab state (persist sang tab khác KH khác) ════════
// 2026-06-01: Refactor cột 4 4-tab — bottom strip Profile/Media/AI/Follow-up.
// 2026-06-12 (anh chốt): tab 'automation' → 'media' (gộp Picker Media + Automation:
//   Ảnh/Video/Tệp/Khối trong MediaTabPanel). `activeTab` (sub-tab) chỉ active scope 'profile'.
const mainTab = ref<'profile' | 'media' | 'ai' | 'followup'>('profile');
// Show the conversation analysis first when a chat is opened; staff can still
// switch to the profile/CRM tabs without losing the generated insight.
const activeTab = ref<'profile' | 'crm' | 'activity'>('activity');

// Cho phép cha (ChatView) mở tab Media từ nút "Chèn từ kho" ở composer cột 3.
function setMainTab(t: 'profile' | 'media' | 'ai' | 'followup') { mainTab.value = t; }
defineExpose({ setMainTab });

// ════════════════════════════════════════════════════════════════════════
// Info section state machine — 3 modes, in-memory only (KHÔNG persist):
//   'auto'   → expand + countdown 5s → auto-hide
//   'sticky' → user click 2nd time để ghim → KHÔNG auto-hide
//   'hidden' → ẩn (mặc định, hoặc sau countdown, hoặc user thu gọn)
//
// Flow toggle button (1 nút, 3-state cycle):
//   hidden → click → 'auto' (5s countdown)
//   'auto' (đang countdown) → click → 'sticky' (cancel countdown, ghim 📌)
//   'sticky' → click → 'hidden'
//
// Reload page / switch conv / switch tab → RESET về hidden (KHÔNG persist).
// Sticky chỉ giữ trong cùng conv + cùng tab Hồ Sơ.
// ════════════════════════════════════════════════════════════════════════
type ExpandMode = 'auto' | 'sticky' | 'hidden';
const expandMode = ref<ExpandMode>('hidden');
const infoExpanded = computed(() => expandMode.value !== 'hidden');
const isSticky = computed(() => expandMode.value === 'sticky');
const collapseRemain = ref(5);
let collapseTimer: ReturnType<typeof setInterval> | null = null;

function clearCollapseTimer() {
  if (collapseTimer) { clearInterval(collapseTimer); collapseTimer = null; }
}
function startAutoCollapse() {
  clearCollapseTimer();
  collapseRemain.value = 5;
  collapseTimer = setInterval(() => {
    collapseRemain.value--;
    if (collapseRemain.value <= 0) {
      // Chỉ tự hide khi đang ở mode 'auto'. Sticky thì never timeout.
      if (expandMode.value === 'auto') expandMode.value = 'hidden';
      clearCollapseTimer();
    }
  }, 1000);
}

// 3-state cycle trên 1 nút toggle (theo user spec):
//   hidden → 'auto' (countdown 5s)
//   'auto' → 'sticky' (ghim, cancel countdown)
//   'sticky' → 'hidden'
function toggleInfoExpand() {
  if (expandMode.value === 'hidden') {
    // Open lần đầu → auto countdown 5s
    expandMode.value = 'auto';
    startAutoCollapse();
  } else if (expandMode.value === 'auto') {
    // Click lần nữa khi đang auto → ghim sticky (cancel countdown)
    expandMode.value = 'sticky';
    clearCollapseTimer();
  } else {
    // sticky → hidden
    expandMode.value = 'hidden';
    clearCollapseTimer();
  }
}

// Khi click tab Hồ Sơ: auto-expand + countdown (KHÔNG sticky default).
// Khi switch tab khác: hidden.
watch(activeTab, (tab) => {
  if (tab === 'profile') {
    expandMode.value = 'auto';
    startAutoCollapse();
  } else {
    clearCollapseTimer();
    expandMode.value = 'hidden';
  }
});

// Animation: khi NotesSection emit 'appointment-created' (fly anim đã xong) → +1 badge với bump effect.
// pendingAptBump giữ count cho tới khi reloadAppointments() refresh data thực từ backend.
const pendingAptBump = ref(0);
const badgeBump = ref(false);
function onAppointmentCreated() {
  pendingAptBump.value++;
  badgeBump.value = true;
  setTimeout(() => { badgeBump.value = false; }, 600);
  // Reset bump NGAY trong .then() (không setTimeout 300ms) để Vue batch cùng frame
  //   activityBadgeCount: 0 → 1  (do reload)
  //   pendingAptBump:     1 → 0  (do reset)
  // Cả 2 update cùng microtask → 1 re-render duy nhất, badge từ 1 (bump) → 1 (real),
  // không flash số 2. Bug cũ: setTimeout 300ms giữ bump=1 sau khi data đã = 1 → badge = 2.
  reloadAppointments().then(() => {
    pendingAptBump.value = 0;
  });
}

// Listen global 'appointment-created' event — fire khi MessageThread (cột 3) tạo
// nhắc hẹn qua icon 📅 trong toolbar. Cùng pattern với zalo-labels-synced.
function onGlobalAppointmentCreated() { onAppointmentCreated(); }
onMounted(() => window.addEventListener('appointment-created', onGlobalAppointmentCreated));
onBeforeUnmount(() => {
  clearCollapseTimer();
  window.removeEventListener('appointment-created', onGlobalAppointmentCreated);
});

// ════════ Relations data (friends per nick = KH Con) — fetch khi đổi contact ═══
interface FriendItem {
  id: string;
  zaloUidInNick: string;
  relationshipKind: string;
  hasConversation: boolean;
  totalInbound: number;
  totalOutbound: number;
  becameFriendAt: string | null;
  lastInboundAt: string | null;
  leadScore: number;
  zaloDisplayName: string | null;
  zaloAvatarUrl: string | null;
  crmTagsPerNick: string[];
  statusRef: { id: string; name: string; order: number; color: string | null } | null;
  zaloAccount: { id: string; displayName: string | null; avatarUrl?: string | null; owner: { id: string; fullName: string } | null };
}
interface RelationsState {
  friends: FriendItem[];
}
const relations = ref<RelationsState>({ friends: [] });

async function fetchRelations(contactId: string) {
  try {
    const res = await api.get<{ friends?: FriendItem[] }>(`/contacts/${contactId}`);
    // Sort: "đang chat" lên đầu — sale chỉ care nick đã thực sự nhắn 1-1.
    const all = res.data.friends || [];
    all.sort((a, b) => {
      if (a.hasConversation !== b.hasConversation) return a.hasConversation ? -1 : 1;
      const at = a.lastInboundAt || '';
      const bt = b.lastInboundAt || '';
      return bt.localeCompare(at);
    });
    relations.value = { friends: all };
  } catch (err) {
    console.error('[ChatContactPanel] fetchRelations error:', err);
    relations.value = { friends: [] };
  }
}

// Care status legacy (CareStatusBadge) GỠ 2026-06-06 — cột 4 dùng ContactDealStageSelector
// (statusId dynamic) cạnh UID để sync với cột 3. onChangeCareStatus + import bỏ.

// ════════ Header name (Avatar component handle initials + gender + gradient) ════════
// B7 fix — Contact stub có thể fullName='Unknown'; fallback qua aliasInNick (props.friendship)
// rồi activeFriend.zaloDisplayName (nick đang chăm) trước khi hiện 'Khách hàng'.
const headerFullName = computed(() => {
  const isUsable = (s: string | null | undefined): s is string =>
    !!s && s.trim().length > 0 && s.trim().toLowerCase() !== 'unknown';
  if (isUsable(props.contact?.crmName)) return props.contact!.crmName!;
  if (isUsable(props.contact?.fullName)) return props.contact!.fullName!;
  if (isUsable(props.friendship?.aliasInNick)) return props.friendship!.aliasInNick!;
  const af = activeFriend.value as { zaloDisplayName?: string | null } | null;
  if (isUsable(af?.zaloDisplayName)) return af!.zaloDisplayName!;
  return 'Khách hàng';
});

// ════════ Phones extras ════════
const showExtraPhones = ref(false);
// SĐT chính: hiển thị format đẹp '0359 944 488' khi KHÔNG focus; khi focus thì show raw để
// sale gõ/sửa tự nhiên. Tooltip = '+84...' (Anh chốt 2026-06-06). Giá trị lưu vẫn raw.
const phoneFocused = ref(false);

// SĐT phụ — list động (form.phonesExtra). Thêm/xoá dòng, lưu khi blur.
function addExtraPhone() {
  form.phonesExtra.push({ label: '', phone: '' });
  showExtraPhones.value = true;
}
function removeExtraPhone(idx: number) {
  form.phonesExtra.splice(idx, 1);
  saveContact();
}

// Tag CRM hệ thống đã chuyển sang TagCrmBar trên chat input (Cột 3).
// Zalo Real labels chuyển sang dropdown trong header Cột 3 (MessageThread).

// ════════ Tab FOLLOW-UP — Luồng Mục Tiêu M9 (2026-06-02) ════════
// AutomationCardList tự fetch /api/v1/contacts/:cid/automation-status
// + tự poll 30s với Page Visibility API. Modal "+ Gắn thêm luồng" qua AddFlowModal.
const automationCardListRef = ref<InstanceType<typeof AutomationCardList> | null>(null);
const showAddFlowModal = ref(false);

function openAddFlowModal(): void {
  showAddFlowModal.value = true;
}

function closeAddFlowModal(): void {
  showAddFlowModal.value = false;
}

function onEnrolled(): void {
  showAddFlowModal.value = false;
  // Refresh card list để hiện luồng mới enroll
  if (automationCardListRef.value?.refetch) {
    void automationCardListRef.value.refetch();
  }
}

// ════════ Hồ sơ KH tổng hợp (phase sau) ════════
// Tạm thời chỉ navigate sang route /contacts/:id/profile (skeleton view).
// Sau khi backend GET /api/v1/contacts/:id/profile sẵn sàng + ContactProfileView
// implement đầy đủ → tab này hiển thị 3 field Email/Address/Occupation đã ẩn ở cột 4.
function openFullProfile() {
  if (!props.contact?.id) return;
  router.push(`/contacts/${props.contact.id}/profile`);
}

// activeFriend dùng cho headerFullName fallback (zaloDisplayName cho KH stub).
const activeFriend = computed<FriendItem | null>(() => {
  if (!props.activeZaloAccountId) return null;
  return relations.value.friends.find(f => f.zaloAccount.id === props.activeZaloAccountId) || null;
});

// Tên nick CRM đang online (hiển thị trong modal handoff: "Từ nick: ...")
// Ưu tiên prop activeZaloAccountName (từ ChatView pass xuống) → fallback activeFriend.
const senderNickName = computed<string | null>(() =>
  props.activeZaloAccountName || activeFriend.value?.zaloAccount?.displayName || null,
);

// ════════ Tab badges ════════
const actionableAppointments = computed(() => contactAppointments.value.filter((appointment) =>
  ['scheduled', 'overdue'].includes(appointment.status),
));
const activityBadgeCount = computed(() => {
  return actionableAppointments.value.length || null;
});

const toast = useToast();
const router = useRouter();

// Khi đổi sang contact mới, reset về tab Hồ sơ + refetch relations
// (NotesSection tự fetch khi prop contactId đổi).
// Cũng force reset infoExpanded + start countdown — nếu activeTab đã = 'profile',
// watch(activeTab) sẽ KHÔNG fire khi cùng giá trị → form section stuck ở state cũ.
watch(() => props.contactId, (id) => {
  activeTab.value = id && props.conversationId ? 'activity' : 'profile';
  // Switch conv hoặc reload page → reset về 'auto' (countdown 5s).
  // KHÔNG persist sticky giữa các conv (theo spec: sticky chỉ trong cùng conv).
  expandMode.value = 'auto';
  startAutoCollapse();
  if (id) void fetchRelations(id);
  else relations.value = { friends: [] };
  // Tab CRM cockpit data — fetch chỉ khi tab CRM được mở (xem watch(activeTab) bên dưới)
  if (!id) {
    cockpit.value = null;
    teammates.value = [];
  }
}, { immediate: true });

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (!Number.isFinite(diff)) return 'Chưa rõ thời gian';
  if (diff < 60_000) return 'Vừa xong';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'hôm qua';
  if (days < 7) return `${days} ngày trước`;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(dateStr));
}

function careMessagePreview(contentType: string | null | undefined, content: string | null | undefined) {
  return notificationPreview({ contentType: contentType || 'text', content: content || '' });
}

// Dữ liệu chăm sóc được tải khi nhân viên mở tab để tránh request thừa.
const { cockpit, teammates, loading: cockpitLoading, fetchCockpit, fetchTeammates, generateHandoffMessage } = useContactCockpit();

// Fetch cockpit + teammates khi tab CRM được mở lần đầu (lazy load tiết kiệm request)
watch([activeTab, () => props.contactId], async ([tab, id]) => {
  if (tab === 'crm' && id) {
    await Promise.all([
      fetchCockpit(id),
      fetchTeammates(id, props.activeZaloAccountId || undefined),
    ]);
  }
}, { immediate: false });

// Reload teammates khi đổi nick active
watch(() => props.activeZaloAccountId, (zaloId) => {
  if (activeTab.value === 'crm' && props.contactId) {
    void fetchTeammates(props.contactId, zaloId || undefined);
  }
});

// ─── Computed cho widgets ────────────────────────────────────────────────
const teammatesFiltered = computed<Teammate[]>(() => {
  const arr = teammates.value || [];
  // Backend đã filter excludeZaloAccountId; thêm dedup theo owner user (1 sale có thể có nhiều nick)
  const seen = new Set<string>();
  const out: Teammate[] = [];
  for (const t of arr) {
    const key = t.owner?.id || `nick:${t.zaloAccountId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
});

const teammatesLoading = computed(() => cockpitLoading.teammates);

// M55 2026-05-30 — Cùng chăm theo ContactAccess (primary + collaborator).
// Cover cả KH có Zalo (đã có teammatesFiltered từ Friend) + KH no-Zalo (Friend=[]).
interface CungChamRow {
  role: 'primary' | 'collaborator';
  source: string;
  createdAt: string;
  user: { id?: string; fullName: string | null; email: string | null } | null;
}
const cungChamList = computed<CungChamRow[]>(() => {
  const list = (props.contact as { contactAccess?: CungChamRow[] } | null | undefined)?.contactAccess;
  return Array.isArray(list) ? list : [];
});
function ccInitial(name: string): string {
  const t = (name || '').trim();
  if (!t) return '?';
  const parts = t.split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
const CC_AVATAR_COLORS = ['#0ea5e9', '#f97316', '#10b981', '#a855f7', '#ec4899', '#eab308', '#06b6d4', '#ef4444'];
function ccAvatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < (seed || '').length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return CC_AVATAR_COLORS[Math.abs(h) % CC_AVATAR_COLORS.length];
}
function ccDateLabel(iso: string): string | null {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
  } catch { return null; }
}

function shortDateTime(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${mi}`;
}

function relativeFuture(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const days = Math.round(diff / 86400000);
  if (days === 0) return 'hôm nay';
  if (days === 1) return 'ngày mai';
  if (days < 0) return `${-days} ngày trước`;
  return `${days} ngày nữa`;
}

function teammateStatus(t: Teammate): string {
  if (!t.lastInteractionAt) return 'chưa có tin nhắn';
  const diff = Date.now() - new Date(t.lastInteractionAt).getTime();
  const hours = diff / 3600000;
  if (hours < 1) return 'vừa trao đổi';
  if (hours < 24) return `trao đổi ${Math.max(1, Math.floor(hours))} giờ trước`;
  const days = Math.floor(hours / 24);
  return `trao đổi ${days} ngày trước`;
}

function shortName(full: string | null | undefined): string | null {
  if (!full) return null;
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1];
}

// ─── Sales handoff modal ────────────────────────────────────────────────
const handoffOpen = ref(false);
const handoffLoading = ref(false);
const handoffContent = ref('');
const handoffSource = ref<'template' | 'ai' | 'fallback'>('template');
const handoffContext = reactive<{
  contactId: string | null;
  targetUserId: string | null;
  targetZaloAccountId: string | null;
  targetName: string | null;
  targetZaloUid: string | null;
  targetZaloAccountName: string | null;
}>({
  contactId: null,
  targetUserId: null,
  targetZaloAccountId: null,
  targetName: null,
  targetZaloUid: null,
  targetZaloAccountName: null,
});

async function onOpenHandoff(t: Teammate) {
  // Guard: không re-fire khi đang loading hoặc modal đang mở
  if (handoffLoading.value || handoffOpen.value) return;
  if (!t.owner) {
    toast.warning('Nick này chưa gán cho sale nào');
    return;
  }
  if (!props.contactId) return;
  handoffContext.contactId = props.contactId;
  handoffContext.targetUserId = t.owner.id;
  handoffContext.targetZaloAccountId = t.zaloAccountId;
  handoffContext.targetName = t.owner.fullName;
  handoffContext.targetZaloUid = null;            // sẽ set từ BE response
  handoffContext.targetZaloAccountName = null;
  handoffContent.value = '';
  handoffSource.value = 'template';
  handoffLoading.value = true;
  handoffOpen.value = true;

  try {
    const res = await generateHandoffMessage({
      contactId: handoffContext.contactId,
      targetUserId: handoffContext.targetUserId,
      targetZaloAccountId: handoffContext.targetZaloAccountId || undefined,
    });
    if (res) {
      handoffContent.value = res.content;
      handoffSource.value = res.source;
      handoffContext.targetZaloUid = res.targetZaloUid;
      handoffContext.targetZaloAccountName = res.targetZaloAccountName;
    } else {
      // BE fail → đóng modal + report rõ lỗi
      handoffOpen.value = false;
      toast.error('Không soạn được tin phối hợp — vui lòng thử lại');
    }
  } catch (e) {
    handoffOpen.value = false;
    console.error('[handoff] open failed:', e);
    toast.error('Lỗi mạng khi soạn tin phối hợp');
  } finally {
    handoffLoading.value = false;
  }
}

async function onRegenerateHandoff() {
  if (!handoffContext.contactId || !handoffContext.targetUserId || handoffLoading.value) return;
  handoffLoading.value = true;
  try {
    const res = await generateHandoffMessage({
      contactId: handoffContext.contactId,
      targetUserId: handoffContext.targetUserId,
      targetZaloAccountId: handoffContext.targetZaloAccountId || undefined,
    });
    if (res) {
      handoffContent.value = res.content;
      handoffSource.value = res.source;
      handoffContext.targetZaloUid = res.targetZaloUid;
      handoffContext.targetZaloAccountName = res.targetZaloAccountName;
    }
  } finally {
    handoffLoading.value = false;
  }
}
</script>

<style scoped>
.info-panel {
  background: var(--smax-bg);
  border-left: 1px solid var(--smax-grey-200);
  display: flex; flex-direction: column;
  height: 100%; overflow: hidden;
  flex-shrink: 0;
}

/* ════════ Header (pinned) ════════ */
.ip-header {
  padding: 12px 42px 12px 14px;
  text-align: left;
  border-bottom: 1px solid var(--smax-grey-200);
  position: relative;
  flex-shrink: 0;
  background: #fff;
}
.ip-contact-head {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  align-items: center;
  gap: 11px;
}
.ip-contact-main { min-width: 0; }
.ip-header .ip-name-line {
  font-size: 14px;
  font-weight: 750;
  line-height: 1.3;
  margin: 0;
  padding: 0;
  text-align: left;
}
.ip-nick-line {
  margin-top: 2px;
  color: #667085;
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ip-care-row-inline {
  margin-top: 6px;
  display: flex;
}

.ip-close {
  position: absolute; top: 7px; right: 9px;
  width: 26px; height: 26px;
  background: transparent; border: none;
  font-size: 20px; cursor: pointer;
  color: var(--smax-grey-700);
  border-radius: 50%;
  z-index: 5;
}
.ip-close:hover { background: var(--smax-grey-100); }


.ip-avatar-wrap {
  position: relative;
  display: inline-block;
}
.ip-avatar-big {
  display: block;
}

/* Lead score badge — overlay trên avatar (góc dưới-phải), Smax-style "điểm KH" */
.lead-score-badge {
  position: absolute;
  bottom: -3px;
  right: -8px;
  background: var(--smax-bg, #fff);
  border: 2px solid #fff;
  border-radius: 11px;
  padding: 1px 7px 1px 6px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;
  white-space: nowrap;
  box-shadow: 0 1px 4px rgba(0,0,0,0.12);
  cursor: help;
}
.lead-score-badge.tier-hot   { background: #ffebee; color: #c62828; border-color: #ffcdd2; }
.lead-score-badge.tier-warm  { background: #fff3e0; color: #ef6c00; border-color: #ffe0b2; }
.lead-score-badge.tier-cool  { background: #e3f2fd; color: #1565c0; border-color: #bbdefb; }
.lead-score-badge.tier-cold  { background: #f5f6fa; color: var(--smax-grey-600); border-color: #e0e0e0; }

.ip-name-line {
  margin-top: 7px;
  font-size: 14px; font-weight: 600;
  color: var(--smax-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 0 17px;
}
.ip-id {
  font-size: 10.5px;
  color: var(--smax-grey-700);
  margin-top: 3px;
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  word-break: break-all;
  padding: 0 17px;
}
.ip-care-row { margin-top: 7px; }
.care-status-select {
  background: rgba(255,145,0,0.15);
  color: #ef6c00;
  border: 1px solid rgba(255,145,0,0.3);
  padding: 4px 11px;
  border-radius: 13px;
  font-size: 11.5px; font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.care-status-select:hover { background: rgba(255,145,0,0.22); }

/* ════════ Tab bar ════════ */
.ip-tabs {
  display: flex;
  border-bottom: 1px solid var(--smax-grey-200);
  background: var(--smax-grey-50);
  flex-shrink: 0;
}
.ip-tab {
  flex: 1;
  background: transparent; border: none;
  padding: 9px 7px;
  cursor: pointer;
  font-size: 12.5px; font-weight: 500;
  color: var(--smax-grey-700);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  font-family: inherit;
  position: relative;
  transition: color 0.15s;
}
.ip-tab .ic { font-size: 13px; line-height: 1; display: inline-flex; align-items: center; }
.ip-tab .ic > svg { display: block; }
.ip-tab:hover { color: var(--smax-primary); background: var(--smax-grey-100); }
.ip-tab.active {
  color: var(--smax-primary);
  border-bottom-color: var(--smax-primary);
  background: var(--smax-bg);
  font-weight: 600;
}
.tab-badge {
  position: absolute;
  top: 5px; right: 9px;
  background: var(--smax-primary);
  color: white;
  font-size: 10px; font-weight: 700;
  padding: 0 5px;
  border-radius: 8px;
  min-width: 16px;
  line-height: 14px;
  text-align: center;
  transition: transform 0.18s ease;
}
/* Bump effect — khi NotesSection báo created → scale + glow để feedback +1 */
.ip-tab.badge-bump .tab-badge {
  animation: badgeBump 0.6s ease;
}
@keyframes badgeBump {
  0%   { transform: scale(1); background: var(--smax-primary); }
  30%  { transform: scale(1.5); background: #f57c00; box-shadow: 0 0 0 6px rgba(245, 124, 0, 0.25); }
  60%  { transform: scale(1.1); background: #f57c00; }
  100% { transform: scale(1); background: var(--smax-primary); box-shadow: none; }
}

/* ════════ Tab content (scroll) ════════ */
.ip-tab-content {
  flex: 1; min-height: 0;
  overflow-y: auto;
}
.tab-pane {
  display: flex; flex-direction: column;
}
.tab-empty {
  padding: 26px 17px;
  font-size: 12px;
  color: var(--smax-grey-700);
  text-align: center;
  font-style: italic;
}
.tab-empty ul {
  text-align: left;
  padding: 0 0 0 18px;
  margin: 6px auto 0;
  max-width: 250px;
}
.tab-empty li { margin: 4px 0; }
.parent-card { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--smax-grey-200); border-radius: 8px; background: rgba(0,242,255,0.04); }
.parent-info { flex: 1; min-width: 0; }
.parent-name { font-weight: 600; font-size: 13px; }
.parent-meta { display: flex; gap: 8px; align-items: center; font-size: 11px; flex-wrap: wrap; margin-top: 4px; }
.friends-list { display: flex; flex-direction: column; gap: 10px; }
.friend-card { border: 1px solid var(--smax-grey-200); border-radius: 8px; padding: 10px 12px; background: var(--smax-bg); }
.friend-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.friend-card-title { flex: 1; min-width: 0; }
.friend-name { font-weight: 600; font-size: 13px; }
.friend-sub { font-size: 11px; color: var(--smax-grey-600); margin-top: 2px; }
.sale-name { font-weight: 500; }
.friend-card-row { display: flex; align-items: center; gap: 6px; font-size: 11.5px; padding: 3px 0; flex-wrap: wrap; }
.friend-card-row .lbl { color: var(--smax-grey-600); }
.friend-card-row .ml-auto { margin-left: auto; }
.friend-card-row.meta-line { padding-top: 6px; border-top: 1px dashed var(--smax-grey-200); margin-top: 4px; color: var(--smax-grey-700); }
.friend-card-row.meta-line strong { color: var(--smax-text); }
.conv-badge {
  font-size: 11px; font-weight: 700;
  padding: 1px 6px; border-radius: 4px;
  margin-left: 4px;
}
.conv-badge--on  { background: rgba(0,200,83,0.15); color: #00897b; }
.conv-badge--off { background: rgba(0,0,0,0.06);    color: #999;    }
.friend-customer-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; margin: 4px 0 6px;
  background: var(--smax-grey-50);
  border-radius: 6px;
  border-left: 3px solid var(--smax-primary);
}
.friend-customer-info { flex: 1; min-width: 0; }
.friend-customer-name {
  font-size: 12.5px; font-weight: 600;
  color: var(--smax-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.friend-customer-row .uid {
  display: inline-block;
  margin-top: 2px;
}
.friend-card-actions { display: flex; justify-content: flex-end; gap: 6px; padding-top: 8px; border-top: 1px dashed var(--smax-grey-200); margin-top: 6px; }
.btn-sm-danger { padding: 4px 10px; font-size: 11px; border: 1px solid #ffcdd2; color: #c62828; border-radius: 4px; background: rgba(255,82,82,0.05); cursor: pointer; }
.btn-sm-danger:hover { background: rgba(255,82,82,0.15); }
.status-edit { cursor: pointer; padding: 2px 8px; border-radius: 10px; font-size: 11px; }
.status-edit:hover { filter: brightness(1.1); }
.uid { font-family: monospace; font-size: 10.5px; color: var(--smax-grey-700); background: rgba(0,0,0,0.04); padding: 1px 4px; border-radius: 3px; }
.chip-grey { background: rgba(90,100,120,0.10); color: var(--smax-grey-700); padding: 1px 7px; border-radius: 9px; font-size: 10.5px; }
.tab-empty code {
  background: var(--smax-grey-100);
  padding: 0 4px; border-radius: 3px;
  font-size: 10.5px;
}

/* ════════ Inline form ════════ */
.ip-form { padding: 4px 0; border-bottom: 1px solid var(--smax-grey-200); }
.info-expand-toggle {
  width: 100%;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  color: var(--smax-primary, #2962ff);
  font-weight: 500;
  padding: 6px 13px;
  text-align: left;
  transition: background 0.12s;
}
.info-expand-toggle:hover { background: var(--smax-primary-soft, #e3f2fd); }
.info-expand-toggle.is-sticky {
  background: linear-gradient(135deg, #FEF3C7, #FDE68A);
  color: #92400E;
  border-color: #FCD34D;
}
.info-expand-toggle .sticky-badge {
  font-size: 11px;
  margin-left: 3px;
}

/* Link Hồ sơ KH tổng hợp — thay thế 3 field email/address/occupation ẩn ở cột 4 */
.info-fullprofile-link {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: calc(100% - 24px);
  margin: 6px 12px 4px;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #6366F1;
  background: #EEF2FF;
  border: 1px dashed #C7D2FE;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  font-family: inherit;
}
.info-fullprofile-link:hover {
  background: #E0E7FF;
  border-color: #818CF8;
  border-style: solid;
}
.ip-form-row {
  display: grid;
  grid-template-columns: 22px 80px 1fr;
  align-items: center;
  gap: 7px;
  padding: 7px 13px;
  border-bottom: 1px solid var(--smax-grey-100);
}
.ip-form-row.sub {
  grid-template-columns: 22px 80px 1fr;
  padding-left: 32px;
}
.ip-form-row:last-child { border-bottom: none; }
.ip-icon { font-size: 14px; opacity: 0.85; text-align: center; }
.ip-label { font-size: 12px; color: var(--smax-grey-700); }
.ip-form-row input,
.ip-form-row select {
  border: none; outline: none;
  font-size: 13px;
  background: transparent;
  width: 100%; min-width: 0;
  padding: 3px 4px;
  border-radius: 4px;
  font-family: inherit;
  color: var(--smax-text);
}
.ip-form-row input:hover,
.ip-form-row select:hover { background: var(--smax-grey-50); }
.ip-form-row input:focus,
.ip-form-row select:focus { background: var(--smax-primary-soft); }
.phone-cell {
  display: flex; align-items: center; gap: 5px;
  width: 100%;
}
.phone-cell input { flex: 1; }
.show-extra-phones {
  background: var(--smax-grey-100);
  border: 1px solid var(--smax-grey-300);
  border-radius: 9px;
  padding: 1px 7px;
  font-size: 11px;
  color: var(--smax-grey-700);
  cursor: pointer;
  flex-shrink: 0;
}
.show-extra-phones:hover { background: var(--smax-primary-soft); color: var(--smax-primary); }

/* ════════ SĐT phụ — list động nhãn tự nhập (2026-06-06) ════════
   Override grid của .ip-form-row.sub: dùng flex để nhãn + số + nút xoá nằm 1 hàng,
   không vỡ như 2 ô cố định cũ (label 80px wrap). */
.phone-extra-row {
  display: flex !important;
  align-items: center;
  gap: 6px;
  padding-left: 32px;
}
.phone-extra-row .pex-label {
  flex: 0 0 96px;
  min-width: 0;
  font-size: 12px;
  color: var(--smax-grey-700);
}
.phone-extra-row .pex-phone {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
}
.phone-extra-row .pex-remove {
  flex: 0 0 auto;
  background: none;
  border: none;
  color: var(--smax-grey-500);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.phone-extra-row .pex-remove:hover { color: var(--smax-danger, #e53935); }
.pex-add {
  margin: 4px 0 4px 32px;
  background: none;
  border: 1px dashed var(--smax-grey-300);
  border-radius: 8px;
  padding: 3px 10px;
  font-size: 12px;
  color: var(--smax-primary, #1786be);
  cursor: pointer;
}
.pex-add:hover { background: var(--smax-primary-soft); }

/* ════════ Section ════════ */
.ip-section {
  padding: 11px 17px;
  border-bottom: 1px solid var(--smax-grey-200);
}
.ip-section:last-child { border-bottom: none; }
.ip-section-title {
  display: flex; align-items: center; gap: 7px;
  font-size: 13px; font-weight: 600;
  color: var(--smax-text);
  margin-bottom: 7px;
}
.ip-section-title .accent {
  width: 3px; height: 14px;
  border-radius: 2px;
  background: var(--smax-grey-300);
}
.scope-tag {
  font-size: 10px; padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500; letter-spacing: 0.3px;
}
.scope-tag.global {
  background: rgba(33,150,243,0.12);
  color: #1565c0;
}
.scope-tag.pernick {
  background: rgba(255,145,0,0.18);
  color: #ef6c00;
}
.refresh-mini {
  margin-left: auto;
  width: 22px; height: 22px;
  border-radius: 50%;
  border: 1px solid var(--smax-grey-300);
  background: var(--smax-bg);
  cursor: pointer;
  font-size: 12px; color: var(--smax-grey-700);
}
.refresh-mini:hover:not(:disabled) { background: var(--smax-grey-50); color: var(--smax-primary); }
.refresh-mini:disabled { opacity: 0.5; cursor: not-allowed; }
.sentiment-reason {
  font-size: 12px;
  color: var(--smax-grey-700);
  margin-top: 7px;
  padding: 7px 9px;
  background: var(--smax-grey-50);
  border-radius: 5px;
  font-style: italic;
}

.tag-list {
  display: flex; flex-wrap: wrap; gap: 4px;
}
.tag-chip {
  background: var(--smax-grey-100);
  color: var(--smax-grey-700);
  padding: 3px 7px;
  border-radius: 7px;
  font-size: 11px;
  display: inline-flex; align-items: center; gap: 4px;
  cursor: default;
}
.tag-chip .x {
  cursor: pointer;
  opacity: 0.55;
  font-weight: 700;
}
.tag-chip .x:hover { opacity: 1; color: var(--smax-error); }
.tag-chip.add {
  background: transparent;
  border: 1px dashed var(--smax-grey-300);
  cursor: pointer;
  color: var(--smax-grey-700);
}
.tag-chip.add:hover { background: var(--smax-grey-50); border-color: var(--smax-primary); color: var(--smax-primary); }
.tag-input {
  border: 1px solid var(--smax-primary);
  outline: none;
  padding: 2px 7px;
  border-radius: 7px;
  font-size: 11px;
  width: 110px;
  font-family: inherit;
}
.tag-suggestions {
  display: flex; flex-wrap: wrap; gap: 4px;
  align-items: center;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--smax-grey-200);
}
.suggestion-label {
  font-size: 10.5px;
  color: var(--smax-grey-700);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  font-weight: 600;
}
.tag-chip.suggestion {
  background: transparent;
  border: 1px dashed var(--smax-primary);
  color: var(--smax-primary);
  font-size: 10.5px;
  padding: 2px 7px;
  cursor: pointer;
  border-radius: 7px;
  font-family: inherit;
}
.tag-chip.suggestion:hover {
  background: var(--smax-primary-soft);
}

.metrics-row {
  display: flex; align-items: baseline; gap: 5px;
  font-size: 13px;
}
.metric-num { font-size: 24px; font-weight: 700; color: var(--smax-success); }
.metric-label { color: var(--smax-grey-700); }
.metric-aux  { color: var(--smax-grey-700); font-size: 12px; }

/* ════════ Per-nick state section ════════ */
.kv-list { display: flex; flex-direction: column; gap: 4px; font-size: 12px; line-height: 1.55; }
.kv-row { display: flex; align-items: baseline; gap: 5px; flex-wrap: wrap; }
.kv-row .k { color: var(--smax-grey-700); min-width: 100px; }
.kv-row .v { color: var(--smax-text); font-weight: 500; }
.kv-row .muted { color: var(--smax-grey-300); font-size: 10.5px; font-style: italic; }
.kv-row code {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  background: var(--smax-grey-100);
  padding: 0 4px; border-radius: 3px;
  font-size: 10px;
}
.status-pill {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 7px; border-radius: 9px;
  font-size: 10px; font-weight: 500;
}
.pill-success { background: rgba(0,200,83,0.12); color: #00897b; }
.pill-warning { background: rgba(255,145,0,0.12); color: #ef6c00; }
.pill-info    { background: rgba(33,150,243,0.12); color: #1565c0; }

.empty-section {
  font-size: 11px; color: var(--smax-grey-700);
  font-style: italic;
  padding: 4px 0;
}

/* ════════ Other nicks list ════════ */
.nick-rows { display: flex; flex-direction: column; gap: 5px; }
.nick-row {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 0;
}
.ni-name { flex: 1; font-size: 12px; color: var(--smax-text); }

/* ════════ Chăm sóc ════════ */
.care-tab {
  padding: 12px;
  gap: 12px;
  background: #f7f8fa;
}
.care-section {
  padding: 12px;
  border: 1px solid var(--smax-grey-200);
  border-radius: 8px;
  background: #fff;
}
.care-section-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 10px;
  color: #344054;
  font-size: 12.5px;
  font-weight: 750;
}
.care-section-title svg { color: #526174; flex-shrink: 0; }
.care-facts { display: grid; gap: 0; }
.care-fact {
  min-width: 0;
  padding: 9px 0;
  border-bottom: 1px solid #eef0f3;
}
.care-fact:first-child { padding-top: 0; }
.care-fact:last-child { padding-bottom: 0; border-bottom: 0; }
.care-fact-label {
  display: block;
  margin-bottom: 3px;
  color: #667085;
  font-size: 10.5px;
}
.care-fact strong {
  display: block;
  color: #172033;
  font-size: 12.5px;
  line-height: 1.35;
}
.care-fact p {
  display: -webkit-box;
  overflow: hidden;
  margin: 3px 0 0;
  color: #667085;
  font-size: 11px;
  line-height: 1.4;
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.care-fact--appointment strong { color: #067647; }
.care-linked-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 3px 8px;
  font-size: 12px;
}
.care-linked-row span { color: #067647; font-weight: 700; text-align: right; }
.care-linked-row small { grid-column: 1 / -1; color: #667085; }
.care-timeline {
  overflow: hidden;
  border: 1px solid var(--smax-grey-200);
  border-radius: 8px;
  background: #fff;
}
.care-timeline :deep(.timeline-section) { padding: 0; }
.care-timeline :deep(.tl-header),
.care-timeline :deep(.note-composer),
.care-timeline :deep(.tl-list),
.care-timeline :deep(.tl-state) { padding-left: 12px; padding-right: 12px; }
.crm-w-loading {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 0;
  color: var(--smax-grey-600);
  font-size: 12px;
}
.crm-spinner {
  width: 14px; height: 14px;
  border: 2px solid var(--smax-grey-200);
  border-top-color: #4f46e5;
  border-radius: 50%;
  animation: crm-spin 700ms linear infinite;
}
@keyframes crm-spin {
  to { transform: rotate(360deg); }
}

.crm-w-empty {
  color: var(--smax-grey-500);
  font-size: 11.5px;
  padding: 4px 0;
}
.team-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* M55 2026-05-30 — Cùng chăm theo ContactAccess */
.cung-cham-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cung-cham-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: #fafbfc;
  border: 1px solid var(--smax-grey-200);
  border-radius: 6px;
}
.cc-avatar-circle {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  text-transform: uppercase;
}
.cc-info { flex: 1; min-width: 0; }
.cc-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--smax-text);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.cc-role-primary {
  background: #ecfdf3;
  color: #067647;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid #abefc6;
}
.cc-role-collab {
  background: #eff8ff;
  color: #175cd3;
  font-size: 9px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid #b2ddff;
}
.cc-meta {
  font-size: 10px;
  color: var(--smax-grey-700);
  margin-top: 1px;
}
.team-card {
  border: 1px solid var(--smax-grey-200);
  border-radius: 8px;
  padding: 8px 9px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  background: #fafafa;
}
.team-card-head {
  display: flex; align-items: center; gap: 8px;
}
.team-card-info {
  flex: 1;
  min-width: 0;
}
.team-name {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--smax-grey-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.team-sub {
  font-size: 11px;
  color: var(--smax-grey-600);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.team-counts {
  display: flex; gap: 5px 12px; flex-wrap: wrap;
  font-size: 10.5px;
  color: var(--smax-grey-700);
}
.crm-btn-handoff {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: #fff;
  color: #175cd3;
  border: 1px solid #b2ddff;
  border-radius: 7px;
  padding: 6px 10px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
}
.crm-btn-handoff:hover:not(:disabled) { background: #eff8ff; }
.crm-btn-handoff:disabled { opacity: 0.45; cursor: not-allowed; }

/* ═════════ 2026-06-01: Bottom 4-tab strip + placeholder panels ═════════ */
.bottom-tabs {
  display: flex;
  border-top: 1px solid #dddddd;
  background: white;
  flex-shrink: 0;
  margin-top: auto;
}
.bottom-tab {
  flex: 1;
  padding: 10px 4px 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  color: #6b7280;
  transition: all 0.15s;
  border-top: 3px solid transparent;
  margin-top: -1px;
  font-family: inherit;
}
.bottom-tab:hover { background: #fafbfc; }
.bottom-tab.active {
  color: #0068FF;
  border-top-color: #0068FF;
}
.bottom-tab svg {
  width: 20px;
  height: 20px;
  stroke-width: 1.75;
}
.bottom-tab.active svg { stroke-width: 2; }
.bt-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
}

.main-tab-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* FOLLOW-UP tab — AutomationCardList tự handle padding (16px nội bộ) + align-start */
.main-tab-body.main-tab-body--no-padding {
  padding: 0;
  display: block;
  align-items: stretch;
  justify-content: stretch;
}
.main-tab-placeholder {
  text-align: center;
  max-width: 280px;
}
.mtp-icon {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.6;
}
.main-tab-placeholder h3 {
  font-size: 16px;
  font-weight: 700;
  color: #181d26;
  margin: 0 0 6px;
}
.main-tab-placeholder p {
  font-size: 13px;
  color: #41454d;
  line-height: 1.5;
  margin: 0 0 16px;
}
.mtp-coming {
  display: inline-block;
  padding: 6px 12px;
  background: #FFF4E6;
  border: 1px solid #FFA726;
  color: #E65100;
  font-size: 11px;
  border-radius: 6px;
  font-weight: 500;
  margin-bottom: 12px;
}
.mtp-link {
  display: inline-block;
  margin-top: 8px;
  padding: 8px 16px;
  background: #0068FF;
  color: white;
  text-decoration: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}
.mtp-link:hover { background: #0050cc; }
</style>
