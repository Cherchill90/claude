import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';

function OrganizedTrainingCard({ training }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [attendees, setAttendees] = useState(null);
  const [error, setError] = useState('');

  async function toggle() {
    if (!open && attendees === null) {
      try {
        const list = await api.getInterested(token, training.id);
        setAttendees(list);
      } catch (err) {
        setError(err.message);
      }
    }
    setOpen((v) => !v);
  }

  return (
    <div className="list-card">
      <div className="list-card-header" onClick={toggle} role="button" tabIndex={0}>
        <div>
          <h3>{training.title}</h3>
          <p className="training-datetime">{formatDateTime(training.date, training.time)}</p>
        </div>
        <span className="interest-badge">{training.interestedCount} interessiert</span>
      </div>

      {open && (
        <div className="attendee-list">
          {error && <p className="inline-error">{error}</p>}
          {attendees && attendees.length === 0 && (
            <p className="deck-empty-hint">Noch niemand hat Interesse bekundet.</p>
          )}
          {attendees && attendees.length > 0 && (
            <ul>
              {attendees.map((person) => (
                <li key={person.id}>{person.name}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function InterestTrainingCard({ training }) {
  return (
    <div className="list-card">
      <div className="list-card-header">
        <div>
          <h3>{training.title}</h3>
          <p className="training-datetime">{formatDateTime(training.date, training.time)}</p>
          <p className="training-organizer">Angeboten von {training.organizerName}</p>
        </div>
      </div>
    </div>
  );
}

export default function MyTrainings({ refreshKey }) {
  const { token } = useAuth();
  const [tab, setTab] = useState('mine');
  const [mine, setMine] = useState(null);
  const [interests, setInterests] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [mineList, interestList] = await Promise.all([
        api.getMine(token),
        api.getInterests(token),
      ]);
      setMine(mineList);
      setInterests(interestList);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <div className="mine-screen">
      <h1>Meine Fortbildungen</h1>

      <div className="auth-tabs">
        <button type="button" className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
          Ich biete an
        </button>
        <button
          type="button"
          className={tab === 'interests' ? 'active' : ''}
          onClick={() => setTab('interests')}
        >
          Mein Interesse
        </button>
      </div>

      {error && <p className="inline-error">{error}</p>}

      {tab === 'mine' && (
        <div className="list-column">
          {mine === null && <p className="deck-status">Lädt…</p>}
          {mine?.length === 0 && (
            <p className="deck-empty-hint">Du hast noch keine Fortbildung angelegt.</p>
          )}
          {mine?.map((t) => (
            <OrganizedTrainingCard key={t.id} training={t} />
          ))}
          <p className="privacy-note">
            Die Teilnahmeliste ist nur für dich als anbietende Person sichtbar.
          </p>
        </div>
      )}

      {tab === 'interests' && (
        <div className="list-column">
          {interests === null && <p className="deck-status">Lädt…</p>}
          {interests?.length === 0 && (
            <p className="deck-empty-hint">Du hast noch bei keiner Fortbildung nach rechts gewischt.</p>
          )}
          {interests?.map((t) => (
            <InterestTrainingCard key={t.id} training={t} />
          ))}
        </div>
      )}
    </div>
  );
}
