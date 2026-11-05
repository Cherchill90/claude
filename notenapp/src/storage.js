// Speicherort je Plattform:
// - Mac-App (Electron): Datei in ~/Library/Application Support/Notenapp (über den Hauptprozess)
// - iPhone/iPad (Capacitor): Dateien in Library/Notenapp der App (nicht in „Dateien“ sichtbar)
// - Browser: localStorage
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';

const desktop = typeof window !== 'undefined' ? window.notenappDesktop : undefined;
export const isNative = !desktop && Capacitor.isNativePlatform();
export const platform = desktop ? 'mac' : isNative ? 'ios' : 'web';

const FILES = { data: 'notenapp-daten.json', pairing: 'sync-kopplung.json', base: 'sync-basis.json' };
const DIR = 'Notenapp';
const cache = {};

/** Muss vor dem ersten Rendern laufen (iPhone liest Dateien asynchron). */
export async function initStorage() {
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
  if (isNative) return cache[name] ?? null;
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
  localStorage.setItem(lsKey(name), str);
}

export async function remove(name) {
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
