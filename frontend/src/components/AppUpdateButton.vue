<template>
  <button type="button" class="update-button" :class="`update-button--${surface}`" :title="title" aria-label="Bản cập nhật ứng dụng Windows" @click="open">
    <Download :size="surface === 'desktop' ? 17 : 18" />
    <span v-if="surface === 'desktop'" class="update-label">Cập nhật</span>
    <span v-if="release.hasUpdate.value" class="update-dot" aria-label="Có bản mới" />
  </button>

  <v-dialog v-model="dialog" max-width="520">
    <v-card class="update-dialog">
      <v-card-title class="update-title"><Download :size="20" /> Cập nhật ZaloCRM Windows</v-card-title>
      <v-card-text>
        <div v-if="release.loading.value && !release.latest.value" class="update-state">Đang kiểm tra bản mới…</div>
        <div v-else-if="release.latest.value" class="update-content">
          <div class="update-versions">
            <span><small>Phiên bản đang cài</small><strong>{{ release.currentVersion.value || 'Không xác định' }}</strong></span>
            <span><small>Phiên bản mới nhất</small><strong>{{ release.latest.value.version }}</strong></span>
          </div>
          <p v-if="release.currentVersion.value && !release.hasUpdate.value" class="update-ok">Máy này đang dùng bản mới nhất.</p>
          <p v-else class="update-ready">Có bộ cài mới cho Windows 64-bit.</p>
          <ul v-if="release.latest.value.notes.length" class="update-notes">
            <li v-for="note in release.latest.value.notes" :key="note">{{ note }}</li>
          </ul>
          <dl class="update-meta">
            <div><dt>Ngày phát hành</dt><dd>{{ publishedAt }}</dd></div>
            <div><dt>Dung lượng</dt><dd>{{ size }}</dd></div>
            <div><dt>SHA-256</dt><dd :title="release.latest.value.sha256">{{ release.latest.value.sha256.slice(0, 16) }}…</dd></div>
          </dl>
          <div v-if="release.installing.value || release.updateStatus.value" class="update-progress" aria-live="polite">
            <div><span>{{ installStatus }}</span><strong v-if="progress !== null">{{ progress }}%</strong></div>
            <v-progress-linear v-if="progress !== null" :model-value="progress" color="primary" height="6" rounded />
          </div>
          <p class="update-warning">{{ release.canInstallNatively.value ? 'Bộ cài được kiểm tra SHA-256 trước khi mở. Ứng dụng sẽ yêu cầu xác nhận trước khi cài và bộ cài chưa ký số.' : 'Tải xong, đóng ZaloCRM Windows rồi chạy bộ cài. Bản hiện tại chưa tự cài đặt và bộ cài chưa ký số.' }}</p>
        </div>
        <div v-else class="update-state">Chưa có bộ cài Windows được công bố.</div>
        <p v-if="release.error.value" class="update-error">{{ release.error.value }}</p>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" :loading="release.loading.value" :disabled="release.installing.value" @click="release.refresh()">Kiểm tra lại</v-btn>
        <v-spacer />
        <v-btn variant="text" :disabled="release.installing.value" @click="dialog = false">Đóng</v-btn>
        <v-btn v-if="release.latest.value" color="primary" prepend-icon="mdi-download" :loading="release.installing.value" @click="install">{{ release.canInstallNatively.value ? 'Tải và cài đặt' : 'Tải bộ cài' }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Download } from 'lucide-vue-next';
import { useDesktopRelease } from '@/composables/use-desktop-release';
import { desktopBridge } from '@/composables/desktop-bridge';

withDefaults(defineProps<{ surface?: 'nav' | 'mobile' | 'desktop' }>(), { surface: 'nav' });
const release = useDesktopRelease();
const dialog = ref(false);
const title = computed(() => release.hasUpdate.value ? `Có bản ZaloCRM ${release.latest.value?.version}` : 'Cập nhật ứng dụng Windows');
const publishedAt = computed(() => release.latest.value ? new Date(release.latest.value.publishedAt).toLocaleDateString('vi-VN') : '');
const size = computed(() => release.latest.value ? `${(release.latest.value.bytes / 1024 / 1024).toFixed(1)} MB` : '');
const progress = computed(() => {
  const status = release.updateStatus.value;
  if (!status?.total || status.phase !== 'downloading') return null;
  return Math.max(0, Math.min(100, Math.floor(((status.received || 0) / status.total) * 100)));
});
const installStatus = computed(() => {
  const phase = release.updateStatus.value?.phase;
  if (phase === 'verified') return 'Đã kiểm tra bộ cài, chờ xác nhận';
  if (phase === 'launching') return 'Đang mở bộ cài đặt';
  if (phase === 'cancelled') return 'Đã hủy cài đặt';
  if (phase === 'failed') return 'Tải hoặc kiểm tra bộ cài không thành công';
  return 'Đang tải bộ cài đặt';
});
function open() {
  if (desktopBridge()?.openUpdater) { desktopBridge()!.openUpdater!(); return; }
  dialog.value = true; release.markSeen(); if (!release.latest.value) void release.refresh();
}
async function install() { if (await release.install()) dialog.value = false; }
</script>

<style scoped>
.update-button { width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center; position: relative; border: 0; border-radius: 7px; background: transparent; cursor: pointer; color: inherit; }
.update-button:hover { background: rgba(255,255,255,.08); }
.update-button--mobile:hover, .update-button--desktop:hover { background: rgba(12,105,80,.1); color: #087058; }
.update-button--desktop { display: flex; gap: 5px; justify-content: center; width: 86px; flex-basis: 86px; }.update-label { font-size: 11px; white-space: nowrap; }
.update-dot { position: absolute; top: 3px; right: 3px; width: 8px; height: 8px; border-radius: 50%; background: #ffca28; box-shadow: 0 0 0 2px #123442; }
.update-button--mobile .update-dot, .update-button--desktop .update-dot { box-shadow: 0 0 0 2px #fff; background: #d9344b; }
.update-dialog { border-radius: 8px; }.update-title { display: flex; align-items: center; gap: 9px; font-size: 17px; }
.update-state { padding: 18px 0; color: #64748b; text-align: center; }.update-content { display: grid; gap: 14px; }
.update-versions { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
.update-versions span { padding: 12px; display: grid; gap: 3px; }.update-versions span + span { border-left: 1px solid #e2e8f0; }
.update-versions small { color: #64748b; font-size: 11px; }.update-versions strong { font-size: 16px; }
.update-ok, .update-ready, .update-warning, .update-error { margin: 0; font-size: 13px; }.update-ok { color: #167447; }.update-ready { color: #9a6700; font-weight: 600; }
.update-notes { margin: 0; padding-left: 20px; display: grid; gap: 5px; font-size: 13px; }.update-meta { margin: 0; display: grid; gap: 6px; font-size: 12px; }
.update-meta div { display: flex; gap: 12px; }.update-meta dt { width: 110px; color: #64748b; }.update-meta dd { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.update-warning { padding: 10px; background: #fff7dd; color: #72550b; border-radius: 6px; line-height: 1.45; }.update-error { color: #b42318; margin-top: 10px; }
.update-progress { display: grid; gap: 7px; padding: 10px; border: 1px solid #dbe7e2; border-radius: 6px; color: #275b4d; font-size: 12px; }.update-progress > div { display: flex; justify-content: space-between; gap: 12px; }
@media (max-width: 520px) { .update-versions { grid-template-columns: 1fr; }.update-versions span + span { border-left: 0; border-top: 1px solid #e2e8f0; } }
</style>
