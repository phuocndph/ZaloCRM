const current = document.getElementById('current');
const latest = document.getElementById('latest');
const status = document.getElementById('status');
const progress = document.getElementById('progress');
const error = document.getElementById('error');
const notes = document.getElementById('notes');
const check = document.getElementById('check');
const install = document.getElementById('install');
function render(state) {
  if (!state) return;
  const busy = ['checking', 'downloading', 'verified', 'launching'].includes(state.phase);
  current.textContent = state.currentVersion;
  latest.textContent = state.latest?.version || (state.phase === 'checking' ? '…' : 'Chưa xác định');
  notes.textContent = state.latest?.notes || ''; notes.hidden = !notes.textContent;
  error.textContent = state.error || ''; error.hidden = !state.error;
  check.disabled = busy; install.disabled = busy || !state.hasUpdate;
  progress.hidden = state.phase !== 'downloading';
  if (state.phase === 'checking') status.textContent = 'Đang kiểm tra bản mới…';
  else if (state.phase === 'downloading') {
    const percent = state.total ? Math.max(0, Math.min(100, Math.floor((state.received || 0) / state.total * 100))) : 0;
    progress.value = percent; status.textContent = `Đang tải bản cập nhật · ${percent}%`;
  } else if (state.phase === 'verified') status.textContent = 'Đã tải xong. Chờ xác nhận cài đặt.';
  else if (state.phase === 'launching') status.textContent = 'Đang mở bộ cài đặt…';
  else if (state.phase === 'cancelled') status.textContent = 'Đã hoãn cài đặt.';
  else if (state.hasUpdate) status.textContent = 'Phiên bản mới đã sẵn sàng.';
  else status.textContent = state.latest ? 'Bạn đang dùng phiên bản mới nhất.' : 'Chưa kiểm tra được bản cập nhật.';
}
window.desktopUpdater.onState(render);
void window.desktopUpdater.state().then(render);
check.addEventListener('click', () => { void window.desktopUpdater.check().then(render); });
install.addEventListener('click', async () => {
  install.disabled = true;
  let result;
  try {
    result = await window.desktopUpdater.install();
  } catch {
    result = { error: 'Không thể cài đặt bản cập nhật. Vui lòng thử lại.' };
  } finally { render(await window.desktopUpdater.state()); }
  if (result?.error) { error.textContent = result.error; error.hidden = false; }
});
