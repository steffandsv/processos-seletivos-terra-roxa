// Exportação de todas as tabelas do sistema em Excel (.xlsx).
import { gerarExcelTudo } from '../../lib/export.js';
import { registrarAuditoria } from '../../lib/audit.js';

export default async function adminExportar(fastify) {
  fastify.get('/exportar', async (request, reply) => {
    const buffer = await gerarExcelTudo();
    await registrarAuditoria({ ator: 'admin', atorId: request.sessao.id, acao: 'dados.exportados_excel', ip: request.ip });
    const data = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="processos-seletivos-${data}.xlsx"`);
    return reply.send(Buffer.from(buffer));
  });
}
