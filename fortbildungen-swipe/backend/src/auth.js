import jwt from 'jsonwebtoken';
import { db } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: '30d',
  });
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Sitzung ungültig oder abgelaufen.' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Nur für die Verwaltung zugänglich.' });
  }
  next();
}

export function requireFreshPassword(req, res, next) {
  const row = db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(req.user.id);
  if (row?.must_change_password) {
    return res.status(403).json({ error: 'Bitte zuerst das Initialpasswort ändern.', code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  next();
}
