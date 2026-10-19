-- @@unique([organizationId, code]) em ObligationType não impede dois registros GLOBAIS
-- (organizationId IS NULL) com o mesmo code — o Postgres trata múltiplos NULL como distintos por
-- padrão nesse tipo de índice. Índice único parcial, escopado só às linhas globais: a unicidade
-- por organização (quando organizationId não é NULL) continua garantida pelo índice já existente
-- de @@unique([organizationId, code]); este índice cobre só o caso que ele deixa passar.
CREATE UNIQUE INDEX "obligation_types_code_global_key" ON "obligation_types"("code") WHERE "organizationId" IS NULL;
