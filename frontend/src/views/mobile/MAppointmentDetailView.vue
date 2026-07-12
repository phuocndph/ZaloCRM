<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- MAppointmentDetailView — chi tiết Lịch hẹn (/m/appointments/:id). Tái dùng GET
     /appointments/:id + PATCH /appointments/:id/status (quyền/quy tắc giữ ở backend). -->
<template>
  <div class="mad mc-scroll">
    <MPageHeader :title="loading ? 'Đang tải...' : 'Chi tiết lịch hẹn'" back @back="goBack" />

    <div class="mad-body m-scroll">
      <MState v-if="error" variant="error" :message="error" @retry="load" />

      <template v-else-if="appt">
        <section class="mad-hero">
          <div class="mad-when">
            <CalendarClockIcon :size="18" :stroke-width="2" />
            {{ (appt.appointmentTime || '').slice(0, 5) }} - {{ dateLabel }}
          </div>
          <div class="mad-title">{{ appt.emoji ? appt.emoji + ' ' : '' }}{{ appt.title || appt.type || 'Lịch hẹn' }}</div>
          <span class="m-chip" :class="`m-chip--${statusMeta.variant}`">{{ statusMeta.label }}</span>
        </section>

        <section class="mad-actions">
          <button v-if="!isDone" class="mad-act primary" :disabled="saving" @click="setStatus('completed')">
            <CheckIcon :size="20" :stroke-width="2.2" /><span>Hoàn thành</span>
          </button>
          <button v-if="appt.conversationId" class="mad-act" @click="openChat">
            <MessageCircleIcon :size="20" :stroke-width="1.9" /><span>Mở chat</span>
          </button>
          <button v-if="!isCancelled" class="mad-act danger" :disabled="saving" @click="setStatus('cancelled')">
            <XCircleIcon :size="20" :stroke-width="1.9" /><span>Hủy</span>
          </button>
        </section>

        <section class="mad-group">
          <div v-if="custName" class="mad-row"><span class="mad-k">Khách hàng</span><span class="mad-v">{{ custName }}</span></div>
          <div v-if="appt.contact?.phone" class="mad-row"><span class="mad-k">SĐT</span><a class="mad-v mad-link" :href="`tel:${appt.contact.phone}`">{{ appt.contact.phone }}</a></div>
          <div v-if="appt.location" class="mad-row"><span class="mad-k">Địa điểm</span><span class="mad-v">{{ appt.location }}</span></div>
          <div v-if="appt.assignedUser?.fullName" class="mad-row"><span class="mad-k">Phụ trách</span><span class="mad-v">{{ appt.assignedUser.fullName }}</span></div>
          <div v-if="appt.notes" class="mad-row mad-row--col"><span class="mad-k">Ghi chú</span><span class="mad-v mad-notes">{{ appt.notes }}</span></div>
        </section>
      </template>

      <div v-else-if="loading" class="mad-loading"><div class="m-skel mad-sk1" /><div class="m-skel mad-sk2" /></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CalendarClock as CalendarClockIcon, Check as CheckIcon, XCircle as XCircleIcon, MessageCircle as MessageCircleIcon } from 'lucide-vue-next';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';
import { apptStatusMeta, apptCustomerName, type MAppointment } from '@/composables/use-mobile-appointments';
import MPageHeader from '@/components/mobile/MPageHeader.vue';
import MState from '@/components/mobile/MState.vue';

const route = useRoute();
const router = useRouter();
const toast = useToast();

const appt = ref<MAppointment | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const id = computed(() => route.params.id as string);

const statusMeta = computed(() => apptStatusMeta(appt.value?.status));
const custName = computed(() => (appt.value ? apptCustomerName(appt.value) : ''));
const isDone = computed(() => ['completed', 'done'].includes((appt.value?.status || '').toLowerCase()));
const isCancelled = computed(() => ['cancelled', 'canceled'].includes((appt.value?.status || '').toLowerCase()));
const dateLabel = computed(() => {
  try { return new Date(appt.value!.appointmentDate).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }); } catch { return ''; }
});

function goBack() { router.push({ name: 'M.Appointments' }); }
function openChat() { if (appt.value?.conversationId) router.push({ name: 'M.Chat', params: { convId: appt.value.conversationId } }); }

async function load() {
  loading.value = true; error.value = null;
  try { appt.value = (await api.get(`/appointments/${id.value}`)).data; }
  catch { error.value = 'Không tải được lịch hẹn'; }
  finally { loading.value = false; }
}
async function setStatus(status: string) {
  if (saving.value || !appt.value) return;
  saving.value = true;
  try {
    await api.patch(`/appointments/${id.value}/status`, { status });
    appt.value.status = status;
    toast.push(status === 'completed' ? 'Đã đánh dấu hoàn thành' : 'Đã hủy lịch hẹn');
  } catch (e: any) {
    toast.push(e?.response?.data?.error || 'Cập nhật trạng thái thất bại');
  } finally { saving.value = false; }
}

onMounted(load);
watch(id, () => { if (id.value) void load(); });
</script>

<style scoped>
.mad { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--m-bg); }
.mad-body { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: calc(var(--m-sp-6) + env(safe-area-inset-bottom, 0px)); }
.mad-hero { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: var(--m-sp-6) var(--m-sp-4) var(--m-sp-4); background: var(--m-surface); }
.mad-when { display: inline-flex; align-items: center; gap: 6px; font-size: var(--m-fs-md); font-weight: var(--m-fw-semibold); color: var(--m-brand-strong); }
.mad-title { font-size: var(--m-fs-lg); font-weight: var(--m-fw-bold); color: var(--m-text); text-align: center; }
.mad-actions { display: flex; gap: var(--m-sp-2); padding: var(--m-sp-3) var(--m-sp-4); background: var(--m-surface); border-top: 1px solid var(--m-border); }
.mad-act { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; min-height: var(--m-touch); padding: 10px 4px; border: 0; border-radius: var(--m-r-md); background: var(--m-surface-2); color: var(--m-text-2); font-size: var(--m-fs-xs); font-weight: var(--m-fw-semibold); cursor: pointer; }
.mad-act:active { transform: scale(0.96); }
.mad-act.primary { background: var(--m-success-soft); color: var(--m-success); }
.mad-act.danger { background: var(--m-danger-soft); color: var(--m-danger); }
.mad-act:disabled { opacity: 0.5; }
.mad-group { margin-top: var(--m-sp-3); background: var(--m-surface); }
.mad-row { display: flex; justify-content: space-between; gap: var(--m-sp-4); padding: 13px var(--m-sp-4); min-height: var(--m-touch); align-items: center; }
.mad-row--col { flex-direction: column; align-items: flex-start; gap: 5px; }
.mad-row + .mad-row { box-shadow: inset 0 1px 0 var(--m-border); }
.mad-k { font-size: var(--m-fs-sm); color: var(--m-text-3); flex-shrink: 0; }
.mad-v { font-size: var(--m-fs-sm); color: var(--m-text); font-weight: var(--m-fw-medium); text-align: right; }
.mad-link { color: var(--m-brand); text-decoration: none; }
.mad-notes { text-align: left; font-weight: var(--m-fw-regular); white-space: pre-wrap; }
.mad-loading { padding: var(--m-sp-6); display: flex; flex-direction: column; gap: var(--m-sp-3); }
.mad-sk1 { height: 60px; border-radius: var(--m-r-md); } .mad-sk2 { height: 120px; border-radius: var(--m-r-md); }
</style>
