# Kanban Dinâmico (Recorrente) + Templates de OS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vincular uma Tarefa Recorrente a um cliente deixa de exigir Processo/Coluna manuais (Kanban
vira uma visão dinâmica agrupada por status). Ordens de Serviço passam a nascer a partir de
Templates reutilizáveis (fases + âncoras de status + notificação + documentos por coluna). Corrige
de quebra o bug de reset silencioso de status ao mover card entre colunas não-finais.

**Architecture:** `Column.isFinal` (booleano) vira `Column.statusEffect` (enum de 6 valores — `NONE`
+ os 5 status). `RecurringTaskAssignment` perde `boardId`/`columnId`; por trás dos panos, cada
cliente ganha um `Board { type: RECURRING_SYSTEM }` invisível com uma única coluna, só pra preservar
a cadeia `task.column.board.clientId` que toda a lógica de escopo por departamento já depende.
`OSTemplate`/`OSTemplateColumn` são o blueprint copiado pra `Column`/`ColumnDocument` reais quando
uma OS nasce (manual ou via aprovação de `Request`).

**Tech Stack:** Fastify v5 + Prisma v6 + Zod (API), React 19 + Vite + TailwindCSS + React Query
(frontend) — mesma stack do resto do projeto.

**Spec:** `docs/superpowers/specs/2026-09-22-kanban-os-recorrente-redesign.md`

## Global Constraints

- TypeScript `strict: true`, sem `any`, sem `as unknown`.
- Validação Zod em todo body/param de rota.
- Erros via `AppError(statusCode, message)`.
- Migrations escritas à mão (nunca confiar no diff automático do `prisma migrate dev` pra mudança de
  tipo/nullability), aplicadas via `pnpm --filter api migrate:deploy` no banco dev **e** teste antes
  de rodar qualquer teste.
- Ambiente é só de teste — nenhuma migration precisa de passo de backfill de dado real (confirmado
  com o usuário nas duas sessões de brainstorming).
- `Board { type: RECURRING_SYSTEM }` nunca aparece em nenhuma listagem visível pro usuário (Processos,
  OS, seletor de board) — toda rota que lista boards pro usuário filtra `type: OS` explicitamente.
- Tarefa a cada task deve terminar com `pnpm --filter api exec tsc --noEmit` + `pnpm --filter api test`
  e, quando tocar frontend, `pnpm --filter web exec tsc --noEmit` + `pnpm --filter web test`, todos
  verdes.

---

## Task 1: Schema foundation — status STARTED, Column.statusEffect, Client.codigo, Board.type, RecurringTaskAssignment simplificado

Task fundacional — como no redesenho anterior (client-users), essa é a única que precisa landar
atômica: os campos removidos/renomeados quebram código existente até tudo ser ajustado na mesma
tacada.

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260922100000_kanban_os_foundation/migration.sql`
- Modify: `apps/api/src/modules/tasks/tasks.service.ts`
- Modify: `apps/api/src/modules/tasks/tasks.schema.ts`
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.service.ts`
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.schema.ts`
- Modify: `apps/api/src/modules/boards/boards.service.ts`
- Modify: `apps/api/src/modules/dashboard/dashboard.service.ts`
- Modify: `apps/api/src/test/helpers.ts`
- Modify: todo arquivo de teste que cria `Column` passando `isFinal` ou `RecurringTaskAssignment`
  passando `boardId`/`columnId` (mecânico — grep na Step 8)

**Interfaces:**
- Produces: `ColumnStatusEffect` enum + `Column.statusEffect`/`notifyClient` — consumido por Task 2
  (OSTemplate copia pra Column) e pelo frontend (Task 5-7).
- Produces: `ensureRecurringSystemBoard(clientId, organizationId): Promise<{ id: string; columns: [{ id: string }] }>`
  helper exportado de `tasks.service.ts` — consumido por
  `recurring-templates.service.ts::generateTaskForAssignment`.
- Produces: `Board.type`/`osTemplateId` — consumido por Task 2/3.

- [ ] **Step 1: `schema.prisma`**

Enum novo e mudança no `TaskStatus`:

```prisma
enum TaskStatus {
  OPEN
  STARTED
  DONE
  DISREGARDED
  BLOCKED
}

enum ColumnStatusEffect {
  NONE
  OPEN
  STARTED
  BLOCKED
  DISREGARDED
  DONE
}

enum BoardType {
  OS
  RECURRING_SYSTEM
}
```

`Column` — remove `isFinal`, adiciona:

```prisma
model Column {
  id           String             @id @default(cuid())
  title        String
  position     Int
  color        String?
  statusEffect ColumnStatusEffect @default(NONE)
  notifyClient Boolean            @default(false)
  boardId      String
  createdAt    DateTime           @default(now())
  updatedAt    DateTime           @updatedAt

  board                    Board                     @relation(fields: [boardId], references: [id], onDelete: Cascade)
  tasks                    Task[]
  recurringTaskAssignments RecurringTaskAssignment[]
  documents                ColumnDocument[]

  @@map("columns")
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

`Board` — adiciona `type`/`osTemplateId` (relation aponta pra `OSTemplate`, criado na Task 2 — por
ora só o campo `osTemplateId String?` sem a relation tipada, adicionada na Task 2 quando o model
`OSTemplate` existir):

```prisma
model Board {
  id                String    @id @default(cuid())
  title             String
  description       String?
  organizationId    String
  clientId          String
  responsibleUserId String?
  isActive          Boolean   @default(true)
  dueDate           DateTime?
  type              BoardType @default(OS)
  osTemplateId      String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  organization             Organization              @relation(fields: [organizationId], references: [id])
  client                   Client                    @relation(fields: [clientId], references: [id])
  responsibleUser          User?                     @relation("BoardResponsible", fields: [responsibleUserId], references: [id])
  columns                  Column[]
  recurringTaskAssignments RecurringTaskAssignment[]

  @@map("boards")
}
```

`Client` — adiciona `codigo`:

```prisma
model Client {
  id         String  @id @default(cuid())
  name       String
  clientType String  @default("PJ")
  codigo     String?
  cnpj       String?
  // ...resto inalterado
}
```

`RecurringTaskAssignment` — remove `boardId`/`columnId`:

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

`Task` — só troca o tipo do `status` (já é `TaskStatus`, pega o novo valor automaticamente, sem
mudança de campo). Rodar `pnpm --filter api exec prisma format` depois de editar.

- [ ] **Step 2: Migration `20260922100000_kanban_os_foundation`**

```sql
-- CreateEnum
ALTER TYPE "TaskStatus" ADD VALUE 'STARTED';

CREATE TYPE "ColumnStatusEffect" AS ENUM ('NONE', 'OPEN', 'STARTED', 'BLOCKED', 'DISREGARDED', 'DONE');
CREATE TYPE "BoardType" AS ENUM ('OS', 'RECURRING_SYSTEM');

-- AlterTable: columns — isFinal -> statusEffect (backfill preserva o comportamento atual)
ALTER TABLE "columns" ADD COLUMN "statusEffect" "ColumnStatusEffect" NOT NULL DEFAULT 'NONE';
ALTER TABLE "columns" ADD COLUMN "notifyClient" BOOLEAN NOT NULL DEFAULT false;
UPDATE "columns" SET "statusEffect" = 'DONE' WHERE "isFinal" = true;
ALTER TABLE "columns" DROP COLUMN "isFinal";

-- CreateTable
CREATE TABLE "column_documents" (
  "id" TEXT NOT NULL,
  "columnId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "column_documents_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "column_documents" ADD CONSTRAINT "column_documents_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: boards — type + osTemplateId (osTemplateId sem FK ainda, a tabela os_templates nasce na Task 2;
-- adicionar a FK agora quebraria a ordem de migrations — fica como coluna solta até a Task 2 criar a tabela
-- e uma migration própria adicionar a constraint)
ALTER TABLE "boards" ADD COLUMN "type" "BoardType" NOT NULL DEFAULT 'OS';
ALTER TABLE "boards" ADD COLUMN "osTemplateId" TEXT;

-- AlterTable: clients — codigo
ALTER TABLE "clients" ADD COLUMN "codigo" TEXT;
CREATE UNIQUE INDEX "clients_codigo_organizationId_key" ON "clients"("codigo", "organizationId");

-- AlterTable: recurring_task_assignments — perde boardId/columnId
-- (sem dado real pra preservar — ambiente de teste, confirmado)
ALTER TABLE "recurring_task_assignments" DROP CONSTRAINT "recurring_task_assignments_boardId_fkey";
ALTER TABLE "recurring_task_assignments" DROP CONSTRAINT "recurring_task_assignments_columnId_fkey";
ALTER TABLE "recurring_task_assignments" DROP COLUMN "boardId";
ALTER TABLE "recurring_task_assignments" DROP COLUMN "columnId";
```

**Atenção:** `ALTER TYPE ... ADD VALUE` não pode rodar dentro da mesma transação que usa o valor
novo — como essa migration só ADICIONA o valor (não usa `STARTED` em nenhum `UPDATE`/`INSERT` na
mesma migration), isso é seguro. Se o Prisma reclamar de rodar `ADD VALUE` fora de transação
implícita, separar em duas migrations (`..._add_started_status` e `..._kanban_os_foundation`) — testar
localmente antes de assumir que funciona numa migration só.

- [ ] **Step 3: Aplicar a migration nos dois bancos, regenerar client**

```bash
pnpm --filter api migrate:deploy
DATABASE_URL="postgresql://tramita:tramita@localhost:5433/tramita_test" \
  node -r dotenv/config apps/api/node_modules/prisma/build/index.js migrate deploy --schema apps/api/prisma/schema.prisma
pnpm --filter api exec prisma generate
```

- [ ] **Step 4: `tasks.service.ts` — `moveTask` usa `statusEffect`, ganha `ensureRecurringSystemBoard`**

```ts
export async function moveTask(
  taskId: string,
  organizationId: string,
  data: MoveTaskBody,
  actor: Actor,
) {
  const task = await verifyTaskBelongsToOrg(taskId, organizationId)
  const fromColumn = task.column
  const toColumn = await verifyColumnBelongsToOrg(data.columnId, organizationId)
  const actorName = await resolveActorName(actor.id, actor.type)

  const nextStatus = toColumn.statusEffect !== 'NONE' ? toColumn.statusEffect : task.status

  const updatedTask = await prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id: taskId },
      data: { columnId: data.columnId, position: data.position, status: nextStatus },
    })

    await tx.taskHistory.create({
      data: {
        taskId, action: 'moved_to', fromValue: fromColumn.title, toValue: toColumn.title,
        actorType: actor.type, actorId: actor.id, actorName,
      },
    })

    return updated
  })

  // Coluna configurada pra notificar (via Template de OS) manda mesmo se o toggle global
  // "Tarefa movida" da org estiver desligado — é uma escolha explícita por coluna, não o
  // aviso genérico de qualquer movimentação.
  await enqueueNotification({
    event: 'TASK_MOVED',
    taskId,
    organizationId,
    clientId: toColumn.board.clientId,
    channels: toColumn.notifyClient ? ['WHATSAPP', 'EMAIL'] : undefined,
    metadata: { taskTitle: task.title, fromColumn: fromColumn.title, toColumn: toColumn.title },
  })

  if (toColumn.statusEffect === 'DONE') {
    await enqueueNotification({
      event: 'TASK_COMPLETED',
      taskId, organizationId, clientId: toColumn.board.clientId,
      metadata: { taskTitle: task.title },
    })
  }

  await publishBoardEvent(toColumn.board.id, {
    event: 'task:moved',
    data: { taskId, fromColumn: fromColumn.id, toColumn: data.columnId, position: data.position },
  })

  // Documentos configurados na coluna de destino (via Template de OS) — cria os
  // TaskDocumentRequirement que ainda não existem pra essa tarefa (evita duplicar se ela
  // passar pela mesma coluna mais de uma vez).
  const columnDocs = await prisma.columnDocument.findMany({ where: { columnId: data.columnId } })
  if (columnDocs.length > 0) {
    const existingNames = new Set(
      (await prisma.taskDocumentRequirement.findMany({ where: { taskId }, select: { name: true } }))
        .map((d) => d.name),
    )
    const toCreate = columnDocs.filter((d) => !existingNames.has(d.name))
    if (toCreate.length > 0) {
      const basePosition = await prisma.taskDocumentRequirement.count({ where: { taskId } })
      await prisma.taskDocumentRequirement.createMany({
        data: toCreate.map((d, i) => ({ taskId, name: d.name, position: basePosition + i })),
      })
    }
  }

  return updatedTask
}
```

Verificar a assinatura real de `enqueueNotification` em `@/lib/queue` antes de adicionar o campo
`channels` — se o parâmetro já existir com outro nome (o worker da feature anterior usa
`channelOverride` internamente, conferir o tipo exportado de `NotificationJob`), usar o nome exato
que já existe em vez de inventar um novo.

`verifyColumnBelongsToOrg` já retorna a coluna com `board` incluído (usado em `toColumn.board.clientId`
logo acima) — conferir se o `select`/`include` atual já traz `statusEffect`/`notifyClient` (deveria,
já que não há `select` explícito limitando campos) antes de assumir que está disponível.

Exportar um novo helper no mesmo arquivo:

```ts
// Todo cliente com pelo menos uma Tarefa Recorrente vinculada precisa de uma "casa" pra essas
// tarefas existirem no banco — não porque o usuário vê ou gerencia esse board (ele nunca aparece
// em nenhuma tela), mas porque toda a lógica de escopo por departamento do portal do cliente
// (comments/attachments/task-documents/notification worker) resolve a empresa de uma tarefa via
// task.column.board.clientId. Criar essa cadeia uma vez por cliente é mais barato do que refatorar
// essa cadeia inteira pra aceitar Task sem coluna.
export async function ensureRecurringSystemBoard(clientId: string, organizationId: string) {
  const existing = await prisma.board.findFirst({
    where: { clientId, organizationId, type: 'RECURRING_SYSTEM' },
    include: { columns: true },
  })
  if (existing && existing.columns[0]) return existing

  return prisma.board.create({
    data: {
      title: 'Tarefas Recorrentes (sistema)',
      organizationId,
      clientId,
      type: 'RECURRING_SYSTEM',
      isActive: true,
      columns: { create: [{ title: 'Recorrentes', position: 0, statusEffect: 'NONE' }] },
    },
    include: { columns: true },
  })
}
```

- [ ] **Step 5: `tasks.schema.ts` — `updateTaskSchema.status` aceita `STARTED`**

```ts
status: z.enum(['OPEN', 'STARTED', 'DONE', 'DISREGARDED', 'BLOCKED']).optional(),
```

- [ ] **Step 6: `boards.service.ts` — `DEFAULT_COLUMNS` usa `statusEffect`, `listBoards` filtra `type: 'OS'`**

```ts
const DEFAULT_COLUMNS = [
  { title: 'Pendente', position: 0, color: '#6B7280', statusEffect: 'NONE' as const },
  { title: 'Em andamento', position: 1, color: '#3B82F6', statusEffect: 'NONE' as const },
  { title: 'Concluído', position: 2, color: '#10B981', statusEffect: 'DONE' as const },
]
```

`listBoards`/`getBoardById` (e qualquer outro `findMany`/`findFirst` de `Board` usado por rota que o
usuário vê — `GET /boards`, `GET /boards/:id`) ganham `type: 'OS'` fixo no `where`, **não** um filtro
opcional — o board de sistema nunca deve vazar pra nenhuma dessas rotas, mesmo sem query param
nenhum. Ler o arquivo inteiro antes de editar pra pegar todo `findMany`/`findFirst` de board que
serve uma tela.

- [ ] **Step 7: `dashboard.service.ts` — breakdown por status ganha `STARTED`**

```ts
OPEN: statusMap['OPEN'] ?? 0,
STARTED: statusMap['STARTED'] ?? 0,
BLOCKED: statusMap['BLOCKED'] ?? 0,
DONE: statusMap['DONE'] ?? 0,
DISREGARDED: statusMap['DISREGARDED'] ?? 0,
```

Os filtros `notIn: ['DONE', 'DISREGARDED']` (linhas ~27/48/68/84 do arquivo atual) já tratam
`STARTED` como "ainda ativo" corretamente sem mudança nenhuma — só o breakdown por status precisa do
campo novo.

- [ ] **Step 8: `recurring-templates.schema.ts`/`recurring-templates.service.ts` — assignment simplificado**

```ts
// recurring-templates.schema.ts
export const createAssignmentSchema = z.object({
  clientId: z.string().cuid(),
})
export const updateAssignmentSchema = z.object({
  isActive: z.boolean().optional(),
})
```

```ts
// recurring-templates.service.ts
export async function createAssignment(templateId: string, organizationId: string, data: CreateAssignmentBody) {
  await getTemplateById(templateId, organizationId)
  const client = await prisma.client.findFirst({ where: { id: data.clientId, organizationId } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  const existing = await prisma.recurringTaskAssignment.findFirst({
    where: { templateId, clientId: data.clientId },
  })
  if (existing) throw new AppError(409, 'Este cliente já está vinculado a este template')

  return prisma.recurringTaskAssignment.create({ data: { templateId, clientId: data.clientId } })
}
```

Remover `assertClientBoardColumnBelongToOrg` (não é mais chamada por ninguém) e o `include: { board: ... } }`
de `listAssignments` (não existe mais `board` na relação — trocar por só `client`).

`updateAssignment` perde a checagem de `boardId`/`columnId` (só sobra `isActive`).

`generateTaskForAssignment` — troca a resolução de coluna:

```ts
// era: const column = await prisma.column.findUnique({ where: { id: assignment.columnId } })
//      if (!column) throw new Error('Coluna do vínculo não existe mais')
const systemBoard = await ensureRecurringSystemBoard(assignment.clientId, template.organizationId)
const columnId = systemBoard.columns[0].id
```

(import `ensureRecurringSystemBoard` de `@/modules/tasks/tasks.service`), e usar `columnId` (a
variável nova) em vez de `assignment.columnId` no `tx.task.create({ data: { columnId, ... } })` mais
abaixo — o resto da função (idempotência por `RecurringGenerationLog`, criação de
`TaskDocumentRequirement`/`TaskDeliverable`, `taskHistory`) fica igual.

- [ ] **Step 9: `test/helpers.ts` — `createTestColumn` ganha `statusEffect`, novo `createTestClient` com `codigo`**

```ts
export async function createTestColumn(
  boardId: string,
  overrides?: Partial<{ title: string; statusEffect: 'NONE' | 'OPEN' | 'STARTED' | 'BLOCKED' | 'DISREGARDED' | 'DONE'; position: number }>,
) {
  return prisma.column.create({
    data: {
      title: overrides?.title ?? (overrides?.statusEffect === 'DONE' ? 'Concluído' : 'Em Andamento'),
      position: overrides?.position ?? 0,
      statusEffect: overrides?.statusEffect ?? 'NONE',
      boardId,
    },
  })
}
```

Varrer o repositório (`grep -rn "isFinal" apps/api/src --include="*.test.ts"`) e trocar cada
`isFinal: true`/`isFinal: false` pelo `statusEffect` equivalente (`DONE`/`NONE`) nos call sites de
`createTestColumn`. Mesma varredura pra `grep -rn "boardId:.*columnId:\|createAssignment(" apps/api/src --include="*.test.ts"`
— qualquer teste que cria um `RecurringTaskAssignment` ou chama `createAssignment` passando
`boardId`/`columnId` precisa perder esses dois campos.

- [ ] **Step 10: Rodar suíte inteira, corrigir o que a varredura mecânica não pegou**

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter api test
```

- [ ] **Step 11: Commit**

```bash
git add apps/api/prisma apps/api/src/modules/tasks apps/api/src/modules/recurring-templates apps/api/src/modules/boards apps/api/src/modules/dashboard apps/api/src/test/helpers.ts <arquivos de teste tocados na Step 9>
git commit -m "feat(kanban): status STARTED, Column.statusEffect, board de sistema pra recorrência"
```

---

## Task 2: `OSTemplate` backend module (CRUD)

**Files:**
- Create: `apps/api/src/modules/os-templates/os-templates.schema.ts`
- Create: `apps/api/src/modules/os-templates/os-templates.service.ts`
- Create: `apps/api/src/modules/os-templates/os-templates.routes.ts`
- Create: `apps/api/src/modules/os-templates/os-templates.service.test.ts`
- Create: `apps/api/src/modules/os-templates/os-templates.routes.test.ts`
- Modify: `apps/api/prisma/schema.prisma` (models `OSTemplate`/`OSTemplateColumn`/`OSTemplateColumnDocument`, mais a FK de `Board.osTemplateId` que ficou solta na Task 1)
- Create: `apps/api/prisma/migrations/20260922110000_os_templates/migration.sql`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: nenhuma desta plan (usa Prisma direto, padrão dos outros módulos CRUD).
- Produces: `GET/POST/PATCH/DELETE /os-templates` — consumido pela Task 3 (criar board a partir de
  template) e pelo frontend na Task 6.

- [ ] **Step 1: `schema.prisma` — modelos novos + FK do Board**

```prisma
model OSTemplate {
  id             String   @id @default(cuid())
  organizationId String
  name           String
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
  id           String             @id @default(cuid())
  templateId   String
  title        String
  position     Int
  statusEffect ColumnStatusEffect @default(NONE)
  notifyClient Boolean            @default(false)

  template  OSTemplate                 @relation(fields: [templateId], references: [id], onDelete: Cascade)
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

No model `Board`, trocar `osTemplateId String?` por:

```prisma
  osTemplateId String?
  osTemplate   OSTemplate? @relation(fields: [osTemplateId], references: [id])
```

No model `Request`, adicionar:

```prisma
  osTemplateId String?
  osTemplate   OSTemplate? @relation(fields: [osTemplateId], references: [id])
```

(Isso é tecnicamente parte da Task 3, mas como a tabela `os_templates` só existe a partir desta
migration, o campo em `Request` precisa nascer na mesma migration — a Task 3 só cuida da lógica que
usa esse campo, não do schema dele.)

`Organization` ganha `osTemplates OSTemplate[]` na lista de relations.

- [ ] **Step 2: Migration `20260922110000_os_templates`**

```sql
CREATE TABLE "os_templates" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "os_templates_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "os_templates" ADD CONSTRAINT "os_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "os_template_columns" (
  "id" TEXT NOT NULL, "templateId" TEXT NOT NULL, "title" TEXT NOT NULL, "position" INTEGER NOT NULL,
  "statusEffect" "ColumnStatusEffect" NOT NULL DEFAULT 'NONE', "notifyClient" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "os_template_columns_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "os_template_columns" ADD CONSTRAINT "os_template_columns_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "os_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "os_template_column_documents" (
  "id" TEXT NOT NULL, "columnId" TEXT NOT NULL, "name" TEXT NOT NULL, "position" INTEGER NOT NULL,
  CONSTRAINT "os_template_column_documents_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "os_template_column_documents" ADD CONSTRAINT "os_template_column_documents_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "os_template_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "boards" ADD CONSTRAINT "boards_osTemplateId_fkey" FOREIGN KEY ("osTemplateId") REFERENCES "os_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "requests" ADD COLUMN "osTemplateId" TEXT;
ALTER TABLE "requests" ADD CONSTRAINT "requests_osTemplateId_fkey" FOREIGN KEY ("osTemplateId") REFERENCES "os_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Aplicar migration nos dois bancos, `prisma generate`** (mesmos comandos da Task 1 Step 3)

- [ ] **Step 4: `os-templates.schema.ts`**

```ts
import { z } from 'zod'

const statusEffectEnum = z.enum(['NONE', 'OPEN', 'STARTED', 'BLOCKED', 'DISREGARDED', 'DONE'])

const columnSchema = z.object({
  title: z.string().trim().min(1),
  statusEffect: statusEffectEnum.default('NONE'),
  notifyClient: z.boolean().default(false),
  documents: z.array(z.object({ name: z.string().trim().min(1) })).default([]),
})

export const createOSTemplateSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
  columns: z.array(columnSchema).min(1, 'Adicione pelo menos uma coluna'),
})

export const updateOSTemplateSchema = createOSTemplateSchema.partial().extend({
  columns: z.array(columnSchema).min(1).optional(),
})

export type CreateOSTemplateBody = z.infer<typeof createOSTemplateSchema>
export type UpdateOSTemplateBody = z.infer<typeof updateOSTemplateSchema>
```

- [ ] **Step 5: `os-templates.service.ts`**

```ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateOSTemplateBody, UpdateOSTemplateBody } from './os-templates.schema'

const INCLUDE = {
  columns: {
    orderBy: { position: 'asc' as const },
    include: { documents: { orderBy: { position: 'asc' as const } } },
  },
}

export async function listOSTemplates(organizationId: string) {
  return prisma.oSTemplate.findMany({ where: { organizationId }, include: INCLUDE, orderBy: { name: 'asc' } })
}

export async function getOSTemplateById(id: string, organizationId: string) {
  const template = await prisma.oSTemplate.findFirst({ where: { id, organizationId }, include: INCLUDE })
  if (!template) throw new AppError(404, 'Template de OS não encontrado')
  return template
}

export async function createOSTemplate(organizationId: string, data: CreateOSTemplateBody) {
  return prisma.oSTemplate.create({
    data: {
      name: data.name,
      description: data.description,
      isActive: data.isActive,
      organizationId,
      columns: {
        create: data.columns.map((col, i) => ({
          title: col.title,
          position: i,
          statusEffect: col.statusEffect,
          notifyClient: col.notifyClient,
          documents: { create: col.documents.map((d, j) => ({ name: d.name, position: j })) },
        })),
      },
    },
    include: INCLUDE,
  })
}

export async function updateOSTemplate(id: string, organizationId: string, data: UpdateOSTemplateBody) {
  const template = await prisma.oSTemplate.findFirst({ where: { id, organizationId } })
  if (!template) throw new AppError(404, 'Template de OS não encontrado')

  return prisma.$transaction(async (tx) => {
    await tx.oSTemplate.update({
      where: { id },
      data: { name: data.name, description: data.description, isActive: data.isActive },
    })

    if (data.columns) {
      // Substitui a lista inteira de colunas — mesmo padrão já usado em ClientUserAccess/accesses:
      // mais simples que diff incremental, e um Template de OS já existente (com boards criados a
      // partir dele) não é afetado retroativamente, porque a cópia pros boards reais acontece só
      // no momento da criação (Task 3), nunca por referência.
      await tx.oSTemplateColumn.deleteMany({ where: { templateId: id } })
      for (const [i, col] of data.columns.entries()) {
        await tx.oSTemplateColumn.create({
          data: {
            templateId: id, title: col.title, position: i, statusEffect: col.statusEffect, notifyClient: col.notifyClient,
            documents: { create: col.documents.map((d, j) => ({ name: d.name, position: j })) },
          },
        })
      }
    }

    return tx.oSTemplate.findUniqueOrThrow({ where: { id }, include: INCLUDE })
  })
}

export async function deleteOSTemplate(id: string, organizationId: string) {
  const template = await prisma.oSTemplate.findFirst({ where: { id, organizationId } })
  if (!template) throw new AppError(404, 'Template de OS não encontrado')
  return prisma.oSTemplate.update({ where: { id }, data: { isActive: false } })
}
```

(Nome do client Prisma pro model `OSTemplate` é `prisma.oSTemplate` — conferir o nome exato gerado
depois do `prisma generate` da Task 1/2, Prisma normaliza sigla maiúscula em camelCase de forma nem
sempre óbvia; ajustar se vier diferente, ex. `prisma.osTemplate`.)

- [ ] **Step 6: `os-templates.routes.ts`** (mesmo padrão de `departments.routes.ts`: leitura liberada
  pra `ORG_ADMIN`/`ORG_MANAGER`/`ORG_MEMBER` — colaborador precisa ver a lista pra escolher template
  ao criar uma OS manual —, mutação só `ORG_ADMIN`)

```ts
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createOSTemplateSchema, updateOSTemplateSchema } from './os-templates.schema'
import { listOSTemplates, getOSTemplateById, createOSTemplate, updateOSTemplate, deleteOSTemplate } from './os-templates.service'

export async function osTemplatesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/', { preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')] }, async (request, reply) => {
    return reply.send(await listOSTemplates(request.user.organizationId!))
  })

  app.get('/:id', { preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getOSTemplateById(id, request.user.organizationId!))
  })

  app.addHook('preHandler', requireRole('ORG_ADMIN'))

  app.post('/', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = createOSTemplateSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createOSTemplate(request.user.organizationId!, result.data))
  })

  app.patch('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateOSTemplateSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateOSTemplate(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteOSTemplate(id, request.user.organizationId!))
  })
}
```

- [ ] **Step 7: registrar em `server.ts`** (import + `app.register(osTemplatesRoutes, { prefix: '/os-templates' })`, mesmo padrão de `departmentsRoutes`)

- [ ] **Step 8: `os-templates.service.test.ts`** — cobrir: cria template com colunas+documentos
  aninhados numa chamada só; `update` substitui a lista de colunas inteira (testar que uma coluna
  removida do payload some, e uma nova aparece); `delete` é soft (`isActive: false`); 404 pra
  template de outra org.

- [ ] **Step 9: `os-templates.routes.test.ts`** — `POST` como `ORG_ADMIN` 201, como `ORG_MANAGER` 403;
  `GET` como `ORG_MEMBER` funciona (leitura liberada); `PATCH`/`DELETE` escopados por org.

- [ ] **Step 10: Rodar suíte, commit**

```bash
pnpm --filter api exec tsc --noEmit && pnpm --filter api test
git add apps/api/prisma apps/api/src/modules/os-templates apps/api/src/server.ts
git commit -m "feat(os-templates): CRUD de templates de ordem de serviço"
```

---

## Task 3: Criar board a partir de Template de OS + `Request.osTemplateId`

**Files:**
- Modify: `apps/api/src/modules/boards/boards.service.ts`
- Modify: `apps/api/src/modules/boards/boards.schema.ts`
- Modify: `apps/api/src/modules/boards/boards.routes.ts`
- Modify: `apps/api/src/modules/requests/requests.schema.ts`
- Modify: `apps/api/src/modules/requests/requests.service.ts`
- Modify: `apps/api/src/modules/requests/requests.service.test.ts`
- Modify: `apps/api/src/modules/boards/boards.service.test.ts`

**Interfaces:**
- Consumes: `OSTemplate`/`OSTemplateColumn`/`OSTemplateColumnDocument` (Task 2).
- Produces: `createBoard` aceita `osTemplateId?` opcional — consumido pelo frontend na Task 6/8.

- [ ] **Step 1: `boards.schema.ts` — `createBoardSchema` ganha `osTemplateId?`**

```ts
export const createBoardSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  clientId: z.string().cuid(),
  osTemplateId: z.string().cuid().optional(),
  dueDate: z.string().datetime().optional(),
  responsibleUserId: z.string().cuid().optional(),
})
```

- [ ] **Step 2: `boards.service.ts::createBoard` — colunas vêm do template quando informado**

```ts
export async function createBoard(organizationId: string, userId: string, userRole: string, data: CreateBoardBody) {
  const client = await prisma.client.findFirst({ where: { id: data.clientId, organizationId, isActive: true } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  const responsibleUserId = userRole === 'ORG_MEMBER' ? userId : (data.responsibleUserId ?? null)

  const columns = data.osTemplateId
    ? await buildColumnsFromTemplate(data.osTemplateId, organizationId)
    : DEFAULT_COLUMNS

  return prisma.board.create({
    data: {
      title: data.title,
      description: data.description,
      clientId: data.clientId,
      organizationId,
      responsibleUserId,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      type: 'OS',
      osTemplateId: data.osTemplateId,
      columns: { create: columns },
    },
    include: {
      client: { select: { id: true, name: true } },
      columns: { orderBy: { position: 'asc' } },
    },
  })
}

async function buildColumnsFromTemplate(osTemplateId: string, organizationId: string) {
  const template = await prisma.oSTemplate.findFirst({
    where: { id: osTemplateId, organizationId },
    include: { columns: { orderBy: { position: 'asc' }, include: { documents: { orderBy: { position: 'asc' } } } } },
  })
  if (!template) throw new AppError(404, 'Template de OS não encontrado')

  return template.columns.map((col) => ({
    title: col.title,
    position: col.position,
    statusEffect: col.statusEffect,
    notifyClient: col.notifyClient,
    documents: { create: col.documents.map((d) => ({ name: d.name, position: d.position })) },
  }))
}
```

- [ ] **Step 3: `boards.routes.ts` — `GET /` e `GET /:id` filtram `type: 'OS'` fixo** (se a Task 1
  Step 6 já cobriu isso em `boards.service.ts::listBoards`/`getBoardById`, essa etapa é só conferir
  que nenhuma rota nova desta task reabriu a brecha)

- [ ] **Step 4: `requests.schema.ts` — `createRequestSchema` ganha `osTemplateId?`**

```ts
export const createRequestSchema = z.object({
  clientId: z.string().cuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  departmentId: z.string().cuid().optional(),
  osTemplateId: z.string().cuid().optional(),
})
```

- [ ] **Step 5: `requests.service.ts` — `createRequest` salva `osTemplateId`, `approveRequest` usa o template no `NEW_BOARD`**

`createRequest`: adicionar `osTemplateId: data.osTemplateId` no `data` do `prisma.request.create`.

`approveRequest`, branch `NEW_BOARD`:

```ts
if (data.mode === 'NEW_BOARD') {
  const client = await prisma.client.findFirst({ where: { id: request.clientId, organizationId } })
  const titlePrefix = client?.codigo ? `${client.codigo} - ${client.name}` : client?.name
  const osTemplate = request.osTemplateId
    ? await prisma.oSTemplate.findFirst({ where: { id: request.osTemplateId, organizationId } })
    : null

  const board = await createBoard(organizationId, reviewerId, reviewerRole, {
    title: osTemplate ? `${titlePrefix} — ${osTemplate.name}` : request.title,
    clientId: request.clientId,
    osTemplateId: request.osTemplateId ?? undefined,
  })
  columnId = board.columns[0].id
}
```

- [ ] **Step 6: Testes** — `boards.service.test.ts`: `createBoard` com `osTemplateId` cria as colunas
  certas (título/statusEffect/documentos copiados do template); sem `osTemplateId` continua usando
  `DEFAULT_COLUMNS` como hoje. `requests.service.test.ts`: `approveRequest` com `NEW_BOARD` e uma
  `Request` com `osTemplateId` cria o board com as colunas do template e o título com prefixo do
  código do cliente.

- [ ] **Step 7: Rodar suíte, commit**

```bash
pnpm --filter api exec tsc --noEmit && pnpm --filter api test
git add apps/api/src/modules/boards apps/api/src/modules/requests
git commit -m "feat(os-templates): board de OS nasce com as colunas do template escolhido"
```

---

## Task 4: `GET /tasks` — endpoint de listagem flat com filtros

**Files:**
- Modify: `apps/api/src/modules/tasks/tasks.schema.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.ts`
- Modify: `apps/api/src/modules/tasks/tasks.routes.ts`
- Modify: `apps/api/src/modules/tasks/tasks.routes.test.ts`

**Interfaces:**
- Produces: `GET /tasks` — consumido pela tela Tarefas (Task 7).

- [ ] **Step 1: `tasks.schema.ts` — `listTasksQuerySchema`**

```ts
export const listTasksQuerySchema = z.object({
  clientId: z.string().cuid().optional(),
  assigneeId: z.string().cuid().optional(),
  departmentId: z.string().cuid().optional(),
  status: z.enum(['OPEN', 'STARTED', 'DONE', 'DISREGARDED', 'BLOCKED']).optional(),
  recurringTemplateId: z.string().cuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  q: z.string().optional(),
})
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>
```

- [ ] **Step 2: `tasks.service.ts::listTasks`**

```ts
export async function listTasks(organizationId: string, actor: { id: string; role: string }, query: ListTasksQuery) {
  const where: Prisma.TaskWhereInput = {
    column: {
      board: {
        organizationId,
        ...(query.clientId ? { clientId: query.clientId } : {}),
      },
    },
    ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.recurringTemplateId ? { recurringTemplateId: query.recurringTemplateId } : {}),
    ...(query.dateFrom || query.dateTo ? {
      targetDate: {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      },
    } : {}),
    ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
  }

  if (actor.role === 'ORG_MEMBER') where.assigneeId = actor.id

  return prisma.task.findMany({
    where,
    select: {
      id: true, title: true, status: true, priority: true, targetDate: true, dueDate: true,
      recurringTemplateId: true,
      department: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      column: { select: { board: { select: { id: true, clientId: true, client: { select: { id: true, name: true, codigo: true } } } } } },
    },
    orderBy: { targetDate: 'asc' },
  })
}
```

Nenhum filtro por `Board.type` aqui — de propósito. `GET /boards` (Processos/OS) filtra
`type: 'OS'` porque lista boards, mas `GET /tasks` lista tarefas diretamente, e o caso de uso
principal desta tela ("ver todas as folhas de todos os clientes juntas") depende exatamente das
tarefas que moram no board de sistema `RECURRING_SYSTEM` criado por `ensureRecurringSystemBoard`
(Task 1). Excluir por `type` aqui esconderia toda tarefa recorrente da tela — o oposto do que a
tela existe pra fazer.

Um `ORG_MEMBER` só vê tarefas onde é `assigneeId` (dimensão diferente de "responsável pelo board" que
`GET /boards` usa) — mantém consistente com o fato de que essa tela lista tarefas individuais, não
boards.

- [ ] **Step 3: `tasks.routes.ts` — `GET /tasks`**

```ts
app.get('/tasks', {
  preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
}, async (request, reply) => {
  const result = listTasksQuerySchema.safeParse(request.query)
  if (!result.success) throw new AppError(400, result.error.errors[0].message)
  return reply.send(await listTasks(request.user.organizationId!, { id: request.user.sub, role: request.user.role }, result.data))
})
```

Registrar **antes** de qualquer rota `/tasks/:id`-shaped já existente no arquivo (mesma cautela de
ordenação já usada em `/tasks/reorder` e `/tasks/:id/move`).

- [ ] **Step 4: Teste** — `tasks.routes.test.ts`: filtro por `clientId` retorna só tarefas daquele
  cliente; filtro por `recurringTemplateId` retorna as tarefas geradas por aquele template
  (independente de qual cliente); `ORG_MEMBER` só vê as que é `assigneeId`; combinação de filtros
  (status + departmentId) funciona junto.

- [ ] **Step 5: Rodar suíte, commit**

```bash
pnpm --filter api exec tsc --noEmit && pnpm --filter api test
git add apps/api/src/modules/tasks
git commit -m "feat(tasks): endpoint de listagem flat com filtros (GET /tasks)"
```

---

## Task 5: Frontend — simplificar "Vincular cliente" em Tarefas Recorrentes

**Files:**
- Modify: `apps/web/src/pages/app/settings/RecurringTemplates.tsx`

**Interfaces:**
- Consumes: `POST /recurring-templates/:id/assignments` (Task 1, agora só `{ clientId }`).

- [ ] **Step 1: `ManageTemplateDialog` — remove os selects de Processo/Coluna**

Ler o componente atual (já lido nesta sessão — os selects de `boardId`/`columnId` e a query
`['boards', clientId]`). Remover: o `useQuery` de `boards`, o `board`/`boardId`/`columnId` de state,
os dois `<select>` de Processo/Coluna. Fica só:

```tsx
<div className="grid grid-cols-2 gap-2">
  <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-9 rounded-md border border-border bg-surface text-foreground px-2 text-sm">
    <option value="">Cliente</option>
    {clients.map((c) => <option key={c.id} value={c.id}>{c.codigo ? `${c.codigo} - ${c.name}` : c.name}</option>)}
  </select>
</div>
<Button type="button" size="sm" onClick={() => addMutation.mutate()} disabled={!clientId || addMutation.isPending}>
  Vincular cliente
</Button>
```

`addMutation` passa a mandar só `{ clientId }` no `POST`.

- [ ] **Step 2: Typecheck, test, commit**

```bash
pnpm --filter web exec tsc --noEmit && pnpm --filter web test
git add apps/web/src/pages/app/settings/RecurringTemplates.tsx
git commit -m "feat(kanban): vincular cliente a tarefa recorrente sem exigir Processo/Coluna"
```

---

## Task 6: Frontend — Templates de OS + Lista de OS

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Create: `apps/web/src/pages/app/settings/OSTemplates.tsx`
- Create: `apps/web/src/pages/app/settings/OSTemplateForm.tsx`
- Create: `apps/web/src/pages/app/OSList.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /os-templates` (Task 2), `GET /boards?type=OS` (ajustar
  `boardsRoutes`/`listBoards` pra aceitar esse filtro explícito no `GET /` existente, já que hoje ele
  não expõe `type` como query — adicionar `type` opcional no `listBoardsQuerySchema` que faz
  `boards.routes.ts` repassar pro `listBoards`, restrito sempre a `'OS'` de qualquer forma pela Task 1
  Step 6 — na prática esse query param nem precisa existir, a lista de OS só chama `GET /boards`
  normal e já recebe só OS).

- [ ] **Step 1: `types/index.ts` — `OSTemplate`/`OSTemplateColumn`**

```ts
export interface OSTemplateColumnDocumentItem { id: string; name: string; position: number }
export interface OSTemplateColumn {
  id: string; title: string; position: number
  statusEffect: 'NONE' | 'OPEN' | 'STARTED' | 'BLOCKED' | 'DISREGARDED' | 'DONE'
  notifyClient: boolean
  documents: OSTemplateColumnDocumentItem[]
}
export interface OSTemplate {
  id: string; name: string; description: string | null; isActive: boolean
  columns: OSTemplateColumn[]
}
```

- [ ] **Step 2: `OSTemplates.tsx`** — lista, mesmo padrão de `RecurringTemplates.tsx` (Card rows, Link
  pra `new`/`:id/edit`, delete soft, empty state).

- [ ] **Step 3: `OSTemplateForm.tsx`** — página cheia (não modal, mesma lição já aplicada em
  `RecurringTemplateForm.tsx`/`ClientUserForm.tsx`): nome, descrição, ativo, e um repetidor de
  colunas onde cada linha tem: título, um select "Tipo" (`Fase` = `statusEffect: NONE`, ou um dos 5
  status), toggle "Notificar cliente", e uma sub-lista de documentos (nome, add/remove) — mesmo
  padrão de repetidor já usado em `ClientUserForm.tsx`.

- [ ] **Step 4: `OSList.tsx`** — lista de `Board { type: OS }` (via `GET /boards`, que já só retorna
  OS depois da Task 1), filtrável por cliente/responsável (os mesmos filtros que `Processes.tsx` já
  usa hoje pra listar boards — reaproveitar o padrão de lá). Cada linha mostra
  `código - nome do cliente`, `osTemplate?.name ?? 'Sem template'`, responsável, contagem de tarefas.
  Clicar navega pra `/app/board/:boardId` (já existe, sem mudança).

- [ ] **Step 5: `router.tsx`/`AppLayout.tsx`** — rotas `settings/os-templates`(+`/new`+`/:id/edit`,
  `ADMIN_ROLES`, mesmo padrão de `settings/recurring-templates`) e `os` (lista, `MANAGER_ROLES`).
  Links no menu: "Templates de OS" em Configurações, "Ordens de Serviço" como item principal (perto
  de "Processos").

- [ ] **Step 6: Typecheck, test, commit**

```bash
pnpm --filter web exec tsc --noEmit && pnpm --filter web test
git add apps/web/src/types/index.ts apps/web/src/pages/app/settings/OSTemplates.tsx apps/web/src/pages/app/settings/OSTemplateForm.tsx apps/web/src/pages/app/OSList.tsx apps/web/src/router.tsx apps/web/src/components/AppLayout.tsx
git commit -m "feat(os-templates): telas de gestão de templates e lista de ordens de serviço"
```

---

## Task 7: Frontend — Tela "Tarefas" (Lista + Kanban dinâmico)

**Files:**
- Create: `apps/web/src/pages/app/Tasks.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`

**Interfaces:**
- Consumes: `GET /tasks` (Task 4).

- [ ] **Step 1: `Tasks.tsx`** — filtros no topo (cliente, colaborador, departamento, tipo de tarefa
  via `recurringTemplateId` — dropdown populado a partir de `GET /recurring-templates` já existente,
  status, intervalo de data, busca por título), toggle Lista/Kanban.

  **Lista:** tabela com as colunas retornadas por `GET /tasks` (cliente com código, título,
  departamento, responsável, status, meta). Clique numa linha abre um painel lateral reaproveitando
  `TaskDrawer`/`Comments` (mesmo componente já usado em `Board.tsx` — conferir as props que ele
  espera antes de reutilizar, já que `TaskDrawer` hoje é montado a partir de um objeto `Task` vindo
  de dentro de um board; o shape retornado por `GET /tasks` precisa bater ou precisa de um mapeamento
  fino, e a query de histórico/comentários dentro do drawer já busca por `taskId` isolado, não
  depende do board — deve funcionar sem adaptação, só conferir na prática).

  **Kanban:** agrupa o array retornado por `status`, renderiza 5 colunas fixas (Aberto/Iniciado/Com
  Impedimento/Desconsiderado/Concluído — mesmas cores/labels já usadas em `TaskDrawer.tsx`'s
  `STATUS_LABEL`/`STATUS_COLOR`, adicionar `STARTED` no mesmo padrão). Arrastar um card entre colunas
  chama `PATCH /tasks/:id { status: <novo> }` direto — sem `moveTask`, sem coluna real envolvida.
  Reaproveitar `@dnd-kit/core` do jeito que `Board.tsx` já usa pro drag-and-drop.

- [ ] **Step 2: `router.tsx`/`AppLayout.tsx`** — rota `tasks`, item "Tarefas" no menu principal (perto
  de Dashboard/Processos/OS).

- [ ] **Step 3: Typecheck, test, commit**

```bash
pnpm --filter web exec tsc --noEmit && pnpm --filter web test
git add apps/web/src/pages/app/Tasks.tsx apps/web/src/router.tsx apps/web/src/components/AppLayout.tsx
git commit -m "feat(tasks): tela unificada de tarefas com modo lista e kanban dinâmico"
```

---

## Task 8: Frontend — código do cliente + tipo de solicitação no portal

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/pages/app/Clients.tsx`
- Modify: `apps/api/src/modules/clients/clients.schema.ts`
- Modify: `apps/api/src/modules/clients/clients.service.ts`
- Modify: `apps/web/src/pages/portal/Requests.tsx`
- Modify: `apps/api/src/modules/portal/portal.routes.ts` (endpoint pra listar os templates ativos pro seletor do portal)

**Interfaces:**
- Consumes: `OSTemplate` (Task 2/6).

- [ ] **Step 1: `clients.schema.ts`/`clients.service.ts` — `codigo`**

Adicionar `codigo: z.string().optional()` em `createClientSchema`/`updateClientSchema`, e
`codigo: data.codigo` no `data` de `createClient`, mais `codigo: true` no `SELECT` do service.

- [ ] **Step 2: `Clients.tsx`** — campo "Código" no formulário (create + edit), exibição
  `"{codigo} - {name}"` na lista quando `codigo` existe (senão só `name`, como já faz hoje).

- [ ] **Step 3: `portal.routes.ts` — `GET /portal/os-templates`**

```ts
app.get('/os-templates', async (request, reply) => {
  return reply.send(
    await prisma.oSTemplate.findMany({
      where: { organizationId: request.user.organizationId!, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  )
})
```

- [ ] **Step 4: `portal/Requests.tsx`** — seletor "Tipo de solicitação" (lista `GET
  /portal/os-templates`) + opção "Outro" que mantém o título livre como já funciona hoje. Mandar
  `osTemplateId` no `POST /portal/requests` quando um tipo específico for escolhido.

- [ ] **Step 5: Typecheck, test, commit**

```bash
pnpm --filter api exec tsc --noEmit && pnpm --filter api test
pnpm --filter web exec tsc --noEmit && pnpm --filter web test
git add apps/web/src/types/index.ts apps/web/src/pages/app/Clients.tsx apps/api/src/modules/clients apps/web/src/pages/portal/Requests.tsx apps/api/src/modules/portal
git commit -m "feat(clients): código do cliente + tipo de solicitação no portal"
```

---

## Task 9: Docs

**Files:**
- Modify: `docs/SPEC.md`
- Modify: `docs/TASKS.md`

- [ ] **Step 1:** Documentar `GET /tasks`, `/os-templates`, o `osTemplateId` em `/clients`/`/requests`,
  `codigo` em `/clients`, e o novo status `STARTED` em `docs/SPEC.md`, seguindo o formato já
  estabelecido nas seções existentes.

- [ ] **Step 2:** Entrada em `docs/TASKS.md` registrando a feature, com a data de hoje.

- [ ] **Step 3: commit**

```bash
git add docs/SPEC.md docs/TASKS.md
git commit -m "docs: documenta kanban dinâmico, templates de OS e código do cliente"
```

---

## Final Verification (after Task 9)

```bash
pnpm --filter api exec tsc --noEmit && pnpm --filter api test
pnpm --filter web exec tsc --noEmit && pnpm --filter web test
```

Smoke test manual: criar um Template de OS com 2 fases + 1 âncora de status intermediária; aprovar
uma solicitação do portal escolhendo esse tipo e confirmar que o board nasce com essas colunas;
mover uma tarefa `BLOCKED` entre duas colunas do tipo `Fase` e confirmar que o status **não** volta
pra `OPEN`; vincular uma Tarefa Recorrente a um cliente sem nenhum board existente e confirmar que
funciona; abrir a tela Tarefas, filtrar por `recurringTemplateId` de um template com mais de um
cliente vinculado, alternar pro modo Kanban e confirmar que aparecem tarefas de clientes diferentes
juntas, agrupadas por status.
