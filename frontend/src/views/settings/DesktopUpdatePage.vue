<template>
  <section class="desktop-update-page">
    <header><div class="update-page-icon"><Download :size="23" /></div><div><h1>Cập nhật ứng dụng Windows</h1><p>Tải bộ cài ZaloCRM mới nhất cho máy tính.</p></div></header>
    <div class="update-page-panel">
      <div class="version-row"><span><small>Phiên bản đang cài</small><strong>{{ release.currentVersion.value || 'Không xác định' }}</strong></span><ArrowRight :size="20" /><span><small>Phiên bản mới nhất</small><strong>{{ release.latest.value?.version || 'Chưa công bố' }}</strong></span></div>
      <p v-if="release.latest.value" class="release-date">Phát hành {{ publishedAt }} · {{ size }} · Windows 64-bit</p>
      <ul v-if="release.latest.value?.notes.length"><li v-for="note in release.latest.value.notes" :key="note">{{ note }}</li></ul>
      <p v-if="release.error.value" class="error">{{ release.error.value }}</p>
      <div v-if="release.installing.value || release.updateStatus.value" class="progress" aria-live="polite"><div><span>{{ installStatus }}</span><strong v-if="progress !== null">{{ progress }}%</strong></div><v-progress-linear v-if="progress !== null" :model-value="progress" color="primary" height="6" rounded /></div>
      <div class="actions"><v-btn variant="outlined" :loading="release.loading.value" :disabled="release.installing.value" @click="release.refresh()">Kiểm tra lại</v-btn><v-btn color="primary" prepend-icon="mdi-download" :loading="release.installing.value" :disabled="!release.latest.value" @click="release.install()">{{ release.canInstallNatively.value ? 'Tải và cài đặt' : 'Tải bộ cài mới nhất' }}</v-btn></div>
      <p class="notice">{{ release.canInstallNatively.value ? 'Bộ cài được kiểm tra SHA-256 trước khi mở. Ứng dụng yêu cầu xác nhận trước khi cài và bộ cài chưa ký số.' : 'Đóng ứng dụng ZaloCRM Windows trước khi chạy bộ cài. Bộ cài hiện chưa ký số và không tự chạy sau khi tải.' }}</p>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { ArrowRight, Download } from 'lucide-vue-next';
import { useDesktopRelease } from '@/composables/use-desktop-release';
const release = useDesktopRelease();
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
onMounted(() => { release.markSeen(); if (!release.latest.value) void release.refresh(); });
</script>
<style scoped>
.desktop-update-page { max-width: 760px; padding: 24px; color: #17202a; }.desktop-update-page header { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }.desktop-update-page h1 { font-size: 20px; margin: 0; }.desktop-update-page header p { color: #667085; font-size: 13px; margin: 3px 0 0; }.update-page-icon { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 7px; background: #e7f4ef; color: #087058; }
.update-page-panel { border: 1px solid #dfe4e8; border-radius: 8px; padding: 20px; background: #fff; }.version-row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 18px; }.version-row span { display: grid; gap: 4px; }.version-row small, .release-date { color: #667085; font-size: 12px; }.version-row strong { font-size: 20px; }.release-date { margin: 14px 0; }.update-page-panel ul { padding-left: 20px; font-size: 13px; line-height: 1.6; }.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }.notice { margin: 16px 0 0; padding: 10px 12px; background: #fff7dd; border-radius: 6px; color: #72550b; font-size: 12px; }.error { color: #b42318; font-size: 13px; }
.progress { display: grid; gap: 7px; padding: 10px; border: 1px solid #dbe7e2; border-radius: 6px; color: #275b4d; font-size: 12px; }.progress > div { display: flex; justify-content: space-between; gap: 12px; }
@media (max-width: 600px) { .version-row { grid-template-columns: 1fr; }.version-row > svg { transform: rotate(90deg); }.actions { flex-direction: column-reverse; }.actions :deep(.v-btn) { width: 100%; } }
</style>
