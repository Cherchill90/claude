// Sync-Datei (z. B. in iCloud Drive): verschlüsselt mit einem Sync-Passwort (PBKDF2 + AES-256-GCM).
import { b64, unb64 } from './synccrypto.js';

export const SYNC_FILE = 'notenapp-sync.json';
const ITER = 200000;
const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptSyncFile(wire, password) {
  if (!password) throw new Error('Bitte zuerst ein Sync-Passwort festlegen.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(wire)));
  return JSON.stringify({ format: 'notenapp-sync', version: 1, changedAt: wire.changedAt || 0, savedAt: Date.now(), salt: b64(salt), iv: b64(iv), data: b64(ct) });
}

export async function decryptSyncFile(text, password) {
  let f;
  try {
    f = JSON.parse(text);
  } catch {
    throw new Error('Das ist keine Sync-Datei der Notenapp.');
  }
  if (f.format !== 'notenapp-sync') throw new Error('Das ist keine Sync-Datei der Notenapp.');
  if (!password) throw new Error('Bitte zuerst das Sync-Passwort eingeben.');
  try {
    const key = await deriveKey(password, unb64(f.salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.iv) }, key, unb64(f.data));
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new Error('Falsches Sync-Passwort – die Datei wurde mit einem anderen Passwort gespeichert.');
  }
}
