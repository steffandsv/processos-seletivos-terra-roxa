// Autenticação do candidato (§5.1): cadastro, verificação de e-mail, login,
// logout e recuperação de senha.
import prisma from '../db.js';
import { csrfGuard, setSessao, limparSessao, requireCandidato } from '../plugins/auth.js';
import { hashSenha, authProvider } from '../lib/seguranca.js';
import { tokenAleatorio, hashToken, gerarCodigoNumerico } from '../lib/crypto.js';
import { registrarAuditoria } from '../lib/audit.js';
import { enviarVerificacaoEmail, enviarResetSenha } from '../lib/email.js';
import config from '../config.js';
import {
  cadastroSchema,
  loginSchema,
  esqueciSenhaSchema,
  resetSenhaSchema,
  errosZod,
} from '../lib/validators.js';

const RL_LOGIN = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

function montarEndereco(body) {
  return {
    cep: body.endereco_cep || '',
    logradouro: body.endereco_logradouro || '',
    numero: body.endereco_numero || '',
    complemento: body.endereco_complemento || '',
    bairro: body.endereco_bairro || '',
    cidade: body.endereco_cidade || '',
    uf: body.endereco_uf || '',
  };
}

function enderecoVazio(e) {
  return !e || Object.values(e).every((v) => !v || !String(v).trim());
}

export default async function rotasAuthCandidato(fastify) {
  // ----- Cadastro -----
  fastify.get('/cadastro', async (request, reply) => {
    if (request.sessao?.tipo === 'candidato') return reply.redirect('/minha-conta');
    return reply.render('cadastro', { titulo: 'Criar conta', valores: {}, erros: {} });
  });

  fastify.post('/cadastro', { preHandler: csrfGuard }, async (request, reply) => {
    const body = request.body || {};
    body.endereco = montarEndereco(body);
    const parsed = cadastroSchema.safeParse(body);
    if (!parsed.success) {
      reply.code(400);
      return reply.render('cadastro', { titulo: 'Criar conta', valores: body, erros: errosZod(parsed) });
    }
    const d = parsed.data;

    // Unicidade de CPF e e-mail
    const existente = await prisma.candidato.findFirst({ where: { OR: [{ cpf: d.cpf }, { email: d.email }] } });
    if (existente) {
      const erros = {};
      if (existente.cpf === d.cpf) erros.cpf = 'Já existe uma conta com este CPF.';
      if (existente.email === d.email) erros.email = 'Já existe uma conta com este e-mail.';
      reply.code(409);
      return reply.render('cadastro', { titulo: 'Criar conta', valores: body, erros });
    }

    const token = tokenAleatorio(32);
    const candidato = await prisma.candidato.create({
      data: {
        nomeCompleto: d.nomeCompleto,
        cpf: d.cpf,
        email: d.email,
        telefone: d.telefone || null,
        endereco: enderecoVazio(d.endereco) ? undefined : d.endereco,
        temDeficiencia: d.temDeficiencia || false,
        descricaoDeficiencia: d.temDeficiencia ? (d.descricaoDeficiencia || null) : null,
        senhaHash: await hashSenha(d.senha),
        emailVerificado: false,
        emailTokenHash: hashToken(token),
        emailTokenExpiraEm: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });

    await registrarAuditoria({ ator: 'candidato', atorId: candidato.id, acao: 'candidato.cadastro', entidade: 'candidato', entidadeId: candidato.id, ip: request.ip });
    await enviarVerificacaoEmail({ candidato, url: `${config.baseUrl}/verificar-email?token=${token}` });

    setSessao(reply, { tipo: 'candidato', id: candidato.id, nome: candidato.nomeCompleto, emailVerificado: false });
    reply.flash('sucesso', 'Conta criada! Enviamos um link de confirmação para o seu e-mail.');
    return reply.redirect('/minha-conta');
  });

  // ----- Verificação de e-mail -----
  fastify.get('/verificar-email', async (request, reply) => {
    const token = String(request.query.token || '');
    if (!token) {
      reply.flash('erro', 'Link de verificação inválido.');
      return reply.redirect('/');
    }
    const candidato = await prisma.candidato.findFirst({
      where: { emailTokenHash: hashToken(token), emailTokenExpiraEm: { gt: new Date() } },
    });
    if (!candidato) {
      reply.flash('erro', 'Link de verificação inválido ou expirado. Faça login e reenvie a confirmação.');
      return reply.redirect('/login');
    }
    await prisma.candidato.update({
      where: { id: candidato.id },
      data: { emailVerificado: true, emailTokenHash: null, emailTokenExpiraEm: null },
    });
    await registrarAuditoria({ ator: 'candidato', atorId: candidato.id, acao: 'candidato.email_verificado', entidade: 'candidato', entidadeId: candidato.id, ip: request.ip });
    if (request.sessao?.tipo === 'candidato' && request.sessao.id === candidato.id) {
      setSessao(reply, { ...request.sessao, emailVerificado: true });
    }
    reply.flash('sucesso', 'E-mail confirmado com sucesso! Agora você pode se inscrever.');
    return reply.redirect(request.sessao?.tipo === 'candidato' ? '/minha-conta' : '/login');
  });

  fastify.post('/reenviar-verificacao', { preHandler: [requireCandidato, csrfGuard] }, async (request, reply) => {
    const candidato = await prisma.candidato.findUnique({ where: { id: request.sessao.id } });
    if (!candidato) { limparSessao(reply); return reply.redirect('/login'); }
    if (candidato.emailVerificado) {
      reply.flash('info', 'Seu e-mail já está confirmado.');
      return reply.redirect('/minha-conta');
    }
    const token = tokenAleatorio(32);
    await prisma.candidato.update({
      where: { id: candidato.id },
      data: { emailTokenHash: hashToken(token), emailTokenExpiraEm: new Date(Date.now() + 48 * 60 * 60 * 1000) },
    });
    await enviarVerificacaoEmail({ candidato, url: `${config.baseUrl}/verificar-email?token=${token}` });
    reply.flash('sucesso', 'Enviamos um novo link de confirmação para o seu e-mail.');
    return reply.redirect('/minha-conta');
  });

  // ----- Login / logout -----
  fastify.get('/login', async (request, reply) => {
    if (request.sessao?.tipo === 'candidato') return reply.redirect('/minha-conta');
    return reply.render('login', { titulo: 'Entrar', valores: {}, erros: {}, next: request.query.next || '' });
  });

  fastify.post('/login', { preHandler: csrfGuard, ...RL_LOGIN }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body || {});
    const next = typeof request.body?.next === 'string' ? request.body.next : '';
    if (!parsed.success) {
      reply.code(400);
      return reply.render('login', { titulo: 'Entrar', valores: request.body, erros: errosZod(parsed), next });
    }
    const candidato = await authProvider.autenticar(parsed.data.email, parsed.data.senha);
    if (!candidato) {
      await registrarAuditoria({ ator: 'sistema', acao: 'candidato.login_falha', detalhes: { email: parsed.data.email }, ip: request.ip });
      reply.code(401);
      return reply.render('login', { titulo: 'Entrar', valores: { email: parsed.data.email }, erros: { _: 'E-mail ou senha incorretos.' }, next });
    }
    setSessao(reply, { tipo: 'candidato', id: candidato.id, nome: candidato.nomeCompleto, emailVerificado: candidato.emailVerificado });
    await registrarAuditoria({ ator: 'candidato', atorId: candidato.id, acao: 'candidato.login', ip: request.ip });
    reply.flash('sucesso', `Bem-vindo(a), ${candidato.nomeCompleto.split(' ')[0]}.`);
    const destino = next && next.startsWith('/') ? next : '/minhas-inscricoes';
    return reply.redirect(destino);
  });

  fastify.post('/logout', { preHandler: csrfGuard }, async (request, reply) => {
    if (request.sessao?.tipo === 'candidato') {
      await registrarAuditoria({ ator: 'candidato', atorId: request.sessao.id, acao: 'candidato.logout', ip: request.ip });
    }
    limparSessao(reply);
    reply.flash('info', 'Sessão encerrada.');
    return reply.redirect('/');
  });

  // ----- Recuperação de senha -----
  fastify.get('/esqueci-senha', async (_request, reply) =>
    reply.render('esqueci-senha', { titulo: 'Recuperar senha', valores: {}, erros: {} }));

  fastify.post('/esqueci-senha', { preHandler: csrfGuard, ...RL_LOGIN }, async (request, reply) => {
    const parsed = esqueciSenhaSchema.safeParse(request.body || {});
    if (!parsed.success) {
      reply.code(400);
      return reply.render('esqueci-senha', { titulo: 'Recuperar senha', valores: request.body, erros: errosZod(parsed) });
    }
    const email = parsed.data.email;
    const candidato = await prisma.candidato.findUnique({ where: { email } });
    if (candidato) {
      const codigo = gerarCodigoNumerico(6);
      await prisma.candidato.update({
        where: { id: candidato.id },
        data: { resetTokenHash: hashToken(codigo), resetTokenExpiraEm: new Date(Date.now() + 30 * 60 * 1000) },
      });
      await enviarResetSenha({ candidato, codigo, url: `${config.baseUrl}/redefinir-senha?email=${encodeURIComponent(email)}` });
      await registrarAuditoria({ ator: 'candidato', atorId: candidato.id, acao: 'candidato.reset_solicitado', ip: request.ip });
    }
    // Mensagem genérica — não revela se o e-mail existe (anti-enumeração).
    reply.flash('info', 'Se o e-mail estiver cadastrado, enviamos um código de 6 dígitos. Confira sua caixa de entrada e também o spam/lixo eletrônico.');
    return reply.redirect(`/redefinir-senha?email=${encodeURIComponent(email)}`);
  });

  fastify.get('/redefinir-senha', async (request, reply) => {
    const email = String(request.query.email || '');
    return reply.render('redefinir-senha', { titulo: 'Redefinir senha', valores: { email }, erros: {} });
  });

  fastify.post('/redefinir-senha', { preHandler: csrfGuard, ...RL_LOGIN }, async (request, reply) => {
    const parsed = resetSenhaSchema.safeParse(request.body || {});
    if (!parsed.success) {
      reply.code(400);
      return reply.render('redefinir-senha', { titulo: 'Redefinir senha', valores: request.body || {}, erros: errosZod(parsed) });
    }
    const candidato = await prisma.candidato.findFirst({
      where: { email: parsed.data.email, resetTokenHash: hashToken(parsed.data.codigo), resetTokenExpiraEm: { gt: new Date() } },
    });
    if (!candidato) {
      await registrarAuditoria({ ator: 'sistema', acao: 'candidato.reset_codigo_invalido', detalhes: { email: parsed.data.email }, ip: request.ip });
      reply.code(400);
      return reply.render('redefinir-senha', { titulo: 'Redefinir senha', valores: { email: parsed.data.email }, erros: { codigo: 'Código inválido ou expirado. Solicite um novo.' } });
    }
    await prisma.candidato.update({
      where: { id: candidato.id },
      data: { senhaHash: await hashSenha(parsed.data.novaSenha), resetTokenHash: null, resetTokenExpiraEm: null },
    });
    await registrarAuditoria({ ator: 'candidato', atorId: candidato.id, acao: 'candidato.senha_redefinida', ip: request.ip });
    reply.flash('sucesso', 'Senha redefinida com sucesso. Faça login com a nova senha.');
    return reply.redirect('/login');
  });
}
