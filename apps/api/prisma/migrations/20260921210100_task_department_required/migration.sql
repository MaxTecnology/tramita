-- Confirmado (2026-09-21): não há nenhuma tarefa de teste sem departamento em
-- nenhum ambiente hoje. Se essa suposição estiver errada em algum ambiente
-- compartilhado, esse ALTER falha alto e claro (erro de migration), nunca
-- corrompe dado — não há necessidade de backfill.
ALTER TABLE "tasks" ALTER COLUMN "departmentId" SET NOT NULL;
