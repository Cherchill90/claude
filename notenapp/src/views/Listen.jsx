import { useState } from 'react';
import { bereichAvg, fachAvg, fachTopLevel, fmt, gesamtAvg, gruppeAvg, nimmtTeil, zeugnisNote, uid } from '../grades.js';
import { Avatar, downloadCsv, Empty, fmtDate, fullName, PrintButton, sortSchueler, today, tone, toneGrade, toneText } from '../ui.jsx';

export const LISTEN = [
  ['strich', 'Strichlisten'],
  ['fach', 'Fach auf einen Blick'],
  ['schueler', 'Schüler auf einen Blick'],
  ['durchschnitte', 'Durchschnitte'],
  ['zeugnis', 'Zeugnisnoten'],
  ['klassenliste', 'Klassenlisten'],
  ['klassenbuch', 'Klassenbuch'],
];

export function ListenSide({ ctx }) {
  const { sel, setSel } = ctx;
  return (
    <ul className="list">
      {LISTEN.map(([id, label]) => (
        <li key={id} className={sel.liste === id ? 'on' : ''} onClick={() => setSel({ liste: id })}><b>{label}</b></li>
      ))}
    </ul>
  );
}

export function ListenMain({ ctx }) {
  const C = { strich: Strichlisten, fach: FachBlick, schueler: SchuelerBlick, durchschnitte: Durchschnitte, zeugnis: Zeugnisnoten, klassenliste: Klassenliste, klassenbuch: Klassenbuch }[ctx.sel.liste] || FachBlick;
  return <C ctx={ctx} />;
}

const hjLabel = (hj) => (hj === 1 ? '1. Halbjahr' : hj === 2 ? '2. Halbjahr' : 'Schuljahr');

function Toolbar({ title, csv, children }) {
  return (
    <>
      <div className="toolbar no-print">
        <h2>{title}</h2>
        <div className="row">
          {children}
          {csv && <button onClick={csv}>⇩ Excel/CSV</button>}
          <PrintButton />
        </div>
      </div>
      <h2 className="print-only">{title}</h2>
    </>
  );
}

// ---------- Fach auf einen Blick ----------
function vorjahrNote(ctx, st, fach) {
  const { data, klasse } = ctx;
  if (!klasse.vorjahr) return '';
  const alt = data.klassen.find((k) => k.id === klasse.vorjahr.klasseId);
  if (!alt) return '';
  const oldId = Object.entries(klasse.vorjahr.idMap).find(([, n]) => n === st.id)?.[0];
  const f = alt.faecher.find((x) => x.name === fach.name);
  return oldId && f ? zeugnisNote(alt, oldId, f.id, 0).value : '';
}

function FachBlick({ ctx }) {
  const { klasse, fach, sel } = ctx;
  const hj = sel.hj;
  const d = klasse.settings.decimals;
  const list = sortSchueler(klasse.schueler).filter((st) => nimmtTeil(fach, st.id));
  const top = fachTopLevel(fach);
  const kz = (x) => x.kurz || x.name;
  const cols = [];
  for (const t of top) {
    if (t.type === 'gruppe') {
      t.bereiche.forEach((b) => cols.push({ label: kz(b), f: (st) => bereichAvg(klasse, st.id, fach.id, b.id, hj) }));
      cols.push({ label: `Ø ${kz(t)}`, f: (st) => gruppeAvg(klasse, st.id, fach, t, hj), strong: true });
    } else cols.push({ label: kz(t), f: (st) => bereichAvg(klasse, st.id, fach.id, t.id, hj) });
  }
  const withVorjahr = !!klasse.vorjahr;
  const head = ['Schüler', ...cols.map((c) => c.label), 'Ø Fach', 'Zeugnisnote', ...(withVorjahr ? ['Vorjahr'] : [])];
  const row = (st) => [
    fullName(st),
    ...cols.map((c) => fmt(c.f(st), d)),
    fmt(fachAvg(klasse, st.id, fach.id, hj), d),
    zeugnisNote(klasse, st.id, fach.id, hj).value,
    ...(withVorjahr ? [vorjahrNote(ctx, st, fach)] : []),
  ];
  const title = `${klasse.name} · ${fach.name} · ${hjLabel(hj)}`;
  return (
    <div className="pad">
      <Toolbar title={`Fach auf einen Blick – ${title}`} csv={() => downloadCsv(`${title}.csv`, [head, ...list.map(row)])} />
      <div className="scroll-x">
        <table className="grid striped">
          <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {list.map((st) => (
              <tr key={st.id}>
                {row(st).map((v, i) => <td key={i} className={i ? 'center' : ''} style={i ? toneText(v, klasse.settings.system) : undefined}>{i === cols.length + 2 ? <b>{v}</b> : v}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Schüler auf einen Blick ----------
function SchuelerBlick({ ctx }) {
  const { klasse, sel } = ctx;
  const d = klasse.settings.decimals;
  const list = sortSchueler(klasse.schueler);
  const only = sel.schuelerBlickId ? list.filter((s) => s.id === sel.schuelerBlickId) : list;
  return (
    <div className="pad">
      <Toolbar title={`Schüler auf einen Blick – ${klasse.name}`}>
        <select value={sel.schuelerBlickId || ''} onChange={(e) => ctx.setSel({ schuelerBlickId: e.target.value || null })}>
          <option value="">Alle Schüler</option>
          {list.map((s) => <option key={s.id} value={s.id}>{fullName(s)}</option>)}
        </select>
      </Toolbar>
      {only.map((st) => (
        <div key={st.id} className="card page-break">
          <div className="row"><Avatar s={st} size={56} /><h3>{fullName(st)}</h3></div>
          {st.bemerkung && <p><i>Bemerkung:</i> {st.bemerkung}</p>}
          <table className="grid">
            <thead><tr><th>Fach</th><th>Noten</th><th>Ø 1. HJ</th><th>Ø 2. HJ</th><th>Ø Jahr</th><th>Zeugnis</th><th>Notiz</th></tr></thead>
            <tbody>
              {klasse.faecher.filter((f) => nimmtTeil(f, st.id)).map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>
                    {klasse.arbeiten
                      .filter((a) => a.fachId === f.id && a.results[st.id]?.grade)
                      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
                      .map((a) => (
                        <span key={a.id} className="chip" style={toneGrade(a.results[st.id].grade, klasse.settings)} title={`${a.title} ${fmtDate(a.date)}${a.results[st.id].notiz ? ' – ' + a.results[st.id].notiz : ''}`}>
                          {a.results[st.id].grade}
                        </span>
                      ))}
                  </td>
                  <td className="center" style={tone(fachAvg(klasse, st.id, f.id, 1), klasse.settings.system)}>{fmt(fachAvg(klasse, st.id, f.id, 1), d)}</td>
                  <td className="center" style={tone(fachAvg(klasse, st.id, f.id, 2), klasse.settings.system)}>{fmt(fachAvg(klasse, st.id, f.id, 2), d)}</td>
                  <td className="center" style={tone(fachAvg(klasse, st.id, f.id, 0), klasse.settings.system)}>{fmt(fachAvg(klasse, st.id, f.id, 0), d)}</td>
                  <td className="center" style={toneText(zeugnisNote(klasse, st.id, f.id, sel.hj).value, klasse.settings.system)}><b>{zeugnisNote(klasse, st.id, f.id, sel.hj).value}</b></td>
                  <td>{st.fachNotizen?.[f.id]}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan="2">Gesamtschnitt (Fachgewichte)</th>
                {[1, 2, 0].map((h) => <th key={h} className="center" style={tone(gesamtAvg(klasse, st.id, h), klasse.settings.system)}>{fmt(gesamtAvg(klasse, st.id, h), d)}</th>)}
                <th colSpan="2"></th>
              </tr>
            </tfoot>
          </table>
          <p className="muted">
            {klasse.strichKategorien.map((k) => `${k.name}: ${klasse.striche.filter((x) => x.studentId === st.id && x.catId === k.id).length}`).join(' · ')}
          </p>
        </div>
      ))}
    </div>
  );
}

// ---------- Durchschnitte ----------
function Durchschnitte({ ctx }) {
  const { klasse } = ctx;
  const d = klasse.settings.decimals;
  const list = sortSchueler(klasse.schueler);
  const head = ['Schüler', ...klasse.faecher.flatMap((f) => [`${f.name} 1. HJ`, `${f.name} 2. HJ`, `${f.name} Jahr`]), 'Gesamt 1. HJ', 'Gesamt 2. HJ', 'Gesamt Jahr'];
  const row = (st) => [
    fullName(st),
    ...klasse.faecher.flatMap((f) => [1, 2, 0].map((h) => (nimmtTeil(f, st.id) ? fmt(fachAvg(klasse, st.id, f.id, h), d) : ''))),
    ...[1, 2, 0].map((h) => fmt(gesamtAvg(klasse, st.id, h), d)),
  ];
  const klassenSchnitt = (f, h) => {
    const v = list.filter((s) => nimmtTeil(f, s.id)).map((s) => fachAvg(klasse, s.id, f.id, h)).filter((x) => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  return (
    <div className="pad">
      <Toolbar title={`Durchschnitte – ${klasse.name}`} csv={() => downloadCsv(`Durchschnitte ${klasse.name}.csv`, [head, ...list.map(row)])} />
      <div className="scroll-x">
        <table className="grid striped">
          <thead>
            <tr><th rowSpan="2">Schüler</th>{klasse.faecher.map((f) => <th key={f.id} colSpan="3">{f.name}</th>)}<th colSpan="3">Gesamt</th></tr>
            <tr>{[...klasse.faecher, { id: 'gesamt' }].map((f) => ['1. HJ', '2. HJ', 'Jahr'].map((l) => <th key={f.id + l}>{l}</th>))}</tr>
          </thead>
          <tbody>
            {list.map((st) => <tr key={st.id}>{row(st).map((v, i) => <td key={i} className={i ? 'center' : ''} style={i ? toneText(v, klasse.settings.system) : undefined}>{v}</td>)}</tr>)}
          </tbody>
          <tfoot>
            <tr><th>Klassenschnitt</th>{klasse.faecher.map((f) => [1, 2, 0].map((h) => <th key={f.id + h}>{fmt(klassenSchnitt(f, h), d)}</th>))}<th colSpan="3"></th></tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ---------- Zeugnisnoten ----------
function Zeugnisnoten({ ctx }) {
  const { klasse, sel, updK } = ctx;
  const hj = sel.hj;
  const d = klasse.settings.decimals;
  const list = sortSchueler(klasse.schueler);
  const head = ['Schüler', ...klasse.faecher.map((f) => f.name)];
  return (
    <div className="pad">
      <Toolbar
        title={`Zeugnisnoten – ${klasse.name} · ${hjLabel(hj)}`}
        csv={() => downloadCsv(`Zeugnisnoten ${klasse.name} ${hjLabel(hj)}.csv`, [head, ...list.map((st) => [fullName(st), ...klasse.faecher.map((f) => (nimmtTeil(f, st.id) ? zeugnisNote(klasse, st.id, f.id, hj).value : ''))])])}
      />
      <p className="muted no-print">Grau = aus dem Schnitt gerundet. Eintippen überschreibt die Note manuell (fett); Feld leeren setzt sie zurück.</p>
      <div className="scroll-x">
        <table className="grid striped">
          <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {list.map((st) => (
              <tr key={st.id}>
                <td>{fullName(st)}</td>
                {klasse.faecher.map((f) => {
                  const key = `${st.id}|${f.id}|${hj}`;
                  if (!nimmtTeil(f, st.id)) return <td key={f.id} className="center muted">—</td>;
                  const z = zeugnisNote(klasse, st.id, f.id, hj);
                  return (
                    <td key={f.id} className="center" title={`Ø ${fmt(fachAvg(klasse, st.id, f.id, hj), d)}`}>
                      <input
                        className={'grade' + (z.manual ? ' manual' : '')}
                        style={toneText(z.value, klasse.settings.system)}
                        placeholder={z.value}
                        value={klasse.zeugnis[key] ?? ''}
                        onChange={(e) => updK((k) => { if (e.target.value) k.zeugnis[key] = e.target.value; else delete k.zeugnis[key]; })}
                        aria-label={`Zeugnisnote ${fullName(st)} ${f.name}`}
                      />
                      <span className="print-only">{z.value}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Klassenliste ----------
function Klassenliste({ ctx }) {
  const { klasse, data, update } = ctx;
  const list = sortSchueler(klasse.schueler);
  const leer = data.prefs.leerspalten ?? 5;
  const mitFoto = data.prefs.listeFoto !== false;
  return (
    <div className="pad">
      <Toolbar
        title={`Klassenliste ${klasse.name} (${klasse.schuljahr})`}
        csv={() => downloadCsv(`Klassenliste ${klasse.name}.csv`, [['Nr.', 'Nachname', 'Vorname'], ...list.map((s, i) => [i + 1, s.last, s.first])])}
      >
        <label className="check"><input type="checkbox" checked={mitFoto} onChange={(e) => update((d) => (d.prefs.listeFoto = e.target.checked))} /> Fotos</label>
        <label className="check">Leerspalten <input type="number" min="0" max="15" className="num" value={leer} onChange={(e) => update((d) => (d.prefs.leerspalten = Number(e.target.value)))} /></label>
      </Toolbar>
      <table className="grid klassenliste">
        <thead><tr><th>Nr.</th>{mitFoto && <th></th>}<th>Name</th>{Array.from({ length: leer }, (_, i) => <th key={i} className="blank"></th>)}</tr></thead>
        <tbody>
          {list.map((s, i) => (
            <tr key={s.id}>
              <td className="center">{i + 1}</td>
              {mitFoto && <td><Avatar s={s} size={28} /></td>}
              <td>{fullName(s)}</td>
              {Array.from({ length: leer }, (_, j) => <td key={j}></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Strichlisten ----------
function Strichlisten({ ctx }) {
  const { klasse, updK } = ctx;
  const [detail, setDetail] = useState(null);
  const [kurztext, setKurztext] = useState('');
  const list = sortSchueler(klasse.schueler);
  const cats = klasse.strichKategorien;
  const cnt = (sid, cid) => klasse.striche.filter((x) => x.studentId === sid && x.catId === cid).length;
  const add = (sid, cid) => updK((k) => k.striche.push({ id: uid(), studentId: sid, catId: cid, date: today(), text: kurztext }));
  const remove = (id) => updK((k) => (k.striche = k.striche.filter((x) => x.id !== id)));
  const head = ['Schüler', ...cats.map((c) => c.name)];
  return (
    <div className="pad">
      <Toolbar title={`Strichlisten – ${klasse.name}`} csv={() => downloadCsv(`Strichlisten ${klasse.name}.csv`, [head, ...list.map((s) => [fullName(s), ...cats.map((c) => cnt(s.id, c.id))])])}>
        <input placeholder="Kurztext (optional)" value={kurztext} onChange={(e) => setKurztext(e.target.value)} />
      </Toolbar>
      <p className="muted no-print">Klick auf + setzt einen Strich mit heutigem Datum. Klick auf die Zahl zeigt die Einträge.</p>
      <table className="grid striped">
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td>{fullName(s)}</td>
              {cats.map((c) => (
                <td key={c.id} className="center">
                  <button className="link" onClick={() => setDetail({ sid: s.id, cid: c.id })}>{'|'.repeat(Math.min(cnt(s.id, c.id), 10))}{cnt(s.id, c.id) > 10 ? ` ${cnt(s.id, c.id)}` : ''}{!cnt(s.id, c.id) && '–'}</button>
                  <button className="mini no-print" onClick={() => add(s.id, c.id)} aria-label={`Strich ${c.name}`}>+</button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {detail && (
        <div className="card">
          <div className="row"><h3>{fullName(klasse.schueler.find((s) => s.id === detail.sid))} – {cats.find((c) => c.id === detail.cid)?.name}</h3><button onClick={() => setDetail(null)}>schließen</button></div>
          <ul className="plain">
            {klasse.striche.filter((x) => x.studentId === detail.sid && x.catId === detail.cid).map((x) => (
              <li key={x.id}>{fmtDate(x.date)} {x.text && `– ${x.text}`} <button className="mini" onClick={() => remove(x.id)}>entfernen</button></li>
            ))}
          </ul>
        </div>
      )}
      <details className="no-print">
        <summary>Kategorien bearbeiten</summary>
        {cats.map((c, i) => (
          <div className="row" key={c.id}>
            <input value={c.name} onChange={(e) => updK((k) => (k.strichKategorien[i].name = e.target.value))} />
            <button className="danger" onClick={() => confirm('Kategorie samt Strichen löschen?') && updK((k) => { k.strichKategorien.splice(i, 1); k.striche = k.striche.filter((x) => x.catId !== c.id); })}>löschen</button>
          </div>
        ))}
        <button onClick={() => updK((k) => k.strichKategorien.push({ id: uid(), name: 'Neue Kategorie', kurz: '' }))}>+ Kategorie</button>
      </details>
    </div>
  );
}

// ---------- Klassenbuch ----------
const ABS = [['', '–'], ['F', 'fehlt'], ['E', 'entsch.'], ['V', 'verspätet']];

function Klassenbuch({ ctx }) {
  const { klasse, fach, updK } = ctx;
  const [openId, setOpenId] = useState(null);
  const list = sortSchueler(klasse.schueler);
  const stunden = [...klasse.stunden].sort((a, b) => b.date.localeCompare(a.date));
  const setH = (id, fn) => updK((k) => fn(k.stunden.find((h) => h.id === id)));
  const add = () => {
    const h = { id: uid(), date: today(), fachId: fach.id, thema: '', hausaufgabe: '', absences: {} };
    updK((k) => k.stunden.push(h));
    setOpenId(h.id);
  };
  const csv = () =>
    downloadCsv(`Klassenbuch ${klasse.name}.csv`, [
      ['Datum', 'Fach', 'Thema', 'Hausaufgabe', 'Fehlend', 'Entschuldigt', 'Verspätet'],
      ...stunden.map((h) => [
        fmtDate(h.date),
        klasse.faecher.find((f) => f.id === h.fachId)?.name || '',
        h.thema,
        h.hausaufgabe,
        ...['F', 'E', 'V'].map((t) => list.filter((s) => h.absences[s.id] === t).map(fullName).join(', ')),
      ]),
    ]);
  return (
    <div className="pad">
      <Toolbar title={`Klassenbuch – ${klasse.name}`} csv={csv}>
        <button className="primary" onClick={add}>+ Stunde</button>
      </Toolbar>
      {!stunden.length && <Empty>Noch keine Stunden eingetragen.</Empty>}
      <table className="grid striped">
        <thead><tr><th>Datum</th><th>Fach</th><th>Thema</th><th>Hausaufgabe</th><th>Fehlzeiten</th><th className="no-print"></th></tr></thead>
        <tbody>
          {stunden.map((h) => (
            <tr key={h.id}>
              <td><input type="date" value={h.date} onChange={(e) => setH(h.id, (x) => (x.date = e.target.value))} /></td>
              <td>
                <select value={h.fachId} onChange={(e) => setH(h.id, (x) => (x.fachId = e.target.value))}>
                  {klasse.faecher.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </td>
              <td><input value={h.thema} onChange={(e) => setH(h.id, (x) => (x.thema = e.target.value))} /></td>
              <td><input value={h.hausaufgabe} onChange={(e) => setH(h.id, (x) => (x.hausaufgabe = e.target.value))} /></td>
              <td>
                {Object.values(h.absences).filter(Boolean).length
                  ? list.filter((s) => h.absences[s.id]).map((s) => `${s.last} (${h.absences[s.id]})`).join(', ')
                  : '–'}
              </td>
              <td className="no-print">
                <button onClick={() => setOpenId(openId === h.id ? null : h.id)}>Anwesenheit</button>
                <button className="danger" onClick={() => confirm('Stunde löschen?') && updK((k) => (k.stunden = k.stunden.filter((x) => x.id !== h.id)))}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {openId && (() => {
        const h = klasse.stunden.find((x) => x.id === openId);
        if (!h) return null;
        return (
          <div className="card no-print">
            <h3>Anwesenheit am {fmtDate(h.date)}</h3>
            <div className="att-grid">
              {list.map((s) => (
                <div key={s.id} className="att">
                  <span>{fullName(s)}</span>
                  <div className="seg small">
                    {ABS.map(([v, l]) => (
                      <button key={v} className={(h.absences[s.id] || '') === v ? 'on' : ''} onClick={() => setH(h.id, (x) => { if (v) x.absences[s.id] = v; else delete x.absences[s.id]; })}>{l}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
      <h3>Fehlzeiten-Übersicht</h3>
      <table className="grid striped">
        <thead><tr><th>Schüler</th><th>fehlt (unentsch.)</th><th>entschuldigt</th><th>verspätet</th></tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td>{fullName(s)}</td>
              {['F', 'E', 'V'].map((t) => <td key={t} className="center">{klasse.stunden.filter((h) => h.absences[s.id] === t).length}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
