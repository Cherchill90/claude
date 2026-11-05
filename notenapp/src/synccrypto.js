// Verschlüsselung für die Synchronisation (WebCrypto; identisches Format wie electron/synccrypto.cjs).
// Format: { iv: base64(12 Byte), data: base64(Chiffrat || 16-Byte-Tag) }, AES-256-GCM.
const enc = new TextEncoder();
const dec = new TextDecoder();
export const PAIR_ITERATIONS = 200000;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Kopplungscode normalisieren: Großbuchstaben, ohne Leer-/Bindestriche, 0→O, 1→I nicht nötig (Alphabet ohne 0/1/O/I). */
export const normCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function pairKey(code, saltB64) {
  const base = await crypto.subtle.importKey('raw', enc.encode(normCode(code)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations: PAIR_ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export const importKey = (keyB64) => crypto.subtle.importKey('raw', unb64(keyB64), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

export async function sealJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64(iv), data: b64(ct) };
}

export async function openJson(key, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.data));
  return JSON.parse(dec.decode(pt));
}
