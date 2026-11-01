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
    weight: 1,
    berechnung: 'durchschnitte',
    gruppierung: true,
    ohne: [],
    gruppen: [{ id: g, name: 'Schriftlich', kurz: 'S', weight: 1 }],
    bereiche: [
      { id: uid(), name: 'Klassenarbeiten', kurz: 'KA', weight: 1, gruppeId: g, color: COLORS[0] },
      { id: uid(), name: 'Mündlich', kurz: 'M', weight: 1, color: COLORS[1] },
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

// ---------- Speicherort: Datei (Mac-App) oder localStorage (Browser) ----------
const desktop = typeof window !== 'undefined' ? window.notenappDesktop : undefined;
export const isDesktop = !!desktop;

export function readRaw() {
  try {
    return JSON.parse(desktop ? desktop.load() : localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

async function writeRaw(str) {
  if (desktop) await desktop.save(str);
  else localStorage.setItem(KEY, str);
}

export async function unlock(password) {
  const raw = readRaw();
  const salt = unb64(raw.salt);
  const key = await deriveKey(password, salt);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(raw.iv) }, key, unb64(raw.data));
  return { data: JSON.parse(dec.decode(pt)), crypt: { key, salt } };
}

// ---------- Passwort pro Klasse ----------
async function sealKlasse(k, ck) {
  const { encrypted, ...box } = await encryptJson(k, ck.key, ck.salt);
  return { id: k.id, name: k.name, schuljahr: k.schuljahr, sealed: box };
}

async function unsealKlasse(k, password) {
  const salt = unb64(k.sealed.salt);
  const key = await deriveKey(password, salt);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(k.sealed.iv) }, key, unb64(k.sealed.data));
  return { klasse: JSON.parse(dec.decode(pt)), ck: { key, salt } };
}

export async function persist(data, crypt, classKeys = {}) {
  const out = {
    ...data,
    klassen: await Promise.all(data.klassen.map((k) => (!k.sealed && classKeys[k.id] ? sealKlasse(k, classKeys[k.id]) : k))),
  };
  const payload = crypt ? await encryptJson(out, crypt.key, crypt.salt) : { encrypted: false, data: out };
  await writeRaw(JSON.stringify(payload));
}

/** Zentraler App-Zustand. Jede Änderung wird automatisch gespeichert (250 ms verzögert). */
export function useStore() {
  const raw = readRaw();
  const [locked, setLocked] = useState(!!raw?.encrypted);
  const [data, setData] = useState(() => (raw && !raw.encrypted ? migrate(raw.data) : emptyData()));
  const [saveState, setSaveState] = useState('saved');
  const crypt = useRef(null);
  const classKeys = useRef({});
  const timer = useRef(null);
  const latest = useRef(data);
  latest.current = data;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (lockedRef.current) return;
    await persist(latest.current, crypt.current, classKeys.current);
    setSaveState('saved');
  }, []);

  useEffect(() => {
    if (locked) return;
    setSaveState('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush().catch((e) => setSaveState('error:' + e.message)), 250);
  }, [data, locked, flush]);

  // Mac-App: vor dem Beenden alles sofort sichern
  useEffect(() => desktop?.onFlushRequest?.(flush), [flush]);
  useEffect(() => {
    const h = () => persist(latest.current, crypt.current, classKeys.current);
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const update = useCallback((fn) => {
    setData((prev) => {
      const draft = structuredClone(prev);
      fn(draft);
      return draft;
    });
  }, []);

  async function lockKlassen() {
    const ids = Object.keys(classKeys.current);
    if (!ids.length) return;
    const sealed = await Promise.all(
      latest.current.klassen.map((k) => (!k.sealed && classKeys.current[k.id] ? sealKlasse(k, classKeys.current[k.id]) : k)),
    );
    classKeys.current = {};
    setData((d) => ({ ...d, klassen: sealed }));
  }

  return {
    data,
    update,
    setData,
    locked,
    saveState,
    flush,
    hasPassword: () => !!crypt.current,
    hasKlassePassword: (id) => !!classKeys.current[id],
    anyKlassePassword: () => Object.keys(classKeys.current).length > 0,
    async tryUnlock(pw) {
      const res = await unlock(pw);
      crypt.current = res.crypt;
      setData(migrate(res.data));
      setLocked(false);
    },
    async lock() {
      if (crypt.current) {
        await persist(latest.current, crypt.current, classKeys.current);
        crypt.current = null;
        classKeys.current = {};
        setData(emptyData());
        setLocked(true);
      } else await lockKlassen();
    },
    lockKlassen,
    async setPassword(pw) {
      crypt.current = pw ? await createKey(pw) : null;
      await persist(latest.current, crypt.current, classKeys.current);
    },
    async setKlassePassword(id, pw) {
      if (pw) classKeys.current[id] = await createKey(pw);
      else delete classKeys.current[id];
      await persist(latest.current, crypt.current, classKeys.current);
      setData((d) => ({ ...d }));
    },
    async unlockKlasse(id, pw) {
      const k = latest.current.klassen.find((x) => x.id === id);
      const { klasse, ck } = await unsealKlasse(k, pw);
      classKeys.current[id] = ck;
      const [m] = migrate({ klassen: [klasse] }).klassen;
      setData((d) => ({ ...d, klassen: d.klassen.map((x) => (x.id === id ? m : x)) }));
    },
  };
}

export function migrate(d) {
  const out = { ...emptyData(), ...d };
  out.prefs = { ...emptyData().prefs, ...(d?.prefs || {}) };
  out.klassen = (out.klassen || []).map((k) =>
    k.sealed
      ? k
      : {
          ...newKlasse(k.name, k.schuljahr),
          ...k,
          settings: { ...DEFAULT_SETTINGS, ...(k.settings || {}) },
          faecher: (k.faecher || []).map((f) => ({
            weight: 1,
            berechnung: 'durchschnitte',
            gruppierung: (f.gruppen || []).length > 0,
            ohne: [],
            ...f,
          })),
        },
  );
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
    faecher: structuredClone(k.faecher).map((f) => ({ ...f, ohne: (f.ohne || []).map((x) => idMap[x]).filter(Boolean) })),
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
