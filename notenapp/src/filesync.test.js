import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSyncFile, decryptSyncFile } from './filesync.js';

test('Sync-Datei: verschlüsselt, mit Passwort lesbar, sonst nicht', async () => {
  const wire = { klassen: [{ id: 'k', name: '5D', schueler: [{ id: 's', last: 'Schüler 01' }] }], changedAt: 7 };
  const text = await encryptSyncFile(wire, 'geheim');
  assert.ok(!text.includes('Schüler') && !text.includes('5D'), 'kein Klartext in der Datei');
  assert.equal(JSON.parse(text).format, 'notenapp-sync');
  assert.deepEqual(await decryptSyncFile(text, 'geheim'), wire);
  await assert.rejects(decryptSyncFile(text, 'falsch'), /Falsches Sync-Passwort/);
  await assert.rejects(decryptSyncFile('{"a":1}', 'geheim'), /keine Sync-Datei/);
  await assert.rejects(encryptSyncFile(wire, ''), /Sync-Passwort/);
});
