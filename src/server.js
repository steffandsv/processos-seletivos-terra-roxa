// Ponto de entrada — monta o Fastify, registra plugins e rotas (§3).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import ejs from 'ejs';

import config from './config.js';
import prisma from './db.js';
import { registrarSessao } from './plugins/auth.js';
import { garantirDiretorio } from './lib/upload.js';

import rotasPublicas from './routes/public.js';
import rotasAuthCandidato from './routes/auth-candidato.js';
import rotasCandidato from './routes/candidato.js';
import rotasAdmin from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function build() {
  const app = Fastify({
    trustProxy: true, // atrás do Caddy/nginx
    bodyLimit: 1024 * 1024, // 1 MB para corpos urlencoded/json (uploads via multipart)
    logger: {
      level: config.isProd ? 'warn' : 'info',
    },
  });

  // --- Plugins de base ---
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", 'https://viacep.com.br'],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  await app.register(fastifyCookie, { secret: config.sessionSecret });
  await app.register(fastifyFormbody);
  await app.register(fastifyMultipart, {
    limits: { fileSize: config.maxUploadBytes, files: 4, fields: 30 },
  });
  await app.register(fastifyRateLimit, {
    global: false, // aplicado seletivamente por rota
    max: 300,
    timeWindow: '1 minute',
  });
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/public/',
  });
  await app.register(fastifyView, {
    engine: { ejs },
    root: path.join(__dirname, 'views'),
    viewExt: 'ejs',
    propertyName: 'view',
  });

  // --- Sessão / CSRF / flash / reply.render ---
  registrarSessao(app);

  // --- Healthcheck (Fase 0) ---
  app.get('/health', async (_req, reply) => reply.send({ status: 'ok' }));
  app.get('/health/db', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({ status: 'ok', db: 'up' });
    } catch (e) {
      reply.code(503);
      return reply.send({ status: 'error', db: 'down', erro: e.message });
    }
  });

  // --- Rotas ---
  await app.register(rotasPublicas);
  await app.register(rotasAuthCandidato);
  await app.register(rotasCandidato);
  await app.register(rotasAdmin, { prefix: '/admin' });

  // --- 404 ---
  app.setNotFoundHandler((request, reply) => {
    reply.code(404);
    if (request.headers.accept?.includes('application/json')) {
      return reply.send({ erro: 'Não encontrado' });
    }
    return reply.render('nao-encontrado', { titulo: 'Página não encontrada' });
  });

  // --- Erros ---
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    if (status === 413) {
      reply.code(413);
      reply.flash?.('erro', 'Arquivo excede o tamanho máximo permitido (8 MB).');
      return reply.redirect(request.headers.referer || '/');
    }
    reply.code(status);
    if (request.headers.accept?.includes('application/json')) {
      return reply.send({ erro: config.isProd ? 'Erro interno' : error.message });
    }
    return reply.render('erro', {
      titulo: 'Erro',
      mensagem: config.isProd ? 'Ocorreu um erro inesperado. Tente novamente.' : error.message,
      voltarUrl: '/',
    });
  });

  return app;
}

async function start() {
  await garantirDiretorio();
  const app = await build();
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      app.log.info(`Recebido ${sig}, encerrando...`);
      await app.close();
      await prisma.$disconnect();
      process.exit(0);
    });
  }
}

// Só inicia se executado diretamente (permite import em testes).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start();
}
