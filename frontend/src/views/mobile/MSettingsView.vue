<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="mst-wrap">
    <header class="mst-head">
      <button class="m-iconbtn mst-back" aria-label="Quay lại" @click="router.push({ name: 'M.Conversations' })">
        <ChevronLeftIcon :size="26" :stroke-width="2.2" />
      </button>
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
          <br />Trên <b>iPhone</b>: mở Safari -> Chia sẻ -> <b>Thêm vào màn hình chính</b>, rồi mở app từ đó.
          <br />Ngoài ra cần truy cập qua <b>HTTPS</b> (hoặc localhost).
        </div>

        <template v-else>
          <label class="mst-row">
            <span>
              Nhận thông báo tin nhắn mới
              <small v-if="push.permission.value === 'denied'">Bạn đã chặn quyền - mở Cài đặt trình duyệt để bật lại</small>
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
import { ChevronLeft as ChevronLeftIcon } from 'lucide-vue-next';
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
.mst-wrap { display: flex; flex-direction: column; height: 100%; background: var(--m-bg); }
.mst-head { flex-shrink: 0; display: flex; align-items: center; gap: var(--m-sp-1); padding: 0 var(--m-sp-2); padding-top: env(safe-area-inset-top, 0px); min-height: calc(var(--m-header-h) + env(safe-area-inset-top, 0px)); background: var(--m-surface); border-bottom: 1px solid var(--m-border); }
.mst-head h1 { font-size: var(--m-fs-lg); font-weight: var(--m-fw-bold); color: var(--m-text); margin: 0; }
.mst-back { color: var(--m-brand); }
.mst-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; touch-action: pan-y; -webkit-overflow-scrolling: touch; padding: var(--m-sp-4); padding-bottom: calc(var(--m-sp-4) + env(safe-area-inset-bottom, 0px)); }
.mst-user { display: flex; align-items: center; gap: var(--m-sp-3); background: var(--m-surface); border-radius: var(--m-r-lg); padding: var(--m-sp-4); box-shadow: var(--m-e1); }
.mst-avatar { width: 52px; height: 52px; border-radius: var(--m-r-full); background: linear-gradient(135deg, #8fb7ff, #1f6fd6); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 21px; font-weight: var(--m-fw-bold); }
.mst-name { font-weight: var(--m-fw-bold); color: var(--m-text); }
.mst-email { font-size: var(--m-fs-xs); color: var(--m-text-2); }
.mst-group { margin-top: var(--m-sp-4); background: var(--m-surface); border-radius: var(--m-r-lg); padding: 4px var(--m-sp-4) var(--m-sp-2); box-shadow: var(--m-e1); }
.mst-group h2 { font-size: var(--m-fs-xs); font-weight: var(--m-fw-semibold); text-transform: uppercase; letter-spacing: .04em; color: var(--m-text-3); margin: var(--m-sp-3) 0 6px; }
.mst-row { display: flex; align-items: center; justify-content: space-between; gap: var(--m-sp-3); min-height: var(--m-touch); padding: 10px 0; border-top: 1px solid var(--m-border); font-size: var(--m-fs-md); color: var(--m-text); }
.mst-row small { display: block; font-size: var(--m-fs-2xs); color: var(--m-warning); margin-top: 2px; }
.mst-row input { width: 22px; height: 22px; accent-color: var(--m-brand); }
.mst-note { font-size: var(--m-fs-sm); line-height: 1.6; color: var(--m-text-2); background: var(--m-info-soft); border-radius: var(--m-r-md); padding: var(--m-sp-3); margin: var(--m-sp-2) 0; }
.mst-link { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 0; min-height: var(--m-touch); font-size: var(--m-fs-md); color: var(--m-text); border-top: 1px solid var(--m-border); }
.mst-link.danger { color: var(--m-danger); font-weight: var(--m-fw-semibold); }
.mst-msg { margin-top: var(--m-sp-4); text-align: center; font-size: var(--m-fs-sm); color: var(--m-text-2); }
</style>
