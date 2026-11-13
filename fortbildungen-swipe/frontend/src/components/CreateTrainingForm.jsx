import React, { useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';

const initialState = { title: '', description: '', location: '', date: '', time: '' };

export default function CreateTrainingForm({ onCreated }) {
  const { token } = useAuth();
  const [form, setForm] = useState(initialState);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  function update(field) {
    return (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!form.date || !form.time) {
      setError('Datum und Uhrzeit sind Pflichtangaben.');
      return;
    }

    setBusy(true);
    try {
      const created = await api.createTraining(token, form);
      setForm(initialState);
      setSuccess(`„${created.title}“ wurde veröffentlicht.`);
      onCreated?.(created);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="create-screen">
      <h1>Neue Fortbildung</h1>
      <p className="screen-subtitle">Erstelle eine Fortbildung, die andere per Swipe entdecken können.</p>

      <form onSubmit={handleSubmit} className="create-form">
        <label>
          Titel *
          <input
            value={form.title}
            onChange={update('title')}
            placeholder="z. B. Erste-Hilfe-Auffrischung"
            required
            minLength={2}
          />
        </label>

        <label>
          Beschreibung
          <textarea
            value={form.description}
            onChange={update('description')}
            placeholder="Worum geht es, für wen ist es geeignet?"
            rows={4}
          />
        </label>

        <label>
          Ort
          <input value={form.location} onChange={update('location')} placeholder="z. B. Raum 204 oder online" />
        </label>

        <div className="form-row">
          <label>
            Datum *
            <input type="date" value={form.date} onChange={update('date')} required />
          </label>
          <label>
            Uhrzeit *
            <input type="time" value={form.time} onChange={update('time')} required />
          </label>
        </div>

        {error && <p className="auth-error">{error}</p>}
        {success && <p className="form-success">{success}</p>}

        <button type="submit" className="primary-btn" disabled={busy}>
          {busy ? 'Wird veröffentlicht…' : 'Fortbildung veröffentlichen'}
        </button>
      </form>
    </div>
  );
}
