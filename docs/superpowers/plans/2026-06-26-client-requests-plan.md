# Solicitações do Cliente Final (Request) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o Cliente Final abra uma `Request` (solicitação) no portal, que o escritório aprova (gerando uma `Task`) ou rejeita, com notificações em cada etapa.

**Architecture:** Novo módulo `apps/api/src/modules/requests/` (schema/service/routes) seguindo a estrutura obrigatória do projeto. Reusa `boards.service.createBoard` e `tasks.service.createTask` na aprovação. Estende `NotificationJob`/`notification.worker.ts` para suportar destinatário `USER` (hoje só suporta `CLIENT`). Frontend: nova página em `apps/web/src/pages/portal/Requests.tsx` (cliente) e `apps/web/src/pages/app/Requests.tsx` (escritório).

**Tech Stack:** Fastify v5 + Prisma v6 + Zod + BullMQ (API), React 19 + TanStack Query + react-router-dom (Web).

## Global Constraints

- TypeScript `strict: true` — sem `any`, sem `as unknown`.
- Validação Zod em toda entrada (body/params/query).
- Erros via `AppError(statusCode, message)`.
- `checkSubscription` em toda rota de mutação (POST/PATCH/DELETE).
- Migrations via `pnpm --filter api migrate:dev -- --name <nome>` — NUNCA `prisma migrate dev` direto.
- `Task.sourceRequestId` e `NotificationLog.requestId` são campos soltos (`String?` sem `@relation`), igual ao padrão já usado em `NotificationLog.taskId` — evita ciclo de FK com `Request.taskId` (que é uma FK real).
- Rodar `pnpm --filter api test` ao final de cada task antes de comitar.

---

## Task 1: Schema Prisma — modelos Request/RequestAttachment + extensões

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/test/setup.ts:30-46` (afterEach cleanup)

**Interfaces:**
- Produces: model `Request` (`id, organizationId, clientId, title, description, status, taskId, rejectionReason, reviewedById, reviewedAt, createdAt, updatedAt`), enum `RequestStatus` (`PENDING|APPROVED|REJECTED|CANCELLED`), model `RequestAttachment` (`id, requestId, filename, mimeType, size, storageKey, uploadedBy, createdAt`). `Task.sourceRequestId String?`. `NotificationConfig.requestCreated/requestApproved/requestRejected Boolean @default(true)`. `NotificationLog.requestId String?`. `NotificationEvent` ganha `REQUEST_CREATED|REQUEST_APPROVED|REQUEST_REJECTED`.

- [ ] **Step 1: Adicionar os novos modelos e enum ao schema**

Em `apps/api/prisma/schema.prisma`, logo após o model `Board` (linha 148, antes de `model Column`), adicionar:

```prisma
model Request {
  id              String        @id @default(cuid())
  organizationId  String
  clientId        String
  title           String
  description     String?
  status          RequestStatus @default(PENDING)
  taskId          String?       @unique
  rejectionReason String?
  reviewedById    String?
  reviewedAt      DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  organization Organization        @relation(fields: [organizationId], references: [id])
  client       Client              @relation(fields: [clientId], references: [id])
  task         Task?               @relation(fields: [taskId], references: [id])
  reviewedBy   User?               @relation(fields: [reviewedById], references: [id])
  attachments  RequestAttachment[]

  @@index([organizationId, status])
  @@map("requests")
}

enum RequestStatus {
  PENDING
  APPROVED
  REJECTED
  CANCELLED
}

model RequestAttachment {
  id         String   @id @default(cuid())
  requestId  String
  filename   String
  mimeType   String
  size       Int
  storageKey String
  uploadedBy String
  createdAt  DateTime @default(now())

  request Request @relation(fields: [requestId], references: [id], onDelete: Cascade)

  @@map("request_attachments")
}
```

- [ ] **Step 2: Adicionar relações inversas em Organization, Client e User**

Em `model Organization` (linha 42-49), adicionar à lista de relations:

```prisma
  requests            Request[]
```

Em `model Client` (linha 121-124), adicionar:

```prisma
  requests     Request[]
```

Em `model User` (linha 88-93), adicionar:

```prisma
  reviewedRequests  Request[]    @relation("RequestReviewer")
```

E ajustar a relation `reviewedBy` no model `Request` do Step 1 para referenciar o nome da relação:

```prisma
  reviewedBy   User?               @relation("RequestReviewer", fields: [reviewedById], references: [id])
```

- [ ] **Step 3: Adicionar `sourceRequestId` solto em Task**

Em `model Task` (linha 166-193), adicionar o campo (sem `@relation` — ponteiro solto, mesmo padrão de `NotificationLog.taskId`):

```prisma
  sourceRequestId String?
```

- [ ] **Step 4: Estender NotificationConfig, NotificationLog e NotificationEvent**

Em `model NotificationConfig` (linha 274-298), adicionar após `dueDateAlert`:

```prisma
  requestCreated   Boolean  @default(true)
  requestApproved  Boolean  @default(true)
  requestRejected  Boolean  @default(true)
```

Em `model NotificationLog` (linha 330-347), adicionar após `taskId`:

```prisma
  requestId      String?
```

Em `enum NotificationEvent` (linha 317-323), adicionar:

```prisma
  REQUEST_CREATED
  REQUEST_APPROVED
  REQUEST_REJECTED
```

- [ ] **Step 5: Rodar a migration**

```bash
pnpm --filter api migrate:dev -- --name add_request_model
```

Expected: migration criada e aplicada sem erro, `apps/api/node_modules/.prisma/client` regenerado.

- [ ] **Step 6: Atualizar limpeza de tabelas nos testes**

Em `apps/api/src/test/setup.ts`, dentro do `afterEach` (linha 30-46), inserir `requestAttachment` e `request` ANTES de `taskHistory` (pois `Request.taskId` é FK real para `Task`, e `Request.clientId` é FK para `Client` — precisa ser apagado antes desses dois):

```typescript
afterEach(async () => {
  await prisma.$transaction([
    prisma.notificationLog.deleteMany(),
    prisma.requestAttachment.deleteMany(),
    prisma.request.deleteMany(),
    prisma.taskHistory.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.task.deleteMany(),
    prisma.column.deleteMany(),
    prisma.board.deleteMany(),
    prisma.client.deleteMany(),
    prisma.user.deleteMany(),
    prisma.notificationConfig.deleteMany(),
    prisma.messageTemplate.deleteMany(),
    prisma.subscriptionHistory.deleteMany(),
    prisma.organization.deleteMany(),
    prisma.plan.deleteMany(),
  ])
})
```

- [ ] **Step 7: Verificar que a suite atual ainda passa**

```bash
pnpm --filter api test
```

Expected: todos os testes existentes continuam passando (a migration só adiciona colunas/tabelas, não remove nada).

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/test/setup.ts
git commit -m "feat(api): adicionar modelo Request e extensões de schema para solicitações do cliente"
```

---

## Task 2: Worker de notificações — suportar destinatário USER

**Files:**
- Modify: `apps/api/src/lib/queue.ts`
- Modify: `apps/api/src/lib/template.ts`
- Modify: `apps/api/src/lib/default-templates.ts`
- Modify: `apps/api/src/workers/notification.worker.ts`
- Test: `apps/api/src/workers/notification-worker.test.ts`

**Interfaces:**
- Consumes: `NotificationConfig` (Prisma, com os 3 novos booleans do Task 1), `getTemplate(organizationId, event, channel)` de `template.ts`.
- Produces: `NotificationJob` estendido com `recipientType?: 'CLIENT' | 'USER'`, `userId?: string`, `requestId?: string` (campos opcionais — chamadas existentes em `tasks.service.ts`/`comments.service.ts` continuam compilando sem alteração). `processNotificationJob` passa a rotear por `recipientType`.

- [ ] **Step 1: Escrever o teste que falha — REQUEST_CREATED notifica ORG_ADMIN por email**

Em `apps/api/src/workers/notification-worker.test.ts`, adicionar ao final do arquivo (antes do fechamento do `describe('processNotificationJob'`):

```typescript
  it('REQUEST_CREATED envia email para destinatário USER e grava log sem clientId', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })

    await prisma.notificationConfig.create({
      data: {
        organizationId: org.id,
        requestCreated: true,
        emailEnabled: true,
        smtpHost: 'smtp.test.com',
        smtpPort: 587,
        smtpUser: 'test@test.com',
        smtpPass: 'encrypted-or-plain-for-test',
        emailFrom: 'Escritório <noreply@test.com>',
      },
    })

    const job: JobInput = {
      data: {
        event: 'REQUEST_CREATED',
        organizationId: org.id,
        recipientType: 'USER',
        userId: admin.id,
        metadata: { clientName: 'João Silva', requestTitle: 'Abertura de empresa' },
      },
    }

    await processNotificationJob(job)

    expect(mailer.sendEmail).toHaveBeenCalledTimes(1)
    const log = await prisma.notificationLog.findFirst()
    expect(log?.channel).toBe('EMAIL')
    expect(log?.recipient).toBe(admin.email)
    expect(log?.clientId).toBeNull()
  })

  it('REQUEST_CREATED não envia quando requestCreated está desabilitado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })

    await prisma.notificationConfig.create({
      data: { organizationId: org.id, requestCreated: false, emailEnabled: true },
    })

    const job: JobInput = {
      data: {
        event: 'REQUEST_CREATED',
        organizationId: org.id,
        recipientType: 'USER',
        userId: admin.id,
        metadata: { clientName: 'João Silva', requestTitle: 'Abertura de empresa' },
      },
    }

    await processNotificationJob(job)

    expect(mailer.sendEmail).not.toHaveBeenCalled()
  })
```

E ajustar o import no topo do arquivo (já existe `import * as mailer from '@/lib/mailer'` na linha 6 — confirmar, está lá).

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
pnpm --filter api test -- notification-worker.test.ts
```

Expected: FAIL — `processNotificationJob` ainda não entende `recipientType: 'USER'` (vai tentar achar `client` com `clientId: undefined` e abortar silenciosamente, então o teste de `sendEmail` chamado vai falhar).

- [ ] **Step 3: Estender `NotificationJob` em `queue.ts`**

Substituir o conteúdo de `apps/api/src/lib/queue.ts`:

```typescript
import { Queue } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'

export interface NotificationJob {
  event: string
  organizationId: string
  recipientType?: 'CLIENT' | 'USER'
  clientId?: string
  userId?: string
  taskId?: string
  requestId?: string
  metadata: Record<string, string | undefined>
}

export const notificationQueue = new Queue('notification-queue', { connection: bullmqRedis })

export async function enqueueNotification(job: NotificationJob): Promise<void> {
  await notificationQueue.add(job.event, job, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  })
}
```

- [ ] **Step 4: Estender `TemplateVars` em `template.ts`**

Em `apps/api/src/lib/template.ts`, alterar a interface (linhas 6-16) — `taskTitle` passa a ser opcional (vars de requests não usam task) e ganha `requestTitle`/`rejectionReason`:

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
}
```

E ajustar `PREVIEW_VARS` (linha 18-28) — sem mudança de valores, só garante que ainda compila (já tem `taskTitle` preenchido, segue válido com o campo opcional).

- [ ] **Step 5: Adicionar templates padrão para os 3 novos eventos**

Em `apps/api/src/lib/default-templates.ts`, adicionar ao objeto `DEFAULT_TEMPLATES` (depois da entrada `TASK_DUE_DATE_APPROACHING`, linha 24-27):

```typescript
  REQUEST_CREATED: {
    WHATSAPP: { body: 'Nova solicitação de {{clientName}}: *{{requestTitle}}*.' },
    EMAIL: { subject: 'Nova solicitação — {{requestTitle}}', body: 'Olá!\n\nO cliente {{clientName}} abriu uma nova solicitação: *{{requestTitle}}*.\n\nAcesse o painel para avaliar: {{portalUrl}}' },
  },
  REQUEST_APPROVED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Sua solicitação *{{requestTitle}}* foi aprovada e já está em andamento.\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Solicitação aprovada — {{requestTitle}}', body: 'Olá, {{clientName}}!\n\nSua solicitação *{{requestTitle}}* foi aprovada e já está em andamento.\n\nAcompanhe em: {{portalUrl}}' },
  },
  REQUEST_REJECTED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Sua solicitação *{{requestTitle}}* não foi aprovada.{{rejectionReason}}\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Solicitação não aprovada — {{requestTitle}}', body: 'Olá, {{clientName}}!\n\nSua solicitação *{{requestTitle}}* não foi aprovada.\n\nMotivo: {{rejectionReason}}\n\nAcompanhe em: {{portalUrl}}' },
  },
```

- [ ] **Step 6: Reescrever `notification.worker.ts` com roteamento por `recipientType`**

Substituir o conteúdo de `apps/api/src/workers/notification.worker.ts`:

```typescript
// apps/api/src/workers/notification.worker.ts
import { Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { renderTemplate, getTemplate, type TemplateVars } from '@/lib/template'
import { sendWhatsApp } from '@/lib/maximizebot'
import { sendEmail } from '@/lib/mailer'
import { decrypt } from '@/lib/encryption'
import type { NotificationConfig, NotificationEvent, MessageChannel } from '@prisma/client'
import type { NotificationJob } from '@/lib/queue'

const EVENT_FLAG_MAP: Record<string, keyof NotificationConfig> = {
  TASK_CREATED: 'taskCreated',
  TASK_MOVED: 'taskMoved',
  TASK_COMPLETED: 'taskCompleted',
  TASK_COMMENT_ADDED: 'commentAdded',
  TASK_DUE_DATE_APPROACHING: 'dueDateAlert',
  REQUEST_CREATED: 'requestCreated',
  REQUEST_APPROVED: 'requestApproved',
  REQUEST_REJECTED: 'requestRejected',
}

export async function processNotificationJob(job: { data: NotificationJob }): Promise<void> {
  const { event, organizationId, recipientType = 'CLIENT', clientId, userId, taskId, requestId, metadata } =
    job.data

  const config = await prisma.notificationConfig.findUnique({ where: { organizationId } })
  if (!config) return

  const isEnabled = (config[EVENT_FLAG_MAP[event]] as boolean | undefined) ?? false
  if (!isEnabled) return

  if (recipientType === 'USER') {
    if (!userId) return
    await processUserNotification(config, { event, organizationId, userId, requestId, metadata })
    return
  }

  if (!clientId) return
  await processClientNotification(config, { event, organizationId, clientId, taskId, requestId, metadata })
}

async function processClientNotification(
  config: NotificationConfig,
  params: {
    event: string
    organizationId: string
    clientId: string
    taskId?: string
    requestId?: string
    metadata: Record<string, string | undefined>
  },
): Promise<void> {
  const { event, organizationId, clientId, taskId, requestId, metadata } = params

  const [client, org, task] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId } }),
    prisma.organization.findUnique({ where: { id: organizationId } }),
    taskId
      ? prisma.task.findUnique({
          where: { id: taskId },
          include: { column: { include: { board: { select: { organizationId: true } } } } },
        })
      : Promise.resolve(null),
  ])
  if (!client || !org) return
  if (client.organizationId !== organizationId) return
  if (taskId && (!task || task.column.board.organizationId !== organizationId)) return

  const vars: TemplateVars = {
    clientName: client.name,
    orgName: org.name,
    taskTitle: task?.title,
    requestTitle: metadata.requestTitle,
    rejectionReason: metadata.rejectionReason,
    fromColumn: metadata.fromColumn,
    toColumn: metadata.toColumn,
    dueDate: metadata.dueDate,
    portalUrl: `${process.env.APP_URL ?? 'https://tramita.autohubs.com.br'}/portal`,
    commentText: metadata.commentText,
    commentAuthorName: metadata.commentAuthorName,
  }

  const channels: MessageChannel[] = []
  if (config.whatsappEnabled && client.whatsapp && config.maximizebotToken) channels.push('WHATSAPP')
  if (config.emailEnabled && config.smtpHost && config.smtpPass) channels.push('EMAIL')

  for (const channel of channels) {
    const template = await getTemplate(organizationId, event as NotificationEvent, channel)
    const rendered = renderTemplate(template.body, vars)

    let status: 'SENT' | 'FAILED' = 'SENT'
    let error: string | undefined

    try {
      if (channel === 'WHATSAPP') {
        await sendWhatsApp(config.maximizebotToken!, {
          number: client.whatsapp!,
          body: rendered,
          saveOnTicket: config.saveOnTicket,
          startChatbot: config.startChatbot,
          linkPreview: true,
        })
      } else {
        const pass = decrypt(config.smtpPass!)
        await sendEmail(
          { host: config.smtpHost!, port: config.smtpPort!, user: config.smtpUser!, pass, from: config.emailFrom! },
          client.email,
          renderTemplate(template.subject ?? '', vars),
          rendered,
        )
      }
    } catch (err) {
      status = 'FAILED'
      error = err instanceof Error ? err.message : String(err)
    }

    await prisma.notificationLog.create({
      data: {
        organizationId,
        clientId,
        event: event as NotificationEvent,
        channel,
        taskId,
        requestId,
        recipient: channel === 'WHATSAPP' ? client.whatsapp! : client.email,
        message: rendered,
        status,
        error,
        sentAt: status === 'SENT' ? new Date() : undefined,
      },
    })
  }
}

async function processUserNotification(
  config: NotificationConfig,
  params: {
    event: string
    organizationId: string
    userId: string
    requestId?: string
    metadata: Record<string, string | undefined>
  },
): Promise<void> {
  const { event, organizationId, userId, requestId, metadata } = params

  if (!config.emailEnabled || !config.smtpHost || !config.smtpPass) return

  const [user, org] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.organization.findUnique({ where: { id: organizationId } }),
  ])
  if (!user || !org || user.organizationId !== organizationId) return

  const vars: TemplateVars = {
    clientName: metadata.clientName ?? '',
    orgName: org.name,
    requestTitle: metadata.requestTitle,
    portalUrl: `${process.env.APP_URL ?? 'https://tramita.autohubs.com.br'}/app/requests`,
  }

  const template = await getTemplate(organizationId, event as NotificationEvent, 'EMAIL')
  const rendered = renderTemplate(template.body, vars)

  let status: 'SENT' | 'FAILED' = 'SENT'
  let error: string | undefined

  try {
    const pass = decrypt(config.smtpPass)
    await sendEmail(
      { host: config.smtpHost, port: config.smtpPort!, user: config.smtpUser!, pass, from: config.emailFrom! },
      user.email,
      renderTemplate(template.subject ?? '', vars),
      rendered,
    )
  } catch (err) {
    status = 'FAILED'
    error = err instanceof Error ? err.message : String(err)
  }

  await prisma.notificationLog.create({
    data: {
      organizationId,
      event: event as NotificationEvent,
      channel: 'EMAIL',
      requestId,
      recipient: user.email,
      message: rendered,
      status,
      error,
      sentAt: status === 'SENT' ? new Date() : undefined,
    },
  })
}

export function startNotificationWorker() {
  return new Worker('notification-queue', processNotificationJob, {
    connection: bullmqRedis,
    concurrency: 5,
  })
}
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

```bash
pnpm --filter api test -- notification-worker.test.ts
pnpm --filter api test -- template.test.ts
```

Expected: PASS em ambos (os testes antigos de `template.test.ts` continuam válidos pois `taskTitle` virou opcional sem quebrar quem já o preenche).

- [ ] **Step 8: Rodar a suite completa da API**

```bash
pnpm --filter api test
```

Expected: PASS — `tasks.service.ts`/`comments.service.ts` continuam chamando `enqueueNotification` com a forma antiga (sem `recipientType`), que cai no branch `CLIENT` por padrão.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/lib/queue.ts apps/api/src/lib/template.ts apps/api/src/lib/default-templates.ts apps/api/src/workers/notification.worker.ts apps/api/src/workers/notification-worker.test.ts
git commit -m "feat(api): estender worker de notificações para destinatário USER (requests)"
```

---

## Task 3: NotificationConfig — expor os 3 novos booleans na API

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.schema.ts`
- Modify: `apps/api/src/modules/notifications/notifications.service.ts`
- Test: `apps/api/src/modules/notifications/templates.routes.test.ts` (ou novo arquivo `config.routes.test.ts` se preferir isolar — usar o existente para não fragmentar)

**Interfaces:**
- Consumes: `UpdateConfigBody` (Zod, `notifications.schema.ts`).
- Produces: `getConfig`/`updateConfig` agora leem/gravam `requestCreated`, `requestApproved`, `requestRejected`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `apps/api/src/modules/notifications/templates.routes.test.ts` (verificar import de helpers no topo do arquivo antes de copiar — reusar os mesmos já importados):

```typescript
describe('PATCH /notifications/config — eventos de request', () => {
  it('atualiza e retorna os booleans de request', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')

    const patch = await app.inject({
      method: 'PATCH',
      url: '/notifications/config',
      headers: { authorization: auth },
      payload: { requestCreated: false, requestApproved: true, requestRejected: false },
    })
    expect(patch.statusCode).toBe(200)

    const get = await app.inject({
      method: 'GET',
      url: '/notifications/config',
      headers: { authorization: auth },
    })
    const body = JSON.parse(get.body)
    expect(body.requestCreated).toBe(false)
    expect(body.requestApproved).toBe(true)
    expect(body.requestRejected).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm --filter api test -- templates.routes.test.ts
```

Expected: FAIL — `getConfig` não inclui esses campos no `select`, então `body.requestCreated` vem `undefined`.

- [ ] **Step 3: Adicionar os campos ao `updateConfigSchema`**

Em `apps/api/src/modules/notifications/notifications.schema.ts`, dentro de `updateConfigSchema` (linha 5-21), adicionar após `dueDateAlert: z.boolean().optional(),`:

```typescript
  requestCreated: z.boolean().optional(),
  requestApproved: z.boolean().optional(),
  requestRejected: z.boolean().optional(),
```

- [ ] **Step 4: Adicionar os campos ao `select` de `getConfig`**

Em `apps/api/src/modules/notifications/notifications.service.ts`, dentro de `getConfig` (linha 14-37), no `select`, adicionar após `dueDateAlert: true,`:

```typescript
      requestCreated: true,
      requestApproved: true,
      requestRejected: true,
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
pnpm --filter api test -- templates.routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/notifications/notifications.schema.ts apps/api/src/modules/notifications/notifications.service.ts apps/api/src/modules/notifications/templates.routes.test.ts
git commit -m "feat(api): expor configuração de notificação para eventos de request"
```

---

## Task 4: Módulo `requests` — schema Zod + criação e leitura

**Files:**
- Create: `apps/api/src/modules/requests/requests.schema.ts`
- Create: `apps/api/src/modules/requests/requests.service.ts`
- Test: `apps/api/src/modules/requests/requests.service.test.ts`

**Interfaces:**
- Produces: `createRequestSchema`, `approveRequestSchema` (discriminated union), `rejectRequestSchema`, tipos `CreateRequestBody`/`ApproveRequestBody`/`RejectRequestBody`. Funções `createRequest(organizationId, clientId, data)`, `listRequestsForOrg(organizationId, status?)`, `listRequestsForClient(organizationId, clientId)`, `getRequestById(id, organizationId, clientId?)`, `cancelRequest(id, organizationId, clientId)`.

- [ ] **Step 1: Criar `requests.schema.ts`**

```typescript
// apps/api/src/modules/requests/requests.schema.ts
import { z } from 'zod'

export const createRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
})

export const approveRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('EXISTING_BOARD'),
    boardId: z.string().cuid(),
    columnId: z.string().cuid(),
  }),
  z.object({
    mode: z.literal('NEW_BOARD'),
  }),
])

export const rejectRequestSchema = z.object({
  reason: z.string().optional(),
})

export const listRequestsQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
})

export type CreateRequestBody = z.infer<typeof createRequestSchema>
export type ApproveRequestBody = z.infer<typeof approveRequestSchema>
export type RejectRequestBody = z.infer<typeof rejectRequestSchema>
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>
```

- [ ] **Step 2: Escrever o teste que falha — `createRequest` cria PENDING e notifica admins**

```typescript
// apps/api/src/modules/requests/requests.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
} from '@/test/helpers'
import * as queue from '@/lib/queue'
import { createRequest, listRequestsForOrg, listRequestsForClient, getRequestById, cancelRequest } from './requests.service'

vi.mock('@/lib/queue', async () => {
  const actual = await vi.importActual<typeof import('@/lib/queue')>('@/lib/queue')
  return { ...actual, enqueueNotification: vi.fn() }
})

describe('createRequest', () => {
  beforeEach(() => vi.clearAllMocks())

  it('cria a request como PENDING e enfileira REQUEST_CREATED para cada ORG_ADMIN/ORG_MANAGER', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    await createTestUser(org.id, { role: 'ORG_MEMBER' }) // não deve ser notificado
    const client = await createTestClient(org.id)

    const request = await createRequest(org.id, client.id, { title: 'Abertura de LTDA' })

    expect(request.status).toBe('PENDING')
    expect(request.clientId).toBe(client.id)

    expect(queue.enqueueNotification).toHaveBeenCalledTimes(2)
    const calledUserIds = vi.mocked(queue.enqueueNotification).mock.calls.map((c) => c[0].userId)
    expect(calledUserIds).toContain(admin.id)
    expect(calledUserIds).toContain(manager.id)
  })

  it('lança 404 se o cliente não pertence à org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const otherOrg = await createTestOrg(plan.id, { slug: 'other-org' })
    const client = await createTestClient(otherOrg.id)

    await expect(createRequest(org.id, client.id, { title: 'X' })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('listRequestsForOrg / listRequestsForClient / getRequestById', () => {
  it('lista requests da org e filtra por status', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    await createRequest(org.id, client.id, { title: 'Pedido 1' })
    const r2 = await createRequest(org.id, client.id, { title: 'Pedido 2' })
    await cancelRequest(r2.id, org.id, client.id)

    const all = await listRequestsForOrg(org.id)
    expect(all).toHaveLength(2)

    const onlyCancelled = await listRequestsForOrg(org.id, 'CANCELLED')
    expect(onlyCancelled).toHaveLength(1)
    expect(onlyCancelled[0].title).toBe('Pedido 2')
  })

  it('cliente só vê as próprias requests', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { email: 'a@test.com' })
    const clientB = await createTestClient(org.id, { email: 'b@test.com' })
    await createRequest(org.id, clientA.id, { title: 'Da A' })
    await createRequest(org.id, clientB.id, { title: 'Da B' })

    const result = await listRequestsForClient(org.id, clientA.id)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Da A')
  })

  it('getRequestById lança 404 quando clientId não é o dono', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { email: 'a2@test.com' })
    const clientB = await createTestClient(org.id, { email: 'b2@test.com' })
    const request = await createRequest(org.id, clientA.id, { title: 'Da A' })

    await expect(getRequestById(request.id, org.id, clientB.id)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('cancelRequest', () => {
  it('cancela uma request PENDING', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })

    const cancelled = await cancelRequest(request.id, org.id, client.id)
    expect(cancelled.status).toBe('CANCELLED')
  })

  it('lança 422 ao tentar cancelar uma request já cancelada', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    await cancelRequest(request.id, org.id, client.id)

    await expect(cancelRequest(request.id, org.id, client.id)).rejects.toMatchObject({ statusCode: 422 })
  })
})
```

- [ ] **Step 3: Rodar e confirmar falha**

```bash
pnpm --filter api test -- requests.service.test.ts
```

Expected: FAIL com erro de módulo não encontrado (`./requests.service` não existe ainda).

- [ ] **Step 4: Implementar `requests.service.ts` (parte 1 — create/list/get/cancel)**

```typescript
// apps/api/src/modules/requests/requests.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import type { CreateRequestBody, RejectRequestBody, ApproveRequestBody } from './requests.schema'
import type { RequestStatus } from '@prisma/client'

export async function createRequest(
  organizationId: string,
  clientId: string,
  data: CreateRequestBody,
) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId, isActive: true },
  })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  const request = await prisma.request.create({
    data: { organizationId, clientId, title: data.title, description: data.description },
  })

  const admins = await prisma.user.findMany({
    where: { organizationId, role: { in: ['ORG_ADMIN', 'ORG_MANAGER'] }, isActive: true },
  })

  await Promise.all(
    admins.map((admin) =>
      enqueueNotification({
        event: 'REQUEST_CREATED',
        organizationId,
        recipientType: 'USER',
        userId: admin.id,
        requestId: request.id,
        metadata: { clientName: client.name, requestTitle: request.title },
      }),
    ),
  )

  return request
}

export async function listRequestsForOrg(organizationId: string, status?: RequestStatus) {
  return prisma.request.findMany({
    where: { organizationId, ...(status ? { status } : {}) },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  })
}

export async function listRequestsForClient(organizationId: string, clientId: string) {
  return prisma.request.findMany({
    where: { organizationId, clientId },
    orderBy: { createdAt: 'desc' },
  })
}

async function getRequestOrThrow(id: string, organizationId: string, clientId?: string) {
  const request = await prisma.request.findFirst({
    where: { id, organizationId, ...(clientId ? { clientId } : {}) },
  })
  if (!request) throw new AppError(404, 'Solicitação não encontrada')
  return request
}

export async function getRequestById(id: string, organizationId: string, clientId?: string) {
  const request = await getRequestOrThrow(id, organizationId, clientId)
  const attachments = await prisma.requestAttachment.findMany({
    where: { requestId: id },
    orderBy: { createdAt: 'asc' },
  })
  return { ...request, attachments }
}

export async function cancelRequest(id: string, organizationId: string, clientId: string) {
  const request = await getRequestOrThrow(id, organizationId, clientId)
  if (request.status !== 'PENDING') {
    throw new AppError(422, 'Apenas solicitações pendentes podem ser canceladas')
  }
  return prisma.request.update({ where: { id }, data: { status: 'CANCELLED' } })
}
```

Os imports `RejectRequestBody`/`ApproveRequestBody` ficam sem uso por enquanto — serão consumidos na Task 5. Para não falhar o lint/build nesta task, remover esses dois do import por ora:

```typescript
import type { CreateRequestBody } from './requests.schema'
import type { RequestStatus } from '@prisma/client'
```

(A Task 5 vai reabrir este arquivo e adicionar os imports de volta junto com as funções que os usam.)

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
pnpm --filter api test -- requests.service.test.ts
```

Expected: PASS em todos os casos.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/requests/requests.schema.ts apps/api/src/modules/requests/requests.service.ts apps/api/src/modules/requests/requests.service.test.ts
git commit -m "feat(api): criar módulo requests com create/list/get/cancel"
```

---

## Task 5: `requests.service.ts` — aprovação e rejeição

**Files:**
- Modify: `apps/api/src/modules/requests/requests.service.ts`
- Modify: `apps/api/src/modules/requests/requests.service.test.ts`

**Interfaces:**
- Consumes: `createBoard(organizationId, userId, userRole, data)` de `@/modules/boards/boards.service` (retorna board com `columns` ordenadas por `position`, a primeira é "Pendente"). `createTask(columnId, organizationId, data, actor)` de `@/modules/tasks/tasks.service` (actor é `{ id, type: 'user' | 'client' }`).
- Produces: `approveRequest(id, organizationId, reviewerId, reviewerRole, data)`, `rejectRequest(id, organizationId, reviewerId, data)`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `apps/api/src/modules/requests/requests.service.test.ts`:

```typescript
import { approveRequest, rejectRequest } from './requests.service'
import { createBoard } from '@/modules/boards/boards.service'

describe('approveRequest', () => {
  it('mode NEW_BOARD cria board com 3 colunas padrão e task na primeira coluna', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Abertura de LTDA', description: 'Detalhes' })

    const approved = await approveRequest(request.id, org.id, admin.id, 'ORG_ADMIN', { mode: 'NEW_BOARD' })

    expect(approved.status).toBe('APPROVED')
    expect(approved.taskId).not.toBeNull()
    expect(approved.reviewedById).toBe(admin.id)

    const task = await prisma.task.findUnique({ where: { id: approved.taskId! } })
    expect(task?.title).toBe('Abertura de LTDA')
    expect(task?.sourceRequestId).toBe(request.id)

    const board = await prisma.board.findFirst({ where: { clientId: client.id } })
    expect(board?.title).toBe('Abertura de LTDA')
  })

  it('mode EXISTING_BOARD cria task na coluna informada de um board já existente do cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const existingBoard = await createBoard(org.id, admin.id, 'ORG_ADMIN', { title: 'Processo já aberto', clientId: client.id })
    const request = await createRequest(org.id, client.id, { title: 'Documento extra' })

    const approved = await approveRequest(request.id, org.id, admin.id, 'ORG_ADMIN', {
      mode: 'EXISTING_BOARD',
      boardId: existingBoard.id,
      columnId: existingBoard.columns[0].id,
    })

    const task = await prisma.task.findUnique({ where: { id: approved.taskId! } })
    expect(task?.columnId).toBe(existingBoard.columns[0].id)
  })

  it('lança 404 se o board existente não pertence ao cliente da request', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const clientA = await createTestClient(org.id, { email: 'a3@test.com' })
    const clientB = await createTestClient(org.id, { email: 'b3@test.com' })
    const boardOfB = await createBoard(org.id, admin.id, 'ORG_ADMIN', { title: 'Board de B', clientId: clientB.id })
    const request = await createRequest(org.id, clientA.id, { title: 'Pedido de A' })

    await expect(
      approveRequest(request.id, org.id, admin.id, 'ORG_ADMIN', {
        mode: 'EXISTING_BOARD',
        boardId: boardOfB.id,
        columnId: boardOfB.columns[0].id,
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('lança 422 ao aprovar uma request que já foi avaliada', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    await approveRequest(request.id, org.id, admin.id, 'ORG_ADMIN', { mode: 'NEW_BOARD' })

    await expect(
      approveRequest(request.id, org.id, admin.id, 'ORG_ADMIN', { mode: 'NEW_BOARD' }),
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('rejectRequest', () => {
  it('rejeita com motivo e grava reviewedBy/reviewedAt', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })

    const rejected = await rejectRequest(request.id, org.id, admin.id, { reason: 'Fora de escopo' })

    expect(rejected.status).toBe('REJECTED')
    expect(rejected.rejectionReason).toBe('Fora de escopo')
    expect(rejected.reviewedById).toBe(admin.id)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm --filter api test -- requests.service.test.ts
```

Expected: FAIL — `approveRequest`/`rejectRequest` não existem ainda.

- [ ] **Step 3: Implementar — adicionar ao final de `requests.service.ts`**

Primeiro, restaurar os imports completos no topo do arquivo (substituir a linha de import de `./requests.schema` e adicionar os dois novos imports de módulos):

```typescript
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import { createBoard } from '@/modules/boards/boards.service'
import { createTask } from '@/modules/tasks/tasks.service'
import type { CreateRequestBody, ApproveRequestBody, RejectRequestBody } from './requests.schema'
import type { RequestStatus } from '@prisma/client'
```

Depois, adicionar ao final do arquivo:

```typescript
export async function approveRequest(
  id: string,
  organizationId: string,
  reviewerId: string,
  reviewerRole: string,
  data: ApproveRequestBody,
) {
  const request = await getRequestOrThrow(id, organizationId)
  if (request.status !== 'PENDING') throw new AppError(422, 'Solicitação já foi avaliada')

  let columnId: string

  if (data.mode === 'NEW_BOARD') {
    const board = await createBoard(organizationId, reviewerId, reviewerRole, {
      title: request.title,
      clientId: request.clientId,
    })
    columnId = board.columns[0].id
  } else {
    const board = await prisma.board.findFirst({
      where: { id: data.boardId, organizationId, clientId: request.clientId, isActive: true },
    })
    if (!board) throw new AppError(404, 'Processo não encontrado para este cliente')
    const column = await prisma.column.findFirst({ where: { id: data.columnId, boardId: board.id } })
    if (!column) throw new AppError(404, 'Coluna não encontrada neste processo')
    columnId = column.id
  }

  const task = await createTask(
    columnId,
    organizationId,
    { title: request.title, description: request.description ?? undefined, priority: 'MEDIUM', tags: [] },
    { id: reviewerId, type: 'user' },
  )

  await prisma.task.update({ where: { id: task.id }, data: { sourceRequestId: id } })

  const updatedRequest = await prisma.request.update({
    where: { id },
    data: { status: 'APPROVED', taskId: task.id, reviewedById: reviewerId, reviewedAt: new Date() },
  })

  await enqueueNotification({
    event: 'REQUEST_APPROVED',
    organizationId,
    clientId: request.clientId,
    taskId: task.id,
    requestId: id,
    metadata: { requestTitle: request.title },
  })

  return updatedRequest
}

export async function rejectRequest(
  id: string,
  organizationId: string,
  reviewerId: string,
  data: RejectRequestBody,
) {
  const request = await getRequestOrThrow(id, organizationId)
  if (request.status !== 'PENDING') throw new AppError(422, 'Solicitação já foi avaliada')

  const updated = await prisma.request.update({
    where: { id },
    data: {
      status: 'REJECTED',
      rejectionReason: data.reason,
      reviewedById: reviewerId,
      reviewedAt: new Date(),
    },
  })

  await enqueueNotification({
    event: 'REQUEST_REJECTED',
    organizationId,
    clientId: request.clientId,
    requestId: id,
    metadata: { requestTitle: request.title, rejectionReason: data.reason },
  })

  return updated
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter api test -- requests.service.test.ts
```

Expected: PASS em todos os casos.

- [ ] **Step 5: Rodar a suite completa**

```bash
pnpm --filter api test
```

Expected: PASS — nenhuma regressão em `boards`/`tasks`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/requests/requests.service.ts apps/api/src/modules/requests/requests.service.test.ts
git commit -m "feat(api): aprovação e rejeição de requests (gera Task em board novo ou existente)"
```

---

## Task 6: Rotas do escritório — `GET/POST /requests`

**Files:**
- Create: `apps/api/src/modules/requests/requests.routes.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/modules/requests/requests.routes.test.ts`

**Interfaces:**
- Consumes: `listRequestsForOrg`, `getRequestById`, `approveRequest`, `rejectRequest` (Task 4/5). `requireRole`, `checkSubscription`, `verifyJWT` (middlewares existentes).
- Produces: `requestsRoutes(app)` registrado com prefixo `/requests`.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// apps/api/src/modules/requests/requests.routes.test.ts
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  getAuthHeader,
} from '@/test/helpers'

describe('GET /requests', () => {
  it('ORG_MEMBER pode listar (somente leitura)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const auth = await getAuthHeader(member.email, 'Test@1234')

    await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: await getAuthHeader(client.email, 'Client@1234') },
      payload: { title: 'Pedido via portal' },
    })

    const res = await app.inject({ method: 'GET', url: '/requests', headers: { authorization: auth } })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toHaveLength(1)
  })
})

describe('POST /requests/:id/approve', () => {
  it('ORG_MEMBER não pode aprovar (403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const authClient = await getAuthHeader(client.email, 'Client@1234')
    const created = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: authClient },
      payload: { title: 'Pedido' },
    })
    const request = JSON.parse(created.body)

    const auth = await getAuthHeader(member.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: `/requests/${request.id}/approve`,
      headers: { authorization: auth },
      payload: { mode: 'NEW_BOARD' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('ORG_ADMIN aprova com NEW_BOARD e a request passa a ter taskId', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const authClient = await getAuthHeader(client.email, 'Client@1234')
    const created = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: authClient },
      payload: { title: 'Pedido' },
    })
    const request = JSON.parse(created.body)

    const auth = await getAuthHeader(admin.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: `/requests/${request.id}/approve`,
      headers: { authorization: auth },
      payload: { mode: 'NEW_BOARD' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('APPROVED')
    expect(body.taskId).not.toBeNull()
  })
})

describe('POST /requests/:id/reject', () => {
  it('ORG_MANAGER rejeita com motivo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const client = await createTestClient(org.id)
    const authClient = await getAuthHeader(client.email, 'Client@1234')
    const created = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: authClient },
      payload: { title: 'Pedido' },
    })
    const request = JSON.parse(created.body)

    const auth = await getAuthHeader(manager.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: `/requests/${request.id}/reject`,
      headers: { authorization: auth },
      payload: { reason: 'Fora de escopo' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('REJECTED')
  })
})
```

Esse teste já depende de `POST /portal/requests`, que só existe na Task 7. **Rodar esta task em conjunto com a Task 7** (implemente as rotas de portal primeiro, ou aceite que este teste fica vermelho até a Task 7 ser concluída — não faça merge/commit final da Task 6 sem a Task 7).

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm --filter api test -- requests.routes.test.ts
```

Expected: FAIL — rota `/requests` e `/portal/requests` não existem.

- [ ] **Step 3: Implementar `requests.routes.ts`**

```typescript
// apps/api/src/modules/requests/requests.routes.ts
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { approveRequestSchema, rejectRequestSchema, listRequestsQuerySchema } from './requests.schema'
import { listRequestsForOrg, getRequestById, approveRequest, rejectRequest } from './requests.service'

export async function requestsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const result = listRequestsQuerySchema.safeParse(request.query)
    const query = result.success ? result.data : {}
    return reply.send(await listRequestsForOrg(request.user.organizationId!, query.status))
  })

  app.get('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getRequestById(id, request.user.organizationId!))
  })

  app.post('/:id/approve', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = approveRequestSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(
      await approveRequest(id, request.user.organizationId!, request.user.sub, request.user.role, result.data),
    )
  })

  app.post('/:id/reject', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = rejectRequestSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await rejectRequest(id, request.user.organizationId!, request.user.sub, result.data))
  })
}
```

- [ ] **Step 4: Registrar em `server.ts`**

Em `apps/api/src/server.ts`, adicionar o import junto aos demais módulos (após a linha do `attachmentsRoutes`):

```typescript
import { requestsRoutes } from '@/modules/requests/requests.routes'
```

E o registro (após `app.register(attachmentsRoutes)`):

```typescript
  app.register(requestsRoutes, { prefix: '/requests' })
```

- [ ] **Step 5: Seguir para a Task 7 antes de rodar os testes** (este módulo depende das rotas de portal). Ao final da Task 7, voltar aqui e rodar:

```bash
pnpm --filter api test -- requests.routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/requests/requests.routes.ts apps/api/src/modules/requests/requests.routes.test.ts apps/api/src/server.ts
git commit -m "feat(api): rotas do escritório para aprovar/rejeitar requests"
```

---

## Task 7: Rotas do portal — criar, listar, cancelar e anexar arquivos

**Files:**
- Modify: `apps/api/src/modules/portal/portal.routes.ts`
- Test: `apps/api/src/modules/portal/portal.routes.test.ts`

**Interfaces:**
- Consumes: `createRequest`, `listRequestsForClient`, `getRequestById`, `cancelRequest` (Task 4) de `@/modules/requests/requests.service`. `createRequestSchema` de `@/modules/requests/requests.schema`.
- Produces: `POST /portal/requests`, `GET /portal/requests`, `GET /portal/requests/:id`, `PATCH /portal/requests/:id/cancel`, `POST /portal/requests/:id/attachments`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `apps/api/src/modules/portal/portal.routes.test.ts` (confirmar que os imports de helpers no topo do arquivo já cobrem `createTestPlan, createTestOrg, createTestClient, getAuthHeader` — se faltar algum, adicionar ao import existente):

```typescript
describe('POST /portal/requests', () => {
  it('cliente cria uma request PENDING', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const auth = await getAuthHeader(client.email, 'Client@1234')

    const res = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: auth },
      payload: { title: 'Abertura de empresa', description: 'Quero abrir uma LTDA' },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('PENDING')
    expect(body.title).toBe('Abertura de empresa')
  })
})

describe('GET /portal/requests', () => {
  it('cliente só vê as próprias requests, não as de outro cliente da mesma org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { email: 'porta-a@test.com' })
    const clientB = await createTestClient(org.id, { email: 'porta-b@test.com' })
    const authA = await getAuthHeader(clientA.email, 'Client@1234')
    const authB = await getAuthHeader(clientB.email, 'Client@1234')

    await app.inject({ method: 'POST', url: '/portal/requests', headers: { authorization: authA }, payload: { title: 'Da A' } })
    await app.inject({ method: 'POST', url: '/portal/requests', headers: { authorization: authB }, payload: { title: 'Da B' } })

    const res = await app.inject({ method: 'GET', url: '/portal/requests', headers: { authorization: authA } })
    const list = JSON.parse(res.body)
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('Da A')
  })
})

describe('PATCH /portal/requests/:id/cancel', () => {
  it('cliente cancela a própria request PENDING', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const auth = await getAuthHeader(client.email, 'Client@1234')

    const created = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: auth },
      payload: { title: 'Pedido a cancelar' },
    })
    const request = JSON.parse(created.body)

    const res = await app.inject({
      method: 'PATCH',
      url: `/portal/requests/${request.id}/cancel`,
      headers: { authorization: auth },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('CANCELLED')
  })

  it('cliente não pode cancelar request de outro cliente (404)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { email: 'cancel-a@test.com' })
    const clientB = await createTestClient(org.id, { email: 'cancel-b@test.com' })
    const authA = await getAuthHeader(clientA.email, 'Client@1234')
    const authB = await getAuthHeader(clientB.email, 'Client@1234')

    const created = await app.inject({
      method: 'POST',
      url: '/portal/requests',
      headers: { authorization: authA },
      payload: { title: 'Da A' },
    })
    const request = JSON.parse(created.body)

    const res = await app.inject({
      method: 'PATCH',
      url: `/portal/requests/${request.id}/cancel`,
      headers: { authorization: authB },
    })
    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm --filter api test -- portal.routes.test.ts
```

Expected: FAIL — rotas `/portal/requests*` ainda não existem.

- [ ] **Step 3: Implementar — estender `portal.routes.ts`**

Substituir o conteúdo de `apps/api/src/modules/portal/portal.routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { updateProfileSchema } from './portal.schema'
import { getClientProfile, updateClientProfile, getTaskHistory } from './portal.service'
import { createRequestSchema } from '@/modules/requests/requests.schema'
import {
  createRequest,
  listRequestsForClient,
  getRequestById,
  cancelRequest,
} from '@/modules/requests/requests.service'
import { createRequestAttachment } from '@/modules/requests/request-attachments.service'

const MAX_FILE_SIZE = 20 * 1024 * 1024

export async function portalRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })

  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('CLIENT'))

  app.get('/profile', async (request, reply) => {
    return reply.send(await getClientProfile(request.user.sub))
  })

  app.patch('/profile', async (request, reply) => {
    const result = updateProfileSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateClientProfile(request.user.sub, result.data))
  })

  app.get('/tasks/:taskId/history', async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    return reply.send(await getTaskHistory(taskId, request.user.organizationId!))
  })

  app.post('/requests', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = createRequestSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(
      await createRequest(request.user.organizationId!, request.user.sub, result.data),
    )
  })

  app.get('/requests', async (request, reply) => {
    return reply.send(await listRequestsForClient(request.user.organizationId!, request.user.sub))
  })

  app.get('/requests/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getRequestById(id, request.user.organizationId!, request.user.sub))
  })

  app.patch('/requests/:id/cancel', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await cancelRequest(id, request.user.organizationId!, request.user.sub))
  })

  app.post('/requests/:id/attachments', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id: requestId } = request.params as { id: string }

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

    const attachment = await createRequestAttachment(
      requestId,
      request.user.organizationId!,
      request.user.sub,
      { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer },
    )

    return reply.status(201).send(attachment)
  })
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter api test -- portal.routes.test.ts
```

Expected: PASS. (O endpoint de attachments depende da Task 8 — se rodar antes dela, o import de `request-attachments.service` vai falhar; ver nota abaixo.)

**Nota de ordem:** este Step 3 já importa `createRequestAttachment` de um arquivo que só é criado na Task 8. Se for implementar as tasks em sequência estrita, mover a linha `app.post('/requests/:id/attachments', ...)` e seu import para o final da Task 8 (junto com a criação do serviço), e deixar a Task 7 só com create/list/get/cancel. Se preferir implementar tudo de uma vez, seguir direto para a Task 8 antes de rodar os testes desta task.

- [ ] **Step 5: Voltar à Task 6 e rodar `requests.routes.test.ts`**

```bash
pnpm --filter api test -- requests.routes.test.ts
```

Expected: PASS (esse teste dependia de `POST /portal/requests`, que agora existe).

- [ ] **Step 6: Rodar a suite completa**

```bash
pnpm --filter api test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/portal/portal.routes.ts apps/api/src/modules/portal/portal.routes.test.ts
git commit -m "feat(api): rotas do portal para criar/listar/cancelar requests"
```

---

## Task 8: Anexos da Request (`RequestAttachment`)

**Files:**
- Create: `apps/api/src/modules/requests/request-attachments.service.ts`
- Test: `apps/api/src/modules/requests/request-attachments.service.test.ts`

**Interfaces:**
- Consumes: `uploadFile(key, buffer, mimeType)`, `getSignedDownloadUrl(key)`, `deleteFile(key)` de `@/lib/b2` (já existem, usados por `attachments.service.ts`).
- Produces: `createRequestAttachment(requestId, organizationId, clientId, payload)` — usado por `portal.routes.ts` (Task 7).

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// apps/api/src/modules/requests/request-attachments.service.test.ts
import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { createTestPlan, createTestOrg, createTestClient } from '@/test/helpers'
import { createRequest } from './requests.service'
import { createRequestAttachment } from './request-attachments.service'
import * as b2 from '@/lib/b2'

vi.mock('@/lib/b2', () => ({
  uploadFile: vi.fn().mockResolvedValue(undefined),
  getSignedDownloadUrl: vi.fn().mockResolvedValue('https://signed.example/file'),
  deleteFile: vi.fn().mockResolvedValue(undefined),
}))

describe('createRequestAttachment', () => {
  it('faz upload e cria o registro vinculado à request do próprio cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido com anexo' })

    const attachment = await createRequestAttachment(request.id, org.id, client.id, {
      filename: 'documento.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      buffer: Buffer.from('conteudo'),
    })

    expect(attachment.filename).toBe('documento.pdf')
    expect(attachment.uploadedBy).toBe(client.id)
    expect(b2.uploadFile).toHaveBeenCalledTimes(1)

    const found = await prisma.requestAttachment.findFirst({ where: { requestId: request.id } })
    expect(found?.id).toBe(attachment.id)
  })

  it('lança 404 se a request não pertence ao cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const clientA = await createTestClient(org.id, { email: 'anexo-a@test.com' })
    const clientB = await createTestClient(org.id, { email: 'anexo-b@test.com' })
    const request = await createRequest(org.id, clientA.id, { title: 'Da A' })

    await expect(
      createRequestAttachment(request.id, org.id, clientB.id, {
        filename: 'x.pdf',
        mimeType: 'application/pdf',
        size: 10,
        buffer: Buffer.from('x'),
      }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm --filter api test -- request-attachments.service.test.ts
```

Expected: FAIL — módulo `./request-attachments.service` não existe.

- [ ] **Step 3: Implementar**

```typescript
// apps/api/src/modules/requests/request-attachments.service.ts
import { prisma } from '@/lib/prisma'
import { uploadFile } from '@/lib/b2'
import { AppError } from '@/errors/AppError'

interface UploadPayload {
  filename: string
  mimeType: string
  size: number
  buffer: Buffer
}

async function getOrgSlug(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { slug: true },
  })
  return org?.slug ?? organizationId
}

export async function createRequestAttachment(
  requestId: string,
  organizationId: string,
  clientId: string,
  payload: UploadPayload,
) {
  const request = await prisma.request.findFirst({
    where: { id: requestId, organizationId, clientId },
  })
  if (!request) throw new AppError(404, 'Solicitação não encontrada')

  const orgSlug = await getOrgSlug(organizationId)
  const storageKey = `request-attachments/${orgSlug}/${requestId}/${Date.now()}-${payload.filename}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  return prisma.requestAttachment.create({
    data: {
      requestId,
      filename: payload.filename,
      mimeType: payload.mimeType,
      size: payload.size,
      storageKey,
      uploadedBy: clientId,
    },
  })
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter api test -- request-attachments.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Voltar à Task 7 e rodar a suite completa da API**

```bash
pnpm --filter api test
```

Expected: PASS — agora `portal.routes.ts` resolve o import de `createRequestAttachment` corretamente.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/requests/request-attachments.service.ts apps/api/src/modules/requests/request-attachments.service.test.ts
git commit -m "feat(api): upload de anexos na solicitação do cliente (B2)"
```

---

## Task 9: Frontend — tipos e página do portal (`/portal/requests`)

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Create: `apps/web/src/pages/portal/Requests.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/pages/portal/Layout.tsx`

**Interfaces:**
- Consumes: `api` (axios client) de `@/lib/api`. Endpoints `GET/POST /portal/requests`, `GET /portal/requests/:id`, `PATCH /portal/requests/:id/cancel`, `POST /portal/requests/:id/attachments`.
- Produces: tipo `Request` em `@/types`, componente `PortalRequests` default export, rota `/portal/requests`.

- [ ] **Step 1: Adicionar o tipo `Request` em `types/index.ts`**

Ao final de `apps/web/src/types/index.ts`, adicionar:

```typescript
export interface RequestAttachment {
  id: string
  filename: string
  mimeType: string
  size: number
  createdAt: string
}

export interface ClientRequest {
  id: string
  title: string
  description: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  rejectionReason: string | null
  taskId: string | null
  createdAt: string
  attachments?: RequestAttachment[]
  client?: { id: string; name: string }
}
```

(Nomeado `ClientRequest` em vez de `Request` para não colidir com o tipo global `Request` do DOM/fetch API do TypeScript.)

- [ ] **Step 2: Criar a página `apps/web/src/pages/portal/Requests.tsx`**

```typescript
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Plus, Inbox } from 'lucide-react'
import type { ClientRequest } from '@/types'
import { toast } from 'sonner'

const STATUS_LABEL: Record<ClientRequest['status'], string> = {
  PENDING: 'Em análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Não aprovada',
  CANCELLED: 'Cancelada',
}

const STATUS_STYLE: Record<ClientRequest['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
}

export default function PortalRequests() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', description: '' })

  const { data: requests = [], isLoading } = useQuery<ClientRequest[]>({
    queryKey: ['portal-requests'],
    queryFn: () => api.get('/portal/requests').then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => api.post('/portal/requests', form).then((r) => r.data),
    onSuccess: () => {
      toast.success('Solicitação enviada')
      qc.invalidateQueries({ queryKey: ['portal-requests'] })
      setOpen(false)
      setForm({ title: '', description: '' })
    },
    onError: () => toast.error('Erro ao enviar solicitação'),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/portal/requests/${id}/cancel`),
    onSuccess: () => {
      toast.success('Solicitação cancelada')
      qc.invalidateQueries({ queryKey: ['portal-requests'] })
    },
    onError: () => toast.error('Erro ao cancelar'),
  })

  if (isLoading) return <div className="p-6 text-gray-500 text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-gray-900">Minhas Solicitações</h1>
        <Button onClick={() => setOpen(true)} className="bg-[#185FA5] hover:bg-[#0C447C] text-white gap-2">
          <Plus size={16} />
          Nova solicitação
        </Button>
      </div>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-gray-400">
          <Inbox size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhuma solicitação ainda</p>
          <p className="text-xs mt-1">Use o botão acima para pedir algo ao seu escritório.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <div key={r.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{r.title}</p>
                  {r.description && <p className="text-xs text-gray-500 mt-0.5">{r.description}</p>}
                  {r.status === 'REJECTED' && r.rejectionReason && (
                    <p className="text-xs text-red-500 mt-1 italic">Motivo: {r.rejectionReason}</p>
                  )}
                </div>
                <span className={cn('text-xs px-2 py-0.5 rounded-full flex-shrink-0', STATUS_STYLE[r.status])}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
              {r.status === 'PENDING' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { if (window.confirm('Cancelar esta solicitação?')) cancelMutation.mutate(r.id) }}
                  className="text-red-500 hover:text-red-700 hover:bg-red-50 mt-2 -ml-2"
                >
                  Cancelar
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Nova solicitação</DialogTitle></DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); if (form.title.trim()) createMutation.mutate() }}
            className="space-y-4 mt-2"
          >
            <div className="space-y-1.5">
              <Label htmlFor="req-title">Título</Label>
              <Input
                id="req-title"
                placeholder="Ex: Preciso de uma certidão atualizada"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-desc">Descrição</Label>
              <textarea
                id="req-desc"
                rows={4}
                placeholder="Detalhe o que você precisa..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
              />
            </div>
            {createMutation.isError && <p className="text-sm text-red-600">Erro ao enviar. Tente novamente.</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={createMutation.isPending || !form.title.trim()} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
                {createMutation.isPending ? 'Enviando...' : 'Enviar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

(Anexos na criação ficam fora do formulário inicial desta task — o endpoint já existe na API; adicionar o dropzone é incremento de UI que pode entrar como ajuste visual depois, sem bloquear a entrega funcional do fluxo de solicitar/cancelar/acompanhar.)

- [ ] **Step 3: Registrar a rota em `router.tsx`**

Em `apps/web/src/router.tsx`, adicionar o lazy import junto aos demais de portal (linha 22-26):

```typescript
const PortalRequests = lazy(() => import('@/pages/portal/Requests'))
```

E o filho de rota dentro de `/portal` (após `{ path: 'board/:boardId', element: <PortalBoard /> },`, linha 112):

```typescript
      { path: 'requests', element: <PortalRequests /> },
```

- [ ] **Step 4: Adicionar a aba no `Layout.tsx` do portal**

Em `apps/web/src/pages/portal/Layout.tsx`, importar o ícone `Inbox` junto aos demais (linha 5):

```typescript
import { LayoutGrid, FileText, User, LogOut, Inbox } from 'lucide-react'
```

E adicionar à lista `tabs` (linha 7-11), entre `Processos` e `Relatórios`:

```typescript
const tabs = [
  { to: '/portal/board', icon: LayoutGrid, label: 'Processos' },
  { to: '/portal/requests', icon: Inbox, label: 'Solicitações' },
  { to: '/portal/reports', icon: FileText, label: 'Relatórios' },
  { to: '/portal/profile', icon: User, label: 'Perfil' },
] as const
```

- [ ] **Step 5: Testar manualmente no navegador**

```bash
pnpm --filter api dev
pnpm --filter web dev
```

Login como CLIENT, navegar para `/portal/requests`, criar uma solicitação, confirmar que aparece como "Em análise", cancelar e confirmar que o status muda para "Cancelada".

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/pages/portal/Requests.tsx apps/web/src/router.tsx apps/web/src/pages/portal/Layout.tsx
git commit -m "feat(web): página do portal para criar/acompanhar/cancelar solicitações"
```

---

## Task 10: Frontend — página do escritório (`/app/requests`) com aprovação/rejeição

**Files:**
- Create: `apps/web/src/pages/app/Requests.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx`

**Interfaces:**
- Consumes: `GET /requests`, `GET /boards?clientId=`, `GET /boards/:id` (colunas), `POST /requests/:id/approve`, `POST /requests/:id/reject`.
- Produces: componente `Requests` default export em `apps/web/src/pages/app/Requests.tsx`, rota `/app/requests`.

- [ ] **Step 1: Criar a página**

```typescript
// apps/web/src/pages/app/Requests.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Inbox } from 'lucide-react'
import type { ClientRequest, Board } from '@/types'
import { toast } from 'sonner'

const STATUS_LABEL: Record<ClientRequest['status'], string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada',
}

const STATUS_STYLE: Record<ClientRequest['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
}

type Mode = 'NEW_BOARD' | 'EXISTING_BOARD'

export default function Requests() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<ClientRequest['status'] | ''>('PENDING')
  const [approving, setApproving] = useState<ClientRequest | null>(null)
  const [rejecting, setRejecting] = useState<ClientRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [mode, setMode] = useState<Mode>('NEW_BOARD')
  const [boardId, setBoardId] = useState('')
  const [columnId, setColumnId] = useState('')

  const { data: requests = [], isLoading } = useQuery<ClientRequest[]>({
    queryKey: ['requests', statusFilter],
    queryFn: () => api.get('/requests', { params: statusFilter ? { status: statusFilter } : {} }).then((r) => r.data),
  })

  const { data: clientBoards = [] } = useQuery<Board[]>({
    queryKey: ['boards', 'by-client', approving?.client?.id],
    queryFn: () => api.get('/boards', { params: { clientId: approving?.client?.id } }).then((r) => r.data),
    enabled: !!approving && mode === 'EXISTING_BOARD',
  })

  const selectedBoard = clientBoards.find((b) => b.id === boardId)

  const approveMutation = useMutation({
    mutationFn: () =>
      api.post(
        `/requests/${approving!.id}/approve`,
        mode === 'NEW_BOARD' ? { mode: 'NEW_BOARD' } : { mode: 'EXISTING_BOARD', boardId, columnId },
      ),
    onSuccess: () => {
      toast.success('Solicitação aprovada')
      qc.invalidateQueries({ queryKey: ['requests'] })
      setApproving(null)
      setMode('NEW_BOARD')
      setBoardId('')
      setColumnId('')
    },
    onError: () => toast.error('Erro ao aprovar solicitação'),
  })

  const rejectMutation = useMutation({
    mutationFn: () => api.post(`/requests/${rejecting!.id}/reject`, { reason: rejectReason || undefined }),
    onSuccess: () => {
      toast.success('Solicitação rejeitada')
      qc.invalidateQueries({ queryKey: ['requests'] })
      setRejecting(null)
      setRejectReason('')
    },
    onError: () => toast.error('Erro ao rejeitar solicitação'),
  })

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-gray-900">Solicitações dos Clientes</h1>
      </div>

      <div className="flex rounded-md border border-gray-300 overflow-hidden w-fit">
        {(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', ''] as const).map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-3 py-1.5 text-sm font-medium transition-colors',
              statusFilter === s ? 'bg-[#185FA5] text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
            )}
          >
            {s ? STATUS_LABEL[s] : 'Todas'}
          </button>
        ))}
      </div>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-gray-400">
          <Inbox size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhuma solicitação encontrada</p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <div key={r.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{r.title}</p>
                  <p className="text-xs text-gray-500">{r.client?.name}</p>
                  {r.description && <p className="text-xs text-gray-500 mt-1">{r.description}</p>}
                </div>
                <span className={cn('text-xs px-2 py-0.5 rounded-full flex-shrink-0', STATUS_STYLE[r.status])}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
              {r.status === 'PENDING' && (
                <div className="flex gap-2 mt-2">
                  <Button size="sm" onClick={() => setApproving(r)} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
                    Aprovar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejecting(r)} className="text-red-600 border-red-200 hover:bg-red-50">
                    Rejeitar
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal de aprovação */}
      <Dialog open={!!approving} onOpenChange={(open) => { if (!open) setApproving(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Aprovar solicitação</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="flex rounded-md border border-gray-300 overflow-hidden w-fit">
              <button
                type="button"
                onClick={() => setMode('NEW_BOARD')}
                className={cn('px-3 py-1.5 text-sm font-medium', mode === 'NEW_BOARD' ? 'bg-[#185FA5] text-white' : 'bg-white text-gray-600')}
              >
                Criar novo processo
              </button>
              <button
                type="button"
                onClick={() => setMode('EXISTING_BOARD')}
                className={cn('px-3 py-1.5 text-sm font-medium', mode === 'EXISTING_BOARD' ? 'bg-[#185FA5] text-white' : 'bg-white text-gray-600')}
              >
                Anexar a processo existente
              </button>
            </div>

            {mode === 'NEW_BOARD' && (
              <p className="text-xs text-gray-500">
                Será criado um novo processo "{approving?.title}" com 3 colunas padrão (Pendente → Em andamento → Concluído).
              </p>
            )}

            {mode === 'EXISTING_BOARD' && (
              <>
                <div className="space-y-1.5">
                  <Label>Processo</Label>
                  <select
                    value={boardId}
                    onChange={(e) => { setBoardId(e.target.value); setColumnId('') }}
                    className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
                  >
                    <option value="">Selecione um processo</option>
                    {clientBoards.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
                  </select>
                </div>
                {selectedBoard && (
                  <div className="space-y-1.5">
                    <Label>Coluna</Label>
                    <select
                      value={columnId}
                      onChange={(e) => setColumnId(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
                    >
                      <option value="">Selecione uma coluna</option>
                      {selectedBoard.columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setApproving(null)}>Cancelar</Button>
              <Button
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending || (mode === 'EXISTING_BOARD' && (!boardId || !columnId))}
                className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
              >
                {approveMutation.isPending ? 'Aprovando...' : 'Aprovar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de rejeição */}
      <Dialog open={!!rejecting} onOpenChange={(open) => { if (!open) setRejecting(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Rejeitar solicitação</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="reject-reason">Motivo (opcional)</Label>
              <textarea
                id="reject-reason"
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="flex w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setRejecting(null)}>Cancelar</Button>
              <Button
                onClick={() => rejectMutation.mutate()}
                disabled={rejectMutation.isPending}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {rejectMutation.isPending ? 'Rejeitando...' : 'Rejeitar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Registrar a rota em `router.tsx`**

Em `apps/web/src/router.tsx`, adicionar o import (junto aos demais de `@/pages/app`, próximo à linha 20):

```typescript
import Requests from '@/pages/app/Requests'
```

E o filho de rota dentro de `/app` (após `{ path: 'processes', element: <Processes /> },`, linha 56), sem `ProtectedRoute` extra — qualquer um dos `ORG_ROLES` já pode acessar (igual `dashboard`/`processes`):

```typescript
      { path: 'requests', element: <Requests /> },
```

- [ ] **Step 3: Adicionar o item de menu em `AppLayout.tsx`**

Em `apps/web/src/components/AppLayout.tsx`, importar o ícone `Inbox` (linha 5):

```typescript
import { LayoutDashboard, Users, UserCheck, Bell, CreditCard, Settings, LogOut, ClipboardList, Inbox, Menu, X } from 'lucide-react'
```

E adicionar o link após o de "Processos" (linha 70, antes do bloco de `MANAGER_ROLES.includes(role) && <SidebarLink to="/app/clients"...`):

```typescript
          {ORG_ROLES.includes(role) && (
            <SidebarLink to="/app/requests" icon={<Inbox size={16} />} label="Solicitações" onClick={handleNavClick} />
          )}
```

- [ ] **Step 4: Testar manualmente no navegador**

```bash
pnpm --filter api dev
pnpm --filter web dev
```

Como CLIENT, criar uma solicitação em `/portal/requests`. Como ORG_ADMIN, ir em `/app/requests`, aprovar com "Criar novo processo" e confirmar que o board aparece em `/app/processes`. Criar outra solicitação e aprovar com "Anexar a processo existente", escolhendo o board recém-criado e uma coluna — confirmar que a task aparece nessa coluna ao abrir o board.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/app/Requests.tsx apps/web/src/router.tsx apps/web/src/components/AppLayout.tsx
git commit -m "feat(web): painel do escritório para aprovar/rejeitar solicitações de clientes"
```

---

## Task 11: Badge "originado de solicitação" no card da Task

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/components/TaskCard.tsx`

**Interfaces:**
- Consumes: campo `sourceRequestId` no JSON de `Task` retornado pela API (já existe no banco desde a Task 1 — confirmar que nenhuma rota faz `select` explícito que omita o campo; `tasks.service.ts`/`boards.service.ts` usam `include`/retorno direto do Prisma, então o campo já vem por padrão).

- [ ] **Step 1: Adicionar o campo ao tipo `Task`**

Em `apps/web/src/types/index.ts`, no `interface Task` (linha 1-15), adicionar:

```typescript
  sourceRequestId: string | null
```

- [ ] **Step 2: Adicionar o badge em `TaskCard.tsx`**

Em `apps/web/src/components/TaskCard.tsx`, importar o ícone (linha 1):

```typescript
import { Inbox } from 'lucide-react'
```

E no JSX, dentro do `<div className="flex items-center gap-2 flex-wrap">` (linha 45-57), adicionar antes do badge de prioridade:

```typescript
        {task.sourceRequestId && (
          <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-600" title="Originado de uma solicitação do cliente">
            <Inbox size={11} />
            Solicitação
          </span>
        )}
```

- [ ] **Step 3: Atualizar o teste existente de `TaskCard.test.tsx`**

Abrir `apps/web/src/components/TaskCard.test.tsx`, localizar o objeto mock de `Task` usado nos testes (provavelmente um `const baseTask: Task = {...}` no topo) e adicionar `sourceRequestId: null` para satisfazer o tipo. Adicionar um novo teste:

```typescript
it('exibe badge de solicitação quando sourceRequestId está preenchido', () => {
  render(<TaskCard task={{ ...baseTask, sourceRequestId: 'req-123' }} onClick={() => {}} />)
  expect(screen.getByText('Solicitação')).toBeInTheDocument()
})
```

(Ajustar `baseTask`/imports de `render`/`screen` conforme o padrão já usado no restante do arquivo — seguir exatamente o setup de teste que já existe ali, sem reescrever os testes existentes.)

- [ ] **Step 4: Rodar os testes do frontend**

```bash
pnpm --filter web test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/components/TaskCard.tsx apps/web/src/components/TaskCard.test.tsx
git commit -m "feat(web): badge de origem por solicitação no card da task"
```

---

## Self-Review (cobertura do spec)

- Schema (`Request`, `RequestAttachment`, `RequestStatus`, extensões) → Task 1.
- Worker de notificação para destinatário `USER` (`REQUEST_CREATED`) → Task 2.
- Notificação ao cliente (`REQUEST_APPROVED`/`REQUEST_REJECTED`) → Tasks 2 e 5.
- Config de notificação por org (3 booleans) → Task 3.
- `createRequest`/listagens/`cancelRequest` → Task 4.
- `approveRequest` (NEW_BOARD e EXISTING_BOARD) / `rejectRequest` → Task 5.
- Rotas do escritório (`/requests*`, roles) → Task 6.
- Rotas do portal (`/portal/requests*`) → Task 7.
- Anexos da solicitação (B2) → Task 8.
- Frontend portal (criar/listar/cancelar) → Task 9.
- Frontend escritório (listar/aprovar/rejeitar com os 2 modos) → Task 10.
- Badge de rastreabilidade na Task → Task 11.
- Dropzone de anexos no formulário do portal (UI) deliberadamente deixado fora do fluxo crítico desta entrega (endpoint já existe; é incremento visual, não funcional) — registrar em `docs/tech-debt.md` se não for feito numa iteração seguinte.
- Fora de escopo conforme o design: catálogo de "tipos de pedido" e edição de conteúdo da request — não implementados aqui, por decisão do spec.
