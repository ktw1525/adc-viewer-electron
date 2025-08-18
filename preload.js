// preload.js
// 안전한 IPC 브리지
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oscAPI', {
  listPorts: () => ipcRenderer.invoke('serial:list'),
  connect: (opts) => ipcRenderer.invoke('serial:connect', opts),
  disconnect: () => ipcRenderer.invoke('serial:disconnect'),
  onStatus: (cb) => ipcRenderer.on('serial:status', (_e, s) => cb(s)),
  onWarning: (cb) => ipcRenderer.on('serial:warning', (_e, s) => cb(s)),
  onError: (cb) => ipcRenderer.on('serial:error', (_e, s) => cb(s)),
  onSamples: (cb) => ipcRenderer.on('serial:samples', (_e, samples) => cb(samples))
});
