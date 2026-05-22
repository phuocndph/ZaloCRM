<template>
  <div class="dept-page privacy-page">
    <header class="page-hero">
      <div class="hero-left">
        <h1 class="hero-title">🔒 Chế độ Riêng Tư</h1>
        <p class="hero-sub">
          Bật Riêng tư cho nick chính của bạn — admin + sale khác sẽ thấy nội dung tin nhắn bị làm mờ (▒▒▒▒).
          Chỉ bạn unlock bằng PIN mới xem được. Khoá tự động sau {{ unlockDurationLabel }}.
        </p>
      </div>
    </header>

    <!-- PIN Setup card (special — keep separate from nick cards) -->
    <section class="pin-card" :class="{ 'pin-unlocked': store.isUnlocked, 'pin-locked': !store.isUnlocked && store.hasPin }">
      <div class="pin-accent" :style="{ background: pinAccentColor }"></div>
      <div class="pin-body">
        <div class="pin-head">
          <div>
            <div class="pin-eyebrow">PIN bảo mật</div>
            <h2 class="pin-title">
              {{ store.hasPin
                ? (store.isUnlocked ? '🔓 Đang mở khoá' : '🔒 Đã setup — chờ unlock')
                : '⚠ Chưa setup PIN' }}
            </h2>
          </div>
          <div class="pin-actions">
            <button v-if="!store.hasPin" class="btn-primary" @click="showUnlockModal = true">
              Setup PIN
            </button>
            <button v-else-if="!store.isUnlocked" class="btn-primary" @click="showUnlockModal = true">
              🔓 Mở khoá
            </button>
            <button v-else class="btn-ghost" @click="lockNow">Khoá ngay</button>
          </div>
        </div>
        <div class="pin-info">
          <div class="info-readonly-grid">
            <div class="readonly-row">
              <span class="readonly-label">Trạng thái</span>
              <span class="role-tag" :class="store.hasPin ? (store.isUnlocked ? 'role-deputy' : 'role-leader') : 'role-empty-tag'">
                {{ store.hasPin ? (store.isUnlocked ? '🟢 Mở khoá' : '🟡 Đã khoá') : '⚪ Chưa setup' }}
              </span>
            </div>
            <div v-if="store.hasPin && store.isUnlocked" class="readonly-row">
              <span class="readonly-label">Còn hiệu lực</span>
              <span class="readonly-value">{{ store.remainingMinutes }} phút</span>
            </div>
            <div class="readonly-row">
              <span class="readonly-label">Phiên đang mở</span>
              <span class="readonly-value">{{ store.activeSessionCount }} phiên</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Stats -->
    <section class="stats-row" v-if="!loading && nicks.length > 0">
      <div class="stat-card stat-primary">
        <div class="stat-label">Tổng nick</div>
        <div class="stat-value">{{ nicks.length }}</div>
      </div>
      <div class="stat-card stat-cream">
        <div class="stat-label">Nick Riêng tư</div>
        <div class="stat-value">{{ countMain }}<span class="stat-unit"> / {{ nicks.length }}</span></div>
      </div>
      <div class="stat-card stat-forest">
        <div class="stat-label">Nick Công khai</div>
        <div class="stat-value">{{ nicks.length - countMain }}<span class="stat-unit"> / {{ nicks.length }}</span></div>
      </div>
      <div class="stat-card stat-mustard">
        <div class="stat-label">Sở hữu của bạn</div>
        <div class="stat-value">{{ ownNickCount }}<span class="stat-unit"> / {{ nicks.length }}</span></div>
      </div>
    </section>

    <!-- Section title above nick cards -->
    <div v-if="nicks.length > 0" class="section-divider">
      <h2 class="section-divider-title">Danh sách nick · Cấu hình Riêng tư</h2>
      <p class="section-divider-sub">Click vào nick để mở panel chi tiết. Chỉ owner của nick mới flip được mode.</p>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="skel-card" v-for="i in 3" :key="i"></div>
    </div>

    <div v-else-if="nicks.length === 0" class="empty-state">
      <div class="empty-icon">📱</div>
      <h3>Chưa có nick Zalo nào</h3>
      <p>Đăng ký nick Zalo từ trang Nick Zalo trước khi cấu hình Riêng tư.</p>
      <RouterLink to="/zalo-accounts" class="btn-primary">Mở trang Nick Zalo</RouterLink>
    </div>

    <section v-else class="nick-cards-grid">
      <div
        v-for="n in nicks"
        :key="n.id"
        class="dept-card privacy-card"
        :style="{ '--accent': nickAccent(n) }"
        @click="openPanel(n)"
      >
        <div class="dept-card-accent"></div>
        <div class="dept-card-body">
          <div class="dept-card-head">
            <div class="dept-name-wrap">
              <img v-if="n.avatarUrl" :src="n.avatarUrl" class="nick-avatar" alt="" />
              <span v-else class="nick-avatar" :style="{ background: avatarColor(n.displayName || 'Nick') }">
                {{ initials(n.displayName || 'Nick') }}
              </span>
              <span class="dept-name">{{ n.displayName || '(chưa đặt tên)' }}</span>
              <span v-if="!n.isOwner" class="dept-depth-tag">Được cấp quyền</span>
              <span v-else-if="n.privacyMode === 'main'" class="dept-depth-tag tag-private">Riêng tư</span>
              <span v-else class="dept-depth-tag tag-public">Công khai</span>
            </div>
            <div class="dept-quick-actions">
              <button class="btn-quick btn-quick-edit" @click.stop="openPanel(n)">
                ✎ Chi tiết
              </button>
            </div>
          </div>
          <div class="dept-rows">
            <div class="dept-info-row">
              <span class="info-ico">{{ n.privacyMode === 'main' ? '🔒' : '🔓' }}</span>
              <span class="info-label">Trạng thái:</span>
              <span class="info-name">
                {{ n.privacyMode === 'main' ? 'Riêng tư (làm mờ tin nhắn)' : 'Công khai (hiển thị bình thường)' }}
              </span>
            </div>
            <div class="dept-info-row dept-info-row-members">
              <span class="info-ico">📞</span>
              <span class="info-label">Số / UID:</span>
              <span class="info-name mono">{{ n.phone || n.zaloUid || '—' }}</span>
              <button
                v-if="n.isOwner"
                class="btn-expand-members"
                :title="expandedNicks.has(n.id) ? 'Thu gọn' : 'Cấu hình nhanh'"
                @click.stop="toggleExpand(n.id)"
              >{{ expandedNicks.has(n.id) ? '−' : '+' }}</button>
            </div>
            <div class="dept-info-row">
              <span class="info-ico">{{ n.status === 'connected' ? '🟢' : n.status === 'qr_pending' ? '🟡' : '⚪' }}</span>
              <span class="info-label">Kết nối:</span>
              <span class="info-name">{{ statusLabel(n.status) }}</span>
            </div>

            <!-- Inline quick toggle for owners -->
            <div v-if="expandedNicks.has(n.id) && n.isOwner" class="inline-quick-toggle">
              <label class="switch-row" @click.stop>
                <input
                  type="checkbox"
                  :checked="n.privacyMode === 'main'"
                  :disabled="flipping === n.id"
                  @change="flipMode(n.id, n.privacyMode === 'main' ? 'sub' : 'main', $event)"
                />
                <span class="slider"></span>
                <span class="switch-text">
                  <strong>{{ n.privacyMode === 'main' ? 'Tắt' : 'Bật' }}</strong>
                  chế độ Riêng tư nhanh
                </span>
              </label>
              <p class="hint-soft" style="margin-top: 8px;">
                Hoặc click <strong>"Chi tiết"</strong> phía trên để xem cấu hình đầy đủ.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Active sessions -->
    <section v-if="store.activeSessions.length > 0" class="section-divider" style="margin-top: 32px">
      <h2 class="section-divider-title">Phiên mở khoá đang hoạt động</h2>
    </section>
    <ul v-if="store.activeSessions.length > 0" class="session-list-v2">
      <li v-for="s in store.activeSessions" :key="s.id" class="session-row">
        <div class="session-icon">🔓</div>
        <div class="session-info">
          <div class="session-time"><strong>Mở:</strong> {{ formatDate(s.unlockedAt) }}</div>
          <div class="session-meta">Hết hạn {{ formatDate(s.expiresAt) }} · {{ uaShort(s.userAgent) }}</div>
        </div>
      </li>
    </ul>

    <NickPrivacyPanel
      :open="panelOpen"
      :nick="selectedNick"
      :can-flip="selectedNick?.isOwner ?? false"
      @close="closePanel"
      @changed="onChanged"
    />

    <PrivacyUnlockModal :show="showUnlockModal" @close="showUnlockModal = false" @unlocked="onUnlocked" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '@/api/index';
import { usePrivacyStore } from '@/stores/privacy';
import PrivacyUnlockModal from '@/components/privacy/PrivacyUnlockModal.vue';
import NickPrivacyPanel from '@/components/privacy/NickPrivacyPanel.vue';

interface NickRow {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  zaloUid: string | null;
  status: string;
  privacyMode: 'main' | 'sub';
  isOwner: boolean;
}

const store = usePrivacyStore();
const nicks = ref<NickRow[]>([]);
const loading = ref(false);
const showUnlockModal = ref(false);
const flipping = ref<string | null>(null);

const panelOpen = ref(false);
const selectedNick = ref<NickRow | null>(null);

const expandedNicks = reactive(new Set<string>());

const unlockDurationLabel = '15 phút – 24 giờ';

onMounted(async () => {
  await Promise.all([store.fetchStatus(true), loadNicks()]);
});

async function loadNicks() {
  loading.value = true;
  try {
    // Anh chốt 2026-05-22: Privacy chỉ thấy nick mình là owner (chính chủ).
    // Endpoint /privacy/my-nicks đã filter sẵn theo ownerUserId = currentUser.
    const { data } = await api.get('/privacy/my-nicks');
    const all: any[] = data.nicks ?? [];
    nicks.value = all.map((a: any) => ({
      id: a.id,
      displayName: a.displayName,
      avatarUrl: a.avatarUrl,
      phone: a.phone,
      zaloUid: a.zaloUid,
      status: a.status,
      privacyMode: (a.privacyMode ?? 'sub') as 'main' | 'sub',
      isOwner: true, // all returned nicks are owned by current user by definition
    }));
  } catch (e) {
    console.warn('Load nicks failed', e);
    nicks.value = [];
  } finally {
    loading.value = false;
  }
}

const countMain = computed(() => nicks.value.filter((n) => n.privacyMode === 'main').length);
const ownNickCount = computed(() => nicks.value.filter((n) => n.isOwner).length);
const pinAccentColor = computed(() =>
  !store.hasPin ? '#d9a441' : store.isUnlocked ? '#0a2e0e' : '#aa2d00'
);

function nickAccent(n: NickRow): string {
  if (!n.isOwner) return '#1b61c9';
  return n.privacyMode === 'main' ? '#aa2d00' : '#0a2e0e';
}

async function flipMode(nickId: string, newMode: 'main' | 'sub', evt?: Event) {
  if (newMode === 'main' && !store.hasPin) {
    if (evt && evt.target) (evt.target as HTMLInputElement).checked = false;
    alert('Bạn cần setup PIN trước khi bật Riêng tư cho nick.');
    showUnlockModal.value = true;
    return;
  }
  flipping.value = nickId;
  try {
    await store.flipNickPrivacyMode(nickId, newMode);
    await loadNicks();
  } catch (e: any) {
    alert(e?.response?.data?.error || 'Lỗi flip mode');
  } finally {
    flipping.value = null;
  }
}

function toggleExpand(id: string) {
  if (expandedNicks.has(id)) expandedNicks.delete(id);
  else expandedNicks.add(id);
}

function openPanel(n: NickRow) {
  selectedNick.value = n;
  panelOpen.value = true;
}
function closePanel() {
  panelOpen.value = false;
  selectedNick.value = null;
}
async function onChanged() {
  await loadNicks();
  // Refresh selectedNick from updated nicks list
  if (selectedNick.value) {
    const updated = nicks.value.find((n) => n.id === selectedNick.value!.id);
    if (updated) selectedNick.value = updated;
  }
}

async function lockNow() {
  if (!confirm('Khoá tất cả phiên Riêng tư ngay bây giờ?')) return;
  await store.lock();
}

function onUnlocked() {
  store.fetchStatus(true);
}

function statusLabel(s: string): string {
  if (s === 'connected') return '🟢 Đã kết nối';
  if (s === 'disconnected') return '⚪ Ngắt kết nối';
  if (s === 'qr_pending') return '🟡 Chờ QR';
  return s;
}
function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleString('vi-VN'); } catch { return iso; }
}
function uaShort(ua: string | null): string {
  if (!ua) return 'unknown UA';
  return ua.length > 60 ? ua.slice(0, 60) + '...' : ua;
}
function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarColor(name: string): string {
  const colors = ['#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9', '#7a2000', '#1a3866'];
  const h = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return colors[h % colors.length];
}
</script>

<style>
.privacy-page { padding-top: 28px; }

/* PIN special card */
.pin-card {
  display: flex;
  background: white;
  border: 1px solid #e0e2e6;
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 24px;
  box-shadow: 0 1px 2px rgba(24,29,38,0.04);
}
.pin-card.pin-unlocked { background: linear-gradient(135deg, #f8fafc 0%, #e3ede4 100%); }
.pin-card.pin-locked { background: linear-gradient(135deg, #f8fafc 0%, #fdf3df 100%); }
.pin-accent { width: 6px; flex: 0 0 6px; }
.pin-body { flex: 1; padding: 16px 20px; }
.pin-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 14px;
}
.pin-eyebrow {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: #9297a0;
  margin-bottom: 4px;
}
.pin-title {
  margin: 0;
  font-size: 18px;
  font-weight: 500;
  color: #181d26;
}
.pin-actions { flex-shrink: 0; }
.pin-info { padding-top: 4px; }

.section-divider {
  margin: 24px 0 12px;
}
.section-divider-title {
  font-size: 14px;
  font-weight: 600;
  color: #181d26;
  margin: 0 0 4px;
}
.section-divider-sub {
  font-size: 12px;
  color: #41454d;
  margin: 0;
}

/* Nick cards grid */
.nick-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 12px;
}

.nick-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: white;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  object-fit: cover;
}

.tag-private { background: #fbe6dc !important; color: #7a2000 !important; }
.tag-public { background: #e3ede4 !important; color: #0a2e0e !important; }

.mono { font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; font-size: 12px; }

.inline-quick-toggle {
  margin-top: 8px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px dashed #e0e2e6;
  border-radius: 8px;
}

/* Sessions list */
.session-list-v2 {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.session-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: white;
  border: 1px solid #e0e2e6;
  border-radius: 8px;
}
.session-icon { font-size: 20px; }
.session-info { flex: 1; min-width: 0; }
.session-time { font-size: 13px; color: #181d26; }
.session-meta { font-size: 11px; color: #9297a0; margin-top: 2px; }
</style>
