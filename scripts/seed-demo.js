// Semente de demonstração: cria dois editais que comprovam a modularidade (§9)
// — um "completo" e um "motorista" simplificado — convivendo no mesmo sistema.
import prisma from '../src/db.js';
import { CONFIG_FASES_PADRAO } from '../src/lib/fases.js';

async function main() {
  const completo = await prisma.edital.upsert({
    where: { numero: '001/2026' },
    update: {},
    create: {
      numero: '001/2026',
      titulo: 'Processo Seletivo — Educação',
      descricao: 'Processo seletivo completo: homologação, atendimento especial, gabarito e recursos.',
      status: 'publicado',
      dataAberturaInscricao: new Date('2026-06-01T08:00:00-03:00'),
      dataEncerramentoInscricao: new Date('2026-12-31T23:59:00-03:00'),
      configFases: { ...CONFIG_FASES_PADRAO, fase_recurso_inscricao: true, fase_recurso_gabarito: true },
      cargos: {
        create: [
          { nome: 'Professor de Ensino Fundamental', qtdVagas: 5, requisitos: 'Licenciatura plena' },
          { nome: 'Auxiliar de Creche', qtdVagas: 10, requisitos: 'Ensino médio completo' },
        ],
      },
    },
  });

  const motorista = await prisma.edital.upsert({
    where: { numero: '002/2026' },
    update: {},
    create: {
      numero: '002/2026',
      titulo: 'Processo Seletivo — Motorista',
      descricao: 'Processo simplificado: sem recurso e sem atendimento especial.',
      status: 'publicado',
      dataAberturaInscricao: new Date('2026-06-01T08:00:00-03:00'),
      dataEncerramentoInscricao: new Date('2026-12-31T23:59:00-03:00'),
      configFases: {
        permite_multiplas_vagas: false,
        exige_documento_foto: true,
        fase_homologacao: true,
        fase_recurso_inscricao: false,
        fase_atendimento_especial: false,
        fase_publicacao_gabarito: false,
        fase_recurso_gabarito: false,
        fase_resultado_classificacao: true,
        janela_reenvio_documento_dias: 2,
      },
      cargos: { create: [{ nome: 'Motorista de Veículos Pesados', qtdVagas: 3, requisitos: 'CNH categoria D' }] },
    },
  });

  console.log(`✔ Editais de demonstração: #${completo.id} (${completo.numero}) e #${motorista.id} (${motorista.numero})`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
