import { useState } from 'react';
import { defaultSchluessel, uid } from '../grades.js';
import { migrate, newFach } from '../store.js';
import { download, Field, Modal, today } from '../ui.jsx';

export function LockScreen({ onUnlock }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="lock">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await onUnlock(pw);
          } catch {
            setErr('Falsches Passwort.');
          }
        }}
      >
        <h2>🔒 Notenapp gesperrt</h2>
        <p className="muted">Die Daten sind verschlüsselt gespeichert.</p>
        <input type="password" autoFocus placeholder="Passwort" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <p className="error">{err}</p>}
        <button className="primary" type="submit">Entsperren</button>
      </form>
    </div>
  );
}

export function Einstellungen({ ctx, store, onClose }) {
  const { data, update } = ctx;
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');
  const has = store.hasPassword();
  return (
    <Modal title="Einstellungen" onClose={onClose}>
      <h3>Passwortschutz</h3>
      <p className="muted">
        Mit Passwort werden alle Daten im Browser mit AES-256 verschlüsselt gespeichert. Ohne das Passwort sind sie nicht wiederherstellbar – bitte merken
        und regelmäßig eine Sicherheitskopie erstellen.
      </p>
      <Field label={has ? 'Neues Passwort' : 'Passwort'}><input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} autoComplete="new-password" /></Field>
      <Field label="Wiederholen"><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
      <div className="row">
        <button
          className="primary"
          disabled={!pw1 || pw1 !== pw2}
          onClick={async () => { await store.setPassword(pw1); setPw1(''); setPw2(''); setMsg('Passwort gesetzt, Daten verschlüsselt.'); }}
        >
          {has ? 'Passwort ändern' : 'Passwort setzen'}
        </button>
        {has && (
          <button onClick={async () => { if (confirm('Passwortschutz entfernen? Daten werden dann unverschlüsselt gespeichert.')) { await store.setPassword(null); setMsg('Passwortschutz entfernt.'); } }}>
            Passwort entfernen
          </button>
        )}
      </div>
      {pw1 && pw2 && pw1 !== pw2 && <p className="error">Passwörter stimmen nicht überein.</p>}
      {msg && <p className="ok">{msg}</p>}
      <Field label="Automatisch sperren nach (Minuten Inaktivität, 0 = nie)">
        <input type="number" min="0" className="num" value={data.prefs.lockMinutes} onChange={(e) => update((d) => (d.prefs.lockMinutes = Number(e.target.value)))} />
      </Field>
      <h3>Darstellung</h3>
      <Field label="Design">
        <select value={data.prefs.theme} onChange={(e) => update((d) => (d.prefs.theme = e.target.value))}>
          <option value="auto">wie System</option>
          <option value="light">Hell</option>
          <option value="dark">Dunkel</option>
        </select>
      </Field>
    </Modal>
  );
}

export function Hilfe({ onClose }) {
  return (
    <Modal title="Hilfe" onClose={onClose}>
      <h3>Aufbau</h3>
      <ul>
        <li><b>Noten</b>: Links Klasse, Fach, Halbjahr und Bereich wählen, dann eine Arbeit. In der Mitte Noten eintippen (Enter/↓ = nächster Schüler). Rechts Notiz und Datum zur einzelnen Note sowie der Notenspiegel.</li>
        <li><b>Schüler</b>: Leistungsverlauf je Bereich, Notentabelle, Zeugnisnoten, Foto, Erinnerungen und Notizen.</li>
        <li><b>Listen</b>: Strichlisten, Fach/Schüler auf einen Blick, Durchschnitte, Zeugnisnoten, Klassenlisten, Klassenbuch – jeweils druckbar und als Excel-CSV exportierbar.</li>
        <li><b>Sitzplan</b>: bis zu drei Pläne pro Klasse. „Bearbeiten“: Schüler auf Plätze ziehen. „Unterricht“: Schüler antippen, um Noten, Striche und Notizen direkt einzutragen.</li>
      </ul>
      <h3>Noteneingabe</h3>
      <ul>
        <li>Noten 1–6: <code>2</code>, <code>2+</code>, <code>3-</code>, <code>2,5</code>. Notenpunkte: <code>0</code>–<code>15</code>.</li>
        <li>Mit „Notenschlüssel“ werden Punkte eingegeben und automatisch in Noten umgerechnet.</li>
        <li>„Schreibschutz“ sperrt eine Arbeit gegen versehentliche Änderungen.</li>
      </ul>
      <h3>Tastenkürzel</h3>
      <ul>
        <li>⌘/Strg + O: Klassen verwalten · ⌘/Strg + N: Neue Klasse · ⌘/Strg + S: Sicherheitskopie · ⌘/Strg + P: Drucken</li>
      </ul>
      <h3>Datenspeicherung</h3>
      <p>Alle Daten bleiben lokal in diesem Browser. Bitte regelmäßig „Sicherheitskopie aller Klassen“ ausführen – beim Löschen der Browserdaten gehen sie sonst verloren.</p>
    </Modal>
  );
}

export function exportBackup(data) {
  const blob = new Blob([JSON.stringify({ format: 'notenapp-backup', version: 1, created: new Date().toISOString(), data }, null, 1)], { type: 'application/json' });
  download(`Notenapp-Sicherung-${today()}.json`, blob);
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.onchange = () => resolve(i.files[0]);
    i.click();
  });
}

export async function importBackup(store) {
  const f = await pickFile('.json,application/json');
  if (!f) return;
  try {
    const parsed = JSON.parse(await f.text());
    const incoming = migrate(parsed.format === 'notenapp-backup' ? parsed.data : parsed);
    if (!incoming.klassen.length) return alert('Die Datei enthält keine Klassen.');
    const replace = store.data.klassen.length
      ? confirm(`${incoming.klassen.length} Klasse(n) gefunden.\n\nOK = vorhandene Daten ERSETZEN\nAbbrechen = als zusätzliche Klassen hinzufügen`)
      : true;
    if (replace) store.setData(incoming);
    else
      store.update((d) => {
        const ids = new Set(d.klassen.map((k) => k.id));
        for (const k of incoming.klassen) d.klassen.push(ids.has(k.id) ? { ...k, id: uid(), name: k.name + ' (Import)' } : k);
      });
  } catch (e) {
    alert('Import fehlgeschlagen: ' + e.message);
  }
}

/** CSV-Import eines Fachs mit Noten: Kopfzeile „Nachname;Vorname;Arbeit 1;Arbeit 2…“. */
export async function importFachCsv(ctx) {
  const f = await pickFile('.csv,text/csv,text/plain');
  if (!f) return;
  const text = (await f.text()).replace(/^﻿/, '');
  const sep = text.split('\n')[0].includes(';') ? ';' : text.split('\n')[0].includes('\t') ? '\t' : ',';
  const rows = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
  if (rows.length < 2 || rows[0].length < 3) return alert('Erwartet: Kopfzeile „Nachname;Vorname;Arbeit 1;…“ und eine Zeile pro Schüler.');
  const [head, ...body] = rows;
  const fachName = prompt('Name des importierten Fachs:', f.name.replace(/\.[^.]+$/, ''));
  if (!fachName) return;
  ctx.updK((k) => {
    const fach = newFach(fachName);
    k.faecher.push(fach);
    const bereich = fach.bereiche[0];
    const arbeiten = head.slice(2).map((title) => ({
      id: uid(), title, fachId: fach.id, bereichId: bereich.id, halbjahr: ctx.sel.hj || 1, date: today(), mitDatum: false,
      individuell: false, weight: 1, locked: false, useSchluessel: false, maxPoints: 50, schluessel: defaultSchluessel(k.settings), notiz: '', results: {},
    }));
    for (const r of body) {
      const [last, first] = r;
      let st = k.schueler.find((s) => s.last.toLowerCase() === (last || '').toLowerCase() && s.first.toLowerCase() === (first || '').toLowerCase());
      if (!st) {
        st = { id: uid(), last: last || '', first: first || '', bemerkung: '', fachNotizen: {}, erinnerungen: {} };
        k.schueler.push(st);
      }
      r.slice(2).forEach((g, i) => { if (g && arbeiten[i]) arbeiten[i].results[st.id] = { grade: g }; });
    }
    k.arbeiten.push(...arbeiten);
  });
  alert(`Fach „${fachName}“ mit ${head.length - 2} Arbeit(en) importiert.`);
}
