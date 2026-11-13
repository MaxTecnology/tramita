# Visibilidade por departamento e "Assumir" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colaborador pertence a departamentos; Gerente vê o departamento, Membro vê a carteira + o departamento (opção "ver colegas", ligada por padrão), com filtro "Minhas · Meu departamento · Todas", botão **Assumir** (uma e em lote) e solicitação aprovada indo pro aprovador.

**Architecture:** Uma regra central (`modules/staff-scope/`) carrega o escopo do usuário do banco uma vez por requisição e gera os `where` do Prisma por recurso e a checagem ver/mexer; ela substitui `memberBoardWhere`/`memberScope`/`role === 'ORG_MEMBER'` em todos os pontos. As listas aceitam `?scope=mine|department|all&departmentId=` e o servidor intersecta com o escopo permitido. No web, um hook lê o escopo de `/users/me` e um componente `ScopeFilter` lembra a escolha por tela.

**Tech Stack:** Fastify v5, Prisma 6 (Postgres), Zod, BullMQ, Vitest; React 19, TanStack Query, Tailwind v4 (tokens), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-visibilidade-por-departamento-design.md`

## Global Constraints

- Mensagens ao usuário em pt-BR; código, variáveis e comentários em inglês.
- Fora do escopo de leitura → **404** (nunca revelar que existe). Visível mas sem poder mexer → **403** `Assuma a tarefa para alterá-la`.
- `User.seesDepartmentWork Boolean @default(true)`; vale só para `ORG_MEMBER`.
- `ORG_MANAGER`/`ORG_MEMBER` precisam de ≥1 departamento: 400 `Selecione pelo menos um departamento`.
- Responsável por cliente precisa pertencer ao departamento, exceto `ORG_ADMIN`: 400 `<nome> não pertence ao departamento <departamento>`.
- Tirar de departamento quem é responsável por cliente ativo nele: 409 `Transfira as responsabilidades antes de tirar <nome> do departamento <departamento>`.
- Assumir em corrida: 409 `Essa tarefa já foi assumida por outra pessoa`.
- Membro passando tarefa para fora do departamento da tarefa: 400 `Só é possível passar a tarefa para alguém do departamento dela`.
- Histórico: action `assumed`, label web `assumiu a tarefa`. Evento novo `TASK_ASSUMED` (coluna `taskAssumed Boolean @default(true)` no config).
- Escopo lido do banco **uma vez por requisição** (não do token).
- Migrations escritas à mão via `prisma migrate diff`, aplicadas em dev (`pnpm --filter api migrate:deploy`) e teste (`DATABASE_URL=$DATABASE_URL_TEST`).
- Commits Conventional, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Telas novas/alteradas: tokens do tema (sem cor fixa), QA com screenshot claro + escuro.

## Review Focus

1. Usuário legado `ORG_MANAGER`/`ORG_MEMBER` **sem nenhum departamento** (backfill não achou responsabilidade): deve ver só a carteira, nunca o escritório inteiro nem quebrar com `IN ()` vazio → teste na Task 2.
2. Desligar "ver colegas" com o Membro logado: a requisição seguinte já responde 404 para o que é só do departamento → teste na Task 5.
3. Gerente em dois departamentos: "Meu departamento" sem `departmentId` mostra os dois; com `departmentId` de um departamento **dele** filtra; com `departmentId` de outro departamento → lista vazia, não 403 nem vazamento → teste na Task 8.
4. Assumir em lote quando parte das tarefas do colega é de departamento que eu não pertenço: assume só as dos meus, e o retorno diz quantas → teste na Task 9.
5. Documento do robô cuja tarefa sugerida foi excluída/mudou de departamento depois da leitura: some do escopo do Membro sem 500 → teste na Task 7.

---

## File Structure

API (`apps/api`):
- `prisma/schema.prisma` + `prisma/migrations/20261113100000_user_departments/` — modelo e backfill.
- `src/modules/staff-scope/staff-scope.ts` — **novo**: tipo do escopo, carga por requisição, `where` por recurso, ver/mexer.
- `src/middlewares/staffScope.ts` — **novo**: preHandler `staffScope(resolve, mode)` (substitui `memberScope.ts`, que é removido).
- `src/modules/boards/board-visibility.ts` — mantém `memberBoardWhere` (carteira), usado por staff-scope.
- `src/modules/users/*` — departamentos e opção no cadastro, `/users/me` com escopo.
- `src/modules/clients/clients.service.ts`, `src/modules/users/responsibility-transfer.service.ts` — responsável pertence ao departamento.
- `src/modules/tasks/task-assume.service.ts` — **novo**: assumir uma/em lote.
- Rotas/serviços que trocam a regra: boards, columns, tasks, comments, attachments, task-documents, protocols (+ office actions, unpaid guides), stream, dashboard, requests, request-comments, document-reader.
- `src/workers/sla-digest.cron.ts`, `src/workers/notification.worker.ts`, `src/lib/default-templates.ts`, `src/modules/notifications/*` — evento `TASK_ASSUMED` e destinatários do resumo.

Web (`apps/web`):
- `src/hooks/useMyScope.ts` — **novo**.
- `src/components/shared/ScopeFilter.tsx` — **novo**.
- `src/pages/app/Users.tsx` — departamentos + opção.
- `src/pages/app/Tasks.tsx`, `Requests.tsx`, `document-reader/ReviewQueue.tsx`, `UnpaidGuides.tsx` — filtro.
- `src/components/shared/TaskDrawer.tsx` — Assumir, modo só-leitura, label do histórico.
- `src/pages/app/settings/Notifications.tsx`, `Templates.tsx` — evento novo.

---

### Task 1: Modelo — `UserDepartment`, `seesDepartmentWork`, `TASK_ASSUMED`

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (User, Department, NotificationEvent, NotificationConfig)
- Create: `apps/api/prisma/migrations/20261113100000_user_departments/migration.sql`
- Modify: `apps/api/src/test/helpers.ts`
- Test: `apps/api/src/modules/users/user-departments.model.test.ts`

**Interfaces:**
- Produces: `model UserDepartment { id, userId, departmentId, createdAt; @@unique([userId, departmentId]); @@index([departmentId]); @@map("user_departments") }` com `onDelete: Cascade` nos dois lados; `User.departments UserDepartment[]`, `User.seesDepartmentWork Boolean @default(true)`; `Department.members UserDepartment[]`; `NotificationEvent.TASK_ASSUMED`; `NotificationConfig.taskAssumed Boolean @default(true)`.
- Produces (helpers): `createTestUser(orgId, { ..., departmentIds?: string[], seesDepartmentWork?: boolean })` cria as memberships; `addUserToDepartment(userId, departmentId)`. `serveClientDepartment(clientId, departmentId, userId)` e `ensureServed(orgId, clientId, departmentId)` passam a garantir a membership do responsável (upsert) quando ele não é ORG_ADMIN.

- [ ] **Step 1: Write the failing test** — `user-departments.model.test.ts`: `createTestUser(org, { role: 'ORG_MEMBER', departmentIds: [fiscal.id] })` → `prisma.userDepartment.count({ where: { userId } })` é 1 e `user.seesDepartmentWork` é `true`; criar a mesma membership de novo lança P2002; excluir o departamento apaga a membership.
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/modules/users/user-departments.model.test.ts` — Expected: FAIL (modelo inexistente).
- [ ] **Step 3: Schema + migration.** `prisma migrate diff --from-url "$DATABASE_URL_TEST" --to-schema-datamodel prisma/schema.prisma --script`, e acrescentar ao final o backfill:

```sql
INSERT INTO "user_departments" ("id", "userId", "departmentId", "createdAt")
SELECT DISTINCT ON (ca."userId", ca."departmentId") gen_random_uuid()::text, ca."userId", ca."departmentId", now()
FROM "client_assignments" ca
ON CONFLICT ("userId", "departmentId") DO NOTHING;
```
  Aplicar em dev e teste; `prisma generate`. Atualizar helpers.
- [ ] **Step 4: Run** o teste — Expected: PASS. Rodar a suíte da API inteira — Expected: verde (helpers compatíveis).
- [ ] **Step 5: Commit** `feat(users): colaborador pertence a departamentos (modelo, backfill, evento TASK_ASSUMED)`

---

### Task 2: Escopo do colaborador (núcleo)

**Files:**
- Create: `apps/api/src/modules/staff-scope/staff-scope.ts`
- Test: `apps/api/src/modules/staff-scope/staff-scope.test.ts`

**Interfaces:**
- Produces:
```ts
type StaffScope =
  | { kind: 'ALL' }
  | { kind: 'LIMITED'; role: 'ORG_MANAGER' | 'ORG_MEMBER'; userId: string; organizationId: string;
      departmentIds: string[]; seesDepartment: boolean }
loadStaffScope(user: { sub: string; role: string; organizationId: string | null }): Promise<StaffScope>
getStaffScope(request: FastifyRequest): Promise<StaffScope>        // memoized per request (WeakMap)
boardWhere(scope): Prisma.BoardWhereInput                          // {} for ALL
taskWhere(scope): Prisma.TaskWhereInput                            // visible tasks
requestWhere(scope): Prisma.RequestWhereInput
receivedDocumentWhere(scope): Prisma.ReceivedDocumentWhereInput
protocolWhere(scope): Prisma.ProtocolWhereInput                    // via task
mineTaskWhere(userId): Prisma.TaskWhereInput                       // { assigneeId: userId }
mineRequestWhere(userId): Prisma.RequestWhereInput                 // (client, department) where I'm responsible
canSeeUnidentifiedDocuments(scope): boolean                        // ALL or MANAGER
canActOnTask(scope, task: { id: string }): Promise<boolean>        // write gate
userBelongsToDepartment(userId: string, departmentId: string): Promise<boolean>
```
- Regras (da spec): `seesDepartment` = `true` para MANAGER, `user.seesDepartmentWork` para MEMBER. `boardWhere` = OR[`memberBoardWhere(userId)`, seesDepartment && deps>0 ? `{ client: { clientAssignments: { some: { departmentId: { in } } } } }`]. `taskWhere` = OR[`{ assigneeId: userId }`, `{ column: { board: { type: 'OS', ...boardWhere } } }`, seesDepartment && deps>0 ? `{ departmentId: { in } }`]. `requestWhere` = OR[`mineRequestWhere`, seesDepartment && deps>0 ? `{ departmentId: { in } }`]. `receivedDocumentWhere` = `{ task: taskWhere }` OR (canSeeUnidentified ? `{ taskId: null }`). `protocolWhere` = `{ task: taskWhere }`. `canActOnTask`: ALL → true; MANAGER → task visible; MEMBER → task matches OR[`{ assigneeId: userId }`, `{ column: { board: memberBoardWhere(userId) } }`]. Departamento vazio nunca gera `in: []` (Review Focus 1).

- [ ] **Step 1: Write the failing tests** (Postgres real, um `describe` por função): org com Fiscal e Folha, cliente A (Fiscal resp. `carlos`), cliente B (Folha resp. `dani`); usuários `admin`, `gerenteFiscal` (MANAGER, [Fiscal]), `bruna` (MEMBER, [Fiscal]), `brunaSemColegas` (MEMBER, [Fiscal], seesDepartmentWork false), `legado` (MEMBER, sem departamento). Asserções:
  - `loadStaffScope(admin)` → `{ kind: 'ALL' }`; `loadStaffScope(bruna).departmentIds` = [Fiscal]; `brunaSemColegas.seesDepartment` false.
  - `prisma.board.findMany({ where: boardWhere(scope) })`: gerenteFiscal e bruna veem o processo do cliente A, não o de B; brunaSemColegas e legado não veem nenhum (não são responsáveis).
  - `taskWhere`: tarefa recorrente Fiscal de A atribuída a carlos é vista por bruna, não por brunaSemColegas; tarefa Folha recorrente de A (atribuída a dani) não é vista por bruna; tarefa atribuída a legado é vista por legado.
  - `canActOnTask(bruna, tarefaDeCarlos)` false; depois de `assigneeId = bruna` → true; `canActOnTask(gerenteFiscal, tarefaDeCarlos)` true.
  - `requestWhere`: solicitação Fiscal de A vista por bruna e gerente; Folha de B não.
  - `canSeeUnidentifiedDocuments`: admin e gerente true, bruna false.
  - `getStaffScope` chamado 2× na mesma request faz 1 consulta (spy em `prisma.user.findUnique`).
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/modules/staff-scope` — Expected: FAIL (módulo inexistente).
- [ ] **Step 3: Implement** `staff-scope.ts` com as assinaturas acima (carga: `prisma.user.findUnique({ select: { role, seesDepartmentWork, departments: { select: { departmentId } } } })`).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(scope): escopo do colaborador por departamento (núcleo)`

---

### Task 3: Cadastro de usuários com departamentos e "ver colegas"

**Files:**
- Modify: `apps/api/src/modules/users/users.schema.ts`, `users.service.ts`, `users.routes.ts`
- Test: `apps/api/src/modules/users/users-departments.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `createUserSchema`/`updateUserSchema` ganham `departmentIds: z.array(z.string().cuid()).min(1, 'Selecione pelo menos um departamento')` (opcional no update) e `seesDepartmentWork: z.boolean().optional()`. `GET /users` e `GET /users/me` devolvem `departments: { id, name }[]` e `seesDepartmentWork`. `GET /users/me` também `role`.

- [ ] **Step 1: Failing tests** (via `app.inject`, admin):
  - POST sem `departmentIds` → 400 `Selecione pelo menos um departamento`; com `[fiscal]` → 201 e `departments` = [Fiscal], `seesDepartmentWork` true.
  - `departmentIds` com departamento de outra org → 400 `Departamento inválido`.
  - PATCH `{ seesDepartmentWork: false }` → 200 e persistido.
  - PATCH trocando `[fiscal]` → `[folha]` quando o usuário é responsável por cliente ativo no Fiscal → 409 `Transfira as responsabilidades antes de tirar Bruna do departamento Fiscal`; sem responsabilidade → 200.
  - `GET /users/me` como membro → `{ role: 'ORG_MEMBER', departments: [{ id, name: 'Fiscal' }], seesDepartmentWork: true }`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Update de departamentos dentro de transação com `SELECT ... FOR UPDATE` no usuário (mesmo padrão de `deleteUser`), conferindo `clientAssignment` com `client.isActive` nos departamentos removidos; substitui memberships (deleteMany + createMany).
- [ ] **Step 4: Run** — Expected: PASS; suíte de users verde.
- [ ] **Step 5: Commit** `feat(users): departamentos e opção "ver colegas" no cadastro`

---

### Task 4: Responsável precisa pertencer ao departamento

**Files:**
- Modify: `apps/api/src/modules/clients/clients.service.ts` (`assertResponsiblesValid`), `apps/api/src/modules/users/responsibility-transfer.service.ts`, `apps/api/src/modules/users/users.service.ts` (`listUserOptions` aceita `departmentId?`)
- Test: `apps/api/src/modules/clients/responsible-department.test.ts`

**Interfaces:**
- Produces: `GET /users/options?departmentId=` lista só quem pertence ao departamento (+ admins).

- [ ] **Step 1: Failing tests:** cadastro de cliente com responsável do Fiscal que só pertence à Folha → 400 `Bruna não pertence ao departamento Fiscal`; responsável ORG_ADMIN sem membership → 201; transferência para quem não pertence ao departamento de alguma responsabilidade movida → 400 com a mesma mensagem e nada transferido; `/users/options?departmentId=fiscal` não lista quem é só da Folha.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** (checagem dentro das transações existentes, depois de `lockUsersForShare`).
- [ ] **Step 4: Run** — PASS; suítes de clients e users verdes (ajustar setups antigos que usam responsável sem membership: `serveClientDepartment` já garante, Task 1).
- [ ] **Step 5: Commit** `feat(clients): responsável precisa pertencer ao departamento`

---

### Task 5: Trocar a regra do Membro pela do colaborador nas rotas (ver vs mexer)

**Files:**
- Create: `apps/api/src/middlewares/staffScope.ts`; Delete: `apps/api/src/middlewares/memberScope.ts`
- Modify: rotas de boards, columns, tasks, comments, attachments, task-documents, protocols, stream; serviços `boards.service.ts` (list/get), `dashboard.service.ts`/`dashboard.routes.ts`, `protocols.service.ts`, `protocol-office-actions.ts`, `unpaid-guides.service.ts`
- Test: rename `apps/api/src/modules/boards/member-scope.routes.test.ts` → `staff-scope.routes.test.ts` (estender)

**Interfaces:**
- Consumes: Task 2.
- Produces: `staffScope(resolve: (r) => ScopeTargets, mode: 'read' | 'write')` preHandler; `assertStaffSees(request, targets, mode)` (usado no stream e serviços). `ScopeTargets` mantém `{ boardIds, columnIds, taskIds, protocolIds }`; `bodyIds`/`param` mudam de arquivo. Modo `write` em tarefa usa `canActOnTask` → 403 `Assuma a tarefa para alterá-la`; em board/coluna (Membro) exige carteira (`memberBoardWhere`) → 403 com a mesma mensagem.
- Mapeamento de modo: **read** = GETs, busca, SSE, `POST /tasks/:taskId/comments`; **write** = todo o resto (criar/mover/reordenar/editar tarefa, colunas, anexos POST/DELETE, task-documents POST/PATCH, protocolos POST).

- [ ] **Step 1: Failing tests** — estender a matriz existente (20 rotas) com perfis: `gerenteFiscal` (vê processo do cliente atendido pelo Fiscal → 200/201 em tudo), `bruna` com ver colegas (GETs e comentário 200/201; mutações → 403 `Assuma a tarefa para alterá-la`), `brunaSemColegas` (tudo 404), `foraFiscal` (MEMBER só Folha → 404). Mais: desligar `seesDepartmentWork` de bruna via prisma e a requisição seguinte dá 404 (Review Focus 2); SSE do processo: bruna 200-aberto (usar ticket e encerrar), foraFiscal 404; dashboard metrics de bruna conta o processo do Fiscal; guias não pagas do gerente só do Fiscal.
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/modules/boards/staff-scope.routes.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Trocar todos os `role === 'ORG_MEMBER'` de escopo (lista em `grep -rn "memberBoardWhere\|memberScope\|assertMemberSeesTargets" src`) por `getStaffScope` + builders; `listBoards`/`getBoardById` recebem `scope` no lugar de `visibleToMemberId`; dashboard idem (mantém `forcedUserId` do Membro em produtividade). `document-reader` fica para a Task 7.
- [ ] **Step 4: Run** — PASS; suíte inteira da API verde (setups antigos de Membro sem departamento continuam válidos pela carteira).
- [ ] **Step 5: Commit** `feat(scope): rotas usam o escopo do colaborador (ver x mexer)`

---

### Task 6: Solicitações no escopo e aprovação para o aprovador

**Files:**
- Modify: `apps/api/src/modules/requests/requests.service.ts` (`listRequestsForOrg`, `getRequestById`, `countPendingRequests`, `approveRequest`), `requests.routes.ts`, `requests.schema.ts`, `apps/api/src/modules/request-comments/*`
- Test: `apps/api/src/modules/requests/requests-scope.test.ts`

**Interfaces:**
- Consumes: Task 2 (`requestWhere`, `mineRequestWhere`, `userBelongsToDepartment`).
- Produces: `GET /requests?scope=mine|department|all&departmentId=` (default por papel na Task 8 — aqui só o filtro de permissão + `mine`); `pending-count` no escopo.

- [ ] **Step 1: Failing tests:** bruna lista solicitações Fiscal (de A) e não Folha; `scope=mine` traz só as de (cliente, departamento) em que ela é responsável; `GET /requests/:id`, comentários (GET/POST) e approve/reject/needs-info/cancel de solicitação Folha por bruna → 404; `pending-count` de bruna conta só o Fiscal; aprovação por bruna (pertence ao Fiscal) de solicitação de cliente cujo responsável é carlos → tarefa criada com `assigneeId = bruna`; aprovação por admin sem membership → `assigneeId = carlos`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** (`approveRequest` passa `assigneeId` ao `createTask` quando `userBelongsToDepartment(reviewerId, request.departmentId)`).
- [ ] **Step 4: Run** — PASS; suítes de requests e request-comments verdes.
- [ ] **Step 5: Commit** `feat(requests): solicitações no escopo do colaborador e tarefa para quem aprova`

---

### Task 7: Fila do robô no escopo

**Files:**
- Modify: `apps/api/src/modules/document-reader/document-reader.service.ts` (`listarFilaDeRevisao`, `listarRejeitados`, `obterUrlVisualizacao`, `buscarDocumentoRevisavel`, `anexarDocumento`, `rejeitarDocumento`), `document-reader.routes.ts`
- Test: `apps/api/src/modules/document-reader/document-reader-scope.test.ts`

**Interfaces:**
- Consumes: Task 2 (`receivedDocumentWhere`, `canSeeUnidentifiedDocuments`, `canActOnTask`).
- Produces: as funções acima recebem `scope: StaffScope` (no lugar de só `organizationId`+actor); `GET /document-reader/fila?scope=mine` filtra por tarefa sugerida minha; `POST /document-reader/upload` → `requireRole('ORG_ADMIN', 'ORG_MANAGER')`.

- [ ] **Step 1: Failing tests:** fila de bruna mostra documento sugerido para tarefa Fiscal e não Folha nem não-identificado; gerente vê o não-identificado; `/:id/visualizar`, `confirmar`, `rejeitar` de documento fora do escopo → 404; confirmar documento sugerido para tarefa de carlos por bruna → 403 `Assuma a tarefa para alterá-la`; upload por Membro → 403; documento cuja tarefa sugerida foi excluída some da fila de bruna sem 500 (Review Focus 5).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** (substitui o `assertMemberSeesTargets` de `anexarDocumento` por `canActOnTask`).
- [ ] **Step 4: Run** — PASS; suíte do document-reader verde.
- [ ] **Step 5: Commit** `feat(document-reader): fila do robô no escopo do colaborador`

---

### Task 8: Filtro `scope` nas listas (tarefas e guias)

**Files:**
- Modify: `apps/api/src/modules/tasks/tasks.schema.ts` (`listTasksQuerySchema`), `tasks.service.ts` (`listTasks`), `apps/api/src/modules/protocols/unpaid-guides.service.ts` + schema/rota
- Test: `apps/api/src/modules/tasks/tasks-scope-filter.test.ts`

**Interfaces:**
- Produces: query `scope: z.enum(['mine', 'department', 'all']).optional()` + `departmentId` (já existe em tarefas; novo em guias). Semântica: `mine` = `mineTaskWhere`; `department` = `taskWhere(scope)` (+ `departmentId` se vier: precisa estar em `scope.departmentIds`, senão lista vazia); `all` = só ADMIN (outros → tratado como `department`). Sem `scope` = `department` para LIMITED, `all` para ADMIN. Substitui o `where.assigneeId = actor.id` atual do Membro.

- [ ] **Step 1: Failing tests:** bruna `scope=mine` → só atribuídas a ela; `scope=department` → também as de carlos no Fiscal; `brunaSemColegas` `scope=department` → igual a `mine`; gerente de Fiscal+Folha `scope=department` vê os dois, `departmentId=fiscal` só Fiscal, `departmentId` de departamento que não é dele → `[]` (Review Focus 3); admin `scope=all` vê tudo; guias não pagas com os mesmos casos.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; suítes de tasks e protocols verdes.
- [ ] **Step 5: Commit** `feat(tasks): filtro Minhas / Meu departamento / Todas nas listas`

---

### Task 9: Assumir (uma e em lote), passar tarefa e aviso `TASK_ASSUMED`

**Files:**
- Create: `apps/api/src/modules/tasks/task-assume.service.ts`, `task-assume.test.ts`
- Modify: `apps/api/src/modules/tasks/tasks.routes.ts`, `tasks.schema.ts`, `tasks.service.ts` (`updateTask`: troca de responsável pelo Membro), `apps/api/src/workers/notification.worker.ts`, `apps/api/src/lib/default-templates.ts`, `apps/api/src/modules/notifications/notifications.schema.ts` + `.service.ts`

**Interfaces:**
- Consumes: Task 2, Task 5 (`canActOnTask`).
- Produces:
  - `POST /tasks/:id/assume` body `{ expectedAssigneeId: string | null }` → 200 tarefa. Regras: tarefa visível; aberta (status ∉ DONE, DISREGARDED, senão 409 `Tarefa concluída não pode ser assumida`); `departmentId` ∈ meus departamentos (senão 403 `Você não pertence ao departamento desta tarefa`); Membro precisa `seesDepartment` (senão 404); já é minha → 409 `A tarefa já é sua`. Escrita: `updateMany({ id, assigneeId: expectedAssigneeId })`, 0 → 409 `Essa tarefa já foi assumida por outra pessoa`.
  - `POST /tasks/assume-bulk` body `{ fromUserId: cuid, departmentId?: cuid }` → `{ count: number }`: tarefas abertas atribuídas a `fromUserId` em `departmentId ∈ meus departamentos` (∩ `departmentId` se vier).
  - Ambos: `TaskHistory { action: 'assumed', fromValue: prevAssigneeId, toValue: myId }`, `publishBoardEvent('task:updated')`, `enqueueNotification({ event: 'TASK_ASSUMED', recipientType: 'USER', userId: prevAssigneeId, metadata: { taskTitle, clientName, assumedByName } })` — **um** aviso por chamada em lote com `taskTitle: '<N> tarefas'`.
  - `updateTask` com `assigneeId` por Membro: precisa `canActOnTask`, e o novo responsável deve pertencer ao `departmentId` da tarefa (senão 400 `Só é possível passar a tarefa para alguém do departamento dela`).
  - Template padrão `taskAssumed` (para a equipe): `{{assumedByName}} assumiu "{{taskTitle}}" ({{clientName}}).`; variável nova `assumedByName` no `TemplateVars`.

- [ ] **Step 1: Failing tests:** assumir tarefa de carlos por bruna → 200, `assigneeId` bruna, histórico `assumed`, `enqueueNotification` com `userId: carlos`; duas chamadas simultâneas com o mesmo `expectedAssigneeId` → uma 200 e uma 409; tarefa concluída → 409; tarefa da Folha → 403; brunaSemColegas → 404; lote: carlos com 3 abertas Fiscal + 1 Folha + 1 concluída → `{ count: 3 }` e 1 aviso (Review Focus 4); passar tarefa minha para carlos → 200; para dani (só Folha) → 400; aviso desligado em `taskAssumed: false` não envia (teste no worker, mesmo padrão dos outros eventos).
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/modules/tasks/task-assume.test.ts` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; suítes de tasks e notifications verdes.
- [ ] **Step 5: Commit** `feat(tasks): assumir tarefa (uma e em lote) com aviso ao responsável anterior`

---

### Task 10: Criar processo no escopo e resumo diário por departamento

**Files:**
- Modify: `apps/api/src/modules/boards/boards.service.ts` (`createBoard`), `apps/api/src/workers/sla-digest.cron.ts`
- Test: `apps/api/src/modules/boards/board-create-scope.test.ts`, `apps/api/src/workers/sla-digest.cron.test.ts` (estender)

- [ ] **Step 1: Failing tests:** bruna cria processo para cliente A (Fiscal) → 201; para cliente B (só Folha) → 404 `Cliente não encontrado`; `brunaSemColegas` para cliente A (não é responsável) → 404. Resumo diário: tarefa Fiscal com responsável inativo vai para admin e `gerenteFiscal`, não para `gerenteFolha`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** (cliente visível = `boardWhere`-equivalente sobre `client`: atendido por departamento meu se `seesDepartment`, ou `clientAssignments some userId`; resumo: destinatários de fallback = admins + gerentes com membership no `task.departmentId` / `protocol.task.departmentId`).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(scope): criar processo e resumo diário respeitam o departamento`

---

### Task 11: Web — escopo do usuário, filtro e cadastro de usuários

**Files:**
- Create: `apps/web/src/hooks/useMyScope.ts`, `apps/web/src/components/shared/ScopeFilter.tsx`, `ScopeFilter.test.tsx`
- Modify: `apps/web/src/pages/app/Users.tsx`, `Tasks.tsx`, `Requests.tsx`, `document-reader/ReviewQueue.tsx`, `UnpaidGuides.tsx`

**Interfaces:**
- Consumes: `/users/me` (Task 3), `?scope=&departmentId=` (Tasks 6–8).
- Produces: `useMyScope(): { role, departments: {id,name}[], seesDepartmentWork, canFilterDepartment: boolean, isAdmin: boolean } | undefined`; `<ScopeFilter screen="tasks" | "requests" | "documents" | "guides" value onChange />` com valor `{ scope: 'mine' | 'department' | 'all'; departmentId?: string }`, lembrado em `localStorage` (`scope-filter:<screen>`, leitura/escrita em try/catch).
- Default: Membro `mine`, Gerente `department`, Admin `all`. Opções visíveis: "Minhas" sempre; "Meu departamento" se `canFilterDepartment` (gerente, ou Membro com "ver colegas"); "Todas" só admin; seletor de departamento quando o usuário tem 2+ departamentos e `department` está escolhido.

- [ ] **Step 1: Failing tests** (`ScopeFilter.test.tsx`): membro abre em "Minhas"; membro sem "ver colegas" não vê "Meu departamento"; gerente abre em "Meu departamento" e não vê "Todas"; escolha persiste após remontar; gerente com 2 departamentos vê o seletor.
- [ ] **Step 2: Run** `pnpm --filter web test -- --run src/components/shared/ScopeFilter.test.tsx` — FAIL.
- [ ] **Step 3: Implement** componente + hook; plugar nas quatro telas (o filtro vira params da query); Users: multi-seleção de departamentos (obrigatória para Gerente/Colaborador) + checkbox "Pode ver o trabalho dos colegas do departamento" (só Colaborador, ligado por padrão), selo vermelho "Sem departamento" na lista.
- [ ] **Step 4: Run** — PASS; `pnpm --filter web test -- --run` e `tsc --noEmit` verdes.
- [ ] **Step 5: Commit** `feat(web): filtro Minhas / Meu departamento e departamentos no cadastro de usuários`

---

### Task 12: Web — Assumir, só-leitura na tarefa de colega e aviso novo

**Files:**
- Modify: `apps/web/src/components/shared/TaskDrawer.tsx`, `apps/web/src/pages/app/Tasks.tsx` (lote), `apps/web/src/pages/app/settings/Notifications.tsx`, `Templates.tsx`
- Modify (API): `GET /boards/:id` e `GET /tasks` passam a devolver `viewerCanEdit: boolean` por tarefa (`canActOnTask`, em lote — uma consulta para a lista)
- Test: `apps/web/src/components/shared/TaskDrawer.assume.test.tsx`, teste de API do `viewerCanEdit` em `tasks-scope-filter.test.ts`

**Interfaces:**
- Consumes: Task 9 endpoints, Task 11 hook.
- Produces: botão **Assumir** no cabeçalho do drawer quando `!viewerCanEdit` ou responsável ≠ eu, tarefa aberta, departamento da tarefa ∈ meus e (`role !== 'ORG_MEMBER' || seesDepartmentWork`); com `viewerCanEdit === false` os controles de edição ficam desabilitados com a dica `Assuma a tarefa para alterá-la` (comentários continuam); 409 mostra o toast com a mensagem da API e recarrega. Lote: em Tarefas com `scope=department` e filtro Colaborador = outra pessoa, botão `Assumir todas as abertas de <nome>` com `confirm` mostrando a quantidade da lista. `ACTION_LABELS.assumed = 'assumiu a tarefa'`. Settings: evento "Tarefa assumida por um colega" (`taskAssumed`) na lista de eventos da equipe e no editor de templates.

- [ ] **Step 1: Failing tests:** drawer com `viewerCanEdit: false` mostra "Assumir" e o seletor de coluna desabilitado; clicar chama `POST /tasks/:id/assume` com `expectedAssigneeId` do responsável atual; resposta 409 mostra `Essa tarefa já foi assumida por outra pessoa`. API: `viewerCanEdit` false para bruna na tarefa de carlos, true depois de assumir.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS; suítes web e API verdes, `tsc` limpo.
- [ ] **Step 5: Commit** `feat(web): assumir tarefa, modo só-leitura e aviso de tarefa assumida`

---

### Task 13: E2E, seed, documentação e QA visual

**Files:**
- Modify: `apps/api/prisma/e2e-seed.ts`, `apps/web/e2e/flows/` (novo `assume-task.spec.ts`), `docs/SPEC.md`, `docs/TASKS.md`, `docs/tech-debt.md`

- [ ] **Step 1: Seed:** memberships de todos os usuários E2E no "Geral"; `ausente-e2e@g2a.com.br` (MEMBER, Geral) com tarefa aberta "Conferência E2E" no processo E2E; `cobertura-e2e@g2a.com.br` (MEMBER, Geral, senha `Equipe@2025`). Reexecutável.
- [ ] **Step 2: Spec E2E** `assume-task.spec.ts`: cobertura entra em Tarefas (abre em "Minhas" sem "Conferência E2E"), troca para "Meu departamento", abre a tarefa (controles desabilitados), clica Assumir, a tarefa aparece em "Minhas". Rodar a suíte E2E inteira duas vezes — Expected: tudo verde.
- [ ] **Step 3: Docs:** SPEC.md (regras transversais: escopo por papel, `?scope=`, `POST /tasks/:id/assume`, `/assume-bulk`, `/users` departamentos, 403 vs 404); TASKS.md marca a entrega; tech-debt.md fecha as duas pendências da auditoria (fila do robô e solicitações).
- [ ] **Step 4: QA visual** com screenshots reais, claro e escuro: Usuários (formulário com departamentos), Tarefas com o filtro e o lote, drawer em só-leitura com Assumir, Solicitações, fila do robô, Guias não pagas.
- [ ] **Step 5: Commit** `test(e2e): assumir tarefa do colega; docs da visibilidade por departamento`
