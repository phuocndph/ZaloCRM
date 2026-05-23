<template>
  <div v-if="show" class="modal-backdrop" @click.self="$emit('close')">
    <div class="modal">
      <header>
        <h3>🔒 Mở khoá chế độ Riêng tư</h3>
        <p class="muted">Nhập PIN 4 số để xem nội dung các nick chính của bạn.</p>
      </header>

      <!-- Honeypot input — bắt autofill cache thay vì cho chui vào PIN field. -->
      <input type="password" name="fake-password" autocomplete="current-password" tabindex="-1" class="honeypot-input" />

      <div v-if="!hasPin" class="setup-first">
        <p>Anh chưa setup PIN. Đặt PIN 4 số mới (KHÔNG cần password):</p>
        <input
          v-model="newPin"
          type="password"
          placeholder="PIN mới (4 chữ số)"
          maxlength="4"
          inputmode="numeric"
          pattern="[0-9]*"
          autocomplete="new-password"
          :name="`pinNew_${nameSalt}`"
          :readonly="newPinReadonly"
          @focus="newPinReadonly = false"
          @input="newPin = newPin.replace(/\D/g, '')"
        />
        <div class="actions">
          <button class="btn-ghost" @click="$emit('close')">Hủy</button>
          <button class="btn-primary" :disabled="!canSetup || submitting" @click="setupPin">
            {{ submitting ? 'Đang tạo...' : 'Setup PIN' }}
          </button>
        </div>
      </div>

      <div v-else class="unlock-form">
        <input
          ref="pinInput"
          v-model="pin"
          type="password"
          maxlength="4"
          inputmode="numeric"
          pattern="[0-9]*"
          autocomplete="new-password"
          :name="`pinUnlock_${nameSalt}`"
          :readonly="pinReadonly"
          placeholder="• • • •"
          class="pin-input"
          @focus="pinReadonly = false"
          @input="pin = pin.replace(/\D/g, '')"
          @keyup.enter="submit"
        />
        <div class="duration-picker">
          <label>Thời hạn mở:</label>
          <button
            v-for="d in DURATIONS"
            :key="d.value"
            type="button"
            :class="{ active: duration === d.value }"
            @click="duration = d.value"
          >
            {{ d.label }}
          </button>
        </div>
        <div class="actions">
          <button class="btn-ghost" @click="$emit('close')">Hủy</button>
          <button class="btn-primary" :disabled="!canSubmit || submitting" @click="submit">
            {{ submitting ? 'Đang mở...' : 'Mở khoá' }}
          </button>
        </div>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { usePrivacyStore } from '@/stores/privacy';

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{
  close: [];
  unlocked: [];
}>();

const store = usePrivacyStore();
const hasPin = computed(() => store.hasPin);

const pin = ref('');
const newPin = ref('');
const currentPwd = ref('');
// Phase Privacy v2 fix 2026-05-23: readonly trick chặn Chrome autofill cache password.
const pinReadonly = ref(true);
const newPinReadonly = ref(true);
const nameSalt = ref(Date.now().toString());
const duration = ref<5 | 15 | 480 | 720>(15);
const submitting = ref(false);
const error = ref('');
const pinInput = ref<HTMLInputElement | null>(null);

// Anh chốt 2026-05-22 v3: 4 options khớp backend DURATIONS_MIN
const DURATIONS = [
  { value: 5 as const, label: '5 phút' },
  { value: 15 as const, label: '15 phút' },
  { value: 480 as const, label: '8 giờ' },
  { value: 720 as const, label: '12 giờ' },
];

const canSubmit = computed(() => /^\d{4}$/.test(pin.value));
// Phase Privacy v2 2026-05-23: setup KHÔNG cần currentPwd — chỉ PIN 4 số.
const canSetup = computed(() => /^\d{4}$/.test(newPin.value));

watch(() => props.show, async (v) => {
  if (v) {
    error.value = '';
    pin.value = '';
    newPin.value = '';
    currentPwd.value = '';
    // Phase Privacy v2 fix 2026-05-23: reset readonly + re-randomize name → autofill cache invalidate.
    pinReadonly.value = true;
    newPinReadonly.value = true;
    nameSalt.value = Date.now().toString() + Math.random().toString(36).slice(2, 7);
    await store.fetchStatus(true);
    await nextTick();
    // DOM-level clear + delay focus 100ms để honeypot bắt autofill trước.
    if (pinInput.value) pinInput.value.value = '';
    setTimeout(() => pinInput.value?.focus(), 100);
  }
});

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  error.value = '';
  try {
    await store.unlock(pin.value, duration.value);
    emit('unlocked');
    emit('close');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Mở khoá thất bại';
  } finally {
    submitting.value = false;
  }
}

async function setupPin() {
  if (!canSetup.value) return;
  submitting.value = true;
  error.value = '';
  try {
    // Phase Privacy v2 2026-05-23: setupPin signature đổi — chỉ pass pin, không cần currentPassword
    await store.setupPin(newPin.value);
    error.value = '';
    alert('Setup PIN thành công. Giờ anh có thể mở khoá.');
    await store.fetchStatus(true);
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Setup PIN thất bại';
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999; }
.modal { background: white; padding: 28px; border-radius: 12px; min-width: 380px; max-width: 440px; position: relative; }
/* Honeypot input — bắt autofill cache thay vì để chui vào PIN field */
.honeypot-input {
  position: absolute !important;
  top: -9999px !important; left: -9999px !important;
  width: 1px !important; height: 1px !important;
  opacity: 0 !important; pointer-events: none !important;
}
/* Placeholder reset letter-spacing — chỉ digit input thật mới giãn rộng */
.pin-input::placeholder {
  letter-spacing: 6px;
  font-size: 18px;
}
.modal h3 { margin: 0 0 4px; font-size: 16px; font-weight: 700; }
.muted { color: #6B7280; font-size: 12px; margin: 0 0 18px; }
.pin-input { width: 100%; padding: 14px; font-size: 28px; letter-spacing: 18px; text-align: center; border: 2px solid #E4E5E9; border-radius: 8px; margin-bottom: 12px; font-family: monospace; }
.pin-input:focus { outline: none; border-color: #5E6AD2; }
.duration-picker { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.duration-picker label { font-size: 12px; color: #6B7280; }
.duration-picker button { background: #F4F4F7; border: 1px solid transparent; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
.duration-picker button.active { background: #EFF6FF; border-color: #5E6AD2; color: #1D4ED8; font-weight: 600; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
.btn-primary { background: #5E6AD2; color: white; border: 0; padding: 9px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost { background: white; border: 1px solid #E4E5E9; padding: 9px 16px; border-radius: 6px; cursor: pointer; }
.setup-first input { width: 100%; padding: 10px; border: 1px solid #E4E5E9; border-radius: 6px; margin-bottom: 8px; font-size: 14px; }
.setup-first p { font-size: 13px; color: #DC2626; margin: 0 0 10px; padding: 10px; background: #FEF2F2; border-radius: 6px; }
.error { color: #DC2626; font-size: 12px; margin: 12px 0 0; padding: 8px; background: #FEF2F2; border-radius: 6px; }
</style>
