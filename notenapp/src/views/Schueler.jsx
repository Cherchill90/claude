import { useState } from 'react';
import {
  bereichAvg, defaultSchluessel, fachAvg, fachTopLevel, fmt, gradeFromPoints, gradeValue, gruppeAvg, isValidGrade, roundToZeugnis,
  zeugnisNote, nimmtTeil, roundAvg, uid,
} from '../grades.js';
import { Verlauf } from '../charts.jsx';
import { Avatar, Empty, fmtDate, readPhoto, sortSchueler, today } from '../ui.jsx';

export function SchuelerSide({ ctx }) {
  const { klasse, fach, sel, setSel, setModal } = ctx;
  const list = sortSchueler(klasse.schueler);
  return (
    <>
      <ul className="list">
        {list.map((st) => (
          <li key={st.id} className={sel.schuelerId === st.id ? 'on' : ''} onClick={() => setSel({ schuelerId: st.id })}>
            <Avatar s={st} size={34} />
            <div>
              <b>{st.first || st.last}</b>
              <small>{st.first ? st.last : ''}</small>
            </div>
            <span className="avg">{nimmtTeil(fach, st.id) ? `Ø ${fmt(fachAvg(klasse, st.id, fach.id, sel.hj), klasse.settings.decimals)}` : 'nimmt nicht teil'}</span>
          </li>
        ))}
        <li className="add" onClick={() => setModal('verwalten')}>Schüler bearbeiten</li>
      </ul>
      <div className="side-foot">{klasse.schueler.length} Schüler</div>
    </>
  );
}

export function SchuelerMain({ ctx }) {
  const { klasse, fach, sel, updK } = ctx;
  const [open, setOpen] = useState({ zeugnis: true, statistik: true });
  const list = sortSchueler(klasse.schueler);
  const st = list.find((x) => x.id === sel.schuelerId) || list[0];
  if (!st) return <Empty>Noch keine Schüler in dieser Klasse.</Empty>;
  const s = klasse.settings;
  const d = s.decimals;
  const hj = sel.hj;
  const setSt = (fn) => updK((k) => fn(k.schueler.find((x) => x.id === st.id)));

  const arbeitenOf = (bid) =>
    klasse.arbeiten
      .filter((a) => a.fachId === fach.id && a.bereichId === bid && (!hj || a.halbjahr === hj))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const series = fach.bereiche.map((b) => ({
    id: b.id,
    name: b.name,
    color: b.color || '#2a78d6',
    points: arbeitenOf(b.id)
      .map((a) => ({ arbeit: a, grade: a.results[st.id]?.grade, value: gradeValue(a.results[st.id]?.grade, s) }))
      .filter((p) => p.value !== null),
  })).filter((x) => x.points.length);

  const top = fachTopLevel(fach).filter((t) => t.type !== 'gruppe' || t.bereiche.length);
  const cols = top.flatMap((t) => (t.type === 'gruppe' ? t.bereiche : [t]));
  // Eine Zeile je Arbeit des Bereichs + eine leere Zeile für eine neue Note
  const rows = Math.max(...cols.map((b) => arbeitenOf(b.id).length), 0) + 1;
  const teil = nimmtTeil(fach, st.id);

  const setGrade = (aid, patch) =>
    updK((k) => {
      const a = k.arbeiten.find((x) => x.id === aid);
      const res = { ...(a.results[st.id] || {}), ...patch };
      if (a.useSchluessel && 'points' in patch) res.grade = gradeFromPoints(patch.points, a.maxPoints, a.schluessel) ?? '';
      if (!res.grade && (res.points === undefined || res.points === '') && !res.notiz) delete a.results[st.id];
      else a.results[st.id] = res;
    });

  const neueNote = (b, grade) =>
    updK((k) => {
      k.arbeiten.push({
        id: uid(), title: `${b.name} ${fmtDate(today())}`, fachId: fach.id, bereichId: b.id, halbjahr: hj || 1,
        date: today(), mitDatum: true, individuell: false, weight: 1, locked: false, useSchluessel: false, maxPoints: 50,
        schluessel: defaultSchluessel(k.settings), notiz: '', results: { [st.id]: { grade } },
      });
    });

  const focusCell = (bid, r) => document.querySelector(`[data-cell="${bid}|${r}"]`)?.focus();
  const onKey = (e, bid, r) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); focusCell(bid, r + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(bid, r - 1); }
  };
  const count = (bid) => arbeitenOf(bid).filter((a) => a.results[st.id]?.grade).length;

  // Statistik
  const striche = klasse.striche.filter((x) => x.studentId === st.id);
  const fehl = { F: 0, E: 0, V: 0 };
  for (const h of klasse.stunden) {
    const v = h.absences?.[st.id];
    if (v) fehl[v] = (fehl[v] || 0) + 1;
  }

  return (
    <div className="two-col">
      <section className="col">
        <h2 className="print-only">{st.last}{st.first && `, ${st.first}`} · {klasse.name} · {fach.name}</h2>
        <Verlauf series={series} system={s.system} />
        <div className="scroll-x">
          <table className="grid noten-tab">
            <thead>
              {top.some((t) => t.type === 'gruppe') && (
                <tr>
                  {top.map((t) => (
                    <th key={t.id} colSpan={t.type === 'gruppe' ? Math.max(1, t.bereiche.length) : 1} rowSpan={t.type === 'gruppe' ? 1 : 2} className="grp">
                      {t.name}
                      <div className="sub">
                        Ø {fmt(t.type === 'gruppe' ? gruppeAvg(klasse, st.id, fach, t, hj) : bereichAvg(klasse, st.id, fach.id, t.id, hj), d)}
                        {' · Gew. '}{t.weight}
                      </div>
                    </th>
                  ))}
                </tr>
              )}
              <tr>
                {cols
                  .filter((b) => !top.some((t) => t.type === 'gruppe') || b.gruppeId)
                  .map((b) => (
                    <th key={b.id} style={{ borderTop: `4px solid ${b.color || '#2a78d6'}` }}>
                      {b.name}
                      <div className="sub">Ø {fmt(bereichAvg(klasse, st.id, fach.id, b.id, hj), d)} · {count(b.id)}×</div>
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, r) => (
                <tr key={r}>
                  {cols.map((b) => {
                    const list = arbeitenOf(b.id);
                    const a = list[r];
                    if (!a) {
                      return (
                        <td key={b.id} className="center cell-edit">
                          {r === list.length && teil && <NeueNoteZelle bid={b.id} r={r} settings={s} onKey={onKey} onCreate={(g) => neueNote(b, g)} />}
                        </td>
                      );
                    }
                    const res = a.results[st.id] || {};
                    const datum = res.date || (a.mitDatum ? a.date : '');
                    return (
                      <td key={b.id} className="center cell-edit" title={`${a.title}${datum ? ' · ' + fmtDate(datum) : ''}${res.notiz ? '\n' + res.notiz : ''}${a.locked ? '\n🔒 Schreibschutz' : ''}`}>
                        {a.useSchluessel ? (
                          <span className="row center-row">
                            <input
                              data-cell={`${b.id}|${r}`} className="pts" inputMode="decimal" placeholder="Pkt." disabled={a.locked || !teil}
                              value={res.points ?? ''} onKeyDown={(e) => onKey(e, b.id, r)}
                              onChange={(e) => setGrade(a.id, { points: e.target.value === '' ? '' : Number(e.target.value.replace(',', '.')) })}
                              aria-label={`Punkte ${a.title}`}
                            />
                            <span className="big">{res.grade || '–'}</span>
                          </span>
                        ) : (
                          <input
                            data-cell={`${b.id}|${r}`}
                            className={'grade big' + (isValidGrade(res.grade, s) ? '' : ' invalid')}
                            value={res.grade ?? ''}
                            disabled={a.locked || !teil}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={(e) => onKey(e, b.id, r)}
                            onChange={(e) => setGrade(a.id, { grade: e.target.value.trim() })}
                            aria-label={`Note ${a.title}`}
                          />
                        )}
                        <button
                          className="link-title" title="In der Notenansicht öffnen"
                          onClick={() => { ctx.setSel({ bereichId: b.id, arbeitId: a.id, hj: hj === 0 ? 0 : a.halbjahr }); ctx.setTab('noten'); }}
                        >
                          {a.locked && '🔒 '}{a.title}{res.notiz && ' 📝'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!teil && <p className="hint">Dieser Schüler nimmt an „{fach.name}“ nicht teil (Klassen verwalten → Fächer → Fachteilnahme).</p>}
        <p className="muted no-print small">Noten hier ändern = Änderung in der Notenansicht (gleiche Daten). Letzte Zeile: neue Note eintippen → legt eine neue Arbeit mit heutigem Datum an.</p>
        <p className="muted">
          Fachschnitt {hj ? `${hj}. Halbjahr` : 'Schuljahr'}: <b>Ø {fmt(fachAvg(klasse, st.id, fach.id, hj), d)}</b>
        </p>
      </section>

      <section className="col right">
        <Collapsible title="Zeugnisnoten" open={open.zeugnis} toggle={() => setOpen({ ...open, zeugnis: !open.zeugnis })}>
          <table className="grid small">
            <thead><tr><th></th><th>Ø</th><th>gerundet</th><th>Zeugnisnote</th></tr></thead>
            <tbody>
              {[[1, '1. Halbjahr'], [2, '2. Halbjahr'], [0, 'Jahr']].map(([h, l]) => {
                const avg = fachAvg(klasse, st.id, fach.id, h);
                const z = zeugnisNote(klasse, st.id, fach.id, h);
                const key = `${st.id}|${fach.id}|${h}`;
                return (
                  <tr key={h}>
                    <td>{l}</td>
                    <td>{fmt(avg, d)}</td>
                    <td>{roundToZeugnis(roundAvg(avg, d), s) ?? '–'}</td>
                    <td>
                      <input
                        className={'grade' + (z.manual ? ' manual' : '')}
                        placeholder={z.value}
                        value={klasse.zeugnis[key] ?? ''}
                        onChange={(e) => updK((k) => { if (e.target.value) k.zeugnis[key] = e.target.value; else delete k.zeugnis[key]; })}
                        title="Leer lassen = gerundeter Schnitt"
                        aria-label={`Zeugnisnote ${l}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Collapsible>

        <Collapsible title="Statistik & Notizen" open={open.statistik} toggle={() => setOpen({ ...open, statistik: !open.statistik })}>
          <div className="photo-box">
            <Avatar s={st} size={110} />
            <div>
              <label className="button">
                Foto wählen
                <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files[0]; if (f) { const p = await readPhoto(f); setSt((x) => (x.photo = p)); } }} />
              </label>
              {st.photo && <button onClick={() => setSt((x) => delete x.photo)}>Foto entfernen</button>}
            </div>
          </div>
          <label className="field"><span>Erinnerung in „{fach.name}“</span>
            <input value={st.erinnerungen?.[fach.id] || ''} onChange={(e) => setSt((x) => ((x.erinnerungen ||= {})[fach.id] = e.target.value))} />
          </label>
          <label className="field"><span>Notiz zum Fach „{fach.name}“</span>
            <textarea rows="3" value={st.fachNotizen?.[fach.id] || ''} onChange={(e) => setSt((x) => ((x.fachNotizen ||= {})[fach.id] = e.target.value))} />
          </label>
          <label className="field"><span>Bemerkung (allgemein)</span>
            <textarea rows="3" value={st.bemerkung || ''} onChange={(e) => setSt((x) => (x.bemerkung = e.target.value))} />
          </label>
          <h4>Strichlisten</h4>
          <ul className="plain">
            {klasse.strichKategorien.map((k) => (
              <li key={k.id}>{k.name}: <b>{striche.filter((x) => x.catId === k.id).length}</b></li>
            ))}
          </ul>
          <h4>Klassenbuch</h4>
          <ul className="plain">
            <li>Gefehlt (unentschuldigt): <b>{fehl.F}</b></li>
            <li>Gefehlt (entschuldigt): <b>{fehl.E}</b></li>
            <li>Verspätet: <b>{fehl.V}</b></li>
          </ul>
        </Collapsible>
      </section>
    </div>
  );
}

export function Collapsible({ title, open, toggle, children }) {
  return (
    <div className="collapsible">
      <button className="coll-head" onClick={toggle} aria-expanded={open}>
        <h3>{title}</h3><span>{open ? '⌃' : '⌄'}</span>
      </button>
      {open && <div className="coll-body">{children}</div>}
    </div>
  );
}

function NeueNoteZelle({ bid, r, settings, onKey, onCreate }) {
  const [v, setV] = useState('');
  const commit = () => {
    if (v && isValidGrade(v, settings)) { onCreate(v); setV(''); }
  };
  return (
    <input
      data-cell={`${bid}|${r}`}
      className={'grade big new' + (v && !isValidGrade(v, settings) ? ' invalid' : '')}
      placeholder="+"
      value={v}
      onChange={(e) => setV(e.target.value.trim())}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else onKey(e, bid, r); }}
      onBlur={commit}
      aria-label="Neue Note"
      title="Neue Note eintragen (legt eine neue Arbeit an)"
    />
  );
}
