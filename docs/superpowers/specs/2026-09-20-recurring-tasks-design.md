# Tarefas Recorrentes + Status Expandido + Checklist de Documentos — Design

## Objetivo

Item 2b do roadmap (`docs/TASKS.md`, Fase 10): motor que gera tarefas automaticamente em periodicidade configurável (semanal/mensal/trimestral/anual), com um modelo de status que reflete a realidade do escritório contábil (nem toda tarefa "não concluída" está em aberto — pode ter sido desconsiderada naquele período, ou estar travada esperando algo do cliente), e um checklist de documentos exigidos por tarefa, com upload do cliente e validação do colaborador.

Depende de 2a (Departamentos + responsabilidade por cliente), já concluído — todo template de recorrência é escopado a um departamento, e as tarefas geradas herdam o roteamento de notificação por departamento que 2a já implementou.

Ficam fora desta spec (specs futuras que **consomem** o que é construído aqui):
- **2c** — visão em lista cross-cliente com filtros (ex: "Folha de pagamento de todos os clientes de fevereiro"). Esta spec entrega os campos e índices que a 2c vai filtrar (`competence`, `dueDate`, `targetDate`), e um filtro básico dentro do board de um cliente — a visão cross-cliente agregada é 2c.
- **2d** — calendário mensal.
- **2e** — sinalização visual de "impedimento" especificamente no portal do cliente (além do status já existir e ser visível).

## Contexto — o que já existe

- **`Task.status`** (`apps/api/prisma/schema.prisma:257`) é um enum `TaskStatus` com 5 valores (`OPEN`, `IN_PROGRESS`, `REVIEW`, `DONE`, `CANCELLED`), mas só `OPEN`/`DONE` são efetivamente escritos por algum código hoje — `tasks.service.ts` `moveTask` seta `status: toColumn.isFinal ? 'DONE' : 'OPEN'` ao mover a tarefa de coluna. `IN_PROGRESS`/`REVIEW` aparecem em métricas do dashboard (`dashboard.service.ts`) mas nunca são escritos em nenhuma rota — enum morto na prática.
- **`TaskHistory`** e **`Comment`** (`schema.prisma:299-343`) já existem e já cobrem "trilha de auditoria" e "interação cliente↔colaborador" em qualquer `Task` — nada novo precisa ser criado pra isso, tarefas recorrentes herdam de graça por serem `Task`s normais. `updateTask` hoje só grava `TaskHistory` quando `priority`/`assigneeId` mudam (não quando `status` muda) — gap que esta spec fecha.
- **`Attachment`** (`schema.prisma:345`) já suporta upload por cliente ou colaborador (`uploadedBy`/`uploadedByClient`), já está ligado ao pipeline B2 existente (`src/lib/b2.ts`) — o checklist de documentos reaproveita esse model via FK, não cria upload paralelo.
- **Padrão de cron já existe**: `apps/api/src/workers/duedate.cron.ts` usa uma `Queue` BullMQ com `repeat: { every: ... }` + um `Worker` que roda a checagem — o motor de geração de recorrência replica esse padrão, não introduz uma dependência nova (sem node-cron, sem infra adicional).
- **`Board`/`Column`**: um cliente pode ter vários boards (processos), sem um board "padrão" — não há convenção hoje de qual board recebe o quê. Isso importa pro desenho do vínculo template↔cliente abaixo.

## Modelo de dados

### `TaskStatus` — substituído

```prisma
enum TaskStatus {
  OPEN            // Aberto
  DONE            // Concluído
  DISREGARDED     // Desconsiderado — não se aplica esse período, série continua no próximo
  BLOCKED         // Com Impedimento — travada esperando algo do cliente (ex: documento pendente/rejeitado)
}
```

Remove `IN_PROGRESS`/`REVIEW`/`CANCELLED` (nunca escritos por nenhuma rota hoje — enum morto, não vale carregar). `moveTask` continua setando `DONE`/`OPEN` por coluna final, sem mudança de comportamento aí. `DISREGARDED`/`BLOCKED` só são setados via `PATCH /tasks/:id` (manual) ou automaticamente pela regra do checklist (`BLOCKED`, ver abaixo) — nunca por movimentação de coluna.

**Migração de dados**: nenhuma linha existente usa `IN_PROGRESS`/`REVIEW`/`CANCELLED` hoje (confirmado: só `OPEN`/`DONE` são escritos por código) — trocar o enum não precisa de backfill.

### `Task` — campos novos

```prisma
model Task {
  // ...campos existentes...
  competence        DateTime?   // primeiro dia do período de referência (ex: 2026-02-01 = competência fevereiro)
  targetDate         DateTime?   // "meta" interna — pode ser antes do vencimento legal
  recurringTemplateId String?     // rastreabilidade — de qual template essa tarefa nasceu (null = manual)

  recurringTemplate RecurringTaskTemplate? @relation(fields: [recurringTemplateId], references: [id])

  @@index([competence])
  @@index([targetDate])
}
```

`dueDate` já existe — passa a ser preenchido automaticamente em tarefas geradas (calculado a partir do template), mas continua editável manualmente em qualquer tarefa, igual hoje.

### `RecurringTaskTemplate` — novo

```prisma
model RecurringTaskTemplate {
  id                   String     @id @default(cuid())
  organizationId       String
  departmentId         String
  title                String
  description          String?
  periodicity          RecurrencePeriodicity
  dueDayOfPeriod       Int        // dia do vencimento legal dentro do período (1-31)
  dueMonthOffset       Int        @default(0)  // 0 = vence no mesmo mês/período da competência, 1 = vence no seguinte, etc.
  targetOffsetDays     Int        @default(0)  // meta = dueDate + esse offset (negativo = antes do vencimento)
  generationDayOfPeriod Int       // dia em que o sistema gera a tarefa do PRÓXIMO período, com antecedência
  isActive             Boolean    @default(true)
  createdAt            DateTime   @default(now())
  updatedAt            DateTime   @updatedAt

  organization Organization                   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  department   Department                     @relation(fields: [departmentId], references: [id])
  documents    RecurringTaskTemplateDocument[]
  assignments  RecurringTaskAssignment[]
  tasks        Task[]
  generationLogs RecurringGenerationLog[]

  @@map("recurring_task_templates")
}

enum RecurrencePeriodicity {
  WEEKLY
  MONTHLY
  QUARTERLY
  ANNUAL
}
```

### `RecurringTaskTemplateDocument` — novo

```prisma
model RecurringTaskTemplateDocument {
  id         String @id @default(cuid())
  templateId String
  name       String   // ex: "Folha de ponto", "Extrato bancário"
  position   Int

  template RecurringTaskTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@map("recurring_task_template_documents")
}
```

Lista de documentos exigidos, definida uma vez no template — cada tarefa gerada a partir dele recebe uma cópia (`TaskDocumentRequirement`) dessa lista no momento da geração (não uma referência viva — se o template mudar depois, tarefas já geradas mantêm a lista de quando foram criadas).

### `RecurringTaskAssignment` — novo (vínculo cliente↔template)

```prisma
model RecurringTaskAssignment {
  id         String   @id @default(cuid())
  templateId String
  clientId   String
  boardId    String
  columnId   String
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())

  template RecurringTaskTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  client   Client                 @relation(fields: [clientId], references: [id], onDelete: Cascade)
  board    Board                  @relation(fields: [boardId], references: [id], onDelete: Cascade)
  column   Column                 @relation(fields: [columnId], references: [id], onDelete: Cascade)

  @@unique([templateId, clientId])
  @@map("recurring_task_assignments")
}
```

Escritório escolhe explicitamente, por cliente, em qual board/coluna as tarefas daquele template devem nascer (decisão tomada durante o brainstorming: sem board "padrão" automático). `isActive: false` pausa a geração pra aquele cliente sem apagar o vínculo (histórico de tarefas já geradas continua intacto).

### `RecurringGenerationLog` — novo (idempotência + auditoria + alerta)

```prisma
model RecurringGenerationLog {
  id           String   @id @default(cuid())
  templateId   String
  clientId     String
  competence   DateTime
  status       GenerationStatus
  taskId       String?          // preenchido em SUCCESS
  errorMessage String?          // preenchido em FAILED
  createdAt    DateTime @default(now())

  template RecurringTaskTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@unique([templateId, clientId, competence])
  @@map("recurring_generation_logs")
}

enum GenerationStatus {
  SUCCESS
  FAILED
}
```

A constraint única `[templateId, clientId, competence]` é a garantia de idempotência **em nível de banco** — nem uma corrida entre execuções do cron nem um duplo-disparo manual conseguem gerar a mesma competência duas vezes pro mesmo cliente. Ver seção "Motor de geração" pra como isso é usado.

### `TaskDocumentRequirement` — novo (checklist por tarefa)

```prisma
model TaskDocumentRequirement {
  id             String     @id @default(cuid())
  taskId         String
  name           String
  status         DocumentRequirementStatus @default(PENDING)
  attachmentId   String?    @unique
  rejectionReason String?
  reviewedById   String?
  reviewedAt     DateTime?
  position       Int
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  task       Task        @relation(fields: [taskId], references: [id], onDelete: Cascade)
  attachment Attachment? @relation(fields: [attachmentId], references: [id])
  reviewedBy User?       @relation(fields: [reviewedById], references: [id])

  @@map("task_document_requirements")
}

enum DocumentRequirementStatus {
  PENDING    // aguardando upload do cliente
  UPLOADED   // cliente subiu, aguardando validação do colaborador
  APPROVED
  REJECTED
}
```

Disponível em **qualquer** `Task` (decisão do brainstorming) — tarefa recorrente nasce com os itens pré-preenchidos a partir de `RecurringTaskTemplateDocument`; tarefa manual ou vinda de Solicitação permite o colaborador adicionar itens ad-hoc pelo mesmo model (sem `template` de origem, só sem popular automaticamente).

## Motor de geração

### Cron (worker, mesmo padrão de `duedate.cron.ts`)

Roda diariamente. Pra cada `RecurringTaskTemplate` ativo cujo `generationDayOfPeriod` bate com o dia corrente (considerando a periodicidade — mensal checa dia do mês, semanal checa dia da semana, trimestral/anual checam dia dentro do mês de referência do período), calcula a próxima `competence` e itera cada `RecurringTaskAssignment` ativo daquele template:

1. Calcula `dueDate` = `competence` + `dueMonthOffset` meses, no dia `dueDayOfPeriod`.
2. Calcula `targetDate` = `dueDate` + `targetOffsetDays` dias.
3. Numa única transação (`$transaction`): cria a `Task` (status `OPEN`, `columnId`/`boardId` do assignment, `departmentId` do template, `competence`/`dueDate`/`targetDate` calculados, `recurringTemplateId`), cria os `TaskDocumentRequirement` a partir de `RecurringTaskTemplateDocument`, cria a entrada inicial em `TaskHistory` (`action: 'created'`), e grava `RecurringGenerationLog` com `status: SUCCESS` + `taskId`.
4. Se qualquer passo falhar (incluindo a constraint única do log pegando uma geração duplicada), a transação inteira reverte — nunca fica tarefa "pela metade" sem checklist ou sem log. O erro é capturado **por assignment** (try/catch no loop, não no cron inteiro): grava `RecurringGenerationLog` com `status: FAILED` + `errorMessage`, dispara `enqueueNotification` (evento novo `RECURRING_GENERATION_FAILED`) pro `ORG_ADMIN` do escritório, e o cron **continua pros próximos assignments** — uma falha isolada não trava o lote.

### Geração manual

`POST /recurring-templates/:id/assignments/:assignmentId/generate` — dispara a mesma lógica do passo acima, sob demanda, pra um assignment específico. Usado quando um cliente novo entra depois do dia de geração e precisa da tarefa do período atual/seguinte imediatamente. Mesmo idempotente: se já existe log `SUCCESS` pra essa `(templateId, clientId, competence)`, retorna 409 em vez de duplicar; se existe um log `FAILED`, permite reprocessar (novo registro de log pra mesma chave é bloqueado pela unique constraint — o reprocessamento **atualiza** o log existente em vez de inserir um novo).

### Regra de status automático (checklist → `BLOCKED`)

Sempre que um `TaskDocumentRequirement` muda de status (`PATCH /tasks/:id/documents/:reqId`), a service recalcula: se **qualquer** item da tarefa está `PENDING` ou `REJECTED`, força `Task.status = BLOCKED` (se ainda não estiver); se **todos** os itens estão `APPROVED`, e o status atual é `BLOCKED`, volta pra `OPEN` automaticamente. Cada uma dessas transições grava uma entrada em `TaskHistory` (`action: 'status_changed'`), igual qualquer outra mudança de status. Rejeição de documento também dispara `enqueueNotification` pro cliente (evento `DOCUMENT_REJECTED`), reaproveitando os canais WhatsApp/email já configurados.

## Mudanças de API

### Novo módulo `recurring-templates` (`apps/api/src/modules/recurring-templates/`)

Estrutura padrão do projeto:
- `recurring-templates.routes.ts` — `GET/POST /recurring-templates`, `PATCH/DELETE /recurring-templates/:id` (inclui a lista de `documents` no payload de criar/editar — substitui a lista inteira, mesmo padrão simples de outros CRUDs do projeto); `GET/POST /recurring-templates/:id/assignments`, `PATCH/DELETE /recurring-templates/:id/assignments/:assignmentId`; `POST /recurring-templates/:id/assignments/:assignmentId/generate`; `GET /recurring-templates/:id/generation-log`. Todas com `preHandler: [verifyJWT, verifyOrg, requireRole(['ORG_ADMIN'])]` pra mutação, `ORG_ADMIN`+`ORG_MANAGER` pra leitura — mesmo padrão de `departments.routes.ts`.
- `recurring-templates.service.ts` — cálculo de `dueDate`/`targetDate`/próxima `competence`; a lógica do motor de geração descrita acima; validação de `departmentId`/`clientId`/`boardId`/`columnId` pertencerem à organização (mesmo padrão `assertDepartmentBelongsToOrg` criado no fix wave de 2a).
- `recurring-templates.schema.ts` — Zod pros payloads acima.

### `tasks` — estendido

- `PATCH /tasks/:id`: `status` passa a aceitar os 4 novos valores; `updateTask` passa a gravar `TaskHistory` (`action: 'status_changed'`) quando `status` muda (gap identificado no brainstorming, fechado aqui).
- Novo: `GET /tasks/:id/documents`, `POST /tasks/:id/documents` (colaborador adiciona item ad-hoc), `PATCH /tasks/:id/documents/:reqId` (aprova/rejeita — 422 se ainda `PENDING`, 422 se `REJECTED` sem `rejectionReason`).
- Filtros de listagem (board/lista existente) passam a aceitar `competence`/`dueDateFrom`/`dueDateTo`/`targetDateFrom`/`targetDateTo`.

### `portal` — estendido

- `GET /portal/tasks/:id/documents` — cliente vê nome + status de cada item (sem `rejectionReason` de outros itens que não sejam os dele... na verdade todos os itens são da mesma tarefa/cliente, então mostra tudo, incluindo `rejectionReason` pra ele saber o motivo).
- `POST /portal/tasks/:id/documents/:reqId/upload` — cliente sobe arquivo contra um item específico do checklist (reaproveita o pipeline de attachment/B2 existente); item vai de `PENDING` pra `UPLOADED`.

## Frontend

- **Nova página "Tarefas Recorrentes"** em Configurações (`apps/web/src/pages/app/settings/RecurringTemplates.tsx`): CRUD de template (com sub-formulário de lista de documentos exigidos), tela de vínculo cliente→board/coluna, e visualização do log de geração (com destaque visual pros `FAILED`, dado o requisito de confiabilidade).
- **`TaskDrawer.tsx`**: bloco de checklist de documentos (nome, badge de status, botão aprovar/rejeitar com campo de motivo); badge de status da tarefa atualizado pros 4 novos valores (`Aberto`=neutro, `Concluído`=verde, `Desconsiderado`=cinza, `Com Impedimento`=vermelho/laranja); campos de competência/vencimento/meta visíveis (editáveis manualmente também, não só em tarefas geradas).
- **Portal — detalhe da tarefa**: mesmo checklist em modo cliente (upload por item, sem aprovar/rejeitar, mostra motivo de rejeição quando houver). A sinalização visual mais chamativa desse impedimento no portal (destaque na lista/dashboard do cliente) fica pra 2e — aqui só garante que o dado existe e é visível no detalhe.
- **`Board.tsx`/`Processes.tsx`**: filtro por competência/vencimento/meta dentro do board de um cliente.

## Testes

Lógica crítica (requisito explícito do usuário: "não pode haver falha" na geração):
- Cálculo de `dueDate`/`targetDate`/próxima `competence` a partir das regras do template (todas as periodicidades).
- Idempotência: rodar a geração duas vezes pra o mesmo `(templateId, clientId, competence)` não cria segunda tarefa (testa a unique constraint sendo respeitada, não só a checagem de aplicação).
- Isolamento de falha: um assignment com `boardId`/`columnId` inválido falha e grava `FAILED` no log, sem impedir a geração dos demais assignments do mesmo lote.
- Transição automática de status via checklist: todos `APPROVED` → `OPEN`; qualquer `PENDING`/`REJECTED` → `BLOCKED`; e que isso gera `TaskHistory`.
- `updateTask` grava `TaskHistory` em mudança de status manual.
- Geração manual retorna 409 se já existe `SUCCESS` pra aquela competência; permite reprocessar um `FAILED`.
- Notificação `RECURRING_GENERATION_FAILED` e `DOCUMENT_REJECTED` disparadas nos momentos certos (via `vi.spyOn` no `enqueueNotification`, padrão já usado em 2a).

Sem teste novo pra CRUD de rotas simples, seguindo a política do projeto.

## Riscos e limitações conhecidas

- `RecurringTaskTemplateDocument` é copiado pra `TaskDocumentRequirement` no momento da geração (snapshot, não referência viva) — editar a lista de documentos do template não afeta tarefas já geradas. Isso é intencional (histórico estável), mas significa que corrigir um nome de documento errado no template não corrige tarefas antigas — só as futuras.
- `generationDayOfPeriod` pra periodicidade `QUARTERLY`/`ANNUAL` assume "dia dentro do mês de referência do período" (ex: trimestral gera no dia X do último mês antes do trimestre seguinte) — a regra exata de qual mês conta como "mês de referência" pra essas duas periodicidades fica pra detalhar na fase de plano de implementação, com exemplos concretos, já que não foi testada em conversa com um caso real trimestral/anual.
- Migração do enum `TaskStatus` (remover `IN_PROGRESS`/`REVIEW`/`CANCELLED`) exige atualizar `dashboard.service.ts`/`DashboardMetrics.tsx` (que hoje exibem contagem desses dois status nunca usados) e o filtro em `boards.schema.ts` — mudança mecânica, sem dado real pra migrar.
- `RecurringTaskAssignment` com `@@unique([templateId, clientId])` assume que um cliente só tem **um** vínculo por template (não dá pra ter o mesmo template gerando em dois boards diferentes pro mesmo cliente). Se isso for necessário no futuro, é uma migração de constraint, não coberta aqui.
