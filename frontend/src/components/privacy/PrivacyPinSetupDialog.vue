<!--
  PrivacyPinSetupDialog — Setup PIN lần đầu hoặc Đổi PIN.
  Phase Privacy v2 2026-05-23 — clone blockchain aesthetic của PrivacyUnlockDialog.
  Anh chốt: Setup KHÔNG cần password — chỉ nhập PIN 4 số (1 step).
  Change = 2 step (oldPin → newPin + confirm).

  Props: modelValue, mode ('setup' | 'change')
  Emits: update:modelValue, done
-->
<template>
  <v-dialog
    :model-value="modelValue"
    max-width="380"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="ps-popup">
      <div class="ps-hash-flow">
        <div class="ps-hash-line">0xa3f8c2e4b9d1f6a7c5e8b2d4a9f7c3e1b8d6f2a4c7e9b3d1f5a8c2e4b9d6f1a3</div>
        <div class="ps-hash-line">0xb7e2f9c4a6d3e8b1f5c7a2d9e4b6f8c3a5d7e1b9f4c2a8d6e3b5f7c9a4d2e8b1</div>
      </div>

      <!-- Step 1: oldPin (chỉ cho mode='change') -->
      <div v-if="mode === 'change' && step === 'old'">
        <div class="ps-emblem">
          <div class="ps-hex"><div class="ps-icon">🔄</div></div>
        </div>
        <div class="ps-title">Xác minh PIN cũ</div>
        <div class="ps-subtitle">Nhập PIN 4 số hiện tại để tiếp tục đổi PIN mới.</div>

        <div class="ps-encryption-proof">
          <div class="ps-enc-label">
            <span>SECURE HASH</span>
            <span class="ps-alg">BCRYPT-12</span>
          </div>
          <div class="ps-enc-hash">
            7f4a3c<span class="ps-blink">█</span>9e2b6d8f1a5c4e9b2d7f3a6c8e1b4d9f2a7c5e8b3d6f1a4
          </div>
        </div>

        <div class="ps-form">
          <!-- Honeypot hidden input — browser autofill chui vào field FAKE này, không vào PIN.
               Phase Privacy v2 fix 2026-05-23 bug autofill 1 ký tự cache. -->
          <input type="password" name="fake-password" autocomplete="current-password" tabindex="-1" class="ps-honeypot" />
          <input
            ref="oldPinInput"
            v-model="oldPin"
            type="password"
            class="ps-input ps-pin-input"
            placeholder="• • • •"
            maxlength="4"
            inputmode="numeric"
            pattern="[0-9]*"
            autocomplete="new-password"
            :name="`oldPin_${nameSalt}`"
            :readonly="oldPinReadonly"
            @focus="oldPinReadonly = false"
            @input="oldPin = oldPin.replace(/\D/g, '')"
            @keyup.enter="canVerifyOldPin && onVerifyOldPin()"
          />
        </div>

        <div v-if="errorMsg" class="ps-error">⚠ {{ errorMsg }}</div>

        <div class="ps-status-row">
          <span class="ps-secure-chip"><span class="ps-dot"></span>BCRYPT</span>
          <span class="ps-secure-chip"><span class="ps-dot"></span>HTTPS</span>
          <span class="ps-secure-chip"><span class="ps-dot"></span>ZERO-LOG</span>
        </div>

        <div class="ps-actions">
          <button class="ps-btn-ghost" @click="close">Huỷ</button>
          <button class="ps-btn-primary" :disabled="!canVerifyOldPin || verifying" @click="onVerifyOldPin">
            {{ verifying ? 'Đang xác minh...' : 'Tiếp tục →' }}
          </button>
        </div>
      </div>

      <!-- Step 2 (change) HOẶC Step 1 single (setup): new PIN entry -->
      <div v-else>
        <div class="ps-emblem">
          <div class="ps-hex"><div class="ps-icon">{{ mode === 'setup' ? '⚙' : '🔢' }}</div></div>
        </div>
        <div class="ps-title">
          {{ mode === 'setup' ? 'Setup PIN bảo mật' : 'Đặt PIN mới' }}
        </div>
        <div class="ps-subtitle">
          {{ mode === 'setup'
            ? 'Đặt PIN 4 chữ số để bật chế độ Riêng tư. Đừng dùng PIN dễ đoán (1234, 0000, ngày sinh).'
            : 'Đặt PIN 4 chữ số mới. Tất cả phiên đang mở sẽ bị khoá lại sau khi đổi.' }}
        </div>

        <div class="ps-encryption-proof">
          <div class="ps-enc-label">
            <span>NEW PIN HASH</span>
            <span class="ps-alg">SHA-256 + SALT</span>
          </div>
          <div class="ps-enc-hash">
            8d2f5a<span class="ps-blink">█</span>1c4e7b9f3a6d2c5e8b1a4f7d2e9c6b3a8f1d4e7c2b5a9f6d3
          </div>
        </div>

        <div class="ps-form">
          <!-- Honeypot hidden — bắt autofill cache thay vì cho chui vào PIN fields -->
          <input type="password" name="fake-newpin" autocomplete="new-password" tabindex="-1" class="ps-honeypot" />
          <input
            ref="newPinInput"
            v-model="newPin"
            type="password"
            class="ps-input ps-pin-input"
            placeholder="• • • •"
            maxlength="4"
            inputmode="numeric"
            pattern="[0-9]*"
            autocomplete="new-password"
            :name="`newPin_${nameSalt}`"
            :readonly="newPinReadonly"
            @focus="newPinReadonly = false"
            @input="newPin = newPin.replace(/\D/g, '')"
          />
          <input
            v-model="confirmPin"
            type="password"
            class="ps-input ps-pin-input"
            placeholder="• • • • (gõ lại để xác nhận)"
            maxlength="4"
            inputmode="numeric"
            pattern="[0-9]*"
            autocomplete="new-password"
            :name="`confirmPin_${nameSalt}`"
            :readonly="confirmPinReadonly"
            @focus="confirmPinReadonly = false"
            @input="confirmPin = confirmPin.replace(/\D/g, '')"
            @keyup.enter="canSavePin && onSavePin()"
          />
        </div>

        <div v-if="pinMismatch" class="ps-error">⚠ PIN xác nhận không khớp</div>
        <div v-if="weakPin" class="ps-error">⚠ PIN quá yếu (dễ đoán). Chọn PIN khác.</div>
        <div v-if="errorMsg" class="ps-error">⚠ {{ errorMsg }}</div>

        <div class="ps-status-row">
          <span class="ps-secure-chip"><span class="ps-dot"></span>SHA-256</span>
          <span class="ps-secure-chip"><span class="ps-dot"></span>SALT-RAND</span>
          <span class="ps-secure-chip"><span class="ps-dot"></span>ON-DISK</span>
        </div>

        <div class="ps-actions">
          <button
            v-if="mode === 'change'"
            class="ps-btn-ghost"
            @click="step = 'old'"
          >← Quay lại</button>
          <button v-else class="ps-btn-ghost" @click="close">Huỷ</button>
          <button class="ps-btn-primary" :disabled="!canSavePin || submitting" @click="onSavePin">
            {{ submitting ? 'Đang lưu...' : (mode === 'setup' ? '✓ Hoàn tất Setup' : '✓ Đổi PIN') }}
          </button>
        </div>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { usePrivacyStore } from '@/stores/privacy';
import { useToast } from '@/composables/use-toast';
import { api } from '@/api/index';

const props = defineProps<{
  modelValue: boolean;
  mode: 'setup' | 'change';
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'done': [];
}>();

const store = usePrivacyStore();
const toast = useToast();

// Setup mode: step luôn = 'new' (1 step only).
// Change mode: step = 'old' → 'new'.
const step = ref<'old' | 'new'>(props.mode === 'change' ? 'old' : 'new');
const oldPin = ref('');
const newPin = ref('');
const confirmPin = ref('');
const errorMsg = ref('');
const submitting = ref(false);
const verifying = ref(false);
// Random salt cho name field — chặn Chrome/Cốc Cốc autofill cache PIN cũ.
const nameSalt = ref(Date.now().toString());
// Phase Privacy v2 fix 2026-05-23: readonly trick — input bắt đầu readonly,
// chỉ remove khi user focus (Chrome KHÔNG autofill vào readonly input).
const oldPinReadonly = ref(true);
const newPinReadonly = ref(true);
const confirmPinReadonly = ref(true);

const oldPinInput = ref<HTMLInputElement | null>(null);
const newPinInput = ref<HTMLInputElement | null>(null);

watch(() => props.modelValue, async (open) => {
  if (open) {
    step.value = props.mode === 'change' ? 'old' : 'new';
    oldPin.value = '';
    newPin.value = '';
    confirmPin.value = '';
    errorMsg.value = '';
    // Reset readonly state — chặn autofill khi mở lại dialog
    oldPinReadonly.value = true;
    newPinReadonly.value = true;
    confirmPinReadonly.value = true;
    // Re-randomize name salt mỗi lần mở dialog → autofill cache invalidated
    nameSalt.value = Date.now().toString() + Math.random().toString(36).slice(2, 7);
    await nextTick();
    // DOM-level clear chống autofill cache (kể cả khi nó chui qua được)
    if (oldPinInput.value) oldPinInput.value.value = '';
    if (newPinInput.value) newPinInput.value.value = '';
    // Defer focus 100ms để browser autofill (nếu có) chui vào honeypot trước
    setTimeout(() => {
      (step.value === 'old' ? oldPinInput.value : newPinInput.value)?.focus();
    }, 100);
  }
});

watch(step, async (s) => {
  await nextTick();
  (s === 'old' ? oldPinInput.value : newPinInput.value)?.focus();
});

const canVerifyOldPin = computed(() => /^\d{4}$/.test(oldPin.value));

const pinMismatch = computed(() =>
  newPin.value.length === 4 && confirmPin.value.length === 4 && newPin.value !== confirmPin.value,
);

const WEAK_PINS = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '1234', '4321', '1212', '2121', '0123', '9876',
]);
const weakPin = computed(() =>
  newPin.value.length === 4 && WEAK_PINS.has(newPin.value),
);

const canSavePin = computed(() =>
  /^\d{4}$/.test(newPin.value)
  && newPin.value === confirmPin.value
  && !weakPin.value,
);

// Phase Privacy v2 fix 2026-05-23: verify oldPin TRƯỚC khi cho user sang step 2.
// Bug trước: step 1 cho phép pass với PIN cũ sai → user nhập newPin xong mới biết fail.
async function onVerifyOldPin() {
  if (!canVerifyOldPin.value || verifying.value) return;
  verifying.value = true;
  errorMsg.value = '';
  try {
    const { data } = await api.post<{ valid: boolean }>('/privacy/verify-pin', { pin: oldPin.value });
    if (data.valid) {
      step.value = 'new';
    } else {
      errorMsg.value = 'PIN cũ sai. Nhập lại.';
      oldPin.value = '';
      await nextTick();
      oldPinInput.value?.focus();
    }
  } catch (e: any) {
    errorMsg.value = e?.response?.data?.error || 'Verify PIN thất bại';
  } finally {
    verifying.value = false;
  }
}

async function onSavePin() {
  if (!canSavePin.value || submitting.value) return;
  submitting.value = true;
  errorMsg.value = '';
  try {
    if (props.mode === 'setup') {
      // Phase Privacy v2 2026-05-23: setup KHÔNG cần password — chỉ PIN.
      await store.setupPin(newPin.value);
      toast.success('⚙ Setup PIN thành công. Giờ bạn có thể bật Riêng tư.');
    } else {
      await store.changePin(oldPin.value, newPin.value);
      toast.success('🔄 Đổi PIN thành công. Tất cả session cũ đã revoke.');
    }
    emit('done');
    emit('update:modelValue', false);
  } catch (e: any) {
    errorMsg.value = e?.response?.data?.error || 'Lưu PIN thất bại';
    // Nếu lỗi do PIN cũ sai → quay về step 'old'
    if (props.mode === 'change' && /PIN cũ sai/i.test(errorMsg.value)) {
      step.value = 'old';
      oldPin.value = '';
    }
  } finally {
    submitting.value = false;
  }
}

function close() {
  emit('update:modelValue', false);
}
</script>

<style scoped>
.ps-popup {
  background: #fff;
  border-radius: 14px;
  padding: 22px 20px 18px;
  position: relative;
  overflow: hidden;
  font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif;
}
.ps-popup::before {
  content: '';
  position: absolute; inset: 0;
  background:
    radial-gradient(circle at 30% 15%, rgba(30, 64, 175, 0.05), transparent 50%),
    radial-gradient(circle at 70% 85%, rgba(59, 130, 246, 0.04), transparent 50%);
  pointer-events: none;
}

.ps-hash-flow { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.ps-hash-line {
  position: absolute;
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  color: rgba(30, 64, 175, 0.09);
  white-space: nowrap;
  animation: ps-scroll 25s linear infinite;
}
.ps-hash-line:nth-child(1) { top: 6%; animation-delay: 0s; }
.ps-hash-line:nth-child(2) { top: 92%; animation-delay: -12s; }
@keyframes ps-scroll { from { transform: translateX(100%); } to { transform: translateX(-100%); } }

.ps-emblem {
  width: 72px; height: 72px; margin: 4px auto 12px;
  position: relative; z-index: 2;
}
.ps-hex {
  width: 100%; height: 100%;
  background: linear-gradient(135deg, #1e40af, #0f172a);
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
  display: flex; align-items: center; justify-content: center;
  position: relative;
  box-shadow: 0 8px 24px rgba(30, 64, 175, 0.25);
}
.ps-hex::before {
  content: ''; position: absolute; inset: 3px;
  background: linear-gradient(135deg, #fff, #eff6ff);
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
}
.ps-icon {
  font-size: 28px; position: relative; z-index: 2;
  filter: drop-shadow(0 2px 5px rgba(30, 64, 175, 0.3));
}
.ps-emblem::before {
  content: ''; position: absolute; inset: -6px; border-radius: 50%;
  background: conic-gradient(from 0deg, transparent, #3b82f6, transparent, #1e40af, transparent);
  animation: ps-glow 5s linear infinite;
  filter: blur(8px); opacity: 0.4; z-index: 1;
}
@keyframes ps-glow { to { transform: rotate(360deg); } }

.ps-title {
  text-align: center; font-size: 15px; font-weight: 700;
  color: #0f172a; margin-bottom: 4px;
  position: relative; z-index: 2;
}
.ps-subtitle {
  text-align: center; font-size: 12px; color: #475569;
  margin-bottom: 16px; line-height: 1.5; max-width: 300px;
  margin-left: auto; margin-right: auto;
  position: relative; z-index: 2;
}

.ps-encryption-proof {
  background: #eff6ff; border: 1px solid #dbeafe;
  border-radius: 8px; padding: 9px 12px;
  margin: 0 auto 14px; max-width: 280px;
  position: relative; z-index: 2;
}
.ps-enc-label {
  font-size: 9px; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.5px;
  margin-bottom: 5px; display: flex;
  justify-content: space-between; align-items: center;
  font-weight: 700;
}
.ps-enc-label .ps-alg {
  background: #1e40af; color: white; padding: 2px 6px;
  border-radius: 3px; font-weight: 700; letter-spacing: 0.5px;
}
.ps-enc-hash {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9.5px; color: #1e40af;
  word-break: break-all; line-height: 1.5;
}
.ps-enc-hash .ps-blink { animation: ps-blink 1s infinite; color: #3b82f6; }
@keyframes ps-blink { 50% { opacity: 0.3; } }

.ps-form {
  position: relative; z-index: 2;
  display: flex; flex-direction: column; gap: 8px;
  margin-bottom: 14px;
}
/* Honeypot hidden input — bắt browser autofill cache password cũ chui vào field FAKE
   thay vì chui vào ô PIN thật. KHÔNG dùng display:none vì browser skip autofill cho
   hidden field. Dùng absolute + opacity 0 + size 1px để invisible nhưng vẫn "tồn tại". */
.ps-honeypot {
  position: absolute !important;
  top: -9999px !important;
  left: -9999px !important;
  width: 1px !important;
  height: 1px !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
.ps-input {
  width: 100%; padding: 11px 14px;
  border: 1.5px solid #E4E5E9; border-radius: 8px;
  font-size: 13px; font-family: inherit;
  background: white;
}
.ps-input:focus { outline: none; border-color: #5E6AD2; box-shadow: 0 0 0 3px rgba(94,106,210,0.12); }
.ps-input.ps-pin-input {
  font-size: 22px; letter-spacing: 14px;
  text-align: center; font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  padding: 13px 14px;
}
/* Phase Privacy v2 fix 2026-05-23: placeholder reset letter-spacing để text "Xác nhận PIN"
   hiển thị bình thường, không stretch. Khi user gõ vào, ::value (digit) sẽ lấy lại
   letter-spacing 14px từ rule trên. */
.ps-input.ps-pin-input::placeholder {
  letter-spacing: normal !important;
  font-size: 13px;
  font-weight: 400;
  font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif;
}

.ps-status-row {
  display: flex; justify-content: center; gap: 12px;
  margin-bottom: 14px;
  position: relative; z-index: 2;
}
.ps-secure-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 9px; color: #94a3b8;
  font-family: 'JetBrains Mono', monospace;
}
.ps-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #059669; box-shadow: 0 0 4px #059669;
  animation: ps-pulse 1.5s ease-in-out infinite;
}
@keyframes ps-pulse { 50% { opacity: 0.4; } }

.ps-error {
  background: #FEF2F2; border: 1px solid #FCA5A5;
  color: #B91C1C; padding: 8px 12px; border-radius: 6px;
  font-size: 12px; font-weight: 600;
  margin-bottom: 10px; text-align: center;
  position: relative; z-index: 2;
}

.ps-actions {
  display: flex; gap: 8px; justify-content: flex-end;
  position: relative; z-index: 2;
}
.ps-btn-ghost {
  background: white; border: 1px solid #E4E5E9; color: #374151;
  padding: 9px 18px; border-radius: 7px;
  cursor: pointer; font-weight: 600; font-size: 13px;
  font-family: inherit;
}
.ps-btn-ghost:hover { background: #F9FAFB; }
.ps-btn-primary {
  background: linear-gradient(135deg, #1e40af, #0f172a);
  color: white; border: 0; padding: 9px 20px;
  border-radius: 7px; cursor: pointer;
  font-weight: 700; font-size: 13px; font-family: inherit;
  white-space: nowrap;
}
.ps-btn-primary:hover:not(:disabled) {
  background: linear-gradient(135deg, #0f172a, #0a1020);
  box-shadow: 0 6px 20px rgba(30, 64, 175, 0.35);
}
.ps-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
