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
  // Synchronisation (Mac als Server)
  onSyncRequest(fn) {
    const h = async (_e, req) => {
      try {
        const merged = await fn(req);
        ipcRenderer.send('sync:response', { reqId: req.reqId, ok: true, merged });
      } catch (err) {
        ipcRenderer.send('sync:response', { reqId: req.reqId, ok: false, error: err.message, status: err.status });
      }
    };
    ipcRenderer.on('sync:request', h);
    return () => ipcRenderer.removeListener('sync:request', h);
  },
  onSyncEvent(fn) {
    const h = (_e, ev) => fn(ev);
    ipcRenderer.on('sync:event', h);
    return () => ipcRenderer.removeListener('sync:event', h);
  },
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  syncSetEnabled: (enabled, port) => ipcRenderer.invoke('sync:setEnabled', enabled, port),
  syncStartPairing: () => ipcRenderer.invoke('sync:startPairing'),
  syncStopPairing: () => ipcRenderer.invoke('sync:stopPairing'),
  syncRemoveDevice: (id) => ipcRenderer.invoke('sync:removeDevice', id),
  onMenu(fn) {
    const h = (_e, cmd) => fn(cmd);
    ipcRenderer.on('menu', h);
    return () => ipcRenderer.removeListener('menu', h);
  },
});
