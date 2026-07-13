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

    <!-- is-direct: chat 1-1 → ẩn tên người gửi trong bubble (đã có ở header, hiện lại là thừa).
         Chỉ áp cho mobile; desktop giữ nguyên quyết định cũ (hiện tên ở cả 1-1 lẫn nhóm). -->
    <div ref="scroller" class="mch-msgs" :class="{ 'is-direct': !isGroupThread }" @scroll.passive="onScroll" @contextmenu.prevent>
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
          :class="{ 'mch-row--swiping': swipeId === m.id && swipeX > 0, 'is-self': m.senderType === 'self', 'is-cluster-end': isGroupEnd(i) }"
          :style="swipeId === m.id && swipeX > 0 ? { transform: `translateX(${swipeX}px)` } : undefined"
          @contextmenu.prevent="openActions(m)"
          @touchstart.passive="onRowTouchStart(m, $event)"
          @touchmove="onRowTouchMove(m, $event)"
          @touchend="onRowTouchEnd(m)"
          @touchcancel="onRowTouchEnd(m)"
        >
          <span
            v-if="swipeId === m.id && swipeX > 0"
            class="mch-swipe-reply"
            :style="{ opacity: Math.min(swipeX / 56, 1) }"
          ><ReplyIcon :size="18" :stroke-width="2.2" /></span>
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

    <!-- Nhấn-giữ tin → overlay kiểu Zalo: nền mờ + bubble nổi lên + hàng cảm xúc + lưới hành động.
         Thay cụm nút tròn thường trực cạnh bubble (cũ) — nút đó che nội dung khi tin ngắn liên tiếp. -->
    <Teleport to="body">
      <div v-if="showActions && actionMsg" class="mch-ov" @click.self="closeActions" @contextmenu.prevent>
        <div class="mch-ov-msg" :class="{ 'is-self': actionMsg.senderType === 'self' }" @click.self="closeActions">
          <MessageBubble
            :message="actionMsg"
            :reply="actionMsg.reply || null"
            :is-self="actionMsg.senderType === 'self'"
            :is-group="selectedConv?.threadType === 'group'"
            :sender-avatar-url="resolveSenderAvatar(actionMsg)"
            :current-user-id="currentUserId"
          />
        </div>

        <div class="mch-ov-react">
          <button v-for="e in QUICK_EMOJIS" :key="e" class="mch-ov-react-btn" @click="onReact(e)">{{ e }}</button>
        </div>

        <div class="mch-ov-grid">
          <button class="mch-ov-act" @click="onReply">
            <ReplyIcon :size="24" :stroke-width="1.7" /><span>Trả lời</span>
          </button>
          <button class="mch-ov-act" @click="openForward">
            <ForwardIcon :size="24" :stroke-width="1.7" /><span>Chuyển tiếp</span>
          </button>
          <button v-if="actionCanCopy" class="mch-ov-act" @click="onCopy">
            <CopyIcon :size="24" :stroke-width="1.7" /><span>Sao chép</span>
          </button>
          <button v-if="actionCanPin && !actionIsPinned" class="mch-ov-act" @click="onPin">
            <PinIcon :size="24" :stroke-width="1.7" /><span>Ghim</span>
          </button>
          <button v-else-if="actionCanPin" class="mch-ov-act" @click="onUnpin">
            <PinOffIcon :size="24" :stroke-width="1.7" /><span>Bỏ ghim</span>
          </button>
          <a v-if="actionMediaUrl" class="mch-ov-act" :href="actionMediaUrl" target="_blank" rel="noopener" download @click="closeActions">
            <DownloadIcon :size="24" :stroke-width="1.7" /><span>Tải xuống</span>
          </a>
          <button v-if="actionReactionDetails.length" class="mch-ov-act" @click="openReactionDetails">
            <HeartIcon :size="24" :stroke-width="1.7" /><span>{{ actionReactionDetails.length }} cảm xúc</span>
          </button>
          <template v-if="actionMsg.senderType === 'self'">
            <button class="mch-ov-act" @click="onRecall">
              <RotateCcwIcon :size="24" :stroke-width="1.7" /><span>Thu hồi</span>
            </button>
            <button class="mch-ov-act danger" @click="onDelete">
              <Trash2Icon :size="24" :stroke-width="1.7" /><span>Xóa</span>
            </button>
          </template>
        </div>
      </div>
    </Teleport>

    <MBottomSheet v-model="showForward" title="Chuyển tiếp tin nhắn">
      <div class="mch-forward-search"><SearchIcon :size="18" :stroke-width="2" /><input v-model="forwardQuery" type="search" placeholder="Tìm hội thoại hoặc bạn bè" @input="onForwardQueryInput" /></div>
      <div v-if="forwardLoading" class="mch-sheet-state">Đang tải hội thoại...</div>
      <div v-else-if="!forwardCandidates.length && !forwardFriends.length && !forwardFriendsLoading" class="mch-sheet-state">
        {{ forwardQuery.trim() ? 'Không tìm thấy hội thoại hoặc bạn bè phù hợp.' : 'Không có hội thoại phù hợp.' }}
      </div>
      <button v-for="conversation in forwardCandidates" :key="conversation.id" class="mch-forward-item" :class="{ selected: forwardTargetIds.has(conversation.id) }" @click="toggleForwardTarget(conversation.id)">
        <span class="mch-forward-check">{{ forwardTargetIds.has(conversation.id) ? '✓' : '' }}</span>
        <Avatar
          :src="forwardAvatarUrl(conversation)"
          :name="forwardName(conversation)"
          :size="40"
          :is-group="conversation.threadType === 'group'"
          :group-member-avatars="conversation.groupMemberAvatars || []"
          :gradient-seed="conversation.id"
        />
        <span class="mch-forward-name">{{ forwardName(conversation) }}</span>
      </button>

      <!-- Bạn bè của nick — kể cả người CHƯA từng chat qua CRM. Chọn xong bấm Chuyển tiếp
           thì hệ thống tự mở hội thoại cho họ (ensure-conversation) rồi gửi. -->
      <div v-if="forwardFriendsLoading" class="mch-sheet-state">Đang tìm bạn bè...</div>
      <template v-else-if="forwardFriends.length">
        <div class="mch-forward-sec">Bạn bè trên Zalo</div>
        <button
          v-for="f in forwardFriends" :key="f.id"
          class="mch-forward-item" :class="{ selected: forwardFriendIds.has(f.id) }"
          @click="toggleForwardFriend(f.id)"
        >
          <span class="mch-forward-check">{{ forwardFriendIds.has(f.id) ? '✓' : '' }}</span>
          <Avatar :src="f.zaloAvatarUrl" :name="forwardFriendName(f)" :size="40" :gradient-seed="f.id" />
          <span class="mch-forward-name">
            {{ forwardFriendName(f) }}
            <small v-if="!f.hasConversation" class="mch-forward-hint">chưa có hội thoại</small>
          </span>
        </button>
      </template>

      <div class="mch-forward-foot"><span>Đã chọn {{ forwardTotalSelected }}</span><button :disabled="forwardTotalSelected === 0 || forwarding" @click="submitForward">{{ forwarding ? 'Đang chuyển...' : 'Chuyển tiếp' }}</button></div>
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
        <button @click="showMediaPicker = true; showComposerTools = false"><FolderOpenIcon :size="23" /><span>Kho Media</span></button>
        <button @click="openTemplatePicker(); showComposerTools = false"><BookOpenIcon :size="23" /><span>Mẫu tin</span></button>
        <button @click="showCopilot = true; showComposerTools = false"><SparklesIcon :size="23" /><span>Trả lời AI</span></button>
      </div>
    </MBottomSheet>

    <MBottomSheet v-model="showMediaPicker" title="Kho Media"><div class="mch-media-picker-sheet"><MediaPickerPopover :conversation-id="convId" stage-before-send @close="showMediaPicker = false" @sent="onMediaSent" /></div></MBottomSheet>

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
      <div v-if="pendingFiles.length" class="mch-attachment-queue">
        <template v-for="file in pendingFiles" :key="file.name + file.size">
          <span v-if="previewUrl(file)" class="mch-attachment-thumb">
            <img :src="previewUrl(file)!" alt="" />
            <button aria-label="Bỏ ảnh" @click="removePendingFile(file)"><XIcon :size="12" :stroke-width="2.4" /></button>
          </span>
          <span v-else class="mch-attachment-chip">
            <PaperclipIcon :size="13" :stroke-width="2" /> {{ file.name }}
            <button aria-label="Bỏ tệp" @click="removePendingFile(file)"><XIcon :size="13" /></button>
          </span>
        </template>
      </div>
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
  ChevronLeft as ChevronLeftIcon, Image as ImageIcon, Send as SendIcon, Loader2 as LoaderIcon, Reply as ReplyIcon, Paperclip as PaperclipIcon, CalendarClock as CalendarClockIcon, StickyNote as StickyNoteIcon, Sparkles as SparklesIcon, BookOpen as BookOpenIcon, Plus as PlusIcon,
  X as XIcon, Copy as CopyIcon, Download as DownloadIcon, RotateCcw as RotateCcwIcon, Trash2 as Trash2Icon, Pin as PinIcon, PinOff as PinOffIcon, Forward as ForwardIcon, Search as SearchIcon, FolderOpen as FolderOpenIcon, Link as LinkIcon, MoreVertical as MoreVerticalIcon, Heart as HeartIcon, Smile as SmileIcon, ChevronUp as ChevronUpIcon, ChevronDown as ChevronDownIcon,
} from 'lucide-vue-next';
import MessageBubble from '@/components/chat/message-bubble.vue';
import Avatar from '@/components/ui/Avatar.vue';
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
import { useForwardFriends, forwardFriendName } from '@/composables/use-forward-friends';
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
    for (const f of filesToSend) revokePreview(f);
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

function openActions(m: any) {
  if (!m || m.isDeleted) return;
  actionMsg.value = m;
  showActions.value = true;
  if (navigator.vibrate) navigator.vibrate(10);
}
function closeActions() { showActions.value = false; }

// Vuốt-để-trả-lời (kéo hàng sang PHẢI qua ngưỡng → trả lời tin đó) + NHẤN-GIỮ mở overlay hành
// động (kiểu Zalo). Cụm nút tròn thường trực cạnh bubble đã bỏ: với chuỗi tin ngắn liên tiếp,
// cụm nút cao 90px đè lên các hàng lân cận và che nội dung.
const swipeId = ref<string | null>(null);
const swipeX = ref(0);
let swStartX = 0, swStartY = 0, swiping = false, swDecided = false, swHoriz = false;
const SWIPE_TRIGGER = 56, SWIPE_MAX = 80;
const LONG_PRESS_MS = 420, LONG_PRESS_SLOP = 10;
let lpTimer: ReturnType<typeof setTimeout> | undefined;
function cancelLongPress() { clearTimeout(lpTimer); lpTimer = undefined; }

function onRowTouchStart(_m: any, e: TouchEvent) {
  swStartX = e.touches[0].clientX; swStartY = e.touches[0].clientY;
  swiping = true; swDecided = false; swHoriz = false;
  swipeId.value = _m.id; swipeX.value = 0;
  cancelLongPress();
  lpTimer = setTimeout(() => {
    lpTimer = undefined;
    swiping = false; swipeX.value = 0; swipeId.value = null; // giữ đủ lâu → không còn là cử chỉ vuốt
    openActions(_m);
  }, LONG_PRESS_MS);
}
function onRowTouchMove(_m: any, e: TouchEvent) {
  if (!swiping) { cancelLongPress(); return; }
  const dx = e.touches[0].clientX - swStartX;
  const dy = e.touches[0].clientY - swStartY;
  // Ngón di quá ngưỡng rung tay → là vuốt/cuộn, không phải nhấn-giữ.
  if (Math.abs(dx) > LONG_PRESS_SLOP || Math.abs(dy) > LONG_PRESS_SLOP) cancelLongPress();
  if (!swDecided) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // chưa đủ để quyết hướng
    swDecided = true;
    swHoriz = Math.abs(dx) > Math.abs(dy) && dx > 0; // chỉ nhận vuốt sang PHẢI
  }
  if (swHoriz) {
    swipeX.value = Math.min(Math.max(dx, 0), SWIPE_MAX);
    e.preventDefault(); // chặn cuộn dọc khi đang vuốt ngang
  }
}
function onRowTouchEnd(m: any) {
  cancelLongPress();
  const trigger = swHoriz && swipeX.value >= SWIPE_TRIGGER;
  swiping = false; swDecided = false; swHoriz = false;
  swipeX.value = 0; swipeId.value = null;
  if (trigger) {
    setReplyTo(m);
    if (navigator.vibrate) navigator.vibrate(10);
    void nextTick(() => textarea.value?.focus());
  }
}

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

const sourceNickId = computed(() => selectedConv.value?.zaloAccount?.id ?? null);
const forwardCandidates = computed(() => {
  const query = forwardQuery.value.trim().toLocaleLowerCase('vi-VN');
  return conversations.value.filter((conversation) => {
    if (conversation.id === convId.value) return false;
    if (sourceNickId.value && conversation.zaloAccount?.id !== sourceNickId.value) return false;
    const name = forwardName(conversation).toLocaleLowerCase('vi-VN');
    return !query || name.includes(query);
  });
});

// ── Tìm cả BẠN BÈ của nick (kể cả người chưa từng chat qua CRM) ──
const { friends: forwardFriends, searching: forwardFriendsLoading, searchFriends, ensureConversations, clear: clearForwardFriends } = useForwardFriends();
const forwardFriendIds = ref(new Set<string>());
let forwardFriendTimer: ReturnType<typeof setTimeout> | undefined;

function onForwardQueryInput() {
  clearTimeout(forwardFriendTimer);
  const q = forwardQuery.value.trim();
  if (!q) { clearForwardFriends(); return; }
  forwardFriendTimer = setTimeout(() => {
    // Bỏ những người đã hiện ở mục Hội thoại để không trùng.
    const shown = new Set<string>();
    for (const c of forwardCandidates.value) if ((c as any).contact?.id) shown.add((c as any).contact.id);
    void searchFriends(sourceNickId.value, q, shown);
  }, 280);
}
function toggleForwardFriend(id: string) {
  const next = new Set(forwardFriendIds.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  forwardFriendIds.value = next;
}
function forwardName(conversation: any) {
  return conversation.groupName || conversation.contact?.crmName || conversation.contact?.fullName || conversation.friendship?.aliasInNick || conversation.friendship?.zaloDisplayName || 'Hội thoại';
}
// Ảnh đại diện hội thoại đích — nhóm ưu tiên ảnh nhóm (thiếu thì Avatar tự ghép lưới mặt
// thành viên), chat 1-1 lấy ảnh khách. Cùng nguồn dữ liệu với danh sách hội thoại.
function forwardAvatarUrl(conversation: any): string | null {
  if (conversation.threadType === 'group') return conversation.groupAvatarUrl || null;
  return conversation.contact?.avatarUrl || null;
}
async function openForward() {
  showActions.value = false;
  forwardQuery.value = '';
  forwardTargetIds.value = new Set();
  forwardFriendIds.value = new Set();
  clearForwardFriends();
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
const forwardTotalSelected = computed(() => forwardTargetIds.value.size + forwardFriendIds.value.size);
async function submitForward() {
  const message = actionMsg.value;
  if (!message || !convId.value || forwardTotalSelected.value === 0) return;
  forwarding.value = true;
  try {
    // Bạn bè chưa có hội thoại → tạo/lấy hội thoại (idempotent) rồi mới chuyển tiếp.
    const friendConvIds = forwardFriendIds.value.size
      ? await ensureConversations([...forwardFriendIds.value])
      : [];
    const targets = [...new Set([...forwardTargetIds.value, ...friendConvIds])];
    if (!targets.length) { toast.error('Không mở được hội thoại đích'); return; }

    await forwardMessage(convId.value, message.id, targets);
    showForward.value = false;
    toast.push(`Đã chuyển tiếp đến ${targets.length} hội thoại`);
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
  // messageId có thể là zaloMsgId (từ khối Trả lời) HOẶC id nội bộ (từ tìm kiếm/ghim).
  // Hàng DOM gắn data-msg-id = id NỘI BỘ, nên phải resolve về đúng message rồi query theo id đó
  // (fix Lỗi 2: trước đây query thẳng zaloMsgId → không khớp → không cuộn được).
  const findLoaded = () => messages.value.find(
    (m) => m.id === messageId || (m as any).zaloMsgId === messageId,
  );
  let target = findLoaded();
  if (!target) {
    // Chưa render → nạp đúng cửa sổ tin quanh tin gốc (KHÔNG reload cả hội thoại).
    const found = await loadMessageContext(convId.value, messageId);
    if (!found) { toast.push('Tin nhắn gốc không còn tồn tại'); return; }
    await nextTick();
    target = findLoaded();
  }
  if (!target) { toast.push('Tin nhắn gốc không còn tồn tại'); return; }
  await nextTick();
  const el = scroller.value?.querySelector<HTMLElement>(`[data-msg-id="${target.id}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('mch-jump-highlight');
  window.setTimeout(() => el.classList.remove('mch-jump-highlight'), 2200);
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
function removePendingFile(file: File) {
  revokePreview(file);
  pendingFiles.value = pendingFiles.value.filter((item) => item !== file);
}

// Xem trước ảnh trong hàng đính kèm — object URL cache theo file, tự revoke để không rò bộ nhớ.
const previewUrls = new Map<string, string>();
function fileKey(f: File) { return `${f.name}:${f.size}:${f.lastModified}`; }
function previewUrl(f: File): string | null {
  if (!f.type.startsWith('image/')) return null;
  const k = fileKey(f);
  let u = previewUrls.get(k);
  if (!u) { u = URL.createObjectURL(f); previewUrls.set(k, u); }
  return u;
}
function revokePreview(f: File) {
  const k = fileKey(f);
  const u = previewUrls.get(k);
  if (u) { URL.revokeObjectURL(u); previewUrls.delete(k); }
}

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

// Báo danh sách hội thoại (MConversationsView, keep-alive) xoá badge chưa đọc NGAY khi mở
// chat — server đã tự mark-read, đây chỉ đồng bộ UI tức thì thay vì đợi lần refresh sau.
function notifyRead(id: string | null) {
  if (id) window.dispatchEvent(new CustomEvent('mobile:conv-read', { detail: id }));
}

// Mở hội thoại + auto-scroll khi có tin mới (socket đã cập nhật `messages`).
onMounted(async () => {
  await selectConversation(convId.value);
  notifyRead(convId.value);
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
// Quay lại foreground (từ nền) → resync tin đã lỡ của thread đang mở (merge, KHÔNG reload UI)
// nếu đang ở gần đáy. Đang cuộn đọc tin cũ thì KHÔNG đụng để không xáo vị trí.
function onVisibility() {
  const hidden = document.hidden;
  announceViewing(hidden ? null : convId.value);
  if (!hidden && convId.value && nearBottom.value) void resyncOpenThread();
}
// Merge tin mới nhất của thread đang mở — dùng khi reconnect/foreground. fetchMessages cùng
// conv là MERGE (giữ tin socket, lấp lỗ hổng), không wipe. Chỉ gọi khi ở gần đáy.
let resyncing = false;
async function resyncOpenThread() {
  if (resyncing || !convId.value) return;
  resyncing = true;
  try { await fetchMessages(convId.value); if (nearBottom.value) await scrollBottom(true); }
  finally { resyncing = false; }
}
document.addEventListener('visibilitychange', onVisibility);
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility);
  stopPresence();
  clearReplyTo();
  cancelLongPress();
  clearTimeout(contentSearchTimer);
  clearKeywordHighlight();
  for (const u of previewUrls.values()) URL.revokeObjectURL(u);
  previewUrls.clear();
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
// Vừa KẾT NỐI LẠI realtime (offline→online) → merge tin đã lỡ của thread đang mở (nếu gần đáy).
watch(realtimeOffline, (offline, was) => {
  if (was && !offline && convId.value && nearBottom.value) void resyncOpenThread();
});
watch(convId, async (id) => { if (id) { hasOlderMessages.value = true; unseenCount.value = 0; await selectConversation(id); notifyRead(id); void refreshPinned(); restoreDraft(id); primeGroupAvatars(); await scrollBottom(); startPresence(); } });
</script>

<style scoped>
.mch-wrap { display: flex; flex-direction: column; width: 100%; max-width: 100vw; height: 100%; min-height: 0; min-width: 0; overflow: hidden; overflow-x: clip; overscroll-behavior: none; touch-action: pan-y; background: var(--m-surface-sunken); padding-bottom: v-bind('keyboardOffset + 'px''); }
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

.mch-msgs { flex: 1; width: 100%; max-width: 100%; min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior-x: none; overscroll-behavior-y: contain; touch-action: pan-y; -webkit-overflow-scrolling: touch; scrollbar-width: none; contain: layout paint; padding: var(--m-sp-3) var(--m-sp-3) var(--m-sp-1); }
.mch-history-status { margin: 2px auto 8px; color: var(--m-text-3); font-size: var(--m-fs-xs); text-align: center; }
.mch-history-status--err { color: var(--m-danger); }
.mch-history-retry { border: 0; background: transparent; color: var(--m-brand); font-weight: var(--m-fw-semibold); font-size: var(--m-fs-xs); text-decoration: underline; cursor: pointer; }
.mch-day { width: fit-content; margin: 10px auto 8px; padding: 3px 9px; border-radius: 999px; background: var(--m-surface-2); color: var(--m-text-3); font-size: var(--m-fs-xs); }
/* Nhịp dọc: tin trong CÙNG cụm sát nhau (2px), giữa hai cụm khác người gửi giãn ra (10px) —
   nếu để 2px cho tất cả thì mắt không tách được ai đang nói. */
.mch-row { position: relative; margin-bottom: 2px; border-radius: var(--m-r-md); contain: layout paint; }
.mch-row.is-cluster-end { margin-bottom: 10px; }
/* Chat 1-1: tên người gửi trong bubble trùng với tên ở header → ẩn (nhóm vẫn hiện). */
.mch-msgs.is-direct :deep(.sender-name) { display: none; }
/* Vuốt-để-trả-lời: snap-back mượt khi thả (chỉ transition khi KHÔNG đang kéo). */
.mch-row:not(.mch-row--swiping) { transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1); }

/* P2 — chặn menu/căn-chọn/callout mặc định của TRÌNH DUYỆT trong vùng tin nhắn (không đụng
   ô nhập ở footer). Sao chép/thao tác đi qua menu riêng (icon ⋯). */
.mch-msgs {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}

/* Overlay nhấn-giữ (kiểu Zalo): nền mờ + bubble nổi + hàng cảm xúc + lưới hành động.
   Xếp dọc, canh giữa; tin dài tự cuộn trong khung để không đẩy lưới hành động ra ngoài. */
.mch-ov {
  position: fixed; inset: 0; z-index: 3000;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: calc(env(safe-area-inset-top, 0px) + 16px) 16px calc(env(safe-area-inset-bottom, 0px) + 16px);
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
  animation: mch-ov-in 0.16s ease-out;
}
@keyframes mch-ov-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .mch-ov { animation: none; } }
/* Bubble nổi: giữ nguyên renderer chung, chỉ giới hạn chiều cao + canh trái/phải theo người gửi. */
.mch-ov-msg {
  display: flex; width: 100%; max-width: 520px; max-height: 42vh; overflow-y: auto;
  scrollbar-width: none;
}
.mch-ov-msg.is-self { justify-content: flex-end; }
.mch-ov-msg :deep(.bubble-wrapper) { max-width: 100%; }
/* Overlay là bản sao tĩnh để xem + chọn hành động — ẩn nút hover reaction của desktop. */
.mch-ov-msg :deep(.reaction-trigger) { display: none; }

.mch-ov-react {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 10px; border-radius: var(--m-r-full);
  background: var(--m-surface); box-shadow: 0 6px 24px rgba(15, 23, 42, 0.25);
}
.mch-ov-react-btn {
  width: 44px; height: 44px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 50%; background: none; padding: 0;
  font-size: 27px; line-height: 1; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.12s ease;
}
.mch-ov-react-btn:active { transform: scale(1.28); }

.mch-ov-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px;
  width: 100%; max-width: 420px; padding: 12px 6px;
  border-radius: 18px; background: var(--m-surface);
  box-shadow: 0 8px 32px rgba(15, 23, 42, 0.28);
}
.mch-ov-act {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  min-height: var(--m-touch); padding: 10px 4px;
  border: 0; border-radius: 12px; background: none; cursor: pointer;
  color: var(--m-text); font-family: inherit; font-size: var(--m-fs-xs); text-align: center; text-decoration: none;
  -webkit-tap-highlight-color: transparent;
}
.mch-ov-act:active { background: var(--m-surface-2); }
.mch-ov-act.danger { color: var(--m-danger); }
.mch-swipe-reply {
  position: absolute; left: -34px; top: 50%; transform: translateY(-50%);
  width: 30px; height: 30px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--m-brand-soft); color: var(--m-brand-strong);
}
.mch-jump-highlight { outline: 2px solid var(--m-brand); outline-offset: 3px; background: var(--m-brand-soft); transition: background 0.3s ease; }
/* P1 — ảnh trong bubble không kéo full quá lớn; bo góc, cắt gọn. Album grid do MessageBubble lo. */
.mch-msgs :deep(.chat-image) { max-height: 62vh; max-width: 100%; object-fit: cover; border-radius: 14px; }
.mch-msgs :deep(.chat-video) { max-height: 62vh; max-width: 100%; border-radius: 14px; }

/* Menu phụ (header, ghim, chuyển tiếp…) — vẫn dùng bottom sheet dạng danh sách. */
.mch-act-item { display: flex; align-items: center; gap: var(--m-sp-3); width: 100%; min-height: var(--m-touch); padding: 13px var(--m-sp-4); border: 0; background: none; color: var(--m-text); font-size: var(--m-fs-md); font-family: inherit; text-align: left; text-decoration: none; cursor: pointer; }
.mch-act-item:active { background: var(--m-surface-2); }
.mch-act-item.danger { color: var(--m-danger); }
.mch-sheet-state { padding: 28px var(--m-sp-4); color: var(--m-text-2); font-size: var(--m-fs-sm); text-align: center; }
.mch-forward-search { display: flex; align-items: center; gap: 8px; margin: 2px var(--m-sp-4) 8px; padding: 0 12px; border-radius: var(--m-r-full); background: var(--m-surface-2); color: var(--m-text-3); }
.mch-forward-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; padding: 11px 0; font: inherit; color: var(--m-text); }
.mch-forward-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; padding: 8px var(--m-sp-4); border: 0; border-top: 1px solid var(--m-border); background: none; text-align: left; color: var(--m-text); }
.mch-forward-item.selected { background: var(--m-brand-soft); }
.mch-forward-sec { padding: 10px var(--m-sp-4) 4px; font-size: var(--m-fs-xs); font-weight: var(--m-fw-bold); color: var(--m-text-3); text-transform: uppercase; letter-spacing: .3px; background: var(--m-surface-2); }
.mch-forward-hint { display: block; font-size: var(--m-fs-2xs); color: var(--m-text-3); font-weight: var(--m-fw-regular, 400); }
.mch-forward-check { width: 22px; height: 22px; flex: 0 0 22px; display: inline-flex; align-items: center; justify-content: center; border: 1.5px solid var(--m-border-strong); border-radius: 50%; color: var(--m-brand-ink); background: transparent; font-weight: var(--m-fw-bold); }
.mch-forward-item.selected .mch-forward-check { background: var(--m-brand); border-color: var(--m-brand); }
.mch-forward-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--m-fs-md); }
.mch-forward-item :deep(.smax-av) { flex-shrink: 0; }
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
.mch-search-panel-inner { background: var(--m-surface); max-height: 62dvh; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; touch-action: pan-y; -webkit-overflow-scrolling: touch; }
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
.mch-video { position: fixed; inset: 0; z-index: 4000; background: rgba(0,0,0,0.96); display: flex; align-items: center; justify-content: center; animation: mch-fade-in 0.2s ease; }
@keyframes mch-fade-in { from { opacity: 0; } to { opacity: 1; } }
/* Thanh điều khiển trên cùng: scrim gradient để nút Đóng luôn thấy rõ trên video sáng. */
.mch-video::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 96px; background: linear-gradient(to bottom, rgba(0,0,0,0.5), transparent); pointer-events: none; z-index: 1; }
.mch-video-el { max-width: 100vw; max-height: 100dvh; border-radius: 4px; }
.mch-video-close { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 8px); right: 12px; width: 42px; height: 42px; display: inline-flex; align-items: center; justify-content: center; border: 0; background: rgba(255,255,255,0.16); backdrop-filter: blur(6px); color: #fff; border-radius: 999px; z-index: 2; transition: transform 0.1s ease; }
.mch-video-close:active { background: rgba(255,255,255,0.3); transform: scale(0.92); }
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
.mch-emoji-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; padding: 4px var(--m-sp-3) var(--m-sp-3); max-height: 44dvh; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; touch-action: pan-y; -webkit-overflow-scrolling: touch; }
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
.mch-media-picker-sheet :deep(.mp-filter-btn), .mch-media-picker-sheet :deep(.mp-x), .mch-media-picker-sheet :deep(.mp-send-album), .mch-media-picker-sheet :deep(.mp-fitem) { min-height: var(--m-touch); }
.mch-media-picker-sheet :deep(.seg span) { min-height: 36px; display: inline-flex; align-items: center; }
.mch-media-picker-sheet :deep(.mp-grid), .mch-media-picker-sheet :deep(.mp-list) { min-height: 0; flex: 1; overscroll-behavior: contain; touch-action: pan-y; -webkit-overflow-scrolling: touch; }
.mch-attachment-queue { display: flex; width: 100%; max-width: 100%; gap: 6px; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; touch-action: pan-x; padding: 2px 0; }
.mch-attachment-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 180px; padding: 5px 8px; border-radius: 999px; background: var(--m-surface-2); color: var(--m-text-2); font-size: var(--m-fs-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mch-attachment-chip button { border: 0; background: none; color: var(--m-text-3); padding: 0; }
/* Thumbnail ảnh chờ gửi (thấy trước ảnh, có nút xoá góc). */
.mch-attachment-thumb { position: relative; flex-shrink: 0; width: 54px; height: 54px; border-radius: var(--m-r-md); overflow: hidden; background: var(--m-surface-2); }
.mch-attachment-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mch-attachment-thumb button {
  position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; display: inline-flex;
  align-items: center; justify-content: center; border: 0; border-radius: 50%;
  background: rgba(0,0,0,0.55); color: #fff; padding: 0; cursor: pointer;
}
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

