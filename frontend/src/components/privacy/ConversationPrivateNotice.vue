<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  ConversationPrivateNotice — màn chặn cột 3 khi hội thoại ở chế độ "Chỉ mình tôi xem"
  và người xem KHÔNG phải chủ (2026-07-09).

  KHÔNG có nội dung tin nhắn nào ở đây: BE trả 403 trước khi truy vấn message (yêu cầu 5),
  nên component này chỉ hiển thị đúng một câu thông báo + danh tính người bật để đồng
  nghiệp biết hỏi ai.

  Ngoại lệ duy nhất: chủ hội thoại bị KHÓA/XÓA → Admin thấy nút gỡ cờ (yêu cầu 10). Gỡ
  KHÔNG mở nội dung ngay — chỉ trả hội thoại về bình thường, sau đó ai có quyền với nick
  mới xem được.
-->
<template>
  <div class="cpn">
    <div class="cpn-card">
      <div class="cpn-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>

      <p class="cpn-title">{{ CONVERSATION_PRIVATE_MESSAGE }}</p>

      <p v-if="ownerName" class="cpn-sub">
        Được bật bởi <strong>{{ ownerName }}</strong
        ><span v-if="enabledAtLabel"> · {{ enabledAtLabel }}</span>
      </p>
      <p v-else-if="!loading" class="cpn-sub">Chỉ người đã bật mới xem được nội dung.</p>

      <!-- Admin gỡ cờ khi chủ đã bị khóa/xóa. Không hiện cho bất kỳ ai khác. -->
      <template v-if="status?.canForceRelease">
        <p class="cpn-warn">
          Chủ hội thoại không còn hoạt động. Bạn có thể gỡ chế độ riêng tư để hội thoại trở
          lại bình thường — thao tác này được ghi vào nhật ký.
        </p>
        <button class="cpn-btn" :disabled="releasing" @click="onForceRelease">
          {{ releasing ? 'Đang gỡ…' : 'Gỡ chế độ riêng tư' }}
        </button>
      </template>

      <p v-if="error" class="cpn-error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  CONVERSATION_PRIVATE_MESSAGE,
  fetchConversationPrivacy,
  forceReleaseConversationPrivacy,
  type ConversationPrivacyStatus,
} from '@/composables/use-conversation-privacy';

const props = defineProps<{ conversationId: string }>();
const emit = defineEmits<{ released: [conversationId: string] }>();

const status = ref<ConversationPrivacyStatus | null>(null);
const loading = ref(false);
const releasing = ref(false);
const error = ref('');

const ownerName = computed(() => status.value?.privateOwnerName ?? '');

const enabledAtLabel = computed(() => {
  const at = status.value?.privateEnabledAt;
  if (!at) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('vi-VN');
});

async function load(convId: string) {
  loading.value = true;
  error.value = '';
  status.value = null;
  try {
    const res = await fetchConversationPrivacy(convId);
    // Đổi hội thoại giữa chừng → bỏ kết quả cũ.
    if (props.conversationId === convId) status.value = res;
  } catch {
    // Không lộ chi tiết lỗi — câu thông báo mặc định đã đủ (yêu cầu 4).
    if (props.conversationId === convId) status.value = null;
  } finally {
    if (props.conversationId === convId) loading.value = false;
  }
}

async function onForceRelease() {
  if (releasing.value) return;
  const who = ownerName.value ? ` của ${ownerName.value}` : '';
  if (!window.confirm(`Gỡ chế độ riêng tư${who}? Thao tác được ghi vào nhật ký hoạt động.`)) return;
  releasing.value = true;
  error.value = '';
  try {
    await forceReleaseConversationPrivacy(props.conversationId);
    emit('released', props.conversationId);
  } catch (err: any) {
    error.value = err?.response?.data?.error ?? 'Không gỡ được, thử lại sau.';
  } finally {
    releasing.value = false;
  }
}

watch(() => props.conversationId, (id) => { if (id) void load(id); }, { immediate: true });
</script>

<style scoped>
.cpn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.cpn-card {
  max-width: 380px;
  text-align: center;
}
.cpn-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 14px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgb(var(--v-theme-primary));
}
.cpn-icon svg { width: 26px; height: 26px; }
.cpn-title {
  font-size: 15px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.82);
  margin: 0 0 6px;
}
.cpn-sub {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.55);
  margin: 0;
  line-height: 1.5;
}
.cpn-warn {
  margin: 16px 0 10px;
  font-size: 12.5px;
  line-height: 1.5;
  color: #8a6100;
  background: #fff8e1;
  border: 1px solid #ffe1a8;
  border-radius: 8px;
  padding: 10px 12px;
  text-align: left;
}
.cpn-btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.cpn-btn:hover:not(:disabled) { background: rgba(0, 0, 0, 0.04); }
.cpn-btn:disabled { opacity: 0.6; cursor: default; }
.cpn-error {
  margin-top: 10px;
  font-size: 12.5px;
  color: #c62828;
}
</style>
