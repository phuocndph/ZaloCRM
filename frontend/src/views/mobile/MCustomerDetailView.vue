<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- MCustomerDetailView — hồ sơ tóm tắt Khách hàng (/m/customers/:id). Tái dùng GET
     /contacts/:id (quyền backend). Bản cơ bản: tóm tắt + gọi/nhắn/ghi chú; timeline + sửa
     full-screen sẽ bổ sung ở increment kế tiếp. -->
<template>
  <div class="mcd mc-scroll">
    <MPageHeader :title="loading ? 'Đang tải...' : name" back @back="goBack" />

    <div class="mcd-body m-scroll">
      <MState v-if="error" variant="error" :message="error" @retry="load" />

      <template v-else-if="contact">
        <!-- Hồ sơ đầu -->
        <section class="mcd-hero">
          <div class="mcd-avatar" :style="avatarStyle">
            <img v-if="contact.avatarUrl" :src="contact.avatarUrl" alt="" />
            <span v-else>{{ initial }}</span>
          </div>
          <div class="mcd-name">{{ name }}</div>
          <div v-if="statusInfo" class="mcd-status" :style="statusStyle">{{ statusInfo.name }}</div>
          <div v-if="contact.phone" class="mcd-phone">{{ contact.phone }}</div>
        </section>

        <!-- Thao tác nhanh -->
        <section class="mcd-actions">
          <a v-if="contact.phone" class="mcd-act" :href="`tel:${contact.phone}`">
            <PhoneIcon :size="21" :stroke-width="1.9" /><span>Gọi</span>
          </a>
          <button class="mcd-act" :disabled="!conversationId" @click="openChat">
            <MessageCircleIcon :size="21" :stroke-width="1.9" /><span>Nhắn</span>
          </button>
        </section>

        <!-- Thông tin -->
        <section class="mcd-group">
          <div v-if="contact.assignedUser?.fullName" class="mcd-row"><span class="mcd-k">Người phụ trách</span><span class="mcd-v">{{ contact.assignedUser.fullName }}</span></div>
          <div v-if="contact.source" class="mcd-row"><span class="mcd-k">Nguồn</span><span class="mcd-v">{{ contact.source }}</span></div>
          <div v-if="contact.email" class="mcd-row"><span class="mcd-k">Email</span><span class="mcd-v">{{ contact.email }}</span></div>
          <div v-if="(contact.tags || []).length" class="mcd-row"><span class="mcd-k">Tag</span>
            <span class="mcd-v mcd-tags"><span v-for="t in contact.tags" :key="t" class="m-chip m-chip--brand">{{ t }}</span></span>
          </div>
          <div v-if="contact.nextAppointment" class="mcd-row"><span class="mcd-k">Lịch hẹn tới</span><span class="mcd-v">{{ fmtDate(contact.nextAppointment) }}</span></div>
        </section>

        <p class="mcd-note-more">Dòng thời gian hoạt động, đơn/báo giá và chỉnh sửa sẽ có ở bản kế tiếp.</p>
      </template>

      <div v-else-if="loading" class="mcd-loading">
        <div class="m-skel mcd-sk-av" />
        <div class="m-skel mcd-sk-line" />
        <div class="m-skel mcd-sk-line2" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Phone as PhoneIcon, MessageCircle as MessageCircleIcon } from 'lucide-vue-next';
import { api } from '@/api/index';
import { customerName, customerStatus, type MCustomer } from '@/composables/use-mobile-customers';
import MPageHeader from '@/components/mobile/MPageHeader.vue';
import MState from '@/components/mobile/MState.vue';

const route = useRoute();
const router = useRouter();

const contact = ref<MCustomer | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const id = computed(() => route.params.id as string);

const name = computed(() => (contact.value ? customerName(contact.value) : 'Khách hàng'));
const initial = computed(() => name.value.trim().charAt(0).toUpperCase());
const statusInfo = computed(() => (contact.value ? customerStatus(contact.value) : null));
const avatarStyle = computed(() => {
  if (!contact.value || contact.value.avatarUrl) return {};
  let h = 0; for (const ch of contact.value.id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return { background: `linear-gradient(135deg, hsl(${h} 62% 62%), hsl(${(h + 40) % 360} 58% 46%))` };
});
const statusStyle = computed(() => {
  const color = statusInfo.value?.color || '#8a95a4';
  return { color, background: color + '1f' };
});

function fmtDate(iso: string) { return new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function goBack() { router.push({ name: 'M.Customers' }); }
const conversationId = computed(() => {
  const c = contact.value as any;
  return c?.conversationId || c?.latestConversationId || c?.conversation?.id || null;
});
function openChat() { if (conversationId.value) router.push({ name: 'M.Chat', params: { convId: conversationId.value } }); }

async function load() {
  loading.value = true; error.value = null;
  try {
    const { data } = await api.get(`/contacts/${id.value}`);
    contact.value = data;
  } catch {
    error.value = 'Không tải được hồ sơ khách hàng';
  } finally { loading.value = false; }
}

onMounted(load);
watch(id, () => { if (id.value) void load(); });
</script>

<style scoped>
.mcd { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--m-bg); }
.mcd-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; touch-action: pan-y; -webkit-overflow-scrolling: touch; padding-bottom: calc(var(--m-sp-6) + env(safe-area-inset-bottom, 0px)); }

.mcd-hero { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: var(--m-sp-6) var(--m-sp-4) var(--m-sp-4); background: var(--m-surface); }
.mcd-avatar { width: 84px; height: 84px; border-radius: var(--m-r-full); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 34px; font-weight: var(--m-fw-bold); }
.mcd-avatar img { width: 100%; height: 100%; border-radius: var(--m-r-full); object-fit: cover; }
.mcd-name { font-size: var(--m-fs-xl); font-weight: var(--m-fw-bold); color: var(--m-text); text-align: center; }
.mcd-status { font-size: var(--m-fs-2xs); font-weight: var(--m-fw-semibold); padding: 3px 10px; border-radius: var(--m-r-full); }
.mcd-phone { font-size: var(--m-fs-md); color: var(--m-text-2); }

.mcd-actions { display: flex; gap: var(--m-sp-2); padding: var(--m-sp-3) var(--m-sp-4); background: var(--m-surface); border-top: 1px solid var(--m-border); }
.mcd-act {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px;
  min-height: var(--m-touch); padding: 10px 4px; border: 0; border-radius: var(--m-r-md);
  background: var(--m-surface-2); color: var(--m-brand); font-size: var(--m-fs-xs); font-weight: var(--m-fw-semibold);
  text-decoration: none; cursor: pointer;
}
.mcd-act:active { transform: scale(0.96); }
.mcd-act:disabled { opacity: .45; cursor: default; }

.mcd-group { margin-top: var(--m-sp-3); background: var(--m-surface); }
.mcd-row { display: flex; justify-content: space-between; gap: var(--m-sp-4); padding: 13px var(--m-sp-4); min-height: var(--m-touch); align-items: center; }
.mcd-row + .mcd-row { box-shadow: inset 0 1px 0 var(--m-border); }
.mcd-k { font-size: var(--m-fs-sm); color: var(--m-text-3); flex-shrink: 0; }
.mcd-v { font-size: var(--m-fs-sm); color: var(--m-text); font-weight: var(--m-fw-medium); text-align: right; overflow: hidden; text-overflow: ellipsis; }
.mcd-tags { display: flex; flex-wrap: wrap; gap: 5px; justify-content: flex-end; }
.mcd-note-more { text-align: center; font-size: var(--m-fs-xs); color: var(--m-text-3); padding: var(--m-sp-5) var(--m-sp-4); font-style: italic; }

.mcd-loading { padding: var(--m-sp-6); display: flex; flex-direction: column; align-items: center; gap: var(--m-sp-3); }
.mcd-sk-av { width: 84px; height: 84px; border-radius: var(--m-r-full); }
.mcd-sk-line { height: 18px; width: 55%; }
.mcd-sk-line2 { height: 13px; width: 40%; }
</style>
