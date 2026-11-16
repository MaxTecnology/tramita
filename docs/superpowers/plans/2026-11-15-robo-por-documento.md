# Robô por documento a entregar — plano de implementação

> Execução: superpowers:executing-plans (nativa), revisor final no fim. Passos em ordem RED → GREEN.

**Objetivo:** o robô de leitura passa a preencher **a entrega certa** de cada tarefa (obrigação por
documento a entregar), com uma fila de conferência fácil (confirmar em lote) e conferência também na
entrega manual pela tela da tarefa.

**Spec:** `docs/superpowers/specs/2026-11-15-robo-por-documento-design.md`

## Restrições globais

- Código em inglês; mensagens ao usuário em pt-BR. Sem `any`/`as unknown`; Zod em toda entrada;
  Prisma só nos serviços; `AppError`.
- Nada é entregue ao cliente sem confirmação humana (sem entrega automática).
- CNPJ de outro cliente do escritório **nunca** é entregue (fila e manual).
- Migrations escritas via `migrate diff` contra o banco de teste, aplicadas em dev e teste, validadas
  pelo `db-migration-checker`.

## Review Focus

1. Documento sugerido para uma entrega que foi preenchida (à mão ou por outro documento) entre a
   sugestão e a confirmação → 409 claro, nada duplicado no cliente.
2. Confirmar em lote com um documento que falha (CNPJ, entrega já feita, reserva de outro revisor)
   → os outros são entregues e o resumo diz qual falhou e por quê.
3. Entrega manual: o cliente nunca contorna a conferência enviando direto ao upload sem passar pela
   checagem (a API reconfere no upload; aviso exige `acceptWarnings`, bloqueio nunca é aceito).
4. Template com várias entregas com robô da mesma obrigação na mesma tarefa → casamento ambíguo vai
   para a fila (nunca escolhe uma ao acaso).
5. Migração: template com obrigação e uma entrega leva a obrigação para a entrega e para as entregas
   abertas das tarefas dele; template com 0 ou várias entregas não migra; nada quebra a geração.

---

### Task 1: Banco — obrigação na entrega

**Arquivos:** `prisma/schema.prisma`, migration `2026111516xxxx_obligation_per_deliverable`,
`recurring-templates.schema.ts|service.ts`, geração de tarefas recorrentes; testes em
`recurring-templates/obligation-per-deliverable.test.ts`.

- `RecurringTaskTemplateDocument.obligationTypeId?` (FK ObligationType, SetNull),
  `TaskDeliverable.obligationTypeId?` (FK, SetNull), `ReceivedDocument.deliverableId?` (FK TaskDeliverable,
  SetNull). Remove `RecurringTaskTemplate.obligationTypeId` (migração copia antes, regra da spec).
- API do template: `documentDeliveries[].obligationTypeId?` (cuid, da org ou global); remove
  `obligationTypeId` do template.
- Geração copia `obligationTypeId` da linha do template para o `TaskDeliverable`.
- Testes: criar/editar template com obrigação por entrega; obrigação de outra org → 404; geração copia.

### Task 2: Web — seletor 🤖 no formulário do template

**Arquivos:** `pages/app/settings/RecurringTemplateForm.tsx` (+ teste).

- Em "A entregar ao cliente", cada item: seletor 🤖 (Nenhum / obrigações de `/document-reader/obrigacoes`).
- Sai o bloco "Avançado: obrigação do robô de leitura". Resumo mostra "N com robô".
- Teste: escolher DAS num item e salvar envia `documentDeliveries[i].obligationTypeId`.

### Task 3: Robô casa por entrega

**Arquivos:** `document-reader.service.ts` (`processarDocumento`, `anexarDocumento`,
`listarFilaDeRevisao`), `engine/pipeline.ts` (`decidir` recebe entregas); testes.

- Base de casamento: entregas **pendentes** com `obligationTypeId` cujo código = tipo lido, em tarefas
  abertas do cliente, mesma competência. Uma → `taskId` + `deliverableId` sugeridos; nenhuma/várias →
  fila com motivo.
- `anexarDocumento` usa `deliverableId` sugerido quando não vier outro; entrega já preenchida → 409
  "Essa entrega já foi feita".
- Fila devolve, por documento: cliente, obrigação, entrega, tarefa, competência e `checks`
  (`cnpj`, `competence`, `payment` com valor/vencimento lidos) e `ready` (todos ok).
- Histórico da confirmação: `deliverable_delivered` com "conferido pelo robô".
- Testes: uma/nenhuma/várias candidatas; entrega preenchida no meio → 409; fila com checks/ready.

### Task 4: Confirmar em lote

**Arquivos:** `document-reader.routes.ts|service.ts|schema.ts`; testes.

- `POST /document-reader/confirmar-lote` `{ ids: string[] }` (≤ 50) → por documento
  `{ id, ok, error?, taskId?, completion? }` e resumo `{ delivered, completed, ready, failed }`.
- Cada documento reusa `confirmarSugestao` (mesma reserva, mesmas travas); falha de um não para os
  outros.
- `completion` igual à entrega manual (`AUTO_COMPLETED | READY | PENDING`).
- Testes: lote misto (ok + CNPJ divergente + reserva de outro revisor); resumo correto.

### Task 5: Web — fila de conferência nova

**Arquivos:** `pages/app/document-reader/ReviewQueue.tsx` (+ teste).

- Linha: arquivo, cliente, "DAS → Guia DAS", tarefa/competência, selos ✓/⚠; valor/vencimento
  editáveis quando faltam; **Confirmar**, **Trocar tarefa/entrega**, **Recusar**, **Ver PDF** (painel
  ao lado).
- **Confirmar os N sem pendência**; depois, resumo e **Concluir as N prontas** (PATCH status DONE).
- Testes: lote envia só os `ready`; linha com valor faltando só confirma depois de preencher;
  "Concluir as prontas".

### Task 6: Conferência do robô na entrega manual

**Arquivos:** `task-documents.service.ts|routes.ts`, novo `delivery-check.ts`; web
`TaskDrawer.tsx`; testes API e web.

- `POST /tasks/:id/documents/deliveries/:reqId/check` (multipart, arquivo) → `{ blocked?: string,
  warnings: string[], read: { amount?, dueDate? } }` (sem gravar nada).
- Upload da entrega com obrigação de robô reconfere: bloqueio → 422; avisos sem `acceptWarnings=true`
  → 409 com os avisos; com `acceptWarnings` → entrega e grava `deliverable_delivered_with_warnings`
  (avisos no histórico). Sem obrigação → como hoje.
- Web: ao escolher o arquivo, chama `check`; bloqueio → mensagem; avisos → diálogo "Entregar mesmo
  assim"; guia → formulário de pagamento já com valor/vencimento lidos.
- Testes: cada linha da tabela da spec; arquivo ilegível; histórico com avisos; contornar a checagem
  chamando o upload direto → 409/422.

### Task 7: E2E, docs e QA

- E2E: seed com template "Simples" e entrega "Guia DAS" com robô; subir PDF de DAS de teste na fila
  → confirmar → cliente vê em Documentos recebidos; entrega manual com competência errada → aviso →
  mesmo assim → histórico.
- SPEC.md (rotas novas), TASKS.md, tech-debt. QA claro/escuro da fila e do diálogo.
