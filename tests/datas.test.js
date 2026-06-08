import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

let parseDataInput;
let fmtInputDateTime;
let fmtData;

before(async () => {
  process.env.DOC_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  ({ parseDataInput } = await import('../src/lib/web.js'));
  ({ fmtInputDateTime, fmtData } = await import('../src/lib/format.js'));
});

test('parseDataInput interpreta datetime-local como horário de Brasília (-03:00)', () => {
  // 09/06 00:00 em SP === 09/06 03:00 UTC
  assert.equal(parseDataInput('2026-06-09T00:00').toISOString(), '2026-06-09T03:00:00.000Z');
  assert.equal(parseDataInput('2026-06-09T01:00').toISOString(), '2026-06-09T04:00:00.000Z');
});

test('parseDataInput aceita data sem hora (00:00 em SP)', () => {
  assert.equal(parseDataInput('2026-06-09').toISOString(), '2026-06-09T03:00:00.000Z');
});

test('parseDataInput respeita fuso explícito e retorna null p/ vazio', () => {
  assert.equal(parseDataInput('2026-06-09T03:00:00Z').toISOString(), '2026-06-09T03:00:00.000Z');
  assert.equal(parseDataInput(''), null);
  assert.equal(parseDataInput(null), null);
});

test('fmtData mostra a data correta em SP (09/06, não 08/06)', () => {
  assert.equal(fmtData('2026-06-09T03:00:00.000Z'), '09/06/2026');
});

test('round-trip: fmtInputDateTime e parseDataInput são consistentes', () => {
  const utc = '2026-06-09T03:00:00.000Z';
  const local = fmtInputDateTime(utc); // '2026-06-09T00:00'
  assert.equal(local, '2026-06-09T00:00');
  assert.equal(parseDataInput(local).toISOString(), utc);
});
