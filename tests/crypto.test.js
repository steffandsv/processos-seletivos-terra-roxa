import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

let cripto;

before(async () => {
  // Config exige estas variáveis; definimos antes de importar.
  process.env.DOC_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  cripto = await import('../src/lib/crypto.js');
});

test('encrypt/decrypt faz round-trip do conteúdo', () => {
  const original = Buffer.from('documento confidencial — RG do candidato 😀', 'utf8');
  const cifrado = cripto.encryptBuffer(original);
  assert.notDeepEqual(cifrado, original);
  assert.ok(cifrado.length > original.length); // IV + tag
  const decifrado = cripto.decryptBuffer(cifrado);
  assert.deepEqual(decifrado, original);
});

test('decrypt falha se o ciphertext for adulterado (AEAD)', () => {
  const cifrado = cripto.encryptBuffer(Buffer.from('abc'));
  cifrado[cifrado.length - 1] ^= 0xff; // corrompe 1 byte
  assert.throws(() => cripto.decryptBuffer(cifrado));
});

test('hashToken é determinístico e compararSeguro funciona', () => {
  const t = cripto.tokenAleatorio(16);
  assert.equal(cripto.hashToken(t), cripto.hashToken(t));
  assert.equal(cripto.compararSeguro('abc', 'abc'), true);
  assert.equal(cripto.compararSeguro('abc', 'abd'), false);
  assert.equal(cripto.compararSeguro('abc', 'abcd'), false);
});
