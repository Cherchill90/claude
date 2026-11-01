// Datei-Speicherung und Backups – ohne Electron-Abhängigkeit, damit testbar.
const fs = require('fs');
const path = require('path');

const DATA_FILE = 'notenapp-daten.json';
const BACKUP_DIR = 'Backups';
const BACKUP_RE = /^Notenapp-Backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.json$/;
const KEEP_MONTHS = 3;

const pad = (n) => String(n).padStart(2, '0');

function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function readData(dir) {
  const f = path.join(dir, DATA_FILE);
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return null;
  }
}

/** Atomar schreiben: erst temporäre Datei, dann umbenennen – ein Absturz hinterlässt nie eine halbe Datei. */
function writeData(dir, content) {
  JSON.parse(content); // nur gültiges JSON speichern
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, DATA_FILE);
  const tmp = f + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  fs.writeSync(fd, content);
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(tmp, f);
}

/** Backup der aktuellen Datendatei anlegen. Gibt den Pfad zurück (oder null, wenn es noch keine Daten gibt). */
function createBackup(dir, now = new Date()) {
  const src = path.join(dir, DATA_FILE);
  if (!fs.existsSync(src)) return null;
  const bdir = path.join(dir, BACKUP_DIR);
  fs.mkdirSync(bdir, { recursive: true });
  let target = path.join(bdir, `Notenapp-Backup-${stamp(now)}.json`);
  for (let i = 2; fs.existsSync(target); i++) target = target.replace(/(-\d+)?\.json$/, `-${i}.json`);
  fs.copyFileSync(src, target);
  return target;
}

/** Datum aus dem Dateinamen; Fallback: Änderungsdatum der Datei. */
function backupDate(bdir, name) {
  const m = name.match(BACKUP_RE);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return fs.statSync(path.join(bdir, name)).mtime;
}

/** Backups löschen, die älter als 3 Monate sind. Gibt die gelöschten Dateinamen zurück. */
function cleanupBackups(dir, now = new Date()) {
  const bdir = path.join(dir, BACKUP_DIR);
  if (!fs.existsSync(bdir)) return [];
  const limit = new Date(now);
  limit.setMonth(limit.getMonth() - KEEP_MONTHS);
  const removed = [];
  for (const name of fs.readdirSync(bdir)) {
    if (!name.startsWith('Notenapp-Backup-') || !name.endsWith('.json')) continue;
    if (backupDate(bdir, name) < limit) {
      fs.unlinkSync(path.join(bdir, name));
      removed.push(name);
    }
  }
  return removed;
}

function listBackups(dir) {
  const bdir = path.join(dir, BACKUP_DIR);
  if (!fs.existsSync(bdir)) return [];
  return fs
    .readdirSync(bdir)
    .filter((n) => n.startsWith('Notenapp-Backup-') && n.endsWith('.json'))
    .map((n) => ({ name: n, path: path.join(bdir, n), date: backupDate(bdir, n) }))
    .sort((a, b) => b.date - a.date);
}

module.exports = { DATA_FILE, BACKUP_DIR, KEEP_MONTHS, readData, writeData, createBackup, cleanupBackups, listBackups, stamp };
