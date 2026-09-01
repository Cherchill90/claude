// Sends only anonymized, per-day-per-category minute totals — never raw timestamps
// or entry-level detail. Matches the "Das verlässt dein Handy" consent list.
export async function syncDay({ pseudonym, date, deputat, rows }) {
  const res = await fetch('/api/sync', {
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
