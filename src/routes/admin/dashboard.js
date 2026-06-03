// Painel inicial do admin: visão geral e atalhos.
import prisma from '../../db.js';

export default async function adminDashboard(fastify) {
  fastify.get('/', async (_request, reply) => {
    const [editais, totalCandidatos, totalInscricoes, recursosAbertos] = await Promise.all([
      prisma.edital.findMany({ orderBy: { criadoEm: 'desc' }, include: { _count: { select: { inscricoes: true, cargos: true } } } }),
      prisma.candidato.count(),
      prisma.inscricao.count(),
      prisma.recurso.count({ where: { status: 'aberto' } }),
    ]);
    const porStatus = editais.reduce((acc, e) => { acc[e.status] = (acc[e.status] || 0) + 1; return acc; }, {});
    return reply.render('admin-dashboard', {
      titulo: 'Painel',
      editais,
      stats: { totalCandidatos, totalInscricoes, recursosAbertos, totalEditais: editais.length, porStatus },
    });
  });
}
