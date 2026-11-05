// Gegenstück zu src/synccrypto.js für Node (Electron-Hauptprozess). AES-256-GCM, Tag am Ende des Chiffrats.
const crypto = require('crypto');

const PAIR_ITERATIONS = 200000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normCode = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function newCode(len = 8) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

const pairKey = (code, saltB64) => crypto.pbkdf2Sync(normCode(code), Buffer.from(saltB64, 'base64'), PAIR_ITERATIONS, 32, 'sha256');

function sealJson(key, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
  return { iv: iv.toString('base64'), data: ct.toString('base64') };
}

function openJson(key, box) {
  const buf = Buffer.from(box.data, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(buf.subarray(buf.length - 16));
  const pt = Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]);
  return JSON.parse(pt.toString('utf8'));
}

module.exports = { PAIR_ITERATIONS, CODE_ALPHABET, normCode, newCode, pairKey, sealJson, openJson };
