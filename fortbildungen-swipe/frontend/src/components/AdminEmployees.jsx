import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';

const initialForm = { email: '', name: '', role: 'employee' };

export default function AdminEmployees() {
  const { token, user } = useAuth();
  const [employees, setEmployees] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastCreated, setLastCreated] = useState(null);

  const load = useCallback(async () => {
    try {
      const list = await api.getEmployees(token);
      setEmployees(list);
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  function update(field) {
    return (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { employee, initialPassword } = await api.createEmployee(token, form);
      setLastCreated({ ...employee, initialPassword });
      setForm(initialForm);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    setError('');
    try {
      await api.deleteEmployee(token, id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="admin-screen">
      <h1>Mitarbeiterverwaltung</h1>
      <p className="screen-subtitle">
        Lege Konten für Kolleg:innen an. Der Zugang erfolgt über die betriebseigene E-Mail-Adresse
        und ein Initialpasswort, das beim ersten Login geändert werden muss.
      </p>

      <form onSubmit={handleSubmit} className="create-form">
        <label>
          Name
          <input value={form.name} onChange={update('name')} placeholder="z. B. Anna Müller" required minLength={2} />
        </label>
        <label>
          E-Mail-Adresse
          <input
            type="email"
            value={form.email}
            onChange={update('email')}
            placeholder="vorname.nachname@firma.de"
            required
          />
        </label>
        <label>
          Rolle
          <select value={form.role} onChange={update('role')}>
            <option value="employee">Mitarbeiter:in</option>
            <option value="admin">Verwaltung</option>
          </select>
        </label>

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? 'Wird angelegt…' : 'Konto anlegen'}
        </button>
      </form>

      {lastCreated && (
        <div className="initial-password-box">
          <p>
            Konto für <strong>{lastCreated.name}</strong> ({lastCreated.email}) wurde angelegt.
          </p>
          <p>
            Initialpasswort: <code>{lastCreated.initialPassword}</code>
          </p>
          <p className="deck-empty-hint">
            Bitte über die betriebseigene E-Mail-Adresse weitergeben. Es wird beim ersten Login
            geändert werden müssen.
          </p>
        </div>
      )}

      <h2 className="admin-list-title">Bestehende Konten</h2>
      <div className="list-column">
        {employees === null && <p className="deck-status">Lädt…</p>}
        {employees?.map((emp) => (
          <div className="list-card" key={emp.id}>
            <div className="list-card-header">
              <div>
                <h3>
                  {emp.name} {emp.role === 'admin' && <span className="role-tag">Verwaltung</span>}
                </h3>
                <p className="training-organizer">{emp.email}</p>
                <p className="deck-empty-hint">
                  {emp.mustChangePassword ? 'Initialpasswort noch aktiv' : 'Passwort geändert'}
                </p>
              </div>
              {emp.id !== user.id && (
                <button type="button" className="delete-btn" onClick={() => handleDelete(emp.id)}>
                  Entfernen
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
