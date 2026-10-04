// Preload for the Remote Control settings window (remote-control-panel.html).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('remotePanel', Object.freeze({
  getStatus: () => ipcRenderer.invoke('remote-panel-v1:get-status'),
  setEnabled: enabled => ipcRenderer.invoke('remote-panel-v1:set-enabled', enabled === true),
  regenerateToken: () => ipcRenderer.invoke('remote-panel-v1:regenerate-token'),
  copyLink: index => ipcRenderer.invoke('remote-panel-v1:copy-link', Number(index) || 0),
  join: input => ipcRenderer.invoke('remote-panel-v1:join', String(input || '')),
  onStatus: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('remote-panel-v1:status', listener);
    return () => ipcRenderer.removeListener('remote-panel-v1:status', listener);
  }
}));
