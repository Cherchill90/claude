// Speicherort je Plattform:
// - Mac-App (Electron): Datei in ~/Library/Application Support/Notenapp (über den Hauptprozess)
// - iPhone/iPad (Capacitor): Dateien in Library/Notenapp der App (nicht in „Dateien“ sichtbar)
// - Browser / Web-App (PWA): IndexedDB (dauerhaft, mehr Platz als localStorage)
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

const desktop = typeof window !== 'undefined' ? window.notenappDesktop : undefined;
export const isNative = !desktop && Capacitor.isNativePlatform();
export const platform = desktop ? 'mac' : isNative ? 'ios' : 'web';

const FILES = { data: 'notenapp-daten.json', pairing: 'sync-kopplung.json', base: 'sync-basis.json', filebase: 'datei-sync-basis.json' };
const DIR = 'Notenapp';
const cache = {};

// ---------- IndexedDB (Browser / Web-App) ----------
let idb = null;
const idbOpen = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open('notenapp', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const idbTx = (mode, fn) =>
  new Promise((resolve, reject) => {
    const tx = idb.transaction('files', mode);
    const out = fn(tx.objectStore('files'));
    tx.oncomplete = () => resolve(out?.result);
    tx.onerror = () => reject(tx.error);
  });

/** Muss vor dem ersten Rendern laufen (iPhone/IndexedDB lesen asynchron). */
export async function initStorage() {
  if (platform === 'web') {
    try {
      idb = await idbOpen();
      const keys = await idbTx('readonly', (st) => st.getAllKeys());
      for (const k of keys) cache[k] = await idbTx('readonly', (st) => st.get(k));
      // Umzug aus älteren Versionen (localStorage)
      for (const k of Object.keys(FILES)) {
        if (cache[k] == null) {
          const v = localStorage.getItem(lsKey(k));
          if (v != null) {
            cache[k] = v;
            await idbTx('readwrite', (st) => st.put(v, k));
          }
        }
      }
      navigator.storage?.persist?.().catch(() => {});
    } catch {
      idb = null; // z. B. privates Fenster → Rückfall auf localStorage
    }
    return;
  }
  if (!isNative) return;
  await Filesystem.mkdir({ path: DIR, directory: Directory.Library, recursive: true }).catch(() => {});
  for (const [k, f] of Object.entries(FILES)) {
    try {
      cache[k] = (await Filesystem.readFile({ path: `${DIR}/${f}`, directory: Directory.Library, encoding: Encoding.UTF8 })).data;
    } catch {
      cache[k] = null;
    }
  }
}

const lsKey = (name) => (name === 'data' ? 'notenapp:v1' : `notenapp:${name}`);

export function read(name) {
  if (name === 'data' && desktop) return desktop.load();
  if (name !== 'data' && desktop) return desktop.readNamed?.(name) ?? null;
  if (isNative || idb) return cache[name] ?? null;
  try {
    return localStorage.getItem(lsKey(name));
  } catch {
    return null;
  }
}

export async function write(name, str) {
  if (name === 'data' && desktop) return desktop.save(str);
  if (isNative) {
    JSON.parse(str); // nur gültiges JSON speichern
    await Filesystem.writeFile({ path: `${DIR}/${FILES[name]}`, directory: Directory.Library, data: str, encoding: Encoding.UTF8, recursive: true });
    cache[name] = str;
    return;
  }
  if (desktop) return desktop.writeNamed(name, str);
  if (idb) {
    cache[name] = str;
    await idbTx('readwrite', (st) => st.put(str, name));
    return;
  }
  localStorage.setItem(lsKey(name), str);
}

export async function remove(name) {
  if (desktop) return desktop.writeNamed(name, null);
  if (idb) {
    delete cache[name];
    await idbTx('readwrite', (st) => st.delete(name));
    return;
  }
  if (isNative) {
    await Filesystem.deleteFile({ path: `${DIR}/${FILES[name]}`, directory: Directory.Library }).catch(() => {});
    cache[name] = null;
    return;
  }
  try {
    localStorage.removeItem(lsKey(name));
  } catch {
    /* ignorieren */
  }
}

export const readJson = (name) => {
  try {
    return JSON.parse(read(name));
  } catch {
    return null;
  }
};
