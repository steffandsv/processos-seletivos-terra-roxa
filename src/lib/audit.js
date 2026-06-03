// Trilha de auditoria — toda ação administrativa logada (mitigação da conta
// única e exigência transversal do plano §9).
import prisma from '../db.js';

/**
 * Registra uma ação no log de auditoria. Nunca lança — auditoria não deve
 * derrubar a operação principal (mas falha é logada no console).
 *
 * @param {object} p
 * @param {'admin'|'candidato'|'sistema'} p.ator
 * @param {string|number|null} [p.atorId]
 * @param {string} p.acao        Ex.: 'inscricao.homologar'
 * @param {string} [p.entidade]  Ex.: 'inscricao'
 * @param {string|number} [p.entidadeId]
 * @param {object} [p.detalhes]
 * @param {string} [p.ip]
 */
export async function registrarAuditoria({ ator, atorId, acao, entidade, entidadeId, detalhes, ip }) {
  try {
    await prisma.logAuditoria.create({
      data: {
        ator,
        atorId: atorId != null ? String(atorId) : null,
        acao,
        entidade: entidade || null,
        entidadeId: entidadeId != null ? String(entidadeId) : null,
        detalhes: detalhes || undefined,
        ip: ip || null,
      },
    });
  } catch (err) {
    console.error('[auditoria] falha ao registrar', acao, err?.message);
  }
}

/** Helper ligado a uma request: infere ator/ip a partir da sessão. */
export function auditoriaDaRequest(request) {
  const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.ip;
  return (dados) => {
    let ator = 'sistema';
    let atorId = null;
    if (request.sessao?.tipo === 'admin') {
      ator = 'admin';
      atorId = request.sessao.id;
    } else if (request.sessao?.tipo === 'candidato') {
      ator = 'candidato';
      atorId = request.sessao.id;
    }
    return registrarAuditoria({ ator, atorId, ip, ...dados });
  };
}
