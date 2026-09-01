import { useRef, useState } from 'react';
import { useAppState, useAppDispatch } from '../state/store.jsx';
import { findCategory } from '../lib/categories.js';
import { clock, hm, hmShort, longDateLabel, minutesSinceMidnight, todayISO } from '../lib/time.js';
import { entriesForDate, sumMinutes } from '../state/selectors.js';

const H0 = 0;
const H1 = 24;
const BAND = 720;
const PXPM = BAND / ((H1 - H0) * 60);
const pxm = (m) => (m - H0 * 60) * PXPM;

const HOUR_LABELS = Array.from({ length: 13 }, (_, i) => ({ label: `${i * 2}`, top: Math.round(pxm(i * 120)) - 6 }));
const GRID_LINES = Array.from({ length: 25 }, (_, i) => ({
  top: Math.round(pxm(i * 60)),
  color: i % 2 ? 'rgba(32,30,29,.05)' : 'rgba(32,30,29,.1)',
}));
const NIGHT_BLOCKS = [
  { top: 0, height: Math.round(pxm(6 * 60)) },
  { top: Math.round(pxm(22 * 60)), height: BAND - Math.round(pxm(22 * 60)) },
];

function biggestGap(sorted) {
  let gap = null;
  for (let i = 1; i < sorted.length; i += 1) {
    const len = sorted[i].from - (sorted[i - 1].from + sorted[i - 1].min);
    if (len > 0 && (!gap || len > gap.len)) gap = { from: sorted[i - 1].from + sorted[i - 1].min, len };
  }
  return gap;
}

export default function Tagesband({ onOpenAdd }) {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [sel, setSel] = useState(null);
  const drag = useRef(null);

  const iso = todayISO();
  const todayEntries = entriesForDate(state, iso);
  const sorted = todayEntries.slice().sort((a, b) => a.from - b.from);
  const total = sumMinutes(todayEntries);

  const gap = biggestGap(sorted);
  const selectedEntry = sorted.find((e) => e.id === sel);

  const defaultCat = (state.cats.find((c) => c.name === 'Verwaltung') || state.cats[0])?.name || '';

  const hint = selectedEntry
    ? `${selectedEntry.name} · ${clock(selectedEntry.from)} — hoch/runter ziehen zum Verschieben.`
    : gap && gap.len >= 15
      ? `Größte Lücke: ${clock(gap.from)} – ${clock(gap.from + gap.len)}. Vor- und Nachbereitung?`
      : 'Keine offene Lücke — Block antippen und ziehen zum Verschieben.';

  const fillGap = () => {
    const g = gap || { from: Math.max(0, Math.round(minutesSinceMidnight(new Date()) / 15) * 15 - 60), len: 60 };
    onOpenAdd({ cat: defaultCat, min: Math.min(180, Math.round(g.len / 15) * 15) || 15, from: g.from });
  };

  let cursor = -99;
  const blocks = sorted.map((e) => {
    const c = findCategory(state.cats, e.name);
    const top = Math.round(pxm(e.from));
    const height = Math.max(8, Math.round(pxm(e.from + e.min) - pxm(e.from)));
    const labelTop = Math.max(top, cursor + 6);
    cursor = labelTop + 30;
    const selected = sel === e.id;
    return {
      entry: e,
      color: c.color,
      top,
      height,
      labelTop,
      bg: selected ? c.color : `color-mix(in srgb, ${c.color} 22%, #f9f4ed)`,
      border: selected ? '1px solid transparent' : `1px solid color-mix(in srgb, ${c.color} 45%, transparent)`,
      fg: selected ? '#f9f4ed' : '#201e1d',
      subFg: selected ? 'rgba(249,244,237,.75)' : 'rgba(32,30,29,.5)',
      grip: selected ? 'rgba(249,244,237,.6)' : 'rgba(32,30,29,.3)',
    };
  });

  const onDown = (e, entry) => (ev) => {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drag.current = { id: entry.id, y0: ev.clientY, from0: entry.from };
    setSel(entry.id);
  };
  const onMove = (entry) => (ev) => {
    const d = drag.current;
    if (!d || d.id !== entry.id) return;
    const deltaMin = (ev.clientY - d.y0) / PXPM;
    dispatch({ type: 'MOVE_ENTRY_START', id: entry.id, from: Math.round((d.from0 + deltaMin) / 5) * 5 });
  };
  const onUp = () => { drag.current = null; };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '.09em', textTransform: 'uppercase', color: 'rgba(32,30,29,.5)', fontWeight: 700 }}>{longDateLabel()}</div>
          <h1 style={{ fontSize: 32, margin: '4px 0 0' }}>Tagesband</h1>
          <div style={{ fontSize: 11.5, color: 'rgba(32,30,29,.5)', marginTop: 3 }}>0 – 24 Uhr · Griff ziehen verschiebt</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 26, lineHeight: 1 }}>{hm(total)} h</div>
          <div style={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 700, color: 'rgba(32,30,29,.45)' }}>erfasst</div>
        </div>
      </div>

      <div style={{ marginTop: 18, display: 'flex', gap: 10, height: BAND }}>
        <div style={{ width: 26, position: 'relative', flex: 'none' }}>
          {HOUR_LABELS.map((h) => (
            <div key={h.label} style={{ position: 'absolute', left: 0, top: h.top, fontSize: 10.5, fontWeight: 700, color: 'rgba(32,30,29,.4)', fontVariantNumeric: 'tabular-nums' }}>{h.label}</div>
          ))}
        </div>
        <div style={{ flex: 1, position: 'relative', borderRadius: 24, background: 'var(--color-neutral-100)', overflow: 'hidden', touchAction: 'none' }}>
          {NIGHT_BLOCKS.map((n, i) => (
            <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: n.top, height: n.height, background: 'var(--color-neutral-200)' }} />
          ))}
          {GRID_LINES.map((l, i) => (
            <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: l.top, height: 1, background: l.color }} />
          ))}
          {blocks.map((b) => (
            <div key={`bar-${b.entry.id}`} style={{ position: 'absolute', left: 10, width: 14, top: b.top, height: b.height, borderRadius: 999, background: b.color }} />
          ))}
          {blocks.map((b) => (
            <div
              key={`label-${b.entry.id}`}
              onPointerDown={onDown(b, b.entry)}
              onPointerMove={onMove(b.entry)}
              onPointerUp={onUp}
              style={{ position: 'absolute', left: 32, right: 10, top: b.labelTop, height: 30, borderRadius: 15, background: b.bg, border: b.border, cursor: 'grab', padding: '0 11px 0 13px', display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', touchAction: 'none' }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 700, color: b.fg, lineHeight: 1, whiteSpace: 'nowrap' }}>{b.entry.name}</div>
              <div style={{ flex: 1, fontSize: 10.5, color: b.subFg, lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {clock(b.entry.from)} – {clock(b.entry.from + b.entry.min)} · {hmShort(b.entry.min)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 'none' }}>
                <div style={{ width: 14, height: 1.5, borderRadius: 999, background: b.grip }} />
                <div style={{ width: 14, height: 1.5, borderRadius: 999, background: b.grip }} />
                <div style={{ width: 14, height: 1.5, borderRadius: 999, background: b.grip }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, background: 'var(--color-surface)', borderRadius: 26, padding: '15px 18px' }}>
        <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4, color: 'rgba(32,30,29,.7)' }}>{hint}</div>
        <button type="button" onClick={fillGap} style={{ cursor: 'pointer', border: 0, background: 'var(--color-accent)', color: 'var(--color-bg)', borderRadius: 999, padding: '12px 18px', fontFamily: 'var(--font-heading)', fontSize: 13.5, whiteSpace: 'nowrap' }}>
          Lücke füllen
        </button>
      </div>
    </div>
  );
}
