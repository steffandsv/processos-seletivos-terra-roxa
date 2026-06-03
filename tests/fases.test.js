import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarConfigFases, CONFIG_FASES_PADRAO, flag } from '../src/lib/fases.js';

test('normalizarConfigFases retorna defaults quando vazio', () => {
  const c = normalizarConfigFases({});
  assert.deepEqual(c, CONFIG_FASES_PADRAO);
});

test('coage strings de formulário (checkbox "on") para boolean', () => {
  const c = normalizarConfigFases({ fase_recurso_inscricao: 'on', exige_documento_foto: 'on' });
  assert.equal(c.fase_recurso_inscricao, true);
  assert.equal(c.exige_documento_foto, true);
});

test('respeita flags explicitamente false vindas do banco (jsonb)', () => {
  const c = normalizarConfigFases({ fase_homologacao: false, fase_atendimento_especial: false });
  assert.equal(c.fase_homologacao, false);
  assert.equal(c.fase_atendimento_especial, false);
});

test('janela_reenvio inválida vira 0; válida é preservada', () => {
  assert.equal(normalizarConfigFases({ janela_reenvio_documento_dias: 'abc' }).janela_reenvio_documento_dias, 0);
  assert.equal(normalizarConfigFases({ janela_reenvio_documento_dias: '5' }).janela_reenvio_documento_dias, 5);
  assert.equal(normalizarConfigFases({ janela_reenvio_documento_dias: -3 }).janela_reenvio_documento_dias, 0);
});

test('flag() lê de um edital carregado', () => {
  const edital = { configFases: { fase_recurso_gabarito: true } };
  assert.equal(flag(edital, 'fase_recurso_gabarito'), true);
  assert.equal(flag(edital, 'fase_homologacao'), true); // default
});
