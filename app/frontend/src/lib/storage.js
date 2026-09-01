const STORAGE_KEY = 'zeitwaage:v1';

function randomHex(n) {
  const bytes = new Uint8Array(n);
  (window.crypto || {}).getRandomValues?.(bytes);
  return Array.from(bytes, (b) => (b % 16).toString(16).toUpperCase()).join('');
}

export function newPseudonym() {
  return `LK-${randomHex(4)}`;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable (private mode, quota) — app still works for this session
  }
}
