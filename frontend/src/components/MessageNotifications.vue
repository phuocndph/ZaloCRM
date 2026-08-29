<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- MessageNotifications — thẻ thông báo realtime dùng chung desktop/mobile. -->
<template>
  <Teleport to="body">
    <div class="msg-noti-stack" role="region" aria-label="Thông báo tin nhắn" aria-live="polite">
      <TransitionGroup name="msg-noti">
        <div v-for="card in cards" :key="card.id" class="msg-noti-card">
          <button class="msg-noti-open" type="button" @click="openCard(card)">
            <div class="msg-noti-avatar">
              <img v-if="card.avatarUrl" :src="card.avatarUrl" alt="" />
              <span v-else>{{ initial(card.name) }}</span>
            </div>
            <div class="msg-noti-body">
              <div class="msg-noti-top">
                <span class="msg-noti-name">{{ card.name }}</span>
                <span class="msg-noti-time">{{ shortTime(card.at) }}</span>
              </div>
              <div class="msg-noti-context">{{ card.context }}</div>
              <div class="msg-noti-preview">{{ card.preview }}</div>
            </div>
          </button>
          <button
            class="msg-noti-close"
            type="button"
            aria-label="Đóng"
            @click.stop="dismiss(card.id)"
          >✕</button>
        </div>
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
  width: 100%;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 28px rgba(15, 23, 42, 0.18);
  transition: transform 0.14s ease, box-shadow 0.14s ease;
  overflow: hidden;
}
.msg-noti-card:hover { transform: translateY(-2px); box-shadow: 0 12px 34px rgba(15, 23, 42, 0.24); }
.msg-noti-card:active { transform: translateY(0); }
.msg-noti-card:focus-within { outline: 3px solid rgba(37, 99, 235, 0.28); outline-offset: 2px; }
.msg-noti-open {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 8px 12px 14px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
}

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
.msg-noti-context {
  margin-top: 2px;
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msg-noti-time { flex-shrink: 0; font-size: 11px; color: #94a3b8; }
.msg-noti-preview {
  margin-top: 3px;
  font-size: 13px;
  color: #475569;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msg-noti-close {
  flex-shrink: 0;
  align-self: flex-start;
  margin: 8px 8px 0 0;
  font-size: 12px;
  line-height: 1;
  color: #94a3b8;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
  border: 0;
  background: transparent;
  cursor: pointer;
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
  .msg-noti-context { color: #94a3b8; }
  .msg-noti-preview { color: #cbd5e1; }
  .msg-noti-close:hover { color: #f1f5f9; background: rgba(255, 255, 255, 0.1); }
}
:global([data-theme='dark']) .msg-noti-card { background: #1e293b; border-color: rgba(255, 255, 255, 0.08); box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5); }
:global([data-theme='dark']) .msg-noti-name { color: #f1f5f9; }
:global([data-theme='dark']) .msg-noti-context { color: #94a3b8; }
:global([data-theme='dark']) .msg-noti-preview { color: #cbd5e1; }

@media (max-width: 700px) {
  .msg-noti-stack {
    top: calc(var(--m-header-h, 56px) + env(safe-area-inset-top, 0px) + 8px);
    right: max(10px, env(safe-area-inset-right, 0px));
    bottom: auto;
    left: max(10px, env(safe-area-inset-left, 0px));
    width: auto;
    max-width: none;
    gap: 8px;
    max-height: calc(100dvh - var(--m-header-h, 56px) - env(safe-area-inset-top, 0px) - 20px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .msg-noti-open { gap: 10px; padding: 11px 6px 11px 12px; }
  .msg-noti-card:hover { transform: none; }
  .msg-noti-avatar { width: 42px; height: 42px; }
  .msg-noti-close { width: 44px; height: 44px; margin: 1px 1px 0 0; font-size: 14px; }
}

@media (prefers-reduced-motion: reduce) {
  .msg-noti-card,
  .msg-noti-enter-active,
  .msg-noti-leave-active { transition: none; }
}
</style>
