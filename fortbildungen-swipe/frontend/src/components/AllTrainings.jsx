import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';

const STATUS_LABEL = {
  right: 'Interessiert',
  left: 'Abgelehnt',
  null: 'Noch offen',
};

function AllTrainingCard({ training, onSwipe, busy }) {
  const status = STATUS_LABEL[training.myDirection ?? null];

  return (
    <div className="list-card">
      <div className="list-card-header">
        <div>
          <h3>{training.title}</h3>
          <p className="training-datetime">{formatDateTime(training.date, training.time)}</p>
          {training.location && <p className="training-location">📍 {training.location}</p>}
          {training.description && <p className="training-description">{training.description}</p>}
          <p className="training-organizer">Angeboten von {training.organizerName}</p>
        </div>
        <span
          className={
            training.myDirection === 'right'
              ? 'interest-badge'
              : training.myDirection === 'left'
                ? 'interest-badge interest-badge-rejected'
                : 'interest-badge interest-badge-open'
          }
        >
          {status}
        </span>
      </div>

      <div className="list-swipe-actions">
        <button
          type="button"
          className={`list-swipe-btn nope ${training.myDirection === 'left' ? 'active' : ''}`}
          onClick={() => onSwipe(training, 'left')}
          disabled={busy}
          aria-label="Kein Interesse"
        >
          ✕ Kein Interesse
        </button>
        <button
          type="button"
          className={`list-swipe-btn like ${training.myDirection === 'right' ? 'active' : ''}`}
          onClick={() => onSwipe(training, 'right')}
          disabled={busy}
          aria-label="Interesse"
        >
          ✓ Interesse
        </button>
      </div>
    </div>
  );
}

export default function AllTrainings({ refreshKey }) {
  const { token } = useAuth();
  const [trainings, setTrainings] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const list = await api.getAll(token);
      setTrainings(list);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function handleSwipe(training, direction) {
    if (busyId) return;
    setBusyId(training.id);
    try {
      await api.swipe(token, training.id, direction);
      setTrainings((prev) =>
        prev.map((t) => (t.id === training.id ? { ...t, myDirection: direction } : t))
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mine-screen">
      <h1>Alle Fortbildungen</h1>
      <p className="screen-subtitle">
        Hier siehst du alle Fortbildungen von Kolleg:innen – auch die, bei denen du schon „Kein
        Interesse“ gewählt hast. Du kannst deine Entscheidung jederzeit ändern.
      </p>

      {error && <p className="inline-error">{error}</p>}

      <div className="list-column">
        {trainings === null && <p className="deck-status">Lädt…</p>}
        {trainings?.length === 0 && (
          <p className="deck-empty-hint">Es wurden noch keine Fortbildungen von anderen angelegt.</p>
        )}
        {trainings?.map((t) => (
          <AllTrainingCard key={t.id} training={t} onSwipe={handleSwipe} busy={busyId === t.id} />
        ))}
      </div>
    </div>
  );
}
