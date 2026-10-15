const { app, BrowserWindow, Menu, Tray, screen, session, ipcMain, shell, dialog, nativeImage, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { crmOrigin, sameOrigin, desktopRelease, compareVersions, clampBounds, adjacentBounds, shouldAutoHide, notification, ConversationQueue, ID } = require('./policy.cjs');
const { downloadVerifiedInstaller, latestGithubRelease } = require('./update.cjs');

const origin = crmOrigin(process.env.ZALOCRM_DESKTOP_URL);
if (process.env.ZALOCRM_DESKTOP_PROFILE) app.setPath('userData', path.resolve(process.env.ZALOCRM_DESKTOP_PROFILE));
app.setAppUserModelId('vn.joliefam.zalocrm');
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let mainWindow, chatWindow, bubbleWindow, previewWindow, updateWindow, tray;
let quitting = false, screenLocked = false, activeConversation = '', pinned = false;
let blurTimer, previewTimer, holdTimer;
let fileChooserHolding = false, nativeDialogs = 0;
let previewHovered = false;
const previewItems = new Map();
let updateInProgress = false;
let nativeRelease = null;
let nativeUpdateState = { currentVersion: app.getVersion(), latest: null, phase: 'idle', error: '', hasUpdate: false };
const children = new Set();
const queue = new ConversationQueue();
const bubbleFile = path.join(__dirname, 'bubble.html'), previewFile = path.join(__dirname, 'preview.html');
const updateFile = path.join(__dirname, 'updater.html');
const prefsFile = path.join(app.getPath('userData'), 'desktop-preferences.json');
let preferences = { bubbleEnabled: true, launchAtLogin: false, previewMode: 'content' };
try {
  const saved = JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
  preferences = { ...preferences, bubbleEnabled: saved.bubbleEnabled !== false, launchAtLogin: saved.launchAtLogin === true,
    previewMode: ['content', 'name', 'off'].includes(saved.previewMode) ? saved.previewMode : 'content',
    position: Number.isFinite(saved.position?.x) && Number.isFinite(saved.position?.y) ? saved.position : undefined };
} catch {}
function savePreferences() {
  fs.mkdirSync(path.dirname(prefsFile), { recursive: true });
  fs.writeFileSync(prefsFile, JSON.stringify(preferences));
}
function live(win) { return win && !win.isDestroyed(); }
function iconPath() { return path.join(__dirname, 'icon.png'); }
function options(role) { return { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
  webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: role !== 'main',
  partition: ['bubble', 'preview', 'updater'].includes(role) ? 'bubble' : 'persist:zalocrm', additionalArguments: [`--zalocrm-role=${role}`, `--zalocrm-origin=${origin}`] }; }
function authorized(event, roles) {
  const entries = { main: mainWindow, chat: chatWindow, bubble: bubbleWindow, preview: previewWindow, updater: updateWindow };
  return roles.some((role) => live(entries[role]) && event.sender === entries[role].webContents && event.senderFrame === event.sender.mainFrame
    && (role === 'bubble' ? event.senderFrame.url === pathToFileURL(bubbleFile).href : role === 'preview' ? event.senderFrame.url === pathToFileURL(previewFile).href : role === 'updater' ? event.senderFrame.url === pathToFileURL(updateFile).href : sameOrigin(event.senderFrame.url, origin)));
}
function state() { return { ...queue.snapshot(), signedIn: !!queue.owner, pinned, bubbleEnabled: preferences.bubbleEnabled, previewMode: preferences.previewMode }; }
function broadcast() {
  const current = state();
  // The bubble needs only a counter; preview text goes only to its short-lived toast.
  for (const win of [mainWindow, chatWindow]) if (live(win)) win.webContents.send('desktop:state-changed', current);
  if (live(bubbleWindow)) {
    bubbleWindow.webContents.send('desktop:state-changed', { count: current.count, signedIn: current.signedIn });
    if (preferences.bubbleEnabled && queue.owner && !screenLocked) bubbleWindow.showInactive(); else bubbleWindow.hide();
  }
  if (tray) { tray.setToolTip(`ZaloCRM${current.count ? ` (${current.count})` : ''}`); tray.setContextMenu(trayMenu()); }
}
function hidePreview() {
  clearTimeout(previewTimer); previewTimer = null; previewHovered = false; previewItems.clear();
  if (live(previewWindow)) { previewWindow.hide(); previewWindow.webContents.send('desktop:preview', []); }
}
function clearQueue() { queue.clear(); hidePreview(); broadcast(); }
function hideChat() { clearTimeout(blurTimer); if (live(chatWindow)) chatWindow.hide(); activeConversation = ''; }
function scheduleAutoHide() {
  clearTimeout(blurTimer); activeConversation = '';
  blurTimer = setTimeout(() => {
    if (!live(chatWindow) || !chatWindow.isVisible()) return;
    const childFocused = [...children].some((child) => live(child) && child.isFocused());
    if (shouldAutoHide({ pinned, focused: chatWindow.isFocused(), childFocused, dialogOpen: nativeDialogs > 0 || !chatWindow.isEnabled(), holding: fileChooserHolding })) hideChat();
  }, 220);
}
function showMain(id) {
  if (!live(mainWindow)) return;
  hideChat(); hidePreview();
  if (id && ID.test(id)) void mainWindow.loadURL(`${origin}/chat/${encodeURIComponent(id)}`).catch(() => {});
  mainWindow.show(); mainWindow.focus();
}
function dismiss(id) {
  queue.remove(id);
  if (previewItems.delete(id)) paintPreview();
  broadcast();
}
function positionChat() {
  if (!live(chatWindow) || chatWindow.isMaximized()) return;
  const anchor = bubbleWindow.getBounds(), work = screen.getDisplayMatching(anchor).workArea;
  const bounds = chatWindow.getBounds(); chatWindow.setBounds(adjacentBounds(anchor, work, bounds.width, bounds.height));
}
function openChat(id = '', { toggle = false } = {}) {
  if (!queue.owner || screenLocked) return showMain();
  if (toggle && live(chatWindow) && chatWindow.isVisible()) { hideChat(); return; }
  hidePreview();
  if (!live(chatWindow)) {
    const anchor = bubbleWindow.getBounds(), work = screen.getDisplayMatching(anchor).workArea;
    chatWindow = new BrowserWindow({ ...adjacentBounds(anchor, work, 540, 740), minWidth: Math.min(420, work.width), minHeight: Math.min(400, work.height), title: 'ZaloCRM - Chat',
      alwaysOnTop: true, show: false, autoHideMenuBar: true, icon: iconPath(), backgroundColor: '#ffffff', webPreferences: options('chat') });
    protect(chatWindow);
    chatWindow.on('close', (event) => { if (!quitting) { event.preventDefault(); hideChat(); } });
    chatWindow.on('blur', scheduleAutoHide);
    chatWindow.on('focus', () => { clearTimeout(blurTimer); });
    chatWindow.webContents.once('did-finish-load', () => { if (queue.owner && !screenLocked) { chatWindow.show(); chatWindow.focus(); } });
    void chatWindow.loadURL(`${origin}/desktop/chat/${id ? encodeURIComponent(id) : ''}`).catch(() => {});
  } else {
    positionChat(); chatWindow.show(); chatWindow.focus();
    if (id) chatWindow.webContents.send('desktop:open-conversation', id);
  }
}
function showPreview(value) {
  if (!value || !preferences.bubbleEnabled || preferences.previewMode === 'off' || screenLocked || !queue.owner) return;
  if (!value.announce && !previewItems.has(value.convId)) return;
  previewItems.delete(value.convId);
  previewItems.set(value.convId, { ...value, count: queue.rows.get(value.convId)?.count || 1,
    senderName: preferences.previewMode === 'name' ? '' : value.senderName,
    preview: preferences.previewMode === 'name' ? 'Bạn có tin nhắn mới' : value.preview });
  if (previewItems.size > 3) previewItems.delete(previewItems.keys().next().value);
  if (!live(previewWindow)) {
    previewWindow = new BrowserWindow({ width: 392, height: 204, frame: false, resizable: false, alwaysOnTop: true,
      skipTaskbar: true, show: false, focusable: false, transparent: true, backgroundColor: '#00000000', webPreferences: options('preview') });
    previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    previewWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    previewWindow.webContents.on('did-finish-load', paintPreview);
    void previewWindow.loadFile(previewFile);
  } else paintPreview();
}
function paintPreview() {
  if (!live(previewWindow)) return;
  if (!previewItems.size) { previewWindow.hide(); clearTimeout(previewTimer); return; }
  const anchor = bubbleWindow.getBounds();
  const work = screen.getDisplayMatching(anchor).workArea;
  const limit = Math.max(1, Math.min(3, Math.floor((work.height - 32) / 172)));
  const items = [...previewItems.values()].reverse().slice(0, limit);
  previewWindow.setBounds(adjacentBounds(anchor, work, 392, 32 + items.length * 172));
  previewWindow.webContents.send('desktop:preview', items);
  previewWindow.showInactive();
  clearTimeout(previewTimer); if (!previewHovered) previewTimer = setTimeout(hidePreview, 9000);
}
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Mở ZaloCRM', click: () => showMain() },
    { label: 'Hội thoại', enabled: !!queue.owner, click: () => openChat() },
    { label: 'Cập nhật ZaloCRM…', click: openUpdater },
    { type: 'separator' },
    { label: 'Bong bóng chat', type: 'checkbox', checked: preferences.bubbleEnabled, click: (item) => { preferences.bubbleEnabled = item.checked; hidePreview(); savePreferences(); broadcast(); } },
    { label: 'Xem trước tin mới', submenu: [
      { label: 'Hiện nội dung', type: 'radio', checked: preferences.previewMode === 'content', click: () => setPreviewMode('content') },
      { label: 'Chỉ hiện tên', type: 'radio', checked: preferences.previewMode === 'name', click: () => setPreviewMode('name') },
      { label: 'Không hiện thẻ', type: 'radio', checked: preferences.previewMode === 'off', click: () => setPreviewMode('off') },
    ] },
    { label: 'Ghim khung chat', type: 'checkbox', checked: pinned, click: (item) => { pinned = item.checked; broadcast(); } },
    { label: 'Khởi động cùng Windows', type: 'checkbox', checked: preferences.launchAtLogin, enabled: app.isPackaged,
      click: (item) => { preferences.launchAtLogin = item.checked; app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--background'] }); savePreferences(); } },
    { label: 'Ẩn thẻ tin mới', click: hidePreview },
    { type: 'separator' }, { label: 'Thoát', click: () => app.quit() },
  ]);
}
function setPreviewMode(value) { preferences.previewMode = value; hidePreview(); savePreferences(); broadcast(); }
function publishUpdateState(value) {
  nativeUpdateState = { ...nativeUpdateState, ...value };
  if (live(updateWindow)) updateWindow.webContents.send('desktop:updater-state', nativeUpdateState);
}
async function checkForUpdate() {
  if (updateInProgress || nativeUpdateState.phase === 'checking') return nativeUpdateState;
  publishUpdateState({ phase: 'checking', error: '' });
  try {
    nativeRelease = await latestGithubRelease();
    publishUpdateState({ phase: 'idle', latest: nativeRelease,
      hasUpdate: !!nativeRelease && compareVersions(nativeRelease.version, app.getVersion()) > 0 });
  } catch {
    publishUpdateState({ phase: 'failed', error: 'Không kiểm tra được bản mới. Kiểm tra kết nối mạng rồi thử lại.' });
  }
  return nativeUpdateState;
}
function openUpdater() {
  if (live(updateWindow)) { updateWindow.show(); updateWindow.focus(); return; }
  hidePreview();
  updateWindow = new BrowserWindow({ width: 500, height: 500, minWidth: 420, minHeight: 420, resizable: true,
    title: 'Cập nhật ZaloCRM', show: false, autoHideMenuBar: true, icon: iconPath(), backgroundColor: '#ffffff', webPreferences: options('updater') });
  updateWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  updateWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  updateWindow.webContents.once('did-finish-load', () => { updateWindow.show(); updateWindow.focus(); void checkForUpdate(); });
  updateWindow.on('closed', () => { updateWindow = null; });
  void updateWindow.loadFile(updateFile);
}
function emitUpdateStatus(contents, value) {
  if (!contents.isDestroyed()) contents.send('desktop:update-status', value);
  publishUpdateState(value);
}
async function installUpdate(event, value, trusted = false) {
  if (process.platform !== 'win32' || process.arch !== 'x64') return { ok: false, error: 'Máy này không hỗ trợ bộ cài Windows 64-bit.' };
  if (updateInProgress) return { ok: false, error: 'Đang tải một bản cập nhật khác.' };
  const release = trusted ? nativeRelease : desktopRelease(value, origin, app.getVersion());
  if (release && compareVersions(release.version, app.getVersion()) <= 0) return { ok: false, error: 'Máy đang dùng bản mới nhất.' };
  if (!release) return { ok: false, error: 'Thông tin bản cập nhật không hợp lệ.' };
  updateInProgress = true;
  publishUpdateState({ error: '' });
  let installer = '';
  try {
    const contents = event.sender;
    installer = await downloadVerifiedInstaller(release, app.getPath('temp'), (status) => emitUpdateStatus(contents, status));
    const owner = BrowserWindow.fromWebContents(contents) ?? mainWindow;
    const decision = await dialog.showMessageBox(owner, {
      type: 'question', title: 'Cài đặt bản cập nhật',
      message: `Bản ${release.version} đã tải và kiểm tra xong.`,
      detail: 'ZaloCRM sẽ đóng để mở bộ cài đặt. Các thay đổi chưa lưu trong cửa sổ hiện tại có thể bị mất.',
      buttons: ['Cài đặt ngay', 'Để sau'], defaultId: 0, cancelId: 1,
    });
    if (decision.response !== 0) {
      await fs.promises.rm(installer, { force: true }).catch(() => {});
      emitUpdateStatus(contents, { phase: 'cancelled' });
      return { ok: false, cancelled: true };
    }
    emitUpdateStatus(contents, { phase: 'launching' });
    const launchError = await shell.openPath(installer);
    if (launchError) {
      await fs.promises.rm(installer, { force: true }).catch(() => {});
      emitUpdateStatus(contents, { phase: 'failed', error: 'Không thể mở bộ cài đặt.' });
      return { ok: false, error: 'Không thể mở bộ cài đặt.' };
    }
    setTimeout(() => app.quit(), 500);
    return { ok: true };
  } catch {
    if (installer) await fs.promises.rm(installer, { force: true }).catch(() => {});
    emitUpdateStatus(event.sender, { phase: 'failed', error: 'Tải hoặc kiểm tra bộ cài không thành công. Vui lòng thử lại.' });
    return { ok: false, error: 'Tải hoặc kiểm tra bộ cài đặt không thành công.' };
  } finally {
    updateInProgress = false;
  }
}
function protect(win) {
  win.webContents.on('will-navigate', (event, url) => { if (!sameOrigin(url, origin)) event.preventDefault(); });
  win.webContents.on('will-redirect', (event, url) => { if (!sameOrigin(url, origin)) event.preventDefault(); });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url, origin) || url.startsWith(`blob:${origin}/`)) return { action: 'allow', overrideBrowserWindowOptions: {
      parent: win, autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'persist:zalocrm', preload: undefined },
    } };
    try {
      const parsed = new URL(url);
      if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) {
        nativeDialogs++;
        void dialog.showMessageBox(win, { type: 'question', message: 'Mở liên kết bằng trình duyệt?', detail: parsed.origin,
          buttons: ['Hủy', 'Mở'], defaultId: 0, cancelId: 0 }).then(({ response }) => { if (response === 1) void shell.openExternal(parsed.href); }).finally(() => { nativeDialogs--; scheduleAutoHide(); });
      }
    } catch {}
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child) => {
    children.add(child); protect(child);
    child.on('blur', scheduleAutoHide);
    child.on('closed', () => { children.delete(child); scheduleAutoHide(); });
  });
  win.webContents.on('render-process-gone', () => { clearQueue(); if (win === mainWindow) { queue.setOwner(null); hideChat(); broadcast(); } });
}
function registerIpc() {
  ipcMain.on('desktop:open-updater', (event) => { if (authorized(event, ['main', 'chat', 'bubble'])) openUpdater(); });
  ipcMain.handle('desktop:updater-state', (event) => authorized(event, ['updater']) ? nativeUpdateState : null);
  ipcMain.handle('desktop:check-update', (event) => authorized(event, ['updater']) ? checkForUpdate() : null);
  ipcMain.handle('desktop:apply-update', (event) => authorized(event, ['updater']) ? installUpdate(event, null, true) : { ok: false });
  ipcMain.handle('desktop:state', (event) => authorized(event, ['main', 'chat', 'bubble']) ? state() : null);
  ipcMain.handle('desktop:app-info', (event) => authorized(event, ['main', 'chat'])
    ? { version: app.getVersion(), platform: process.platform, arch: process.arch }
    : null);
  ipcMain.handle('desktop:install-update', (event, value) => authorized(event, ['main', 'chat'])
    ? installUpdate(event, value)
    : { ok: false, error: 'Yêu cầu cập nhật không hợp lệ.' });
  ipcMain.on('desktop:identity', (event, value) => {
    if (!authorized(event, ['main'])) return;
    const previous = queue.owner; queue.setOwner(value);
    if (previous !== queue.owner) {
      hidePreview(); pinned = false;
      for (const child of children) if (live(child)) child.destroy(); children.clear();
      if (live(chatWindow)) { hideChat(); chatWindow.webContents.send('desktop:reset'); }
    }
    broadcast();
  });
  ipcMain.handle('desktop:notify', (event, value) => {
    if (!authorized(event, ['main']) || screenLocked) return false;
    if (live(chatWindow) && chatWindow.isFocused() && activeConversation === value?.convId) return false;
    const added = queue.add(value, origin);
    if (added) { broadcast(); showPreview(notification(value, origin)); }
    return added;
  });
  ipcMain.handle('desktop:unread', (event, value) => {
    if (!authorized(event, ['main'])) return false;
    const accepted = queue.syncUnread(value?.counts, value?.revision);
    if (accepted) {
      for (const id of previewItems.keys()) if (!queue.unread.has(id)) previewItems.delete(id);
      paintPreview();
      broadcast();
    }
    return accepted;
  });
  ipcMain.on('desktop:dismiss', (event, id) => { if (authorized(event, ['main', 'chat']) && typeof id === 'string' && ID.test(id)) dismiss(id); });
  ipcMain.on('desktop:clear', (event) => { if (authorized(event, ['main'])) clearQueue(); });
  ipcMain.on('desktop:active', (event, id) => {
    if (!authorized(event, ['chat'])) return;
    activeConversation = typeof id === 'string' && ID.test(id) && chatWindow.isFocused() ? id : '';
    if (activeConversation) dismiss(activeConversation);
  });
  ipcMain.on('desktop:open', (event) => { if (authorized(event, ['bubble'])) openChat('', { toggle: true }); });
  ipcMain.on('desktop:main', (event, id) => { if (authorized(event, ['chat'])) showMain(typeof id === 'string' && ID.test(id) ? id : ''); });
  ipcMain.on('desktop:hide', (event) => { if (authorized(event, ['chat'])) hideChat(); });
  ipcMain.on('desktop:expand', (event) => { if (authorized(event, ['chat'])) chatWindow.isMaximized() ? chatWindow.unmaximize() : chatWindow.maximize(); });
  ipcMain.on('desktop:pin', (event, value) => { if (authorized(event, ['chat']) && typeof value === 'boolean') { pinned = value; broadcast(); if (!value) scheduleAutoHide(); } });
  ipcMain.on('desktop:hold', (event, value) => {
    if (!authorized(event, ['chat']) || typeof value !== 'boolean') return;
    clearTimeout(holdTimer); fileChooserHolding = value;
    if (value) holdTimer = setTimeout(() => { fileChooserHolding = false; scheduleAutoHide(); }, 300000);
    else scheduleAutoHide();
  });
  ipcMain.on('desktop:preview-hover', (event, value) => {
    if (!authorized(event, ['preview']) || typeof value !== 'boolean') return;
    previewHovered = value;
    clearTimeout(previewTimer); if (!value) previewTimer = setTimeout(hidePreview, 1500);
  });
  ipcMain.on('desktop:preview-open', (event, id) => { if (authorized(event, ['preview']) && typeof id === 'string' && previewItems.has(id)) openChat(id); });
  ipcMain.on('desktop:preview-close', (event, id) => { if (authorized(event, ['preview']) && typeof id === 'string' && previewItems.delete(id)) paintPreview(); });
  ipcMain.on('desktop:menu', (event) => { if (authorized(event, ['bubble'])) trayMenu().popup({ window: bubbleWindow }); });
  ipcMain.on('desktop:move', (event, value) => {
    if (!authorized(event, ['bubble']) || !Number.isFinite(value?.dx) || !Number.isFinite(value?.dy)) return;
    hidePreview();
    const bounds = bubbleWindow.getBounds();
    const target = { x: bounds.x + Math.max(-100, Math.min(value.dx, 100)), y: bounds.y + Math.max(-100, Math.min(value.dy, 100)) };
    bubbleWindow.setBounds(clampBounds(target, screen.getDisplayNearestPoint(target).workArea, bounds.width, bounds.height));
    preferences.position = bubbleWindow.getBounds();
  });
}
if (locked) {
  app.on('second-instance', () => showMain());
  app.on('before-quit', () => { quitting = true; savePreferences(); });
  app.on('window-all-closed', () => {});
  app.whenReady().then(() => {
    const crmSession = session.fromPartition('persist:zalocrm');
    crmSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => sameOrigin(requestingOrigin, origin) && permission === 'clipboard-sanitized-write');
    crmSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    registerIpc();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'ZaloCRM', submenu: [{ label: 'Mở ZaloCRM', click: () => showMain() }, { type: 'separator' }, { label: 'Thoát', click: () => app.quit() }] },
      { role: 'editMenu', label: 'Chỉnh sửa' },
      { label: 'Cập nhật', submenu: [{ label: `Phiên bản ${app.getVersion()}`, enabled: false }, { label: 'Kiểm tra bản cập nhật…', accelerator: 'CommandOrControl+Shift+U', click: openUpdater }] },
    ]));
    mainWindow = new BrowserWindow({ width: 1280, height: 820, minWidth: 840, minHeight: 540, title: 'ZaloCRM',
      show: !process.argv.includes('--background'), autoHideMenuBar: false, icon: iconPath(), backgroundColor: '#ffffff', webPreferences: options('main') });
    protect(mainWindow);
    mainWindow.on('close', (event) => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
    mainWindow.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
      if (isMainFrame && code !== -3 && sameOrigin(url, origin)) void dialog.showMessageBox(mainWindow, {
        type: 'warning', message: 'Không kết nối được ZaloCRM', detail: origin, buttons: ['Thử lại', 'Đóng'], defaultId: 0, cancelId: 1,
      }).then(({ response }) => { if (response === 0) mainWindow.reload(); });
    });
    void mainWindow.loadURL(origin).catch(() => {});
    const work = screen.getPrimaryDisplay().workArea;
    const position = preferences.position ?? { x: work.x + work.width - 92, y: work.y + work.height - 200 };
    bubbleWindow = new BrowserWindow({ ...clampBounds(position, screen.getDisplayNearestPoint(position).workArea, 76, 76),
      frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false, title: 'ZaloCRM Bubble', webPreferences: options('bubble') });
    bubbleWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    bubbleWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    bubbleWindow.webContents.on('did-finish-load', broadcast);
    void bubbleWindow.loadFile(bubbleFile);
    tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 20, height: 20 }));
    tray.on('double-click', () => showMain());
    screen.on('display-removed', () => { const bounds = bubbleWindow.getBounds(); bubbleWindow.setBounds(clampBounds(bounds, screen.getDisplayNearestPoint(bounds).workArea, 76, 76)); positionChat(); hidePreview(); });
    powerMonitor.on('lock-screen', () => { screenLocked = true; hideChat(); clearQueue(); });
    powerMonitor.on('unlock-screen', () => { screenLocked = false; broadcast(); if (live(mainWindow)) mainWindow.webContents.send('desktop:sync-request'); });
    broadcast();
  });
}
