const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('launcher', {
  getRecentProjects: () => ipcRenderer.invoke('launcher:get-recent-projects'),
  readProjectConfig: (p) => ipcRenderer.invoke('launcher:read-project-config', p),
  checkPort: (port) => ipcRenderer.invoke('launcher:check-port', port),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  newFolder: () => ipcRenderer.invoke('dialog:newFolder'),
  launch: (opts) => ipcRenderer.invoke('launcher:launch', opts),
  close: () => ipcRenderer.invoke('launcher:close'),
})
