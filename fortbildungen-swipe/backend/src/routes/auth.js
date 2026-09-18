import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { signToken } from '../auth.js';

export const authRouter = Router();

function publicUser(user) {
  return { id: user.id, name: user.name };
}

authRouter.post('/register', (req, res) => {
  const name = (req.body?.name || '').trim();
  const password = req.body?.password || '';

  if (name.length < 2) {
    return res.status(400).json({ error: 'Name muss mindestens 2 Zeichen haben.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE name = ?').get(name);
  if (existing) {
    return res.status(409).json({ error: 'Dieser Name ist bereits vergeben.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (name, password_hash) VALUES (?, ?)')
    .run(name, passwordHash);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

authRouter.post('/login', (req, res) => {
  const name = (req.body?.name || '').trim();
  const password = req.body?.password || '';

  const user = db.prepare('SELECT * FROM users WHERE name = ?').get(name);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Name oder Passwort ist falsch.' });
  }

  res.json({ token: signToken(user), user: publicUser(user) });
});
