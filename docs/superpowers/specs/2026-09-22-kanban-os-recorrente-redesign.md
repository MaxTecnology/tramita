# Kanban Dinâmico (Recorrente) + Templates de OS — Design

## Contexto

Surgiu de um bug real: vincular um Template de Tarefa Recorrente a um cliente exigia escolher um
Processo (Board) e uma Coluna — se o cliente não tinha nenhum board criado, o fluxo travava
(dropdown vazio, botão nunca habilitava). Investigando a causa raiz, ficou claro que o modelo atual
tem dois problemas mais profundos:

1. **Toda tarefa depende de um Board/Coluna manualmente criado**, mesmo quando ela é gerada
   automaticamente (recorrência) ou quando o "processo" é na real uma solicitação do cliente que já
   tem um formato conhecido (abertura de empresa, alteração contratual, etc.).
2. **Coluna e status divergem silenciosamente.** Hoje `Column.isFinal` só sabe "essa é a coluna
   final" — mover uma tarefa `BLOCKED`/`DISREGARDED` entre colunas não-finais reseta o status pra
   `OPEN` sem avisar ninguém (`tasks.service.ts::moveTask`).

Esse documento formaliza o redesenho decidido em brainstorming (duas sessões, com validação visual
de 3 estilos de Kanban) pra resolver os dois problemas de uma vez, cobrindo dois fluxos de trabalho
que hoje são forçados a usar o mesmo modelo genérico de Board:

- **Recorrente** — tarefas geradas por `RecurringTaskTemplate`. Kanban **dinâmico**: sem board
  físico visível, colunas = os status direto, filtrado por empresa + tipo de tarefa.
- **OS (Ordem de Serviço)** — trabalho ad-hoc e solicitações do cliente. Continua com board físico
  por instância, mas a estrutura de colunas vem de um **Template de OS** reutilizável (fases livres
  intercaladas com âncoras de status), com notificação e documentos configuráveis por coluna.

## Fora de escopo desta spec

- Redesenho da tela de Configurações → Notificações (o motor de eventos/canais já existe e é
  reaproveitado como está — só ganha um novo ponto de disparo por coluna).
- Qualquer mudança em `ClientUserAccess`/departamento (feature já entregue, ortogonal a esta).
- Migração de dado real — ambiente ainda é só de teste, sem necessidade de backfill.

## 1. Status novo: `STARTED`

```prisma
enum TaskStatus {
  OPEN
  STARTED   // novo — "Iniciado": alguém já começou a trabalhar, visibilidade pra gerência
  DONE
  DISREGARDED
  BLOCKED
}
```

Sem mudança de comportamento em nada que já lê `TaskStatus` além de aceitar o novo valor — filtros
de dashboard/portal que hoje tratam "tudo que não é DONE/DISREGARDED como pendente" continuam
funcionando (checar `dashboard.service.ts` e o portal na hora de implementar, mas nenhum deles deveria
excluir `STARTED` explicitamente já que ele é conceitualmente "ainda aberto, só que em andamento").

## 2. Coluna ganha `statusEffect` (substitui `isFinal`)

```prisma
enum ColumnStatusEffect {
  NONE          // coluna livre — só organiza, nunca muda o status da tarefa (era o padrão implícito de isFinal=false)
  OPEN
  STARTED
  BLOCKED
  DISREGARDED
  DONE
}

model Column {
  // ...campos existentes, remove isFinal
  statusEffect ColumnStatusEffect @default(NONE)
}
```

**Migração:** coluna com `isFinal: true` vira `statusEffect: DONE`; `isFinal: false` vira `NONE` —
preserva o comportamento atual (mover pra coluna final = concluído) sem quebrar nenhum board
existente, e já habilita configurar colunas de status intermediário em boards novos.

**`moveTask` (tasks.service.ts) muda de:**
```ts
status: toColumn.isFinal ? 'DONE' : 'OPEN'
```
**para:**
```ts
status: toColumn.statusEffect !== 'NONE' ? toColumn.statusEffect : task.status
```
Ou seja: só mexe no status se a coluna de destino for uma âncora explícita; uma coluna `NONE`
(fase livre) nunca mais reseta um status que já era `BLOCKED`/`DISREGARDED`/`STARTED`. Isso sozinho
já corrige o bug relatado, independente do resto desta spec.

## 3. Código do cliente

```prisma
model Client {
  // ...
  codigo String?
  // ...
}
```

Texto livre (não numérico — precisa aceitar `320`, `320-02`, `320-03` pra matriz/filial). Único por
organização quando preenchido (`@@unique([codigo, organizationId])` — Postgres trata `NULL` como
distinto em índice único, então múltiplos clientes sem código continuam permitidos). Exibido como
`"{codigo} - {name}"` em toda lista/seleção: `Clients.tsx`, seletor de cliente em boards/filtros,
`TaskCard`, a nova tela Tarefas. Quando `codigo` é nulo, cai pra exibir só o `name` (não quebra
cliente sem código ainda cadastrado).

## 4. Recorrente: Kanban dinâmico, sem board visível

### 4.1 `RecurringTaskAssignment` simplifica

```prisma
model RecurringTaskAssignment {
  id         String   @id @default(cuid())
  templateId String
  clientId   String
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())

  template RecurringTaskTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  client   Client                @relation(fields: [clientId], references: [id], onDelete: Cascade)

  @@unique([templateId, clientId])
  @@map("recurring_task_assignments")
}
```

`boardId`/`columnId` saem do modelo. "Vincular cliente" na tela de Tarefas Recorrentes (o dialog que
motivou esse redesenho) vira **só escolher a empresa** — sem Processo, sem Coluna. Isso mata o bug
original de vez.

### 4.2 Decisão técnica: board "invisível" por trás, pra não quebrar o escopo por departamento

**Importante — isto é uma decisão de implementação, não um requisito de produto.** `Task.columnId`
continua **obrigatório** no schema. O motivo: toda a lógica de escopo por cliente/departamento
entregue na feature anterior (`comments.service.ts`, `attachments.service.ts`,
`task-documents.service.ts`, `portal.routes.ts`, `notification.worker.ts` — praticamente tudo que
checa "esse `ClientUser` pode ver essa tarefa?") resolve a empresa da tarefa via
`task.column.board.clientId`. Tornar `columnId` opcional exigiria refatorar essa cadeia inteira só
pra remover uma coluna que o usuário nunca vê — risco alto, ganho zero pra quem usa o sistema.

Em vez disso, `Board` ganha um `type`:

```prisma
enum BoardType {
  OS               // board tradicional, visível nas telas de Processo/OS
  RECURRING_SYSTEM // um por cliente, nunca aparece em nenhuma UI, existe só pra satisfazer a FK
}

model Board {
  // ...campos existentes
  type       BoardType @default(OS)
  osTemplateId String?
  osTemplate   OSTemplate? @relation(fields: [osTemplateId], references: [id])
}
```

Ao criar a primeira `RecurringTaskAssignment` de um cliente (ou lazy na primeira geração de tarefa,
tanto faz), o backend garante (find-or-create) um `Board { type: RECURRING_SYSTEM, clientId }` com
uma única `Column { statusEffect: NONE }` pra esse cliente, e usa essa coluna como `columnId` de toda
tarefa recorrente gerada pra ele. **Toda rota que lista boards pro usuário (`GET /boards`,
Processos, OS) filtra `type: OS` explicitamente — o board de sistema nunca aparece.** O Kanban
dinâmico da seção 4.3 ignora completamente esse board/coluna — ele lê e escreve só via `status`.

### 4.3 Endpoint e UI

`GET /tasks` (novo — hoje só existe `POST/PATCH/DELETE` por tarefa individual, sem listagem própria)
com filtros de query: `clientId?`, `assigneeId?`, `departmentId?`, `status?`, `recurringTemplateId?`
(pra "todas as folhas de pagamento" — já existe como campo em `Task`, não precisa de campo novo),
`dateFrom?`/`dateTo?` (sobre `targetDate`), `q?` (busca por título). Escopado por
`organizationId`/`role` do jeito que `GET /boards` já é hoje (ORG_MEMBER só vê o que é responsável,
CLIENT passa por `getClientAccessScope`).

Resposta: lista de tarefas com `client`, `department`, `assignee`, `status`, `targetDate`,
`recurringTemplateId` — o suficiente pra montar tanto a visão Lista quanto a visão Kanban no
frontend sem round-trip extra.

Arrastar um card no modo Kanban = `PATCH /tasks/:id { status }` direto — não é `moveTask` (não
existe coluna real envolvida aqui).

## 5. OS: Templates + board por instância

### 5.1 `OSTemplate`

```prisma
model OSTemplate {
  id             String   @id @default(cuid())
  organizationId String
  name           String   // "Abertura de Empresa", "Alteração Contratual"
  description    String?
  isActive       Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  columns      OSTemplateColumn[]
  requests     Request[]
  boards       Board[]

  @@map("os_templates")
}

model OSTemplateColumn {
  id            String             @id @default(cuid())
  templateId    String
  title         String
  position      Int
  statusEffect  ColumnStatusEffect @default(NONE)
  notifyClient  Boolean            @default(false)

  template  OSTemplate               @relation(fields: [templateId], references: [id], onDelete: Cascade)
  documents OSTemplateColumnDocument[]

  @@map("os_template_columns")
}

model OSTemplateColumnDocument {
  id       String @id @default(cuid())
  columnId String
  name     String
  position Int

  column OSTemplateColumn @relation(fields: [columnId], references: [id], onDelete: Cascade)

  @@map("os_template_column_documents")
}
```

Tela nova `/app/settings/os-templates` — mesmo padrão de UI de Tarefas Recorrentes (lista + página
de formulário dedicada, não modal): nome do template, e um repetidor de colunas onde cada uma define
título, se é `Fase` (statusEffect `NONE`) ou âncora de um status específico, se notifica o cliente ao
entrar ali, e a lista de documentos a cobrar naquela fase.

### 5.2 `Column` ganha os mesmos dois campos extras que o template tem

```prisma
model Column {
  // ...título, position, statusEffect (seção 2)
  notifyClient Boolean @default(false)
  documents    ColumnDocument[]
}

model ColumnDocument {
  id       String @id @default(cuid())
  columnId String
  name     String
  position Int

  column Column @relation(fields: [columnId], references: [id], onDelete: Cascade)

  @@map("column_documents")
}
```

Ao criar um board a partir de um `OSTemplate`, cada `OSTemplateColumn` (+ seus
`OSTemplateColumnDocument`) é copiado 1:1 pra `Column`/`ColumnDocument` reais daquele board
específico — copiar, não referenciar, porque o board pode divergir do template depois (adicionar uma
coluna extra só pra aquele cliente, por exemplo) sem afetar outros boards já criados do mesmo
template — mesmo princípio já usado hoje pros documentos de Tarefa Recorrente.

Quando uma tarefa entra numa coluna com `notifyClient: true`, dispara o evento de notificação
reaproveitando o motor existente (`notification.worker.ts`/`NotificationConfig`) — não é um evento
novo no enum `NotificationEvent`, é o `TASK_MOVED` já existente, só que o worker passa a checar
`toColumn.notifyClient` além do `config.taskMoved` global (hoje o worker não olha pra coluna
nenhuma). Quando a tarefa entra numa coluna com `ColumnDocument[]` não-vazio, o sistema cria
automaticamente os `TaskDocumentRequirement` correspondentes (pulando qualquer nome que já exista
pra essa tarefa, pra não duplicar se ela passar pela mesma coluna duas vezes).

### 5.3 `Request` ganha o tipo de solicitação

```prisma
model Request {
  // ...campos existentes
  osTemplateId String?
  osTemplate   OSTemplate? @relation(fields: [osTemplateId], references: [id])
}
```

Opcional — mantém compatibilidade com o fluxo de texto livre de hoje. No portal, o formulário de
nova solicitação (`portal/Requests.tsx`) ganha um seletor "Tipo de solicitação" (lista os
`OSTemplate` ativos da org) + uma opção "Outro" que mantém o campo de título livre como já funciona.

Em `approveRequest` (`requests.service.ts`): se `request.osTemplateId` estiver setado, o fluxo
`NEW_BOARD` passa a criar o board com `type: OS`, `osTemplateId`, título
`"{client.codigo} - {client.name} — {osTemplate.name}"`, e as colunas copiadas do template (seção
5.2) — em vez das 3 colunas genéricas padrão (`Pendente/Em andamento/Concluído`) que `createBoard`
usa hoje. O fluxo `EXISTING_BOARD` (anexar numa OS que já existe) continua igual, sem mudança.

## 6. Lista de OS

Tela nova `/app/os` (ou nome equivalente) — lista de `Board { type: OS }`, filtrável por cliente,
responsável, template, ativo/inativo. Cada linha mostra cliente (`codigo - name`), nome do template
(ou "Sem template" se foi criado manualmente), responsável, contagem de tarefas abertas/total. Clicar
abre o Kanban daquela OS específica — reaproveita a tela de Board existente (`Board.tsx`), sem
mudança nela além de já saber renderizar a badge de status por coluna (`statusEffect`) se fizer
sentido visualmente.

## 7. Tela "Tarefas" (lista + Kanban unificados)

Item novo no menu, separado de Processos/OS. Um toggle Lista ↔ Kanban no topo, mesmos filtros pros
dois modos (cliente, colaborador, departamento, tipo de tarefa via `recurringTemplateId`, status,
intervalo de data, busca por título) — consome o `GET /tasks` da seção 4.3.

- **Modo Lista**: tabela flat, clique numa linha abre o painel de detalhe lateral reaproveitando
  `TaskDrawer`/`Comments` (já existem, usados hoje em `Board.tsx`).
- **Modo Kanban**: agrupa o resultado filtrado por `status` (as mesmas 5 colunas fixas do Kanban
  dinâmico da seção 4.3) — funciona tanto pra ver só recorrentes de um cliente quanto pra ver "todas
  as folhas de pagamento de todos os clientes" de uma vez, que foi o caso de uso que motivou a ideia.

## Resumo das migrações necessárias

1. `TaskStatus` ganha `STARTED`.
2. `Column`: `isFinal` → `statusEffect` (+ backfill `true→DONE`, `false→NONE`), mais `notifyClient`
   e a tabela nova `ColumnDocument`.
3. `Client` ganha `codigo` (+ índice único condicional por org).
4. `RecurringTaskAssignment` perde `boardId`/`columnId`.
5. `Board` ganha `type` (default `OS`, sem quebrar boards existentes) e `osTemplateId`.
6. Tabelas novas: `OSTemplate`, `OSTemplateColumn`, `OSTemplateColumnDocument`.
7. `Request` ganha `osTemplateId`.

Sem necessidade de backfill de dado real (ambiente só de teste, confirmado com o usuário).
