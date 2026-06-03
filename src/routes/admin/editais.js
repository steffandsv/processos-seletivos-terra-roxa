// CRUD de editais + configurador de fases (§2), cargos, publicação,
// encerramento e expurgo LGPD.
import prisma from '../../db.js';
import { csrfGuard } from '../../plugins/auth.js';
import { editalSchema, cargoSchema, errosZod } from '../../lib/validators.js';
import { parseDataInput } from '../../lib/web.js';
import { CONFIG_FASES_PADRAO, ROTULOS_FASES, normalizarConfigFases } from '../../lib/fases.js';
import { registrarAuditoria } from '../../lib/audit.js';
import { removerArquivo } from '../../lib/upload.js';

const FLAGS_BOOL = [
  'permite_multiplas_vagas', 'exige_documento_foto', 'fase_homologacao',
  'fase_recurso_inscricao', 'fase_atendimento_especial', 'fase_publicacao_gabarito',
  'fase_recurso_gabarito', 'fase_resultado_classificacao',
];

// Lê a config de fases de um formulário (checkbox ausente = false).
function configFasesDoForm(body) {
  const cfg = {};
  for (const flag of FLAGS_BOOL) cfg[flag] = body[flag] === 'on';
  const dias = parseInt(body.janela_reenvio_documento_dias, 10);
  cfg.janela_reenvio_documento_dias = Number.isFinite(dias) && dias >= 0 ? dias : 0;
  return cfg;
}

async function statsInscricoes(editalId) {
  const grupos = await prisma.inscricao.groupBy({ by: ['status'], where: { editalId }, _count: true });
  const out = { total: 0 };
  for (const g of grupos) { out[g.status] = g._count; out.total += g._count; }
  return out;
}

export default async function adminEditais(fastify) {
  fastify.get('/editais', async (_request, reply) => {
    const editais = await prisma.edital.findMany({ orderBy: { criadoEm: 'desc' }, include: { _count: { select: { inscricoes: true, cargos: true } } } });
    return reply.render('admin-editais', { titulo: 'Editais', editais });
  });

  fastify.get('/editais/novo', async (_request, reply) =>
    reply.render('admin-edital-form', { titulo: 'Novo edital', edital: null, config: CONFIG_FASES_PADRAO, rotulos: ROTULOS_FASES, valores: {}, erros: {} }));

  fastify.post('/editais', { preHandler: csrfGuard }, async (request, reply) => {
    const body = request.body || {};
    const parsed = editalSchema.safeParse(body);
    if (!parsed.success) {
      reply.code(400);
      return reply.render('admin-edital-form', { titulo: 'Novo edital', edital: null, config: configFasesDoForm(body), rotulos: ROTULOS_FASES, valores: body, erros: errosZod(parsed) });
    }
    const d = parsed.data;
    try {
      const edital = await prisma.edital.create({
        data: {
          titulo: d.titulo, numero: d.numero, descricao: d.descricao || null,
          configFases: configFasesDoForm(body),
          dataAberturaInscricao: parseDataInput(d.dataAberturaInscricao),
          dataEncerramentoInscricao: parseDataInput(d.dataEncerramentoInscricao),
          status: 'rascunho',
        },
      });
      await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'edital.criado', entidade: 'edital', entidadeId: edital.id, detalhes: { numero: edital.numero }, ip: request.ip });
      reply.flash('sucesso', 'Edital criado como rascunho. Adicione cargos e publique quando estiver pronto.');
      return reply.redirect(`/admin/editais/${edital.id}`);
    } catch (e) {
      if (e.code === 'P2002') {
        reply.code(409);
        return reply.render('admin-edital-form', { titulo: 'Novo edital', edital: null, config: configFasesDoForm(body), rotulos: ROTULOS_FASES, valores: body, erros: { numero: 'Já existe um edital com este número.' } });
      }
      throw e;
    }
  });

  fastify.get('/editais/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id }, include: { cargos: { orderBy: { nome: 'asc' }, include: { _count: { select: { inscricoes: true } } } }, _count: { select: { publicacoes: true } } } });
    if (!edital) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' }); }
    const stats = await statsInscricoes(id);
    const recursosAbertos = await prisma.recurso.count({ where: { inscricao: { editalId: id }, status: 'aberto' } });
    return reply.render('admin-edital', { titulo: `${edital.numero}`, edital, config: normalizarConfigFases(edital.configFases), rotulos: ROTULOS_FASES, stats, recursosAbertos });
  });

  fastify.get('/editais/:id/editar', async (request, reply) => {
    const edital = await prisma.edital.findUnique({ where: { id: Number(request.params.id) } });
    if (!edital) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' }); }
    return reply.render('admin-edital-form', { titulo: `Editar ${edital.numero}`, edital, config: normalizarConfigFases(edital.configFases), rotulos: ROTULOS_FASES, valores: {}, erros: {} });
  });

  fastify.post('/editais/:id', { preHandler: csrfGuard }, async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id } });
    if (!edital) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' }); }
    const body = request.body || {};
    const parsed = editalSchema.safeParse(body);
    if (!parsed.success) {
      reply.code(400);
      return reply.render('admin-edital-form', { titulo: `Editar ${edital.numero}`, edital, config: configFasesDoForm(body), rotulos: ROTULOS_FASES, valores: body, erros: errosZod(parsed) });
    }
    const d = parsed.data;
    try {
      await prisma.edital.update({
        where: { id }, data: {
          titulo: d.titulo, numero: d.numero, descricao: d.descricao || null,
          configFases: configFasesDoForm(body),
          dataAberturaInscricao: parseDataInput(d.dataAberturaInscricao),
          dataEncerramentoInscricao: parseDataInput(d.dataEncerramentoInscricao),
        },
      });
      await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'edital.atualizado', entidade: 'edital', entidadeId: id, ip: request.ip });
      reply.flash('sucesso', 'Edital atualizado.');
      return reply.redirect(`/admin/editais/${id}`);
    } catch (e) {
      if (e.code === 'P2002') {
        reply.code(409);
        return reply.render('admin-edital-form', { titulo: `Editar ${edital.numero}`, edital, config: configFasesDoForm(body), rotulos: ROTULOS_FASES, valores: body, erros: { numero: 'Já existe um edital com este número.' } });
      }
      throw e;
    }
  });

  // Cargos
  fastify.post('/editais/:id/cargos', { preHandler: csrfGuard }, async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id } });
    if (!edital) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' }); }
    const parsed = cargoSchema.safeParse(request.body || {});
    if (!parsed.success) {
      reply.flash('erro', Object.values(errosZod(parsed))[0] || 'Dados do cargo inválidos.');
      return reply.redirect(`/admin/editais/${id}`);
    }
    const d = parsed.data;
    await prisma.cargo.create({ data: { editalId: id, nome: d.nome, descricao: d.descricao || null, qtdVagas: d.qtdVagas, requisitos: d.requisitos || null, salario: d.salario, cargaHoraria: d.cargaHoraria || null } });
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'cargo.criado', entidade: 'edital', entidadeId: id, detalhes: { cargo: d.nome }, ip: request.ip });
    reply.flash('sucesso', 'Cargo adicionado.');
    return reply.redirect(`/admin/editais/${id}`);
  });

  fastify.post('/cargos/:id/excluir', { preHandler: csrfGuard }, async (request, reply) => {
    const cargoId = Number(request.params.id);
    const cargo = await prisma.cargo.findUnique({ where: { id: cargoId }, include: { _count: { select: { inscricoes: true } } } });
    if (!cargo) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Cargo não encontrado' }); }
    if (cargo._count.inscricoes > 0) {
      reply.flash('erro', 'Não é possível excluir um cargo que já possui inscrições.');
      return reply.redirect(`/admin/editais/${cargo.editalId}`);
    }
    await prisma.cargo.delete({ where: { id: cargoId } });
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'cargo.excluido', entidade: 'edital', entidadeId: cargo.editalId, detalhes: { cargo: cargo.nome }, ip: request.ip });
    reply.flash('sucesso', 'Cargo excluído.');
    return reply.redirect(`/admin/editais/${cargo.editalId}`);
  });

  // Publicar
  fastify.post('/editais/:id/publicar', { preHandler: csrfGuard }, async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id }, include: { _count: { select: { cargos: true } } } });
    if (!edital) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' }); }
    if (edital.status !== 'rascunho') { reply.flash('erro', 'Apenas editais em rascunho podem ser publicados.'); return reply.redirect(`/admin/editais/${id}`); }
    if (edital._count.cargos === 0) { reply.flash('erro', 'Adicione ao menos um cargo antes de publicar.'); return reply.redirect(`/admin/editais/${id}`); }
    await prisma.edital.update({ where: { id }, data: { status: 'publicado' } });
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'edital.publicado', entidade: 'edital', entidadeId: id, ip: request.ip });
    reply.flash('sucesso', 'Edital publicado. Já aparece na vitrine pública.');
    return reply.redirect(`/admin/editais/${id}`);
  });

  // Encerrar
  fastify.post('/editais/:id/encerrar', { preHandler: csrfGuard }, async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id } });
    if (!edital) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' }); }
    if (edital.status !== 'publicado') { reply.flash('erro', 'Apenas editais publicados podem ser encerrados.'); return reply.redirect(`/admin/editais/${id}`); }
    await prisma.edital.update({ where: { id }, data: { status: 'encerrado' } });
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'edital.encerrado', entidade: 'edital', entidadeId: id, ip: request.ip });
    reply.flash('sucesso', 'Edital encerrado. Não recebe novas inscrições.');
    return reply.redirect(`/admin/editais/${id}`);
  });

  // Expurgo LGPD — apaga documentos das inscrições não homologadas (premissa 10, §6)
  fastify.post('/editais/:id/expurgar', { preHandler: csrfGuard }, async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id } });
    if (!edital) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' }); }
    if (edital.status !== 'encerrado') { reply.flash('erro', 'Encerre o edital antes de expurgar os documentos.'); return reply.redirect(`/admin/editais/${id}`); }

    const inscNaoHomologadas = await prisma.inscricao.findMany({
      where: { editalId: id, status: { not: 'homologada' } },
      select: { id: true, documentos: { select: { id: true, arquivoPath: true } }, recursos: { select: { id: true, anexoPath: true } } },
    });
    const docIds = [];
    const arquivos = [];
    for (const i of inscNaoHomologadas) {
      for (const d of i.documentos) { docIds.push(d.id); if (d.arquivoPath) arquivos.push(d.arquivoPath); }
      for (const r of i.recursos) { if (r.anexoPath) arquivos.push(r.anexoPath); }
    }
    if (docIds.length) await prisma.documento.deleteMany({ where: { id: { in: docIds } } });
    if (inscNaoHomologadas.length) {
      await prisma.recurso.updateMany({ where: { inscricaoId: { in: inscNaoHomologadas.map((i) => i.id) }, anexoPath: { not: null } }, data: { anexoPath: null } });
    }
    await Promise.all(arquivos.map((a) => removerArquivo(a).catch(() => {})));
    await prisma.edital.update({ where: { id }, data: { status: 'expurgado' } });
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'edital.expurgado', entidade: 'edital', entidadeId: id, detalhes: { documentosRemovidos: arquivos.length, inscricoesAfetadas: inscNaoHomologadas.length }, ip: request.ip });
    reply.flash('sucesso', `Expurgo concluído: ${arquivos.length} arquivo(s) removido(s) de inscrições não homologadas.`);
    return reply.redirect(`/admin/editais/${id}`);
  });
}
