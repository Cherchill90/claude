// Mac: Sync-Datei in einem Ordner (Standard: iCloud Drive/Notenapp) beobachten, lesen und schreiben.
// Erkennt iCloud-Konfliktkopien („notenapp-sync 2.json“) und lädt ausgelagerte iCloud-Dateien nach.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SETTINGS = 'datei-sync.json';
const PRIMARY = 'notenapp-sync.json';
const RE = /^notenapp-sync(?:[ _-]?\(?\d+\)?)?\.json$/i;
const ICLOUD = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs');

function defaultFolder() {
  return fs.existsSync(ICLOUD) ? path.join(ICLOUD, 'Notenapp') : path.join(os.homedir(), 'Documents', 'Notenapp-Sync');
}

class FileSync {
  constructor({ dir, onChange, pollMs = 10000 }) {
    this.dir = dir;
    this.onChange = onChange || (() => {});
    this.pollMs = pollMs;
    this.known = {}; // Dateiname → mtimeMs, die wir kennen (gelesen oder selbst geschrieben)
    this.state = this.load();
    this.timer = null;
  }

  load() {
    try {
      return { enabled: false, folder: defaultFolder(), ...JSON.parse(fs.readFileSync(path.join(this.dir, SETTINGS), 'utf8')) };
    } catch {
      return { enabled: false, folder: defaultFolder() };
    }
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, SETTINGS), JSON.stringify(this.state, null, 1));
  }

  status() {
    return { ...this.state, icloud: this.state.folder.startsWith(ICLOUD), folderExists: fs.existsSync(this.state.folder), files: this.list().map((f) => f.name), lastError: this.lastError || null };
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.save();
    this.known = {};
    this.restart();
    return this.status();
  }

  restart() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.state.enabled) {
      this.timer = setInterval(() => this.poll(), this.pollMs);
      this.timer.unref?.();
    }
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  list() {
    let names = [];
    try {
      names = fs.readdirSync(this.state.folder);
    } catch {
      return [];
    }
    // iCloud-Platzhalter (Datei nur in der Cloud): „.notenapp-sync.json.icloud“ → herunterladen anstoßen
    for (const n of names) {
      const m = n.match(/^\.(.+)\.icloud$/);
      if (m && RE.test(m[1])) execFile('brctl', ['download', path.join(this.state.folder, m[1])], () => {});
    }
    return names
      .filter((n) => RE.test(n))
      .map((n) => ({ name: n, mtime: fs.statSync(path.join(this.state.folder, n)).mtimeMs }))
      .sort((a, b) => (a.name === PRIMARY ? -1 : b.name === PRIMARY ? 1 : a.mtime - b.mtime));
  }

  poll() {
    const changed = this.list().some((f) => this.known[f.name] !== f.mtime);
    if (changed) this.onChange();
  }

  read() {
    return this.list().map((f) => {
      const text = fs.readFileSync(path.join(this.state.folder, f.name), 'utf8');
      this.known[f.name] = f.mtime;
      return { name: f.name, text };
    });
  }

  /** Zusammengeführten Stand als Hauptdatei schreiben, gelesene Konfliktkopien entfernen. */
  write(text, removeNames = []) {
    JSON.parse(text);
    fs.mkdirSync(this.state.folder, { recursive: true });
    const f = path.join(this.state.folder, PRIMARY);
    fs.writeFileSync(f + '.tmp', text);
    fs.renameSync(f + '.tmp', f);
    for (const n of removeNames) if (n !== PRIMARY && RE.test(n)) fs.rmSync(path.join(this.state.folder, n), { force: true });
    this.known = {};
    for (const x of this.list()) this.known[x.name] = x.mtime;
    this.state.lastWrite = Date.now();
    this.save();
    return true;
  }
}

module.exports = { FileSync, PRIMARY, defaultFolder };
