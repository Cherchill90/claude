import { useState } from 'react';
import { fmt } from './grades.js';
import { fmtDate } from './ui.jsx';

/** Notenspiegel als horizontale Balken (eine Serie): Anzahl im Balken, Anteil daneben. */
export function Notenspiegel({ spiegel, avg, decimals = 2, title = 'Notenspiegel' }) {
  const [hover, setHover] = useState(null);
  const total = spiegel.reduce((a, s) => a + s.count, 0);
  const max = Math.max(1, ...spiegel.map((s) => s.count));
  return (
    <figure className="chart spiegel" aria-label={title}>
      <div className="avg-big">Ø {fmt(avg, decimals)}</div>
      {spiegel.map((s, i) => (
        <div
          key={s.grade}
          className={'sp-row' + (hover === i ? ' hover' : '')}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
          title={`Note ${s.grade}: ${s.count} von ${total}`}
        >
          <span className="sp-label">{s.grade}</span>
          <span className="sp-track">
            {s.count > 0 && (
              <span className="sp-bar" style={{ width: `${Math.max(4, (s.count / max) * 100)}%` }}>{s.count}</span>
            )}
          </span>
          <span className="sp-pct">{s.count > 0 && total ? `${Math.round((s.count / total) * 100)} %` : ''}</span>
        </div>
      ))}
      <figcaption className="muted">{title} · {total} Noten</figcaption>
    </figure>
  );
}

/**
 * Leistungsverlauf: eine Linie je Bereich (Farbe = feste Bereichsfarbe), Legende + Direktbeschriftung
 * über die Legende, Hover-Tooltip je Punkt. Bei Noten 1–6 liegt „besser“ oben.
 */
export function Verlauf({ series, system }) {
  const [hover, setHover] = useState(null);
  const all = series.flatMap((s) => s.points);
  if (!all.length) return <p className="muted">Noch keine Noten vorhanden.</p>;
  const W = 640;
  const H = 220;
  const pad = { l: 30, r: 14, t: 12, b: 22 };
  const [lo, hi] = system === 'punkte' ? [0, 15] : [1, 6];
  const y = (v) => {
    const t = (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo);
    return pad.t + (system === 'punkte' ? 1 - t : t) * (H - pad.t - pad.b);
  };
  const times = all.map((p) => new Date((p.arbeit.date || '2000-01-01') + 'T00:00').getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const x = (p) => {
    const t = new Date((p.arbeit.date || '2000-01-01') + 'T00:00').getTime();
    return pad.l + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  };
  const ticks = system === 'punkte' ? [0, 3, 6, 9, 12, 15] : [1, 2, 3, 4, 5, 6];
  const hp = hover && series[hover[0]].points[hover[1]];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Leistungsverlauf">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 8} y={y(t) + 4} className="tick" textAnchor="end">{t}</text>
          </g>
        ))}
        {series.map((s, si) => (
          <g key={s.id}>
            {s.points.length > 1 && (
              <path
                d={s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p)},${y(p.value)}`).join(' ')}
                className="line" style={{ stroke: s.color }}
              />
            )}
            {s.points.map((p, i) => (
              <g key={i} onMouseEnter={() => setHover([si, i])} onMouseLeave={() => setHover(null)}>
                <circle cx={x(p)} cy={y(p.value)} r="12" fill="transparent" />
                <circle cx={x(p)} cy={y(p.value)} r={hover && hover[0] === si && hover[1] === i ? 6 : 4} className="dot" style={{ fill: s.color }} />
              </g>
            ))}
          </g>
        ))}
      </svg>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.id}><i style={{ background: s.color }} />{s.name}</span>
          ))}
        </div>
      )}
      {hp && (
        <div className="tooltip">
          {series[hover[0]].name} · {hp.arbeit.title}{hp.arbeit.mitDatum && hp.arbeit.date ? ` (${fmtDate(hp.arbeit.date)})` : ''}: <b>{hp.grade}</b>
        </div>
      )}
    </figure>
  );
}
