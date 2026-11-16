# Ordens de Serviço e Processos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OS vira a peça básica (tarefa configurada por um Modelo de OS), Processo é um board montado com OS (Modelo de Processo), com prazo interno em dias úteis que pausa aguardando o cliente, data limite fixa, motivo de atraso, dependência entre OS, tempo por etapa e "solicitar serviço" no portal.

**Architecture:** Calendário único de dias úteis (`lib/business-days.ts` + feriados da org) usado pelas recorrentes e pelo prazo. `OSTemplate` é renomeado para `ProcessTemplate`; novo `OSModel`. Abrir OS/processo cria tarefas (`Task.osModelId`) — avulsa num board de sistema `SERVICE_SYSTEM` do cliente, de processo no board `PROCESS`. Um módulo `os-deadline` mantém pausas (`TaskPause`/`BoardPause`), meta (`targetDate`), liberação por dependência e exigência de motivo de atraso. O robô não muda: OS é tarefa com entregas com robô e competência.

**Tech Stack:** Fastify v5, Prisma 6, Zod, Vitest (API); React 19, TanStack Query, Tailwind v4 tokens, msw/Vitest, Playwright (web).

**Spec:** `docs/superpowers/specs/2026-11-15-os-processos-design.md`

## Global Constraints

- Respostas/mensagens ao usuário em pt-BR; código, nomes e comentários em inglês.
- TypeScript strict, sem `any`/`as unknown`; Zod em body/params/query; erros via `AppError(status, mensagem)`; Prisma só em `*.service.ts`; toda query filtrada por `organizationId`.
- Migrations versionadas via `pnpm --filter api migrate:dev -- --name <nome>`; pré-produção: renomear sem compatibilidade, reset do banco local liberado. Cada migration passa pelo `db-migration-checker`.
- Dia útil = seg–sex menos feriados nacionais embutidos (fixos + Sexta-feira Santa) e feriados da organização; **a mesma regra vale para as recorrentes** (vencimento/meta com rolagem pulam feriados). Tarefas já geradas não mudam.
- Pausa = documento obrigatório do cliente `PENDING`/`REJECTED` **ou** aprovação do cliente pendente; `UPLOADED` não pausa; aprovação pendente pausa sem mudar status.
- OS esperando dependência: `releasedAt = null`, status `OPEN`, nunca `BLOCKED`; API recusa iniciar/mover/concluir com 409 `'Esta OS aguarda: <títulos>'`.
- Concluir OS atrasada (meta < hoje, já descontada a pausa) sem motivo → 422 `'Informe o motivo do atraso'`; processo → 422 `'Informe o motivo do atraso do processo'`. Conclusão automática não bloqueia: marca `delayReasonPending = true`.
- Motivos padrão de atraso: "Aguardando órgão público", "Retrabalho interno", "Volume de trabalho", "Outro" ("Outro" exige observação: 422 `'Descreva o motivo'`).
- Copy de telas: "Modelos de OS", "Modelos de Processo", "Motivos de atraso", "Feriados", "Ordens de Serviço", "Nova OS", "Solicitar serviço", "⏸ aguardando cliente há X dias", "atrasada há X dias úteis", "faltam X dias úteis", "aguardando <OS>".
- QA visual com screenshots reais em claro e escuro das telas novas (memória do projeto).

## Review Focus

1. Feriado ou fim de semana no dia da liberação / pausa que começa e termina no mesmo dia → contagem de dias úteis não pode pular nem dobrar um dia (testes de borda na Task 1 e Task 6).
2. Duas OS dependentes da mesma OS concluída ao mesmo tempo, ou dependência desconsiderada (`DISREGARDED`) → ambas liberadas uma vez só, avisadas uma vez (Task 6).
3. Concluir por caminhos alternativos (arrastar para coluna DONE, "concluir prontas" do robô, conclusão automática por entrega) → mesma regra de motivo de atraso (Task 7).
4. Pedido do cliente com modelo que pede competência sem informar o mês, ou modelo desativado/“só de processo” enviado direto à API → 422, nada criado (Task 8).
5. Membro (escopo LIMITED) na lista de OS e na abertura de OS/processo para cliente fora da carteira → mesmo escopo de Tarefas/criação de board (Task 9 e Task 5).

---

### Task 1: Calendário de dias úteis e feriados (inclui recorrentes)

**Files:**
- Create: `apps/api/src/lib/business-days.ts`, `apps/api/src/lib/business-days.test.ts`
- Create: `apps/api/src/modules/holidays/holidays.{routes,service,schema}.ts`, `holidays.routes.test.ts`
- Modify: `apps/api/prisma/schema.prisma` (model `Holiday`), `apps/api/src/server.ts` (registrar rotas)
- Modify: `apps/api/src/modules/recurring-templates/recurrence-dates.ts` (rolagem recebe feriados), `recurring-templates.service.ts` (carrega feriados ao gerar), `recurrence-dates.test.ts`
- Create: `apps/web/src/pages/app/settings/Holidays.tsx` + entrada no `SettingsHub.tsx`

**Interfaces:**
- Produces: `type HolidaySet = ReadonlySet<string>` ('YYYY-MM-DD'); `nationalHolidays(year: number): string[]`; `isBusinessDay(d: Date, h: HolidaySet): boolean`; `addBusinessDays(start: Date, n: number, h: HolidaySet): Date` (n-ésimo dia útil **depois** de `start`, data UTC 00:00; n=0 devolve `start`); `businessDaysBetween(from: Date, to: Date, h: HolidaySet): number` (dias úteis d com from < d ≤ to; 0 se to ≤ from); `loadHolidaySet(organizationId: string, years: number[]): Promise<HolidaySet>` (em `holidays.service.ts`, nacionais + da org).
- Model `Holiday { id, organizationId, date @db.Date, name, createdAt; @@unique([organizationId, date]) }`.
- Rotas (ORG_ADMIN escreve, staff lê): `GET /holidays?year=` → `{ national: {date,name}[], custom: Holiday[] }`; `POST /holidays {date, name}` (409 `'Já existe feriado nesta data'`); `DELETE /holidays/:id`.
- `rollToBusinessDay(date, direction, holidays: HolidaySet)` e as funções exportadas de `recurrence-dates.ts` que rolam ganham parâmetro final `holidays: HolidaySet = new Set()`.

- [ ] **Step 1: Testes que falham** — `business-days.test.ts`:
  - `nationalHolidays(2026)` contém `'2026-01-01','2026-04-03','2026-04-21','2026-05-01','2026-09-07','2026-10-12','2026-11-02','2026-11-15','2026-11-20','2026-12-25'` (Sexta-feira Santa 2026 = 03/04; 20/11 Consciência Negra é nacional desde 2024).
  - `addBusinessDays(2026-11-13 (sex), 1, nacionais)` → `2026-11-16`; `addBusinessDays(2026-11-19, 1, nacionais)` → `2026-11-23` (20/11 feriado, 21–22 fim de semana); `addBusinessDays(2026-12-31, 1, nacionais)` → `2027-01-04`.
  - `businessDaysBetween(2026-11-13, 2026-11-16, …)` = 1; mesmo dia = 0.
  - `recurrence-dates.test.ts`: vencimento dia 20/11/2026 com `FORWARD` e feriados → 23/11/2026; sem feriados → 20/11 (sexta).
- [ ] **Step 2:** `pnpm --filter api exec vitest run src/lib/business-days.test.ts src/modules/recurring-templates/recurrence-dates.test.ts` → FAIL (módulo inexistente / 20/11).
- [ ] **Step 3:** Implementar; Páscoa pelo algoritmo de Meeus/Butcher; gerador (`generateTaskForAssignment`, `generateBulkForTemplate`, prévia em `recurring-templates`) carrega `loadHolidaySet(orgId, [ano, ano+1])` uma vez por execução.
- [ ] **Step 4:** Migration `holidays`; testes de rota (`holidays.routes.test.ts`: lista nacionais+custom, 409 duplicado, membro não cria → 403, outra org não vê). Web `Holidays.tsx`: lista do ano (seletor), nacionais só leitura, adicionar/remover custom.
- [ ] **Step 5:** `pnpm --filter api exec vitest run src/lib src/modules/holidays src/modules/recurring-templates` → PASS; `pnpm --filter web exec tsc --noEmit`.
- [ ] **Step 6:** Commit `feat(calendario): dias úteis com feriados nacionais e do escritório, inclusive nas recorrentes`.

### Task 2: Renomear Template de OS → Modelo de Processo

**Files:**
- Modify: `apps/api/prisma/schema.prisma` — `OSTemplate`→`ProcessTemplate` (`@@map("process_templates")`), `OSTemplateColumn`→`ProcessTemplateColumn`, `OSTemplateColumnDocument`→`ProcessTemplateColumnDocument`; `Board.osTemplateId`→`processTemplateId`; `BoardType { PROCESS, RECURRING_SYSTEM, SERVICE_SYSTEM }` (OS→PROCESS); `ProcessTemplate` ganha `departmentId String?` (FK Department), `deadlineBusinessDays Int?`, `clientCanRequest Boolean @default(false)`; `Board` ganha `deadlineBusinessDays Int?`, `competence DateTime?`, `completedAt DateTime?`, `delayReasonId String?`, `delayNote String?`, `delayReasonPending Boolean @default(false)`.
- Move: `apps/api/src/modules/os-templates/` → `apps/api/src/modules/process-templates/` (rotas `/process-templates`).
- Modify: todas as referências (`boards`, `requests`, `tasks`, `portal`, `dashboard`, `inbox`, `staff-scope`, seeds `prisma/seed.ts`, `prisma/e2e-seed.ts`); web `types/index.ts`, `settings/OSTemplates.tsx`→`ProcessTemplates.tsx`, `OSTemplateForm.tsx`→`ProcessTemplateForm.tsx`, `SettingsHub.tsx`, `Processes.tsx`, `Board.tsx`.

**Interfaces:**
- Produces: `prisma.processTemplate`, `Board.type: 'PROCESS' | 'RECURRING_SYSTEM' | 'SERVICE_SYSTEM'`, `Board.processTemplateId`; rota `GET/POST/PATCH/DELETE /process-templates`. Requests ainda usam `osTemplateId` até a Task 8 — renomear a coluna de `Request` para `processTemplateId` aqui.

- [ ] **Step 1:** Ajustar os testes existentes de `os-templates` (mover para `process-templates`) e de boards para a URL/nomes novos + teste novo: `POST /process-templates` com `deadlineBusinessDays: 30, clientCanRequest: true, departmentId` devolve os campos; departamento de outra org → 404 `'Departamento não encontrado'`.
- [ ] **Step 2:** Rodar → FAIL (rota inexistente).
- [ ] **Step 3:** Migration `rename_os_template_to_process_template` (rename de tabelas/colunas/enum via SQL, sem perder dados); atualizar código e web.
- [ ] **Step 4:** `pnpm --filter api test` e `pnpm --filter web exec vitest run` → PASS; `tsc` nos dois.
- [ ] **Step 5:** Commit `refactor(processos): Template de OS vira Modelo de Processo (prazo, departamento, solicitável)`.

### Task 3: Modelo de OS (API)

**Files:**
- Create: `apps/api/src/modules/os-models/os-models.{routes,service,schema}.ts`, `os-models.routes.test.ts`
- Modify: `schema.prisma` — `OSModel { id, organizationId, name, description?, departmentId, priority Priority @default(MEDIUM), visibleToClient Boolean @default(true), requiresCompetence Boolean @default(false), deadlineBusinessDays Int?, autoCompleteOnAllDelivered Boolean @default(false), usableStandalone Boolean @default(true), usableInProcess Boolean @default(false), isActive Boolean @default(true), timestamps; @@index([organizationId, isActive]) }`; `OSModelDocument { id, requestModelId?, deliveryModelId?, name, position, requiresPayment Boolean @default(false), obligationTypeId? }` (mesmo padrão de `RecurringTaskTemplateDocument`, cascade).

**Interfaces:**
- Produces: `GET /os-models?usage=standalone|process` (ativos filtrados por uso), `GET /os-models/:id`, `POST /os-models`, `PATCH /os-models/:id`, `DELETE /os-models/:id` (desativa se já houver tarefa). Body: `{ name, description?, departmentId, priority?, visibleToClient?, requiresCompetence, deadlineBusinessDays?: int 1..365, autoCompleteOnAllDelivered, usableStandalone, usableInProcess, documentRequests: {name}[], documentDeliveries: {name, requiresPayment?, obligationTypeId?}[] }`. Service: `getOSModelForOrg(id, orgId)`.
- Reaproveitar `assertDeliveryObligations` de `recurring-templates.service.ts` (exportar se preciso).

- [ ] **Step 1:** Testes: cria e lê com entregas e robô; nenhum uso marcado → 422 `'Marque onde essa OS é usada'`; entrega com robô e `requiresCompetence: false` → 422 `'OS com robô precisa pedir competência'`; obrigação de outra org → 404; `?usage=process` só traz `usableInProcess`; membro não cria → 403.
- [ ] **Step 2:** Rodar → FAIL. **Step 3:** Migration `os_models` + implementação. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(os): Modelo de OS com documentos, robô, prazo e onde é usada`.

### Task 4: Telas de Modelo de OS e Modelo de Processo (web)

**Files:**
- Create: `apps/web/src/pages/app/settings/OSModels.tsx`, `OSModelForm.tsx`, `OSModelForm.test.tsx`
- Modify: `RecurringTemplateForm.tsx` — exportar o editor de lista de documentos (`DocumentListEditor`) para reuso, sem mudar comportamento
- Modify: `ProcessTemplateForm.tsx` (+ `ProcessTemplateForm.test.tsx`) — departamento, prazo em dias úteis, "Cliente pode solicitar", seção **OS do processo**
- Modify: `SettingsHub.tsx`, `App.tsx` (rotas), `types/index.ts`

**Interfaces:**
- Consumes: Task 3 rotas; Task 5 `items` em `/process-templates` (o form envia `items: { osModelId, columnIndex, dependsOn: number[] }[]` — índices na própria lista).
- `OSModelForm`: mesmos blocos visuais do `RecurringTemplateForm` (cabeçalho, cards de documentos, seletor 🤖), campos da Task 3, caixas "Avulsa — o escritório abre e o cliente pode solicitar" e "Dentro de processos".

- [ ] **Step 1:** Testes: `OSModelForm` envia o body da Task 3 (com `obligationTypeId` na entrega); marcar 🤖 marca e trava "Pede competência"; desmarcar as duas caixas mostra "Marque onde essa OS é usada" e não envia. `ProcessTemplateForm`: lista de OS oferece só `usage=process`; escolher coluna e "depende de" envia `items`; dependência que forma ciclo mostra "Dependência circular" e não envia.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** `pnpm --filter web exec vitest run src/pages/app/settings` → PASS.
- [ ] **Step 5:** Commit `feat(web): telas de Modelo de OS e Modelo de Processo com OS e dependências`.

### Task 5: Abrir OS e abrir Processo

**Files:**
- Create: `apps/api/src/modules/os/os.{routes,service,schema}.ts`, `os.open.test.ts`
- Modify: `schema.prisma` — `ProcessTemplateItem { id, templateId, osModelId, columnPosition Int, position Int }`, `ProcessTemplateItemDependency { itemId, dependsOnItemId, @@id([itemId, dependsOnItemId]) }`; `Task` ganha `osModelId String?` (FK, `@@index([osModelId])`), `releasedAt DateTime?`, `deadlineBusinessDays Int?`, `delayReasonId String?`, `delayNote String?`, `delayReasonPending Boolean @default(false)`; `TaskDependency { taskId, dependsOnTaskId, @@id([taskId, dependsOnTaskId]), @@index([dependsOnTaskId]) }`.
- Modify: `process-templates.service.ts` (salvar/ler `items`, recusar ciclo 422 `'Dependência circular entre OS'`, item com modelo sem `usableInProcess` → 422 `'Essa OS não é usada em processos'`)
- Modify: `boards.service.ts` `createBoard` (com `processTemplateId` cria as OS dos itens), `tasks.service.ts` (`ensureServiceSystemBoard(clientId, orgId)` análogo a `ensureRecurringSystemBoard`, colunas âncora OPEN/STARTED/BLOCKED/DONE)

**Interfaces:**
- Produces: `openOS(input: { organizationId; actor: {id; role}; osModelId; clientId; competence?: Date; assigneeId?: string; dueDate?: Date; boardId?: string; columnId?: string; dependsOnTaskIds?: string[]; sourceRequestId?: string }): Promise<Task>` — sem `boardId` cria no board de serviços; com `boardId` (processo) adiciona ao processo. Copia documentos a cobrar/entregar (com `obligationTypeId`, `requiresPayment`), título `"<modelo> — MM/AAAA"` quando há competência, `deadlineBusinessDays`, `releasedAt = now` se sem dependências pendentes, chama `scheduleDeadline(taskId)` (Task 6).
- `openProcess(input: { organizationId; actor; processTemplateId; clientId; competence?: Date; title?: string; responsibleUserId?: string; dueDate?: Date; sourceRequestId?: string }): Promise<Board>` — cria board PROCESS (colunas do modelo), uma OS por item na coluna `columnPosition`, `TaskDependency` a partir dos itens; competência copiada para OS cujo modelo pede (422 `'Informe a competência'` se algum pede e não veio).
- Rotas: `POST /os` (body = openOS sem org/actor), `POST /boards` com `processTemplateId` passa a chamar `openProcess`, `POST /boards/:id/os` (adicionar OS a processo: `osModelId, columnId, dependsOnTaskIds?`). Escopo: cliente dentro de `clientWhere(scope)` como `createBoard`; modelo `usableStandalone` exigido em `POST /os` sem `boardId` (422 `'Essa OS é só de processo'`).

- [ ] **Step 1:** Testes `os.open.test.ts`: OS avulsa nasce no board `SERVICE_SYSTEM` do cliente com entregas com robô e competência, título "Recálculo DAS — 03/2025", `releasedAt` setado; segundo `openOS` reaproveita o mesmo board; modelo que pede competência sem competência → 422 `'Informe a competência'`; modelo só de processo em `POST /os` → 422; processo "Abertura" com itens A (col 0), B depende de A, C depende de A e B → 3 tarefas nas colunas, B e C com `releasedAt null`, A liberada; membro abrindo para cliente fora da carteira → 404 `'Cliente não encontrado'`. **Robô:** `processarDocumento` de um PDF com CNPJ do cliente e competência 03/2025 sugere a OS avulsa e a entrega (usar `gerarPdfComDocumentoArrecadacao` como em `robo-por-entrega.test.ts`).
- [ ] **Step 2:** FAIL. **Step 3:** Migration `os_tasks_and_process_items` + implementação. **Step 4:** `pnpm --filter api exec vitest run src/modules/os src/modules/process-templates src/modules/boards src/modules/document-reader` → PASS.
- [ ] **Step 5:** Commit `feat(os): abrir OS avulsa e processo com OS e dependências`.

### Task 6: Prazo interno, pausa, liberação por dependência

**Files:**
- Create: `apps/api/src/modules/os/os-deadline.service.ts`, `os-deadline.test.ts`
- Modify: `schema.prisma` — `TaskPause { id, taskId, startedAt, endedAt?, @@index([taskId]) }`, `BoardPause { id, boardId, startedAt, endedAt?, @@index([boardId]) }`
- Modify: `task-documents.service.ts` `recalculateTaskStatus` (chama `syncPause`), `approvals` service (pedir/decidir aprovação chama `syncPause`), `tasks.service.ts` (`updateTask`/`moveTask`: recusa OS não liberada; ao virar DONE/DISREGARDED chama `onOSFinished`)
- Modify: `os.routes.ts` — `POST /tasks/:id/release { reason }` (ORG_ADMIN/ORG_MANAGER)

**Interfaces:**
- Produces (em `os-deadline.service.ts`):
  - `isWaitingClient(taskId): Promise<boolean>` — requisito `PENDING`/`REJECTED` ou `TaskApproval` pendente.
  - `syncPause(taskId): Promise<void>` — abre/fecha `TaskPause` conforme `isWaitingClient`; ao fechar recalcula meta; depois `syncBoardPause(boardId)` se a tarefa é de processo.
  - `scheduleDeadline(taskId): Promise<void>` — se `deadlineBusinessDays` e `releasedAt`: `targetDate = addBusinessDays(releasedAt, deadlineBusinessDays + pausedBusinessDays, holidays)`.
  - `deadlineInfo(task, now, holidays): { state: 'NONE'|'ON_TIME'|'DUE_SOON'|'LATE'|'PAUSED'|'WAITING_DEPENDENCY'|'DONE'; businessDaysLeft?: number; businessDaysLate?: number; pausedSinceDays?: number; officeBusinessDays: number; clientBusinessDays: number }` (DUE_SOON = faltam ≤ `slaTargetWarningDays`).
  - `onOSFinished(taskId, actor): Promise<void>` — libera dependentes cujas dependências estão todas DONE/DISREGARDED (`releasedAt = now`, `scheduleDeadline`, inbox ao responsável: `"<OS> foi liberada"`), recalcula `syncProcessCompletion(boardId)`.
  - `assertReleased(taskId): Promise<void>` → 409 `'Esta OS aguarda: <títulos>'`.
  - `releaseEarly(taskId, actor, reason): Promise<void>` — histórico `os_released_early`.
  - Processo: `syncBoardPause(boardId)` (pausado quando todas as OS liberadas e não concluídas estão pausadas), `scheduleBoardDeadline(boardId)` (meta = `createdAt` + N + dias pausados), `syncProcessCompletion(boardId)` (todas DONE/DISREGARDED → `completedAt`; nova OS aberta → `completedAt = null`).
- Histórico: `os_paused`/`os_resumed`/`os_released`/`os_released_early`.

- [ ] **Step 1:** Testes: OS com prazo 3 liberada sex 13/11/2026 → meta qua 18/11; documento obrigatório PENDING aberto seg 16/11 e resolvido qua 18/11 → 2 dias úteis pausados (17 e 18) → meta = `addBusinessDays(13/11, 5)` = seg 23/11 (20/11 feriado); `UPLOADED` não pausa; aprovação pendente pausa sem mudar status; OS não liberada: PATCH status STARTED, mover e concluir → 409 `'Esta OS aguarda: A'`; concluir A libera B uma vez e avisa o responsável; C (depende de A e B) só libera após B; A `DISREGARDED` também libera; duas conclusões concorrentes de A e B → C liberada uma vez (um `os_released` no histórico); `releaseEarly` por membro → 403; processo conclui quando todas terminam e reabre ao adicionar OS; `deadlineInfo` com pausa aberta → `PAUSED` e `clientBusinessDays` correto.
- [ ] **Step 2:** FAIL. **Step 3:** Migration `os_pauses` + implementação (escrita da liberação com `updateMany where releasedAt null` para não liberar duas vezes). **Step 4:** `pnpm --filter api exec vitest run src/modules/os src/modules/tasks src/modules/task-documents src/modules/approvals` → PASS.
- [ ] **Step 5:** Commit `feat(os): prazo em dias úteis com pausa aguardando cliente e liberação por dependência`.

### Task 7: Motivo de atraso

**Files:**
- Create: `apps/api/src/modules/delay-reasons/delay-reasons.{routes,service,schema}.ts`, `delay-reasons.test.ts`
- Modify: `schema.prisma` — `DelayReason { id, organizationId, name, requiresNote Boolean @default(false), isActive Boolean @default(true), position Int, @@unique([organizationId, name]) }`; FKs `Task.delayReasonId`, `Board.delayReasonId`
- Modify: `tasks.schema.ts`/`tasks.service.ts` (`updateTask` e `moveTask` aceitam `delayReasonId?`, `delayNote?`, `processDelayReasonId?`, `processDelayNote?`), `task-documents.service.ts` (conclusão automática → `delayReasonPending`), `os.routes.ts` (`PATCH /tasks/:id/delay-reason`, `PATCH /boards/:id/delay-reason` para registrar antes ou resolver pendente)
- Create: `apps/web/src/pages/app/settings/DelayReasons.tsx`

**Interfaces:**
- Produces: `listDelayReasons(orgId)` (cria os 4 padrões na primeira leitura da org), `assertDelayReasonOnFinish(taskId, input, now): Promise<{ delayReasonId?: string; delayNote?: string }>` — se `deadlineInfo` = LATE e sem motivo registrado nem informado → 422 `'Informe o motivo do atraso'`; motivo com `requiresNote` sem nota → 422 `'Descreva o motivo'`; idem processo quando esta conclusão fecha um processo atrasado → 422 `'Informe o motivo do atraso do processo'`.
- Rotas: `GET /delay-reasons`, `POST/PATCH/DELETE /delay-reasons` (ORG_ADMIN). Histórico `delay_reason_set` (fromValue = nome do motivo, toValue = nota).

- [ ] **Step 1:** Testes: concluir OS atrasada via PATCH sem motivo → 422; com motivo → 200 e histórico; mover para coluna DONE sem motivo → 422; "Outro" sem nota → 422; motivo registrado antes (`PATCH /tasks/:id/delay-reason`) → conclui sem pedir; conclusão automática por entrega de OS atrasada → conclui com `delayReasonPending: true`; OS no prazo nunca pede; última OS de processo atrasado sem `processDelayReasonId` → 422 do processo; motivo de outra org → 404.
- [ ] **Step 2:** FAIL. **Step 3:** Migration `delay_reasons` + implementação. **Step 4:** PASS (`src/modules/delay-reasons src/modules/tasks src/modules/os src/modules/task-documents`).
- [ ] **Step 5:** Commit `feat(os): motivo de atraso obrigatório ao concluir fora do prazo`.

### Task 8: Solicitar serviço (portal) e aprovação

**Files:**
- Modify: `schema.prisma` — `Request`: `osModelId String?`, `processTemplateId String?` (já renomeado na Task 2), `competence DateTime?`, `boardId String?` (processo criado)
- Modify: `requests.schema.ts`/`requests.service.ts` (`createRequest`, `approveRequest`), `portal.routes.ts`/`portal.service.ts` (`GET /portal/services`), web `pages/portal/Requests.tsx` (+ test), `pages/app/Requests.tsx` (aprovar)

**Interfaces:**
- `GET /portal/services` → `{ kind: 'OS' | 'PROCESS'; id; name; description: string | null; departmentId: string; requiresCompetence: boolean }[]` — OS: `isActive && usableStandalone`; processo: `clientCanRequest` com departamento; só departamentos que atendem o cliente (regra atual de `requestDepartment`).
- `createRequest` (cliente): `{ title, description?, departmentId?, osModelId?, processTemplateId?, competence?: 'YYYY-MM' }` — no máximo um modelo; com modelo o departamento vem do modelo; modelo que pede competência sem ela → 422 `'Informe a competência'`; modelo inativo/só de processo → 422 `'Serviço indisponível'`.
- `approveRequest` modos: `{ mode: 'OS', osModelId? }` (usa o do pedido ou o escolhido) → `openOS` e `Request.taskId`; `{ mode: 'PROCESS', processTemplateId? }` → `openProcess` e `Request.boardId` (sem modelo: colunas padrão e uma tarefa, como hoje o NEW_BOARD); `{ mode: 'EXISTING_PROCESS', boardId, columnId, osModelId?, dependsOnTaskIds? }` → adiciona OS (ou tarefa livre sem modelo) ao processo. Notificação `REQUEST_APPROVED` como hoje (taskId da OS ou da primeira OS liberada do processo).

- [ ] **Step 1:** Testes: catálogo traz OS avulsa e processo solicitável, esconde "só de processo" e inativos; pedido com competência cria OS com competência na aprovação; pedido de processo cria board e aponta `boardId`; sem competência → 422; `EXISTING_PROCESS` com dependência cria OS não liberada; pedido livre continua funcionando. Web portal: seletor "Solicitar serviço" mostra os dois tipos e pede mês quando `requiresCompetence`.
- [ ] **Step 2:** FAIL. **Step 3:** Migration `requests_services` + implementação. **Step 4:** `pnpm --filter api exec vitest run src/modules/requests src/modules/portal` e `pnpm --filter web exec vitest run src/pages/portal src/pages/app` → PASS.
- [ ] **Step 5:** Commit `feat(os): cliente solicita serviço (OS ou processo) e aprovação abre o certo`.

### Task 9: Lista de OS, Tarefas e Processos com prazo

**Files:**
- Modify: `os.routes.ts`/`os.service.ts` — `GET /os`
- Modify: `apps/web/src/pages/app/OSList.tsx` (reescrita: lista de OS), `Tasks.tsx` (selo "OS" e nome do processo), `Processes.tsx` (só `PROCESS`, chip de prazo/atraso/pausa), `components/AppLayout.tsx` ("Ordens de Serviço" para todo staff), `types/index.ts`
- Create: `apps/web/src/components/shared/DeadlineChip.tsx` (+ test)

**Interfaces:**
- `GET /os?clientId=&osModelId=&assigneeId=&departmentId=&boardId=&situation=ON_TIME|DUE_SOON|LATE|PAUSED|WAITING_DEPENDENCY|DONE&search=` → `{ id, title, status, competence, client: {id,name,codigo}, osModel: {id,name}, process: {id,title} | null, assignee, department, dueDate, targetDate, deadline: ReturnType<deadlineInfo>, delayReasonPending, link }[]`, escopo `taskWhere(scope)`, ordenado por situação (LATE primeiro) e meta.
- `GET /tasks` e `GET /boards` passam a incluir `osModel {id,name} | null` / `deadline`.
- `DeadlineChip({ deadline })` → textos da Global Constraints com cores de token (danger/warning/info/success).

- [ ] **Step 1:** Testes API: filtros por situação (uma OS de cada estado), membro só vê o escopo dele, OS de processo traz `process`. Web: `DeadlineChip` para cada estado; `OSList` filtra por situação e abre o drawer; `Tasks` mostra selo "OS"; `Processes` não lista board `SERVICE_SYSTEM`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS (API `src/modules/os`, web `src/pages/app src/components/shared`).
- [ ] **Step 5:** Commit `feat(os): lista de Ordens de Serviço com situação do prazo; Processos só com processos`.

### Task 10: Drawer, board e fila do robô (prazo, dependência, motivo)

**Files:**
- Create: `apps/web/src/components/shared/task-documents/delayReason.ts` (`askDelayReason(reasons, opts): Promise<{ delayReasonId: string; delayNote?: string } | null>` via `askConfirm`/diálogo próprio em `app-dialogs`), `apps/web/src/components/ui/app-dialogs.tsx` (diálogo de seleção, se necessário)
- Modify: `TaskDrawer.tsx` (+ testes) — bloco de prazo (`DeadlineChip`, dias do escritório × aguardando cliente, data limite), aviso "aguardando <OS>" com botão "Liberar agora" (admin/gerente, pede justificativa), concluir: em 422 de motivo abre `askDelayReason` e reenvia; "Registrar motivo do atraso"
- Modify: `apps/api/src/modules/document-reader/document-reader.service.ts` (sugestão com modelo de OS/processo)
- Modify: `pages/app/Board.tsx` (arraste: em 409/422 mostra a mensagem e, para motivo, abre o diálogo e reenvia), `pages/app/document-reader/ReviewQueue.tsx` ("Concluir N prontas": coleta motivo por OS atrasada, com "aplicar a todas")

**Interfaces:**
- Consumes: Task 7 erros/rotas, Task 6 `deadline`, Task 9 `DeadlineChip`.

- [ ] **Step 0 (API):** `listarFilaDeRevisao` acrescenta à `suggestion` `osModelName: string | null` e `processTitle: string | null`; a fila mostra "OS · <modelo>" e o processo na linha da sugestão (teste em `robo-por-entrega.test.ts` e `ReviewQueue.test.tsx`).
- [ ] **Step 1:** Testes: drawer de OS atrasada → concluir abre diálogo de motivo, escolher "Retrabalho interno" reenvia PATCH com `delayReasonId`; "Outro" sem nota não envia; OS aguardando dependência mostra "aguardando A" e esconde troca de status; "Liberar agora" só para gerente; ReviewQueue com 2 prontas atrasadas pede motivo e "aplicar a todas" envia o mesmo nas duas.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** `pnpm --filter web exec vitest run` → PASS.
- [ ] **Step 5:** Commit `feat(web): prazo, dependência e motivo de atraso no drawer, no board e na fila do robô`.

### Task 11: Tempo por etapa e Dashboard

**Files:**
- Create: `apps/api/src/modules/os/os-metrics.service.ts`, `os-metrics.test.ts`
- Modify: `os.routes.ts` — `GET /boards/:id/stage-times`; `dashboard.service.ts`/`routes` — `GET /dashboard/os`
- Modify: web `pages/app/Board.tsx` (painel "Tempo por etapa"), `DashboardMetrics.tsx` (cartões)

**Interfaces:**
- `getStageTimes(boardId, orgId): { columns: { columnId; title; totalBusinessDays; avgBusinessDays }[]; os: { taskId; title; officeBusinessDays; clientBusinessDays; state }[] }` — por coluna a partir de `TaskHistory` `moved_to` (+ `created`), em dias úteis.
- `getOSDashboard(orgId, scope, period: {from,to})`: `{ delaysByReason: {reasonId; name; count}[]; byModel: { kind: 'OS'|'PROCESS'; id; name; count; avgOfficeBusinessDays; avgClientBusinessDays; lateCount }[]; pendingReasons: number }` — escopo `taskWhere`.

- [ ] **Step 1:** Testes: OS criada na col 0 seg 16/11, movida para col 1 qua 18/11, concluída seg 23/11 → col 0 = 2 dias úteis, col 1 = 2 (20/11 feriado); dashboard conta atrasos por motivo e pendentes; membro só vê o escopo.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS. Web: cartões "Atrasos por motivo", "Tempo médio: escritório × cliente", "Motivos pendentes".
- [ ] **Step 5:** Commit `feat(os): tempo por etapa no processo e indicadores de prazo no Dashboard`.

### Task 12: E2E, docs e QA

**Files:**
- Modify: `apps/api/prisma/e2e-seed.ts` (modelo de OS "Recálculo DAS E2E" com robô e prazo 3; modelo de processo "Abertura E2E" com A → B; uma OS atrasada; motivo padrão)
- Create: `apps/web/e2e/flows/os-processos.spec.ts`
- Modify: `docs/SPEC.md` (rotas novas), `docs/TASKS.md`, `docs/tech-debt.md`, `CLAUDE.md` (stack/convenções se mudar algo)

- [ ] **Step 1:** Specs: abrir "Nova OS" pelo escritório e vê-la na lista com "faltam 3 dias úteis"; concluir OS atrasada pede motivo e registra no histórico; abrir processo "Abertura E2E" → B "aguardando A" → concluir A libera B; cliente solicita serviço "Recálculo DAS E2E" com mês.
- [ ] **Step 2:** `pnpm --filter web exec playwright test` (parar o web local na 5173 antes) → PASS (todos os specs).
- [ ] **Step 3:** QA visual claro/escuro (screenshots reais): Modelos de OS, Modelo de Processo com OS/dependências, lista de OS, drawer com prazo/motivo, Dashboard.
- [ ] **Step 4:** Atualizar docs. **Step 5:** Commit `test(os): E2E de OS e processos; docs`.
