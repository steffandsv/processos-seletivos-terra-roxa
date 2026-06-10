// Gestão de candidatos pelo admin: buscar, editar dados/e-mail, confirmar
// conta, resetar senha e excluir (com remoção dos arquivos do storage).
import prisma from '../../db.js';
import { csrfGuard } from '../../plugins/auth.js';
import { adminCandidatoSchema, adminSenhaSchema, errosZod } from '../../lib/validators.js';
import { paginacao } from '../../lib/web.js';
import { hashSenha } from '../../lib/seguranca.js';
import { removerArquivo } from '../../lib/upload.js';
import { registrarAuditoria } from '../../lib/audit.js';

function montarEndereco(body) {
  return {
    cep: body.endereco_cep || '', logradouro: body.endereco_logradouro || '', numero: body.endereco_numero || '',
    complemento: body.endereco_complemento || '', bairro: body.endereco_bairro || '', cidade: body.endereco_cidade || '', uf: body.endereco_uf || '',
  };
}
const enderecoVazio = (e) => !e || Object.values(e).every((v) => !v || !String(v).trim());

function carregar(id) {
  return prisma.candidato.findUnique({
    where: { id },
    include: {
      inscricoes: {
        orderBy: { criadoEm: 'desc' },
        include: { edital: { select: { id: true, numero: true } }, cargo: { select: { nome: true } } },
      },
    },
  });
}

export default async function adminCandidatos(fastify) {
  // Lista + busca
  fastify.get('/candidatos', async (request, reply) => {
    const busca = String(request.query.busca || '').trim();
    const termos = [];
    if (busca) {
      termos.push({ nomeCompleto: { contains: busca, mode: 'insensitive' } });
      termos.push({ email: { contains: busca, mode: 'insensitive' } });
      const dig = busca.replace(/\D/g, '');
      if (dig) termos.push({ cpf: { contains: dig } });
    }
    const where = termos.length ? { OR: termos } : {};
    const { pagina, porPagina, skip, take } = paginacao(request.query, 30);
    const [candidatos, total] = await Promise.all([
      prisma.candidato.findMany({ where, orderBy: { criadoEm: 'desc' }, skip, take, include: { _count: { select: { inscricoes: true } } } }),
      prisma.candidato.count({ where }),
    ]);
    return reply.render('admin-candidatos', { titulo: 'Candidatos', candidatos, total, pagina, porPagina, busca });
  });

  // Detalhe / edição
  fastify.get('/candidatos/:id', async (request, reply) => {
    const candidato = await carregar(Number(request.params.id));
    if (!candidato) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Candidato não encontrado' }); }
    return reply.render('admin-candidato', { titulo: candidato.nomeCompleto, candidato, erros: {}, valores: {} });
  });

  // Atualizar dados / e-mail / confirmação
  fastify.post('/candidatos/:id', { preHandler: csrfGuard }, async (request, reply) => {
    const id = Number(request.params.id);
    const candidato = await carregar(id);
    if (!candidato) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Candidato não encontrado' }); }
    const body = request.body || {};
    body.endereco = montarEndereco(body);
    const parsed = adminCandidatoSchema.safeParse(body);
    if (!parsed.success) {
      reply.code(400);
      return reply.render('admin-candidato', { titulo: candidato.nomeCompleto, candidato, erros: errosZod(parsed), valores: body });
    }
    const d = parsed.data;
    if (d.email !== candidato.email) {
      const existe = await prisma.candidato.findFirst({ where: { email: d.email, NOT: { id } } });
      if (existe) {
        reply.code(409);
        return reply.render('admin-candidato', { titulo: candidato.nomeCompleto, candidato, erros: { email: 'Já existe outra conta com este e-mail.' }, valores: body });
      }
    }
    const temDeficiencia = body.temDeficiencia === 'on';
    const emailVerificado = body.emailVerificado === 'on';
    await prisma.candidato.update({
      where: { id },
      data: {
        nomeCompleto: d.nomeCompleto,
        email: d.email,
        telefone: d.telefone || null,
        endereco: enderecoVazio(d.endereco) ? undefined : d.endereco,
        temDeficiencia,
        descricaoDeficiencia: temDeficiencia ? (d.descricaoDeficiencia || null) : null,
        emailVerificado,
        ...(emailVerificado ? { emailTokenHash: null, emailTokenExpiraEm: null } : {}),
      },
    });
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'candidato.editado_admin', entidade: 'candidato', entidadeId: id, detalhes: { emailDe: candidato.email, emailPara: d.email, emailVerificado }, ip: request.ip });
    reply.flash('sucesso', 'Cadastro atualizado.');
    return reply.redirect(`/admin/candidatos/${id}`);
  });

  // Resetar senha
  fastify.post('/candidatos/:id/senha', { preHandler: csrfGuard }, async (request, reply) => {
    const id = Number(request.params.id);
    const candidato = await carregar(id);
    if (!candidato) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Candidato não encontrado' }); }
    const parsed = adminSenhaSchema.safeParse(request.body || {});
    if (!parsed.success) {
      reply.code(400);
      return reply.render('admin-candidato', { titulo: candidato.nomeCompleto, candidato, erros: errosZod(parsed), valores: {}, abaSenha: true });
    }
    await prisma.candidato.update({ where: { id }, data: { senhaHash: await hashSenha(parsed.data.novaSenha), resetTokenHash: null, resetTokenExpiraEm: null } });
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'candidato.senha_resetada_admin', entidade: 'candidato', entidadeId: id, ip: request.ip });
    reply.flash('sucesso', `Senha redefinida. Informe a nova senha ao candidato (${candidato.email}).`);
    return reply.redirect(`/admin/candidatos/${id}`);
  });

  // Excluir (com remoção dos arquivos do storage)
  fastify.post('/candidatos/:id/excluir', { preHandler: csrfGuard }, async (request, reply) => {
    const id = Number(request.params.id);
    const candidato = await prisma.candidato.findUnique({
      where: { id },
      include: { inscricoes: { include: { documentos: true, recursos: true } } },
    });
    if (!candidato) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Candidato não encontrado' }); }
    const arquivos = [];
    for (const i of candidato.inscricoes) {
      for (const doc of i.documentos) if (doc.arquivoPath) arquivos.push(doc.arquivoPath);
      for (const r of i.recursos) if (r.anexoPath) arquivos.push(r.anexoPath);
    }
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'candidato.excluido', entidade: 'candidato', entidadeId: id, detalhes: { nome: candidato.nomeCompleto, email: candidato.email, inscricoes: candidato.inscricoes.length, arquivos: arquivos.length }, ip: request.ip });
    await prisma.candidato.delete({ where: { id } });
    await Promise.all(arquivos.map((a) => removerArquivo(a).catch(() => {})));
    reply.flash('sucesso', `Cadastro de ${candidato.nomeCompleto} excluído (${arquivos.length} arquivo(s) removido(s)).`);
    return reply.redirect('/admin/candidatos');
  });
}
