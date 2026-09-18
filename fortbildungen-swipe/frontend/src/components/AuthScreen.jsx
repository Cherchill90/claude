import React, { useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';

export default function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(name.trim(), password);
      } else {
        await register(name.trim(), password);
      }
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
        <p className="auth-subtitle">Fortbildungen entdecken und nach rechts wischen für Interesse.</p>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => setMode('login')}
          >
            Anmelden
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'active' : ''}
            onClick={() => setMode('register')}
          >
            Registrieren
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Anna Müller"
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
              placeholder="mind. 6 Zeichen"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={6}
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="primary-btn" disabled={busy}>
            {busy ? 'Bitte warten…' : mode === 'login' ? 'Anmelden' : 'Konto erstellen'}
          </button>
        </form>
      </div>
    </div>
  );
}
