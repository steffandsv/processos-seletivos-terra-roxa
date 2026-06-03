import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpfValido, somenteDigitos, formatarCpf } from '../src/lib/cpf.js';

test('cpfValido aceita CPFs válidos (com e sem máscara)', () => {
  assert.equal(cpfValido('529.982.247-25'), true);
  assert.equal(cpfValido('52998224725'), true);
  assert.equal(cpfValido('111.444.777-35'), true);
});

test('cpfValido rejeita inválidos, repetidos e tamanho errado', () => {
  assert.equal(cpfValido('529.982.247-24'), false); // DV errado
  assert.equal(cpfValido('111.111.111-11'), false); // todos iguais
  assert.equal(cpfValido('00000000000'), false);
  assert.equal(cpfValido('123'), false);
  assert.equal(cpfValido(''), false);
  assert.equal(cpfValido(null), false);
});

test('somenteDigitos e formatarCpf', () => {
  assert.equal(somenteDigitos('529.982.247-25'), '52998224725');
  assert.equal(formatarCpf('52998224725'), '529.982.247-25');
});
