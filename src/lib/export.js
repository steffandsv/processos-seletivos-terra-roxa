// Exportação de TODAS as tabelas do sistema em um único arquivo .xlsx
// (uma aba por tabela). Campos sensíveis (hashes de senha, token, senha SMTP)
// NÃO são exportados. O exceljs é carregado sob demanda (import dinâmico).
import prisma from '../db.js';

function celula(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'object') {
    if (typeof v.toNumber === 'function') return v.toNumber(); // Prisma Decimal
    return JSON.stringify(v); // colunas jsonb
  }
  return v;
}

function adicionarAba(wb, nome, linhas) {
  const ws = wb.addWorksheet(nome.slice(0, 31)); // nome de aba: máx. 31 chars
  if (!linhas.length) {
    ws.addRow(['(sem registros)']);
    return;
  }
  const colunas = Object.keys(linhas[0]);
  ws.addRow(colunas);
  ws.getRow(1).font = { bold: true };
  for (const l of linhas) ws.addRow(colunas.map((c) => celula(l[c])));
  ws.columns.forEach((col) => { col.width = 20; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

export async function gerarExcelTudo() {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema de Processos Seletivos — Terra Roxa';

  adicionarAba(wb, 'admins', await prisma.usuarioAdmin.findMany({ select: { id: true, nome: true, email: true, criadoEm: true }, orderBy: { id: 'asc' } }));
  adicionarAba(wb, 'candidatos', await prisma.candidato.findMany({ select: { id: true, nomeCompleto: true, cpf: true, email: true, telefone: true, endereco: true, temDeficiencia: true, descricaoDeficiencia: true, emailVerificado: true, criadoEm: true, atualizadoEm: true }, orderBy: { id: 'asc' } }));
  adicionarAba(wb, 'editais', await prisma.edital.findMany({ select: { id: true, numero: true, titulo: true, descricao: true, status: true, configFases: true, dataAberturaInscricao: true, dataEncerramentoInscricao: true, editalNomeOriginal: true, criadoEm: true }, orderBy: { id: 'asc' } }));
  adicionarAba(wb, 'cargos', await prisma.cargo.findMany({ select: { id: true, editalId: true, nome: true, descricao: true, qtdVagas: true, salario: true, cargaHoraria: true, requisitos: true }, orderBy: { id: 'asc' } }));
  adicionarAba(wb, 'inscricoes', await prisma.inscricao.findMany({ select: { id: true, numeroInscricao: true, candidatoId: true, editalId: true, cargoId: true, status: true, motivoIndeferimento: true, reenvioAteEm: true, termoAceiteEm: true, criadoEm: true, atualizadoEm: true }, orderBy: { id: 'asc' } }));
  adicionarAba(wb, 'documentos', await prisma.documento.findMany({ select: { id: true, inscricaoId: true, tipo: true, nomeOriginal: true, mime: true, tamanho: true, enviadoEm: true }, orderBy: { id: 'asc' } }));
  adicionarAba(wb, 'atendimento_especial', await prisma.atendimentoEspecial.findMany({ select: { id: true, inscricaoId: true, tipoNecessidade: true, descricao: true, laudoDocumentoId: true }, orderBy: { id: 'asc' } }));
  adicionarAba(wb, 'recursos', await prisma.recurso.findMany({ select: { id: true, inscricaoId: true, fase: true, protocolo: true, status: true, texto: true, respostaAdmin: true, respondidoEm: true, criadoEm: true }, orderBy: { id: 'asc' } }));
  adicionarAba(wb, 'publicacoes', await prisma.publicacao.findMany({ select: { id: true, editalId: true, tipo: true, titulo: true, nomeOriginal: true, mime: true, publicadoEm: true }, orderBy: { id: 'asc' } }));
  adicionarAba(wb, 'notificacoes_email', await prisma.notificacaoEmail.findMany({ select: { id: true, destinatario: true, assunto: true, template: true, status: true, tentativas: true, erro: true, inscricaoId: true, criadoEm: true }, orderBy: { id: 'asc' } }));
  adicionarAba(wb, 'auditoria', await prisma.logAuditoria.findMany({ select: { id: true, ator: true, atorId: true, acao: true, entidade: true, entidadeId: true, detalhes: true, ip: true, criadoEm: true }, orderBy: { id: 'asc' } }));
  adicionarAba(wb, 'configuracao', await prisma.configuracao.findMany({ select: { id: true, smtpHost: true, smtpPort: true, smtpSecure: true, smtpUser: true, smtpFrom: true, atualizadoEm: true } }));

  return wb.xlsx.writeBuffer();
}
