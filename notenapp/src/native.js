// iPhone/iPad: Backups, Exporte in „Dateien“, Lebenszyklus der App.
import { App } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { isNative, read } from './storage.js';

const BACKUP_DIR = 'Backups';
const EXPORT_DIR = 'Exporte';
const KEEP_MONTHS = 3;
const RE = /^Notenapp-Backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(-[\w-]+)?\.json$/;
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

/** Backup der Datendatei in „Dateien → Auf meinem iPhone → Notenapp → Backups“. */
let lastBackedUp = null;
export async function backupNow(suffix = '') {
  if (!isNative) return null;
  const data = read('data');
  if (!data || data === lastBackedUp) return null; // unverändert seit dem letzten Backup
  lastBackedUp = data;
  const path = `${BACKUP_DIR}/Notenapp-Backup-${stamp()}${suffix ? '-' + suffix : ''}.json`;
  await Filesystem.writeFile({ path, directory: Directory.Documents, data, encoding: Encoding.UTF8, recursive: true });
  await cleanupBackups();
  return path;
}

/** Backups älter als 3 Monate löschen. */
export async function cleanupBackups(now = new Date()) {
  if (!isNative) return [];
  const limit = new Date(now);
  limit.setMonth(limit.getMonth() - KEEP_MONTHS);
  let files = [];
  try {
    files = (await Filesystem.readdir({ path: BACKUP_DIR, directory: Directory.Documents })).files;
  } catch {
    return [];
  }
  const removed = [];
  for (const f of files) {
    const m = f.name.match(RE);
    if (!m) continue;
    if (new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) < limit) {
      await Filesystem.deleteFile({ path: `${BACKUP_DIR}/${f.name}`, directory: Directory.Documents }).catch(() => {});
      removed.push(f.name);
    }
  }
  return removed;
}

/** Exporte (CSV, Sicherheitskopie) landen in „Dateien → Auf meinem iPhone → Notenapp → Exporte“. */
export async function saveExport(filename, blob) {
  const text = await blob.text();
  const path = `${EXPORT_DIR}/${filename.replace(/[\\/:*?"<>|]/g, '_')}`;
  await Filesystem.writeFile({ path, directory: Directory.Documents, data: text, encoding: Encoding.UTF8, recursive: true });
  alert(`Gespeichert in der App „Dateien“:\nAuf meinem iPhone → Notenapp → ${path}`);
}

/** App geht in den Hintergrund / kommt zurück. */
export function onAppState(fn) {
  if (!isNative) return () => {};
  const p = App.addListener('appStateChange', ({ isActive }) => fn(isActive));
  return () => p.then((h) => h.remove());
}
