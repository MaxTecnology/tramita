-- Substitui os booleanos dueRollToBusinessDay/targetRollToBusinessDay por um enum
-- de 3 estados (NONE/FORWARD/BACKWARD), pra suportar "antecipar pro dia útil
-- anterior" além de "empurrar pro próximo dia útil". Feito manualmente (em vez
-- de deixar o Prisma dropar e recriar a coluna) pra preservar o valor já
-- configurado nos templates existentes: true -> FORWARD, false -> NONE.

-- CreateEnum
CREATE TYPE "BusinessDayRoll" AS ENUM ('NONE', 'FORWARD', 'BACKWARD');

-- AddColumn (temporário, com backfill logo abaixo)
ALTER TABLE "recurring_task_templates" ADD COLUMN "dueBusinessDayRoll" "BusinessDayRoll" NOT NULL DEFAULT 'NONE';
ALTER TABLE "recurring_task_templates" ADD COLUMN "targetBusinessDayRoll" "BusinessDayRoll" NOT NULL DEFAULT 'NONE';

-- Backfill a partir dos booleanos antigos
UPDATE "recurring_task_templates"
SET "dueBusinessDayRoll" = CASE WHEN "dueRollToBusinessDay" THEN 'FORWARD'::"BusinessDayRoll" ELSE 'NONE'::"BusinessDayRoll" END,
    "targetBusinessDayRoll" = CASE WHEN "targetRollToBusinessDay" THEN 'FORWARD'::"BusinessDayRoll" ELSE 'NONE'::"BusinessDayRoll" END;

-- DropColumn (booleanos antigos)
ALTER TABLE "recurring_task_templates" DROP COLUMN "dueRollToBusinessDay";
ALTER TABLE "recurring_task_templates" DROP COLUMN "targetRollToBusinessDay";
