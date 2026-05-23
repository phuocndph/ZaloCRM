<!--
  PrivacyNicksTab — Phase Privacy v2 2026-05-23.

  Top: PIN config grid V2 (Variant 2 anh chốt — primary action card + device info card).
   - State unlocked: split button "🔒 Khoá ngay" + "⚙ Đổi PIN"
   - Device info: browser (Cốc Cốc / Chrome / Safari) + IP + Mở→Khoá + countdown
   - State setup: clone blockchain aesthetic của PrivacyUnlockDialog
  Below: list 2-group Riêng tư / Thường + toggle (PIN confirm bắt buộc).
-->
<template>
  <div class="privacy-tab">
    <!-- ═════════ PIN CONFIG GRID V2 ═════════ -->
    <section class="pin-grid">
      <!-- Primary action card (state-aware gradient) -->
      <div class="pin-primary" :class="primaryState">
        <div class="pin-icon">{{ primaryIcon }}</div>
        <div class="pin-text">
          <h3 class="pin-title">{{ primaryTitle }}</h3>
          <div class="pin-sub">{{ primarySub }}</div>
        </div>
        <div class="pin-action">
          <!-- Unlocked: split 2 buttons -->
          <div v-if="store.isUnlocked" class="pin-btn-group">
            <button class="pin-btn-split lock" @click="onLock">🔒 Khoá ngay</button>
            <button class="pin-btn-split changepin" @click="onOpenChangePin">⚙ Đổi PIN</button>
          </div>
          <!-- Locked: 1 unlock button -->
          <button v-else-if="store.hasPin" class="pin-btn primary" @click="onOpenUnlock">🔓 Mở khoá</button>
          <!-- Empty: 1 setup button -->
          <button v-else class="pin-btn empty" @click="onOpenSetup">⚙ Setup PIN</button>
        </div>
      </div>

      <!-- Info card (device active session) -->
      <div class="pin-info">
        <span class="pin-info-label">Thiết bị đang mở</span>
        <div v-if="activeDevice" class="device-row">
          <div class="device-line">
            <span class="device-browser">{{ activeDevice.browser }}</span>
            <span v-if="activeDevice.ip" class="device-ip">{{ activeDevice.ip }}</span>
          </div>
          <div class="device-time">
            Mở {{ activeDevice.unlockedTime }} <span class="arrow">→</span>
            Khoá lúc <strong>{{ activeDevice.expiresTime }}</strong>
            <span class="dot">·</span>
            <span class="countdown">⏱ {{ countdown }}</span>
          </div>
        </div>
        <span v-else class="pin-info-empty">
          {{ store.hasPin ? '— Đang khoá —' : '— Chưa có session —' }}
        </span>
      </div>
    </section>

    <!-- ═════════ LIST NICK SECTION ═════════ -->
    <header class="ptab-head">
      <div>
        <h2 class="ptab-title">Nick Riêng tư của tôi</h2>
        <p class="ptab-sub">
          Default mọi nick là "Thường". Toggle sang "Riêng tư" → admin + sale khác sẽ thấy
          content bị làm mờ. Chỉ bạn unlock được bằng PIN.
        </p>
      </div>
      <div class="ptab-counter" :class="{ full: privateCount >= maxPrivacyNicks }">
        <div class="counter-label">Đã dùng</div>
        <div class="counter-value">{{ privateCount }} / {{ maxPrivacyNicks }}</div>
      </div>
    </header>

    <div v-if="!loading && nicks.length === 0" class="ptab-empty">
      <div class="empty-icon">📱</div>
      <h3>Chưa có nick chính</h3>
      <p>Bạn chưa được gán làm chính chủ nick nào. Yêu cầu admin assign owner một nick hoặc tự đăng ký nick mới qua QR.</p>
    </div>

    <div v-else-if="loading" class="ptab-loading">
      <div class="skel" v-for="i in 3" :key="i"></div>
    </div>

    <template v-else>
      <section v-if="privateNicks.length > 0" class="ptab-group">
        <div class="group-header"><span class="group-icon">🔒</span><span class="group-name">Nick Riêng tư</span><span class="group-count">{{ privateNicks.length }}</span></div>
        <div class="nick-list">
          <NickRow v-for="n in privateNicks" :key="n.id" :nick="n" :is-internal-contact="internalContactId === n.id" :submitting="submittingId === n.id" @toggle="onToggleRequest(n)" @set-internal="onSetInternalContact(n)" />
        </div>
      </section>

      <section v-if="normalNicks.length > 0" class="ptab-group">
        <div class="group-header"><span class="group-icon">📭</span><span class="group-name">Nick Thường</span><span class="group-count">{{ normalNicks.length }}</span></div>
        <div class="nick-list">
          <NickRow v-for="n in normalNicks" :key="n.id" :nick="n" :is-internal-contact="internalContactId === n.id" :submitting="submittingId === n.id" @toggle="onToggleRequest(n)" @set-internal="onSetInternalContact(n)" />
        </div>
      </section>
    </template>

    <div v-if="errorMsg" class="ptab-error" @click="errorMsg = ''">⚠ {{ errorMsg }} <span class="dismiss">✕</span></div>

    <!-- Dialogs: reuse PrivacyUnlockDialog cho unlock + PrivacyPinSetupDialog cho setup/change -->
    <PrivacyUnlockDialog v-model="unlockOpen" :nick="meAsNick" @unlocked="onUnlocked" />
    <PrivacyPinSetupDialog v-model="setupOpen" :mode="setupMode" @done="onSetupDone" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, h, defineComponent } from 'vue';
import { api } from '@/api/index';
import { usePrivacyStore } from '@/stores/privacy';
import { useAuthStore } from '@/stores/auth';
import PrivacyUnlockDialog from '@/components/privacy/PrivacyUnlockDialog.vue';
import PrivacyPinSetupDialog from '@/components/privacy/PrivacyPinSetupDialog.vue';

interface MyNick {
  id: string;
  zaloUid: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  privacyMode: 'main' | 'sub';
  friendCount: number;
}

const store = usePrivacyStore();
const auth = useAuthStore();

const nicks = ref<MyNick[]>([]);
const loading = ref(true);
const submittingId = ref<string | null>(null);
const errorMsg = ref('');
const maxPrivacyNicks = ref(2);
const internalContactId = ref<string | null>(null);

const unlockOpen = ref(false);
const setupOpen = ref(false);
const setupMode = ref<'setup' | 'change'>('setup');
const pendingToggle = ref<MyNick | null>(null);

// Tick mỗi giây cho countdown realtime
const tickNow = ref(Date.now());
let tickTimer: number | null = null;

const privateNicks = computed(() => nicks.value.filter((n) => n.privacyMode === 'main'));
const normalNicks = computed(() => nicks.value.filter((n) => n.privacyMode !== 'main'));
const privateCount = computed(() => privateNicks.value.length);

// PIN config grid — state-aware
const primaryState = computed(() => {
  if (!store.hasPin) return 'empty';
  if (store.isUnlocked) return '';
  return 'locked';
});
const primaryIcon = computed(() => {
  if (!store.hasPin) return '⚙';
  return store.isUnlocked ? '🔓' : '🔒';
});
const primaryTitle = computed(() => {
  if (!store.hasPin) return 'Chưa setup PIN bảo mật';
  return store.isUnlocked ? 'Đang mở khoá Riêng tư' : 'Riêng tư đang khoá';
});
const primarySub = computed(() => {
  if (!store.hasPin) return 'Đặt PIN 4 chữ số để có thể bật Riêng tư cho nick của bạn.';
  return store.isUnlocked
    ? 'Bạn có thể xem nội dung tin nhắn của các nick Riêng tư đến hết countdown.'
    : 'Nhập PIN để xem nội dung các nick bạn đã đặt Riêng tư.';
});

// Device info — parse từ active session
const activeDevice = computed(() => {
  if (!store.isUnlocked || store.activeSessions.length === 0) return null;
  const s = store.activeSessions[0];
  return {
    browser: parseBrowser(s.userAgent),
    ip: s.ipAddress,
    unlockedTime: formatTime(s.unlockedAt),
    expiresTime: formatTime(s.expiresAt),
  };
});

const countdown = computed(() => {
  if (!store.isUnlocked || store.activeSessions.length === 0) return '--:--:--';
  const exp = new Date(store.activeSessions[0].expiresAt).getTime();
  const ms = exp - tickNow.value;
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
});

// Fake nick cho PrivacyUnlockDialog (vì dialog accept nick prop nhưng đây là user-level unlock)
const meAsNick = computed(() => ({
  displayName: auth.user?.fullName || 'Bạn',
  avatarUrl: null,
  zaloUid: null,
}));

async function loadAll() {
  loading.value = true;
  try {
    const [myNicksRes, meContactRes] = await Promise.all([
      api.get<{ nicks: MyNick[] }>('/privacy/my-nicks'),
      api.get<{ internalContactZaloAccountId: string | null; maxPrivacyNicks: number; autoDefaulted?: boolean }>('/me/internal-contact'),
      store.fetchStatus(true),
    ]);
    const list = Array.isArray(myNicksRes.data) ? myNicksRes.data : (myNicksRes.data?.nicks ?? []);
    nicks.value = list;
    internalContactId.value = meContactRes.data.internalContactZaloAccountId;
    maxPrivacyNicks.value = meContactRes.data.maxPrivacyNicks;
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.error || 'Không tải được danh sách nick';
  } finally {
    loading.value = false;
  }
}

// Phase Privacy v2 2026-05-23: toggle privacy mode REQUIRE PIN confirm.
// - Nếu chưa setup PIN → mở SetupPinDialog (mode='setup'). User setup xong → tự động unlock.
// - Nếu hasPin + chưa unlock → mở UnlockDialog. User unlock xong → flip mode.
// - Nếu hasPin + đã unlock → flip thẳng (đã có session, không cần re-confirm).
async function onToggleRequest(nick: MyNick) {
  if (submittingId.value) return;
  if (!store.hasPin) {
    pendingToggle.value = nick;
    setupMode.value = 'setup';
    setupOpen.value = true;
    return;
  }
  if (!store.isUnlocked) {
    pendingToggle.value = nick;
    unlockOpen.value = true;
    return;
  }
  await doFlipNick(nick);
}

async function doFlipNick(nick: MyNick) {
  submittingId.value = nick.id;
  errorMsg.value = '';
  const newMode: 'main' | 'sub' = nick.privacyMode === 'main' ? 'sub' : 'main';
  try {
    await api.patch(`/zalo-accounts/${nick.id}/privacy-mode`, { mode: newMode });
    nick.privacyMode = newMode;
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.error || 'Đổi privacy mode thất bại';
  } finally {
    submittingId.value = null;
  }
}

function onUnlocked() {
  // Sau khi unlock thành công → flip nick đang pending nếu có
  if (pendingToggle.value) {
    doFlipNick(pendingToggle.value);
    pendingToggle.value = null;
  }
}

function onSetupDone() {
  // Sau khi setup PIN xong → reload status + flip pending nick
  store.fetchStatus(true).then(() => {
    if (pendingToggle.value) {
      // Setup xong CHƯA unlock — user cần mở khoá tiếp
      unlockOpen.value = true;
    }
  });
}

function onOpenUnlock() { unlockOpen.value = true; }
function onOpenSetup() { setupMode.value = 'setup'; setupOpen.value = true; }
function onOpenChangePin() { setupMode.value = 'change'; setupOpen.value = true; }

async function onLock() {
  await store.lock();
}

async function onSetInternalContact(nick: MyNick) {
  if (submittingId.value) return;
  const newValue = internalContactId.value === nick.id ? null : nick.id;
  submittingId.value = nick.id;
  errorMsg.value = '';
  try {
    await api.patch('/me/internal-contact', { zaloAccountId: newValue });
    internalContactId.value = newValue;
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.error || 'Đặt nick liên lạc nội bộ thất bại';
  } finally {
    submittingId.value = null;
  }
}

function parseBrowser(ua: string | null): string {
  if (!ua) return 'Trình duyệt khác';
  if (/coc[ _]?coc/i.test(ua)) return 'Cốc Cốc';
  if (/edg\b/i.test(ua)) return 'Microsoft Edge';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/opr\b|opera/i.test(ua)) return 'Opera';
  if (/chrome/i.test(ua)) return 'Chrome';
  if (/safari/i.test(ua)) return 'Safari';
  return 'Trình duyệt khác';
}
function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

onMounted(() => {
  loadAll();
  tickTimer = window.setInterval(() => { tickNow.value = Date.now(); }, 1000);
});
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer);
});

// Inline NickRow component
const NickRow = defineComponent({
  props: {
    nick: { type: Object as () => MyNick, required: true },
    isInternalContact: { type: Boolean, default: false },
    submitting: { type: Boolean, default: false },
  },
  emits: ['toggle', 'set-internal'],
  setup(props, { emit }) {
    const initials = (name: string | null) => {
      if (!name) return '?';
      const parts = name.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    };
    const avatarColor = (name: string | null) => {
      const palette = [
        'linear-gradient(135deg,#f59e0b,#ef4444)',
        'linear-gradient(135deg,#3b82f6,#1e40af)',
        'linear-gradient(135deg,#10b981,#059669)',
        'linear-gradient(135deg,#8b5cf6,#6d28d9)',
      ];
      const h = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      return palette[h % palette.length];
    };
    const statusLabel = (s: string) =>
      s === 'connected' ? { label: 'Đang kết nối', color: '#10B981' }
        : s === 'qr_pending' ? { label: 'Cần đăng nhập', color: '#F59E0B' }
          : { label: 'Đứt kết nối', color: '#EF4444' };

    return () => {
      const n = props.nick;
      const isMain = n.privacyMode === 'main';
      const stat = statusLabel(n.status);
      return h('div', { class: 'nick-row' }, [
        h('div', { class: 'nr-avatar', style: { background: avatarColor(n.displayName) } }, [
          n.avatarUrl ? h('img', { src: n.avatarUrl }) : initials(n.displayName),
        ]),
        h('div', { class: 'nr-info' }, [
          h('div', { class: 'nr-name' }, [
            n.displayName || 'Nick chưa đặt tên',
            props.isInternalContact ? h('span', { class: 'nr-badge-internal', title: 'Nick liên lạc nội bộ của bạn' }, '🏠 Liên lạc nội bộ') : null,
          ]),
          h('div', { class: 'nr-meta' }, [
            h('span', { class: 'nr-dot', style: { background: stat.color } }),
            stat.label,
            n.zaloUid ? h('span', { class: 'nr-uid' }, [' · UID ' + n.zaloUid]) : null,
            n.friendCount > 0 ? h('span', { class: 'nr-uid' }, [' · 👥 ' + n.friendCount + ' bạn']) : null,
          ]),
          !props.isInternalContact
            ? h('button', { class: 'nr-set-internal', disabled: props.submitting, onClick: () => emit('set-internal') }, '🏠 Đặt làm nick liên lạc nội bộ')
            : h('button', { class: 'nr-clear-internal', disabled: props.submitting, onClick: () => emit('set-internal') }, '✕ Bỏ liên lạc nội bộ'),
        ]),
        h('button', {
          class: ['nr-toggle', isMain ? 'on' : 'off'],
          disabled: props.submitting,
          onClick: () => emit('toggle'),
          title: isMain ? 'Đang Riêng tư — click để chuyển Thường (yêu cầu PIN)' : 'Đang Thường — click để chuyển Riêng tư (yêu cầu PIN)',
        }, [
          h('span', { class: 'nr-toggle-track' }, [ h('span', { class: 'nr-toggle-thumb' }) ]),
          h('span', { class: 'nr-toggle-label' }, isMain ? 'Riêng tư' : 'Thường'),
        ]),
      ]);
    };
  },
});
</script>

<style scoped>
.privacy-tab { padding: 20px 4px; display: flex; flex-direction: column; gap: 20px; }

/* ═════════ PIN Config Grid V2 ═════════ */
.pin-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; }
.pin-primary {
  background: linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%);
  border: 1px solid #BFDBFE; border-radius: 12px; padding: 18px 22px;
  display: flex; align-items: center; gap: 18px;
}
.pin-primary.locked { background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%); border-color: #FCD34D; }
.pin-primary.empty { background: linear-gradient(135deg, #F9FAFB 0%, #F3F4F6 100%); border-color: #E5E7EB; }
.pin-icon { width: 52px; height: 52px; border-radius: 14px; background: white; display: flex; align-items: center; justify-content: center; font-size: 26px; flex-shrink: 0; box-shadow: 0 4px 10px rgba(30, 64, 175, 0.1); }
.pin-text { flex: 1; min-width: 0; }
.pin-title { font-size: 15px; font-weight: 700; color: #0F172A; margin: 0 0 3px; }
.pin-sub { font-size: 12px; color: #475569; line-height: 1.4; }
.pin-action { flex-shrink: 0; }
.pin-btn { padding: 9px 18px; border: none; border-radius: 8px; background: #1E40AF; color: white; font-weight: 700; font-size: 13px; cursor: pointer; font-family: inherit; white-space: nowrap; }
.pin-btn:hover { background: #1E3A8A; }
.pin-btn.empty { background: #5E6AD2; }
.pin-btn-group { display: flex; gap: 6px; }
.pin-btn-split { padding: 8px 14px; border-radius: 7px; font-weight: 700; font-size: 12.5px; cursor: pointer; font-family: inherit; border: 1px solid transparent; white-space: nowrap; }
.pin-btn-split.lock { background: #B45309; color: white; border-color: #B45309; }
.pin-btn-split.lock:hover { background: #92400E; }
.pin-btn-split.changepin { background: white; color: #1E40AF; border-color: #BFDBFE; }
.pin-btn-split.changepin:hover { background: #EFF6FF; }

.pin-info { background: white; border: 1px solid #E5E7EB; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; }
.pin-info-label { font-size: 10.5px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 700; }
.pin-info-empty { color: #9CA3AF; font-style: italic; font-size: 12px; }
.device-row { display: flex; flex-direction: column; gap: 4px; padding: 4px 0; }
.device-line { display: flex; align-items: center; gap: 6px; font-size: 12.5px; flex-wrap: wrap; }
.device-browser { font-weight: 700; color: #0F172A; }
.device-ip { font-family: 'JetBrains Mono', monospace; background: #F3F4F6; color: #374151; padding: 1px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.device-time { font-size: 11px; color: #6B7280; font-variant-numeric: tabular-nums; }
.device-time .arrow { color: #C7CCEB; margin: 0 4px; }
.device-time .dot { margin: 0 6px; color: #C7CCEB; }
.device-time strong { color: #374151; }
.countdown { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #B45309; font-size: 12px; }

/* ═════════ List section (giữ như trước) ═════════ */
.ptab-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 12px; border-bottom: 1px solid #E5E7EB; }
.ptab-title { margin: 0; font-size: 18px; font-weight: 700; color: #0F172A; }
.ptab-sub { margin: 6px 0 0; color: #6B7280; font-size: 12.5px; line-height: 1.5; max-width: 640px; }
.ptab-counter { background: #EFF6FF; border: 1px solid #DBEAFE; border-radius: 10px; padding: 10px 16px; min-width: 120px; text-align: center; }
.ptab-counter.full { background: #FEF2F2; border-color: #FECACA; }
.counter-label { font-size: 10.5px; color: #6B7280; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
.counter-value { font-size: 20px; font-weight: 700; color: #1D4ED8; font-variant-numeric: tabular-nums; line-height: 1.1; margin-top: 2px; }
.ptab-counter.full .counter-value { color: #B91C1C; }

.ptab-empty { background: white; border: 1px dashed #E5E7EB; border-radius: 12px; padding: 48px 24px; text-align: center; color: #6B7280; }
.empty-icon { font-size: 40px; margin-bottom: 12px; }
.ptab-empty h3 { margin: 0 0 6px; font-size: 16px; color: #0F172A; }
.ptab-empty p { margin: 0; font-size: 13px; max-width: 420px; margin: 0 auto; }

.ptab-loading { display: flex; flex-direction: column; gap: 8px; }
.skel { height: 64px; background: linear-gradient(90deg, #F3F4F6 0%, #E5E7EB 50%, #F3F4F6 100%); background-size: 200% 100%; animation: skel 1.5s linear infinite; border-radius: 10px; }
@keyframes skel { from { background-position: 200% 0 } to { background-position: -200% 0 } }

.ptab-group { display: flex; flex-direction: column; gap: 8px; }
.group-header { display: flex; align-items: center; gap: 8px; padding: 4px 2px; font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: .04em; font-weight: 700; }
.group-icon { font-size: 14px; }
.group-count { background: #F3F4F6; color: #6B7280; font-weight: 700; padding: 1px 8px; border-radius: 9999px; font-size: 10px; letter-spacing: 0; }

.nick-list { display: flex; flex-direction: column; gap: 8px; }
:deep(.nick-row) { display: flex; align-items: center; gap: 14px; padding: 14px 16px; background: white; border: 1px solid #E5E7EB; border-radius: 10px; transition: border-color 0.15s; }
:deep(.nick-row:hover) { border-color: #C7D2FE; }
:deep(.nr-avatar) { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 13px; flex-shrink: 0; overflow: hidden; }
:deep(.nr-avatar img) { width: 100%; height: 100%; object-fit: cover; }
:deep(.nr-info) { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
:deep(.nr-name) { font-size: 14px; font-weight: 600; color: #0F172A; display: flex; align-items: center; gap: 8px; }
:deep(.nr-badge-internal) { background: #FEF3C7; color: #92400E; font-size: 10.5px; padding: 2px 8px; border-radius: 9999px; font-weight: 700; }
:deep(.nr-meta) { font-size: 11.5px; color: #6B7280; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
:deep(.nr-dot) { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
:deep(.nr-uid) { color: #9CA3AF; }
:deep(.nr-set-internal), :deep(.nr-clear-internal) { background: transparent; border: 1px dashed #C7D2FE; color: #5E6AD2; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 6px; cursor: pointer; align-self: flex-start; margin-top: 2px; font-family: inherit; }
:deep(.nr-set-internal):hover, :deep(.nr-clear-internal):hover { background: #EEF0FF; border-style: solid; }
:deep(.nr-clear-internal) { color: #B91C1C; border-color: #FCA5A5; }
:deep(.nr-clear-internal:hover) { background: #FEF2F2; }
:deep(.nr-toggle) { display: inline-flex; align-items: center; gap: 8px; background: transparent; border: none; cursor: pointer; padding: 4px 0; font-family: inherit; }
:deep(.nr-toggle-track) { width: 38px; height: 22px; border-radius: 9999px; background: #D1D5DB; position: relative; transition: background 0.15s; }
:deep(.nr-toggle-thumb) { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: white; box-shadow: 0 1px 3px rgba(0,0,0,.2); transition: transform 0.15s; }
:deep(.nr-toggle.on .nr-toggle-track) { background: #5E6AD2; }
:deep(.nr-toggle.on .nr-toggle-thumb) { transform: translateX(16px); }
:deep(.nr-toggle-label) { font-size: 12px; font-weight: 600; color: #374151; min-width: 60px; text-align: left; }
:deep(.nr-toggle.on .nr-toggle-label) { color: #5E6AD2; }
:deep(.nr-toggle:disabled) { opacity: 0.5; cursor: not-allowed; }

.ptab-error { position: fixed; bottom: 24px; right: 24px; background: #FEF2F2; color: #B91C1C; border: 1px solid #FCA5A5; padding: 12px 18px; border-radius: 10px; font-size: 13px; display: flex; align-items: center; gap: 12px; cursor: pointer; box-shadow: 0 8px 24px rgba(185, 28, 28, 0.15); z-index: 1000; max-width: 480px; }
.ptab-error .dismiss { color: #DC2626; font-weight: 700; }
</style>
