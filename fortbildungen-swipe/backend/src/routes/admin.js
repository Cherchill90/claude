import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { validateEmail, generateInitialPassword } from '../lib/credentials.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

function publicEmployee(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.created_at,
  };
}

adminRouter.get('/employees', (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all();
  res.json(rows.map(publicEmployee));
});

adminRouter.post('/employees', (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const name = (req.body?.name || '').trim();
  const role = req.body?.role === 'admin' ? 'admin' : 'employee';

  const emailError = validateEmail(email);
  if (emailError) return res.status(400).json({ error: emailError });
  if (name.length < 2) {
    return res.status(400).json({ error: 'Name muss mindestens 2 Zeichen haben.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'Für diese E-Mail-Adresse existiert bereits ein Konto.' });
  }

  const initialPassword = generateInitialPassword();
  const passwordHash = bcrypt.hashSync(initialPassword, 10);

  const info = db
    .prepare(
      `INSERT INTO users (email, name, password_hash, role, must_change_password)
       VALUES (?, ?, ?, ?, 1)`
    )
    .run(email, name, passwordHash, role);

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ employee: publicEmployee(row), initialPassword });
});

adminRouter.delete('/employees/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res.status(400).json({ error: 'Der eigene Zugang kann nicht entfernt werden.' });
  }

  const info = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Konto nicht gefunden.' });
  }
  res.json({ ok: true });
});
