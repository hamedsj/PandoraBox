const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  newFolder: () => ipcRenderer.invoke('dialog:newFolder'),
})
