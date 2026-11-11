# Cobertura de departamentos por cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantir que todo departamento que atende um cliente tenha responsável do escritório e pelo menos um usuário do cliente, que tarefa/solicitação só exista em departamento atendido, e que notificações, cadastro, transferência de responsabilidades e falhas de recorrência respeitem isso.

**Architecture:** "Departamento atendido" = `ClientAssignment` existente (sem tabela nova). As regras vivem num módulo de domínio `client-coverage.ts` chamado por todos os pontos de entrada (clientes, usuários de cliente, tarefas, recorrentes, solicitações, usuários). O cadastro de cliente vira contrato de substituição completa (empresa + departamentos + usuários) gravado numa transação. Frontend: cadastro de cliente em abas com lógica de completude extraída em função pura.

**Tech Stack:** Node 22 + TypeScript strict, Fastify v5, Prisma v6 (Postgres), Zod, Vitest (banco real), React 19 + Vite + TanStack Query + Tailwind v4, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-cobertura-departamentos-cliente-design.md` (ler inteira antes da Task 1 — as mensagens de erro e as regras são citadas de lá).

## Global Constraints

- Código, nomes e comentários em inglês; mensagens ao usuário em pt-BR, **copiadas literalmente da seção "Erros" da spec**.
- TypeScript `strict`, sem `any` novo, sem `as unknown`.
- Toda entrada validada com Zod; erros de negócio via `AppError(statusCode, message)`.
- Logs via Pino (`@/lib/logger`), nunca `console.log` novo.
- Toda query filtra por `organizationId`; recurso de outra organização → 404 (nunca revelar existência).
- TDD: teste escrito e visto falhar antes da implementação; testes contra o Postgres real (`tramita_test`); mocks só de rede externa e sempre via `vi.spyOn`, nunca `vi.mock`.
- Migrations: **não** rodar `prisma migrate dev` (trava sem TTY). Gerar SQL com `pnpm --filter api exec prisma migrate diff --from-url "$DATABASE_URL_TEST" --to-schema-datamodel prisma/schema.prisma --script`, escrever a pasta `prisma/migrations/<timestamp>_<nome>/migration.sql` à mão (incluindo o SQL que o Prisma não expressa) e aplicar com `migrate deploy` no banco de teste e no de dev. Pré-produção: pode zerar o banco local se precisar (`pg_dump` antes).
- Commits Conventional Commits em pt-BR, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Comando de teste da API: `pnpm --filter api test -- <arquivo>`; suíte inteira: `pnpm --filter api test`. Web: `pnpm --filter web test`. Typecheck: `pnpm --filter api exec tsc --noEmit` e `pnpm --filter web exec tsc --noEmit`.

## Review Focus

1. Mesmo CNPJ com e sem máscara (`12.345.678/0001-95` vs `12345678000195`) em dois clientes ativos → 409, não dois clientes. (Task 1)
2. Usuário do cliente com acesso a dois clientes, um deles desativado: desativá-lo só é bloqueado pelo cliente **ativo** em que ele é o último do departamento. (Task 3)
3. Desmarcar departamento que só tem tarefas `DONE`/`DISREGARDED` → permitido, tarefas permanecem com o departamento antigo. (Task 2)
4. Transferência com filtro de departamento não move processos (`Board`) e só move tarefas daquele departamento. (Task 8)
5. Tarefa `visibleToClient = false` não notifica ninguém mesmo com usuários com telefone; usuário sem telefone recebe só e-mail. (Task 7)

---

## File Structure

**API — novos**
- `apps/api/src/lib/documento.ts` — `soDigitos`, `cnpjValido`, `cpfValido` (movidos do motor de leitura).
- `apps/api/src/lib/phone.ts` — normalização de telefone BR para o formato do MaximizeBot.
- `apps/api/src/modules/clients/client-coverage.ts` — regras de cobertura (I1–I5) reutilizadas por todos os módulos.
- `apps/api/src/modules/users/responsibility-transfer.service.ts` (+ `.schema.ts`) — carteira e transferência.
- `apps/api/src/modules/notifications/client-recipients.ts` — destinatários de notificação ao cliente por departamento.
- Migrations: `<ts>_client_required_fields`, `<ts>_request_department_required`.

**API — modificados**
- `prisma/schema.prisma`, `prisma/e2e-seed.ts`, `src/test/helpers.ts`
- `src/modules/document-reader/engine/validadores.ts` (re-exporta de `@/lib/documento`)
- `src/modules/clients/clients.{schema,service,routes}.ts`
- `src/modules/client-users/client-users.{schema,service}.ts`
- `src/modules/tasks/tasks.service.ts`
- `src/modules/recurring-templates/recurring-templates.service.ts`
- `src/modules/requests/requests.{schema,service}.ts`, `src/modules/portal/portal.routes.ts`
- `src/modules/comments/comments.service.ts`, `src/modules/request-comments/request-comments.service.ts`
- `src/workers/notification.worker.ts`, `src/workers/sla-digest.cron.ts`
- `src/modules/users/users.{service,routes}.ts`

**Web — novos**
- `apps/web/src/pages/app/clients/ClientForm.tsx` — formulário em abas (Empresa, Departamentos, Acesso ao portal).
- `apps/web/src/pages/app/clients/clientFormStatus.ts` (+ `.test.ts`) — completude das abas e linhas do painel de cobertura.
- `apps/web/src/pages/app/UserTransfer.tsx` — tela "Transferir responsabilidades".
- `apps/web/src/components/FailedGenerationsAlert.tsx` — alerta do Dashboard.
- `apps/web/src/hooks/useServedDepartments.ts` — departamentos atendidos de um cliente.

**Web — modificados**
- `src/pages/app/Clients.tsx` (passa a usar `ClientForm`, aceita `?edit=<id>`), `src/pages/app/Users.tsx`, `src/router.tsx`
- `src/pages/app/Board.tsx`, `src/components/shared/TaskDrawer.tsx`, `src/pages/app/settings/ClientUserForm.tsx`, `src/pages/app/settings/RecurringTemplateManage.tsx`
- `src/pages/portal/Requests.tsx`, `src/pages/app/DashboardMetrics.tsx`, `src/types/index.ts`

---

### Task 1: Dados obrigatórios do cliente (validação, normalização, garantias no banco)

**Files:**
- Create: `apps/api/src/lib/documento.ts`, `apps/api/src/lib/documento.test.ts`, `apps/api/prisma/migrations/<ts>_client_required_fields/migration.sql`
- Modify: `apps/api/src/modules/document-reader/engine/validadores.ts`, `apps/api/prisma/schema.prisma`, `apps/api/src/modules/clients/clients.schema.ts`, `apps/api/src/test/helpers.ts`
- Test: `apps/api/src/modules/clients/clients.schema.test.ts` (novo), `apps/api/src/modules/clients/clients.service.test.ts`

**Interfaces:**
- Produces: `soDigitos(s: string): string`, `cnpjValido(s: string): boolean`, `cpfValido(s: string): boolean` em `@/lib/documento`.
- Produces: `companyFieldsSchema` (Zod) em `clients.schema.ts` — campos da aba Empresa, já com transform: `cnpj`/`cpf` → só dígitos, `codigo` → `trim()`.
- Produces (helpers): `createTestClient(organizationId, overrides?)` passa a gerar por padrão `codigo` único (`C-<contador>`), `clientType: 'PJ'` e um CNPJ válido único; `generateValidCnpj(seed: number): string` exportado de `src/test/helpers.ts`.

- [ ] **Step 1: Testes de `documento.ts`** — mover os casos de CNPJ/CPF já existentes em `validadores.test.ts` não é necessário; escrever em `src/lib/documento.test.ts`: `cnpjValido('11.222.333/0001-81') === true`, `cnpjValido('11222333000180') === false`, `cnpjValido('00000000000000') === false`, `cpfValido('529.982.247-25') === true`, `cpfValido('11111111111') === false`, `soDigitos('12.345-6') === '123456'`.
- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter api test -- src/lib/documento.test.ts` → FAIL (módulo não existe).
- [ ] **Step 3: Implementar** `src/lib/documento.ts` movendo as três funções de `validadores.ts`; em `validadores.ts` trocar as definições por `export { soDigitos, cnpjValido, cpfValido } from '@/lib/documento'` (o motor continua importando de `./validadores`).
- [ ] **Step 4: Rodar** `documento.test.ts` e `src/modules/document-reader` → PASS.
- [ ] **Step 5: Testes do schema** em `clients.schema.test.ts` usando `companyFieldsSchema.safeParse`:
  - PJ sem `cnpj` → falha com mensagem `'Informe o CNPJ'`; PJ com CNPJ de dígito inválido → `'CNPJ inválido'`; PF sem `cpf` → `'Informe o CPF'`; CPF inválido → `'CPF inválido'`.
  - `codigo` ausente ou só espaços → `'Informe o código do cliente'`.
  - PJ sem algum de `cep, estado, cidade, bairro, logradouro, numero` → `'Endereço completo é obrigatório para pessoa jurídica'`; PF sem endereço → sucesso.
  - Sucesso normaliza: `cnpj: '11.222.333/0001-81'` → `data.cnpj === '11222333000181'`; `codigo: '  42 '` → `'42'`.
- [ ] **Step 6: Rodar e ver falhar.**
- [ ] **Step 7: Implementar `companyFieldsSchema`** em `clients.schema.ts` (objeto com os campos atuais da empresa + `superRefine` para as regras PJ/PF acima; mensagens exatamente como no Step 5). Ainda não trocar `createClientSchema` (Task 2 faz isso).
- [ ] **Step 8: Rodar** → PASS.
- [ ] **Step 9: Schema Prisma + migration.** Em `model Client`: `codigo String` (NOT NULL); remover `@@unique([codigo, organizationId])` e adicionar comentário apontando para os índices parciais. Migration à mão:
  ```sql
  DROP INDEX "clients_codigo_organizationId_key";
  ALTER TABLE "clients" ALTER COLUMN "codigo" SET NOT NULL;
  ALTER TABLE "clients" ADD CONSTRAINT "clients_document_by_type_check"
    CHECK (("clientType" = 'PJ' AND "cnpj" IS NOT NULL) OR ("clientType" = 'PF' AND "cpf" IS NOT NULL));
  CREATE UNIQUE INDEX "clients_codigo_active_key" ON "clients"("organizationId", "codigo") WHERE "isActive";
  CREATE UNIQUE INDEX "clients_cnpj_active_key" ON "clients"("organizationId", "cnpj") WHERE "isActive" AND "cnpj" IS NOT NULL;
  CREATE UNIQUE INDEX "clients_cpf_active_key" ON "clients"("organizationId", "cpf") WHERE "isActive" AND "cpf" IS NOT NULL;
  ```
  (confirmar o nome real do índice antigo com `\d clients` antes). Aplicar em teste e dev; `pnpm --filter api exec prisma generate`.
- [ ] **Step 10: Helpers** — atualizar `createTestClient` (defaults acima) e adicionar `generateValidCnpj(seed)` (calcula os dois dígitos verificadores sobre uma base de 12 dígitos derivada do seed). Rodar a suíte inteira da API: deve continuar verde (nenhum teste depende de cliente sem código/CNPJ; se algum depender, ajustar o teste para passar os campos).
- [ ] **Step 11: Teste de duplicidade (Review Focus 1)** em `clients.service.test.ts`, inserindo via `prisma.client.create` dois clientes ativos da mesma org com o mesmo CNPJ em dígitos → o segundo lança P2002 em `clients_cnpj_active_key`; cliente desativado com o mesmo CNPJ não conflita. (O mapeamento P2002 → 409 com mensagem é testado na Task 2.)
- [ ] **Step 12: Commit** — `feat(clients): código, CNPJ/CPF e endereço PJ obrigatórios com unicidade entre ativos`.

---

### Task 2: Cadastro de cliente com departamentos atendidos (I1–I4) e remoção do endpoint avulso

**Files:**
- Create: `apps/api/src/modules/clients/client-coverage.ts`, `apps/api/src/modules/clients/client-coverage.test.ts`
- Modify: `clients.schema.ts`, `clients.service.ts`, `clients.routes.ts`, `src/test/helpers.ts`
- Test: `clients.service.test.ts`, `clients.routes.test.ts`

**Interfaces:**
- Consumes: `companyFieldsSchema` (Task 1).
- Produces (schema): `clientBodySchema = companyFieldsSchema.extend({ departments: z.array(z.object({ departmentId: cuid, responsibleUserId: cuid })).min(1, 'Selecione ao menos um departamento que atende o cliente'), clientUsers: z.array(clientUserLinkSchema).min(1, 'Adicione pelo menos um usuário') })`; `type ClientBody`. `createClientSchema` e `updateClientSchema` passam a ser **o mesmo** `clientBodySchema` (PATCH = substituição completa). `clientUserLinkSchema` ganha `phone: z.string().optional()` no ramo "novo usuário" (normalização na Task 7).
- Produces (`client-coverage.ts`):
  - `type Db = Prisma.TransactionClient | typeof prisma`
  - `listServedDepartmentIds(db: Db, clientId: string): Promise<string[]>`
  - `assertDepartmentServesClient(db: Db, clientId: string, departmentId: string): Promise<void>` → `AppError(400, 'O departamento {nome} não atende o cliente {cliente}.')`
  - `assertPayloadCoverage(departments: ClientBody['departments'], clientUsers: ClientBody['clientUsers'], departmentNames: Map<string, string>): void` → 400 com `'O departamento {nome} não atende este cliente.'` (acesso fora dos atendidos) ou `'O departamento {nome} precisa de pelo menos um usuário do cliente com acesso.'`
  - `assertCanUnserveDepartments(db: Db, clientId: string, departmentIds: string[]): Promise<void>` → 409 com a mensagem "Desmarcar com pendências" da spec (só cita contagens > 0).
- Produces (helpers): `serveClientDepartment(clientId: string, departmentId: string, responsibleUserId: string)` → cria `ClientAssignment`.
- Produces (service): `createClient(organizationId: string, data: ClientBody)`, `updateClient(id: string, organizationId: string, data: ClientBody)`; `setAssignment` e a rota `PUT /clients/:id/assignments` **removidos**; `GET /clients/:id/assignments` mantido.

- [ ] **Step 1: Testes de `client-coverage.ts`** (unitários + banco):
  - `assertPayloadCoverage`: depto atendido sem nenhum usuário → mensagem "precisa de pelo menos um usuário…"; usuário com `departmentIds` contendo depto não listado em `departments` → "não atende este cliente"; payload coberto → não lança.
  - `assertDepartmentServesClient`: sem `ClientAssignment` → 400 com nome do depto e do cliente; com → resolve.
  - `assertCanUnserveDepartments`: tarefa `OPEN` do cliente no depto → 409 citando "1 tarefa(s) aberta(s)"; só tarefas `DONE`/`DISREGARDED` → resolve (Review Focus 3); vínculo recorrente ativo de template desse depto → 409 citando recorrente; `Request` `PENDING` ou `NEEDS_INFO` no depto → 409 citando solicitação.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar `client-coverage.ts`.** "Tarefa aberta" = `status notIn ['DONE','DISREGARDED']` em board do cliente. Mensagens exatas da spec.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Testes do service** (`clients.service.test.ts`), reescrevendo os de criar/editar para o contrato novo:
  - criar com 2 departamentos + responsáveis + 1 usuário novo com acesso aos 2 → cria `Client`, 2 `ClientAssignment`, `ClientUser`, 2 `ClientUserAccess`.
  - responsável de outra org / inativo / papel `CLIENT`-like → 400 `'Responsável inválido para o departamento {nome}'`; departamento de outra org → 404.
  - depto atendido sem usuário → 400 e **nada gravado** (contar `clients` antes/depois).
  - CNPJ duplicado entre ativos → 409 `'Já existe um cliente ativo com este CNPJ nesta organização'`; código duplicado → 409 com a mensagem atual de código; CPF duplicado → 409 análoga.
  - editar removendo um depto sem pendências → `ClientAssignment` e `ClientUserAccess` desse depto somem; trocando responsável → `ClientAssignment.userId` atualizado.
  - editar removendo depto com tarefa aberta → 409 e nada alterado.
- [ ] **Step 6: Rodar e ver falhar.**
- [ ] **Step 7: Implementar** `createClient`/`updateClient` numa transação única: validar org de departamentos/responsáveis → `assertPayloadCoverage` → (update) `assertCanUnserveDepartments` para os removidos → gravar client → sincronizar `ClientAssignment` (upsert dos enviados, delete dos removidos) → `upsertClientUserLinks` (já existe) → apagar `ClientUserAccess` do cliente fora do conjunto enviado. Mapear P2002 por índice (`clients_codigo_active_key`, `clients_cnpj_active_key`, `clients_cpf_active_key`) para 409. Remover `setAssignment`, `setAssignmentSchema` e a rota PUT.
- [ ] **Step 8: Rotas** (`clients.routes.test.ts`): POST/PATCH com corpo inválido → 400 com a primeira mensagem do Zod; `PUT /clients/:id/assignments` → 404. Rodar → PASS.
- [ ] **Step 9: Suíte inteira da API.** Testes de outros módulos que criam cliente direto pelo service/rota quebram aqui — atualizá-los para o contrato novo (usar `serveClientDepartment` + payload completo). Rodar até verde.
- [ ] **Step 10: Commit** — `feat(clients): departamentos atendidos e cobertura de usuários no cadastro do cliente`.

---

### Task 3: Usuários de cliente respeitam departamentos atendidos e cobertura (I3/I4)

**Files:**
- Modify: `apps/api/src/modules/clients/client-coverage.ts`, `apps/api/src/modules/client-users/client-users.service.ts`
- Test: `client-coverage.test.ts`, `client-users.service.test.ts`, `client-users.routes.test.ts`

**Interfaces:**
- Consumes: `listServedDepartmentIds`, `Db` (Task 2).
- Produces: `assertClientUserChangeKeepsCoverage(db: Db, clientUserId: string, next: { accesses: { clientId: string; departmentId: string }[]; isActive: boolean }): Promise<void>` → 409 `'{usuário} é o único com acesso ao departamento {depto} do cliente {cliente}. Adicione outro usuário antes.'` Considera só clientes **ativos**.
- Produces: `assertAccessesServed(db: Db, accesses: { clientId: string; departmentId: string }[]): Promise<void>` → 400 `'O departamento {nome} não atende este cliente.'`

- [ ] **Step 1: Testes:**
  - `createClientUser` com acesso a depto não atendido → 400.
  - `updateClientUser` removendo o único acesso de um depto atendido de cliente ativo → 409 com a mensagem; mesmo cenário com o cliente desativado → permitido (Review Focus 2).
  - `updateClientUser({ isActive: false })` sendo o último → 409; havendo outro usuário ativo → permitido.
  - `deleteClientUser` (soft delete) sendo o último → 409.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** as duas funções em `client-coverage.ts` e chamá-las em `createClientUser` (só `assertAccessesServed`), `updateClientUser` e `deleteClientUser` **dentro da transação** que grava (para não haver janela entre checar e gravar). O estado "depois" de `updateClientUser` = acessos novos se vierem, senão os atuais; `isActive` novo se vier.
- [ ] **Step 4: Rodar** → PASS; suíte inteira verde.
- [ ] **Step 5: Commit** — `feat(client-users): acesso só a departamento atendido e bloqueio do último usuário`.

---

### Task 4: Tarefas só em departamento atendido e só dentro do mesmo board (I5)

**Files:**
- Modify: `apps/api/src/modules/tasks/tasks.service.ts`
- Test: `tasks.service.test.ts`, `tasks.routes.test.ts` (+ testes de outros módulos que criam/movem tarefa pelo service)

**Interfaces:**
- Consumes: `assertDepartmentServesClient` (Task 2), `serveClientDepartment` (helper).

- [ ] **Step 1: Testes:**
  - `createTask` com depto não atendido pelo cliente do board → 400 `'O departamento {nome} não atende o cliente {cliente}.'`; atendido → cria.
  - `updateTask` trocando para depto não atendido → 400; para atendido → atualiza e grava `department_changed`.
  - `moveTask` para coluna de **outro board** (mesmo cliente ou outro) → 400 `'A tarefa só pode ser movida dentro do mesmo processo'`; mesma coluna/board → ok.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** as checagens no início de `createTask`, `updateTask` (só quando `departmentId` muda) e `moveTask` (`toColumn.board.id !== task.column.board.id`).
- [ ] **Step 4: Rodar** → PASS. Suíte inteira: atualizar os testes que criam tarefa via service/rota sem declarar o departamento como atendido (chamar `serveClientDepartment` no setup). `createTestTask` (insert direto) não muda.
- [ ] **Step 5: Commit** — `fix(tasks): tarefa só em departamento atendido e mover só no mesmo processo`.

---

### Task 5: Recorrentes respeitam departamentos atendidos (I5) com falha acionável

**Files:**
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.service.ts`
- Test: `recurring-templates.service.test.ts`, `recurring-tasks.cron.test.ts`, `task-documents.service.test.ts`

**Interfaces:**
- Consumes: `assertDepartmentServesClient`, `listServedDepartmentIds` (Task 2).
- Produces: constante exportada `departmentNotServedFailureMessage(departmentName: string, clientName: string): string` = `'O departamento {depto} não atende mais o cliente {cliente}. Marque o departamento no cadastro do cliente ou remova o vínculo do template.'`

- [ ] **Step 1: Testes:**
  - `createAssignment` para cliente não atendido pelo depto do template → 400 (mensagem de `assertDepartmentServesClient`).
  - `updateTemplate` trocando `departmentId` quando algum cliente vinculado ativo não é atendido pelo novo → 409 `'Não é possível trocar o departamento: {n} cliente(s) vinculado(s) não são atendidos pelo departamento {nome}.'`
  - `generateTaskForAssignment` com o depto deixando de atender o cliente (apagar o `ClientAssignment` direto no banco) → retorna `{ status: 'FAILED', errorMessage }` com a mensagem de `departmentNotServedFailureMessage`, grava `RecurringGenerationLog` `FAILED` e **não** cria tarefa.
  - Falha inesperada (forçar `ensureRecurringSystemBoard` a lançar via `vi.spyOn` no namespace import) → `errorMessage` começa com `'Erro inesperado ao gerar a tarefa:'` e termina com `'Tente gerar novamente; se persistir, avise o suporte.'`
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** as checagens; na geração, checar antes da transação de criação; o catch genérico existente passa a montar a mensagem amigável acima.
- [ ] **Step 4: Rodar** → PASS; suíte verde (atualizar setups com `serveClientDepartment`).
- [ ] **Step 5: Commit** — `feat(recurring): vínculo e geração só em departamento atendido, falhas com mensagem acionável`.

---

### Task 6: Solicitações e portal só em departamento acessível (I6)

**Files:**
- Create: `apps/api/prisma/migrations/<ts>_request_department_required/migration.sql`
- Modify: `prisma/schema.prisma` (`Request.departmentId String`, relação obrigatória), `requests.schema.ts`, `requests.service.ts`, `portal.routes.ts`, `tasks.service.ts` (remover `defaultDepartmentForOrg`)
- Test: `requests.service.test.ts`, `portal.routes.test.ts`, `request-comments.*.test.ts`, `request-attachments.service.test.ts`

**Interfaces:**
- Consumes: `assertDepartmentServesClient` (Task 2), `getClientAccessScope`/`canSeeTask` (existentes).
- Produces: `createRequestSchema.departmentId` obrigatório (`'Selecione o departamento'`); `GET /portal/departments?clientId=` → `{ id, name }[]`.
- Produces: assinatura nova `createRequest(organizationId: string, clientId: string, clientUserId: string, data: Omit<CreateRequestBody, 'clientId'>)` — o `clientUserId` é usado para validar o acesso ao departamento.

- [ ] **Step 1: Testes:**
  - `GET /portal/departments` sem `clientId` → 400 `'clientId é obrigatório'`; empresa sem acesso → 404 `'Empresa não encontrada'`; com acesso → só os departamentos do `ClientUserAccess` do usuário naquele cliente.
  - `POST /portal/requests` sem `departmentId` → 400; com depto a que o usuário não tem acesso naquele cliente → 403 `'Você não tem acesso a este departamento'`.
  - `approveRequest` quando o depto deixou de atender o cliente desde a abertura → 409 `'O departamento {nome} não atende mais o cliente {cliente}. Ajuste o cadastro do cliente antes de aprovar.'`; normal → cria tarefa no depto da solicitação.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Migration + implementação.** `Request.departmentId` NOT NULL (gerar via `migrate diff`, aplicar em teste/dev; bancos sem `requests` nulas). Rota do portal passa `request.user.sub` como `clientUserId`; `createRequest` valida o acesso com `getClientAccessScope`; `approveRequest` usa `request.departmentId` e chama `assertDepartmentServesClient` convertendo para a mensagem 409 acima; apagar `defaultDepartmentForOrg` e seus testes.
- [ ] **Step 4: Rodar** → PASS; suíte verde (setups de solicitação passam a criar depto atendido + acesso).
- [ ] **Step 5: Commit** — `feat(requests): solicitação exige departamento acessível ao usuário do cliente`.

---

### Task 7: Notificações ao cliente por departamento, WhatsApp no telefone de cada usuário

**Files:**
- Create: `apps/api/src/lib/phone.ts` (+ `.test.ts`), `apps/api/src/modules/notifications/client-recipients.ts` (+ `.test.ts`)
- Modify: `src/workers/notification.worker.ts`, `src/modules/client-users/client-users.service.ts`, `src/modules/clients/clients.service.ts`, `src/modules/requests/requests.service.ts`, `src/modules/comments/comments.service.ts`, `src/modules/request-comments/request-comments.service.ts`
- Test: `notification.worker.test.ts`, `notification-worker.test.ts`, testes de comments/request-comments/requests

**Interfaces:**
- Produces: `normalizarTelefoneBr(input: string): string` — só dígitos; 10–11 dígitos → prefixa `55`; 12–13 começando com `55` → mantém; senão `AppError(400, 'Telefone inválido: {input}')`.
- Produces: `resolveClientRecipients(clientId: string, departmentId: string): Promise<{ id: string; name: string; email: string; phone: string | null }[]>` — usuários do cliente **ativos** com acesso ao departamento.

- [ ] **Step 1: Testes de `phone.ts`:** `'(82) 99999-1234'` → `'5582999991234'`; `'5582999991234'` → igual; `'1234'` → 400.
- [ ] **Step 2: Testes do worker** (spy em `maximizebot.sendWhatsApp` e `mailer.sendEmail`):
  - evento de tarefa do depto Folha com 2 usuários na Folha (um com telefone) e 1 no Fiscal com telefone → WhatsApp só para o telefone do usuário da Folha, e-mail para os 2 da Folha; `NotificationLog` um por envio com `recipient` = telefone/e-mail.
  - `client.whatsapp` preenchido não recebe nada.
  - tarefa `visibleToClient = false` → zero envios (Review Focus 5).
  - evento de solicitação (`REQUEST_APPROVED`) usa `request.departmentId` para filtrar.
- [ ] **Step 3: Testes de fallback removido:** comentário de cliente em tarefa notifica só o responsável do `ClientAssignment` do depto (sem fallback para admins); idem nova solicitação e comentário em solicitação.
- [ ] **Step 4: Rodar e ver falhar.**
- [ ] **Step 5: Implementar.** `resolveClientRecipients` usado pelos dois canais no worker (departamento = `task.departmentId` ou `request.departmentId`; carregar o request quando houver `requestId`); WhatsApp por destinatário com telefone; remover uso de `client.whatsapp`. Normalizar `phone` ao salvar em `createClientUser`/`updateClientUser` e no ramo "novo usuário" de `upsertClientUserLinks`. Remover os ramos de fallback "sem responsável → ORG_ADMIN/ORG_MANAGER" nos três services.
- [ ] **Step 6: Rodar** → PASS; suíte verde.
- [ ] **Step 7: Commit** — `feat(notifications): destinatários do cliente por departamento e WhatsApp por usuário`.

---

### Task 8: Transferir responsabilidades e bloqueio de desativação de responsável (I2)

**Files:**
- Create: `apps/api/src/modules/users/responsibility-transfer.service.ts`, `responsibility-transfer.schema.ts`, `responsibility-transfer.service.test.ts`
- Modify: `users.service.ts` (`deleteUser`), `users.routes.ts`
- Test: `users.service.test.ts`, `users.routes.test.ts` (rotas novas)

**Interfaces:**
- Produces: `type PortfolioEntry = { clientId: string; clientName: string; codigo: string; departments: { id: string; name: string }[]; boardsCount: number; openTasksCount: number }`
- Produces: `getPortfolio(userId: string, organizationId: string, departmentId?: string): Promise<PortfolioEntry[]>` — só clientes ativos; inclui cliente que tenha qualquer um dos três vínculos (assignment, board ativo como responsável, tarefa aberta atribuída); com `departmentId`, considera só assignments e tarefas daquele depto e `boardsCount = 0`.
- Produces: `transferSchema = z.object({ toUserId: cuid, clientIds: z.array(cuid).min(1), departmentId: cuid.optional(), includeBoards: z.boolean().default(true), includeTasks: z.boolean().default(true) })`; `transferResponsibilities(fromUserId: string, organizationId: string, body: TransferBody, actorId: string): Promise<{ assignments: number; boards: number; tasks: number }>`.
- Routes (ORG_ADMIN): `GET /users/:id/portfolio?departmentId=`, `POST /users/:id/transfer`.

- [ ] **Step 1: Testes:**
  - `getPortfolio` agrupa por cliente com as contagens; filtro de depto zera `boardsCount`.
  - `transferResponsibilities` move assignments, boards ativos (`responsibleUserId`) e tarefas abertas (`assigneeId`) dos clientes selecionados, grava `TaskHistory` `assigned_to` por tarefa, e não toca em clientes não selecionados nem em tarefas `DONE`.
  - com `departmentId`: não move boards e só move tarefas/assignments daquele depto (Review Focus 4).
  - `includeTasks: false` → tarefas ficam.
  - destino inativo / de outra org / papel inválido → 400 `'Colaborador de destino inválido'` (outra org → 404); origem = destino → 400 `'Escolha um colaborador diferente do atual'`; cliente fora da carteira → 400 `'Cliente fora da carteira deste colaborador'`.
  - `deleteUser` de quem é responsável em cliente ativo → 409 `'{usuário} é responsável por {n} cliente(s)/departamento(s). Defina outro responsável antes de desativar.'`; responsável só em cliente inativo → permitido.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** service (transação única), schema e rotas.
- [ ] **Step 4: Rodar** → PASS; suíte verde.
- [ ] **Step 5: Commit** — `feat(users): transferir responsabilidades e bloquear desativação de responsável`.

---

### Task 9: Falhas de geração no resumo diário

**Files:**
- Modify: `apps/api/src/workers/sla-digest.cron.ts`
- Test: `apps/api/src/workers/sla-digest.cron.test.ts`

**Interfaces:**
- Consumes: `getFailedGenerations` (existente).
- Produces: `DigestEntry.kind` ganha `'recurring_failure'` e `level` ganha `'FAILED'` (rank 0, antes de `EXPIRED`); linha: `- [recorrente não gerada] {templateTitle} ({clientName}) — competência {MM/AAAA}: {errorMessage}`.

- [ ] **Step 1: Teste:** org com 1 falha de geração e digest ligado → `enqueueNotification` (spy) para cada `ORG_ADMIN`/`ORG_MANAGER` ativo com `taskListText` contendo a linha acima no topo; org com digest desligado → nada.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** em `runSlaDigestForOrg`, depois de tarefas e protocolos.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** — `feat(sla-digest): falhas de geração de recorrentes no resumo diário`.

---

### Task 10: Seed E2E respeitando as invariantes

**Files:**
- Modify: `apps/api/prisma/e2e-seed.ts`

- [ ] **Step 1:** "Cliente E2E" com `codigo: 'E2E-001'`, `clientType: 'PJ'`, CNPJ válido fixo (`'11222333000181'`), endereço completo; `ClientAssignment` do depto "Geral" com o admin como responsável (upsert); `ClientUser` com `phone`.
- [ ] **Step 2:** Rodar `pnpm --filter web test:e2e` (com API + web de pé) → 8/8 specs verdes.
- [ ] **Step 3: Commit** — `test(e2e): seed respeita departamentos atendidos e dados obrigatórios`.

---

### Task 11: Formulário de cliente em abas

**Files:**
- Create: `apps/web/src/pages/app/clients/ClientForm.tsx`, `apps/web/src/pages/app/clients/clientFormStatus.ts`, `apps/web/src/pages/app/clients/clientFormStatus.test.ts`
- Modify: `apps/web/src/pages/app/Clients.tsx`, `apps/web/src/types/index.ts`

**Interfaces:**
- Consumes: `POST/PATCH /clients` com `ClientBody` (Task 2), `GET /clients/:id/assignments`, `GET /clients/:id/users`, `GET /departments`, `GET /users`.
- Produces: `computeClientFormStatus(form: ClientFormState): { empresa: boolean; departamentos: boolean; acesso: boolean; canSave: boolean; coverage: CoverageRow[] }`, `type CoverageRow = { departmentId: string; departmentName: string; userCount: number; withPhoneCount: number; status: 'ok' | 'sem_whatsapp' | 'sem_usuario' }`.

- [ ] **Step 1: Testes de `computeClientFormStatus`:** PJ sem CNPJ válido → `empresa false`; PJ sem endereço → `false`; PF sem endereço → `true`; nenhum depto marcado → `departamentos false`; depto marcado sem responsável → `false`; depto sem usuário → linha `sem_usuario` e `acesso false`; depto só com usuários sem telefone → `sem_whatsapp` e `acesso true`; tudo ok → `canSave true`. Validação de CNPJ/CPF no front: portar `cnpjValido`/`cpfValido` para `apps/web/src/lib/documento.ts` (mesmos casos de teste da Task 1).
- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter web test -- clientFormStatus`.
- [ ] **Step 3: Implementar** `clientFormStatus.ts` e `ClientForm.tsx`: 3 abas (Empresa, Departamentos, Acesso ao portal) com indicador vermelho na aba incompleta; aba Departamentos com checkbox + seletor obrigatório de responsável (usuários ORG ativos); aba Acesso com usuários (buscar/criar, telefone opcional), chips só dos deptos marcados, **novo usuário entra com todos os atendidos marcados**, desmarcar depto na aba 2 remove os chips; painel de cobertura (vermelho bloqueia, amarelo avisa — textos da spec). Org sem departamento: aviso com link para Configurações › Departamentos. Salvar desabilitado enquanto `!canSave`; erro da API mostrado no toast. `Clients.tsx` usa `ClientForm` para criar e editar, remove `AssignmentsSection`, e abre o editar quando a URL tem `?edit=<clientId>`.
- [ ] **Step 4: Rodar** testes + `tsc`.
- [ ] **Step 5: QA no navegador** (Playwright, prints): criar cliente PJ completo; tentar salvar com depto sem usuário (bloqueado); amarelo sem WhatsApp; editar e desmarcar depto com tarefa aberta (erro da API visível); `?edit=` abre o formulário.
- [ ] **Step 6: Commit** — `feat(web): cadastro de cliente em abas com painel de cobertura`.

---

### Task 12: Seletores de departamento restritos + portal

**Files:**
- Create: `apps/web/src/hooks/useServedDepartments.ts`
- Modify: `Board.tsx`, `components/shared/TaskDrawer.tsx`, `settings/ClientUserForm.tsx`, `settings/RecurringTemplateManage.tsx`, `pages/portal/Requests.tsx`

**Interfaces:**
- Produces: `useServedDepartments(clientId: string | undefined): { departments: { id: string; name: string }[]; isLoading: boolean }` (de `GET /clients/:id/assignments`).

- [ ] **Step 1:** `Board.tsx` (nova tarefa) e `TaskDrawer.tsx` (trocar depto, só papéis ORG) usam `useServedDepartments(board.clientId)`; `ClientUserForm.tsx` mostra por empresa só os atendidos; `RecurringTemplateManage.tsx` desabilita cliente não atendido pelo depto do template com o motivo `'{cliente} não é atendido pelo departamento {nome}'` (fonte: `GET /clients` + assignments — se ficar caro, adicionar `servedDepartmentIds` na resposta de `GET /recurring-templates/:id/assignments` candidatos; decidir no implementar e anotar). Portal `Requests.tsx`: `GET /portal/departments?clientId=` com o `clientId` do `usePortalClient`, departamento obrigatório no formulário.
- [ ] **Step 2:** `tsc` + testes web.
- [ ] **Step 3: QA no navegador:** board só oferece deptos atendidos; portal só lista os deptos do usuário e exige seleção.
- [ ] **Step 4: Commit** — `feat(web): seletores de departamento só com departamentos atendidos`.

---

### Task 13: Tela "Transferir responsabilidades"

**Files:**
- Create: `apps/web/src/pages/app/UserTransfer.tsx`
- Modify: `apps/web/src/pages/app/Users.tsx`, `apps/web/src/router.tsx`

**Interfaces:**
- Consumes: `GET /users/:id/portfolio`, `POST /users/:id/transfer`, `DELETE /users/:id` (Task 8).

- [ ] **Step 1:** Rota `/app/users/:id/transfer` (ORG_ADMIN). Lista agrupada por cliente (código, nome, departamentos, nº processos, nº tarefas abertas), busca, filtro de depto, seleção individual e "selecionar todos os filtrados", seletor de destino (exclui a origem), checkboxes "Incluir processos" (desabilitado com filtro de depto) e "Incluir tarefas abertas" marcados, botão Transferir; após sucesso, toast com as contagens e lista recarregada. Lista vazia → botão "Desativar colaborador". Em `Users.tsx`, botão "Transferir responsabilidades" por linha; o erro 409 da desativação mostra link para a tela.
- [ ] **Step 2:** `tsc` + testes web.
- [ ] **Step 3: QA no navegador:** repartir carteira de um colaborador entre dois destinos em duas transferências; filtro de depto; desativar ao zerar.
- [ ] **Step 4: Commit** — `feat(web): tela de transferência de responsabilidades`.

---

### Task 14: Alerta de recorrentes não geradas no Dashboard

**Files:**
- Create: `apps/web/src/components/FailedGenerationsAlert.tsx`
- Modify: `apps/web/src/pages/app/DashboardMetrics.tsx`

**Interfaces:**
- Consumes: `GET /recurring-templates/failed-generations` (`FailedGeneration[]`, já existe e já aceita `ORG_MANAGER`), retry existente (`POST /recurring-templates/:id/assignments/bulk-generate`, mesma lógica do `RecurringGenerationConsole` — extrair para um hook compartilhado em vez de duplicar).

- [ ] **Step 1:** Alerta no topo do Dashboard, só `ORG_ADMIN`/`ORG_MANAGER`, some sem falhas: título `'{n} tarefa(s) recorrente(s) não foram geradas'`; cada linha com template, cliente, competência (MM/AAAA), `errorMessage`, links "Abrir cliente" (`/app/clients?edit=<clientId>`) e "Abrir template" (`/app/settings/recurring-templates/<templateId>`), e "Gerar novamente" quando `retryable`.
- [ ] **Step 2:** `tsc` + testes web.
- [ ] **Step 3: QA no navegador:** forçar uma falha (remover o depto atendido de um cliente com vínculo recorrente direto no banco e gerar manualmente) e ver o alerta; corrigir e "Gerar novamente".
- [ ] **Step 4: Commit** — `feat(web): alerta de recorrentes não geradas no Dashboard`.

---

### Task 15: Fechamento

- [ ] **Step 1:** Suíte inteira API (`test:coverage`, threshold 80%), web, `tsc` dos dois, E2E.
- [ ] **Step 2:** Atualizar `docs/TASKS.md` (item 10 → concluído, com resumo) e `docs/tech-debt.md` se algo ficou deferido.
- [ ] **Step 3: Commit** — `docs: cobertura de departamentos concluída`.
