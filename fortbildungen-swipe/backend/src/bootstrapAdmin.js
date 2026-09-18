import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { generateInitialPassword } from './lib/credentials.js';

export function bootstrapAdmin() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (count > 0) return;

  const email = (process.env.ADMIN_EMAIL || 'admin@firma.example').trim().toLowerCase();
  const name = process.env.ADMIN_NAME || 'Verwaltung';
  const password = process.env.ADMIN_INITIAL_PASSWORD || generateInitialPassword();
  const passwordHash = bcrypt.hashSync(password, 10);

  db.prepare(
    `INSERT INTO users (email, name, password_hash, role, must_change_password)
     VALUES (?, ?, ?, 'admin', 1)`
  ).run(email, name, passwordHash);

  console.log('\n==================================================');
  console.log('Erstes Admin-Konto wurde angelegt:');
  console.log(`  E-Mail:            ${email}`);
  console.log(`  Initialpasswort:   ${password}`);
  console.log('Bitte nach dem ersten Login sofort das Passwort ändern.');
  console.log('Über ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD kann dies beim Start konfiguriert werden.');
  console.log('==================================================\n');
}
