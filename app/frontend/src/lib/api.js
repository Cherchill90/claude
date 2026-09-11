// In the browser (web/PWA), a relative URL works via same-origin or the dev
// proxy. In the native iOS shell (Capacitor), the WebView's origin is
// capacitor://localhost — there's no backend there, so a real absolute URL
// must be baked in at build time via VITE_API_BASE_URL.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// Sends only anonymized, per-day-per-category minute totals — never raw timestamps
// or entry-level detail. Matches the "Das verlässt dein Handy" consent list.
export async function syncDay({ pseudonym, date, deputat, rows }) {
  const res = await fetch(`${API_BASE}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pseudonym, date, deputat, rows }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Sync fehlgeschlagen (${res.status})`);
  }
  return res.json();
}
