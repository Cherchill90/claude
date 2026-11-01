import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, uid } from './grades.js';

const KEY = 'notenapp:v1';

export const DEFAULT_STRICH = [
  { id: 'hav', name: 'Hausaufgaben vergessen', kurz: 'HA' },
  { id: 'mav', name: 'Material vergessen', kurz: 'MA' },
  { id: 'mp', name: 'Mitarbeit positiv', kurz: '+' },
  { id: 'mn', name: 'Mitarbeit negativ', kurz: '−' },
  { id: 'st', name: 'Störung', kurz: 'St' },
];

export const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

export function newFach(name = 'Fach') {
  const g = uid();
  return {
    id: uid(),
    name,
    gruppen: [{ id: g, name: 'Schriftlich', weight: 1 }],
    bereiche: [
      { id: uid(), name: 'Klassenarbeiten', weight: 1, gruppeId: g, color: COLORS[0] },
      { id: uid(), name: 'Mündlich', weight: 1, color: COLORS[1] },
    ],
  };
}

export function newKlasse(name = 'Neue Klasse', schuljahr = currentSchuljahr()) {
  return {
    id: uid(),
    name,
    schuljahr,
    settings: { ...DEFAULT_SETTINGS },
    faecher: [newFach()],
    schueler: [],
    arbeiten: [],
    zeugnis: {},
    strichKategorien: DEFAULT_STRICH.map((k) => ({ ...k })),
    striche: [],
    stunden: [],
    sitzplaene: [{ id: uid(), name: 'Plan 1', rows: 5, cols: 6, seats: {} }],
  };
}

export function currentSchuljahr(d = new Date()) {
  const y = d.getFullYear();
  const start = d.getMonth() >= 7 ? y : y - 1;
  return `${start}/${String(start + 1).slice(2)}`;
}

export function emptyData() {
  return { klassen: [], activeKlasseId: null, prefs: { lockMinutes: 15, theme: 'auto' } };
}

// ---------- Verschlüsselung (AES-GCM, Schlüssel via PBKDF2 aus dem Passwort) ----------
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptJson(obj, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { encrypted: true, salt: b64(salt), iv: b64(iv), data: b64(ct) };
}

export async function createKey(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { key: await deriveKey(password, salt), salt };
}

export function readRaw() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export async function unlock(password) {
  const raw = readRaw();
  const salt = unb64(raw.salt);
  const key = await deriveKey(password, salt);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(raw.iv) }, key, unb64(raw.data));
  return { data: JSON.parse(dec.decode(pt)), crypt: { key, salt } };
}

export async function persist(data, crypt) {
  const payload = crypt ? await encryptJson(data, crypt.key, crypt.salt) : { encrypted: false, data };
  localStorage.setItem(KEY, JSON.stringify(payload));
}

/** Zentraler App-Zustand mit Auto-Speichern. */
export function useStore() {
  const raw = readRaw();
  const [locked, setLocked] = useState(!!raw?.encrypted);
  const [data, setData] = useState(() => (raw && !raw.encrypted ? migrate(raw.data) : emptyData()));
  const crypt = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    if (locked) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(data, crypt.current), 250);
  }, [data, locked]);

  const update = useCallback((fn) => {
    setData((prev) => {
      const draft = structuredClone(prev);
      fn(draft);
      return draft;
    });
  }, []);

  return {
    data,
    update,
    setData,
    locked,
    hasPassword: () => !!crypt.current,
    async tryUnlock(pw) {
      const res = await unlock(pw);
      crypt.current = res.crypt;
      setData(migrate(res.data));
      setLocked(false);
    },
    lock() {
      if (!crypt.current) return;
      persist(data, crypt.current);
      crypt.current = null;
      setData(emptyData());
      setLocked(true);
    },
    async setPassword(pw) {
      crypt.current = pw ? await createKey(pw) : null;
      await persist(data, crypt.current);
    },
  };
}

export function migrate(d) {
  const out = { ...emptyData(), ...d };
  out.prefs = { ...emptyData().prefs, ...(d?.prefs || {}) };
  out.klassen = (out.klassen || []).map((k) => ({
    ...newKlasse(k.name, k.schuljahr),
    ...k,
    settings: { ...DEFAULT_SETTINGS, ...(k.settings || {}) },
  }));
  return out;
}

/** Versetzen: Klasse mit Schülern, Fächern und Einstellungen ins neue Schuljahr kopieren. */
export function versetzeKlasse(k, newName, newSchuljahr) {
  const idMap = {};
  const schueler = k.schueler.map((s) => {
    const id = uid();
    idMap[s.id] = id;
    return { ...s, id, fachNotizen: {}, erinnerungen: {} };
  });
  return {
    ...newKlasse(newName, newSchuljahr),
    settings: { ...k.settings },
    faecher: structuredClone(k.faecher),
    schueler,
    strichKategorien: k.strichKategorien.map((x) => ({ ...x })),
    sitzplaene: k.sitzplaene.map((p) => ({
      ...p,
      id: uid(),
      seats: Object.fromEntries(Object.entries(p.seats).filter(([, v]) => idMap[v]).map(([s, v]) => [s, idMap[v]])),
    })),
    vorjahr: { klasseId: k.id, idMap },
  };
}
