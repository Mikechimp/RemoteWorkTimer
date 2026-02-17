const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendNotification: (title, body) => {
    return ipcRenderer.invoke('send-notification', { title, body });
  },
});
