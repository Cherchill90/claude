import { useAppState } from '../state/store.jsx';
import { clock, hmShort, longDateLabel } from '../lib/time.js';

const FROM_PRESETS = [
  ['Vor dem Unterricht', 420],
  ['Mittag', 780],
  ['Nachmittag', 900],
  ['Abend', 1140],
];

function pillStyle(on) {
  return {
    background: on ? 'var(--color-accent-200)' : 'var(--color-neutral-100)',
    border: `1px solid ${on ? 'var(--color-accent-400)' : 'rgba(32,30,29,.14)'}`,
    color: on ? 'var(--color-accent-800)' : 'var(--color-text)',
  };
}

export default function AddSheet({ value, onChange, onClose, onSave }) {
  const state = useAppState();
  const { cat, min, from } = value;

  const set = (patch) => onChange({ ...value, ...patch });
  const setFrom = (v) => set({ from: Math.max(0, Math.min(1439 - min, v)) });
  const setMin = (v) => set({ min: Math.max(15, Math.min(480, v)) });

  return (
    <div className="sheet-backdrop">
      <div className="sheet-panel">
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 23 }}>Block nachtragen</h3>
          <button type="button" onClick={onClose} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 22, color: 'rgba(32,30,29,.4)', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, color: 'rgba(32,30,29,.55)', marginTop: 2 }}>{longDateLabel()}</div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
          {state.cats.map((c) => {
            const on = cat === c.name;
            return (
              <button key={c.id || c.name} type="button" onClick={() => set({ cat: c.name })} style={{ cursor: 'pointer', borderRadius: 999, padding: '9px 15px', fontSize: 12.5, fontWeight: 600, ...pillStyle(on) }}>
                {c.name}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 20, background: 'var(--color-neutral-100)', borderRadius: 26, padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
            <div>
              <div style={{ fontSize: 10.5, letterSpacing: '.07em', textTransform: 'uppercase', fontWeight: 700, color: 'rgba(32,30,29,.45)' }}>Beginn</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 30, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{clock(from)}</div>
              <div style={{ fontSize: 11.5, color: 'rgba(32,30,29,.5)' }}>endet {clock(from + min)}</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setFrom(from - 15)} style={{ cursor: 'pointer', border: '1px solid rgba(32,30,29,.15)', background: 'var(--color-bg)', width: 46, height: 46, borderRadius: 999, fontSize: 20, lineHeight: 1, fontFamily: 'var(--font-heading)', color: 'var(--color-text)' }}>−</button>
              <button type="button" onClick={() => setFrom(from + 15)} style={{ cursor: 'pointer', border: '1px solid rgba(32,30,29,.15)', background: 'var(--color-bg)', width: 46, height: 46, borderRadius: 999, fontSize: 20, lineHeight: 1, fontFamily: 'var(--font-heading)', color: 'var(--color-text)' }}>+</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 14 }}>
            {FROM_PRESETS.map(([label, m]) => {
              const on = Math.abs(from - m) < 8;
              return (
                <button key={label} type="button" onClick={() => setFrom(m)} style={{ cursor: 'pointer', borderRadius: 999, padding: '8px 13px', fontSize: 11.5, fontWeight: 600, ...pillStyle(on) }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
          <button type="button" onClick={() => setMin(min - 15)} style={{ cursor: 'pointer', border: '1px solid rgba(32,30,29,.15)', background: 'var(--color-neutral-100)', width: 52, height: 52, borderRadius: 999, fontSize: 24, lineHeight: 1, fontFamily: 'var(--font-heading)', color: 'var(--color-text)' }}>−</button>
          <div style={{ textAlign: 'center', minWidth: 118 }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 40, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{hmShort(min)}</div>
            <div style={{ fontSize: 10.5, letterSpacing: '.07em', textTransform: 'uppercase', fontWeight: 700, color: 'rgba(32,30,29,.45)', marginTop: 4 }}>Dauer · 15-Min-Schritte</div>
          </div>
          <button type="button" onClick={() => setMin(min + 15)} style={{ cursor: 'pointer', border: '1px solid rgba(32,30,29,.15)', background: 'var(--color-neutral-100)', width: 52, height: 52, borderRadius: 999, fontSize: 24, lineHeight: 1, fontFamily: 'var(--font-heading)', color: 'var(--color-text)' }}>+</button>
        </div>

        <button
          type="button"
          onClick={onSave}
          disabled={!cat}
          style={{ cursor: cat ? 'pointer' : 'default', marginTop: 24, width: '100%', border: 0, background: 'var(--color-accent)', color: 'var(--color-bg)', borderRadius: 999, padding: 16, fontFamily: 'var(--font-heading)', fontSize: 15.5 }}
        >
          {cat || 'Kategorie wählen'} eintragen
        </button>
      </div>
    </div>
  );
}
