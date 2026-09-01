import { useState } from 'react';
import { useAppState, useAppDispatch, useSollStunden } from '../state/store.jsx';
import { hm } from '../lib/time.js';
import { MAX_CATEGORIES, PALETTE } from '../lib/categories.js';
import { sumMinutes, weekEntries } from '../state/selectors.js';

const DEPUTAT_STEPS = [100, 75, 50, 25];

const MEHR_LINKS = [
  'Eigener Export (Excel, PDF)',
  'Erinnerung am Abend · 20:30',
  'Erhebung & Datenschutzerklärung',
];

export default function Mehr() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const sollStunden = useSollStunden();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PALETTE[PALETTE.length - 1]);

  const weekMinByCat = (name) => sumMinutes(weekEntries(state).filter((e) => e.name === name));

  const atMax = state.cats.length >= MAX_CATEGORIES;
  const trimmed = newName.trim();
  const nameTaken = state.cats.some((c) => c.name === trimmed);
  const addDisabled = atMax || !trimmed || nameTaken;

  const addCategory = () => {
    if (addDisabled) return;
    dispatch({ type: 'ADD_CATEGORY', name: trimmed, color: newColor });
    setNewName('');
  };

  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '.09em', textTransform: 'uppercase', color: 'rgba(32,30,29,.5)', fontWeight: 700 }}>Konto {state.pseudonym}</div>
      <h1 style={{ fontSize: 34, margin: '4px 0 0' }}>Mehr</h1>

      <div style={{ marginTop: 20, background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: '20px 22px' }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 18 }}>Mein Deputat</div>
        <div style={{ fontSize: 12.5, color: 'rgba(32,30,29,.6)', marginTop: 3 }}>Hessen · Vollzeit = 25,5 Deputatsstunden = 40 Zeitstunden</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {DEPUTAT_STEPS.map((p) => {
            const on = state.deputat === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => dispatch({ type: 'SET_DEPUTAT', percent: p })}
                style={{ flex: 1, cursor: 'pointer', border: `1px solid ${on ? 'var(--color-accent-400)' : 'rgba(32,30,29,.14)'}`, background: on ? 'var(--color-accent-200)' : 'var(--color-neutral-100)', color: on ? 'var(--color-accent-800)' : 'var(--color-text)', borderRadius: 999, padding: '11px 4px', fontFamily: 'var(--font-heading)', fontSize: 13 }}
              >
                {p} %
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '26px 0 4px' }}>
        <h4 style={{ margin: 0, fontSize: 18 }}>Kategorien</h4>
        <span style={{ fontSize: 11.5, color: 'rgba(32,30,29,.5)' }}>{state.cats.length} von {MAX_CATEGORIES} Kategorien</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'rgba(32,30,29,.5)', marginBottom: 10 }}>Reihenfolge bestimmt die Kacheln auf „Heute“ · tippen schaltet sichtbar</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {state.cats.map((c, i) => {
          const on = !state.hidden.includes(c.name);
          return (
            <div key={c.id || c.name} style={{ border: `1px solid ${on ? 'rgba(32,30,29,.1)' : 'rgba(32,30,29,.14)'}`, background: on ? 'var(--color-neutral-100)' : 'transparent', borderRadius: 22, padding: '10px 12px 10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={() => dispatch({ type: 'TOGGLE_CATEGORY_VISIBLE', name: c.name })}
                style={{ flex: 1, minWidth: 0, cursor: 'pointer', textAlign: 'left', border: 0, background: 'transparent', display: 'flex', alignItems: 'center', gap: 13, padding: 0 }}
              >
                <div style={{ width: 30, height: 30, borderRadius: 999, flex: 'none', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-heading)', fontSize: 14, color: 'var(--color-bg)', background: c.color }}>{c.letter}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                  <div style={{ fontSize: 11.5, color: 'rgba(32,30,29,.5)' }}>{hm(weekMinByCat(c.name))} h · {on ? 'sichtbar' : 'aus'}</div>
                </div>
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 'none' }}>
                <button type="button" disabled={i === 0} onClick={() => dispatch({ type: 'MOVE_CATEGORY', index: i, direction: -1 })} style={{ cursor: i === 0 ? 'default' : 'pointer', border: 0, background: 'transparent', width: 30, height: 30, borderRadius: 999, fontSize: 14, lineHeight: 1, color: i === 0 ? 'rgba(32,30,29,.18)' : 'rgba(32,30,29,.55)' }}>▲</button>
                <button type="button" disabled={i === state.cats.length - 1} onClick={() => dispatch({ type: 'MOVE_CATEGORY', index: i, direction: 1 })} style={{ cursor: i === state.cats.length - 1 ? 'default' : 'pointer', border: 0, background: 'transparent', width: 30, height: 30, borderRadius: 999, fontSize: 14, lineHeight: 1, color: i === state.cats.length - 1 ? 'rgba(32,30,29,.18)' : 'rgba(32,30,29,.55)' }}>▼</button>
                <button type="button" onClick={() => dispatch({ type: 'DELETE_CATEGORY', name: c.name })} style={{ cursor: 'pointer', border: 0, background: 'transparent', width: 30, height: 30, borderRadius: 999, fontSize: 17, lineHeight: 1, color: 'rgba(32,30,29,.35)' }}>×</button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, background: 'var(--color-surface)', borderRadius: 26, padding: 18 }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 17 }}>Neue Kategorie</div>
        <div style={{ fontSize: 12, color: 'rgba(32,30,29,.6)', marginTop: 2 }}>
          {atMax ? 'Maximum erreicht — erst eine Kategorie löschen.' : 'Eigene Kategorie anlegen, Farbe wählen.'}
        </div>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="z. B. Klassenleitung"
          disabled={atMax}
          style={{ marginTop: 12, width: '100%', border: '1px solid rgba(32,30,29,.16)', background: 'var(--color-neutral-100)', borderRadius: 999, padding: '13px 18px', fontSize: 14, color: 'var(--color-text)' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setNewColor(color)}
              style={{ cursor: 'pointer', width: 32, height: 32, borderRadius: 999, background: color, border: newColor === color ? '3px solid var(--color-text)' : '3px solid transparent', padding: 0 }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={addCategory}
          disabled={addDisabled}
          style={{ cursor: addDisabled ? 'default' : 'pointer', marginTop: 14, width: '100%', border: 0, background: addDisabled ? 'var(--color-neutral-300)' : 'var(--color-accent)', color: addDisabled ? 'rgba(32,30,29,.45)' : 'var(--color-bg)', borderRadius: 999, padding: 14, fontFamily: 'var(--font-heading)', fontSize: 14.5 }}
        >
          Kategorie hinzufügen
        </button>
      </div>

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {MEHR_LINKS.map((label) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--color-neutral-100)', borderRadius: 22, padding: '14px 16px', fontSize: 14 }}>
            <div style={{ flex: 1 }}>{label}</div>
            <div style={{ color: 'rgba(32,30,29,.35)', fontSize: 16 }}>›</div>
          </div>
        ))}
      </div>
    </div>
  );
}
