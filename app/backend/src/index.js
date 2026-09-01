import express from 'express';
import cors from 'cors';
import { upsertRows, distinctParticipantCount } from './spreadsheet.js';

const PORT = process.env.PORT || 8787;
const K_ANONYMITY_THRESHOLD = 5;

const PSEUDONYM_RE = /^LK-[0-9A-F]{4}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_DEPUTAT = [100, 75, 50, 25];

const app = express();
app.use(cors());
app.use(express.json({ limit: '64kb' }));

function validateSyncPayload(body) {
  if (!body || typeof body !== 'object') return 'Ungültige Anfrage.';
  const { pseudonym, date, deputat, rows } = body;
  if (typeof pseudonym !== 'string' || !PSEUDONYM_RE.test(pseudonym)) return 'Ungültiges Pseudonym.';
  if (typeof date !== 'string' || !DATE_RE.test(date)) return 'Ungültiges Datum.';
  if (!ALLOWED_DEPUTAT.includes(deputat)) return 'Ungültiges Stundenmaß.';
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 9) return 'Ungültige Zeilen.';
  for (const row of rows) {
    if (!row || typeof row.category !== 'string' || !row.category.trim() || row.category.length > 60) {
      return 'Ungültige Kategorie.';
    }
    if (typeof row.minutes !== 'number' || !Number.isFinite(row.minutes) || row.minutes <= 0 || row.minutes > 1440) {
      return 'Ungültige Minutenanzahl.';
    }
  }
  return null;
}

app.post('/api/sync', async (req, res) => {
  const error = validateSyncPayload(req.body);
  if (error) return res.status(400).json({ error });

  const { pseudonym, date, deputat, rows } = req.body;
  try {
    const result = await upsertRows({ pseudonym, date, deputat, rows });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('sync failed', err);
    res.status(500).json({ error: 'Sync fehlgeschlagen.' });
  }
});

app.get('/api/stats', async (_req, res) => {
  try {
    const participants = await distinctParticipantCount();
    res.json({
      participants,
      threshold: K_ANONYMITY_THRESHOLD,
      released: participants >= K_ANONYMITY_THRESHOLD,
    });
  } catch (err) {
    console.error('stats failed', err);
    res.status(500).json({ error: 'Statistik nicht verfügbar.' });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Zeitwaage sync server listening on :${PORT}`);
});
