// Sessão (cookie assinado), proteção CSRF (synchronizer token), flash messages
// e helper de render com contexto comum. Registrado no instance-raiz para que
// todas as rotas herdem hooks e decorators.
import config from '../config.js';
import * as fmt from '../lib/format.js';
import { tokenAleatorio, compararSeguro } from '../lib/crypto.js';

const SESSAO_COOKIE = 'ps_sessao';
const CSRF_COOKIE = 'ps_csrf';
const FLASH_COOKIE = 'ps_flash';
const SESSAO_MAX_AGE = 60 * 60 * 8; // 8 horas

function baseCookie(extra = {}) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    signed: true,
    ...extra,
  };
}

export function setSessao(reply, dados) {
  reply.setCookie(SESSAO_COOKIE, JSON.stringify(dados), baseCookie({ maxAge: SESSAO_MAX_AGE }));
}

export function limparSessao(reply) {
  reply.clearCookie(SESSAO_COOKIE, { path: '/' });
}

/** Registra sessão, CSRF, flash e o helper reply.render. */
export function registrarSessao(fastify) {
  fastify.decorateRequest('sessao', null);
  fastify.decorateRequest('csrfToken', null);
  fastify.decorateRequest('flashMessages', null);
  fastify.decorateRequest('_hadFlash', false);
  fastify.decorateReply('_flashes', null);

  fastify.addHook('onRequest', async (request, reply) => {
    // --- sessão ---
    request.sessao = null;
    const rawS = request.cookies[SESSAO_COOKIE];
    if (rawS) {
      const u = request.unsignCookie(rawS);
      if (u.valid && u.value) {
        try { request.sessao = JSON.parse(u.value); } catch { request.sessao = null; }
      }
    }

    // --- token CSRF (garante existência) ---
    let token = null;
    const rawC = request.cookies[CSRF_COOKIE];
    if (rawC) {
      const u = request.unsignCookie(rawC);
      if (u.valid && u.value) token = u.value;
    }
    if (!token) {
      token = tokenAleatorio(24);
      reply.setCookie(CSRF_COOKIE, token, baseCookie({ maxAge: SESSAO_MAX_AGE }));
    }
    request.csrfToken = token;

    // --- flash de entrada ---
    request.flashMessages = [];
    request._hadFlash = false;
    const rawF = request.cookies[FLASH_COOKIE];
    if (rawF) {
      const u = request.unsignCookie(rawF);
      if (u.valid && u.value) {
        try { request.flashMessages = JSON.parse(u.value); request._hadFlash = true; } catch { /* ignore */ }
      }
    }
    reply._flashes = [];
  });

  fastify.addHook('onSend', async (request, reply, payload) => {
    if (reply._flashes && reply._flashes.length) {
      reply.setCookie(FLASH_COOKIE, JSON.stringify(reply._flashes), baseCookie({ maxAge: 60 }));
    } else if (request._hadFlash) {
      reply.clearCookie(FLASH_COOKIE, { path: '/' });
    }
    return payload;
  });

  fastify.decorateReply('flash', function flash(tipo, texto) {
    if (!this._flashes) this._flashes = [];
    this._flashes.push({ tipo, texto });
  });

  fastify.decorateReply('render', function render(template, data = {}) {
    const request = this.request;
    return this.view(template, {
      sessao: request.sessao,
      flashes: request.flashMessages,
      csrfToken: request.csrfToken,
      fmt,
      orgao: config.orgao,
      baseUrl: config.baseUrl,
      isProd: config.isProd,
      currentPath: request.url.split('?')[0],
      titulo: 'Processos Seletivos',
      erros: {},
      valores: {},
      ...data,
    });
  });
}

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

/** preHandler para formulários urlencoded (token no campo _csrf do body). */
export async function csrfGuard(request, reply) {
  const enviado = request.body?._csrf;
  if (!enviado || !compararSeguro(enviado, request.csrfToken)) {
    reply.code(403);
    return reply.render('erro', { titulo: 'Erro de validação', mensagem: 'Sessão expirada ou requisição inválida (CSRF). Recarregue a página e tente novamente.', voltarUrl: request.headers.referer || '/' });
  }
}

/** Validação manual de CSRF para rotas multipart (token lido dos campos). */
export function validarCsrf(request, tokenEnviado) {
  return Boolean(tokenEnviado) && compararSeguro(tokenEnviado, request.csrfToken);
}

// ---------------------------------------------------------------------------
// Guards de autorização
// ---------------------------------------------------------------------------

export async function requireCandidato(request, reply) {
  if (request.sessao?.tipo !== 'candidato') {
    reply.flash('erro', 'Faça login para continuar.');
    return reply.redirect(`/login?next=${encodeURIComponent(request.url)}`);
  }
}

export async function requireAdmin(request, reply) {
  if (request.sessao?.tipo !== 'admin') {
    reply.flash('erro', 'Acesso restrito. Faça login como administrador.');
    return reply.redirect(`/admin/login?next=${encodeURIComponent(request.url)}`);
  }
}
