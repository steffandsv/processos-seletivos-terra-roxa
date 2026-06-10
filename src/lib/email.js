// Camada de e-mail — nodemailer + SMTP por variável de ambiente.
// Sem fila dedicada: envio com retry simples (premissa 6 / §3).
// Todo envio é registrado em notificacao_email (peso jurídico §4).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import ejs from 'ejs';
import config from '../config.js';
import prisma from '../db.js';
import { formatarCpf } from './cpf.js';
import { decryptBuffer } from './crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const emailsDir = path.join(__dirname, '..', 'views', 'emails');

// Cache do transporter: { transporter, from, devMode }. Precedência da config:
// 1) tabela `configuracao` (gerenciada pelo admin)  2) variáveis de ambiente
// 3) modo desenvolvimento (não envia; apenas registra).
let _cache = null;

/** Invalida o cache (chamar após o admin salvar a configuração de SMTP). */
export function resetTransporter() {
  _cache = null;
}

function decifrarSenhaSmtp(cifrada) {
  if (!cifrada) return undefined;
  try {
    return decryptBuffer(Buffer.from(cifrada, 'base64')).toString('utf8');
  } catch {
    console.error('[email] NÃO foi possível decifrar a senha do SMTP — a DOC_ENCRYPTION_KEY atual difere da usada ao salvar. Recadastre a senha em /admin/configuracoes neste ambiente.');
    return undefined;
  }
}

async function obterTransporter() {
  if (_cache) return _cache;
  let cfg = null;
  try {
    cfg = await prisma.configuracao.findUnique({ where: { id: 1 } });
  } catch {
    cfg = null;
  }

  if (cfg?.smtpHost) {
    _cache = {
      transporter: nodemailer.createTransport({
        host: cfg.smtpHost,
        port: cfg.smtpPort || 587,
        secure: !!cfg.smtpSecure,
        auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: decifrarSenhaSmtp(cfg.smtpPassCifrada) } : undefined,
      }),
      from: cfg.smtpFrom || config.smtp.from,
      devMode: false,
    };
  } else if (config.smtp.host) {
    _cache = {
      transporter: nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      }),
      from: config.smtp.from,
      devMode: false,
    };
  } else {
    _cache = { transporter: nodemailer.createTransport({ jsonTransport: true }), from: config.smtp.from, devMode: true };
  }
  return _cache;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function renderBase(data) {
  return ejs.renderFile(
    path.join(emailsDir, 'base.ejs'),
    {
      orgao: config.orgao,
      baseUrl: config.baseUrl,
      botao: null,
      paragrafos: [],
      ...data,
    },
    { async: true },
  );
}

/**
 * Envio de baixo nível com retry e registro em notificacao_email.
 * @returns {Promise<{status:'enviado'|'falha'}>}
 */
export async function enviarEmail({ to, subject, html, template = 'generico', attachments, inscricaoId }) {
  const { transporter, from, devMode } = await obterTransporter();
  const maxTentativas = 3;
  let status = 'falha';
  let erro = null;
  let tentativas = 0;

  for (let i = 1; i <= maxTentativas; i++) {
    tentativas = i;
    try {
      const info = await transporter.sendMail({ from, to, subject, html, attachments });
      status = 'enviado';
      erro = null;
      if (devMode) {
        console.log(`\n[email:dev] Para: ${to}\n[email:dev] Assunto: ${subject}\n[email:dev] (SMTP não configurado — mensagem não enviada de verdade)`);
        if (info?.message) {
          console.log(`[email:dev] tamanho do corpo: ${Buffer.byteLength(info.message)} bytes`);
        }
      }
      break;
    } catch (e) {
      status = 'falha';
      erro = e?.message || String(e);
      if (i < maxTentativas) await sleep(400 * i);
    }
  }

  try {
    await prisma.notificacaoEmail.create({
      data: {
        destinatario: Array.isArray(to) ? to.join(',') : String(to),
        assunto: subject,
        template,
        status,
        tentativas,
        erro,
        inscricaoId: inscricaoId || null,
      },
    });
  } catch (e) {
    console.error('[email] falha ao registrar notificacao_email:', e?.message);
  }

  if (status === 'falha') {
    console.error(`[email] FALHA ao enviar "${subject}" para ${to}: ${erro}`);
  }
  return { status, erro };
}

// ---------------------------------------------------------------------------
// E-mails de alto nível (1 por evento — ver critério de aceite §9)
// ---------------------------------------------------------------------------

export async function enviarVerificacaoEmail({ candidato, url }) {
  const html = await renderBase({
    titulo: 'Confirme seu e-mail',
    paragrafos: [
      `Olá, <strong>${candidato.nomeCompleto}</strong>.`,
      'Para concluir seu cadastro e poder se inscrever em processos seletivos, confirme seu endereço de e-mail.',
      'Este link expira em 48 horas.',
    ],
    botao: { texto: 'Confirmar e-mail', url },
  });
  return enviarEmail({ to: candidato.email, subject: 'Confirme seu e-mail — Processos Seletivos', html, template: 'verificacao_email' });
}

export async function enviarResetSenha({ candidato, codigo, url }) {
  const html = await renderBase({
    titulo: 'Código de recuperação de senha',
    paragrafos: [
      `Olá, <strong>${candidato.nomeCompleto}</strong>.`,
      'Recebemos uma solicitação para redefinir sua senha. Use o código abaixo na página de recuperação:',
      `<div style="font-size:34px;font-weight:bold;letter-spacing:8px;color:#5b34c4;background:#efe9ff;border-radius:10px;padding:16px 0;text-align:center;margin:4px 0;">${codigo}</div>`,
      'Este código expira em <strong>30 minutos</strong>. Se não foi você quem pediu, ignore este e-mail.',
      '<span style="color:#6e6e6e;font-size:12px;">Não recebeu? Confira a caixa de <strong>spam/lixo eletrônico</strong> e marque a mensagem como “não é spam”.</span>',
    ],
    botao: url ? { texto: 'Abrir página de recuperação', url } : null,
  });
  return enviarEmail({ to: candidato.email, subject: `${codigo} é o seu código de recuperação — Processos Seletivos`, html, template: 'reset_senha' });
}

export async function enviarConfirmacaoInscricao({ inscricao, candidato, edital, cargo, espelhoPdf }) {
  const acompanharUrl = `${config.baseUrl}/minhas-inscricoes/${inscricao.id}`;
  const html = await renderBase({
    titulo: 'Inscrição recebida',
    paragrafos: [
      `Olá, <strong>${candidato.nomeCompleto}</strong>.`,
      `Recebemos sua inscrição <strong>nº ${inscricao.numeroInscricao}</strong> no edital <strong>${edital.numero} — ${edital.titulo}</strong>, para o cargo <strong>${cargo.nome}</strong>.`,
      `Situação atual: <strong>${rotuloStatus(inscricao.status)}</strong>.`,
      'O comprovante (espelho) da inscrição segue em anexo neste e-mail (PDF) e também está disponível no portal.',
    ],
    botao: { texto: 'Acompanhar inscrição', url: acompanharUrl },
  });
  return enviarEmail({
    to: candidato.email,
    subject: `Inscrição ${inscricao.numeroInscricao} recebida — ${edital.numero}`,
    html,
    template: 'inscricao_confirmada',
    inscricaoId: inscricao.id,
    attachments: espelhoPdf
      ? [{ filename: `espelho-inscricao-${inscricao.numeroInscricao}.pdf`, content: espelhoPdf, contentType: 'application/pdf' }]
      : undefined,
  });
}

export async function enviarInscricaoHomologada({ inscricao, candidato, edital, cargo, espelhoPdf }) {
  const html = await renderBase({
    titulo: 'Inscrição homologada',
    paragrafos: [
      `Olá, <strong>${candidato.nomeCompleto}</strong>.`,
      `Sua inscrição <strong>nº ${inscricao.numeroInscricao}</strong> no edital <strong>${edital.numero}</strong> (cargo ${cargo.nome}) foi <strong>homologada</strong>.`,
      'O espelho atualizado (com a situação <strong>Homologada</strong>) segue em anexo. A versão sempre atual também está no portal, em "Minhas inscrições".',
    ],
    botao: { texto: 'Ver inscrição', url: `${config.baseUrl}/minhas-inscricoes/${inscricao.id}` },
  });
  return enviarEmail({
    to: candidato.email,
    subject: `Inscrição ${inscricao.numeroInscricao} homologada — ${edital.numero}`,
    html,
    template: 'inscricao_homologada',
    inscricaoId: inscricao.id,
    attachments: espelhoPdf
      ? [{ filename: `espelho-inscricao-${inscricao.numeroInscricao}.pdf`, content: espelhoPdf, contentType: 'application/pdf' }]
      : undefined,
  });
}

export async function enviarInscricaoIndeferida({ inscricao, candidato, edital, cargo, motivo, reenvioUrl, reenvioAteEm }) {
  const paragrafos = [
    `Olá, <strong>${candidato.nomeCompleto}</strong>.`,
    `Sua inscrição <strong>nº ${inscricao.numeroInscricao}</strong> no edital <strong>${edital.numero}</strong> (cargo ${cargo.nome}) foi <strong>indeferida</strong>.`,
    `<strong>Motivo:</strong> ${motivo}`,
  ];
  if (reenvioUrl && reenvioAteEm) {
    paragrafos.push(
      `Você pode corrigir e reenviar a documentação até <strong>${formatarDataHora(reenvioAteEm)}</strong>.`,
    );
  }
  const html = await renderBase({
    titulo: 'Inscrição indeferida',
    paragrafos,
    botao: reenvioUrl ? { texto: 'Reenviar documentação', url: reenvioUrl } : { texto: 'Ver inscrição', url: `${config.baseUrl}/minhas-inscricoes/${inscricao.id}` },
  });
  return enviarEmail({
    to: candidato.email,
    subject: `Inscrição ${inscricao.numeroInscricao} indeferida — ${edital.numero}`,
    html,
    template: 'inscricao_indeferida',
    inscricaoId: inscricao.id,
  });
}

export async function enviarProtocoloRecurso({ candidato, recurso, edital, inscricao }) {
  const html = await renderBase({
    titulo: 'Recurso protocolado',
    paragrafos: [
      `Olá, <strong>${candidato.nomeCompleto}</strong>.`,
      `Seu recurso (${rotuloFaseRecurso(recurso.fase)}) referente à inscrição <strong>nº ${inscricao.numeroInscricao}</strong> (edital ${edital.numero}) foi protocolado.`,
      `<strong>Protocolo:</strong> ${recurso.protocolo}`,
      'Você será avisado por e-mail quando houver resposta.',
    ],
    botao: { texto: 'Acompanhar recurso', url: `${config.baseUrl}/minhas-inscricoes/${inscricao.id}` },
  });
  return enviarEmail({
    to: candidato.email,
    subject: `Recurso protocolado (${recurso.protocolo}) — ${edital.numero}`,
    html,
    template: 'recurso_protocolo',
    inscricaoId: inscricao.id,
  });
}

export async function enviarRespostaRecurso({ candidato, recurso, edital, inscricao }) {
  const html = await renderBase({
    titulo: `Recurso ${recurso.status === 'deferido' ? 'deferido' : 'indeferido'}`,
    paragrafos: [
      `Olá, <strong>${candidato.nomeCompleto}</strong>.`,
      `Seu recurso <strong>${recurso.protocolo}</strong> (inscrição nº ${inscricao.numeroInscricao}, edital ${edital.numero}) foi <strong>${recurso.status}</strong>.`,
      `<strong>Resposta da comissão:</strong> ${recurso.respostaAdmin || '—'}`,
    ],
    botao: { texto: 'Ver detalhes', url: `${config.baseUrl}/minhas-inscricoes/${inscricao.id}` },
  });
  return enviarEmail({
    to: candidato.email,
    subject: `Resposta ao recurso ${recurso.protocolo} — ${edital.numero}`,
    html,
    template: 'recurso_resposta',
    inscricaoId: inscricao.id,
  });
}

export async function enviarNotificacaoStatus({ candidato, inscricao, edital, titulo, mensagem, template = 'status_generico' }) {
  const html = await renderBase({
    titulo,
    paragrafos: [
      `Olá, <strong>${candidato.nomeCompleto}</strong>.`,
      mensagem,
      `Inscrição <strong>nº ${inscricao.numeroInscricao}</strong> — edital ${edital.numero}.`,
    ],
    botao: { texto: 'Acompanhar inscrição', url: `${config.baseUrl}/minhas-inscricoes/${inscricao.id}` },
  });
  return enviarEmail({ to: candidato.email, subject: `${titulo} — inscrição ${inscricao.numeroInscricao}`, html, template, inscricaoId: inscricao.id });
}

export async function enviarEmailTeste(to) {
  const html = await renderBase({
    titulo: 'E-mail de teste',
    paragrafos: [
      'Este é um e-mail de teste do Sistema de Processos Seletivos.',
      'Se você recebeu esta mensagem, a configuração de SMTP está funcionando.',
    ],
  });
  return enviarEmail({ to, subject: 'Teste de configuração de SMTP — Processos Seletivos', html, template: 'teste_smtp' });
}

// --- rótulos/format helpers reaproveitados ---------------------------------

export function rotuloStatus(status) {
  return {
    enviada: 'Enviada',
    em_analise: 'Em análise',
    homologada: 'Homologada',
    indeferida: 'Indeferida',
    cancelada: 'Cancelada',
  }[status] || status;
}

export function rotuloFaseRecurso(fase) {
  return { inscricao: 'recurso de inscrição', gabarito: 'recurso de gabarito' }[fase] || fase;
}

function formatarDataHora(d) {
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date(d));
  } catch {
    return String(d);
  }
}

export { formatarCpf };
