# Tarefas Recorrentes + Status Expandido + Checklist de Documentos — Design

## Objetivo

Item 2b do roadmap (`docs/TASKS.md`, Fase 10): motor que gera tarefas automaticamente em periodicidade configurável (semanal/mensal/trimestral/anual), com um modelo de status que reflete a realidade do escritório contábil (nem toda tarefa "não concluída" está em aberto — pode ter sido desconsiderada naquele período, ou estar travada esperando algo do cliente), e duas listas de "atividades" por tarefa — documentos a cobrar do cliente e documentos a entregar ao cliente — com validação e conclusão automática configurável. Desenho inspirado na tela de cadastro de tarefa recorrente do Gestta (referência visual trazida pelo usuário durante o brainstorming), adaptado ao que já existe no Tramita.

Depende de 2a (Departamentos + responsabilidade por cliente), já concluído — todo template de recorrência é escopado a um departamento, e as tarefas geradas herdam o roteamento de notificação por departamento que 2a já implementou.

Ficam fora desta spec (specs futuras que **consomem** o que é construído aqui):
- **2c** — visão em lista cross-cliente com filtros (ex: "Folha de pagamento de todos os clientes de fevereiro"). Esta spec entrega os campos e índices que a 2c vai filtrar (`competence`, `dueDate`, `targetDate`), e um filtro básico dentro do board de um cliente — a visão cross-cliente agregada é 2c.
- **2d** — calendário mensal.
- **2e** — sinalização visual de "impedimento" especificamente no portal do cliente (além do status já existir e ser visível).

Ficam fora **do produto por enquanto** (decisão explícita do usuário durante o brainstorming, campos que existem na referência do Gestta mas não entram agora):
- **Postergar** (adiar automaticamente).
- **Esfera** (Federal/Estadual/Municipal — categorização fiscal).
- **Pontuação** (gamificação/produtividade por tarefa) — só documentado aqui como decisão futura, **sem campo no schema agora**; faz mais sentido quando o item 4 do roadmap (métricas de produtividade) for especificado, porque depende de 2b+2c existirem primeiro pra ter o que medir.
- **Gerar multa** — o usuário descreveu como um "status mais rigoroso" que cobra o colaborador e exige que o cliente confirme recebimento da guia; é uma extensão de fluxo consistente com o que construímos aqui (mais um nível de rigor em cima do checklist), mas fica pra uma spec própria depois.
- **Agrupadores de tarefas** — o usuário descreveu como agrupar **clientes** (não tarefas) pra vincular templates de recorrência em lote, em vez de cliente por cliente. Fica pra depois; por enquanto `RecurringTaskAssignment` é sempre vinculado cliente a cliente (ver seção própria). O campo `tags` que `Task` já tem hoje cobre qualquer necessidade leve de organização enquanto isso não existe.

## Contexto — o que já existe

- **`Task.status`** (`apps/api/prisma/schema.prisma:257`) é um enum `TaskStatus` com 5 valores (`OPEN`, `IN_PROGRESS`, `REVIEW`, `DONE`, `CANCELLED`), mas só `OPEN`/`DONE` são efetivamente escritos por algum código hoje — `tasks.service.ts` `moveTask` seta `status: toColumn.isFinal ? 'DONE' : 'OPEN'` ao mover a tarefa de coluna. `IN_PROGRESS`/`REVIEW` aparecem em métricas do dashboard (`dashboard.service.ts`) mas nunca são escritos em nenhuma rota — enum morto na prática.
- **`TaskHistory`** e **`Comment`** (`schema.prisma:299-343`) já existem e já cobrem "trilha de auditoria" e "interação cliente↔colaborador" em qualquer `Task` — nada novo precisa ser criado pra isso, tarefas recorrentes herdam de graça por serem `Task`s normais. `updateTask` hoje só grava `TaskHistory` quando `priority`/`assigneeId` mudam (não quando `status` muda) — gap que esta spec fecha.
- **`Attachment`** (`schema.prisma:345`) já suporta upload por cliente ou colaborador (`uploadedBy`/`uploadedByClient`), já está ligado ao pipeline B2 existente (`src/lib/b2.ts`) — os dois checklists (cobrar/entregar documento) reaproveitam esse model via FK, não criam upload paralelo.
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

Remove `IN_PROGRESS`/`REVIEW`/`CANCELLED` (nunca escritos por nenhuma rota hoje — enum morto, não vale carregar). `moveTask` continua setando `DONE`/`OPEN` por coluna final, sem mudança de comportamento aí. `DISREGARDED` só é setado manualmente via `PATCH /tasks/:id`. `BLOCKED`/`DONE` também podem ser setados automaticamente pela regra de atividades (ver "Conclusão automática" abaixo) — nunca por movimentação de coluna.

**Migração de dados**: nenhuma linha existente usa `IN_PROGRESS`/`REVIEW`/`CANCELLED` hoje (confirmado: só `OPEN`/`DONE` são escritos por código) — trocar o enum não precisa de backfill.

### `Task` — campos novos

```prisma
model Task {
  // ...campos existentes...
  competence           DateTime?   // primeiro dia do período de referência (ex: 2026-02-01 = competência fevereiro)
  targetDate           DateTime?   // "meta" interna — pode ser antes do vencimento legal
  recurringTemplateId  String?     // rastreabilidade — de qual template essa tarefa nasceu (null = manual)
  visibleToClient      Boolean  @default(true)  // false = tarefa só de controle interno do escritório (ex: SPED), nunca aparece no portal

  recurringTemplate RecurringTaskTemplate? @relation(fields: [recurringTemplateId], references: [id])

  @@index([competence])
  @@index([targetDate])
}
```

`dueDate` já existe — passa a ser preenchido automaticamente em tarefas geradas (calculado a partir do template), mas continua editável manualmente em qualquer tarefa, igual hoje. `visibleToClient` nasce com o valor do template (`RecurringTaskTemplate.visibleToClient`) nas tarefas geradas, e com `true` por padrão em tarefas manuais — mas é editável por tarefa em qualquer caso (o escritório pode esconder uma tarefa pontual do cliente mesmo vinda de um template visível, ou o contrário).

### `RecurringTaskTemplate` — novo

```prisma
model RecurringTaskTemplate {
  id                    String   @id @default(cuid())
  organizationId        String
  departmentId          String
  title                 String
  description           String?
  periodicity           RecurrencePeriodicity

  // Vencimento legal, relativo ao início da competência
  dueMonthOffset        Int      @default(0)  // meses DEPOIS do início da competência (0 = mesmo mês/semana); ignorado em WEEKLY
  dueDayOfPeriod         Int                    // dia do mês (mensal/trimestral/anual) ou dia da semana 1-7 (semanal)
  dueRollToBusinessDay  Boolean  @default(false) // "Dia útil" do vencimento — se cair em fim de semana/feriado, empurra pro próximo dia útil

  // Meta interna
  targetOffsetDays        Int      @default(0)     // meta = vencimento + esses dias (negativo = antes)
  targetRollToBusinessDay Boolean  @default(false)  // "Dia útil" da meta, independente do vencimento

  // Geração antecipada — gatilho único
  generationMonthOffset Int      @default(1)  // meses ANTES do início da competência que a geração roda (mensal/trimestral/anual); ignorado em WEEKLY (sempre 1 semana antes)
  generationDayOfPeriod Int                    // dia do mês da geração (dentro do mês definido acima), ou dia da semana 1-7 (semanal)

  // Conclusão automática
  autoCompleteOnAllActivitiesDone Boolean @default(false) // liga/desliga: quando todas as atividades (documentos cobrados aprovados + documentos entregues) estiverem resolvidas, marca a tarefa como Concluído sozinho

  // Notificação ao cliente — canais independentes; os dois desligados = não notifica
  notifyViaWhatsapp Boolean @default(true)
  notifyViaEmail    Boolean @default(false)

  // Visibilidade no portal — default herdado por toda tarefa gerada (editável por tarefa, ver `Task.visibleToClient`)
  visibleToClient Boolean @default(true)

  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization       Organization                     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  department         Department                       @relation(fields: [departmentId], references: [id])
  documentRequests   RecurringTaskTemplateDocument[]   @relation("TemplateDocumentRequests")
  documentDeliveries RecurringTaskTemplateDocument[]   @relation("TemplateDocumentDeliveries")
  assignments        RecurringTaskAssignment[]
  tasks              Task[]
  generationLogs     RecurringGenerationLog[]

  @@map("recurring_task_templates")
}

enum RecurrencePeriodicity {
  WEEKLY
  MONTHLY
  QUARTERLY
  ANNUAL
}
```

**Sobre "Competência" como campo amigável**: no formulário (frontend), o escritório não vai digitar `dueMonthOffset`/`generationMonthOffset` como número cru — esses dois campos ficam por trás de um seletor amigável (ex: "Vence no mês seguinte à competência", "Gera 1 mês antes da competência começar"), no espírito do campo "Competência" com dropdown que aparece na referência do Gestta. As opções exatas do dropdown e o texto de cada uma ficam pra fase de plano de implementação (é decisão de UI, não de arquitetura) — o que importa pra esta spec é que o par `(monthOffset, dayOfPeriod)` é suficiente pra expressar qualquer uma dessas opções amigáveis, pras 4 periodicidades, sem caso especial por periodicidade (ver exemplos abaixo).

**Exemplo mensal** (o caso que o usuário descreveu): competência fevereiro, vence dia 15 de março, meta 2 dias antes, gera dia 20 de janeiro → `dueMonthOffset=1, dueDayOfPeriod=15, targetOffsetDays=-2, generationMonthOffset=1, generationDayOfPeriod=20`.

**Exemplo trimestral**: competência Q1 (jan-mar), vence dia 10 do 3º mês do trimestre (março), gera 1 mês antes do trimestre começar (dezembro) dia 20 → `dueMonthOffset=2, dueDayOfPeriod=10, generationMonthOffset=1, generationDayOfPeriod=20`. Mesma fórmula do mensal, sem caso especial.

**Exemplo semanal**: vencimento sempre dentro da própria semana da competência (`dueMonthOffset` ignorado, `dueDayOfPeriod` = dia da semana, ex: 5 = sexta); geração sempre exatamente 1 semana antes (`generationMonthOffset` ignorado — regra fixa "sempre a semana anterior"), `generationDayOfPeriod` = dia da semana em que o cron dispara a leva do mês. Decisão do brainstorming: **um único gatilho por template no dia configurado do mês** — quando esse dia bate, o motor gera de uma vez todas as ocorrências da periodicidade daquele template que caem dentro do próximo mês (pra semanal, isso normalmente é 4 ou 5 tarefas geradas na mesma execução; pra mensal, é 1; pra trimestral/anual, só gera quando o próximo mês inicia um novo trimestre/ano, senão essa execução não faz nada pra esse template). Ver "Motor de geração" abaixo.

### `RecurringTaskTemplateDocument` — novo (duas listas: cobrar do cliente / entregar ao cliente)

```prisma
model RecurringTaskTemplateDocument {
  id                    String @id @default(cuid())
  requestTemplateId     String?   // preenchido quando é item da lista "cobrar do cliente"
  deliveryTemplateId    String?   // preenchido quando é item da lista "entregar ao cliente" — exatamente um dos dois é não-nulo
  name                  String    // ex: "Folha de ponto" (cobrar) ou "Recibo de pagamento" (entregar)
  position              Int

  requestTemplate  RecurringTaskTemplate? @relation("TemplateDocumentRequests", fields: [requestTemplateId], references: [id], onDelete: Cascade)
  deliveryTemplate RecurringTaskTemplate? @relation("TemplateDocumentDeliveries", fields: [deliveryTemplateId], references: [id], onDelete: Cascade)

  @@map("recurring_task_template_documents")
}
```

Cada tarefa gerada recebe uma **cópia** dessas listas no momento da geração (`TaskDocumentRequirement`/`TaskDeliverable`, snapshot — não referência viva; editar o template depois não afeta tarefas já geradas, só as futuras).

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

Escritório escolhe explicitamente, por cliente, em qual board/coluna as tarefas daquele template devem nascer (decisão do brainstorming: sem board "padrão" automático). Um cliente só pode ter **um** vínculo por template (confirmado no brainstorming — "Folha de pagamento" só se atrela a um cliente 1 vez), mas o mesmo template é reutilizado por quantos clientes o escritório quiser, cada um com seu próprio vínculo. `isActive: false` pausa a geração pra aquele cliente sem apagar o vínculo (histórico de tarefas já geradas continua intacto).

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

### `TaskDocumentRequirement` — novo (documentos a cobrar do cliente)

```prisma
model TaskDocumentRequirement {
  id              String     @id @default(cuid())
  taskId          String
  name            String
  status          DocumentRequirementStatus @default(PENDING)
  attachmentId    String?    @unique
  rejectionReason String?
  reviewedById    String?
  reviewedAt      DateTime?
  position        Int
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

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

Fluxo: cliente sobe o arquivo no portal contra um item → `UPLOADED`; colaborador aprova (`APPROVED`) ou rejeita (`REJECTED` + `rejectionReason` obrigatório, dispara notificação pro cliente).

### `TaskDeliverable` — novo (documentos a entregar ao cliente)

```prisma
model TaskDeliverable {
  id           String    @id @default(cuid())
  taskId       String
  name         String    // ex: "Resumo da folha", "Recibo de pagamento"
  attachmentId String?   @unique
  deliveredById String?
  deliveredAt  DateTime?
  position     Int
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  task        Task        @relation(fields: [taskId], references: [id], onDelete: Cascade)
  attachment  Attachment? @relation(fields: [attachmentId], references: [id])
  deliveredBy User?       @relation(fields: [deliveredById], references: [id])

  @@map("task_deliverables")
}
```

Fluxo inverso do anterior: colaborador sobe o arquivo contra um item nomeado → fica disponível pro cliente ver/baixar no portal (`deliveredAt` preenchido). Sem ciclo de aprovação — o escritório controla o próprio produto, não precisa de validação externa.

Ambos (`TaskDocumentRequirement` e `TaskDeliverable`) ficam disponíveis em **qualquer** `Task` (decisão do brainstorming), não só nas geradas por recorrência — tarefa manual ou vinda de Solicitação permite o colaborador adicionar itens ad-hoc em qualquer uma das duas listas.

## Motor de geração

### Cron (worker, mesmo padrão de `duedate.cron.ts`)

Roda diariamente. Pra cada `RecurringTaskTemplate` ativo, verifica se o dia de hoje bate com `generationDayOfPeriod` (dia do mês pra mensal/trimestral/anual; dia da semana pra semanal, checado toda semana). Quando bate:

- **MONTHLY**: gera 1 tarefa, `competence` = 1º dia do mês seguinte.
- **WEEKLY**: gera uma tarefa pra **cada** semana (dia configurado) que cai dentro do mês seguinte inteiro — normalmente 4 ou 5 de uma vez.
- **QUARTERLY**: só gera (1 tarefa) se o mês seguinte for o primeiro mês de um novo trimestre (jan/abr/jul/out); nos outros meses, essa execução não faz nada pra esse template.
- **ANNUAL**: só gera (1 tarefa) se o mês seguinte for janeiro; nos outros 11 meses, não faz nada pra esse template.

Pra cada tarefa a gerar, itera cada `RecurringTaskAssignment` ativo do template:

1. Calcula `dueDate` = `competence` + `dueMonthOffset` meses, no dia `dueDayOfPeriod` (ajustado pro próximo dia útil se `dueRollToBusinessDay`).
2. Calcula `targetDate` = `dueDate` + `targetOffsetDays` dias (ajustado pro próximo dia útil se `targetRollToBusinessDay`, independente do ajuste do vencimento).
3. Numa única transação (`$transaction`): cria a `Task` (status `OPEN`, `columnId`/`boardId` do assignment, `departmentId` do template, `competence`/`dueDate`/`targetDate` calculados, `recurringTemplateId`, `visibleToClient` herdado do template), cria os `TaskDocumentRequirement`/`TaskDeliverable` a partir das listas do template, cria a entrada inicial em `TaskHistory` (`action: 'created'`), e grava `RecurringGenerationLog` com `status: SUCCESS` + `taskId`. Dispara notificação de criação da tarefa por WhatsApp se `notifyViaWhatsapp`, por e-mail se `notifyViaEmail` (os dois desligados = nenhuma notificação, sem depender de `visibleToClient` — uma tarefa pode notificar sem estar visível no portal, ou vice-versa, são decisões independentes).
4. Se qualquer passo falhar (incluindo a constraint única do log pegando uma geração duplicada), a transação inteira reverte — nunca fica tarefa "pela metade" sem checklist ou sem log. O erro é capturado **por assignment** (try/catch no loop, não no cron inteiro): grava `RecurringGenerationLog` com `status: FAILED` + `errorMessage`, dispara `enqueueNotification` (evento novo `RECURRING_GENERATION_FAILED`) pro `ORG_ADMIN` do escritório, e o cron **continua pros próximos assignments** — uma falha isolada não trava o lote.

### Geração manual

`POST /recurring-templates/:id/assignments/:assignmentId/generate` — dispara a mesma lógica do passo acima, sob demanda, pra um assignment específico. Usado quando um cliente novo entra depois do dia de geração e precisa da tarefa do período atual/seguinte imediatamente. Mesmo idempotente: se já existe log `SUCCESS` pra essa `(templateId, clientId, competence)`, retorna 409 em vez de duplicar; se existe um log `FAILED`, permite reprocessar (o reprocessamento **atualiza** o log existente em vez de inserir um novo, já que a unique constraint bloqueia um segundo insert pra mesma chave).

### Conclusão automática e impedimento

Sempre que um `TaskDocumentRequirement` ou `TaskDeliverable` muda (upload, aprovação, rejeição, entrega), a service recalcula o status da tarefa:

- **Impedimento (sempre automático, não depende de configuração)**: se qualquer `TaskDocumentRequirement` está `PENDING` ou `REJECTED`, força `Task.status = BLOCKED` (se ainda não estiver). Isso reflete a realidade — a tarefa está de fato travada esperando o cliente, independente de qualquer toggle.
- **Conclusão automática (opt-in por template, campo `autoCompleteOnAllActivitiesDone`)**: quando **todos** os `TaskDocumentRequirement` estão `APPROVED` **e** todos os `TaskDeliverable` têm `deliveredAt` preenchido, e o template tem `autoCompleteOnAllActivitiesDone = true`, a tarefa vira `DONE` sozinha. Se o toggle estiver desligado (padrão), o colaborador precisa marcar `Concluído` manualmente mesmo com tudo resolvido — dá o passo de revisão final pra quem preferir.

Toda transição automática de status grava uma entrada em `TaskHistory` (`action: 'status_changed'`), igual qualquer mudança manual. Rejeição de documento cobrado também dispara `enqueueNotification` pro cliente (evento `DOCUMENT_REJECTED`), reaproveitando os canais já configurados.

## Mudanças de API

### Novo módulo `recurring-templates` (`apps/api/src/modules/recurring-templates/`)

Estrutura padrão do projeto:
- `recurring-templates.routes.ts` — `GET/POST /recurring-templates`, `PATCH/DELETE /recurring-templates/:id` (inclui as duas listas de documentos — `documentRequests`/`documentDeliveries` — no payload de criar/editar, substituindo a lista inteira, mesmo padrão simples de outros CRUDs do projeto); `GET/POST /recurring-templates/:id/assignments`, `PATCH/DELETE /recurring-templates/:id/assignments/:assignmentId`; `POST /recurring-templates/:id/assignments/:assignmentId/generate`; `GET /recurring-templates/:id/generation-log`. Todas com `preHandler: [verifyJWT, verifyOrg, requireRole(['ORG_ADMIN'])]` pra mutação, `ORG_ADMIN`+`ORG_MANAGER` pra leitura — mesmo padrão de `departments.routes.ts`.
- `recurring-templates.service.ts` — cálculo de `dueDate`/`targetDate`/próxima `competence` (incluindo ajuste de dia útil); a lógica do motor de geração descrita acima; validação de `departmentId`/`clientId`/`boardId`/`columnId` pertencerem à organização (mesmo padrão `assertDepartmentBelongsToOrg` criado no fix wave de 2a).
- `recurring-templates.schema.ts` — Zod pros payloads acima.

### `tasks` — estendido

- `PATCH /tasks/:id`: `status` passa a aceitar os 4 novos valores; `updateTask` passa a gravar `TaskHistory` (`action: 'status_changed'`) quando `status` muda (gap identificado no brainstorming, fechado aqui).
- Novo: `GET /tasks/:id/documents` (retorna as duas listas — cobrança e entrega), `POST /tasks/:id/documents/requests` e `POST /tasks/:id/documents/deliveries` (colaborador adiciona item ad-hoc em cada lista), `PATCH /tasks/:id/documents/requests/:reqId` (aprova/rejeita — 422 se ainda `PENDING`, 422 se `REJECTED` sem `rejectionReason`), `POST /tasks/:id/documents/deliveries/:reqId/upload` (colaborador sobe o entregável).
- Filtros de listagem (board/lista existente) passam a aceitar `competence`/`dueDateFrom`/`dueDateTo`/`targetDateFrom`/`targetDateTo`.

### `portal` — estendido

- `GET /portal/tasks/:id/documents` — cliente vê as duas listas: o que precisa enviar (nome + status + motivo de rejeição quando houver) e o que já foi entregue a ele (nome + link de download quando `deliveredAt` preenchido).
- `POST /portal/tasks/:id/documents/requests/:reqId/upload` — cliente sobe arquivo contra um item específico da lista de cobrança (reaproveita o pipeline de attachment/B2 existente); item vai de `PENDING` pra `UPLOADED`.
- **Gate de visibilidade**: `boards.service.ts`'s `getBoardById` hoje não distingue por role — devolve todas as tasks de todas as colunas pra quem quer que chame, inclusive `CLIENT` (`boards.routes.ts:33-38`). Isso precisa mudar: quando o chamador é `CLIENT`, o include de `tasks` passa a filtrar `where: { visibleToClient: true }`. Mesma regra vale pra qualquer endpoint client-facing que devolve uma task individual por id (`GET /portal/tasks/:id/history`, os dois novos endpoints de documentos acima) — todos precisam checar `task.visibleToClient` e responder 404 (não 403, pra não revelar que a task existe) quando for `false` e o chamador for `CLIENT`.

## Frontend

- **Nova página "Tarefas Recorrentes"** em Configurações (`apps/web/src/pages/app/settings/RecurringTemplates.tsx`): CRUD de template — incluindo o seletor amigável de competência/vencimento/meta/geração (ver nota na seção de modelo de dados), os toggles de dia útil, conclusão automática, os dois toggles independentes de notificação (WhatsApp/e-mail — os dois desligados = não notifica, sem toggle mestre separado) e o toggle "O cliente pode ver esta tarefa" (default ligado; quando desligado, tarefas geradas por esse template nascem como controle interno, nunca aparecem no portal — caso de uso citado: SPED, que o escritório cadastra e trabalha sem o cliente nunca saber), e os dois sub-formulários de lista de documentos (cobrar/entregar) — tela de vínculo cliente→board/coluna, e visualização do log de geração (com destaque visual pros `FAILED`, dado o requisito de confiabilidade).
- **`TaskDrawer.tsx`**: mesmo toggle "O cliente pode ver esta tarefa" editável por tarefa individual (sobrescreve o default herdado do template); dois blocos de checklist (documentos a cobrar — nome, badge de status, botão aprovar/rejeitar com campo de motivo; documentos a entregar — nome, botão de upload do colaborador, indicação de entregue); badge de status da tarefa atualizado pros 4 novos valores (`Aberto`=neutro, `Concluído`=verde, `Desconsiderado`=cinza, `Com Impedimento`=vermelho/laranja); campos de competência/vencimento/meta visíveis (editáveis manualmente também, não só em tarefas geradas).
- **Portal — detalhe da tarefa**: os dois checklists em modo cliente (upload só na lista de cobrança, sem aprovar/rejeitar, mostra motivo de rejeição quando houver; lista de entrega só com link de download quando disponível). A sinalização visual mais chamativa desse impedimento no portal (destaque na lista/dashboard do cliente) fica pra 2e — aqui só garante que o dado existe e é visível no detalhe.
- **`Board.tsx`/`Processes.tsx`**: filtro por competência/vencimento/meta dentro do board de um cliente.

## Testes

Lógica crítica (requisito explícito do usuário: "não pode haver falha" na geração):
- Cálculo de `dueDate`/`targetDate`/próxima `competence` a partir das regras do template, incluindo ajuste de dia útil, pras 4 periodicidades (com foco especial no exemplo trimestral, já que é o caso que tinha ficado ambíguo antes de resolver a fórmula unificada).
- Idempotência: rodar a geração duas vezes pra o mesmo `(templateId, clientId, competence)` não cria segunda tarefa (testa a unique constraint sendo respeitada, não só a checagem de aplicação).
- Isolamento de falha: um assignment com `boardId`/`columnId` inválido falha e grava `FAILED` no log, sem impedir a geração dos demais assignments do mesmo lote.
- Regra de impedimento automático: qualquer `TaskDocumentRequirement` `PENDING`/`REJECTED` força `BLOCKED`, sempre (independente do toggle de conclusão automática).
- Regra de conclusão automática: só dispara com `autoCompleteOnAllActivitiesDone = true` e todos os itens (cobrança + entrega) resolvidos; com o toggle desligado, tudo resolvido não muda o status sozinho.
- `updateTask` grava `TaskHistory` em mudança de status manual e nas automáticas.
- Geração manual retorna 409 se já existe `SUCCESS` pra aquela competência; permite reprocessar um `FAILED`.
- Notificação `RECURRING_GENERATION_FAILED` e `DOCUMENT_REJECTED` disparadas nos momentos certos (via `vi.spyOn` no `enqueueNotification`, padrão já usado em 2a); com `notifyViaWhatsapp=false` e `notifyViaEmail=false`, a criação da tarefa não dispara nenhuma notificação.
- `getBoardById` (ou variante client-aware) filtra tasks com `visibleToClient: false` quando o chamador é `CLIENT`; endpoints client-facing de task individual (history, documentos) respondem 404 nesse caso, não 403.

Sem teste novo pra CRUD de rotas simples, seguindo a política do projeto.

## Riscos e limitações conhecidas

- Listas de documentos (`RecurringTaskTemplateDocument`) são copiadas pra `TaskDocumentRequirement`/`TaskDeliverable` no momento da geração (snapshot, não referência viva) — editar a lista do template depois não afeta tarefas já geradas. Intencional (histórico estável), mas corrigir um nome de documento errado no template não corrige tarefas antigas, só as futuras.
- Migração do enum `TaskStatus` (remover `IN_PROGRESS`/`REVIEW`/`CANCELLED`) exige atualizar `dashboard.service.ts`/`DashboardMetrics.tsx` (que hoje exibem contagem desses dois status nunca usados) e o filtro em `boards.schema.ts` — mudança mecânica, sem dado real pra migrar.
- `RecurringTaskAssignment` com `@@unique([templateId, clientId])` assume que um cliente só tem **um** vínculo por template — confirmado como aceitável no brainstorming. Se precisar de "agrupadores de cliente" pra vincular em lote (mencionado pelo usuário como necessidade futura), é uma feature nova por cima disso, não coberta aqui.
- Os campos adiados (Postergar, Esfera, Pontuação, Gerar multa, Agrupadores) estão documentados na seção "Objetivo" com o raciocínio de cada um — quando entrarem, a maioria encaixa como extensão aditiva do que já existe aqui (mais um campo/toggle no template, ou uma tabela nova), sem exigir redesenho do que está sendo construído em 2b.
