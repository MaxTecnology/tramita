# Calendário Mensal + Sinalização de Impedimento no Portal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela "Tarefas" ganha um terceiro modo (Calendário mensal), e o escritório ganha controle
explícito (toggle + mensagem customizável) sobre notificar o cliente final quando uma tarefa dele
entra em impedimento, com o selo de status correspondente agora visível no Kanban do portal.

**Architecture:** O calendário é puramente um novo modo de visualização sobre a infraestrutura já
existente (`GET /tasks`, `useInfiniteQuery`, `TaskDrawer`) — nenhuma rota nova no backend. A
notificação de impedimento segue o motor de `NotificationEvent`/`NotificationConfig` já existente
(mesmo padrão de `TASK_DUE_DATE_APPROACHING`/`dueDateAlert`), com um único helper
(`notifyIfBlocked`) chamado nos três (e só três, confirmado por varredura) pontos do código que
escrevem `Task.status`.

**Tech Stack:** Fastify v5 + Prisma v6 (API), React 19 + Vite + TailwindCSS + TanStack Query v5
(frontend) — mesma stack do resto do projeto.

**Spec:** `docs/superpowers/specs/2026-10-05-calendario-impedimento-portal-design.md`

## Global Constraints

- TypeScript `strict: true`, sem `any`, sem `as unknown`.
- Validação Zod em todo body/param de rota.
- Erros via `AppError(statusCode, message)`.
- Migrations escritas à mão, aplicadas via `pnpm --filter api migrate:deploy` no banco dev (5432) e
  teste (5433) antes de rodar qualquer teste.
- A notificação `TASK_BLOCKED` **nunca** usa `forceChannels` — ao contrário de
  `Column.notifyClient`, ela respeita o toggle `config.taskBlocked` da organização. Esse é o
  requisito não-negociável desta feature: o escritório pediu controle explícito.
- Agrupamento de tarefas por dia no calendário usa a convenção "date-only UTC" já estabelecida em
  `apps/web/src/lib/dates.ts` — nunca `date.getDate()`/`date.getMonth()` direto (desloca o dia em
  fusos atrás de UTC).
- Toda tarefa termina com `pnpm --filter api exec tsc --noEmit` + `pnpm --filter api test` (ou
  `pnpm --filter web`, quando tocar frontend) verdes antes do commit.

## Review Focus

- Uma tarefa movida para uma coluna com `statusEffect: BLOCKED` **e** que também tem
  `ColumnDocument`s configurados (dispara `recalculateTaskStatus` de dentro de `moveTask`) deve
  notificar **exatamente uma vez**, não duas — é o ponto mais fácil de um reviewer descartar como
  "óbvio" e deixar passar um bug de notificação duplicada.
- Desligar `config.taskBlocked` na organização realmente impede o envio — não é óbvio pela leitura
  do código do helper isoladamente, só confirmando contra o `EVENT_FLAG_MAP` do worker.
- Uma tarefa que sai de `BLOCKED` pra `OPEN` (impedimento resolvido) não deve gerar notificação
  nenhuma — só a transição de entrada em `BLOCKED` importa.
- Tarefa sem `targetDate` nem `dueDate` deve ficar **ausente** do calendário, não quebrar o
  agrupamento nem aparecer num "dia inválido".
- Uma tarefa com `targetDate` resultando em dia diferente dependendo do fuso (ex.: executado num
  CI com `TZ` não-UTC) precisa cair no dia certo de qualquer forma — teste determinístico contra o
  valor UTC, não contra o relógio da máquina de teste.

---

## Task 1: Schema — `NotificationEvent.TASK_BLOCKED` + `NotificationConfig.taskBlocked`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261005210000_task_blocked_notification/migration.sql`

**Interfaces:**
- Produces: enum value `TASK_BLOCKED` em `NotificationEvent`, campo `NotificationConfig.taskBlocked:
  boolean` — consumidos pela Task 2 (worker/helper) e Task 3 (UI de Configurações).

- [ ] **Step 1: `schema.prisma`**

No `enum NotificationEvent` (linha ~694), adicionar o valor novo:

```prisma
enum NotificationEvent {
  TASK_CREATED
  TASK_MOVED
  TASK_COMPLETED
  TASK_COMMENT_ADDED
  TASK_DUE_DATE_APPROACHING
  TASK_BLOCKED
  REQUEST_CREATED
  REQUEST_APPROVED
  REQUEST_REJECTED
  RECURRING_GENERATION_FAILED
  DOCUMENT_REJECTED
}
```

No `model NotificationConfig` (linha ~651), adicionar o campo logo após `dueDateAlert`:

```prisma
model NotificationConfig {
  id                        String   @id @default(cuid())
  organizationId            String   @unique
  whatsappEnabled           Boolean  @default(true)
  emailEnabled              Boolean  @default(true)
  taskCreated               Boolean  @default(false)
  taskMoved                 Boolean  @default(true)
  taskCompleted             Boolean  @default(true)
  commentAdded              Boolean  @default(true)
  dueDateAlert              Boolean  @default(true)
  taskBlocked               Boolean  @default(true)
  requestCreated            Boolean  @default(true)
  requestApproved           Boolean  @default(true)
  requestRejected           Boolean  @default(true)
  maximizebotToken          String?
  saveOnTicket              Boolean  @default(true)
  startChatbot              Boolean  @default(false)
  recurringGenerationFailed Boolean  @default(true)
  documentRejected          Boolean  @default(true)
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])

  @@map("notification_configs")
}
```

Rodar `pnpm --filter api exec prisma format` depois de editar.

- [ ] **Step 2: Migration**

```sql
-- CreateEnumValue (sozinho, sem uso na mesma migration — ALTER TYPE ... ADD VALUE não pode ser
-- usado e consumido na mesma transação/migration)
ALTER TYPE "NotificationEvent" ADD VALUE 'TASK_BLOCKED';

-- AlterTable
ALTER TABLE "notification_configs" ADD COLUMN "taskBlocked" BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 3: Aplicar nos dois bancos, regenerar client**

```bash
pnpm --filter api migrate:deploy
DATABASE_URL="postgresql://tramita:tramita@localhost:5433/tramita_test" \
  node -r dotenv/config apps/api/node_modules/prisma/build/index.js migrate deploy --schema apps/api/prisma/schema.prisma
pnpm --filter api exec prisma generate
```

- [ ] **Step 4: Verificar, commit**

```bash
pnpm --filter api exec tsc --noEmit
git add apps/api/prisma
git commit -m "feat(notifications): adiciona evento TASK_BLOCKED e toggle taskBlocked"
```

---

## Task 2: Backend — `notifyIfBlocked` + wiring nos 3 pontos de escrita de status

**Files:**
- Modify: `apps/api/src/modules/task-documents/task-documents.service.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.ts`
- Modify: `apps/api/src/workers/notification.worker.ts`
- Modify: `apps/api/src/lib/default-templates.ts`
- Modify: `apps/api/src/modules/notifications/notifications.schema.ts`
- Modify: `apps/api/src/modules/task-documents/task-documents.service.test.ts`
- Modify: `apps/api/src/modules/tasks/tasks.service.test.ts`
- Modify: `apps/api/src/workers/notification.worker.test.ts`
- Create: `apps/api/src/modules/notifications/notifications.routes.test.ts`

**Interfaces:**
- Consumes: `NotificationEvent.TASK_BLOCKED`, `NotificationConfig.taskBlocked` (Task 1).
- Produces: `notifyIfBlocked(taskId, previousStatus, newStatus, clientId, organizationId): Promise<void>`
  exportado de `task-documents.service.ts` — consumido por `tasks.service.ts`.

- [ ] **Step 1: `notifications.schema.ts` — `updateConfigSchema` ganha `taskBlocked`**

```ts
export const updateConfigSchema = z.object({
  whatsappEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  taskCreated: z.boolean().optional(),
  taskMoved: z.boolean().optional(),
  taskCompleted: z.boolean().optional(),
  commentAdded: z.boolean().optional(),
  dueDateAlert: z.boolean().optional(),
  taskBlocked: z.boolean().optional(),
  maximizebotToken: z.string().optional(),
  saveOnTicket: z.boolean().optional(),
  startChatbot: z.boolean().optional(),
})
```

(Só essa linha nova — **não** adicionar `requestCreated`/`requestApproved`/`requestRejected`/
`recurringGenerationFailed`/`documentRejected` aqui; essa ausência é um débito técnico pré-existente
e separado, fora do escopo desta task — ver Task 8.)

- [ ] **Step 2: `default-templates.ts` — entrada `TASK_BLOCKED`**

Adicionar ao objeto `DEFAULT_TEMPLATES` (qualquer posição — é um `Record`, não importa ordem; o
TypeScript recusa compilar se faltar):

```ts
  TASK_BLOCKED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! A tarefa *{{taskTitle}}* está com impedimento e precisa da sua atenção.\n\nAcesse: {{portalUrl}}' },
    EMAIL: { subject: 'Tarefa com impedimento — {{taskTitle}}', body: 'Olá, {{clientName}}!\n\nA tarefa *{{taskTitle}}* está com impedimento e precisa da sua atenção.\n\nAcesse: {{portalUrl}}' },
  },
```

- [ ] **Step 3: `notification.worker.ts` — `EVENT_FLAG_MAP` ganha `TASK_BLOCKED`**

```ts
const EVENT_FLAG_MAP: Record<string, keyof NotificationConfig> = {
  TASK_CREATED: 'taskCreated',
  TASK_MOVED: 'taskMoved',
  TASK_COMPLETED: 'taskCompleted',
  TASK_COMMENT_ADDED: 'commentAdded',
  TASK_DUE_DATE_APPROACHING: 'dueDateAlert',
  TASK_BLOCKED: 'taskBlocked',
  REQUEST_CREATED: 'requestCreated',
  REQUEST_APPROVED: 'requestApproved',
  REQUEST_REJECTED: 'requestRejected',
  RECURRING_GENERATION_FAILED: 'recurringGenerationFailed',
  DOCUMENT_REJECTED: 'documentRejected',
}
```

Esse `Record` é tipado `Record<string, keyof NotificationConfig>` — o TypeScript **não** obriga essa
entrada (chave solta), diferente de `DEFAULT_TEMPLATES`. Esquecer este passo faz `isEnabled` cair em
`false` sempre (linha `(config[EVENT_FLAG_MAP[event]] as boolean | undefined) ?? false`), e a
notificação nunca sai, mesmo com o toggle ligado — conferir com atenção.

- [ ] **Step 4: `task-documents.service.ts` — `notifyIfBlocked` + wiring em `recalculateTaskStatus`**

Adicionar o import de `enqueueNotification` já existe no topo do arquivo (linha 4) — não precisa de
import novo. Adicionar a função nova antes de `recalculateTaskStatus`:

```ts
// Ponto único de disparo da notificação TASK_BLOCKED — chamado por recalculateTaskStatus (abaixo,
// quando um documento pendente/rejeitado bloqueia a tarefa) e por tasks.service.ts's moveTask/
// updateTask (os outros dois — e únicos outros, confirmado por varredura do código inteiro — pontos
// que escrevem Task.status). Só dispara na transição DE ENTRADA em BLOCKED, nunca em edições
// subsequentes enquanto já está bloqueada, nunca ao sair de BLOCKED.
export async function notifyIfBlocked(
  taskId: string,
  previousStatus: TaskStatus,
  newStatus: TaskStatus,
  clientId: string,
  organizationId: string,
): Promise<void> {
  if (newStatus !== 'BLOCKED' || previousStatus === 'BLOCKED') return
  await enqueueNotification({
    event: 'TASK_BLOCKED',
    organizationId,
    clientId,
    taskId,
    metadata: {},
  })
}
```

Modificar `recalculateTaskStatus` pra buscar `clientId`/`organizationId` e chamar o helper depois da
transação:

```ts
export async function recalculateTaskStatus(taskId: string) {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      documentRequirements: true,
      deliverables: true,
      recurringTemplate: { select: { autoCompleteOnAllActivitiesDone: true } },
      column: { select: { board: { select: { clientId: true, organizationId: true } } } },
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

    await notifyIfBlocked(taskId, task.status, nextStatus, task.column.board.clientId, task.column.board.organizationId)
  }
}
```

- [ ] **Step 5: `tasks.service.ts` — wiring em `moveTask` e `updateTask`**

Importar `notifyIfBlocked` de `task-documents.service.ts` (já existe import de
`recalculateTaskStatus` de lá — adicionar na mesma linha):

```ts
import { recalculateTaskStatus, notifyIfBlocked } from '@/modules/task-documents/task-documents.service'
```

Em `moveTask`, logo depois do bloco que envia `TASK_MOVED`/`TASK_COMPLETED` (depois da linha que
fecha o `if (toColumn.statusEffect === 'DONE') { ... }`, antes de `publishBoardEvent`):

```ts
  await notifyIfBlocked(taskId, task.status, nextStatus, toColumn.board.clientId, organizationId)

  await publishBoardEvent(toColumn.board.id, {
```

(`task.status` aqui é o status ORIGINAL da tarefa, capturado no início da função antes de qualquer
update — `nextStatus` é o valor calculado na linha `const nextStatus = toColumn.statusEffect !== 'NONE' ? ...`.
Essa chamada cobre a transição direta via `statusEffect` da coluna. Mais abaixo na mesma função, se a
coluna tiver `ColumnDocument`s e `recalculateTaskStatus(taskId)` for chamado, esse helper já dispara
sua própria notificação internamente — e não duplica, porque nesse ponto o banco já reflete
`nextStatus` escrito aqui, então o `task.status !== 'BLOCKED'` dentro de `recalculateTaskStatus` só é
`true` se a transição ainda não tinha acontecido.)

Em `updateTask`, logo depois do `await prisma.$transaction(...)` que fecha a função principal (antes
de `await publishBoardEvent(task.column.board.id, ...)`):

```ts
  if (data.status !== undefined) {
    await notifyIfBlocked(id, task.status, data.status, task.column.board.clientId, organizationId)
  }

  await publishBoardEvent(task.column.board.id, {
```

- [ ] **Step 6: Testes — `task-documents.service.test.ts`**

```ts
describe('notifyIfBlocked (via recalculateTaskStatus)', () => {
  it('enfileira TASK_BLOCKED quando um documento pendente bloqueia a tarefa', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    await prisma.taskDocumentRequirement.create({ data: { taskId: task.id, name: 'Contrato', position: 0 } })

    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    await recalculateTaskStatus(task.id)

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'TASK_BLOCKED', taskId: task.id }))
    spy.mockRestore()
  })

  it('não notifica de novo se a tarefa já estava BLOCKED', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    await prisma.task.update({ where: { id: task.id }, data: { status: 'BLOCKED' } })
    await prisma.taskDocumentRequirement.create({ data: { taskId: task.id, name: 'Contrato', position: 0 } })

    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    await recalculateTaskStatus(task.id)

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('não notifica ao resolver o impedimento (BLOCKED -> OPEN)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)
    await prisma.task.update({ where: { id: task.id }, data: { status: 'BLOCKED' } })
    const req = await prisma.taskDocumentRequirement.create({ data: { taskId: task.id, name: 'Contrato', position: 0 } })
    await prisma.taskDocumentRequirement.update({ where: { id: req.id }, data: { status: 'APPROVED' } })

    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    await recalculateTaskStatus(task.id)

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
```

Verificar no topo do arquivo de teste se `queue` já está importado como `import * as queue from
'@/lib/queue'` (mesmo padrão usado em `recurring-tasks.cron.test.ts`/`tasks.routes.test.ts`); se não
estiver, adicionar.

- [ ] **Step 7: Testes — `tasks.service.test.ts`**

```ts
describe('notifyIfBlocked (via moveTask e updateTask)', () => {
  it('moveTask: notifica exatamente uma vez quando a coluna de destino é BLOCKED e tem documentos configurados', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const colA = await createTestColumn(board.id, { position: 0 })
    const colB = await createTestColumn(board.id, { position: 1, statusEffect: 'BLOCKED' })
    await prisma.columnDocument.create({ data: { columnId: colB.id, name: 'Contrato', position: 0 } })
    const task = await createTestTask(colA.id, user.id)

    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    await moveTask(task.id, org.id, { columnId: colB.id, position: 0 }, { id: user.id, type: 'user' })

    const blockedCalls = spy.mock.calls.filter((c) => (c[0] as { event: string }).event === 'TASK_BLOCKED')
    expect(blockedCalls).toHaveLength(1)
    spy.mockRestore()
  })

  it('updateTask: notifica quando o status é editado manualmente para BLOCKED', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    await updateTask(task.id, org.id, { status: 'BLOCKED' }, { id: user.id, type: 'user' })

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ event: 'TASK_BLOCKED', taskId: task.id }))
    spy.mockRestore()
  })

  it('updateTask: não notifica quando o status muda entre valores que não são BLOCKED', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    const spy = vi.spyOn(queue, 'enqueueNotification').mockResolvedValue()
    await updateTask(task.id, org.id, { status: 'STARTED' }, { id: user.id, type: 'user' })

    const blockedCalls = spy.mock.calls.filter((c) => (c[0] as { event: string }).event === 'TASK_BLOCKED')
    expect(blockedCalls).toHaveLength(0)
    spy.mockRestore()
  })
})
```

- [ ] **Step 8: Teste no worker — `config.taskBlocked` realmente controla o envio (ponto do Review
  Focus desta spec: o mais importante pro usuário, que pediu esse controle explicitamente)**

Adicionar ao `notification.worker.test.ts` existente, seguindo exatamente o padrão já usado pela
`describe` de `Column.notifyClient forceChannels` logo acima dela no mesmo arquivo:

```ts
describe('processNotificationJob — TASK_BLOCKED respeita config.taskBlocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function setupTaskBlocked(taskBlocked: boolean) {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    await prisma.client.update({ where: { id: client.id }, data: { whatsapp: '5511999999999' } })
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, user.id)

    await prisma.notificationConfig.create({
      data: {
        organizationId: org.id,
        whatsappEnabled: true,
        emailEnabled: true,
        taskBlocked,
        maximizebotToken: 'Bearer fake-token',
      },
    })

    return { org, client, task }
  }

  it('envia TASK_BLOCKED quando config.taskBlocked está ligado', async () => {
    const { org, client, task } = await setupTaskBlocked(true)

    await processNotificationJob({
      data: { event: 'TASK_BLOCKED', organizationId: org.id, clientId: client.id, taskId: task.id, metadata: {} },
    })

    expect(maximizebot.sendWhatsApp).toHaveBeenCalledTimes(1)
    const logs = await prisma.notificationLog.findMany({ where: { taskId: task.id, event: 'TASK_BLOCKED' } })
    expect(logs.some((l) => l.channel === 'WHATSAPP' && l.status === 'SENT')).toBe(true)
  })

  it('não envia nada quando config.taskBlocked está desligado — nunca usa forceChannels pra contornar', async () => {
    const { org, client, task } = await setupTaskBlocked(false)

    await processNotificationJob({
      data: { event: 'TASK_BLOCKED', organizationId: org.id, clientId: client.id, taskId: task.id, metadata: {} },
    })

    expect(maximizebot.sendWhatsApp).not.toHaveBeenCalled()
    const logs = await prisma.notificationLog.findMany({ where: { taskId: task.id, event: 'TASK_BLOCKED' } })
    expect(logs).toHaveLength(0)
  })
})
```

- [ ] **Step 9: Teste de round-trip — `notifications.routes.test.ts` (novo arquivo)**

```ts
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { createTestPlan, createTestOrg, createTestUser, getAuthHeader } from '@/test/helpers'

describe('PATCH /notifications/config', () => {
  it('persiste taskBlocked: false e o GET subsequente confirma', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(user.email, 'Test@1234')

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/notifications/config',
      headers: { authorization: auth },
      payload: { taskBlocked: false },
    })
    expect(patchRes.statusCode).toBe(200)

    const getRes = await app.inject({
      method: 'GET',
      url: '/notifications/config',
      headers: { authorization: auth },
    })
    expect(getRes.statusCode).toBe(200)
    expect(JSON.parse(getRes.body).taskBlocked).toBe(false)
  })
})
```

- [ ] **Step 10: Rodar suíte inteira, commit**

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter api test
git add apps/api/src/modules/task-documents apps/api/src/modules/tasks apps/api/src/modules/notifications apps/api/src/workers apps/api/src/lib/default-templates.ts
git commit -m "feat(notifications): notifica cliente quando tarefa entra em impedimento (TASK_BLOCKED)"
```

---

## Task 3: Frontend — toggle "Tarefa com impedimento" em Configurações → Notificações

**Files:**
- Modify: `apps/web/src/pages/app/settings/Notifications.tsx`

**Interfaces:**
- Consumes: `PATCH /notifications/config` com `taskBlocked` (Task 2).

- [ ] **Step 1: `Config` interface ganha o campo**

```ts
interface Config {
  whatsappEnabled?: boolean
  emailEnabled?: boolean
  taskMoved?: boolean
  taskCompleted?: boolean
  commentAdded?: boolean
  dueDateAlert?: boolean
  taskBlocked?: boolean
  maximizebotToken?: string
  maximizebotTokenPreview?: string | null
}
```

- [ ] **Step 2: `EVENT_LABEL` ganha a entrada** (usada na tabela de histórico de envios)

```ts
const EVENT_LABEL: Record<string, string> = {
  TASK_CREATED: 'Tarefa criada',
  TASK_MOVED: 'Tarefa movida',
  TASK_COMPLETED: 'Tarefa concluída',
  TASK_COMMENT_ADDED: 'Comentário adicionado',
  TASK_DUE_DATE_APPROACHING: 'Prazo se aproximando',
  TASK_BLOCKED: 'Tarefa com impedimento',
  RECURRING_GENERATION_FAILED: 'Falha na geração de tarefa recorrente',
  DOCUMENT_REJECTED: 'Documento rejeitado',
}
```

- [ ] **Step 3: Novo `SwitchRow` na seção "Eventos"**

Inserir logo depois do `SwitchRow` de "Prazo se aproximando" (`dueDateAlert`), antes do `</Section>`
que fecha a seção "Eventos":

```tsx
            <SwitchRow
              label="Tarefa com impedimento"
              description="Notifica o cliente quando uma tarefa dele fica com impedimento"
              checked={form.taskBlocked ?? false}
              onChange={(v) => setForm({ ...form, taskBlocked: v })}
            />
          </Section>
```

- [ ] **Step 4: Typecheck, test, commit**

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web test
git add apps/web/src/pages/app/settings/Notifications.tsx
git commit -m "feat(notifications): toggle de impedimento na tela de Configurações"
```

---

## Task 4: Frontend — `TASK_BLOCKED` na tela de Templates de mensagem

**Files:**
- Modify: `apps/web/src/pages/app/settings/Templates.tsx`

**Interfaces:**
- Consumes: `GET/PUT /notifications/templates/:event/:channel` (já existentes, aceitam qualquer
  `NotificationEvent` válido via `eventParamSchema`/`previewSchema`'s `z.nativeEnum`).

- [ ] **Step 1: `EVENTS` e `EVENT_LABEL` ganham a entrada**

```ts
const EVENTS = ['TASK_CREATED', 'TASK_MOVED', 'TASK_COMPLETED', 'TASK_COMMENT_ADDED', 'TASK_DUE_DATE_APPROACHING', 'TASK_BLOCKED'] as const
const CHANNELS = ['WHATSAPP', 'EMAIL'] as const

const EVENT_LABEL: Record<string, string> = {
  TASK_CREATED: 'Tarefa criada',
  TASK_MOVED: 'Tarefa movida',
  TASK_COMPLETED: 'Tarefa concluída',
  TASK_COMMENT_ADDED: 'Comentário adicionado',
  TASK_DUE_DATE_APPROACHING: 'Prazo se aproximando',
  TASK_BLOCKED: 'Tarefa com impedimento',
}
```

(Não adicionar os outros cinco eventos sem editor hoje — `REQUEST_CREATED`/`REQUEST_APPROVED`/
`REQUEST_REJECTED`/`RECURRING_GENERATION_FAILED`/`DOCUMENT_REJECTED` — isso é o débito técnico
pré-existente registrado na Task 8, fora do escopo desta task.)

- [ ] **Step 2: Typecheck, test, commit**

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web test
git add apps/web/src/pages/app/settings/Templates.tsx
git commit -m "feat(notifications): permite customizar a mensagem de impedimento"
```

---

## Task 5: Frontend — selo de status no card do Kanban do portal

**Files:**
- Modify: `apps/web/src/pages/portal/Board.tsx`

**Interfaces:**
- Consumes: `STATUS_LABEL`/`STATUS_COLOR` (já exportados de
  `apps/web/src/components/shared/TaskDrawer.tsx`, usados por `Tasks.tsx`/`portal/Tasks.tsx`).

- [ ] **Step 1: Importar `STATUS_LABEL`/`STATUS_COLOR`**

```ts
import { STATUS_LABEL, STATUS_COLOR } from '@/components/shared/TaskDrawer'
```

- [ ] **Step 2: Adicionar o selo no card, antes do selo de prioridade**

O card da tarefa (dentro do `.map((task) => { ... return (<div ...>` que renderiza cada card) ganha
o selo condicional logo depois do `<p>` do título e antes do `<div className="flex items-center gap-2 mt-2 flex-wrap">`
existente (prioridade + vencimento) — ou, mais simples, como o primeiro item dentro desse mesmo
`<div>` flex, antes do selo de prioridade:

```tsx
                      <p className="text-sm font-medium text-foreground line-clamp-2">{task.title}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {task.status !== 'OPEN' && (
                          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', STATUS_COLOR[task.status])}>
                            {STATUS_LABEL[task.status]}
                          </span>
                        )}
                        <span className={cn(
                          'text-xs font-medium px-2 py-0.5 rounded-full',
                          ({
                            LOW: 'bg-gray-100 text-gray-600',
                            MEDIUM: 'bg-blue-100 text-blue-600',
                            HIGH: 'bg-orange-100 text-orange-600',
                            URGENT: 'bg-red-100 text-red-600',
                          } as Record<string, string>)[task.priority] ?? 'bg-gray-100 text-gray-600',
                        )}>
                          {PRIORITY_LABELS[task.priority] ?? task.priority}
                        </span>
```

(O resto do bloco — `{task.dueDate && (...)}` — fica igual, só o selo de status novo é inserido antes
do selo de prioridade já existente.)

- [ ] **Step 3: Typecheck, test, commit**

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web test
git add apps/web/src/pages/portal/Board.tsx
git commit -m "feat(portal): mostra selo de status (inclusive impedimento) no card do Kanban"
```

---

## Task 6: Frontend — `utcDateKey` + `buildCalendarGrid` (lógica pura, testável isoladamente)

**Files:**
- Modify: `apps/web/src/lib/dates.ts`
- Create: `apps/web/src/lib/dates.test.ts`
- Create: `apps/web/src/pages/app/tasksCalendar.ts`
- Create: `apps/web/src/pages/app/tasksCalendar.test.ts`

**Interfaces:**
- Produces: `utcDateKey(date: string | Date): string` (de `dates.ts`), `buildCalendarGrid(tasks,
  month): CalendarDay[]` e `getCalendarGridRange(month): { from: string; to: string }` (de
  `tasksCalendar.ts`) — consumidos pela Task 7.

- [ ] **Step 1: `dates.ts` — `utcDateKey`**

```ts
/** Chave 'YYYY-MM-DD' estável pro dia UTC de uma data "date-only" — usada pra agrupar tarefas por
 * dia (calendário) sem deslocar pelo fuso local do navegador. */
export function utcDateKey(date: string | Date): string {
  const d = new Date(date)
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
```

- [ ] **Step 2: `dates.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { utcDateKey } from './dates'

describe('utcDateKey', () => {
  it('retorna a data UTC independente do fuso local do processo', () => {
    // 2026-03-15T00:00:00Z é meia-noite UTC do dia 15 — deve ser '2026-03-15' mesmo que o
    // processo de teste esteja rodando num fuso atrás de UTC (ex.: America/Sao_Paulo, UTC-3,
    // onde new Date(...).getDate() local devolveria 14).
    expect(utcDateKey('2026-03-15T00:00:00.000Z')).toBe('2026-03-15')
  })

  it('preenche mês e dia com zero à esquerda', () => {
    expect(utcDateKey('2026-01-05T00:00:00.000Z')).toBe('2026-01-05')
  })

  it('aceita um objeto Date diretamente', () => {
    expect(utcDateKey(new Date('2026-12-31T00:00:00.000Z'))).toBe('2026-12-31')
  })
})
```

- [ ] **Step 3: Rodar, verificar que passa**

```bash
pnpm --filter web exec vitest run src/lib/dates.test.ts
```

- [ ] **Step 4: `tasksCalendar.ts`**

```ts
import { utcDateKey } from '@/lib/dates'
import type { Task } from '@/types'

export interface CalendarTaskLike {
  id: string
  targetDate: string | null
  dueDate: string | null
  status: Task['status']
}

export interface CalendarDay {
  dateKey: string
  dayOfMonth: number
  isCurrentMonth: boolean
  tasks: CalendarTaskLike[]
}

function gridLeadingDays(month: Date): { year: number; monthIndex: number; firstWeekday: number; daysInMonth: number } {
  const year = month.getUTCFullYear()
  const monthIndex = month.getUTCMonth()
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() // 0 = domingo
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return { year, monthIndex, firstWeekday, daysInMonth }
}

/** Intervalo [from, to] (chaves 'YYYY-MM-DD') que cobre a grade completa de semanas do mês,
 * incluindo os dias do mês anterior/seguinte que preenchem a primeira/última semana — é a janela
 * que `GET /tasks?dateFrom=...&dateTo=...` precisa buscar pra alimentar o calendário. */
export function getCalendarGridRange(month: Date): { from: string; to: string } {
  const { year, monthIndex, firstWeekday, daysInMonth } = gridLeadingDays(month)
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7
  const gridStart = new Date(Date.UTC(year, monthIndex, 1 - firstWeekday))
  const gridEnd = new Date(Date.UTC(year, monthIndex, 1 - firstWeekday + totalCells - 1))
  return { from: utcDateKey(gridStart), to: utcDateKey(gridEnd) }
}

/** Agrupa `tasks` por dia (via targetDate, com fallback pra dueDate) numa grade de semanas
 * completas cobrindo `month`. Tarefa sem nenhuma das duas datas, ou com status DISREGARDED, não
 * aparece em dia nenhum. */
export function buildCalendarGrid<T extends CalendarTaskLike>(tasks: T[], month: Date): CalendarDay[] {
  const { year, monthIndex, firstWeekday, daysInMonth } = gridLeadingDays(month)
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7

  const byDateKey = new Map<string, T[]>()
  for (const task of tasks) {
    if (task.status === 'DISREGARDED') continue
    const dateSource = task.targetDate ?? task.dueDate
    if (!dateSource) continue
    const key = utcDateKey(dateSource)
    const list = byDateKey.get(key) ?? []
    list.push(task)
    byDateKey.set(key, list)
  }

  const days: CalendarDay[] = []
  for (let i = 0; i < totalCells; i++) {
    const current = new Date(Date.UTC(year, monthIndex, 1 - firstWeekday + i))
    const key = utcDateKey(current)
    days.push({
      dateKey: key,
      dayOfMonth: current.getUTCDate(),
      isCurrentMonth: current.getUTCMonth() === monthIndex,
      tasks: byDateKey.get(key) ?? [],
    })
  }

  return days
}
```

- [ ] **Step 5: `tasksCalendar.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildCalendarGrid, getCalendarGridRange, type CalendarTaskLike } from './tasksCalendar'

function task(overrides: Partial<CalendarTaskLike>): CalendarTaskLike {
  return { id: 'x', targetDate: null, dueDate: null, status: 'OPEN', ...overrides }
}

describe('buildCalendarGrid', () => {
  it('posiciona a tarefa no dia de targetDate', () => {
    const t = task({ id: 't1', targetDate: '2026-03-15T00:00:00.000Z' })
    const grid = buildCalendarGrid([t], new Date('2026-03-01T00:00:00.000Z'))
    const day = grid.find((d) => d.dateKey === '2026-03-15')
    expect(day?.tasks.map((x) => x.id)).toEqual(['t1'])
  })

  it('usa dueDate como fallback quando targetDate é null', () => {
    const t = task({ id: 't2', dueDate: '2026-03-20T00:00:00.000Z' })
    const grid = buildCalendarGrid([t], new Date('2026-03-01T00:00:00.000Z'))
    const day = grid.find((d) => d.dateKey === '2026-03-20')
    expect(day?.tasks.map((x) => x.id)).toEqual(['t2'])
  })

  it('tarefa sem targetDate nem dueDate não aparece em nenhum dia', () => {
    const t = task({ id: 't3' })
    const grid = buildCalendarGrid([t], new Date('2026-03-01T00:00:00.000Z'))
    const allIds = grid.flatMap((d) => d.tasks.map((x) => x.id))
    expect(allIds).not.toContain('t3')
  })

  it('tarefa DISREGARDED é excluída mesmo com targetDate válido', () => {
    const t = task({ id: 't4', targetDate: '2026-03-15T00:00:00.000Z', status: 'DISREGARDED' })
    const grid = buildCalendarGrid([t], new Date('2026-03-01T00:00:00.000Z'))
    const day = grid.find((d) => d.dateKey === '2026-03-15')
    expect(day?.tasks).toHaveLength(0)
  })

  it('a grade cobre semanas completas, incluindo dias do mês vizinho', () => {
    // Março de 2026 começa numa quarta-feira (dia 1 = quarta) — a grade precisa incluir
    // domingo/segunda/terça de fevereiro antes do dia 1.
    const grid = buildCalendarGrid([], new Date('2026-03-01T00:00:00.000Z'))
    expect(grid.length % 7).toBe(0)
    expect(grid[0].isCurrentMonth).toBe(false)
    expect(grid.some((d) => d.dateKey === '2026-03-01' && d.isCurrentMonth)).toBe(true)
    expect(grid.some((d) => d.dateKey === '2026-03-31' && d.isCurrentMonth)).toBe(true)
  })

  it('fica correto independente do fuso-horário local do processo de teste (regressão UTC)', () => {
    // targetDate em meia-noite UTC do último dia do mês não deve "escorregar" pro mês seguinte
    // nem pro anterior ao agrupar.
    const t = task({ id: 't5', targetDate: '2026-02-28T00:00:00.000Z' })
    const grid = buildCalendarGrid([t], new Date('2026-02-01T00:00:00.000Z'))
    const day = grid.find((d) => d.dateKey === '2026-02-28')
    expect(day?.isCurrentMonth).toBe(true)
    expect(day?.tasks.map((x) => x.id)).toEqual(['t5'])
  })
})

describe('getCalendarGridRange', () => {
  it('retorna um intervalo que cobre a grade inteira, não só o mês estrito', () => {
    const { from, to } = getCalendarGridRange(new Date('2026-03-01T00:00:00.000Z'))
    expect(from <= '2026-03-01').toBe(true)
    expect(to >= '2026-03-31').toBe(true)
  })
})
```

- [ ] **Step 6: Rodar, verificar que passa**

```bash
pnpm --filter web exec vitest run src/pages/app/tasksCalendar.test.ts
```

- [ ] **Step 7: Typecheck completo, commit**

```bash
pnpm --filter web exec tsc --noEmit
git add apps/web/src/lib/dates.ts apps/web/src/lib/dates.test.ts apps/web/src/pages/app/tasksCalendar.ts apps/web/src/pages/app/tasksCalendar.test.ts
git commit -m "feat(tasks): lógica pura de grade de calendário (buildCalendarGrid, utcDateKey)"
```

---

## Task 7: Frontend — modo Calendário na tela Tarefas

**Files:**
- Modify: `apps/web/src/pages/app/Tasks.tsx`

**Interfaces:**
- Consumes: `buildCalendarGrid`, `getCalendarGridRange` (Task 6); `STATUS_LABEL`/`STATUS_COLOR`
  (já importados no arquivo).

- [ ] **Step 1: Import novo + `ViewMode` ganha `'calendar'`**

```ts
import { buildCalendarGrid, getCalendarGridRange } from './tasksCalendar'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'
```

(Ajustar o import de `lucide-react` existente — linha `import { List, LayoutGrid, Inbox } from
'lucide-react'` — pra incluir os três ícones novos na mesma linha, em vez de um import separado.)

```ts
type ViewMode = 'list' | 'kanban' | 'calendar'
```

- [ ] **Step 2: Estado do mês corrente + efeito que sincroniza `dateFrom`/`dateTo`**

Logo depois de `const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)`:

```ts
  const [calendarMonth, setCalendarMonth] = useState(() => new Date())
```

Logo depois da declaração de `const [dateTo, setDateTo] = useState('')` (mantendo as outras
declarações de filtro como estão), adicionar o efeito — importar `useEffect` de `'react'` no topo
(`import { useMemo, useState, useEffect } from 'react'`):

```ts
  // No modo Calendário, a navegação de mês É o filtro de data — substitui dateFrom/dateTo pela
  // janela da grade inteira (inclui dias do mês vizinho visíveis). Voltar pra Lista/Kanban depois
  // mantém esse intervalo (comportamento aceitável: os três modos compartilham o mesmo filtro).
  useEffect(() => {
    if (view !== 'calendar') return
    const { from, to } = getCalendarGridRange(calendarMonth)
    setDateFrom(from)
    setDateTo(to)
  }, [view, calendarMonth])
```

- [ ] **Step 3: Botão "Calendário" no seletor de modo**

Depois do botão "Kanban" (antes do `</div>` que fecha o seletor de 3 botões):

```tsx
          <button
            type="button"
            onClick={() => setView('calendar')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
              view === 'calendar' ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <CalendarIcon size={14} />
            Calendário
          </button>
```

- [ ] **Step 4: Esconder os inputs manuais de `dateFrom`/`dateTo` no modo Calendário**

Envolver os dois `<input type="date">` existentes (`dateFrom`/`dateTo`) com a condição:

```tsx
        {view !== 'calendar' && (
          <>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              title="Meta de"
              className="h-8 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              title="Meta até"
              className="h-8 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </>
        )}
```

- [ ] **Step 5: Branch do calendário no conteúdo principal**

Trocar a cadeia de ternários existente (`isLoading ? ... : tasks.length === 0 ? ... : view ===
'list' ? ... : (...)`) pra incluir o calendário antes do fallback do Kanban:

```tsx
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando tarefas...</p>
        ) : view === 'calendar' ? (
          <CalendarView
            tasks={tasks}
            month={calendarMonth}
            onPrevMonth={() => setCalendarMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() - 1, 1)))}
            onNextMonth={() => setCalendarMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)))}
            onToday={() => setCalendarMonth(new Date())}
            onTaskClick={(taskId) => setSelectedTaskId(taskId)}
          />
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma tarefa encontrada.</p>
        ) : view === 'list' ? (
```

(Reparar que o calendário precisa aparecer ANTES do check `tasks.length === 0` — uma grade de mês
vazia ainda é uma grade válida pra navegar, diferente de Lista/Kanban onde "nenhuma tarefa" é uma
tela própria. O resto da cadeia — `view === 'list'` e o fallback `kanban` — fica exatamente como
está, só precedido pelo novo branch.)

- [ ] **Step 6: Componente `CalendarView` (novo, no mesmo arquivo)**

Adicionar antes de `export default function Tasks()` (mesma seção onde `TaskRow`/
`DraggableTaskCard`/`DroppableStatusColumn` já estão definidos):

```tsx
const MONTH_LABEL = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MAX_VISIBLE_PER_DAY = 2

function CalendarView({
  tasks,
  month,
  onPrevMonth,
  onNextMonth,
  onToday,
  onTaskClick,
}: {
  tasks: TaskListItem[]
  month: Date
  onPrevMonth: () => void
  onNextMonth: () => void
  onToday: () => void
  onTaskClick: (taskId: string) => void
}) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const grid = useMemo(() => buildCalendarGrid(tasks, month), [tasks, month])
  const tasksByDateKey = useMemo(() => {
    const map = new Map<string, TaskListItem[]>()
    for (const day of grid) map.set(day.dateKey, day.tasks as TaskListItem[])
    return map
  }, [grid])

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-neutral-bg">
        <div className="flex items-center gap-1">
          <button type="button" onClick={onPrevMonth} className="p-1 rounded hover:bg-surface text-muted-foreground hover:text-foreground">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={onNextMonth} className="p-1 rounded hover:bg-surface text-muted-foreground hover:text-foreground">
            <ChevronRight size={16} />
          </button>
          <button type="button" onClick={onToday} className="ml-1 text-xs text-muted-foreground hover:text-foreground underline">
            Hoje
          </button>
        </div>
        <span className="text-sm font-semibold text-foreground capitalize">{MONTH_LABEL.format(month)}</span>
        <div className="w-16" />
      </div>

      <div className="grid grid-cols-7">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center py-1.5 border-b border-border">
            {w}
          </div>
        ))}
        {grid.map((day) => {
          const dayTasks = tasksByDateKey.get(day.dateKey) ?? []
          const visible = dayTasks.slice(0, MAX_VISIBLE_PER_DAY)
          const extra = dayTasks.length - visible.length
          return (
            <div
              key={day.dateKey}
              className={cn(
                'min-h-[90px] border-b border-r border-border p-1.5 relative',
                !day.isCurrentMonth && 'bg-neutral-bg/40',
              )}
            >
              <span className={cn('text-xs', day.isCurrentMonth ? 'text-foreground' : 'text-muted-foreground')}>
                {day.dayOfMonth}
              </span>
              <div className="flex flex-col gap-1 mt-1">
                {visible.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onTaskClick(task.id)}
                    className="text-left text-[11px] leading-tight px-1.5 py-1 rounded bg-neutral-bg hover:bg-border truncate"
                  >
                    <span className={cn('inline-block w-1.5 h-1.5 rounded-full mr-1', STATUS_COLOR[task.status])} />
                    {task.title}
                  </button>
                ))}
                {extra > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpandedDay(day.dateKey)}
                    className="text-left text-[11px] text-muted-foreground hover:text-foreground px-1.5"
                  >
                    +{extra} mais
                  </button>
                )}
              </div>

              {expandedDay === day.dateKey && (
                <div className="absolute z-10 top-full left-0 mt-1 w-56 bg-surface border border-border rounded-lg shadow-lg p-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-foreground">{day.dayOfMonth} — todas as tarefas</span>
                    <button type="button" onClick={() => setExpandedDay(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
                  </div>
                  <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                    {dayTasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => { onTaskClick(task.id); setExpandedDay(null) }}
                        className="text-left text-xs px-1.5 py-1 rounded hover:bg-neutral-bg truncate"
                      >
                        <span className={cn('inline-block w-1.5 h-1.5 rounded-full mr-1', STATUS_COLOR[task.status])} />
                        {task.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter web exec tsc --noEmit
```

Se `STATUS_COLOR[task.status]` reclamar de tipo porque `CalendarTaskLike`/`buildCalendarGrid` usa um
tipo genérico mais largo — confirmar que `tasksByDateKey` está anotado como `Map<string,
TaskListItem[]>` (não `CalendarTaskLike[]`) como no código acima, já que o cast via `day.tasks as
TaskListItem[]` resolve isso (os itens retornados por `buildCalendarGrid<TaskListItem>` são sempre os
mesmos objetos `TaskListItem` passados como entrada — o genérico de `buildCalendarGrid` preserva o
tipo exato do array de entrada).

- [ ] **Step 8: Teste manual visual**

```bash
pnpm --filter api dev    # outro terminal
pnpm --filter web dev
```

Abrir `/app/tasks`, clicar em "Calendário", confirmar: navegação Anterior/Hoje/Próximo funciona,
tarefas aparecem no dia certo (comparar com o que a Lista mostra pra "Meta"), dia com 3+ tarefas
mostra "+N mais" que abre o popover, clicar numa tarefa (direto ou no popover) abre o `TaskDrawer`
corretamente.

- [ ] **Step 9: Rodar suíte completa, commit**

```bash
pnpm --filter web exec vitest run
git add apps/web/src/pages/app/Tasks.tsx
git commit -m "feat(tasks): modo Calendário na tela Tarefas"
```

**Decisão sobre o E2E opcional que a spec deixou em aberto:** não adicionar um spec Playwright novo
pro modo Calendário nesta plan. A suíte E2E existente (8 specs) é deliberadamente pequena e focada em
fluxos críticos de autenticação/dados (login, board, portal) — o calendário é um modo de visualização
somente-leitura sobre dados já cobertos pelos testes de `GET /tasks`/`buildCalendarGrid`, e um bug
visual nele não quebra nenhum fluxo de negócio. Revisitar se o calendário ganhar interação
(drag-and-drop de data, por exemplo) numa fase futura.

---

## Task 8: Docs

**Files:**
- Modify: `docs/TASKS.md`
- Modify: `docs/tech-debt.md`

- [ ] **Step 1: `docs/TASKS.md`**

Marcar 2c como concluído sem trabalho novo (já satisfeito pela tela Tarefas existente), e 2d/2e como
concluídos, seguindo o formato das entradas vizinhas (`[x]` + resumo + data + ponteiro pra spec/plano):

```markdown
   - [x] 2c. Visão em lista cross-cliente com filtros (concluído sem trabalho novo, 2026-10-05) — já
     satisfeito pela tela "Tarefas" existente (filtro por `recurringTemplateId` cruza clientes
     diferentes desde o redesenho de Kanban, item 9).
   - [x] 2d. Calendário mensal (concluído em 2026-10-05) — terceiro modo na tela "Tarefas"
     (`view: 'calendar'`), mesmos filtros e mesma query `GET /tasks` de Lista/Kanban. Posiciona
     tarefa por `targetDate` (fallback `dueDate`), grade de semanas completas, até 2 tarefas
     visíveis por dia + popover "+N mais". Ver `docs/superpowers/specs/2026-10-05-calendario-impedimento-portal-design.md`.
   - [x] 2e. Sinalização de "impedimento" no portal do cliente (concluído em 2026-10-05) — selo de
     status no card do Kanban do portal (`portal/Board.tsx`), e notificação `TASK_BLOCKED` (toggle
     `taskBlocked` em Configurações, mensagem customizável em Templates) quando uma tarefa do
     cliente entra em impedimento — dispara de um ponto único (`notifyIfBlocked`) cobrindo os três
     caminhos que escrevem `Task.status`. Ver mesma spec/plano do item 2d.
```

Atualizar a linha "Próximo passo" no final do arquivo pra refletir que 2c/2d/2e estão concluídos e o
próximo é escolher entre os itens 3-7 do roadmap.

- [ ] **Step 2: `docs/tech-debt.md` — registrar o débito encontrado durante a spec**

```markdown
## Eventos de notificação sem controle completo na UI (encontrado em 2026-10-05, revisão da spec de impedimento)

**Contexto:** `recurringGenerationFailed` e `documentRejected` existem em `NotificationConfig` (com
default `true`) e o worker já os usa via `EVENT_FLAG_MAP`, mas nenhum dos dois tem toggle na tela de
Configurações nem entrada em `updateConfigSchema` — ficam travados ligados pra sempre, sem o
escritório poder desligar. `Templates.tsx`'s `EVENTS` também não cobre esses dois nem
`REQUEST_CREATED`/`REQUEST_APPROVED`/`REQUEST_REJECTED` — cinco eventos sem editor de mensagem
customizada, só o template padrão do sistema.

**Pendente:** nivelar todos os eventos de `NotificationEvent` ao mesmo padrão de controle (toggle em
`Notifications.tsx` + entrada em `updateConfigSchema` + editor em `Templates.tsx`) que
`taskMoved`/`taskCompleted`/`commentAdded`/`dueDateAlert`/`taskBlocked` já têm.
```

- [ ] **Step 3: commit**

```bash
git add docs/TASKS.md docs/tech-debt.md
git commit -m "docs: marca 2c/2d/2e concluídos, registra débito de controle incompleto de notificações"
```

---

## Final Verification (after Task 8)

```bash
pnpm --filter api exec tsc --noEmit && pnpm --filter api test
pnpm --filter web exec tsc --noEmit && pnpm --filter web test
```

Smoke test manual: desligar "Tarefa com impedimento" em Configurações, mover uma tarefa pra uma
coluna `BLOCKED` e confirmar que nenhuma notificação é enfileirada (checar `NotificationLog` ou os
logs do worker); religar o toggle, repetir, confirmar que agora enfileira; abrir o portal do cliente,
ver o selo "Com Impedimento" no card; abrir a tela Tarefas, trocar pra Calendário, navegar dois meses
pra frente e voltar pra Hoje, confirmar que as tarefas aparecem nos dias certos comparando com a
Lista.
