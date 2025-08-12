const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('adc', {
  listPorts: () => ipcRenderer.invoke('list-ports'),
  openPort: (opts) => ipcRenderer.invoke('open-port', opts),
  closePort: () => ipcRenderer.invoke('close-port'),
  onFrame: (cb) => ipcRenderer.on('frame', (_evt, rows) => cb(rows))
});
