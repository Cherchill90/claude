import { useRef, useState } from 'react';
import {
  arbeitStats, defaultSchluessel, fmt, gradeFromPoints, isValidGrade, nimmtTeil, schluesselRanges, uid, fachTopLevel,
} from '../grades.js';
import { Notenspiegel } from '../charts.jsx';
import { Avatar, Field, fmtDate, sortSchueler, today, Empty, tone, toneGrade } from '../ui.jsx';

export function currentBereich(ctx) {
  const { fach, sel } = ctx;
  return fach.bereiche.find((b) => b.id === sel.bereichId) || fach.bereiche[0];
}

export function BereichSelect({ ctx, allowAll }) {
  const { fach, sel, setSel } = ctx;
  const bereich = currentBereich(ctx);
  return (
    <select
      value={sel.bereichId === 'alle' && allowAll ? 'alle' : bereich?.id || ''}
      onChange={(e) => setSel({ bereichId: e.target.value, arbeitId: null })}
      aria-label="Bereich"
    >
      {allowAll && <option value="alle">Alle Bereiche</option>}
      {fachTopLevel(fach).map((t) =>
        t.type === 'gruppe' ? (
          <optgroup key={t.id} label={t.name}>
            {t.bereiche.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </optgroup>
        ) : (
          <option key={t.id} value={t.id}>{t.name}</option>
        ),
      )}
    </select>
  );
}

function arbeitenListe(ctx) {
  const { klasse, fach, sel } = ctx;
  const bereich = currentBereich(ctx);
  return klasse.arbeiten
    .filter((a) => a.fachId === fach.id && a.bereichId === bereich?.id && (!sel.hj || a.halbjahr === sel.hj))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

export function NotenSide({ ctx }) {
  const { klasse, fach, sel, setSel, updK } = ctx;
  const bereich = currentBereich(ctx);
  if (!bereich) return <p className="pad muted">Dieses Fach hat noch keinen Bereich.</p>;
  const list = arbeitenListe(ctx);

  function neueArbeit() {
    const a = {
      id: uid(),
      title: `${bereich.name} ${list.length + 1}`,
      fachId: fach.id,
      bereichId: bereich.id,
      halbjahr: sel.hj || 1,
      date: today(),
      mitDatum: true,
      individuell: false,
      weight: 1,
      locked: false,
      useSchluessel: false,
      maxPoints: 50,
      schluessel: defaultSchluessel(klasse.settings),
      notiz: '',
      results: {},
    };
    updK((k) => k.arbeiten.push(a));
    setSel({ arbeitId: a.id });
  }

  return (
    <>
      <div className="selectors" style={{ paddingTop: 0 }}>
        <BereichSelect ctx={ctx} />
      </div>
      <ul className="list">
        {list.map((a) => (
          <li key={a.id} className={sel.arbeitId === a.id ? 'on' : ''} onClick={() => setSel({ arbeitId: a.id })}>
            <div>
              <b>{a.title}{a.locked && ' 🔒'}</b>
              <small>{a.mitDatum ? fmtDate(a.date) : ''}</small>
            </div>
            <span className="avg" style={tone(arbeitStats(klasse, a).avg, klasse.settings.system)}>Ø {fmt(arbeitStats(klasse, a).avg, klasse.settings.decimals)}</span>
          </li>
        ))}
        <li className="add" onClick={neueArbeit}>+ Neue Arbeit</li>
      </ul>
      <div className="side-foot">{klasse.schueler.length} Schüler</div>
    </>
  );
}

export function NotenMain({ ctx }) {
  const { klasse, sel, setSel, updK, data, update } = ctx;
  const list = arbeitenListe(ctx);
  const arbeit = list.find((a) => a.id === sel.arbeitId) || list[list.length - 1];
  const [showSchluessel, setShowSchluessel] = useState(false);
  const [paste, setPaste] = useState(null);
  const inputs = useRef([]);
  const s = klasse.settings;
  if (!arbeit) return <Empty>Noch keine Arbeit in diesem Bereich. Lege links eine „Neue Arbeit“ an.</Empty>;

  const schueler = sortSchueler(klasse.schueler).filter((st) => nimmtTeil(ctx.fach, st.id));
  const student = schueler.find((x) => x.id === sel.schuelerId) || schueler[0];
  const stats = arbeitStats(klasse, arbeit);
  const showFoto = data.prefs.fotoAnzeigen !== false;
  const zweispaltig = !!data.prefs.zweispaltig;

  const setA = (fn) => updK((k) => fn(k.arbeiten.find((x) => x.id === arbeit.id)));
  const setResult = (sid, patch) =>
    setA((a) => {
      a.results[sid] = { ...(a.results[sid] || {}), ...patch };
      if (a.useSchluessel && 'points' in patch) {
        a.results[sid].grade = gradeFromPoints(patch.points, a.maxPoints, a.schluessel) ?? '';
      }
    });

  function onKey(e, i) {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      inputs.current[i + 1]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      inputs.current[i - 1]?.focus();
    }
  }

  function applyPaste() {
    const lines = paste.split(/\r?\n/).map((l) => l.trim());
    setA((a) => {
      schueler.forEach((st, i) => {
        if (lines[i] === undefined || lines[i] === '') return;
        if (a.useSchluessel) {
          const p = Number(lines[i].replace(',', '.'));
          a.results[st.id] = { ...(a.results[st.id] || {}), points: p, grade: gradeFromPoints(p, a.maxPoints, a.schluessel) ?? '' };
        } else {
          a.results[st.id] = { ...(a.results[st.id] || {}), grade: lines[i] };
        }
      });
    });
    setPaste(null);
  }

  return (
    <div className="three-col">
      <section className="col details">
        <h3 className="tabhead">Arbeitsdetails</h3>
        <div className="row">
          <input className="grow" value={arbeit.title} disabled={arbeit.locked} onChange={(e) => setA((a) => (a.title = e.target.value))} aria-label="Bezeichnung" />
          <label className="check"><input type="checkbox" checked={!!arbeit.locked} onChange={(e) => setA((a) => (a.locked = e.target.checked))} /> Schreibschutz</label>
        </div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={!!arbeit.mitDatum} disabled={arbeit.locked} onChange={(e) => setA((a) => (a.mitDatum = e.target.checked))} /> Mit Datum</label>
          {arbeit.mitDatum && <input type="date" value={arbeit.date || ''} disabled={arbeit.locked} onChange={(e) => setA((a) => (a.date = e.target.value))} />}
        </div>
        <div className="row">
          <Field label="Halbjahr">
            <select value={arbeit.halbjahr} disabled={arbeit.locked} onChange={(e) => setA((a) => (a.halbjahr = Number(e.target.value)))}>
              <option value={1}>1. Halbjahr</option>
              <option value={2}>2. Halbjahr</option>
            </select>
          </Field>
          <Field label="Bereich">
            <select value={arbeit.bereichId} disabled={arbeit.locked} onChange={(e) => { setA((a) => (a.bereichId = e.target.value)); setSel({ bereichId: e.target.value }); }}>
              {ctx.fach.bereiche.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={!!arbeit.individuell} disabled={arbeit.locked} onChange={(e) => setA((a) => (a.individuell = e.target.checked))} /> Individuell gewichten</label>
          {arbeit.individuell && (
            <input type="number" min="0" step="0.5" className="num" value={arbeit.weight} disabled={arbeit.locked} onChange={(e) => setA((a) => (a.weight = Number(e.target.value)))} aria-label="Gewicht" />
          )}
        </div>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={!!arbeit.useSchluessel} disabled={arbeit.locked} onChange={(e) => setA((a) => { a.useSchluessel = e.target.checked; if (!a.schluessel) a.schluessel = defaultSchluessel(s); if (!a.maxPoints) a.maxPoints = 50; })} /> Notenschlüssel
          </label>
          {arbeit.useSchluessel && (
            <>
              <input type="number" min="1" className="num" value={arbeit.maxPoints} disabled={arbeit.locked} onChange={(e) => setA((a) => (a.maxPoints = Number(e.target.value)))} aria-label="Maximale Punkte" />
              <span className="muted">Punkte</span>
              <button onClick={() => setShowSchluessel(!showSchluessel)}>{showSchluessel ? 'ausblenden' : 'bearbeiten'}</button>
            </>
          )}
        </div>
        {arbeit.useSchluessel && showSchluessel && (
          <table className="grid small">
            <thead><tr><th>Note</th><th>ab %</th><th>Punkte</th></tr></thead>
            <tbody>
              {schluesselRanges(arbeit.maxPoints, arbeit.schluessel).map((r) => (
                <tr key={r.grade}>
                  <td>{r.grade}</td>
                  <td>
                    <input
                      type="number" className="num" value={r.min} disabled={arbeit.locked}
                      onChange={(e) =>
                        setA((a) => {
                          a.schluessel.find((x) => x.grade === r.grade).min = Number(e.target.value);
                          for (const [sid, res] of Object.entries(a.results))
                            if (res.points !== undefined && res.points !== '') a.results[sid].grade = gradeFromPoints(res.points, a.maxPoints, a.schluessel);
                        })
                      }
                    />
                  </td>
                  <td>{fmt(r.from, 1)} – {fmt(r.to, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <textarea placeholder="Notiz zur Arbeit" rows="5" value={arbeit.notiz || ''} onChange={(e) => setA((a) => (a.notiz = e.target.value))} />
        <div className="row">
          <button disabled={arbeit.locked} onClick={() => setPaste('')} title="Noten aus Excel o. Ä. einfügen (eine Zeile pro Schüler, alphabetisch)">Noten importieren</button>
          <button
            className="danger" disabled={arbeit.locked}
            onClick={() => confirm(`„${arbeit.title}“ mit allen Noten löschen?`) && (updK((k) => (k.arbeiten = k.arbeiten.filter((x) => x.id !== arbeit.id))), setSel({ arbeitId: null }))}
          >
            „{arbeit.title}“ löschen
          </button>
        </div>
        {paste !== null && (
          <div className="card">
            <p className="muted">Eine {arbeit.useSchluessel ? 'Punktzahl' : 'Note'} pro Zeile, in der Reihenfolge der Schülerliste (alphabetisch). Leere Zeilen werden übersprungen.</p>
            <textarea rows="8" value={paste} onChange={(e) => setPaste(e.target.value)} autoFocus />
            <div className="row"><button className="primary" onClick={applyPaste}>Übernehmen</button><button onClick={() => setPaste(null)}>Abbrechen</button></div>
          </div>
        )}
      </section>

      <section className="col entry">
        <div className="row end no-print">
          <label className="check"><input type="checkbox" checked={showFoto} onChange={(e) => update((d) => (d.prefs.fotoAnzeigen = e.target.checked))} /> Foto anzeigen</label>
          <div className="seg small">
            <button className={!zweispaltig ? 'on' : ''} onClick={() => update((d) => (d.prefs.zweispaltig = false))} title="Einspaltig">1 Spalte</button>
            <button className={zweispaltig ? 'on' : ''} onClick={() => update((d) => (d.prefs.zweispaltig = true))} title="Zweispaltig">2 Spalten</button>
          </div>
        </div>
        <h2 className="print-only">{klasse.name} · {ctx.fach.name} · {arbeit.title} {arbeit.mitDatum && fmtDate(arbeit.date)}</h2>
        {!schueler.length && <Empty>Noch keine Schüler. Über „☰ Klasse → Klassen verwalten“ hinzufügen.</Empty>}
        <ul className={'entry-list' + (zweispaltig ? ' two' : '')}>
          {schueler.map((st, i) => {
            const r = arbeit.results[st.id] || {};
            const valid = isValidGrade(r.grade, s);
            return (
              <li key={st.id} className={student?.id === st.id ? 'on' : ''} onClick={() => setSel({ schuelerId: st.id })}>
                {showFoto && <Avatar s={st} size={40} />}
                <span className="name"><b>{st.last}</b>{st.first && `, ${st.first}`}{r.notiz && <span title={r.notiz}> 📝</span>}</span>
                {arbeit.useSchluessel && (
                  <input
                    ref={(el) => (inputs.current[i] = el)}
                    className="pts" inputMode="decimal" placeholder="Pkt." disabled={arbeit.locked}
                    value={r.points ?? ''}
                    onFocus={() => setSel({ schuelerId: st.id })}
                    onKeyDown={(e) => onKey(e, i)}
                    onChange={(e) => setResult(st.id, { points: e.target.value === '' ? '' : Number(e.target.value.replace(',', '.')) })}
                    aria-label={`Punkte ${st.last}`}
                  />
                )}
                <input
                  ref={arbeit.useSchluessel ? undefined : (el) => (inputs.current[i] = el)}
                  className={'grade' + (valid ? '' : ' invalid')}
                  style={valid ? toneGrade(r.grade, s) : undefined}
                  value={r.grade ?? ''}
                  disabled={arbeit.locked || arbeit.useSchluessel}
                  onFocus={(e) => { setSel({ schuelerId: st.id }); e.target.select(); }}
                  onKeyDown={(e) => onKey(e, i)}
                  onChange={(e) => setResult(st.id, { grade: e.target.value.trim() })}
                  aria-label={`Note ${st.last}`}
                  title={valid ? '' : s.system === 'punkte' ? 'Gültig: 0–15' : 'Gültig: 1–6, ggf. mit + / − oder z. B. 2,5'}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <section className="col right">
        {student && (
          <div className="card no-print">
            <b>{student.last}{student.first && `, ${student.first}`}</b>
            <textarea
              placeholder="Notiz zur Leistung" rows="4"
              value={arbeit.results[student.id]?.notiz || ''}
              onChange={(e) => setResult(student.id, { notiz: e.target.value })}
            />
            <div className="row">
              <label className="check">
                <input type="checkbox" checked={!!arbeit.results[student.id]?.date} onChange={(e) => setResult(student.id, { date: e.target.checked ? today() : '' })} /> Mit Datum
              </label>
              {arbeit.results[student.id]?.date && (
                <input type="date" value={arbeit.results[student.id].date} onChange={(e) => setResult(student.id, { date: e.target.value })} />
              )}
            </div>
          </div>
        )}
        <Notenspiegel spiegel={stats.spiegel} avg={stats.avg} decimals={s.decimals} />
        {arbeit.useSchluessel && (
          <p className="muted">
            Ø Punkte: {fmt(avgPoints(arbeit), 1)} von {arbeit.maxPoints}
          </p>
        )}
      </section>
    </div>
  );
}

function avgPoints(a) {
  const v = Object.values(a.results).map((r) => r.points).filter((p) => p !== undefined && p !== '' && !Number.isNaN(p));
  return v.length ? v.reduce((x, y) => x + Number(y), 0) / v.length : null;
}

