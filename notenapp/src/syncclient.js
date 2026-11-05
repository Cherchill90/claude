// iPhone-Seite der Synchronisation: Mac im WLAN koppeln und Daten abgleichen.
import { importKey, openJson, pairKey, sealJson } from './synccrypto.js';

const TIMEOUT = 20000;

function baseUrl(host, port) {
  const h = String(host || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return `http://${h.includes(':') && !h.startsWith('[') ? h : h}:${port || 12980}`;
}

async function call(host, port, path, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  let res;
  try {
    res = await fetch(baseUrl(host, port) + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
  } catch {
    throw new Error(
      `Mac nicht erreichbar (${host}:${port || 12980}). Sind iPhone und Mac im selben WLAN, ist die Notenapp am Mac geöffnet und dort „Synchronisation“ eingeschaltet?`,
    );
  } finally {
    clearTimeout(t);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Fehler ${res.status}`);
  return json;
}

export const macInfo = (host, port) => call(host, port, '/notenapp/info');

export async function pairWithMac({ host, port, code, deviceId, deviceName }) {
  const info = await macInfo(host, port);
  if (info.app !== 'notenapp') throw new Error('Unter dieser Adresse läuft keine Notenapp.');
  if (!info.pairing) throw new Error('Am Mac ist keine Kopplung geöffnet. Dort unter „Einstellungen → Synchronisation“ auf „iPhone koppeln“ tippen.');
  const k = await pairKey(code, info.pairSalt);
  const proof = await sealJson(k, { deviceId, ts: Date.now() });
  const r = await call(host, port, '/notenapp/pair', { deviceId, deviceName, proof });
  const { key, macId, macName } = await openJson(k, r.box);
  return { host: String(host).trim(), port: Number(port) || 12980, deviceId, key, macId, macName, seq: 0, pairedAt: Date.now(), lastSync: null };
}

/** Schickt Basis + eigenen Stand, bekommt den zusammengeführten Stand zurück. */
export async function syncWithMac(pairing, base, remote) {
  const seq = Math.max((pairing.seq || 0) + 1, Date.now());
  const key = await importKey(pairing.key);
  const box = await sealJson(key, { seq, base, remote });
  const r = await call(pairing.host, pairing.port, '/notenapp/sync', { deviceId: pairing.deviceId, box });
  const res = await openJson(key, r.box);
  if (res.seq !== seq) throw new Error('Unerwartete Antwort vom Mac.');
  return { merged: res.merged, seq, macName: res.macName };
}
