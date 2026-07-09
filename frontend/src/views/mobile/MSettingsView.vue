<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="mst-wrap">
    <header class="mst-head">
      <button class="mst-back" aria-label="Quay lại" @click="router.push({ name: 'M.Conversations' })">‹</button>
      <h1>Cài đặt</h1>
    </header>

    <div class="mst-body">
      <div class="mst-user">
        <div class="mst-avatar">{{ initial }}</div>
        <div>
          <div class="mst-name">{{ auth.user?.fullName || 'Người dùng' }}</div>
          <div class="mst-email">{{ auth.user?.email }}</div>
        </div>
      </div>

      <section class="mst-group">
        <h2>Thông báo</h2>

        <div v-if="!push.supported.value" class="mst-note">
          Thiết bị này chưa hỗ trợ thông báo đẩy.
          <br />Trên <b>iPhone</b>: mở Safari → Chia sẻ → <b>Thêm vào màn hình chính</b>, rồi mở app từ đó.
          <br />Ngoài ra cần truy cập qua <b>HTTPS</b> (hoặc localhost).
        </div>

        <template v-else>
          <label class="mst-row">
            <span>
              Nhận thông báo tin nhắn mới
              <small v-if="push.permission.value === 'denied'">Bạn đã chặn quyền — mở Cài đặt trình duyệt để bật lại</small>
            </span>
            <input
              type="checkbox" :checked="push.enabled.value"
              :disabled="push.busy.value || push.permission.value === 'denied'"
              @change="toggleNoti"
            />
          </label>

          <label class="mst-row">
            <span>Âm thanh thông báo</span>
            <input type="checkbox" :checked="push.soundEnabled.value" @change="toggleSound" />
          </label>
        </template>
      </section>

      <section class="mst-group">
        <h2>Khác</h2>
        <button class="mst-link" @click="router.push('/chat')">Mở bản Desktop</button>
        <button class="mst-link danger" @click="logout">Đăng xuất</button>
      </section>

      <p v-if="msg" class="mst-msg">{{ msg }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useWebPush } from '@/composables/use-web-push';

const router = useRouter();
const auth = useAuthStore();
const push = useWebPush();
const msg = ref('');

const initial = computed(() => (auth.user?.fullName || 'U').charAt(0).toUpperCase());

async function toggleNoti() {
  msg.value = '';
  if (push.enabled.value) {
    await push.disable();
    msg.value = 'Đã tắt thông báo trên thiết bị này.';
  } else {
    const r = await push.enable();
    msg.value = r.ok ? 'Đã bật thông báo.' : (r.error ?? 'Không bật được');
  }
}
function toggleSound() { push.setSound(!push.soundEnabled.value); }

async function logout() {
  await push.disable().catch(() => {});
  await auth.logout();
  router.push('/login');
}

onMounted(() => push.refresh());
</script>

<style scoped>
.mst-wrap { display: flex; flex-direction: column; height: 100%; background: var(--smax-grey-100, #f5f6fa); }
.mst-head { flex-shrink: 0; display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: var(--smax-bg, #fff); border-bottom: 1px solid var(--smax-grey-200, #ebedf0); }
.mst-head h1 { font-size: 18px; margin: 0; }
.mst-back { border: 0; background: none; font-size: 30px; line-height: 1; padding: 0 8px 4px; color: var(--smax-primary, #1786be); }
.mst-body { flex: 1; overflow-y: auto; padding: 14px; }
.mst-user { display: flex; align-items: center; gap: 12px; background: var(--smax-bg, #fff); border-radius: 14px; padding: 14px; }
.mst-avatar { width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #90caf9, #1976d2); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700; }
.mst-name { font-weight: 700; }
.mst-email { font-size: 12.5px; color: var(--smax-grey-700, #5a6478); }
.mst-group { margin-top: 16px; background: var(--smax-bg, #fff); border-radius: 14px; padding: 6px 14px 10px; }
.mst-group h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--smax-grey-700, #5a6478); margin: 12px 0 6px; }
.mst-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: 1px solid var(--smax-grey-100, #f5f6fa); font-size: 15px; }
.mst-row small { display: block; font-size: 11.5px; color: #b45309; margin-top: 2px; }
.mst-row input { width: 22px; height: 22px; }
.mst-note { font-size: 13px; line-height: 1.6; color: var(--smax-grey-700, #5a6478); background: rgba(33,150,243,.07); border-radius: 10px; padding: 10px 12px; margin: 8px 0; }
.mst-link { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 13px 0; font-size: 15px; border-top: 1px solid var(--smax-grey-100, #f5f6fa); }
.mst-link.danger { color: #dc2626; font-weight: 600; }
.mst-msg { margin-top: 14px; text-align: center; font-size: 13px; color: var(--smax-grey-700, #5a6478); }
</style>
