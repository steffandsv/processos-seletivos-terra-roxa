// Portal público (§5.1): vitrine, página do edital, listas públicas,
// download de publicações oficiais, Aviso de Privacidade e Termos.
import prisma from '../db.js';
import { flagsEdital, inscricoesAbertas, paginacao } from '../lib/web.js';
import { lerArquivo } from '../lib/upload.js';

export default async function rotasPublicas(fastify) {
  // Vitrine de oportunidades
  fastify.get('/', async (request, reply) => {
    const editais = await prisma.edital.findMany({
      where: { status: 'publicado' },
      orderBy: { criadoEm: 'desc' },
      include: { _count: { select: { cargos: true } } },
    });
    return reply.render('public-home', { titulo: 'Editais', editais, inscricoesAbertas });
  });

  // Página do edital
  fastify.get('/editais/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({
      where: { id },
      include: {
        cargos: { orderBy: { nome: 'asc' } },
        publicacoes: { orderBy: { publicadoEm: 'desc' } },
      },
    });
    if (!edital || (edital.status !== 'publicado' && edital.status !== 'encerrado')) {
      reply.code(404);
      return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' });
    }
    return reply.render('public-edital', {
      titulo: `${edital.numero} — ${edital.titulo}`,
      edital,
      flags: flagsEdital(edital),
      aberto: inscricoesAbertas(edital),
    });
  });

  // Inscrições "ativas" que entram na concorrência e nas listas públicas.
  const STATUS_ATIVAS = ['enviada', 'em_analise', 'homologada'];

  // Lista pública de inscritos — APENAS nome + nº inscrição (§6). Filtrável por cargo.
  fastify.get('/editais/:id/inscritos', async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id }, include: { cargos: { orderBy: { nome: 'asc' } } } });
    if (!edital || edital.status === 'rascunho' || edital.status === 'expurgado') {
      reply.code(404);
      return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' });
    }
    const filtroCargo = request.query.cargo && edital.cargos.some((c) => c.id === Number(request.query.cargo)) ? Number(request.query.cargo) : null;
    const where = { editalId: id, status: { in: STATUS_ATIVAS } };
    if (filtroCargo) where.cargoId = filtroCargo;
    const { pagina, porPagina, skip, take } = paginacao(request.query, 50);
    const [inscritos, total] = await Promise.all([
      prisma.inscricao.findMany({
        where,
        // Selecionamos SOMENTE o necessário — nunca CPF, nunca deficiência.
        select: {
          numeroInscricao: true,
          cargo: { select: { id: true, nome: true } },
          candidato: { select: { nomeCompleto: true } },
        },
        orderBy: [{ cargo: { nome: 'asc' } }, { numeroInscricao: 'asc' }],
        skip, take,
      }),
      prisma.inscricao.count({ where }),
    ]);
    return reply.render('public-inscritos', { titulo: `Inscritos — ${edital.numero}`, edital, inscritos, filtroCargo, pagina, porPagina, total });
  });

  // Concorrência por vaga (candidatos ativos / vagas) — visão pública.
  fastify.get('/editais/:id/concorrencia', async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id }, include: { cargos: { orderBy: { nome: 'asc' } } } });
    if (!edital || edital.status === 'rascunho' || edital.status === 'expurgado') {
      reply.code(404);
      return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' });
    }
    const grupos = await prisma.inscricao.groupBy({ by: ['cargoId'], where: { editalId: id, status: { in: STATUS_ATIVAS } }, _count: true });
    const porCargo = new Map(grupos.map((g) => [g.cargoId, g._count]));
    const linhas = edital.cargos
      .map((c) => {
        const inscritos = porCargo.get(c.id) || 0;
        const vagas = c.qtdVagas || 0;
        return { cargo: c, inscritos, vagas, ratio: vagas > 0 ? inscritos / vagas : null };
      })
      .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.inscritos - a.inscritos);
    const maxRatio = Math.max(1, ...linhas.map((l) => l.ratio || 0));
    const totalInscritos = linhas.reduce((s, l) => s + l.inscritos, 0);
    return reply.render('public-concorrencia', { titulo: `Concorrência — ${edital.numero}`, edital, linhas, maxRatio, totalInscritos });
  });

  // Download do PDF oficial do edital (público quando publicado/encerrado;
  // admin pode baixar mesmo em rascunho para conferência)
  fastify.get('/editais/:id/edital', async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id } });
    const ehAdmin = request.sessao?.tipo === 'admin';
    const visivel = edital && (['publicado', 'encerrado'].includes(edital.status) || ehAdmin);
    if (!edital || !edital.editalArquivoPath || !visivel) {
      reply.code(404);
      return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' });
    }
    let conteudo;
    try {
      conteudo = await lerArquivo(edital.editalArquivoPath);
    } catch {
      reply.code(404);
      return reply.render('nao-encontrado', { titulo: 'Arquivo indisponível' });
    }
    reply.header('Content-Type', edital.editalMime || 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="${(edital.editalNomeOriginal || `edital-${edital.numero}.pdf`).replace(/"/g, '')}"`);
    return reply.send(conteudo);
  });

  // Download público de uma publicação oficial
  fastify.get('/publicacoes/:id/arquivo', async (request, reply) => {
    const id = Number(request.params.id);
    const pub = await prisma.publicacao.findUnique({ where: { id }, include: { edital: true } });
    if (!pub || pub.edital.status === 'rascunho' || pub.edital.status === 'expurgado') {
      reply.code(404);
      return reply.render('nao-encontrado', { titulo: 'Publicação não encontrada' });
    }
    let conteudo;
    try {
      conteudo = await lerArquivo(pub.arquivoPath);
    } catch {
      reply.code(404);
      return reply.render('nao-encontrado', { titulo: 'Arquivo indisponível' });
    }
    reply.header('Content-Type', pub.mime || 'application/octet-stream');
    reply.header('Content-Disposition', `inline; filename="${(pub.nomeOriginal || 'publicacao').replace(/"/g, '')}"`);
    return reply.send(conteudo);
  });

  // Aviso de Privacidade (§6) e Termos de Uso — páginas versionadas
  fastify.get('/aviso-de-privacidade', async (_request, reply) =>
    reply.render('public-privacidade', { titulo: 'Aviso de Privacidade' }));

  fastify.get('/termos-de-uso', async (_request, reply) =>
    reply.render('public-termos', { titulo: 'Termos de Uso' }));
}
