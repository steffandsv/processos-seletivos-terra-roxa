// Painel administrativo (§5.2). Aggregator: rotas de login abertas + um escopo
// protegido por requireAdmin contendo todo o restante. O prefixo /admin é
// aplicado em server.js.
import { requireAdmin } from '../plugins/auth.js';
import adminAuth from './admin/auth.js';
import adminDashboard from './admin/dashboard.js';
import adminEditais from './admin/editais.js';
import adminInscricoes from './admin/inscricoes.js';
import adminTransparencia from './admin/transparencia.js';
import adminConfiguracoes from './admin/configuracoes.js';

export default async function rotasAdmin(fastify) {
  // Login / logout (sem guard)
  await fastify.register(adminAuth);

  // Tudo o mais exige administrador autenticado
  await fastify.register(async (protegido) => {
    protegido.addHook('preHandler', requireAdmin);
    await protegido.register(adminDashboard);
    await protegido.register(adminEditais);
    await protegido.register(adminInscricoes);
    await protegido.register(adminTransparencia);
    await protegido.register(adminConfiguracoes);
  });
}
