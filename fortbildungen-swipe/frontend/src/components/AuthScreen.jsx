import React, { useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';

export default function AuthScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Fortbildungen Swipe</h1>
        <p className="auth-subtitle">
          Melde dich mit deiner betriebseigenen E-Mail-Adresse und deinem Passwort an.
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            E-Mail-Adresse
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vorname.nachname@firma.de"
              autoComplete="username"
              required
            />
          </label>
          <label>
            Passwort
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Passwort"
              autoComplete="current-password"
              required
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? 'Bitte warten…' : 'Anmelden'}
          </button>
        </form>

        <p className="auth-footnote">
          Noch keinen Zugang? Wende dich an deine Verwaltung — sie richtet dein Konto mit
          Initialpasswort ein.
        </p>
      </div>
    </div>
  );
}
