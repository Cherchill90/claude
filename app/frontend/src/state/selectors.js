import { findCategory } from '../lib/categories.js';
import { startOfWeek, todayISO, dateForOffset } from '../lib/time.js';

export function entriesForDate(state, dateISO) {
  return state.entries.filter((e) => e.date === dateISO);
}

export function sumMinutes(entries) {
  return entries.reduce((s, e) => s + e.min, 0);
}

export function runningMinutes(state, now = Date.now()) {
  return state.running ? (now - state.running.startTs) / 60000 : 0;
}

export function todayRunningMinutes(state, now = Date.now()) {
  if (!state.running) return 0;
  return state.running.startDate === todayISO() ? runningMinutes(state, now) : 0;
}

export function weekEntries(state, ref = new Date()) {
  const start = startOfWeek(ref);
  const startISO = todayISO(start);
  const end = dateForOffset(start, 6);
  const endISO = todayISO(end);
  return state.entries.filter((e) => e.date >= startISO && e.date <= endISO);
}

export function weekTotalMinutes(state, now = Date.now(), ref = new Date()) {
  const base = sumMinutes(weekEntries(state, ref));
  return base + todayRunningMinutes(state, now);
}

export function dailyTotalsForWeek(state, now = Date.now(), ref = new Date()) {
  const start = startOfWeek(ref);
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const d = dateForOffset(start, i);
    const iso = todayISO(d);
    let min = sumMinutes(entriesForDate(state, iso));
    if (iso === todayISO()) min += todayRunningMinutes(state, now);
    days.push({ date: iso, min, isToday: iso === todayISO() });
  }
  return days;
}

export function distributionForWeek(state, now = Date.now(), ref = new Date()) {
  const entries = weekEntries(state, ref);
  const byCat = new Map();
  for (const e of entries) {
    byCat.set(e.name, (byCat.get(e.name) || 0) + e.min);
  }
  if (state.running && state.running.startDate === todayISO()) {
    const rm = runningMinutes(state, now);
    byCat.set(state.running.name, (byCat.get(state.running.name) || 0) + rm);
  }
  const total = [...byCat.values()].reduce((a, b) => a + b, 0);
  const rows = [...byCat.entries()].map(([name, min]) => {
    const c = findCategory(state.cats, name);
    const pct = total > 0 ? Math.round((min / total) * 100) : 0;
    return { name, color: c.color, min, pct };
  });
  rows.sort((a, b) => b.pct - a.pct);
  return rows;
}

// One row per (date, category) with summed minutes — the exact shape that leaves the device.
export function aggregatedRows(state, entries) {
  const byKey = new Map();
  for (const e of entries) {
    const key = `${e.date}__${e.name}`;
    byKey.set(key, (byKey.get(key) || 0) + e.min);
  }
  return [...byKey.entries()]
    .map(([key, min]) => {
      const [date, name] = key.split('__');
      return { date, name, min };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name)));
}

export function todayByCategory(state, name, now = Date.now()) {
  const entries = entriesForDate(state, todayISO());
  let min = sumMinutes(entries.filter((e) => e.name === name));
  if (state.running && state.running.name === name && state.running.startDate === todayISO()) {
    min += runningMinutes(state, now);
  }
  return min;
}
