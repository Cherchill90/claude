import { useState } from 'react';
import { uid } from '../grades.js';
import { COLORS, currentSchuljahr, newFach, newKlasse, versetzeKlasse } from '../store.js';
import { Avatar, Field, fullName, Modal, readPhoto, sortSchueler } from '../ui.jsx';

export function KlassenVerwalten({ ctx, onClose }) {
  const { data, update } = ctx;
  const [kid, setKid] = useState(ctx.klasse?.id || data.klassen[0]?.id);
  const [tab, setTab] = useState('allgemein');
  const klasse = data.klassen.find((k) => k.id === kid);
  const updK = (fn) => update((d) => fn(d.klassen.find((k) => k.id === kid), d));

  function add() {
    const k = newKlasse();
    update((d) => { d.klassen.push(k); d.activeKlasseId = k.id; });
    setKid(k.id);
    setTab('allgemein');
  }

  return (
    <Modal title="Klassen verwalten" onClose={onClose} wide>
      <div className="manage">
        <ul className="list compact">
          {data.klassen.map((k) => (
            <li key={k.id} className={k.id === kid ? 'on' : ''} onClick={() => setKid(k.id)}>
              <div><b>{k.name}</b><small>{k.schuljahr} · {k.schueler.length} Schüler</small></div>
            </li>
          ))}
          <li className="add" onClick={add}>+ Neue Klasse</li>
        </ul>
        {klasse ? (
          <div>
            <div className="seg">
              {[['allgemein', 'Allgemein'], ['schueler', 'Schüler'], ['faecher', 'Fächer & Bereiche'], ['benotung', 'Benotung']].map(([id, l]) => (
                <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>
              ))}
            </div>
            {tab === 'allgemein' && <Allgemein klasse={klasse} updK={updK} update={update} onDeleted={() => setKid(data.klassen.find((k) => k.id !== kid)?.id)} />}
            {tab === 'schueler' && <SchuelerVerwalten klasse={klasse} updK={updK} />}
            {tab === 'faecher' && <FaecherVerwalten klasse={klasse} updK={updK} />}
            {tab === 'benotung' && <Benotung klasse={klasse} updK={updK} />}
          </div>
        ) : (
          <p>Noch keine Klasse angelegt.</p>
        )}
      </div>
    </Modal>
  );
}

function Allgemein({ klasse, updK, update, onDeleted }) {
  return (
    <div className="form">
      <Field label="Klassenname"><input value={klasse.name} onChange={(e) => updK((k) => (k.name = e.target.value))} /></Field>
      <Field label="Schuljahr" hint="z. B. 2026/27"><input value={klasse.schuljahr} onChange={(e) => updK((k) => (k.schuljahr = e.target.value))} /></Field>
      <div className="row">
        <button onClick={() => update((d) => (d.activeKlasseId = klasse.id))}>Diese Klasse öffnen</button>
        <button
          className="danger"
          onClick={() => {
            if (!confirm(`Klasse „${klasse.name}“ mit allen Noten unwiderruflich löschen? Tipp: vorher eine Sicherheitskopie erstellen.`)) return;
            update((d) => {
              d.klassen = d.klassen.filter((k) => k.id !== klasse.id);
              if (d.activeKlasseId === klasse.id) d.activeKlasseId = d.klassen[0]?.id || null;
            });
            onDeleted();
          }}
        >
          Klasse löschen
        </button>
      </div>
    </div>
  );
}

function SchuelerVerwalten({ klasse, updK }) {
  const [importText, setImportText] = useState('');
  const list = sortSchueler(klasse.schueler);
  const setS = (id, fn) => updK((k) => fn(k.schueler.find((s) => s.id === id)));

  function doImport() {
    const rows = importText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    updK((k) => {
      for (const r of rows) {
        let last, first;
        if (r.includes(';')) [last, first] = r.split(';');
        else if (r.includes(',')) [last, first] = r.split(',');
        else if (r.includes('\t')) [last, first] = r.split('\t');
        else {
          const parts = r.split(/\s+/);
          last = parts.pop();
          first = parts.join(' ');
        }
        k.schueler.push({ id: uid(), last: (last || '').trim(), first: (first || '').trim(), bemerkung: '', fachNotizen: {}, erinnerungen: {} });
      }
    });
    setImportText('');
  }

  return (
    <div className="form">
      <table className="grid">
        <thead><tr><th>Foto</th><th>Nachname</th><th>Vorname</th><th></th></tr></thead>
        <tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td>
                <label className="photo-pick" title="Foto wählen">
                  <Avatar s={s} size={32} />
                  <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files[0]; if (f) { const p = await readPhoto(f); setS(s.id, (x) => (x.photo = p)); } }} />
                </label>
              </td>
              <td><input value={s.last} onChange={(e) => setS(s.id, (x) => (x.last = e.target.value))} /></td>
              <td><input value={s.first} onChange={(e) => setS(s.id, (x) => (x.first = e.target.value))} /></td>
              <td>
                <button
                  className="danger"
                  onClick={() => confirm(`${fullName(s)} mit allen Noten entfernen?`) && updK((k) => {
                    k.schueler = k.schueler.filter((x) => x.id !== s.id);
                    k.arbeiten.forEach((a) => delete a.results[s.id]);
                    k.striche = k.striche.filter((x) => x.studentId !== s.id);
                    k.sitzplaene.forEach((p) => Object.keys(p.seats).forEach((key) => p.seats[key] === s.id && delete p.seats[key]));
                  })}
                >✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => updK((k) => k.schueler.push({ id: uid(), last: 'Neu', first: '', bemerkung: '', fachNotizen: {}, erinnerungen: {} }))}>+ Schüler</button>
      <Field label="Schüler importieren" hint="Eine Zeile pro Schüler: „Nachname, Vorname“, „Nachname;Vorname“, Tab-getrennt (aus Excel kopiert) oder „Vorname Nachname“.">
        <textarea rows="5" value={importText} onChange={(e) => setImportText(e.target.value)} />
      </Field>
      <button className="primary" disabled={!importText.trim()} onClick={doImport}>Importieren</button>
    </div>
  );
}

function FaecherVerwalten({ klasse, updK }) {
  const setF = (fid, fn) => updK((k) => fn(k.faecher.find((f) => f.id === fid)));
  return (
    <div className="form">
      <p className="muted">
        Bereiche (z. B. „Klausur“, „Praxis“) können in Bereichsgruppen (z. B. „Besondere Fachprüfung“) zusammengefasst werden.
        Gewichtung: Zuerst werden die Bereiche einer Gruppe nach ihren Gewichten gemittelt, dann Gruppen und lose Bereiche nach ihren Gewichten.
        Bereiche ohne Noten zählen nicht mit.
      </p>
      {klasse.faecher.map((f) => (
        <fieldset key={f.id} className="card">
          <div className="row">
            <input className="grow strong" value={f.name} onChange={(e) => setF(f.id, (x) => (x.name = e.target.value))} aria-label="Fachname" />
            <button
              className="danger"
              onClick={() => confirm(`Fach „${f.name}“ mit allen Arbeiten löschen?`) && updK((k) => { k.faecher = k.faecher.filter((x) => x.id !== f.id); k.arbeiten = k.arbeiten.filter((a) => a.fachId !== f.id); })}
            >Fach löschen</button>
          </div>
          <h4>Bereichsgruppen</h4>
          {(f.gruppen || []).map((g) => (
            <div className="row" key={g.id}>
              <input value={g.name} onChange={(e) => setF(f.id, (x) => (x.gruppen.find((y) => y.id === g.id).name = e.target.value))} />
              <label className="check">Gewicht <input type="number" min="0" step="0.5" className="num" value={g.weight} onChange={(e) => setF(f.id, (x) => (x.gruppen.find((y) => y.id === g.id).weight = Number(e.target.value)))} /></label>
              <button className="danger" onClick={() => setF(f.id, (x) => { x.gruppen = x.gruppen.filter((y) => y.id !== g.id); x.bereiche.forEach((b) => b.gruppeId === g.id && delete b.gruppeId); })}>✕</button>
            </div>
          ))}
          <button onClick={() => setF(f.id, (x) => (x.gruppen ||= []).push({ id: uid(), name: 'Neue Gruppe', weight: 1 }))}>+ Gruppe</button>
          <h4>Bereiche</h4>
          {f.bereiche.map((b, i) => (
            <div className="row" key={b.id}>
              <input type="color" value={b.color || COLORS[i % COLORS.length]} onChange={(e) => setF(f.id, (x) => (x.bereiche[i].color = e.target.value))} aria-label="Farbe" />
              <input value={b.name} onChange={(e) => setF(f.id, (x) => (x.bereiche[i].name = e.target.value))} />
              <select value={b.gruppeId || ''} onChange={(e) => setF(f.id, (x) => { if (e.target.value) x.bereiche[i].gruppeId = e.target.value; else delete x.bereiche[i].gruppeId; })} aria-label="Gruppe">
                <option value="">– keine Gruppe –</option>
                {(f.gruppen || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <label className="check">Gewicht <input type="number" min="0" step="0.5" className="num" value={b.weight} onChange={(e) => setF(f.id, (x) => (x.bereiche[i].weight = Number(e.target.value)))} /></label>
              <button
                className="danger"
                onClick={() => confirm(`Bereich „${b.name}“ mit allen Arbeiten löschen?`) && updK((k) => { const x = k.faecher.find((y) => y.id === f.id); x.bereiche.splice(i, 1); k.arbeiten = k.arbeiten.filter((a) => a.bereichId !== b.id); })}
              >✕</button>
            </div>
          ))}
          <button onClick={() => setF(f.id, (x) => x.bereiche.push({ id: uid(), name: 'Neuer Bereich', weight: 1, color: COLORS[x.bereiche.length % COLORS.length] }))}>+ Bereich</button>
        </fieldset>
      ))}
      <button className="primary" onClick={() => updK((k) => k.faecher.push(newFach('Neues Fach')))}>+ Fach</button>
    </div>
  );
}

function Benotung({ klasse, updK }) {
  const s = klasse.settings;
  const set = (key, v) => updK((k) => (k.settings[key] = v));
  return (
    <div className="form">
      <Field label="Benotungsart">
        <select value={s.system} onChange={(e) => set('system', e.target.value)}>
          <option value="noten">Noten (1–6)</option>
          <option value="punkte">Notenpunkte (0–15, Oberstufe)</option>
        </select>
      </Field>
      {s.system === 'noten' && (
        <>
          <label className="check"><input type="checkbox" checked={s.plusMinus} onChange={(e) => set('plusMinus', e.target.checked)} /> Mit Plus/Minus (Tendenzen, z. B. 2+ / 3−)</label>
          {s.plusMinus && (
            <>
              <Field label="Wert von Plus/Minus" hint="0,25 → 2+ = 1,75 und 2− = 2,25; 0,33 → Drittelnoten">
                <input type="number" step="0.01" min="0" max="0.5" className="num" value={s.plusValue} onChange={(e) => set('plusValue', Number(e.target.value))} />
              </Field>
              <label className="check"><input type="checkbox" checked={s.plusMinusImSchnitt} onChange={(e) => set('plusMinusImSchnitt', e.target.checked)} /> Plus/Minus im Schnitt berücksichtigen</label>
            </>
          )}
          <Field label="Rundung der Zeugnisnote" hint="Ab welchem Nachkommawert zur schlechteren Note gerundet wird (Standard 0,5)">
            <input type="number" step="0.01" min="0.01" max="0.99" className="num" value={s.roundThreshold} onChange={(e) => set('roundThreshold', Number(e.target.value))} />
          </Field>
        </>
      )}
      <Field label="Nachkommastellen bei Durchschnitten">
        <input type="number" min="0" max="3" className="num" value={s.decimals} onChange={(e) => set('decimals', Number(e.target.value))} />
      </Field>
      <Field label="Gewichtung der Halbjahre im Jahresschnitt">
        <select value={Array.isArray(s.hjWeights) ? 'gew' : 'alle'} onChange={(e) => set('hjWeights', e.target.value === 'gew' ? [1, 1] : null)}>
          <option value="alle">Alle Noten des Jahres gemeinsam verrechnen</option>
          <option value="gew">Halbjahresschnitte gewichten</option>
        </select>
      </Field>
      {Array.isArray(s.hjWeights) && (
        <div className="row">
          <label className="check">1. HJ <input type="number" min="0" step="0.5" className="num" value={s.hjWeights[0]} onChange={(e) => set('hjWeights', [Number(e.target.value), s.hjWeights[1]])} /></label>
          <label className="check">2. HJ <input type="number" min="0" step="0.5" className="num" value={s.hjWeights[1]} onChange={(e) => set('hjWeights', [s.hjWeights[0], Number(e.target.value)])} /></label>
        </div>
      )}
    </div>
  );
}

export function Versetzen({ ctx, onClose }) {
  const { klasse, update } = ctx;
  const nextName = klasse.name.replace(/\d+/, (n) => String(Number(n) + 1));
  const [sj0] = klasse.schuljahr.split('/');
  const nextSj = /^\d{4}$/.test(sj0) ? `${Number(sj0) + 1}/${String(Number(sj0) + 2).slice(2)}` : currentSchuljahr();
  const [name, setName] = useState(nextName);
  const [sj, setSj] = useState(nextSj);
  return (
    <Modal
      title={`Klasse „${klasse.name}“ versetzen`}
      onClose={onClose}
      footer={
        <button
          className="primary"
          onClick={() => {
            const k = versetzeKlasse(klasse, name, sj);
            update((d) => { d.klassen.push(k); d.activeKlasseId = k.id; });
            onClose();
          }}
        >
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
