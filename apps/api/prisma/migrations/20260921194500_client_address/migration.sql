-- AlterTable: adiciona campos de endereço ao cliente (opcionais — preenchidos
-- manualmente ou via consulta de CNPJ na tela de cadastro)
ALTER TABLE "clients" ADD COLUMN "cep" TEXT;
ALTER TABLE "clients" ADD COLUMN "estado" TEXT;
ALTER TABLE "clients" ADD COLUMN "cidade" TEXT;
ALTER TABLE "clients" ADD COLUMN "bairro" TEXT;
ALTER TABLE "clients" ADD COLUMN "logradouro" TEXT;
ALTER TABLE "clients" ADD COLUMN "numero" TEXT;
ALTER TABLE "clients" ADD COLUMN "complemento" TEXT;
