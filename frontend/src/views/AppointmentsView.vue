<template>
  <div>
    <!-- Toolbar -->
    <div class="d-flex align-center mb-4 flex-wrap gap-2">
      <h1 class="text-h5 mr-4">Lịch hẹn</h1>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="showCreateDialog = true">
        Tạo lịch hẹn
      </v-btn>
    </div>

    <!-- Tabs -->
    <v-tabs v-model="activeTab" class="mb-4">
      <v-tab value="today">Hôm nay</v-tab>
      <v-tab value="upcoming">Sắp tới</v-tab>
      <v-tab value="all">Tất cả</v-tab>
    </v-tabs>

    <!-- Source filter chips — phân biệt Zalo vs Manual -->
    <div class="d-flex align-center gap-2 mb-3 flex-wrap">
      <v-chip
        :variant="filters.source === 'all' ? 'flat' : 'outlined'"
        :color="filters.source === 'all' ? 'primary' : undefined"
        @click="filters.source = 'all'; fetchAppointments()"
      >
        Tất cả
        <v-chip size="x-small" class="ml-1" variant="flat">
          {{ (sourceCounts.manual || 0) + (sourceCounts.zalo || 0) }}
        </v-chip>
      </v-chip>
      <v-chip
        :variant="filters.source === 'zalo' ? 'flat' : 'outlined'"
        :color="filters.source === 'zalo' ? 'info' : undefined"
        prepend-icon="mdi-bell-ring"
        @click="filters.source = 'zalo'; fetchAppointments()"
      >
        Zalo
        <v-chip size="x-small" class="ml-1" variant="flat">{{ sourceCounts.zalo || 0 }}</v-chip>
      </v-chip>
      <v-chip
        :variant="filters.source === 'manual' ? 'flat' : 'outlined'"
        :color="filters.source === 'manual' ? 'secondary' : undefined"
        prepend-icon="mdi-pencil-outline"
        @click="filters.source = 'manual'; fetchAppointments()"
      >
        Thủ công
        <v-chip size="x-small" class="ml-1" variant="flat">{{ sourceCounts.manual || 0 }}</v-chip>
      </v-chip>

      <!-- Status filter chỉ hiện ở tab "Tất cả" -->
      <v-select
        v-if="activeTab === 'all'"
        v-model="filters.status"
        :items="APPOINTMENT_STATUS_OPTIONS"
        item-title="text"
        item-value="value"
        label="Trạng thái"
        clearable
        style="max-width: 200px"
        hide-details
        density="compact"
        class="ml-2"
        @update:model-value="fetchAppointments()"
      />
    </div>

    <!-- Appointment table -->
    <v-data-table
      :headers="headers"
      :items="activeList"
      :loading="loading"
      item-value="id"
      hover
      @click:row="onRowClick"
    >
      <!-- Source badge -->
      <template #item.source="{ item }">
        <v-chip
          v-if="item.source === 'zalo'"
          color="info"
          size="x-small"
          variant="tonal"
          prepend-icon="mdi-bell-ring"
        >
          {{ item.emoji || '🔔' }} Zalo
        </v-chip>
        <v-chip
          v-else
          color="grey"
          size="x-small"
          variant="tonal"
          prepend-icon="mdi-pencil-outline"
        >
          Thủ công
        </v-chip>
      </template>

      <!-- Date -->
      <template #item.appointmentDate="{ item }">
        {{ formatDate(item.appointmentDate) }}
      </template>

      <!-- Time (timezone-aware từ appointmentDate, không trust appointmentTime string DB) -->
      <template #item.time="{ item }">
        {{ formatTime(item.appointmentDate) }}
      </template>

      <!-- Contact name -->
      <template #item.contact="{ item }">
        <span>{{ item.contact?.fullName ?? '—' }}</span>
        <div class="text-caption text-grey">{{ item.contact?.phone ?? '' }}</div>
      </template>

      <!-- Type -->
      <template #item.type="{ item }">
        {{ typeLabel(item.type) }}
      </template>

      <!-- Status chip + audit info -->
      <template #item.status="{ item }">
        <v-chip :color="statusChipColor(item.status)" size="small" variant="tonal">
          {{ statusLabel(item.status) }}
        </v-chip>
        <div v-if="item.statusChangedBy && item.status !== 'scheduled' && item.status !== 'overdue'" class="text-caption text-grey mt-1">
          <v-icon size="11">mdi-account-check-outline</v-icon>
          {{ item.statusChangedBy.fullName || item.statusChangedBy.email }}
          <span v-if="item.statusChangedAt"> · {{ formatRelativeTime(item.statusChangedAt) }}</span>
        </div>
      </template>

      <!-- Notes -->
      <template #item.notes="{ item }">
        <span class="text-body-2">{{ item.notes ?? '—' }}</span>
      </template>

      <!-- Quick actions: 1-click status change cho appointment chưa có outcome -->
      <template #item.actions="{ item }">
        <div class="d-flex gap-1 flex-wrap">
          <template v-if="item.status === 'scheduled' || item.status === 'overdue'">
            <v-btn
              size="x-small"
              variant="tonal"
              color="success"
              prepend-icon="mdi-check"
              title="Hoàn thành"
              @click.stop="onMarkComplete(item.id)"
            >Xong</v-btn>
            <v-btn
              size="x-small"
              variant="tonal"
              color="error"
              prepend-icon="mdi-account-cancel-outline"
              title="Khách không đến"
              @click.stop="onNoShow(item.id)"
            >Vắng</v-btn>
            <v-btn
              size="x-small"
              variant="text"
              color="grey"
              prepend-icon="mdi-close"
              title="Huỷ"
              @click.stop="onCancel(item.id)"
            >Huỷ</v-btn>
          </template>
          <v-btn
            size="x-small"
            variant="text"
            color="error"
            icon="mdi-delete"
            title="Xoá"
            @click.stop="onDelete(item.id)"
          />
        </div>
      </template>
    </v-data-table>

    <!-- Create appointment dialog -->
    <v-dialog v-model="showCreateDialog" max-width="520" persistent>
      <v-card>
        <v-card-title class="d-flex align-center">
          Tạo lịch hẹn
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" @click="showCreateDialog = false" />
        </v-card-title>
        <v-divider />
        <v-card-text>
          <v-row dense>
            <v-col cols="12">
              <v-text-field
                v-model="createForm.contactId"
                label="ID khách hàng"
                hint="Nhập ID khách hàng"
                persistent-hint
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="createForm.appointmentDate" label="Ngày hẹn" type="date" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field v-model="createForm.appointmentTime" label="Giờ hẹn" type="time" />
            </v-col>
            <v-col cols="12">
              <v-select
                v-model="createForm.type"
                :items="APPOINTMENT_TYPE_OPTIONS"
                item-title="text"
                item-value="value"
                label="Loại"
              />
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="createForm.notes" label="Ghi chú" rows="2" auto-grow />
            </v-col>
          </v-row>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showCreateDialog = false">Huỷ</v-btn>
          <v-btn color="primary" :loading="saving" @click="onCreateSave">Lưu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  useAppointments,
  APPOINTMENT_STATUS_OPTIONS,
  APPOINTMENT_TYPE_OPTIONS,
  statusChipColor,
  statusLabel,
} from '@/composables/use-appointments';
import type { Appointment } from '@/composables/use-appointments';

const router = useRouter();
const {
  appointments, todayAppointments, upcomingAppointments,
  loading, saving, filters, sourceCounts,
  fetchAppointments, fetchToday, fetchUpcoming,
  createAppointment, deleteAppointment, markComplete, cancelAppointment, markNoShow,
} = useAppointments();

const activeTab = ref<'today' | 'upcoming' | 'all'>('today');
const showCreateDialog = ref(false);

interface CreateForm {
  contactId: string;
  appointmentDate: string;
  appointmentTime: string;
  type: string;
  notes: string;
}

const createForm = ref<CreateForm>({
  contactId: '',
  appointmentDate: '',
  appointmentTime: '',
  type: 'follow_up',
  notes: '',
});

const headers = [
  { title: 'Nguồn', key: 'source', sortable: false, width: '110px' },
  { title: 'Ngày', key: 'appointmentDate', sortable: true },
  { title: 'Giờ', key: 'time', sortable: false }, // computed từ appointmentDate (timezone-aware)
  { title: 'Khách hàng', key: 'contact', sortable: false },
  { title: 'Loại', key: 'type', sortable: false },
  { title: 'Trạng thái', key: 'status', sortable: false },
  { title: 'Ghi chú', key: 'notes', sortable: false },
  { title: '', key: 'actions', sortable: false, width: '120px' },
];

// Click row Zalo → mở conversation tại message reminder gốc
function onRowClick(_event: MouseEvent, row: { item: Appointment }) {
  const item = row.item;
  if (item.source === 'zalo' && item.conversationId) {
    router.push(`/chat/${item.conversationId}`);
  }
}

const activeList = computed<Appointment[]>(() => {
  switch (activeTab.value) {
    case 'today': return todayAppointments.value;
    case 'upcoming': return upcomingAppointments.value;
    default: return appointments.value;
  }
});

function formatDate(date: string) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('vi-VN');
}

function formatTime(date: string) {
  if (!date) return '';
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function typeLabel(type: string) {
  return APPOINTMENT_TYPE_OPTIONS.find(o => o.value === type)?.text ?? type;
}

async function onMarkComplete(id: string) {
  await markComplete(id);
  refreshActive();
}

async function onCancel(id: string) {
  await cancelAppointment(id);
  refreshActive();
}

async function onNoShow(id: string) {
  await markNoShow(id);
  refreshActive();
}

async function onDelete(id: string) {
  await deleteAppointment(id);
  refreshActive();
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

async function onCreateSave() {
  const result = await createAppointment({
    contactId: createForm.value.contactId,
    appointmentDate: createForm.value.appointmentDate,
    appointmentTime: createForm.value.appointmentTime,
    type: createForm.value.type,
    notes: createForm.value.notes || null,
  } as Partial<Appointment>);
  if (result) {
    showCreateDialog.value = false;
    createForm.value = { contactId: '', appointmentDate: '', appointmentTime: '', type: 'follow_up', notes: '' };
    refreshActive();
  }
}

function refreshActive() {
  switch (activeTab.value) {
    case 'today': fetchToday(); break;
    case 'upcoming': fetchUpcoming(); break;
    default: fetchAppointments(); break;
  }
}

watch(activeTab, () => refreshActive());

onMounted(() => {
  fetchToday();
  fetchUpcoming();
  fetchAppointments(); // load để có sourceCounts cho chip badges
});
</script>
