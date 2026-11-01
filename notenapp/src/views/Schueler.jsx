import { useState } from 'react';
import {
  bereichAvg, fachAvg, fachTopLevel, fmt, gradeValue, gruppeAvg, roundToZeugnis, zeugnisNote,
} from '../grades.js';
import { Verlauf } from '../charts.jsx';
import { Avatar, Empty, fmtDate, readPhoto, sortSchueler } from '../ui.jsx';

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
            <span className="avg">Ø {fmt(fachAvg(klasse, st.id, fach.id, sel.hj), klasse.settings.decimals)}</span>
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
  const rows = Math.max(1, ...cols.map((b) => arbeitenOf(b.id).filter((a) => a.results[st.id]?.grade).length));
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
                    const a = arbeitenOf(b.id).filter((x) => x.results[st.id]?.grade)[r];
                    const res = a?.results[st.id];
                    return (
                      <td key={b.id} className="center" title={a ? `${a.title}${a.mitDatum ? ' · ' + fmtDate(res.date || a.date) : ''}${res.notiz ? '\n' + res.notiz : ''}` : ''}>
                        {a && <><span className="big">{res.grade}</span><small className="muted block">{a.title}</small></>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                    <td>{roundToZeugnis(avg, s) ?? '–'}</td>
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
