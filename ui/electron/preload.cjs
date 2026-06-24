const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  newFolder: () => ipcRenderer.invoke('dialog:newFolder'),
  decodeBody: (base64, encoding) => ipcRenderer.invoke('body:decode', { base64, encoding }),
  getCliStatus: () => ipcRenderer.invoke('cli:status'),
  installCli: () => ipcRenderer.invoke('cli:install'),
})
