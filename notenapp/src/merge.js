// Drei-Wege-Merge für die Synchronisation Mac ⇄ iPhone.
//
// base   = Stand der letzten erfolgreichen Synchronisation mit diesem Gerät
// local  = aktueller Stand auf dem Mac
// remote = aktueller Stand auf dem iPhone
//
// Regeln (rekursiv, bis hinunter zur einzelnen Note):
// - Nur eine Seite hat etwas geändert → diese Änderung gilt.
// - Beide haben dasselbe geändert → egal, gleich.
// - Beide haben verschieden geändert → Objekte/Listen mit id werden feldweise weiter zusammengeführt;
//   bei echten Konflikten auf Feldebene gewinnt die Seite mit der neueren Änderung (preferRemote).
// - Gelöscht auf einer Seite, unverändert auf der anderen → gelöscht.
//   Gelöscht auf einer Seite, geändert auf der anderen → die Änderung bleibt erhalten.
// - Passwortgeschützte (versiegelte) Klassen werden als Ganzes behandelt (Vergleich über ihren Inhalts-Hash).

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isSealed = (v) => isObj(v) && isObj(v.sealed);
const isIdList = (a) => Array.isArray(a) && a.every((x) => isObj(x) && typeof x.id === 'string');

/** JSON mit sortierten Schlüsseln, damit gleiche Inhalte gleich verglichen werden. Versiegelte Klassen → Hash. */
export function stable(v) {
  if (isSealed(v)) return JSON.stringify(['sealed', v.id, v.sealed.hash || v.sealed.data]);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}

const eq = (a, b) => stable(a) === stable(b);

export function merge3(base, local, remote, preferRemote = false) {
  if (eq(local, remote)) return local;
  if (base !== undefined && eq(base, local)) return remote;
  if (base !== undefined && eq(base, remote)) return local;
  // beide verschieden geändert
  if (isObj(local) && isObj(remote) && !isSealed(local) && !isSealed(remote)) {
    return mergeObject(isObj(base) && !isSealed(base) ? base : undefined, local, remote, preferRemote);
  }
  if (isIdList(local) && isIdList(remote) && (local.length || remote.length)) {
    return mergeIdList(isIdList(base) ? base : undefined, local, remote, preferRemote);
  }
  return preferRemote ? remote : local;
}

function mergeEntry(has, b, l, r, inL, inR, preferRemote) {
  // Rückgabe: [vorhanden?, Wert]
  if (inL && inR) return [true, merge3(has ? b : undefined, l, r, preferRemote)];
  if (inL && !inR) {
    if (has) return eq(b, l) ? [false] : [true, l]; // remote gelöscht; lokal unverändert → löschen
    return [true, l]; // lokal neu
  }
  if (!inL && inR) {
    if (has) return eq(b, r) ? [false] : [true, r]; // lokal gelöscht; remote unverändert → löschen
    return [true, r]; // remote neu
  }
  return [false];
}

function mergeObject(base, local, remote, preferRemote) {
  const out = {};
  const keys = [...new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base || {})])];
  for (const k of keys) {
    const has = !!base && k in base && base[k] !== undefined;
    const inL = k in local && local[k] !== undefined;
    const inR = k in remote && remote[k] !== undefined;
    const [keep, v] = mergeEntry(has, base?.[k], local[k], remote[k], inL, inR, preferRemote);
    if (keep) out[k] = v;
  }
  return out;
}

function mergeIdList(base, local, remote, preferRemote) {
  const B = new Map((base || []).map((x) => [x.id, x]));
  const L = new Map(local.map((x) => [x.id, x]));
  const R = new Map(remote.map((x) => [x.id, x]));
  const order = [...local.map((x) => x.id), ...remote.map((x) => x.id).filter((id) => !L.has(id))];
  const out = [];
  for (const id of order) {
    const [keep, v] = mergeEntry(B.has(id), B.get(id), L.get(id), R.get(id), L.has(id), R.has(id), preferRemote);
    if (keep) out.push(v);
  }
  return out;
}

/** Synchronisierter Teil der Daten (Geräte-Einstellungen wie Design oder aktive Klasse bleiben lokal). */
export function mergeSyncData(base, local, remote) {
  const preferRemote = (remote?.changedAt || 0) > (local?.changedAt || 0);
  const klassen = merge3(base?.klassen ?? (base ? [] : undefined), local?.klassen || [], remote?.klassen || [], preferRemote);
  return { klassen, changedAt: Math.max(local?.changedAt || 0, remote?.changedAt || 0) };
}
