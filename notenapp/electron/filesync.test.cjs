const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FileSync } = require('./filesync.cjs');

test('Mac-Ordnerwächter: Konfliktkopien, Schreiben, Änderungserkennung', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-'));
  const folder = path.join(dir, 'iCloud', 'Notenapp');
  let changes = 0;
  const f = new FileSync({ dir, onChange: () => changes++, pollMs: 50 });
  f.set({ enabled: true, folder });
  assert.deepEqual(f.read(), []);
  f.write('{"v":1}');
  assert.deepEqual(f.status().files, ['notenapp-sync.json']);
  f.poll();
  assert.equal(changes, 0, 'eigenes Schreiben löst keine Änderung aus');
  // iPhone speichert als Kopie (iCloud-Konflikt) und ändert das Original
  fs.writeFileSync(path.join(folder, 'notenapp-sync 2.json'), '{"v":2}');
  fs.writeFileSync(path.join(folder, 'notizen.txt'), 'fremd');
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(path.join(folder, 'notenapp-sync.json'), '{"v":3}');
  f.poll();
  assert.equal(changes, 1);
  const read = f.read();
  assert.deepEqual(read.map((x) => x.name), ['notenapp-sync.json', 'notenapp-sync 2.json']);
  f.write('{"v":4}', read.map((x) => x.name));
  assert.deepEqual(fs.readdirSync(folder).sort(), ['notenapp-sync.json', 'notizen.txt'], 'Konfliktkopie entfernt, fremde Datei bleibt');
  assert.throws(() => f.write('kaputt'));
  assert.equal(fs.readFileSync(path.join(folder, 'notenapp-sync.json'), 'utf8'), '{"v":4}');
  f.stop();
});
