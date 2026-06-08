// Formatação para as views (datas, rótulos, tamanhos).
import { formatarCpf } from './cpf.js';

const TZ = 'America/Sao_Paulo';

export function fmtData(d) {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: TZ }).format(new Date(d));
  } catch {
    return '—';
  }
}

export function fmtDataHora(d) {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ }).format(new Date(d));
  } catch {
    return '—';
  }
}

export function fmtMoeda(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Formata uma data para o input datetime-local ("YYYY-MM-DDTHH:mm") em horário de Brasília. */
export function fmtInputDateTime(d) {
  if (!d) return '';
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const p = Object.fromEntries(fmt.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
    const hora = p.hour === '24' ? '00' : p.hour; // en-CA pode emitir 24h
    return `${p.year}-${p.month}-${p.day}T${hora}:${p.minute}`;
  } catch {
    return '';
  }
}

export function fmtTamanho(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ROTULO_STATUS_INSCRICAO = {
  enviada: 'Enviada',
  em_analise: 'Em análise',
  homologada: 'Homologada',
  indeferida: 'Indeferida',
  cancelada: 'Cancelada',
};

export const CLASSE_STATUS_INSCRICAO = {
  enviada: 'badge-info',
  em_analise: 'badge-warn',
  homologada: 'badge-ok',
  indeferida: 'badge-erro',
  cancelada: 'badge-neutro',
};

export const ROTULO_STATUS_EDITAL = {
  rascunho: 'Rascunho',
  publicado: 'Publicado',
  encerrado: 'Encerrado',
  expurgado: 'Expurgado',
};

export const ROTULO_TIPO_PUBLICACAO = {
  edital: 'Edital',
  retificacao: 'Retificação',
  gabarito_preliminar: 'Gabarito preliminar',
  gabarito_definitivo: 'Gabarito definitivo',
  resultado: 'Resultado',
  classificacao: 'Classificação',
  convocacao: 'Convocação',
  outro: 'Outro',
};

export const ROTULO_TIPO_DOCUMENTO = {
  doc_foto: 'Documento com foto',
  laudo: 'Laudo',
  outro: 'Outro',
};

export const ROTULO_STATUS_RECURSO = {
  aberto: 'Em análise',
  deferido: 'Deferido',
  indeferido: 'Indeferido',
};

export const ROTULO_FASE_RECURSO = {
  inscricao: 'Recurso de inscrição',
  gabarito: 'Recurso de gabarito',
};

export { formatarCpf };
