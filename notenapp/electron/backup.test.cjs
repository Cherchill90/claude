const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('./backup.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notenapp-'));

test('Speichern ist atomar und lehnt ungültiges JSON ab', () => {
  const d = tmp();
  B.writeData(d, '{"a":1}');
  assert.equal(B.readData(d), '{"a":1}');
  assert.throws(() => B.writeData(d, '{kaputt'));
  assert.equal(B.readData(d), '{"a":1}');
  assert.ok(!fs.existsSync(path.join(d, B.DATA_FILE + '.tmp')));
});

test('Backup beim Beenden wird angelegt, ohne Daten keins', () => {
  const d = tmp();
  assert.equal(B.createBackup(d), null);
  B.writeData(d, '{"x":2}');
  const p1 = B.createBackup(d, new Date(2026, 10, 1, 12, 0, 0));
  const p2 = B.createBackup(d, new Date(2026, 10, 1, 12, 0, 0));
  assert.match(path.basename(p1), /^Notenapp-Backup-2026-11-01_12-00-00\.json$/);
  assert.notEqual(p1, p2);
  assert.equal(fs.readFileSync(p1, 'utf8'), '{"x":2}');
});

test('Backups älter als 3 Monate werden gelöscht', () => {
  const d = tmp();
  B.writeData(d, '{}');
  B.createBackup(d, new Date(2026, 6, 31, 23, 59, 0)); // 31.07. – älter als 3 Monate
  B.createBackup(d, new Date(2026, 7, 2, 8, 0, 0)); // 02.08. – noch innerhalb
  B.createBackup(d, new Date(2026, 9, 30, 8, 0, 0));
  fs.writeFileSync(path.join(d, B.BACKUP_DIR, 'fremde-datei.txt'), 'bleibt');
  const removed = B.cleanupBackups(d, new Date(2026, 10, 1, 10, 0, 0));
  assert.deepEqual(removed, ['Notenapp-Backup-2026-07-31_23-59-00.json']);
  assert.equal(B.listBackups(d).length, 2);
  assert.ok(fs.existsSync(path.join(d, B.BACKUP_DIR, 'fremde-datei.txt')));
});
