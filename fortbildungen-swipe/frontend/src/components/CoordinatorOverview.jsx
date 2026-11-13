import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';

function OverviewTrainingCard({ training }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="list-card">
      <div
        className="list-card-header"
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
      >
        <div>
          <h3>{training.title}</h3>
          <p className="training-datetime">{formatDateTime(training.date, training.time)}</p>
          {training.location && <p className="training-location">📍 {training.location}</p>}
          <p className="training-organizer">Angeboten von {training.organizerName}</p>
        </div>
        <span className="interest-badge">{training.attendees.length} interessiert</span>
      </div>

      {open && (
        <div className="attendee-list">
          {training.attendees.length === 0 ? (
            <p className="deck-empty-hint">Noch niemand hat Interesse bekundet.</p>
          ) : (
            <ul>
              {training.attendees.map((person) => (
                <li key={person.id}>{person.name}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function CoordinatorOverview({ refreshKey }) {
  const { token } = useAuth();
  const [trainings, setTrainings] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const list = await api.getOverview(token);
      setTrainings(list);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <div className="mine-screen">
      <h1>Fortbildungen – Überblick</h1>
      <p className="screen-subtitle">
        Alle angelegten Fortbildungen im Betrieb mit den jeweils interessierten Kolleg:innen.
      </p>

      {error && <p className="inline-error">{error}</p>}

      <div className="list-column">
        {trainings === null && <p className="deck-status">Lädt…</p>}
        {trainings?.length === 0 && (
          <p className="deck-empty-hint">Es wurden noch keine Fortbildungen angelegt.</p>
        )}
        {trainings?.map((t) => (
          <OverviewTrainingCard key={t.id} training={t} />
        ))}
      </div>
    </div>
  );
}
