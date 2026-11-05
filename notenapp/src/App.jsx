import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, newKlasse, isDesktop } from './store.js';
import { uid } from './grades.js';
import { NotenSide, NotenMain } from './views/Noten.jsx';
import { SchuelerSide, SchuelerMain } from './views/Schueler.jsx';
import { ListenSide, ListenMain, LISTEN } from './views/Listen.jsx';
import { SitzplanSide, SitzplanMain } from './views/Sitzplan.jsx';
import { KlassenVerwalten, Versetzen } from './views/Verwalten.jsx';
import { LockScreen, Einstellungen, Hilfe, exportBackup, importBackup, pickCsv } from './views/Global.jsx';
import { CsvImport } from './views/CsvImport.jsx';
import { SyncDialog } from './views/Sync.jsx';
import { platform } from './storage.js';
import { Empty } from './ui.jsx';

function KlasseEntsperren({ klasse, store }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="lock" style={{ height: 'auto', padding: 60, background: 'none' }}>
      <form className="card" onSubmit={async (e) => { e.preventDefault(); try { await store.unlockKlasse(klasse.id, pw); } catch { setErr('Falsches Passwort.'); } }}>
        <h2>🔒 {klasse.name}</h2>
        <p className="muted">Diese Klasse ist mit einem eigenen Passwort geschützt.</p>
        <input type="password" autoFocus placeholder="Passwort der Klasse" value={pw} onChange={(e) => { setPw(e.target.value); setErr(''); }} />
        {err && <p className="error">{err}</p>}
        <button className="primary" type="submit">Öffnen</button>
      </form>
    </div>
  );
}

const TABS = [
  ['noten', 'Noten'],
  ['schueler', 'Schüler'],
  ['listen', 'Listen'],
  ['sitzplan', 'Sitzplan'],
];

export default function App() {
  const store = useStore();
  const { data, update, locked } = store;
  const [tab, setTab] = useState('noten');
  const [sel, setSelState] = useState({ hj: 1, liste: 'fach' });
  const [modal, setModal] = useState(null);
  const [menu, setMenu] = useState(null);
  const [sideOpen, setSideOpen] = useState(false);
  const setSel = (patch) => {
    setSelState((s) => ({ ...s, ...patch }));
    // Handy: nach einer Auswahl in der Seitenleiste wieder zum Inhalt
    if (['arbeitId', 'schuelerId', 'liste', 'planId'].some((k) => patch[k]) && window.innerWidth < 760) setSideOpen(false);
  };

  // Nur im CI-Build: automatischer Selbsttest der nativen App (siehe .github/workflows/ios.yml)
  const storeRef = useRef(store);
  storeRef.current = store;
  useEffect(() => {
    if (import.meta.env.VITE_SELFTEST === '1' && platform === 'ios') import('./selftest.js').then((m) => m.startSelftest(storeRef));
  }, []);

  // Theme
  useEffect(() => {
    document.documentElement.dataset.theme = data.prefs.theme;
    document.documentElement.dataset.farbskala = data.prefs.farbskala === false ? 'aus' : 'an';
  }, [data.prefs.theme, data.prefs.farbskala]);

  // Automatische Sperre nach Inaktivität (nur mit Passwort)
  const last = useRef(Date.now());
  useEffect(() => {
    const bump = () => (last.current = Date.now());
    const evs = ['mousedown', 'keydown', 'touchstart'];
    evs.forEach((e) => window.addEventListener(e, bump));
    const t = setInterval(() => {
      const min = data.prefs.lockMinutes;
      if (min > 0 && (store.hasPassword() || store.anyKlassePassword()) && Date.now() - last.current > min * 60000) store.lock();
    }, 10000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  });

  // Tastenkürzel wie in der Mac-App
  useEffect(() => {
    const h = (e) => {
      if (isDesktop || !(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'o') setModal({ type: 'verwalten' });
      else if (k === 'n') addKlasse();
      else if (k === 'p') window.print();
      else if (k === 's') exportBackup(data);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const openCsv = (text, name) => setModal({ type: 'csv', text, name });

  // Menübefehle der Mac-App
  useEffect(() =>
    window.notenappDesktop?.onMenu?.((cmd) => {
      if (cmd === 'verwalten') setModal({ type: 'verwalten' });
      else if (cmd === 'neu') addKlasse();
      else if (cmd === 'versetzen' && klasse && !klasse.sealed) setModal({ type: 'versetzen', kid: klasse.id });
      else if (cmd === 'export') exportBackup(data);
      else if (cmd === 'import') importBackup(store, openCsv);
      else if (cmd === 'importFach') pickCsv(openCsv);
      else if (cmd === 'einstellungen') setModal('einstellungen');
      else if (cmd === 'sperren') store.lock();
      else if (cmd === 'hilfe') setModal('hilfe');
      else if (cmd === 'sync') setModal('sync');
    }),
  );

  const klasse = data.klassen.find((k) => k.id === data.activeKlasseId) || data.klassen[0];
  const sealed = !!klasse?.sealed;
  const fach = sealed ? null : klasse?.faecher.find((f) => f.id === sel.fachId) || klasse?.faecher[0];

  const ctx = useMemo(
    () => ({
      data,
      update,
      klasse,
      fach,
      sel,
      setSel,
      setTab,
      setModal,
      updK: (fn) =>
        update((d) => {
          const k = d.klassen.find((x) => x.id === klasse.id);
          fn(k, d);
        }),
    }),
    [data, klasse, fach, sel],
  );

  if (locked) return <LockScreen onUnlock={store.tryUnlock} />;

  function addKlasse() {
    const k = newKlasse();
    update((d) => {
      d.klassen.push(k);
      d.activeKlasseId = k.id;
    });
    setModal({ type: 'verwalten', edit: { id: k.id, step: 'allgemein' } });
  }

  function addDemo() {
    const k = newKlasse('Beispielklasse');
    for (let i = 1; i <= 12; i++) k.schueler.push({ id: uid(), first: '', last: `Schüler ${String(i).padStart(2, '0')}`, bemerkung: '', fachNotizen: {}, erinnerungen: {} });
    const f = k.faecher[0];
    f.name = 'Mathematik';
    const grades = ['1', '2+', '2', '2-', '3+', '3', '3-', '4', '4-', '5', '2', '3'];
    const [b1, b2] = f.bereiche;
    const mk = (title, bereich, date, shift) => ({
      id: uid(), title, fachId: f.id, bereichId: bereich.id, halbjahr: 1, date, mitDatum: true, notiz: '',
      results: Object.fromEntries(k.schueler.map((s, i) => [s.id, { grade: grades[(i + shift) % grades.length] }])),
    });
    k.arbeiten.push(mk('1. Klassenarbeit', b1, '2026-10-02', 0), mk('2. Klassenarbeit', b1, '2026-11-20', 3), mk('Mündlich Okt.', b2, '2026-10-30', 5));
    update((d) => {
      d.klassen.push(k);
      d.activeKlasseId = k.id;
    });
  }

  const menuItems = [
    ['Klassen verwalten', '⌘O', () => setModal({ type: 'verwalten' })],
    ['+ Neue Klasse anlegen', '⌘N', addKlasse],
    ['Klasse versetzen', '', () => klasse && !sealed && setModal({ type: 'versetzen', kid: klasse.id })],
    'sep',
    ['Sicherheitskopie aller Klassen', '⌘S', () => exportBackup(data)],
    ['Importieren (Sicherheitskopie)', '', () => importBackup(store, openCsv)],
    ['Import von Fächern mit Noten (CSV)', '', () => pickCsv(openCsv)],
    'sep',
    [platform === 'mac' ? 'Synchronisation mit iPhone …' : 'Mit Mac synchronisieren …', platform === 'mac' ? '⌘Y' : '', () => setModal('sync')],
    ['Einstellungen & Passwort', '', () => setModal('einstellungen')],
    (store.hasPassword() || store.anyKlassePassword()) && ['Jetzt sperren', '', () => store.lock()],
    platform !== 'ios' && ['Drucken …', '⌘P', () => window.print()],
  ].filter(Boolean);

  async function syncButton() {
    if (platform === 'mac' || !store.sync.pairing) return setModal('sync');
    try {
      await store.syncNow();
    } catch (e) {
      alert('Synchronisation fehlgeschlagen:\n' + e.message);
    }
  }

  const Side = { noten: NotenSide, schueler: SchuelerSide, listen: ListenSide, sitzplan: SitzplanSide }[tab];
  const Main = { noten: NotenMain, schueler: SchuelerMain, listen: ListenMain, sitzplan: SitzplanMain }[tab];

  return (
    <div className={'app' + (sideOpen ? ' side-open' : '')} onClick={() => menu && setMenu(null)}>
      <aside className="sidebar no-print">
        <div className="selectors">
          <select
            value={klasse?.id || ''}
            onChange={(e) => {
              update((d) => (d.activeKlasseId = e.target.value));
              setSel({ fachId: null, bereichId: null, arbeitId: null, schuelerId: null });
            }}
            aria-label="Klasse"
          >
            {!klasse && <option value="">– keine Klasse –</option>}
            {[...new Set(data.klassen.map((k) => k.schuljahr))].sort().reverse().map((sj) => (
              <optgroup key={sj} label={`Schuljahr ${sj}`}>
                {data.klassen.filter((k) => k.schuljahr === sj).map((k) => (
                  <option key={k.id} value={k.id}>{k.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {klasse && !sealed && tab !== 'sitzplan' && (
            <select value={fach?.id || ''} onChange={(e) => setSel({ fachId: e.target.value, bereichId: null, arbeitId: null })} aria-label="Fach">
              {klasse.faecher.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
          {klasse && !sealed && (
            <div className="seg">
              {[[1, '1. HJ'], [2, '2. HJ'], [0, 'Jahr']].map(([v, l]) => (
                <button key={v} className={sel.hj === v ? 'on' : ''} onClick={() => setSel({ hj: v, arbeitId: null })}>{l}</button>
              ))}
            </div>
          )}
        </div>
        {klasse && fach && <Side ctx={ctx} />}
      </aside>

      <div className="content">
        <header className="topbar no-print">
          <button className="side-toggle" onClick={() => setSideOpen(!sideOpen)} aria-label="Auswahl ein-/ausblenden">{sideOpen ? '✕' : '☰'}</button>
          <nav className="tabs">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? 'on' : ''}
                onClick={(e) => {
                  if (id === 'listen') {
                    e.stopPropagation();
                    setMenu(menu === 'listen' ? null : 'listen');
                  }
                  setTab(id);
                  if (id !== 'listen') setSideOpen(false);
                }}
              >
                {label}{id === 'listen' && ' ▾'}
              </button>
            ))}
            {menu === 'listen' && (
              <div className="dropdown" style={{ left: 'calc(50% - 40px)' }}>
                {LISTEN.map(([id, label]) => (
                  <button key={id} onClick={() => { setSel({ liste: id }); setTab('listen'); setMenu(null); }}>{label}</button>
                ))}
              </div>
            )}
          </nav>
          <div className="actions">
            <span className={'save-state ' + (store.saveState.startsWith('error') ? 'error' : '')} title={platform === 'mac' ? 'Daten werden automatisch in einer Datei auf diesem Mac gespeichert' : platform === 'ios' ? 'Daten werden automatisch auf diesem Gerät gespeichert' : 'Daten werden automatisch im Browser gespeichert'}>
              {store.saveState === 'saved' ? '✓ Gespeichert' : store.saveState === 'pending' ? 'Speichert …' : '⚠ Speicherfehler'}
            </span>
            <button onClick={(e) => { e.stopPropagation(); setMenu(menu === 'klasse' ? null : 'klasse'); }}>☰ Klasse</button>
            <button className={'sync-btn' + (store.sync.busy ? ' busy' : '') + (store.sync.error ? ' err' : '')} onClick={syncButton} title={store.sync.error || (store.sync.pairing?.lastSync ? 'Zuletzt: ' + new Date(store.sync.pairing.lastSync).toLocaleString('de-DE') : 'Synchronisation')}>
              {platform === 'mac' ? '📱 Sync' : store.sync.busy ? '⟳ …' : '⟳ Sync'}
            </button>
            {platform !== 'ios' && <button className="print-btn" onClick={() => window.print()}>🖨 Drucken</button>}
            <button onClick={() => setModal('hilfe')}>? Hilfe</button>
            {menu === 'klasse' && (
              <div className="dropdown right">
                {menuItems.map((m, i) =>
                  m !== 'sep' ? (
                    <button key={i} onClick={() => { setMenu(null); m[2](); }}>
                      <span>{m[0]}</span><kbd>{m[1]}</kbd>
                    </button>
                  ) : <hr key={i} />,
                )}
              </div>
            )}
          </div>
        </header>
        <main>
          {!klasse ? (
            <Empty>
              <h2>Willkommen</h2>
              <p>Lege deine erste Klasse an oder starte mit einer Beispielklasse.</p>
              <p>
                <button className="primary" onClick={addKlasse}>+ Neue Klasse anlegen</button>{' '}
                <button onClick={addDemo}>Beispielklasse laden</button>{' '}
                <button onClick={() => pickCsv(openCsv)}>Noten aus CSV importieren</button>{' '}
                <button onClick={() => importBackup(store, openCsv)}>Sicherheitskopie importieren</button>
              </p>
            </Empty>
          ) : sealed ? (
            <KlasseEntsperren klasse={klasse} store={store} />
          ) : !fach ? (
            <Empty>
              Diese Klasse hat noch kein Fach. <button onClick={() => setModal({ type: 'verwalten' })}>Klasse verwalten</button>
            </Empty>
          ) : (
            <Main ctx={ctx} />
          )}
        </main>
      </div>

      {modal?.type === 'verwalten' && (
        <KlassenVerwalten
          ctx={ctx}
          store={store}
          startEdit={modal.edit}
          onClose={() => setModal(null)}
          onOpenSitzplan={(kid) => { update((d) => (d.activeKlasseId = kid)); setSel({ planId: null }); setTab('sitzplan'); setModal(null); }}
          onVersetzen={(kid) => setModal({ type: 'versetzen', kid })}
        />
      )}
      {modal?.type === 'versetzen' && (
        <Versetzen ctx={ctx} klasse={data.klassen.find((k) => k.id === modal.kid)} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'csv' && <CsvImport ctx={ctx} text={modal.text} fileName={modal.name} onClose={() => setModal(null)} />}
      {modal === 'einstellungen' && <Einstellungen ctx={ctx} store={store} onClose={() => setModal(null)} />}
      {modal === 'hilfe' && <Hilfe onClose={() => setModal(null)} />}
      {modal === 'sync' && <SyncDialog store={store} ctx={ctx} onClose={() => setModal(null)} />}
    </div>
  );
}
