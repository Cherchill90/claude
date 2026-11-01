// CSV-Import (u. a. Excel-Exporte der NotenBox): Parser + automatische Erkennung des Aufbaus.
import { DEFAULT_SETTINGS, gradeValue } from './grades.js';

/** CSV mit Anführungszeichen, ; / Tab / , als Trenner. */
export function parseCsv(text) {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = text.split('\n').find((l) => l.trim()) || '';
  const sep = [';', '\t', ','].map((s) => [s, firstLine.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.filter((r) => r.some((c) => c !== '')).map((r) => [...r, ...Array(width - r.length).fill('')]);
}

const DATE_RE = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/;
const SKIP_COL_RE = /(^|\s)(Ø|ø)|schnitt|durchschnitt|zeugnis|gesamt|summe|mittel/i;
const SKIP_ROW_RE = /^(Ø|ø|durchschnitt|klassenschnitt|schnitt|summe|anzahl|notenspiegel)/i;

const isGradeLike = (v, system) => v !== '' && gradeValue(v.replace(/\s/g, ''), { ...DEFAULT_SETTINGS, system }) !== null;
const hasLetters = (v) => /[a-zäöüß]/i.test(v);

export function detectSystem(rows) {
  const nums = rows.flat().filter((v) => /^\d{1,2}$/.test(v)).map(Number);
  return nums.some((n) => n > 6 && n <= 15) ? 'punkte' : 'noten';
}

/** Vorschlag für Kopfzeilen, Namensspalten und Notenspalten. */
export function guessLayout(rows, system = detectSystem(rows)) {
  const width = rows[0]?.length || 0;
  // Datenzeile = Text in Spalte 0 oder 1 und mindestens ein notenartiger Wert
  const isData = (r) => (hasLetters(r[0]) || hasLetters(r[1] || '')) && r.slice(1).some((v) => isGradeLike(v, system));
  let headerRows = rows.findIndex(isData);
  if (headerRows < 0) headerRows = 1;
  const data = rows.slice(headerRows);
  const head = (c) => rows.slice(0, headerRows).map((r) => r[c]).join(' ').toLowerCase();

  // Namensspalten
  let nameMode = 'komma';
  let nameCol = 0;
  let firstCol = 1;
  const vn = [...Array(width).keys()].find((c) => /vorname/.test(head(c)));
  const nn = [...Array(width).keys()].find((c) => /nachname|familienname/.test(head(c)));
  if (vn !== undefined && nn !== undefined) {
    nameMode = 'zwei'; nameCol = nn; firstCol = vn;
  } else {
    const textCol1 = data.filter((r) => hasLetters(r[1] || '') && !isGradeLike(r[1], system)).length > data.length / 2;
    const comma = data.filter((r) => r[0].includes(',')).length > data.length / 2;
    if (comma) nameMode = 'komma';
    else if (textCol1) { nameMode = 'zwei'; nameCol = 0; firstCol = 1; }
    else nameMode = 'leer';
  }
  const nameCols = nameMode === 'zwei' ? [nameCol, firstCol] : [nameCol];

  const cols = [];
  for (let c = 0; c < width; c++) {
    if (nameCols.includes(c)) continue;
    const vals = data.map((r) => r[c]).filter((v) => v !== '');
    if (!vals.length) continue;
    const valid = vals.filter((v) => isGradeLike(v, system)).length;
    const title = columnTitle(rows, headerRows, c);
    const m = title.match(DATE_RE);
    cols.push({
      c,
      title: title.replace(DATE_RE, '').replace(/\s+[-–]\s*$/, '').trim() || `Spalte ${c + 1}`,
      date: m ? isoDate(m) : '',
      valid,
      total: vals.length,
      use: valid >= vals.length / 2 && !SKIP_COL_RE.test(title),
    });
  }
  return { headerRows, nameMode, nameCol, firstCol, system, cols };
}

/** Spaltentitel aus allen Kopfzeilen; leere Zellen in oberen Zeilen erben von links (verbundene Zellen). */
export function columnTitle(rows, headerRows, c) {
  const parts = [];
  for (let r = 0; r < headerRows; r++) {
    let v = rows[r][c];
    if (!v && r < headerRows - 1) for (let k = c - 1; k >= 0 && !v; k--) v = rows[r][k];
    if (v && !parts.includes(v)) parts.push(v);
  }
  return parts.join(' – ');
}

function isoDate(m) {
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Name aus einer Datenzeile gemäß Layout. */
export function nameOf(row, layout) {
  if (layout.nameMode === 'zwei') return { last: row[layout.nameCol] || '', first: row[layout.firstCol] || '' };
  const v = row[layout.nameCol] || '';
  if (layout.nameMode === 'komma' && v.includes(',')) {
    const [last, ...rest] = v.split(',');
    return { last: last.trim(), first: rest.join(',').trim() };
  }
  const p = v.trim().split(/\s+/);
  const last = p.pop() || '';
  return { last, first: p.join(' ') };
}

export const isStudentRow = (row, layout) => {
  const n = nameOf(row, layout);
  const s = `${n.last} ${n.first}`.trim();
  return !!s && hasLetters(s) && !SKIP_ROW_RE.test(s);
};

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
export function findStudent(list, n) {
  return list.find(
    (s) =>
      (norm(s.last) === norm(n.last) && norm(s.first) === norm(n.first)) ||
      (norm(s.last) === norm(n.first) && norm(s.first) === norm(n.last)),
  );
}

export const cleanGrade = (v) => v.replace(/\s/g, '').replace('–', '-').replace('−', '-');
