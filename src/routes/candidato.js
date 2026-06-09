// Área do candidato (§5.1): perfil/LGPD, inscrição, acompanhamento,
// espelho, reenvio de documento e recursos.
import prisma from '../db.js';
import config from '../config.js';
import {
  requireCandidato,
  csrfGuard,
  validarCsrf,
  limparSessao,
  setSessao,
} from '../plugins/auth.js';
import { hashSenha, verificarSenha } from '../lib/seguranca.js';
import { perfilSchema, trocaSenhaSchema, recursoSchema, errosZod } from '../lib/validators.js';
import {
  lerMultipart,
  flagsEdital,
  inscricoesAbertas,
  criarInscricaoComNumero,
  subpastaDoEdital,
} from '../lib/web.js';
import { salvarArquivo, lerArquivo, removerArquivo } from '../lib/upload.js';
import { gerarProtocolo, tokenAleatorio, hashToken } from '../lib/crypto.js';
import { gerarEspelhoPdf } from '../lib/pdf.js';
import { registrarAuditoria } from '../lib/audit.js';
import {
  enviarConfirmacaoInscricao,
  enviarProtocoloRecurso,
  enviarNotificacaoStatus,
  enviarVerificacaoEmail,
} from '../lib/email.js';

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
const enderecoVazio = (e) => !e || Object.values(e).every((v) => !v || !String(v).trim());

// Carrega uma inscrição garantindo que pertence ao candidato logado.
async function inscricaoDoCandidato(id, candidatoId, include = {}) {
  const insc = await prisma.inscricao.findUnique({ where: { id }, include });
  if (!insc || insc.candidatoId !== candidatoId) return null;
  return insc;
}

export default async function rotasCandidato(fastify) {
  // ===================== Conta / perfil / LGPD =====================
  fastify.get('/minha-conta', { preHandler: requireCandidato }, async (request, reply) => {
    const candidato = await prisma.candidato.findUnique({ where: { id: request.sessao.id } });
    if (!candidato) { limparSessao(reply); return reply.redirect('/login'); }
    return reply.render('candidato-conta', { titulo: 'Minha conta', candidato, erros: {}, valores: {} });
  });

  fastify.post('/minha-conta', { preHandler: [requireCandidato, csrfGuard] }, async (request, reply) => {
    const body = request.body || {};
    body.endereco = montarEndereco(body);
    const parsed = perfilSchema.safeParse(body);
    const candidato = await prisma.candidato.findUnique({ where: { id: request.sessao.id } });
    if (!parsed.success) {
      reply.code(400);
      return reply.render('candidato-conta', { titulo: 'Minha conta', candidato, erros: errosZod(parsed), valores: body });
    }
    const d = parsed.data;
    const emailMudou = d.email !== candidato.email;
    if (emailMudou) {
      const existe = await prisma.candidato.findFirst({ where: { email: d.email, NOT: { id: candidato.id } } });
      if (existe) {
        reply.code(409);
        return reply.render('candidato-conta', { titulo: 'Minha conta', candidato, erros: { email: 'Já existe uma conta com este e-mail.' }, valores: body });
      }
    }
    const dados = {
      nomeCompleto: d.nomeCompleto,
      telefone: d.telefone || null,
      endereco: enderecoVazio(d.endereco) ? undefined : d.endereco,
      temDeficiencia: d.temDeficiencia || false,
      descricaoDeficiencia: d.temDeficiencia ? (d.descricaoDeficiencia || null) : null,
    };
    let token = null;
    if (emailMudou) {
      token = tokenAleatorio(32);
      dados.email = d.email;
      dados.emailVerificado = false; // novo e-mail entra como não confirmado (confirmação é opcional)
      dados.emailTokenHash = hashToken(token);
      dados.emailTokenExpiraEm = new Date(Date.now() + 48 * 60 * 60 * 1000);
    }
    const atualizado = await prisma.candidato.update({ where: { id: candidato.id }, data: dados });
    if (emailMudou) {
      await enviarVerificacaoEmail({ candidato: atualizado, url: `${config.baseUrl}/verificar-email?token=${token}` }).catch(() => {});
      setSessao(reply, { ...request.sessao, nome: atualizado.nomeCompleto, emailVerificado: false });
    } else if (atualizado.nomeCompleto !== request.sessao.nome) {
      setSessao(reply, { ...request.sessao, nome: atualizado.nomeCompleto });
    }
    await registrarAuditoria({ ator: 'candidato', atorId: candidato.id, acao: emailMudou ? 'candidato.email_alterado' : 'candidato.perfil_atualizado', entidade: 'candidato', entidadeId: candidato.id, detalhes: emailMudou ? { de: candidato.email, para: d.email } : undefined, ip: request.ip });
    reply.flash('sucesso', emailMudou ? 'Dados atualizados. Enviamos um link de confirmação para o novo e-mail (a confirmação é opcional — você já pode se inscrever).' : 'Dados atualizados.');
    return reply.redirect('/minha-conta');
  });

  fastify.post('/minha-conta/senha', { preHandler: [requireCandidato, csrfGuard] }, async (request, reply) => {
    const parsed = trocaSenhaSchema.safeParse(request.body || {});
    const candidato = await prisma.candidato.findUnique({ where: { id: request.sessao.id } });
    if (!parsed.success) {
      reply.code(400);
      return reply.render('candidato-conta', { titulo: 'Minha conta', candidato, erros: errosZod(parsed), valores: {}, abaSenha: true });
    }
    const ok = await verificarSenha(candidato.senhaHash, parsed.data.senhaAtual);
    if (!ok) {
      reply.code(400);
      return reply.render('candidato-conta', { titulo: 'Minha conta', candidato, erros: { senhaAtual: 'Senha atual incorreta.' }, valores: {}, abaSenha: true });
    }
    await prisma.candidato.update({ where: { id: candidato.id }, data: { senhaHash: await hashSenha(parsed.data.novaSenha) } });
    await registrarAuditoria({ ator: 'candidato', atorId: candidato.id, acao: 'candidato.senha_alterada', entidade: 'candidato', entidadeId: candidato.id, ip: request.ip });
    reply.flash('sucesso', 'Senha alterada.');
    return reply.redirect('/minha-conta');
  });

  // Exportação dos próprios dados (direito LGPD §6)
  fastify.get('/minha-conta/exportar', { preHandler: requireCandidato }, async (request, reply) => {
    const candidato = await prisma.candidato.findUnique({
      where: { id: request.sessao.id },
      include: {
        inscricoes: {
          include: {
            edital: { select: { numero: true, titulo: true } },
            cargo: { select: { nome: true } },
            documentos: { select: { tipo: true, nomeOriginal: true, mime: true, tamanho: true, enviadoEm: true } },
            recursos: { select: { protocolo: true, fase: true, status: true, criadoEm: true } },
            atendimentoEspecial: { select: { tipoNecessidade: true, descricao: true } },
          },
        },
      },
    });
    const { senhaHash: _sh, emailTokenHash: _et, resetTokenHash: _rt, ...limpo } = candidato;
    await registrarAuditoria({ ator: 'candidato', atorId: candidato.id, acao: 'candidato.dados_exportados', entidade: 'candidato', entidadeId: candidato.id, ip: request.ip });
    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="meus-dados-${candidato.id}.json"`);
    return reply.send(JSON.stringify({ geradoEm: new Date().toISOString(), titular: limpo }, null, 2));
  });

  // Solicitação de exclusão (direito LGPD §6) — bloqueada se houver certame ativo
  fastify.post('/minha-conta/excluir', { preHandler: [requireCandidato, csrfGuard] }, async (request, reply) => {
    const candidato = await prisma.candidato.findUnique({
      where: { id: request.sessao.id },
      include: { inscricoes: { include: { edital: { select: { status: true } }, documentos: true } } },
    });
    const temCertameAtivo = candidato.inscricoes.some((i) => i.edital.status === 'publicado');
    if (temCertameAtivo) {
      reply.flash('aviso', 'Não é possível excluir a conta enquanto houver inscrição em edital ativo (guarda obrigatória durante o certame). Procure o Encarregado (DPO) ao final do certame.');
      return reply.redirect('/minha-conta');
    }
    const arquivos = candidato.inscricoes.flatMap((i) => i.documentos.map((d) => d.arquivoPath));
    await registrarAuditoria({ ator: 'candidato', atorId: candidato.id, acao: 'candidato.conta_excluida', entidade: 'candidato', entidadeId: candidato.id, detalhes: { inscricoes: candidato.inscricoes.length, documentos: arquivos.length }, ip: request.ip });
    await prisma.candidato.delete({ where: { id: candidato.id } });
    await Promise.all(arquivos.map((a) => removerArquivo(a).catch(() => {})));
    limparSessao(reply);
    reply.flash('sucesso', 'Sua conta e seus dados foram excluídos.');
    return reply.redirect('/');
  });

  // ===================== Minhas inscrições =====================
  fastify.get('/minhas-inscricoes', { preHandler: requireCandidato }, async (request, reply) => {
    const inscricoes = await prisma.inscricao.findMany({
      where: { candidatoId: request.sessao.id },
      include: { edital: { select: { numero: true, titulo: true, id: true } }, cargo: { select: { nome: true } } },
      orderBy: { criadoEm: 'desc' },
    });
    return reply.render('candidato-inscricoes', { titulo: 'Minhas inscrições', inscricoes });
  });

  fastify.get('/minhas-inscricoes/:id', { preHandler: requireCandidato }, async (request, reply) => {
    const insc = await inscricaoDoCandidato(Number(request.params.id), request.sessao.id, {
      edital: true,
      cargo: true,
      documentos: true,
      atendimentoEspecial: true,
      recursos: { orderBy: { criadoEm: 'desc' } },
    });
    if (!insc) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Inscrição não encontrada' }); }
    const flags = flagsEdital(insc.edital);
    const agora = new Date();
    const podeReenviar = insc.status === 'indeferida' && insc.reenvioAteEm && agora <= new Date(insc.reenvioAteEm);
    const recursosPorFase = { inscricao: insc.recursos.find((r) => r.fase === 'inscricao'), gabarito: insc.recursos.find((r) => r.fase === 'gabarito') };
    const podeRecursoInscricao = flags.fase_recurso_inscricao && insc.status === 'indeferida' && !recursosPorFase.inscricao;
    const podeRecursoGabarito = flags.fase_recurso_gabarito && !recursosPorFase.gabarito;
    return reply.render('candidato-inscricao', {
      titulo: `Inscrição ${insc.numeroInscricao}`,
      insc, flags, podeReenviar, recursosPorFase, podeRecursoInscricao, podeRecursoGabarito,
    });
  });

  // Espelho em PDF (gerado sob demanda — reflete fielmente os dados, §9)
  fastify.get('/minhas-inscricoes/:id/espelho', { preHandler: requireCandidato }, async (request, reply) => {
    const insc = await inscricaoDoCandidato(Number(request.params.id), request.sessao.id, {
      edital: true, cargo: true, candidato: true, documentos: true, atendimentoEspecial: true,
    });
    if (!insc) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Inscrição não encontrada' }); }
    const pdf = await gerarEspelhoPdf({ inscricao: insc, candidato: insc.candidato, edital: insc.edital, cargo: insc.cargo, documentos: insc.documentos, atendimento: insc.atendimentoEspecial });
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `inline; filename="espelho-inscricao-${insc.numeroInscricao}.pdf"`);
    return reply.send(pdf);
  });

  // Download do próprio documento
  fastify.get('/documentos/:id/arquivo', { preHandler: requireCandidato }, async (request, reply) => {
    const doc = await prisma.documento.findUnique({ where: { id: Number(request.params.id) }, include: { inscricao: true } });
    if (!doc || doc.inscricao.candidatoId !== request.sessao.id) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Documento não encontrado' }); }
    let conteudo;
    try { conteudo = await lerArquivo(doc.arquivoPath); } catch { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Arquivo indisponível' }); }
    reply.header('Content-Type', doc.mime || 'application/octet-stream');
    reply.header('Content-Disposition', `inline; filename="${(doc.nomeOriginal || 'documento').replace(/"/g, '')}"`);
    return reply.send(conteudo);
  });

  // ===================== Inscrição =====================
  fastify.get('/editais/:id/inscrever', { preHandler: requireCandidato }, async (request, reply) => {
    const edital = await prisma.edital.findUnique({ where: { id: Number(request.params.id) }, include: { cargos: { orderBy: { nome: 'asc' } } } });
    if (!edital || !inscricoesAbertas(edital)) {
      reply.flash('erro', 'As inscrições para este edital não estão abertas.');
      return reply.redirect(edital ? `/editais/${edital.id}` : '/');
    }
    const flags = flagsEdital(edital);
    const jaInscrito = await prisma.inscricao.findFirst({ where: { candidatoId: request.sessao.id, editalId: edital.id } });
    if (jaInscrito && !flags.permite_multiplas_vagas) {
      reply.flash('info', 'Você já possui inscrição neste edital.');
      return reply.redirect(`/minhas-inscricoes/${jaInscrito.id}`);
    }
    const cargosInscritos = await prisma.inscricao.findMany({ where: { candidatoId: request.sessao.id, editalId: edital.id }, select: { cargoId: true } });
    const idsInscritos = new Set(cargosInscritos.map((c) => c.cargoId));
    return reply.render('candidato-inscrever', { titulo: `Inscrição — ${edital.numero}`, edital, flags, cargosDisponiveis: edital.cargos.filter((c) => !idsInscritos.has(c.id)), erros: {} });
  });

  fastify.post('/editais/:id/inscrever', { preHandler: requireCandidato }, async (request, reply) => {
    const editalId = Number(request.params.id);
    const edital = await prisma.edital.findUnique({ where: { id: editalId }, include: { cargos: true } });
    if (!edital || !inscricoesAbertas(edital)) {
      reply.flash('erro', 'As inscrições para este edital não estão abertas.');
      return reply.redirect('/');
    }
    const flags = flagsEdital(edital);
    const { fields, files } = await lerMultipart(request);
    if (!validarCsrf(request, fields._csrf)) { reply.code(403); return reply.render('erro', { titulo: 'Erro de validação', mensagem: 'Requisição inválida (CSRF). Recarregue e tente novamente.', voltarUrl: `/editais/${editalId}/inscrever` }); }

    const erros = {};
    const cargoId = Number(fields.cargoId);
    const cargo = edital.cargos.find((c) => c.id === cargoId);
    if (!cargo) erros.cargoId = 'Selecione um cargo válido.';
    if (fields.aceiteTermos !== 'on') erros.aceiteTermos = 'É necessário aceitar o termo para concluir a inscrição.';

    // Unicidade conforme flag
    if (!flags.permite_multiplas_vagas) {
      const jaInscrito = await prisma.inscricao.findFirst({ where: { candidatoId: request.sessao.id, editalId } });
      if (jaInscrito) { reply.flash('info', 'Você já possui inscrição neste edital.'); return reply.redirect(`/minhas-inscricoes/${jaInscrito.id}`); }
    } else if (cargo) {
      const jaNoCargo = await prisma.inscricao.findFirst({ where: { candidatoId: request.sessao.id, cargoId } });
      if (jaNoCargo) erros.cargoId = 'Você já está inscrito neste cargo.';
    }

    // Documento com foto
    const docFoto = files.documento;
    if (flags.exige_documento_foto) {
      if (!docFoto) erros.documento = 'Anexe um documento com foto (RG, CNH, CTPS digital, Passaporte ou RNM).';
      else if (!config.mimesDocumento.includes(docFoto.mimetype)) erros.documento = 'Formato inválido. Aceitos: PDF, JPG ou PNG.';
      else if (docFoto.size > config.maxUploadBytes) erros.documento = 'Arquivo excede 8 MB.';
    }
    // Laudo (opcional) — só se atendimento especial estiver ligado
    const laudo = files.laudo;
    if (laudo && !config.mimesDocumento.includes(laudo.mimetype)) erros.laudo = 'Laudo em formato inválido (PDF, JPG ou PNG).';

    if (Object.keys(erros).length) {
      reply.code(400);
      const cargosInscritos = await prisma.inscricao.findMany({ where: { candidatoId: request.sessao.id, editalId }, select: { cargoId: true } });
      const idsInscritos = new Set(cargosInscritos.map((c) => c.cargoId));
      return reply.render('candidato-inscrever', { titulo: `Inscrição — ${edital.numero}`, edital, flags, cargosDisponiveis: edital.cargos.filter((c) => !idsInscritos.has(c.id)), erros, valores: fields });
    }

    // Persistência: salva arquivos no volume (cifrados) e cria os registros
    let docFotoNome = null;
    let laudoNome = null;
    try {
      const subpasta = subpastaDoEdital(edital);
      if (docFoto) docFotoNome = await salvarArquivo(docFoto.buffer, docFoto.mimetype, { subpasta });
      if (laudo) laudoNome = await salvarArquivo(laudo.buffer, laudo.mimetype, { subpasta });

      const statusInicial = flags.fase_homologacao ? 'em_analise' : 'enviada';
      const inscricao = await criarInscricaoComNumero({
        candidatoId: request.sessao.id,
        editalId,
        cargoId,
        status: statusInicial,
        termoAceiteEm: new Date(),
      });

      if (docFotoNome) {
        await prisma.documento.create({ data: { inscricaoId: inscricao.id, tipo: 'doc_foto', arquivoPath: docFotoNome, nomeOriginal: docFoto.filename, mime: docFoto.mimetype, tamanho: docFoto.size } });
      }
      let laudoDoc = null;
      if (laudoNome) {
        laudoDoc = await prisma.documento.create({ data: { inscricaoId: inscricao.id, tipo: 'laudo', arquivoPath: laudoNome, nomeOriginal: laudo.filename, mime: laudo.mimetype, tamanho: laudo.size } });
      }
      if (flags.fase_atendimento_especial && fields.atendimento_tipo && fields.atendimento_tipo.trim()) {
        await prisma.atendimentoEspecial.create({ data: { inscricaoId: inscricao.id, tipoNecessidade: fields.atendimento_tipo.trim().slice(0, 200), descricao: (fields.atendimento_descricao || '').slice(0, 500) || null, laudoDocumentoId: laudoDoc?.id || null } });
      }

      const completa = await prisma.inscricao.findUnique({ where: { id: inscricao.id }, include: { candidato: true, edital: true, cargo: true, documentos: true, atendimentoEspecial: true } });
      const espelho = await gerarEspelhoPdf({ inscricao: completa, candidato: completa.candidato, edital: completa.edital, cargo: completa.cargo, documentos: completa.documentos, atendimento: completa.atendimentoEspecial });
      await enviarConfirmacaoInscricao({ inscricao: completa, candidato: completa.candidato, edital: completa.edital, cargo: completa.cargo, espelhoPdf: espelho });
      await registrarAuditoria({ ator: 'candidato', atorId: request.sessao.id, acao: 'inscricao.criada', entidade: 'inscricao', entidadeId: inscricao.id, detalhes: { edital: edital.numero, cargo: cargo.nome, status: statusInicial }, ip: request.ip });

      reply.flash('sucesso', `Inscrição nº ${inscricao.numeroInscricao} enviada! O espelho foi enviado para o seu e-mail.`);
      return reply.redirect(`/minhas-inscricoes/${inscricao.id}`);
    } catch (err) {
      await Promise.all([docFotoNome && removerArquivo(docFotoNome), laudoNome && removerArquivo(laudoNome)].filter(Boolean).map((p) => p.catch(() => {})));
      throw err;
    }
  });

  // ===================== Reenvio de documento =====================
  fastify.get('/minhas-inscricoes/:id/reenviar', { preHandler: requireCandidato }, async (request, reply) => {
    const insc = await inscricaoDoCandidato(Number(request.params.id), request.sessao.id, { edital: true, cargo: true });
    if (!insc) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Inscrição não encontrada' }); }
    const podeReenviar = insc.status === 'indeferida' && insc.reenvioAteEm && new Date() <= new Date(insc.reenvioAteEm);
    if (!podeReenviar) { reply.flash('erro', 'A janela de reenvio não está disponível para esta inscrição.'); return reply.redirect(`/minhas-inscricoes/${insc.id}`); }
    return reply.render('candidato-reenviar', { titulo: `Reenvio — ${insc.numeroInscricao}`, insc, erros: {} });
  });

  fastify.post('/minhas-inscricoes/:id/reenviar', { preHandler: requireCandidato }, async (request, reply) => {
    const insc = await inscricaoDoCandidato(Number(request.params.id), request.sessao.id, { edital: true, cargo: true, candidato: true, documentos: true });
    if (!insc) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Inscrição não encontrada' }); }
    const podeReenviar = insc.status === 'indeferida' && insc.reenvioAteEm && new Date() <= new Date(insc.reenvioAteEm);
    if (!podeReenviar) { reply.flash('erro', 'A janela de reenvio não está disponível.'); return reply.redirect(`/minhas-inscricoes/${insc.id}`); }

    const { fields, files } = await lerMultipart(request);
    if (!validarCsrf(request, fields._csrf)) { reply.code(403); return reply.render('erro', { titulo: 'Erro de validação', mensagem: 'Requisição inválida (CSRF).', voltarUrl: `/minhas-inscricoes/${insc.id}/reenviar` }); }
    const docFoto = files.documento;
    const erros = {};
    if (!docFoto) erros.documento = 'Anexe o documento.';
    else if (!config.mimesDocumento.includes(docFoto.mimetype)) erros.documento = 'Formato inválido (PDF, JPG ou PNG).';
    else if (docFoto.size > config.maxUploadBytes) erros.documento = 'Arquivo excede 8 MB.';
    if (Object.keys(erros).length) { reply.code(400); return reply.render('candidato-reenviar', { titulo: `Reenvio — ${insc.numeroInscricao}`, insc, erros }); }

    const novoNome = await salvarArquivo(docFoto.buffer, docFoto.mimetype, { subpasta: subpastaDoEdital(insc.edital) });
    const flags = flagsEdital(insc.edital);
    // Remove documentos de foto anteriores e adiciona o novo.
    const antigos = insc.documentos.filter((d) => d.tipo === 'doc_foto');
    await prisma.documento.create({ data: { inscricaoId: insc.id, tipo: 'doc_foto', arquivoPath: novoNome, nomeOriginal: docFoto.filename, mime: docFoto.mimetype, tamanho: docFoto.size } });
    await prisma.documento.deleteMany({ where: { id: { in: antigos.map((a) => a.id) } } });
    await Promise.all(antigos.map((a) => removerArquivo(a.arquivoPath).catch(() => {})));

    const novoStatus = flags.fase_homologacao ? 'em_analise' : 'enviada';
    await prisma.inscricao.update({ where: { id: insc.id }, data: { status: novoStatus, motivoIndeferimento: null, reenvioAteEm: null } });
    await registrarAuditoria({ ator: 'candidato', atorId: request.sessao.id, acao: 'inscricao.documento_reenviado', entidade: 'inscricao', entidadeId: insc.id, ip: request.ip });
    await enviarNotificacaoStatus({ candidato: insc.candidato, inscricao: insc, edital: insc.edital, titulo: 'Documentação reenviada', mensagem: 'Recebemos sua nova documentação. Sua inscrição voltou para análise.', template: 'reenvio_recebido' });

    reply.flash('sucesso', 'Documentação reenviada. Sua inscrição voltou para análise.');
    return reply.redirect(`/minhas-inscricoes/${insc.id}`);
  });

  // ===================== Recursos =====================
  fastify.get('/minhas-inscricoes/:id/recurso/:fase', { preHandler: requireCandidato }, async (request, reply) => {
    const fase = request.params.fase;
    if (!['inscricao', 'gabarito'].includes(fase)) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Recurso inválido' }); }
    const insc = await inscricaoDoCandidato(Number(request.params.id), request.sessao.id, { edital: true, cargo: true, recursos: true });
    if (!insc) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Inscrição não encontrada' }); }
    const erro = validarAberturaRecurso(insc, fase);
    if (erro) { reply.flash('erro', erro); return reply.redirect(`/minhas-inscricoes/${insc.id}`); }
    return reply.render('candidato-recurso', { titulo: 'Interpor recurso', insc, fase, erros: {}, valores: {} });
  });

  fastify.post('/minhas-inscricoes/:id/recurso/:fase', { preHandler: requireCandidato }, async (request, reply) => {
    const fase = request.params.fase;
    if (!['inscricao', 'gabarito'].includes(fase)) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Recurso inválido' }); }
    const insc = await inscricaoDoCandidato(Number(request.params.id), request.sessao.id, { edital: true, cargo: true, candidato: true, recursos: true });
    if (!insc) { reply.code(404); return reply.render('nao-encontrado', { titulo: 'Inscrição não encontrada' }); }
    const erroAbertura = validarAberturaRecurso(insc, fase);
    if (erroAbertura) { reply.flash('erro', erroAbertura); return reply.redirect(`/minhas-inscricoes/${insc.id}`); }

    const { fields, files } = await lerMultipart(request);
    if (!validarCsrf(request, fields._csrf)) { reply.code(403); return reply.render('erro', { titulo: 'Erro de validação', mensagem: 'Requisição inválida (CSRF).', voltarUrl: `/minhas-inscricoes/${insc.id}` }); }
    const parsed = recursoSchema.safeParse({ texto: fields.texto });
    if (!parsed.success) { reply.code(400); return reply.render('candidato-recurso', { titulo: 'Interpor recurso', insc, fase, erros: errosZod(parsed), valores: fields }); }

    const anexo = files.anexo;
    if (anexo && !config.mimesDocumento.includes(anexo.mimetype)) {
      reply.code(400);
      return reply.render('candidato-recurso', { titulo: 'Interpor recurso', insc, fase, erros: { anexo: 'Anexo em formato inválido (PDF, JPG ou PNG).' }, valores: fields });
    }
    let anexoNome = null;
    if (anexo) anexoNome = await salvarArquivo(anexo.buffer, anexo.mimetype, { subpasta: subpastaDoEdital(insc.edital) });

    const ano = new Date().getFullYear();
    const recurso = await prisma.recurso.create({ data: { inscricaoId: insc.id, fase, protocolo: gerarProtocolo('REC', ano), texto: parsed.data.texto, anexoPath: anexoNome, status: 'aberto' } });
    await registrarAuditoria({ ator: 'candidato', atorId: request.sessao.id, acao: 'recurso.criado', entidade: 'recurso', entidadeId: recurso.id, detalhes: { fase, protocolo: recurso.protocolo }, ip: request.ip });
    await enviarProtocoloRecurso({ candidato: insc.candidato, recurso, edital: insc.edital, inscricao: insc });

    reply.flash('sucesso', `Recurso protocolado sob o número ${recurso.protocolo}.`);
    return reply.redirect(`/minhas-inscricoes/${insc.id}`);
  });
}

// Regras de abertura de recurso conforme fase e flags do edital.
function validarAberturaRecurso(insc, fase) {
  const flags = flagsEdital(insc.edital);
  const jaTem = insc.recursos?.some((r) => r.fase === fase);
  if (jaTem) return 'Você já interpôs recurso nesta fase.';
  if (fase === 'inscricao') {
    if (!flags.fase_recurso_inscricao) return 'O recurso de inscrição não está habilitado neste edital.';
    if (insc.status !== 'indeferida') return 'O recurso de inscrição só é cabível para inscrições indeferidas.';
  } else {
    if (!flags.fase_recurso_gabarito) return 'O recurso de gabarito não está habilitado neste edital.';
  }
  return null;
}
