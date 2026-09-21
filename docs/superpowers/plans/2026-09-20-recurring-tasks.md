# Tarefas Recorrentes + Status Expandido + Checklist de Documentos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Motor de tarefas recorrentes (semanal/mensal/trimestral/anual) com status expandido (Aberto/Concluído/Desconsiderado/Com Impedimento) e dois checklists de documento por tarefa (cobrar do cliente / entregar ao cliente), com geração idempotente, isolada por falha e auditável.

**Architecture:** Novo módulo `recurring-templates` (CRUD de template + vínculo por cliente + geração manual + log), motor de geração reaproveitando o padrão BullMQ já existente (`duedate.cron.ts`), extensão de `tasks`/`portal` pros dois checklists e pro novo modelo de status, e um gate de visibilidade novo (`visibleToClient`) nos endpoints client-facing.

**Tech Stack:** Fastify v5 + Prisma v6 + TypeScript strict + BullMQ (backend), React 19 + TanStack Query + TailwindCSS (frontend) — mesma stack do resto do projeto, sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-09-20-recurring-tasks-design.md`

## Global Constraints

- TypeScript `strict: true` — sem `any`, sem `as unknown`.
- Validação Zod em toda entrada (body/params/query).
- Erros via `AppError` customizado (`statusCode` + `message`).
- Estrutura de módulo obrigatória: `<nome>.routes.ts` / `.service.ts` / `.schema.ts` / `.types.ts` quando aplicável.
- Testes com `vi.spyOn` (nunca `vi.mock`), seguindo a convenção já documentada em `docs/tech-debt.md`.
- Migration é destrutiva onde necessário (troca de enum `TaskStatus`) — banco atual é só de teste, mesma decisão já tomada e aplicada em 2a. Antes de rodar em ambiente com dado real, confirmar com o usuário.
- `dueRollToBusinessDay`/`targetRollToBusinessDay` ajustam só por fim de semana (sábado/domingo) — **não** existe hoje no projeto uma fonte de calendário de feriados brasileiros; ajuste por feriado fica como tech-debt documentado (Task 3), não implementado nesta fase.
- Todo endpoint novo de mutação em `recurring-templates` é `ORG_ADMIN`-only; leitura é `ORG_ADMIN`+`ORG_MANAGER` — mesmo padrão de `departments.routes.ts`.
- Nenhuma migration/comando destrutivo é confirmado por um subagent implementador — controller assume essa etapa (mesma regra já usada em 2a).

---

### Task 1: Schema Prisma — status expandido + tarefas recorrentes + checklists

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_recurring_tasks/migration.sql`

**Interfaces:**
- Produces: enum `TaskStatus` com `OPEN | DONE | DISREGARDED | BLOCKED`; models `RecurringTaskTemplate`, `RecurringTaskTemplateDocument`, `RecurringTaskAssignment`, `RecurringGenerationLog`, `TaskDocumentRequirement`, `TaskDeliverable`; campos novos em `Task` (`competence`, `targetDate`, `recurringTemplateId`, `visibleToClient`).

- [ ] **Step 1: Editar `TaskStatus` no schema**

Localizar (hoje em `apps/api/prisma/schema.prisma`, dentro do bloco de enums perto de `Task`):

```prisma
enum TaskStatus {
  OPEN
  IN_PROGRESS
  REVIEW
  DONE
  CANCELLED
}
```

Substituir por:

```prisma
enum TaskStatus {
  OPEN
  DONE
  DISREGARDED
  BLOCKED
}
```

- [ ] **Step 2: Adicionar campos novos em `Task`**

No model `Task`, adicionar (perto de `departmentId`/`tags`) e **tornar `creatorId` opcional** (hoje é `String` obrigatório — tarefas geradas pelo motor de recorrência não têm um usuário humano criador, ver Task 6):

```prisma
model Task {
  // ...campos existentes (id, title, description, position, priority, status, dueDate, columnId, assigneeId, sourceRequestId, departmentId, tags, createdAt, updatedAt)...
  creatorId           String?     // era String obrigatório — vira opcional (null = gerada pelo motor de recorrência, sem criador humano)
  competence          DateTime?
  targetDate          DateTime?
  recurringTemplateId String?
  visibleToClient     Boolean  @default(true)

  // ...relations existentes (column, assignee, department, comments, history, attachments, sourceForRequest)...
  creator                 User?                     @relation("TaskCreator", fields: [creatorId], references: [id])  // era User obrigatório, vira User?
  recurringTemplate       RecurringTaskTemplate?    @relation(fields: [recurringTemplateId], references: [id])
  documentRequirements    TaskDocumentRequirement[]
  deliverables            TaskDeliverable[]

  @@index([status])
  @@index([priority])
  @@index([dueDate])
  @@index([title])
  @@index([competence])
  @@index([targetDate])
  @@map("tasks")
}
```

Essa mudança de `creatorId`/`creator` de obrigatório pra opcional é compatível com dado existente (relaxar uma constraint NOT NULL não é destrutivo — ao contrário da mudança de enum do Step 1, essa parte da migration não precisa de confirmação especial, `prisma migrate dev` deveria aceitar direto).

- [ ] **Step 3: Novos models de recorrência**

Adicionar ao final do arquivo (antes do último `enum` existente, ou em qualquer lugar coerente — Prisma não exige ordem):

```prisma
model RecurringTaskTemplate {
  id             String                @id @default(cuid())
  organizationId String
  departmentId   String
  title          String
  description    String?
  periodicity    RecurrencePeriodicity

  dueMonthOffset       Int     @default(0)
  dueDayOfPeriod       Int
  dueRollToBusinessDay Boolean @default(false)

  targetOffsetDays        Int     @default(0)
  targetRollToBusinessDay Boolean @default(false)

  generationMonthOffset Int @default(1)
  generationDayOfPeriod Int

  autoCompleteOnAllActivitiesDone Boolean @default(false)

  notifyViaWhatsapp Boolean @default(true)
  notifyViaEmail    Boolean @default(false)

  visibleToClient Boolean @default(true)

  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization       Organization                   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  department         Department                     @relation(fields: [departmentId], references: [id])
  documentRequests    RecurringTaskTemplateDocument[] @relation("TemplateDocumentRequests")
  documentDeliveries  RecurringTaskTemplateDocument[] @relation("TemplateDocumentDeliveries")
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

model RecurringTaskTemplateDocument {
  id                 String  @id @default(cuid())
  requestTemplateId  String?
  deliveryTemplateId String?
  name               String
  position           Int

  requestTemplate  RecurringTaskTemplate? @relation("TemplateDocumentRequests", fields: [requestTemplateId], references: [id], onDelete: Cascade)
  deliveryTemplate RecurringTaskTemplate? @relation("TemplateDocumentDeliveries", fields: [deliveryTemplateId], references: [id], onDelete: Cascade)

  @@map("recurring_task_template_documents")
}

model RecurringTaskAssignment {
  id         String   @id @default(cuid())
  templateId String
  clientId   String
  boardId    String
  columnId   String
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())

  template RecurringTaskTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  client   Client                @relation(fields: [clientId], references: [id], onDelete: Cascade)
  board    Board                 @relation(fields: [boardId], references: [id], onDelete: Cascade)
  column   Column                @relation(fields: [columnId], references: [id], onDelete: Cascade)

  @@unique([templateId, clientId])
  @@map("recurring_task_assignments")
}

model RecurringGenerationLog {
  id           String           @id @default(cuid())
  templateId   String
  clientId     String
  competence   DateTime
  status       GenerationStatus
  taskId       String?
  errorMessage String?
  createdAt    DateTime         @default(now())

  template RecurringTaskTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@unique([templateId, clientId, competence])
  @@map("recurring_generation_logs")
}

enum GenerationStatus {
  SUCCESS
  FAILED
}

model TaskDocumentRequirement {
  id              String                     @id @default(cuid())
  taskId          String
  name            String
  status          DocumentRequirementStatus  @default(PENDING)
  attachmentId    String?                    @unique
  rejectionReason String?
  reviewedById    String?
  reviewedAt      DateTime?
  position        Int
  createdAt       DateTime                   @default(now())
  updatedAt       DateTime                   @updatedAt

  task       Task        @relation(fields: [taskId], references: [id], onDelete: Cascade)
  attachment Attachment? @relation(fields: [attachmentId], references: [id])
  reviewedBy User?       @relation(fields: [reviewedById], references: [id])

  @@map("task_document_requirements")
}

enum DocumentRequirementStatus {
  PENDING
  UPLOADED
  APPROVED
  REJECTED
}

model TaskDeliverable {
  id            String    @id @default(cuid())
  taskId        String
  name          String
  attachmentId  String?   @unique
  deliveredById String?
  deliveredAt   DateTime?
  position      Int
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  task        Task        @relation(fields: [taskId], references: [id], onDelete: Cascade)
  attachment  Attachment? @relation(fields: [attachmentId], references: [id])
  deliveredBy User?       @relation(fields: [deliveredById], references: [id])

  @@map("task_deliverables")
}
```

- [ ] **Step 4: Reverse relations em models existentes**

Em `Organization`, adicionar `recurringTaskTemplates RecurringTaskTemplate[]`. Em `Department`, adicionar `recurringTaskTemplates RecurringTaskTemplate[]` e `tasks` já existe (mantido). Em `Client`, adicionar `recurringTaskAssignments RecurringTaskAssignment[]`. Em `Board`, adicionar `recurringTaskAssignments RecurringTaskAssignment[]`. Em `Column`, adicionar `recurringTaskAssignments RecurringTaskAssignment[]`. Em `Attachment`, adicionar `documentRequirement TaskDocumentRequirement?` e `deliverable TaskDeliverable?` (lado inverso do `@unique` acima — Prisma exige a relação declarada dos dois lados). Em `User`, adicionar `reviewedDocumentRequirements TaskDocumentRequirement[]` e `deliveredDeliverables TaskDeliverable[]` — sem precisar de `@relation("nome")` explícito nessas duas, porque `User` já tem 3 relações nomeadas com `Task` (`TaskAssignee`/`TaskCreator`/`BoardResponsible`, ambíguas entre si, por isso nomeadas), mas só **uma** relação com `TaskDocumentRequirement` e só **uma** com `TaskDeliverable` — sem ambiguidade, Prisma infere o nome sozinho. O código de `TaskDocumentRequirement.reviewedBy`/`TaskDeliverable.deliveredBy` no Step 3 já está correto como está (sem `@relation("nome")`), não precisa de ajuste.

- [ ] **Step 4b: Dois eventos de notificação novos**

O motor de geração (Task 7) precisa alertar o `ORG_ADMIN` quando uma geração falha, e o fluxo de documento (Task 9) precisa avisar o cliente quando um documento é rejeitado — nenhum dos dois eventos existe hoje. Editar o enum `NotificationEvent`:

```prisma
enum NotificationEvent {
  TASK_CREATED
  TASK_MOVED
  TASK_COMPLETED
  TASK_COMMENT_ADDED
  TASK_DUE_DATE_APPROACHING
  REQUEST_CREATED
  REQUEST_APPROVED
  REQUEST_REJECTED
  RECURRING_GENERATION_FAILED
  DOCUMENT_REJECTED
}
```

E adicionar 2 flags em `NotificationConfig` (mesmo padrão das existentes, `@default(true)` porque são alertas operacionais/de exceção — diferente de `taskCreated` que é `@default(false)`):

```prisma
model NotificationConfig {
  // ...campos existentes...
  recurringGenerationFailed Boolean @default(true)
  documentRejected          Boolean @default(true)
}
```

- [ ] **Step 5: Rodar `pnpm --filter api exec prisma validate`**

Confirma que o schema é sintaticamente válido antes de gerar a migration. Corrigir qualquer nome de relação faltando do lado inverso.

- [ ] **Step 6: Migration — PARAR antes de aplicar**

`prisma migrate dev` provavelmente recusa não-interativo (troca de enum com valores removidos é uma mudança com potencial perda de dado, mesmo padrão já visto em 2a). **Implementador: pare aqui e reporte BLOCKED** pedindo pro controller rodar a migration manualmente — não confirme nenhum prompt destrutivo sozinho. O controller vai: (a) confirmar que nenhuma linha usa `IN_PROGRESS`/`REVIEW`/`CANCELLED` hoje (`SELECT status, count(*) FROM tasks GROUP BY status` no banco de dev/test), (b) escrever a migration SQL manualmente seguindo as convenções de nomenclatura já usadas nas migrations anteriores do projeto (conferir `20260920160000_add_departments/migration.sql` como referência de estilo — inclusive o comentário de aviso que esse arquivo ganhou no fix wave de 2a), (c) aplicar via `migrate deploy` nos bancos de dev (5432) e teste (5433).

- [ ] **Step 7: `pnpm --filter api exec prisma generate`**

Depois que o controller aplicar a migration, regenerar o client Prisma antes de qualquer outro task rodar (mesmo passo que já causou uma falha de CI em 2a por client desatualizado — não pular).

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): schema de tarefas recorrentes, status expandido e checklists de documento"
```

---

### Task 2: Limpeza mecânica do `TaskStatus` antigo (IN_PROGRESS/REVIEW/CANCELLED)

**Depende de:** Task 1 (schema aplicado + client Prisma regenerado).

**Files:**
- Modify: `apps/api/src/modules/dashboard/dashboard.service.ts`
- Modify: `apps/api/src/modules/dashboard/dashboard.types.ts`
- Modify: `apps/api/src/modules/boards/boards.schema.ts`
- Modify: `apps/api/src/modules/boards/boards.service.ts`
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/pages/app/DashboardMetrics.tsx`
- Modify: `apps/web/src/pages/app/Processes.tsx`
- Modify: `apps/web/src/pages/portal/Board.tsx`
- Modify: `apps/web/src/pages/portal/Boards.tsx`

**Interfaces:**
- Consumes: `TaskStatus` novo (`OPEN | DONE | DISREGARDED | BLOCKED`) do Task 1.

Todo lugar do código que filtra/exibe por `IN_PROGRESS`/`REVIEW`/`CANCELLED` (nunca escritos por rota nenhuma, confirmado durante o brainstorming) precisa trocar pra usar o novo enum. Regra de tradução: qualquer filtro que hoje é `notIn: ['DONE', 'CANCELLED']` (ou `status !== 'CANCELLED'`) — "conta como tarefa ativa" — vira `notIn: ['DONE', 'DISREGARDED']` (`BLOCKED` continua contando como ativa/em risco, é o comportamento certo: uma tarefa com impedimento ainda é uma pendência real, só uma `DISREGARDED` sai da conta).

- [ ] **Step 1: `apps/api/src/modules/dashboard/dashboard.service.ts`**

Trocar as 3 ocorrências de `status: { notIn: ['DONE', 'CANCELLED'] }` por `status: { notIn: ['DONE', 'DISREGARDED'] }`. Trocar a construção final:

```typescript
tasksByStatus: {
  OPEN: statusMap['OPEN'] ?? 0,
  IN_PROGRESS: statusMap['IN_PROGRESS'] ?? 0,
  REVIEW: statusMap['REVIEW'] ?? 0,
  DONE: statusMap['DONE'] ?? 0,
},
```

por:

```typescript
tasksByStatus: {
  OPEN: statusMap['OPEN'] ?? 0,
  BLOCKED: statusMap['BLOCKED'] ?? 0,
  DONE: statusMap['DONE'] ?? 0,
  DISREGARDED: statusMap['DISREGARDED'] ?? 0,
},
```

- [ ] **Step 2: `apps/api/src/modules/dashboard/dashboard.types.ts`**

```typescript
export interface DashboardMetrics {
  kpis: {
    activeBoards: number
    overdueBoards: number
    completedTasksThisMonth: number
    urgentOpenTasks: number
  }
  tasksByStatus: {
    OPEN: number
    BLOCKED: number
    DONE: number
    DISREGARDED: number
  }
  atRisk: Array<{
    boardId: string
    boardTitle: string
    clientName: string
    mostUrgentDueDate: string | null
    daysOverdue: number
  }>
}
```

- [ ] **Step 3: `apps/api/src/modules/boards/boards.schema.ts`**

```typescript
status: z.enum(['OPEN', 'DONE', 'DISREGARDED', 'BLOCKED']).optional(),
```

(era `z.enum(['OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CANCELLED']).optional()`.)

- [ ] **Step 4: `apps/api/src/modules/boards/boards.service.ts`**

Trocar as 3 ocorrências de `status: { notIn: ['DONE', 'CANCELLED'] }` por `status: { notIn: ['DONE', 'DISREGARDED'] }` (linhas 35, 45, 58 no arquivo atual).

- [ ] **Step 5: `apps/web/src/types/index.ts`**

Linha 6, trocar:

```typescript
status: 'OPEN' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'CANCELLED'
```

por:

```typescript
status: 'OPEN' | 'DONE' | 'DISREGARDED' | 'BLOCKED'
```

(**Não** mexer na linha do `ClientRequest['status']`, que é um enum diferente e continua tendo `CANCELLED`.)

- [ ] **Step 6: `apps/web/src/pages/app/DashboardMetrics.tsx`**

Trocar a interface `Metrics['tasksByStatus']`, `STATUS_LABELS` e `STATUS_COLORS`:

```typescript
tasksByStatus: {
  OPEN: number
  BLOCKED: number
  DONE: number
  DISREGARDED: number
}
```

```typescript
const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Aberto',
  BLOCKED: 'Com Impedimento',
  DONE: 'Concluído',
  DISREGARDED: 'Desconsiderado',
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-accent',
  BLOCKED: 'bg-danger-text',
  DONE: 'bg-success-text',
  DISREGARDED: 'bg-neutral-text',
}
```

Remover o comentário sobre `REVIEW` usar roxo fora dos tokens (não se aplica mais — os 4 status novos já usam tokens semânticos existentes, `neutral-text` pro Desconsiderado). Se `neutral-text` não existir como token, usar `text-muted-foreground`-equivalente de fundo já usado em outro badge neutro do projeto (conferir `index.css` antes de inventar um token novo).

- [ ] **Step 7: `apps/web/src/pages/app/Processes.tsx`**

4 ocorrências de `'CANCELLED'` (linhas 20, 34, 45, 243 no arquivo atual) — todas trocam por `'DISREGARDED'`.

- [ ] **Step 8: `apps/web/src/pages/portal/Board.tsx`**

1 ocorrência de `t.status !== 'CANCELLED'` → `t.status !== 'DISREGARDED'`.

- [ ] **Step 9: `apps/web/src/pages/portal/Boards.tsx`**

2 ocorrências (`getProgress`, `getCurrentStage`) de `'CANCELLED'` → `'DISREGARDED'`.

- [ ] **Step 10: Rodar typecheck**

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter web exec tsc --noEmit
```

Ambos devem ficar limpos — qualquer erro remanescente indica um uso de `IN_PROGRESS`/`REVIEW`/`CANCELLED` (pro `Task['status']`) que não foi pego nesta varredura.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/dashboard apps/api/src/modules/boards/boards.schema.ts apps/api/src/modules/boards/boards.service.ts apps/web/src/types/index.ts apps/web/src/pages/app/DashboardMetrics.tsx apps/web/src/pages/app/Processes.tsx apps/web/src/pages/portal/Board.tsx apps/web/src/pages/portal/Boards.tsx
git commit -m "refactor: atualizar todos os consumidores do TaskStatus pro novo enum de 4 valores"
```

---

### Task 3: Utilitário de cálculo de datas de recorrência (funções puras, sem I/O)

**Depende de:** nenhuma (funções puras, não tocam banco).

**Files:**
- Create: `apps/api/src/modules/recurring-templates/recurrence-dates.ts`
- Test: `apps/api/src/modules/recurring-templates/recurrence-dates.test.ts`

**Interfaces:**
- Produces: `computeDueDate`, `computeTargetDate`, `computeCompetencesToGenerate` — usadas pelo motor de geração (Task 6) e pela validação de payload do template (Task 4).

Todas as datas são tratadas em UTC (`Date.UTC(...)`/`getUTCFullYear` etc) pra evitar bug de fuso horário em cálculo de dia-do-mês — mesma prática seguinda noutros pontos de data do projeto.

- [ ] **Step 1: Escrever os testes primeiro**

```typescript
import { describe, it, expect } from 'vitest'
import {
  computeDueDate,
  computeTargetDate,
  computeCompetencesToGenerate,
  computeCurrentPeriodStart,
  type RecurrenceDateRules,
} from './recurrence-dates'

const monthlyRules: RecurrenceDateRules = {
  periodicity: 'MONTHLY',
  dueMonthOffset: 1,
  dueDayOfPeriod: 15,
  dueRollToBusinessDay: false,
  targetOffsetDays: -2,
  targetRollToBusinessDay: false,
  generationMonthOffset: 1,
  generationDayOfPeriod: 20,
}

describe('computeDueDate', () => {
  it('mensal: competência fevereiro, vence dia 15 de março (dueMonthOffset=1)', () => {
    const competence = new Date(Date.UTC(2026, 1, 1)) // 2026-02-01
    const due = computeDueDate(competence, monthlyRules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-03-15')
  })

  it('trimestral: competência Q1 (jan), vence dia 10 do 3º mês do trimestre (março)', () => {
    const rules: RecurrenceDateRules = {
      ...monthlyRules,
      periodicity: 'QUARTERLY',
      dueMonthOffset: 2,
      dueDayOfPeriod: 10,
    }
    const competence = new Date(Date.UTC(2026, 0, 1)) // 2026-01-01
    const due = computeDueDate(competence, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-03-10')
  })

  it('anual: competência jan/2027, vence dia 31 do 3º mês depois (março/2027)', () => {
    const rules: RecurrenceDateRules = {
      ...monthlyRules,
      periodicity: 'ANNUAL',
      dueMonthOffset: 2,
      dueDayOfPeriod: 31,
    }
    const competence = new Date(Date.UTC(2027, 0, 1))
    const due = computeDueDate(competence, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2027-03-31')
  })

  it('semanal: competência é a segunda-feira da semana; dueDayOfPeriod=5 (sexta) cai na mesma semana', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'WEEKLY', dueDayOfPeriod: 5 }
    const competence = new Date(Date.UTC(2026, 1, 2)) // segunda-feira 2026-02-02
    const due = computeDueDate(competence, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-02-06') // sexta da mesma semana
  })

  it('ajusta pro próximo dia útil quando dueRollToBusinessDay=true e a data cai num sábado', () => {
    // competência fevereiro + dueMonthOffset=1 (herdado de monthlyRules) = base março; dia 14 de março de 2026 é um sábado
    const rules: RecurrenceDateRules = { ...monthlyRules, dueDayOfPeriod: 14, dueRollToBusinessDay: true }
    const competence = new Date(Date.UTC(2026, 1, 1))
    const due = computeDueDate(competence, rules)
    expect(due.getUTCDay()).not.toBe(0)
    expect(due.getUTCDay()).not.toBe(6)
    expect(due.toISOString().slice(0, 10)).toBe('2026-03-16') // segunda seguinte
  })

  it('ajusta o dia pro último dia do mês quando dueDayOfPeriod excede os dias do mês de destino', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, dueMonthOffset: 0, dueDayOfPeriod: 31 }
    const competence = new Date(Date.UTC(2026, 3, 1)) // abril, tem 30 dias
    const due = computeDueDate(competence, rules)
    expect(due.toISOString().slice(0, 10)).toBe('2026-04-30')
  })
})

describe('computeTargetDate', () => {
  it('meta = vencimento + targetOffsetDays (negativo = antes)', () => {
    const due = new Date(Date.UTC(2026, 2, 15)) // 2026-03-15
    const target = computeTargetDate(due, monthlyRules)
    expect(target.toISOString().slice(0, 10)).toBe('2026-03-13')
  })

  it('ajusta a meta pro próximo dia útil independente do ajuste do vencimento', () => {
    // due=2026-03-16 (segunda) + targetOffsetDays=-1 = 2026-03-15 (domingo) — cai em fim de semana
    const rules: RecurrenceDateRules = { ...monthlyRules, targetOffsetDays: -1, targetRollToBusinessDay: true }
    const due = new Date(Date.UTC(2026, 2, 16)) // segunda 2026-03-16 -> meta cai em 2026-03-15 (domingo)
    const target = computeTargetDate(due, rules)
    expect(target.toISOString().slice(0, 10)).toBe('2026-03-16') // empurra pra segunda
  })
})

describe('computeCompetencesToGenerate', () => {
  it('mensal: dispara só no dia configurado, gera 1 competência (mês seguinte)', () => {
    const trigger = new Date(Date.UTC(2026, 0, 20)) // 20 de janeiro
    const notTrigger = new Date(Date.UTC(2026, 0, 19))
    expect(computeCompetencesToGenerate(trigger, monthlyRules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-02-01'])
    expect(computeCompetencesToGenerate(notTrigger, monthlyRules)).toEqual([])
  })

  it('trimestral: só gera quando o mês seguinte inicia um trimestre novo', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'QUARTERLY' }
    const triggersNewQuarter = new Date(Date.UTC(2025, 11, 20)) // dezembro -> gera Q1 (janeiro)
    const doesNotTrigger = new Date(Date.UTC(2026, 0, 20)) // janeiro -> mês seguinte é fevereiro, não é início de trimestre
    expect(computeCompetencesToGenerate(triggersNewQuarter, rules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2026-01-01'])
    expect(computeCompetencesToGenerate(doesNotTrigger, rules)).toEqual([])
  })

  it('anual: só gera quando o mês seguinte é janeiro', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'ANNUAL' }
    const triggersNewYear = new Date(Date.UTC(2026, 11, 20)) // dezembro -> gera ano seguinte
    const doesNotTrigger = new Date(Date.UTC(2026, 0, 20))
    expect(computeCompetencesToGenerate(triggersNewYear, rules).map((d) => d.toISOString().slice(0, 10)))
      .toEqual(['2027-01-01'])
    expect(computeCompetencesToGenerate(doesNotTrigger, rules)).toEqual([])
  })

  it('semanal: gera uma competência por cada dueDayOfPeriod que cai no mês seguinte inteiro', () => {
    const rules: RecurrenceDateRules = { ...monthlyRules, periodicity: 'WEEKLY', dueDayOfPeriod: 1 } // segundas-feiras
    const trigger = new Date(Date.UTC(2026, 0, 20)) // gera pro mês de fevereiro/2026
    const mondaysOfFebruary2026 = computeCompetencesToGenerate(trigger, rules).map((d) => d.toISOString().slice(0, 10))
    expect(mondaysOfFebruary2026).toEqual(['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23'])
  })
})

describe('computeCurrentPeriodStart', () => {
  it('mensal: início do mês corrente', () => {
    const today = new Date(Date.UTC(2026, 2, 17)) // 17 de março
    expect(computeCurrentPeriodStart(today, 'MONTHLY').toISOString().slice(0, 10)).toBe('2026-03-01')
  })

  it('semanal: segunda-feira da semana corrente', () => {
    const today = new Date(Date.UTC(2026, 2, 18)) // quarta-feira 2026-03-18
    expect(computeCurrentPeriodStart(today, 'WEEKLY').toISOString().slice(0, 10)).toBe('2026-03-16')
  })

  it('trimestral: início do trimestre corrente', () => {
    const today = new Date(Date.UTC(2026, 4, 10)) // maio -> Q2 começa em abril
    expect(computeCurrentPeriodStart(today, 'QUARTERLY').toISOString().slice(0, 10)).toBe('2026-04-01')
  })

  it('anual: início do ano corrente', () => {
    const today = new Date(Date.UTC(2026, 7, 1))
    expect(computeCurrentPeriodStart(today, 'ANNUAL').toISOString().slice(0, 10)).toBe('2026-01-01')
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham** (módulo ainda não existe)

```bash
pnpm --filter api exec vitest run src/modules/recurring-templates/recurrence-dates.test.ts
```
Esperado: falha de import (`recurrence-dates` não existe).

- [ ] **Step 3: Implementar `recurrence-dates.ts`**

```typescript
export type Periodicity = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'

export interface RecurrenceDateRules {
  periodicity: Periodicity
  dueMonthOffset: number
  dueDayOfPeriod: number
  dueRollToBusinessDay: boolean
  targetOffsetDays: number
  targetRollToBusinessDay: boolean
  generationMonthOffset: number
  generationDayOfPeriod: number
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

function rollToNextBusinessDay(date: Date): Date {
  const result = new Date(date)
  while (isWeekend(result)) {
    result.setUTCDate(result.getUTCDate() + 1)
  }
  return result
}

function clampDayOfMonth(year: number, monthIndex: number, day: number): number {
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return Math.min(day, daysInMonth)
}

function addMonthsUTC(date: Date, months: number): Date {
  const result = new Date(date)
  result.setUTCMonth(result.getUTCMonth() + months)
  return result
}

function addDaysUTC(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

function startOfMonthUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

/** Segunda-feira da semana ISO em que `date` cai (ou a própria data, se já for segunda). */
function mondayOfWeek(date: Date): Date {
  const isoDay = date.getUTCDay() === 0 ? 7 : date.getUTCDay() // 1=segunda..7=domingo
  return addDaysUTC(date, 1 - isoDay)
}

export function computeDueDate(competence: Date, rules: RecurrenceDateRules): Date {
  let due: Date
  if (rules.periodicity === 'WEEKLY') {
    // competence é sempre a segunda-feira da semana; dueDayOfPeriod é 1(segunda)-7(domingo)
    due = addDaysUTC(competence, rules.dueDayOfPeriod - 1)
  } else {
    const base = addMonthsUTC(competence, rules.dueMonthOffset)
    const year = base.getUTCFullYear()
    const month = base.getUTCMonth()
    const day = clampDayOfMonth(year, month, rules.dueDayOfPeriod)
    due = new Date(Date.UTC(year, month, day))
  }
  return rules.dueRollToBusinessDay ? rollToNextBusinessDay(due) : due
}

export function computeTargetDate(dueDate: Date, rules: RecurrenceDateRules): Date {
  const target = addDaysUTC(dueDate, rules.targetOffsetDays)
  return rules.targetRollToBusinessDay ? rollToNextBusinessDay(target) : target
}

/**
 * Retorna as competências a gerar hoje, ou [] se hoje não é o dia de gatilho
 * do template (`generationDayOfPeriod`, sempre dia-do-mês, pras 4 periodicidades).
 */
export function computeCompetencesToGenerate(today: Date, rules: RecurrenceDateRules): Date[] {
  const year = today.getUTCFullYear()
  const month = today.getUTCMonth()
  const triggerDay = clampDayOfMonth(year, month, rules.generationDayOfPeriod)
  if (today.getUTCDate() !== triggerDay) return []

  const nextMonthStart = addMonthsUTC(startOfMonthUTC(today), 1)

  switch (rules.periodicity) {
    case 'MONTHLY':
      return [nextMonthStart]

    case 'QUARTERLY':
      return nextMonthStart.getUTCMonth() % 3 === 0 ? [nextMonthStart] : []

    case 'ANNUAL':
      return nextMonthStart.getUTCMonth() === 0 ? [nextMonthStart] : []

    case 'WEEKLY': {
      const nextMonthEnd = addMonthsUTC(nextMonthStart, 1)
      const competences: Date[] = []
      let cursor = mondayOfWeek(nextMonthStart)
      if (cursor < nextMonthStart) cursor = addDaysUTC(cursor, 7)
      while (cursor < nextMonthEnd) {
        competences.push(cursor)
        cursor = addDaysUTC(cursor, 7)
      }
      return competences
    }
  }
}

/**
 * Início do período de competência corrente (não o próximo) — usado só pela
 * geração manual (Task 7), que não espera o gatilho `generationDayOfPeriod`
 * bater; o operador escolhe rodar na hora, pro período que está valendo hoje.
 */
export function computeCurrentPeriodStart(today: Date, periodicity: Periodicity): Date {
  switch (periodicity) {
    case 'MONTHLY':
      return startOfMonthUTC(today)
    case 'WEEKLY':
      return mondayOfWeek(today)
    case 'QUARTERLY': {
      const quarterStartMonth = Math.floor(today.getUTCMonth() / 3) * 3
      return new Date(Date.UTC(today.getUTCFullYear(), quarterStartMonth, 1))
    }
    case 'ANNUAL':
      return new Date(Date.UTC(today.getUTCFullYear(), 0, 1))
  }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

```bash
pnpm --filter api exec vitest run src/modules/recurring-templates/recurrence-dates.test.ts
```
Esperado: todos os testes passando. Atenção especial ao teste de `dueRollToBusinessDay` — recalcular manualmente o dia da semana esperado se o ano-base do exemplo mudar (2026-02-14 cai num sábado; se o step 1 for copiado literalmente, os valores já estão certos pra 2026).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/recurring-templates/recurrence-dates.ts apps/api/src/modules/recurring-templates/recurrence-dates.test.ts
git commit -m "feat: funções puras de cálculo de vencimento/meta/competência pra tarefas recorrentes"
```

---

### Task 4: Módulo `recurring-templates` — CRUD de template + duas listas de documento

**Depende de:** Task 1 (schema), Task 3 (`recurrence-dates.ts`, usado pra validar `dueDayOfPeriod`/`generationDayOfPeriod`).

**Files:**
- Create: `apps/api/src/modules/recurring-templates/recurring-templates.schema.ts`
- Create: `apps/api/src/modules/recurring-templates/recurring-templates.service.ts`
- Create: `apps/api/src/modules/recurring-templates/recurring-templates.routes.ts`
- Create: `apps/api/src/modules/recurring-templates/recurring-templates.service.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `assertDepartmentBelongsToOrg` de `@/modules/departments/departments.service` (padrão criado no fix wave de 2a).
- Produces: `createTemplate`, `updateTemplate`, `deleteTemplate`, `listTemplates`, `getTemplateById` — usadas por Task 5 (assignments) e Task 6 (motor de geração).

- [ ] **Step 1: `recurring-templates.schema.ts`**

```typescript
import { z } from 'zod'

const documentItemSchema = z.object({
  name: z.string().trim().min(1, 'Nome do documento obrigatório'),
})

export const createTemplateSchema = z.object({
  departmentId: z.string().cuid(),
  title: z.string().trim().min(1, 'Título obrigatório'),
  description: z.string().optional(),
  periodicity: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL']),

  dueMonthOffset: z.number().int().min(0).default(0),
  dueDayOfPeriod: z.number().int().min(1).max(31),
  dueRollToBusinessDay: z.boolean().default(false),

  targetOffsetDays: z.number().int().default(0),
  targetRollToBusinessDay: z.boolean().default(false),

  generationMonthOffset: z.number().int().min(0).default(1),
  generationDayOfPeriod: z.number().int().min(1).max(31),

  autoCompleteOnAllActivitiesDone: z.boolean().default(false),
  notifyViaWhatsapp: z.boolean().default(true),
  notifyViaEmail: z.boolean().default(false),
  visibleToClient: z.boolean().default(true),
  isActive: z.boolean().default(true),

  documentRequests: z.array(documentItemSchema).default([]),
  documentDeliveries: z.array(documentItemSchema).default([]),
})

export const updateTemplateSchema = createTemplateSchema.partial().extend({
  // departmentId/periodicity ficam editáveis também — não há razão pra travar depois de criado
})

export type CreateTemplateBody = z.infer<typeof createTemplateSchema>
export type UpdateTemplateBody = z.infer<typeof updateTemplateSchema>

export const createAssignmentSchema = z.object({
  clientId: z.string().cuid(),
  boardId: z.string().cuid(),
  columnId: z.string().cuid(),
})

export const updateAssignmentSchema = z.object({
  boardId: z.string().cuid().optional(),
  columnId: z.string().cuid().optional(),
  isActive: z.boolean().optional(),
})

export type CreateAssignmentBody = z.infer<typeof createAssignmentSchema>
export type UpdateAssignmentBody = z.infer<typeof updateAssignmentSchema>
```

Validação semântica de `dueDayOfPeriod`/`generationDayOfPeriod` (1-31, sempre; pra `WEEKLY` o `dueDayOfPeriod` é reinterpretado como 1-7 no service, ver Step 2 abaixo — o schema aceita até 31 porque o mesmo campo serve dia-do-mês nas outras 3 periodicidades, mas a service rejeita >7 quando `periodicity === 'WEEKLY'`).

- [ ] **Step 2: `recurring-templates.service.ts`**

```typescript
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { assertDepartmentBelongsToOrg } from '@/modules/departments/departments.service'
import type { CreateTemplateBody, UpdateTemplateBody } from './recurring-templates.schema'

function assertDayOfPeriodValid(periodicity: string, dueDayOfPeriod: number, generationDayOfPeriod: number) {
  if (periodicity === 'WEEKLY') {
    if (dueDayOfPeriod > 7) {
      throw new AppError(400, 'Periodicidade semanal: dia do vencimento deve ser de 1 (segunda) a 7 (domingo)')
    }
  }
  if (generationDayOfPeriod > 31 || generationDayOfPeriod < 1) {
    throw new AppError(400, 'Dia de geração deve ser de 1 a 31')
  }
}

export async function listTemplates(organizationId: string) {
  return prisma.recurringTaskTemplate.findMany({
    where: { organizationId },
    include: { department: { select: { id: true, name: true } }, documentRequests: true, documentDeliveries: true },
    orderBy: { title: 'asc' },
  })
}

export async function getTemplateById(id: string, organizationId: string) {
  const template = await prisma.recurringTaskTemplate.findFirst({
    where: { id, organizationId },
    include: { department: { select: { id: true, name: true } }, documentRequests: true, documentDeliveries: true },
  })
  if (!template) throw new AppError(404, 'Template não encontrado')
  return template
}

export async function createTemplate(organizationId: string, data: CreateTemplateBody) {
  await assertDepartmentBelongsToOrg(data.departmentId, organizationId)
  assertDayOfPeriodValid(data.periodicity, data.dueDayOfPeriod, data.generationDayOfPeriod)

  const { documentRequests, documentDeliveries, ...templateData } = data

  return prisma.recurringTaskTemplate.create({
    data: {
      ...templateData,
      organizationId,
      documentRequests: { create: documentRequests.map((d, i) => ({ name: d.name, position: i })) },
      documentDeliveries: { create: documentDeliveries.map((d, i) => ({ name: d.name, position: i })) },
    },
    include: { documentRequests: true, documentDeliveries: true },
  })
}

export async function updateTemplate(id: string, organizationId: string, data: UpdateTemplateBody) {
  const existing = await getTemplateById(id, organizationId)

  if (data.departmentId) await assertDepartmentBelongsToOrg(data.departmentId, organizationId)
  assertDayOfPeriodValid(
    data.periodicity ?? existing.periodicity,
    data.dueDayOfPeriod ?? existing.dueDayOfPeriod,
    data.generationDayOfPeriod ?? existing.generationDayOfPeriod,
  )

  const { documentRequests, documentDeliveries, ...templateData } = data

  return prisma.$transaction(async (tx) => {
    if (documentRequests) {
      await tx.recurringTaskTemplateDocument.deleteMany({ where: { requestTemplateId: id } })
      await tx.recurringTaskTemplateDocument.createMany({
        data: documentRequests.map((d, i) => ({ requestTemplateId: id, name: d.name, position: i })),
      })
    }
    if (documentDeliveries) {
      await tx.recurringTaskTemplateDocument.deleteMany({ where: { deliveryTemplateId: id } })
      await tx.recurringTaskTemplateDocument.createMany({
        data: documentDeliveries.map((d, i) => ({ deliveryTemplateId: id, name: d.name, position: i })),
      })
    }
    return tx.recurringTaskTemplate.update({
      where: { id },
      data: templateData,
      include: { documentRequests: true, documentDeliveries: true },
    })
  })
}

export async function deleteTemplate(id: string, organizationId: string) {
  await getTemplateById(id, organizationId)

  const assignmentsCount = await prisma.recurringTaskAssignment.count({ where: { templateId: id } })
  if (assignmentsCount > 0) {
    throw new AppError(409, 'Template em uso — remova os vínculos de cliente antes de excluir')
  }

  await prisma.recurringTaskTemplate.delete({ where: { id } })
  return { ok: true }
}
```

`documentRequests`/`documentDeliveries` no update substituem a lista inteira (delete-then-create, dentro da mesma transação) — mesmo padrão simples usado noutros CRUDs do projeto que recebem lista completa no payload, sem diff item a item. Tarefas já geradas não são afetadas (a cópia delas, `TaskDocumentRequirement`/`TaskDeliverable`, é independente — ver Task 6).

- [ ] **Step 3: `recurring-templates.routes.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createTemplateSchema, updateTemplateSchema } from './recurring-templates.schema'
import {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from './recurring-templates.service'

export async function recurringTemplatesRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    return reply.send(await listTemplates(request.user.organizationId!))
  })

  app.get('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getTemplateById(id, request.user.organizationId!))
  })

  app.addHook('preHandler', requireRole('ORG_ADMIN'))

  app.post('/', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = createTemplateSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createTemplate(request.user.organizationId!, result.data))
  })

  app.patch('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateTemplateSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateTemplate(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteTemplate(id, request.user.organizationId!))
  })
}
```

- [ ] **Step 4: Registrar em `server.ts`**

```typescript
import { recurringTemplatesRoutes } from '@/modules/recurring-templates/recurring-templates.routes'
// ...
app.register(recurringTemplatesRoutes, { prefix: '/recurring-templates' })
```

- [ ] **Step 5: Testes de `recurring-templates.service.ts`**

```typescript
import { describe, it, expect } from 'vitest'
import { createTemplate, updateTemplate, deleteTemplate, getTemplateById } from './recurring-templates.service'
import { createTestOrg, createTestPlan, createTestDepartment } from '@/test/helpers'

describe('createTemplate', () => {
  it('cria template com as duas listas de documento', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)

    const template = await createTemplate(org.id, {
      departmentId: dept.id,
      title: 'Folha de pagamento',
      periodicity: 'MONTHLY',
      dueMonthOffset: 1,
      dueDayOfPeriod: 15,
      dueRollToBusinessDay: false,
      targetOffsetDays: -2,
      targetRollToBusinessDay: false,
      generationMonthOffset: 1,
      generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false,
      notifyViaWhatsapp: true,
      notifyViaEmail: false,
      visibleToClient: true,
      isActive: true,
      documentRequests: [{ name: 'Ponto' }],
      documentDeliveries: [{ name: 'Resumo da folha' }, { name: 'Recibos' }],
    })

    expect(template.documentRequests).toHaveLength(1)
    expect(template.documentDeliveries).toHaveLength(2)
  })

  it('lança 404 se departmentId pertence a outra organização', async () => {
    const plan = await createTestPlan()
    const orgA = await createTestOrg(plan.id)
    const orgB = await createTestOrg(plan.id)
    const deptOfB = await createTestDepartment(orgB.id)

    await expect(
      createTemplate(orgA.id, {
        departmentId: deptOfB.id,
        title: 'X',
        periodicity: 'MONTHLY',
        dueMonthOffset: 0,
        dueDayOfPeriod: 10,
        dueRollToBusinessDay: false,
        targetOffsetDays: 0,
        targetRollToBusinessDay: false,
        generationMonthOffset: 1,
        generationDayOfPeriod: 5,
        autoCompleteOnAllActivitiesDone: false,
        notifyViaWhatsapp: true,
        notifyViaEmail: false,
        visibleToClient: true,
        isActive: true,
        documentRequests: [],
        documentDeliveries: [],
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('lança 400 se periodicidade semanal com dueDayOfPeriod > 7', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)

    await expect(
      createTemplate(org.id, {
        departmentId: dept.id,
        title: 'X',
        periodicity: 'WEEKLY',
        dueMonthOffset: 0,
        dueDayOfPeriod: 10,
        dueRollToBusinessDay: false,
        targetOffsetDays: 0,
        targetRollToBusinessDay: false,
        generationMonthOffset: 1,
        generationDayOfPeriod: 20,
        autoCompleteOnAllActivitiesDone: false,
        notifyViaWhatsapp: true,
        notifyViaEmail: false,
        visibleToClient: true,
        isActive: true,
        documentRequests: [],
        documentDeliveries: [],
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('updateTemplate', () => {
  it('substitui a lista de documentos inteira (delete-then-create), sem acumular', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const template = await createTemplate(org.id, {
      departmentId: dept.id,
      title: 'X',
      periodicity: 'MONTHLY',
      dueMonthOffset: 0,
      dueDayOfPeriod: 10,
      dueRollToBusinessDay: false,
      targetOffsetDays: 0,
      targetRollToBusinessDay: false,
      generationMonthOffset: 1,
      generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false,
      notifyViaWhatsapp: true,
      notifyViaEmail: false,
      visibleToClient: true,
      isActive: true,
      documentRequests: [{ name: 'A' }],
      documentDeliveries: [],
    })

    const updated = await updateTemplate(template.id, org.id, { documentRequests: [{ name: 'B' }, { name: 'C' }] })

    expect(updated.documentRequests.map((d) => d.name)).toEqual(['B', 'C'])
  })
})

describe('deleteTemplate', () => {
  it('lança 409 quando o template tem assignment vinculado', async () => {
    // coberto de ponta a ponta junto com createAssignment na Task 5 (depende de client/board/column de teste)
  })
})
```

- [ ] **Step 6: Rodar `pnpm --filter api test src/modules/recurring-templates` e confirmar que passam**

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/recurring-templates apps/api/src/server.ts
git commit -m "feat: módulo recurring-templates — CRUD de template com listas de documento a cobrar/entregar"
```

---

### Task 5: Vínculo cliente↔template (`RecurringTaskAssignment`)

**Depende de:** Task 4 (`recurring-templates.service.ts`/`.routes.ts` já existem, esta task estende os dois).

**Files:**
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.service.ts`
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.routes.ts`
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.service.test.ts`

**Interfaces:**
- Produces: `listAssignments`, `createAssignment`, `updateAssignment`, `deleteAssignment` — usadas pelo motor de geração (Task 6, que itera `isActive: true`).

- [ ] **Step 1: Adicionar ao `recurring-templates.service.ts`**

```typescript
import type { CreateAssignmentBody, UpdateAssignmentBody } from './recurring-templates.schema'

async function assertClientBoardColumnBelongToOrg(
  organizationId: string,
  clientId: string,
  boardId: string,
  columnId: string,
) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  const board = await prisma.board.findFirst({ where: { id: boardId, organizationId, clientId } })
  if (!board) throw new AppError(404, 'Processo não encontrado para este cliente')

  const column = await prisma.column.findFirst({ where: { id: columnId, boardId } })
  if (!column) throw new AppError(404, 'Coluna não encontrada neste processo')
}

export async function listAssignments(templateId: string, organizationId: string) {
  await getTemplateById(templateId, organizationId)
  return prisma.recurringTaskAssignment.findMany({
    where: { templateId },
    include: { client: { select: { id: true, name: true } }, board: { select: { id: true, title: true } } },
    orderBy: { createdAt: 'asc' },
  })
}

export async function createAssignment(templateId: string, organizationId: string, data: CreateAssignmentBody) {
  await getTemplateById(templateId, organizationId)
  await assertClientBoardColumnBelongToOrg(organizationId, data.clientId, data.boardId, data.columnId)

  const existing = await prisma.recurringTaskAssignment.findFirst({
    where: { templateId, clientId: data.clientId },
  })
  if (existing) throw new AppError(409, 'Este cliente já está vinculado a este template')

  return prisma.recurringTaskAssignment.create({ data: { templateId, ...data } })
}

async function getAssignmentOrThrow(templateId: string, assignmentId: string, organizationId: string) {
  await getTemplateById(templateId, organizationId)
  const assignment = await prisma.recurringTaskAssignment.findFirst({
    where: { id: assignmentId, templateId },
  })
  if (!assignment) throw new AppError(404, 'Vínculo não encontrado')
  return assignment
}

export async function updateAssignment(
  templateId: string,
  assignmentId: string,
  organizationId: string,
  data: UpdateAssignmentBody,
) {
  const assignment = await getAssignmentOrThrow(templateId, assignmentId, organizationId)

  if (data.boardId || data.columnId) {
    await assertClientBoardColumnBelongToOrg(
      organizationId,
      assignment.clientId,
      data.boardId ?? assignment.boardId,
      data.columnId ?? assignment.columnId,
    )
  }

  return prisma.recurringTaskAssignment.update({ where: { id: assignmentId }, data })
}

export async function deleteAssignment(templateId: string, assignmentId: string, organizationId: string) {
  await getAssignmentOrThrow(templateId, assignmentId, organizationId)
  await prisma.recurringTaskAssignment.delete({ where: { id: assignmentId } })
  return { ok: true }
}
```

- [ ] **Step 2: Adicionar rotas em `recurring-templates.routes.ts`**

Dentro do mesmo arquivo, ainda no bloco após o segundo `app.addHook('preHandler', requireRole('ORG_ADMIN'))` (mutação ORG_ADMIN-only, leitura aberta a ORG_MANAGER também — replicar o padrão de leitura liberada igual o `GET /:id` já feito no Step 3 da Task 4, então o `GET` de assignments precisa ficar ANTES do segundo hook, junto dos outros GETs):

```typescript
// mover pra cima do segundo app.addHook('preHandler', requireRole('ORG_ADMIN')), junto dos GETs existentes:
app.get('/:id/assignments', {
  preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
}, async (request, reply) => {
  const { id } = request.params as { id: string }
  return reply.send(await listAssignments(id, request.user.organizationId!))
})

// abaixo do segundo hook, junto das outras mutações:
app.post('/:id/assignments', { preHandler: [checkSubscription] }, async (request, reply) => {
  const { id } = request.params as { id: string }
  const result = createAssignmentSchema.safeParse(request.body)
  if (!result.success) throw new AppError(400, result.error.errors[0].message)
  return reply.status(201).send(await createAssignment(id, request.user.organizationId!, result.data))
})

app.patch('/:id/assignments/:assignmentId', { preHandler: [checkSubscription] }, async (request, reply) => {
  const { id, assignmentId } = request.params as { id: string; assignmentId: string }
  const result = updateAssignmentSchema.safeParse(request.body)
  if (!result.success) throw new AppError(400, result.error.errors[0].message)
  return reply.send(await updateAssignment(id, assignmentId, request.user.organizationId!, result.data))
})

app.delete('/:id/assignments/:assignmentId', { preHandler: [checkSubscription] }, async (request, reply) => {
  const { id, assignmentId } = request.params as { id: string; assignmentId: string }
  return reply.send(await deleteAssignment(id, assignmentId, request.user.organizationId!))
})
```

Atualizar os imports do arquivo (`createAssignmentSchema`, `updateAssignmentSchema` de `./recurring-templates.schema`; `listAssignments`, `createAssignment`, `updateAssignment`, `deleteAssignment` de `./recurring-templates.service`).

- [ ] **Step 3: Testes — adicionar a `recurring-templates.service.test.ts`**

```typescript
import { createAssignment, deleteAssignment } from './recurring-templates.service'
import { deleteTemplate } from './recurring-templates.service'
import {
  createTestClient,
  createTestBoard,
  createTestColumn,
} from '@/test/helpers'

describe('createAssignment', () => {
  it('vincula cliente a template com board/coluna válidos', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'X', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueRollToBusinessDay: false,
      targetOffsetDays: 0, targetRollToBusinessDay: false,
      generationMonthOffset: 1, generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })

    const assignment = await createAssignment(template.id, org.id, {
      clientId: client.id, boardId: board.id, columnId: col.id,
    })

    expect(assignment.clientId).toBe(client.id)
  })

  it('lança 409 ao vincular o mesmo cliente duas vezes ao mesmo template', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'X', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueRollToBusinessDay: false,
      targetOffsetDays: 0, targetRollToBusinessDay: false,
      generationMonthOffset: 1, generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    await createAssignment(template.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })

    await expect(
      createAssignment(template.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('lança 404 se o board não pertence ao cliente informado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const clientA = await createTestClient(org.id)
    const clientB = await createTestClient(org.id)
    const boardOfB = await createTestBoard(org.id, clientB.id)
    const col = await createTestColumn(boardOfB.id, { position: 0 })
    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'X', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueRollToBusinessDay: false,
      targetOffsetDays: 0, targetRollToBusinessDay: false,
      generationMonthOffset: 1, generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })

    await expect(
      createAssignment(template.id, org.id, { clientId: clientA.id, boardId: boardOfB.id, columnId: col.id }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('deleteTemplate (com assignment vinculado)', () => {
  it('lança 409 quando o template tem assignment vinculado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'X', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueRollToBusinessDay: false,
      targetOffsetDays: 0, targetRollToBusinessDay: false,
      generationMonthOffset: 1, generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    await createAssignment(template.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })

    await expect(deleteTemplate(template.id, org.id)).rejects.toMatchObject({ statusCode: 409 })
  })
})
```

Remover o teste placeholder de `deleteTemplate` deixado no Step 5 da Task 4 (substituído por este, que já tem o setup completo de client/board/column).

- [ ] **Step 4: Rodar `pnpm --filter api test src/modules/recurring-templates` e confirmar que passam**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/recurring-templates
git commit -m "feat: vínculo cliente↔template de recorrência (board/coluna por cliente)"
```

---

### Task 6: Plumbing de notificação — 2 eventos novos + override de canal por job

**Depende de:** Task 1 (enum `NotificationEvent`/`NotificationConfig` já migrados).

**Files:**
- Modify: `apps/api/src/lib/queue.ts`
- Modify: `apps/api/src/lib/template.ts`
- Modify: `apps/api/src/lib/default-templates.ts`
- Modify: `apps/api/src/workers/notification.worker.ts`

**Interfaces:**
- Produces: `NotificationJob.channels?: MessageChannel[]` — usado pelo motor de geração (Task 7) pra respeitar `notifyViaWhatsapp`/`notifyViaEmail` do template, escolhendo só os canais daquele template em vez do padrão da organização inteira.

Hoje o canal de notificação (`WHATSAPP`/`EMAIL`) é decidido só pela configuração da organização (`NotificationConfig.whatsappEnabled`/`emailEnabled`) — não existe um jeito de um job específico pedir "só WhatsApp" ou "só e-mail", mesmo que a org tenha os dois habilitados. Os toggles `notifyViaWhatsapp`/`notifyViaEmail` do `RecurringTaskTemplate` precisam desse override.

- [ ] **Step 1: `apps/api/src/lib/queue.ts` — adicionar `channels` opcional**

```typescript
import { Queue } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import type { MessageChannel } from '@prisma/client'

export interface NotificationJob {
  event: string
  organizationId: string
  recipientType?: 'CLIENT' | 'USER'
  clientId?: string
  userId?: string
  taskId?: string
  requestId?: string
  metadata: Record<string, string | undefined>
  channels?: MessageChannel[]  // quando presente, restringe os canais além do que a organização já habilita (interseção, nunca força um canal que a org desligou)
}

export const notificationQueue = new Queue('notification-queue', { connection: bullmqRedis })

export async function enqueueNotification(job: NotificationJob): Promise<void> {
  await notificationQueue.add(job.event, job, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  })
}
```

- [ ] **Step 2: `apps/api/src/lib/template.ts` — novas variáveis de template**

Adicionar à interface `TemplateVars`:

```typescript
export interface TemplateVars {
  clientName: string
  orgName: string
  taskTitle?: string
  requestTitle?: string
  rejectionReason?: string
  fromColumn?: string
  toColumn?: string
  dueDate?: string
  portalUrl: string
  commentText?: string
  commentAuthorName?: string
  documentName?: string      // novo — nome do documento rejeitado (DOCUMENT_REJECTED)
  templateTitle?: string     // novo — título do template de recorrência (RECURRING_GENERATION_FAILED)
  errorMessage?: string      // novo — mensagem de erro da geração (RECURRING_GENERATION_FAILED)
}
```

Atualizar `PREVIEW_VARS` com valores de exemplo pros 3 campos novos (usado na tela de preview de templates já existente):

```typescript
export const PREVIEW_VARS: TemplateVars = {
  clientName: 'João Silva',
  orgName: 'Escritório G2A',
  taskTitle: 'Abertura de LTDA',
  fromColumn: 'Documentação Pendente',
  toColumn: 'Em Revisão',
  dueDate: '30/06/2026',
  portalUrl: 'https://tramita.autohubs.com.br/portal',
  commentText: 'Documento recebido, obrigado!',
  commentAuthorName: 'Dr. Carlos Mendes',
  documentName: 'Extrato bancário',
  templateTitle: 'Folha de pagamento',
  errorMessage: 'Coluna do processo não encontrada',
}
```

- [ ] **Step 3: `apps/api/src/lib/default-templates.ts` — 2 entradas novas**

Adicionar ao objeto `DEFAULT_TEMPLATES` (o tipo `TemplateMap` já exige as 2 chaves novas por causa do enum editado no Task 1 — sem elas o arquivo não compila):

```typescript
  RECURRING_GENERATION_FAILED: {
    WHATSAPP: { body: 'Falha ao gerar a tarefa recorrente *{{templateTitle}}*: {{errorMessage}}' },
    EMAIL: { subject: 'Falha na geração de tarefa recorrente — {{templateTitle}}', body: 'A geração automática da tarefa recorrente *{{templateTitle}}* falhou.\n\nMotivo: {{errorMessage}}\n\nAcesse o painel pra reprocessar: {{portalUrl}}' },
  },
  DOCUMENT_REJECTED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! O documento *{{documentName}}* enviado em *{{taskTitle}}* foi rejeitado.\n\nMotivo: {{rejectionReason}}\n\nEnvie novamente: {{portalUrl}}' },
    EMAIL: { subject: 'Documento rejeitado — {{documentName}}', body: 'Olá, {{clientName}}!\n\nO documento *{{documentName}}* enviado em *{{taskTitle}}* foi rejeitado.\n\nMotivo: {{rejectionReason}}\n\nEnvie novamente em: {{portalUrl}}' },
  },
```

- [ ] **Step 4: `apps/api/src/workers/notification.worker.ts` — mapear os eventos e respeitar `channels`**

Adicionar ao `EVENT_FLAG_MAP`:

```typescript
const EVENT_FLAG_MAP: Record<string, keyof NotificationConfig> = {
  TASK_CREATED: 'taskCreated',
  TASK_MOVED: 'taskMoved',
  TASK_COMPLETED: 'taskCompleted',
  TASK_COMMENT_ADDED: 'commentAdded',
  TASK_DUE_DATE_APPROACHING: 'dueDateAlert',
  REQUEST_CREATED: 'requestCreated',
  REQUEST_APPROVED: 'requestApproved',
  REQUEST_REJECTED: 'requestRejected',
  RECURRING_GENERATION_FAILED: 'recurringGenerationFailed',
  DOCUMENT_REJECTED: 'documentRejected',
}
```

Em `processNotificationJob`, passar `job.data.channels` adiante:

```typescript
export async function processNotificationJob(job: { data: NotificationJob }): Promise<void> {
  const { event, organizationId, recipientType = 'CLIENT', clientId, userId, taskId, requestId, metadata, channels } =
    job.data

  const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
  if (!config) return

  const isEnabled = (config[EVENT_FLAG_MAP[event]] as boolean | undefined) ?? false
  if (!isEnabled) return

  if (recipientType === 'USER') {
    if (!userId) return
    await processUserNotification(config, { event, organizationId, userId, taskId, requestId, metadata })
    return
  }

  if (!clientId) return
  await processClientNotification(config, { event, organizationId, clientId, taskId, requestId, metadata, channels })
}
```

Em `processClientNotification`, aceitar `channels` no parâmetro e usar interseção na hora de montar a lista:

```typescript
async function processClientNotification(
  config: NotificationConfig,
  params: {
    event: string
    organizationId: string
    clientId: string
    taskId?: string
    requestId?: string
    metadata: Record<string, string | undefined>
    channels?: MessageChannel[]
  },
): Promise<void> {
  const { event, organizationId, clientId, taskId, requestId, metadata, channels: channelOverride } = params

  // ...trecho existente até calcular `vars` sem mudança...

  const channels: MessageChannel[] = []
  if (config.whatsappEnabled && client.whatsapp && config.maximizebotToken) channels.push('WHATSAPP')
  if (config.emailEnabled) channels.push('EMAIL')

  const effectiveChannels = channelOverride ? channels.filter((c) => channelOverride.includes(c)) : channels

  for (const channel of effectiveChannels) {
    // ...resto do loop sem mudança (usa `channel`, não muda)...
  }
}
```

`processUserNotification` não recebe `channels` — alertas internos pro `ORG_ADMIN` continuam sempre por e-mail, mesmo padrão já existente pra `REQUEST_CREATED`/`REQUEST_APPROVED` (não é canal configurável por enquanto, fora de escopo mudar isso agora).

- [ ] **Step 5: Rodar `pnpm --filter api exec tsc --noEmit`**

Confirma que `default-templates.ts` compila com as 2 chaves novas — se faltar uma, o TypeScript aponta exatamente onde (o tipo `TemplateMap` é `Record<NotificationEvent, ...>`, exaustivo).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/queue.ts apps/api/src/lib/template.ts apps/api/src/lib/default-templates.ts apps/api/src/workers/notification.worker.ts
git commit -m "feat: eventos de notificação RECURRING_GENERATION_FAILED/DOCUMENT_REJECTED + override de canal por job"
```

- [ ] **Step 7: Rótulo dos 2 eventos novos no log de notificações**

Em `apps/web/src/pages/app/settings/Notifications.tsx`, adicionar ao `EVENT_LABEL` (o log de notificações já existente lista qualquer evento que aparecer, então sem isso os 2 eventos novos apareceriam com o nome cru do enum):

```typescript
const EVENT_LABEL: Record<string, string> = {
  TASK_CREATED: 'Tarefa criada',
  TASK_MOVED: 'Tarefa movida',
  TASK_COMPLETED: 'Tarefa concluída',
  TASK_COMMENT_ADDED: 'Comentário adicionado',
  TASK_DUE_DATE_APPROACHING: 'Prazo se aproximando',
  RECURRING_GENERATION_FAILED: 'Falha na geração de tarefa recorrente',
  DOCUMENT_REJECTED: 'Documento rejeitado',
}
```

Não adicionar toggle de liga/desliga pra esses 2 eventos nesta tela — a maioria dos eventos existentes (`taskCreated`, `requestCreated`, `requestApproved`, `requestRejected`) também não tem toggle próprio aqui hoje, então isso não é uma regressão nem inconsistência nova, é o padrão já estabelecido da tela.

```bash
git add apps/web/src/pages/app/settings/Notifications.tsx
git commit -m "chore: rótulo dos eventos de notificação novos no log"
```

---

### Task 7: Motor de geração — núcleo (`generateTaskForAssignment`) + endpoint manual

**Depende de:** Task 3 (`recurrence-dates.ts`), Task 5 (assignments), Task 6 (notificação com override de canal).

**Files:**
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.service.ts`
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.routes.ts`
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.schema.ts`
- Modify: `apps/api/src/modules/recurring-templates/recurring-templates.service.test.ts`

**Interfaces:**
- Produces: `generateTaskForAssignment(templateId, assignmentId, competence)` — usada tanto pelo endpoint manual quanto pelo cron (Task 8).
- Consumes: `computeDueDate`/`computeTargetDate`/`computeCurrentPeriodStart` (Task 3), `enqueueNotification` com `channels` (Task 6).

Esta é a peça mais sensível do plano — o requisito "não pode haver falha" do usuário se traduz em três garantias que o código abaixo implementa explicitamente: (1) idempotência **de verdade** em nível de banco, não só checagem de aplicação — inclusive sob corrida real entre duas execuções concorrentes; (2) transação atômica (task + checklist + histórico + log, tudo ou nada); (3) falha vira log auditável + alerta, nunca some silenciosamente.

- [ ] **Step 1: Adicionar ao `recurring-templates.schema.ts`**

```typescript
export const manualGenerateSchema = z.object({
  competence: z.string().datetime().optional(),
})

export type ManualGenerateBody = z.infer<typeof manualGenerateSchema>
```

- [ ] **Step 2: Adicionar ao `recurring-templates.service.ts`**

```typescript
import { Prisma, type MessageChannel } from '@prisma/client'
import { enqueueNotification } from '@/lib/queue'
import {
  computeDueDate,
  computeTargetDate,
  computeCurrentPeriodStart,
  type RecurrenceDateRules,
} from './recurrence-dates'

export type GenerationOutcome =
  | { status: 'SUCCESS'; taskId: string }
  | { status: 'ALREADY_EXISTS' }
  | { status: 'FAILED'; errorMessage: string }

function isDuplicateGenerationLogError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    Array.isArray(err.meta?.target) &&
    (err.meta!.target as string[]).includes('templateId')
  )
}

export async function generateTaskForAssignment(
  templateId: string,
  assignmentId: string,
  competence: Date,
): Promise<GenerationOutcome> {
  const template = await prisma.recurringTaskTemplate.findUnique({
    where: { id: templateId },
    include: { documentRequests: true, documentDeliveries: true },
  })
  if (!template) return { status: 'FAILED', errorMessage: 'Template não encontrado' }

  const assignment = await prisma.recurringTaskAssignment.findUnique({ where: { id: assignmentId } })
  if (!assignment || assignment.templateId !== templateId) {
    return { status: 'FAILED', errorMessage: 'Vínculo não encontrado' }
  }

  const logKey = {
    templateId_clientId_competence: { templateId, clientId: assignment.clientId, competence },
  }
  const existingLog = await prisma.recurringGenerationLog.findUnique({ where: logKey })
  if (existingLog?.status === 'SUCCESS') return { status: 'ALREADY_EXISTS' }

  try {
    const column = await prisma.column.findUnique({ where: { id: assignment.columnId } })
    if (!column) throw new Error('Coluna do vínculo não existe mais')

    const rules: RecurrenceDateRules = template
    const dueDate = computeDueDate(competence, rules)
    const targetDate = computeTargetDate(dueDate, rules)
    const initialStatus = template.documentRequests.length > 0 ? 'BLOCKED' : 'OPEN'

    const taskId = await prisma.$transaction(async (tx) => {
      const position = await tx.task.count({ where: { columnId: assignment.columnId } })

      const task = await tx.task.create({
        data: {
          title: template.title,
          description: template.description,
          priority: 'MEDIUM',
          status: initialStatus,
          columnId: assignment.columnId,
          departmentId: template.departmentId,
          competence,
          dueDate,
          targetDate,
          recurringTemplateId: template.id,
          visibleToClient: template.visibleToClient,
          position,
          tags: [],
        },
      })

      if (template.documentRequests.length > 0) {
        await tx.taskDocumentRequirement.createMany({
          data: template.documentRequests.map((d, i) => ({ taskId: task.id, name: d.name, position: i })),
        })
      }
      if (template.documentDeliveries.length > 0) {
        await tx.taskDeliverable.createMany({
          data: template.documentDeliveries.map((d, i) => ({ taskId: task.id, name: d.name, position: i })),
        })
      }

      await tx.taskHistory.create({
        data: {
          taskId: task.id,
          action: 'created',
          toValue: task.title,
          actorType: 'system',
          actorId: 'system',
          actorName: 'Sistema (recorrência)',
        },
      })

      // Reserva a chave de idempotência por último, dentro da mesma transação: se outra
      // execução concorrente já reservou essa combinação (templateId, clientId, competence)
      // entre a checagem acima e aqui, o unique constraint derruba a transação inteira —
      // a Task recém-criada é revertida junto, nada fica duplicado no banco.
      if (existingLog) {
        await tx.recurringGenerationLog.update({
          where: logKey,
          data: { status: 'SUCCESS', taskId: task.id, errorMessage: null },
        })
      } else {
        await tx.recurringGenerationLog.create({
          data: { templateId, clientId: assignment.clientId, competence, status: 'SUCCESS', taskId: task.id },
        })
      }

      return task.id
    })

    if (template.notifyViaWhatsapp || template.notifyViaEmail) {
      const channels: MessageChannel[] = []
      if (template.notifyViaWhatsapp) channels.push('WHATSAPP')
      if (template.notifyViaEmail) channels.push('EMAIL')
      await enqueueNotification({
        event: 'TASK_CREATED',
        organizationId: template.organizationId,
        clientId: assignment.clientId,
        taskId,
        channels,
        metadata: { taskTitle: template.title },
      })
    }

    return { status: 'SUCCESS', taskId }
  } catch (err) {
    if (isDuplicateGenerationLogError(err)) {
      // Perdeu a corrida pra outra execução concorrente que gerou essa competência primeiro
      // — não é uma falha real, é o próprio mecanismo de idempotência funcionando.
      return { status: 'ALREADY_EXISTS' }
    }

    const errorMessage = err instanceof Error ? err.message : String(err)

    await prisma.recurringGenerationLog.upsert({
      where: logKey,
      create: { templateId, clientId: assignment.clientId, competence, status: 'FAILED', errorMessage },
      update: { status: 'FAILED', errorMessage, taskId: null },
    })

    const admins = await prisma.user.findMany({
      where: { organizationId: template.organizationId, role: 'ORG_ADMIN', isActive: true },
      select: { id: true },
    })
    await Promise.all(
      admins.map((admin) =>
        enqueueNotification({
          event: 'RECURRING_GENERATION_FAILED',
          organizationId: template.organizationId,
          recipientType: 'USER',
          userId: admin.id,
          metadata: { templateTitle: template.title, errorMessage },
        }),
      ),
    )

    return { status: 'FAILED', errorMessage }
  }
}

export async function generateManually(
  templateId: string,
  assignmentId: string,
  organizationId: string,
  competenceOverride?: string,
) {
  const template = await getTemplateById(templateId, organizationId)
  const assignment = await getAssignmentOrThrow(templateId, assignmentId, organizationId)

  const competence = competenceOverride
    ? new Date(competenceOverride)
    : computeCurrentPeriodStart(new Date(), template.periodicity)

  const outcome = await generateTaskForAssignment(template.id, assignment.id, competence)

  if (outcome.status === 'ALREADY_EXISTS') {
    throw new AppError(409, 'Já existe tarefa gerada pra essa competência e esse cliente')
  }
  if (outcome.status === 'FAILED') {
    throw new AppError(422, `Falha ao gerar: ${outcome.errorMessage}`)
  }
  return { taskId: outcome.taskId }
}

export async function listGenerationLog(templateId: string, organizationId: string) {
  await getTemplateById(templateId, organizationId)
  return prisma.recurringGenerationLog.findMany({
    where: { templateId },
    include: { template: { select: { title: true } } },
    orderBy: { createdAt: 'desc' },
  })
}
```

`generateManually` chama `getAssignmentOrThrow` (já existe desde a Task 5, no mesmo arquivo) — sem mudança de export necessária, é uso interno ao módulo.

- [ ] **Step 3: Rotas em `recurring-templates.routes.ts`**

Adicionar (bloco de mutação, depois do segundo `requireRole('ORG_ADMIN')`):

```typescript
app.post('/:id/assignments/:assignmentId/generate', { preHandler: [checkSubscription] }, async (request, reply) => {
  const { id, assignmentId } = request.params as { id: string; assignmentId: string }
  const result = manualGenerateSchema.safeParse(request.body ?? {})
  if (!result.success) throw new AppError(400, result.error.errors[0].message)
  return reply.status(201).send(
    await generateManually(id, assignmentId, request.user.organizationId!, result.data.competence),
  )
})
```

E no bloco de leitura (antes do segundo hook, junto dos outros GETs):

```typescript
app.get('/:id/generation-log', {
  preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
}, async (request, reply) => {
  const { id } = request.params as { id: string }
  return reply.send(await listGenerationLog(id, request.user.organizationId!))
})
```

Atualizar imports (`manualGenerateSchema`, `generateManually`, `listGenerationLog`).

- [ ] **Step 4: Testes**

```typescript
import * as queue from '@/lib/queue'
import { generateTaskForAssignment, generateManually } from './recurring-templates.service'
import { createTestUser } from '@/test/helpers'

describe('generateTaskForAssignment', () => {
  async function setup() {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Folha de pagamento', periodicity: 'MONTHLY',
      dueMonthOffset: 1, dueDayOfPeriod: 15, dueRollToBusinessDay: false,
      targetOffsetDays: -2, targetRollToBusinessDay: false,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true,
      documentRequests: [{ name: 'Ponto' }], documentDeliveries: [{ name: 'Resumo' }],
    })
    const assignment = await createAssignment(template.id, org.id, {
      clientId: client.id, boardId: board.id, columnId: col.id,
    })
    return { org, dept, client, board, col, template, assignment }
  }

  it('gera a tarefa com checklist copiado do template, dueDate/targetDate calculados e status BLOCKED (tem documento a cobrar)', async () => {
    const { template, assignment } = await setup()
    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const competence = new Date(Date.UTC(2026, 1, 1)) // fevereiro
    const outcome = await generateTaskForAssignment(template.id, assignment.id, competence)

    expect(outcome.status).toBe('SUCCESS')
    if (outcome.status !== 'SUCCESS') throw new Error('unreachable')

    const task = await prisma.task.findUniqueOrThrow({
      where: { id: outcome.taskId },
      include: { documentRequirements: true, deliverables: true },
    })
    expect(task.status).toBe('BLOCKED')
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe('2026-03-15')
    expect(task.documentRequirements).toHaveLength(1)
    expect(task.deliverables).toHaveLength(1)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'TASK_CREATED', channels: ['WHATSAPP'] }))

    spy.mockRestore()
  })

  it('idempotência: chamar duas vezes pra mesma competência não cria segunda tarefa', async () => {
    const { template, assignment } = await setup()
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const competence = new Date(Date.UTC(2026, 1, 1))
    const first = await generateTaskForAssignment(template.id, assignment.id, competence)
    const second = await generateTaskForAssignment(template.id, assignment.id, competence)

    expect(first.status).toBe('SUCCESS')
    expect(second.status).toBe('ALREADY_EXISTS')

    const count = await prisma.task.count({ where: { recurringTemplateId: template.id } })
    expect(count).toBe(1)

    vi.restoreAllMocks()
  })

  it('isolamento de falha: coluna do vínculo não existe mais, grava FAILED e notifica ORG_ADMIN', async () => {
    const { org, template, assignment, col } = await setup()
    await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    await prisma.column.delete({ where: { id: col.id } })

    const competence = new Date(Date.UTC(2026, 1, 1))
    const outcome = await generateTaskForAssignment(template.id, assignment.id, competence)

    expect(outcome.status).toBe('FAILED')

    const log = await prisma.recurringGenerationLog.findUnique({
      where: { templateId_clientId_competence: { templateId: template.id, clientId: assignment.clientId, competence } },
    })
    expect(log?.status).toBe('FAILED')
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'RECURRING_GENERATION_FAILED' }))

    spy.mockRestore()
  })

  it('reprocessamento manual: gera com sucesso depois de um FAILED anterior pra mesma competência', async () => {
    const { org, template, assignment, col } = await setup()
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const competence = new Date(Date.UTC(2026, 1, 1))
    await prisma.recurringGenerationLog.create({
      data: { templateId: template.id, clientId: assignment.clientId, competence, status: 'FAILED', errorMessage: 'erro antigo' },
    })

    const outcome = await generateTaskForAssignment(template.id, assignment.id, competence)
    expect(outcome.status).toBe('SUCCESS')

    vi.restoreAllMocks()
  })
})

describe('generateManually', () => {
  async function setupTemplate() {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'X', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueRollToBusinessDay: false,
      targetOffsetDays: 0, targetRollToBusinessDay: false,
      generationMonthOffset: 1, generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    const assignment = await createAssignment(template.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })
    return { template, assignment }
  }

  it('lança 409 se já existe SUCCESS pra essa competência', async () => {
    const { template, assignment } = await setupTemplate()
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const competence = new Date().toISOString()
    await generateManually(template.id, assignment.id, template.organizationId, competence)

    await expect(
      generateManually(template.id, assignment.id, template.organizationId, competence),
    ).rejects.toMatchObject({ statusCode: 409 })

    vi.restoreAllMocks()
  })
})
```

- [ ] **Step 5: Rodar `pnpm --filter api test src/modules/recurring-templates` e confirmar que passam**

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/recurring-templates
git commit -m "feat: núcleo do motor de geração de tarefas recorrentes — idempotente, isolado por falha, auditável"
```

---

### Task 8: Worker de cron — geração diária

**Depende de:** Task 7 (`generateTaskForAssignment`).

**Files:**
- Create: `apps/api/src/workers/recurring-tasks.cron.ts`
- Modify: `apps/api/src/worker.ts`
- Create: `apps/api/src/workers/recurring-tasks.cron.test.ts`

**Interfaces:**
- Consumes: `generateTaskForAssignment` (Task 7), `computeCompetencesToGenerate` (Task 3).

- [ ] **Step 1: `recurring-tasks.cron.ts`**

```typescript
import { Queue, Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { computeCompetencesToGenerate, type RecurrenceDateRules } from '@/modules/recurring-templates/recurrence-dates'
import { generateTaskForAssignment } from '@/modules/recurring-templates/recurring-templates.service'

export async function runRecurringTasksGeneration(today: Date = new Date()): Promise<void> {
  const templates = await prisma.recurringTaskTemplate.findMany({
    where: { isActive: true },
    include: { assignments: { where: { isActive: true } } },
  })

  for (const template of templates) {
    let competences: Date[]
    try {
      const rules: RecurrenceDateRules = template
      competences = computeCompetencesToGenerate(today, rules)
    } catch {
      // Falha no cálculo de competência não deve derrubar o cron inteiro — pula esse
      // template nesta execução, o próximo dia tenta de novo. `generateTaskForAssignment`
      // já cobre a maioria dos erros com log+alerta; isso aqui é só um cinto de segurança
      // extra pra um bug de cálculo que nem chega a rodar por assignment.
      continue
    }
    if (competences.length === 0) continue

    for (const assignment of template.assignments) {
      for (const competence of competences) {
        try {
          await generateTaskForAssignment(template.id, assignment.id, competence)
        } catch {
          // generateTaskForAssignment já captura e loga qualquer erro esperado (retorna
          // FAILED, nunca deveria lançar) — esse catch é só defesa extra contra um bug
          // inesperado, pra garantir que um assignment problemático nunca trava os demais.
        }
      }
    }
  }
}

export async function startRecurringTasksCronWorker() {
  const cronQueue = new Queue('recurring-tasks-cron', { connection: bullmqRedis })

  await cronQueue.add('generate', {}, {
    repeat: { every: 3_600_000 * 24 }, // diário — a idempotência do log garante que múltiplas execuções no mesmo dia não dupliquem nada
    jobId: 'recurring-tasks-generate',
  })

  return new Worker('recurring-tasks-cron', async () => {
    await runRecurringTasksGeneration()
  }, { connection: bullmqRedis })
}
```

`runRecurringTasksGeneration` recebe `today` como parâmetro (default `new Date()`) especificamente pra ser testável sem mockar o relógio do sistema — mesmo padrão que facilita os testes de `recurrence-dates.ts` (Task 3), que também recebem a data como argumento em vez de ler `Date.now()` internamente.

- [ ] **Step 2: Registrar em `apps/api/src/worker.ts`**

```typescript
import { resolve } from 'node:path'
import { config } from 'dotenv'
config({ path: resolve(import.meta.dirname, '../../../.env') })

import { startNotificationWorker } from '@/workers/notification.worker'
import { startDueDateCronWorker } from '@/workers/duedate.cron'
import { startRecurringTasksCronWorker } from '@/workers/recurring-tasks.cron'

async function main() {
  startNotificationWorker()
  await startDueDateCronWorker()
  await startRecurringTasksCronWorker()
  console.log('[worker] Notification worker + duedate cron + recurring tasks cron iniciados')
}

main().catch((err) => {
  console.error('[worker] Fatal:', err)
  process.exit(1)
})
```

- [ ] **Step 3: Testes**

```typescript
import { describe, it, expect, vi } from 'vitest'
import * as queue from '@/lib/queue'
import { runRecurringTasksGeneration } from './recurring-tasks.cron'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestDepartment,
  createTestClient, createTestBoard, createTestColumn,
} from '@/test/helpers'
import { createTemplate } from '@/modules/recurring-templates/recurring-templates.service'
import { createAssignment } from '@/modules/recurring-templates/recurring-templates.service'

describe('runRecurringTasksGeneration', () => {
  it('gera tarefa só pros templates cujo generationDayOfPeriod bate com a data informada', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const templateTriggersToday = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Dispara hoje', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueRollToBusinessDay: false,
      targetOffsetDays: 0, targetRollToBusinessDay: false,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    await createAssignment(templateTriggersToday.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })

    const templateDoesNotTrigger = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Não dispara hoje', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueRollToBusinessDay: false,
      targetOffsetDays: 0, targetRollToBusinessDay: false,
      generationMonthOffset: 1, generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    await createAssignment(templateDoesNotTrigger.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })

    const today = new Date(Date.UTC(2026, 0, 20)) // dia 20
    await runRecurringTasksGeneration(today)

    const tasksOfTriggered = await prisma.task.count({ where: { recurringTemplateId: templateTriggersToday.id } })
    const tasksOfNotTriggered = await prisma.task.count({ where: { recurringTemplateId: templateDoesNotTrigger.id } })
    expect(tasksOfTriggered).toBe(1)
    expect(tasksOfNotTriggered).toBe(0)

    vi.restoreAllMocks()
  })

  it('não gera nada pra template inativo (isActive=false)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'Inativo', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueRollToBusinessDay: false,
      targetOffsetDays: 0, targetRollToBusinessDay: false,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: false, documentRequests: [], documentDeliveries: [],
    })
    await createAssignment(template.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })

    await runRecurringTasksGeneration(new Date(Date.UTC(2026, 0, 20)))

    const count = await prisma.task.count({ where: { recurringTemplateId: template.id } })
    expect(count).toBe(0)

    vi.restoreAllMocks()
  })

  it('não gera nada pra assignment inativo (isActive=false), mesmo com o template ativo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'X', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueRollToBusinessDay: false,
      targetOffsetDays: 0, targetRollToBusinessDay: false,
      generationMonthOffset: 1, generationDayOfPeriod: 20,
      autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
      visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
    })
    const assignment = await createAssignment(template.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })
    await prisma.recurringTaskAssignment.update({ where: { id: assignment.id }, data: { isActive: false } })

    await runRecurringTasksGeneration(new Date(Date.UTC(2026, 0, 20)))

    const count = await prisma.task.count({ where: { recurringTemplateId: template.id } })
    expect(count).toBe(0)

    vi.restoreAllMocks()
  })
})
```

- [ ] **Step 4: Rodar `pnpm --filter api test src/workers/recurring-tasks.cron.test.ts` e confirmar que passam**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workers/recurring-tasks.cron.ts apps/api/src/workers/recurring-tasks.cron.test.ts apps/api/src/worker.ts
git commit -m "feat: worker de cron diário pra geração de tarefas recorrentes"
```

---

### Task 9: Status manual em `PATCH /tasks/:id` + módulo `task-documents` (org-side)

**Depende de:** Task 1 (schema).

**Files:**
- Modify: `apps/api/src/modules/tasks/tasks.schema.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.test.ts`
- Create: `apps/api/src/modules/task-documents/task-documents.schema.ts`
- Create: `apps/api/src/modules/task-documents/task-documents.service.ts`
- Create: `apps/api/src/modules/task-documents/task-documents.routes.ts`
- Create: `apps/api/src/modules/task-documents/task-documents.service.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Produces: `recalculateTaskStatus(taskId)` — usada por este módulo e reaproveitada pelo lado do portal (Task 10).

Hoje `PATCH /tasks/:id` **não aceita `status` de jeito nenhum** — nem no schema Zod, nem no update do Prisma (só `moveTask`, ao trocar de coluna, seta status implicitamente). Isso precisa ser corrigido, não só "estendido", pra virar realidade o que a spec pede.

- [ ] **Step 1: `tasks.schema.ts` — adicionar `status` ao update**

```typescript
export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  status: z.enum(['OPEN', 'DONE', 'DISREGARDED', 'BLOCKED']).optional(),
  assigneeId: z.string().cuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  tags: z.array(z.string()).optional(),
  departmentId: z.string().cuid().nullable().optional(),
})
```

(`createTaskSchema` não ganha `status` — tarefa manual sempre nasce `OPEN`, igual hoje; tarefa recorrente nasce via o motor de geração, Task 7, que não passa por esse schema.)

- [ ] **Step 2: `tasks.service.ts` — `updateTask` grava histórico de mudança de status**

No topo do arquivo, adicionar a mudança de status ao array `historyEntries` (junto de `priority`/`assigneeId`):

```typescript
  if (data.priority !== undefined && data.priority !== task.priority) {
    historyEntries.push({
      action: 'priority_changed',
      fromValue: task.priority,
      toValue: data.priority,
    })
  }
  if (data.status !== undefined && data.status !== task.status) {
    historyEntries.push({
      action: 'status_changed',
      fromValue: task.status,
      toValue: data.status,
    })
  }
  if (data.assigneeId !== undefined && data.assigneeId !== task.assigneeId) {
    historyEntries.push({
      action: 'assigned_to',
      fromValue: task.assigneeId ?? undefined,
      toValue: data.assigneeId ?? undefined,
    })
  }
```

E no `tx.task.update`, adicionar `status: data.status` ao `data`:

```typescript
    const result = await tx.task.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        priority: data.priority,
        status: data.status,
        assigneeId: data.assigneeId,
        dueDate:
          data.dueDate === null ? null
          : data.dueDate !== undefined ? new Date(data.dueDate)
          : undefined,
        tags: data.tags,
        departmentId: data.departmentId,
      },
    })
```

- [ ] **Step 3: Testes em `tasks.service.test.ts`**

```typescript
describe('updateTask (status)', () => {
  it('atualiza status e registra TaskHistory status_changed', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    const updated = await updateTask(task.id, org.id, { status: 'DISREGARDED' }, { id: user.id, type: 'user' })
    expect(updated.status).toBe('DISREGARDED')

    const history = await prisma.taskHistory.findMany({ where: { taskId: task.id, action: 'status_changed' } })
    expect(history).toHaveLength(1)
    expect(history[0].fromValue).toBe('OPEN')
    expect(history[0].toValue).toBe('DISREGARDED')
  })

  it('não registra histórico quando status não muda', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    await updateTask(task.id, org.id, { status: 'OPEN' }, { id: user.id, type: 'user' })

    const history = await prisma.taskHistory.findMany({ where: { taskId: task.id, action: 'status_changed' } })
    expect(history).toHaveLength(0)
  })
})
```

- [ ] **Step 4: `task-documents.schema.ts`**

```typescript
import { z } from 'zod'

export const addDocumentItemSchema = z.object({
  name: z.string().trim().min(1, 'Nome do documento obrigatório'),
})

export const reviewDocumentRequirementSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  rejectionReason: z.string().trim().min(1).optional(),
})

export type AddDocumentItemBody = z.infer<typeof addDocumentItemSchema>
export type ReviewDocumentRequirementBody = z.infer<typeof reviewDocumentRequirementSchema>
```

- [ ] **Step 5: `task-documents.service.ts`**

```typescript
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { uploadFile, getSignedDownloadUrl } from '@/lib/b2'
import { enqueueNotification } from '@/lib/queue'
import type { TaskStatus } from '@prisma/client'

export interface UploadPayload {
  filename: string
  mimeType: string
  size: number
  buffer: Buffer
}

async function getOrgSlug(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { slug: true } })
  return org?.slug ?? organizationId
}

export async function verifyTaskAccess(taskId: string, organizationId: string, clientId?: string) {
  const boardWhere = clientId ? { organizationId, clientId } : { organizationId }
  const task = await prisma.task.findFirst({ where: { id: taskId, column: { board: boardWhere } } })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  // clientId presente = chamada vindo do portal — tarefa marcada como não-visível pro
  // cliente (ex: SPED, controle interno) responde 404 igual "não existe", nunca 403
  // (não revela que a tarefa existe). Chamada do lado do escritório (clientId ausente)
  // nunca é filtrada por isso.
  if (clientId && !task.visibleToClient) throw new AppError(404, 'Tarefa não encontrada')
  return task
}

export async function listTaskDocuments(taskId: string, organizationId: string, clientId?: string) {
  await verifyTaskAccess(taskId, organizationId, clientId)

  const [requirements, deliverables] = await Promise.all([
    prisma.taskDocumentRequirement.findMany({ where: { taskId }, orderBy: { position: 'asc' }, include: { attachment: true } }),
    prisma.taskDeliverable.findMany({ where: { taskId }, orderBy: { position: 'asc' }, include: { attachment: true } }),
  ])

  return {
    requirements: await Promise.all(requirements.map(async (r) => ({
      ...r,
      signedUrl: r.attachment ? await getSignedDownloadUrl(r.attachment.storageKey) : null,
    }))),
    deliverables: await Promise.all(deliverables.map(async (d) => ({
      ...d,
      signedUrl: d.attachment ? await getSignedDownloadUrl(d.attachment.storageKey) : null,
    }))),
  }
}

export async function addDocumentRequirement(taskId: string, organizationId: string, name: string) {
  await verifyTaskAccess(taskId, organizationId)
  const position = await prisma.taskDocumentRequirement.count({ where: { taskId } })
  return prisma.taskDocumentRequirement.create({ data: { taskId, name, position } })
}

export async function addDeliverable(taskId: string, organizationId: string, name: string) {
  await verifyTaskAccess(taskId, organizationId)
  const position = await prisma.taskDeliverable.count({ where: { taskId } })
  return prisma.taskDeliverable.create({ data: { taskId, name, position } })
}

export async function uploadForRequirement(
  taskId: string,
  requirementId: string,
  organizationId: string,
  actor: { id: string; type: 'user' | 'client' },
  clientId: string | undefined,
  payload: UploadPayload,
) {
  await verifyTaskAccess(taskId, organizationId, clientId)
  const requirement = await prisma.taskDocumentRequirement.findFirst({ where: { id: requirementId, taskId } })
  if (!requirement) throw new AppError(404, 'Documento não encontrado')

  const orgSlug = await getOrgSlug(organizationId)
  const storageKey = `task-documents/${orgSlug}/${taskId}/${Date.now()}-${payload.filename}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  const attachment = await prisma.attachment.create({
    data: {
      taskId,
      filename: payload.filename,
      mimeType: payload.mimeType,
      size: payload.size,
      storageKey,
      uploadedBy: actor.type === 'user' ? actor.id : undefined,
      uploadedByClient: actor.type === 'client' ? actor.id : undefined,
    },
  })

  await prisma.taskDocumentRequirement.update({
    where: { id: requirementId },
    data: { status: 'UPLOADED', attachmentId: attachment.id, rejectionReason: null },
  })

  await recalculateTaskStatus(taskId)

  return prisma.taskDocumentRequirement.findUniqueOrThrow({ where: { id: requirementId }, include: { attachment: true } })
}

export async function reviewDocumentRequirement(
  taskId: string,
  requirementId: string,
  organizationId: string,
  reviewerId: string,
  decision: 'APPROVED' | 'REJECTED',
  rejectionReason: string | undefined,
) {
  await verifyTaskAccess(taskId, organizationId)
  const requirement = await prisma.taskDocumentRequirement.findFirst({ where: { id: requirementId, taskId } })
  if (!requirement) throw new AppError(404, 'Documento não encontrado')
  if (requirement.status !== 'UPLOADED') {
    throw new AppError(422, 'Só é possível avaliar um documento que já foi enviado')
  }
  if (decision === 'REJECTED' && !rejectionReason) {
    throw new AppError(422, 'Motivo da rejeição é obrigatório')
  }

  const updated = await prisma.taskDocumentRequirement.update({
    where: { id: requirementId },
    data: {
      status: decision,
      rejectionReason: decision === 'REJECTED' ? rejectionReason : null,
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    },
  })

  await recalculateTaskStatus(taskId)

  if (decision === 'REJECTED') {
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { column: { include: { board: { select: { clientId: true } } } } },
    })
    await enqueueNotification({
      event: 'DOCUMENT_REJECTED',
      organizationId,
      clientId: task.column.board.clientId,
      taskId,
      metadata: { taskTitle: task.title, documentName: requirement.name, rejectionReason: rejectionReason! },
    })
  }

  return updated
}

export async function deliverDocument(
  taskId: string,
  deliverableId: string,
  organizationId: string,
  actor: { id: string },
  payload: UploadPayload,
) {
  await verifyTaskAccess(taskId, organizationId)
  const deliverable = await prisma.taskDeliverable.findFirst({ where: { id: deliverableId, taskId } })
  if (!deliverable) throw new AppError(404, 'Entregável não encontrado')

  const orgSlug = await getOrgSlug(organizationId)
  const storageKey = `task-documents/${orgSlug}/${taskId}/${Date.now()}-${payload.filename}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  const attachment = await prisma.attachment.create({
    data: {
      taskId, filename: payload.filename, mimeType: payload.mimeType, size: payload.size, storageKey,
      uploadedBy: actor.id,
    },
  })

  const updated = await prisma.taskDeliverable.update({
    where: { id: deliverableId },
    data: { attachmentId: attachment.id, deliveredById: actor.id, deliveredAt: new Date() },
  })

  await recalculateTaskStatus(taskId)

  return updated
}

export async function recalculateTaskStatus(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      documentRequirements: true,
      deliverables: true,
      recurringTemplate: { select: { autoCompleteOnAllActivitiesDone: true } },
    },
  })

  const hasPendingOrRejected = task.documentRequirements.some((d) => d.status === 'PENDING' || d.status === 'REJECTED')
  const allRequirementsApproved = task.documentRequirements.every((d) => d.status === 'APPROVED')
  const allDeliverablesDone = task.deliverables.every((d) => d.deliveredAt !== null)
  const autoComplete = task.recurringTemplate?.autoCompleteOnAllActivitiesDone ?? false

  let nextStatus: TaskStatus | undefined

  if (hasPendingOrRejected) {
    if (task.status !== 'BLOCKED') nextStatus = 'BLOCKED'
  } else if (autoComplete && allRequirementsApproved && allDeliverablesDone && task.status !== 'DONE') {
    nextStatus = 'DONE'
  } else if (task.status === 'BLOCKED') {
    // Impedimento resolvido (nada mais pendente/rejeitado) — mesmo sem conclusão automática
    // ligada, ou com entregáveis ainda faltando, o status "Com Impedimento" deixou de ser
    // verdade, então volta pra Aberto.
    nextStatus = 'OPEN'
  }

  if (nextStatus && nextStatus !== task.status) {
    await prisma.$transaction([
      prisma.task.update({ where: { id: taskId }, data: { status: nextStatus } }),
      prisma.taskHistory.create({
        data: {
          taskId,
          action: 'status_changed',
          fromValue: task.status,
          toValue: nextStatus,
          actorType: 'system',
          actorId: 'system',
          actorName: 'Sistema (checklist)',
        },
      }),
    ])
  }
}
```

- [ ] **Step 6: `task-documents.routes.ts`** (registrado sem prefixo, mesmo padrão de `attachments.routes.ts`)

```typescript
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { addDocumentItemSchema, reviewDocumentRequirementSchema } from './task-documents.schema'
import {
  listTaskDocuments,
  addDocumentRequirement,
  addDeliverable,
  uploadForRequirement,
  reviewDocumentRequirement,
  deliverDocument,
} from './task-documents.service'

const MAX_FILE_SIZE = 20 * 1024 * 1024

export async function taskDocumentsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })

  app.addHook('preHandler', verifyJWT)

  app.get('/tasks/:id/documents', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await listTaskDocuments(id, request.user.organizationId!))
  })

  app.post('/tasks/:id/documents/requests', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = addDocumentItemSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await addDocumentRequirement(id, request.user.organizationId!, result.data.name))
  })

  app.post('/tasks/:id/documents/deliveries', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = addDocumentItemSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await addDeliverable(id, request.user.organizationId!, result.data.name))
  })

  app.patch('/tasks/:id/documents/requests/:reqId', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const { id, reqId } = request.params as { id: string; reqId: string }
    const result = reviewDocumentRequirementSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(
      await reviewDocumentRequirement(
        id, reqId, request.user.organizationId!, request.user.sub,
        result.data.decision, result.data.rejectionReason,
      ),
    )
  })

  app.post('/tasks/:id/documents/deliveries/:reqId/upload', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const { id, reqId } = request.params as { id: string; reqId: string }

    let file: Awaited<ReturnType<typeof request.file>>
    try {
      file = await request.file()
    } catch (err: unknown) {
      const e = err as { statusCode?: number; code?: string }
      if (e?.statusCode === 413 || e?.code === 'FST_FILES_LIMIT' || e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(413, 'Arquivo excede o limite de 20MB')
      }
      throw err
    }
    if (!file) throw new AppError(400, 'Nenhum arquivo enviado')

    const buffer = await file.toBuffer()
    if (buffer.length > MAX_FILE_SIZE) throw new AppError(413, 'Arquivo excede o limite de 20MB')

    return reply.status(201).send(
      await deliverDocument(
        id, reqId, request.user.organizationId!, { id: request.user.sub },
        { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer },
      ),
    )
  })

  app.post('/tasks/:id/documents/requests/:reqId/upload', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const { id, reqId } = request.params as { id: string; reqId: string }

    let file: Awaited<ReturnType<typeof request.file>>
    try {
      file = await request.file()
    } catch (err: unknown) {
      const e = err as { statusCode?: number; code?: string }
      if (e?.statusCode === 413 || e?.code === 'FST_FILES_LIMIT' || e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(413, 'Arquivo excede o limite de 20MB')
      }
      throw err
    }
    if (!file) throw new AppError(400, 'Nenhum arquivo enviado')

    const buffer = await file.toBuffer()
    if (buffer.length > MAX_FILE_SIZE) throw new AppError(413, 'Arquivo excede o limite de 20MB')

    return reply.status(201).send(
      await uploadForRequirement(
        id, reqId, request.user.organizationId!, { id: request.user.sub, type: 'user' }, undefined,
        { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer },
      ),
    )
  })
}
```

`POST /tasks/:id/documents/requests/:reqId/upload` (upload pelo lado do colaborador, ex: quando o colaborador recebe o documento por fora e sobe em nome do cliente) fica aberto aqui também — o spec só menciona explicitamente o upload do cliente via portal (Task 10), mas colaborador também poder subir em nome do cliente é consistente com o resto do projeto (attachments genéricos já permitem colaborador subir independente de quem "deveria" subir) e evita um buraco de UX real (cliente liga pro escritório e manda por WhatsApp, colaborador precisa conseguir registrar no sistema).

- [ ] **Step 7: Registrar em `server.ts`**

```typescript
import { taskDocumentsRoutes } from '@/modules/task-documents/task-documents.routes'
// ...
app.register(taskDocumentsRoutes)
```

- [ ] **Step 8: Testes de `task-documents.service.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest'
import * as queue from '@/lib/queue'
import { prisma } from '@/lib/prisma'
import {
  addDocumentRequirement, uploadForRequirement, reviewDocumentRequirement,
  addDeliverable, deliverDocument, recalculateTaskStatus,
} from './task-documents.service'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient,
  createTestBoard, createTestColumn, createTestTask,
} from '@/test/helpers'

describe('checklist de documento — impedimento automático', () => {
  it('tarefa vai pra BLOCKED quando um documento é adicionado (PENDING)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    await addDocumentRequirement(task.id, org.id, 'Ponto')
    await recalculateTaskStatus(task.id)

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(updated.status).toBe('BLOCKED')
  })

  it('volta pra OPEN quando o único documento pendente é aprovado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    const requirement = await addDocumentRequirement(task.id, org.id, 'Ponto')
    await recalculateTaskStatus(task.id)

    await uploadForRequirement(
      task.id, requirement.id, org.id, { id: client.id, type: 'client' }, client.id,
      { filename: 'ponto.pdf', mimeType: 'application/pdf', size: 100, buffer: Buffer.from('x') },
    )
    await reviewDocumentRequirement(task.id, requirement.id, org.id, user.id, 'APPROVED', undefined)

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(updated.status).toBe('OPEN')
  })

  it('rejeição exige motivo e dispara DOCUMENT_REJECTED', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    const requirement = await addDocumentRequirement(task.id, org.id, 'Ponto')
    await uploadForRequirement(
      task.id, requirement.id, org.id, { id: client.id, type: 'client' }, client.id,
      { filename: 'ponto.pdf', mimeType: 'application/pdf', size: 100, buffer: Buffer.from('x') },
    )

    await expect(
      reviewDocumentRequirement(task.id, requirement.id, org.id, user.id, 'REJECTED', undefined),
    ).rejects.toMatchObject({ statusCode: 422 })

    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    await reviewDocumentRequirement(task.id, requirement.id, org.id, user.id, 'REJECTED', 'Ilegível')
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'DOCUMENT_REJECTED', metadata: expect.objectContaining({ rejectionReason: 'Ilegível' }) }))

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: task.id } })
    expect(updated.status).toBe('BLOCKED')

    spy.mockRestore()
  })

  it('conclusão automática só dispara com autoCompleteOnAllActivitiesDone=true no template de origem', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const dept = await createTestDepartment(org.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()

    const template = await createTemplate(org.id, {
      departmentId: dept.id, title: 'X', periodicity: 'MONTHLY',
      dueMonthOffset: 0, dueDayOfPeriod: 10, dueRollToBusinessDay: false,
      targetOffsetDays: 0, targetRollToBusinessDay: false,
      generationMonthOffset: 1, generationDayOfPeriod: 5,
      autoCompleteOnAllActivitiesDone: true, notifyViaWhatsapp: false, notifyViaEmail: false,
      visibleToClient: true, isActive: true,
      documentRequests: [{ name: 'Ponto' }], documentDeliveries: [],
    })
    const assignment = await createAssignment(template.id, org.id, { clientId: client.id, boardId: board.id, columnId: col.id })
    const outcome = await generateTaskForAssignment(template.id, assignment.id, new Date(Date.UTC(2026, 1, 1)))
    if (outcome.status !== 'SUCCESS') throw new Error('geração falhou no setup do teste')

    const requirement = await prisma.taskDocumentRequirement.findFirstOrThrow({ where: { taskId: outcome.taskId } })
    await uploadForRequirement(
      outcome.taskId, requirement.id, org.id, { id: client.id, type: 'client' }, client.id,
      { filename: 'ponto.pdf', mimeType: 'application/pdf', size: 100, buffer: Buffer.from('x') },
    )
    await reviewDocumentRequirement(outcome.taskId, requirement.id, org.id, user.id, 'APPROVED', undefined)

    const updated = await prisma.task.findUniqueOrThrow({ where: { id: outcome.taskId } })
    expect(updated.status).toBe('DONE')

    vi.restoreAllMocks()
  })
})
```

Import `createTemplate`, `createAssignment`, `generateTaskForAssignment` de `@/modules/recurring-templates/recurring-templates.service` no topo do arquivo, e `createTestDepartment` de `@/test/helpers` (já usado por outros módulos desde 2a).

- [ ] **Step 9: Rodar `pnpm --filter api test src/modules/tasks src/modules/task-documents` e confirmar que passam**

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/tasks apps/api/src/modules/task-documents apps/api/src/server.ts
git commit -m "feat: status manual em tarefas + checklist de documento (cobrar/entregar) com impedimento e conclusão automática"
```

---

### Task 10: Gate de visibilidade no portal + documentos do lado do cliente

**Depende de:** Task 9 (`verifyTaskAccess` já checa `visibleToClient` quando `clientId` é passado).

**Files:**
- Modify: `apps/api/src/modules/boards/boards.service.ts`
- Modify: `apps/api/src/modules/boards/boards.routes.ts`
- Modify: `apps/api/src/modules/portal/portal.service.ts`
- Modify: `apps/api/src/modules/portal/portal.routes.ts`
- Modify: `apps/api/src/modules/boards/boards.service.test.ts`
- Modify: `apps/api/src/modules/task-documents/task-documents.service.test.ts`

**Interfaces:**
- Consumes: `verifyTaskAccess`, `listTaskDocuments`, `uploadForRequirement` (Task 9).

- [ ] **Step 1: `boards.service.ts` — `getBoardById` filtra tasks por visibilidade quando o chamador é `CLIENT`**

```typescript
export async function getBoardById(id: string, organizationId: string, hideInvisibleTasks = false) {
  const board = await prisma.board.findFirst({
    where: { id, organizationId, isActive: true },
    include: {
      client: { select: { id: true, name: true } },
      responsibleUser: { select: { id: true, name: true } },
      columns: {
        orderBy: { position: 'asc' },
        include: {
          tasks: {
            where: hideInvisibleTasks ? { visibleToClient: true } : undefined,
            orderBy: { position: 'asc' },
          },
        },
      },
    },
  })
  if (!board) throw new AppError(404, 'Board não encontrado')
  return board
}
```

- [ ] **Step 2: `boards.routes.ts` — passar `hideInvisibleTasks` quando `role === 'CLIENT'`**

```typescript
  app.get('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getBoardById(id, request.user.organizationId!, request.user.role === 'CLIENT'))
  })
```

- [ ] **Step 3: `portal.service.ts` — `getTaskHistory` ganha escopo por cliente + gate de visibilidade**

A função hoje **não** checa se a tarefa pertence ao cliente que está autenticado — qualquer cliente autenticado da organização conseguiria ver o histórico de uma tarefa de outro cliente, só sabendo o id. Corrigir isso junto com o gate de visibilidade (mesmo tipo de checagem, mesmo lugar):

```typescript
export async function getTaskHistory(taskId: string, organizationId: string, clientId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId, clientId } } },
  })
  if (!task || !task.visibleToClient) throw new AppError(404, 'Tarefa não encontrada')

  return prisma.taskHistory.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
  })
}
```

- [ ] **Step 4: `portal.routes.ts` — passar `clientId` e adicionar rotas de documento**

Trocar a chamada existente:

```typescript
  app.get('/tasks/:taskId/history', async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    return reply.send(await getTaskHistory(taskId, request.user.organizationId!, request.user.sub))
  })
```

Adicionar (mesmo arquivo, mesmo bloco — já roda sob `verifyJWT`+`requireRole('CLIENT')` do topo do arquivo):

```typescript
  app.get('/tasks/:taskId/documents', async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    return reply.send(await listTaskDocuments(taskId, request.user.organizationId!, request.user.sub))
  })

  app.post('/tasks/:taskId/documents/requests/:reqId/upload', async (request, reply) => {
    const { taskId, reqId } = request.params as { taskId: string; reqId: string }

    let file: Awaited<ReturnType<typeof request.file>>
    try {
      file = await request.file()
    } catch (err: unknown) {
      const e = err as { statusCode?: number; code?: string }
      if (e?.statusCode === 413 || e?.code === 'FST_FILES_LIMIT' || e?.code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(413, 'Arquivo excede o limite de 20MB')
      }
      throw err
    }
    if (!file) throw new AppError(400, 'Nenhum arquivo enviado')

    const buffer = await file.toBuffer()
    if (buffer.length > MAX_FILE_SIZE) throw new AppError(413, 'Arquivo excede o limite de 20MB')

    return reply.status(201).send(
      await uploadForRequirement(
        taskId, reqId, request.user.organizationId!, { id: request.user.sub, type: 'client' }, request.user.sub,
        { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer },
      ),
    )
  })
```

Atualizar os imports do topo do arquivo (`listTaskDocuments`, `uploadForRequirement` de `@/modules/task-documents/task-documents.service`; `MAX_FILE_SIZE` já precisa ser declarado no arquivo — conferir se já existe uma constante local; se não, declarar `const MAX_FILE_SIZE = 20 * 1024 * 1024` no topo, mesmo valor usado em `attachments.routes.ts`/`task-documents.routes.ts`).

- [ ] **Step 5: Testes**

Em `boards.service.test.ts`:

```typescript
describe('getBoardById (visibilidade)', () => {
  it('esconde tarefas com visibleToClient=false quando hideInvisibleTasks=true', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const visibleTask = await createTestTask(col.id, user.id)
    const hiddenTask = await createTestTask(col.id, user.id)
    await prisma.task.update({ where: { id: hiddenTask.id }, data: { visibleToClient: false } })

    const asClient = await getBoardById(board.id, org.id, true)
    const taskIdsAsClient = asClient.columns.flatMap((c) => c.tasks).map((t) => t.id)
    expect(taskIdsAsClient).toContain(visibleTask.id)
    expect(taskIdsAsClient).not.toContain(hiddenTask.id)

    const asOrg = await getBoardById(board.id, org.id, false)
    const taskIdsAsOrg = asOrg.columns.flatMap((c) => c.tasks).map((t) => t.id)
    expect(taskIdsAsOrg).toContain(hiddenTask.id)
  })
})
```

Em `task-documents.service.test.ts`, adicionar:

```typescript
describe('verifyTaskAccess (visibilidade no portal)', () => {
  it('lança 404 quando o cliente tenta acessar documentos de uma tarefa com visibleToClient=false', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: false } })

    await expect(listTaskDocuments(task.id, org.id, client.id)).rejects.toMatchObject({ statusCode: 404 })
    // do lado do escritório (sem clientId), continua acessível
    await expect(listTaskDocuments(task.id, org.id)).resolves.toBeDefined()
  })
})
```

- [ ] **Step 6: Rodar `pnpm --filter api test src/modules/boards src/modules/portal src/modules/task-documents` e confirmar que passam**

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/boards apps/api/src/modules/portal apps/api/src/modules/task-documents
git commit -m "fix: gate de visibilidade (visibleToClient) no portal + corrige vazamento de histórico entre clientes"
```

---

### Task 11: Frontend — tipos + página "Tarefas Recorrentes" (template + vínculos + log)

**Depende de:** Task 4-7 (endpoints já existem).

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Create: `apps/web/src/pages/app/settings/RecurringTemplates.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /recurring-templates`, `GET/POST/PATCH/DELETE /recurring-templates/:id/assignments`, `POST /recurring-templates/:id/assignments/:assignmentId/generate`, `GET /recurring-templates/:id/generation-log`, `GET /clients`, `GET /boards` (já existentes), `GET /departments` (2a).

- [ ] **Step 1: `apps/web/src/types/index.ts` — atualizar `Task` e adicionar tipos novos**

```typescript
export interface Task {
  id: string
  title: string
  description: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  status: 'OPEN' | 'DONE' | 'DISREGARDED' | 'BLOCKED'
  position: number
  columnId: string
  assigneeId: string | null
  creatorId: string | null
  dueDate: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
  sourceRequestId: string | null
  departmentId: string | null
  competence: string | null
  targetDate: string | null
  recurringTemplateId: string | null
  visibleToClient: boolean
}
```

(`creatorId` era `string` obrigatório, vira `string | null` — tarefas geradas pelo motor de recorrência não têm criador humano.)

Adicionar ao final do arquivo:

```typescript
export interface RecurringTaskTemplateDocumentItem {
  id: string
  name: string
  position: number
}

export interface RecurringTaskTemplate {
  id: string
  departmentId: string
  department: { id: string; name: string }
  title: string
  description: string | null
  periodicity: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'
  dueMonthOffset: number
  dueDayOfPeriod: number
  dueRollToBusinessDay: boolean
  targetOffsetDays: number
  targetRollToBusinessDay: boolean
  generationMonthOffset: number
  generationDayOfPeriod: number
  autoCompleteOnAllActivitiesDone: boolean
  notifyViaWhatsapp: boolean
  notifyViaEmail: boolean
  visibleToClient: boolean
  isActive: boolean
  documentRequests: RecurringTaskTemplateDocumentItem[]
  documentDeliveries: RecurringTaskTemplateDocumentItem[]
}

export interface RecurringTaskAssignment {
  id: string
  templateId: string
  clientId: string
  client: { id: string; name: string }
  boardId: string
  board: { id: string; title: string }
  columnId: string
  isActive: boolean
}

export interface RecurringGenerationLog {
  id: string
  templateId: string
  clientId: string
  competence: string
  status: 'SUCCESS' | 'FAILED'
  taskId: string | null
  errorMessage: string | null
  createdAt: string
}

export interface TaskDocumentRequirement {
  id: string
  taskId: string
  name: string
  status: 'PENDING' | 'UPLOADED' | 'APPROVED' | 'REJECTED'
  rejectionReason: string | null
  signedUrl: string | null
  position: number
}

export interface TaskDeliverable {
  id: string
  taskId: string
  name: string
  deliveredAt: string | null
  signedUrl: string | null
  position: number
}
```

- [ ] **Step 2: `apps/web/src/pages/app/settings/RecurringTemplates.tsx`**

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Pencil, Trash2, Repeat, Users, History } from 'lucide-react'
import { toast } from 'sonner'
import type { RecurringTaskTemplate, RecurringTaskAssignment, RecurringGenerationLog, Department, Client, Board } from '@/types'

const PERIODICITY_LABEL: Record<RecurringTaskTemplate['periodicity'], string> = {
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensal',
  QUARTERLY: 'Trimestral',
  ANNUAL: 'Anual',
}

const MONTH_OFFSET_OPTIONS = [0, 1, 2, 3]
const WEEKDAY_LABEL: Record<number, string> = { 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado', 7: 'Domingo' }

interface FormState {
  departmentId: string
  title: string
  description: string
  periodicity: RecurringTaskTemplate['periodicity']
  dueMonthOffset: number
  dueDayOfPeriod: number
  dueRollToBusinessDay: boolean
  targetOffsetDays: number
  targetRollToBusinessDay: boolean
  generationMonthOffset: number
  generationDayOfPeriod: number
  autoCompleteOnAllActivitiesDone: boolean
  notifyViaWhatsapp: boolean
  notifyViaEmail: boolean
  visibleToClient: boolean
  isActive: boolean
  documentRequests: { name: string }[]
  documentDeliveries: { name: string }[]
}

const EMPTY_FORM: FormState = {
  departmentId: '', title: '', description: '', periodicity: 'MONTHLY',
  dueMonthOffset: 0, dueDayOfPeriod: 10, dueRollToBusinessDay: false,
  targetOffsetDays: 0, targetRollToBusinessDay: false,
  generationMonthOffset: 1, generationDayOfPeriod: 20,
  autoCompleteOnAllActivitiesDone: false, notifyViaWhatsapp: true, notifyViaEmail: false,
  visibleToClient: true, isActive: true, documentRequests: [], documentDeliveries: [],
}

function DocumentListEditor({ label, items, onChange }: {
  label: string
  items: { name: string }[]
  onChange: (items: { name: string }[]) => void
}) {
  const [draft, setDraft] = useState('')
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Nome do documento"
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (draft.trim()) { onChange([...items, { name: draft.trim() }]); setDraft('') } }
          }}
        />
        <Button type="button" variant="outline" onClick={() => { if (draft.trim()) { onChange([...items, { name: draft.trim() }]); setDraft('') } }}>
          Adicionar
        </Button>
      </div>
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-center justify-between text-sm bg-neutral-bg rounded px-2 py-1">
              {item.name}
              <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-danger-text">
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function RecurringTemplates() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<RecurringTaskTemplate | null>(null)
  const [managing, setManaging] = useState<RecurringTaskTemplate | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const { data: templates = [], isLoading } = useQuery<RecurringTaskTemplate[]>({
    queryKey: ['recurring-templates'],
    queryFn: () => api.get('/recurring-templates').then((r) => r.data),
  })

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? api.patch(`/recurring-templates/${editing.id}`, form).then((r) => r.data)
        : api.post('/recurring-templates', form).then((r) => r.data),
    onSuccess: () => {
      toast.success(editing ? 'Template atualizado' : 'Template criado')
      qc.invalidateQueries({ queryKey: ['recurring-templates'] })
      closeDialog()
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao salvar template')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/recurring-templates/${id}`),
    onSuccess: () => {
      toast.success('Template removido')
      qc.invalidateQueries({ queryKey: ['recurring-templates'] })
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao remover template')
    },
  })

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setOpen(true)
  }

  function openEdit(t: RecurringTaskTemplate) {
    setEditing(t)
    setForm({
      departmentId: t.departmentId, title: t.title, description: t.description ?? '',
      periodicity: t.periodicity, dueMonthOffset: t.dueMonthOffset, dueDayOfPeriod: t.dueDayOfPeriod,
      dueRollToBusinessDay: t.dueRollToBusinessDay, targetOffsetDays: t.targetOffsetDays,
      targetRollToBusinessDay: t.targetRollToBusinessDay, generationMonthOffset: t.generationMonthOffset,
      generationDayOfPeriod: t.generationDayOfPeriod, autoCompleteOnAllActivitiesDone: t.autoCompleteOnAllActivitiesDone,
      notifyViaWhatsapp: t.notifyViaWhatsapp, notifyViaEmail: t.notifyViaEmail, visibleToClient: t.visibleToClient,
      isActive: t.isActive,
      documentRequests: t.documentRequests.map((d) => ({ name: d.name })),
      documentDeliveries: t.documentDeliveries.map((d) => ({ name: d.name })),
    })
    setOpen(true)
  }

  function closeDialog() {
    setOpen(false)
    setEditing(null)
    setForm(EMPTY_FORM)
  }

  const isWeekly = form.periodicity === 'WEEKLY'
  const dayOptions = isWeekly ? [1, 2, 3, 4, 5, 6, 7] : Array.from({ length: 31 }, (_, i) => i + 1)

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Tarefas Recorrentes</h1>
        <Button onClick={openCreate} className="gap-2">
          <Plus size={16} />
          Novo template
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <Repeat size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhum template de recorrência cadastrado</p>
          <p className="text-xs mt-1">Crie um pra gerar tarefas automaticamente (ex: Folha de pagamento, mensal).</p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <Card key={t.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{t.title}</span>
                  {!t.isActive && <span className="text-xs px-1.5 py-0.5 rounded-full bg-neutral-bg text-muted-foreground">Inativo</span>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{PERIODICITY_LABEL[t.periodicity]} · {t.department.name}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => setManaging(t)} className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-bg hover:text-foreground" aria-label="Vínculos e log">
                  <Users size={14} />
                </button>
                <button onClick={() => openEdit(t)} className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-bg hover:text-foreground" aria-label="Editar">
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => { if (window.confirm(`Excluir o template "${t.title}"?`)) deleteMutation.mutate(t.id) }}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-danger-bg hover:text-danger-text"
                  aria-label="Excluir"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!v) closeDialog() }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar template' : 'Novo template'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate() }} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Título</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex: Folha de pagamento" required />
            </div>

            <div className="space-y-1.5">
              <Label>Departamento</Label>
              <select
                value={form.departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                required
              >
                <option value="">Selecione</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Periodicidade</Label>
              <select
                value={form.periodicity}
                onChange={(e) => setForm({ ...form, periodicity: e.target.value as FormState['periodicity'] })}
                className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
              >
                {Object.entries(PERIODICITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Vencimento — meses após competência</Label>
                <select
                  value={form.dueMonthOffset}
                  onChange={(e) => setForm({ ...form, dueMonthOffset: Number(e.target.value) })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                  disabled={isWeekly}
                >
                  {MONTH_OFFSET_OPTIONS.map((o) => <option key={o} value={o}>{o === 0 ? 'Mesmo mês' : `${o} ${o === 1 ? 'mês' : 'meses'} depois`}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>{isWeekly ? 'Dia da semana do vencimento' : 'Dia do vencimento'}</Label>
                <select
                  value={form.dueDayOfPeriod}
                  onChange={(e) => setForm({ ...form, dueDayOfPeriod: Number(e.target.value) })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                >
                  {dayOptions.map((d) => <option key={d} value={d}>{isWeekly ? WEEKDAY_LABEL[d] : d}</option>)}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.dueRollToBusinessDay} onChange={(e) => setForm({ ...form, dueRollToBusinessDay: e.target.checked })} />
              Empurrar vencimento pro próximo dia útil se cair em fim de semana
            </label>

            <div className="space-y-1.5">
              <Label>Meta interna — dias em relação ao vencimento (negativo = antes)</Label>
              <Input
                type="number"
                value={form.targetOffsetDays}
                onChange={(e) => setForm({ ...form, targetOffsetDays: Number(e.target.value) })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.targetRollToBusinessDay} onChange={(e) => setForm({ ...form, targetRollToBusinessDay: e.target.checked })} />
              Empurrar meta pro próximo dia útil se cair em fim de semana
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Geração — meses antes da competência</Label>
                <select
                  value={form.generationMonthOffset}
                  onChange={(e) => setForm({ ...form, generationMonthOffset: Number(e.target.value) })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                >
                  {MONTH_OFFSET_OPTIONS.map((o) => <option key={o} value={o}>{o === 0 ? 'Mesmo mês' : `${o} ${o === 1 ? 'mês' : 'meses'} antes`}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Dia da geração</Label>
                <select
                  value={form.generationDayOfPeriod}
                  onChange={(e) => setForm({ ...form, generationDayOfPeriod: Number(e.target.value) })}
                  className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm"
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>

            <DocumentListEditor
              label="Documentos a cobrar do cliente"
              items={form.documentRequests}
              onChange={(items) => setForm({ ...form, documentRequests: items })}
            />
            <DocumentListEditor
              label="Documentos a entregar ao cliente"
              items={form.documentDeliveries}
              onChange={(items) => setForm({ ...form, documentDeliveries: items })}
            />

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.autoCompleteOnAllActivitiesDone} onChange={(e) => setForm({ ...form, autoCompleteOnAllActivitiesDone: e.target.checked })} />
              Concluir automaticamente quando todas as atividades forem resolvidas
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.notifyViaWhatsapp} onChange={(e) => setForm({ ...form, notifyViaWhatsapp: e.target.checked })} />
                Notificar via WhatsApp
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.notifyViaEmail} onChange={(e) => setForm({ ...form, notifyViaEmail: e.target.checked })} />
                Notificar via e-mail
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.visibleToClient} onChange={(e) => setForm({ ...form, visibleToClient: e.target.checked })} />
              O cliente pode ver esta tarefa
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Ativo
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeDialog}>Cancelar</Button>
              <Button type="submit" disabled={saveMutation.isPending || !form.title.trim() || !form.departmentId}>
                {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {managing && <ManageTemplateDialog template={managing} onClose={() => setManaging(null)} />}
    </div>
  )
}

function ManageTemplateDialog({ template, onClose }: { template: RecurringTaskTemplate; onClose: () => void }) {
  const qc = useQueryClient()
  const [clientId, setClientId] = useState('')
  const [boardId, setBoardId] = useState('')
  const [columnId, setColumnId] = useState('')

  const { data: assignments = [] } = useQuery<RecurringTaskAssignment[]>({
    queryKey: ['recurring-assignments', template.id],
    queryFn: () => api.get(`/recurring-templates/${template.id}/assignments`).then((r) => r.data),
  })

  const { data: logs = [] } = useQuery<RecurringGenerationLog[]>({
    queryKey: ['recurring-generation-log', template.id],
    queryFn: () => api.get(`/recurring-templates/${template.id}/generation-log`).then((r) => r.data),
  })

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
  })

  const { data: boards = [] } = useQuery<Board[]>({
    queryKey: ['boards', clientId],
    queryFn: () => api.get('/boards', { params: { clientId } }).then((r) => r.data),
    enabled: !!clientId,
  })

  const board = boards.find((b) => b.id === boardId)

  const addMutation = useMutation({
    mutationFn: () => api.post(`/recurring-templates/${template.id}/assignments`, { clientId, boardId, columnId }),
    onSuccess: () => {
      toast.success('Cliente vinculado')
      qc.invalidateQueries({ queryKey: ['recurring-assignments', template.id] })
      setClientId(''); setBoardId(''); setColumnId('')
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao vincular cliente')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (assignmentId: string) => api.delete(`/recurring-templates/${template.id}/assignments/${assignmentId}`),
    onSuccess: () => {
      toast.success('Vínculo removido')
      qc.invalidateQueries({ queryKey: ['recurring-assignments', template.id] })
    },
  })

  const generateMutation = useMutation({
    mutationFn: (assignmentId: string) => api.post(`/recurring-templates/${template.id}/assignments/${assignmentId}/generate`, {}),
    onSuccess: () => {
      toast.success('Tarefa gerada')
      qc.invalidateQueries({ queryKey: ['recurring-generation-log', template.id] })
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao gerar tarefa')
    },
  })

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template.title} — vínculos e geração</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Clientes vinculados</Label>
            {assignments.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-2">Nenhum cliente vinculado ainda.</p>
            ) : (
              <div className="space-y-1.5 mt-2">
                {assignments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-sm bg-neutral-bg rounded px-2 py-1.5">
                    <span>{a.client.name} — {a.board.title}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => generateMutation.mutate(a.id)} className="text-xs text-accent hover:underline">Gerar agora</button>
                      <button onClick={() => removeMutation.mutate(a.id)} className="text-muted-foreground hover:text-danger-text">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <select value={clientId} onChange={(e) => { setClientId(e.target.value); setBoardId(''); setColumnId('') }} className="h-9 rounded-md border border-border bg-surface px-2 text-sm">
              <option value="">Cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={boardId} onChange={(e) => { setBoardId(e.target.value); setColumnId('') }} className="h-9 rounded-md border border-border bg-surface px-2 text-sm" disabled={!clientId}>
              <option value="">Processo</option>
              {boards.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <select value={columnId} onChange={(e) => setColumnId(e.target.value)} className="h-9 rounded-md border border-border bg-surface px-2 text-sm" disabled={!boardId}>
              <option value="">Coluna</option>
              {board?.columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <Button type="button" size="sm" onClick={() => addMutation.mutate()} disabled={!clientId || !boardId || !columnId || addMutation.isPending}>
            Vincular cliente
          </Button>

          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <History size={12} /> Log de geração
            </Label>
            {logs.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-2">Nenhuma geração registrada ainda.</p>
            ) : (
              <div className="space-y-1 mt-2 max-h-40 overflow-y-auto">
                {logs.map((l) => (
                  <div key={l.id} className={`text-xs rounded px-2 py-1 ${l.status === 'FAILED' ? 'bg-danger-bg text-danger-text' : 'bg-success-bg text-success-text'}`}>
                    {new Date(l.competence).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} — {l.status === 'FAILED' ? l.errorMessage : 'Gerado com sucesso'}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Fechar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Rotear em `router.tsx`**

```typescript
import RecurringTemplates from '@/pages/app/settings/RecurringTemplates'
// ...
      {
        path: 'settings/recurring-templates',
        element: (
          <ProtectedRoute allowedRoles={ADMIN_ROLES}>
            <RecurringTemplates />
          </ProtectedRoute>
        ),
      },
```

(inserir junto dos outros `settings/*`, ex: logo depois do bloco `settings/departments`.)

- [ ] **Step 4: Item de menu em `AppLayout.tsx`**

```tsx
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/recurring-templates" icon={<Repeat size={16} />} label="Tarefas Recorrentes" onClick={handleNavClick} />
          )}
```

(logo depois do link de Departamentos; importar `Repeat` de `lucide-react` no topo do arquivo, junto dos outros ícones já importados.)

- [ ] **Step 5: Rodar `pnpm --filter web exec tsc --noEmit` e confirmar que compila**

- [ ] **Step 6: Verificação visual manual (Playwright)**

Seguindo a lição já registrada em memória desta sessão (QA visual com screenshot real pra telas novas): abrir a tela, criar um template mensal com um documento em cada lista, confirmar que o form salva e a lista atualiza; abrir "Vínculos e geração", vincular um cliente de teste a um board/coluna, clicar "Gerar agora" e confirmar que aparece no log. Testar em claro e escuro.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/pages/app/settings/RecurringTemplates.tsx apps/web/src/router.tsx apps/web/src/components/AppLayout.tsx
git commit -m "feat(web): tela de Tarefas Recorrentes — CRUD de template, vínculos por cliente e log de geração"
```

---

### Task 12: `TaskDrawer.tsx` — status expandido, visibilidade, competência/meta, checklist de documentos

**Depende de:** Task 9 (endpoints `/tasks/:id/documents/*`), Task 11 (`types/index.ts` já atualizado).

**Files:**
- Modify: `apps/web/src/components/shared/TaskDrawer.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /tasks/:id`, `GET/POST /tasks/:id/documents/requests`, `GET/POST /tasks/:id/documents/deliveries`, `PATCH /tasks/:id/documents/requests/:reqId`, `POST /tasks/:id/documents/deliveries/:reqId/upload` (Task 9).

- [ ] **Step 1: Badge de status — substituir o bloco de badges no header**

Trocar as constantes de prioridade (mantidas) e adicionar as de status, logo abaixo de `PRIORITY_COLOR`:

```typescript
const STATUS_LABEL: Record<Task['status'], string> = {
  OPEN: 'Aberto',
  DONE: 'Concluído',
  DISREGARDED: 'Desconsiderado',
  BLOCKED: 'Com Impedimento',
}

const STATUS_COLOR: Record<Task['status'], string> = {
  OPEN: 'bg-gray-100 text-gray-600',
  DONE: 'bg-green-100 text-green-600',
  DISREGARDED: 'bg-gray-200 text-gray-500',
  BLOCKED: 'bg-red-100 text-red-600',
}
```

No bloco "Badges de metadados" (dentro do header), adicionar o select de status entre o de prioridade e o de departamento:

```tsx
            {canEdit ? (
              <select
                value={task.status}
                onChange={(e) => updateMutation.mutate({ status: e.target.value as Task['status'] })}
                className={cn('text-xs font-medium px-2 py-0.5 rounded-full border-0 cursor-pointer', STATUS_COLOR[task.status])}
              >
                {(['OPEN', 'DONE', 'DISREGARDED', 'BLOCKED'] as Task['status'][]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            ) : (
              <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', STATUS_COLOR[task.status])}>
                {STATUS_LABEL[task.status]}
              </span>
            )}
```

Ampliar a assinatura de `updateMutation` (que hoje só aceita `title | priority | description | dueDate | departmentId`) pra incluir `status` e `visibleToClient`:

```typescript
  const updateMutation = useMutation({
    mutationFn: (data: Partial<Pick<Task, 'title' | 'priority' | 'status' | 'description' | 'dueDate' | 'departmentId' | 'visibleToClient' | 'targetDate' | 'competence'>>) =>
      api.patch(`/tasks/${task.id}`, data).then((r) => r.data),
    onSuccess: () => {
      toast.success('Tarefa atualizada')
      queryClient.invalidateQueries({ queryKey: ['board'] })
    },
    onError: () => toast.error('Erro ao salvar tarefa'),
  })
```

`PATCH /tasks/:id` já aceita `status` desde a Task 9; `visibleToClient` **não** foi incluído no `updateTaskSchema` da Task 9 (a spec só pedia status) — adicionar aqui:

```typescript
// em apps/api/src/modules/tasks/tasks.schema.ts, updateTaskSchema:
  visibleToClient: z.boolean().optional(),
```

E em `tasks.service.ts`, `updateTask`, incluir `visibleToClient: data.visibleToClient` no `tx.task.update`'s `data`.

- [ ] **Step 2: Toggle "O cliente pode ver esta tarefa"**

Adicionar no header, junto do bloco de badges, só quando `canEdit`:

```tsx
            {canEdit && (
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={task.visibleToClient}
                  onChange={(e) => updateMutation.mutate({ visibleToClient: e.target.checked })}
                />
                Cliente pode ver
              </label>
            )}
```

- [ ] **Step 3: Competência / meta (exibição, editável em qualquer tarefa)**

`updateTaskSchema`/`tx.task.update` (Task 9) ainda não incluem `targetDate`/`competence` no payload de `PATCH /tasks/:id` — adicionar os dois campos primeiro:

```typescript
// tasks.schema.ts, updateTaskSchema:
  targetDate: z.string().datetime().nullable().optional(),
  competence: z.string().datetime().nullable().optional(),
```

```typescript
// tasks.service.ts, updateTask, no tx.task.update:
        targetDate:
          data.targetDate === null ? null
          : data.targetDate !== undefined ? new Date(data.targetDate)
          : undefined,
        competence:
          data.competence === null ? null
          : data.competence !== undefined ? new Date(data.competence)
          : undefined,
```

Com isso, o campo de meta no drawer fica (adicionado ao lado do campo de vencimento já existente):

```tsx
            {canEdit ? (
              <input
                type="date"
                defaultValue={task.targetDate ? task.targetDate.slice(0, 10) : ''}
                onChange={(e) => {
                  const val = e.target.value
                  updateMutation.mutate({ targetDate: val ? new Date(val + 'T00:00:00').toISOString() : null })
                }}
                title="Meta interna"
                className="text-xs border border-gray-300 rounded px-2 py-0.5 text-gray-700"
              />
            ) : (
              task.targetDate && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100" title="Meta interna">
                  Meta: {new Date(task.targetDate).toLocaleDateString('pt-BR')}
                </span>
              )
            )}
            {task.competence && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100" title="Competência">
                Competência: {new Date(task.competence).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
              </span>
            )}
```

(campo de competência fica só leitura no drawer — é definido na geração, editar manualmente não é um caso de uso comum; se o escritório precisar corrigir, pode ser feito depois via uma ação dedicada, fora de escopo por agora.)

- [ ] **Step 4: Nova aba "Documentos"**

Adicionar ao array `TABS` (import `FileCheck` de `lucide-react`):

```typescript
  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'comments', label: 'Comentários', icon: <MessageSquare size={14} /> },
    { id: 'documents', label: 'Documentos', icon: <FileCheck size={14} /> },
    { id: 'attachments', label: 'Anexos', icon: <Paperclip size={14} /> },
    { id: 'history', label: 'Histórico', icon: <Clock size={14} /> },
  ]
```

Atualizar `type Tab = 'comments' | 'documents' | 'attachments' | 'history'`.

Adicionar o fetch (junto dos outros `useQuery` do componente):

```typescript
  const { data: documents } = useQuery<{ requirements: TaskDocumentRequirement[]; deliverables: TaskDeliverable[] }>({
    queryKey: ['task-documents', task.id],
    queryFn: () => api.get(documentsEndpoint(task.id, role)).then((r) => r.data),
    enabled: tab === 'documents',
  })
```

Com o helper de endpoint (mesmo padrão de `historyEndpoint`, junto dele no topo do arquivo):

```typescript
const documentsEndpoint = (taskId: string, role: DrawerRole) =>
  role === 'CLIENT'
    ? `/portal/tasks/${taskId}/documents`
    : `/tasks/${taskId}/documents`
```

Mutations (junto das outras mutations do componente):

```typescript
  const addRequirementMutation = useMutation({
    mutationFn: (name: string) => api.post(`/tasks/${task.id}/documents/requests`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-documents', task.id] }),
  })

  const addDeliverableMutation = useMutation({
    mutationFn: (name: string) => api.post(`/tasks/${task.id}/documents/deliveries`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['task-documents', task.id] }),
  })

  const uploadRequirementMutation = useMutation({
    mutationFn: ({ reqId, file }: { reqId: string; file: File }) => {
      const form = new FormData()
      form.append('file', file)
      const url = role === 'CLIENT'
        ? `/portal/tasks/${task.id}/documents/requests/${reqId}/upload`
        : `/tasks/${task.id}/documents/requests/${reqId}/upload`
      return api.post(url, form)
    },
    onSuccess: () => {
      toast.success('Arquivo enviado')
      queryClient.invalidateQueries({ queryKey: ['task-documents', task.id] })
    },
    onError: () => toast.error('Erro ao enviar arquivo'),
  })

  const reviewRequirementMutation = useMutation({
    mutationFn: ({ reqId, decision, rejectionReason }: { reqId: string; decision: 'APPROVED' | 'REJECTED'; rejectionReason?: string }) =>
      api.patch(`/tasks/${task.id}/documents/requests/${reqId}`, { decision, rejectionReason }),
    onSuccess: () => {
      toast.success('Documento avaliado')
      queryClient.invalidateQueries({ queryKey: ['task-documents', task.id] })
    },
    onError: () => toast.error('Erro ao avaliar documento'),
  })

  const deliverMutation = useMutation({
    mutationFn: ({ reqId, file }: { reqId: string; file: File }) => {
      const form = new FormData()
      form.append('file', file)
      return api.post(`/tasks/${task.id}/documents/deliveries/${reqId}/upload`, form)
    },
    onSuccess: () => {
      toast.success('Documento entregue')
      queryClient.invalidateQueries({ queryKey: ['task-documents', task.id] })
    },
    onError: () => toast.error('Erro ao entregar documento'),
  })
```

Conteúdo da aba (dentro do `{tab === 'documents' && (...)}`, no bloco "Conteúdo da aba"):

```tsx
          {tab === 'documents' && documents && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">A cobrar do cliente</p>
                {documents.requirements.length === 0 && <p className="text-sm text-gray-400">Nenhum documento a cobrar.</p>}
                <div className="space-y-2">
                  {documents.requirements.map((r) => (
                    <div key={r.id} className="bg-gray-50 rounded-lg px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">{r.name}</span>
                        <span className={cn(
                          'text-xs font-medium px-2 py-0.5 rounded-full',
                          r.status === 'PENDING' && 'bg-gray-100 text-gray-500',
                          r.status === 'UPLOADED' && 'bg-blue-100 text-blue-600',
                          r.status === 'APPROVED' && 'bg-green-100 text-green-600',
                          r.status === 'REJECTED' && 'bg-red-100 text-red-600',
                        )}>
                          {{ PENDING: 'Pendente', UPLOADED: 'Enviado', APPROVED: 'Aprovado', REJECTED: 'Rejeitado' }[r.status]}
                        </span>
                      </div>
                      {r.rejectionReason && <p className="text-xs text-red-500 mt-1">Motivo: {r.rejectionReason}</p>}
                      {r.signedUrl && (
                        <a href={r.signedUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-1 block">
                          Ver arquivo enviado
                        </a>
                      )}
                      {canEdit && r.status === 'UPLOADED' && (
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => reviewRequirementMutation.mutate({ reqId: r.id, decision: 'APPROVED' })} className="text-xs text-green-600 hover:underline">
                            Aprovar
                          </button>
                          <button
                            onClick={() => {
                              const reason = window.prompt('Motivo da rejeição:')
                              if (reason?.trim()) reviewRequirementMutation.mutate({ reqId: r.id, decision: 'REJECTED', rejectionReason: reason.trim() })
                            }}
                            className="text-xs text-red-600 hover:underline"
                          >
                            Rejeitar
                          </button>
                        </div>
                      )}
                      {(r.status === 'PENDING' || r.status === 'REJECTED') && (
                        <label className="inline-block mt-2 cursor-pointer">
                          <input type="file" className="hidden" onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) uploadRequirementMutation.mutate({ reqId: r.id, file })
                            e.target.value = ''
                          }} />
                          <span className="text-xs text-blue-600 hover:underline">Enviar arquivo</span>
                        </label>
                      )}
                    </div>
                  ))}
                </div>
                {canEdit && (
                  <button
                    onClick={() => { const name = window.prompt('Nome do documento a cobrar:'); if (name?.trim()) addRequirementMutation.mutate(name.trim()) }}
                    className="text-xs text-blue-600 hover:underline mt-2"
                  >
                    + Adicionar documento a cobrar
                  </button>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">A entregar ao cliente</p>
                {documents.deliverables.length === 0 && <p className="text-sm text-gray-400">Nenhum documento a entregar.</p>}
                <div className="space-y-2">
                  {documents.deliverables.map((d) => (
                    <div key={d.id} className="bg-gray-50 rounded-lg px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-700">{d.name}</span>
                        <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', d.deliveredAt ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500')}>
                          {d.deliveredAt ? 'Entregue' : 'Pendente'}
                        </span>
                      </div>
                      {d.signedUrl && (
                        <a href={d.signedUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-1 block">
                          Ver arquivo entregue
                        </a>
                      )}
                      {canEdit && (
                        <label className="inline-block mt-2 cursor-pointer">
                          <input type="file" className="hidden" onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) deliverMutation.mutate({ reqId: d.id, file })
                            e.target.value = ''
                          }} />
                          <span className="text-xs text-blue-600 hover:underline">{d.deliveredAt ? 'Substituir arquivo' : 'Enviar arquivo'}</span>
                        </label>
                      )}
                    </div>
                  ))}
                </div>
                {canEdit && (
                  <button
                    onClick={() => { const name = window.prompt('Nome do documento a entregar:'); if (name?.trim()) addDeliverableMutation.mutate(name.trim()) }}
                    className="text-xs text-blue-600 hover:underline mt-2"
                  >
                    + Adicionar documento a entregar
                  </button>
                )}
              </div>
            </div>
          )}
```

Cliente (`role === 'CLIENT'`) só vê o formulário de upload nos itens `PENDING`/`REJECTED` da lista de cobrança (sem botão aprovar/rejeitar, gated por `canEdit` que já é `false` pra CLIENT) e só visualiza a lista de entrega (sem upload lá — `canEdit` também controla isso).

Atualizar o import do topo: `import type { Task, Attachment, TaskHistory, DrawerRole, TaskDocumentRequirement, TaskDeliverable } from '@/types'` e adicionar `FileCheck` a `import { X, Paperclip, MessageSquare, Clock, Trash2, FileCheck } from 'lucide-react'`.

- [ ] **Step 5: Atualizar `ACTION_LABELS` (histórico) com o novo action de status**

```typescript
const ACTION_LABELS: Record<string, string> = {
  moved_to: 'moveu para',
  created: 'criou a tarefa',
  updated_priority: 'alterou prioridade para',
  updated_title: 'alterou título para',
  updated_assignee: 'alterou responsável para',
  updated_due_date: 'alterou vencimento para',
  attachment_added: 'adicionou o anexo',
  attachment_deleted: 'removeu o anexo',
  status_changed: 'alterou status para',
  priority_changed: 'alterou prioridade para',
  assigned_to: 'alterou responsável para',
}
```

(`priority_changed`/`assigned_to` já eram os `action` reais gravados por `tasks.service.ts` — só não estavam mapeados aqui, o histórico caía no fallback `h.action` cru; corrigido junto por serem o mesmo tipo de gap.)

- [ ] **Step 6: Rodar `pnpm --filter web exec tsc --noEmit` e `pnpm --filter web test`**

- [ ] **Step 7: Verificação visual manual (Playwright)** — abrir uma tarefa gerada por recorrência (com checklist), aprovar/rejeitar um documento, confirmar que o badge de status muda sozinho pra "Com Impedimento"/"Aberto" sem precisar dar refresh na página (a invalidação de `['board']` já força o refetch). Testar em claro e escuro.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/shared/TaskDrawer.tsx apps/api/src/modules/tasks
git commit -m "feat(web): status expandido, visibilidade e checklist de documentos no TaskDrawer"
```

---

### Task 13: Filtro por competência/vencimento/meta dentro do board de um cliente

**Depende de:** Task 1 (campos `competence`/`targetDate` no schema).

**Files:**
- Modify: `apps/api/src/modules/boards/boards.schema.ts`
- Modify: `apps/api/src/modules/boards/boards.service.ts`
- Modify: `apps/web/src/pages/app/Board.tsx`

**Interfaces:**
- Consumes: `GET /boards/:id/tasks/search` (existente, estendido).

Nota do detalhe pendente da spec: o "detalhe da tarefa no portal" (checklists de documento em modo cliente) já foi resolvido de graça na Task 12 — `apps/web/src/components/portal/TaskDrawer.tsx` é só um re-export do `TaskDrawer` compartilhado, que já ramifica por `role` (Task 12). Esta task cobre só o que ainda faltava: o filtro de datas dentro do board.

- [ ] **Step 1: `boards.schema.ts` — estender `searchQuerySchema`**

```typescript
export const searchQuerySchema = z.object({
  q: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  status: z.enum(['OPEN', 'DONE', 'DISREGARDED', 'BLOCKED']).optional(),
  assigneeId: z.string().cuid().optional(),
  dueBefore: z.string().datetime().optional(),
  dueAfter: z.string().datetime().optional(),
  competence: z.string().datetime().optional(),
  targetBefore: z.string().datetime().optional(),
  targetAfter: z.string().datetime().optional(),
})
```

- [ ] **Step 2: `boards.service.ts` — `searchTasks` aplica os filtros novos**

```typescript
export async function searchTasks(boardId: string, organizationId: string, filters: SearchQuery) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, organizationId, isActive: true },
  })
  if (!board) throw new AppError(404, 'Board não encontrado')

  return prisma.task.findMany({
    where: {
      column: { boardId },
      ...(filters.q ? { title: { contains: filters.q, mode: 'insensitive' } } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
      ...(filters.dueBefore ? { dueDate: { lte: new Date(filters.dueBefore) } } : {}),
      ...(filters.dueAfter ? { dueDate: { gte: new Date(filters.dueAfter) } } : {}),
      ...(filters.competence ? { competence: new Date(filters.competence) } : {}),
      ...(filters.targetBefore ? { targetDate: { lte: new Date(filters.targetBefore) } } : {}),
      ...(filters.targetAfter ? { targetDate: { gte: new Date(filters.targetAfter) } } : {}),
    },
    orderBy: { position: 'asc' },
  })
}
```

- [ ] **Step 3: `Board.tsx` — filtro de competência (seletor de mês)**

Adicionar estado (junto de `search`/`filterPriority`):

```typescript
  const [filterCompetence, setFilterCompetence] = useState('')
  const hasFilters = search.trim() !== '' || filterPriority !== '' || filterCompetence !== ''
```

Incluir no `queryKey`/params da busca:

```typescript
    queryKey: ['board-search', boardId, search, filterPriority, filterCompetence],
    queryFn: () => {
      const params = new URLSearchParams()
      if (search.trim()) params.set('q', search.trim())
      if (filterPriority) params.set('priority', filterPriority)
      if (filterCompetence) params.set('competence', new Date(filterCompetence + '-01T00:00:00').toISOString())
      return api.get(`/boards/${boardId}/tasks/search?${params}`).then((r) => r.data)
    },
```

Controle na barra de busca (ao lado do select de prioridade):

```tsx
        <input
          type="month"
          value={filterCompetence}
          onChange={(e) => setFilterCompetence(e.target.value)}
          title="Filtrar por competência"
          className="h-8 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
```

E no botão "Limpar", resetar também `filterCompetence`:

```typescript
              setSearch('')
              setFilterPriority('')
              setFilterCompetence('')
```

`input type="month"` já entrega o valor no formato `YYYY-MM`, então `new Date(filterCompetence + '-01T00:00:00')` reconstrói o primeiro dia do mês em UTC-local, compatível com como `competence` é sempre gravado (primeiro dia do período). Vencimento (`dueBefore`/`dueAfter`) e meta (`targetBefore`/`targetAfter`) já existem como parâmetros aceitos pela API — não adicionar controles de UI extras pra eles nesta fase (o filtro de competência já resolve o caso de uso citado na spec, "Folha de pagamento desse mês"; vencimento/meta ficam disponíveis via API pra quando o item 2c — visão cross-cliente — precisar deles).

- [ ] **Step 4: Rodar `pnpm --filter api test src/modules/boards` e `pnpm --filter web exec tsc --noEmit`**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/boards apps/web/src/pages/app/Board.tsx
git commit -m "feat: filtro por competência no board + campos de vencimento/meta na busca da API"
```
