import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './grades.js';

const S = G.DEFAULT_SETTINGS;
const P = { ...S, system: 'punkte' };

test('gradeValue Noten mit Tendenz', () => {
  assert.equal(G.gradeValue('2', S), 2);
  assert.equal(G.gradeValue('2+', S), 1.75);
  assert.equal(G.gradeValue('2-', S), 2.25);
  assert.equal(G.gradeValue('2,5', S), 2.5);
  assert.equal(G.gradeValue('7', S), null);
  assert.equal(G.gradeValue('', S), null);
  assert.equal(G.gradeValue('2-', { ...S, plusMinusImSchnitt: false }), 2);
});

test('gradeValue Punkte', () => {
  assert.equal(G.gradeValue('15', P), 15);
  assert.equal(G.gradeValue('0', P), 0);
  assert.equal(G.gradeValue('16', P), null);
});

test('Rundung Zeugnisnote', () => {
  assert.equal(G.roundToZeugnis(2.49, S), 2);
  assert.equal(G.roundToZeugnis(2.5, S), 3);
  assert.equal(G.roundToZeugnis(10.5, P), 11);
  assert.equal(G.roundToZeugnis(null, S), null);
});

test('Notenschlüssel', () => {
  const k = G.SCHLUESSEL_NOTEN;
  assert.equal(G.gradeFromPoints(46, 50, k), '1');
  assert.equal(G.gradeFromPoints(25, 50, k), '4');
  assert.equal(G.gradeFromPoints(0, 50, k), '6');
  const r = G.schluesselRanges(50, k);
  assert.deepEqual(r[0], { grade: '1', min: 92, from: 46, to: 50 });
  assert.equal(r[1].to, 45.5);
});

test('Fachschnitt mit Bereichsgewichtung', () => {
  const klasse = {
    settings: S,
    schueler: [{ id: 's1' }, { id: 's2' }],
    faecher: [{ id: 'f', bereiche: [{ id: 'sch', weight: 2 }, { id: 'mue', weight: 1 }] }],
    arbeiten: [
      { id: 'a1', fachId: 'f', bereichId: 'sch', halbjahr: 1, results: { s1: { grade: '2' }, s2: { grade: '4' } } },
      { id: 'a2', fachId: 'f', bereichId: 'sch', halbjahr: 2, weight: 1, results: { s1: { grade: '3' } } },
      { id: 'a3', fachId: 'f', bereichId: 'mue', halbjahr: 1, weight: 1, results: { s1: { grade: '1' } } },
    ],
    zeugnis: {},
  };
  // HJ1: sch 2, mue 1 -> (2*2+1)/3 = 1,667
  assert.ok(Math.abs(G.fachAvg(klasse, 's1', 'f', 1) - 5 / 3) < 1e-9);
  // Jahr gesamt: sch 2,5; mue 1 -> (5+1)/3 = 2
  assert.equal(G.fachAvg(klasse, 's1', 'f', 0), 2);
  // s2 nur schriftlich -> 4
  assert.equal(G.fachAvg(klasse, 's2', 'f', 0), 4);
  const st = G.arbeitStats(klasse, klasse.arbeiten[0]);
  assert.equal(st.avg, 3);
  assert.equal(st.spiegel.find((x) => x.grade === 2).count, 1);
  assert.equal(G.zeugnisNote(klasse, 's2', 'f', 0).value, '4');
  klasse.zeugnis['s2|f|0'] = '3';
  assert.deepEqual(G.zeugnisNote(klasse, 's2', 'f', 0), { value: '3', manual: true });
  // Halbjahresgewichtung 1:1 -> HJ1 1,667, HJ2 3 -> 2,333
  klasse.settings = { ...S, hjWeights: [1, 1] };
  assert.ok(Math.abs(G.fachAvg(klasse, 's1', 'f', 0) - 7 / 3) < 1e-9);
});

test('Bereichsgruppen und individuelle Gewichtung', () => {
  const klasse = {
    settings: S,
    schueler: [{ id: 's' }],
    faecher: [{
      id: 'f',
      gruppen: [{ id: 'g1', name: 'Fachprüfung', weight: 1 }],
      bereiche: [
        { id: 'k', gruppeId: 'g1', weight: 1 },
        { id: 'p', gruppeId: 'g1', weight: 1 },
        { id: 'm', weight: 1 },
      ],
    }],
    arbeiten: [
      { fachId: 'f', bereichId: 'k', halbjahr: 1, results: { s: { grade: '1' } } },
      { fachId: 'f', bereichId: 'p', halbjahr: 1, results: { s: { grade: '3' } } },
      { fachId: 'f', bereichId: 'm', halbjahr: 1, individuell: true, weight: 3, results: { s: { grade: '4' } } },
      { fachId: 'f', bereichId: 'm', halbjahr: 1, results: { s: { grade: '6' } } },
    ],
  };
  // Gruppe: (1+3)/2 = 2 ; mündlich: (4*3+6)/4 = 4,5 ; Fach: (2+4,5)/2 = 3,25
  assert.equal(G.fachAvg(klasse, 's', 'f', 1), 3.25);
});
