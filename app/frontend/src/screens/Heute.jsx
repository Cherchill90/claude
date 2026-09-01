import { useEffect, useState } from 'react';
import { useAppState, useAppDispatch, sollWeekMinutes, sollDayMinutes } from '../state/store.jsx';
import { findCategory } from '../lib/categories.js';
import { clock, hm, hmShort, longDateLabel, todayISO } from '../lib/time.js';
import { entriesForDate, sumMinutes, runningMinutes, weekTotalMinutes } from '../state/selectors.js';

function runningClockLabel(startTs, now) {
  const t = Math.max(0, Math.floor((now - startTs) / 1000));
  const hh = String(Math.floor(t / 3600)).padStart(2, '0');
  const mm = String(Math.floor(t / 60) % 60).padStart(2, '0');
  const ss = String(t % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export default function Heute({ onOpenAdd }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!state.running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.running]);

  const iso = todayISO();
  const todayEntries = entriesForDate(state, iso);
  const todayMin = sumMinutes(todayEntries);
  const runMin = runningMinutes(state, now);
  const tagesSoll = sollDayMinutes(state);
  const sollWeek = sollWeekMinutes(state);
  const weekTotal = weekTotalMinutes(state, now);
  const diff = weekTotal - sollWeek;

  const sortedToday = todayEntries.slice().sort((a, b) => a.from - b.from);
  const lastEntry = sortedToday.length ? sortedToday[sortedToday.length - 1] : null;

  const visible = state.cats.filter((c) => !state.hidden.includes(c.name));

  const todayByCat = (name) => {
    let m = sumMinutes(todayEntries.filter((e) => e.name === name));
    if (state.running && state.running.name === name) m += runMin;
    return m;
  };

  const startTimer = (name) => dispatch({ type: 'START_TIMER', name });
  const stopTimer = () => dispatch({ type: 'STOP_TIMER' });
  const discardTimer = () => dispatch({ type: 'DISCARD_TIMER' });
  const deleteEntry = (id) => dispatch({ type: 'DELETE_ENTRY', id });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '.09em', textTransform: 'uppercase', color: 'rgba(32,30,29,.5)', fontWeight: 700 }}>{longDateLabel()}</div>
          <h1 style={{ fontSize: 34, margin: '4px 0 0' }}>Heute</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 999, background: 'var(--color-accent-2-200)', fontSize: 12.5, fontWeight: 700, color: 'var(--color-accent-2-800)', whiteSpace: 'nowrap' }}>
          Woche {diff >= 0 ? '+' : '−'}{hm(Math.abs(diff))}
        </div>
      </div>

      <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 22, background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: '22px 24px' }}>
        <div style={{ width: 104, height: 104, borderRadius: 999, flex: 'none', display: 'grid', placeItems: 'center', background: `conic-gradient(var(--color-accent) ${Math.min(100, Math.round(((todayMin + runMin) / tagesSoll) * 100))}%, var(--color-neutral-300) 0)` }}>
          <div style={{ width: 80, height: 80, borderRadius: 999, background: 'var(--color-surface)', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 21, lineHeight: 1 }}>{hm(todayMin + runMin)}</div>
              <div style={{ fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'rgba(32,30,29,.5)', fontWeight: 700 }}>erfasst</div>
            </div>
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'rgba(32,30,29,.62)' }}>
            Tagesrichtwert <strong style={{ color: 'var(--color-text)' }}>{hm(tagesSoll)} h</strong> bei {Math.round(sollWeek / 60)} h Woche.
          </div>
          <div style={{ marginTop: 10, fontSize: 13.5, color: 'rgba(32,30,29,.62)' }}>
            {todayEntries.length} Einträge · zuletzt {lastEntry ? lastEntry.name : '—'}
          </div>
        </div>
      </div>

      {state.running && (
        <div style={{ marginTop: 14, borderRadius: 'var(--radius-lg)', padding: '20px 22px', background: 'var(--color-accent-800)', color: 'var(--color-accent-100)', display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 9, height: 9, borderRadius: 999, background: 'var(--color-accent-300)' }} />
              <div style={{ fontSize: 11, letterSpacing: '.09em', textTransform: 'uppercase', fontWeight: 700, opacity: .8 }}>läuft · {state.running.name}</div>
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 44, lineHeight: 1.1, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
              {runningClockLabel(state.running.startTs, now)}
            </div>
            <div style={{ fontSize: 12, opacity: .7, marginTop: 2 }}>gestartet {state.running.label}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" onClick={stopTimer} style={{ border: 0, cursor: 'pointer', padding: '13px 20px', borderRadius: 999, background: 'var(--color-accent-100)', color: 'var(--color-accent-800)', fontFamily: 'var(--font-heading)', fontSize: 14 }}>Speichern</button>
            <button type="button" onClick={discardTimer} style={{ border: '1px solid rgba(255,241,235,.35)', cursor: 'pointer', padding: '11px 20px', borderRadius: 999, background: 'transparent', color: 'var(--color-accent-200)', fontSize: 12.5 }}>Verwerfen</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '26px 0 12px' }}>
        <h4 style={{ margin: 0, fontSize: 18 }}>Schnell erfassen</h4>
        <span style={{ fontSize: 11.5, color: 'rgba(32,30,29,.5)' }}>tippen = Timer startet</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
        {visible.map((c) => {
          const t = todayByCat(c.name);
          return (
            <button
              key={c.id || c.name}
              type="button"
              disabled={!!state.running}
              onClick={() => startTimer(c.name)}
              style={{ cursor: state.running ? 'default' : 'pointer', opacity: state.running ? .5 : 1, border: '1px solid rgba(32,30,29,.1)', background: 'var(--color-neutral-100)', borderRadius: 24, padding: '14px 10px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}
            >
              <div style={{ width: 42, height: 42, borderRadius: 999, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-heading)', fontSize: 17, color: 'var(--color-bg)', background: c.color }}>{c.letter}</div>
              <div style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.25, textAlign: 'center', color: 'var(--color-text)' }}>{c.name}</div>
              <div style={{ fontSize: 10, color: 'rgba(32,30,29,.45)', fontWeight: 700, letterSpacing: '.04em' }}>{t ? hmShort(t) : '—'}</div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onOpenAdd}
        style={{ cursor: 'pointer', marginTop: 12, width: '100%', border: '1px dashed rgba(32,30,29,.3)', background: 'transparent', borderRadius: 999, padding: 14, fontFamily: 'var(--font-heading)', fontSize: 14.5, color: 'var(--color-accent-700)' }}
      >
        + Block nachtragen
      </button>

      <h4 style={{ margin: '28px 0 10px', fontSize: 18 }}>Tagesprotokoll</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sortedToday.slice().reverse().map((e) => {
          const c = findCategory(state.cats, e.name);
          return (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 13, background: 'var(--color-neutral-100)', borderRadius: 22, padding: '13px 16px' }}>
              <div style={{ width: 12, height: 12, borderRadius: 999, flex: 'none', background: c.color }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{e.name}</div>
                <div style={{ fontSize: 11.5, color: 'rgba(32,30,29,.5)' }}>{clock(e.from)} – {clock(e.from + e.min)} · {e.source}</div>
              </div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>{hmShort(e.min)}</div>
              <button type="button" onClick={() => deleteEntry(e.id)} style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'rgba(32,30,29,.35)', fontSize: 17, padding: '2px 4px', lineHeight: 1 }}>×</button>
            </div>
          );
        })}
        {!sortedToday.length && (
          <div style={{ fontSize: 13, color: 'rgba(32,30,29,.5)', padding: '12px 2px' }}>Noch keine Einträge heute.</div>
        )}
      </div>
    </div>
  );
}
