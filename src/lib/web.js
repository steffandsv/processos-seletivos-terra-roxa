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

/** Converte 'YYYY-MM-DD' ou 'YYYY-MM-DDTHH:mm' (input HTML) em Date ou null. */
export function parseDataInput(valor) {
  if (!valor || !String(valor).trim()) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Cria a inscrição gerando um número sequencial por edital, com retry em caso
 * de colisão de unicidade (editalId, numeroInscricao).
 */
export async function criarInscricaoComNumero(dados) {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const total = await prisma.inscricao.count({ where: { editalId: dados.editalId } });
    const numero = String(total + 1 + tentativa).padStart(5, '0');
    try {
      return await prisma.inscricao.create({ data: { ...dados, numeroInscricao: numero } });
    } catch (e) {
      if (e.code === 'P2002' && Array.isArray(e.meta?.target) && e.meta.target.includes('numero_inscricao')) {
        continue; // colisão de número — tenta o próximo
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
