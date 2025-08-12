const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('adc', {
  listPorts: () => ipcRenderer.invoke('list-ports'),
  openPort: (opts) => ipcRenderer.invoke('open-port', opts),
  closePort: () => ipcRenderer.invoke('close-port'),
  setSamples: (n) => ipcRenderer.invoke('set-samples', n),
  onParams: (cb) => ipcRenderer.on('params', (_e, p) => cb(p)),
  onFrame: (cb) => ipcRenderer.on('frame', (_e, rows) => cb(rows)),
});
