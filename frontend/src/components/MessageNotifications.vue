<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- MessageNotifications — thẻ thông báo tin nhắn NỔI góc dưới-phải (desktop, giống Zalo).
     Dữ liệu từ use-message-notifications (socket riêng tầng layout). Bấm thẻ → mở hội thoại. -->
<template>
  <Teleport to="body">
    <div class="msg-noti-stack" role="region" aria-label="Thông báo tin nhắn">
      <TransitionGroup name="msg-noti">
        <button
          v-for="card in cards"
          :key="card.id"
          class="msg-noti-card"
          @click="openCard(card)"
        >
          <div class="msg-noti-avatar">
            <img v-if="card.avatarUrl" :src="card.avatarUrl" alt="" />
            <span v-else>{{ initial(card.name) }}</span>
          </div>
          <div class="msg-noti-body">
            <div class="msg-noti-top">
              <span class="msg-noti-name">{{ card.name }}</span>
              <span class="msg-noti-time">{{ shortTime(card.at) }}</span>
            </div>
            <div class="msg-noti-preview">{{ card.preview }}</div>
          </div>
          <span
            class="msg-noti-close"
            role="button"
            aria-label="Đóng"
            @click.stop="dismiss(card.id)"
          >✕</span>
        </button>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useMessageNotifications } from '@/composables/use-message-notifications';

const { cards, dismiss, openCard } = useMessageNotifications();

function initial(name: string): string {
  const c = (name || '').trim().charAt(0);
  return c ? c.toUpperCase() : '?';
}
function shortTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}
</script>

<style scoped>
.msg-noti-stack {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 360px;
  width: calc(100vw - 36px);
  pointer-events: none;
}
.msg-noti-card {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  padding: 12px 14px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.18);
  cursor: pointer;
  transition: transform 0.14s ease, box-shadow 0.14s ease;
}
.msg-noti-card:hover { transform: translateY(-2px); box-shadow: 0 12px 34px rgba(15, 23, 42, 0.24); }
.msg-noti-card:active { transform: translateY(0); }

.msg-noti-avatar {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #2962ff, #1e4bd8);
  color: #fff;
  font-weight: 700;
  font-size: 18px;
}
.msg-noti-avatar img { width: 100%; height: 100%; object-fit: cover; }

.msg-noti-body { flex: 1; min-width: 0; }
.msg-noti-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.msg-noti-name {
  font-weight: 600;
  font-size: 14px;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msg-noti-time { flex-shrink: 0; font-size: 11px; color: #94a3b8; }
.msg-noti-preview {
  margin-top: 2px;
  font-size: 13px;
  color: #475569;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msg-noti-close {
  flex-shrink: 0;
  align-self: flex-start;
  font-size: 12px;
  line-height: 1;
  color: #94a3b8;
  padding: 2px 4px;
  border-radius: 6px;
}
.msg-noti-close:hover { color: #0f172a; background: rgba(0, 0, 0, 0.06); }

/* Trượt vào từ phải */
.msg-noti-enter-active, .msg-noti-leave-active { transition: all 0.28s cubic-bezier(0.22, 1, 0.36, 1); }
.msg-noti-enter-from { opacity: 0; transform: translateX(110%); }
.msg-noti-leave-to { opacity: 0; transform: translateX(110%); }
.msg-noti-leave-active { position: absolute; width: 100%; }

/* Dark mode */
@media (prefers-color-scheme: dark) {
  .msg-noti-card { background: #1e293b; border-color: rgba(255, 255, 255, 0.08); box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5); }
  .msg-noti-name { color: #f1f5f9; }
  .msg-noti-preview { color: #cbd5e1; }
  .msg-noti-close:hover { color: #f1f5f9; background: rgba(255, 255, 255, 0.1); }
}
:global([data-theme='dark']) .msg-noti-card { background: #1e293b; border-color: rgba(255, 255, 255, 0.08); box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5); }
:global([data-theme='dark']) .msg-noti-name { color: #f1f5f9; }
:global([data-theme='dark']) .msg-noti-preview { color: #cbd5e1; }
</style>
