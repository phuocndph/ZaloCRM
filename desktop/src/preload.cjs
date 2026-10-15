const { contextBridge, ipcRenderer } = require('electron');
const role = process.argv.find((arg) => arg.startsWith('--zalocrm-role='))?.split('=')[1] ?? 'none';
const origin = process.argv.find((arg) => arg.startsWith('--zalocrm-origin='))?.slice('--zalocrm-origin='.length);
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

if (process.isMainFrame && role === 'preview' && location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('preview', {
    onMessage: (callback) => subscribe('desktop:preview', callback),
    open: () => ipcRenderer.send('desktop:preview-open'),
    close: () => ipcRenderer.send('desktop:preview-close'),
    hover: (value) => ipcRenderer.send('desktop:preview-hover', value),
  });
} else if (process.isMainFrame && role === 'bubble' && location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('bubble', {
    state: () => ipcRenderer.invoke('desktop:state'),
    onState: (callback) => subscribe('desktop:state-changed', callback),
    open: () => ipcRenderer.send('desktop:open'),
    menu: () => ipcRenderer.send('desktop:menu'),
    move: (dx, dy) => ipcRenderer.send('desktop:move', { dx, dy }),
  });
} else if (process.isMainFrame && location.origin === origin && ['main', 'chat'].includes(role)) {
  contextBridge.exposeInMainWorld('zaloDesktop', {
    role,
    setIdentity: (value) => ipcRenderer.send('desktop:identity', value),
    notify: (value) => ipcRenderer.invoke('desktop:notify', value),
    dismiss: (id) => ipcRenderer.send('desktop:dismiss', id),
    clear: () => ipcRenderer.send('desktop:clear'),
    active: (id) => ipcRenderer.send('desktop:active', id),
    state: () => ipcRenderer.invoke('desktop:state'),
    onState: (callback) => subscribe('desktop:state-changed', callback),
    onOpen: (callback) => subscribe('desktop:open-conversation', callback),
    onReset: (callback) => subscribe('desktop:reset', callback),
    openMain: (id) => ipcRenderer.send('desktop:main', id),
    hide: () => ipcRenderer.send('desktop:hide'),
    expand: () => ipcRenderer.send('desktop:expand'),
    setPinned: (value) => ipcRenderer.send('desktop:pin', value),
    syncUnread: (counts, revision) => ipcRenderer.invoke('desktop:unread', { counts, revision }),
    onSyncRequest: (callback) => subscribe('desktop:sync-request', callback),
    appInfo: () => ipcRenderer.invoke('desktop:app-info'),
    installUpdate: (release) => ipcRenderer.invoke('desktop:install-update', release),
    onUpdateStatus: (callback) => subscribe('desktop:update-status', callback),
  });
  if (role === 'chat') {
    // File inputs open native dialogs that otherwise look like an outside click.
    let picker = null;
    const release = () => { if (picker) { picker = null; ipcRenderer.send('desktop:hold', false); } };
    document.addEventListener('click', (event) => {
      const input = event.composedPath().find((node) => node instanceof HTMLInputElement && node.type === 'file');
      if (!input) return;
      picker = input; ipcRenderer.send('desktop:hold', true);
      input.addEventListener('change', release, { once: true }); input.addEventListener('cancel', release, { once: true });
    }, true);
    window.addEventListener('focus', () => { if (picker) setTimeout(release, 350); });
  }
}
