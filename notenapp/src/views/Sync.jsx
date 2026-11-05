import { useEffect, useState } from 'react';
import { Field, Modal } from '../ui.jsx';
import { platform } from '../storage.js';

const desktop = typeof window !== 'undefined' ? window.notenappDesktop : undefined;
const fmtTime = (t) => (t ? new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : 'noch nie');

export function SyncDialog({ store, ctx, onClose }) {
  return (
    <Modal title={platform === 'mac' ? 'Synchronisation mit iPhone/iPad' : 'Mit Mac synchronisieren'} onClose={onClose}>
      {platform === 'mac' ? <MacSync /> : <PhoneSync store={store} ctx={ctx} />}
    </Modal>
  );
}

// ---------------- Mac: Server, Kopplung, Geräte ----------------
function MacSync() {
  const [st, setSt] = useState(null);
  const [port, setPort] = useState('');
  const refresh = () => desktop.syncStatus().then((s) => { setSt(s); setPort((p) => p || String(s.port)); });
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    const off = desktop.onSyncEvent?.(() => refresh());
    return () => { clearInterval(t); off?.(); };
  }, []);
  if (!st) return <p className="muted">Lade …</p>;
  const secs = st.pairing ? Math.max(0, Math.round((st.pairing.expires - Date.now()) / 1000)) : 0;
  return (
    <div className="sync">
      <p className="muted">
        Das iPhone gleicht seine Noten direkt mit diesem Mac ab, über das WLAN, ohne Cloud. Beide Geräte müssen im selben Netz sein, und die
        Notenapp muss am Mac geöffnet sein. Die Übertragung ist verschlüsselt.
      </p>
      <label className="check block">
        <input type="checkbox" checked={st.enabled} onChange={async (e) => setSt(await desktop.syncSetEnabled(e.target.checked, Number(port) || st.port))} />
        <b>Synchronisation erlauben</b>
      </label>
      <div className="row">
        <span className="muted">Port</span>
        <input className="num" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} onBlur={async () => st.enabled && Number(port) !== st.port && setSt(await desktop.syncSetEnabled(true, Number(port)))} />
        <span className={st.running ? 'ok' : 'muted'}>{st.running ? '● aktiv' : st.enabled ? '○ nicht gestartet' : '○ aus'}</span>
      </div>
      {st.error && <p className="error">{st.error}</p>}
      {st.running && (
        <p>
          Adresse dieses Macs: {st.addresses.length ? st.addresses.map((a) => <code key={a} className="addr">{a}</code>) : <span className="error">kein WLAN/Netzwerk gefunden</span>}
          {' '}· Port <code>{st.port}</code>
        </p>
      )}

      {st.running && (
        st.pairing ? (
          <div className="card center">
            <p>Auf dem iPhone in der Notenapp: <b>⟳ Sync → Mit Mac koppeln</b> und eingeben:</p>
            <p>Adresse <code className="addr big">{st.addresses[0] || '–'}</code> Port <code className="addr big">{st.port}</code></p>
            <div className="pair-code">{st.pairing.code.slice(0, 4)}-{st.pairing.code.slice(4)}</div>
            <p className="muted small">Gültig noch {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} Minuten</p>
            <button onClick={async () => setSt(await desktop.syncStopPairing())}>Abbrechen</button>
          </div>
        ) : (
          <button className="primary" onClick={async () => setSt(await desktop.syncStartPairing())}>📱 iPhone/iPad koppeln</button>
        )
      )}

      <h4>Gekoppelte Geräte</h4>
      {!st.devices.length && <p className="muted">Noch keine.</p>}
      <ul className="plain">
        {st.devices.map((d) => (
          <li key={d.id} className="row">
            <span className="grow"><b>{d.name}</b> <span className="muted small">gekoppelt {fmtTime(d.pairedAt)} · letzte Synchronisation {fmtTime(d.lastSync)}</span></span>
            <button className="danger" onClick={async () => confirm(`„${d.name}“ entkoppeln? Das Gerät kann danach nicht mehr synchronisieren.`) && setSt(await desktop.syncRemoveDevice(d.id))}>Entfernen</button>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Beim ersten Einschalten fragt macOS, ob die Notenapp eingehende Verbindungen annehmen darf: „Erlauben“ wählen. Läuft die Synchronisation
        nicht, hilft meist: Systemeinstellungen → Netzwerk → Firewall → Notenapp erlauben.
      </p>
    </div>
  );
}

// ---------------- iPhone: koppeln und synchronisieren ----------------
function PhoneSync({ store, ctx }) {
  const p = store.sync.pairing;
  const [host, setHost] = useState(p?.host || '');
  const [port, setPort] = useState(String(p?.port || 12980));
  const [code, setCode] = useState('');
  const [name, setName] = useState(platform === 'ios' ? 'iPhone' : 'Browser');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [editHost, setEditHost] = useState(false);
  const { data, update } = ctx;

  async function doPair() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await store.pair({ host, port: Number(port) || 12980, code, deviceName: name });
      setMsg({ ok: true, text: `Gekoppelt mit „${r.macName}“. Erste Synchronisation läuft …` });
      await store.syncNow();
      setMsg({ ok: true, text: `Gekoppelt mit „${r.macName}“ und synchronisiert.` });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function doSync() {
    setMsg(null);
    try {
      await store.syncNow();
      setMsg({ ok: true, text: 'Synchronisiert.' });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  }

  if (!p) {
    return (
      <div className="sync">
        <p>So koppelst du das {platform === 'ios' ? 'iPhone' : 'Gerät'} einmalig mit dem Mac:</p>
        <ol>
          <li>Am Mac in der Notenapp: <b>☰ Klasse → Synchronisation mit iPhone</b>, „Synchronisation erlauben“ einschalten.</li>
          <li>Dort auf <b>„iPhone/iPad koppeln“</b> klicken. Der Mac zeigt Adresse, Port und einen Code.</li>
          <li>Hier eintragen und „Koppeln“ tippen. Beide Geräte müssen im selben WLAN sein.</li>
        </ol>
        <Field label="Adresse des Macs (z. B. 192.168.178.20)">
          <input value={host} onChange={(e) => setHost(e.target.value.trim())} inputMode="decimal" autoCapitalize="off" autoCorrect="off" placeholder="192.168.…" />
        </Field>
        <Field label="Port"><input className="num" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></Field>
        <Field label="Kopplungscode vom Mac">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoCorrect="off" placeholder="XXXX-XXXX" className="code-input" />
        </Field>
        <Field label="Name dieses Geräts"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <button className="primary" disabled={busy || !host || code.replace(/[^A-Z0-9]/gi, '').length < 8} onClick={doPair}>
          {busy ? 'Kopple …' : 'Koppeln'}
        </button>
        {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
        <p className="muted small">Beim ersten Mal fragt iOS, ob die Notenapp Geräte im lokalen Netzwerk finden darf: „Erlauben“ tippen.</p>
      </div>
    );
  }

  return (
    <div className="sync">
      <p>
        Gekoppelt mit <b>{p.macName}</b> ({p.host}:{p.port})<br />
        <span className="muted">Letzte Synchronisation: {fmtTime(p.lastSync)}</span>
      </p>
      <button className="primary big-btn" disabled={store.sync.busy} onClick={doSync}>
        {store.sync.busy ? '⟳ Synchronisiere …' : '⟳ Jetzt synchronisieren'}
      </button>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
      <label className="check block">
        <input type="checkbox" checked={data.prefs.autoSync !== false} onChange={(e) => update((d) => (d.prefs.autoSync = e.target.checked))} />
        Beim Öffnen der App automatisch synchronisieren
      </label>
      <h4>So wird abgeglichen</h4>
      <ul className="small">
        <li>Änderungen auf beiden Geräten werden zusammengeführt, bis auf die einzelne Note.</li>
        <li>Wurde dieselbe Note auf beiden Geräten unterschiedlich geändert, gilt die neuere Änderung.</li>
        <li>Klassen mit eigenem Passwort werden als Ganzes abgeglichen; nach einer Änderung auf dem anderen Gerät muss man sie neu entsperren.</li>
        <li>Vor jeder Synchronisation legt die App ein Backup an (Dateien → Auf meinem iPhone → Notenapp → Backups).</li>
      </ul>
      <div className="row">
        {editHost ? (
          <>
            <input value={host} onChange={(e) => setHost(e.target.value.trim())} inputMode="decimal" />
            <input className="num" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
            <button onClick={async () => { await store.updatePairing({ host, port: Number(port) || 12980 }); setEditHost(false); }}>Speichern</button>
          </>
        ) : (
          <button onClick={() => setEditHost(true)}>Adresse des Macs ändern</button>
        )}
        <button className="danger" onClick={() => confirm('Kopplung mit dem Mac aufheben? Die Noten auf diesem Gerät bleiben erhalten.') && store.unpair()}>Entkoppeln</button>
      </div>
    </div>
  );
}
