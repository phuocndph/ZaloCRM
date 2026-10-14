const { contextBridge, ipcRenderer } = require('electron');
const role = process.argv.find((arg) => arg.startsWith('--zalocrm-role='))?.split('=')[1] ?? 'none';
const origin = process.argv.find((arg) => arg.startsWith('--zalocrm-origin='))?.slice('--zalocrm-origin='.length);
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

if (process.isMainFrame && role === 'bubble' && location.protocol === 'file:') {
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
  });
}
