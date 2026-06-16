// Utilitários de rota: leitura de multipart, numeração de inscrição,
// estado do edital e parsing de datas de formulário.
import prisma from '../db.js';
import { normalizarConfigFases } from './fases.js';
import { sanitizarSegmento } from './upload.js';

/**
 * Subpasta de armazenamento de um edital: "{ANO}/{NÚMERO}".
 * Ex.: edital "001/2026" -> "2026/001-2026". Usada para organizar os uploads
 * (ver Pasta raiz do WebDAV: Publicacoes/Processos Seletivos/{ANO}/{NUMERO}).
 */
export function subpastaDoEdital(edital) {
  const numero = sanitizarSegmento(edital?.numero);
  let ano = (String(edital?.numero || '').match(/(20\d{2})/) || [])[1];
  if (!ano) {
    const base = edital?.dataAberturaInscricao || edital?.criadoEm || new Date();
    ano = String(new Date(base).getFullYear());
  }
  return `${ano}/${numero}`;
}

/**
 * Lê um corpo multipart por completo (campos + arquivos em buffer).
 * Arquivos vazios (campo file sem seleção) são ignorados.
 */
export async function lerMultipart(request) {
  const fields = {};
  const files = {};
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      if (part.filename && buffer.length > 0) {
        files[part.fieldname] = {
          buffer,
          filename: part.filename,
          mimetype: part.mimetype,
          size: buffer.length,
        };
      }
    } else {
      fields[part.fieldname] = part.value;
    }
  }
  return { fields, files };
}

/** Config de fases normalizada de um edital carregado. */
export function flagsEdital(edital) {
  return normalizarConfigFases(edital?.configFases || {});
}

/** Edital aceita novas inscrições agora? (publicado + dentro da janela) */
export function inscricoesAbertas(edital, agora = new Date()) {
  if (!edital || edital.status !== 'publicado') return false;
  if (edital.dataAberturaInscricao && agora < new Date(edital.dataAberturaInscricao)) return false;
  if (edital.dataEncerramentoInscricao && agora > new Date(edital.dataEncerramentoInscricao)) return false;
  return true;
}

/**
 * Converte o valor de um input HTML em Date, interpretando datas SEM fuso como
 * horário de Brasília (GMT-3 / America/Sao_Paulo). Sem isso, o servidor (UTC)
 * interpretaria "2026-06-09T00:00" como meia-noite UTC e a data exibida ficaria
 * um dia "atrás" no fuso de SP. Brasil não usa horário de verão desde 2019 (-03:00).
 */
export function parseDataInput(valor) {
  if (!valor || !String(valor).trim()) return null;
  let s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += ':00-03:00';        // datetime-local
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00-03:00';         // date
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Cria a inscrição gerando um número sequencial por edital, com retry em caso
 * de colisão de unicidade (editalId, numeroInscricao).
 *
 * Usa MAX(numero)+1 (e não COUNT+1): assim é robusto a exclusões de inscrições
 * (que deixam lacunas) — o COUNT cairia abaixo do maior número e colidiria.
 */
export async function criarInscricaoComNumero(dados) {
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const rows = await prisma.$queryRaw`
      SELECT COALESCE(MAX(numero_inscricao::int), 0) AS max
      FROM inscricao WHERE edital_id = ${dados.editalId}`;
    const base = Number(rows?.[0]?.max ?? 0);
    const numero = String(base + 1 + tentativa).padStart(5, '0');
    try {
      return await prisma.inscricao.create({ data: { ...dados, numeroInscricao: numero } });
    } catch (e) {
      if (e.code === 'P2002' && Array.isArray(e.meta?.target) && e.meta.target.includes('numero_inscricao')) {
        continue; // colisão (concorrência) — tenta o próximo número
      }
      throw e;
    }
  }
  throw new Error('Não foi possível gerar o número de inscrição. Tente novamente.');
}

/** Helper de paginação simples. */
export function paginacao(query, porPagina = 30) {
  const pagina = Math.max(1, parseInt(query?.pagina, 10) || 1);
  return { pagina, porPagina, skip: (pagina - 1) * porPagina, take: porPagina };
}
