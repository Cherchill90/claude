import crypto from 'node:crypto';

const COMPANY_EMAIL_DOMAIN = (process.env.COMPANY_EMAIL_DOMAIN || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function validateEmail(email) {
  if (!EMAIL_RE.test(email)) {
    return 'Bitte eine gültige E-Mail-Adresse angeben.';
  }
  if (COMPANY_EMAIL_DOMAIN && !email.toLowerCase().endsWith(`@${COMPANY_EMAIL_DOMAIN}`)) {
    return `Es sind nur betriebseigene E-Mail-Adressen (@${COMPANY_EMAIL_DOMAIN}) zugelassen.`;
  }
  return null;
}

export function generateInitialPassword(length = 10) {
  let password = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) {
    password += PASSWORD_CHARS[bytes[i] % PASSWORD_CHARS.length];
  }
  return password;
}
