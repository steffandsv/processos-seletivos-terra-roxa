-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StatusEdital" AS ENUM ('rascunho', 'publicado', 'encerrado', 'expurgado');

-- CreateEnum
CREATE TYPE "StatusInscricao" AS ENUM ('enviada', 'em_analise', 'homologada', 'indeferida', 'cancelada');

-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('doc_foto', 'laudo', 'outro');

-- CreateEnum
CREATE TYPE "FaseRecurso" AS ENUM ('inscricao', 'gabarito');

-- CreateEnum
CREATE TYPE "StatusRecurso" AS ENUM ('aberto', 'deferido', 'indeferido');

-- CreateEnum
CREATE TYPE "TipoPublicacao" AS ENUM ('edital', 'retificacao', 'gabarito_preliminar', 'gabarito_definitivo', 'resultado', 'classificacao', 'convocacao', 'outro');

-- CreateEnum
CREATE TYPE "AtorTipo" AS ENUM ('admin', 'candidato', 'sistema');

-- CreateEnum
CREATE TYPE "StatusNotificacao" AS ENUM ('enviado', 'falha');

-- CreateTable
CREATE TABLE "usuario_admin" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidato" (
    "id" SERIAL NOT NULL,
    "nome_completo" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefone" TEXT,
    "endereco" JSONB,
    "tem_deficiencia" BOOLEAN NOT NULL DEFAULT false,
    "descricao_deficiencia" TEXT,
    "senha_hash" TEXT NOT NULL,
    "email_verificado" BOOLEAN NOT NULL DEFAULT false,
    "email_token_hash" TEXT,
    "email_token_expira_em" TIMESTAMP(3),
    "reset_token_hash" TEXT,
    "reset_token_expira_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "edital" (
    "id" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "descricao" TEXT,
    "config_fases" JSONB NOT NULL,
    "data_abertura_inscricao" TIMESTAMP(3),
    "data_encerramento_inscricao" TIMESTAMP(3),
    "status" "StatusEdital" NOT NULL DEFAULT 'rascunho',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargo" (
    "id" SERIAL NOT NULL,
    "edital_id" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "qtd_vagas" INTEGER NOT NULL DEFAULT 1,
    "requisitos" TEXT,

    CONSTRAINT "cargo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inscricao" (
    "id" SERIAL NOT NULL,
    "candidato_id" INTEGER NOT NULL,
    "edital_id" INTEGER NOT NULL,
    "cargo_id" INTEGER NOT NULL,
    "numero_inscricao" TEXT NOT NULL,
    "status" "StatusInscricao" NOT NULL DEFAULT 'enviada',
    "motivo_indeferimento" TEXT,
    "reenvio_ate_em" TIMESTAMP(3),
    "termo_aceite_em" TIMESTAMP(3),
    "pdf_espelho_path" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inscricao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documento" (
    "id" SERIAL NOT NULL,
    "inscricao_id" INTEGER NOT NULL,
    "tipo" "TipoDocumento" NOT NULL,
    "arquivo_path" TEXT NOT NULL,
    "nome_original" TEXT,
    "mime" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "enviado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atendimento_especial" (
    "id" SERIAL NOT NULL,
    "inscricao_id" INTEGER NOT NULL,
    "tipo_necessidade" TEXT NOT NULL,
    "descricao" TEXT,
    "laudo_documento_id" INTEGER,

    CONSTRAINT "atendimento_especial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurso" (
    "id" SERIAL NOT NULL,
    "inscricao_id" INTEGER NOT NULL,
    "fase" "FaseRecurso" NOT NULL,
    "protocolo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "anexo_path" TEXT,
    "status" "StatusRecurso" NOT NULL DEFAULT 'aberto',
    "resposta_admin" TEXT,
    "respondido_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publicacao" (
    "id" SERIAL NOT NULL,
    "edital_id" INTEGER NOT NULL,
    "tipo" "TipoPublicacao" NOT NULL,
    "titulo" TEXT NOT NULL,
    "arquivo_path" TEXT NOT NULL,
    "nome_original" TEXT,
    "mime" TEXT,
    "publicado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publicacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_auditoria" (
    "id" SERIAL NOT NULL,
    "ator" "AtorTipo" NOT NULL,
    "ator_id" TEXT,
    "acao" TEXT NOT NULL,
    "entidade" TEXT,
    "entidade_id" TEXT,
    "detalhes" JSONB,
    "ip" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacao_email" (
    "id" SERIAL NOT NULL,
    "destinatario" TEXT NOT NULL,
    "assunto" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" "StatusNotificacao" NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "inscricao_id" INTEGER,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacao_email_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_admin_email_key" ON "usuario_admin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "candidato_cpf_key" ON "candidato"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "candidato_email_key" ON "candidato"("email");

-- CreateIndex
CREATE UNIQUE INDEX "edital_numero_key" ON "edital"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "inscricao_candidato_id_cargo_id_key" ON "inscricao"("candidato_id", "cargo_id");

-- CreateIndex
CREATE UNIQUE INDEX "inscricao_edital_id_numero_inscricao_key" ON "inscricao"("edital_id", "numero_inscricao");

-- CreateIndex
CREATE UNIQUE INDEX "atendimento_especial_inscricao_id_key" ON "atendimento_especial"("inscricao_id");

-- CreateIndex
CREATE UNIQUE INDEX "atendimento_especial_laudo_documento_id_key" ON "atendimento_especial"("laudo_documento_id");

-- CreateIndex
CREATE UNIQUE INDEX "recurso_protocolo_key" ON "recurso"("protocolo");

-- CreateIndex
CREATE INDEX "log_auditoria_entidade_entidade_id_idx" ON "log_auditoria"("entidade", "entidade_id");

-- CreateIndex
CREATE INDEX "log_auditoria_criado_em_idx" ON "log_auditoria"("criado_em");

-- CreateIndex
CREATE INDEX "notificacao_email_destinatario_idx" ON "notificacao_email"("destinatario");

-- AddForeignKey
ALTER TABLE "cargo" ADD CONSTRAINT "cargo_edital_id_fkey" FOREIGN KEY ("edital_id") REFERENCES "edital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscricao" ADD CONSTRAINT "inscricao_candidato_id_fkey" FOREIGN KEY ("candidato_id") REFERENCES "candidato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscricao" ADD CONSTRAINT "inscricao_edital_id_fkey" FOREIGN KEY ("edital_id") REFERENCES "edital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inscricao" ADD CONSTRAINT "inscricao_cargo_id_fkey" FOREIGN KEY ("cargo_id") REFERENCES "cargo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento" ADD CONSTRAINT "documento_inscricao_id_fkey" FOREIGN KEY ("inscricao_id") REFERENCES "inscricao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atendimento_especial" ADD CONSTRAINT "atendimento_especial_inscricao_id_fkey" FOREIGN KEY ("inscricao_id") REFERENCES "inscricao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atendimento_especial" ADD CONSTRAINT "atendimento_especial_laudo_documento_id_fkey" FOREIGN KEY ("laudo_documento_id") REFERENCES "documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurso" ADD CONSTRAINT "recurso_inscricao_id_fkey" FOREIGN KEY ("inscricao_id") REFERENCES "inscricao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publicacao" ADD CONSTRAINT "publicacao_edital_id_fkey" FOREIGN KEY ("edital_id") REFERENCES "edital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

