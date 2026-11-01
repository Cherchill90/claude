import { useMemo, useState } from 'react';
import { defaultSchluessel, isValidGrade, uid } from '../grades.js';
import { COLORS, newFach, newKlasse } from '../store.js';
import { cleanGrade, columnTitle, findStudent, guessLayout, isStudentRow, nameOf, parseCsv } from '../csv.js';
import { Field, Modal, today } from '../ui.jsx';

/** Import von Noten aus CSV/Excel-Export mit Vorschau und Spaltenzuordnung. */
export function CsvImport({ ctx, text, fileName, onClose }) {
  const { data, update, klasse: aktiv, sel } = ctx;
  const rows = useMemo(() => parseCsv(text), [text]);
  const guess = useMemo(() => guessLayout(rows), [rows]);
  const baseName = fileName.replace(/\.[^.]+$/, '');

  const klassen = data.klassen.filter((k) => !k.sealed);
  const [klasseId, setKlasseId] = useState(aktiv && !aktiv.sealed ? aktiv.id : klassen[0]?.id || 'neu');
  const [neueKlasse, setNeueKlasse] = useState(baseName);
  const klasse = klassen.find((k) => k.id === klasseId);
  const [fachId, setFachId] = useState('neu');
  const [fachName, setFachName] = useState(baseName);
  const fach = klasse?.faecher.find((f) => f.id === fachId);
  const [hj, setHj] = useState(sel.hj || 1);
  const [layout, setLayout] = useState(guess);
  const [cols, setCols] = useState(() =>
    guess.cols.map((c) => ({ ...c, bereich: `neu:${c.title.split(' – ').pop()}` })),
  );
  const systemMismatch = !!klasse && layout.system !== klasse.settings.system;
  const [umstellen, setUmstellen] = useState(() => !!klasse && !klasse.arbeiten.length);
  const system = klasse && !(systemMismatch && umstellen) ? klasse.settings.system : layout.system;
  const settings = { ...(klasse?.settings || newKlasse().settings), system };

  const setL = (patch) => {
    const next = { ...layout, ...patch };
    setLayout(next);
    if ('headerRows' in patch) setCols((cs) => cs.map((c) => ({ ...c, title: columnTitle(rows, next.headerRows, c.c) || c.title })));
  };
  const setC = (i, patch) => setCols((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const dataRows = rows.slice(layout.headerRows).filter((r) => isStudentRow(r, layout));
  const schueler = klasse?.schueler || [];
  const neu = dataRows.filter((r) => !findStudent(schueler, nameOf(r, layout))).length;
  const used = cols.filter((c) => c.use);
  const invalid = used.reduce((n, c) => n + dataRows.filter((r) => r[c.c] && !isValidGrade(cleanGrade(r[c.c]), settings)).length, 0);

  const bereichOptions = (c) => {
    const opts = (fach?.bereiche || []).map((b) => [b.id, b.name]);
    const own = `neu:${c.title.split(' – ').pop()}`;
    if (!opts.some(([, n]) => `neu:${n}` === own)) opts.push([own, `Neuer Bereich „${own.slice(4)}“`]);
    for (const n of ['Schriftlich', 'Mündlich']) if (!opts.some(([v, l]) => v === `neu:${n}` || l === n)) opts.push([`neu:${n}`, `Neuer Bereich „${n}“`]);
    return opts;
  };

  function doImport() {
    let summary = '';
    const zielFachId = fach ? fach.id : uid();
    update((d) => {
      let k = d.klassen.find((x) => x.id === klasseId);
      if (!k) {
        k = newKlasse(neueKlasse || 'Importierte Klasse');
        k.settings.system = layout.system;
        k.faecher = [];
        d.klassen.push(k);
      }
      d.activeKlasseId = k.id;
      if (systemMismatch && umstellen) k.settings.system = layout.system;
      let f = k.faecher.find((x) => x.id === fachId);
      if (!f) {
        f = { ...newFach(fachName || 'Importiertes Fach'), id: zielFachId, gruppen: [], bereiche: [], gruppierung: true };
        k.faecher.push(f);
      }
      const bereichId = (key) => {
        if (!key.startsWith('neu:')) return key;
        const name = key.slice(4);
        let b = f.bereiche.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (!b) {
          b = { id: uid(), name, kurz: '', weight: 1, color: COLORS[f.bereiche.length % COLORS.length] };
          f.bereiche.push(b);
        }
        return b.id;
      };
      const arbeiten = used.map((c) => ({
        id: uid(), title: c.title, fachId: f.id, bereichId: bereichId(c.bereich), halbjahr: hj,
        date: c.date || today(), mitDatum: !!c.date, individuell: false, weight: 1, locked: false,
        useSchluessel: false, maxPoints: 50, schluessel: defaultSchluessel(k.settings), notiz: 'Importiert aus ' + fileName, results: {},
      }));
      let nNeu = 0;
      let nNoten = 0;
      for (const r of dataRows) {
        const n = nameOf(r, layout);
        let st = findStudent(k.schueler, n);
        if (!st) {
          st = { id: uid(), first: n.first, last: n.last, bemerkung: '', fachNotizen: {}, erinnerungen: {} };
          k.schueler.push(st);
          nNeu++;
        }
        used.forEach((c, i) => {
          const g = cleanGrade(r[c.c] || '');
          if (g) { arbeiten[i].results[st.id] = { grade: g }; nNoten++; }
        });
      }
      k.arbeiten.push(...arbeiten);
      summary = `${arbeiten.length} Arbeit(en) mit ${nNoten} Noten in „${f.name}“ importiert, ${nNeu} Schüler neu angelegt.`;
    });
    ctx.setSel({ fachId: zielFachId, bereichId: null, arbeitId: null, hj });
    onClose();
    setTimeout(() => alert(summary), 50);
  }

  return (
    <Modal
      title={`Noten importieren – ${fileName}`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted grow">
            {dataRows.length} Schüler · {used.length} Notenspalten{neu ? ` · ${neu} Schüler werden neu angelegt` : ''}
            {invalid ? ` · ⚠ ${invalid} ungültige Werte (werden trotzdem übernommen und rot markiert)` : ''}
          </span>
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" disabled={!used.length || !dataRows.length} onClick={doImport}>Importieren</button>
        </>
      }
    >
      <div className="import-grid">
        <Field label="In Klasse">
          <select value={klasseId} onChange={(e) => { const v = e.target.value; setKlasseId(v); setFachId('neu'); setUmstellen(!klassen.find((k) => k.id === v)?.arbeiten.length); }}>
            {klassen.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.schuljahr})</option>)}
            <option value="neu">+ Neue Klasse …</option>
          </select>
          {klasseId === 'neu' && <input value={neueKlasse} onChange={(e) => setNeueKlasse(e.target.value)} placeholder="Klassenname" />}
        </Field>
        <Field label="In Fach">
          <select value={fachId} onChange={(e) => { setFachId(e.target.value); setCols((cs) => cs.map((c) => ({ ...c, bereich: `neu:${c.title.split(' – ').pop()}` }))); }}>
            {(klasse?.faecher || []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            <option value="neu">+ Neues Fach …</option>
          </select>
          {fachId === 'neu' && <input value={fachName} onChange={(e) => setFachName(e.target.value)} placeholder="Fachname" />}
        </Field>
        <Field label="Halbjahr">
          <select value={hj} onChange={(e) => setHj(Number(e.target.value))}>
            <option value={1}>1. Halbjahr</option>
            <option value={2}>2. Halbjahr</option>
          </select>
        </Field>
        <Field label="Kopfzeilen">
          <input type="number" min="0" max="6" className="num" value={layout.headerRows} onChange={(e) => setL({ headerRows: Math.max(0, Number(e.target.value)) })} />
        </Field>
        <Field label="Namen">
          <select value={layout.nameMode} onChange={(e) => setL({ nameMode: e.target.value })}>
            <option value="komma">Eine Spalte „Nachname, Vorname“</option>
            <option value="leer">Eine Spalte „Vorname Nachname“</option>
            <option value="zwei">Zwei Spalten</option>
          </select>
          <span className="row">
            {layout.nameMode === 'zwei' ? 'Nachname' : 'Spalte'}
            <select value={layout.nameCol} onChange={(e) => setL({ nameCol: Number(e.target.value) })}>
              {rows[0].map((_, c) => <option key={c} value={c}>{c + 1}</option>)}
            </select>
            {layout.nameMode === 'zwei' && (
              <>
                Vorname
                <select value={layout.firstCol} onChange={(e) => setL({ firstCol: Number(e.target.value) })}>
                  {rows[0].map((_, c) => <option key={c} value={c}>{c + 1}</option>)}
                </select>
              </>
            )}
          </span>
        </Field>
      </div>
      {systemMismatch && (
        <div className="hint">
          ⚠ Die Datei enthält {layout.system === 'punkte' ? 'Notenpunkte (0–15)' : 'Noten (1–6)'}, die Klasse ist auf {klasse.settings.system === 'punkte' ? 'Notenpunkte' : 'Noten'} eingestellt.
          <label className="check block">
            <input type="checkbox" checked={umstellen} onChange={(e) => setUmstellen(e.target.checked)} />
            Klasse „{klasse.name}“ auf {layout.system === 'punkte' ? 'Notenpunkte' : 'Noten'} umstellen
            {klasse.arbeiten.length > 0 && ' (Achtung: betrifft auch die vorhandenen Noten)'}
          </label>
        </div>
      )}

      <h4>Notenspalten</h4>
      <table className="grid small">
        <thead><tr><th></th><th>Spalte</th><th>Bezeichnung der Arbeit</th><th>Datum</th><th>Bereich</th><th>Beispiele</th><th>gültig</th></tr></thead>
        <tbody>
          {cols.map((c, i) => (
            <tr key={c.c} className={c.use ? '' : 'muted'}>
              <td><input type="checkbox" checked={c.use} onChange={(e) => setC(i, { use: e.target.checked })} aria-label="importieren" /></td>
              <td className="center">{c.c + 1}</td>
              <td><input value={c.title} onChange={(e) => setC(i, { title: e.target.value })} /></td>
              <td><input type="date" value={c.date} onChange={(e) => setC(i, { date: e.target.value })} /></td>
              <td>
                <select value={c.bereich} onChange={(e) => setC(i, { bereich: e.target.value })}>
                  {bereichOptions(c).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </td>
              <td className="muted">{dataRows.map((r) => r[c.c]).filter(Boolean).slice(0, 5).join('  ')}</td>
              <td className="center">{dataRows.filter((r) => r[c.c] && isValidGrade(cleanGrade(r[c.c]), settings)).length}/{dataRows.filter((r) => r[c.c]).length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Vorschau der Datei</h4>
      <div className="scroll-x preview">
        <table className="grid small">
          <tbody>
            {rows.slice(0, 12).map((r, ri) => {
              const isHead = ri < layout.headerRows;
              const isData = !isHead && isStudentRow(r, layout);
              return (
                <tr key={ri} className={isHead ? 'head' : isData ? '' : 'skip'}>
                  <td className="muted">{isHead ? 'Kopf' : isData ? '✓' : '–'}</td>
                  {r.map((v, ci) => (
                    <td key={ci} className={(layout.nameMode === 'zwei' ? [layout.nameCol, layout.firstCol] : [layout.nameCol]).includes(ci) ? 'namecol' : cols.find((c) => c.c === ci && c.use) ? 'usecol' : ''}>{v}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > 12 && <p className="muted small">… {rows.length - 12} weitere Zeilen</p>}
      </div>
    </Modal>
  );
}
