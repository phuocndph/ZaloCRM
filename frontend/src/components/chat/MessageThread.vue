<template>
  <div class="message-thread">
    <!-- Empty state -->
    <div v-if="!conversation" class="empty-state">
      <v-icon icon="mdi-chat-outline" size="96" color="grey-lighten-2" />
      <p class="text-h6 mt-4">Chọn cuộc trò chuyện</p>
    </div>

    <template v-else>
      <!-- ════════ Chat header (Smax-style) ════════ -->
      <header class="chat-header">
        <div class="ch-avatar-wrap">
          <div class="ch-avatar" :style="avatarStyle">
            {{ avatarInitials }}
          </div>
          <div v-if="contactGender" class="gender-badge" :class="genderClass">
            {{ contactGender === 'female' ? '♀' : '♂' }}
          </div>
        </div>

        <div class="ch-info">
          <div class="ch-name-row">
            <div class="ch-name">{{ headerName }}</div>
            <span v-if="friendshipChip" :class="['status-pill', friendshipChipClass]">
              {{ friendshipChip }}
            </span>
            <CareStatusBadge
              v-if="conversation.contact"
              :model-value="(conversation.contact.status as string | null) || 'new'"
              @update:model-value="onCareStatusChange"
            />
          </div>
          <div class="ch-meta">
            <span v-if="conversation.contact?.phone">📞 {{ conversation.contact.phone }}</span>
            <span v-if="friendshipDays" class="dot">·</span>
            <span v-if="friendshipDays">{{ friendshipDays }} ngày là bạn</span>
            <span v-if="msgCounts" class="dot">·</span>
            <span v-if="msgCounts">{{ msgCounts }}</span>
            <span v-if="conversation.zaloAccount?.displayName" class="dot">·</span>
            <span v-if="conversation.zaloAccount?.displayName" class="from-nick">
              từ nick: {{ conversation.zaloAccount.displayName }}
            </span>
          </div>
        </div>

        <div class="ch-actions">
          <button v-if="friendshipChip" class="btn-action btn-friend-already">
            ✓ Đã KB
          </button>
          <button class="btn-action btn-webhook" :disabled="webhookLoading" @click="fireWebhook">
            {{ webhookLoading ? '⏳ Đang bắn…' : '🚀 Webhook' }}
          </button>
          <button class="icon-btn" title="Lịch sử" @click="toast.push('Mở lịch sử (chưa implement)')">🕐</button>
          <button class="icon-btn" title="Tìm" @click="toast.push('Tìm trong hội thoại (chưa implement)')">🔍</button>
          <button class="icon-btn" title="Note" @click="toast.push('Ghi chú nhanh (xem ở info panel)')">📝</button>
          <button
            class="icon-btn"
            :class="{ on: showContactPanel }"
            title="Toggle thông tin KH"
            @click="$emit('toggle-contact-panel')"
          >ⓘ</button>
        </div>
      </header>

      <!-- ════════ Messages ════════ -->
      <div ref="messagesContainer" class="messages chat-messages-area">
        <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />

        <template v-for="item in displayItems" :key="item.key">
          <!-- Date divider -->
          <div v-if="item.kind === 'divider'" class="msg-divider">{{ item.label }}</div>

          <!-- Album -->
          <div v-else-if="item.kind === 'album'" class="msg-album-wrap" :class="item.senderType === 'self' ? 'self' : ''">
            <div class="msg-album-body">
              <div v-if="conversation.threadType === 'group' && item.senderType !== 'self'" class="album-sender">
                {{ item.senderName || 'Unknown' }}
              </div>
              <div class="bubble album">
                <div class="album-grid" :class="albumGridClass(item.messages.length)">
                  <img
                    v-for="m in item.messages"
                    :key="m.id"
                    :src="getImageUrl(m)!"
                    alt="Hình ảnh"
                    class="album-tile"
                    @click="previewImageUrl = getImageUrl(m)!"
                  />
                </div>
                <div v-if="item.totalExpected && item.totalExpected > item.messages.length" class="album-progress">
                  {{ item.messages.length }}/{{ item.totalExpected }} ảnh đã nhận
                </div>
                <div class="bubble-time">
                  {{ formatMessageTime(item.sentAt) }} · 🖼️ {{ item.messages.length }} ảnh
                </div>
              </div>
            </div>
          </div>

          <!-- Single message — MessageBubble component -->
          <MessageBubble
            v-else
            :message="item.msg"
            :reply="item.msg.reply || null"
            :reactions="item.msg.reactions || []"
            :is-self="item.msg.senderType === 'self'"
            :is-group="conversation.threadType === 'group'"
            @contextmenu="onContextMenu($event, item.msg)"
            @preview-image="previewImageUrl = $event"
            @toggle-reaction="onToggleReaction(item.msg, $event)"
          />
        </template>

        <div v-if="!loading && messages.length === 0" class="text-center pa-8 text-grey">Chưa có tin nhắn</div>
      </div>

      <!-- Typing indicator -->
      <TypingIndicator :typers="currentTypers" />

      <!-- AI suggest bar -->
      <AISuggestBar
        :suggestion="aiSuggestion"
        :loading="aiSuggestionLoading"
        :error="aiSuggestionError"
        @use="applySuggestion"
        @refresh="$emit('ask-ai')"
      />

      <!-- ════════ Input area: toolbar trên textarea (Smax-style) ════════ -->
      <div class="input-area">
        <ReplyPreviewBar
          :message="(replyingTo || editingMessage) ?? null"
          :mode="editingMessage ? 'edit' : 'reply'"
          @cancel="onCancelReplyEdit"
        />

        <div class="input-toolbar-top">
          <button class="icon-tool" title="Emoji" @click="todoToast('Emoji picker')">😊</button>
          <button class="icon-tool" title="Sticker" @click="todoToast('Sticker')">🎴</button>
          <button class="icon-tool spacer-after" title="GIF" @click="todoToast('GIF')">🎞</button>
          <button class="icon-tool" title="Đính kèm file" @click="todoToast('Attach file')">📎</button>
          <button class="icon-tool" title="Hình ảnh" @click="todoToast('Upload hình')">🖼</button>
          <button class="icon-tool" title="Voice" @click="todoToast('Voice recording')">🎤</button>
          <button class="icon-tool spacer-after" title="Video" @click="todoToast('Video')">🎥</button>
          <button class="icon-tool" title="Template (gõ /)" @click="openTemplatePopup">⚡</button>
          <button class="icon-tool" title="Tin nhắn nhanh" @click="todoToast('Tin nhắn nhanh')">💬</button>
          <button class="icon-tool" title="Card BĐS" @click="todoToast('Card BĐS')">🏠</button>
          <button class="icon-tool" title="Card KH" @click="todoToast('Card KH')">👤</button>
          <button class="icon-tool spacer-after" title="Vị trí" @click="onLinkClick">📍</button>
          <button class="icon-tool ai-btn" title="AI compose" :disabled="aiSuggestionLoading" @click="$emit('ask-ai')">✨</button>
          <button class="icon-tool" title="Dịch" @click="todoToast('Dịch tin nhắn')">🌐</button>
        </div>

        <div class="input-row">
          <QuickTemplatePopup
            :visible="showTemplatePopup"
            :query="templateQuery"
            :templates="templates"
            :contact="conversation.contact"
            @select="onTemplateSelect"
            @close="showTemplatePopup = false"
          />
          <RichTextEditor
            ref="editorRef"
            v-model="inputText"
            :placeholder="inputPlaceholder"
            class="input-editor"
            @submit="handleSend"
            @typing="onTypingEvent"
          />
          <button class="send-btn" :disabled="!inputText.trim() || sending" @click="handleSend" title="Gửi (Enter)">
            <v-icon v-if="sending" size="20">mdi-loading mdi-spin</v-icon>
            <span v-else>➤</span>
          </button>
        </div>
      </div>
    </template>

    <!-- Context menu -->
    <MessageContextMenu
      v-model="showContextMenu"
      :message="contextMsg"
      :is-self="contextMsg?.senderType === 'self'"
      :is-pinned="conversation?.isPinned"
      :position="contextPos"
      @reply="onReply"
      @edit="onEdit"
      @delete="onDelete"
      @undo="onUndo"
      @forward="showForwardDialog = true"
      @copy="() => {}"
      @pin="onPin"
    />

    <!-- Forward dialog -->
    <ForwardDialog
      v-model="showForwardDialog"
      :conversations="allConversations ?? []"
      @forward="onForward"
    />

    <!-- Image preview -->
    <v-dialog v-model="showImagePreview" max-width="900" content-class="elevation-0">
      <div class="text-center" @click="showImagePreview = false" style="cursor: pointer;">
        <img :src="previewImageUrl" alt="Preview" style="max-width: 100%; max-height: 85vh; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);" />
        <div class="text-caption mt-2" style="color: #aaa;">Nhấn để đóng</div>
      </div>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted } from 'vue';
import type { Conversation, Message } from '@/composables/use-chat';
import { api } from '@/api/index';
import AISuggestBar from '@/components/chat/AISuggestBar.vue';
import CareStatusBadge from '@/components/ui/CareStatusBadge.vue';
import QuickTemplatePopup from '@/components/chat/quick-template-popup.vue';
import MessageBubble from '@/components/chat/message-bubble.vue';
import MessageContextMenu from '@/components/chat/message-context-menu.vue';
import TypingIndicator from '@/components/chat/typing-indicator.vue';
import ReplyPreviewBar from '@/components/chat/reply-preview-bar.vue';
import ForwardDialog from '@/components/chat/forward-dialog.vue';
import RichTextEditor from '@/components/chat/rich-text-editor.vue';
import { useToast } from '@/composables/use-toast';

interface TemplateItem { id: string; name: string; content: string; category: string | null; isPersonal: boolean; }

const props = defineProps<{
  conversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  showContactPanel?: boolean;
  aiSuggestion: string;
  aiSuggestionLoading: boolean;
  aiSuggestionError: string;
  allConversations?: Conversation[];
  replyingTo?: Message | null;
  editingMessage?: Message | null;
  typingUsers?: { userId: string; userName: string }[];
}>();

const emit = defineEmits<{
  send: [content: string, replyMessageId?: string | null];
  'toggle-contact-panel': [];
  'ask-ai': [];
  'add-reaction': [msgId: string, reaction: string];
  'delete-message': [msgId: string];
  'undo-message': [msgId: string];
  'edit-message': [msgId: string, content: string];
  'forward-message': [msgId: string, targetIds: string[]];
  'pin-conversation': [];
  'set-reply-to': [msg: Message];
  'set-editing': [msg: Message];
  'cancel-reply-edit': [];
  'typing': [];
  'refresh-thread': [];
  'care-status-changed': [value: string];
}>();

const toast = useToast();
const inputText = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const previewImageUrl = ref('');
const showImagePreview = computed({ get: () => !!previewImageUrl.value, set: (v) => { if (!v) previewImageUrl.value = ''; } });
const webhookLoading = ref(false);

// Context menu state
const showContextMenu = ref(false);
const contextMsg = ref<Message | null>(null);
const contextPos = ref({ x: 0, y: 0 });
const showForwardDialog = ref(false);
const editorRef = ref<InstanceType<typeof RichTextEditor> | null>(null);
const currentTypers = computed(() => props.typingUsers || []);

// ── Header derived data ─────────────────────────────────────────────────────
const headerName = computed(() => {
  const c = props.conversation?.contact;
  return c?.crmName || c?.fullName || 'Unknown';
});
const avatarInitials = computed(() => {
  const parts = headerName.value.trim().split(/\s+/);
  return (parts[parts.length - 1]?.[0] || '?').toUpperCase()
    + (parts.length > 1 ? (parts[parts.length - 2]?.[0] || '').toUpperCase() : '');
});
const avatarStyle = computed(() => {
  const n = (headerName.value.charCodeAt(0) || 0) % 5;
  const palettes = [
    'linear-gradient(135deg,#90caf9,#1976d2)',
    'linear-gradient(135deg,#ff7043,#bf360c)',
    'linear-gradient(135deg,#ce93d8,#7b1fa2)',
    'linear-gradient(135deg,#80cbc4,#00695c)',
    'linear-gradient(135deg,#fbc02d,#f57c00)',
  ];
  return { background: palettes[n] };
});
const contactGender = computed(() => props.conversation?.contact?.gender);
const genderClass = computed(() =>
  contactGender.value === 'female' ? 'gender-female' : 'gender-male',
);
const friendshipChip = computed(() => {
  // Heuristic: if zaloUid set + thread is user, treat as friend.
  if (props.conversation?.threadType !== 'user') return null;
  if (!props.conversation?.contact?.zaloUid) return null;
  return '✓ Bạn bè';
});
const friendshipChipClass = computed(() => 'pill-success');
const friendshipDays = computed(() => {
  // MOCK: chờ field becameFriendAt expose qua /conversations payload
  return null as number | null;
});
const msgCounts = computed(() => {
  const c = props.conversation?.contact;
  if (!c?.totalInbound && !c?.totalOutbound) return null;
  return `${c.totalInbound ?? 0} in / ${c.totalOutbound ?? 0} out`;
});
const inputPlaceholder = computed(() => {
  const nick = props.conversation?.zaloAccount?.displayName || 'Zalo';
  return `Đang nhắn từ nick: ${nick}\nGõ "/" để chèn template, "@" mention, "#" tag…`;
});

function onCareStatusChange(value: string) {
  emit('care-status-changed', value);
  toast.success(`Đã đổi care status → ${value}`);
}

async function fireWebhook() {
  if (!props.conversation?.contact?.id) return;
  webhookLoading.value = true;
  try {
    // MOCK: chờ POST /webhooks/fire endpoint
    await new Promise(r => setTimeout(r, 700));
    toast.success('Webhook đã bắn về CRM');
  } catch {
    toast.error('Webhook fail');
  } finally {
    webhookLoading.value = false;
  }
}

function todoToast(label: string) {
  toast.push(`${label}: chưa implement`, 'warning');
}

// ── Display item types (album grouping + date dividers) ─────────────────────
type DisplayItem =
  | { kind: 'single'; key: string; msg: Message }
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'album'; key: string; senderType: string; senderName: string | null; sentAt: string; totalExpected: number | null; messages: Message[] };

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dd = d.getDate().toString().padStart(2, '0');
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = d.getHours().toString().padStart(2, '0');
  const mi = d.getMinutes().toString().padStart(2, '0');
  if (day.getTime() === today.getTime()) return `Hôm nay ${hh}:${mi}`;
  if (day.getTime() === yesterday.getTime()) return `Hôm qua ${hh}:${mi}`;
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

const displayItems = computed<DisplayItem[]>(() => {
  const out: DisplayItem[] = [];
  let curAlbum: Extract<DisplayItem, { kind: 'album' }> | null = null;
  let lastDayKey = '';

  for (const msg of props.messages) {
    const d = new Date(msg.sentAt);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${Math.floor(d.getHours() / 4)}`;
    if (dayKey !== lastDayKey) {
      out.push({ kind: 'divider', key: 'div:' + dayKey, label: dayLabel(msg.sentAt) });
      lastDayKey = dayKey;
      curAlbum = null;
    }

    const canGroup = msg.contentType === 'image' && msg.albumKey && !msg.isDeleted && !!getImageUrl(msg);
    if (canGroup && curAlbum && curAlbum.key === `album:${msg.albumKey}:${msg.senderType}`) {
      curAlbum.messages.push(msg);
      continue;
    }
    curAlbum = null;
    if (canGroup) {
      curAlbum = {
        kind: 'album',
        key: `album:${msg.albumKey}:${msg.senderType}`,
        senderType: msg.senderType,
        senderName: msg.senderName,
        sentAt: msg.sentAt,
        totalExpected: msg.albumTotal ?? null,
        messages: [msg],
      };
      out.push(curAlbum);
    } else {
      out.push({ kind: 'single', key: msg.id, msg });
    }
  }
  for (const item of out) {
    if (item.kind === 'album') {
      item.messages.sort((a, b) => (a.albumIndex ?? 0) - (b.albumIndex ?? 0));
    }
  }
  return out;
});

function albumGridClass(count: number): string {
  if (count <= 1) return 'album-grid-1';
  if (count <= 4) return 'album-grid-2';
  return 'album-grid-3';
}

// ── Context menu / actions ──────────────────────────────────────────────────
function onContextMenu(event: MouseEvent, msg: Message) {
  contextMsg.value = msg;
  contextPos.value = { x: event.clientX, y: event.clientY };
  showContextMenu.value = true;
}
function onToggleReaction(msg: Message, emoji: string) { emit('add-reaction', msg.id, emoji); }
function onReply() { if (contextMsg.value) emit('set-reply-to', contextMsg.value); }
function onEdit() {
  if (contextMsg.value) {
    emit('set-editing', contextMsg.value);
    inputText.value = contextMsg.value.content || '';
  }
}
function onDelete() { if (contextMsg.value) emit('delete-message', contextMsg.value.id); }
function onUndo() { if (contextMsg.value) emit('undo-message', contextMsg.value.id); }
function onPin() { emit('pin-conversation'); }

async function onLinkClick() {
  const url = window.prompt('Nhập URL hoặc địa chỉ vị trí để gửi');
  if (!url?.trim() || !props.conversation) return;
  try {
    await api.post(`/conversations/${props.conversation.id}/link`, { url: url.trim() });
    emit('refresh-thread');
    toast.success('Đã gửi link');
  } catch (err) {
    console.error('Failed to send link:', err);
    toast.error('Gửi link thất bại');
  }
}

function onForward(targetIds: string[]) {
  if (contextMsg.value) emit('forward-message', contextMsg.value.id, targetIds);
  showForwardDialog.value = false;
}

function onCancelReplyEdit() {
  emit('cancel-reply-edit');
  if (props.editingMessage) inputText.value = '';
}

// ── Template quick-insert ───────────────────────────────────────────────────
const showTemplatePopup = ref(false);
const templateQuery = ref('');
const templates = ref<TemplateItem[]>([]);

async function loadTemplates() {
  try {
    const res = await api.get<{ templates: TemplateItem[] }>('/automation/templates');
    templates.value = res.data.templates;
  } catch { /* non-critical */ }
}
onMounted(() => { loadTemplates(); });

function onTypingEvent() {
  emit('typing');
  const value = inputText.value;
  if (value === '/' || /\s\/$/.test(value)) {
    showTemplatePopup.value = true;
    templateQuery.value = '';
  } else if (showTemplatePopup.value) {
    const lastSlash = value.lastIndexOf('/');
    if (lastSlash === -1) showTemplatePopup.value = false;
    else templateQuery.value = value.slice(lastSlash + 1);
  }
}

function openTemplatePopup() {
  showTemplatePopup.value = true;
  templateQuery.value = '';
}

function onTemplateSelect(rendered: string) {
  const lastSlash = inputText.value.lastIndexOf('/');
  inputText.value = lastSlash >= 0 ? inputText.value.slice(0, lastSlash) + rendered : rendered;
  showTemplatePopup.value = false;
  templateQuery.value = '';
}

// ── Send ────────────────────────────────────────────────────────────────────
function handleSend() {
  if (showTemplatePopup.value) { showTemplatePopup.value = false; return; }
  if (!inputText.value.trim()) return;
  if (props.editingMessage) {
    emit('edit-message', props.editingMessage.id, inputText.value);
  } else {
    emit('send', inputText.value, props.replyingTo?.id ?? null);
  }
  inputText.value = '';
  editorRef.value?.clear();
  emit('cancel-reply-edit');
}

function applySuggestion(text?: string) {
  const t = text || props.aiSuggestion;
  if (!t) return;
  inputText.value = t;
  toast.success('Đã chèn vào ô chat');
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatMessageTime(d: string) {
  return new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function getImageUrl(msg: Message): string | null {
  if (msg.contentType === 'image' && msg.content) {
    if (msg.content.startsWith('http')) return msg.content;
    try { const p = JSON.parse(msg.content); return p.href || p.thumb || p.hdUrl || null; } catch {}
  }
  if (msg.content?.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      const href = p.href || p.thumb || '';
      if (href && /\.(jpg|jpeg|png|webp|gif)/i.test(href)) return href;
      if (href && href.includes('zdn.vn') && !p.params?.includes('fileExt')) return href;
    } catch {}
  }
  return null;
}

watch(() => props.messages.length, async () => {
  await nextTick();
  if (messagesContainer.value) messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
});
</script>

<style scoped>
.message-thread {
  display: flex; flex-direction: column;
  height: 100%;
  background: var(--smax-grey-100);
  overflow: hidden;
}

.empty-state {
  display: flex; flex: 1;
  align-items: center; justify-content: center;
  flex-direction: column;
  color: var(--smax-grey-700);
}

/* ════════ Chat header ════════ */
.chat-header {
  background: var(--smax-bg);
  padding: 11px 17px;
  border-bottom: 1px solid var(--smax-grey-200);
  display: flex; align-items: center; gap: 13px;
  flex-shrink: 0;
}
.ch-avatar-wrap { position: relative; }
.ch-avatar {
  width: 44px; height: 44px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ff7043, #bf360c);
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 600; font-size: 16px;
}
.gender-badge {
  position: absolute; bottom: -2px; right: -4px;
  width: 19px; height: 19px;
  border-radius: 50%;
  border: 2.5px solid var(--smax-bg);
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 700; font-size: 10px;
}
.gender-female { background: var(--smax-female); }
.gender-male   { background: var(--smax-male); }

.ch-info { flex: 1; min-width: 0; }
.ch-name-row {
  display: flex; align-items: center; gap: 7px;
  flex-wrap: wrap;
}
.ch-name { font-weight: 600; font-size: 16px; color: var(--smax-text); }
.status-pill {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 7px; border-radius: 9px;
  font-size: 10px; font-weight: 500;
}
.pill-success { background: rgba(0,200,83,0.12); color: #00897b; }
.ch-meta {
  font-size: 12px; color: var(--smax-grey-700);
  margin-top: 3px;
  display: flex; align-items: center; gap: 5px;
  flex-wrap: wrap;
}
.ch-meta .dot { color: var(--smax-grey-300); }
.ch-meta .from-nick { font-style: italic; }

.ch-actions { display: flex; gap: 5px; align-items: center; }
.btn-action {
  padding: 6px 11px;
  border-radius: 7px;
  border: 1px solid;
  cursor: pointer;
  font-size: 12px; font-weight: 500;
  display: inline-flex; align-items: center; gap: 5px;
  background: var(--smax-bg);
  font-family: inherit;
}
.btn-friend-already {
  background: rgba(0,200,83,0.08);
  color: #00897b;
  border-color: rgba(0,200,83,0.25);
}
.btn-webhook {
  background: var(--smax-primary);
  color: white;
  border-color: var(--smax-primary);
}
.btn-webhook:hover:not(:disabled) { background: var(--smax-primary-hover); }
.btn-webhook:disabled { opacity: 0.5; cursor: not-allowed; }

.icon-btn {
  width: 33px; height: 33px;
  border-radius: 7px;
  background: transparent; border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  color: var(--smax-grey-700);
  font-size: 15px;
}
.icon-btn:hover { background: var(--smax-grey-100); }
.icon-btn.on {
  background: var(--smax-primary-soft);
  color: var(--smax-primary);
}

/* ════════ Messages ════════ */
.messages {
  flex: 1; overflow-y: auto;
  padding: 14px 26px;
  display: flex; flex-direction: column; gap: 5px;
}
.msg-divider {
  text-align: center; margin: 13px 0 9px;
  color: var(--smax-grey-700); font-size: 11px;
}
.msg-divider::before,
.msg-divider::after {
  content: ''; display: inline-block;
  width: 60px; height: 1px;
  background: var(--smax-grey-300);
  vertical-align: middle; margin: 0 9px;
}

.msg-album-wrap { display: flex; }
.msg-album-wrap.self { justify-content: flex-end; }
.msg-album-body { max-width: 60%; }
.album-sender {
  font-size: 11px; color: var(--smax-primary);
  font-weight: 500; margin-bottom: 3px;
}
.bubble.album {
  background: var(--smax-bg);
  border-radius: 13px;
  overflow: hidden;
  box-shadow: 0 1px 1px rgba(0,0,0,0.06);
}
.album-grid { display: grid; gap: 3px; max-width: 420px; }
.album-grid-1 { grid-template-columns: 1fr; }
.album-grid-2 { grid-template-columns: 1fr 1fr; }
.album-grid-3 { grid-template-columns: 1fr 1fr 1fr; }
.album-tile {
  width: 100%; aspect-ratio: 1/1;
  object-fit: cover; cursor: pointer;
  transition: transform 0.2s;
}
.album-tile:hover { transform: scale(1.02); }
.album-progress { font-size: 10px; padding: 5px 9px; opacity: 0.7; }
.bubble-time {
  font-size: 11px; color: var(--smax-grey-700);
  padding: 5px 9px;
  text-align: right;
}

/* ════════ Input area ════════ */
.input-area {
  background: var(--smax-bg);
  border-top: 1px solid var(--smax-grey-200);
  padding: 7px 13px 9px;
  flex-shrink: 0;
}
.input-toolbar-top {
  display: flex; align-items: center; gap: 1px;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--smax-grey-100);
  flex-wrap: wrap;
}
.icon-tool {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  color: var(--smax-grey-700);
  background: transparent; border: none;
  font-family: inherit;
}
.icon-tool:hover { background: var(--smax-grey-100); color: var(--smax-primary); }
.icon-tool.spacer-after {
  border-right: 1px solid var(--smax-grey-200);
  margin-right: 4px; padding-right: 4px;
}
.icon-tool.ai-btn { color: #9c27b0; }

.input-row {
  display: flex; align-items: flex-end; gap: 7px;
  position: relative;
}
.input-editor { flex: 1; min-width: 0; }

.send-btn {
  background: var(--smax-primary);
  color: white;
  width: 42px; height: 42px;
  border-radius: 9px; border: none;
  cursor: pointer; font-size: 18px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.send-btn:hover:not(:disabled) { background: var(--smax-primary-hover); }
.send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
