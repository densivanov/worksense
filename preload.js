const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  loadData:        ()       => ipcRenderer.invoke('load-data'),
  saveData:        (data)   => ipcRenderer.invoke('save-data', data),
  readClaudeStats: (since)  => ipcRenderer.invoke('read-claude-stats', since),
  minimize:        ()       => ipcRenderer.send('window-minimize'),
  maximize:        ()       => ipcRenderer.send('window-maximize'),
  close:           ()       => ipcRenderer.send('window-close'),
  timerUpdate:     (status) => ipcRenderer.send('timer-update', status),
  isElectron:      true
})
