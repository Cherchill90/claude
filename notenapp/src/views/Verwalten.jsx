import { useState } from 'react';
import { HJ_GEWICHTUNGEN, RUNDUNGEN, uid } from '../grades.js';
import { COLORS, currentSchuljahr, newFach, newKlasse, versetzeKlasse } from '../store.js';
import { Avatar, Field, fullName, Modal, readPhoto, sortSchueler } from '../ui.jsx';

const STEPS = [
  ['allgemein', 'Allgemein'],
  ['faecher', 'Fächer'],
  ['schueler', 'Schüler'],
  ['uebersicht', 'Übersicht'],
];

/** Klassen verwalten: Kachelübersicht + Assistent (Allgemein · Fächer · Schüler · Übersicht). */
export function KlassenVerwalten({ ctx, store, onClose, onOpenSitzplan, onVersetzen, startEdit }) {
  const { data, update } = ctx;
  const [edit, setEdit] = useState(startEdit || null); // { id, step }

  function add() {
    const k = newKlasse();
    update((d) => { d.klassen.push(k); d.activeKlasseId = k.id; });
    setEdit({ id: k.id, step: 'allgemein' });
  }

  const klasse = edit && data.klassen.find((k) => k.id === edit.id);
  return (
    <div className="modal-bg">
      <div className="modal full" role="dialog" aria-label="Klassen verwalten">
        {klasse && !klasse.sealed ? (
          <Editor ctx={ctx} store={store} klasse={klasse} step={edit.step} setStep={(step) => setEdit({ ...edit, step })} onBack={() => setEdit(null)} onDone={onClose} />
        ) : (
          <>
            <header>
              <h2>Klassen verwalten</h2>
              <div className="row">
                <button className="primary" onClick={add}>+ Neue Klasse</button>
                <button onClick={onClose}>Fertig</button>
              </div>
            </header>
            <div className="modal-body">
              <div className="cards">
                {data.klassen.map((k) => (
                  <KlassenKarte
                    key={k.id}
                    k={k}
                    store={store}
                    active={k.id === data.activeKlasseId}
                    onSelect={() => update((d) => (d.activeKlasseId = k.id))}
                    onEdit={(step) => setEdit({ id: k.id, step })}
                    onSitzplan={() => onOpenSitzplan(k.id)}
                    onVersetzen={() => onVersetzen(k.id)}
                    onDelete={() => {
                      if (!confirm(`Klasse „${k.name}“ mit allen Noten unwiderruflich löschen?\n\nTipp: vorher eine Sicherheitskopie erstellen.`)) return;
                      update((d) => {
                        d.klassen = d.klassen.filter((x) => x.id !== k.id);
                        if (d.activeKlasseId === k.id) d.activeKlasseId = d.klassen[0]?.id || null;
                      });
                    }}
                  />
                ))}
                {!data.klassen.length && <p className="muted">Noch keine Klasse angelegt.</p>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KlassenKarte({ k, store, active, onSelect, onEdit, onSitzplan, onVersetzen, onDelete }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  if (k.sealed) {
    return (
      <div className={'kcard' + (active ? ' on' : '')} onClick={onSelect}>
        <h3>🔒 {k.name}</h3>
        <p className="muted">{k.schuljahr} · passwortgeschützt</p>
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            try { await store.unlockKlasse(k.id, pw); setPw(''); } catch { setErr('Falsches Passwort'); }
          }}
        >
          <input type="password" placeholder="Passwort" value={pw} onChange={(e) => { setPw(e.target.value); setErr(''); }} />
          <button type="submit">Öffnen</button>
        </form>
        {err && <p className="error">{err}</p>}
        <div className="kcard-foot"><span /><button className="icon-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Klasse löschen">🗑</button></div>
      </div>
    );
  }
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div className={'kcard' + (active ? ' on' : '')} onClick={onSelect}>
      <div className="kcard-main">
        <div>
          <h3>{store.hasKlassePassword(k.id) && '🔐 '}{k.name}</h3>
          <p>{k.schueler.length} Schüler</p>
          <p className="faecher">{k.faecher.map((f) => <span key={f.id}>{f.name}</span>)}</p>
          <p className="muted">{k.schuljahr}</p>
        </div>
        <div className="kcard-btns">
          <button className="icon-btn" title="Klasse bearbeiten" onClick={stop(() => onEdit('allgemein'))}>✎</button>
          <button className="icon-btn" title="Schüler" onClick={stop(() => onEdit('schueler'))}>👥</button>
          <button className="icon-btn" title="Sitzplan" onClick={stop(onSitzplan)}>▦</button>
        </div>
      </div>
      <div className="kcard-foot">
        <button onClick={stop(onVersetzen)}>versetzen</button>
        <button className="icon-btn" title="Klasse löschen" onClick={stop(onDelete)}>🗑</button>
      </div>
    </div>
  );
}

function Editor({ ctx, store, klasse, step, setStep, onBack, onDone }) {
  const updK = (fn) => ctx.update((d) => fn(d.klassen.find((k) => k.id === klasse.id), d));
  const i = STEPS.findIndex(([id]) => id === step);
  return (
    <>
      <header className="editor-head">
        <button onClick={onBack} title="Zur Klassenübersicht">‹ Klassen</button>
        <nav className="stepper">
          <b>{klasse.name}</b>
          <button disabled={i <= 0} onClick={() => setStep(STEPS[i - 1][0])} aria-label="Zurück">‹</button>
          {STEPS.map(([id, l]) => (
            <button key={id} className={id === step ? 'on' : ''} onClick={() => setStep(id)}>{l}</button>
          ))}
          <button disabled={i >= STEPS.length - 1} onClick={() => setStep(STEPS[i + 1][0])} aria-label="Weiter">›</button>
        </nav>
        <button className="primary" onClick={onDone}>Fertig</button>
      </header>
      <div className="modal-body editor-body">
        {step === 'allgemein' && <Allgemein klasse={klasse} updK={updK} store={store} />}
        {step === 'faecher' && <Faecher klasse={klasse} updK={updK} />}
        {step === 'schueler' && <SchuelerEditor klasse={klasse} updK={updK} />}
        {step === 'uebersicht' && <Uebersicht klasse={klasse} store={store} />}
      </div>
    </>
  );
}

// ---------------- Allgemein ----------------
function Allgemein({ klasse, updK, store }) {
  const s = klasse.settings;
  const set = (key, v) => updK((k) => (k.settings[key] = v));
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');
  const hasPw = store.hasKlassePassword(klasse.id);
  const hjKey = JSON.stringify(s.hjWeights ?? null);
  const preset = HJ_GEWICHTUNGEN.some(([v]) => JSON.stringify(v) === hjKey);
  return (
    <div className="settings">
      <h4>Klassendaten</h4>
      <div className="group">
        <label className="irow"><span className="ic">👥</span><input value={klasse.name} onChange={(e) => updK((k) => (k.name = e.target.value))} placeholder="Klassenname" autoFocus /></label>
        <label className="irow"><span className="ic">🔒</span><input type="password" value={pw1} onChange={(e) => { setPw1(e.target.value); setMsg(''); }} placeholder={hasPw ? 'Neues Passwort' : 'Passwort'} autoComplete="new-password" /></label>
        <label className="irow"><span className="ic">🔒</span><input type="password" value={pw2} onChange={(e) => { setPw2(e.target.value); setMsg(''); }} placeholder="Passwort wiederholen" autoComplete="new-password" /></label>
        <div className="irow">
          <span className="ic" />
          <button disabled={!pw1 || pw1 !== pw2} onClick={async () => { await store.setKlassePassword(klasse.id, pw1); setPw1(''); setPw2(''); setMsg('Passwort für diese Klasse gesetzt. Die Klasse wird verschlüsselt gespeichert und bei Inaktivität gesperrt.'); }}>
            {hasPw ? 'Passwort ändern' : 'Passwort setzen'}
          </button>
          {hasPw && <button onClick={async () => { if (confirm('Passwort dieser Klasse entfernen?')) { await store.setKlassePassword(klasse.id, null); setMsg('Passwort entfernt.'); } }}>Passwort entfernen</button>}
          {pw1 && pw2 && pw1 !== pw2 && <span className="error">stimmt nicht überein</span>}
          {msg && <span className="ok">{msg}</span>}
        </div>
        <label className="irow"><span className="ic">📅</span><input value={klasse.schuljahr} onChange={(e) => updK((k) => (k.schuljahr = e.target.value))} placeholder={currentSchuljahr()} /></label>
      </div>

      <h4>Noteneinstellungen</h4>
      <div className="group">
        <label className="irow">
          <span className="ic">🏅</span>
          <select value={s.system} onChange={(e) => set('system', e.target.value)}>
            <option value="noten">Noten</option>
            <option value="punkte">Notenpunkte</option>
          </select>
        </label>
        {s.system === 'noten' && (
          <>
            <label className="irow"><span className="ic" /><span className="check"><input type="checkbox" checked={s.plusMinus} onChange={(e) => set('plusMinus', e.target.checked)} /> Mit Plus/Minus (2+, 3−)</span></label>
            {s.plusMinus && (
              <>
                <label className="irow"><span className="ic" />Wert von Plus/Minus <input type="number" step="0.01" min="0" max="0.5" className="num" value={s.plusValue} onChange={(e) => set('plusValue', Number(e.target.value))} /> <small className="muted">0,25 → 2+ = 1,75 · 0,33 → Drittelnoten</small></label>
                <label className="irow"><span className="ic" /><span className="check"><input type="checkbox" checked={s.plusMinusImSchnitt} onChange={(e) => set('plusMinusImSchnitt', e.target.checked)} /> Plus/Minus im Schnitt berücksichtigen</span></label>
              </>
            )}
            <label className="irow"><span className="ic" />Zeugnisnote: zur schlechteren Note ab <input type="number" step="0.01" min="0.01" max="0.99" className="num" value={s.roundThreshold} onChange={(e) => set('roundThreshold', Number(e.target.value))} /></label>
          </>
        )}
      </div>

      <h4>Rundung</h4>
      <div className="group">
        <label className="irow">
          <span className="ic">≈</span>
          <select value={s.decimals} onChange={(e) => set('decimals', Number(e.target.value))}>
            {RUNDUNGEN.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
          </select>
        </label>
      </div>

      <h4>Gewichtung Halbjahre</h4>
      <div className="group">
        <label className="irow">
          <span className="ic">⚖︎</span>
          <select
            value={preset ? hjKey : 'eigen'}
            onChange={(e) => set('hjWeights', e.target.value === 'eigen' ? [1, 1] : JSON.parse(e.target.value))}
          >
            {HJ_GEWICHTUNGEN.map(([v, l]) => <option key={l} value={JSON.stringify(v)}>{l}</option>)}
            <option value="eigen">Eigene Gewichtung …</option>
          </select>
          {!preset && (
            <>
              1. HJ <input type="number" min="0" step="0.5" className="num" value={s.hjWeights[0]} onChange={(e) => set('hjWeights', [Number(e.target.value), s.hjWeights[1]])} />
              2. HJ <input type="number" min="0" step="0.5" className="num" value={s.hjWeights[1]} onChange={(e) => set('hjWeights', [s.hjWeights[0], Number(e.target.value)])} />
            </>
          )}
        </label>
      </div>
    </div>
  );
}

// ---------------- Fächer ----------------
function NewRow({ placeholder, onCreate, indent = 0 }) {
  const [v, setV] = useState('');
  const commit = () => { if (v.trim()) { onCreate(v.trim()); setV(''); } };
  return (
    <div className="tree-row new" style={{ paddingLeft: 12 + indent * 28 }}>
      <input
        placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit()} onBlur={commit}
      />
    </div>
  );
}

function useDragSort(onMove) {
  const [drag, setDrag] = useState(null);
  return (key, index) => ({
    draggable: true,
    onDragStart: (e) => { setDrag({ key, index }); e.dataTransfer.effectAllowed = 'move'; },
    onDragOver: (e) => drag?.key === key && e.preventDefault(),
    onDrop: (e) => { e.preventDefault(); if (drag?.key === key && drag.index !== index) onMove(key, drag.index, index); setDrag(null); },
  });
}

const move = (arr, from, to) => { const [x] = arr.splice(from, 1); arr.splice(to, 0, x); };

function Faecher({ klasse, updK }) {
  const [selId, setSelId] = useState({ type: 'fach', id: klasse.faecher[0]?.id });
  const setF = (fid, fn) => updK((k) => fn(k.faecher.find((f) => f.id === fid)));
  const dnd = useDragSort((key, from, to) =>
    updK((k) => {
      if (key === 'faecher') return move(k.faecher, from, to);
      const [kind, fid, gid] = key.split('|');
      const f = k.faecher.find((x) => x.id === fid);
      if (kind === 'gruppen') return move(f.gruppen, from, to);
      // Bereiche: Reihenfolge innerhalb derselben Ebene/Gruppe ändern
      const lose = (b) => f.gruppierung === false || !b.gruppeId || !(f.gruppen || []).some((g) => g.id === b.gruppeId);
      const sib = f.bereiche.filter((b) => (gid === '-' ? lose(b) : b.gruppeId === gid));
      const x = sib[from];
      const target = sib[to];
      f.bereiche.splice(f.bereiche.indexOf(x), 1);
      const ti = f.bereiche.indexOf(target);
      f.bereiche.splice(from < to ? ti + 1 : ti, 0, x);
    }),
  );

  const newBereich = (f, name, gruppeId) => ({ id: uid(), name, kurz: '', weight: 1, color: COLORS[f.bereiche.length % COLORS.length], ...(gruppeId ? { gruppeId } : {}) });

  const bereichRow = (f, b, i, indent, key) => (
    <div
      key={b.id}
      className={'tree-row' + (selId.id === b.id ? ' on' : '')}
      style={{ paddingLeft: 12 + indent * 28 }}
      onClick={() => setSelId({ type: 'bereich', id: b.id, fachId: f.id })}
      {...dnd(key, i)}
    >
      <i className="dot" style={{ background: b.color }} />
      <input className="grow" value={b.name} onChange={(e) => setF(f.id, (x) => (x.bereiche.find((y) => y.id === b.id).name = e.target.value))} />
      <input className="kurz" value={b.kurz || ''} placeholder="Kürzel" onChange={(e) => setF(f.id, (x) => (x.bereiche.find((y) => y.id === b.id).kurz = e.target.value))} />
      <span className="ic" title="Gewicht">⚖︎</span>
      <input type="number" min="0" step="0.5" className="num" value={b.weight} onChange={(e) => setF(f.id, (x) => (x.bereiche.find((y) => y.id === b.id).weight = Number(e.target.value)))} aria-label="Gewicht" />
      <button className="icon-btn" title="Bereich löschen" onClick={(e) => { e.stopPropagation(); confirm(`Bereich „${b.name}“ mit allen Arbeiten löschen?`) && updK((k) => { const x = k.faecher.find((y) => y.id === f.id); x.bereiche = x.bereiche.filter((y) => y.id !== b.id); k.arbeiten = k.arbeiten.filter((a) => a.bereichId !== b.id); }); }}>🗑</button>
      <span className="handle" title="Ziehen zum Sortieren">≡</span>
    </div>
  );

  const sel =
    selId.type === 'fach'
      ? klasse.faecher.find((f) => f.id === selId.id)
      : klasse.faecher.find((f) => f.id === selId.fachId);

  return (
    <div className="split">
      <div className="tree">
        {klasse.faecher.map((f, fi) => (
          <div key={f.id} className="tree-fach">
            <div className={'tree-row fach' + (selId.id === f.id ? ' on' : '')} onClick={() => setSelId({ type: 'fach', id: f.id })} {...dnd('faecher', fi)}>
              <input className="grow strong" value={f.name} onChange={(e) => setF(f.id, (x) => (x.name = e.target.value))} aria-label="Fachname" />
              <span className="ic" title="Gewicht im Gesamtschnitt">⚖︎</span>
              <input type="number" min="0" step="0.5" className="num" value={f.weight ?? 1} onChange={(e) => setF(f.id, (x) => (x.weight = Number(e.target.value)))} aria-label="Fachgewicht" />
              <button className="icon-btn" title="Fach löschen" onClick={(e) => { e.stopPropagation(); confirm(`Fach „${f.name}“ mit allen Arbeiten löschen?`) && updK((k) => { k.faecher = k.faecher.filter((x) => x.id !== f.id); k.arbeiten = k.arbeiten.filter((a) => a.fachId !== f.id); }); }}>🗑</button>
              <span className="handle">≡</span>
            </div>
            {f.gruppierung !== false ? (
              <>
                {(f.gruppen || []).map((g, gi) => {
                  const inG = f.bereiche.filter((b) => b.gruppeId === g.id);
                  return (
                    <div key={g.id} className="tree-group">
                      <div className={'tree-row' + (selId.id === g.id ? ' on' : '')} style={{ paddingLeft: 12 }} onClick={() => setSelId({ type: 'gruppe', id: g.id, fachId: f.id })} {...dnd(`gruppen|${f.id}`, gi)}>
                        <span className="caret">⌄</span>
                        <input className="grow" value={g.name} onChange={(e) => setF(f.id, (x) => (x.gruppen.find((y) => y.id === g.id).name = e.target.value))} />
                        <input className="kurz" value={g.kurz || ''} placeholder="Kürzel" onChange={(e) => setF(f.id, (x) => (x.gruppen.find((y) => y.id === g.id).kurz = e.target.value))} />
                        <span className="ic" title="Gewicht">⚖︎</span>
                        <input type="number" min="0" step="0.5" className="num" value={g.weight} onChange={(e) => setF(f.id, (x) => (x.gruppen.find((y) => y.id === g.id).weight = Number(e.target.value)))} aria-label="Gewicht" />
                        <button className="icon-btn" title="Gruppe auflösen" onClick={(e) => { e.stopPropagation(); setF(f.id, (x) => { x.gruppen = x.gruppen.filter((y) => y.id !== g.id); x.bereiche.forEach((b) => b.gruppeId === g.id && delete b.gruppeId); }); }}>🗑</button>
                        <span className="handle">≡</span>
                      </div>
                      {inG.map((b, i) => bereichRow(f, b, i, 1, `bereiche|${f.id}|${g.id}`))}
                      <NewRow placeholder="Neuer Bereich" indent={1} onCreate={(name) => setF(f.id, (x) => x.bereiche.push(newBereich(x, name, g.id)))} />
                    </div>
                  );
                })}
                {f.bereiche.filter((b) => !b.gruppeId || !(f.gruppen || []).some((g) => g.id === b.gruppeId)).map((b, i) => bereichRow(f, b, i, 0, `bereiche|${f.id}|-`))}
              </>
            ) : (
              f.bereiche.map((b, i) => bereichRow(f, b, i, 0, `bereiche|${f.id}|-`))
            )}
            <NewRow placeholder="Neuer Bereich" onCreate={(name) => setF(f.id, (x) => x.bereiche.push(newBereich(x, name)))} />
            <NewRow placeholder="Neue Gruppe" onCreate={(name) => { const id = uid(); setF(f.id, (x) => { x.gruppierung = true; (x.gruppen ||= []).push({ id, name, kurz: '', weight: 1 }); }); setSelId({ type: 'gruppe', id, fachId: f.id }); }} />
          </div>
        ))}
        <NewRow placeholder="Neues Fach" onCreate={(name) => updK((k) => { const f = newFach(name); k.faecher.push(f); setSelId({ type: 'fach', id: f.id }); })} />
      </div>

      <aside className="detail">
        {sel && selId.type === 'fach' && <FachDetail klasse={klasse} f={sel} setF={setF} />}
        {sel && selId.type === 'gruppe' && (() => {
          const g = (sel.gruppen || []).find((x) => x.id === selId.id);
          if (!g) return null;
          return (
            <>
              <h2>{g.name}</h2>
              <p className="muted">Bereichsgruppe in „{sel.name}“. Der Gruppenschnitt ist das gewichtete Mittel der angehakten Bereiche; er geht mit Gewicht {g.weight} in den Fachschnitt ein.</p>
              <h4>Bereiche in dieser Gruppe</h4>
              {sel.bereiche.map((b) => {
                const other = b.gruppeId && b.gruppeId !== g.id && sel.gruppen.find((x) => x.id === b.gruppeId);
                return (
                  <label key={b.id} className="check block">
                    <input
                      type="checkbox"
                      checked={b.gruppeId === g.id}
                      onChange={(e) => setF(sel.id, (x) => { const y = x.bereiche.find((z) => z.id === b.id); if (e.target.checked) y.gruppeId = g.id; else delete y.gruppeId; })}
                    />
                    <i className="dot" style={{ background: b.color }} /> {b.name}
                    {other && <span className="muted small"> (bisher in „{other.name}“)</span>}
                  </label>
                );
              })}
              {!sel.bereiche.length && <p className="muted">Noch keine Bereiche – unten links „Neuer Bereich“ anlegen.</p>}
            </>
          );
        })()}
        {sel && selId.type === 'bereich' && (() => {
          const b = sel.bereiche.find((x) => x.id === selId.id);
          if (!b) return null;
          return (
            <>
              <h2>{b.name}</h2>
              <Field label="Farbe"><input type="color" value={b.color || COLORS[0]} onChange={(e) => setF(sel.id, (x) => (x.bereiche.find((y) => y.id === b.id).color = e.target.value))} /></Field>
              <Field label="Gruppe" hint={sel.gruppierung === false && b.gruppeId ? 'Gruppierung ist für dieses Fach ausgeschaltet – die Gruppe zählt erst, wenn sie wieder eingeschaltet wird.' : ''}>
                <select
                  value={b.gruppeId || ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    const id = v === 'neu' ? uid() : v;
                    setF(sel.id, (x) => {
                      const y = x.bereiche.find((z) => z.id === b.id);
                      if (v === 'neu') { x.gruppen ||= []; x.gruppen.push({ id, name: `Gruppe ${x.gruppen.length + 1}`, kurz: '', weight: 1 }); }
                      if (v) { y.gruppeId = id; x.gruppierung = true; } else delete y.gruppeId;
                    });
                  }}
                >
                  <option value="">– keine Gruppe –</option>
                  {(sel.gruppen || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  <option value="neu">+ Neue Gruppe …</option>
                </select>
              </Field>
            </>
          );
        })()}
      </aside>
    </div>
  );
}

function FachDetail({ klasse, f, setF }) {
  const [openTeil, setOpenTeil] = useState(false);
  const teilnehmer = klasse.schueler.filter((s) => !(f.ohne || []).includes(s.id)).length;
  return (
    <>
      <h2>{f.name}</h2>
      <p>Durchschnittsberechnung für {f.name}</p>
      <label className="check block"><input type="radio" checked={f.berechnung !== 'einzeln'} onChange={() => setF(f.id, (x) => (x.berechnung = 'durchschnitte'))} /> Durchschnitte gewichten</label>
      <label className="check block"><input type="radio" checked={f.berechnung === 'einzeln'} onChange={() => setF(f.id, (x) => (x.berechnung = 'einzeln'))} /> Jede Note einzeln gewichten</label>
      <p className="muted small">
        {f.berechnung === 'einzeln'
          ? 'Alle Noten kommen in einen Topf; jede zählt mit dem Gewicht ihres Bereichs (× Gruppe × Arbeit). Bereiche mit vielen Noten zählen dadurch mehr.'
          : 'Erst wird je Bereich ein Schnitt gebildet, dann werden die Bereichsschnitte gewichtet – unabhängig davon, wie viele Noten ein Bereich hat.'}
      </p>
      <label className="check block">
        <input type="checkbox" checked={f.gruppierung !== false} onChange={(e) => setF(f.id, (x) => { x.gruppierung = e.target.checked; x.gruppen ||= []; })} />
        Gruppierung <span className="muted">in {f.name}</span>
      </label>
      <p className="muted small">für spezielle Durchschnittsberechnungen, z. B. für Schriftlich und Mündlich</p>
      <div className="collapsible">
        <button className="coll-head" onClick={() => setOpenTeil(!openTeil)}>
          <span>Fachteilnahme</span><span className="muted">{teilnehmer} von {klasse.schueler.length} {openTeil ? '⌃' : '⌄'}</span>
        </button>
        {openTeil && (
          <div className="coll-body">
            <div className="row">
              <button onClick={() => setF(f.id, (x) => (x.ohne = []))}>Alle</button>
              <button onClick={() => setF(f.id, (x) => (x.ohne = klasse.schueler.map((s) => s.id)))}>Keine</button>
            </div>
            {sortSchueler(klasse.schueler).map((s) => (
              <label key={s.id} className="check block">
                <input type="checkbox" checked={!(f.ohne || []).includes(s.id)} onChange={(e) => setF(f.id, (x) => { x.ohne = (x.ohne || []).filter((id) => id !== s.id); if (!e.target.checked) x.ohne.push(s.id); })} />
                {fullName(s)}
              </label>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------- Schüler ----------------
function parseNames(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((r) => {
    let last, first;
    if (r.includes('\t')) [first, last] = r.split('\t');
    else if (r.includes(';')) [last, first] = r.split(';');
    else if (r.includes(',')) [last, first] = r.split(',');
    else { const p = r.split(/\s+/); last = p.pop(); first = p.join(' '); }
    return { first: (first || '').trim(), last: (last || '').trim() };
  });
}

const newSchueler = (first, last) => ({ id: uid(), first, last, bemerkung: '', fachNotizen: {}, erinnerungen: {} });

function SchuelerEditor({ klasse, updK }) {
  const [selId, setSelId] = useState(null);
  const [nf, setNf] = useState('');
  const [nl, setNl] = useState('');
  const [importText, setImportText] = useState('');
  const [openTeil, setOpenTeil] = useState(true);
  const list = sortSchueler(klasse.schueler);
  const sel = klasse.schueler.find((s) => s.id === selId);
  const setS = (id, fn) => updK((k) => fn(k.schueler.find((s) => s.id === id)));

  function addNew() {
    if (!nf.trim() && !nl.trim()) return;
    updK((k) => k.schueler.push(newSchueler(nf.trim(), nl.trim())));
    setNf(''); setNl('');
    document.getElementById('neu-vorname')?.focus();
  }

  function remove(s) {
    if (!confirm(`${fullName(s)} mit allen Noten entfernen?`)) return;
    updK((k) => {
      k.schueler = k.schueler.filter((x) => x.id !== s.id);
      k.arbeiten.forEach((a) => delete a.results[s.id]);
      k.striche = k.striche.filter((x) => x.studentId !== s.id);
      k.stunden.forEach((h) => delete h.absences[s.id]);
      k.sitzplaene.forEach((p) => Object.keys(p.seats).forEach((key) => p.seats[key] === s.id && delete p.seats[key]));
    });
    setSelId(null);
  }

  return (
    <div className="split">
      <div>
        <table className="names">
          <tbody>
            {list.map((s) => (
              <tr key={s.id} className={selId === s.id ? 'on' : ''} onClick={() => setSelId(s.id)}>
                <td><input value={s.first} placeholder="Vorname" onFocus={() => setSelId(s.id)} onChange={(e) => setS(s.id, (x) => (x.first = e.target.value))} /></td>
                <td><input value={s.last} placeholder="Nachname" onFocus={() => setSelId(s.id)} onChange={(e) => setS(s.id, (x) => (x.last = e.target.value))} /></td>
                <td className="photo-cell">
                  <label className="photo-pick" title="Foto wählen">
                    <Avatar s={s} size={34} />
                    <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files[0]; if (f) { const p = await readPhoto(f); setS(s.id, (x) => (x.photo = p)); } }} />
                  </label>
                </td>
              </tr>
            ))}
            <tr className="new">
              <td><input id="neu-vorname" value={nf} placeholder="Vorname" onChange={(e) => setNf(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && document.getElementById('neu-nachname').focus()} /></td>
              <td><input id="neu-nachname" value={nl} placeholder="Nachname" onChange={(e) => setNl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNew()} onBlur={addNew} /></td>
              <td />
            </tr>
          </tbody>
        </table>
        <details>
          <summary>Liste einfügen (z. B. aus Excel)</summary>
          <p className="muted small">Eine Zeile pro Schüler: „Vorname⇥Nachname“ (aus Excel kopiert), „Nachname, Vorname“, „Nachname;Vorname“ oder „Vorname Nachname“.</p>
          <textarea rows="6" value={importText} onChange={(e) => setImportText(e.target.value)} />
          <button className="primary" disabled={!importText.trim()} onClick={() => { updK((k) => parseNames(importText).forEach((n) => k.schueler.push(newSchueler(n.first, n.last)))); setImportText(''); }}>Übernehmen</button>
        </details>
      </div>
      <aside className="detail">
        {sel ? (
          <>
            <div className="photo-box">
              <Avatar s={sel} size={96} />
              <div>
                <b>{fullName(sel)}</b>
                <label className="button">Foto wählen<input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files[0]; if (f) { const p = await readPhoto(f); setS(sel.id, (x) => (x.photo = p)); } }} /></label>
                {sel.photo && <button onClick={() => setS(sel.id, (x) => delete x.photo)}>Foto entfernen</button>}
                <button className="danger" onClick={() => remove(sel)}>🗑 Schüler löschen</button>
              </div>
            </div>
            <div className="collapsible">
              <button className="coll-head" onClick={() => setOpenTeil(!openTeil)}><span>Fachteilnahme</span><span>{openTeil ? '⌃' : '⌄'}</span></button>
              {openTeil && (
                <div className="coll-body">
                  {klasse.faecher.map((f) => (
                    <label key={f.id} className="check block">
                      <input type="checkbox" checked={!(f.ohne || []).includes(sel.id)} onChange={(e) => updK((k) => { const x = k.faecher.find((y) => y.id === f.id); x.ohne = (x.ohne || []).filter((id) => id !== sel.id); if (!e.target.checked) x.ohne.push(sel.id); })} />
                      {f.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="muted">Schüler anklicken, um Foto, Fachteilnahme oder Löschen zu bearbeiten. Neue Schüler in der letzten Zeile eintragen (Enter).</p>
        )}
      </aside>
    </div>
  );
}

// ---------------- Übersicht ----------------
function Uebersicht({ klasse, store }) {
  const s = klasse.settings;
  const hj = HJ_GEWICHTUNGEN.find(([v]) => JSON.stringify(v) === JSON.stringify(s.hjWeights ?? null))?.[1] || `eigene (${s.hjWeights?.join(' : ')})`;
  return (
    <div className="settings">
      <h4>Klasse</h4>
      <div className="group pad">
        <p><b>{klasse.name}</b> · Schuljahr {klasse.schuljahr} · {klasse.schueler.length} Schüler · {store.hasKlassePassword(klasse.id) ? 'mit Passwort' : 'ohne Passwort'}</p>
        <p>
          {s.system === 'punkte' ? 'Notenpunkte 0–15' : `Noten 1–6${s.plusMinus ? `, Plus/Minus ±${String(s.plusValue).replace('.', ',')}${s.plusMinusImSchnitt ? '' : ' (nicht im Schnitt)'}` : ''}`}
          {' · '}Rundung {RUNDUNGEN.find(([d]) => d === s.decimals)?.[1]} · Halbjahre: {hj}
        </p>
      </div>
      <h4>Fächer</h4>
      <div className="group pad">
        {klasse.faecher.map((f) => (
          <div key={f.id} className="ueb-fach">
            <b>{f.name}</b> <span className="muted">Gewicht {f.weight ?? 1} · {f.berechnung === 'einzeln' ? 'jede Note einzeln gewichtet' : 'Durchschnitte gewichtet'} · {klasse.schueler.length - (f.ohne || []).length} von {klasse.schueler.length} Schülern</span>
            <ul>
              {f.gruppierung !== false && (f.gruppen || []).map((g) => (
                <li key={g.id}>
                  {g.name} {g.kurz && `(${g.kurz})`} – Gewicht {g.weight}
                  <ul>{f.bereiche.filter((b) => b.gruppeId === g.id).map((b) => <li key={b.id}>{b.name} {b.kurz && `(${b.kurz})`} – Gewicht {b.weight}</li>)}</ul>
                </li>
              ))}
              {f.bereiche.filter((b) => f.gruppierung === false || !b.gruppeId).map((b) => <li key={b.id}>{b.name} {b.kurz && `(${b.kurz})`} – Gewicht {b.weight}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Versetzen ----------------
export function Versetzen({ ctx, klasse, onClose }) {
  const { update } = ctx;
  const nextName = klasse.name.replace(/\d+/, (n) => String(Number(n) + 1));
  const [sj0] = klasse.schuljahr.split('/');
  const y = Number(sj0.length === 2 ? '20' + sj0 : sj0);
  const nextSj = y ? `${y + 1}/${String(y + 2).slice(2)}` : currentSchuljahr();
  const [name, setName] = useState(nextName);
  const [sj, setSj] = useState(nextSj);
  return (
    <Modal
      title={`Klasse „${klasse.name}“ versetzen`}
      onClose={onClose}
      footer={
        <button className="primary" onClick={() => { const k = versetzeKlasse(klasse, name, sj); update((d) => { d.klassen.push(k); d.activeKlasseId = k.id; }); onClose(); }}>
          Versetzen
        </button>
      }
    >
      <p>Es wird eine neue Klasse mit denselben Schülern, Fächern, Bereichen, Benotungseinstellungen und Sitzplänen angelegt – ohne Noten. Die bisherige Klasse bleibt erhalten; ihre Zeugnisnoten erscheinen als „Vorjahr“ in „Fach auf einen Blick“.</p>
      <Field label="Neuer Klassenname"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Schuljahr"><input value={sj} onChange={(e) => setSj(e.target.value)} /></Field>
    </Modal>
  );
}
