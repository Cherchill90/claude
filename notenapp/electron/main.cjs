const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const B = require('./backup.cjs');
const { SyncServer } = require('./syncserver.cjs');
const { FileSync } = require('./filesync.cjs');
const crypto = require('crypto');

app.setName('Notenapp');
if (process.env.NOTENAPP_DATA_DIR) app.setPath('userData', process.env.NOTENAPP_DATA_DIR);
const DIR = app.getPath('userData'); // ~/Library/Application Support/Notenapp
let win = null;
let quitting = false;
let readyToQuit = false;

// ---------- Daten ----------
ipcMain.on('daten:load', (e) => {
  e.returnValue = B.readData(DIR);
});
ipcMain.handle('daten:save', (_e, content) => {
  B.writeData(DIR, content);
  return true;
});

// ---------- Synchronisation mit iPhone/iPad (WLAN) ----------
const pendingSync = new Map();
ipcMain.on('sync:response', (_e, res) => {
  const p = pendingSync.get(res.reqId);
  if (!p) return;
  pendingSync.delete(res.reqId);
  clearTimeout(p.timer);
  if (res.ok) p.resolve(res.merged);
  else p.reject(Object.assign(new Error(res.error || 'Fehler am Mac'), { status: res.status || 503 }));
});

function syncViaRenderer(req) {
  return new Promise((resolve, reject) => {
    if (!win || win.isDestroyed()) return reject(Object.assign(new Error('Das Fenster der Notenapp ist am Mac nicht geöffnet.'), { status: 503 }));
    const reqId = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingSync.delete(reqId);
      reject(Object.assign(new Error('Der Mac hat nicht rechtzeitig geantwortet.'), { status: 504 }));
    }, 60000);
    pendingSync.set(reqId, { resolve, reject, timer });
    win.webContents.send('sync:request', { ...req, reqId });
  });
}

const sync = new SyncServer({
  dir: DIR,
  onSync: syncViaRenderer,
  onEvent: (ev) => win?.webContents.send('sync:event', ev),
});
ipcMain.handle('sync:status', () => sync.status());
ipcMain.handle('sync:setEnabled', (_e, enabled, port) => sync.setEnabled(enabled, port));
ipcMain.handle('sync:startPairing', () => sync.startPairing());
ipcMain.handle('sync:stopPairing', () => sync.stopPairing());
ipcMain.handle('sync:removeDevice', (_e, id) => sync.removeDevice(id));

// ---------- Abgleich über eine Sync-Datei (iCloud Drive) ----------
const fileSync = new FileSync({ dir: DIR, onChange: () => win?.webContents.send('filesync:changed') });
ipcMain.handle('filesync:status', () => fileSync.status());
ipcMain.handle('filesync:set', (_e, patch) => fileSync.set(patch));
ipcMain.handle('filesync:read', () => fileSync.read());
ipcMain.handle('filesync:write', (_e, text, remove) => fileSync.write(text, remove));
ipcMain.handle('filesync:choose', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Ordner für die Sync-Datei wählen', defaultPath: fileSync.state.folder, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? fileSync.status() : fileSync.set({ folder: r.filePaths[0] });
});

// Weitere kleine Dateien der Oberfläche (z. B. Basis für den Datei-Abgleich)
const NAMED = { filebase: 'datei-sync-basis.json' };
ipcMain.on('named:read', (e, name) => {
  try {
    e.returnValue = NAMED[name] ? fs.readFileSync(path.join(DIR, NAMED[name]), 'utf8') : null;
  } catch {
    e.returnValue = null;
  }
});
ipcMain.handle('named:write', (_e, name, content) => {
  if (!NAMED[name]) throw new Error('Unbekannte Datei');
  const f = path.join(DIR, NAMED[name]);
  if (content == null) return fs.rmSync(f, { force: true });
  JSON.parse(content);
  fs.writeFileSync(f + '.tmp', content, { mode: 0o600 });
  fs.renameSync(f + '.tmp', f);
});

// ---------- Fenster ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Notenapp',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // Externe Links im Standardbrowser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => (win = null));
}

const send = (cmd) => win?.webContents.send('menu', cmd);

// ---------- Beenden: erst speichern, dann Backup, dann alte Backups löschen ----------
function flushRenderer(timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve();
    const done = () => {
      clearTimeout(t);
      ipcMain.removeListener('flush:done', done);
      resolve();
    };
    const t = setTimeout(done, timeoutMs);
    ipcMain.once('flush:done', done);
    win.webContents.send('flush:request');
  });
}

async function backupAndQuit() {
  try {
    await sync.stop();
    fileSync.stop();
    await flushRenderer();
    const file = B.createBackup(DIR);
    const removed = B.cleanupBackups(DIR);
    console.log('Backup:', file, '– gelöscht:', removed.length);
  } catch (e) {
    dialog.showErrorBox('Backup fehlgeschlagen', String(e?.message || e));
  }
  readyToQuit = true;
  app.quit();
}

app.on('before-quit', (e) => {
  if (readyToQuit) return;
  e.preventDefault();
  if (quitting) return;
  quitting = true;
  backupAndQuit();
});

// Fenster schließen = App beenden (damit das Backup sicher entsteht)
app.on('window-all-closed', () => app.quit());

// ---------- Backups wiederherstellen ----------
async function restoreBackup() {
  const list = B.listBackups(DIR);
  if (!list.length) return dialog.showMessageBox(win, { message: 'Es gibt noch keine Backups.', detail: 'Backups entstehen automatisch bei jedem Beenden der App.' });
  const { filePaths } = await dialog.showOpenDialog(win, {
    title: 'Backup wiederherstellen',
    defaultPath: path.join(DIR, B.BACKUP_DIR),
    filters: [{ name: 'Notenapp-Backup', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (!filePaths?.[0]) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Wiederherstellen', 'Abbrechen'],
    defaultId: 1,
    cancelId: 1,
    message: `„${path.basename(filePaths[0])}“ wiederherstellen?`,
    detail: 'Der aktuelle Stand wird vorher selbst als Backup gesichert und dann durch das gewählte Backup ersetzt.',
  });
  if (response !== 0) return;
  await flushRenderer();
  B.createBackup(DIR);
  B.writeData(DIR, fs.readFileSync(filePaths[0], 'utf8'));
  win.reload();
}

// ---------- Menü ----------
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: 'Notenapp',
          submenu: [
            { role: 'about', label: 'Über Notenapp' },
            { type: 'separator' },
            { label: 'Einstellungen …', accelerator: 'Cmd+,', click: () => send('einstellungen') },
            { type: 'separator' },
            { role: 'hide', label: 'Notenapp ausblenden' },
            { role: 'hideOthers', label: 'Andere ausblenden' },
            { role: 'unhide', label: 'Alle einblenden' },
            { type: 'separator' },
            { role: 'quit', label: 'Notenapp beenden' },
          ],
        }]
      : []),
    {
      label: 'Klasse',
      submenu: [
        { label: 'Klassen verwalten', accelerator: 'CmdOrCtrl+O', click: () => send('verwalten') },
        { label: '+ Neue Klasse anlegen', accelerator: 'CmdOrCtrl+N', click: () => send('neu') },
        { label: 'Klasse versetzen', click: () => send('versetzen') },
        { type: 'separator' },
        { label: 'Sicherheitskopie aller Klassen exportieren …', accelerator: 'CmdOrCtrl+S', click: () => send('export') },
        { label: 'Importieren …', click: () => send('import') },
        { label: 'Import von Fächern mit Noten …', click: () => send('importFach') },
        { type: 'separator' },
        { label: 'Backup wiederherstellen …', click: restoreBackup },
        { label: 'Backup-Ordner im Finder zeigen', click: () => { fs.mkdirSync(path.join(DIR, B.BACKUP_DIR), { recursive: true }); shell.openPath(path.join(DIR, B.BACKUP_DIR)); } },
        { type: 'separator' },
        { label: 'Synchronisation mit iPhone …', accelerator: 'CmdOrCtrl+Y', click: () => send('sync') },
        { label: 'Sync-Ordner im Finder zeigen', click: () => { fs.mkdirSync(fileSync.state.folder, { recursive: true }); shell.openPath(fileSync.state.folder); } },
        { type: 'separator' },
        { label: 'Sperren', accelerator: 'CmdOrCtrl+L', click: () => send('sperren') },
        { label: 'Drucken …', accelerator: 'CmdOrCtrl+P', click: () => win?.webContents.print() },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit', label: 'Beenden' }]),
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Widerrufen' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einsetzen' },
        { role: 'selectAll', label: 'Alles auswählen' },
      ],
    },
    {
      label: 'Darstellung',
      submenu: [
        { role: 'zoomIn', label: 'Größer' },
        { role: 'zoomOut', label: 'Kleiner' },
        { role: 'resetZoom', label: 'Originalgröße' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
      ],
    },
    { role: 'windowMenu', label: 'Fenster' },
    { label: 'Hilfe', role: 'help', submenu: [{ label: 'Notenapp-Hilfe', click: () => send('hilfe') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  try {
    B.cleanupBackups(DIR);
  } catch (e) {
    console.error(e);
  }
  buildMenu();
  createWindow();
  if (sync.state.enabled) sync.start();
  fileSync.restart();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
