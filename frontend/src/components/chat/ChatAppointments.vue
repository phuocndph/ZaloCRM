<template>
  <div class="chat-appointments">
    <v-divider class="my-3" />
    <div class="d-flex align-center mb-2">
      <v-icon size="16" color="warning" class="mr-1">mdi-calendar-clock</v-icon>
      <span class="text-caption font-weight-bold">Lịch hẹn ({{ appointments.length }})</span>
      <v-spacer />
      <v-btn
        size="x-small"
        :variant="showForm ? 'flat' : 'tonal'"
        color="primary"
        rounded
        @click="showForm = !showForm"
      >
        <v-icon size="14" class="mr-1">{{ showForm ? 'mdi-close' : 'mdi-plus' }}</v-icon>
        {{ showForm ? 'Đóng' : 'Tạo' }}
      </v-btn>
    </div>

    <!-- Quick create form — date picker visual + time slot picker -->
    <div v-if="showForm" class="apt-form">
      <!-- Quick preset chips: 1-click cho 90% case -->
      <div class="apt-form-label">Nhanh:</div>
      <div class="d-flex flex-wrap gap-1 mb-3">
        <v-chip
          v-for="preset in quickPresets"
          :key="preset.label"
          size="small"
          :variant="isPresetActive(preset) ? 'flat' : 'outlined'"
          :color="isPresetActive(preset) ? 'warning' : undefined"
          @click="applyPreset(preset)"
        >
          {{ preset.label }}
        </v-chip>
      </div>

      <!-- Date + Time side-by-side -->
      <div class="apt-form-label">Hoặc chọn ngày + giờ:</div>
      <div class="d-flex gap-2 mb-2">
        <!-- Date input native (browser calendar) -->
        <v-text-field
          :model-value="dateInputValue"
          label="Ngày"
          type="date"
          :min="todayStr"
          density="compact"
          variant="outlined"
          hide-details
          prepend-inner-icon="mdi-calendar"
          style="flex: 1.4;"
          @update:model-value="onDateInputChange"
        />

        <!-- Time với select 30 phút increments -->
        <v-select
          v-model="createForm.time"
          :items="timeSlots"
          label="Giờ"
          density="compact"
          variant="outlined"
          hide-details
          prepend-inner-icon="mdi-clock-outline"
          style="flex: 1;"
        />
      </div>

      <!-- Display nicely formatted preview -->
      <div v-if="createForm.date && createForm.time" class="apt-form-preview">
        📅 {{ formatDateDisplay(createForm.date) }} lúc <strong>{{ createForm.time }}</strong>
      </div>

      <v-text-field
        v-model="createForm.notes"
        label="Ghi chú (tuỳ chọn)"
        density="compact"
        variant="outlined"
        hide-details
        prepend-inner-icon="mdi-text"
        class="mb-2"
        placeholder="VD: Tư vấn căn 2PN view sông"
      />

      <v-btn
        size="small"
        color="warning"
        block
        :disabled="!createForm.date || !createForm.time"
        :loading="creating"
        @click="submitCreate"
      >
        <v-icon size="14" class="mr-1">mdi-check</v-icon>
        Tạo lịch hẹn — {{ formatDateDisplay(createForm.date) }} {{ createForm.time }}
      </v-btn>
    </div>

    <!-- Appointment list — overdue trên cùng, scheduled middle, done bottom -->
    <div
      v-for="apt in sortedAppointments"
      :key="apt.id"
      class="apt-row"
      :class="aptRowClass(apt)"
    >
      <div v-if="editingId !== apt.id">
        <!-- Row 1: source badge + status -->
        <div class="d-flex align-center mb-1">
          <v-chip
            v-if="apt.source === 'zalo'"
            size="x-small"
            color="info"
            variant="tonal"
            prepend-icon="mdi-bell-ring"
            class="mr-1"
          >
            {{ apt.emoji || '🔔' }} Zalo
          </v-chip>
          <v-chip
            v-else
            size="x-small"
            color="primary"
            variant="tonal"
            prepend-icon="mdi-pencil-outline"
            class="mr-1"
          >
            CRM
          </v-chip>
          <v-spacer />
          <v-chip
            size="x-small"
            :color="statusColor(apt.status)"
            variant="tonal"
          >
            {{ statusLabel(apt.status) }}
          </v-chip>
        </div>

        <!-- Row 2: date/time + edit -->
        <div class="d-flex align-center">
          <div class="flex-grow-1">
            <div class="apt-datetime">
              {{ formatAptDate(apt.appointmentDate) }}
              <span class="apt-time">· {{ formatAptTime(apt.appointmentDate) }}</span>
            </div>
            <div v-if="apt.notes" class="apt-notes">{{ apt.notes }}</div>
          </div>
          <v-btn icon size="x-small" variant="text" color="primary" @click="startEdit(apt)">
            <v-icon size="14">mdi-pencil</v-icon>
          </v-btn>
        </div>

        <!-- Row 3: quick action buttons (chỉ show khi status còn ở scheduled/overdue) -->
        <div v-if="canQuickAction(apt)" class="apt-quick-actions">
          <v-btn
            size="x-small"
            variant="tonal"
            color="success"
            prepend-icon="mdi-check"
            :loading="changingId === apt.id && changingTo === 'completed'"
            @click="quickChangeStatus(apt, 'completed')"
          >Hoàn thành</v-btn>
          <v-btn
            size="x-small"
            variant="tonal"
            color="error"
            prepend-icon="mdi-account-cancel-outline"
            :loading="changingId === apt.id && changingTo === 'no_show'"
            @click="quickChangeStatus(apt, 'no_show')"
          >Không đến</v-btn>
          <v-btn
            size="x-small"
            variant="text"
            color="grey"
            prepend-icon="mdi-close"
            :loading="changingId === apt.id && changingTo === 'cancelled'"
            @click="quickChangeStatus(apt, 'cancelled')"
          >Huỷ</v-btn>
        </div>

        <!-- Audit line: hiển thị ai đổi status + lúc nào -->
        <div v-if="apt.statusChangedBy && apt.status !== 'scheduled' && apt.status !== 'overdue'" class="apt-audit">
          <v-icon size="11">mdi-account-check-outline</v-icon>
          {{ apt.statusChangedBy.fullName || apt.statusChangedBy.email }}
          <span v-if="apt.statusChangedAt">· {{ formatRelativeTime(apt.statusChangedAt) }}</span>
        </div>
      </div>

      <!-- Edit mode -->
      <div v-else>
        <v-text-field
          v-model="editForm.datetime"
          label="Thời gian"
          type="datetime-local"
          density="compact"
          variant="outlined"
          hide-details
          class="mb-2"
        />
        <v-text-field
          v-model="editForm.notes"
          label="Ghi chú"
          density="compact"
          variant="outlined"
          hide-details
          class="mb-2"
        />
        <v-select
          v-model="editForm.status"
          :items="statusOptions"
          item-title="title"
          item-value="value"
          label="Trạng thái"
          density="compact"
          variant="outlined"
          hide-details
          class="mb-2"
        />
        <div class="d-flex gap-1">
          <v-btn size="small" color="warning" :loading="saving" @click="submitEdit(apt.id)">
            Lưu
          </v-btn>
          <v-btn size="small" variant="text" @click="editingId = null">Hủy</v-btn>
        </div>
      </div>
    </div>

    <div v-if="appointments.length === 0 && !showForm" class="apt-empty">
      Chưa có lịch hẹn nào
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import { api } from '@/api/index';

export interface Appointment {
  id: string;
  appointmentDate: string;
  appointmentTime: string | null;
  type: string | null;
  status: string;
  notes: string | null;
  source?: 'manual' | 'zalo';
  emoji?: string | null;
  externalRef?: string | null;
  zaloMessageId?: string | null;
  statusChangedAt?: string | null;
  statusChangedBy?: { id: string; fullName: string | null; email: string } | null;
}

const props = defineProps<{
  contactId: string;
  appointments: Appointment[];
}>();

const emit = defineEmits<{
  refresh: [];
}>();

const showForm = ref(false);
const creating = ref(false);
const saving = ref(false);
const editingId = ref<string | null>(null);
const changingId = ref<string | null>(null);
const changingTo = ref<string | null>(null);

// Form: date là Date object (cho v-date-picker), time là "HH:mm" string
const createForm = reactive({
  date: null as Date | null,
  time: '',
  notes: '',
});
const editForm = reactive({ datetime: '', notes: '', status: '' });

// Time slots cho dropdown — 30 phút increment từ 07:00 → 21:30
const timeSlots = (() => {
  const slots: string[] = [];
  for (let h = 7; h <= 21; h++) {
    slots.push(`${pad(h)}:00`);
    slots.push(`${pad(h)}:30`);
  }
  return slots;
})();

const todayStr = new Date().toISOString().split('T')[0];

// Helpers cho prefill + format
function nextRoundedHalfHour(): { date: Date; time: string } {
  const now = new Date();
  // Cộng 60-90 phút, làm tròn lên 30 phút
  const target = new Date(now.getTime() + 60 * 60 * 1000);
  const mins = target.getMinutes();
  if (mins > 30) {
    target.setHours(target.getHours() + 1);
    target.setMinutes(0, 0, 0);
  } else if (mins > 0) {
    target.setMinutes(30, 0, 0);
  }
  return {
    date: new Date(target.getFullYear(), target.getMonth(), target.getDate()),
    time: `${pad(target.getHours())}:${pad(target.getMinutes())}`,
  };
}

function formatDateDisplay(d: Date | null | string): string {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Date <-> input value "YYYY-MM-DD" (HTML5 date input)
const dateInputValue = computed<string>(() => {
  if (!createForm.date) return '';
  const d = createForm.date;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
});
function onDateInputChange(v: string | null) {
  if (!v) { createForm.date = null; return; }
  const [y, m, d] = v.split('-').map(Number);
  createForm.date = new Date(y, (m || 1) - 1, d || 1);
}

// Auto-prefill khi mở form
watch(showForm, (open) => {
  if (open && !createForm.date) {
    const def = nextRoundedHalfHour();
    createForm.date = def.date;
    createForm.time = def.time;
  }
});

const statusOptions = [
  { title: 'Đã lên lịch', value: 'scheduled' },
  { title: 'Quá hạn', value: 'overdue' },
  { title: 'Hoàn thành', value: 'completed' },
  { title: 'Huỷ', value: 'cancelled' },
  { title: 'Không đến', value: 'no_show' },
];

// Quick presets: render datetime-local string format YYYY-MM-DDTHH:mm
function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
interface Preset { label: string; date: Date; time: string }

const quickPresets = computed<Preset[]>(() => {
  const now = new Date();
  const dateOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = dateOnly(now);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 7);
  return [
    { label: 'Hôm nay 14:00', date: today, time: '14:00' },
    { label: 'Mai 09:00', date: tomorrow, time: '09:00' },
    { label: 'Mai 14:00', date: tomorrow, time: '14:00' },
    { label: 'Tuần sau 09:00', date: nextWeek, time: '09:00' },
  ];
});

function applyPreset(preset: Preset) {
  createForm.date = preset.date;
  createForm.time = preset.time;
}

function isPresetActive(preset: Preset): boolean {
  if (!createForm.date || !createForm.time) return false;
  return (
    createForm.date.getTime() === preset.date.getTime() &&
    createForm.time === preset.time
  );
}

// Compute "effective status" — bao gồm cả scheduled qua hạn nhưng cron chưa flip
// (cron chạy mỗi 30 phút → có lag, UI cần real-time hơn).
function effectiveStatus(apt: Appointment): string {
  if (apt.status === 'scheduled' && new Date(apt.appointmentDate).getTime() < Date.now()) {
    return 'overdue';
  }
  return apt.status;
}

// Thứ tự hiển thị (final):
//   1. OVERDUE (cảnh báo, border đỏ) — TOP, sắp xếp quá hạn gần nhất lên trước
//   2. SCHEDULED (chờ diễn ra, border vàng) — middle, gần đến giờ lên đầu
//   3. COMPLETED/CANCELLED/NO_SHOW (đã chốt outcome, border xám) — BOTTOM
const sortedAppointments = computed(() => {
  const overdue: Appointment[] = [];
  const scheduled: Appointment[] = [];
  const done: Appointment[] = [];
  for (const a of props.appointments) {
    const es = effectiveStatus(a);
    if (es === 'overdue') overdue.push(a);
    else if (es === 'scheduled') scheduled.push(a);
    else done.push(a); // completed | cancelled | no_show
  }
  // Overdue: quá hạn gần nhất (sát now) lên trên — dễ action
  overdue.sort((a, b) => new Date(b.appointmentDate).getTime() - new Date(a.appointmentDate).getTime());
  // Scheduled: gần đến giờ nhất lên đầu
  scheduled.sort((a, b) => new Date(a.appointmentDate).getTime() - new Date(b.appointmentDate).getTime());
  // Done: gần nhất (vừa close) lên trước
  done.sort((a, b) => {
    const ta = a.statusChangedAt ? new Date(a.statusChangedAt).getTime() : new Date(a.appointmentDate).getTime();
    const tb = b.statusChangedAt ? new Date(b.statusChangedAt).getTime() : new Date(b.appointmentDate).getTime();
    return tb - ta;
  });
  return [...overdue, ...scheduled, ...done];
});

function aptRowClass(apt: Appointment): string {
  const es = effectiveStatus(apt);
  if (es === 'overdue') return 'apt-overdue';
  if (es === 'completed' || es === 'cancelled' || es === 'no_show') return 'apt-done';
  return ''; // scheduled = default warning border
}

function statusColor(s: string): string {
  switch (s) {
    case 'scheduled': return 'blue';
    case 'overdue': return 'orange'; // cảnh báo sale cần action
    case 'completed': return 'green';
    case 'cancelled': return 'grey';
    case 'no_show': return 'red';
    default: return 'grey';
  }
}

function statusLabel(s: string): string {
  return statusOptions.find(o => o.value === s)?.title || s;
}

// Hiển thị giờ từ appointmentDate (UTC ISO) → browser local timezone tự chuyển đúng.
// Không dùng appointmentTime string vì rows cũ có thể lưu UTC sai (bug Zalo sync).
function formatAptTime(d: string): string {
  const dt = new Date(d);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

// Hiển thị ngày kiểu thân thiện: Hôm qua / Hôm nay / Ngày mai / Ngày mốt → trong list này,
// quá list (3-6 ngày) thì Thứ X (Thứ 2..CN), >6 ngày thì dd/mm/yyyy
function formatAptDate(d: string): string {
  const dt = new Date(d);
  const dateOnly = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((dateOnly.getTime() - today.getTime()) / 86400000);

  if (diffDays === -1) return 'Hôm qua';
  if (diffDays === 0) return 'Hôm nay';
  if (diffDays === 1) return 'Ngày mai';
  if (diffDays === 2) return 'Ngày mốt';

  // Trong tuần (3-6 ngày tới hoặc 2-6 ngày trước) → tên thứ
  if (diffDays >= 3 && diffDays <= 6) {
    const weekday = dt.toLocaleDateString('vi-VN', { weekday: 'long' });
    return weekday.replace(/^./, c => c.toUpperCase()); // "thứ hai" → "Thứ hai"
  }
  if (diffDays <= -2 && diffDays >= -6) {
    const weekday = dt.toLocaleDateString('vi-VN', { weekday: 'long' });
    return `${weekday.replace(/^./, c => c.toUpperCase())} tuần trước`;
  }

  // Xa hơn → full date
  return dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function startEdit(apt: Appointment) {
  editingId.value = apt.id;
  // Dùng appointmentDate (UTC ISO → browser local Date) thay vì appointmentTime string
  // — vì rows cũ có thể lưu sai timezone.
  const baseDate = apt.appointmentDate ? new Date(apt.appointmentDate) : new Date();
  editForm.datetime = toLocalInput(baseDate);
  editForm.notes = apt.notes ?? '';
  editForm.status = apt.status;
}

// Quick action: chỉ active khi status đang ở scheduled/overdue (chưa có outcome cuối)
function canQuickAction(apt: Appointment): boolean {
  return apt.status === 'scheduled' || apt.status === 'overdue';
}

async function quickChangeStatus(apt: Appointment, newStatus: 'completed' | 'cancelled' | 'no_show') {
  changingId.value = apt.id;
  changingTo.value = newStatus;
  try {
    await api.patch(`/appointments/${apt.id}/status`, { status: newStatus });
    emit('refresh');
  } catch (err) {
    console.error('Quick status change error:', err);
  } finally {
    changingId.value = null;
    changingTo.value = null;
  }
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return 'vừa xong';
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} giờ trước`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD} ngày trước`;
  return new Date(iso).toLocaleDateString('vi-VN');
}

async function submitCreate() {
  if (!createForm.date || !createForm.time || !props.contactId) return;
  creating.value = true;
  try {
    const [hh, mm] = createForm.time.split(':').map(Number);
    const dt = new Date(createForm.date);
    dt.setHours(hh || 0, mm || 0, 0, 0);
    await api.post('/appointments', {
      contactId: props.contactId,
      appointmentDate: dt.toISOString(),
      appointmentTime: createForm.time,
      type: 'follow_up',
      notes: createForm.notes || null,
    });
    showForm.value = false;
    createForm.date = null;
    createForm.time = '';
    createForm.notes = '';
    emit('refresh');
  } catch (err) {
    console.error('Create appointment error:', err);
  } finally {
    creating.value = false;
  }
}

async function submitEdit(appointmentId: string) {
  saving.value = true;
  try {
    const dt = editForm.datetime ? new Date(editForm.datetime) : null;
    await api.put(`/appointments/${appointmentId}`, {
      appointmentDate: dt ? dt.toISOString() : undefined,
      appointmentTime: dt ? `${pad(dt.getHours())}:${pad(dt.getMinutes())}` : null,
      notes: editForm.notes || null,
      status: editForm.status,
    });
    editingId.value = null;
    emit('refresh');
  } catch (err) {
    console.error('Update appointment error:', err);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.apt-form {
  background: rgba(255, 183, 77, 0.08);
  border: 1px solid rgba(255, 183, 77, 0.2);
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 10px;
}
.apt-form-label {
  font-size: 11px;
  color: #757575;
  margin-bottom: 4px;
  font-weight: 500;
}
.apt-form-preview {
  background: rgba(255, 183, 77, 0.15);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  color: #5d4037;
  margin-bottom: 8px;
  text-align: center;
}

.apt-row {
  background: rgba(255, 183, 77, 0.05);
  border: 1.5px solid rgba(255, 183, 77, 0.3);
  border-radius: 10px;
  padding: 8px 10px;
  margin-bottom: 6px;
  transition: background 0.15s ease;
}
/* Overdue: border đỏ cảnh báo, nền cam nhạt */
.apt-row.apt-overdue {
  background: rgba(255, 87, 34, 0.06);
  border-color: #ef5350;
  box-shadow: 0 0 0 1px rgba(239, 83, 80, 0.15);
}
/* Done (completed/cancelled/no_show): border xám, đẩy xuống dưới, mờ nhẹ */
.apt-row.apt-done {
  background: rgba(0, 0, 0, 0.02);
  border-color: rgba(0, 0, 0, 0.12);
  opacity: 0.7;
}
.apt-row.apt-done .apt-datetime {
  text-decoration: line-through;
  color: #9e9e9e;
}

.apt-datetime {
  font-size: 13px;
  font-weight: 600;
  color: #424242;
}
.apt-time {
  color: var(--smax-primary, #2962ff);
  font-weight: 500;
}
.apt-notes {
  font-size: 11px;
  color: #757575;
  margin-top: 2px;
  line-height: 1.4;
}

.apt-quick-actions {
  display: flex;
  gap: 4px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed rgba(0, 0, 0, 0.08);
}
.apt-quick-actions :deep(.v-btn) {
  font-size: 10px !important;
  letter-spacing: 0;
}

.apt-audit {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  font-size: 10px;
  color: #757575;
  font-style: italic;
}
.apt-audit .v-icon {
  font-size: 11px;
}

.apt-empty {
  font-size: 11px;
  color: #9e9e9e;
  text-align: center;
  padding: 14px 0;
  font-style: italic;
}
</style>
