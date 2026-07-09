<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- Màn chat mobile. Tái dùng useChat (API + socket + optimistic send) và
     message-bubble.vue (render ảnh/sticker/reply/thu hồi) — không viết lại renderer. -->
<template>
  <div class="mch-wrap">
    <header class="mch-head">
      <button class="mch-back" aria-label="Quay lại" @click="goBack">‹</button>
      <div class="mch-avatar">
        <img v-if="avatarUrl" :src="avatarUrl" alt="" />
        <span v-else>{{ initial }}</span>
      </div>
      <div class="mch-info">
        <div class="mch-name">{{ title }}</div>
        <div v-if="nickName" class="mch-nick">qua {{ nickName }}</div>
      </div>
    </header>

    <div ref="scroller" class="mch-msgs" @scroll.passive="onScroll">
      <div v-if="loadingMsgs && !messages.length" class="mch-state">Đang tải tin nhắn…</div>
      <div v-else-if="!messages.length" class="mch-state">Chưa có tin nhắn.</div>

      <div v-for="(m, i) in messages" :key="m.id" class="mch-row">
        <MessageBubble
          :message="m"
          :reply="(m as any).reply || null"
          :reactions="(m as any).reactions || []"
          :is-self="m.senderType === 'self'"
          :is-group="selectedConv?.threadType === 'group'"
          :is-group-start="isGroupStart(i)"
          :is-group-end="isGroupEnd(i)"
          :sender-avatar-url="avatarUrl"
          :current-user-id="currentUserId"
        />
      </div>
    </div>

    <div v-if="sendError" class="mch-retry">
      Gửi thất bại.
      <button @click="retry">Thử lại</button>
      <button class="ghost" @click="sendError = null">Bỏ qua</button>
    </div>

    <!-- Input luôn dính đáy -->
    <footer class="mch-input">
      <button class="mch-tool" aria-label="Gửi ảnh" @click="imageInput?.click()">🖼️</button>
      <EmojiPicker @pick="onEmoji" />
      <textarea
        ref="textarea" v-model="text" rows="1" placeholder="Nhập tin nhắn…"
        @keydown.enter.exact.prevent="send" @input="autoGrow"
      />
      <button class="mch-send" :disabled="!text.trim() || sendingMsg" aria-label="Gửi" @click="send">
        {{ sendingMsg ? '…' : '➤' }}
      </button>
      <input ref="imageInput" type="file" accept="image/*" multiple hidden @change="onPickImages" />
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
import MessageBubble from '@/components/chat/message-bubble.vue';
import EmojiPicker from '@/components/chat/EmojiPicker.vue';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const auth = useAuthStore();
const {
  messages, selectedConv, loadingMsgs, sendingMsg,
  selectConversation, sendMessage, fetchMessages, getSocket,
} = useChat();

const text = ref('');
const sendError = ref<string | null>(null);
const scroller = ref<HTMLElement | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);
const imageInput = ref<HTMLInputElement | null>(null);
const currentUserId = computed(() => auth.user?.id ?? null);

const convId = computed(() => route.params.convId as string);
const title = computed(() => selectedConv.value?.contact?.fullName || 'Chat');
const avatarUrl = computed(() => (selectedConv.value?.contact as any)?.avatarUrl ?? null);
const nickName = computed(() => (selectedConv.value as any)?.zaloAccount?.displayName ?? '');
const initial = computed(() => (title.value || '?').charAt(0).toUpperCase());

// Gom cụm tin liên tiếp cùng người gửi (giống desktop) để bớt lặp avatar/giờ.
function isGroupStart(i: number) {
  const prev = messages.value[i - 1];
  return !prev || prev.senderType !== messages.value[i].senderType;
}
function isGroupEnd(i: number) {
  const next = messages.value[i + 1];
  return !next || next.senderType !== messages.value[i].senderType;
}

function goBack() { router.push({ name: 'M.Conversations' }); }

async function scrollBottom(smooth = false) {
  await nextTick();
  const el = scroller.value;
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}
function onScroll() { /* chỗ móc cho load-more lịch sử ở P5 */ }

function autoGrow() {
  const el = textarea.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

let lastSent = '';
async function send() {
  const body = text.value.trim();
  if (!body || sendingMsg.value) return;
  lastSent = body;
  text.value = '';
  sendError.value = null;
  autoGrow();
  try {
    await sendMessage(body);
    await scrollBottom(true);
  } catch {
    sendError.value = lastSent;
    text.value = lastSent; // trả chữ lại cho user, không mất công gõ
  }
}
async function retry() {
  const body = sendError.value;
  if (!body) return;
  sendError.value = null;
  text.value = body;
  await send();
}

function onEmoji(e: string) {
  text.value += e;
  textarea.value?.focus();
}

async function onPickImages(ev: Event) {
  const files = Array.from((ev.target as HTMLInputElement).files || []);
  if (imageInput.value) imageInput.value.value = '';
  if (!files.length || !convId.value) return;
  toast.push(`Đang gửi ${files.length} ảnh…`);
  try {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    await api.post(`/conversations/${convId.value}/attachments`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    await fetchMessages(convId.value);
    await scrollBottom(true);
  } catch (err: any) {
    toast.error(err?.response?.data?.error || 'Gửi ảnh thất bại');
  }
}

// ── Presence: báo server "đang mở hội thoại này" → không tự bắn notification cho mình.
// Heartbeat 30s vì key Redis TTL 60s (tab đóng đột ngột thì key tự hết hạn).
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
  await scrollBottom();
  startPresence();
});
// Ẩn tab / khoá máy → coi như không còn xem, để vẫn nhận được notification.
function onVisibility() {
  announceViewing(document.hidden ? null : convId.value);
}
document.addEventListener('visibilitychange', onVisibility);
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility);
  stopPresence();
});

watch(() => messages.value.length, () => void scrollBottom(true));
watch(convId, async (id) => { if (id) { await selectConversation(id); await scrollBottom(); startPresence(); } });
</script>

<style scoped>
.mch-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--smax-grey-100, #f5f6fa); }
.mch-head {
  flex-shrink: 0; display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; background: var(--smax-bg, #fff);
  border-bottom: 1px solid var(--smax-grey-200, #ebedf0);
}
.mch-back { border: 0; background: none; font-size: 30px; line-height: 1; padding: 0 8px 4px; color: var(--smax-primary, #1786be); cursor: pointer; }
.mch-avatar {
  width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #90caf9, #1976d2); color: #fff;
  display: flex; align-items: center; justify-content: center; font-weight: 600;
}
.mch-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.mch-info { min-width: 0; }
.mch-name { font-size: 15.5px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mch-nick { font-size: 11.5px; color: var(--smax-grey-700, #5a6478); }

.mch-msgs { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 12px 12px 4px; }
.mch-row { margin-bottom: 2px; }
.mch-state { text-align: center; color: var(--smax-grey-700, #5a6478); font-size: 14px; padding: 24px; }

.mch-retry {
  flex-shrink: 0; display: flex; align-items: center; gap: 8px; justify-content: center;
  background: #fee2e2; color: #991b1b; font-size: 13px; padding: 8px;
}
.mch-retry button { border: 0; border-radius: 8px; padding: 5px 12px; background: #991b1b; color: #fff; font-weight: 600; }
.mch-retry button.ghost { background: transparent; color: #991b1b; text-decoration: underline; }

.mch-input {
  flex-shrink: 0; display: flex; align-items: flex-end; gap: 6px;
  padding: 8px 10px; background: var(--smax-bg, #fff);
  border-top: 1px solid var(--smax-grey-200, #ebedf0);
}
.mch-tool { border: 0; background: none; font-size: 22px; padding: 6px; cursor: pointer; }
.mch-input textarea {
  flex: 1; min-width: 0; resize: none; border: 0; outline: none;
  background: var(--smax-grey-100, #f5f6fa); border-radius: 20px;
  padding: 10px 14px; font-size: 16px; /* 16px: iOS không tự zoom khi focus */
  line-height: 1.35; max-height: 120px;
}
.mch-send {
  width: 42px; height: 42px; border: 0; border-radius: 50%; flex-shrink: 0;
  background: var(--smax-primary, #1786be); color: #fff; font-size: 17px; cursor: pointer;
}
.mch-send:disabled { opacity: .4; }
</style>
