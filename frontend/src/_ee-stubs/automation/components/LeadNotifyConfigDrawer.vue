<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <v-dialog :model-value="modelValue" max-width="600" persistent scrollable @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-account-network-outline</v-icon>
        Tự động phân phối data theo nick Zalo
      </v-card-title>
      <v-card-text>
        <v-switch
          v-model="enabled"
          color="primary"
          hide-details
          label="Tự động gán số có Zalo cho nick quản lý"
          class="mb-3"
        />
        <p class="text-body-2 text-medium-emphasis mb-3">
          Mỗi lead được gán cho một tài khoản Zalo đã chọn theo vòng tròn. Việc này không thay đổi người phụ trách CRM của khách.
        </p>
        <v-alert v-if="loadError" type="error" density="compact" class="mb-3">{{ loadError }}</v-alert>
        <v-select
          v-model="selectedZaloAccountIds"
          :items="availableAccounts"
          item-title="displayName"
          item-value="id"
          label="Nick Zalo quản lý data"
          multiple
          chips
          closable-chips
          :disabled="!enabled || loading"
          :loading="loading"
          no-data-text="Chưa có nick Zalo khả dụng"
        >
          <template #item="{ props: itemProps, item }">
            <v-list-item v-bind="itemProps" :title="accountTitle(item)" :subtitle="statusLabel(item)">
              <template #prepend>
                <v-avatar size="30" color="primary" class="mr-2">
                  <v-img v-if="item.avatarUrl" :src="item.avatarUrl" />
                  <span v-else>{{ initials(item.displayName || item.phone || 'Z') }}</span>
                </v-avatar>
              </template>
            </v-list-item>
          </template>
          <template #chip="{ item, index, props: chipProps }">
            <v-chip v-bind="chipProps" :prepend-icon="item.liveStatus === 'connected' ? 'mdi-check-circle' : 'mdi-alert-circle-outline'">
              {{ accountTitle(item) }}
              <span v-if="index === 0 && selectedZaloAccountIds.length > 1" class="ml-1 text-medium-emphasis">+{{ selectedZaloAccountIds.length - 1 }}</span>
            </v-chip>
          </template>
        </v-select>
        <v-alert v-if="enabled && selectedZaloAccountIds.some((id) => disconnectedIds.has(id))" type="warning" density="compact" class="mt-3">
          Một số nick đang ngắt kết nối. Lead vẫn được ghi nhận cho đúng nick, nhưng nick cần kết nối lại trước khi xử lý Zalo.
        </v-alert>
        <v-switch
          v-model="notifyIndividual"
          color="primary"
          hide-details
          label="Thông báo cho người sở hữu nick Zalo"
          :disabled="!enabled"
          class="mt-3"
        />
        <v-alert v-if="enabled && !selectedZaloAccountIds.length" type="warning" density="compact" class="mt-4">
          Chọn ít nhất một nick Zalo trước khi bật phân phối tự động.
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="saving" @click="close">Hủy</v-btn>
        <v-btn color="primary" :loading="saving" :disabled="enabled && !selectedZaloAccountIds.length" @click="save">Lưu cấu hình</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '@/api';
import { useZaloAccounts, type ZaloAccount } from '@/composables/use-zalo-accounts';
import { useToast } from '@/composables/use-toast';

const props = defineProps<{ modelValue?: boolean; listId?: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void; (e: 'saved'): void }>();
const { accounts, fetchAccounts, statusText } = useZaloAccounts();
const toast = useToast();
const loading = ref(false);
const saving = ref(false);
const loadError = ref('');
const enabled = ref(false);
const selectedZaloAccountIds = ref<string[]>([]);
const notifyIndividual = ref(true);

const availableAccounts = computed(() => accounts.value.filter((account) => !(account as any).archivedAt));
const disconnectedIds = computed(() => new Set(availableAccounts.value.filter((account) => account.liveStatus !== 'connected').map((account) => account.id)));

function accountTitle(account: ZaloAccount) {
  return account.displayName || account.phone || account.zaloUid || `Nick ${account.id.slice(0, 8)}`;
}
function statusLabel(account: ZaloAccount) {
  return `${statusText(account.liveStatus || account.status)}${account.owner?.fullName ? ` · chủ nick: ${account.owner.fullName}` : ''}`;
}
function initials(value: string) {
  return value.trim().split(/\s+/).slice(-2).map((part) => part[0]).join('').toUpperCase() || 'Z';
}

async function load() {
  if (!props.listId) return;
  loading.value = true;
  loadError.value = '';
  try {
    const [config] = await Promise.all([
      api.get(`/customer-lists/${props.listId}/auto-assign`),
      fetchAccounts(),
    ]);
    enabled.value = Boolean(config.data.enabled);
    selectedZaloAccountIds.value = Array.isArray(config.data.zaloAccountIds) ? config.data.zaloAccountIds : [];
    notifyIndividual.value = config.data.notifyIndividual !== false;
  } catch (error: any) {
    loadError.value = error.response?.data?.error || 'Không tải được cấu hình phân phối';
  } finally {
    loading.value = false;
  }
}

function close() {
  emit('update:modelValue', false);
}

async function save() {
  if (!props.listId) return;
  saving.value = true;
  try {
    const response = await api.put(`/customer-lists/${props.listId}/auto-assign`, {
      enabled: enabled.value,
      zaloAccountIds: selectedZaloAccountIds.value,
      notifyIndividual: notifyIndividual.value,
    });
    emit('saved');
    close();
    const assigned = Number(response.data.assigned || 0);
    toast.success(assigned ? `Đã lưu và gán ${assigned} data đang chờ cho nick Zalo` : 'Đã lưu cấu hình nick Zalo quản lý');
  } catch (error: any) {
    toast.error(error.response?.data?.error || 'Không lưu được cấu hình phân phối nick Zalo');
  } finally {
    saving.value = false;
  }
}

watch(() => props.modelValue, (open) => { if (open) void load(); });
</script>