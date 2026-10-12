# Protocolo Digital com Validade Jurídica + IP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao escritório um protocolo digital defensável — número único, log de eventos
imutável (enviado/visualizado/baixado/vencido) com IP e identidade de quem acessou, alerta diário
pro staff quando não há visualização, e comprovante exportável — pra documentos/avisos com
vencimento (ex: guias de imposto).

**Architecture:** Módulo novo `protocols/` (schema/service/routes), mesmo padrão dos módulos
existentes. `Protocol` referencia opcionalmente um `Attachment` já existente (caso documento) ou
carrega texto livre (caso aviso). `ProtocolEvent` é um log *append-only* (mesmo padrão de
`TaskHistory`/`NotificationLog`) — o `Protocol` nunca é editado depois de criado, só recebe
eventos novos. O alerta diário estende o cron de SLA já existente em vez de criar um mecanismo
paralelo. O comprovante é HTML pronto pra impressão (não gera PDF no servidor).

**Tech Stack:** Node.js 22 + TypeScript strict + Fastify v5 + Prisma v6 + BullMQ/Redis (backend);
React 19 + Vite + TailwindCSS v4 + React Query (frontend). Vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-protocolo-digital-design.md`

## Global Constraints

- `pnpm --filter api prisma migrate dev` NUNCA roda direto (CLI não carrega `DATABASE_URL` via
  `app.ts`). Gerar a migration com `prisma migrate diff` e aplicar via `migrate:deploy` — ver
  Task 1, mesmo workflow usado nas duas features anteriores desta sessão.
- Toda migration aplicada nos **dois** bancos: `DATABASE_URL` (dev) e `DATABASE_URL_TEST`
  (`DATABASE_URL="$DATABASE_URL_TEST" pnpm --filter api migrate:deploy`), seguido de
  `pnpm --filter api exec prisma generate`.
- Comentários/identificadores em inglês; mensagens de usuário (toasts, labels, templates) em
  português.
- TypeScript `strict: true` — sem `any`. Validação Zod em toda entrada de rota.
- `ProtocolEvent` nunca é editado ou deletado depois de criado — só `INSERT`. `Protocol.status`
  só avança (`SENT → VIEWED → DOWNLOADED`, ou `SENT → EXPIRED`), nunca regride.
- Acesso de `ClientUser` a um `Protocol` sempre passa por `getClientAccessScope` + checagem de
  `task.visibleToClient` — igual ao padrão já testado em `comments.service.ts`/
  `request-comments.service.ts`. Acesso negado é sempre 404, nunca 403 (não revela existência).
- Todo novo campo booleano de `NotificationEvent` precisa dos 6 pontos de toque: enum Prisma,
  campo em `NotificationConfig` + `updateConfigSchema` + `getConfig` select, `EVENT_FLAG_MAP`,
  `DEFAULT_TEMPLATES`, toggle em `Notifications.tsx`, entrada em `Templates.tsx`.
- O comprovante (`GET /protocols/:id/receipt`) devolve HTML (`Content-Type: text/html`), não PDF
  — decisão explícita em brainstorming pra evitar Puppeteer/Chromium no Alpine. O escritório usa
  "Imprimir > Salvar como PDF" do próprio navegador.

## Review Focus

- **`ClientUser` sem acesso à empresa do protocolo:** `GET /portal/protocols/:id` e
  `GET /portal/protocols/:id/download` devem devolver 404, nunca 403 nem os dados do protocolo —
  mesmo que o `ClientUser` saiba o id.
- **Task não visível ao cliente:** `POST /tasks/:taskId/protocols` numa Task com
  `visibleToClient: false` deve ser bloqueado na criação — não faz sentido notificar um cliente
  sobre uma Task que ele nem deveria saber que existe.
- **`attachmentId` de outra Task:** criar um protocolo passando o id de um `Attachment` que
  pertence a uma Task diferente da informada na URL deve ser rejeitado (404), nunca aceito
  silenciosamente — evitaria vazar arquivo entre tasks/clientes.
- **Download sem arquivo:** `GET /portal/protocols/:id/download` num protocolo que é só texto
  (`attachmentId` nulo) deve devolver 404 com mensagem clara, nunca 500.
- **Números de protocolo sob concorrência:** dois `createProtocol` disparados ao mesmo tempo na
  mesma org/ano nunca podem gerar o mesmo `number` — o `ProtocolCounter` precisa garantir isso
  via `upsert` atômico, não `COUNT(*) + 1`.

---

### Task 1: Schema — `Protocol`, `ProtocolEvent`, `ProtocolCounter`, evento de notificação

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration SQL

**Interfaces:**
- Produces: modelos `Protocol`/`ProtocolEvent`/`ProtocolCounter`; enums `ProtocolStatus`
  (`SENT`/`VIEWED`/`DOWNLOADED`/`EXPIRED`) e `ProtocolEventType`
  (`SENT`/`VIEWED`/`DOWNLOADED`/`EXPIRED`); `NotificationEvent.PROTOCOL_CREATED`;
  `NotificationConfig.protocolCreated`/`protocolWarningDays`.

- [ ] **Step 1: Editar `apps/api/prisma/schema.prisma`**

No `model Organization` (linha ~25), adicionar ao final do bloco de relações:

```prisma
  protocols              Protocol[]
  protocolCounters       ProtocolCounter[]
```

No `model User` (linha ~81), adicionar logo após `requestComments`:

```prisma
  requestComments              RequestComment[]
  protocols                    Protocol[]
```

No `model Client` (linha ~131), adicionar logo após `requestComments`:

```prisma
  requestComments          RequestComment[]
  protocols                Protocol[]
```

No `model Task` (linha ~364), adicionar logo após `deliverables`:

```prisma
  documentRequirements TaskDocumentRequirement[]
  deliverables         TaskDeliverable[]
  protocols            Protocol[]
```

No `model Attachment` (linha ~683), adicionar logo após `deliverable`:

```prisma
  documentRequirement TaskDocumentRequirement?
  deliverable         TaskDeliverable?
  protocol            Protocol?
```

Logo após `model TaskDeliverable` (antes de `model Comment`), adicionar os 3 modelos novos:

```prisma
model Protocol {
  id             String         @id @default(cuid())
  organizationId String
  number         String
  clientId       String
  taskId         String
  attachmentId   String?        @unique
  title          String
  content        String?
  dueDate        DateTime?
  status         ProtocolStatus @default(SENT)
  createdById    String
  createdAt      DateTime       @default(now())

  organization Organization    @relation(fields: [organizationId], references: [id])
  client       Client          @relation(fields: [clientId], references: [id])
  task         Task            @relation(fields: [taskId], references: [id], onDelete: Cascade)
  attachment   Attachment?     @relation(fields: [attachmentId], references: [id])
  createdBy    User            @relation(fields: [createdById], references: [id])
  events       ProtocolEvent[]

  @@unique([organizationId, number])
  @@index([organizationId, status])
  @@index([organizationId, dueDate])
  @@index([clientId])
  @@map("protocols")
}

enum ProtocolStatus {
  SENT
  VIEWED
  DOWNLOADED
  EXPIRED
}

model ProtocolEvent {
  id         String            @id @default(cuid())
  protocolId String
  type       ProtocolEventType
  actorType  String
  actorId    String?
  actorName  String?
  actorEmail String?
  ip         String?
  userAgent  String?
  createdAt  DateTime          @default(now())

  protocol Protocol @relation(fields: [protocolId], references: [id], onDelete: Cascade)

  @@index([protocolId, createdAt])
  @@map("protocol_events")
}

enum ProtocolEventType {
  SENT
  VIEWED
  DOWNLOADED
  EXPIRED
}

model ProtocolCounter {
  organizationId String
  year           Int
  lastNumber     Int    @default(0)

  organization Organization @relation(fields: [organizationId], references: [id])

  @@id([organizationId, year])
  @@map("protocol_counters")
}
```

No enum `NotificationEvent` (linha ~759), adicionar ao final:

```prisma
enum NotificationEvent {
  TASK_CREATED
  TASK_MOVED
  TASK_COMPLETED
  TASK_COMMENT_ADDED
  TASK_BLOCKED
  REQUEST_CREATED
  REQUEST_APPROVED
  REQUEST_REJECTED
  RECURRING_GENERATION_FAILED
  DOCUMENT_REJECTED
  SLA_DIGEST
  REQUEST_NEEDS_INFO
  REQUEST_COMMENT_ADDED
  REQUEST_CANCELLED
  PROTOCOL_CREATED
}
```

No `model NotificationConfig` (linha ~707), adicionar logo após `requestCancelled` e logo após
`slaDueCriticalDays` (dois campos em grupos diferentes, mesmo padrão dos campos de SLA):

```prisma
  requestCancelled          Boolean  @default(true)
  protocolCreated           Boolean  @default(true)
  maximizebotToken          String?
  saveOnTicket              Boolean  @default(true)
  startChatbot              Boolean  @default(false)
  recurringGenerationFailed Boolean  @default(true)
  documentRejected          Boolean  @default(true)
  slaTargetWarningDays      Int      @default(3)
  slaDueCriticalDays        Int      @default(1)
  protocolWarningDays       Int      @default(3)
  slaDigestEnabled          Boolean  @default(true)
```

- [ ] **Step 2: Gerar o SQL da migration**

```bash
cd apps/api
set -a; source ../../.env; set +a
prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script \
  > /tmp/add_protocols.sql 2> /tmp/diff-stderr.log
cat /tmp/diff-stderr.log  # confirmar que só tem avisos
```

Revisar o SQL: deve criar `protocols`, `protocol_events`, `protocol_counters`, os 2 enums novos
(`ProtocolStatus`, `ProtocolEventType`), 1 valor novo em `NotificationEvent`
(`PROTOCOL_CREATED`), e as 2 colunas novas em `notification_configs`
(`protocolCreated`, `protocolWarningDays`). Copiar pra
`apps/api/prisma/migrations/<timestamp>_add_protocols/migration.sql` (timestamp no formato
`YYYYMMDDHHMMSS`, conferir a última pasta em `apps/api/prisma/migrations/` pra manter o padrão).

- [ ] **Step 3: Aplicar nos dois bancos e gerar o client**

```bash
pnpm --filter api migrate:deploy
DATABASE_URL="$DATABASE_URL_TEST" pnpm --filter api migrate:deploy
pnpm --filter api exec prisma generate
```

- [ ] **Step 4: Verificar o build**

```bash
pnpm --filter api exec tsc --noEmit
```

Esperado: 1 erro em `default-templates.ts` (`DEFAULT_TEMPLATES` exaustivo sobre
`NotificationEvent`, falta `PROTOCOL_CREATED`) — mesmo padrão já visto nas 2 features anteriores,
resolvido na Task 5. Confirmar que é só esse erro: `pnpm --filter api exec tsc --noEmit | grep -c "error TS"` deve dar `1`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): adiciona Protocol, ProtocolEvent, ProtocolCounter e evento PROTOCOL_CREATED"
```

---

### Task 2: Módulo `protocols/` — schema e service (CRUD, eventos, numeração, comprovante HTML)

**Files:**
- Create: `apps/api/src/modules/protocols/protocols.schema.ts`
- Create: `apps/api/src/modules/protocols/protocols.service.ts`
- Create: `apps/api/src/modules/protocols/protocols.service.test.ts`

**Interfaces:**
- Consumes: `prisma.protocol`/`protocolEvent`/`protocolCounter` (Task 1); `getClientAccessScope`,
  `canSeeTask` de `@/modules/client-users/client-access`; `getSignedDownloadUrl` de `@/lib/b2`;
  `enqueueNotification` de `@/lib/queue`.
- Produces: `createProtocol`, `listProtocolsForOrg`, `listProtocolsForTask`,
  `listProtocolsForClient`, `getProtocolById`, `getProtocolsSummary`, `registerView`,
  `registerDownload`, `expireOverdueProtocols`, `buildProtocolReceiptHtml` — consumidos por
  Task 3 (rotas staff), Task 4 (rotas portal + `trustProxy`), Task 6 (cron de digest).

- [ ] **Step 1: Escrever `protocols.schema.ts`**

```typescript
// apps/api/src/modules/protocols/protocols.schema.ts
import { z } from 'zod'

export const createProtocolSchema = z.object({
  title: z.string().min(1),
  dueDate: z.string().datetime().optional(),
  attachmentId: z.string().cuid().optional(),
  content: z.string().min(1).optional(),
}).refine((data) => !!data.attachmentId || !!data.content, {
  message: 'Informe um anexo existente ou um texto pro protocolo',
  path: ['content'],
})

export const listProtocolsQuerySchema = z.object({
  status: z.enum(['SENT', 'VIEWED', 'DOWNLOADED', 'EXPIRED']).optional(),
  clientId: z.string().cuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

export type CreateProtocolBody = z.infer<typeof createProtocolSchema>
export type ListProtocolsQuery = z.infer<typeof listProtocolsQuerySchema>
```

- [ ] **Step 2: Escrever os testes de `createProtocol`/`registerView`/`registerDownload`/`expireOverdueProtocols` (falhando)**

```typescript
// apps/api/src/modules/protocols/protocols.service.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment,
  createTestBoard, createTestColumn, createTestTask, createTestClientUser, grantClientAccess,
} from '@/test/helpers'
import * as queue from '@/lib/queue'
import {
  createProtocol, listProtocolsForOrg, listProtocolsForTask, listProtocolsForClient,
  getProtocolById, getProtocolsSummary, registerView, registerDownload, expireOverdueProtocols,
  buildProtocolReceiptHtml,
} from './protocols.service'

beforeEach(() => {
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

afterEach(() => vi.restoreAllMocks())

async function setupTaskWithAttachment(orgId: string, userId: string) {
  const client = await createTestClient(orgId)
  const board = await createTestBoard(orgId, client.id)
  const column = await createTestColumn(board.id)
  const task = await createTestTask(column.id, userId)
  const attachment = await prisma.attachment.create({
    data: { taskId: task.id, filename: 'guia-darf.pdf', mimeType: 'application/pdf', size: 1024, storageKey: 'k1', uploadedBy: userId },
  })
  return { client, board, column, task, attachment }
}

describe('createProtocol', () => {
  it('cria com anexo existente, número sequencial e evento SENT', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment, client } = await setupTaskWithAttachment(org.id, admin.id)

    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'Guia DARF Outubro', attachmentId: attachment.id })

    expect(protocol.status).toBe('SENT')
    expect(protocol.number).toMatch(/^\d{4}-\d{6}$/)
    expect(protocol.clientId).toBe(client.id)
    const events = await prisma.protocolEvent.findMany({ where: { protocolId: protocol.id } })
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('SENT')
    expect(queue.enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'PROTOCOL_CREATED', clientId: client.id, taskId: task.id }),
    )
  })

  it('cria só com texto (sem anexo)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, admin.id)

    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'Aviso formal', content: 'Lembramos que o prazo vence em breve.' })

    expect(protocol.attachmentId).toBeNull()
    expect(protocol.content).toBe('Lembramos que o prazo vence em breve.')
  })

  it('lança 400 sem anexo e sem texto', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task } = await setupTaskWithAttachment(org.id, admin.id)

    await expect(
      createProtocol(task.id, org.id, admin.id, { title: 'x' } as never),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('lança 422 numa task com visibleToClient false', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task } = await setupTaskWithAttachment(org.id, admin.id)
    await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: false } })

    await expect(
      createProtocol(task.id, org.id, admin.id, { title: 'x', content: 'y' }),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('lança 404 se attachmentId pertence a outra task', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task: taskA } = await setupTaskWithAttachment(org.id, admin.id)
    const { attachment: attachmentB } = await setupTaskWithAttachment(org.id, admin.id)

    await expect(
      createProtocol(taskA.id, org.id, admin.id, { title: 'x', attachmentId: attachmentB.id }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('números não colidem sob criação concorrente na mesma org/ano', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task: task1 } = await setupTaskWithAttachment(org.id, admin.id)
    const { task: task2 } = await setupTaskWithAttachment(org.id, admin.id)

    const [p1, p2] = await Promise.all([
      createProtocol(task1.id, org.id, admin.id, { title: 'A', content: 'a' }),
      createProtocol(task2.id, org.id, admin.id, { title: 'B', content: 'b' }),
    ])

    expect(p1.number).not.toBe(p2.number)
  })
})

describe('registerView / registerDownload', () => {
  it('registerView cria evento VIEWED e avança status SENT -> VIEWED', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment, client } = await setupTaskWithAttachment(org.id, admin.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    await prisma.task.update({ where: { id: task.id }, data: { departmentId: department.id } })
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'x', attachmentId: attachment.id })

    await registerView(protocol.id, org.id, clientUser.id, '203.0.113.5', 'Mozilla/5.0')

    const updated = await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })
    expect(updated.status).toBe('VIEWED')
    const events = await prisma.protocolEvent.findMany({ where: { protocolId: protocol.id, type: 'VIEWED' } })
    expect(events).toHaveLength(1)
    expect(events[0].ip).toBe('203.0.113.5')
    expect(events[0].actorEmail).toBe(clientUser.email)
  })

  it('registerView duas vezes gera dois eventos, mas status não regride', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment, client } = await setupTaskWithAttachment(org.id, admin.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    await prisma.task.update({ where: { id: task.id }, data: { departmentId: department.id } })
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'x', attachmentId: attachment.id })

    await registerView(protocol.id, org.id, clientUser.id, '203.0.113.5', 'ua')
    await registerDownload(protocol.id, org.id, clientUser.id, '203.0.113.5', 'ua')
    await registerView(protocol.id, org.id, clientUser.id, '203.0.113.6', 'ua')

    const updated = await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })
    expect(updated.status).toBe('DOWNLOADED') // não regride pra VIEWED
    const viewedEvents = await prisma.protocolEvent.findMany({ where: { protocolId: protocol.id, type: 'VIEWED' } })
    expect(viewedEvents).toHaveLength(2)
  })

  it('registerView lança 404 pra ClientUser sem acesso à empresa', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, admin.id)
    const { clientUser } = await createTestClientUser(org.id) // sem grantClientAccess
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'x', attachmentId: attachment.id })

    await expect(
      registerView(protocol.id, org.id, clientUser.id, '203.0.113.5', 'ua'),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('registerDownload lança 404 quando o protocolo não tem anexo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, admin.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    await prisma.task.update({ where: { id: task.id }, data: { departmentId: department.id } })
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'x', content: 'y' })

    await expect(
      registerDownload(protocol.id, org.id, clientUser.id, '203.0.113.5', 'ua'),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('expireOverdueProtocols', () => {
  it('marca EXPIRED só os que estão SENT com dueDate vencido, gera evento', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task: task1, attachment: att1 } = await setupTaskWithAttachment(org.id, admin.id)
    const { task: task2, attachment: att2 } = await setupTaskWithAttachment(org.id, admin.id)
    const past = new Date(Date.now() - 86400000)
    const future = new Date(Date.now() + 86400000)

    const overdue = await createProtocol(task1.id, org.id, admin.id, { title: 'vence ontem', attachmentId: att1.id, dueDate: past })
    const notYet = await createProtocol(task2.id, org.id, admin.id, { title: 'vence amanhã', attachmentId: att2.id, dueDate: future })

    const count = await expireOverdueProtocols(org.id, new Date())

    expect(count).toBe(1)
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: overdue.id } })).status).toBe('EXPIRED')
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: notYet.id } })).status).toBe('SENT')
    const event = await prisma.protocolEvent.findFirst({ where: { protocolId: overdue.id, type: 'EXPIRED' } })
    expect(event).not.toBeNull()
  })

  it('nunca marca EXPIRED um protocolo que já foi visualizado', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment, client } = await setupTaskWithAttachment(org.id, admin.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    await prisma.task.update({ where: { id: task.id }, data: { departmentId: department.id } })
    const past = new Date(Date.now() - 86400000)
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'x', attachmentId: attachment.id, dueDate: past })
    await registerView(protocol.id, org.id, clientUser.id, '203.0.113.5', 'ua')

    await expireOverdueProtocols(org.id, new Date())

    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })).status).toBe('VIEWED')
  })
})

describe('listProtocolsForOrg / listProtocolsForClient / getProtocolById / getProtocolsSummary', () => {
  it('lista da org filtra por status e cliente vê só os próprios', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task: taskA, attachment: attA, client: clientA } = await setupTaskWithAttachment(org.id, admin.id)
    const { task: taskB, attachment: attB } = await setupTaskWithAttachment(org.id, admin.id)
    await createProtocol(taskA.id, org.id, admin.id, { title: 'Da A', attachmentId: attA.id })
    await createProtocol(taskB.id, org.id, admin.id, { title: 'Da B', attachmentId: attB.id })

    const all = await listProtocolsForOrg(org.id, {})
    expect(all).toHaveLength(2)
    expect(all.every((p) => typeof p.boardId === 'string')).toBe(true)

    const onlyA = await listProtocolsForClient(org.id, clientA.id, {})
    expect(onlyA).toHaveLength(1)
    expect(onlyA[0].title).toBe('Da A')
  })

  it('listProtocolsForClient esconde protocolo cuja task deixou de ser visível ao cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment, client } = await setupTaskWithAttachment(org.id, admin.id)
    await createProtocol(task.id, org.id, admin.id, { title: 'Vira interno', attachmentId: attachment.id })
    await prisma.task.update({ where: { id: task.id }, data: { visibleToClient: false } })

    const list = await listProtocolsForClient(org.id, client.id, {})

    expect(list).toHaveLength(0)
  })

  it('getProtocolById inclui a timeline de eventos ordenada', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment, client } = await setupTaskWithAttachment(org.id, admin.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    await prisma.task.update({ where: { id: task.id }, data: { departmentId: department.id } })
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'x', attachmentId: attachment.id })
    await registerView(protocol.id, org.id, clientUser.id, '203.0.113.5', 'ua')

    const detail = await getProtocolById(protocol.id, org.id)

    expect(detail.events.map((e) => e.type)).toEqual(['SENT', 'VIEWED'])
  })

  it('getProtocolsSummary conta por status', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, admin.id)
    await createProtocol(task.id, org.id, admin.id, { title: 'x', attachmentId: attachment.id })

    const summary = await getProtocolsSummary(org.id)

    expect(summary.SENT).toBe(1)
    expect(summary.VIEWED).toBe(0)
  })
})

describe('buildProtocolReceiptHtml', () => {
  it('monta HTML com número, timeline e o aviso sobre o IP', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, admin.id)
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'Guia DARF', attachmentId: attachment.id })
    const detail = await getProtocolById(protocol.id, org.id)

    const html = buildProtocolReceiptHtml(detail)

    expect(html).toContain(detail.number)
    expect(html).toContain('Guia DARF')
    expect(html).toContain('evidência de apoio')
  })
})
```

- [ ] **Step 3: Rodar os testes e confirmar falha**

```bash
pnpm --filter api test protocols.service
```

Esperado: FAIL — módulo `./protocols.service` não existe.

- [ ] **Step 4: Implementar `protocols.service.ts`**

```typescript
// apps/api/src/modules/protocols/protocols.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import { getClientAccessScope, canSeeTask } from '@/modules/client-users/client-access'
import { getSignedDownloadUrl } from '@/lib/b2'
import type { CreateProtocolBody } from './protocols.schema'
import type { ProtocolStatus } from '@prisma/client'

interface ProtocolDetail {
  id: string
  number: string
  title: string
  content: string | null
  status: ProtocolStatus
  client: { name: string }
  attachment: { filename: string } | null
  events: { type: string; actorName: string | null; actorEmail: string | null; ip: string | null; createdAt: Date }[]
}

async function nextProtocolNumber(organizationId: string): Promise<string> {
  const year = new Date().getUTCFullYear()
  const counter = await prisma.protocolCounter.upsert({
    where: { organizationId_year: { organizationId, year } },
    create: { organizationId, year, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  })
  return `${year}-${String(counter.lastNumber).padStart(6, '0')}`
}

export async function createProtocol(
  taskId: string,
  organizationId: string,
  staffId: string,
  data: Omit<CreateProtocolBody, 'dueDate'> & { dueDate?: Date },
) {
  if (!data.attachmentId && !data.content) {
    throw new AppError(400, 'Informe um anexo existente ou um texto pro protocolo')
  }

  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId } } },
    include: { column: { include: { board: { select: { clientId: true } } } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  if (!task.visibleToClient) {
    throw new AppError(422, 'Só é possível criar protocolo numa tarefa visível ao cliente')
  }

  if (data.attachmentId) {
    const attachment = await prisma.attachment.findFirst({ where: { id: data.attachmentId, taskId } })
    if (!attachment) throw new AppError(404, 'Anexo não encontrado nesta tarefa')
  }

  const clientId = task.column.board.clientId
  const number = await nextProtocolNumber(organizationId)

  const protocol = await prisma.protocol.create({
    data: {
      organizationId,
      number,
      clientId,
      taskId,
      attachmentId: data.attachmentId,
      title: data.title,
      content: data.content,
      dueDate: data.dueDate,
      createdById: staffId,
    },
  })

  await prisma.protocolEvent.create({
    data: { protocolId: protocol.id, type: 'SENT', actorType: 'user', actorId: staffId },
  })

  await enqueueNotification({
    event: 'PROTOCOL_CREATED',
    organizationId,
    clientId,
    taskId,
    metadata: { protocolTitle: data.title },
  })

  return protocol
}

export async function listProtocolsForOrg(
  organizationId: string,
  filters: { status?: ProtocolStatus; clientId?: string; from?: Date; to?: Date },
) {
  const protocols = await prisma.protocol.findMany({
    where: {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.clientId ? { clientId: filters.clientId } : {}),
      ...(filters.from || filters.to ? { createdAt: { gte: filters.from, lte: filters.to } } : {}),
    },
    include: {
      client: { select: { id: true, name: true } },
      // boardId achatado abaixo — o Dashboard (Task 11) linka pro board, não existe rota de
      // task isolada no app (mesmo padrão já resolvido na feature de Solicitações).
      task: { select: { column: { select: { boardId: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return protocols.map(({ task, ...rest }) => ({ ...rest, boardId: task.column.boardId }))
}

export async function listProtocolsForTask(taskId: string, organizationId: string) {
  const task = await prisma.task.findFirst({ where: { id: taskId, column: { board: { organizationId } } } })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  return prisma.protocol.findMany({ where: { taskId }, orderBy: { createdAt: 'desc' } })
}

export async function listProtocolsForClient(
  organizationId: string,
  clientId: string,
  filters: { status?: ProtocolStatus; from?: Date; to?: Date; search?: string },
) {
  return prisma.protocol.findMany({
    where: {
      organizationId,
      clientId,
      // Um protocolo cuja Task foi marcada como visibleToClient: false depois de criado nunca
      // pode aparecer nesta lista — senão o card aparece pro cliente mas abrir/baixar (que
      // revalida isso em registerView/registerDownload) devolveria 404, uma inconsistência
      // visível pro próprio cliente.
      task: { visibleToClient: true },
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.from || filters.to ? { createdAt: { gte: filters.from, lte: filters.to } } : {}),
      ...(filters.search ? { title: { contains: filters.search, mode: 'insensitive' } } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getProtocolById(id: string, organizationId: string): Promise<ProtocolDetail> {
  const protocol = await prisma.protocol.findFirst({
    where: { id, organizationId },
    include: {
      client: { select: { name: true } },
      attachment: { select: { filename: true } },
      events: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!protocol) throw new AppError(404, 'Protocolo não encontrado')
  return protocol
}

export async function getProtocolsSummary(organizationId: string) {
  const counts = await prisma.protocol.groupBy({
    by: ['status'],
    where: { organizationId },
    _count: { _all: true },
  })
  const summary: Record<ProtocolStatus, number> = { SENT: 0, VIEWED: 0, DOWNLOADED: 0, EXPIRED: 0 }
  for (const row of counts) summary[row.status] = row._count._all
  return summary
}

async function assertClientAccess(protocolClientId: string, taskDepartmentId: string, clientUserId: string) {
  const scope = await getClientAccessScope(clientUserId)
  if (!canSeeTask(scope, protocolClientId, taskDepartmentId)) {
    throw new AppError(404, 'Protocolo não encontrado')
  }
}

async function resolveClientUserActor(clientUserId: string) {
  const clientUser = await prisma.clientUser.findUnique({ where: { id: clientUserId }, select: { name: true, email: true } })
  return { name: clientUser?.name ?? 'Cliente', email: clientUser?.email ?? null }
}

export async function registerView(
  protocolId: string,
  organizationId: string,
  clientUserId: string,
  ip: string | undefined,
  userAgent: string | undefined,
) {
  const protocol = await prisma.protocol.findFirst({
    where: { id: protocolId, organizationId },
    include: { task: { select: { departmentId: true, visibleToClient: true } } },
  })
  if (!protocol || !protocol.task.visibleToClient) throw new AppError(404, 'Protocolo não encontrado')
  await assertClientAccess(protocol.clientId, protocol.task.departmentId, clientUserId)

  const actor = await resolveClientUserActor(clientUserId)
  await prisma.protocolEvent.create({
    data: { protocolId, type: 'VIEWED', actorType: 'client', actorId: clientUserId, actorName: actor.name, actorEmail: actor.email, ip, userAgent },
  })

  if (protocol.status === 'SENT') {
    await prisma.protocol.updateMany({ where: { id: protocolId, status: 'SENT' }, data: { status: 'VIEWED' } })
  }

  return prisma.protocol.findUniqueOrThrow({ where: { id: protocolId } })
}

export async function registerDownload(
  protocolId: string,
  organizationId: string,
  clientUserId: string,
  ip: string | undefined,
  userAgent: string | undefined,
) {
  const protocol = await prisma.protocol.findFirst({
    where: { id: protocolId, organizationId },
    include: { task: { select: { departmentId: true, visibleToClient: true } }, attachment: true },
  })
  if (!protocol || !protocol.task.visibleToClient) throw new AppError(404, 'Protocolo não encontrado')
  await assertClientAccess(protocol.clientId, protocol.task.departmentId, clientUserId)
  if (!protocol.attachment) throw new AppError(404, 'Esse protocolo não tem arquivo pra baixar')

  const actor = await resolveClientUserActor(clientUserId)
  await prisma.protocolEvent.create({
    data: { protocolId, type: 'DOWNLOADED', actorType: 'client', actorId: clientUserId, actorName: actor.name, actorEmail: actor.email, ip, userAgent },
  })

  if (protocol.status === 'SENT' || protocol.status === 'VIEWED') {
    await prisma.protocol.updateMany({ where: { id: protocolId, status: protocol.status }, data: { status: 'DOWNLOADED' } })
  }

  return getSignedDownloadUrl(protocol.attachment.storageKey)
}

export async function expireOverdueProtocols(organizationId: string, now: Date): Promise<number> {
  const overdue = await prisma.protocol.findMany({
    where: { organizationId, status: 'SENT', dueDate: { not: null, lt: now } },
    select: { id: true },
  })

  for (const p of overdue) {
    await prisma.$transaction([
      prisma.protocol.update({ where: { id: p.id }, data: { status: 'EXPIRED' } }),
      prisma.protocolEvent.create({ data: { protocolId: p.id, type: 'EXPIRED', actorType: 'system' } }),
    ])
  }

  return overdue.length
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  SENT: 'Enviado',
  VIEWED: 'Visualizado',
  DOWNLOADED: 'Baixado',
  EXPIRED: 'Vencido sem visualização',
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildProtocolReceiptHtml(protocol: ProtocolDetail): string {
  const rows = protocol.events.map((e) => `
    <tr>
      <td>${escapeHtml(EVENT_TYPE_LABEL[e.type] ?? e.type)}</td>
      <td>${escapeHtml(e.actorName ?? '—')}${e.actorEmail ? ` (${escapeHtml(e.actorEmail)})` : ''}</td>
      <td>${escapeHtml(e.ip ?? '—')}</td>
      <td>${new Date(e.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Comprovante — Protocolo ${escapeHtml(protocol.number)}</title>
<style>
  body { font-family: Arial, sans-serif; color: #1f2937; padding: 32px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .muted { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
  th { background: #f3f4f6; }
  .footer { margin-top: 32px; font-size: 11px; color: #9ca3af; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>Protocolo ${escapeHtml(protocol.number)}</h1>
  <p class="muted">${escapeHtml(protocol.title)} — ${escapeHtml(protocol.client.name)}</p>
  <p>${protocol.content ? escapeHtml(protocol.content) : `Arquivo: ${escapeHtml(protocol.attachment?.filename ?? '—')}`}</p>
  <table>
    <thead><tr><th>Evento</th><th>Quem</th><th>IP</th><th>Quando</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="footer">O IP registrado é evidência de apoio do acesso à plataforma, vinculado à autenticação do usuário no momento do evento — não constitui assinatura digital certificada.</p>
</body>
</html>`
}
```

Nota: o `ProtocolEvent` tipo `SENT` é criado numa chamada separada, depois do `protocol.create`
(não dentro de uma `$transaction` combinada) porque depende do `protocol.id` já gerado. Cenário
de borda aceitável: se essa segunda chamada falhar, o protocolo existe sem o evento `SENT` —
não quebra a garantia principal (`status` nunca regride, eventos nunca são editados), só deixa a
timeline sem o primeiro item nesse caso raro de falha a meio do caminho.

- [ ] **Step 5: Rodar os testes e confirmar passagem**

```bash
pnpm --filter api test protocols.service
```

Esperado: todos passando.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/protocols
git commit -m "feat(protocols): módulo protocols — createProtocol, eventos, numeração, comprovante HTML"
```

---

### Task 3: Rotas do lado do escritório (`protocols.routes.ts`)

**Files:**
- Create: `apps/api/src/modules/protocols/protocols.routes.ts`
- Create: `apps/api/src/modules/protocols/protocols.routes.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: todas as funções de `protocols.service.ts` (Task 2); `createProtocolSchema`,
  `listProtocolsQuerySchema` (Task 2).

- [ ] **Step 1: Escrever `protocols.routes.ts`**

```typescript
// apps/api/src/modules/protocols/protocols.routes.ts
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createProtocolSchema, listProtocolsQuerySchema } from './protocols.schema'
import {
  createProtocol, listProtocolsForOrg, listProtocolsForTask, getProtocolById,
  getProtocolsSummary, buildProtocolReceiptHtml,
} from './protocols.service'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] as const

export async function protocolsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.post('/tasks/:taskId/protocols', {
    preHandler: [requireRole(...ORG_ROLES), checkSubscription],
  }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    const result = createProtocolSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const { dueDate, ...rest } = result.data
    return reply.status(201).send(
      await createProtocol(taskId, request.user.organizationId!, request.user.sub, {
        ...rest,
        dueDate: dueDate ? new Date(dueDate) : undefined,
      }),
    )
  })

  app.get('/tasks/:taskId/protocols', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    return reply.send(await listProtocolsForTask(taskId, request.user.organizationId!))
  })

  app.get('/protocols/summary', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    return reply.send(await getProtocolsSummary(request.user.organizationId!))
  })

  app.get('/protocols', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    const result = listProtocolsQuerySchema.safeParse(request.query)
    const query = result.success ? result.data : {}
    return reply.send(await listProtocolsForOrg(request.user.organizationId!, {
      status: query.status,
      clientId: query.clientId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    }))
  })

  app.get('/protocols/:id', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getProtocolById(id, request.user.organizationId!))
  })

  app.get('/protocols/:id/receipt', {
    preHandler: [requireRole(...ORG_ROLES)],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const protocol = await getProtocolById(id, request.user.organizationId!)
    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.send(buildProtocolReceiptHtml(protocol))
  })
}
```

- [ ] **Step 2: Registrar em `server.ts`**

Adicionar o import logo após `requestCommentsRoutes` e o `app.register` logo após
`app.register(requestCommentsRoutes)`:

```typescript
import { protocolsRoutes } from '@/modules/protocols/protocols.routes'
```

```typescript
  app.register(requestCommentsRoutes)
  app.register(protocolsRoutes)
```

- [ ] **Step 3: Escrever `protocols.routes.test.ts`**

```typescript
// apps/api/src/modules/protocols/protocols.routes.test.ts
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestBoard,
  createTestColumn, createTestTask, createTestClientUser, getAuthHeader,
} from '@/test/helpers'

async function setupTaskWithAttachment(orgId: string, userId: string) {
  const client = await createTestClient(orgId)
  const board = await createTestBoard(orgId, client.id)
  const column = await createTestColumn(board.id)
  const task = await createTestTask(column.id, userId)
  const attachment = await prisma.attachment.create({
    data: { taskId: task.id, filename: 'guia.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'k', uploadedBy: userId },
  })
  return { task, attachment }
}

describe('POST /tasks/:taskId/protocols', () => {
  it('ORG_MEMBER cria protocolo com anexo existente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, member.id)
    const auth = await getAuthHeader(member.email, 'Test@1234')

    const res = await app.inject({
      method: 'POST', url: `/tasks/${task.id}/protocols`, headers: { authorization: auth },
      payload: { title: 'Guia DARF', attachmentId: attachment.id },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).status).toBe('SENT')
  })

  it('CLIENT não pode criar protocolo (403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, member.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    const authClient = await getAuthHeader(clientUser.email, password)

    const res = await app.inject({
      method: 'POST', url: `/tasks/${task.id}/protocols`, headers: { authorization: authClient },
      payload: { title: 'x', attachmentId: attachment.id },
    })

    expect(res.statusCode).toBe(403)
  })

  it('sem header de autorização recebe 401', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, admin.id)

    const res = await app.inject({
      method: 'POST', url: `/tasks/${task.id}/protocols`,
      payload: { title: 'x', attachmentId: attachment.id },
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('GET /protocols e /protocols/summary', () => {
  it('lista e resume os protocolos da org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, admin.id)
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    await app.inject({
      method: 'POST', url: `/tasks/${task.id}/protocols`, headers: { authorization: auth },
      payload: { title: 'Guia', attachmentId: attachment.id },
    })

    const list = await app.inject({ method: 'GET', url: '/protocols', headers: { authorization: auth } })
    expect(list.statusCode).toBe(200)
    expect(JSON.parse(list.body)).toHaveLength(1)

    const summary = await app.inject({ method: 'GET', url: '/protocols/summary', headers: { authorization: auth } })
    expect(summary.statusCode).toBe(200)
    expect(JSON.parse(summary.body).SENT).toBe(1)
  })
})

describe('GET /protocols/:id/receipt', () => {
  it('devolve HTML com o número do protocolo', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { task, attachment } = await setupTaskWithAttachment(org.id, admin.id)
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    const created = await app.inject({
      method: 'POST', url: `/tasks/${task.id}/protocols`, headers: { authorization: auth },
      payload: { title: 'Guia', attachmentId: attachment.id },
    })
    const protocol = JSON.parse(created.body)

    const res = await app.inject({ method: 'GET', url: `/protocols/${protocol.id}/receipt`, headers: { authorization: auth } })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain(protocol.number)
  })
})
```

- [ ] **Step 4: Rodar os testes e confirmar passagem**

```bash
pnpm --filter api test protocols.routes
```

Esperado: todos passando.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/protocols/protocols.routes.ts apps/api/src/modules/protocols/protocols.routes.test.ts apps/api/src/server.ts
git commit -m "feat(protocols): rotas do lado do escritório + comprovante HTML"
```

---

### Task 4: `trustProxy` + rotas do portal (visualização/download real do cliente)

**Files:**
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/modules/portal/portal.routes.ts`
- Create: `apps/api/src/modules/portal/portal.protocols.routes.test.ts`

**Interfaces:**
- Consumes: `registerView`, `registerDownload`, `listProtocolsForClient` (Task 2);
  `getClientAccessScope` (já usado no arquivo).
- Produces: `request.ip` passa a refletir o IP real do cliente (não o do proxy) — consumido por
  qualquer rota que capture IP, agora e no futuro.

- [ ] **Step 1: Ativar `trustProxy` em `server.ts`**

```typescript
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test', trustProxy: 1 })
```

`trustProxy: 1` confia só no hop imediato (o proxy, ex: Traefik), não na cadeia inteira — mais
estrito que `trustProxy: true`. Decisão de brainstorming: não bloquear esta feature numa
auditoria de isolamento de rede do Dokploy agora (registrado em "Fora do escopo" na spec).

- [ ] **Step 2: Escrever o teste de rota do portal (falhando)**

```typescript
// apps/api/src/modules/portal/portal.protocols.routes.test.ts
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestBoard,
  createTestColumn, createTestTask, createTestDepartment, createTestClientUser,
  grantClientAccess, getAuthHeader,
} from '@/test/helpers'

async function setupProtocol(orgId: string, staffId: string) {
  const client = await createTestClient(orgId)
  const department = await createTestDepartment(orgId)
  const board = await createTestBoard(orgId, client.id)
  const column = await createTestColumn(board.id)
  const task = await createTestTask(column.id, staffId, { departmentId: department.id })
  const attachment = await prisma.attachment.create({
    data: { taskId: task.id, filename: 'guia.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'k', uploadedBy: staffId },
  })
  const auth = await getAuthHeader((await prisma.user.findUniqueOrThrow({ where: { id: staffId } })).email, 'Test@1234')
  const created = await app.inject({
    method: 'POST', url: `/tasks/${task.id}/protocols`, headers: { authorization: auth },
    payload: { title: 'Guia', attachmentId: attachment.id },
  })
  return { client, department, protocol: JSON.parse(created.body) }
}

describe('GET /portal/protocols/:id', () => {
  it('registra VIEWED com o IP real do cliente (via X-Forwarded-For, graças ao trustProxy)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { client, department, protocol } = await setupProtocol(org.id, admin.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const authClient = await getAuthHeader(clientUser.email, password)

    const res = await app.inject({
      method: 'GET',
      url: `/portal/protocols/${protocol.id}`,
      headers: { authorization: authClient, 'x-forwarded-for': '203.0.113.9' },
    })

    expect(res.statusCode).toBe(200)
    const event = await prisma.protocolEvent.findFirst({ where: { protocolId: protocol.id, type: 'VIEWED' } })
    expect(event?.ip).toBe('203.0.113.9')
  })

  it('ClientUser sem acesso à empresa recebe 404', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { protocol } = await setupProtocol(org.id, admin.id)
    const { clientUser, password } = await createTestClientUser(org.id) // sem grantClientAccess
    const authClient = await getAuthHeader(clientUser.email, password)

    const res = await app.inject({
      method: 'GET', url: `/portal/protocols/${protocol.id}`, headers: { authorization: authClient },
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('GET /portal/protocols/:id/download', () => {
  it('registra DOWNLOADED e devolve uma url', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { client, department, protocol } = await setupProtocol(org.id, admin.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const authClient = await getAuthHeader(clientUser.email, password)

    const res = await app.inject({
      method: 'GET', url: `/portal/protocols/${protocol.id}/download`, headers: { authorization: authClient },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).url).toBeTruthy()
    const event = await prisma.protocolEvent.findFirst({ where: { protocolId: protocol.id, type: 'DOWNLOADED' } })
    expect(event).not.toBeNull()
  })
})

describe('GET /portal/protocols', () => {
  it('lista os protocolos da empresa do cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { client, department } = await setupProtocol(org.id, admin.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const authClient = await getAuthHeader(clientUser.email, password)

    const res = await app.inject({
      method: 'GET', url: `/portal/protocols?clientId=${client.id}`, headers: { authorization: authClient },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Rodar e confirmar falha**

```bash
pnpm --filter api test portal.protocols.routes
```

Esperado: FAIL — rotas `/portal/protocols*` não existem.

- [ ] **Step 4: Adicionar as rotas em `portal.routes.ts`**

Adicionar o import logo após `createRequestAttachment`:

```typescript
import { listProtocolsForClient, registerView, registerDownload } from '@/modules/protocols/protocols.service'
```

Adicionar as rotas no final do arquivo, antes do `}` de fechamento de `portalRoutes`:

```typescript
  app.get('/protocols', async (request, reply) => {
    const { clientId, status, search } = request.query as { clientId?: string; status?: string; search?: string }
    if (!clientId) throw new AppError(400, 'clientId é obrigatório')
    const scope = await getClientAccessScope(request.user.sub)
    if (!scope.clientIds.includes(clientId)) throw new AppError(404, 'Empresa não encontrada')
    return reply.send(
      await listProtocolsForClient(request.user.organizationId!, clientId, {
        status: status as never,
        search,
      }),
    )
  })

  app.get('/protocols/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(
      await registerView(id, request.user.organizationId!, request.user.sub, request.ip, request.headers['user-agent'] as string | undefined),
    )
  })

  app.get('/protocols/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string }
    const url = await registerDownload(id, request.user.organizationId!, request.user.sub, request.ip, request.headers['user-agent'] as string | undefined)
    return reply.send({ url })
  })
```

- [ ] **Step 5: Rodar os testes e confirmar passagem**

```bash
pnpm --filter api test portal.protocols.routes
```

Esperado: todos passando — inclusive o que verifica `trustProxy` capturando o IP real via
`X-Forwarded-For`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/modules/portal/portal.routes.ts apps/api/src/modules/portal/portal.protocols.routes.test.ts
git commit -m "feat(protocols): trustProxy + rotas do portal (visualização e download registram evento com IP real)"
```

---

### Task 5: Nivelamento do evento `PROTOCOL_CREATED` (backend)

**Files:**
- Modify: `apps/api/src/lib/template.ts`
- Modify: `apps/api/src/lib/default-templates.ts`
- Modify: `apps/api/src/workers/notification.worker.ts`
- Modify: `apps/api/src/modules/notifications/notifications.schema.ts`
- Modify: `apps/api/src/modules/notifications/notifications.service.ts`

**Interfaces:**
- Consumes: `NotificationEvent.PROTOCOL_CREATED`, `NotificationConfig.protocolCreated` (Task 1).

- [ ] **Step 1: Adicionar `protocolTitle` a `TemplateVars` em `template.ts`**

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
  documentName?: string
  templateTitle?: string
  errorMessage?: string
  taskCount?: string
  criticalCount?: string
  taskListText?: string
  protocolTitle?: string   // novo — título do protocolo (PROTOCOL_CREATED)
}
```

E em `PREVIEW_VARS`, adicionar `protocolTitle: 'Guia de DARF — Outubro/2026',`.

- [ ] **Step 2: Adicionar o template default em `default-templates.ts`**

Adicionar ao final do objeto `DEFAULT_TEMPLATES`, depois de `REQUEST_CANCELLED`:

```typescript
  PROTOCOL_CREATED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Você tem um novo protocolo: *{{protocolTitle}}*.\n\nAcesse o portal pra ver os detalhes: {{portalUrl}}' },
    EMAIL: { subject: 'Novo protocolo — {{protocolTitle}}', body: 'Olá, {{clientName}}!\n\nVocê tem um novo protocolo: *{{protocolTitle}}*.\n\nAcesse o portal pra ver os detalhes: {{portalUrl}}' },
  },
```

- [ ] **Step 3: Adicionar em `EVENT_FLAG_MAP` em `notification.worker.ts`**

```typescript
  REQUEST_CANCELLED: 'requestCancelled',
  PROTOCOL_CREATED: 'protocolCreated',
}
```

- [ ] **Step 4: Adicionar em `updateConfigSchema` em `notifications.schema.ts`**

```typescript
  requestCancelled: z.boolean().optional(),
  protocolCreated: z.boolean().optional(),
  protocolWarningDays: z.number().int().min(0).max(90).optional(),
  taskBlocked: z.boolean().optional(),
```

- [ ] **Step 5: Adicionar ao `select` de `getConfig` em `notifications.service.ts`**

```typescript
      requestCancelled: true,
      protocolCreated: true,
      protocolWarningDays: true,
      taskBlocked: true,
```

- [ ] **Step 6: Verificar o build e rodar os testes de notificações**

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter api test notifications
```

Esperado: ambos sem erro — o erro de exaustividade da Task 1 some aqui.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/template.ts apps/api/src/lib/default-templates.ts apps/api/src/workers/notification.worker.ts apps/api/src/modules/notifications/notifications.schema.ts apps/api/src/modules/notifications/notifications.service.ts
git commit -m "feat(notifications): nivela PROTOCOL_CREATED"
```

---

### Task 6: Digest diário — estende `sla-digest.cron.ts` com protocolos em risco

**Files:**
- Modify: `apps/api/src/workers/sla-digest.cron.ts`
- Modify: `apps/api/src/workers/sla-digest.cron.test.ts`

**Interfaces:**
- Consumes: `expireOverdueProtocols` (Task 2) — chamado no início de `runSlaDigestForOrg`, antes
  de montar os `DigestEntry`, pra que protocolos vencidos já apareçam como `EXPIRED`, não `SENT`,
  na mesma rodada.

- [ ] **Step 1: Escrever o teste de digest com protocolo (falhando)**

Adicionar ao final de `sla-digest.cron.test.ts`:

```typescript
describe('runSlaDigest — protocolos', () => {
  it('inclui protocolo sem visualização dentro da janela de aviso no digest do assignee da task', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const assignee = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, assignee.id)
    await prisma.task.update({ where: { id: task.id }, data: { assigneeId: assignee.id } })
    const attachment = await prisma.attachment.create({
      data: { taskId: task.id, filename: 'guia.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'k', uploadedBy: assignee.id },
    })
    const dueDate = new Date()
    dueDate.setUTCDate(dueDate.getUTCDate() + 1)
    await createProtocol(task.id, org.id, assignee.id, { title: 'Guia DARF', attachmentId: attachment.id, dueDate })

    await runSlaDigest(new Date())

    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'SLA_DIGEST',
        userId: assignee.id,
        metadata: expect.objectContaining({ taskListText: expect.stringContaining('Guia DARF') }),
      }),
    )
  })

  it('marca protocolo vencido como EXPIRED e inclui no digest com a tag de vencido', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, admin.id)
    const attachment = await prisma.attachment.create({
      data: { taskId: task.id, filename: 'guia.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'k', uploadedBy: admin.id },
    })
    const past = new Date(Date.now() - 86400000)
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'Guia vencida', attachmentId: attachment.id, dueDate: past })

    await runSlaDigest(new Date())

    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })).status).toBe('EXPIRED')
    expect(enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ taskListText: expect.stringContaining('vencido sem visualização') }),
      }),
    )
  })

  it('não inclui protocolo já visualizado no digest', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const department = await createTestDepartment(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, admin.id, { departmentId: department.id })
    const { clientUser } = await createTestClientUser(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const attachment = await prisma.attachment.create({
      data: { taskId: task.id, filename: 'guia.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'k', uploadedBy: admin.id },
    })
    const dueDate = new Date()
    dueDate.setUTCDate(dueDate.getUTCDate() + 1)
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'Já visto', attachmentId: attachment.id, dueDate })
    await registerView(protocol.id, org.id, clientUser.id, '1.2.3.4', 'ua')

    await runSlaDigest(new Date())

    expect(enqueueNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ taskListText: expect.stringContaining('Já visto') }) }),
    )
  })

  it('expira protocolo vencido mesmo com slaDigestEnabled desligado — expiração não é uma função do email', async () => {
    const { enqueueNotification } = await import('@/lib/queue')
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    await prisma.notificationConfig.upsert({
      where: { organizationId: org.id },
      create: { organizationId: org.id, slaDigestEnabled: false },
      update: { slaDigestEnabled: false },
    })
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const column = await createTestColumn(board.id)
    const task = await createTestTask(column.id, admin.id)
    const attachment = await prisma.attachment.create({
      data: { taskId: task.id, filename: 'guia.pdf', mimeType: 'application/pdf', size: 10, storageKey: 'k', uploadedBy: admin.id },
    })
    const past = new Date(Date.now() - 86400000)
    const protocol = await createProtocol(task.id, org.id, admin.id, { title: 'x', attachmentId: attachment.id, dueDate: past })

    await runSlaDigest(new Date())

    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: protocol.id } })).status).toBe('EXPIRED')
    expect(enqueueNotification).not.toHaveBeenCalled() // digest desligado, mas expiração aconteceu
  })
})
```

Adicionar os imports necessários no topo do arquivo de teste:

```typescript
import { createTestDepartment, createTestClientUser, grantClientAccess } from '@/test/helpers'
import { createProtocol, registerView } from '@/modules/protocols/protocols.service'
```

(ajustar o import existente de `@/test/helpers` pra incluir os 3 novos nomes junto dos demais,
em vez de um import separado)

- [ ] **Step 2: Rodar e confirmar falha**

```bash
pnpm --filter api test sla-digest.cron -t "protocolos"
```

Esperado: FAIL — `taskListText` não contém "Guia DARF"/"vencido sem visualização" ainda.

- [ ] **Step 3: Substituir `sla-digest.cron.ts` inteiro**

```typescript
import { Queue, Worker } from 'bullmq'
import { bullmqRedis } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { enqueueNotification } from '@/lib/queue'
import { computeSlaLevel, type SlaLevel } from '@/lib/sla'
import { expireOverdueProtocols } from '@/modules/protocols/protocols.service'

interface DigestEntry {
  kind: 'task' | 'protocol'
  title: string
  clientName: string
  level: SlaLevel | 'EXPIRED'
  dateLabel: string
}

const MAX_DIGEST_LINES = 20
const DIGEST_TIMEZONE = 'America/Sao_Paulo'

function formatTaskLine(entry: DigestEntry): string {
  const tag = entry.level === 'DUE_CRITICAL' ? 'crítico' : entry.level === 'EXPIRED' ? 'vencido sem visualização' : 'atenção'
  const prefix = entry.kind === 'protocol' ? '[protocolo] ' : ''
  return `- ${prefix}${entry.title} (${entry.clientName}) — ${entry.dateLabel} [${tag}]`
}

// Vencido sem visualização primeiro, depois crítico, depois atenção — o que já falhou precisa
// de atenção imediata (ligar pro cliente), o resto ainda dá tempo de agir.
function formatTaskListText(entries: DigestEntry[]): string {
  const rank = (level: DigestEntry['level']) => (level === 'EXPIRED' ? 0 : level === 'DUE_CRITICAL' ? 1 : 2)
  const sorted = [...entries].sort((a, b) => rank(a.level) - rank(b.level))
  const visible = sorted.slice(0, MAX_DIGEST_LINES)
  const lines = visible.map(formatTaskLine)
  const remaining = sorted.length - visible.length
  if (remaining > 0) lines.push(`…e mais ${remaining}. Acesse o painel para ver todas.`)
  return lines.join('\n')
}

export async function runSlaDigest(now: Date = new Date()): Promise<void> {
  const orgs = await prisma.organization.findMany({
    where: { isActive: true, subscriptionStatus: { notIn: ['SUSPENDED', 'CANCELLED'] } },
    include: { notificationConfig: true },
  })

  for (const org of orgs) {
    try {
      await runSlaDigestForOrg(org, now)
    } catch (err) {
      // Uma organização com erro (ex: dado inconsistente) nunca pode impedir o digest das demais —
      // cada execução diária é independente por organização.
      console.error(`[sla-digest] falhou para a organização ${org.id}:`, err)
    }
  }
}

async function runSlaDigestForOrg(
  org: {
    id: string
    notificationConfig: {
      slaDigestEnabled: boolean
      slaTargetWarningDays: number
      slaDueCriticalDays: number
      protocolWarningDays: number
    } | null
  },
  now: Date,
): Promise<void> {
  // Roda incondicionalmente, ANTES de qualquer early-return — expirar um protocolo vencido é uma
  // transição de estado de negócio (o Dashboard e o comprovante do cliente dependem dela), não
  // uma função do email de resumo. Desligar o digest (`slaDigestEnabled: false`) não pode ter o
  // efeito colateral de travar a expiração de protocolo pra sempre.
  await expireOverdueProtocols(org.id, now)

  if (org.notificationConfig?.slaDigestEnabled === false) return

  // Org sem linha em NotificationConfig (nunca visitou a tela de Configurações) provisiona aqui,
  // com os defaults do schema — sem isso, o enqueue abaixo funcionaria mas o worker de envio
  // descartaria o job silenciosamente (`processNotificationJob` retorna se `!config`), quebrando
  // o "digest ligado por padrão" pra qualquer org nova.
  const notificationConfig = org.notificationConfig ?? await prisma.notificationConfig.create({
    data: { organizationId: org.id },
  })

  const config = {
    slaTargetWarningDays: notificationConfig.slaTargetWarningDays,
    slaDueCriticalDays: notificationConfig.slaDueCriticalDays,
  }

  const tasks = await prisma.task.findMany({
    where: {
      status: { notIn: ['DONE', 'DISREGARDED'] },
      column: { board: { organizationId: org.id, isActive: true } },
      OR: [{ targetDate: { not: null } }, { dueDate: { not: null } }],
    },
    select: {
      id: true,
      title: true,
      targetDate: true,
      dueDate: true,
      assignee: { select: { id: true, isActive: true } },
      column: { select: { board: { select: { client: { select: { name: true } } } } } },
    },
  })

  const protocolThreshold = new Date(now)
  protocolThreshold.setUTCDate(protocolThreshold.getUTCDate() + notificationConfig.protocolWarningDays)

  // status IN ('SENT','EXPIRED') de propósito — um protocolo já VIEWED/DOWNLOADED não é mais
  // "sem visualização", sai do digest mesmo que o vencimento ainda esteja próximo.
  const protocols = await prisma.protocol.findMany({
    where: {
      organizationId: org.id,
      status: { in: ['SENT', 'EXPIRED'] },
      dueDate: { not: null, lte: protocolThreshold },
    },
    select: {
      id: true, title: true, dueDate: true, status: true,
      client: { select: { name: true } },
      task: { select: { assignee: { select: { id: true, isActive: true } } } },
    },
  })

  const admins = await prisma.user.findMany({
    where: { organizationId: org.id, role: { in: ['ORG_ADMIN', 'ORG_MANAGER'] }, isActive: true },
    select: { id: true },
  })

  const byUserId = new Map<string, DigestEntry[]>()

  for (const task of tasks) {
    const level = computeSlaLevel(task.targetDate, task.dueDate, now, config)
    if (level === 'NONE') continue

    const entry: DigestEntry = {
      kind: 'task',
      title: task.title,
      clientName: task.column.board.client.name,
      level,
      dateLabel: level === 'DUE_CRITICAL'
        ? `vence ${task.dueDate!.toLocaleDateString('pt-BR', { timeZone: DIGEST_TIMEZONE })}`
        : `meta ${task.targetDate!.toLocaleDateString('pt-BR', { timeZone: DIGEST_TIMEZONE })}`,
    }

    // Assignee desativado (ex-funcionário) nunca é destinatário — mesma regra de "sem assignee".
    const recipientIds = task.assignee?.isActive ? [task.assignee.id] : admins.map((a) => a.id)
    for (const userId of recipientIds) {
      const bucket = byUserId.get(userId) ?? []
      bucket.push(entry)
      byUserId.set(userId, bucket)
    }
  }

  for (const protocol of protocols) {
    const entry: DigestEntry = {
      kind: 'protocol',
      title: protocol.title,
      clientName: protocol.client.name,
      level: protocol.status === 'EXPIRED' ? 'EXPIRED' : 'TARGET_WARNING',
      dateLabel: `vence ${protocol.dueDate!.toLocaleDateString('pt-BR', { timeZone: DIGEST_TIMEZONE })}`,
    }
    const recipientIds = protocol.task.assignee?.isActive ? [protocol.task.assignee.id] : admins.map((a) => a.id)
    for (const userId of recipientIds) {
      const bucket = byUserId.get(userId) ?? []
      bucket.push(entry)
      byUserId.set(userId, bucket)
    }
  }

  for (const [userId, entries] of byUserId) {
    const criticalCount = entries.filter((e) => e.level === 'DUE_CRITICAL' || e.level === 'EXPIRED').length
    await enqueueNotification({
      event: 'SLA_DIGEST',
      organizationId: org.id,
      recipientType: 'USER',
      userId,
      metadata: {
        taskCount: String(entries.length),
        criticalCount: String(criticalCount),
        taskListText: formatTaskListText(entries),
      },
    })
  }
}

export async function startSlaDigestCronWorker() {
  const cronQueue = new Queue('sla-digest-cron', { connection: bullmqRedis })

  await cronQueue.add('check', {}, {
    repeat: { pattern: '0 8 * * *', tz: DIGEST_TIMEZONE },
    jobId: 'sla-digest-check',
  })

  return new Worker('sla-digest-cron', async () => {
    await runSlaDigest()
  }, { connection: bullmqRedis })
}
```

Nota: `criticalCount` passou a somar `DUE_CRITICAL` **e** `EXPIRED` juntos — ambos representam
"já é tarde, precisa de ação imediata" do ponto de vista de quem lê o resumo; o `WHATSAPP`/
`EMAIL` do `SLA_DIGEST` já usa esse número só pra destacar a urgência no título, não distingue
tipo.

- [ ] **Step 4: Rodar os testes e confirmar passagem**

```bash
pnpm --filter api test sla-digest.cron
```

Esperado: todos passando, incluindo os 8 testes pré-existentes (nenhuma regressão).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workers/sla-digest.cron.ts apps/api/src/workers/sla-digest.cron.test.ts
git commit -m "feat(protocols): digest diário estendido com protocolos sem visualização e expiração automática"
```

---

### Task 7: UI de configuração de notificações (frontend)

**Files:**
- Modify: `apps/web/src/pages/app/settings/Notifications.tsx`
- Modify: `apps/web/src/pages/app/settings/Templates.tsx`

**Interfaces:**
- Consumes: `protocolCreated`, `protocolWarningDays` (Task 5, via `GET /notifications/config`).

- [ ] **Step 1: Atualizar `Notifications.tsx`**

Na interface `Config`, adicionar após `requestCancelled`:

```typescript
  requestCancelled?: boolean
  protocolCreated?: boolean
  protocolWarningDays?: number
```

No `EVENT_LABEL`, adicionar:

```typescript
  REQUEST_CANCELLED: 'Solicitação cancelada (pós-aprovação)',
  PROTOCOL_CREATED: 'Protocolo criado',
  SLA_DIGEST: 'Resumo diário de prazos',
```

Adicionar uma seção nova "Eventos — Protocolos" logo depois da seção "Eventos — Solicitações":

```typescript
          <Section title="Eventos — Protocolos">
            <SwitchRow
              label="Protocolo criado"
              description="Notifica o cliente quando um protocolo formal é criado"
              checked={form.protocolCreated ?? false}
              onChange={(v) => setForm({ ...form, protocolCreated: v })}
            />
          </Section>
```

Dentro da seção "Alertas de SLA" (`<Section title="Alertas de SLA">`), adicionar um terceiro
campo numérico ao `grid grid-cols-2 gap-4` existente (vira 2x2, com o 4º espaço vazio — ou
ajustar pra `grid-cols-3` se preferir simetria; manter `grid-cols-2` é suficiente):

```typescript
              <div className="space-y-1">
                <Label htmlFor="protocol-warning-days">Alerta de protocolo sem visualização (dias antes do vencimento)</Label>
                <Input
                  id="protocol-warning-days"
                  type="number"
                  min={0}
                  max={90}
                  value={form.protocolWarningDays ?? 3}
                  onChange={(e) => setForm({ ...form, protocolWarningDays: Number(e.target.value) })}
                />
              </div>
```

- [ ] **Step 2: Atualizar `Templates.tsx`**

```typescript
const EVENTS = [
  'TASK_CREATED', 'TASK_MOVED', 'TASK_COMPLETED', 'TASK_COMMENT_ADDED', 'TASK_BLOCKED',
  'DOCUMENT_REJECTED', 'REQUEST_CREATED', 'REQUEST_APPROVED', 'REQUEST_REJECTED',
  'REQUEST_NEEDS_INFO', 'REQUEST_COMMENT_ADDED', 'REQUEST_CANCELLED', 'PROTOCOL_CREATED',
  'RECURRING_GENERATION_FAILED', 'SLA_DIGEST',
] as const
```

```typescript
  REQUEST_CANCELLED: 'Solicitação cancelada (pós-aprovação)',
  PROTOCOL_CREATED: 'Protocolo criado',
  RECURRING_GENERATION_FAILED: 'Falha na geração de tarefa recorrente',
```

- [ ] **Step 3: Verificar tipos**

```bash
pnpm --filter web exec tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/app/settings/Notifications.tsx apps/web/src/pages/app/settings/Templates.tsx
git commit -m "feat(notifications): expõe PROTOCOL_CREATED e protocolWarningDays na UI de configuração"
```

---

### Task 8: Tipos do frontend (`Protocol`, `ProtocolEvent`, `ProtocolSummary`)

**Files:**
- Modify: `apps/web/src/types/index.ts`

**Interfaces:**
- Produces: `Protocol`, `ProtocolEvent`, `ProtocolSummary` — consumidos pelas Tasks 9/10/11.

- [ ] **Step 1: Adicionar as interfaces, logo após `ClientRequest`**

```typescript
export interface ProtocolEvent {
  id: string
  type: 'SENT' | 'VIEWED' | 'DOWNLOADED' | 'EXPIRED'
  actorType: string
  actorName: string | null
  actorEmail: string | null
  ip: string | null
  userAgent: string | null
  createdAt: string
}

export interface Protocol {
  id: string
  number: string
  title: string
  content: string | null
  dueDate: string | null
  status: 'SENT' | 'VIEWED' | 'DOWNLOADED' | 'EXPIRED'
  attachmentId: string | null
  taskId: string
  clientId: string
  createdAt: string
  client?: { id: string; name: string }
  attachment?: { filename: string } | null
  events?: ProtocolEvent[]
  boardId?: string   // só presente em GET /protocols (listagem da org) — ver protocols.service.ts
}

export interface ProtocolSummary {
  SENT: number
  VIEWED: number
  DOWNLOADED: number
  EXPIRED: number
}
```

- [ ] **Step 2: Verificar tipos**

```bash
pnpm --filter web exec tsc --noEmit
```

Esperado: sem erros (nada consome esses tipos ainda).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/types/index.ts
git commit -m "feat(types): adiciona Protocol, ProtocolEvent e ProtocolSummary"
```

---

### Task 9: `TaskDrawer` — aba "Protocolos"

**Files:**
- Modify: `apps/web/src/components/shared/TaskDrawer.tsx`

**Interfaces:**
- Consumes: `POST /tasks/:id/protocols`, `GET /tasks/:id/protocols` (Task 3); `Attachment[]` (já
  buscado pela aba "Anexos", reaproveitado aqui); `Protocol` (Task 8).

- [ ] **Step 1: Editar `TaskDrawer.tsx`**

Adicionar o import de `Stamp` ao lado dos demais ícones de `lucide-react` (linha 3):

```typescript
import { X, Paperclip, MessageSquare, Clock, Trash2, FileCheck, Stamp } from 'lucide-react'
```

Adicionar `Protocol` ao import de tipos (linha 8):

```typescript
import type { Task, Attachment, TaskHistory, DrawerRole, TaskDocumentRequirement, TaskDeliverable, Protocol } from '@/types'
```

Ampliar o tipo `Tab` (linha ~70):

```typescript
type Tab = 'comments' | 'documents' | 'attachments' | 'history' | 'protocols'
```

Adicionar ao array `TABS` (linha ~231), só visível pra quem não é cliente:

```typescript
  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'comments', label: 'Comentários', icon: <MessageSquare size={14} /> },
    { id: 'documents', label: 'Documentos', icon: <FileCheck size={14} /> },
    { id: 'attachments', label: 'Anexos', icon: <Paperclip size={14} /> },
    ...(canEdit ? [{ id: 'protocols' as Tab, label: 'Protocolos', icon: <Stamp size={14} /> }] : []),
    { id: 'history', label: 'Histórico', icon: <Clock size={14} /> },
  ]
```

Adicionar o estado e as queries/mutations, logo após a query de `attachments` (linha ~133):

```typescript
  const { data: protocols = [] } = useQuery<Protocol[]>({
    queryKey: ['protocols', task.id],
    queryFn: () => api.get(`/tasks/${task.id}/protocols`).then((r) => r.data),
    enabled: tab === 'protocols',
  })

  const [creatingProtocol, setCreatingProtocol] = useState(false)
  const [protocolMode, setProtocolMode] = useState<'attachment' | 'text'>('attachment')
  const [protocolTitle, setProtocolTitle] = useState('')
  const [protocolDueDate, setProtocolDueDate] = useState('')
  const [protocolAttachmentId, setProtocolAttachmentId] = useState('')
  const [protocolContent, setProtocolContent] = useState('')

  const createProtocolMutation = useMutation({
    mutationFn: () => api.post(`/tasks/${task.id}/protocols`, {
      title: protocolTitle,
      dueDate: protocolDueDate ? new Date(protocolDueDate).toISOString() : undefined,
      attachmentId: protocolMode === 'attachment' ? protocolAttachmentId : undefined,
      content: protocolMode === 'text' ? protocolContent : undefined,
    }),
    onSuccess: () => {
      toast.success('Protocolo criado')
      queryClient.invalidateQueries({ queryKey: ['protocols', task.id] })
      setCreatingProtocol(false)
      setProtocolTitle('')
      setProtocolDueDate('')
      setProtocolAttachmentId('')
      setProtocolContent('')
    },
    onError: () => toast.error('Erro ao criar protocolo'),
  })
```

`Attachment` e `useState`/`useQuery`/`useMutation` já estão importados no topo do arquivo — não
precisa de import novo pra isso.

Adicionar o conteúdo da aba, logo após o bloco `{tab === 'attachments' && (...)}` (linha ~659,
antes do bloco `{tab === 'history' && (...)}`):

```typescript
          {tab === 'protocols' && (
            <div className="space-y-4">
              <Button size="sm" onClick={() => setCreatingProtocol(true)} className="gap-2">
                <Stamp size={14} />
                Criar protocolo
              </Button>

              {protocols.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum protocolo criado pra esta tarefa.</p>
              ) : (
                <div className="space-y-2">
                  {protocols.map((p) => (
                    <div key={p.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-foreground">{p.number} — {p.title}</p>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-bg text-muted-foreground">{p.status}</span>
                      </div>
                      {p.dueDate && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Vencimento: {new Date(p.dueDate).toLocaleDateString('pt-BR')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {creatingProtocol && (
                <div className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex rounded-md border border-border overflow-hidden w-fit">
                    <button
                      type="button"
                      onClick={() => setProtocolMode('attachment')}
                      className={cn('px-3 py-1.5 text-sm font-medium', protocolMode === 'attachment' ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground')}
                    >
                      Anexo existente
                    </button>
                    <button
                      type="button"
                      onClick={() => setProtocolMode('text')}
                      className={cn('px-3 py-1.5 text-sm font-medium', protocolMode === 'text' ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground')}
                    >
                      Só texto
                    </button>
                  </div>

                  <input
                    placeholder="Título do protocolo"
                    value={protocolTitle}
                    onChange={(e) => setProtocolTitle(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm"
                  />

                  <input
                    type="date"
                    value={protocolDueDate}
                    onChange={(e) => setProtocolDueDate(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm"
                  />

                  {protocolMode === 'attachment' ? (
                    <select
                      value={protocolAttachmentId}
                      onChange={(e) => setProtocolAttachmentId(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm"
                    >
                      <option value="">Selecione um anexo já enviado nesta tarefa</option>
                      {attachments.filter((a) => !a.deletedAt).map((a) => (
                        <option key={a.id} value={a.id}>{a.filename}</option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      rows={3}
                      placeholder="Texto do aviso formal"
                      value={protocolContent}
                      onChange={(e) => setProtocolContent(e.target.value)}
                      className="flex w-full rounded-md border border-border bg-surface text-foreground px-3 py-2 text-sm resize-none"
                    />
                  )}

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setCreatingProtocol(false)}>Cancelar</Button>
                    <Button
                      onClick={() => createProtocolMutation.mutate()}
                      disabled={
                        createProtocolMutation.isPending || !protocolTitle.trim() ||
                        (protocolMode === 'attachment' ? !protocolAttachmentId : !protocolContent.trim())
                      }
                      className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
                    >
                      {createProtocolMutation.isPending ? 'Criando...' : 'Criar'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
```

Nota: a aba só aparece pra `canEdit` (staff), e usa a MESMA query `['attachments', task.id]` já
buscada pela aba "Anexos" — mas essa query só roda quando `enabled: tab === 'attachments'`. Pra
funcionar também na aba "Protocolos" (escolher um anexo existente sem precisar passar pela aba
Anexos primeiro), ajustar o `enabled` da query de `attachments` (linha ~133) pra:

```typescript
  const { data: attachments = [] } = useQuery<Attachment[]>({
    queryKey: ['attachments', task.id],
    queryFn: () => api.get(`/tasks/${task.id}/attachments`).then((r) => r.data),
    enabled: tab === 'attachments' || tab === 'protocols',
  })
```

- [ ] **Step 2: Verificar tipos**

```bash
pnpm --filter web exec tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 3: Testar no dev server**

```bash
pnpm --filter web dev
```

Validar manualmente: aba "Protocolos" só aparece pra staff; criar com anexo existente e com texto
livre funcionam; protocolo criado aparece na lista com status `SENT`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/shared/TaskDrawer.tsx
git commit -m "feat(protocols): aba Protocolos no TaskDrawer (criar com anexo existente ou texto)"
```

---

### Task 10: Portal — tela "Meus Protocolos"

**Files:**
- Create: `apps/web/src/pages/portal/Protocols.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/pages/portal/Layout.tsx`

**Interfaces:**
- Consumes: `GET /portal/protocols`, `GET /portal/protocols/:id`, `GET /portal/protocols/:id/download` (Task 4); `Protocol` (Task 8); `usePortalClient()` (já existente, usado em
  `Requests.tsx`).

- [ ] **Step 1: Criar `apps/web/src/pages/portal/Protocols.tsx`**

```typescript
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Inbox, Download, Search } from 'lucide-react'
import type { Protocol } from '@/types'
import { toast } from 'sonner'
import { usePortalClient } from './Layout'

const STATUS_LABEL: Record<Protocol['status'], string> = {
  SENT: 'Enviado',
  VIEWED: 'Visualizado',
  DOWNLOADED: 'Baixado',
  EXPIRED: 'Vencido',
}

const STATUS_STYLE: Record<Protocol['status'], string> = {
  SENT: 'bg-amber-100 text-amber-700',
  VIEWED: 'bg-blue-100 text-blue-700',
  DOWNLOADED: 'bg-green-100 text-green-700',
  EXPIRED: 'bg-red-100 text-red-700',
}

export default function PortalProtocols() {
  const { clientId } = usePortalClient()
  const [statusFilter, setStatusFilter] = useState<Protocol['status'] | ''>('')
  const [search, setSearch] = useState('')
  const [openedId, setOpenedId] = useState<string | null>(null)

  const { data: protocols = [], isLoading } = useQuery<Protocol[]>({
    queryKey: ['portal-protocols', clientId, statusFilter, search],
    queryFn: () => api.get('/portal/protocols', {
      params: { clientId, status: statusFilter || undefined, search: search || undefined },
    }).then((r) => r.data),
    enabled: !!clientId,
  })

  const viewMutation = useMutation({
    mutationFn: (id: string) => api.get(`/portal/protocols/${id}`).then((r) => r.data),
    onSuccess: (_, id) => setOpenedId(id),
    onError: () => toast.error('Erro ao abrir protocolo'),
  })

  const downloadMutation = useMutation({
    mutationFn: (id: string) => api.get<{ url: string }>(`/portal/protocols/${id}/download`).then((r) => r.data),
    onSuccess: (data) => window.open(data.url, '_blank'),
    onError: () => toast.error('Erro ao baixar arquivo'),
  })

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-lg md:text-xl font-bold text-foreground">Meus Protocolos</h1>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 border-border focus:ring-accent"
          />
        </div>
        <div className="flex rounded-md border border-border overflow-hidden">
          {(['', 'SENT', 'VIEWED', 'DOWNLOADED', 'EXPIRED'] as const).map((s) => (
            <button
              key={s || 'all'}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium transition-colors',
                statusFilter === s ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground hover:bg-neutral-bg',
              )}
            >
              {s ? STATUS_LABEL[s] : 'Todos'}
            </button>
          ))}
        </div>
      </div>

      {protocols.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <Inbox size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhum protocolo ainda</p>
        </div>
      ) : (
        <div className="space-y-2">
          {protocols.map((p) => (
            <div key={p.id} className="bg-surface rounded-lg border border-border px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{p.number}</p>
                  <p className="text-sm font-medium text-foreground">{p.title}</p>
                  {p.dueDate && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Vencimento: {new Date(p.dueDate).toLocaleDateString('pt-BR')}
                    </p>
                  )}
                </div>
                <span className={cn('text-xs px-2 py-0.5 rounded-full flex-shrink-0', STATUS_STYLE[p.status])}>
                  {STATUS_LABEL[p.status]}
                </span>
              </div>

              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => viewMutation.mutate(p.id)}
                  className="text-xs text-[#185FA5] hover:underline"
                >
                  {openedId === p.id ? 'Visualizado' : 'Abrir'}
                </button>
                {p.attachmentId && (
                  <button
                    type="button"
                    onClick={() => downloadMutation.mutate(p.id)}
                    className="text-xs text-[#185FA5] hover:underline inline-flex items-center gap-1"
                  >
                    <Download size={12} />
                    Baixar
                  </button>
                )}
              </div>

              {openedId === p.id && p.content && (
                <p className="text-sm text-foreground mt-2 pt-2 border-t border-border">{p.content}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Registrar a rota em `router.tsx`**

Adicionar o import lazy logo após `PortalRequests`:

```typescript
const PortalProtocols = lazy(() => import('@/pages/portal/Protocols'))
```

Adicionar a rota logo após `{ path: 'requests', element: <PortalRequests /> }`:

```typescript
      { path: 'requests', element: <PortalRequests /> },
      { path: 'protocols', element: <PortalProtocols /> },
```

- [ ] **Step 3: Adicionar o item de navegação em `Layout.tsx`**

Adicionar `Stamp` ao import de `lucide-react` (linha 7):

```typescript
import { LayoutGrid, User, LogOut, Inbox, ClipboardList, Stamp } from 'lucide-react'
```

Adicionar ao array `tabs` (linha ~10), antes de "Perfil":

```typescript
const tabs = [
  { to: '/portal/board', icon: LayoutGrid, label: 'Processos' },
  { to: '/portal/tasks', icon: ClipboardList, label: 'Tarefas' },
  { to: '/portal/requests', icon: Inbox, label: 'Solicitações' },
  { to: '/portal/protocols', icon: Stamp, label: 'Protocolos' },
  { to: '/portal/profile', icon: User, label: 'Perfil' },
] as const
```

- [ ] **Step 4: Verificar tipos e testar no dev server**

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web dev
```

Validar manualmente: nav item "Protocolos" aparece no portal; filtro de status e busca
funcionam; abrir marca como visualizado (recarregar a página do admin confirma o evento `VIEWED`
gravado); baixar funciona quando há anexo.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/portal/Protocols.tsx apps/web/src/router.tsx apps/web/src/pages/portal/Layout.tsx
git commit -m "feat(protocols): tela Meus Protocolos no portal do cliente"
```

---

### Task 11: Dashboard — aba "Protocolos"

**Files:**
- Modify: `apps/web/src/pages/app/DashboardMetrics.tsx`

**Interfaces:**
- Consumes: `GET /protocols`, `GET /protocols/summary` (Task 3); `Protocol`, `ProtocolSummary`
  (Task 8).

- [ ] **Step 1: Editar `DashboardMetrics.tsx`**

Ampliar o tipo da aba (linha ~406):

```typescript
  const [tab, setTab] = useState<'overview' | 'productivity' | 'protocols'>('overview')
```

Ampliar o array de abas (linha ~418) e o label (linha ~428):

```typescript
        {(['overview', 'productivity', 'protocols'] as const).map((t) => (
```

```typescript
            {t === 'overview' ? 'Visão geral' : t === 'productivity' ? 'Produtividade' : 'Protocolos'}
```

Adicionar o render da aba nova, logo após `{tab === 'productivity' && <ProductivityTab />}`:

```typescript
      {tab === 'protocols' && <ProtocolsTab />}
```

Adicionar a função `ProtocolsTab`, no mesmo arquivo, logo após a função `ProductivityTab`
existente:

```typescript
const PROTOCOL_STATUS_LABEL: Record<Protocol['status'], string> = {
  SENT: 'Enviados',
  VIEWED: 'Visualizados',
  DOWNLOADED: 'Baixados',
  EXPIRED: 'Vencidos',
}

function ProtocolsTab() {
  const [statusFilter, setStatusFilter] = useState<Protocol['status'] | ''>('')

  const { data: summary } = useQuery<ProtocolSummary>({
    queryKey: ['protocols-summary'],
    queryFn: () => api.get('/protocols/summary').then((r) => r.data),
  })

  const { data: protocols = [] } = useQuery<Protocol[]>({
    queryKey: ['protocols', statusFilter],
    queryFn: () => api.get('/protocols', { params: { status: statusFilter || undefined } }).then((r) => r.data),
  })

  const sorted = useMemo(() => {
    return [...protocols].sort((a, b) => {
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    })
  }, [protocols])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(['SENT', 'VIEWED', 'DOWNLOADED', 'EXPIRED'] as const).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setStatusFilter(statusFilter === status ? '' : status)}
            className={cn(
              'rounded-xl border p-4 text-left transition-colors',
              statusFilter === status ? 'border-[#185FA5] bg-[#185FA5]/5' : 'border-border bg-surface',
            )}
          >
            <p className="text-2xl font-bold text-foreground">{summary?.[status] ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-1">{PROTOCOL_STATUS_LABEL[status]}</p>
          </button>
        ))}
      </div>

      <div className="bg-surface rounded-xl border border-border shadow-sm overflow-hidden">
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">Nenhum protocolo encontrado.</p>
        ) : (
          sorted.map((p) => (
            <Link
              key={p.id}
              to={`/app/board/${p.boardId}`}
              className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border last:border-0 hover:bg-neutral-bg transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm text-foreground truncate">{p.number} — {p.title}</p>
                <p className="text-xs text-muted-foreground">{p.client?.name}</p>
              </div>
              <div className="text-right flex-shrink-0">
                {p.dueDate && (
                  <p className="text-xs text-muted-foreground">
                    vence {new Date(p.dueDate).toLocaleDateString('pt-BR')}
                  </p>
                )}
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  p.status === 'EXPIRED' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600',
                )}>
                  {PROTOCOL_STATUS_LABEL[p.status]}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
```

`DashboardMetrics.tsx` hoje não importa nada de `@/types` (todas as interfaces usadas no arquivo
são locais, ex: `ProductivityMetrics`) — adicionar uma linha de import nova, junto dos demais
imports no topo do arquivo (linha ~8, logo após `import { Label } from '@/components/ui/label'`):

```typescript
import type { Protocol, ProtocolSummary } from '@/types'
```

Nota: o link de cada linha usa `/app/board/${p.boardId}` — `boardId` vem achatado de
`listProtocolsForOrg` (Task 2, via `task.column.boardId`), mesmo padrão já usado pra `Request` na
feature anterior. Abre o **board**, não a task específica dentro dele (não existe rota de task
isolada no app) — aceitável como v1, usuário acha a task manualmente dentro do board certo.

- [ ] **Step 2: Verificar tipos**

```bash
pnpm --filter web exec tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 3: Testar no dev server**

```bash
pnpm --filter web dev
```

Validar manualmente: aba "Protocolos" aparece no Dashboard; cards de contagem corretos; clicar
num card filtra a lista; lista ordenada por vencimento, vencidos aparecem com badge vermelho.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/app/DashboardMetrics.tsx
git commit -m "feat(protocols): aba Protocolos no Dashboard (contagem + lista por urgência)"
```

---

### Task 12: `docs/TASKS.md` e verificação final completa

**Files:**
- Modify: `docs/TASKS.md`

- [ ] **Step 1: Marcar o item 7 do roadmap como concluído**

Localizar a entrada "7. Protocolo digital com validade jurídica + IP" e marcar como concluída,
seguindo o padrão das entradas anteriores (resumo do que foi feito + link pra spec e plano).

- [ ] **Step 2: Rodar a suíte completa da API**

```bash
pnpm --filter api test
```

Esperado: todos os testes passando, sem regressão nos módulos existentes.

- [ ] **Step 3: Rodar a suíte completa do frontend**

```bash
pnpm --filter web test
```

Esperado: todos os testes passando.

- [ ] **Step 4: Typecheck completo dos dois workspaces**

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter web exec tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 5: Build de produção do frontend**

```bash
pnpm --filter web build
```

Esperado: build concluído sem erros.

- [ ] **Step 6: Commit final**

```bash
git add docs/TASKS.md
git commit -m "docs: marca Protocolo Digital como concluído no roadmap"
```

---

## Self-Review

**1. Cobertura da spec:** identificador único (Task 2, `nextProtocolNumber`) · log append-only
(Task 2, `ProtocolEvent`) · dois eventos distintos visualização/download (Task 2,
`registerView`/`registerDownload`) · regra de `EXPIRED` só sem visualização (Task 2,
`expireOverdueProtocols` + teste "nunca marca EXPIRED... já foi visualizado") · notificação sem
link de arquivo (Task 5, template só menciona `protocolTitle`+`portalUrl`) · `trustProxy: 1`
(Task 4) · `actorEmail` snapshot (Task 2, `resolveClientUserActor`) · digest estendendo o SLA,
não criando cron novo (Task 6) · comprovante com o aviso sobre IP como evidência de apoio
(Task 2, `buildProtocolReceiptHtml`) · área do cliente com filtro (Task 10) · aba no Dashboard
(Task 11) · quem pode criar = `ORG_ADMIN`/`MANAGER`/`MEMBER` (Task 3, `ORG_ROLES`) · visibilidade
só em Task `visibleToClient` (Task 2, `createProtocol` + Task 2's `registerView`/
`registerDownload` revalidando isso também). Todas as linhas da tabela de decisões da spec têm
task correspondente.

**2. Placeholder scan:** nenhum "TBD"/"implementar depois". A única observação explícita
("aceitável como v1") é no Task 11 sobre o link ir pro board em vez da task exata — é uma
limitação reconhecida do endpoint atual, não um buraco deixado sem código.

**3. Consistência de tipos:** `createProtocol`/`registerView`/`registerDownload`/
`expireOverdueProtocols`/`getProtocolsSummary`/`buildProtocolReceiptHtml` (Task 2) usados com a
mesma assinatura exata em Task 3 (rotas staff), Task 4 (rotas portal) e Task 6 (cron). `Protocol`/
`ProtocolEvent`/`ProtocolSummary` (Task 8) consumidos identicamente nas Tasks 9/10/11.

**4. Review Focus:** as 5 situações listadas (ClientUser sem acesso, Task não visível, anexo de
outra task, download sem arquivo, número sob concorrência) têm teste dedicado na Task 2 (as 4
primeiras) e Task 2/4 (a quinta, testada tanto isolada quanto via rota real).

**5. Re-revisão antes de iniciar a execução (pedida pelo usuário):** achei e corrigi 3 problemas
reais antes de começar a implementar, todos já refletidos no texto acima:
- `listProtocolsForClient` não filtrava por `task.visibleToClient` — um protocolo cuja Task
  virasse interna depois de criada continuaria aparecendo na lista do portal, mesmo que abrir/
  baixar já desse 404 (inconsistência visível pro próprio cliente). Corrigido com `task: {
  visibleToClient: true }` no `where` + teste dedicado.
- O link do Dashboard (Task 11) usava `/app/board/${p.taskId}` — `taskId` não é um `boardId`,
  isso navegaria pra um board errado/inexistente. Corrigido: `listProtocolsForOrg` agora achata
  `boardId` via `task.column.boardId` (mesmo padrão já usado pra `Request` na feature anterior),
  `Protocol.boardId` adicionado ao tipo (Task 8), link corrigido pra `p.boardId`.
- `expireOverdueProtocols` só rodava se `slaDigestEnabled` estivesse ligado — desligar o email de
  resumo teria o efeito colateral de travar a expiração de protocolo pra sempre (um protocolo
  vencido nunca viraria `EXPIRED`, nem apareceria como tal no Dashboard/comprovante). Corrigido:
  a expiração agora roda incondicionalmente, antes de qualquer `return` antecipado, com teste
  dedicado confirmando que expira mesmo com o digest desligado.

Também corrigido um teste da Task 3 cujo nome dizia "CLIENT não pode criar (403)" mas na
verdade só testava ausência de header de autenticação (401) — separado em dois testes
corretos.
