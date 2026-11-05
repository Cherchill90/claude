// Sync-Server der Mac-App: iPhone/iPad im selben WLAN koppeln und Noten abgleichen.
// Ohne Electron-Abhängigkeit, damit testbar. Daten werden nie im Klartext übertragen:
// - Kopplung: Code wird NIE gesendet. Beide Seiten leiten daraus per PBKDF2 einen Schlüssel ab;
//   das iPhone beweist den Code mit einer verschlüsselten Nachricht, der Mac antwortet mit dem
//   zufälligen Geräteschlüssel (256 Bit), verschlüsselt mit dem Code-Schlüssel.
// - Abgleich: jede Anfrage/Antwort AES-256-GCM mit dem Geräteschlüssel, fortlaufende Nummer gegen Wiederholung.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./synccrypto.cjs');

const FILE = 'sync-geraete.json';
const DEFAULT_PORT = 12980;
const PAIR_MINUTES = 10;
const MAX_PAIR_ATTEMPTS = 10;
const MAX_BODY = 60 * 1024 * 1024;

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

class SyncServer {
  /**
   * @param {object} o
   * @param {string} o.dir         Ordner für sync-geraete.json
   * @param {string} o.name        Anzeigename des Macs
   * @param {(req:{device, base, remote}) => Promise<object>} o.onSync  führt den Merge durch, liefert den neuen Stand
   * @param {(ev:object) => void} [o.onEvent]
   */
  constructor({ dir, name, onSync, onEvent }) {
    this.dir = dir;
    this.name = name || os.hostname().replace(/\.local$/, '');
    this.onSync = onSync;
    this.onEvent = onEvent || (() => {});
    this.server = null;
    this.pairing = null;
    this.state = this.load();
  }

  load() {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(this.dir, FILE), 'utf8'));
      return { enabled: false, port: DEFAULT_PORT, devices: [], ...s };
    } catch {
      return { macId: crypto.randomUUID(), enabled: false, port: DEFAULT_PORT, devices: [] };
    }
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const f = path.join(this.dir, FILE);
    fs.writeFileSync(f + '.tmp', JSON.stringify(this.state, null, 1), { mode: 0o600 });
    fs.renameSync(f + '.tmp', f);
  }

  status() {
    return {
      enabled: this.state.enabled,
      running: !!this.server?.listening,
      port: this.state.port,
      name: this.name,
      addresses: lanAddresses(),
      pairing: this.pairing && Date.now() < this.pairing.expires ? { code: this.pairing.code, expires: this.pairing.expires } : null,
      devices: this.state.devices.map(({ key, ...d }) => d),
      error: this.lastError || null,
    };
  }

  async setEnabled(enabled, port) {
    this.state.enabled = !!enabled;
    if (port) this.state.port = Number(port);
    this.save();
    await this.stop();
    if (this.state.enabled) await this.start();
    return this.status();
  }

  start() {
    return new Promise((resolve) => {
      this.lastError = null;
      const srv = http.createServer((req, res) => this.handle(req, res).catch((e) => this.reply(res, 500, { error: e.message })));
      srv.on('error', (e) => {
        this.lastError = e.code === 'EADDRINUSE' ? `Port ${this.state.port} ist belegt.` : e.message;
        this.server = null;
        resolve(this.status());
      });
      srv.listen(this.state.port, '0.0.0.0', () => {
        this.server = srv;
        resolve(this.status());
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server.closeAllConnections?.();
      this.server = null;
    });
  }

  startPairing() {
    const code = C.newCode(8);
    const salt = crypto.randomBytes(16).toString('base64');
    this.pairing = { code, salt, key: C.pairKey(code, salt), expires: Date.now() + PAIR_MINUTES * 60000, attempts: 0 };
    return this.status();
  }

  stopPairing() {
    this.pairing = null;
    return this.status();
  }

  removeDevice(id) {
    this.state.devices = this.state.devices.filter((d) => d.id !== id);
    this.save();
    return this.status();
  }

  reply(res, status, obj) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(obj));
  }

  readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new Error('Anfrage zu groß')); req.destroy(); } else chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Ungültige Anfrage')); }
      });
      req.on('error', reject);
    });
  }

  async handle(req, res) {
    const url = (req.url || '').split('?')[0];
    if (req.method === 'OPTIONS') return this.reply(res, 204, {});
    if (req.method === 'GET' && url === '/notenapp/info') {
      const p = this.pairing && Date.now() < this.pairing.expires ? this.pairing : null;
      return this.reply(res, 200, { app: 'notenapp', protocol: 1, name: this.name, macId: this.state.macId, pairing: !!p, pairSalt: p?.salt || null });
    }
    if (req.method === 'POST' && url === '/notenapp/pair') return this.pair(res, await this.readBody(req));
    if (req.method === 'POST' && url === '/notenapp/sync') return this.sync(res, await this.readBody(req));
    return this.reply(res, 404, { error: 'Unbekannt' });
  }

  pair(res, body) {
    const p = this.pairing;
    if (!p || Date.now() > p.expires) return this.reply(res, 403, { error: 'Am Mac ist gerade keine Kopplung geöffnet. Dort „iPhone koppeln“ wählen.' });
    if (p.attempts >= MAX_PAIR_ATTEMPTS) { this.pairing = null; return this.reply(res, 429, { error: 'Zu viele Fehlversuche. Bitte am Mac neu starten.' }); }
    let proof;
    try {
      proof = C.openJson(p.key, body.proof);
    } catch {
      p.attempts++;
      return this.reply(res, 403, { error: 'Falscher Kopplungscode.' });
    }
    if (proof.deviceId !== body.deviceId || Math.abs(Date.now() - proof.ts) > 10 * 60000) return this.reply(res, 403, { error: 'Ungültige Kopplung.' });
    const key = crypto.randomBytes(32).toString('base64');
    const device = { id: body.deviceId, name: String(body.deviceName || 'iPhone').slice(0, 60), key, pairedAt: Date.now(), lastSync: null, seq: 0 };
    this.state.devices = [...this.state.devices.filter((d) => d.id !== device.id), device];
    this.save();
    this.pairing = null;
    this.onEvent({ type: 'paired', device: { id: device.id, name: device.name } });
    return this.reply(res, 200, { box: C.sealJson(p.key, { key, macId: this.state.macId, macName: this.name }) });
  }

  async sync(res, body) {
    const dev = this.state.devices.find((d) => d.id === body.deviceId);
    if (!dev) return this.reply(res, 401, { error: 'Dieses Gerät ist nicht (mehr) gekoppelt. Bitte neu koppeln.' });
    const key = Buffer.from(dev.key, 'base64');
    let msg;
    try {
      msg = C.openJson(key, body.box);
    } catch {
      return this.reply(res, 401, { error: 'Entschlüsselung fehlgeschlagen. Bitte neu koppeln.' });
    }
    if (!(msg.seq > (dev.seq || 0))) return this.reply(res, 409, { error: 'Veraltete Anfrage.' });
    dev.seq = msg.seq;
    let merged;
    try {
      merged = await this.onSync({ device: { id: dev.id, name: dev.name }, base: msg.base, remote: msg.remote });
    } catch (e) {
      return this.reply(res, e.status || 503, { error: e.message });
    }
    dev.lastSync = Date.now();
    this.save();
    this.onEvent({ type: 'synced', device: { id: dev.id, name: dev.name }, at: dev.lastSync });
    return this.reply(res, 200, { box: C.sealJson(key, { merged, seq: msg.seq, macName: this.name }) });
  }
}

module.exports = { SyncServer, DEFAULT_PORT, lanAddresses };
