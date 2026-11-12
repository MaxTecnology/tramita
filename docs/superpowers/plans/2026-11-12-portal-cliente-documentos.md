# Novo portal do cliente centrado em documentos (Fase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a lista de tarefas do portal por um portal centrado em documentos (Início, Documentos recebidos com "Marcar como pago", Enviar documentos, Processos) e dar ao escritório a visão de guias não pagas.

**Architecture:** `Protocol` vira o único "documento recebido" do cliente: ganha competência, valor, pagamento, cancelamento e versão de arquivo; a entrega (`TaskDeliverable`) concluída numa tarefa visível gera/atualiza o protocolo dela (1:1). O robô de leitura passa a preencher a entrega (com barreira de CNPJ/competência e pré-preenchimento de valor/vencimento). O portal web troca as telas Tarefas/Protocolos por Início/Documentos recebidos/Enviar documentos/Processos, consumindo endpoints agregados novos em `portal.routes.ts`.

**Tech Stack:** Fastify v5, Prisma v6 (Postgres), Zod, BullMQ, Vitest; React 19, TanStack Query, Tailwind v4, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-11-12-portal-cliente-documentos-design.md`

## Global Constraints

- Textos ao usuário em pt-BR; código, nomes e comentários em inglês. TypeScript strict, sem `any`.
- Zod em todo body/params/query; erros via `AppError(statusCode, message)`; logs via `logger`, sem telefone/e-mail/valor de cliente.
- Migrations só por `pnpm --filter api migrate:dev -- --name <nome>` (dev) e aplicar no banco de teste com `DATABASE_URL=$DATABASE_URL_TEST node ./node_modules/prisma/build/index.js migrate deploy` (sem TTY: gerar SQL com `prisma migrate diff --from-url "$DATABASE_URL_TEST" --to-schema-datamodel prisma/schema.prisma --script`, escrever a pasta à mão e aplicar com `migrate deploy` nos dois bancos). Nunca `prisma migrate` direto.
- Dinheiro: Postgres `DECIMAL(12,2)` / Prisma `Decimal`; na API trafega como string `"1234.56"`; nunca `number` de ponto flutuante na persistência.
- Isolamento: toda query filtra `organizationId`; portal filtra por `getClientAccessScope` + `canSeeTask(scope, clientId, task.departmentId)`; fora do escopo responde **404** (nunca 403).
- ORG_MEMBER no escritório: escopo `memberBoardWhere(userId)` (`apps/api/src/modules/boards/board-visibility.ts`) aplicado via `task.column.board`.
- UI: tokens do tema (`bg-surface`, `text-foreground`, `text-muted-foreground`, `bg-*-500/10`), nunca cor clara fixa; funcionar em 375px de largura.
- Sem notificação nova de cobrança; o aviso `PROTOCOL_CREATED` continua para todo protocolo (manual ou automático).

## Review Focus

1. Usuário do cliente com acesso só à Folha chamando por URL direta as ações de um protocolo/pedido do Fiscal (pagar, desfazer, baixar, nada a enviar) → 404 e nada muda. (testes nas Tasks 6 e 7)
2. Valor em formato brasileiro vindo da UI ("1.234,56") ou com mais de 2 casas → API recusa com 400 claro; a UI converte para "1234.56" antes de enviar. (testes nas Tasks 3 e 10)
3. Dois cliques em "Marcar como pago" / escritório editando valor ou substituindo arquivo de guia já paga → 409 com mensagem, sem segundo evento `PAID`. (testes nas Tasks 4 e 6)
4. Entrega reenviada (substituída) numa tarefa **não** visível ao cliente, e depois a tarefa ficando visível → exatamente um protocolo, com o arquivo mais recente. (teste na Task 3)
5. Robô anexando a tarefa sem nenhuma entrega pendente → comportamento antigo (só anexo, sem protocolo), não erro. (teste na Task 8)

---

### Task 1: Schema — pagamento, cancelamento, versões e "nada a enviar"

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (models `Protocol`, `ProtocolEvent`, `TaskDeliverable`, `RecurringTaskTemplateDocument`; enums `ProtocolEventType`, `DocumentRequirementStatus`)
- Create: `apps/api/prisma/migrations/20261112120000_portal_documents/migration.sql`
- Test: `apps/api/src/modules/protocols/protocol-schema.test.ts`

**Interfaces:**
- Produces (Prisma fields, exact names):
  - `Protocol`: `competence DateTime? @db.Date`, `requiresPayment Boolean @default(false)`, `amount Decimal? @db.Decimal(12,2)`, `paidAt DateTime?`, `paidAmount Decimal? @db.Decimal(12,2)`, `paidByClientUserId String?` (relation `ClientUser`), `paymentProofAttachmentId String? @unique` (relation `Attachment`, name `"ProtocolPaymentProof"`), `deliverableId String? @unique` (relation `TaskDeliverable`), `cancelledAt DateTime?`, `cancelledById String?` (relation `User`, name `"ProtocolCancelledBy"`), `cancellationReason String?`, `fileUpdatedAt DateTime?`. `dueDate` continua sendo o **vencimento** da guia.
  - `ProtocolEvent`: `detail String?` (texto livre: "R$ 10,00 → R$ 12,00", motivo), `previousAttachmentId String?` (arquivo substituído; sem FK cascata — o anexo antigo nunca é apagado).
  - `ProtocolEventType` += `PAID`, `UNPAID`, `AMOUNT_CHANGED`, `REPLACED`, `CANCELLED`.
  - `TaskDeliverable`: `requiresPayment Boolean @default(false)`, `amount Decimal? @db.Decimal(12,2)`, `paymentDueDate DateTime? @db.Date`, back-relation `protocol Protocol?`.
  - `RecurringTaskTemplateDocument`: `requiresPayment Boolean @default(false)` (só tem efeito nas linhas de entrega).
  - `DocumentRequirementStatus` += `NOT_APPLICABLE`.
  - Index: `@@index([organizationId, requiresPayment, paidAt])` em `Protocol`.

- [ ] **Step 1: Write the failing test** — `protocol-schema.test.ts`, `it('persists payment, cancellation and deliverable link on Protocol')`: cria org/cliente/tarefa/entrega via helpers, `prisma.protocol.create` com `requiresPayment: true, amount: '1234.56', competence: new Date('2026-10-01'), deliverableId`, depois `update` com `paidAt`, `paidAmount: '1234.56'`; asserts `amount.toString() === '1234.56'`, `deliverableId` igual, e que um segundo `protocol.create` com o mesmo `deliverableId` rejeita com código `P2002`. `it('accepts NOT_APPLICABLE on document requirements')`.
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/modules/protocols/protocol-schema.test.ts` — Expected: FAIL (campos inexistentes / erro de tipo).
- [ ] **Step 3: Edit schema + write migration** (gerar SQL com `migrate diff`, revisar, salvar na pasta acima; aplicar com `pnpm --filter api migrate:deploy` e no banco de teste). Rodar `pnpm --filter api exec prisma generate`.
- [ ] **Step 4: Run** o mesmo teste + `pnpm --filter api exec tsc --noEmit` — Expected: PASS, tsc limpo.
- [ ] **Step 5: Commit** `feat(db): campos de pagamento, cancelamento e versão no protocolo; nada a enviar`

### Task 2: "Exige pagamento" no template e na entrega manual

**Files:**
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.schema.ts` (`documentItemSchema` vira dois: `documentRequestItemSchema = { name }`, `documentDeliveryItemSchema = { name, requiresPayment: z.boolean().default(false) }`)
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.service.ts` (create/update gravam `requiresPayment` das entregas; `generateTaskForAssignment` copia `requiresPayment` para `TaskDeliverable`)
- Modify: `apps/api/src/modules/task-documents/task-documents.service.ts` (`addDeliverable(taskId, organizationId, name, requiresPayment = false)`) e a rota `POST /tasks/:id/documents/deliveries` (body `{ name, requiresPayment? }`)
- Modify: `apps/web/src/pages/app/settings/RecurringTemplateForm.tsx` (checkbox "Exige pagamento" por entrega), `apps/web/src/types/index.ts`
- Test: `apps/api/src/modules/recurring-templates/requires-payment.test.ts`

**Interfaces:**
- Produces: `addDeliverable(taskId: string, organizationId: string, name: string, requiresPayment?: boolean): Promise<TaskDeliverable>`; template payload `documentDeliveries: { name: string; requiresPayment: boolean }[]`.

- [ ] **Step 1: Failing tests** — `it('copies requiresPayment from template deliveries to generated task deliverables')`: template com entregas `[{ name: 'Guia DAS', requiresPayment: true }, { name: 'Extrato', requiresPayment: false }]`, `generateManually` → deliverables da tarefa têm `requiresPayment` `[true, false]`. `it('update replaces deliveries keeping requiresPayment')`. `it('POST /tasks/:id/documents/deliveries accepts requiresPayment')` → 201 com `requiresPayment: true`.
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/modules/recurring-templates/requires-payment.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** API; na UI do template, cada linha de entrega ganha checkbox "Exige pagamento" (linhas de "documentos pedidos" não).
- [ ] **Step 4: Run** teste + `tsc` dos dois apps — Expected: PASS.
- [ ] **Step 5: Commit** `feat(templates): marca "exige pagamento" nas entregas`

### Task 3: Entrega gera/atualiza o protocolo (com valor e vencimento)

**Files:**
- Create: `apps/api/src/modules/protocols/protocol-from-deliverable.ts`
- Create: `apps/api/src/lib/money.ts` (+ `money.test.ts`)
- Modify: `apps/api/src/modules/task-documents/task-documents.service.ts` (`deliverDocument`), `task-documents.routes.ts` (campos multipart `amount`, `paymentDueDate`)
- Modify: `apps/api/src/modules/protocols/protocols.service.ts` (extrair o núcleo de criação para reuso: `insertProtocol(tx, input)` — número, evento `SENT`, notificação)
- Modify: `apps/api/src/modules/tasks/tasks.service.ts` (`updateTask`: ao mudar `visibleToClient` false→true, chamar `syncProtocolsForTask`)
- Modify: `apps/api/src/lib/template.ts`, `apps/api/src/lib/default-templates.ts`, `apps/api/src/workers/notification.worker.ts` (variável `paymentInfo`)
- Test: `apps/api/src/modules/protocols/protocol-from-deliverable.test.ts`

**Interfaces:**
- Consumes: campos da Task 1; `requiresPayment` da Task 2.
- Produces:
  - `parseMoney(input: string): string` — aceita `"1234.56"`/`"1234.5"`/`"1234"`; lança `AppError(400, 'Valor inválido: use até 2 casas decimais')` para vírgula, negativo, zero, >2 casas ou > 9999999999.99. Retorna string normalizada com 2 casas.
  - `formatBRL(amount: string): string` → `"R$ 1.234,56"`.
  - `upsertProtocolForDeliverable(deliverableId: string, actor: { id: string }): Promise<Protocol | null>` — `null` se a tarefa não é `visibleToClient`. Cria (título = nome da entrega, `attachmentId` = anexo da entrega, `dueDate` = `deliverable.paymentDueDate ?? task.dueDate`, `competence` = `task.competence`, `requiresPayment`, `amount`, `deliverableId`) ou, se já existe protocolo da entrega, faz a **substituição** (Task 4 `replaceProtocolFile`).
  - `syncProtocolsForTask(taskId: string, actor: { id: string }): Promise<number>` — gera protocolos para entregas concluídas sem protocolo.
  - `deliverDocument(taskId, deliverableId, organizationId, actor, payload, payment?: { amount?: string; paymentDueDate?: string })` — se `deliverable.requiresPayment` e `amount` ausente → `AppError(400, 'Informe o valor da guia')`; grava `amount`/`paymentDueDate` na entrega antes de chamar `upsertProtocolForDeliverable`.
  - Variável de template `paymentInfo?: string` = `"\nValor: R$ 1.234,56 — vencimento 20/11/2026"` para protocolo com pagamento, `''` caso contrário; incluída nos textos padrão de `PROTOCOL_CREATED` (WhatsApp e e-mail) logo após `{{protocolTitle}}`.

- [ ] **Step 1: Failing tests** (`protocol-from-deliverable.test.ts`):
  - `it('delivering a payment deliverable on a visible task creates one protocol with amount, due date and competence')` → `amount '1234.56'`, `dueDate` = paymentDueDate enviado, `competence` = da tarefa, evento `SENT`, `enqueueNotification` chamado com `event: 'PROTOCOL_CREATED'` e `metadata.paymentInfo` contendo `'R$ 1.234,56'`.
  - `it('rejects payment deliverable without amount')` → 400 `'Informe o valor da guia'`, entrega continua não entregue.
  - `it('non-payment deliverable creates protocol without amount and paymentInfo empty')`.
  - `it('task not visible to client: no protocol; making it visible generates exactly one with the latest file')` (Review Focus 4: entrega, reentrega, depois `PATCH` visibleToClient true → 1 protocolo, `attachmentId` = segundo anexo).
  - `money.test.ts`: `parseMoney('1234.56') === '1234.56'`, `parseMoney('10') === '10.00'`, rejeita `'1.234,56'`, `'12.345'`, `'-1'`, `'0'` (Review Focus 2).
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/modules/protocols/protocol-from-deliverable.test.ts src/lib/money.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** os módulos acima (protocolo + entrega atualizados na mesma transação; notificação enfileirada após commit).
- [ ] **Step 4: Run** testes + suíte de `task-documents` e `protocols` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(protocols): entrega concluída gera o protocolo com valor e vencimento`

### Task 4: Escritório — substituir, corrigir valor/vencimento, cancelar

**Files:**
- Modify: `apps/api/src/modules/protocols/protocols.service.ts`, `protocols.routes.ts`, `protocols.schema.ts`
- Test: `apps/api/src/modules/protocols/protocol-office-actions.test.ts`

**Interfaces:**
- Produces:
  - `replaceProtocolFile(protocolId, organizationId, actor, payload: UploadPayload, payment?: { amount?: string; paymentDueDate?: string })` — recusa `409 'Essa guia já foi marcada como paga pelo cliente. Peça para ele desfazer o pagamento antes de substituir.'` se `paidAt`; recusa `409 'Protocolo cancelado não pode ser alterado'` se `cancelledAt`; novo `Attachment`, `attachmentId` atualizado, `fileUpdatedAt = now`, `status` volta para `SENT`, evento `REPLACED` com `previousAttachmentId`; enfileira `PROTOCOL_CREATED` de novo (cliente é avisado da correção). Se o protocolo tem `deliverableId`, atualiza também a entrega.
  - `updateProtocolPayment(protocolId, organizationId, actor, { amount?: string; dueDate?: string })` — só se `requiresPayment` e não pago (senão 409 como acima); evento `AMOUNT_CHANGED` com `detail` `"R$ 10,00 → R$ 12,00; vencimento 20/11/2026 → 25/11/2026"`.
  - `cancelProtocol(protocolId, organizationId, actor, reason: string)` — motivo obrigatório (`z.string().trim().min(3)`); `cancelledAt/By/Reason`, evento `CANCELLED` com `detail` = motivo; idempotência: já cancelado → 409.
  - Rotas (escritório, `requireRole('ORG_ADMIN','ORG_MANAGER','ORG_MEMBER')` + `checkSubscription`): `POST /protocols/:id/replace` (multipart: file, `amount?`, `paymentDueDate?`), `PATCH /protocols/:id/payment` (`{ amount?, dueDate? }`), `POST /protocols/:id/cancel` (`{ reason }`). ORG_MEMBER só em protocolo de processo visível a ele (`memberBoardWhere`), senão 404.
  - `listProtocolsForOrg` e `getProtocolsSummary`: trocar o escopo do ORG_MEMBER de `task.assigneeId` para `task.column.board` + `memberBoardWhere`.
  - Protocolo manual (`createProtocolSchema` / `POST /tasks/:taskId/protocols`) aceita `requiresPayment?: boolean`, `amount?: string` (obrigatório se `requiresPayment`, via `parseMoney`) e grava `competence = task.competence`; mesma variável `paymentInfo` na notificação.

- [ ] **Step 1: Failing tests**: `it('manual protocol with requiresPayment requires amount and stores competence from the task')`; `it('replace keeps one protocol, swaps file, logs REPLACED with previous attachment and notifies again')`; `it('replace and payment edit are refused with 409 once the client marked it paid')` (Review Focus 3); `it('payment edit logs AMOUNT_CHANGED with before → after')`; `it('cancel requires reason, records CANCELLED and refuses a second cancel')`; `it('ORG_MEMBER gets 404 acting on a protocol of a process not visible to them')`.
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/modules/protocols/protocol-office-actions.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** testes + suíte `protocols` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(protocols): substituir arquivo, corrigir valor e cancelar com motivo`

### Task 5: Guias não pagas no escritório + expiração/digest

**Files:**
- Create: `apps/api/src/modules/protocols/unpaid-guides.service.ts`
- Modify: `apps/api/src/modules/protocols/protocols.routes.ts`, `protocols.service.ts` (`expireOverdueProtocols`), `apps/api/src/workers/sla-digest.cron.ts`
- Test: `apps/api/src/modules/protocols/unpaid-guides.test.ts`

**Interfaces:**
- Produces:
  - `listUnpaidGuides(organizationId, actor: { id: string; role: string }, filters: { clientId?: string; departmentId?: string; competence?: string /* 'YYYY-MM' */; situation?: 'overdue' | 'upcoming' | 'paid' })` → itens `{ id, number, title, clientId, clientName, departmentName, competence, dueDate, amount, paidAt, paidAmount, paidByName, boardId }`; base: `requiresPayment = true AND cancelledAt IS NULL`; sem `situation` = não pagas (vencidas + a vencer); ordenação: não pagas por `dueDate asc` (vencidas primeiro); pagas por `paidAt desc`. Vencida = `utcDayLabel(dueDate) < todayInBRT(now)` (mesma regra de `date-only.ts`).
  - `getUnpaidGuidesSummary(organizationId, actor)` → `{ unpaidCount: number; unpaidTotal: string; overdueCount: number; overdueTotal: string }` (totais como string decimal).
  - Rotas: `GET /protocols/unpaid` (query Zod com os filtros acima), `GET /protocols/unpaid/summary`. ORG_MEMBER com escopo `memberBoardWhere`.
  - `expireOverdueProtocols` e o digest de SLA ignoram protocolos com `paidAt` ou `cancelledAt` preenchidos.

- [ ] **Step 1: Failing tests**: `it('lists only unpaid, non-cancelled payment protocols ordered by due date with overdue first')`; `it('summary totals unpaid and overdue amounts as decimal strings')` (ex.: 1234.56 + 100.00 = `'1334.56'`); `it('paid guide leaves the list and the summary; situation=paid lists it with who paid')`; `it('ORG_MEMBER only sees guides of processes visible to them')`; `it('expiry and SLA digest skip paid and cancelled protocols')`.
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/modules/protocols/unpaid-guides.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** (somas com `Prisma.Decimal`, nunca `Number`).
- [ ] **Step 4: Run** testes + `sla-digest.cron.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(protocols): guias não pagas e resumo pro escritório`

### Task 6: Portal API — documentos recebidos e marcar como pago

**Files:**
- Modify: `apps/api/src/modules/protocols/protocols.service.ts` (`listProtocolsForClient`, `registerView`, `registerDownload`), `apps/api/src/modules/portal/portal.routes.ts`
- Create: `apps/api/src/modules/protocols/protocol-payment.service.ts`
- Test: `apps/api/src/modules/protocols/protocol-payment.test.ts`

**Interfaces:**
- Produces:
  - `listProtocolsForClient(organizationId, clientId, clientUserId, filters: { search?; competence?: 'YYYY-MM'; departmentId?; dueFrom?; dueTo?; paymentStatus?: 'unpaid' | 'paid' })` — **remove** o filtro `task.visibleToClient` (documento entregue nunca some); **exclui** `cancelledAt != null`; escopo de departamento como hoje. Retorna também `competence, requiresPayment, amount, paidAt, paidAmount, departmentName, fileUpdatedAt`.
  - `registerView`/`registerDownload`: mesma troca (sem `visibleToClient`, cancelado → 404).
  - `markProtocolPaid(protocolId, organizationId, clientUserId, input: { amount: string; proof?: UploadPayload })` — 404 fora do escopo/cancelado; 422 `'Esse documento não é uma guia de pagamento'` se `!requiresPayment`; 409 `'Essa guia já está marcada como paga'` se `paidAt`; grava `paidAt/paidAmount/paidByClientUserId/paymentProofAttachmentId` (comprovante vira `Attachment` da tarefa com `uploadedByClient`); evento `PAID` (`detail` = valor formatado); se `status` ∈ `SENT|EXPIRED` registra também `VIEWED`. Usar `updateMany where paidAt: null` para que dois cliques simultâneos gerem um só `PAID`.
  - `unmarkProtocolPaid(protocolId, organizationId, clientUserId)` — 409 se não pago; limpa campos de pagamento (comprovante permanece no histórico de anexos); evento `UNPAID`.
  - Rotas portal: `POST /portal/protocols/:id/pay` (multipart: `amount` obrigatório + arquivo opcional; sem arquivo também aceita JSON `{ amount }`), `DELETE /portal/protocols/:id/pay`, `GET /portal/protocols/:id` passa a devolver `events` com `actorName` e `type` para o histórico ("quem marcou e quando").

- [ ] **Step 1: Failing tests**: `it('client marks a guide as paid with proof; history shows who and when')`; `it('double mark paid yields a single PAID event and 409 on the second')` (Review Focus 3); `it('user with access only to Folha gets 404 paying a Fiscal guide and nothing changes')` (Review Focus 1); `it('non-payment document refuses pay with 422')`; `it('unmark restores unpaid and logs UNPAID')`; `it('protocol stays listed after its task is hidden from client; cancelled protocol disappears')`.
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/modules/protocols/protocol-payment.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** testes + suíte `protocols` e `portal` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): marcar guia como paga e documentos recebidos que não somem`

### Task 7: Portal API — Início, Enviar documentos e "Nada a enviar"

**Files:**
- Create: `apps/api/src/modules/portal/portal-overview.service.ts`
- Modify: `apps/api/src/modules/portal/portal.routes.ts`, `apps/api/src/modules/task-documents/task-documents.service.ts` (`recalculateTaskStatus`, `reviewDocumentRequirement`, novo `setNotApplicable`)
- Test: `apps/api/src/modules/portal/portal-overview.test.ts`

**Interfaces:**
- Produces:
  - `getPortalHome(organizationId, clientId, clientUserId, now = new Date())` → `{ unpaidGuides: { count: number; overdueCount: number }; documentsToSend: number /* PENDING|REJECTED em tarefas visíveis, recorrentes + processos, no escopo */; processesInProgress: number /* boards OS com tarefa visível não concluída */; dueThisWeek: { kind: 'guide' | 'request'; id: string; title: string; dueDate: string; amount?: string }[] /* próximos 7 dias, inclui vencidas não pagas */ }`.
  - `listDocumentRequestsByMonth(organizationId, clientId, clientUserId, competence: 'YYYY-MM')` → `{ competence; requests: { id; taskId; name; status; rejectionReason; departmentName; taskTitle }[] }` — só tarefas em board `RECURRING_SYSTEM`, `visibleToClient`, `task.competence` no mês, escopo de departamento.
  - `listDocumentRequestMonths(organizationId, clientId, clientUserId)` → `{ competence: 'YYYY-MM'; pending: number; total: number }[]` ordenado desc (para o seletor e para recolher meses sem pendência).
  - `setNotApplicable(taskId, requirementId, organizationId, clientUserId, value: boolean)` — `true`: PENDING|REJECTED → `NOT_APPLICABLE`; `false` (desfazer): `NOT_APPLICABLE` → `PENDING`, recusado com 409 `'A tarefa já foi concluída'` se a tarefa está `DONE`; ambos chamam `recalculateTaskStatus`.
  - `recalculateTaskStatus`: `NOT_APPLICABLE` conta como `APPROVED` (não bloqueia; entra em `allRequirementsApproved`).
  - `reviewDocumentRequirement`: permite recusar (`REJECTED` + motivo) um `NOT_APPLICABLE`.
  - Rotas portal: `GET /portal/home?clientId=`, `GET /portal/document-requests/months?clientId=`, `GET /portal/document-requests?clientId=&competence=YYYY-MM`, `POST`/`DELETE /portal/tasks/:taskId/documents/requests/:reqId/not-applicable`.

- [ ] **Step 1: Failing tests**: `it('home counts unpaid guides, documents to send and processes in progress within the user scope')` (usuário só Folha não conta itens do Fiscal); `it('document requests by month list only recurring tasks of that competence')` (pedido de OS não aparece); `it('not applicable unblocks the task like an approval and can be undone while not done')`; `it('office can reject a not applicable with a reason')`; `it('Folha-only user gets 404 on not-applicable of a Fiscal request')` (Review Focus 1).
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/modules/portal/portal-overview.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** testes + suíte `task-documents` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(portal): início, enviar documentos por mês e nada a enviar`

### Task 8: Robô — barreira de CNPJ/competência e preenchimento da entrega

**Files:**
- Modify: `apps/api/src/modules/document-reader/document-reader.service.ts` (`anexarDocumento`, `confirmarSugestao`, `trocarTarefa`), `document-reader.schema.ts`, `document-reader.routes.ts`
- Modify: `apps/web/src/pages/app/document-reader/ReviewQueue.tsx`
- Test: `apps/api/src/modules/document-reader/document-reader-delivery.test.ts`

**Interfaces:**
- Consumes: `deliverDocument` com `payment` (Task 3).
- Produces:
  - Body de `POST /document-reader/:id/confirmar` e `/trocar-tarefa` ganha `{ deliverableId?: string; amount?: string; paymentDueDate?: string }`.
  - `anexarDocumento`: (1) **sempre** `assertCnpjBateComTarefa` (hoje só em `'trocado'`); (2) se `extractedFields.competencia` ou `.pa` válido e diferente de `competenciaParaRotulo(task.competence)` → `AppError(422, 'A competência lida no documento (MM/AAAA) não bate com a da tarefa (MM/AAAA) — confira se escolheu a tarefa certa')`; (3) entregas pendentes da tarefa (`deliveredAt = null`): 0 → comportamento atual (só anexo); 1 → usa ela; >1 sem `deliverableId` → 422 `'Essa tarefa tem mais de uma entrega pendente — escolha qual este documento preenche'`; (4) `amount` = body ou `extractedFields.valor` (tipo moeda, válido); `paymentDueDate` = body ou `extractedFields.vencimento` (tipo data, válido); entrega que exige pagamento sem valor → 400 `'Informe o valor da guia'` (de `deliverDocument`). O documento fica `PENDING` na fila em qualquer erro.
  - `GET /document-reader` (fila) passa a devolver, para a tarefa sugerida, `pendingDeliverables: { id; name; requiresPayment }[]`.
  - ReviewQueue: seletor de entrega quando houver >1; campos Valor/Vencimento (pré-preenchidos com o lido) quando a entrega exige pagamento; mostra o motivo do 422.

- [ ] **Step 1: Failing tests**: `it('confirming a guide fills the single pending deliverable and creates the protocol with the read amount and due date')`; `it('CNPJ of another client is refused even when confirming the suggestion')`; `it('competence mismatch is refused with the read and expected months')`; `it('more than one pending deliverable requires choosing one')`; `it('task without pending deliverables keeps the old behavior: attachment only, no protocol')` (Review Focus 5).
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/modules/document-reader/document-reader-delivery.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** API + ReviewQueue.
- [ ] **Step 4: Run** testes + suíte `document-reader` + `tsc` web — Expected: PASS.
- [ ] **Step 5: Commit** `feat(document-reader): barreira de CNPJ/competência e robô preenche a entrega`

### Task 9: Escritório web — entrega com valor, ações do protocolo, Dashboard e lista de guias

**Files:**
- Modify: `apps/web/src/components/shared/TaskDrawer.tsx` (adicionar entrega com "Exige pagamento"; upload de entrega que exige pagamento abre campos Valor (máscara BRL) e Vencimento (padrão = prazo da tarefa); aba Protocolos com Substituir, Corrigir valor/vencimento, Cancelar com motivo, histórico com eventos novos)
- Create: `apps/web/src/lib/money.ts` (+ `money.test.ts`): `toApiAmount(input: string): string` ("1.234,56" → "1234.56"; inválido → lança `Error('Valor inválido')`), `formatBRL(amount: string): string`
- Create: `apps/web/src/pages/app/UnpaidGuides.tsx` (rota `/app/guides`, item "Guias não pagas" no sidebar em TRABALHO)
- Modify: `apps/web/src/pages/app/DashboardMetrics.tsx` (cartão "Guias não pagas": quantidade e total; linha de vencidas em destaque `text-danger-text`; clique → `/app/guides`), `apps/web/src/router.tsx`, sidebar
- Test: `apps/web/src/lib/money.test.ts`, `apps/web/src/pages/app/UnpaidGuides.test.tsx`

**Interfaces:**
- Consumes: rotas das Tasks 3–5.
- Produces: rota web `/app/guides` com filtros cliente, competência, departamento, situação (vencida / a vencer / paga); lista ordenada como a API; valor em destaque; paga mostra quem pagou e diferença se `paidAmount ≠ amount`.

- [ ] **Step 1: Failing tests**: `money.test.ts` — `toApiAmount('1.234,56') === '1234.56'`, `toApiAmount('10') === '10.00'`, `toApiAmount('12,345')` lança (Review Focus 2); `UnpaidGuides.test.tsx` (msw) — renderiza vencida antes de a vencer e mostra `'R$ 1.234,56'`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run src/lib/money.test.ts src/pages/app/UnpaidGuides.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** testes + `tsc` web — Expected: PASS. QA visual: screenshot claro/escuro do Dashboard, da lista e do TaskDrawer (aba Protocolos).
- [ ] **Step 5: Commit** `feat(web): guias não pagas no escritório e entrega com valor`

### Task 10: Portal web — Início, Documentos recebidos, Enviar documentos, Processos

**Files:**
- Create: `apps/web/src/pages/portal/Home.tsx`, `ReceivedDocuments.tsx`, `ReceivedDocumentDetail.tsx`, `SendDocuments.tsx`, `components/portal/MarkPaidDialog.tsx`
- Modify: `apps/web/src/pages/portal/Layout.tsx` (nav: Início, Documentos recebidos, Enviar documentos, Processos, Solicitações, Perfil — remove Tarefas e Protocolos), `apps/web/src/router.tsx` (rotas `/portal` index → `home`; `documents`, `documents/:id`, `send`, `board` continua como Processos; remover `tasks` e `protocols` com `Navigate` para `documents`), `apps/web/src/pages/portal/Board.tsx` (pedidos de documento do processo com enviar / nada a enviar)
- Delete: `apps/web/src/pages/portal/Tasks.tsx`, `apps/web/src/pages/portal/Protocols.tsx`
- Test: `apps/web/src/components/portal/MarkPaidDialog.test.tsx`, `apps/web/src/pages/portal/SendDocuments.test.tsx`

**Interfaces:**
- Consumes: rotas das Tasks 6 e 7; `toApiAmount`/`formatBRL` (Task 9).
- Produces (comportamento):
  - Início: 3 cartões clicáveis + "Vencendo esta semana".
  - Documentos recebidos: filtros competência/vencimento/departamento/situação; colunas Documento, Vencimento, Competência, Valor, Status (Não visto / Visto / Pago); "Atualizado em dd/mm" quando `fileUpdatedAt`.
  - Detalhe: prévia do PDF (iframe com URL assinada), Baixar, toggle "Pago" → `MarkPaidDialog` (Valor pré-preenchido com `amount`, comprovante opcional, Cancelar/Marcar como pago); desfazer com confirmação; "Ver histórico" com quem/quando.
  - Enviar documentos: seletor de mês (mês corrente padrão), meses sem pendência recolhidos, cada pedido com cor (vermelho pendente/recusado com motivo, amarelo enviado, verde aprovado/nada a enviar), Anexar e "Nada a enviar"/desfazer.
  - Seletor de empresa (cliente) mantido no topo quando o usuário tem mais de um cliente.

- [ ] **Step 1: Failing tests**: `MarkPaidDialog.test.tsx` — abre com `'1.234,56'` pré-preenchido; ao confirmar envia `amount: '1234.56'`; botão desabilitado enquanto envia (Review Focus 3). `SendDocuments.test.tsx` — pedido recusado mostra o motivo em vermelho; "Nada a enviar" chama `POST .../not-applicable`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run src/components/portal/MarkPaidDialog.test.tsx src/pages/portal/SendDocuments.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** testes + `tsc` web — Expected: PASS. QA visual: screenshots claro/escuro em 1440px e 375px de Início, Documentos recebidos, detalhe com o diálogo aberto e Enviar documentos.
- [ ] **Step 5: Commit** `feat(portal): novo portal centrado em documentos`

### Task 11: E2E seed, documentação e verificação final

**Files:**
- Modify: `apps/api/prisma/e2e-seed.ts` (cliente E2E com uma guia DAS paga-pendente e um pedido mensal), `docs/SPEC.md` (endpoints novos), `docs/TASKS.md` (marcar Fase A), `docs/tech-debt.md` (se algo ficar de fora)
- Test: suítes completas

- [ ] **Step 1: Run** `pnpm --filter api test` e `pnpm --filter web test` e `tsc` dos dois — Expected: tudo verde.
- [ ] **Step 2: Update** seed e docs conforme o que foi entregue (endpoints, regras de pagamento/cancelamento/substituição, variável `paymentInfo`).
- [ ] **Step 3: Run** `pnpm --filter api exec tsx prisma/e2e-seed.ts` contra o banco local — Expected: sem erro.
- [ ] **Step 4: Commit** `docs: portal do cliente centrado em documentos (Fase A)`
