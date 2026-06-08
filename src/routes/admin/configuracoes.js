// Configuração de SMTP gerenciável pelo admin (evita SPAM: SSL/TLS,
// autenticação e From alinhado ao domínio). Senha cifrada em repouso.
import prisma from '../../db.js';
import config from '../../config.js';
import { csrfGuard } from '../../plugins/auth.js';
import { configSmtpSchema, emailTesteSchema, errosZod } from '../../lib/validators.js';
import { encryptBuffer } from '../../lib/crypto.js';
import { registrarAuditoria } from '../../lib/audit.js';
import { resetTransporter, enviarEmailTeste } from '../../lib/email.js';

async function carregar() {
  return prisma.configuracao.findUnique({ where: { id: 1 } });
}

export default async function adminConfiguracoes(fastify) {
  fastify.get('/configuracoes', async (request, reply) => {
    const cfg = await carregar();
    return reply.render('admin-configuracoes', {
      titulo: 'Configurações',
      cfg,
      temSenha: Boolean(cfg?.smtpPassCifrada),
      usandoEnv: !cfg?.smtpHost && Boolean(config.smtp.host),
      semSmtp: !cfg?.smtpHost && !config.smtp.host,
      adminEmail: request.sessao.email,
      erros: {},
      valores: {},
    });
  });

  fastify.post('/configuracoes', { preHandler: csrfGuard }, async (request, reply) => {
    const body = request.body || {};
    const parsed = configSmtpSchema.safeParse(body);
    const cfgAtual = await carregar();
    if (!parsed.success) {
      reply.code(400);
      return reply.render('admin-configuracoes', { titulo: 'Configurações', cfg: cfgAtual, temSenha: Boolean(cfgAtual?.smtpPassCifrada), usandoEnv: false, semSmtp: false, adminEmail: request.sessao.email, erros: errosZod(parsed), valores: body });
    }
    const d = parsed.data;
    const smtpSecure = body.smtpSecure === 'on';

    // Senha: só atualiza se foi digitada; senão mantém a cifrada existente.
    let smtpPassCifrada = cfgAtual?.smtpPassCifrada || null;
    if (d.smtpPass) {
      smtpPassCifrada = encryptBuffer(Buffer.from(d.smtpPass, 'utf8')).toString('base64');
    } else if (body.limparSenha === 'on') {
      smtpPassCifrada = null;
    }

    const dados = {
      smtpHost: d.smtpHost || null,
      smtpPort: d.smtpPort,
      smtpSecure,
      smtpUser: d.smtpUser || null,
      smtpPassCifrada,
      smtpFrom: d.smtpFrom || null,
    };
    await prisma.configuracao.upsert({ where: { id: 1 }, update: dados, create: { id: 1, ...dados } });
    resetTransporter();
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'configuracao.smtp_atualizada', entidade: 'configuracao', entidadeId: 1, detalhes: { host: dados.smtpHost, port: dados.smtpPort, secure: smtpSecure }, ip: request.ip });
    reply.flash('sucesso', 'Configuração de SMTP salva. Use o teste abaixo para validar o envio.');
    return reply.redirect('/admin/configuracoes');
  });

  fastify.post('/configuracoes/teste', { preHandler: csrfGuard }, async (request, reply) => {
    const parsed = emailTesteSchema.safeParse(request.body || {});
    if (!parsed.success) {
      reply.flash('erro', Object.values(errosZod(parsed))[0] || 'E-mail inválido.');
      return reply.redirect('/admin/configuracoes');
    }
    resetTransporter(); // garante uso da config recém-salva
    const { status, erro } = await enviarEmailTeste(parsed.data.destino);
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'configuracao.smtp_teste', detalhes: { destino: parsed.data.destino, status, erro }, ip: request.ip });
    if (status === 'enviado') reply.flash('sucesso', `E-mail de teste enviado para ${parsed.data.destino}. Verifique a caixa de entrada e também o spam/lixo eletrônico.`);
    else reply.flash('erro', `Falha ao enviar: ${erro || 'erro desconhecido'}. Confira host, porta, usuário/senha e SSL/TLS. (Se trocou de ambiente, recadastre a senha do SMTP aqui.)`);
    return reply.redirect('/admin/configuracoes');
  });
}
