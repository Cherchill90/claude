// Minutes-since-midnight helpers, matching the design's clock/hm/hmShort formatting.

export const clock = (m) => {
  const total = Math.round(((m % 1440) + 1440) % 1440);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

// Rounds to whole minutes first, then splits h/m — rounding each part separately
// can carry a remainder to 60 (e.g. "29:60" instead of "30:00").
export const hm = (m) => {
  const sign = m < 0 ? '−' : '';
  const total = Math.round(Math.abs(m));
  return `${sign}${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export const hmShort = (m) => {
  const total = Math.round(Math.abs(m));
  return total >= 60 ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} h` : `${total} Min`;
};

export const todayISO = (d = new Date()) => {
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
};

export const minutesSinceMidnight = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
];
const WEEKDAY_LONG = [
  'Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag',
];

export function startOfWeek(d = new Date()) {
  const day = (d.getDay() + 6) % 7; // Monday = 0
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return start;
}

export function isoWeekNumber(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = date - firstThursday;
  return 1 + Math.round(diff / (7 * 86400000));
}

export function weekRangeLabel(d = new Date()) {
  const start = startOfWeek(d);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const kw = isoWeekNumber(d);
  const fmt = (dt) => `${dt.getDate()}. ${MONTH_LABELS[dt.getMonth()]}`;
  return `KW ${kw} · ${fmt(start)} – ${fmt(end)}`;
}

export function longDateLabel(d = new Date()) {
  return `${WEEKDAY_LONG[d.getDay()]}, ${d.getDate()}. ${MONTH_LABELS[d.getMonth()]}${MONTH_LABELS[d.getMonth()] === 'Mai' ? '' : ''}`.replace('Mär', 'März');
}

export function weekdayLabels() {
  return WEEKDAY_LABELS;
}

export function dateForOffset(startDate, offsetDays) {
  const d = new Date(startDate);
  d.setDate(d.getDate() + offsetDays);
  return d;
}
