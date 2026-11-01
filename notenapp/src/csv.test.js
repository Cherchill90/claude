import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, guessLayout, nameOf, isStudentRow, columnTitle } from './csv.js';

test('NotenBox-artiger Export: leere Ecke, zweizeiliger Kopf, Schnittspalten', () => {
  const text = '﻿;Klausur;Klausur;Praxis;Ø\n;12.10.2026;05.11.2026;;\n"Muster, Anna";12;10;13;11,67\n"Beispiel, Ben";9;;11;10\nØ;10,5;10;12;\n';
  const rows = parseCsv(text);
  assert.equal(rows.length, 5);
  const L = guessLayout(rows);
  assert.equal(L.system, 'punkte');
  assert.equal(L.headerRows, 2);
  assert.equal(L.nameMode, 'komma');
  assert.deepEqual(L.cols.map((c) => [c.title, c.date, c.use]), [
    ['Klausur', '2026-10-12', true],
    ['Klausur', '2026-11-05', true],
    ['Praxis', '', true],
    ['Ø', '', false],
  ]);
  assert.deepEqual(nameOf(rows[2], L), { last: 'Muster', first: 'Anna' });
  assert.equal(isStudentRow(rows[4], L), false);
});

test('Nachname;Vorname-Kopf und Noten mit Tendenz', () => {
  const rows = parseCsv('Nachname;Vorname;Test 1;Test 2\nMuster;Anna;2+;3-\nBeispiel;Ben;1;4\n');
  const L = guessLayout(rows);
  assert.equal(L.system, 'noten');
  assert.equal(L.headerRows, 1);
  assert.equal(L.nameMode, 'zwei');
  assert.deepEqual(nameOf(rows[1], L), { last: 'Muster', first: 'Anna' });
  assert.deepEqual(L.cols.map((c) => c.title), ['Test 1', 'Test 2']);
});

test('Verbundene Gruppenzellen erben von links', () => {
  const rows = [['', 'Schriftlich', '', 'Mündlich'], ['', 'KA 1', 'KA 2', 'Mitarbeit']];
  assert.equal(columnTitle(rows, 2, 2), 'Schriftlich – KA 2');
});

test('Anführungszeichen mit Semikolon im Feld', () => {
  assert.deepEqual(parseCsv('a;"b;c";"d ""x"""\n'), [['a', 'b;c', 'd "x"']]);
});
