import { useState } from 'react';
import { uid, defaultSchluessel, fachAvg, fmt, isValidGrade } from '../grades.js';
import { Avatar, Empty, fullName, sortSchueler, today, fmtDate, toneGrade } from '../ui.jsx';

const MAX_PLAENE = 3;

function currentPlan(ctx) {
  const { klasse, sel } = ctx;
  return klasse.sitzplaene.find((p) => p.id === sel.planId) || klasse.sitzplaene[0];
}

export function SitzplanSide({ ctx }) {
  const { klasse, sel, setSel, updK, fach } = ctx;
  const plan = currentPlan(ctx);
  const mode = sel.planMode || 'unterricht';
  const arbeiten = klasse.arbeiten.filter((a) => a.fachId === fach.id && !a.locked);
  return (
    <div className="pad">
      <select value={fach.id} onChange={(e) => setSel({ fachId: e.target.value, sitzArbeitId: null })} aria-label="Fach">
        {klasse.faecher.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      <ul className="list compact">
        {klasse.sitzplaene.map((p) => (
          <li key={p.id} className={plan?.id === p.id ? 'on' : ''} onClick={() => setSel({ planId: p.id })}><b>{p.name}</b></li>
        ))}
        {klasse.sitzplaene.length < MAX_PLAENE && (
          <li className="add" onClick={() => { const p = { id: uid(), name: `Plan ${klasse.sitzplaene.length + 1}`, rows: 5, cols: 6, seats: {} }; updK((k) => k.sitzplaene.push(p)); setSel({ planId: p.id }); }}>
            + Neuer Sitzplan
          </li>
        )}
      </ul>
      <div className="seg">
        <button className={mode === 'unterricht' ? 'on' : ''} onClick={() => setSel({ planMode: 'unterricht' })}>Unterricht</button>
        <button className={mode === 'bearbeiten' ? 'on' : ''} onClick={() => setSel({ planMode: 'bearbeiten' })}>Bearbeiten</button>
      </div>
      {mode === 'unterricht' && (
        <label className="field">
          <span>Noten eintragen in</span>
          <select value={sel.sitzArbeitId || ''} onChange={(e) => setSel({ sitzArbeitId: e.target.value })}>
            <option value="">– Arbeit wählen –</option>
            {arbeiten.map((a) => (
              <option key={a.id} value={a.id}>{a.title}{a.mitDatum ? ` (${fmtDate(a.date)})` : ''}</option>
            ))}
          </select>
          <button
            onClick={() => {
              const b = fach.bereiche.find((x) => /münd/i.test(x.name)) || fach.bereiche[fach.bereiche.length - 1];
              if (!b) return;
              const a = { id: uid(), title: `Mündlich ${fmtDate(today())}`, fachId: fach.id, bereichId: b.id, halbjahr: sel.hj || 1, date: today(), mitDatum: true, individuell: false, weight: 1, locked: false, useSchluessel: false, maxPoints: 50, schluessel: defaultSchluessel(klasse.settings), notiz: '', results: {} };
              updK((k) => k.arbeiten.push(a));
              setSel({ sitzArbeitId: a.id });
            }}
          >
            + Neue mündliche Note (heute)
          </button>
        </label>
      )}
      {mode === 'bearbeiten' && plan && (
        <>
          <label className="field"><span>Name</span><input value={plan.name} onChange={(e) => updK((k) => (k.sitzplaene.find((p) => p.id === plan.id).name = e.target.value))} /></label>
          <div className="row">
            <label className="field"><span>Reihen</span><input type="number" min="1" max="12" className="num" value={plan.rows} onChange={(e) => updK((k) => (k.sitzplaene.find((p) => p.id === plan.id).rows = Number(e.target.value)))} /></label>
            <label className="field"><span>Plätze</span><input type="number" min="1" max="14" className="num" value={plan.cols} onChange={(e) => updK((k) => (k.sitzplaene.find((p) => p.id === plan.id).cols = Number(e.target.value)))} /></label>
          </div>
          <button onClick={() => updK((k) => (k.sitzplaene.find((p) => p.id === plan.id).seats = {}))}>Alle Plätze leeren</button>
          <button onClick={() => {
            const ids = sortSchueler(klasse.schueler).map((s) => s.id);
            updK((k) => {
              const p = k.sitzplaene.find((x) => x.id === plan.id);
              p.seats = {};
              let i = 0;
              for (let r = 0; r < p.rows; r++) for (let c = 0; c < p.cols; c++) if (i < ids.length) p.seats[`${r}-${c}`] = ids[i++];
            });
          }}>Alphabetisch füllen</button>
          {klasse.sitzplaene.length > 1 && (
            <button className="danger" onClick={() => confirm(`„${plan.name}“ löschen?`) && (updK((k) => (k.sitzplaene = k.sitzplaene.filter((p) => p.id !== plan.id))), setSel({ planId: null }))}>Sitzplan löschen</button>
          )}
        </>
      )}
    </div>
  );
}

export function SitzplanMain({ ctx }) {
  const { klasse, sel, updK, fach, setSel } = ctx;
  const plan = currentPlan(ctx);
  const [picked, setPicked] = useState(null); // Bearbeiten: ausgewählter Schüler (für Klick-Platzierung)
  const [active, setActive] = useState(null); // Unterricht: Schüler-Popover
  if (!plan) return <Empty>Kein Sitzplan.</Empty>;
  const mode = sel.planMode || 'unterricht';
  const byId = Object.fromEntries(klasse.schueler.map((s) => [s.id, s]));
  const seated = new Set(Object.values(plan.seats));
  const unseated = sortSchueler(klasse.schueler.filter((s) => !seated.has(s.id)));
  const setPlan = (fn) => updK((k) => fn(k.sitzplaene.find((p) => p.id === plan.id)));
  const arbeit = klasse.arbeiten.find((a) => a.id === sel.sitzArbeitId);

  function place(sid, seat) {
    setPlan((p) => {
      const from = Object.keys(p.seats).find((k) => p.seats[k] === sid);
      const occupant = p.seats[seat];
      if (from) delete p.seats[from];
      if (occupant && from) p.seats[from] = occupant; // Plätze tauschen
      p.seats[seat] = sid;
    });
  }

  function onSeat(seat) {
    const sid = plan.seats[seat];
    if (mode === 'bearbeiten') {
      if (picked) { place(picked, seat); setPicked(null); }
      else if (sid) setPicked(sid);
    } else if (sid) setActive(sid);
  }

  const st = active && byId[active];
  return (
    <div className="pad sitzplan">
      <h2 className="print-only">Sitzplan {klasse.name} – {plan.name}</h2>
      <div className="pult no-print">Tafel / Pult</div>
      <div className="seats" style={{ gridTemplateColumns: `repeat(${plan.cols}, minmax(84px, 1fr))` }}>
        {Array.from({ length: plan.rows * plan.cols }, (_, i) => {
          const seat = `${Math.floor(i / plan.cols)}-${i % plan.cols}`;
          const s = byId[plan.seats[seat]];
          const grade = s && arbeit?.results[s.id]?.grade;
          return (
            <div
              key={seat}
              className={'seat' + (s ? ' filled' : '') + (picked && s?.id === picked ? ' picked' : '')}
              onClick={() => onSeat(seat)}
              onDragOver={(e) => mode === 'bearbeiten' && e.preventDefault()}
              onDrop={(e) => { const sid = e.dataTransfer.getData('text/plain'); if (sid) place(sid, seat); }}
              draggable={mode === 'bearbeiten' && !!s}
              onDragStart={(e) => s && e.dataTransfer.setData('text/plain', s.id)}
            >
              {s && (
                <>
                  <Avatar s={s} size={42} />
                  <span className="seat-name">{s.first || s.last}<br /><small>{s.first ? s.last : ''}</small></span>
                  {grade && <span className="seat-grade" style={toneGrade(grade, klasse.settings)}>{grade}</span>}
                  {mode === 'bearbeiten' && (
                    <button className="seat-x" onClick={(e) => { e.stopPropagation(); setPlan((p) => delete p.seats[seat]); }} aria-label="Platz leeren">✕</button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {mode === 'bearbeiten' && (
        <div className="card no-print">
          <b>Ohne Platz ({unseated.length})</b> <span className="muted">– auf einen Platz ziehen oder anklicken und dann Platz wählen</span>
          <div className="chips">
            {unseated.map((s) => (
              <span
                key={s.id} className={'chip big' + (picked === s.id ? ' on' : '')} draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', s.id)}
                onClick={() => setPicked(picked === s.id ? null : s.id)}
              >
                {fullName(s)}
              </span>
            ))}
          </div>
        </div>
      )}

      {st && mode === 'unterricht' && (
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && setActive(null)}>
          <div className="modal">
            <header><h2>{fullName(st)}</h2><button className="icon" onClick={() => setActive(null)}>✕</button></header>
            <div className="modal-body">
              <div className="row"><Avatar s={st} size={64} /><span>Ø {fach.name}: <b>{fmt(fachAvg(klasse, st.id, fach.id, sel.hj), klasse.settings.decimals)}</b></span></div>
              {st.erinnerungen?.[fach.id] && <p className="hint">⏰ {st.erinnerungen[fach.id]}</p>}
              {arbeit ? (
                <label className="field">
                  <span>Note für „{arbeit.title}“</span>
                  <input
                    autoFocus
                    className={'grade' + (isValidGrade(arbeit.results[st.id]?.grade, klasse.settings) ? '' : ' invalid')}
                    value={arbeit.results[st.id]?.grade || ''}
                    onChange={(e) => updK((k) => { const a = k.arbeiten.find((x) => x.id === arbeit.id); a.results[st.id] = { ...(a.results[st.id] || {}), grade: e.target.value.trim() }; })}
                    onKeyDown={(e) => e.key === 'Enter' && setActive(null)}
                  />
                </label>
              ) : (
                <p className="muted">Links eine Arbeit wählen, um Noten direkt im Sitzplan einzutragen.</p>
              )}
              <h4>Strichliste</h4>
              <div className="chips">
                {klasse.strichKategorien.map((c) => (
                  <button key={c.id} onClick={() => updK((k) => k.striche.push({ id: uid(), studentId: st.id, catId: c.id, date: today(), text: '' }))}>
                    + {c.name} ({klasse.striche.filter((x) => x.studentId === st.id && x.catId === c.id).length})
                  </button>
                ))}
              </div>
              <label className="field">
                <span>Notiz zum Fach „{fach.name}“</span>
                <textarea rows="3" value={st.fachNotizen?.[fach.id] || ''} onChange={(e) => updK((k) => { const x = k.schueler.find((y) => y.id === st.id); (x.fachNotizen ||= {})[fach.id] = e.target.value; })} />
              </label>
              <button onClick={() => { setSel({ schuelerId: st.id }); ctx.setTab('schueler'); }}>Schülerdetails öffnen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
