// Portal público (§5.1): vitrine, página do edital, listas públicas,
// download de publicações oficiais, Aviso de Privacidade e Termos.
import prisma from '../db.js';
import { flagsEdital, inscricoesAbertas } from '../lib/web.js';
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

  // Lista pública de inscritos homologados — APENAS nome + nº inscrição (§6)
  fastify.get('/editais/:id/inscritos', async (request, reply) => {
    const id = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id }, include: { cargos: { orderBy: { nome: 'asc' } } } });
    if (!edital || edital.status === 'rascunho' || edital.status === 'expurgado') {
      reply.code(404);
      return reply.render('nao-encontrado', { titulo: 'Edital não encontrado' });
    }
    const flags = flagsEdital(edital);
    // Se há homologação, lista os homologados; senão, os enviados.
    const statusAlvo = flags.fase_homologacao ? ['homologada'] : ['enviada', 'em_analise', 'homologada'];
    const inscritos = await prisma.inscricao.findMany({
      where: { editalId: id, status: { in: statusAlvo } },
      // Selecionamos SOMENTE o necessário — nunca CPF, nunca deficiência.
      select: {
        numeroInscricao: true,
        cargo: { select: { nome: true } },
        candidato: { select: { nomeCompleto: true } },
      },
      orderBy: [{ cargo: { nome: 'asc' } }, { numeroInscricao: 'asc' }],
    });
    return reply.render('public-inscritos', {
      titulo: `Inscritos — ${edital.numero}`,
      edital,
      inscritos,
      homologacao: flags.fase_homologacao,
    });
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
