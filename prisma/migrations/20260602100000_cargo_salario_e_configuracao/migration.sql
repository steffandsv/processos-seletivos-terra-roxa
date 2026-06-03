-- AlterTable
ALTER TABLE "cargo" ADD COLUMN     "carga_horaria" TEXT,
ADD COLUMN     "salario" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "configuracao" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "smtp_host" TEXT,
    "smtp_port" INTEGER DEFAULT 587,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT false,
    "smtp_user" TEXT,
    "smtp_pass_cifrada" TEXT,
    "smtp_from" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracao_pkey" PRIMARY KEY ("id")
);

