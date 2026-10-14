const { app, BrowserWindow, Menu, Tray, screen, session, ipcMain, shell, dialog, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { crmOrigin, sameOrigin, clampBounds, ConversationQueue, ID } = require('./policy.cjs');

const origin = crmOrigin(process.env.ZALOCRM_DESKTOP_URL);
if (process.env.ZALOCRM_DESKTOP_PROFILE) app.setPath('userData', path.resolve(process.env.ZALOCRM_DESKTOP_PROFILE));
app.setAppUserModelId('vn.joliefam.zalocrm');
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let mainWindow, chatWindow, bubbleWindow, tray;
let quitting = false;
let activeConversation = '';
const queue = new ConversationQueue();
const bubbleFile = path.join(__dirname, 'bubble.html');
const prefsFile = path.join(app.getPath('userData'), 'desktop-preferences.json');
let preferences = { bubbleEnabled: true, launchAtLogin: false };
try { const saved = JSON.parse(fs.readFileSync(prefsFile, 'utf8')); preferences = { ...preferences,
  bubbleEnabled: saved.bubbleEnabled !== false, launchAtLogin: saved.launchAtLogin === true,
  position: Number.isFinite(saved.position?.x) && Number.isFinite(saved.position?.y) ? saved.position : undefined }; } catch {}
function savePreferences() {
  fs.mkdirSync(path.dirname(prefsFile), { recursive: true });
  fs.writeFileSync(prefsFile, JSON.stringify(preferences));
}
function live(win) { return win && !win.isDestroyed(); }
function iconPath() { return path.join(__dirname, 'icon.png'); }
function options(role) { return { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
  webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: role !== 'main',
  partition: role === 'bubble' ? 'bubble' : 'persist:zalocrm', additionalArguments: [`--zalocrm-role=${role}`, `--zalocrm-origin=${origin}`] }; }
function authorized(event, roles) {
  const entries = { main: mainWindow, chat: chatWindow, bubble: bubbleWindow };
  return roles.some((role) => live(entries[role]) && event.sender === entries[role].webContents
    && event.senderFrame === event.sender.mainFrame
    && (role === 'bubble' ? event.senderFrame.url === pathToFileURL(bubbleFile).href : sameOrigin(event.senderFrame.url, origin)));
}
function broadcast() {
  const state = { ...queue.snapshot(), signedIn: !!queue.owner, bubbleEnabled: preferences.bubbleEnabled };
  for (const win of [mainWindow, chatWindow, bubbleWindow]) if (live(win)) win.webContents.send('desktop:state-changed', state);
  if (live(bubbleWindow)) {
    if (preferences.bubbleEnabled && queue.owner) bubbleWindow.showInactive(); else bubbleWindow.hide();
  }
  if (tray) { tray.setToolTip(`ZaloCRM${state.count ? ` (${state.count})` : ''}`); tray.setContextMenu(trayMenu()); }
}
function showMain(id) {
  if (!live(mainWindow)) return;
  if (id && ID.test(id)) void mainWindow.loadURL(`${origin}/chat/${encodeURIComponent(id)}`).catch(() => {});
  mainWindow.show(); mainWindow.focus();
}
function dismiss(id) { queue.remove(id); broadcast(); }
function openChat(id = queue.snapshot().items[0]?.convId ?? '') {
  if (!queue.owner) return showMain();
  if (!live(chatWindow)) {
    const work = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(760, work.width), height = Math.min(760, work.height);
    chatWindow = new BrowserWindow({ width, height, minWidth: 420, minHeight: 400, title: 'ZaloCRM - Chat',
      alwaysOnTop: true, show: false, autoHideMenuBar: true, icon: iconPath(), backgroundColor: '#ffffff', webPreferences: options('chat') });
    protect(chatWindow);
    chatWindow.on('close', (event) => { if (!quitting) { event.preventDefault(); chatWindow.hide(); activeConversation = ''; } });
    chatWindow.on('blur', () => { activeConversation = ''; });
    chatWindow.webContents.once('did-finish-load', () => { if (queue.owner) chatWindow.show(); });
    void chatWindow.loadURL(`${origin}/desktop/chat/${id ? encodeURIComponent(id) : ''}`).catch(() => {});
  } else {
    chatWindow.show(); chatWindow.focus();
    if (id) chatWindow.webContents.send('desktop:open-conversation', id);
  }
}
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Mở ZaloCRM', click: () => showMain() },
    { label: 'Mở khung chat', enabled: !!queue.owner, click: () => openChat() },
    { type: 'separator' },
    { label: 'Bong bóng chat', type: 'checkbox', checked: preferences.bubbleEnabled, click: (item) => { preferences.bubbleEnabled = item.checked; savePreferences(); broadcast(); } },
    { label: 'Khởi động cùng Windows', type: 'checkbox', checked: preferences.launchAtLogin, enabled: app.isPackaged,
      click: (item) => { preferences.launchAtLogin = item.checked; app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--background'] }); savePreferences(); } },
    { label: 'Xóa danh sách thông báo', click: () => { queue.clear(); broadcast(); } },
    { type: 'separator' }, { label: 'Thoát', click: () => app.quit() },
  ]);
}
function protect(win) {
  win.webContents.on('will-navigate', (event, url) => { if (!sameOrigin(url, origin)) event.preventDefault(); });
  win.webContents.on('will-redirect', (event, url) => { if (!sameOrigin(url, origin)) event.preventDefault(); });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url, origin) || url.startsWith(`blob:${origin}/`)) return { action: 'allow', overrideBrowserWindowOptions: {
      autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'persist:zalocrm', preload: undefined },
    } };
    try {
      const parsed = new URL(url);
      if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) {
        void dialog.showMessageBox(win, { type: 'question', message: 'Mo lien ket bang trinh duyet?', detail: parsed.origin,
          buttons: ['Huy', 'Mo'], defaultId: 0, cancelId: 0 }).then(({ response }) => { if (response === 1) void shell.openExternal(parsed.href); });
      }
    } catch {}
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child) => protect(child));
  win.webContents.on('render-process-gone', () => { queue.clear(); broadcast(); if (win === mainWindow) { queue.setOwner(null); if (live(chatWindow)) chatWindow.hide(); broadcast(); } });
}
function registerIpc() {
  ipcMain.handle('desktop:state', (event) => authorized(event, ['main', 'chat', 'bubble']) ? { ...queue.snapshot(), signedIn: !!queue.owner } : null);
  ipcMain.on('desktop:identity', (event, value) => {
    if (!authorized(event, ['main'])) return;
    const previous = queue.owner; queue.setOwner(value);
    if (previous !== queue.owner && live(chatWindow)) { chatWindow.hide(); chatWindow.webContents.send('desktop:reset'); activeConversation = ''; }
    broadcast();
  });
  ipcMain.handle('desktop:notify', (event, value) => {
    if (!authorized(event, ['main'])) return false;
    if (live(chatWindow) && chatWindow.isFocused() && activeConversation === value?.convId) return false;
    const added = queue.add(value);
    if (added) broadcast();
    return added;
  });
  ipcMain.on('desktop:dismiss', (event, id) => { if (authorized(event, ['main', 'chat']) && typeof id === 'string' && ID.test(id)) dismiss(id); });
  ipcMain.on('desktop:clear', (event) => { if (authorized(event, ['main'])) { queue.clear(); broadcast(); } });
  ipcMain.on('desktop:active', (event, id) => {
    if (!authorized(event, ['chat'])) return;
    activeConversation = typeof id === 'string' && ID.test(id) && chatWindow.isFocused() ? id : '';
    if (activeConversation) dismiss(activeConversation);
  });
  ipcMain.on('desktop:open', (event) => { if (authorized(event, ['bubble'])) openChat(); });
  ipcMain.on('desktop:main', (event, id) => { if (authorized(event, ['chat'])) showMain(typeof id === 'string' && ID.test(id) ? id : ''); });
  ipcMain.on('desktop:hide', (event) => { if (authorized(event, ['chat'])) { chatWindow.hide(); activeConversation = ''; } });
  ipcMain.on('desktop:expand', (event) => { if (authorized(event, ['chat'])) chatWindow.isMaximized() ? chatWindow.unmaximize() : chatWindow.maximize(); });
  ipcMain.on('desktop:menu', (event) => { if (authorized(event, ['bubble'])) trayMenu().popup({ window: bubbleWindow }); });
  ipcMain.on('desktop:move', (event, value) => {
    if (!authorized(event, ['bubble']) || !Number.isFinite(value?.dx) || !Number.isFinite(value?.dy)) return;
    const bounds = bubbleWindow.getBounds();
    const target = { x: bounds.x + Math.max(-100, Math.min(value.dx, 100)), y: bounds.y + Math.max(-100, Math.min(value.dy, 100)) };
    const work = screen.getDisplayNearestPoint(target).workArea;
    bubbleWindow.setBounds(clampBounds(target, work, bounds.width, bounds.height));
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
    mainWindow = new BrowserWindow({ width: 1280, height: 820, minWidth: 840, minHeight: 540,
      title: 'ZaloCRM', show: !process.argv.includes('--background'), autoHideMenuBar: true, icon: iconPath(), backgroundColor: '#ffffff', webPreferences: options('main') });
    protect(mainWindow);
    mainWindow.on('close', (event) => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
    mainWindow.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
      if (isMainFrame && code !== -3 && sameOrigin(url, origin)) {
        void dialog.showMessageBox(mainWindow, { type: 'warning', message: 'Khong ket noi duoc ZaloCRM', detail: origin,
          buttons: ['Thu lai', 'Dong'], defaultId: 0, cancelId: 1 }).then(({ response }) => { if (response === 0) mainWindow.reload(); });
      }
    });
    void mainWindow.loadURL(origin).catch(() => {});
    const work = screen.getPrimaryDisplay().workArea;
    const position = preferences.position ?? { x: work.x + work.width - 92, y: work.y + work.height - 200 };
    bubbleWindow = new BrowserWindow({ ...clampBounds(position, screen.getDisplayNearestPoint(position).workArea, 76, 76),
      frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false,
      title: 'ZaloCRM Bubble', webPreferences: options('bubble') });
    bubbleWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    bubbleWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    bubbleWindow.webContents.on('did-finish-load', broadcast);
    void bubbleWindow.loadFile(bubbleFile);
    tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 20, height: 20 }));
    tray.on('double-click', () => showMain());
    screen.on('display-removed', () => { const bounds = bubbleWindow.getBounds(); bubbleWindow.setBounds(clampBounds(bounds, screen.getDisplayNearestPoint(bounds).workArea, 76, 76)); });
    broadcast();
  });
}
