import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as W from './synccrypto.js';
const N = createRequire(import.meta.url)('../electron/synccrypto.cjs');

test('Node ⇄ WebCrypto: gleiche Schlüsselableitung und gleiches Format', async () => {
  const salt = Buffer.from('0123456789abcdef').toString('base64');
  const code = N.newCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  const nodeKey = N.pairKey(code, salt);
  const webKey = await W.pairKey(code.toLowerCase().replace(/(.{4})/, '$1-'), salt); // Eingabe mit Bindestrich/klein
  const box1 = N.sealJson(nodeKey, { hallo: 'Mac', n: 1 });
  assert.deepEqual(await W.openJson(webKey, box1), { hallo: 'Mac', n: 1 });
  const box2 = await W.sealJson(webKey, { hallo: 'iPhone', ü: 'ä' });
  assert.deepEqual(N.openJson(nodeKey, box2), { hallo: 'iPhone', ü: 'ä' });
  const wrong = N.pairKey('FALSCH22', salt);
  assert.throws(() => N.openJson(wrong, box2));
});
