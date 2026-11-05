const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SyncServer } = require('./syncserver.cjs');

test('Kopplung, Synchronisation und Schutzmechanismen', async () => {
  const { pairWithMac, syncWithMac, macInfo } = await import('../src/syncclient.js');
  const { mergeSyncData } = await import('../src/merge.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notenapp-sync-'));
  let macData = { klassen: [{ id: 'k1', name: '5D', arbeiten: [{ id: 'a1', results: { s1: { grade: '2' } } }] }], changedAt: 1 };
  const events = [];
  const srv = new SyncServer({
    dir, name: 'Test-Mac',
    onSync: async ({ base, remote }) => (macData = mergeSyncData(base, macData, remote)),
    onEvent: (e) => events.push(e.type),
  });
  const port = 12990 + Math.floor(Math.random() * 500);
  await srv.setEnabled(true, port);
  try {
    assert.equal((await macInfo('127.0.0.1', port)).pairing, false);
    await assert.rejects(pairWithMac({ host: '127.0.0.1', port, code: 'AAAABBBB', deviceId: 'd1', deviceName: 'iPhone' }), /keine Kopplung/);

    const { pairing } = { pairing: srv.startPairing().pairing };
    await assert.rejects(pairWithMac({ host: '127.0.0.1', port, code: 'AAAABBBB', deviceId: 'd1', deviceName: 'iPhone' }), /Falscher Kopplungscode/);
    const p = await pairWithMac({ host: '127.0.0.1', port, code: pairing.code.toLowerCase(), deviceId: 'd1', deviceName: 'iPhone' });
    assert.equal(p.macName, 'Test-Mac');
    assert.equal(srv.status().pairing, null, 'Kopplung endet nach Erfolg');
    assert.equal(srv.status().devices[0].name, 'iPhone');
    assert.ok(!JSON.stringify(srv.status()).includes(p.key), 'Schlüssel wird nicht über status() herausgegeben');

    // erste Synchronisation: iPhone leer
    const r1 = await syncWithMac(p, null, { klassen: [], changedAt: 0 });
    assert.equal(r1.merged.klassen[0].name, '5D');
    // iPhone ändert Note, Mac ändert Klassenname
    const ip = structuredClone(r1.merged); ip.klassen[0].arbeiten[0].results.s1.grade = '1'; ip.changedAt = 5;
    macData = structuredClone(macData); macData.klassen[0].name = '5D Mathe'; macData.changedAt = 4;
    const r2 = await syncWithMac({ ...p, seq: r1.seq }, r1.merged, ip);
    assert.equal(r2.merged.klassen[0].name, '5D Mathe');
    assert.equal(r2.merged.klassen[0].arbeiten[0].results.s1.grade, '1');
    assert.deepEqual(macData, r2.merged);

    // Wiederholte (mitgeschnittene) Anfrage wird abgelehnt
    const W = await import('../src/synccrypto.js');
    const replay = { deviceId: p.deviceId, box: await W.sealJson(await W.importKey(p.key), { seq: r2.seq, base: null, remote: { klassen: [], changedAt: 99 } }) };
    const rr = await fetch(`http://127.0.0.1:${port}/notenapp/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(replay) });
    assert.equal(rr.status, 409);
    assert.equal(macData.klassen.length, 1, 'Wiederholung hat nichts verändert');
    // unbekanntes Gerät
    await assert.rejects(syncWithMac({ ...p, deviceId: 'fremd' }, null, ip), /nicht \(mehr\) gekoppelt/);
    // falscher Schlüssel
    await assert.rejects(syncWithMac({ ...p, key: Buffer.alloc(32, 7).toString('base64'), seq: Date.now() + 1e6 }, null, ip), /Entschlüsselung/);
    // Mac gesperrt
    srv.onSync = async () => { throw Object.assign(new Error('gesperrt'), { status: 423 }); };
    await assert.rejects(syncWithMac({ ...p, seq: Date.now() + 2e6 }, null, ip), /gesperrt/);

    // Brute-Force-Schutz: nach 10 Fehlversuchen ist die Kopplung beendet
    srv.startPairing();
    for (let i = 0; i < 10; i++) await assert.rejects(pairWithMac({ host: '127.0.0.1', port, code: 'ZZZZZZZZ', deviceId: 'x', deviceName: 'x' }));
    await assert.rejects(pairWithMac({ host: '127.0.0.1', port, code: 'ZZZZZZZZ', deviceId: 'x', deviceName: 'x' }), /Zu viele Fehlversuche/);

    // Geräte-Datei ist nur für den Benutzer lesbar
    const mode = fs.statSync(path.join(dir, 'sync-geraete.json')).mode & 0o777;
    assert.equal(mode, 0o600);
    assert.deepEqual([...new Set(events)], ['paired', 'synced']);
  } finally {
    await srv.stop();
  }
});
