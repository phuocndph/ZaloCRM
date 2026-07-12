<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- Màn chat mobile. Tái dùng useChat (API + socket + optimistic send) và
     message-bubble.vue (render ảnh/sticker/reply/thu hồi) — không viết lại renderer. -->
<template>
  <div class="mch-wrap">
    <header class="mch-head">
      <button class="m-iconbtn mch-back" aria-label="Quay lại" @click="goBack">
        <ChevronLeftIcon :size="26" :stroke-width="2.2" />
      </button>
      <div class="mch-avatar">
        <img v-if="avatarUrl" :src="avatarUrl" alt="" />
        <span v-else>{{ initial }}</span>
      </div>
      <div class="mch-info">
        <div class="mch-name">{{ title }}</div>
        <div v-if="nickName" class="mch-nick">qua {{ nickName }}</div>
      </div>
      <!-- Header gọn: chỉ Tìm + ⋮ (More). Ghi chú / Lịch hẹn / Nội dung / Ghim gom vào menu. -->
      <button class="m-iconbtn mch-pinned" aria-label="Tìm trong hội thoại" @click="openContentSearch">
        <SearchIcon :size="20" :stroke-width="1.9" />
      </button>
      <button class="m-iconbtn mch-pinned" aria-label="Thêm" @click="showHeaderMenu = true">
        <MoreVerticalIcon :size="20" :stroke-width="1.9" />
      </button>
    </header>

    <!-- Menu header (gom hành động phụ) -->
    <MBottomSheet v-model="showHeaderMenu" title="Hội thoại">
      <button class="mch-act-item" @click="openContentLibrary(); showHeaderMenu = false">
        <FolderOpenIcon :size="20" :stroke-width="1.9" /><span>Nội dung đã chia sẻ</span>
      </button>
      <button class="mch-act-item" @click="openPinned(); showHeaderMenu = false">
        <PinIcon :size="20" :stroke-width="1.9" /><span>Tin đã ghim</span>
      </button>
      <button v-if="selectedConv?.contact" class="mch-act-item" @click="showNotes = true; showHeaderMenu = false">
        <StickyNoteIcon :size="20" :stroke-width="1.9" /><span>Ghi chú nội bộ</span>
      </button>
      <button v-if="selectedConv?.contact" class="mch-act-item" @click="showAppointmentEditor = true; showHeaderMenu = false">
        <CalendarClockIcon :size="20" :stroke-width="1.9" /><span>Tạo lịch hẹn</span>
      </button>
    </MBottomSheet>

    <div ref="scroller" class="mch-msgs" @scroll.passive="onScroll">
      <div v-if="loadingOlder" class="mch-history-status">Đang tải tin cũ...</div>
      <div v-else-if="historyError" class="mch-history-status mch-history-status--err">
        Không tải được tin cũ. <button class="mch-history-retry" @click="retryHistory">Thử lại</button>
      </div>
      <!-- Riêng tư cấp hội thoại 2026-07-09 — BE trả 403, không có tin nhắn nào để hiện.
           Phải chặn TRƯỚC nhánh "Chưa có tin nhắn" (nếu không sẽ nói sai sự thật). -->
      <div v-if="conversationPrivateBlocked" class="mch-state mch-state--private">Riêng tư - {{ CONVERSATION_PRIVATE_MESSAGE }}</div>
      <div v-else-if="loadingMsgs && !messages.length" class="mch-state">Đang tải tin nhắn...</div>
      <div v-else-if="!messages.length" class="mch-state">Chưa có tin nhắn.</div>

      <div v-for="(m, i) in (conversationPrivateBlocked ? [] : messages)" :key="m.id">
        <div v-if="showDateDivider(i)" class="mch-day">{{ dateLabel(m.sentAt) }}</div>
        <div
          class="mch-row"
          :data-msg-id="m.id"
          @contextmenu.prevent="openActions(m)"
          @touchstart.passive="onRowTouchStart(m)"
          @touchmove.passive="onRowTouchMove"
          @touchend="onRowTouchEnd"
        >
          <MessageBubble
          :message="m"
          :reply="(m as any).reply || null"
          :reactions="(m as any).reactions || []"
          :is-self="m.senderType === 'self'"
          :is-group="selectedConv?.threadType === 'group'"
          :is-group-start="isGroupStart(i)"
          :is-group-end="isGroupEnd(i)"
          :sender-avatar-url="resolveSenderAvatar(m)"
          :current-user-id="currentUserId"
          @preview-image="onPreviewImage"
          @preview-video="onPreviewVideo"
          @jump-to-reply="jumpToReply"
          />
        </div>
      </div>
    </div>

    <!-- Long-press → menu hành động tin (P1). Chỉ hiện hành động đúng loại tin + quyền. -->
    <MBottomSheet v-model="showActions">
      <div v-if="actionMsg" class="mch-react">
        <button v-for="e in QUICK_EMOJIS" :key="e" class="mch-react-btn" @click="onReact(e)">{{ e }}</button>
      </div>
      <button v-if="actionReactionDetails.length" class="mch-act-item" @click="openReactionDetails">
        <span class="mch-reaction-summary">{{ actionReactionDetails.length }} cảm xúc</span>
        <span>Xem chi tiết</span>
      </button>
      <button class="mch-act-item" @click="onReply">
        <ReplyIcon :size="20" :stroke-width="1.9" /><span>Trả lời</span>
      </button>
      <button class="mch-act-item" @click="openForward">
        <ForwardIcon :size="20" :stroke-width="1.9" /><span>Chuyển tiếp</span>
      </button>
      <button v-if="actionCanPin && !actionIsPinned" class="mch-act-item" @click="onPin">
        <PinIcon :size="20" :stroke-width="1.9" /><span>Ghim tin nhắn</span>
      </button>
      <button v-else-if="actionCanPin" class="mch-act-item" @click="onUnpin">
        <PinOffIcon :size="20" :stroke-width="1.9" /><span>Bỏ ghim</span>
      </button>
      <button v-if="actionCanCopy" class="mch-act-item" @click="onCopy">
        <CopyIcon :size="20" :stroke-width="1.9" /><span>Sao chép</span>
      </button>
      <a v-if="actionMediaUrl" class="mch-act-item" :href="actionMediaUrl" target="_blank" rel="noopener" download @click="showActions = false">
        <DownloadIcon :size="20" :stroke-width="1.9" /><span>Tải xuống</span>
      </a>
      <template v-if="actionMsg?.senderType === 'self'">
        <button class="mch-act-item" @click="onRecall">
          <RotateCcwIcon :size="20" :stroke-width="1.9" /><span>Thu hồi</span>
        </button>
        <button class="mch-act-item danger" @click="onDelete">
          <Trash2Icon :size="20" :stroke-width="1.9" /><span>Xóa</span>
        </button>
      </template>
    </MBottomSheet>

    <MBottomSheet v-model="showForward" title="Chuyển tiếp tin nhắn">
      <div class="mch-forward-search"><SearchIcon :size="18" :stroke-width="2" /><input v-model="forwardQuery" type="search" placeholder="Tìm hội thoại" /></div>
      <div v-if="forwardLoading" class="mch-sheet-state">Đang tải hội thoại...</div>
      <div v-else-if="!forwardCandidates.length" class="mch-sheet-state">Không có hội thoại phù hợp.</div>
      <button v-for="conversation in forwardCandidates" :key="conversation.id" class="mch-forward-item" :class="{ selected: forwardTargetIds.has(conversation.id) }" @click="toggleForwardTarget(conversation.id)">
        <span class="mch-forward-check">{{ forwardTargetIds.has(conversation.id) ? '✓' : '' }}</span>
        <span class="mch-forward-name">{{ forwardName(conversation) }}</span>
      </button>
      <div class="mch-forward-foot"><span>Đã chọn {{ forwardTargetIds.size }}</span><button :disabled="forwardTargetIds.size === 0 || forwarding" @click="submitForward">{{ forwarding ? 'Đang chuyển...' : 'Chuyển tiếp' }}</button></div>
    </MBottomSheet>

    <MBottomSheet v-model="showContentLibrary" title="Nội dung đã chia sẻ">
      <div class="mch-content-tabs">
        <button :class="{ on: contentLibraryTab === 'media' }" @click="setContentLibraryTab('media')">Ảnh/Video</button>
        <button :class="{ on: contentLibraryTab === 'files' }" @click="setContentLibraryTab('files')">Tệp</button>
        <button :class="{ on: contentLibraryTab === 'links' }" @click="setContentLibraryTab('links')">Liên kết</button>
      </div>
      <div v-if="contentLibraryLoading" class="mch-sheet-state">Đang tải...</div>
      <div v-else-if="!contentLibraryItems.length" class="mch-sheet-state">Chưa có nội dung phù hợp.</div>
      <button v-for="message in contentLibraryItems" :key="message.id" class="mch-library-item" @click="openContentLibraryMessage(message)">
        <img v-if="contentLibraryTab === 'media' && contentLibraryThumbnail(message)" class="mch-library-thumb" :src="contentLibraryThumbnail(message)" alt="" />
        <span v-else class="mch-library-icon" aria-hidden="true">
          <ImageIcon v-if="contentLibraryTab === 'media'" :size="22" />
          <PaperclipIcon v-else-if="contentLibraryTab === 'files'" :size="22" />
          <LinkIcon v-else :size="22" />
        </span>
        <span class="mch-library-body">
          <span class="mch-content-result-name">{{ message.senderName || 'Tin nhắn' }} - {{ dateLabel(message.sentAt) }}</span>
          <strong class="mch-library-title">{{ contentLibraryTitle(message) }}</strong>
          <span v-if="contentLibraryDescription(message)" class="mch-library-description">{{ contentLibraryDescription(message) }}</span>
          <span v-if="contentLibraryTab !== 'media' && contentLibraryUrl(message)" class="mch-library-url">{{ contentLibraryUrlLabel(message) }}</span>
        </span>
      </button>
    </MBottomSheet>

    <!-- Tìm trong hội thoại kiểu Zalo: thanh trên đầu + đếm 1/N + nút ↑/↓ nhảy giữa các kết quả. -->
    <Teleport to="body">
      <div v-if="showContentSearch" class="mch-searchbar-wrap">
        <div class="mch-searchbar">
          <button class="m-iconbtn" aria-label="Đóng tìm kiếm" @click="closeContentSearch"><ChevronLeftIcon :size="24" :stroke-width="2.2" /></button>
          <div class="mch-searchbar-input">
            <SearchIcon :size="17" :stroke-width="2" />
            <input
              v-model="contentSearchQuery" type="search" enterkeyhint="next"
              placeholder="Tìm tin nhắn"
              @input="scheduleContentSearch"
              @keydown.enter.prevent="onSearchEnter"
            />
            <button v-if="contentSearchQuery" class="mch-searchbar-clear" aria-label="Xóa" @click="clearSearch"><XIcon :size="16" :stroke-width="2.4" /></button>
          </div>
          <div v-if="contentSearchResults.length" class="mch-searchbar-nav">
            <span class="mch-search-count">{{ searchActiveIndex + 1 }}/{{ contentSearchResults.length }}</span>
            <button class="m-iconbtn" aria-label="Kết quả trước" @click="prevMatch"><ChevronUpIcon :size="22" :stroke-width="2.2" /></button>
            <button class="m-iconbtn" aria-label="Kết quả sau" @click="nextMatch"><ChevronDownIcon :size="22" :stroke-width="2.2" /></button>
          </div>
        </div>
        <!-- Danh sách kết quả (ẩn sau khi nhảy tới 1 tin để thấy khung chat). -->
        <div v-if="showSearchList" class="mch-search-panel" @click.self="showSearchList = false">
          <div class="mch-search-panel-inner">
            <div v-if="contentSearchLoading" class="mch-sheet-state">Đang tìm...</div>
            <div v-else-if="contentSearchQuery.trim() && !contentSearchResults.length" class="mch-sheet-state">Không tìm thấy tin nhắn phù hợp.</div>
            <div v-else-if="!contentSearchQuery.trim()" class="mch-sheet-state">Nhập từ khóa để tìm trong hội thoại này.</div>
            <button
              v-for="(message, idx) in contentSearchResults" :key="message.id"
              class="mch-content-result" :class="{ on: idx === searchActiveIndex }"
              @click="selectMatch(idx)"
            >
              <span class="mch-content-result-name">{{ message.senderName || 'Tin nhắn' }} - {{ dateLabel(message.sentAt) }}</span>
              <span class="mch-content-result-text" v-html="highlightSnippet(message.content)"></span>
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <MBottomSheet v-model="showReactionDetails" title="Cảm xúc">
      <div v-if="!actionReactionDetails.length" class="mch-sheet-state">Chưa có cảm xúc.</div>
      <div v-for="detail in actionReactionDetails" :key="`${detail.reactorId}-${detail.emoji}`" class="mch-reaction-detail">
        <span class="mch-reaction-emoji">{{ detail.emoji }}</span>
        <span class="mch-reaction-name">{{ detail.reactorName || 'Người dùng' }}</span>
      </div>
    </MBottomSheet>

    <MBottomSheet v-model="showPinned" title="Tin đã ghim">
      <div v-if="pinnedLoading" class="mch-sheet-state">Đang tải tin đã ghim...</div>
      <div v-else-if="!pinnedItems.length" class="mch-sheet-state">Chưa có tin nhắn nào được ghim.</div>
      <button v-for="item in pinnedItems" :key="item.pinId" class="mch-pinned-item" @click="jumpToPinned(item)">
        <span class="mch-pinned-by">{{ item.pinnedByName }} - {{ formatPinnedTime(item.pinnedAt) }}</span>
        <span class="mch-pinned-text">{{ replyPreview(item.message?.content || (item.missing ? 'Tin nhắn không còn khả dụng' : 'Nội dung đính kèm')) }}</span>
      </button>
    </MBottomSheet>

    <MBottomSheet v-model="showNotes" title="Ghi chú nội bộ"><NotesSection :contact-id="selectedConv?.contact?.id ?? null" :contact-name="selectedConv?.contact?.fullName ?? null" /></MBottomSheet>

    <AppointmentEditor
      v-model="showAppointmentEditor"
      :prefill-contact="selectedConv?.contact ? { id: selectedConv.contact.id, fullName: selectedConv.contact.fullName, phone: selectedConv.contact.phone, zaloUid: selectedConv.contact.zaloUid ?? null, zaloUsername: (selectedConv.contact as any).zaloUsername ?? null } : null"
      :current-user-id="currentUserId"
      @created="toast.push('Đã tạo lịch hẹn')"
    />

    <MBottomSheet v-model="showTemplatePicker" title="Mảu tin nhắn"><div v-if="templatesLoading" class="mch-sheet-state">Đang tải mảu?</div><div v-else-if="!templates.length" class="mch-sheet-state">Chưa có mảu tin nhắn.</div><button v-for="template in templates" :key="template.id" class="mch-content-result" @click="selectTemplate(template)"><span class="mch-content-result-name">{{ template.name }}</span><span class="mch-content-result-text">{{ replyPreview(template.content) }}</span></button></MBottomSheet>
    <TemplateComposerPreview v-if="showTemplatePreview" :conversation-id="convId" :initial-blocks="templateBlocks" :can-send="!conversationPrivateBlocked" @cancel="showTemplatePreview = false" @done="showTemplatePreview = false" />

    <MBottomSheet v-model="showComposerTools" title="Thêm chức năng">
      <div class="mch-tool-grid">
        <button @click="imageInput?.click(); showComposerTools = false"><ImageIcon :size="23" /><span>Ảnh</span></button>
        <button @click="cameraInput?.click(); showComposerTools = false"><CameraIcon :size="23" /><span>Camera</span></button>
        <button @click="fileInput?.click(); showComposerTools = false"><PaperclipIcon :size="23" /><span>Tệp</span></button>
        <button @click="showMediaPicker = true; showComposerTools = false"><FolderOpenIcon :size="23" /><span>Kho Media</span></button>
        <button @click="openTemplatePicker(); showComposerTools = false"><BookOpenIcon :size="23" /><span>Mẫu tin</span></button>
        <button @click="showCopilot = true; showComposerTools = false"><SparklesIcon :size="23" /><span>Trả lời AI</span></button>
      </div>
    </MBottomSheet>

    <MBottomSheet v-model="showMediaPicker" title="Kho Media"><div class="mch-media-picker-sheet"><MediaPickerPopover :conversation-id="convId" @close="showMediaPicker = false" @sent="onMediaSent" /></div></MBottomSheet>

    <!-- Gộp Emoji + Sticker vào 1 sheet (1 nút trên thanh soạn). -->
    <MBottomSheet v-model="showEmojiSticker" title="Biểu cảm">
      <div class="mch-es-tabs">
        <button :class="{ on: emojiStickerTab === 'emoji' }" @click="emojiStickerTab = 'emoji'">Emoji</button>
        <button :class="{ on: emojiStickerTab === 'sticker' }" @click="emojiStickerTab = 'sticker'">Sticker</button>
      </div>
      <div v-if="emojiStickerTab === 'emoji'" class="mch-emoji-grid">
        <button v-for="e in EMOJI_LIST" :key="e" class="mch-emoji-cell" @click="onEmoji(e)">{{ e }}</button>
      </div>
      <div v-else class="mch-sticker-tab">
        <StickerPicker inline @select="(s) => { onSendSticker(s); showEmojiSticker = false; }" />
      </div>
    </MBottomSheet>

    <AiCopilotPanel :open="showCopilot" :conversation-id="convId" :private-blocked="conversationPrivateBlocked" @close="showCopilot = false" />

    <!-- Lightbox ảnh + modal video (P1 — xem media toàn màn hình) -->
    <MLightbox :open="!!lightboxUrl" :url="lightboxUrl" @close="lightboxUrl = null" />
    <Teleport to="body">
      <div v-if="videoUrl" class="mch-video" @click.self="closeVideo">
        <button class="mch-video-close" aria-label="Đóng" @click="closeVideo"><XIcon :size="24" :stroke-width="2" /></button>
        <video ref="videoEl" :src="videoUrl" class="mch-video-el" controls playsinline preload="metadata"></video>
      </div>
    </Teleport>
    <button v-if="unseenCount > 0" class="mch-new" @click="jumpLatest">↓ {{ unseenCount }} tin mới</button>
    <div v-if="realtimeOffline" class="mch-offline">Đang mất kết nối; nội dung đang soạn vẫn được giữ.</div>

    <TypingIndicator v-if="currentTypers.length" :typers="currentTypers" />

    <div v-if="sendError" class="mch-retry">
      Gửi thất bại.
      <button @click="retry">Thử lại</button>
      <button class="ghost" @click="sendError = null">Bỏ qua</button>
    </div>

    <!-- Input luôn dính đáy — trừ hội thoại riêng tư của người khác (BE cũng chặn gửi). -->
    <footer v-if="!conversationPrivateBlocked" class="mch-input">
      <div v-if="replyingTo" class="mch-replybar">
        <div class="mch-replybar-body"><b>Trả lời {{ replyingTo.senderName || 'tin nhắn' }}</b><span>{{ replyPreview(replyingTo.content) }}</span></div>
        <button class="m-iconbtn" aria-label="Hủy trả lời" @click="clearReplyTo"><XIcon :size="19" :stroke-width="2" /></button>
      </div>
      <div v-if="pendingFiles.length" class="mch-attachment-queue"><span v-for="file in pendingFiles" :key="file.name + file.size" class="mch-attachment-chip">{{ file.name }}<button @click="removePendingFile(file)"><XIcon :size="13" /></button></span></div>
      <div class="mch-composer-row">
        <button class="m-iconbtn mch-tool" aria-label="Thêm chức năng" @click="showComposerTools = true"><PlusIcon :size="24" :stroke-width="2" /></button>
        <textarea
          ref="textarea" v-model="text" rows="1" placeholder="Nhập tin nhắn..."
          @keydown.enter.exact.prevent="send" @input="onComposerInput"
        />
        <!-- 1 nút gộp Emoji + Sticker (luôn hiện, kể cả khi đang gõ). -->
        <button type="button" class="m-iconbtn mch-emoji-btn" aria-label="Emoji và Sticker" @click="showEmojiSticker = true">
          <SmileIcon :size="23" :stroke-width="1.9" />
        </button>
        <button class="mch-send" :class="{ ready: (text.trim() || pendingFiles.length) && !sendingMsg }" :disabled="(!text.trim() && !pendingFiles.length) || sendingMsg" aria-label="Gửi" @click="send">
          <LoaderIcon v-if="sendingMsg" :size="20" :stroke-width="2.4" class="mch-spin" />
          <SendIcon v-else :size="20" :stroke-width="2" />
        </button>
        <input ref="imageInput" type="file" accept="image/*" multiple hidden @change="queueAttachments" />
        <input ref="cameraInput" type="file" accept="image/*" capture="environment" hidden @change="queueAttachments" />
        <input ref="fileInput" type="file" multiple hidden @change="queueAttachments" />
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api/index';
import { useChat } from '@/composables/use-chat';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/composables/use-toast';
import { groupAvatarStore } from '@/composables/use-group-avatar-cache';
import {
  ChevronLeft as ChevronLeftIcon, Image as ImageIcon, Send as SendIcon, Loader2 as LoaderIcon, Reply as ReplyIcon, Paperclip as PaperclipIcon, Camera as CameraIcon, CalendarClock as CalendarClockIcon, StickyNote as StickyNoteIcon, Sparkles as SparklesIcon, BookOpen as BookOpenIcon, Plus as PlusIcon,
  X as XIcon, Copy as CopyIcon, Download as DownloadIcon, RotateCcw as RotateCcwIcon, Trash2 as Trash2Icon, Pin as PinIcon, PinOff as PinOffIcon, Forward as ForwardIcon, Search as SearchIcon, FolderOpen as FolderOpenIcon, Link as LinkIcon, MoreVertical as MoreVerticalIcon, Smile as SmileIcon, ChevronUp as ChevronUpIcon, ChevronDown as ChevronDownIcon,
} from 'lucide-vue-next';
import MessageBubble from '@/components/chat/message-bubble.vue';
import MLightbox from '@/components/mobile/MLightbox.vue';
import MBottomSheet from '@/components/mobile/MBottomSheet.vue';
import TypingIndicator from '@/components/chat/typing-indicator.vue';
import AppointmentEditor from '@/components/appointments/AppointmentEditor.vue';
import NotesSection from '@/components/chat/NotesSection.vue';
import StickerPicker from '@/components/chat/StickerPicker.vue';
import AiCopilotPanel from '@/components/chat/AiCopilotPanel.vue';
import MediaPickerPopover from '@/components/media/MediaPickerPopover.vue';
import TemplateComposerPreview from '@/components/chat/TemplateComposerPreview.vue';
import { useMessageTemplates, type MessageTemplate } from '@/composables/use-message-templates';
import { templateToBlocks, isSimpleTextTemplate, type TemplateBlock } from '@/composables/use-template-blocks';
import { useChatOperations } from '@/composables/use-chat-operations';
import { useConversationContent } from '@/composables/use-conversation-content';
import { CONVERSATION_PRIVATE_MESSAGE } from '@/composables/use-conversation-privacy';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const auth = useAuthStore();
const {
  conversations, messages, selectedConv, loadingMsgs, sendingMsg, conversationPrivateBlocked,
  selectConversation, sendMessage, fetchMessages, fetchConversations, loadOlderMessages, loadMessageContext, getSocket, realtimeOffline,
} = useChat();

const text = ref('');
const keyboardOffset = ref(0);
const sendError = ref<string | null>(null);
const scroller = ref<HTMLElement | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);
const cameraInput = ref<HTMLInputElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const pendingFiles = ref<File[]>([]);
const currentUserId = computed(() => auth.user?.id || undefined);
const unseenCount = ref(0);
const nearBottom = ref(true);
const loadingOlder = ref(false);
const historyError = ref(false);
const hasOlderMessages = ref(true);
const showAppointmentEditor = ref(false);
const showNotes = ref(false);
const showCopilot = ref(false);
const showMediaPicker = ref(false);
const showTemplatePicker = ref(false);
const showComposerTools = ref(false);
const showTemplatePreview = ref(false);
const templateBlocks = ref<TemplateBlock[]>([]);
const { templates, loading: templatesLoading, fetchTemplates, trackUse } = useMessageTemplates();

const convId = computed(() => route.params.convId as string);
const draftKey = (id: string) => `zalocrm-mobile-draft:${id}`;
const title = computed(() => selectedConv.value?.contact?.fullName || 'Chat');
const avatarUrl = computed(() => (selectedConv.value?.contact as any)?.avatarUrl ?? null);
const nickName = computed(() => (selectedConv.value as any)?.zaloAccount?.displayName ?? '');
const initial = computed(() => (title.value || '?').charAt(0).toUpperCase());

const isGroupThread = computed(() => selectedConv.value?.threadType === 'group');

// Cùng NGƯỜI gửi? Trong NHÓM phải so senderUid (nhiều người cùng senderType='contact');
// nếu chỉ so senderType thì các người khác nhau bị gom 1 cụm → mất avatar/tên (bug "không
// biết ai nhắn"). Chat 1-1 giữ so theo senderType như cũ.
function sameSender(a: any, b: any): boolean {
  if (!a || !b) return false;
  if (a.senderType !== b.senderType) return false;
  if (isGroupThread.value && a.senderType !== 'self') return (a.senderUid || '') === (b.senderUid || '');
  return true;
}
function isGroupStart(i: number) { return !sameSender(messages.value[i - 1], messages.value[i]); }
function isGroupEnd(i: number) { return !sameSender(messages.value[i + 1], messages.value[i]); }

// Avatar theo TỪNG người gửi (giống desktop): self→null; nhóm→cache theo senderUid; 1-1→avatar KH.
function resolveSenderAvatar(m: any): string | null {
  if (!m || m.senderType === 'self') return null;
  if (isGroupThread.value) return (m.senderUid && groupAvatarStore.get(m.senderUid)) || null;
  return avatarUrl.value;
}
// Nạp avatar nhóm theo lô cho các UID đang hiển thị (đúng nick hội thoại để không đốt quota).
function primeGroupAvatars() {
  if (!isGroupThread.value) return;
  const accountId = (selectedConv.value as any)?.zaloAccount?.id as string | undefined;
  const uids = Array.from(new Set(messages.value.filter((m: any) => m.senderType !== 'self' && m.senderUid).map((m: any) => m.senderUid as string)));
  if (uids.length) void groupAvatarStore.fetchBatch(uids, accountId);
}

function goBack() { router.push({ name: 'M.Conversations' }); }
function restoreDraft(id: string) { text.value = localStorage.getItem(draftKey(id)) ?? ''; void nextTick(autoGrow); }
function saveDraft() { if (!convId.value) return; const value = text.value.trimEnd(); if (value) localStorage.setItem(draftKey(convId.value), value); else localStorage.removeItem(draftKey(convId.value)); }
function syncViewport() { const viewport = window.visualViewport; if (!viewport) return; keyboardOffset.value = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop); }

async function scrollBottom(smooth = false) {
  await nextTick();
  const el = scroller.value;
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}
function onScroll() {
  const el = scroller.value;
  if (!el) return;
  nearBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  if (nearBottom.value) unseenCount.value = 0;
  if (el.scrollTop < 64 && hasOlderMessages.value && !loadingOlder.value && !loadingMsgs.value && !historyError.value) {
    void loadOlder();
  }
}
async function loadOlder() {
  const el = scroller.value;
  if (!el || loadingOlder.value || !hasOlderMessages.value) return;
  const previousHeight = el.scrollHeight;
  const previousTop = el.scrollTop;
  loadingOlder.value = true;
  historyError.value = false;
  try {
    const result = await loadOlderMessages(convId.value);
    hasOlderMessages.value = result.hasMore;
    await nextTick();
    // Giữ NGUYÊN vị trí đọc: bù đúng phần chiều cao vừa chèn ở đầu danh sách (scroll anchor).
    el.scrollTop = previousTop + (el.scrollHeight - previousHeight);
  } catch {
    // P0 #12 — lỗi tải lịch sử: hiện trạng thái + nút thử lại, KHÔNG tự lặp vô hạn.
    historyError.value = true;
  } finally {
    loadingOlder.value = false;
  }
}
function retryHistory() { historyError.value = false; void loadOlder(); }
function jumpLatest() { unseenCount.value = 0; nearBottom.value = true; void scrollBottom(true); }
function showDateDivider(index: number) { const current = messages.value[index]?.sentAt; const previous = messages.value[index - 1]?.sentAt; return !!current && (!previous || new Date(current).toDateString() !== new Date(previous).toDateString()); }
function dateLabel(value?: string) { if (!value) return ''; const date = new Date(value); const now = new Date(); if (date.toDateString() === now.toDateString()) return 'Hôm nay'; const yesterday = new Date(now.getTime() - 86_400_000); if (date.toDateString() === yesterday.toDateString()) return 'Hôm qua'; return date.toLocaleDateString('vi-VN'); }

function autoGrow() {
  const el = textarea.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

let lastSent = '';
async function send() {
  const body = text.value.trim();
  if ((!body && !pendingFiles.value.length) || sendingMsg.value) return;
  lastSent = body;
  text.value = '';
  saveDraft();
  sendError.value = null;
  autoGrow();
  const replyMessageId = replyingTo.value?.id ?? null;
  const filesToSend = [...pendingFiles.value];
  try {
    if (body) { await sendMessage(body, replyMessageId); clearReplyTo(); }
    if (filesToSend.length) await sendPendingFiles(filesToSend);
    pendingFiles.value = pendingFiles.value.filter((file) => !filesToSend.includes(file));
    await scrollBottom(true);
  } catch {
    sendError.value = lastSent;
    text.value = lastSent; // trả chữ lại cho user, không mất công gõ
    saveDraft();
  }
}
async function retry() {
  const body = sendError.value;
  if (!body) return;
  sendError.value = null;
  text.value = body;
  await send();
}

function onComposerInput() {
  autoGrow();
  if (convId.value) sendTypingEvent(convId.value);
}

async function openTemplatePicker() { showTemplatePicker.value = true; await fetchTemplates(); }
function selectTemplate(template: MessageTemplate) {
  const blocks = templateToBlocks(template);
  showTemplatePicker.value = false;
  void trackUse(template.id);
  if (isSimpleTextTemplate(blocks)) { text.value = text.value ? `${text.value}\n${blocks[0].content || ''}` : (blocks[0].content || ''); void nextTick(() => { autoGrow(); textarea.value?.focus(); }); return; }
  templateBlocks.value = blocks; showTemplatePreview.value = true;
}

function onMediaSent() { showMediaPicker.value = false; void fetchMessages(convId.value); void scrollBottom(true); }
function onSendSticker(sticker: { id: number; catId: number; type: number }) {
  if (!convId.value) return;
  api.post(`/conversations/${convId.value}/sticker`, { stickerId: sticker.id, cateId: sticker.catId, type: sticker.type })
    .then(() => fetchMessages(convId.value))
    .catch(() => toast.error('Không gửi được sticker'));
}
function onCopilotInsert(event: Event) {
  const value = (event as CustomEvent<{ text?: string }>).detail?.text;
  if (!value) return;
  text.value = text.value ? `${text.value}
${value}` : value;
  void nextTick(() => { autoGrow(); textarea.value?.focus(); });
}

function onEmoji(e: string) {
  text.value += e;
  textarea.value?.focus();
}

// ── P1: xem media toàn màn hình (tái dùng event MessageBubble desktop) ──
const lightboxUrl = ref<string | null>(null);
const videoUrl = ref<string | null>(null);
const videoEl = ref<HTMLVideoElement | null>(null);
function onPreviewImage(url: string) { if (url) lightboxUrl.value = url; }
function onPreviewVideo(url: string) { if (url) videoUrl.value = url; }
function closeVideo() { videoEl.value?.pause(); videoUrl.value = null; }

// ── P1: long-press → menu hành động (tái dùng useChatOperations, quyền enforce ở backend) ──
const { addReaction, deleteMessage, undoMessage, forwardMessage, replyingTo, setReplyTo, clearReplyTo, typingUsers, sendTypingEvent, registerSocketListeners } = useChatOperations();
const currentTypers = computed(() => typingUsers.value.get(convId.value) || []);
const { pin, unpin, listPinned, search: searchConversationContent, listMedia, listFiles, listLinks } = useConversationContent();
const pinnedIds = ref(new Set<string>());
const pinnedItems = ref<any[]>([]);
const pinnedLoading = ref(false);
const showPinned = ref(false);
const showHeaderMenu = ref(false);
const showForward = ref(false);
const showEmojiSticker = ref(false);
const emojiStickerTab = ref<'emoji' | 'sticker'>('emoji');
const EMOJI_LIST = ['😀','😁','😂','🤣','😊','😍','😘','😎','🤗','🤔','😐','😴','😌','😜','🤤','😒','😔','🙃','😏','😢','😭','😤','😡','🥵','😱','😳','🤯','😬','🥰','😇','🙂','😉','👍','👎','👌','✌️','🤝','🙏','👏','💪','🔥','❤️','💯','✅','🎉','⭐','☕','🌸'];
const forwardQuery = ref('');
const forwardTargetIds = ref(new Set<string>());
const forwardLoading = ref(false);
const forwarding = ref(false);
const showReactionDetails = ref(false);
const showContentSearch = ref(false);
const showContentLibrary = ref(false);
const contentLibraryTab = ref<'media' | 'files' | 'links'>('media');
const contentLibraryItems = ref<any[]>([]);
const contentLibraryLoading = ref(false);
const contentSearchQuery = ref('');
const contentSearchResults = ref<any[]>([]);
const contentSearchLoading = ref(false);
const searchActiveIndex = ref(-1);   // vị trí kết quả đang xem (kiểu Zalo 1/N)
const showSearchList = ref(true);    // hiện danh sách kết quả; ẩn khi đã nhảy tới 1 tin
let contentSearchTimer: ReturnType<typeof setTimeout> | undefined;
const QUICK_EMOJIS = ['❤️', '👍', '😆', '😮', '😢', '😡'];
const showActions = ref(false);
const actionMsg = ref<any>(null);
let pressTimer: ReturnType<typeof setTimeout> | undefined;

function openActions(m: any) {
  if (!m || m.isDeleted) return;
  actionMsg.value = m;
  showActions.value = true;
  if (navigator.vibrate) navigator.vibrate(12);
}
function onRowTouchStart(m: any) { clearTimeout(pressTimer); pressTimer = setTimeout(() => openActions(m), 480); }
function onRowTouchMove() { clearTimeout(pressTimer); }
function onRowTouchEnd() { clearTimeout(pressTimer); }

const actionCanCopy = computed(() => actionMsg.value?.contentType === 'text' && !!actionMsg.value?.content && !actionMsg.value?.redacted);
const actionCanPin = computed(() => !!actionMsg.value && !actionMsg.value.isDeleted && !actionMsg.value.redacted);
const actionIsPinned = computed(() => !!actionMsg.value && pinnedIds.value.has(actionMsg.value.id));
const actionReactionDetails = computed(() => (actionMsg.value?.reactionDetails || []).filter((detail: any) => detail?.emoji));
function openReactionDetails() { showActions.value = false; showReactionDetails.value = true; }
function openContentLibrary() { showContentLibrary.value = true; void loadContentLibrary(); }
function setContentLibraryTab(tab: 'media' | 'files' | 'links') { contentLibraryTab.value = tab; void loadContentLibrary(); }
async function loadContentLibrary() {
  if (!convId.value) return;
  contentLibraryLoading.value = true;
  try {
    const page = contentLibraryTab.value === 'media' ? await listMedia(convId.value) : contentLibraryTab.value === 'files' ? await listFiles(convId.value) : await listLinks(convId.value);
    contentLibraryItems.value = page.items;
  } catch { contentLibraryItems.value = []; }
  finally { contentLibraryLoading.value = false; }
}
function openContentLibraryMessage(message: any) {
  showContentLibrary.value = false;
  const url = contentLibraryUrl(message);
  if (message.contentType === 'image' && url) {
    onPreviewImage(url);
    return;
  }
  if (message.contentType === 'video' && url) {
    onPreviewVideo(url);
    return;
  }
  if ((contentLibraryTab.value === 'files' || contentLibraryTab.value === 'links') && url) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  void jumpToReply(message.id);
}
type SharedContentMeta = { href: string | null; thumbnail: string | null; title: string; description: string };
function sharedContentMeta(message: any): SharedContentMeta {
  const raw = typeof message?.content === 'string' ? message.content.trim() : '';
  let value: Record<string, unknown> | null = null;
  if (raw.startsWith('{')) {
    try { value = JSON.parse(raw) as Record<string, unknown>; } catch { value = null; }
  }
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const candidate = value?.[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return null;
  };
  const href = pick('href', 'url', 'hdUrl', 'normalUrl', 'oriUrl', 'fileUrl') || (!value && raw ? raw : null);
  return {
    href,
    thumbnail: pick('thumbnail', 'thumb', 'thumbUrl', 'previewUrl') || href,
    title: pick('title', 'name', 'fileName') || '',
    description: pick('description', 'caption', 'text') || '',
  };
}
function contentLibraryUrl(message: any) { return sharedContentMeta(message).href; }
function contentLibraryThumbnail(message: any) { return sharedContentMeta(message).thumbnail || undefined; }
function contentLibraryTitle(message: any) {
  const meta = sharedContentMeta(message);
  if (meta.title) return meta.title;
  if (contentLibraryTab.value === 'media') return message.contentType === 'video' ? 'Video' : 'Ảnh';
  if (contentLibraryTab.value === 'files') return 'Tệp đính kèm';
  return contentLibraryUrlLabel(message);
}
function contentLibraryDescription(message: any) { return sharedContentMeta(message).description; }
function contentLibraryUrlLabel(message: any) {
  const href = contentLibraryUrl(message);
  if (!href) return '';
  try {
    const parsed = new URL(href, window.location.origin);
    return parsed.hostname + parsed.pathname;
  } catch { return href; }
}

function openContentSearch() {
  showContentSearch.value = true;
  showSearchList.value = true;
  contentSearchQuery.value = '';
  contentSearchResults.value = [];
  searchActiveIndex.value = -1;
  window.setTimeout(() => document.querySelector<HTMLInputElement>('.mch-searchbar-input input')?.focus(), 100);
}
function closeContentSearch() {
  showContentSearch.value = false;
  clearKeywordHighlight();
}
function clearSearch() {
  contentSearchQuery.value = '';
  contentSearchResults.value = [];
  searchActiveIndex.value = -1;
  showSearchList.value = true;
  clearKeywordHighlight();
  window.setTimeout(() => document.querySelector<HTMLInputElement>('.mch-searchbar-input input')?.focus(), 30);
}
function scheduleContentSearch() {
  clearTimeout(contentSearchTimer);
  const query = contentSearchQuery.value.trim();
  showSearchList.value = true;
  if (!query) { contentSearchResults.value = []; searchActiveIndex.value = -1; contentSearchLoading.value = false; clearKeywordHighlight(); return; }
  contentSearchTimer = setTimeout(() => { void runContentSearch(query); }, 280);
}
async function runContentSearch(query: string) {
  if (!convId.value || query !== contentSearchQuery.value.trim()) return;
  contentSearchLoading.value = true;
  try {
    // Chỉ tìm TIN TEXT (như Zalo) — không trả tin ảnh/file/link (tránh hiện JSON thô).
    const page = await searchConversationContent(convId.value, { q: query, type: 'text', limit: 50 });
    if (query === contentSearchQuery.value.trim()) {
      contentSearchResults.value = page.items;
      searchActiveIndex.value = page.items.length ? 0 : -1;
    }
  } catch {
    if (query === contentSearchQuery.value.trim()) { contentSearchResults.value = []; searchActiveIndex.value = -1; }
  } finally {
    if (query === contentSearchQuery.value.trim()) contentSearchLoading.value = false;
  }
}
// Enter = nhảy tới kết quả kế (giống ↓). Nếu chưa nhảy lần nào thì tới kết quả đầu.
function onSearchEnter() {
  if (!contentSearchResults.value.length) return;
  if (!showSearchList.value) { nextMatch(); return; }
  selectMatch(searchActiveIndex.value >= 0 ? searchActiveIndex.value : 0);
}
function selectMatch(idx: number) {
  if (idx < 0 || idx >= contentSearchResults.value.length) return;
  searchActiveIndex.value = idx;
  void goToMatch();
}
function nextMatch() {
  const n = contentSearchResults.value.length;
  if (!n) return;
  searchActiveIndex.value = (searchActiveIndex.value + 1 + n) % n;
  void goToMatch();
}
function prevMatch() {
  const n = contentSearchResults.value.length;
  if (!n) return;
  searchActiveIndex.value = (searchActiveIndex.value - 1 + n) % n;
  void goToMatch();
}
async function goToMatch() {
  const msg = contentSearchResults.value[searchActiveIndex.value];
  if (!msg) return;
  showSearchList.value = false;             // thu gọn để thấy khung chat
  await jumpToReply(msg.id);
  applyKeywordHighlight(contentSearchQuery.value.trim());
}

// ---- Highlight từ khóa (dùng CSS Custom Highlight API — không đụng DOM tin nhắn) ----
function clearKeywordHighlight() {
  try { (window as any).CSS?.highlights?.delete('mch-kw'); } catch { /* noop */ }
}
function applyKeywordHighlight(term: string) {
  const CSSg: any = (window as any).CSS;
  if (!term || !CSSg?.highlights || typeof (window as any).Highlight === 'undefined') return;
  clearKeywordHighlight();
  const root = scroller.value;
  if (!root) return;
  const needle = term.toLowerCase();
  const hl = new (window as any).Highlight();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue || '';
    const hay = text.toLowerCase();
    let from = 0; let at: number;
    while ((at = hay.indexOf(needle, from)) !== -1) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      hl.add(range);
      from = at + needle.length;
    }
  }
  CSSg.highlights.set('mch-kw', hl);
}
function highlightSnippet(value: string | null) {
  const raw = replyPreview(value);
  const term = contentSearchQuery.value.trim();
  const escaped = raw.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  if (!term) return escaped;
  const safeTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  try { return escaped.replace(new RegExp(safeTerm, 'gi'), (m) => `<mark class="mch-kw-mark">${m}</mark>`); }
  catch { return escaped; }
}
const actionMediaUrl = computed(() => {
  const m = actionMsg.value;
  if (!m || m.redacted) return null;
  const t = m.contentType;
  if (!['image', 'video', 'file'].includes(t)) return null;
  const c = m.content || '';
  if (c.startsWith('http')) return c;
  if (c.startsWith('{')) { try { const p = JSON.parse(c); return p.hdUrl || p.href || p.normalUrl || p.thumb || null; } catch { return null; } }
  return null;
});

const forwardCandidates = computed(() => {
  const query = forwardQuery.value.trim().toLocaleLowerCase('vi-VN');
  const sourceNickId = selectedConv.value?.zaloAccount?.id ?? null;
  return conversations.value.filter((conversation) => {
    if (conversation.id === convId.value) return false;
    if (sourceNickId && conversation.zaloAccount?.id !== sourceNickId) return false;
    const name = forwardName(conversation).toLocaleLowerCase('vi-VN');
    return !query || name.includes(query);
  });
});
function forwardName(conversation: any) {
  return conversation.groupName || conversation.contact?.crmName || conversation.contact?.fullName || conversation.friendship?.aliasInNick || conversation.friendship?.zaloDisplayName || 'Hội thoại';
}
async function openForward() {
  showActions.value = false;
  forwardQuery.value = '';
  forwardTargetIds.value = new Set();
  showForward.value = true;
  forwardLoading.value = true;
  try { await fetchConversations({ bypassCache: true }); }
  catch { toast.push('Không tải được danh sách hội thoại'); }
  finally { forwardLoading.value = false; }
}
function toggleForwardTarget(id: string) {
  const next = new Set(forwardTargetIds.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  forwardTargetIds.value = next;
}
async function submitForward() {
  const message = actionMsg.value;
  if (!message || !convId.value || forwardTargetIds.value.size === 0) return;
  forwarding.value = true;
  try {
    await forwardMessage(convId.value, message.id, [...forwardTargetIds.value]);
    showForward.value = false;
    toast.push(`Đã chuyển tiếp đến ${forwardTargetIds.value.size} hội thoại`);
  } catch (error: any) {
    toast.error(error?.response?.data?.error || 'Chuyển tiếp thất bại');
  } finally { forwarding.value = false; }
}

async function refreshPinned() {
  if (!convId.value) return;
  pinnedLoading.value = true;
  try {
    const list = await listPinned(convId.value);
    pinnedItems.value = list;
    pinnedIds.value = new Set(list.filter((item) => item.message).map((item) => item.message!.id));
  } catch {
    pinnedItems.value = [];
    pinnedIds.value = new Set();
  } finally {
    pinnedLoading.value = false;
  }
}
function openPinned() { showPinned.value = true; void refreshPinned(); }
async function onPin() {
  const message = actionMsg.value; showActions.value = false;
  if (!message || !convId.value) return;
  try { await pin(convId.value, message.id); pinnedIds.value = new Set([...pinnedIds.value, message.id]); }
  catch { toast.push('Không ghim được tin nhắn'); }
}
async function onUnpin() {
  const message = actionMsg.value; showActions.value = false;
  if (!message || !convId.value) return;
  try { await unpin(convId.value, message.id); const next = new Set(pinnedIds.value); next.delete(message.id); pinnedIds.value = next; }
  catch { toast.push('Không bỏ ghim được tin nhắn'); }
}
function formatPinnedTime(value: string) { return new Date(value).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function jumpToPinned(item: any) {
  showPinned.value = false;
  if (!item.message?.id) { toast.push('Tin nhắn không còn khả dụng'); return; }
  void jumpToReply(item.message.id);
}

async function onReact(emoji: string) {
  const m = actionMsg.value; showActions.value = false;
  if (!m || !convId.value) return;
  try { await addReaction(convId.value, m.id, emoji); } catch { toast.push('Không thả được cảm xúc'); }
}
function replyPreview(value: string | null) {
  const compact = (value || '').replace(/\s+/g, ' ').trim();
  return compact.length > 80 ? `${compact.slice(0, 80)}...` : compact || 'Nội dung đính kèm';
}
function onReply() {
  const message = actionMsg.value;
  showActions.value = false;
  if (!message) return;
  setReplyTo(message);
  void nextTick(() => textarea.value?.focus());
}
async function jumpToReply(messageId: string) {
  if (!messageId || !convId.value) return;
  const found = await loadMessageContext(convId.value, messageId);
  if (!found) { toast.push('Không tìm thấy tin nhắn gốc'); return; }
  await nextTick();
  const target = scroller.value?.querySelector<HTMLElement>(`[data-msg-id="${messageId}"]`);
  if (!target) return;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.add('mch-jump-highlight');
  window.setTimeout(() => target.classList.remove('mch-jump-highlight'), 1800);
}

async function onCopy() {
  showActions.value = false;
  try { await navigator.clipboard.writeText(actionMsg.value?.content || ''); toast.push('Đã sao chép'); }
  catch { toast.push('Không sao chép được'); }
}
async function onRecall() {
  const m = actionMsg.value; showActions.value = false;
  if (!m || !convId.value) return;
  try { await undoMessage(convId.value, m.id); } catch (e: any) { toast.push(e?.response?.data?.error || 'Thu hồi thất bại'); }
}
async function onDelete() {
  const m = actionMsg.value; showActions.value = false;
  if (!m || !convId.value) return;
  try { await deleteMessage(convId.value, m.id); } catch (e: any) { toast.push(e?.response?.data?.error || 'Xóa thất bại'); }
}

async function sendPendingFiles(files: File[]) {
  if (!convId.value || !files.length) return;
  const fd = new FormData();
  for (const file of files) fd.append('files', file, file.name);
  await api.post(`/conversations/${convId.value}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  await fetchMessages(convId.value);
}
function queueAttachments(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const picked = Array.from(input.files || []); input.value = '';
  const keys = new Set(pendingFiles.value.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
  pendingFiles.value = [...pendingFiles.value, ...picked.filter((file) => !keys.has(`${file.name}:${file.size}:${file.lastModified}`))];
}
function removePendingFile(file: File) { pendingFiles.value = pendingFiles.value.filter((item) => item !== file); }

// Presence: existing heartbeat keeps notification behavior unchanged.
let hb: ReturnType<typeof setInterval> | undefined;
function announceViewing(id: string | null) {
  getSocket()?.emit('presence:viewing', { conversationId: id });
}
function startPresence() {
  announceViewing(convId.value);
  clearInterval(hb);
  hb = setInterval(() => announceViewing(convId.value), 30_000);
}
function stopPresence() {
  clearInterval(hb);
  announceViewing(null);
}

// Mở hội thoại + auto-scroll khi có tin mới (socket đã cập nhật `messages`).
onMounted(async () => {
  await selectConversation(convId.value);
  registerSocketListeners(getSocket());
  void refreshPinned();
  restoreDraft(convId.value);
  primeGroupAvatars();
  await scrollBottom();
  startPresence();
  window.addEventListener('chat:insert-suggestion', onCopilotInsert as EventListener);
  window.visualViewport?.addEventListener('resize', syncViewport);
  window.visualViewport?.addEventListener('scroll', syncViewport);
  syncViewport();
});
// Ẩn tab / khoá máy → coi như không còn xem, để vẫn nhận được notification.
function onVisibility() {
  announceViewing(document.hidden ? null : convId.value);
}
document.addEventListener('visibilitychange', onVisibility);
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility);
  stopPresence();
  clearReplyTo();
  clearTimeout(contentSearchTimer);
  clearKeywordHighlight();
  window.removeEventListener('chat:insert-suggestion', onCopilotInsert as EventListener);
  window.visualViewport?.removeEventListener('resize', syncViewport);
  window.visualViewport?.removeEventListener('scroll', syncViewport);
});

watch(() => messages.value.length, (next, previous) => {
  primeGroupAvatars();
  if (!previous || nearBottom.value) void scrollBottom(true);
  else if (next > previous) unseenCount.value += next - previous;
});
watch(text, saveDraft);
watch(convId, async (id) => { if (id) { hasOlderMessages.value = true; unseenCount.value = 0; await selectConversation(id); void refreshPinned(); restoreDraft(id); primeGroupAvatars(); await scrollBottom(); startPresence(); } });
</script>

<style scoped>
.mch-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--m-surface-sunken); padding-bottom: v-bind('keyboardOffset + 'px''); }
.mch-head {
  flex-shrink: 0; display: flex; align-items: center; gap: var(--m-sp-2);
  padding: 0 var(--m-sp-2); padding-top: env(safe-area-inset-top, 0px); min-height: calc(var(--m-header-h) + env(safe-area-inset-top, 0px));
  background: color-mix(in srgb, var(--m-surface) 88%, transparent);
  backdrop-filter: saturate(1.4) blur(12px); -webkit-backdrop-filter: saturate(1.4) blur(12px);
  border-bottom: 1px solid var(--m-border);
}
.mch-back, .mch-pinned { color: var(--m-brand); }
.mch-avatar {
  width: 38px; height: 38px; border-radius: var(--m-r-full); flex-shrink: 0;
  background: linear-gradient(135deg, #8fb7ff, #1f6fd6); color: #fff;
  display: flex; align-items: center; justify-content: center; font-weight: var(--m-fw-semibold);
}
.mch-avatar img { width: 100%; height: 100%; border-radius: var(--m-r-full); object-fit: cover; }
.mch-info { min-width: 0; flex: 1; }
.mch-name { font-size: var(--m-fs-md); font-weight: var(--m-fw-bold); color: var(--m-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mch-nick { font-size: var(--m-fs-2xs); color: var(--m-text-3); }

.mch-msgs { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: var(--m-sp-3) var(--m-sp-3) var(--m-sp-1); }
.mch-history-status { margin: 2px auto 8px; color: var(--m-text-3); font-size: var(--m-fs-xs); text-align: center; }
.mch-history-status--err { color: var(--m-danger); }
.mch-history-retry { border: 0; background: transparent; color: var(--m-brand); font-weight: var(--m-fw-semibold); font-size: var(--m-fs-xs); text-decoration: underline; cursor: pointer; }
.mch-day { width: fit-content; margin: 10px auto 8px; padding: 3px 9px; border-radius: 999px; background: var(--m-surface-2); color: var(--m-text-3); font-size: var(--m-fs-xs); }
.mch-row { margin-bottom: 2px; animation: m-rise var(--m-dur-fast) var(--m-ease) both; border-radius: var(--m-r-md); }
.mch-jump-highlight { outline: 2px solid var(--m-brand); outline-offset: 3px; background: var(--m-brand-soft); transition: background 0.3s ease; }
/* P1 — ảnh trong bubble không kéo full quá lớn; bo góc, cắt gọn. Album grid do MessageBubble lo. */
.mch-msgs :deep(.chat-image) { max-height: 62vh; max-width: 100%; object-fit: cover; border-radius: 14px; }
.mch-msgs :deep(.chat-video) { max-height: 62vh; max-width: 100%; border-radius: 14px; }

/* Menu hành động (long-press) */
.mch-react { display: flex; justify-content: space-around; padding: 6px var(--m-sp-4) 12px; }
.mch-react-btn { width: 46px; height: 46px; border: 0; background: var(--m-surface-2); border-radius: var(--m-r-full); font-size: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.mch-react-btn:active { transform: scale(0.88); background: var(--m-brand-soft); }
.mch-act-item { display: flex; align-items: center; gap: var(--m-sp-3); width: 100%; min-height: var(--m-touch); padding: 13px var(--m-sp-4); border: 0; background: none; color: var(--m-text); font-size: var(--m-fs-md); font-family: inherit; text-align: left; text-decoration: none; cursor: pointer; }
.mch-act-item:active { background: var(--m-surface-2); }
.mch-act-item.danger { color: var(--m-danger); }
.mch-sheet-state { padding: 28px var(--m-sp-4); color: var(--m-text-2); font-size: var(--m-fs-sm); text-align: center; }
.mch-forward-search { display: flex; align-items: center; gap: 8px; margin: 2px var(--m-sp-4) 8px; padding: 0 12px; border-radius: var(--m-r-full); background: var(--m-surface-2); color: var(--m-text-3); }
.mch-forward-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; padding: 11px 0; font: inherit; color: var(--m-text); }
.mch-forward-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; padding: 8px var(--m-sp-4); border: 0; border-top: 1px solid var(--m-border); background: none; text-align: left; color: var(--m-text); }
.mch-forward-item.selected { background: var(--m-brand-soft); }
.mch-forward-check { width: 22px; height: 22px; flex: 0 0 22px; display: inline-flex; align-items: center; justify-content: center; border: 1.5px solid var(--m-border-strong); border-radius: 50%; color: var(--m-brand-ink); background: transparent; font-weight: var(--m-fw-bold); }
.mch-forward-item.selected .mch-forward-check { background: var(--m-brand); border-color: var(--m-brand); }
.mch-forward-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--m-fs-md); }
.mch-forward-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px var(--m-sp-4); border-top: 1px solid var(--m-border); color: var(--m-text-2); font-size: var(--m-fs-sm); }
.mch-forward-foot button { min-height: 40px; border: 0; border-radius: var(--m-r-sm); padding: 0 16px; color: var(--m-brand-ink); background: var(--m-brand); font-weight: var(--m-fw-semibold); }
.mch-forward-foot button:disabled { opacity: .5; }
.mch-pinned-item { display: flex; flex-direction: column; gap: 4px; width: 100%; border: 0; background: none; padding: 12px var(--m-sp-4); text-align: left; color: var(--m-text); }
.mch-pinned-item + .mch-pinned-item { border-top: 1px solid var(--m-border); }
.mch-pinned-item:active { background: var(--m-surface-2); }
.mch-pinned-by { font-size: var(--m-fs-xs); color: var(--m-text-3); }
.mch-pinned-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--m-fs-sm); }
.mch-reaction-summary { flex: 1; text-align: left; color: var(--m-text-2); }
.mch-reaction-detail { display: flex; align-items: center; gap: var(--m-sp-3); min-height: var(--m-touch); padding: 10px var(--m-sp-4); border-bottom: 1px solid var(--m-border); }
.mch-reaction-emoji { width: 32px; font-size: 22px; text-align: center; }
.mch-reaction-name { font-size: var(--m-fs-md); color: var(--m-text); }
.mch-content-tabs { display: flex; gap: 6px; padding: 0 var(--m-sp-3) 8px; }
.mch-content-tabs button { flex: 1; min-height: 36px; border: 0; border-radius: var(--m-r-md); background: var(--m-surface-2); color: var(--m-text-2); font: inherit; font-size: var(--m-fs-xs); }
.mch-content-tabs button.on { background: var(--m-brand); color: var(--m-brand-ink); }
.mch-content-search, .mch-forward-search { display: flex; align-items: center; gap: var(--m-sp-2); margin: 2px var(--m-sp-3) 8px; padding: 0 12px; min-height: 42px; border-radius: var(--m-r-lg); background: var(--m-surface-2); color: var(--m-text-3); }
.mch-content-search input, .mch-forward-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--m-text); font: inherit; }
.mch-content-result { display: flex; flex-direction: column; gap: 4px; width: 100%; border: 0; border-top: 1px solid var(--m-border); padding: 11px var(--m-sp-4); background: none; text-align: left; color: var(--m-text); }
.mch-content-result:active { background: var(--m-surface-2); }
.mch-content-result-name { color: var(--m-text-3); font-size: var(--m-fs-xs); }
.mch-content-result-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--m-fs-sm); }
.mch-content-result.on { background: var(--m-brand-soft); }

/* Thanh tìm kiếm kiểu Zalo (overlay trên đầu) */
.mch-searchbar-wrap { position: fixed; top: 0; left: 0; right: 0; z-index: 3500; display: flex; flex-direction: column; }
.mch-searchbar {
  display: flex; align-items: center; gap: 6px;
  padding: calc(env(safe-area-inset-top, 0px) + 6px) 8px 6px;
  background: var(--m-surface); border-bottom: 1px solid var(--m-border);
  box-shadow: 0 2px 10px rgba(0,0,0,.08);
}
.mch-searchbar-input { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 0 10px; min-height: 40px; border-radius: var(--m-r-full); background: var(--m-surface-2); color: var(--m-text-3); }
.mch-searchbar-input input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--m-text); font: inherit; }
.mch-searchbar-clear { display: inline-flex; align-items: center; justify-content: center; border: 0; background: none; color: var(--m-text-3); padding: 2px; cursor: pointer; }
.mch-searchbar-nav { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
.mch-search-count { font-size: var(--m-fs-xs); font-weight: var(--m-fw-semibold); color: var(--m-text-2); min-width: 34px; text-align: center; font-variant-numeric: tabular-nums; }
.mch-search-panel { flex: 1; min-height: 0; background: rgba(0,0,0,.35); overflow: hidden; }
.mch-search-panel-inner { background: var(--m-surface); max-height: 62dvh; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.mch-kw-mark { background: #ffd54a; color: #1a1a1a; border-radius: 3px; padding: 0 1px; }
.mch-library-item { display: flex; align-items: center; gap: var(--m-sp-3); width: 100%; min-height: 74px; border: 0; border-top: 1px solid var(--m-border); padding: 10px var(--m-sp-4); background: none; color: var(--m-text); text-align: left; }
.mch-library-item:active { background: var(--m-surface-2); }
.mch-library-thumb, .mch-library-icon { width: 54px; height: 54px; flex: 0 0 54px; border-radius: var(--m-r-md); }
.mch-library-thumb { object-fit: cover; background: var(--m-surface-2); }
.mch-library-icon { display: inline-flex; align-items: center; justify-content: center; background: var(--m-brand-soft); color: var(--m-brand); }
.mch-library-body { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.mch-library-title, .mch-library-description, .mch-library-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mch-library-title { font-size: var(--m-fs-sm); font-weight: var(--m-fw-semibold); }
.mch-library-description { color: var(--m-text-2); font-size: var(--m-fs-xs); }
.mch-library-url { color: var(--m-brand); font-size: var(--m-fs-xs); }

/* Modal video toàn màn hình */
.mch-video { position: fixed; inset: 0; z-index: 4000; background: #000; display: flex; align-items: center; justify-content: center; }
.mch-video-el { max-width: 100vw; max-height: 100dvh; }
.mch-video-close { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 6px); right: 10px; width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border: 0; background: rgba(255,255,255,0.14); color: #fff; border-radius: 999px; z-index: 2; }
.mch-video-close:active { background: rgba(255,255,255,0.28); }
.mch-state { text-align: center; color: var(--m-text-2); font-size: var(--m-fs-md); padding: var(--m-sp-6); }
.mch-state--private { font-style: italic; padding-top: 48px; }

.mch-new { position: absolute; right: 16px; bottom: calc(76px + var(--m-safe-bottom)); z-index: 2; border: 0; border-radius: 999px; background: var(--m-brand); color: var(--m-brand-ink); padding: 8px 12px; font-size: var(--m-fs-sm); font-weight: var(--m-fw-semibold); box-shadow: var(--m-e-up); }
.mch-offline { flex-shrink: 0; padding: 7px var(--m-sp-3); background: var(--m-danger-soft); color: var(--m-danger); font-size: var(--m-fs-sm); text-align: center; }
.mch-retry {
  flex-shrink: 0; display: flex; align-items: center; gap: var(--m-sp-2); justify-content: center;
  background: var(--m-danger-soft); color: var(--m-danger); font-size: var(--m-fs-sm); padding: var(--m-sp-2);
}
.mch-retry button { border: 0; border-radius: var(--m-r-sm); padding: 6px 12px; background: var(--m-danger); color: #fff; font-weight: var(--m-fw-semibold); }
.mch-retry button.ghost { background: transparent; color: var(--m-danger); text-decoration: underline; }

.mch-input {
  flex-shrink: 0; display: flex; flex-direction: column; gap: var(--m-sp-1);
  padding: var(--m-sp-2) var(--m-sp-2) calc(var(--m-sp-2) + var(--m-safe-bottom));
  background: var(--m-surface); border-top: 1px solid var(--m-border); box-shadow: var(--m-e-up);
}
.mch-composer-row { display: flex; width: 100%; align-items: flex-end; gap: var(--m-sp-1); }
.mch-emoji-btn { color: var(--m-text-2); flex-shrink: 0; }

/* Sheet gộp Emoji + Sticker */
.mch-es-tabs { display: flex; gap: var(--m-sp-2); padding: 0 var(--m-sp-4) var(--m-sp-2); }
.mch-es-tabs button { flex: 1; border: 0; background: var(--m-surface-2); color: var(--m-text-2); border-radius: var(--m-r-full); padding: 8px 0; font-size: var(--m-fs-sm); font-weight: var(--m-fw-semibold); cursor: pointer; }
.mch-es-tabs button.on { background: var(--m-brand); color: var(--m-brand-ink); }
.mch-emoji-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; padding: 4px var(--m-sp-3) var(--m-sp-3); max-height: 44dvh; overflow-y: auto; }
.mch-emoji-cell { border: 0; background: none; font-size: 27px; line-height: 1; padding: 7px 0; border-radius: var(--m-r-sm); cursor: pointer; }
.mch-emoji-cell:active { background: var(--m-surface-2); transform: scale(0.9); }
.mch-sticker-tab { padding: var(--m-sp-3) var(--m-sp-4) var(--m-sp-4); }
.mch-tool-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 8px var(--m-sp-4) 16px; }
.mch-tool-grid button, .mch-tool-grid :deep(.sticker-trigger) { width: 100%; min-height: 68px; border: 0; border-radius: var(--m-r-lg); background: var(--m-surface-2); color: var(--m-text); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; font: inherit; font-size: var(--m-fs-xs); }
.mch-tool-grid :deep(.sticker-trigger) { padding: 0; box-shadow: none; }
.mch-tool-grid :deep(.sticker-trigger:hover), .mch-tool-grid :deep(.sticker-trigger:focus-visible) { background: var(--m-surface-2); color: var(--m-text); }
.mch-media-picker-sheet { min-height: min(620px, calc(82dvh - 54px)); }
.mch-media-picker-sheet :deep(.mp-pop) { position: static; inset: auto; bottom: auto; z-index: auto; height: 100%; }
.mch-media-picker-sheet :deep(.mp-card) { height: min(620px, calc(82dvh - 54px)); max-height: none; border: 0; border-radius: 0; padding: 8px var(--m-sp-3) calc(var(--m-safe-bottom) + 10px); box-shadow: none; background: var(--m-surface); }
.mch-media-picker-sheet :deep(.mp-grid), .mch-media-picker-sheet :deep(.mp-list) { min-height: 0; flex: 1; }
.mch-attachment-queue { display: flex; width: 100%; gap: 6px; overflow-x: auto; padding: 2px 0; }
.mch-attachment-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 180px; padding: 5px 8px; border-radius: 999px; background: var(--m-surface-2); color: var(--m-text-2); font-size: var(--m-fs-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mch-attachment-chip button { border: 0; background: none; color: var(--m-text-3); padding: 0; }
.mch-replybar { display: flex; width: 100%; align-items: center; gap: var(--m-sp-2); padding: 6px var(--m-sp-1) 0 var(--m-sp-2); border-left: 3px solid var(--m-brand); }
.mch-replybar-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.mch-replybar-body b, .mch-replybar-body span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mch-replybar-body b { font-size: var(--m-fs-sm); color: var(--m-brand); }
.mch-replybar-body span { font-size: var(--m-fs-xs); color: var(--m-text-2); }
.mch-tool { color: var(--m-text-2); }
.mch-input textarea {
  flex: 1; min-width: 0; resize: none; border: 0; outline: none;
  background: var(--m-surface-2); border-radius: var(--m-r-xl);
  padding: 10px 15px; font-size: var(--m-fs-input); color: var(--m-text);
  line-height: 1.35; max-height: 120px;
}
.mch-input textarea::placeholder { color: var(--m-text-3); }
.mch-send {
  width: var(--m-touch); height: var(--m-touch); border: 0; border-radius: var(--m-r-full); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--m-surface-2); color: var(--m-text-3); cursor: pointer;
  transition: background var(--m-dur-fast) var(--m-ease), color var(--m-dur-fast) var(--m-ease), transform var(--m-dur-fast) var(--m-ease);
}
/* Có nội dung → nút Gửi "sáng lên" brand + phóng nhẹ (feedback rõ) */
.mch-send.ready { background: var(--m-brand); color: var(--m-brand-ink); }
.mch-send.ready:active { transform: scale(0.9); }
.mch-send:disabled { cursor: default; }
.mch-spin { animation: mch-rot 0.7s linear infinite; }
@keyframes mch-rot { to { transform: rotate(360deg); } }
</style>

<!-- Không scoped: ::highlight() tô từ khóa trong khung chat (CSS Custom Highlight API). -->
<style>
::highlight(mch-kw) { background-color: #ffd54a; color: #1a1a1a; }
</style>

