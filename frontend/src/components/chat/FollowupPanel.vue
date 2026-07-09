<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- Follow-up Workflow (CE) — panel trong tab Follow-up cột 4: trạng thái + timeline
     của KH đang mở, cho phép đưa KH vào workflow / dừng / hoàn thành việc Sale. -->
<template>
  <div class="fup">
    <div v-if="loading" class="fup-loading"><v-progress-circular indeterminate size="22" color="primary" /></div>

    <!-- Chưa trong workflow nào → cho enroll -->
    <template v-else-if="!enrollment">
      <div class="fup-empty">
        <v-icon size="30" color="grey-lighten-1">mdi-timeline-clock-outline</v-icon>
        <p class="fup-empty-txt">Khách chưa nằm trong workflow nào.</p>

        <!-- Không có workflow ACTIVE → nói rõ lý do thay vì để ô chọn trống. -->
        <template v-if="!activeWfs.length">
          <div class="fup-hint">
            Chưa có workflow nào được <b>Kích hoạt</b>.<br />
            Vào <b>Marketing → Follow-up</b>, mở 1 workflow rồi bấm <b>Kích hoạt</b>.
          </div>
          <v-btn color="primary" variant="tonal" size="small" block class="mt-2" :to="{ name: 'CE.Followup' }">
            Mở trang Follow-up
          </v-btn>
        </template>

        <template v-else>
          <v-select
            v-model="pickWf" :items="wfOptions" density="compact" variant="outlined" hide-details
            label="Chọn workflow" class="fup-pick"
          />
          <v-btn color="primary" size="small" block class="mt-2" :disabled="!pickWf" :loading="enrolling" @click="enroll(false)">
            Đưa vào workflow
          </v-btn>
        </template>
      </div>
    </template>

    <!-- Đang có enrollment -->
    <template v-else>
      <div class="fup-card">
        <div class="fup-card-head">
          <div class="fup-wf-name">{{ workflow?.name || 'Workflow' }}</div>
          <span class="fup-status" :class="'en-' + enrollment.status">{{ enrollStatusLabel(enrollment.status) }}</span>
        </div>
        <div class="fup-meta">
          <span>Đã gửi {{ enrollment.messagesSent }}<template v-if="workflow?.maxMessages">/{{ workflow.maxMessages }}</template> tin</span>
          <span v-if="enrollment.nextRunAt && isActive"> · Bước kế: {{ fmtWhen(enrollment.nextRunAt) }}</span>
        </div>
        <div v-if="enrollment.status === 'waiting_sale'" class="fup-task">
          <v-icon size="16" color="deep-orange">mdi-account-clock-outline</v-icon>
          <span>{{ enrollment.saleTaskTitle || 'Chờ Sale xử lý' }}</span>
          <v-btn size="x-small" color="primary" variant="tonal" @click="completeTask">Hoàn thành</v-btn>
        </div>
        <div class="fup-actions">
          <v-btn v-if="isActive" size="x-small" color="error" variant="text" @click="stop">Dừng workflow</v-btn>
          <v-btn v-else size="x-small" color="primary" variant="text" @click="showReenroll = !showReenroll">Đưa vào workflow khác</v-btn>
        </div>
        <div v-if="showReenroll && !isActive" class="fup-reenroll">
          <v-select v-model="pickWf" :items="wfOptions" density="compact" variant="outlined" hide-details label="Chọn workflow" />
          <v-btn color="primary" size="x-small" block class="mt-2" :disabled="!pickWf" :loading="enrolling" @click="enroll(false)">Bắt đầu</v-btn>
        </div>
      </div>

      <!-- Timeline -->
      <div class="fup-timeline">
        <div class="fup-tl-title">Timeline</div>
        <div v-for="t in timeline" :key="t.id" class="fup-tl-item" :class="'ev-' + t.eventType">
          <span class="fup-tl-dot" />
          <div class="fup-tl-body">
            <div class="fup-tl-msg">{{ t.message }}</div>
            <div class="fup-tl-when">{{ fmtWhen(t.createdAt) }}<span v-if="t.actorName"> · {{ t.actorName }}</span></div>
          </div>
        </div>
        <div v-if="!timeline.length" class="fup-tl-empty">Chưa có hoạt động.</div>
      </div>
    </template>

    <!-- Conflict dialog: KH đang ở workflow khác -->
    <v-dialog v-model="conflictOpen" max-width="420">
      <v-card>
        <v-card-title class="text-body-1">Khách đang trong workflow khác</v-card-title>
        <v-card-text>Khách đang tham gia "<b>{{ conflictName }}</b>". Chuyển sang workflow mới sẽ dừng workflow hiện tại.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="conflictOpen = false">Giữ nguyên</v-btn>
          <v-btn color="primary" :loading="enrolling" @click="enroll(true)">Chuyển</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';

const props = defineProps<{ contactId: string; zaloAccountId: string | null }>();
const toast = useToast();

const loading = ref(true);
const enrollment = ref<any>(null);
const workflow = ref<any>(null);
const timeline = ref<any[]>([]);
const activeWfs = ref<Array<{ id: string; name: string }>>([]);
const pickWf = ref<string | null>(null);
const enrolling = ref(false);
const showReenroll = ref(false);
const conflictOpen = ref(false);
const conflictName = ref('');

const wfOptions = computed(() => activeWfs.value.map((w) => ({ title: w.name, value: w.id })));
const isActive = computed(() => ['running', 'waiting', 'waiting_sale'].includes(enrollment.value?.status));

const EN: Record<string, string> = { running: 'Đang chạy', waiting: 'Đang chờ', waiting_sale: 'Chờ Sale', completed: 'Hoàn thành', stopped: 'Đã dừng', goal_reached: 'Đạt Goal' };
function enrollStatusLabel(s: string) { return EN[s] ?? s; }
function fmtWhen(iso: string) {
  const d = new Date(iso); const now = new Date();
  const hhmm = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return `Hôm nay ${hhmm}`;
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${hhmm}`;
}

async function load() {
  if (!props.contactId) { loading.value = false; return; }
  loading.value = true;
  try {
    const [res, act] = await Promise.all([
      api.get(`/followup/contacts/${props.contactId}`),
      api.get('/followup/active').catch(() => ({ data: { workflows: [] } })),
    ]);
    enrollment.value = res.data.enrollment;
    workflow.value = res.data.workflow;
    timeline.value = res.data.timeline ?? [];
    activeWfs.value = act.data.workflows ?? [];
  } catch {
    /* im lặng — tab phụ */
  } finally {
    loading.value = false;
  }
}

async function enroll(force: boolean) {
  if (!pickWf.value || !props.zaloAccountId) {
    if (!props.zaloAccountId) toast.warning('Chưa xác định nick Zalo để gửi');
    return;
  }
  enrolling.value = true;
  try {
    await api.post('/followup/enroll', {
      workflowId: pickWf.value, contactId: props.contactId, zaloAccountId: props.zaloAccountId,
      onConflict: force ? 'switch' : undefined,
    });
    conflictOpen.value = false; showReenroll.value = false; pickWf.value = null;
    toast.success('Đã đưa khách vào workflow');
    await load();
  } catch (err: any) {
    if (err?.response?.status === 409) {
      conflictName.value = err.response.data?.conflict?.workflowName ?? '';
      conflictOpen.value = true;
    } else {
      toast.error(err?.response?.data?.error || 'Không đưa vào workflow được');
    }
  } finally {
    enrolling.value = false;
  }
}

async function stop() {
  if (!enrollment.value) return;
  try { await api.post(`/followup/enrollments/${enrollment.value.id}/stop`); toast.success('Đã dừng workflow'); await load(); }
  catch { toast.error('Không dừng được'); }
}
async function completeTask() {
  if (!enrollment.value) return;
  try { await api.post(`/followup/enrollments/${enrollment.value.id}/complete-task`); toast.success('Đã tiếp tục workflow'); await load(); }
  catch { toast.error('Lỗi'); }
}

watch(() => props.contactId, () => { enrollment.value = null; load(); });
onMounted(load);
</script>

<style scoped>
.fup { padding: 12px 14px; }
.fup-loading { display: flex; justify-content: center; padding: 24px; }
.fup-empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 18px 8px; }
.fup-empty-txt { font-size: 13px; color: var(--smax-grey-700, #5a6478); margin: 8px 0 12px; }
.fup-pick { width: 100%; }
.fup-hint {
  width: 100%; font-size: 12.5px; line-height: 1.5;
  color: var(--smax-grey-700, #5a6478);
  background: rgba(33, 150, 243, .07);
  border: 1px solid rgba(33, 150, 243, .18);
  border-radius: 8px; padding: 9px 10px; text-align: left;
}
.fup-card { background: var(--smax-grey-50, #fafbfc); border: 1px solid var(--smax-grey-200, #ebedf0); border-radius: 12px; padding: 12px; }
.fup-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fup-wf-name { font-weight: 700; font-size: 14px; }
.fup-status { font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
.en-running { background: rgba(0,200,83,.14); color: #1b8a4d; } .en-waiting { background: rgba(33,150,243,.14); color: #1565c0; }
.en-waiting_sale { background: rgba(255,145,0,.14); color: #ef6c00; } .en-completed { background: #eceff1; color: #607d8b; }
.en-stopped { background: #fce4ec; color: #ad1457; } .en-goal_reached { background: rgba(103,58,183,.14); color: #5e35b1; }
.fup-meta { font-size: 12px; color: var(--smax-grey-700, #5a6478); margin-top: 6px; }
.fup-task { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding: 8px; background: rgba(255,145,0,.08); border-radius: 8px; font-size: 12.5px; }
.fup-task span { flex: 1; }
.fup-actions { margin-top: 8px; }
.fup-reenroll { margin-top: 8px; }
.fup-timeline { margin-top: 16px; }
.fup-tl-title { font-size: 12px; font-weight: 700; color: var(--smax-grey-700); margin-bottom: 8px; }
.fup-tl-item { display: flex; gap: 8px; padding-bottom: 12px; position: relative; }
.fup-tl-item:not(:last-child) .fup-tl-dot::after { content: ''; position: absolute; left: 3px; top: 12px; bottom: -4px; width: 2px; background: var(--smax-grey-200, #ebedf0); }
.fup-tl-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--smax-primary, #1786be); margin-top: 4px; flex-shrink: 0; position: relative; }
.fup-tl-body { flex: 1; min-width: 0; }
.fup-tl-msg { font-size: 13px; color: var(--smax-text, #212121); line-height: 1.35; }
.fup-tl-when { font-size: 11px; color: var(--smax-grey-700, #5a6478); margin-top: 1px; }
.fup-tl-empty { font-size: 12px; color: var(--smax-grey-700); text-align: center; padding: 12px; }
.ev-stopped .fup-tl-dot, .ev-message_failed .fup-tl-dot { background: #ad1457; }
.ev-goal_reached .fup-tl-dot { background: #5e35b1; }
</style>
