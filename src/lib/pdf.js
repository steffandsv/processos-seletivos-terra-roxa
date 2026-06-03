// Geração do espelho de inscrição em PDF (pdfkit — sem headless Chrome, §3).
// O espelho reflete fielmente os dados e a data/hora de envio (§9).
import PDFDocument from 'pdfkit';
import config from '../config.js';
import { formatarCpf } from './cpf.js';
import { fmtDataHora, ROTULO_STATUS_INSCRICAO, ROTULO_TIPO_DOCUMENTO } from './format.js';

const AZUL = '#0e0e29'; // navy oficial (títulos)
const ROXO = '#5b34c4'; // roxo marca (destaques)
const CINZA = '#475569';

function streamParaBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function linhaCampo(doc, rotulo, valor) {
  doc.font('Helvetica-Bold').fontSize(9).fillColor(CINZA).text(rotulo.toUpperCase(), { continued: false });
  doc.font('Helvetica').fontSize(11).fillColor('#0f172a').text(valor || '—');
  doc.moveDown(0.5);
}

function secao(doc, titulo) {
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(AZUL).text(titulo);
  doc.moveTo(doc.x, doc.y + 2).lineTo(doc.page.width - doc.page.margins.right, doc.y + 2).strokeColor('#cbd5e1').stroke();
  doc.moveDown(0.6);
}

/**
 * @returns {Promise<Buffer>}
 */
export async function gerarEspelhoPdf({ inscricao, candidato, edital, cargo, documentos = [], atendimento = null }) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Espelho de Inscrição ${inscricao.numeroInscricao}` } });
  const bufferPromise = streamParaBuffer(doc);

  // Cabeçalho
  doc.font('Helvetica-Bold').fontSize(15).fillColor(AZUL).text(`${config.orgao.nome} — ${config.orgao.uf}`);
  doc.font('Helvetica').fontSize(11).fillColor(CINZA).text('Comprovante / Espelho de Inscrição');
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor(CINZA).text(`Emitido em ${fmtDataHora(new Date())}`);

  // Faixa com número da inscrição
  doc.moveDown(0.8);
  const boxY = doc.y;
  doc.rect(doc.page.margins.left, boxY, doc.page.width - doc.page.margins.left - doc.page.margins.right, 46).fill('#efe9ff');
  doc.fillColor(ROXO).font('Helvetica-Bold').fontSize(10).text('INSCRIÇÃO Nº', doc.page.margins.left + 14, boxY + 9);
  doc.fillColor(AZUL).fontSize(20).text(inscricao.numeroInscricao, doc.page.margins.left + 14, boxY + 20);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(ROXO).text('SITUAÇÃO', doc.page.width - doc.page.margins.right - 160, boxY + 9, { width: 146, align: 'right' });
  doc.fillColor(AZUL).fontSize(14).text(ROTULO_STATUS_INSCRICAO[inscricao.status] || inscricao.status, doc.page.width - doc.page.margins.right - 160, boxY + 22, { width: 146, align: 'right' });
  doc.y = boxY + 60;
  doc.x = doc.page.margins.left;
  doc.fillColor('#0f172a');

  // Edital / cargo
  secao(doc, 'Edital');
  linhaCampo(doc, 'Edital', `${edital.numero} — ${edital.titulo}`);
  linhaCampo(doc, 'Cargo / vaga', `${cargo.nome}${cargo.requisitos ? ` (requisitos: ${cargo.requisitos})` : ''}`);

  // Candidato
  secao(doc, 'Dados do candidato');
  linhaCampo(doc, 'Nome completo', candidato.nomeCompleto);
  linhaCampo(doc, 'CPF', formatarCpf(candidato.cpf));
  linhaCampo(doc, 'E-mail', candidato.email);
  linhaCampo(doc, 'Telefone', candidato.telefone || '—');
  if (candidato.endereco) {
    const e = candidato.endereco;
    const endTxt = [
      [e.logradouro, e.numero].filter(Boolean).join(', '),
      e.complemento,
      e.bairro,
      [e.cidade, e.uf].filter(Boolean).join('/'),
      e.cep ? `CEP ${e.cep}` : null,
    ].filter(Boolean).join(' — ');
    linhaCampo(doc, 'Endereço', endTxt || '—');
  }

  // Atendimento especial (só aparece se solicitado)
  if (atendimento) {
    secao(doc, 'Atendimento especial solicitado');
    linhaCampo(doc, 'Necessidade', atendimento.tipoNecessidade);
    if (atendimento.descricao) linhaCampo(doc, 'Descrição', atendimento.descricao);
  }

  // Documentos anexados
  secao(doc, 'Documentos anexados');
  if (documentos.length === 0) {
    doc.font('Helvetica').fontSize(11).fillColor('#0f172a').text('Nenhum documento anexado.');
  } else {
    documentos.forEach((d) => {
      doc.font('Helvetica').fontSize(10).fillColor('#0f172a')
        .text(`• ${ROTULO_TIPO_DOCUMENTO[d.tipo] || d.tipo}: ${d.nomeOriginal || '(arquivo)'} — ${d.mime} — enviado em ${fmtDataHora(d.enviadoEm)}`);
    });
  }

  // Termo de aceite
  secao(doc, 'Termo de aceite');
  doc.font('Helvetica').fontSize(10).fillColor('#0f172a').text(
    inscricao.termoAceiteEm
      ? `O candidato declarou ter lido o edital integralmente e estar ciente de que não pode trocar a vaga depois. Aceite registrado em ${fmtDataHora(inscricao.termoAceiteEm)}.`
      : 'Termo de aceite não registrado.',
    { align: 'justify' },
  );

  // Rodapé
  doc.moveDown(1.2);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(CINZA).text(
    'Documento gerado eletronicamente pelo Sistema de Processos Seletivos. Espelho de transparência — não substitui as publicações oficiais no Diário Oficial.',
    { align: 'center' },
  );

  doc.end();
  return bufferPromise;
}
