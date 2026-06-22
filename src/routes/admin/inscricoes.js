// Fila de homologação (§5.2): listar, visualizar documento, homologar/indeferir.
import prisma from '../../db.js';
import config from '../../config.js';
import { csrfGuard } from '../../plugins/auth.js';
import { indeferimentoSchema, errosZod } from '../../lib/validators.js';
import { normalizarConfigFases } from '../../lib/fases.js';
import { paginacao } from '../../lib/web.js';
import { lerArquivo } from '../../lib/upload.js';
import { gerarEspelhoPdf } from '../../lib/pdf.js';
import { registrarAuditoria } from '../../lib/audit.js';
import { enviarInscricaoHomologada, enviarInscricaoIndeferida, enviarNotificacaoStatus } from '../../lib/email.js';

const STATUS_VALIDOS = ['enviada', 'em_analise', 'homologada', 'indeferida', 'cancelada'];

export default async function adminInscricoes(fastify) {
  // Fila de homologação de um edital
  fastify.get('/editais/:id/inscricoes', async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id }, include: { cargos: { orderBy: { nome: 'asc' } } } });
    if (!edital) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' }); }

    const filtroStatus = STATUS_VALIDOS.includes(request.query.status) ? request.query.status : null;
    const filtroCargo = request.query.cargo ? Number(request.query.cargo) : null;
    const where = { editalId: id };
    if (filtroStatus) where.status = filtroStatus;
    if (filtroCargo) where.cargoId = filtroCargo;

    const { pagina, porPagina, skip, take } = paginacao(request.query, 50);
    const [inscricoes, total] = await Promise.all([
      prisma.inscricao.findMany({
        where,
        include: { candidato: { select: { nomeCompleto: true, cpf: true } }, cargo: { select: { nome: true } }, _count: { select: { documentos: true } } },
        orderBy: [{ status: 'asc' }, { criadoEm: 'asc' }],
        skip, take,
      }),
      prisma.inscricao.count({ where }),
    ]);
    return reply.render('admin-inscricoes', { titulo: `Inscrições — ${edital.numero}`, edital, inscricoes, filtroStatus, filtroCargo, pagina, porPagina, total });
  });

  // Detalhe de uma inscrição
  fastify.get('/inscricoes/:id', async (request, reply) => {
    const insc = await carregarCompleta(Number(request.params.id));
    if (!insc) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Inscrição não encontrada' }); }
    return reply.render('admin-inscricao', { titulo: `Inscrição ${insc.numeroInscricao}`, insc, flags: normalizarConfigFases(insc.edital.configFases), erros: {} });
  });

  // Visualização de documento pelo admin
  fastify.get('/documentos/:id/arquivo', async (request, reply) => {
    const doc = await prisma.documento.findUnique({ where: { id: Number(request.params.id) } });
    if (!doc) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Documento não encontrado' }); }
    let conteudo;
    try { conteudo = await lerArquivo(doc.arquivoPath); } catch { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Arquivo indisponível' }); }
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'documento.visualizado', entidade: 'documento', entidadeId: doc.id, ip: request.ip });
    reply.header('Content-Type', doc.mime || 'application/octet-stream');
    reply.header('Content-Disposition', `inline; filename="${(doc.nomeOriginal || 'documento').replace(/"/g, '')}"`);
    return reply.send(conteudo);
  });

  // Homologar
  fastify.post('/inscricoes/:id/homologar', { preHandler: csrfGuard }, async (request, reply) => {
    const insc = await carregarCompleta(Number(request.params.id));
    if (!insc) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Inscrição não encontrada' }); }
    if (insc.status === 'homologada') { reply.flash('info', 'Inscrição já estava homologada.'); return reply.redirect(`/admin/inscricoes/${insc.id}`); }

    const flags = normalizarConfigFases(insc.edital.configFases);
    if (flags.exige_documento_foto && !insc.documentos.some((d) => d.tipo === 'doc_foto')) {
      reply.flash('erro', 'Não é possível homologar: falta o documento com foto.');
      return reply.redirect(`/admin/inscricoes/${insc.id}`);
    }

    const atualizada = await prisma.inscricao.update({ where: { id: insc.id }, data: { status: 'homologada', motivoIndeferimento: null, reenvioAteEm: null } });
    // Ao homologar, o admin já validou a identidade pelo documento — a conta
    // passa a ser considerada CONFIRMADA (mesmo que o e-mail nunca tenha sido verificado).
    if (!insc.candidato.emailVerificado) {
      await prisma.candidato.update({ where: { id: insc.candidato.id }, data: { emailVerificado: true, emailTokenHash: null, emailTokenExpiraEm: null } });
      await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'candidato.confirmado_por_homologacao', entidade: 'candidato', entidadeId: insc.candidato.id, ip: request.ip });
    }
    const espelho = await gerarEspelhoPdf({ inscricao: atualizada, candidato: insc.candidato, edital: insc.edital, cargo: insc.cargo, documentos: insc.documentos, atendimento: insc.atendimentoEspecial });
    await enviarInscricaoHomologada({ inscricao: atualizada, candidato: insc.candidato, edital: insc.edital, cargo: insc.cargo, espelhoPdf: espelho });
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'inscricao.homologada', entidade: 'inscricao', entidadeId: insc.id, ip: request.ip });
    reply.flash('sucesso', `Inscrição ${insc.numeroInscricao} homologada. Candidato notificado.`);
    return reply.redirect(`/admin/inscricoes/${insc.id}`);
  });

  // Indeferir (com motivo)
  fastify.post('/inscricoes/:id/indeferir', { preHandler: csrfGuard }, async (request, reply) => {
    const insc = await carregarCompleta(Number(request.params.id));
    if (!insc) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Inscrição não encontrada' }); }
    const parsed = indeferimentoSchema.safeParse(request.body || {});
    if (!parsed.success) {
      reply.code(400);
      return reply.render('admin-inscricao', { titulo: `Inscrição ${insc.numeroInscricao}`, insc, flags: normalizarConfigFases(insc.edital.configFases), erros: errosZod(parsed) });
    }
    const flags = normalizarConfigFases(insc.edital.configFases);
    const dias = flags.janela_reenvio_documento_dias || 0;
    const reenvioAteEm = dias > 0 ? new Date(Date.now() + dias * 24 * 60 * 60 * 1000) : null;

    const atualizada = await prisma.inscricao.update({ where: { id: insc.id }, data: { status: 'indeferida', motivoIndeferimento: parsed.data.motivo, reenvioAteEm } });
    const reenvioUrl = reenvioAteEm ? `${config.baseUrl}/minhas-inscricoes/${insc.id}/reenviar` : null;
    await enviarInscricaoIndeferida({ inscricao: atualizada, candidato: insc.candidato, edital: insc.edital, cargo: insc.cargo, motivo: parsed.data.motivo, reenvioUrl, reenvioAteEm });
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'inscricao.indeferida', entidade: 'inscricao', entidadeId: insc.id, detalhes: { motivo: parsed.data.motivo, reenvioAteEm }, ip: request.ip });
    reply.flash('sucesso', `Inscrição ${insc.numeroInscricao} indeferida. Candidato notificado${reenvioUrl ? ' com janela de reenvio' : ''}.`);
    return reply.redirect(`/admin/inscricoes/${insc.id}`);
  });

  // Cancelar inscrição (admin) — mantém histórico; candidato pode reinscrever em outra vaga
  fastify.post('/inscricoes/:id/cancelar', { preHandler: csrfGuard }, async (request, reply) => {
    const insc = await carregarCompleta(Number(request.params.id));
    if (!insc) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Inscrição não encontrada' }); }
    if (insc.status === 'cancelada') { reply.flash('info', 'Inscrição já estava cancelada.'); return reply.redirect(`/admin/inscricoes/${insc.id}`); }
    await prisma.inscricao.update({ where: { id: insc.id }, data: { status: 'cancelada' } });
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'inscricao.cancelada_admin', entidade: 'inscricao', entidadeId: insc.id, detalhes: { statusAnterior: insc.status }, ip: request.ip });
    await enviarNotificacaoStatus({ candidato: insc.candidato, inscricao: insc, edital: insc.edital, titulo: 'Inscrição cancelada', mensagem: `Sua inscrição nº ${insc.numeroInscricao} (${insc.cargo.nome}) foi cancelada pela administração. Em caso de dúvida, entre em contato.`, template: 'inscricao_cancelada' }).catch(() => {});
    reply.flash('sucesso', `Inscrição ${insc.numeroInscricao} cancelada.`);
    return reply.redirect(`/admin/inscricoes/${insc.id}`);
  });
}

function carregarCompleta(id) {
  return prisma.inscricao.findUnique({
    where: { id },
    include: { candidato: true, edital: true, cargo: true, documentos: true, atendimentoEspecial: { include: { laudoDocumento: true } }, recursos: { orderBy: { criadoEm: 'desc' } } },
  });
}
