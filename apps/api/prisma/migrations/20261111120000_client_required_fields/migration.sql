-- Código do cliente (número no ERP contábil) passa a ser obrigatório
DROP INDEX "clients_codigo_organizationId_key";
ALTER TABLE "clients" ALTER COLUMN "codigo" SET NOT NULL;

-- PJ exige CNPJ, PF exige CPF
ALTER TABLE "clients" ADD CONSTRAINT "clients_document_by_type_check"
  CHECK (("clientType" = 'PJ' AND "cnpj" IS NOT NULL) OR ("clientType" = 'PF' AND "cpf" IS NOT NULL));

-- Unicidade só entre clientes ativos (cliente desativado não trava recadastro)
CREATE UNIQUE INDEX "clients_codigo_active_key" ON "clients"("organizationId", "codigo") WHERE "isActive";
CREATE UNIQUE INDEX "clients_cnpj_active_key" ON "clients"("organizationId", "cnpj") WHERE "isActive" AND "cnpj" IS NOT NULL;
CREATE UNIQUE INDEX "clients_cpf_active_key" ON "clients"("organizationId", "cpf") WHERE "isActive" AND "cpf" IS NOT NULL;
