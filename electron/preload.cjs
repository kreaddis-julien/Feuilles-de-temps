const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  setTrayTitle: (title) => ipcRenderer.send('set-tray-title', title),
  closeTrayPopup: () => ipcRenderer.send('close-tray-popup'),
  openMainWindow: () => ipcRenderer.send('open-main-window'),
  // Update notifier
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  updaterCheck: () => ipcRenderer.invoke('updater-check'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  onUpdaterEvent: (callback) =>
    ipcRenderer.on('updater-event', (_event, type, data) => callback(type, data)),
});
