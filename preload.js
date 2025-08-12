// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scopeAPI', {
  listPorts: () => ipcRenderer.invoke('serial:list'),
  open: (opts) => ipcRenderer.invoke('serial:open', opts),
  close: () => ipcRenderer.invoke('serial:close'),
  onStatus: (cb) => ipcRenderer.on('serial:status', (_, msg) => cb(msg)),
  onFrame: (cb) => ipcRenderer.on('serial:frame', (_, frameBuf) => cb(frameBuf))
});
