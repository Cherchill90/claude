import { useAppState, sollWeekMinutes, sollDayMinutes } from '../state/store.jsx';
import { hm, weekRangeLabel, weekdayLabels } from '../lib/time.js';
import { dailyTotalsForWeek, distributionForWeek, weekTotalMinutes } from '../state/selectors.js';

export default function Woche() {
  const state = useAppState();
  const sollWeek = sollWeekMinutes(state);
  const tagesSoll = sollDayMinutes(state);
  const weekTotal = weekTotalMinutes(state);
  const diff = weekTotal - sollWeek;
  const weekPct = Math.min(100, Math.round((weekTotal / sollWeek) * 100));

  const days = dailyTotalsForWeek(state);
  const labels = weekdayLabels();
  const maxDay = Math.max(...days.map((d) => d.min), tagesSoll) || 1;

  const dist = distributionForWeek(state);

  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '.09em', textTransform: 'uppercase', color: 'rgba(32,30,29,.5)', fontWeight: 700 }}>{weekRangeLabel()}</div>
      <h1 style={{ fontSize: 34, margin: '4px 0 0' }}>Woche</h1>

      <div style={{ marginTop: 20, background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: '22px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700, color: 'rgba(32,30,29,.5)' }}>Ist</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 38, lineHeight: 1.05 }}>{hm(weekTotal)} h</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 700, color: 'rgba(32,30,29,.5)' }}>Soll</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22, lineHeight: 1.4 }}>{Math.round(sollWeek / 60)}:00</div>
          </div>
        </div>
        <div style={{ marginTop: 14, height: 12, borderRadius: 999, background: 'var(--color-neutral-300)', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 999, background: 'var(--color-accent)', width: `${weekPct}%` }} />
        </div>
        <div style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 15px', borderRadius: 999, background: diff >= 0 ? 'var(--color-accent-200)' : 'var(--color-accent-2-200)', color: diff >= 0 ? 'var(--color-accent-800)' : 'var(--color-accent-2-800)', fontSize: 12.5, fontWeight: 700 }}>
          {diff >= 0 ? `${hm(diff)} h über dem Soll — dokumentiert` : `${hm(-diff)} h bis zum Soll dieser Woche`}
        </div>
      </div>

      <h4 style={{ margin: '26px 0 12px', fontSize: 18 }}>Verlauf</h4>
      <div style={{ background: 'var(--color-neutral-100)', borderRadius: 'var(--radius-lg)', padding: '20px 18px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9, height: 150 }}>
          {days.map((d, i) => (
            <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, height: '100%', justifyContent: 'flex-end' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(32,30,29,.45)', fontVariantNumeric: 'tabular-nums' }}>{d.min ? hm(d.min) : '·'}</div>
              <div style={{ width: '100%', borderRadius: '999px 999px 10px 10px', background: d.isToday ? 'var(--color-accent)' : d.min ? 'var(--color-accent-300)' : 'var(--color-neutral-300)', height: Math.round((d.min / maxDay) * 130) }} />
              <div style={{ fontSize: 11, fontWeight: 700, color: d.isToday ? 'var(--color-accent-800)' : 'rgba(32,30,29,.45)' }}>{labels[i]}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(32,30,29,.45)', textAlign: 'center' }}>gestrichelte Linie = Tagesrichtwert {hm(tagesSoll)} h</div>
      </div>

      <h4 style={{ margin: '26px 0 12px', fontSize: 18 }}>Verteilung</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {dist.map((d) => (
          <div key={d.name}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{d.name}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'rgba(32,30,29,.6)' }}>{hm(d.min)} h · {d.pct} %</span>
            </div>
            <div style={{ marginTop: 5, height: 9, borderRadius: 999, background: 'var(--color-neutral-200)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 999, background: d.color, width: `${d.pct}%` }} />
            </div>
          </div>
        ))}
        {!dist.length && (
          <div style={{ fontSize: 13, color: 'rgba(32,30,29,.5)' }}>Noch keine Einträge diese Woche.</div>
        )}
      </div>
    </div>
  );
}
