import React, { useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';

export default function ChangePasswordScreen({ forced = false, onCancel }) {
  const { token, logout, markPasswordChanged } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Die beiden neuen Passwörter stimmen nicht überein.');
      return;
    }

    setBusy(true);
    try {
      const { user } = await api.changePassword(token, currentPassword, newPassword);
      markPasswordChanged(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Passwort ändern</h1>
        <p className="auth-subtitle">
          {forced
            ? 'Du meldest dich mit einem Initialpasswort an. Bitte vergib jetzt ein eigenes Passwort, bevor es weitergeht.'
            : 'Vergib ein neues Passwort für dein Konto.'}
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Aktuelles Passwort
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            Neues Passwort
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="mind. 8 Zeichen"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label>
            Neues Passwort bestätigen
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? 'Wird gespeichert…' : 'Passwort speichern'}
          </button>
        </form>

        {forced ? (
          <button type="button" className="logout-btn auth-footnote" onClick={logout}>
            Abmelden
          </button>
        ) : (
          onCancel && (
            <button type="button" className="logout-btn auth-footnote" onClick={onCancel}>
              Zurück zur App
            </button>
          )
        )}
      </div>
    </div>
  );
}
