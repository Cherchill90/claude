import { useState } from 'react';
import { useAppState, useAppDispatch } from '../state/store.jsx';
import { todayISO } from '../lib/time.js';
import { entriesForDate, sumMinutes, aggregatedRows } from '../state/selectors.js';
import { syncDay } from '../lib/api.js';
import { SURVEY_LABEL } from '../lib/config.js';

const FIELDS = [
  { name: 'Minuten pro Kategorie pro Tag', state: 'gesendet', mark: '✓', color: '#728157' },
  { name: 'Stundenmaß in Prozent', state: 'gesendet', mark: '✓', color: '#728157' },
  { name: 'Pseudonym (pro Erhebung neu)', state: 'gesendet', mark: '✓', color: '#728157' },
  { name: 'Name, Fächer, Klassen', state: 'nie', mark: '×', color: '#a19786' },
  { name: 'Uhrzeiten, Notizen, Standort', state: 'nie', mark: '×', color: '#a19786' },
];

export default function Daten() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [showPreview, setShowPreview] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);

  const iso = todayISO();
  const todayEntries = entriesForDate(state, iso);
  const todayRows = aggregatedRows(state, todayEntries);
  const previewRows = aggregatedRows(state, state.entries).slice(0, 5);
  const alreadySyncedToday = state.syncLog.some((l) => l.date === iso);

  const togglePart = () => dispatch({ type: 'SET_PARTICIPATE', value: !state.participate });

  const onSync = async () => {
    if (!todayRows.length || syncing) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const rows = todayRows.map((r) => ({ category: r.name, minutes: r.min }));
      await syncDay({ pseudonym: state.pseudonym, date: iso, deputat: state.deputat, rows });
      dispatch({ type: 'MARK_SYNCED', date: iso, rows: rows.length, sentAt: Date.now() });
    } catch (err) {
      setSyncError(err.message || 'Sync fehlgeschlagen.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '.09em', textTransform: 'uppercase', color: 'rgba(32,30,29,.5)', fontWeight: 700 }}>{SURVEY_LABEL}</div>
      <h1 style={{ fontSize: 34, margin: '4px 0 0' }}>Datenraum</h1>

      <div style={{ marginTop: 20, background: 'var(--color-accent-2-200)', borderRadius: 'var(--radius-lg)', padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 19, color: 'var(--color-accent-2-900)' }}>
              {state.participate ? 'Teilnahme aktiv' : 'Teilnahme pausiert'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-accent-2-800)', marginTop: 3 }}>
              Pseudonym <strong>{state.pseudonym}</strong> · kein Name, keine Fächer
            </div>
          </div>
          <button
            type="button"
            onClick={togglePart}
            style={{ border: 0, cursor: 'pointer', width: 58, height: 34, borderRadius: 999, padding: 4, display: 'flex', justifyContent: state.participate ? 'flex-end' : 'flex-start', background: state.participate ? 'var(--color-accent-2-700)' : 'var(--color-neutral-400)' }}
          >
            <div style={{ width: 26, height: 26, borderRadius: 999, background: 'var(--color-neutral-100)' }} />
          </button>
        </div>
      </div>

      <h4 style={{ margin: '26px 0 10px', fontSize: 18 }}>Das verlässt dein Handy</h4>
      <div style={{ background: 'var(--color-neutral-100)', borderRadius: 'var(--radius-lg)', padding: '6px 18px' }}>
        {FIELDS.map((f, i) => (
          <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderBottom: i === FIELDS.length - 1 ? 'none' : '1px solid rgba(32,30,29,.08)' }}>
            <div style={{ width: 22, height: 22, borderRadius: 999, flex: 'none', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, color: 'var(--color-bg)', background: f.color }}>{f.mark}</div>
            <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.35 }}>{f.name}</div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: f.color }}>{f.state}</div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setShowPreview((v) => !v)}
        style={{ cursor: 'pointer', marginTop: 12, width: '100%', border: '1px solid rgba(32,30,29,.15)', background: 'var(--color-neutral-100)', borderRadius: 999, padding: 13, fontFamily: 'var(--font-heading)', fontSize: 14, color: 'var(--color-accent-700)' }}
      >
        {showPreview ? 'Vorschau schließen' : 'Genaue Zeilen ansehen'}
      </button>

      {showPreview && (
        <div style={{ marginTop: 12, borderRadius: 22, overflow: 'hidden', border: '1px solid rgba(32,30,29,.12)', fontVariantNumeric: 'tabular-nums' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr .7fr', background: 'var(--color-accent-800)', color: 'var(--color-accent-100)', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' }}>
            <div style={{ padding: '9px 12px' }}>Datum</div><div style={{ padding: '9px 12px' }}>Kategorie</div><div style={{ padding: '9px 12px', textAlign: 'right' }}>Min.</div>
          </div>
          {previewRows.map((r) => (
            <div key={`${r.date}-${r.name}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr .7fr', fontSize: 12, background: 'var(--color-neutral-100)', borderTop: '1px solid rgba(32,30,29,.07)' }}>
              <div style={{ padding: '9px 12px', color: 'rgba(32,30,29,.6)' }}>{r.date.slice(8, 10)}.{r.date.slice(5, 7)}.</div>
              <div style={{ padding: '9px 12px' }}>{r.name}</div>
              <div style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>{r.min}</div>
            </div>
          ))}
          {!previewRows.length && (
            <div style={{ padding: '12px', fontSize: 12, color: 'rgba(32,30,29,.5)', background: 'var(--color-neutral-100)' }}>Noch keine Daten erfasst.</div>
          )}
        </div>
      )}

      <h4 style={{ margin: '26px 0 10px', fontSize: 18 }}>Übermittlungen</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {state.syncLog.map((p) => (
          <div key={p.date} style={{ display: 'flex', alignItems: 'center', gap: 13, background: 'var(--color-neutral-100)', borderRadius: 22, padding: '13px 16px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.date}</div>
              <div style={{ fontSize: 11.5, color: 'rgba(32,30,29,.5)' }}>{p.rows} Zeilen · in zentraler Tabelle</div>
            </div>
            <div style={{ padding: '6px 13px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: 'var(--color-accent-2-200)', color: 'var(--color-accent-2-800)' }}>gesendet</div>
          </div>
        ))}
        {!alreadySyncedToday && todayRows.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, background: 'var(--color-neutral-100)', borderRadius: 22, padding: '13px 16px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Heute</div>
              <div style={{ fontSize: 11.5, color: 'rgba(32,30,29,.5)' }}>{todayRows.length} Zeilen · wartet auf Freigabe</div>
            </div>
            <div style={{ padding: '6px 13px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: 'var(--color-accent-200)', color: 'var(--color-accent-800)' }}>offen</div>
          </div>
        )}
        {!state.syncLog.length && !todayRows.length && (
          <div style={{ fontSize: 13, color: 'rgba(32,30,29,.5)' }}>Noch keine Übermittlungen.</div>
        )}
      </div>

      <button
        type="button"
        onClick={onSync}
        disabled={!state.participate || !todayRows.length || syncing}
        style={{
          cursor: !state.participate || !todayRows.length || syncing ? 'default' : 'pointer',
          marginTop: 14, width: '100%', border: 0,
          background: alreadySyncedToday ? 'var(--color-accent-2-600)' : 'var(--color-accent)',
          color: 'var(--color-bg)', borderRadius: 999, padding: 15, fontFamily: 'var(--font-heading)', fontSize: 15,
          opacity: !state.participate || !todayRows.length ? 0.5 : 1,
        }}
      >
        {syncing ? 'Sende …' : alreadySyncedToday ? 'Heute übermittelt ✓' : 'Heutige Zeilen jetzt senden'}
      </button>
      {syncError && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-accent-700)' }}>{syncError}</div>
      )}
      <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.5, color: 'rgba(32,30,29,.5)' }}>
        Die Zeilen werden ohne Gerätekennung an die Sammelstelle der Schule gesendet und dort in die zentrale Tabelle geschrieben. Auswertungen erst ab 5 teilnehmenden Personen.
      </div>
    </div>
  );
}
