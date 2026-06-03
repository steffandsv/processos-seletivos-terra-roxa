// Configuração modular de fases por edital (§2 do plano).
// "Regra de ouro": flag false => a etapa NÃO EXISTE para o candidato.

/** Config padrão — usada como base ao criar um edital e ao ler config legada. */
export const CONFIG_FASES_PADRAO = Object.freeze({
  permite_multiplas_vagas: false,
  exige_documento_foto: true,
  fase_homologacao: true,
  fase_recurso_inscricao: false,
  fase_atendimento_especial: true,
  fase_publicacao_gabarito: true,
  fase_recurso_gabarito: false,
  fase_resultado_classificacao: true,
  janela_reenvio_documento_dias: 2,
});

const FLAGS_BOOL = [
  'permite_multiplas_vagas',
  'exige_documento_foto',
  'fase_homologacao',
  'fase_recurso_inscricao',
  'fase_atendimento_especial',
  'fase_publicacao_gabarito',
  'fase_recurso_gabarito',
  'fase_resultado_classificacao',
];

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['1', 'true', 'on', 'yes'].includes(v.toLowerCase());
  return Boolean(v);
}

/**
 * Normaliza qualquer objeto/parcial em uma config completa e segura.
 * Aceita o que vem de formulário (strings/checkbox) ou do banco (jsonb).
 */
export function normalizarConfigFases(input = {}) {
  const out = { ...CONFIG_FASES_PADRAO };
  for (const flag of FLAGS_BOOL) {
    if (input[flag] !== undefined) out[flag] = toBool(input[flag]);
  }
  if (input.janela_reenvio_documento_dias !== undefined) {
    const n = parseInt(input.janela_reenvio_documento_dias, 10);
    out.janela_reenvio_documento_dias = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return out;
}

/** Acesso seguro a um flag de um edital já carregado. */
export function flag(edital, nome) {
  const cfg = normalizarConfigFases(edital?.configFases || {});
  return cfg[nome];
}

/** Rótulos amigáveis para o configurador no admin. */
export const ROTULOS_FASES = {
  permite_multiplas_vagas: 'Permitir múltiplas vagas (candidato escolhe N cargos)',
  exige_documento_foto: 'Exigir documento com foto (obrigatório p/ homologar)',
  fase_homologacao: 'Fase de homologação (alguém valida a inscrição)',
  fase_recurso_inscricao: 'Recurso contra indeferimento de inscrição',
  fase_atendimento_especial: 'Atendimento especial (PcD / condição na prova)',
  fase_publicacao_gabarito: 'Publicação de gabarito',
  fase_recurso_gabarito: 'Recurso contra gabarito',
  fase_resultado_classificacao: 'Resultado / classificação final',
};
