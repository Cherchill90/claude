import { useAppState, useAppDispatch, useSollStunden } from '../state/store.jsx';
import { hm } from '../lib/time.js';

const OB_POINTS = [
  'Live-Timer für laufende Tätigkeiten — oder abends in Blöcken nachtragen.',
  'Soll-Ist gegen 25,5 Deputatsstunden bzw. 40 Zeitstunden.',
  'Anonymisierte Minuten fließen in die Erhebung des Kollegiums.',
];

const CONSENT_ROWS = [
  { name: 'Minuten pro Kategorie pro Tag', mark: '✓', color: '#728157', bg: 'var(--color-accent-2-200)' },
  { name: 'Stundenmaß in Prozent', mark: '✓', color: '#728157', bg: 'var(--color-accent-2-200)' },
  { name: 'Name, Fächer, Uhrzeiten, Notizen', mark: '×', color: '#a19786', bg: 'var(--color-neutral-200)' },
];

const DEPUTAT_STEPS = [100, 75, 50, 25];

export default function Onboarding() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const sollStunden = useSollStunden();
  const { ob, consent, deputat } = state;

  const cta = ob === 3 ? 'Los geht’s' : ob === 2 ? 'Einverstanden, weiter' : 'Weiter';
  const onNext = () => (ob === 3 ? dispatch({ type: 'COMPLETE_ONBOARDING' }) : dispatch({ type: 'SET_OB_STEP', step: ob + 1 }));
  const onSkip = () => dispatch({ type: 'COMPLETE_ONBOARDING' });

  return (
    <div className="onboard-overlay">
      <div style={{ display: 'flex', gap: 6 }}>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            style={{ flex: 1, height: 5, borderRadius: 999, background: i <= ob ? 'var(--color-accent)' : 'var(--color-neutral-300)' }}
          />
        ))}
      </div>

      {ob === 1 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ width: 82, height: 82, borderRadius: 999, background: 'var(--color-accent)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-heading)', fontSize: 34, color: 'var(--color-bg)' }}>Z</div>
          <h1 style={{ fontSize: 40, margin: '26px 0 0', lineHeight: 1.05 }}>Zeitwaage</h1>
          <p style={{ fontSize: 16, lineHeight: 1.55, color: 'rgba(32,30,29,.68)', marginTop: 14 }}>
            Arbeitszeit in Sekunden erfasst statt in Formularen. Ein Tipp startet, ein Tipp speichert — der Rest passiert im Hintergrund.
          </p>
          <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {OB_POINTS.map((text) => (
              <div key={text} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                <div style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--color-accent-2-600)', marginTop: 7, flex: 'none' }} />
                <div style={{ fontSize: 14, lineHeight: 1.45, color: 'rgba(32,30,29,.75)' }}>{text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {ob === 2 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <h1 style={{ fontSize: 32, margin: 0, lineHeight: 1.1 }}>Was gesendet wird</h1>
          <p style={{ fontSize: 14.5, lineHeight: 1.55, color: 'rgba(32,30,29,.68)', marginTop: 10 }}>
            Für die schulweite Erhebung verlassen ausschließlich <strong>Minuten pro Kategorie pro Tag</strong> dein Handy — unter einem Pseudonym.
          </p>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 9 }}>
            {CONSENT_ROWS.map((c) => (
              <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 12, background: c.bg, borderRadius: 20, padding: '13px 15px' }}>
                <div style={{ width: 24, height: 24, borderRadius: 999, flex: 'none', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, color: 'var(--color-bg)', background: c.color }}>{c.mark}</div>
                <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.35 }}>{c.name}</div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => dispatch({ type: 'TOGGLE_CONSENT' })}
            style={{
              marginTop: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
              border: `1px solid ${consent ? 'var(--color-accent-400)' : 'rgba(32,30,29,.14)'}`,
              background: consent ? 'var(--color-accent-100)' : 'var(--color-neutral-100)',
              borderRadius: 20, padding: '14px 15px', textAlign: 'left', font: 'inherit',
            }}
          >
            <div style={{ width: 24, height: 24, borderRadius: 8, flex: 'none', display: 'grid', placeItems: 'center', background: consent ? 'var(--color-accent)' : 'var(--color-neutral-400)', color: 'var(--color-bg)', fontSize: 14, fontWeight: 700 }}>
              {consent ? '✓' : ''}
            </div>
            <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4, color: 'var(--color-text)' }}>
              Ich stimme der anonymisierten Übermittlung zu. Widerruf jederzeit im Datenraum.
            </div>
          </button>
        </div>
      )}

      {ob === 3 && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <h1 style={{ fontSize: 32, margin: 0, lineHeight: 1.1 }}>Dein Stundenmaß</h1>
          <p style={{ fontSize: 14.5, lineHeight: 1.55, color: 'rgba(32,30,29,.68)', marginTop: 10 }}>
            Daraus berechnet die App deinen Soll-Ist-Vergleich. 25,5 Deputatsstunden entsprechen 40 Zeitstunden pro Woche.
          </p>
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 9 }}>
            {DEPUTAT_STEPS.map((p) => {
              const on = deputat === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => dispatch({ type: 'SET_DEPUTAT', percent: p })}
                  style={{
                    cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14,
                    border: `1px solid ${on ? 'var(--color-accent-400)' : 'rgba(32,30,29,.14)'}`,
                    background: on ? 'var(--color-accent-200)' : 'var(--color-neutral-100)',
                    borderRadius: 22, padding: '15px 18px', font: 'inherit',
                  }}
                >
                  <div style={{ width: 20, height: 20, borderRadius: 999, border: `2px solid ${on ? 'var(--color-accent)' : 'rgba(32,30,29,.28)'}`, background: on ? 'var(--color-accent)' : 'transparent', flex: 'none' }} />
                  <div style={{ flex: 1, fontFamily: 'var(--font-heading)', fontSize: 16, color: 'var(--color-text)' }}>{p} %</div>
                  <div style={{ fontSize: 12.5, color: 'rgba(32,30,29,.55)' }}>{hm(Math.round((sollStunden * p) / 100 * 60)).replace(':00', '')} h / Woche</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" onClick={onSkip} style={{ border: 0, background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'rgba(32,30,29,.5)', padding: '8px 4px', font: 'inherit' }}>
          überspringen
        </button>
        <button
          type="button"
          onClick={onNext}
          style={{ flex: 1, cursor: 'pointer', border: 0, background: 'var(--color-accent)', color: 'var(--color-bg)', borderRadius: 999, padding: 16, fontFamily: 'var(--font-heading)', fontSize: 15.5 }}
        >
          {cta}
        </button>
      </div>
    </div>
  );
}
