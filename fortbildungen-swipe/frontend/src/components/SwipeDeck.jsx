import React, { useEffect, useState, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import SwipeCard from './SwipeCard.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';

export default function SwipeDeck({ refreshKey }) {
  const { token } = useAuth();
  const [trainings, setTrainings] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const loadFeed = useCallback(async () => {
    setError('');
    try {
      const feed = await api.getFeed(token);
      setTrainings(feed);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed, refreshKey]);

  async function handleSwipe(training, direction) {
    if (pending) return;
    setPending(true);
    try {
      await api.swipe(token, training.id, direction);
    } catch (err) {
      setError(err.message);
    } finally {
      setTrainings((prev) => prev.filter((t) => t.id !== training.id));
      setPending(false);
    }
  }

  if (trainings === null) {
    return <div className="deck-status">Fortbildungen werden geladen…</div>;
  }

  const visible = trainings.slice(0, 3);
  const topTraining = trainings[0];

  return (
    <div className="deck-screen">
      {error && <p className="inline-error">{error}</p>}

      <div className="deck-stack">
        {visible.length === 0 && (
          <div className="deck-empty">
            <p>Keine neuen Fortbildungen mehr 🎉</p>
            <p className="deck-empty-hint">Schau später wieder vorbei oder lege selbst eine an.</p>
          </div>
        )}
        <AnimatePresence>
          {visible.map((training, i) => (
            <SwipeCard
              key={training.id}
              training={training}
              isTop={training.id === topTraining?.id}
              zIndex={visible.length - i}
              onSwiped={(direction) => handleSwipe(training, direction)}
            />
          ))}
        </AnimatePresence>
      </div>

      {topTraining && (
        <div className="deck-actions">
          <button
            type="button"
            className="round-btn nope"
            onClick={() => handleSwipe(topTraining, 'left')}
            aria-label="Kein Interesse"
          >
            ✕
          </button>
          <button
            type="button"
            className="round-btn like"
            onClick={() => handleSwipe(topTraining, 'right')}
            aria-label="Interesse"
          >
            ✓
          </button>
        </div>
      )}
    </div>
  );
}
