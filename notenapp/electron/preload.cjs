const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notenappDesktop', {
  load: () => ipcRenderer.sendSync('daten:load'),
  save: (content) => ipcRenderer.invoke('daten:save', content),
  onFlushRequest(fn) {
    const h = async () => {
      try {
        await fn();
      } finally {
        ipcRenderer.send('flush:done');
      }
    };
    ipcRenderer.on('flush:request', h);
    return () => ipcRenderer.removeListener('flush:request', h);
  },
  onMenu(fn) {
    const h = (_e, cmd) => fn(cmd);
    ipcRenderer.on('menu', h);
    return () => ipcRenderer.removeListener('menu', h);
  },
});
