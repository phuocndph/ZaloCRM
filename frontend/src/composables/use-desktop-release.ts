import { computed, readonly, ref } from 'vue';
import { api } from '@/api';
import { desktopBridge, type DesktopUpdateStatus } from '@/composables/desktop-bridge';

export interface DesktopRelease {
  version: string;
  publishedAt: string;
  notes: string[];
  platform: 'win32';
  arch: 'x64';
  filename: string;
  bytes: number;
  sha256: string;
  downloadUrl: string;
}

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const latest = ref<DesktopRelease | null>(null);
const currentVersion = ref<string | null>(null);
const loading = ref(false);
const error = ref('');
const installing = ref(false);
const updateStatus = ref<DesktopUpdateStatus | null>(null);
const owner = ref('');
const seenVersion = ref('');
let timer: ReturnType<typeof setInterval> | null = null;
let requestId = 0;
let listenersActive = false;
let stopUpdateStatus: (() => void) | null = null;

function parts(value: string): number[] {
  return value.split('-', 1)[0].split('.').map((part) => Number(part));
}

export function compareDesktopVersions(left: string, right: string): number {
  if (!VERSION_RE.test(left) || !VERSION_RE.test(right)) return 0;
  const a = parts(left), b = parts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  const aPre = left.includes('-'), bPre = right.includes('-');
  if (aPre !== bPre) return aPre ? -1 : 1;
  return left.localeCompare(right);
}

function seenKey(value: string) {
  return `desktop-release-seen:${value}`;
}

function validRelease(value: unknown): value is DesktopRelease {
  if (!value || typeof value !== 'object') return false;
  const release = value as DesktopRelease;
  return VERSION_RE.test(release.version)
    && release.platform === 'win32' && release.arch === 'x64'
    && typeof release.filename === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.exe$/i.test(release.filename)
    && Array.isArray(release.notes)
    && Number.isSafeInteger(release.bytes) && release.bytes > 0
    && /^[a-f0-9]{64}$/.test(release.sha256)
    && release.downloadUrl === `/api/v1/desktop/releases/${encodeURIComponent(release.version)}/download`;
}

async function refresh() {
  if (!owner.value || loading.value) return;
  const id = ++requestId;
  loading.value = true;
  try {
    const [response, appInfo] = await Promise.all([
      api.get('/desktop/releases/latest'),
      desktopBridge()?.appInfo?.().catch(() => null) ?? Promise.resolve(null),
    ]);
    if (id !== requestId || !owner.value) return;
    latest.value = response.data?.available && validRelease(response.data.release) ? response.data.release : null;
    currentVersion.value = appInfo && VERSION_RE.test(appInfo.version) ? appInfo.version : null;
    error.value = '';
  } catch {
    if (id === requestId) error.value = 'Không kiểm tra được bản cập nhật.';
  } finally {
    if (id === requestId) loading.value = false;
  }
}

function onWake() {
  if (document.visibilityState === 'visible' && navigator.onLine) void refresh();
}

function start(value: string) {
  if (owner.value === value && timer) return;
  stop();
  owner.value = value;
  if (!value) return;
  seenVersion.value = localStorage.getItem(seenKey(value)) || '';
  void refresh();
  timer = setInterval(() => void refresh(), 15 * 60 * 1000);
  if (!listenersActive) {
    window.addEventListener('focus', onWake);
    window.addEventListener('online', onWake);
    document.addEventListener('visibilitychange', onWake);
    listenersActive = true;
  }
}

function stop() {
  requestId += 1;
  if (timer) clearInterval(timer);
  timer = null;
  owner.value = '';
  latest.value = null;
  currentVersion.value = null;
  loading.value = false;
  error.value = '';
  installing.value = false;
  updateStatus.value = null;
  seenVersion.value = '';
  if (stopUpdateStatus) { stopUpdateStatus(); stopUpdateStatus = null; }
  if (listenersActive) {
    window.removeEventListener('focus', onWake);
    window.removeEventListener('online', onWake);
    document.removeEventListener('visibilitychange', onWake);
    listenersActive = false;
  }
}

function markSeen() {
  if (!owner.value || !latest.value) return;
  seenVersion.value = latest.value.version;
  localStorage.setItem(seenKey(owner.value), latest.value.version);
}

function download() {
  const release = latest.value;
  if (!release || !validRelease(release)) return false;
  markSeen();
  const anchor = document.createElement('a');
  anchor.href = release.downloadUrl;
  anchor.download = release.filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}

function listenForUpdateStatus() {
  if (stopUpdateStatus) return;
  const bridge = desktopBridge();
  if (!bridge?.onUpdateStatus) return;
  stopUpdateStatus = bridge.onUpdateStatus((status) => {
    if (status && ['downloading', 'verified', 'launching', 'cancelled', 'failed'].includes(status.phase)) updateStatus.value = status;
  });
}

async function install() {
  const release = latest.value;
  if (!release || !validRelease(release)) return false;
  const bridge = desktopBridge();
  if (!bridge?.installUpdate) return download();
  markSeen();
  error.value = '';
  installing.value = true;
  updateStatus.value = { phase: 'downloading', received: 0, total: release.bytes };
  listenForUpdateStatus();
  try {
    const result = await bridge.installUpdate(release);
    if (!result?.ok && !result?.cancelled) error.value = result?.error || 'Không thể cài đặt bản cập nhật.';
    return result?.ok === true;
  } catch {
    error.value = 'Không thể cài đặt bản cập nhật.';
    return false;
  } finally {
    installing.value = false;
  }
}

const hasUpdate = computed(() => !!latest.value && (
  currentVersion.value
    ? compareDesktopVersions(latest.value.version, currentVersion.value) > 0
    : latest.value.version !== seenVersion.value
));
const canInstallNatively = computed(() => typeof desktopBridge()?.installUpdate === 'function');

export function useDesktopRelease() {
  return {
    latest: readonly(latest), currentVersion: readonly(currentVersion), loading: readonly(loading),
    error: readonly(error), installing: readonly(installing), updateStatus: readonly(updateStatus),
    hasUpdate, canInstallNatively, start, stop, refresh, markSeen, download, install,
  };
}
