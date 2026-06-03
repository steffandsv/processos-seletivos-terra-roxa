// Publicações (§5.2 / Fase 3), recursos (Fase 4), relatórios e auditoria.
import prisma from '../../db.js';
import config from '../../config.js';
import { csrfGuard, validarCsrf } from '../../plugins/auth.js';
import { publicacaoSchema, respostaRecursoSchema, errosZod } from '../../lib/validators.js';
import { lerMultipart, paginacao } from '../../lib/web.js';
import { salvarArquivo, lerArquivo, removerArquivo } from '../../lib/upload.js';
import { registrarAuditoria } from '../../lib/audit.js';
import { enviarRespostaRecurso } from '../../lib/email.js';

export default async function adminTransparencia(fastify) {
  // ---------- Publicações ----------
  fastify.get('/editais/:id/publicacoes', async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id }, include: { publicacoes: { orderBy: { publicadoEm: 'desc' } } } });
    if (!edital) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' }); }
    return reply.render('admin-publicacoes', { titulo: `Publicações — ${edital.numero}`, edital });
  });

  fastify.post('/editais/:id/publicacoes', async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id } });
    if (!edital) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' }); }
    const { fields, files } = await lerMultipart(request);
    if (!validarCsrf(request, fields._csrf)) { reply.code(403); return reply.render('erro', { titulo: 'Erro de validação', mensagem: 'Requisição inválida (CSRF).', voltarUrl: `/admin/editais/${id}/publicacoes` }); }
    const parsed = publicacaoSchema.safeParse({ tipo: fields.tipo, titulo: fields.titulo });
    const arquivo = files.arquivo;
    const erros = parsed.success ? {} : errosZod(parsed);
    if (!arquivo) erros.arquivo = 'Selecione um arquivo (PDF, CSV ou imagem).';
    else if (!config.mimesPublicacao.includes(arquivo.mimetype)) erros.arquivo = 'Formato não aceito. Use PDF, CSV, JPG ou PNG.';
    else if (arquivo.size > config.maxUploadBytes) erros.arquivo = 'Arquivo excede 8 MB.';
    if (Object.keys(erros).length) {
      const comPub = await prisma.edital.findUnique({ where: { id }, include: { publicacoes: { orderBy: { publicadoEm: 'desc' } } } });
      reply.code(400);
      return reply.render('admin-publicacoes', { titulo: `Publicações — ${edital.numero}`, edital: comPub, erros, valores: fields });
    }
    const nome = await salvarArquivo(arquivo.buffer, arquivo.mimetype);
    const pub = await prisma.publicacao.create({ data: { editalId: id, tipo: parsed.data.tipo, titulo: parsed.data.titulo, arquivoPath: nome, nomeOriginal: arquivo.filename, mime: arquivo.mimetype } });
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'publicacao.criada', entidade: 'publicacao', entidadeId: pub.id, detalhes: { tipo: pub.tipo, titulo: pub.titulo }, ip: request.ip });
    reply.flash('sucesso', 'Publicação adicionada com carimbo de data/hora.');
    return reply.redirect(`/admin/editais/${id}/publicacoes`);
  });

  fastify.post('/publicacoes/:id/excluir', { preHandler: csrfGuard }, async (request, reply) => {
    const pub = await prisma.publicacao.findUnique({ where: { id: Number(request.params.id) } });
    if (!pub) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Publicação não encontrada' }); }
    await prisma.publicacao.delete({ where: { id: pub.id } });
    await removerArquivo(pub.arquivoPath).catch(() => {});
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'publicacao.excluida', entidade: 'publicacao', entidadeId: pub.id, ip: request.ip });
    reply.flash('sucesso', 'Publicação removida.');
    return reply.redirect(`/admin/editais/${pub.editalId}/publicacoes`);
  });

  // ---------- Recursos ----------
  fastify.get('/editais/:id/recursos', async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id } });
    if (!edital) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' }); }
    const recursos = await prisma.recurso.findMany({
      where: { inscricao: { editalId: id } },
      include: { inscricao: { include: { candidato: { select: { nomeCompleto: true } }, cargo: { select: { nome: true } } } } },
      orderBy: [{ status: 'asc' }, { criadoEm: 'asc' }],
    });
    return reply.render('admin-recursos', { titulo: `Recursos — ${edital.numero}`, edital, recursos });
  });

  fastify.get('/recursos/:id', async (request, reply) => {
    const recurso = await carregarRecurso(Number(request.params.id));
    if (!recurso) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Recurso não encontrado' }); }
    return reply.render('admin-recurso', { titulo: `Recurso ${recurso.protocolo}`, recurso, erros: {} });
  });

  fastify.get('/recursos/:id/anexo', async (request, reply) => {
    const recurso = await prisma.recurso.findUnique({ where: { id: Number(request.params.id) } });
    if (!recurso || !recurso.anexoPath) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Anexo não encontrado' }); }
    let conteudo;
    try { conteudo = await lerArquivo(recurso.anexoPath); } catch { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Arquivo indisponível' }); }
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `inline; filename="anexo-recurso-${recurso.protocolo}"`);
    return reply.send(conteudo);
  });

  fastify.post('/recursos/:id/responder', { preHandler: csrfGuard }, async (request, reply) => {
    const recurso = await carregarRecurso(Number(request.params.id));
    if (!recurso) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Recurso não encontrado' }); }
    if (recurso.status !== 'aberto') { reply.flash('info', 'Este recurso já foi respondido.'); return reply.redirect(`/admin/recursos/${recurso.id}`); }
    const parsed = respostaRecursoSchema.safeParse(request.body || {});
    if (!parsed.success) {
      reply.code(400);
      return reply.render('admin-recurso', { titulo: `Recurso ${recurso.protocolo}`, recurso, erros: errosZod(parsed) });
    }
    const atualizado = await prisma.recurso.update({ where: { id: recurso.id }, data: { status: parsed.data.status, respostaAdmin: parsed.data.respostaAdmin, respondidoEm: new Date() } });
    await enviarRespostaRecurso({ candidato: recurso.inscricao.candidato, recurso: atualizado, edital: recurso.inscricao.edital, inscricao: recurso.inscricao });
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'recurso.respondido', entidade: 'recurso', entidadeId: recurso.id, detalhes: { status: parsed.data.status }, ip: request.ip });
    reply.flash('sucesso', `Recurso ${recurso.protocolo} ${parsed.data.status}. Candidato notificado.`);
    return reply.redirect(`/admin/recursos/${recurso.id}`);
  });

  // ---------- Relatório simples ----------
  fastify.get('/editais/:id/relatorio', async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id }, include: { cargos: { orderBy: { nome: 'asc' } } } });
    if (!edital) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' }); }
    const grupos = await prisma.inscricao.groupBy({ by: ['cargoId', 'status'], where: { editalId: id }, _count: true });
    const porCargo = new Map(edital.cargos.map((c) => [c.id, { cargo: c, total: 0, homologada: 0, indeferida: 0, em_analise: 0, enviada: 0, cancelada: 0 }]));
    let totalGeral = 0;
    for (const g of grupos) {
      const linha = porCargo.get(g.cargoId);
      if (linha) { linha[g.status] = g._count; linha.total += g._count; totalGeral += g._count; }
    }
    return reply.render('admin-relatorio', { titulo: `Relatório — ${edital.numero}`, edital, linhas: [...porCargo.values()], totalGeral });
  });

  // ---------- Auditoria ----------
  fastify.get('/auditoria', async (request, reply) => {
    const { pagina, porPagina, skip, take } = paginacao(request.query, 50);
    const where = {};
    if (request.query.ator && ['admin', 'candidato', 'sistema'].includes(request.query.ator)) where.ator = request.query.ator;
    const [logs, total] = await Promise.all([
      prisma.logAuditoria.findMany({ where, orderBy: { criadoEm: 'desc' }, skip, take }),
      prisma.logAuditoria.count({ where }),
    ]);
    return reply.render('admin-auditoria', { titulo: 'Trilha de auditoria', logs, pagina, porPagina, total, filtroAtor: request.query.ator || '' });
  });
}

function carregarRecurso(id) {
  return prisma.recurso.findUnique({
    where: { id },
    include: { inscricao: { include: { candidato: true, edital: true, cargo: true } } },
  });
}
