// Reine Berechnungslogik – ohne React, damit testbar.

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const DEFAULT_SETTINGS = {
  system: 'noten', // 'noten' (1–6) | 'punkte' (0–15)
  plusMinus: true, // Tendenzen (+/-) erlaubt
  plusValue: 0.25, // 2+ = 1,75 · 2- = 2,25
  plusMinusImSchnitt: true, // Tendenzen fließen in den Schnitt ein
  decimals: 2, // Nachkommastellen bei Durchschnitten
  roundThreshold: 0.5, // ab x,50 wird zur schlechteren Note gerundet
  hjWeights: null, // null = alle Noten des Jahres gemeinsam, sonst [g1, g2]
};

export const SCHLUESSEL_NOTEN = [
  { grade: '1', min: 92 },
  { grade: '2', min: 81 },
  { grade: '3', min: 67 },
  { grade: '4', min: 50 },
  { grade: '5', min: 30 },
  { grade: '6', min: 0 },
];

export const SCHLUESSEL_PUNKTE = [
  [15, 95], [14, 90], [13, 85], [12, 80], [11, 75], [10, 70], [9, 65], [8, 60],
  [7, 55], [6, 50], [5, 45], [4, 40], [3, 33], [2, 27], [1, 20], [0, 0],
].map(([g, m]) => ({ grade: String(g), min: m }));

export const defaultSchluessel = (s) =>
  (s.system === 'punkte' ? SCHLUESSEL_PUNKTE : SCHLUESSEL_NOTEN).map((x) => ({ ...x }));

/** Notentext -> Zahl (oder null, wenn leer/ungültig). */
export function gradeValue(raw, s = DEFAULT_SETTINGS) {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).trim().replace(',', '.');
  if (!t) return null;
  if (s.system === 'punkte') {
    if (!/^\d{1,2}$/.test(t)) return null;
    const n = Number(t);
    return n >= 0 && n <= 15 ? n : null;
  }
  let m = t.match(/^([1-6])([+-]?)$/);
  if (m) {
    const n = Number(m[1]);
    if (!m[2] || !s.plusMinusImSchnitt) return n;
    const v = m[2] === '+' ? n - s.plusValue : n + s.plusValue;
    return Math.min(6, Math.max(0.5, v));
  }
  m = t.match(/^([1-6])\.(\d{1,2})$/);
  if (m) {
    const v = Number(t);
    return v >= 1 && v <= 6 ? v : null;
  }
  return null;
}

export function isValidGrade(raw, s = DEFAULT_SETTINGS) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return true;
  if (s.system === 'noten' && !s.plusMinus && /[+-]/.test(String(raw))) return false;
  return gradeValue(raw, s) !== null;
}

/** Ganzzahlige Stufe für den Notenspiegel (2- zählt als 2). */
export function gradeStep(raw, s = DEFAULT_SETTINGS) {
  const v = gradeValue(raw, { ...s, plusMinusImSchnitt: false });
  if (v === null) return null;
  return s.system === 'punkte' ? v : Math.round(v);
}

export function weightedMean(pairs) {
  let sum = 0;
  let w = 0;
  for (const [v, g] of pairs) {
    if (v === null || v === undefined || !(g > 0)) continue;
    sum += v * g;
    w += g;
  }
  return w > 0 ? sum / w : null;
}

export function fmt(v, decimals = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  return v.toFixed(decimals).replace('.', ',');
}

/** Zeugnisnote aus Schnitt. Noten: ab Schwelle zur schlechteren Note. Punkte: ab ,5 aufrunden. */
export function roundToZeugnis(avg, s = DEFAULT_SETTINGS) {
  if (avg === null) return null;
  const base = Math.floor(avg);
  const frac = avg - base;
  if (s.system === 'punkte') return Math.min(15, frac >= 0.5 - 1e-9 ? base + 1 : base);
  const r = frac >= s.roundThreshold - 1e-9 ? base + 1 : base;
  return Math.min(6, Math.max(1, r));
}

/** Note aus Punkten über Notenschlüssel (Prozentgrenzen absteigend). */
export function gradeFromPoints(points, maxPoints, schluessel) {
  if (points === null || points === undefined || points === '' || !(maxPoints > 0)) return null;
  const pct = (Number(points) / maxPoints) * 100;
  const sorted = [...schluessel].sort((a, b) => b.min - a.min);
  for (const st of sorted) if (pct >= st.min - 1e-9) return st.grade;
  return sorted[sorted.length - 1]?.grade ?? null;
}

/** Punktgrenzen je Notenstufe für die Anzeige des Notenschlüssels. */
export function schluesselRanges(maxPoints, schluessel, step = 0.5) {
  const sorted = [...schluessel].sort((a, b) => b.min - a.min);
  const roundUp = (x) => Math.ceil(x / step - 1e-9) * step;
  return sorted.map((st, i) => {
    const from = roundUp((st.min / 100) * maxPoints);
    const to = i === 0 ? maxPoints : roundUp((sorted[i - 1].min / 100) * maxPoints) - step;
    return { grade: st.grade, min: st.min, from, to: Math.max(from, to) };
  });
}

// ---------- Aggregation über Klassendaten ----------

const resultOf = (arbeit, studentId) => arbeit.results?.[studentId]?.grade;

export function arbeitenFor(klasse, fachId, bereichId, hj) {
  return klasse.arbeiten.filter(
    (a) =>
      a.fachId === fachId &&
      (bereichId === undefined || a.bereichId === bereichId) &&
      (hj === undefined || hj === 0 || a.halbjahr === hj),
  );
}

export function bereichAvg(klasse, studentId, fachId, bereichId, hj) {
  const s = klasse.settings;
  return weightedMean(
    arbeitenFor(klasse, fachId, bereichId, hj).map((a) => [
      gradeValue(resultOf(a, studentId), s),
      (a.individuell ? Number(a.weight) : 1) || 0,
    ]),
  );
}

/**
 * Struktur eines Fachs: Bereichsgruppen (z. B. „Besondere Fachprüfung“) enthalten Bereiche
 * (z. B. „Klausur“, „Praxis“). Bereiche ohne Gruppe stehen auf oberster Ebene.
 * Gewichtet wird zuerst innerhalb der Gruppe (Bereichsgewichte), dann über die oberste Ebene.
 */
export function fachTopLevel(fach) {
  const gruppen = (fach.gruppen || []).map((g) => ({
    type: 'gruppe',
    ...g,
    bereiche: fach.bereiche.filter((b) => b.gruppeId === g.id),
  }));
  const lose = fach.bereiche
    .filter((b) => !b.gruppeId || !(fach.gruppen || []).some((g) => g.id === b.gruppeId))
    .map((b) => ({ type: 'bereich', ...b }));
  return [...gruppen, ...lose];
}

export function gruppeAvg(klasse, studentId, fach, gruppe, hj) {
  return weightedMean(
    fach.bereiche
      .filter((b) => b.gruppeId === gruppe.id)
      .map((b) => [bereichAvg(klasse, studentId, fach.id, b.id, hj), Number(b.weight) || 0]),
  );
}

/** Fachschnitt für ein Halbjahr (1|2) oder das ganze Jahr (0). */
export function fachAvg(klasse, studentId, fachId, hj = 0) {
  const s = klasse.settings;
  const fach = klasse.faecher.find((f) => f.id === fachId);
  if (!fach) return null;
  if (hj === 0 && Array.isArray(s.hjWeights)) {
    return weightedMean([
      [fachAvg(klasse, studentId, fachId, 1), s.hjWeights[0]],
      [fachAvg(klasse, studentId, fachId, 2), s.hjWeights[1]],
    ]);
  }
  return weightedMean(
    fachTopLevel(fach).map((t) => [
      t.type === 'gruppe'
        ? gruppeAvg(klasse, studentId, fach, t, hj)
        : bereichAvg(klasse, studentId, fachId, t.id, hj),
      Number(t.weight) || 0,
    ]),
  );
}

export function arbeitStats(klasse, arbeit) {
  const s = klasse.settings;
  const values = [];
  const steps = {};
  for (const st of klasse.schueler) {
    const g = resultOf(arbeit, st.id);
    const v = gradeValue(g, s);
    if (v === null) continue;
    values.push(v);
    const k = gradeStep(g, s);
    steps[k] = (steps[k] || 0) + 1;
  }
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const levels = s.system === 'punkte' ? Array.from({ length: 16 }, (_, i) => 15 - i) : [1, 2, 3, 4, 5, 6];
  const spiegel = levels.map((l) => ({ grade: l, count: steps[l] || 0 }));
  return { avg, count: values.length, spiegel };
}

/** Zeugnisnote: manuelle Festlegung hat Vorrang vor dem gerundeten Schnitt. */
export function zeugnisNote(klasse, studentId, fachId, hj) {
  const manual = klasse.zeugnis?.[`${studentId}|${fachId}|${hj}`];
  if (manual !== undefined && manual !== '') return { value: manual, manual: true };
  const r = roundToZeugnis(fachAvg(klasse, studentId, fachId, hj), klasse.settings);
  return { value: r === null ? '' : String(r), manual: false };
}

/** Leistungsverlauf: alle Noten eines Schülers chronologisch. */
export function verlauf(klasse, studentId, fachId) {
  return klasse.arbeiten
    .filter((a) => (!fachId || a.fachId === fachId) && gradeValue(resultOf(a, studentId), klasse.settings) !== null)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map((a) => ({
      arbeit: a,
      grade: resultOf(a, studentId),
      value: gradeValue(resultOf(a, studentId), klasse.settings),
    }));
}
