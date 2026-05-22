<!--
  PrivacyUnlockDialog — Owner unlock UI (PIN keypad + duration picker + lockout).
  Anh chốt 2026-05-22:
   - Theme trắng + xanh sậm
   - PIN 4 chữ số, auto-check khi đủ
   - 4 duration options: 5p / 15p ⭐ / 8h / 12h
   - Lockout 5 cấp: 5s → 30s → 5p → 10p → 30p
   - Tỷ lệ popup 1:2 (rộng:cao)

  Props:
    modelValue: boolean (open state)
    nick: { displayName, avatarUrl, zaloUid } — info nick để hiện ở header

  Emits:
    update:modelValue
    unlocked — sau khi PIN đúng + chọn duration thành công
-->
<template>
  <v-dialog
    :model-value="modelValue"
    max-width="360"
    :persistent="lockoutSeconds > 0"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="pp-popup">
      <div class="pp-hash-flow">
        <div class="pp-hash-line">0xa3f8c2e4b9d1f6a7c5e8b2d4a9f7c3e1b8d6f2a4c7e9b3d1f5a8c2e4b9d6f1a3</div>
        <div class="pp-hash-line">0xb7e2f9c4a6d3e8b1f5c7a2d9e4b6f8c3a5d7e1b9f4c2a8d6e3b5f7c9a4d2e8b1</div>
      </div>

      <!-- Step 1: PIN entry -->
      <div v-if="step === 'pin'">
        <div class="pp-nick-info">
          <div class="pp-avatar-wrap">
            <div class="pp-avatar" :style="{ background: avatarColor(nick?.displayName) }">
              <img v-if="nick?.avatarUrl" :src="nick.avatarUrl" />
              <template v-else>{{ initials(nick?.displayName) }}</template>
            </div>
          </div>
          <div class="pp-nick-name">{{ nick?.displayName || 'Nick Zalo' }}</div>
          <div v-if="nick?.zaloUid" class="pp-nick-uid">UID {{ nick.zaloUid }}</div>
        </div>

        <div class="pp-lock-emblem">
          <div class="pp-lock-hex"><div class="pp-lock-icon">🔓</div></div>
        </div>

        <div class="pp-title">Nhập mã PIN để mở khoá</div>
        <div class="pp-subtitle">4 chữ số bí mật do bạn đặt khi setup Riêng tư</div>

        <!-- Lockout overlay -->
        <div v-if="lockoutSeconds > 0" class="pp-lockout">
          <div class="pp-lockout-icon">⏳</div>
          <div class="pp-lockout-title">Đã khoá — vui lòng đợi</div>
          <div class="pp-lockout-countdown">{{ formattedCountdown }}</div>
          <div class="pp-lockout-hint">Mở khoá lại trong giây lát</div>
          <div class="pp-lockout-attempts">Sai {{ wrongCount }}/5</div>
        </div>

        <!-- PIN entry area -->
        <div v-else>
          <div class="pp-pin-display">
            <div
              v-for="i in 4"
              :key="i"
              class="pp-pin-box"
              :class="{ filled: pin.length >= i, active: pin.length === i - 1, error: hasError }"
            >
              <div class="pp-pin-dot"></div>
            </div>
          </div>

          <div class="pp-error-msg" :class="{ show: hasError }">⚠ Sai mật khẩu</div>

          <div class="pp-keypad" :class="{ disabled: checking }">
            <button v-for="d in ['1','2','3','4','5','6','7','8','9']" :key="d" class="pp-key" type="button" @click="pressKey(d)">{{ d }}</button>
            <button class="pp-key pp-clear" type="button" @click="clearPin">Xoá</button>
            <button class="pp-key" type="button" @click="pressKey('0')">0</button>
            <button class="pp-key pp-delete" type="button" @click="backspace">⌫</button>
          </div>
        </div>

        <div class="pp-secure-row">
          <span class="pp-secure-chip"><span class="pp-dot"></span> AES-256</span>
          <span class="pp-secure-chip"><span class="pp-dot"></span> BCRYPT-12</span>
          <span class="pp-secure-chip"><span class="pp-dot"></span> ZERO-LOG</span>
        </div>
      </div>

      <!-- Step 2: Duration picker -->
      <div v-else-if="step === 'duration'" class="pp-duration-step">
        <div class="pp-success-icon">✓</div>
        <div class="pp-title">Mở khoá thành công</div>
        <div class="pp-subtitle">Chọn thời hạn xem tin riêng tư trên nick này</div>

        <div class="pp-duration-options">
          <button
            v-for="opt in DURATION_OPTIONS"
            :key="opt.minutes"
            type="button"
            class="pp-duration-btn"
            :class="{ recommended: opt.recommended }"
            :disabled="submitting"
            @click="confirmDuration(opt.minutes)"
          >
            <div class="pp-duration-value">{{ opt.value }}</div>
            <div class="pp-duration-label">{{ opt.label }}</div>
            <div class="pp-duration-badge">{{ opt.badge }}</div>
          </button>
        </div>

        <div class="pp-secure-row" style="margin-top: 14px">
          <span class="pp-secure-chip"><span class="pp-dot"></span> Tự khoá lại sau thời hạn</span>
        </div>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { usePrivacyStore } from '@/stores/privacy';
import { useToast } from '@/composables/use-toast';

interface NickInfo {
  displayName?: string | null;
  avatarUrl?: string | null;
  zaloUid?: string | null;
}

const props = defineProps<{
  modelValue: boolean;
  nick?: NickInfo | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  unlocked: [];
}>();

const privacyStore = usePrivacyStore();
const toast = useToast();

// Anh chốt 2026-05-22: 4 options thời hạn (đồng bộ backend DURATIONS_MIN)
const DURATION_OPTIONS = [
  { minutes: 5, value: '5', label: 'Phút', badge: '⚡ Nhanh', recommended: false },
  { minutes: 15, value: '15', label: 'Phút', badge: '⭐ Khuyến nghị', recommended: true },
  { minutes: 480, value: '8', label: 'Giờ', badge: '🏢 Ca làm việc', recommended: false },
  { minutes: 720, value: '12', label: 'Giờ', badge: '🌙 Nửa ngày', recommended: false },
] as const;

// Lockout durations theo cấp sai (anh chốt): 5s → 30s → 5p → 10p → 30p
const LOCKOUT_DURATIONS_S = [5, 30, 300, 600, 1800];

type SessionDuration = 5 | 15 | 480 | 720;

const step = ref<'pin' | 'duration'>('pin');
const pin = ref('');
// Anh chốt 2026-05-22: cache PIN giữa step 1 và 2 để có thể re-unlock khi user
// chọn duration khác mặc định. Clear ngay khi dialog đóng (security).
const cachedPin = ref('');
// Track duration hiện tại đang active (step 1 default = 15p recommended).
// User pick khác sẽ trigger re-unlock với duration mới.
const DEFAULT_MINUTES: SessionDuration = 15;
const currentMinutes = ref<SessionDuration>(DEFAULT_MINUTES);
const wrongCount = ref(0);
const hasError = ref(false);
const checking = ref(false);
const submitting = ref(false);
const lockoutSeconds = ref(0);
let lockoutTimer: ReturnType<typeof setInterval> | null = null;

const formattedCountdown = computed(() => {
  const s = lockoutSeconds.value;
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
});

watch(() => props.modelValue, (open) => {
  if (open) {
    // Reset state mỗi lần mở
    step.value = 'pin';
    pin.value = '';
    hasError.value = false;
    currentMinutes.value = DEFAULT_MINUTES;
    // wrongCount + lockout giữ nguyên (tránh user spam đóng/mở để bypass)
  } else {
    // Đóng dialog → clear cached PIN ngay (security: PIN không sống quá session UI).
    cachedPin.value = '';
  }
});

onUnmounted(() => {
  if (lockoutTimer) clearInterval(lockoutTimer);
});

function pressKey(digit: string) {
  if (pin.value.length >= 4 || checking.value || lockoutSeconds.value > 0) return;
  hasError.value = false;
  pin.value += digit;
  if (pin.value.length === 4) {
    setTimeout(checkPin, 200);
  }
}

function clearPin() {
  pin.value = '';
  hasError.value = false;
}

function backspace() {
  pin.value = pin.value.slice(0, -1);
  hasError.value = false;
}

async function checkPin() {
  if (pin.value.length !== 4 || checking.value) return;
  checking.value = true;
  try {
    // Anh chốt 2026-05-22: step 1 unlock với 15p (recommended default). User
    // không pick gì ở step 2 cũng đã có session 15p ngon lành (không phải 5p).
    // Cache PIN để step 2 có thể re-unlock duration khác. BE đã revoke prior
    // active session khi tạo mới → không bị orphan multi-session.
    await privacyStore.unlock(pin.value, DEFAULT_MINUTES);
    cachedPin.value = pin.value;
    currentMinutes.value = DEFAULT_MINUTES;
    step.value = 'duration';
    wrongCount.value = 0;
    hasError.value = false;
  } catch (e: any) {
    // Wrong PIN
    hasError.value = true;
    wrongCount.value = Math.min(wrongCount.value + 1, 5);
    const seconds = LOCKOUT_DURATIONS_S[wrongCount.value - 1];
    setTimeout(() => {
      pin.value = '';
      startLockout(seconds);
    }, 500);
  } finally {
    checking.value = false;
  }
}

function startLockout(seconds: number) {
  lockoutSeconds.value = seconds;
  if (lockoutTimer) clearInterval(lockoutTimer);
  lockoutTimer = setInterval(() => {
    lockoutSeconds.value--;
    if (lockoutSeconds.value <= 0) {
      lockoutSeconds.value = 0;
      if (lockoutTimer) { clearInterval(lockoutTimer); lockoutTimer = null; }
      pin.value = '';
      hasError.value = false;
    }
  }, 1000);
}

async function confirmDuration(minutes: SessionDuration) {
  if (submitting.value) return;
  submitting.value = true;
  try {
    // Nếu user pick DURATION KHÁC current → re-unlock với duration mới.
    // BE: unlock revoke prior session trước khi create → cookie luôn trỏ session
    // mới nhất, activeSessionCount=1. Lock badge revoke ALL → thật sự lock.
    if (minutes !== currentMinutes.value) {
      if (!cachedPin.value) {
        toast.error('Session đã hết hạn cache PIN — vui lòng nhập lại');
        step.value = 'pin';
        pin.value = '';
        return;
      }
      await privacyStore.unlock(cachedPin.value, minutes);
      currentMinutes.value = minutes;
    } else {
      // Same duration → just refresh status (no API call needed).
      await privacyStore.fetchStatus(true);
    }
    toast.success(`🔓 Đã mở khoá Riêng tư · ${labelFor(minutes)}`);
    emit('unlocked');
    emit('update:modelValue', false);
  } catch (e: any) {
    toast.error(e?.response?.data?.error || 'Lỗi đổi thời hạn');
  } finally {
    submitting.value = false;
  }
}

function labelFor(m: SessionDuration): string {
  if (m === 5) return '5 phút';
  if (m === 15) return '15 phút';
  if (m === 480) return '8 giờ';
  return '12 giờ';
}

function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarColor(name?: string | null): string {
  const colors = ['linear-gradient(135deg,#f59e0b,#ef4444)', 'linear-gradient(135deg,#3b82f6,#1e40af)', 'linear-gradient(135deg,#10b981,#059669)', 'linear-gradient(135deg,#8b5cf6,#6d28d9)'];
  const h = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return colors[h % colors.length];
}
</script>

<style scoped>
.pp-popup {
  background: #fff;
  border-radius: 14px;
  padding: 22px 18px 16px;
  position: relative;
  overflow: hidden;
  font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif;
  min-height: 480px;
}
.pp-popup::before {
  content: '';
  position: absolute; inset: 0;
  background:
    radial-gradient(circle at 30% 15%, rgba(30, 64, 175, 0.04), transparent 50%),
    radial-gradient(circle at 70% 85%, rgba(59, 130, 246, 0.03), transparent 50%);
  pointer-events: none;
}
.pp-hash-flow {
  position: absolute; inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.pp-hash-line {
  position: absolute;
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  color: rgba(30, 64, 175, 0.08);
  white-space: nowrap;
  animation: pp-scroll 25s linear infinite;
}
.pp-hash-line:nth-child(1) { top: 6%; animation-delay: 0s; }
.pp-hash-line:nth-child(2) { top: 92%; animation-delay: -12s; }
@keyframes pp-scroll {
  from { transform: translateX(100%); }
  to { transform: translateX(-100%); }
}

.pp-nick-info {
  display: flex; flex-direction: column; align-items: center;
  gap: 4px; margin-bottom: 14px;
  position: relative; z-index: 2;
}
.pp-avatar-wrap {
  position: relative; width: 48px; height: 48px;
}
.pp-avatar-wrap::before, .pp-avatar-wrap::after {
  content: ''; position: absolute; inset: -5px;
  border-radius: 50%;
  border: 1.5px solid rgba(30, 64, 175, 0.25);
  animation: pp-ring 2.5s ease-in-out infinite;
}
.pp-avatar-wrap::after { inset: -10px; animation-delay: 1.2s; }
@keyframes pp-ring {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50% { opacity: 0; transform: scale(1.2); }
}
.pp-avatar {
  width: 100%; height: 100%; border-radius: 50%;
  color: white; display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 700;
  border: 2.5px solid #1e40af;
  position: relative; z-index: 2;
  overflow: hidden;
}
.pp-avatar img { width: 100%; height: 100%; object-fit: cover; }
.pp-nick-name {
  font-size: 13px; font-weight: 600; color: #0f172a; margin-top: 2px;
}
.pp-nick-uid {
  font-size: 9px; color: #94a3b8;
  font-family: 'JetBrains Mono', monospace; letter-spacing: 0.3px;
}

.pp-lock-emblem {
  width: 72px; height: 72px; margin: 0 auto 12px;
  position: relative; z-index: 2;
}
.pp-lock-hex {
  width: 100%; height: 100%;
  background: linear-gradient(135deg, #1e40af, #0f172a);
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
  display: flex; align-items: center; justify-content: center;
  position: relative;
  box-shadow: 0 8px 24px rgba(30, 64, 175, 0.25);
}
.pp-lock-hex::before {
  content: ''; position: absolute; inset: 3px;
  background: linear-gradient(135deg, #fff, #eff6ff);
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
}
.pp-lock-icon {
  font-size: 24px; position: relative; z-index: 2;
  filter: drop-shadow(0 2px 5px rgba(30, 64, 175, 0.3));
}
.pp-lock-emblem::before {
  content: ''; position: absolute; inset: -5px; border-radius: 50%;
  background: conic-gradient(from 0deg, transparent, #3b82f6, transparent, #1e40af, transparent);
  animation: pp-glow 5s linear infinite;
  filter: blur(8px); opacity: 0.35; z-index: 1;
}
@keyframes pp-glow {
  to { transform: rotate(360deg); }
}

.pp-title {
  text-align: center; font-size: 14px; font-weight: 600;
  color: #0f172a; margin-bottom: 4px;
  position: relative; z-index: 2;
}
.pp-subtitle {
  text-align: center; font-size: 11px; color: #475569;
  margin-bottom: 14px; line-height: 1.5; max-width: 260px;
  margin-left: auto; margin-right: auto;
  position: relative; z-index: 2;
}

.pp-pin-display {
  display: flex; justify-content: center; gap: 10px;
  margin-bottom: 10px; position: relative; z-index: 2;
}
.pp-pin-box {
  width: 36px; height: 42px;
  border: 1.5px solid #cbd5e1; background: #fff;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.18s ease;
}
.pp-pin-box.active { border-color: #1e40af; box-shadow: 0 0 0 3px rgba(30, 64, 175, 0.12); }
.pp-pin-dot {
  width: 11px; height: 11px; border-radius: 50%; background: #1e40af;
  opacity: 0; transform: scale(0.4);
  transition: opacity 0.18s, transform 0.18s;
}
.pp-pin-box.filled .pp-pin-dot { opacity: 1; transform: scale(1); }
.pp-pin-box.error { border-color: #dc2626; animation: pp-shake 0.4s; }
.pp-pin-box.error .pp-pin-dot { background: #dc2626; }
@keyframes pp-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-5px); }
  40%, 80% { transform: translateX(5px); }
}

.pp-error-msg {
  text-align: center; font-size: 11px; font-weight: 600;
  color: #dc2626; margin-bottom: 6px; min-height: 16px;
  position: relative; z-index: 2; display: none;
}
.pp-error-msg.show { display: block; }

.pp-lockout {
  background: #eff6ff; border: 1px solid #dbeafe;
  border-radius: 10px; padding: 14px 16px; text-align: center;
  margin: 0 auto 12px; max-width: 280px;
  position: relative; z-index: 3;
}
.pp-lockout-icon { font-size: 22px; margin-bottom: 4px; }
.pp-lockout-title { font-size: 12px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }
.pp-lockout-countdown {
  font-size: 22px; font-weight: 700; color: #1e40af;
  font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums;
  margin: 2px 0;
}
.pp-lockout-hint { font-size: 10px; color: #475569; }
.pp-lockout-attempts {
  display: inline-block; margin-top: 6px; font-size: 9px;
  padding: 1px 7px; border-radius: 9999px;
  background: #fee2e2; color: #dc2626; font-weight: 600;
}

.pp-keypad {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
  max-width: 220px; margin: 0 auto 12px;
  position: relative; z-index: 2;
}
.pp-keypad.disabled { opacity: 0.4; pointer-events: none; }
.pp-key {
  height: 40px; background: #fff; border: 1px solid #e2e8f0;
  color: #0f172a; border-radius: 8px;
  font-size: 16px; font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
  cursor: pointer; transition: all 0.1s;
  display: flex; align-items: center; justify-content: center;
}
.pp-key:hover {
  background: #eff6ff; border-color: #1e40af; color: #1e40af;
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(30, 64, 175, 0.12);
}
.pp-key:active { transform: translateY(1px); background: #dbeafe; }
.pp-key.pp-clear, .pp-key.pp-delete { font-size: 10px; color: #475569; font-weight: 500; }
.pp-key.pp-delete { font-size: 14px; }

.pp-secure-row {
  display: flex; justify-content: center; gap: 8px;
  font-size: 9px; color: #94a3b8;
  font-family: 'JetBrains Mono', monospace;
  position: relative; z-index: 2; flex-wrap: wrap;
}
.pp-secure-chip { display: inline-flex; align-items: center; gap: 4px; }
.pp-dot {
  width: 5px; height: 5px; border-radius: 50%; background: #059669;
  box-shadow: 0 0 4px #059669; animation: pp-pulse 1.5s ease-in-out infinite;
}
@keyframes pp-pulse { 50% { opacity: 0.4; } }

.pp-duration-step { position: relative; z-index: 2; }
.pp-success-icon {
  width: 42px; height: 42px; border-radius: 50%;
  background: linear-gradient(135deg, #059669, #047857);
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 8px; color: white; font-size: 20px;
  box-shadow: 0 4px 14px rgba(5, 150, 105, 0.3);
}
.pp-duration-options {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
  max-width: 260px; margin: 0 auto;
}
.pp-duration-btn {
  padding: 10px 8px; background: #fff;
  border: 1.5px solid #e2e8f0; border-radius: 10px;
  color: #0f172a; cursor: pointer; text-align: center;
  transition: all 0.15s; font-family: inherit;
}
.pp-duration-btn:hover {
  border-color: #1e40af; background: #eff6ff;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(30, 64, 175, 0.15);
}
.pp-duration-btn.recommended {
  border-color: #1e40af;
  background: linear-gradient(135deg, #eff6ff, #fff);
  box-shadow: 0 4px 12px rgba(30, 64, 175, 0.18);
}
.pp-duration-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pp-duration-value {
  font-size: 18px; font-weight: 700; color: #1e40af;
  font-family: 'JetBrains Mono', monospace;
}
.pp-duration-label {
  font-size: 10px; color: #475569; margin-top: 2px;
  text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;
}
.pp-duration-badge {
  font-size: 9px; color: #1e40af; margin-top: 3px; font-weight: 600;
}
</style>
