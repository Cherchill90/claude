import test from 'node:test';
import assert from 'node:assert/strict';
import { merge3, mergeSyncData, stable } from './merge.js';

const klasse = (over = {}) => ({
  id: 'k1', name: '5D', settings: { system: 'noten' },
  schueler: [{ id: 's1', first: '', last: 'Schüler 01' }, { id: 's2', first: '', last: 'Schüler 02' }],
  arbeiten: [{ id: 'a1', title: 'KA 1', results: { s1: { grade: '2' }, s2: { grade: '3' } } }],
  ...over,
});
const clone = (x) => structuredClone(x);

test('Unterschiedliche Noten auf beiden Geräten werden zusammengeführt', () => {
  const base = { klassen: [klasse()], changedAt: 1 };
  const mac = clone(base); mac.klassen[0].arbeiten[0].results.s1.grade = '1'; mac.changedAt = 5;
  const ip = clone(base); ip.klassen[0].arbeiten[0].results.s2.grade = '4'; ip.changedAt = 6;
  const m = mergeSyncData(base, mac, ip);
  assert.equal(m.klassen[0].arbeiten[0].results.s1.grade, '1');
  assert.equal(m.klassen[0].arbeiten[0].results.s2.grade, '4');
  assert.equal(m.changedAt, 6);
});

test('Neue Arbeit auf dem iPhone + neue Arbeit auf dem Mac → beide bleiben', () => {
  const base = { klassen: [klasse()] };
  const mac = clone(base); mac.klassen[0].arbeiten.push({ id: 'aM', title: 'Mac', results: {} });
  const ip = clone(base); ip.klassen[0].arbeiten.push({ id: 'aI', title: 'Mündlich', results: { s1: { grade: '2+' } } });
  const m = mergeSyncData(base, mac, ip);
  assert.deepEqual(m.klassen[0].arbeiten.map((a) => a.id), ['a1', 'aM', 'aI']);
});

test('Löschen: unverändert gelöscht, geändert bleibt', () => {
  const base = { klassen: [klasse()] };
  const mac = clone(base); mac.klassen[0].arbeiten = []; // Mac löscht KA 1
  const ip = clone(base);
  assert.equal(mergeSyncData(base, mac, ip).klassen[0].arbeiten.length, 0);
  const ip2 = clone(base); ip2.klassen[0].arbeiten[0].results.s1.grade = '5'; // iPhone ändert sie
  assert.equal(mergeSyncData(base, mac, ip2).klassen[0].arbeiten[0].results.s1.grade, '5');
  // gelöschte Note (Schlüssel entfernt) auf dem iPhone
  const ip3 = clone(base); delete ip3.klassen[0].arbeiten[0].results.s2;
  assert.equal(mergeSyncData(base, clone(base), ip3).klassen[0].arbeiten[0].results.s2, undefined);
});

test('Konflikt auf derselben Note: neuere Änderung gewinnt', () => {
  const base = { klassen: [klasse()] };
  const mac = clone(base); mac.klassen[0].arbeiten[0].results.s1.grade = '1'; mac.changedAt = 10;
  const ip = clone(base); ip.klassen[0].arbeiten[0].results.s1.grade = '5'; ip.changedAt = 20;
  assert.equal(mergeSyncData(base, mac, ip).klassen[0].arbeiten[0].results.s1.grade, '5');
  mac.changedAt = 30;
  assert.equal(mergeSyncData(base, mac, ip).klassen[0].arbeiten[0].results.s1.grade, '1');
});

test('Erste Synchronisation ohne Basis: Vereinigung', () => {
  const mac = { klassen: [klasse()], changedAt: 3 };
  const ip = { klassen: [], changedAt: 0 };
  assert.equal(mergeSyncData(null, mac, ip).klassen.length, 1);
  const ip2 = { klassen: [klasse({ id: 'k2', name: 'Q1' })], changedAt: 1 };
  assert.deepEqual(mergeSyncData(null, mac, ip2).klassen.map((k) => k.name), ['5D', 'Q1']);
});

test('Versiegelte Klassen: Vergleich über Hash, nicht über zufälligen IV', () => {
  const s = (iv, hash) => ({ id: 'k9', name: 'X', sealed: { iv, data: 'x' + iv, salt: 's', hash } });
  const base = { klassen: [s('1', 'h1')] };
  // Mac hat neu versiegelt (anderer IV), Inhalt gleich; iPhone hat geändert
  const m = mergeSyncData(base, { klassen: [s('2', 'h1')], changedAt: 9 }, { klassen: [s('3', 'h2')], changedAt: 1 });
  assert.equal(m.klassen[0].sealed.hash, 'h2');
});

test('stable ignoriert Schlüsselreihenfolge', () => {
  assert.equal(stable({ a: 1, b: { c: 2, d: 3 } }), stable({ b: { d: 3, c: 2 }, a: 1 }));
  assert.ok(merge3({ a: 1, b: 2 }, { b: 2, a: 1 }, { a: 1, b: 3 }).b === 3);
});
