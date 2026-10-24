import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { validateEmail, generateInitialPassword } from '../lib/credentials.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

async function readRowsFromFile(file) {
  const workbook = new ExcelJS.Workbook();
  const isCsv = /\.csv$/i.test(file.originalname) || file.mimetype === 'text/csv';

  if (isCsv) {
    await workbook.csv.read(Readable.from(file.buffer));
  } else {
    await workbook.xlsx.load(file.buffer);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headers = (sheet.getRow(1).values || []).map((h) => String(h ?? '').trim());

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Überschrift überspringen
    const obj = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber];
      if (key) obj[key] = cell.value;
    });
    rows.push({ obj, rowNumber });
  });

  return rows;
}

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

adminRouter.post('/employees/import', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Keine Datei hochgeladen.' });
  }

  let rows;
  try {
    rows = await readRowsFromFile(req.file);
  } catch {
    return res.status(400).json({
      error: 'Datei konnte nicht gelesen werden. Bitte eine gültige Excel- (.xlsx) oder CSV-Datei hochladen.',
    });
  }

  if (rows.length === 0) {
    return res.status(400).json({ error: 'Die Datei enthält keine Zeilen.' });
  }

  const insert = db.prepare(
    `INSERT INTO users (email, name, password_hash, role, must_change_password)
     VALUES (?, ?, ?, ?, 1)`
  );

  const results = rows
    .map(({ obj: row, rowNumber }) => {
      const email = String(row.Email ?? row['E-Mail'] ?? row.email ?? '')
        .trim()
        .toLowerCase();
      const name = String(row.Name ?? row.name ?? '').trim();
      const roleRaw = String(row.Rolle ?? row.Role ?? row.role ?? '')
        .trim()
        .toLowerCase();
      const role = roleRaw === 'admin' || roleRaw === 'verwaltung' ? 'admin' : 'employee';

      if (!email && !name) return null; // leere Zeile überspringen

      const emailError = validateEmail(email);
      if (emailError) {
        return { row: rowNumber, email, name, status: 'error', error: emailError };
      }
      if (name.length < 2) {
        return { row: rowNumber, email, name, status: 'error', error: 'Name muss mindestens 2 Zeichen haben.' };
      }

      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) {
        return { row: rowNumber, email, name, status: 'error', error: 'E-Mail-Adresse bereits vergeben.' };
      }

      const initialPassword = generateInitialPassword();
      const passwordHash = bcrypt.hashSync(initialPassword, 10);
      insert.run(email, name, passwordHash, role);

      return { row: rowNumber, email, name, role, status: 'created', initialPassword };
    })
    .filter(Boolean);

  const created = results.filter((r) => r.status === 'created').length;
  res.status(201).json({ created, total: results.length, results });
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

adminRouter.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Datei zu groß oder ungültig (maximal 2 MB).' });
  }
  next(err);
});
