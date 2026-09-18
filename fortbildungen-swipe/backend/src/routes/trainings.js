import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

export const trainingsRouter = Router();
trainingsRouter.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function serializeTraining(row, extra = {}) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    date: row.date,
    time: row.time,
    organizerId: row.organizer_id,
    organizerName: row.organizer_name,
    createdAt: row.created_at,
    ...extra,
  };
}

trainingsRouter.post('/', (req, res) => {
  const title = (req.body?.title || '').trim();
  const description = (req.body?.description || '').trim();
  const location = (req.body?.location || '').trim();
  const date = (req.body?.date || '').trim();
  const time = (req.body?.time || '').trim();

  if (title.length < 2) {
    return res.status(400).json({ error: 'Titel muss mindestens 2 Zeichen haben.' });
  }
  if (!DATE_RE.test(date)) {
    return res.status(400).json({ error: 'Bitte ein gültiges Datum angeben.' });
  }
  if (!TIME_RE.test(time)) {
    return res.status(400).json({ error: 'Bitte eine gültige Uhrzeit angeben.' });
  }

  const info = db
    .prepare(
      `INSERT INTO trainings (organizer_id, title, description, location, date, time)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, title, description, location, date, time);

  const row = db
    .prepare(
      `SELECT t.*, u.name AS organizer_name FROM trainings t
       JOIN users u ON u.id = t.organizer_id WHERE t.id = ?`
    )
    .get(info.lastInsertRowid);

  res.status(201).json(serializeTraining(row));
});

// Feed: trainings by others that the current user hasn't swiped on yet.
trainingsRouter.get('/feed', (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.*, u.name AS organizer_name FROM trainings t
       JOIN users u ON u.id = t.organizer_id
       WHERE t.organizer_id != ?
         AND NOT EXISTS (
           SELECT 1 FROM swipes s WHERE s.training_id = t.id AND s.user_id = ?
         )
       ORDER BY t.date ASC, t.time ASC, t.created_at ASC`
    )
    .all(req.user.id, req.user.id);

  res.json(rows.map((row) => serializeTraining(row)));
});

trainingsRouter.get('/mine', (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.*, u.name AS organizer_name FROM trainings t
       JOIN users u ON u.id = t.organizer_id
       WHERE t.organizer_id = ?
       ORDER BY t.date ASC, t.time ASC`
    )
    .all(req.user.id);

  const withCounts = rows.map((row) => {
    const interestedCount = db
      .prepare(`SELECT COUNT(*) AS c FROM swipes WHERE training_id = ? AND direction = 'right'`)
      .get(row.id).c;
    return serializeTraining(row, { interestedCount });
  });

  res.json(withCounts);
});

// Trainings the current user has swiped right on.
trainingsRouter.get('/interests', (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.*, u.name AS organizer_name FROM trainings t
       JOIN users u ON u.id = t.organizer_id
       JOIN swipes s ON s.training_id = t.id
       WHERE s.user_id = ? AND s.direction = 'right'
       ORDER BY t.date ASC, t.time ASC`
    )
    .all(req.user.id);

  res.json(rows.map((row) => serializeTraining(row)));
});

trainingsRouter.post('/:id/swipe', (req, res) => {
  const trainingId = Number(req.params.id);
  const direction = req.body?.direction;

  if (!['left', 'right'].includes(direction)) {
    return res.status(400).json({ error: "Richtung muss 'left' oder 'right' sein." });
  }

  const training = db.prepare('SELECT * FROM trainings WHERE id = ?').get(trainingId);
  if (!training) {
    return res.status(404).json({ error: 'Fortbildung nicht gefunden.' });
  }
  if (training.organizer_id === req.user.id) {
    return res.status(400).json({ error: 'Auf eigene Fortbildungen kann nicht gewischt werden.' });
  }

  db.prepare(
    `INSERT INTO swipes (user_id, training_id, direction) VALUES (?, ?, ?)
     ON CONFLICT(user_id, training_id) DO UPDATE SET direction = excluded.direction`
  ).run(req.user.id, trainingId, direction);

  res.json({ ok: true });
});

// Private: only the organizer may see who is interested.
trainingsRouter.get('/:id/interested', (req, res) => {
  const trainingId = Number(req.params.id);
  const training = db.prepare('SELECT * FROM trainings WHERE id = ?').get(trainingId);

  if (!training) {
    return res.status(404).json({ error: 'Fortbildung nicht gefunden.' });
  }
  if (training.organizer_id !== req.user.id) {
    return res.status(403).json({ error: 'Nur die anbietende Person kann diese Liste sehen.' });
  }

  const attendees = db
    .prepare(
      `SELECT u.id, u.name, s.created_at AS interested_at
       FROM swipes s JOIN users u ON u.id = s.user_id
       WHERE s.training_id = ? AND s.direction = 'right'
       ORDER BY s.created_at ASC`
    )
    .all(trainingId);

  res.json(attendees.map((a) => ({ id: a.id, name: a.name, interestedAt: a.interested_at })));
});
