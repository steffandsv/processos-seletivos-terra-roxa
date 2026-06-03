// Login da conta administradora (única e compartilhada — premissa/§4).
import prisma from '../../db.js';
import { csrfGuard, setSessao, limparSessao } from '../../plugins/auth.js';
import { verificarSenha } from '../../lib/seguranca.js';
import { adminLoginSchema, errosZod } from '../../lib/validators.js';
import { registrarAuditoria } from '../../lib/audit.js';

const RL_LOGIN = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export default async function adminAuth(fastify) {
  fastify.get('/login', async (request, reply) => {
    if (request.sessao?.tipo === 'admin') return reply.redirect('/admin');
    return reply.render('admin-login', { titulo: 'Acesso administrativo', valores: {}, erros: {}, next: request.query.next || '' });
  });

  fastify.post('/login', { preHandler: csrfGuard, ...RL_LOGIN }, async (request, reply) => {
    const parsed = adminLoginSchema.safeParse(request.body || {});
    const next = typeof request.body?.next === 'string' ? request.body.next : '';
    if (!parsed.success) {
      reply.code(400);
      return reply.render('admin-login', { titulo: 'Acesso administrativo', valores: request.body, erros: errosZod(parsed), next });
    }
    const admin = await prisma.usuarioAdmin.findUnique({ where: { email: parsed.data.email } });
    const ok = admin && (await verificarSenha(admin.senhaHash, parsed.data.senha));
    if (!ok) {
      await registrarAuditoria({ ator: 'sistema', acao: 'admin.login_falha', detalhes: { email: parsed.data.email }, ip: request.ip });
      reply.code(401);
      return reply.render('admin-login', { titulo: 'Acesso administrativo', valores: { email: parsed.data.email }, erros: { _: 'Credenciais inválidas.' }, next });
    }
    setSessao(reply, { tipo: 'admin', id: admin.id, nome: admin.nome, email: admin.email });
    await registrarAuditoria({ ator: 'admin', atorId: admin.id, acao: 'admin.login', ip: request.ip });
    return reply.redirect(next && next.startsWith('/admin') ? next : '/admin');
  });

  fastify.post('/logout', { preHandler: csrfGuard }, async (request, reply) => {
    if (request.sessao?.tipo === 'admin') {
      await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'admin.logout', ip: request.ip });
    }
    limparSessao(reply);
    reply.flash('info', 'Sessão administrativa encerrada.');
    return reply.redirect('/admin/login');
  });
}
