const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  setTrayTitle: (title) => ipcRenderer.send('set-tray-title', title),
  closeTrayPopup: () => ipcRenderer.send('close-tray-popup'),
  openMainWindow: () => ipcRenderer.send('open-main-window'),
});
