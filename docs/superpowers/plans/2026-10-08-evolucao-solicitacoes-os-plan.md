# Evolução de Solicitações → Ordem de Serviço — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os 4 gaps do fluxo Solicitação→OS: link pro processo após aprovação (admin e portal), status de triagem `NEEDS_INFO` com thread de comentários na própria Request, e cancelamento pós-aprovação pelo escritório (com motivo obrigatório e `Task` → `DISREGARDED`).

**Architecture:** Reaproveita os padrões já existentes no módulo `comments`/`Comment` (criando `RequestComment` como espelho exato, ligado a `Request` em vez de `Task`) e no `regenerateTask` (trava de zero-atividade reaproveitada em `cancelApprovedRequest`). Generaliza o componente `Comments` do frontend para aceitar `entityType: 'task' | 'request'`. Segue o padrão de nivelamento de evento de notificação já usado em todas as features anteriores desta sessão (SLA, Métricas).

**Tech Stack:** Node.js 22 + TypeScript strict + Fastify v5 + Prisma v6 + BullMQ/Redis (backend); React 19 + Vite + TailwindCSS v4 + React Query (frontend). Vitest para testes de API.

**Spec:** `docs/superpowers/specs/2026-10-08-evolucao-solicitacoes-os-design.md`

## Global Constraints

- `pnpm --filter api prisma migrate dev` NUNCA roda direto (CLI não carrega `DATABASE_URL` via `app.ts`, não-interativo falha). Gerar a migration com `prisma migrate diff` e aplicar com os scripts do projeto — ver Task 1.
- Toda migration deve ser aplicada em **dois** bancos: `DATABASE_URL` (dev) via `pnpm --filter api migrate:deploy`, e `DATABASE_URL_TEST` via `DATABASE_URL=$DATABASE_URL_TEST pnpm --filter api migrate:deploy` (ou equivalente — ver Task 1), seguido de `pnpm --filter api exec prisma generate`.
- Comentários e identificadores em inglês; mensagens de usuário (toasts, labels, templates) em português.
- TypeScript `strict: true` — sem `any`, sem `as unknown`. Validação Zod em toda entrada de rota.
- Todo novo campo booleano de `NotificationEvent` precisa dos 6 touch-points: enum Prisma, campo em `NotificationConfig` + `updateConfigSchema` + `getConfig` select, `EVENT_FLAG_MAP`, `DEFAULT_TEMPLATES`, toggle em `Notifications.tsx`, entrada em `Templates.tsx` (`EVENTS` + `EVENT_LABEL`).
- Reaproveitar `getClientAccessScope`/`scope.clientIds.includes(request.clientId)` para checar acesso de `ClientUser` a uma `Request` — **não** usar `canSeeTask` (exige `departmentId` não-nulo, que `Request.departmentId` não garante), mesmo padrão já usado em `portal.routes.ts` para `GET /portal/requests/:id`.
- `cancelApprovedRequest` só é alcançável por `ORG_ADMIN`/`ORG_MANAGER` (mesmo gate de `approve`/`reject`), nunca pelo cliente.

## Review Focus

- **Cancelamento com atividade registrada:** chamar `POST /requests/:id/cancel` numa Request `APPROVED` cuja Task já tem `TaskHistory` (além do `created`), `Comment` ou `Attachment` deve retornar 409 e não alterar nada — mesmo com motivo preenchido corretamente.
- **Comentário do cliente durante NEEDS_INFO sem reabrir indevidamente outros status:** um comentário de `CLIENT` só reverte `NEEDS_INFO → PENDING`; um comentário de `CLIENT` numa Request `APPROVED`/`REJECTED`/`CANCELLED` não deve mudar o status.
- **Comentário da equipe em NEEDS_INFO não reverte:** staff comentando numa Request `NEEDS_INFO` mantém o status como está — só o comentário do cliente dispara a reversão automática.
- **`departmentId` nulo no fallback de notificação:** criar uma Request sem `departmentId`, mandar `markNeedsInfo` ou um comentário de cliente, e confirmar que a notificação cai em `ORG_ADMIN`/`ORG_MANAGER` em vez de lançar erro por falta de `ClientAssignment` com `departmentId: null`.
- **Transição de status inválida nos novos endpoints:** `markNeedsInfo` numa Request que não está `PENDING` (ex.: já `APPROVED`) e `cancelApprovedRequest` numa Request que não está `APPROVED` devem retornar 422, não 500 nem sucesso silencioso.

---

### Task 1: Schema — NEEDS_INFO, cancelamento pós-aprovação, RequestComment, novos eventos de notificação

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration SQL (gerada via `prisma migrate diff`, nome sugerido `add_request_comments_and_needs_info`)

**Interfaces:**
- Produces: enum `RequestStatus` com `NEEDS_INFO`; campos `Request.cancelledByType`, `Request.cancelledById`, `Request.cancellationReason`; modelo `RequestComment` (espelho de `Comment`, com `requestId` no lugar de `taskId`); enum `NotificationEvent` com `REQUEST_NEEDS_INFO`, `REQUEST_COMMENT_ADDED`, `REQUEST_CANCELLED`; `NotificationConfig` com `requestNeedsInfo`, `requestCommentAdded`, `requestCancelled` (todos `Boolean @default(true)`).

- [ ] **Step 1: Editar `apps/api/prisma/schema.prisma`**

No enum `RequestStatus` (linha ~286), adicionar `NEEDS_INFO`:

```prisma
enum RequestStatus {
  PENDING
  APPROVED
  REJECTED
  CANCELLED
  NEEDS_INFO
}
```

No `model Request` (linha ~257), adicionar os 3 novos campos e a relação `comments` (logo após `osTemplateId` e antes de `createdAt`, mantendo o padrão de agrupamento do arquivo):

```prisma
model Request {
  id                 String             @id @default(cuid())
  organizationId     String
  clientId           String
  title              String
  description        String?
  status             RequestStatus      @default(PENDING)
  taskId             String?            @unique
  departmentId       String?
  rejectionReason    String?
  reviewedById       String?
  reviewedAt         DateTime?
  osTemplateId       String?
  cancelledByType    CommentAuthorType?
  cancelledById      String?
  cancellationReason String?
  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  organization Organization        @relation(fields: [organizationId], references: [id])
  client       Client              @relation(fields: [clientId], references: [id])
  task         Task?               @relation(fields: [taskId], references: [id])
  department   Department?         @relation(fields: [departmentId], references: [id])
  reviewedBy   User?               @relation("RequestReviewer", fields: [reviewedById], references: [id])
  osTemplate   OSTemplate?         @relation(fields: [osTemplateId], references: [id])
  attachments  RequestAttachment[]
  comments     RequestComment[]

  @@index([organizationId, status])
  @@index([departmentId])
  @@map("requests")
}
```

Logo após `model RequestAttachment` (linha ~306), adicionar o novo modelo:

```prisma
model RequestComment {
  id            String            @id @default(cuid())
  content       String
  requestId     String
  authorType    CommentAuthorType
  userId        String?
  clientId      String?
  deletedAt     DateTime?
  deletedBy     String?
  deletedByType DeletedByType?
  createdAt     DateTime          @default(now())
  updatedAt     DateTime          @updatedAt

  request Request @relation(fields: [requestId], references: [id], onDelete: Cascade)
  user    User?   @relation(fields: [userId], references: [id])
  client  Client? @relation(fields: [clientId], references: [id])

  @@map("request_comments")
}
```

No enum `NotificationEvent` (linha ~729), adicionar os 3 novos eventos ao final:

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
}
```

No `model NotificationConfig` (linha ~680), adicionar os 3 novos campos logo após `requestRejected`:

```prisma
  requestRejected           Boolean  @default(true)
  requestNeedsInfo          Boolean  @default(true)
  requestCommentAdded       Boolean  @default(true)
  requestCancelled          Boolean  @default(true)
```

- [ ] **Step 2: Gerar o SQL da migration**

```bash
cd apps/api
set -a; source ../../.env; set +a
prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script \
  > /tmp/claude-1000/-home-max-job-autohubs-tramita/*/scratchpad/add_request_comments_and_needs_info.sql 2> /tmp/diff-stderr.log
cat /tmp/diff-stderr.log  # confirmar que só tem avisos, não erros
```

Revisar o SQL gerado manualmente: confirmar que cria a tabela `request_comments`, os 3 novos valores de enum (`RequestStatus` e `NotificationEvent` via `ALTER TYPE ... ADD VALUE`), as 6 novas colunas (`requests.cancelledByType/cancelledById/cancellationReason`, `notification_configs.requestNeedsInfo/requestCommentAdded/requestCancelled`). Copiar o SQL revisado para `apps/api/prisma/migrations/<timestamp>_add_request_comments_and_needs_info/migration.sql` (criar a pasta com o timestamp no formato `YYYYMMDDHHMMSS` usado pelas migrations existentes — conferir o nome da última pasta em `apps/api/prisma/migrations/` para manter o padrão).

- [ ] **Step 3: Aplicar a migration nos dois bancos**

```bash
pnpm --filter api migrate:deploy
DATABASE_URL="$DATABASE_URL_TEST" pnpm --filter api migrate:deploy
pnpm --filter api exec prisma generate
```

- [ ] **Step 4: Verificar que o client gerado reconhece os novos tipos**

```bash
pnpm --filter api exec tsc --noEmit
```

Esperado: sem erros (o schema ainda não é referenciado por nenhum código novo, então isso só confirma que o Prisma Client gerou sem quebrar o build existente).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): adiciona NEEDS_INFO, cancelamento pós-aprovação e RequestComment"
```

---

### Task 2: Módulo `request-comments` (schema, service, routes, testes)

**Files:**
- Create: `apps/api/src/modules/request-comments/request-comments.schema.ts`
- Create: `apps/api/src/modules/request-comments/request-comments.service.ts`
- Create: `apps/api/src/modules/request-comments/request-comments.routes.ts`
- Create: `apps/api/src/modules/request-comments/request-comments.service.test.ts`
- Create: `apps/api/src/modules/request-comments/request-comments.routes.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `prisma.requestComment` (Task 1); `getClientAccessScope(clientUserId)` de `@/modules/client-users/client-access`; `enqueueNotification` de `@/lib/queue`; `publishOrgEvent` de `@/lib/sse`.
- Produces: `listRequestComments(requestId, organizationId, role, clientUserId?)`, `createRequestComment(requestId, data, actor)`, `deleteRequestComment(id, actor)` — usados por Task 3 (`markNeedsInfo` cria uma `RequestComment` diretamente via `prisma`, não via `createRequestComment`, para não duplicar notificação).

- [ ] **Step 1: Escrever `request-comments.schema.ts`**

```typescript
// apps/api/src/modules/request-comments/request-comments.schema.ts
import { z } from 'zod'

export const createRequestCommentSchema = z.object({
  content: z.string().min(1),
})

export type CreateRequestCommentBody = z.infer<typeof createRequestCommentSchema>
```

- [ ] **Step 2: Escrever `request-comments.service.ts`**

```typescript
// apps/api/src/modules/request-comments/request-comments.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { publishOrgEvent } from '@/lib/sse'
import { enqueueNotification } from '@/lib/queue'
import { getClientAccessScope } from '@/modules/client-users/client-access'
import type { CreateRequestCommentBody } from './request-comments.schema'

interface CommentActor {
  // For role === 'CLIENT' this is a ClientUser id, not a Client id — resolving the actual
  // company always goes through getClientAccessScope, same convention as comments.service.ts.
  id: string
  role: string
  organizationId: string
}

const CAN_SEE_DELETED_CONTENT = new Set(['ORG_ADMIN', 'ORG_MANAGER'])

export async function listRequestComments(
  requestId: string,
  organizationId: string,
  role: string,
  clientUserId?: string,
) {
  const scope = role === 'CLIENT' && clientUserId ? await getClientAccessScope(clientUserId) : null

  const request = await prisma.request.findFirst({ where: { id: requestId, organizationId } })
  if (!request) throw new AppError(404, 'Solicitação não encontrada')
  if (scope && !scope.clientIds.includes(request.clientId)) {
    throw new AppError(404, 'Solicitação não encontrada')
  }

  const comments = await prisma.requestComment.findMany({
    where: { requestId },
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  })

  const canSeeDeleted = CAN_SEE_DELETED_CONTENT.has(role)

  return comments.map((c) => {
    if (!c.deletedAt) return c
    return {
      ...c,
      content: null,
      ...(canSeeDeleted ? { deletedContent: c.content } : {}),
    }
  })
}

export async function createRequestComment(
  requestId: string,
  data: CreateRequestCommentBody,
  actor: CommentActor,
) {
  const isClient = actor.role === 'CLIENT'
  const scope = isClient ? await getClientAccessScope(actor.id) : null

  const request = await prisma.request.findFirst({ where: { id: requestId, organizationId: actor.organizationId } })
  if (!request) throw new AppError(404, 'Solicitação não encontrada')
  if (isClient && !scope!.clientIds.includes(request.clientId)) {
    throw new AppError(404, 'Solicitação não encontrada')
  }

  const comment = await prisma.requestComment.create({
    data: {
      content: data.content,
      requestId,
      authorType: isClient ? 'CLIENT' : 'USER',
      userId: isClient ? undefined : actor.id,
      clientId: isClient ? request.clientId : undefined,
    },
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  })

  // Comentário do CLIENTE enquanto a solicitação está em NEEDS_INFO reabre a fila de triagem
  // automaticamente — comentário da equipe nunca reverte (ela pode responder livremente sem
  // tirar a request do estado de espera).
  if (isClient && request.status === 'NEEDS_INFO') {
    await prisma.request.update({ where: { id: requestId }, data: { status: 'PENDING' } })
  }

  await publishOrgEvent(actor.organizationId, { event: 'request:changed', data: {} })

  const authorName = isClient
    ? (comment.client?.name ?? 'Cliente')
    : (comment.user?.name ?? 'Colaborador')

  if (isClient) {
    const assignments = await prisma.clientAssignment.findMany({
      where: request.departmentId
        ? { clientId: request.clientId, departmentId: request.departmentId }
        : { clientId: request.clientId },
      select: { userId: true },
    })
    const recipientIds = assignments.length > 0
      ? assignments.map((a) => a.userId)
      : await prisma.user.findMany({
          where: { organizationId: actor.organizationId, role: { in: ['ORG_ADMIN', 'ORG_MANAGER'] }, isActive: true },
          select: { id: true },
        }).then((users) => users.map((u) => u.id))

    await Promise.all(
      recipientIds.map((userId) =>
        enqueueNotification({
          event: 'REQUEST_COMMENT_ADDED',
          organizationId: actor.organizationId,
          recipientType: 'USER',
          userId,
          requestId,
          metadata: {
            requestTitle: request.title,
            commentText: data.content,
            commentAuthorName: authorName,
          },
        }),
      ),
    )
  } else {
    await enqueueNotification({
      event: 'REQUEST_COMMENT_ADDED',
      organizationId: actor.organizationId,
      clientId: request.clientId,
      requestId,
      metadata: {
        requestTitle: request.title,
        commentText: data.content,
        commentAuthorName: authorName,
      },
    })
  }

  return comment
}

export async function deleteRequestComment(id: string, actor: CommentActor) {
  const comment = await prisma.requestComment.findFirst({
    where: { id },
    include: { request: { select: { organizationId: true, clientId: true } } },
  })
  if (!comment) throw new AppError(404, 'Comentário não encontrado')
  if (comment.deletedAt) throw new AppError(410, 'Comentário já foi removido')
  if (comment.request.organizationId !== actor.organizationId) throw new AppError(403, 'Acesso negado')

  if (actor.role === 'CLIENT') {
    const scope = await getClientAccessScope(actor.id)
    if (!scope.clientIds.includes(comment.request.clientId)) {
      throw new AppError(404, 'Comentário não encontrado')
    }
  }

  const isAuthor =
    (actor.role === 'CLIENT' && comment.clientId === comment.request.clientId) ||
    (actor.role !== 'CLIENT' && comment.userId === actor.id)
  const isAdmin = actor.role === 'ORG_ADMIN' || actor.role === 'ORG_MANAGER'

  if (!isAuthor && !isAdmin) throw new AppError(403, 'Sem permissão')

  await prisma.requestComment.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedBy: actor.role === 'CLIENT' ? comment.request.clientId : actor.id,
      deletedByType: actor.role === 'CLIENT' ? 'CLIENT' : 'USER',
    },
  })

  return { ok: true }
}
```

- [ ] **Step 3: Escrever `request-comments.routes.ts`**

```typescript
// apps/api/src/modules/request-comments/request-comments.routes.ts
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { AppError } from '@/errors/AppError'
import { createRequestCommentSchema } from './request-comments.schema'
import { listRequestComments, createRequestComment, deleteRequestComment } from './request-comments.service'

export async function requestCommentsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/requests/:requestId/comments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { requestId } = request.params as { requestId: string }
    const clientId = request.user.role === 'CLIENT' ? request.user.sub : undefined
    return reply.send(
      await listRequestComments(requestId, request.user.organizationId!, request.user.role, clientId),
    )
  })

  app.post('/requests/:requestId/comments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { requestId } = request.params as { requestId: string }
    const result = createRequestCommentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(
      await createRequestComment(requestId, result.data, {
        id: request.user.sub,
        role: request.user.role,
        organizationId: request.user.organizationId!,
      }),
    )
  })

  app.delete('/request-comments/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(
      await deleteRequestComment(id, {
        id: request.user.sub,
        role: request.user.role,
        organizationId: request.user.organizationId!,
      }),
    )
  })
}
```

- [ ] **Step 4: Registrar em `server.ts`**

Adicionar o import logo após `requestsRoutes` (linha ~20) e o `app.register` logo após `app.register(requestsRoutes, { prefix: '/requests' })` (linha ~53):

```typescript
import { requestCommentsRoutes } from '@/modules/request-comments/request-comments.routes'
```

```typescript
  app.register(requestsRoutes, { prefix: '/requests' })
  app.register(requestCommentsRoutes)
```

- [ ] **Step 5: Escrever `request-comments.service.test.ts`**

```typescript
// apps/api/src/modules/request-comments/request-comments.service.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient, createTestDepartment,
  createTestClientUser, grantClientAccess,
} from '@/test/helpers'
import * as queue from '@/lib/queue'
import { createRequest, markNeedsInfo } from '@/modules/requests/requests.service'
import { listRequestComments, createRequestComment, deleteRequestComment } from './request-comments.service'

beforeEach(() => {
  vi.spyOn(queue, 'enqueueNotification').mockResolvedValue(undefined)
})

afterEach(() => vi.restoreAllMocks())

describe('createRequestComment', () => {
  it('comentário do cliente em request NEEDS_INFO reverte o status para PENDING', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    await markNeedsInfo(request.id, org.id, admin.id, 'Qual o CNPJ da empresa?')

    await createRequestComment(request.id, { content: 'É 00.000.000/0001-00' }, {
      id: clientUser.id, role: 'CLIENT', organizationId: org.id,
    })

    const updated = await prisma.request.findUniqueOrThrow({ where: { id: request.id } })
    expect(updated.status).toBe('PENDING')
  })

  it('comentário da equipe em request NEEDS_INFO NÃO reverte o status', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    await markNeedsInfo(request.id, org.id, admin.id, 'Qual o CNPJ da empresa?')

    await createRequestComment(request.id, { content: 'Só um follow-up' }, {
      id: admin.id, role: 'ORG_ADMIN', organizationId: org.id,
    })

    const updated = await prisma.request.findUniqueOrThrow({ where: { id: request.id } })
    expect(updated.status).toBe('NEEDS_INFO')
  })

  it('comentário do cliente em request APPROVED não altera o status', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    await prisma.request.update({ where: { id: request.id }, data: { status: 'APPROVED', reviewedById: admin.id } })

    await createRequestComment(request.id, { content: 'Obrigado!' }, {
      id: clientUser.id, role: 'CLIENT', organizationId: org.id,
    })

    const updated = await prisma.request.findUniqueOrThrow({ where: { id: request.id } })
    expect(updated.status).toBe('APPROVED')
  })

  it('cliente sem acesso à company da request recebe 404', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const client = await createTestClient(org.id)
    const { clientUser } = await createTestClientUser(org.id) // sem grantClientAccess
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })

    await expect(
      createRequestComment(request.id, { content: 'x' }, { id: clientUser.id, role: 'CLIENT', organizationId: org.id }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('departmentId nulo na request cai no fallback ORG_ADMIN/ORG_MANAGER sem erro', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const { clientUser } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido sem depto' }) // departmentId undefined

    await createRequestComment(request.id, { content: 'Oi' }, {
      id: clientUser.id, role: 'CLIENT', organizationId: org.id,
    })

    expect(queue.enqueueNotification).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'REQUEST_COMMENT_ADDED', userId: admin.id }),
    )
  })
})

describe('listRequestComments / deleteRequestComment', () => {
  it('lista comentários em ordem cronológica e marca deletado sem revelar conteúdo pro cliente', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    const c1 = await createRequestComment(request.id, { content: 'Primeiro' }, { id: admin.id, role: 'ORG_ADMIN', organizationId: org.id })
    await createRequestComment(request.id, { content: 'Segundo' }, { id: admin.id, role: 'ORG_ADMIN', organizationId: org.id })

    await deleteRequestComment(c1.id, { id: admin.id, role: 'ORG_ADMIN', organizationId: org.id })

    const asAdmin = await listRequestComments(request.id, org.id, 'ORG_ADMIN')
    expect(asAdmin).toHaveLength(2)
    expect(asAdmin[0].content).toBeNull()
    expect((asAdmin[0] as unknown as { deletedContent: string }).deletedContent).toBe('Primeiro')
  })
})
```

- [ ] **Step 6: Rodar os testes de serviço**

```bash
pnpm --filter api test request-comments.service
```

Esperado: todos passando.

- [ ] **Step 7: Escrever `request-comments.routes.test.ts`**

```typescript
// apps/api/src/modules/request-comments/request-comments.routes.test.ts
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import {
  createTestPlan, createTestOrg, createTestUser, createTestClient,
  createTestClientUser, createTestDepartment, grantClientAccess, getAuthHeader,
} from '@/test/helpers'
import { createRequest } from '@/modules/requests/requests.service'

describe('POST /requests/:requestId/comments', () => {
  it('ORG_MEMBER comenta e cliente consegue ler depois', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const { clientUser, password } = await createTestClientUser(org.id)
    const department = await createTestDepartment(org.id)
    await grantClientAccess(clientUser.id, client.id, department.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })

    const authStaff = await getAuthHeader(member.email, 'Test@1234')
    const created = await app.inject({
      method: 'POST',
      url: `/requests/${request.id}/comments`,
      headers: { authorization: authStaff },
      payload: { content: 'Pode detalhar?' },
    })
    expect(created.statusCode).toBe(201)

    const authClient = await getAuthHeader(clientUser.email, password)
    const list = await app.inject({
      method: 'GET',
      url: `/requests/${request.id}/comments`,
      headers: { authorization: authClient },
    })
    expect(list.statusCode).toBe(200)
    expect(JSON.parse(list.body)).toHaveLength(1)
  })
})

describe('DELETE /request-comments/:id', () => {
  it('autor remove o próprio comentário', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    const auth = await getAuthHeader(admin.email, 'Test@1234')

    const created = await app.inject({
      method: 'POST',
      url: `/requests/${request.id}/comments`,
      headers: { authorization: auth },
      payload: { content: 'Meu comentário' },
    })
    const comment = JSON.parse(created.body)

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/request-comments/${comment.id}`,
      headers: { authorization: auth },
    })
    expect(deleted.statusCode).toBe(200)
  })
})
```

- [ ] **Step 8: Rodar os testes de rota**

```bash
pnpm --filter api test request-comments.routes
```

Esperado: todos passando.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/request-comments apps/api/src/server.ts
git commit -m "feat(requests): adiciona módulo request-comments (thread de comentários na solicitação)"
```

---

### Task 3: `requests.service.ts` — NEEDS_INFO, cancelamento pós-aprovação, boardId

**Files:**
- Modify: `apps/api/src/modules/requests/requests.schema.ts`
- Modify: `apps/api/src/modules/requests/requests.service.ts`
- Modify: `apps/api/src/modules/requests/requests.service.test.ts`

**Interfaces:**
- Consumes: `prisma.taskHistory.count`, `prisma.comment.count`, `prisma.attachment.count` (trava de zero-atividade, mesmo padrão de `regenerateTask` em `recurring-templates.service.ts:591-598`).
- Produces: `markNeedsInfo(id, organizationId, staffId, comment): Promise<Request>`; `cancelApprovedRequest(id, organizationId, staffId, reason): Promise<Request>`; `getRequestById`/`listRequestsForOrg`/`listRequestsForClient` agora retornam um campo `boardId: string | null` — consumido por Task 9/10 (frontend).

- [ ] **Step 1: Atualizar `requests.schema.ts`**

```typescript
import { z } from 'zod'

export const createRequestSchema = z.object({
  clientId: z.string().cuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  departmentId: z.string().cuid().optional(),
  osTemplateId: z.string().cuid().optional(),
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

export const needsInfoRequestSchema = z.object({
  comment: z.string().min(1),
})

export const cancelApprovedRequestSchema = z.object({
  reason: z.string().min(1),
})

export const listRequestsQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'NEEDS_INFO']).optional(),
})

export type CreateRequestBody = z.infer<typeof createRequestSchema>
export type ApproveRequestBody = z.infer<typeof approveRequestSchema>
export type RejectRequestBody = z.infer<typeof rejectRequestSchema>
export type NeedsInfoRequestBody = z.infer<typeof needsInfoRequestSchema>
export type CancelApprovedRequestBody = z.infer<typeof cancelApprovedRequestSchema>
export type ListRequestsQuery = z.infer<typeof listRequestsQuerySchema>
```

- [ ] **Step 2: Escrever o teste de `markNeedsInfo` (falhando)**

Adicionar ao final de `requests.service.test.ts`, antes do último `describe('countPendingRequests', ...)`:

```typescript
import { markNeedsInfo, cancelApprovedRequest } from './requests.service'
```

(ajustar o import existente de `requests.service` no topo do arquivo para incluir `markNeedsInfo` e `cancelApprovedRequest` junto dos demais, em vez de um import separado)

```typescript
describe('markNeedsInfo', () => {
  it('move PENDING → NEEDS_INFO e registra o comentário obrigatório', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })

    const updated = await markNeedsInfo(request.id, org.id, admin.id, 'Qual o CNPJ?')

    expect(updated.status).toBe('NEEDS_INFO')
    const comment = await prisma.requestComment.findFirst({ where: { requestId: request.id } })
    expect(comment?.content).toBe('Qual o CNPJ?')
    expect(comment?.authorType).toBe('USER')
  })

  it('lança 422 se a request não está PENDING', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    await rejectRequest(request.id, org.id, admin.id, {})

    await expect(markNeedsInfo(request.id, org.id, admin.id, 'x')).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('cancelApprovedRequest', () => {
  it('cancela a request aprovada e marca a task como DISREGARDED quando não há atividade', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    const approved = await approveRequest(request.id, org.id, admin.id, 'ORG_ADMIN', { mode: 'NEW_BOARD' })

    const cancelled = await cancelApprovedRequest(request.id, org.id, admin.id, 'Cliente desistiu')

    expect(cancelled.status).toBe('CANCELLED')
    expect(cancelled.cancelledByType).toBe('USER')
    expect(cancelled.cancelledById).toBe(admin.id)
    expect(cancelled.cancellationReason).toBe('Cliente desistiu')
    const task = await prisma.task.findUniqueOrThrow({ where: { id: approved.taskId! } })
    expect(task.status).toBe('DISREGARDED')
  })

  it('lança 409 se a task já teve movimentação (history além de created)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    const approved = await approveRequest(request.id, org.id, admin.id, 'ORG_ADMIN', { mode: 'NEW_BOARD' })
    await prisma.taskHistory.create({
      data: { taskId: approved.taskId!, action: 'moved', actorType: 'user', actorId: admin.id, actorName: 'Admin' },
    })

    await expect(cancelApprovedRequest(request.id, org.id, admin.id, 'Motivo')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('lança 409 se a task já tem comentário', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })
    const approved = await approveRequest(request.id, org.id, admin.id, 'ORG_ADMIN', { mode: 'NEW_BOARD' })
    await prisma.comment.create({ data: { taskId: approved.taskId!, content: 'x', authorType: 'USER', userId: admin.id } })

    await expect(cancelApprovedRequest(request.id, org.id, admin.id, 'Motivo')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('lança 422 se a request não está APPROVED', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const request = await createRequest(org.id, client.id, { title: 'Pedido' })

    await expect(cancelApprovedRequest(request.id, org.id, admin.id, 'Motivo')).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('getRequestById / listRequestsForOrg — boardId', () => {
  it('expõe boardId quando a request tem task associada, e null quando não tem', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const client = await createTestClient(org.id)
    const pending = await createRequest(org.id, client.id, { title: 'Ainda pendente' })
    const toApprove = await createRequest(org.id, client.id, { title: 'Vai ser aprovada' })
    const approved = await approveRequest(toApprove.id, org.id, admin.id, 'ORG_ADMIN', { mode: 'NEW_BOARD' })

    const pendingFetched = await getRequestById(pending.id, org.id)
    expect(pendingFetched.boardId).toBeNull()

    const approvedFetched = await getRequestById(approved.id, org.id)
    const task = await prisma.task.findUniqueOrThrow({ where: { id: approved.taskId! } })
    expect(approvedFetched.boardId).toBe(task.columnId ? (await prisma.column.findUniqueOrThrow({ where: { id: task.columnId } })).boardId : null)

    const list = await listRequestsForOrg(org.id)
    expect(list.find((r) => r.id === approved.id)?.boardId).toBe(approvedFetched.boardId)
  })
})
```

- [ ] **Step 3: Rodar os testes novos para confirmar que falham (funções ainda não existem)**

```bash
pnpm --filter api test requests.service -t "markNeedsInfo|cancelApprovedRequest|boardId"
```

Esperado: FAIL — `markNeedsInfo`/`cancelApprovedRequest` não exportados.

- [ ] **Step 4: Implementar em `requests.service.ts`**

Substituir o arquivo inteiro por:

```typescript
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import { publishOrgEvent } from '@/lib/sse'
import { createBoard } from '@/modules/boards/boards.service'
import { createTask, defaultDepartmentForOrg } from '@/modules/tasks/tasks.service'
import { assertDepartmentBelongsToOrg } from '@/modules/departments/departments.service'
import type { CreateRequestBody, ApproveRequestBody, RejectRequestBody } from './requests.schema'
import type { RequestStatus } from '@prisma/client'

const CANCELLABLE_BY_CLIENT: RequestStatus[] = ['PENDING', 'NEEDS_INFO']
const REVIEWABLE: RequestStatus[] = ['PENDING', 'NEEDS_INFO']

function withBoardId<T extends { task: { column: { boardId: string } } | null }>(
  row: T,
): Omit<T, 'task'> & { boardId: string | null } {
  const { task, ...rest } = row
  return { ...rest, boardId: task?.column.boardId ?? null }
}

export async function createRequest(
  organizationId: string,
  clientId: string,
  data: Omit<CreateRequestBody, 'clientId'>,
) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId, isActive: true },
  })
  if (!client) throw new AppError(404, 'Cliente não encontrado')
  if (data.departmentId) await assertDepartmentBelongsToOrg(data.departmentId, organizationId)

  const request = await prisma.request.create({
    data: {
      organizationId,
      clientId,
      title: data.title,
      description: data.description,
      departmentId: data.departmentId,
      osTemplateId: data.osTemplateId,
    },
  })

  // Notifica responsáveis atribuídos ao cliente; fallback para ORG_ADMIN + ORG_MANAGER
  const assignments = await prisma.clientAssignment.findMany({
    where: request.departmentId
      ? { clientId, departmentId: request.departmentId }
      : { clientId },
    select: { userId: true },
  })

  const recipientIds = assignments.length > 0
    ? assignments.map((a) => a.userId)
    : await prisma.user.findMany({
        where: { organizationId, role: { in: ['ORG_ADMIN', 'ORG_MANAGER'] }, isActive: true },
        select: { id: true },
      }).then((users) => users.map((u) => u.id))

  await Promise.all(
    recipientIds.map((userId) =>
      enqueueNotification({
        event: 'REQUEST_CREATED',
        organizationId,
        recipientType: 'USER',
        userId,
        requestId: request.id,
        metadata: { clientName: client.name, requestTitle: request.title },
      }),
    ),
  )

  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })

  return request
}

export async function listRequestsForOrg(organizationId: string, status?: RequestStatus) {
  const requests = await prisma.request.findMany({
    where: { organizationId, ...(status ? { status } : {}) },
    include: {
      client: { select: { id: true, name: true } },
      task: { select: { column: { select: { boardId: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return requests.map(withBoardId)
}

export async function listRequestsForClient(organizationId: string, clientId: string) {
  const requests = await prisma.request.findMany({
    where: { organizationId, clientId },
    include: { task: { select: { column: { select: { boardId: true } } } } },
    orderBy: { createdAt: 'desc' },
  })
  return requests.map(withBoardId)
}

async function getRequestOrThrow(id: string, organizationId: string, clientId?: string) {
  const request = await prisma.request.findFirst({
    where: { id, organizationId, ...(clientId ? { clientId } : {}) },
  })
  if (!request) throw new AppError(404, 'Solicitação não encontrada')
  return request
}

export async function getRequestById(id: string, organizationId: string, clientId?: string) {
  const request = await prisma.request.findFirst({
    where: { id, organizationId, ...(clientId ? { clientId } : {}) },
    include: { task: { select: { column: { select: { boardId: true } } } } },
  })
  if (!request) throw new AppError(404, 'Solicitação não encontrada')
  const attachments = await prisma.requestAttachment.findMany({
    where: { requestId: id },
    orderBy: { createdAt: 'asc' },
  })
  return { ...withBoardId(request), attachments }
}

export async function cancelRequest(id: string, organizationId: string, clientId: string) {
  const request = await getRequestOrThrow(id, organizationId, clientId)
  if (!CANCELLABLE_BY_CLIENT.includes(request.status)) {
    throw new AppError(422, 'Essa solicitação não pode mais ser cancelada por aqui — fale com o escritório')
  }
  const updated = await prisma.request.update({ where: { id }, data: { status: 'CANCELLED' } })
  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })
  return updated
}

export async function markNeedsInfo(id: string, organizationId: string, staffId: string, comment: string) {
  const request = await getRequestOrThrow(id, organizationId)
  if (request.status !== 'PENDING') {
    throw new AppError(422, 'Só solicitações pendentes podem ser marcadas como "precisa de mais informação"')
  }

  const [updated] = await prisma.$transaction([
    prisma.request.update({ where: { id }, data: { status: 'NEEDS_INFO' } }),
    prisma.requestComment.create({
      data: { content: comment, requestId: id, authorType: 'USER', userId: staffId },
    }),
  ])

  await enqueueNotification({
    event: 'REQUEST_NEEDS_INFO',
    organizationId,
    clientId: request.clientId,
    requestId: id,
    metadata: { requestTitle: request.title, commentText: comment },
  })

  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })
  return updated
}

export async function cancelApprovedRequest(
  id: string,
  organizationId: string,
  staffId: string,
  reason: string,
) {
  const request = await getRequestOrThrow(id, organizationId)
  if (request.status !== 'APPROVED') throw new AppError(422, 'Só solicitações aprovadas podem ser canceladas por este caminho')
  if (!request.taskId) throw new AppError(422, 'Solicitação aprovada sem tarefa associada — estado inconsistente')

  const [historyCount, commentCount, attachmentCount] = await Promise.all([
    prisma.taskHistory.count({ where: { taskId: request.taskId, action: { not: 'created' } } }),
    prisma.comment.count({ where: { taskId: request.taskId } }),
    prisma.attachment.count({ where: { taskId: request.taskId } }),
  ])
  if (historyCount > 0 || commentCount > 0 || attachmentCount > 0) {
    throw new AppError(409, 'Essa tarefa já teve movimentação — não pode ser cancelada por este caminho')
  }

  const [, updated] = await prisma.$transaction([
    prisma.task.update({ where: { id: request.taskId }, data: { status: 'DISREGARDED' } }),
    prisma.request.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledByType: 'USER',
        cancelledById: staffId,
        cancellationReason: reason,
      },
    }),
  ])

  await enqueueNotification({
    event: 'REQUEST_CANCELLED',
    organizationId,
    clientId: request.clientId,
    requestId: id,
    // rejectionReason é o nome de variável genérico de template.ts pra "motivo exibido ao
    // cliente" — reaproveitado aqui (não é uma rejeição, é o motivo do cancelamento) em vez de
    // criar uma TemplateVar nova só pra este evento.
    metadata: { requestTitle: request.title, rejectionReason: reason },
  })

  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })
  return updated
}

export async function approveRequest(
  id: string,
  organizationId: string,
  reviewerId: string,
  reviewerRole: string,
  data: ApproveRequestBody,
) {
  const request = await getRequestOrThrow(id, organizationId)
  if (!REVIEWABLE.includes(request.status)) throw new AppError(422, 'Solicitação já foi avaliada')

  let columnId: string

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
  } else {
    const board = await prisma.board.findFirst({
      where: { id: data.boardId, organizationId, clientId: request.clientId, isActive: true, type: 'OS' },
    })
    if (!board) throw new AppError(404, 'Processo não encontrado para este cliente')
    const column = await prisma.column.findFirst({ where: { id: data.columnId, boardId: board.id } })
    if (!column) throw new AppError(404, 'Coluna não encontrada neste processo')
    columnId = column.id
  }

  const departmentId = request.departmentId ?? (await defaultDepartmentForOrg(organizationId))

  const task = await createTask(
    columnId,
    organizationId,
    {
      title: request.title,
      description: request.description ?? undefined,
      priority: 'MEDIUM',
      tags: [],
      departmentId,
    },
    { id: reviewerId, type: 'user' },
  )

  const [, updatedRequest] = await prisma.$transaction([
    prisma.task.update({ where: { id: task.id }, data: { sourceRequestId: id } }),
    prisma.request.update({
      where: { id },
      data: { status: 'APPROVED', taskId: task.id, reviewedById: reviewerId, reviewedAt: new Date() },
    }),
  ])

  await enqueueNotification({
    event: 'REQUEST_APPROVED',
    organizationId,
    clientId: request.clientId,
    taskId: task.id,
    requestId: id,
    metadata: { requestTitle: request.title },
  })

  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })

  return updatedRequest
}

export async function rejectRequest(
  id: string,
  organizationId: string,
  reviewerId: string,
  data: RejectRequestBody,
) {
  const request = await getRequestOrThrow(id, organizationId)
  if (!REVIEWABLE.includes(request.status)) throw new AppError(422, 'Solicitação já foi avaliada')

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

  await publishOrgEvent(organizationId, { event: 'request:changed', data: {} })

  return updated
}

export async function countPendingRequests(organizationId: string): Promise<number> {
  return prisma.request.count({ where: { organizationId, status: 'PENDING' } })
}
```

Nota: `approveRequest`/`rejectRequest` agora aceitam `NEEDS_INFO` como status de origem além de `PENDING` (campo `REVIEWABLE`) — mesma lógica de "não fica presa" que motivou o cancelamento pelo cliente em `NEEDS_INFO`: a equipe pode decidir aprovar/rejeitar mesmo com a conversa de triagem ainda aberta, sem ficar obrigada a reverter o status manualmente primeiro.

- [ ] **Step 5: Rodar a suíte completa do módulo**

```bash
pnpm --filter api test requests.service
```

Esperado: todos passando, incluindo os testes pré-existentes (nenhuma regressão).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/requests/requests.schema.ts apps/api/src/modules/requests/requests.service.ts apps/api/src/modules/requests/requests.service.test.ts
git commit -m "feat(requests): markNeedsInfo, cancelApprovedRequest e boardId exposto nas respostas"
```

---

### Task 4: Rotas `POST /requests/:id/needs-info` e `POST /requests/:id/cancel`

**Files:**
- Modify: `apps/api/src/modules/requests/requests.routes.ts`
- Modify: `apps/api/src/modules/requests/requests.routes.test.ts`

**Interfaces:**
- Consumes: `markNeedsInfo`, `cancelApprovedRequest` (Task 3); `needsInfoRequestSchema`, `cancelApprovedRequestSchema` (Task 3).

- [ ] **Step 1: Escrever os testes de rota (falhando)**

Adicionar a `requests.routes.test.ts`:

```typescript
describe('POST /requests/:id/needs-info', () => {
  it('ORG_MANAGER marca NEEDS_INFO com comentário obrigatório', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const { client, auth: authClient } = await createTestClientLogin(org.id)
    const created = await app.inject({
      method: 'POST', url: '/portal/requests', headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido' },
    })
    const request = JSON.parse(created.body)

    const auth = await getAuthHeader(manager.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST', url: `/requests/${request.id}/needs-info`, headers: { authorization: auth },
      payload: { comment: 'Qual o CNPJ?' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('NEEDS_INFO')
  })

  it('rejeita sem comment (400)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const { client, auth: authClient } = await createTestClientLogin(org.id)
    const created = await app.inject({
      method: 'POST', url: '/portal/requests', headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido' },
    })
    const request = JSON.parse(created.body)

    const auth = await getAuthHeader(manager.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST', url: `/requests/${request.id}/needs-info`, headers: { authorization: auth },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /requests/:id/cancel', () => {
  it('ORG_ADMIN cancela request aprovada sem atividade na task, com motivo obrigatório', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { client, auth: authClient } = await createTestClientLogin(org.id)
    const created = await app.inject({
      method: 'POST', url: '/portal/requests', headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido' },
    })
    const request = JSON.parse(created.body)
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    await app.inject({
      method: 'POST', url: `/requests/${request.id}/approve`, headers: { authorization: auth },
      payload: { mode: 'NEW_BOARD' },
    })

    const res = await app.inject({
      method: 'POST', url: `/requests/${request.id}/cancel`, headers: { authorization: auth },
      payload: { reason: 'Cliente desistiu' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('CANCELLED')
  })

  it('ORG_MEMBER não pode cancelar (403)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const { client, auth: authClient } = await createTestClientLogin(org.id)
    const created = await app.inject({
      method: 'POST', url: '/portal/requests', headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido' },
    })
    const request = JSON.parse(created.body)
    const authAdmin = await getAuthHeader(admin.email, 'Test@1234')
    await app.inject({
      method: 'POST', url: `/requests/${request.id}/approve`, headers: { authorization: authAdmin },
      payload: { mode: 'NEW_BOARD' },
    })

    const authMember = await getAuthHeader(member.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST', url: `/requests/${request.id}/cancel`, headers: { authorization: authMember },
      payload: { reason: 'x' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejeita sem reason (400)', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const { client, auth: authClient } = await createTestClientLogin(org.id)
    const created = await app.inject({
      method: 'POST', url: '/portal/requests', headers: { authorization: authClient },
      payload: { clientId: client.id, title: 'Pedido' },
    })
    const request = JSON.parse(created.body)
    const auth = await getAuthHeader(admin.email, 'Test@1234')
    await app.inject({
      method: 'POST', url: `/requests/${request.id}/approve`, headers: { authorization: auth },
      payload: { mode: 'NEW_BOARD' },
    })

    const res = await app.inject({
      method: 'POST', url: `/requests/${request.id}/cancel`, headers: { authorization: auth },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha (rotas não existem ainda)**

```bash
pnpm --filter api test requests.routes -t "needs-info|cancel"
```

Esperado: FAIL com 404 (rota inexistente).

- [ ] **Step 3: Implementar as rotas em `requests.routes.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { verifyAccessToken } from '@/lib/jwt'
import { attachSSESubscriber } from '@/lib/sse'
import { AppError } from '@/errors/AppError'
import {
  approveRequestSchema, rejectRequestSchema, listRequestsQuerySchema,
  needsInfoRequestSchema, cancelApprovedRequestSchema,
} from './requests.schema'
import {
  listRequestsForOrg,
  getRequestById,
  approveRequest,
  rejectRequest,
  markNeedsInfo,
  cancelApprovedRequest,
  countPendingRequests,
} from './requests.service'

const ORG_ROLES = ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'] as const

export async function requestsRoutes(app: FastifyInstance) {
  // /stream fica fora do hook global de verifyJWT — autentica via query param,
  // igual ao padrão de /boards/:id/stream (EventSource não manda headers customizados)
  app.get('/stream', async (request, reply) => {
    const { token } = request.query as { token?: string }
    if (!token) throw new AppError(401, 'Token não fornecido')

    let user: ReturnType<typeof verifyAccessToken>
    try {
      user = verifyAccessToken(token)
    } catch {
      throw new AppError(401, 'Token inválido ou expirado')
    }

    if (!ORG_ROLES.includes(user.role as typeof ORG_ROLES[number]) || !user.organizationId) {
      throw new AppError(403, 'Acesso negado')
    }

    attachSSESubscriber(request, reply, `org:${user.organizationId}:requests`)
  })

  app.register(async (authed) => {
    authed.addHook('preHandler', verifyJWT)

    authed.get('/', {
      preHandler: [requireRole(...ORG_ROLES)],
    }, async (request, reply) => {
      const result = listRequestsQuerySchema.safeParse(request.query)
      const query = result.success ? result.data : {}
      return reply.send(await listRequestsForOrg(request.user.organizationId!, query.status))
    })

    authed.get('/pending-count', {
      preHandler: [requireRole(...ORG_ROLES)],
    }, async (request, reply) => {
      const count = await countPendingRequests(request.user.organizationId!)
      return reply.send({ count })
    })

    authed.get('/:id', {
      preHandler: [requireRole(...ORG_ROLES)],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      return reply.send(await getRequestById(id, request.user.organizationId!))
    })

    authed.post('/:id/approve', {
      preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = approveRequestSchema.safeParse(request.body)
      if (!result.success) throw new AppError(400, result.error.errors[0].message)
      return reply.send(
        await approveRequest(id, request.user.organizationId!, request.user.sub, request.user.role, result.data),
      )
    })

    authed.post('/:id/reject', {
      preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = rejectRequestSchema.safeParse(request.body)
      if (!result.success) throw new AppError(400, result.error.errors[0].message)
      return reply.send(await rejectRequest(id, request.user.organizationId!, request.user.sub, result.data))
    })

    authed.post('/:id/needs-info', {
      preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = needsInfoRequestSchema.safeParse(request.body)
      if (!result.success) throw new AppError(400, result.error.errors[0].message)
      return reply.send(
        await markNeedsInfo(id, request.user.organizationId!, request.user.sub, result.data.comment),
      )
    })

    authed.post('/:id/cancel', {
      preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
    }, async (request, reply) => {
      const { id } = request.params as { id: string }
      const result = cancelApprovedRequestSchema.safeParse(request.body)
      if (!result.success) throw new AppError(400, result.error.errors[0].message)
      return reply.send(
        await cancelApprovedRequest(id, request.user.organizationId!, request.user.sub, result.data.reason),
      )
    })
  })
}
```

- [ ] **Step 4: Rodar os testes e confirmar passagem**

```bash
pnpm --filter api test requests.routes
```

Esperado: todos passando.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/requests/requests.routes.ts apps/api/src/modules/requests/requests.routes.test.ts
git commit -m "feat(requests): rotas POST /requests/:id/needs-info e /cancel"
```

---

### Task 5: Nivelamento dos 3 novos eventos de notificação (backend)

**Files:**
- Modify: `apps/api/src/lib/default-templates.ts`
- Modify: `apps/api/src/workers/notification.worker.ts`
- Modify: `apps/api/src/modules/notifications/notifications.schema.ts`
- Modify: `apps/api/src/modules/notifications/notifications.service.ts`

**Interfaces:**
- Consumes: `NotificationEvent.REQUEST_NEEDS_INFO/REQUEST_COMMENT_ADDED/REQUEST_CANCELLED` (Task 1); `TemplateVars.commentText/commentAuthorName/requestTitle/rejectionReason` (já existentes em `@/lib/template.ts`, sem necessidade de novo campo).

- [ ] **Step 1: Adicionar os 3 templates default em `default-templates.ts`**

Adicionar ao final do objeto `DEFAULT_TEMPLATES`, depois de `DOCUMENT_REJECTED`:

```typescript
  REQUEST_NEEDS_INFO: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Precisamos de mais informações sobre sua solicitação *{{requestTitle}}*:\n\n"{{commentText}}"\n\nResponda por lá: {{portalUrl}}' },
    EMAIL: { subject: 'Precisamos de mais informações — {{requestTitle}}', body: 'Olá, {{clientName}}!\n\nPrecisamos de mais informações sobre sua solicitação *{{requestTitle}}*:\n\n"{{commentText}}"\n\nResponda em: {{portalUrl}}' },
  },
  REQUEST_COMMENT_ADDED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Novo comentário em sua solicitação *{{requestTitle}}*:\n\n"{{commentText}}"\n\n— {{commentAuthorName}}\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Novo comentário — {{requestTitle}}', body: 'Olá, {{clientName}}!\n\nNovo comentário em sua solicitação *{{requestTitle}}*:\n\n"{{commentText}}"\n\n— {{commentAuthorName}}\n\nAcompanhe em: {{portalUrl}}' },
  },
  REQUEST_CANCELLED: {
    WHATSAPP: { body: 'Olá, {{clientName}}! Sua solicitação *{{requestTitle}}*, já aprovada, foi cancelada pelo escritório.\n\nMotivo: {{rejectionReason}}\n\nAcompanhe: {{portalUrl}}' },
    EMAIL: { subject: 'Solicitação cancelada — {{requestTitle}}', body: 'Olá, {{clientName}}!\n\nSua solicitação *{{requestTitle}}*, já aprovada, foi cancelada pelo escritório.\n\nMotivo: {{rejectionReason}}\n\nAcompanhe em: {{portalUrl}}' },
  },
```

- [ ] **Step 2: Adicionar as 3 entradas em `EVENT_FLAG_MAP` em `notification.worker.ts`**

```typescript
const EVENT_FLAG_MAP: Record<string, keyof NotificationConfig> = {
  TASK_CREATED: 'taskCreated',
  TASK_MOVED: 'taskMoved',
  TASK_COMPLETED: 'taskCompleted',
  TASK_COMMENT_ADDED: 'commentAdded',
  TASK_BLOCKED: 'taskBlocked',
  REQUEST_CREATED: 'requestCreated',
  REQUEST_APPROVED: 'requestApproved',
  REQUEST_REJECTED: 'requestRejected',
  RECURRING_GENERATION_FAILED: 'recurringGenerationFailed',
  DOCUMENT_REJECTED: 'documentRejected',
  SLA_DIGEST: 'slaDigestEnabled',
  REQUEST_NEEDS_INFO: 'requestNeedsInfo',
  REQUEST_COMMENT_ADDED: 'requestCommentAdded',
  REQUEST_CANCELLED: 'requestCancelled',
}
```

- [ ] **Step 3: Adicionar os 3 campos em `updateConfigSchema` em `notifications.schema.ts`**

```typescript
export const updateConfigSchema = z.object({
  whatsappEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  taskCreated: z.boolean().optional(),
  taskMoved: z.boolean().optional(),
  taskCompleted: z.boolean().optional(),
  commentAdded: z.boolean().optional(),
  slaTargetWarningDays: z.number().int().min(0).max(90).optional(),
  slaDueCriticalDays: z.number().int().min(0).max(90).optional(),
  slaDigestEnabled: z.boolean().optional(),
  lateClosureThresholdDays: z.number().int().min(0).max(90).optional(),
  requestCreated: z.boolean().optional(),
  requestApproved: z.boolean().optional(),
  requestRejected: z.boolean().optional(),
  requestNeedsInfo: z.boolean().optional(),
  requestCommentAdded: z.boolean().optional(),
  requestCancelled: z.boolean().optional(),
  taskBlocked: z.boolean().optional(),
  recurringGenerationFailed: z.boolean().optional(),
  documentRejected: z.boolean().optional(),
  maximizebotToken: z.string().optional(),
  saveOnTicket: z.boolean().optional(),
  startChatbot: z.boolean().optional(),
})
```

- [ ] **Step 4: Adicionar os 3 campos ao `select` de `getConfig` em `notifications.service.ts`**

```typescript
export async function getConfig(organizationId: string) {
  const config = await prisma.notificationConfig.findUnique({
    where: { organizationId },
    select: {
      id: true,
      organizationId: true,
      whatsappEnabled: true,
      emailEnabled: true,
      taskCreated: true,
      taskMoved: true,
      taskCompleted: true,
      commentAdded: true,
      slaTargetWarningDays: true,
      slaDueCriticalDays: true,
      slaDigestEnabled: true,
      lateClosureThresholdDays: true,
      customSlaSoundLabel: true,
      requestCreated: true,
      requestApproved: true,
      requestRejected: true,
      requestNeedsInfo: true,
      requestCommentAdded: true,
      requestCancelled: true,
      taskBlocked: true,
      recurringGenerationFailed: true,
      documentRejected: true,
      saveOnTicket: true,
      startChatbot: true,
      createdAt: true,
      updatedAt: true,
      maximizebotToken: true, // fetched only to produce the masked preview
    },
  })

  if (!config) return null

  const { maximizebotToken, ...rest } = config
  return {
    ...rest,
    maximizebotTokenPreview: maximizebotToken ? maskToken(maximizebotToken) : null,
  }
}
```

- [ ] **Step 5: Rodar os testes de notificações e templates**

```bash
pnpm --filter api test notifications
```

Esperado: todos passando (nenhuma asserção pré-existente depende dos campos exatos de `getConfig`/`updateConfigSchema`, então não deve haver regressão).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/default-templates.ts apps/api/src/workers/notification.worker.ts apps/api/src/modules/notifications/notifications.schema.ts apps/api/src/modules/notifications/notifications.service.ts
git commit -m "feat(notifications): nivela REQUEST_NEEDS_INFO, REQUEST_COMMENT_ADDED e REQUEST_CANCELLED"
```

---

### Task 6: UI de configuração de notificações (frontend)

**Files:**
- Modify: `apps/web/src/pages/app/settings/Notifications.tsx`
- Modify: `apps/web/src/pages/app/settings/Templates.tsx`

**Interfaces:**
- Consumes: campos `requestNeedsInfo`, `requestCommentAdded`, `requestCancelled` do `Config` (retornados por `GET /notifications/config`, Task 5).

- [ ] **Step 1: Atualizar `Notifications.tsx`**

Na interface `Config` (linha ~12), adicionar os 3 campos após `requestRejected`:

```typescript
  requestCreated?: boolean
  requestApproved?: boolean
  requestRejected?: boolean
  requestNeedsInfo?: boolean
  requestCommentAdded?: boolean
  requestCancelled?: boolean
```

No `EVENT_LABEL` (linha ~43), adicionar:

```typescript
const EVENT_LABEL: Record<string, string> = {
  TASK_CREATED: 'Tarefa criada',
  TASK_MOVED: 'Tarefa movida',
  TASK_COMPLETED: 'Tarefa concluída',
  TASK_COMMENT_ADDED: 'Comentário adicionado',
  TASK_BLOCKED: 'Tarefa com impedimento',
  RECURRING_GENERATION_FAILED: 'Falha na geração de tarefa recorrente',
  DOCUMENT_REJECTED: 'Documento rejeitado',
  REQUEST_CREATED: 'Solicitação criada',
  REQUEST_APPROVED: 'Solicitação aprovada',
  REQUEST_REJECTED: 'Solicitação rejeitada',
  REQUEST_NEEDS_INFO: 'Solicitação precisa de mais informação',
  REQUEST_COMMENT_ADDED: 'Comentário em solicitação',
  REQUEST_CANCELLED: 'Solicitação cancelada (pós-aprovação)',
  SLA_DIGEST: 'Resumo diário de prazos',
}
```

Na seção "Eventos — Solicitações" (linha ~284), adicionar os 3 novos toggles após o de `requestRejected`:

```typescript
          <Section title="Eventos — Solicitações">
            <SwitchRow
              label="Solicitação criada"
              description="Notifica a equipe interna quando um cliente abre uma solicitação"
              checked={form.requestCreated ?? false}
              onChange={(v) => setForm({ ...form, requestCreated: v })}
            />
            <SwitchRow
              label="Solicitação aprovada"
              description="Notifica o cliente quando a solicitação dele é aprovada"
              checked={form.requestApproved ?? false}
              onChange={(v) => setForm({ ...form, requestApproved: v })}
            />
            <SwitchRow
              label="Solicitação rejeitada"
              description="Notifica o cliente quando a solicitação dele não é aprovada"
              checked={form.requestRejected ?? false}
              onChange={(v) => setForm({ ...form, requestRejected: v })}
            />
            <SwitchRow
              label="Precisa de mais informação"
              description="Notifica o cliente quando a equipe pede mais detalhes sobre a solicitação dele"
              checked={form.requestNeedsInfo ?? false}
              onChange={(v) => setForm({ ...form, requestNeedsInfo: v })}
            />
            <SwitchRow
              label="Comentário em solicitação"
              description="Notifica quando alguém comenta em uma solicitação"
              checked={form.requestCommentAdded ?? false}
              onChange={(v) => setForm({ ...form, requestCommentAdded: v })}
            />
            <SwitchRow
              label="Solicitação cancelada"
              description="Notifica o cliente quando uma solicitação já aprovada é cancelada pelo escritório"
              checked={form.requestCancelled ?? false}
              onChange={(v) => setForm({ ...form, requestCancelled: v })}
            />
          </Section>
```

- [ ] **Step 2: Atualizar `Templates.tsx`**

```typescript
const EVENTS = [
  'TASK_CREATED', 'TASK_MOVED', 'TASK_COMPLETED', 'TASK_COMMENT_ADDED', 'TASK_BLOCKED',
  'DOCUMENT_REJECTED', 'REQUEST_CREATED', 'REQUEST_APPROVED', 'REQUEST_REJECTED',
  'REQUEST_NEEDS_INFO', 'REQUEST_COMMENT_ADDED', 'REQUEST_CANCELLED',
  'RECURRING_GENERATION_FAILED', 'SLA_DIGEST',
] as const
const CHANNELS = ['WHATSAPP', 'EMAIL'] as const

const EVENT_LABEL: Record<string, string> = {
  TASK_CREATED: 'Tarefa criada',
  TASK_MOVED: 'Tarefa movida',
  TASK_COMPLETED: 'Tarefa concluída',
  TASK_COMMENT_ADDED: 'Comentário adicionado',
  TASK_BLOCKED: 'Tarefa com impedimento',
  DOCUMENT_REJECTED: 'Documento rejeitado',
  REQUEST_CREATED: 'Solicitação criada',
  REQUEST_APPROVED: 'Solicitação aprovada',
  REQUEST_REJECTED: 'Solicitação rejeitada',
  REQUEST_NEEDS_INFO: 'Solicitação precisa de mais informação',
  REQUEST_COMMENT_ADDED: 'Comentário em solicitação',
  REQUEST_CANCELLED: 'Solicitação cancelada (pós-aprovação)',
  RECURRING_GENERATION_FAILED: 'Falha na geração de tarefa recorrente',
  SLA_DIGEST: 'Resumo diário de prazos',
}
```

- [ ] **Step 3: Verificar tipos**

```bash
pnpm --filter web exec tsc --noEmit
```

Esperado: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/app/settings/Notifications.tsx apps/web/src/pages/app/settings/Templates.tsx
git commit -m "feat(notifications): expõe os 3 novos eventos de solicitação na UI de configuração"
```

---

### Task 7: Generalizar `Comments` para `entityType: 'task' | 'request'`

**Files:**
- Modify: `apps/web/src/components/shared/Comments.tsx`
- Modify: `apps/web/src/components/shared/TaskDrawer.tsx:468`
- Modify: `apps/web/src/components/portal/Comments.test.tsx`

**Interfaces:**
- Produces: `<Comments entityType="task" entityId={task.id} currentUserId role />` e `<Comments entityType="request" entityId={request.id} currentUserId role />` — consumido por Task 9/10.

- [ ] **Step 1: Reescrever `Comments.tsx`**

```typescript
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Comment, DrawerRole } from '@/types'
import { toast } from 'sonner'

type EntityType = 'task' | 'request'

interface Props {
  entityType: EntityType
  entityId: string
  currentUserId: string
  role: DrawerRole
}

const CAN_SEE_DELETED = new Set<DrawerRole>(['ORG_ADMIN', 'ORG_MANAGER'])

function basePath(entityType: EntityType, entityId: string): string {
  return entityType === 'task' ? `/tasks/${entityId}/comments` : `/requests/${entityId}/comments`
}

function deletePath(entityType: EntityType, commentId: string): string {
  return entityType === 'task' ? `/comments/${commentId}` : `/request-comments/${commentId}`
}

export function Comments({ entityType, entityId, currentUserId, role }: Props) {
  const queryClient = useQueryClient()
  const [content, setContent] = useState('')
  const queryKey = [entityType === 'task' ? 'comments' : 'request-comments', entityId]

  const { data: comments = [] } = useQuery<Comment[]>({
    queryKey,
    queryFn: () => api.get(basePath(entityType, entityId)).then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(basePath(entityType, entityId), { content }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Comentário adicionado')
      queryClient.invalidateQueries({ queryKey })
      setContent('')
    },
    onError: () => toast.error('Erro ao adicionar comentário'),
  })

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) =>
      api.delete(deletePath(entityType, commentId)).then((r) => r.data),
    onSuccess: () => {
      toast.success('Comentário removido')
      queryClient.invalidateQueries({ queryKey })
    },
    onError: () => toast.error('Erro ao remover comentário'),
  })

  function canDelete(c: Comment) {
    if (c.deletedAt) return false
    if (role === 'CLIENT') return c.client?.id === currentUserId
    if (role === 'ORG_ADMIN' || role === 'ORG_MANAGER') return true
    return c.user?.id === currentUserId
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-2">
        {comments.map((c) => {
          const isClient = c.authorType === 'CLIENT'
          const author = isClient ? c.client : c.user
          const isDeleted = !!c.deletedAt

          return (
            <div
              key={c.id}
              className={cn(
                'rounded-lg p-3 border-l-2',
                isClient ? 'bg-blue-50 border-blue-400' : 'bg-violet-50 border-violet-400',
                isDeleted && 'opacity-60',
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={cn('text-xs font-semibold', isClient ? 'text-blue-700' : 'text-violet-700')}>
                  {author?.name ?? (isClient ? 'Cliente' : 'Colaborador')}
                  {isClient && <span className="ml-1 text-blue-500 font-normal">(cliente)</span>}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {new Date(c.createdAt).toLocaleString('pt-BR')}
                  </span>
                  {canDelete(c) && (
                    <button
                      type="button"
                      onClick={() => deleteMutation.mutate(c.id)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>

              {isDeleted ? (
                <div>
                  <p className="text-xs text-muted-foreground italic">
                    Comentário removido em {new Date(c.deletedAt!).toLocaleString('pt-BR')}
                  </p>
                  {CAN_SEE_DELETED.has(role) && c.deletedContent && (
                    <details className="mt-1">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        Ver conteúdo removido
                      </summary>
                      <p className="text-sm text-muted-foreground mt-1 line-through">{c.deletedContent}</p>
                    </details>
                  )}
                </div>
              ) : (
                <p className="text-sm text-foreground">{c.content}</p>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 items-start mt-1">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Adicionar comentário..."
          rows={2}
          className="flex-1 rounded-md border border-border bg-surface text-foreground px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent resize-none"
        />
        <Button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || !content.trim()}
          size="sm"
        >
          Enviar
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Atualizar o call site em `TaskDrawer.tsx:468`**

```typescript
          {tab === 'comments' && (
            <Comments entityType="task" entityId={task.id} currentUserId={currentUserId} role={role} />
          )}
```

- [ ] **Step 3: Atualizar `Comments.test.tsx`** (`apps/web/src/components/portal/Comments.test.tsx`)

```typescript
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { Comments } from '@/components/portal/Comments'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const existingComments = [
  {
    id: 'c1',
    content: 'Processo iniciado',
    authorType: 'USER',
    user: { id: 'u1', name: 'João Escrit.' },
    client: null,
    createdAt: '2024-01-01T10:00:00.000Z',
  },
]

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  )
}

it('lista comentários existentes com nome do autor', async () => {
  server.use(
    http.get('http://localhost:3000/tasks/task-1/comments', () =>
      HttpResponse.json(existingComments),
    ),
  )
  render(<Comments entityType="task" entityId="task-1" currentUserId="cl1" role="CLIENT" />, { wrapper })
  await waitFor(() => expect(screen.getByText('Processo iniciado')).toBeInTheDocument())
  expect(screen.getByText('João Escrit.')).toBeInTheDocument()
})

it('submits POST /tasks/:taskId/comments com content correto', async () => {
  let capturedBody: unknown
  server.use(
    http.get('http://localhost:3000/tasks/task-1/comments', () => HttpResponse.json([])),
    http.post('http://localhost:3000/tasks/task-1/comments', async ({ request }) => {
      capturedBody = await request.json()
      return HttpResponse.json({
        id: 'c2',
        content: 'Meu comentário',
        authorType: 'CLIENT',
        user: null,
        client: { id: 'cl1', name: 'Empresa ABC' },
        createdAt: new Date().toISOString(),
      })
    }),
  )

  render(<Comments entityType="task" entityId="task-1" currentUserId="cl1" role="CLIENT" />, { wrapper })
  await waitFor(() => screen.getByPlaceholderText('Adicionar comentário...'))

  const textarea = screen.getByPlaceholderText('Adicionar comentário...')
  await userEvent.type(textarea, 'Meu comentário')
  await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))

  await waitFor(() => {
    expect(capturedBody).toMatchObject({ content: 'Meu comentário' })
  })
})

it('entityType="request" lê e grava em /requests/:id/comments', async () => {
  let capturedBody: unknown
  server.use(
    http.get('http://localhost:3000/requests/req-1/comments', () => HttpResponse.json([])),
    http.post('http://localhost:3000/requests/req-1/comments', async ({ request }) => {
      capturedBody = await request.json()
      return HttpResponse.json({
        id: 'rc1',
        content: 'Follow-up',
        authorType: 'CLIENT',
        user: null,
        client: { id: 'cl1', name: 'Empresa ABC' },
        createdAt: new Date().toISOString(),
      })
    }),
  )

  render(<Comments entityType="request" entityId="req-1" currentUserId="cl1" role="CLIENT" />, { wrapper })
  await waitFor(() => screen.getByPlaceholderText('Adicionar comentário...'))

  const textarea = screen.getByPlaceholderText('Adicionar comentário...')
  await userEvent.type(textarea, 'Follow-up')
  await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))

  await waitFor(() => {
    expect(capturedBody).toMatchObject({ content: 'Follow-up' })
  })
})
```

- [ ] **Step 4: Rodar os testes do componente**

```bash
pnpm --filter web test Comments
```

Esperado: todos passando.

- [ ] **Step 5: Verificar tipos**

```bash
pnpm --filter web exec tsc --noEmit
```

Esperado: sem erros (confirma que não restou nenhum outro call site de `<Comments taskId=.../>` com a prop antiga).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/shared/Comments.tsx apps/web/src/components/shared/TaskDrawer.tsx apps/web/src/components/portal/Comments.test.tsx
git commit -m "refactor(comments): generaliza Comments para entityType task|request"
```

---

### Task 8: `types/index.ts` — `ClientRequest` com NEEDS_INFO, boardId, cancelamento

**Files:**
- Modify: `apps/web/src/types/index.ts`

**Interfaces:**
- Produces: `ClientRequest` com os campos usados por Task 9/10.

- [ ] **Step 1: Atualizar a interface `ClientRequest`**

```typescript
export interface ClientRequest {
  id: string
  title: string
  description: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'NEEDS_INFO'
  rejectionReason: string | null
  taskId: string | null
  boardId: string | null
  departmentId: string | null
  cancelledByType: 'USER' | 'CLIENT' | null
  cancellationReason: string | null
  createdAt: string
  attachments?: RequestAttachment[]
  client?: { id: string; name: string }
}
```

- [ ] **Step 2: Verificar tipos**

```bash
pnpm --filter web exec tsc --noEmit
```

Esperado: erros apontando os lugares que usam `STATUS_LABEL`/`STATUS_STYLE` com `Record<ClientRequest['status'], string>` sem a chave `NEEDS_INFO` — confirma que Task 9/10 são necessárias (serão corrigidos lá). Se não houver essa dependência circular de tasks, é aceitável ver esses erros nesta etapa; eles são resolvidos nas Tasks 9 e 10.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/types/index.ts
git commit -m "feat(types): ClientRequest ganha NEEDS_INFO, boardId e campos de cancelamento"
```

---

### Task 9: `app/Requests.tsx` — pedir mais informação, cancelar pós-aprovação, link do processo, thread

**Files:**
- Modify: `apps/web/src/pages/app/Requests.tsx`

**Interfaces:**
- Consumes: `POST /requests/:id/needs-info`, `POST /requests/:id/cancel` (Task 4); `Comments` com `entityType="request"` (Task 7); `ClientRequest.boardId/status/cancellationReason` (Task 8).

- [ ] **Step 1: Reescrever `apps/web/src/pages/app/Requests.tsx`**

```typescript
import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Comments } from '@/components/shared/Comments'
import { cn } from '@/lib/utils'
import { Inbox, Search, X, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import type { ClientRequest, Board } from '@/types'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/useAuth'

const STATUS_LABEL: Record<ClientRequest['status'], string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada',
  NEEDS_INFO: 'Precisa de informação',
}

const STATUS_STYLE: Record<ClientRequest['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
  NEEDS_INFO: 'bg-blue-100 text-blue-700',
}

type Mode = 'NEW_BOARD' | 'EXISTING_BOARD'

export default function Requests() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [statusFilter, setStatusFilter] = useState<ClientRequest['status'] | ''>('PENDING')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [approving, setApproving] = useState<ClientRequest | null>(null)
  const [rejecting, setRejecting] = useState<ClientRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [needsInfoTarget, setNeedsInfoTarget] = useState<ClientRequest | null>(null)
  const [needsInfoComment, setNeedsInfoComment] = useState('')
  const [cancelling, setCancelling] = useState<ClientRequest | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [mode, setMode] = useState<Mode>('NEW_BOARD')
  const [boardId, setBoardId] = useState('')
  const [columnId, setColumnId] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: requests = [], isLoading } = useQuery<ClientRequest[]>({
    queryKey: ['requests', statusFilter],
    queryFn: () => api.get('/requests', { params: statusFilter ? { status: statusFilter } : {} }).then((r) => r.data),
  })

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (search) {
        const q = search.toLowerCase()
        const matchesTitle = r.title.toLowerCase().includes(q)
        const matchesClient = (r.client?.name ?? '').toLowerCase().includes(q)
        if (!matchesTitle && !matchesClient) return false
      }
      if (dateFrom && new Date(r.createdAt) < new Date(dateFrom + 'T00:00:00')) return false
      if (dateTo && new Date(r.createdAt) > new Date(dateTo + 'T23:59:59')) return false
      return true
    })
  }, [requests, search, dateFrom, dateTo])

  const hasActiveFilter = !!search || !!dateFrom || !!dateTo

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

  const needsInfoMutation = useMutation({
    mutationFn: () => api.post(`/requests/${needsInfoTarget!.id}/needs-info`, { comment: needsInfoComment }),
    onSuccess: () => {
      toast.success('Pedido de informação enviado ao cliente')
      qc.invalidateQueries({ queryKey: ['requests'] })
      setNeedsInfoTarget(null)
      setNeedsInfoComment('')
    },
    onError: () => toast.error('Erro ao pedir mais informação'),
  })

  const cancelApprovedMutation = useMutation({
    mutationFn: () => api.post(`/requests/${cancelling!.id}/cancel`, { reason: cancelReason }),
    onSuccess: () => {
      toast.success('Solicitação cancelada')
      qc.invalidateQueries({ queryKey: ['requests'] })
      setCancelling(null)
      setCancelReason('')
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } }).response?.status
      if (status === 409) {
        toast.error('Essa tarefa já teve movimentação — não pode ser cancelada por aqui')
      } else {
        toast.error('Erro ao cancelar solicitação')
      }
    },
  })

  if (isLoading) return <div className="p-8 text-muted-foreground">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Solicitações dos Clientes</h1>
      </div>

      <div className="flex rounded-md border border-border overflow-hidden w-fit flex-wrap">
        {(['PENDING', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'CANCELLED', ''] as const).map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={cn(
              'px-3 py-1.5 text-sm font-medium transition-colors',
              statusFilter === s ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground hover:bg-neutral-bg',
            )}
          >
            {s ? STATUS_LABEL[s] : 'Todas'}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por cliente ou título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 border-border focus:ring-accent"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Label htmlFor="req-date-from" className="text-xs text-muted-foreground whitespace-nowrap">De</Label>
          <Input
            id="req-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-36 border-border"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Label htmlFor="req-date-to" className="text-xs text-muted-foreground whitespace-nowrap">Até</Label>
          <Input
            id="req-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-36 border-border"
          />
        </div>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }}
            className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <X size={13} />
            Limpar
          </button>
        )}
      </div>

      {requests.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {filtered.length === requests.length
            ? `${requests.length} solicitação${requests.length !== 1 ? 'ões' : ''}`
            : `Exibindo ${filtered.length} de ${requests.length}`}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <Inbox size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">
            {requests.length === 0 ? 'Nenhuma solicitação encontrada' : 'Nenhuma solicitação encontrada para este filtro'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const isExpanded = expandedId === r.id
            return (
              <div key={r.id} className="bg-surface rounded-lg border border-border px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{r.client?.name}</p>
                    {r.description && <p className="text-xs text-muted-foreground mt-1">{r.description}</p>}
                    {r.status === 'CANCELLED' && r.cancelledByType === 'USER' && r.cancellationReason && (
                      <p className="text-xs text-gray-500 mt-1 italic">Cancelada pelo escritório — motivo: {r.cancellationReason}</p>
                    )}
                  </div>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full flex-shrink-0', STATUS_STYLE[r.status])}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>

                <div className="flex gap-2 mt-2 items-center flex-wrap">
                  {r.status === 'PENDING' && (
                    <>
                      <Button size="sm" onClick={() => setApproving(r)} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
                        Aprovar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRejecting(r)} className="text-red-600 border-red-200 hover:bg-red-50">
                        Rejeitar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setNeedsInfoTarget(r)}>
                        Pedir mais informação
                      </Button>
                    </>
                  )}
                  {r.status === 'NEEDS_INFO' && (
                    <>
                      <Button size="sm" onClick={() => setApproving(r)} className="bg-[#185FA5] hover:bg-[#0C447C] text-white">
                        Aprovar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRejecting(r)} className="text-red-600 border-red-200 hover:bg-red-50">
                        Rejeitar
                      </Button>
                    </>
                  )}
                  {r.status === 'APPROVED' && (
                    <Button size="sm" variant="outline" onClick={() => setCancelling(r)} className="text-red-600 border-red-200 hover:bg-red-50">
                      Cancelar
                    </Button>
                  )}
                  {r.boardId && (
                    <Link
                      to={`/app/board/${r.boardId}`}
                      className="text-xs text-[#185FA5] hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink size={12} />
                      Abrir processo
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 ml-auto"
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    Comentários
                  </button>
                </div>

                {isExpanded && user && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <Comments
                      entityType="request"
                      entityId={r.id}
                      currentUserId={user.id}
                      role={user.role as 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal de aprovação */}
      <Dialog open={!!approving} onOpenChange={(open) => { if (!open) setApproving(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Aprovar solicitação</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="flex rounded-md border border-border overflow-hidden w-fit">
              <button
                type="button"
                onClick={() => setMode('NEW_BOARD')}
                className={cn('px-3 py-1.5 text-sm font-medium', mode === 'NEW_BOARD' ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground')}
              >
                Criar novo processo
              </button>
              <button
                type="button"
                onClick={() => setMode('EXISTING_BOARD')}
                className={cn('px-3 py-1.5 text-sm font-medium', mode === 'EXISTING_BOARD' ? 'bg-[#185FA5] text-white' : 'bg-surface text-muted-foreground')}
              >
                Anexar a processo existente
              </button>
            </div>

            {mode === 'NEW_BOARD' && (
              <p className="text-xs text-muted-foreground">
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
                    className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm"
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
                      className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm"
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
                className="flex w-full rounded-md border border-border bg-surface text-foreground px-3 py-2 text-sm resize-none"
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

      {/* Modal de "pedir mais informação" */}
      <Dialog open={!!needsInfoTarget} onOpenChange={(open) => { if (!open) setNeedsInfoTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Pedir mais informação</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="needs-info-comment">O que você precisa saber?</Label>
              <textarea
                id="needs-info-comment"
                rows={3}
                value={needsInfoComment}
                onChange={(e) => setNeedsInfoComment(e.target.value)}
                className="flex w-full rounded-md border border-border bg-surface text-foreground px-3 py-2 text-sm resize-none"
                placeholder="Ex: Qual o CNPJ da empresa?"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setNeedsInfoTarget(null)}>Cancelar</Button>
              <Button
                onClick={() => needsInfoMutation.mutate()}
                disabled={needsInfoMutation.isPending || !needsInfoComment.trim()}
                className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
              >
                {needsInfoMutation.isPending ? 'Enviando...' : 'Enviar pedido'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de cancelamento pós-aprovação */}
      <Dialog open={!!cancelling} onOpenChange={(open) => { if (!open) setCancelling(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Cancelar solicitação aprovada</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-xs text-muted-foreground">
              A tarefa criada a partir desta solicitação será marcada como desconsiderada. Só é possível cancelar se a tarefa ainda não teve nenhuma movimentação (comentário, anexo ou mudança de coluna).
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="cancel-reason">Motivo (obrigatório)</Label>
              <textarea
                id="cancel-reason"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="flex w-full rounded-md border border-border bg-surface text-foreground px-3 py-2 text-sm resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setCancelling(null)}>Voltar</Button>
              <Button
                onClick={() => cancelApprovedMutation.mutate()}
                disabled={cancelApprovedMutation.isPending || !cancelReason.trim()}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {cancelApprovedMutation.isPending ? 'Cancelando...' : 'Confirmar cancelamento'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

Nota: `useAuth()` (`@/hooks/useAuth.ts`) já existe e expõe `{ user: { id, name, role: string, ... } | null }` lido do `localStorage`. `role` vem como `string` solto, por isso o cast `as 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'` acima — mesmo padrão já usado em `apps/web/src/pages/app/Board.tsx:318` ao passar `role` pro `TaskDrawer`.

- [ ] **Step 2: Verificar tipos**

```bash
pnpm --filter web exec tsc --noEmit
```

Esperado: sem erros. Se `useAuth` não existir com esse formato, corrigir o import/acesso antes de prosseguir (não deixar a tela sem `currentUserId`/`role` reais).

- [ ] **Step 3: Rodar o dev server e testar manualmente**

```bash
pnpm --filter web dev
```

Validar: filtro por `NEEDS_INFO` aparece e funciona; "Pedir mais informação" cria o comentário e move pra NEEDS_INFO; "Cancelar" numa request `APPROVED` sem atividade funciona e mostra erro amigável quando a task já teve atividade (409); link "Abrir processo" navega pro board certo; thread de comentários expande/recolhe e envia mensagens.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/app/Requests.tsx
git commit -m "feat(requests): UI de pedir informação, cancelar pós-aprovação, link do processo e thread"
```

---

### Task 10: `portal/Requests.tsx` — badge NEEDS_INFO, thread, link do processo, motivo de cancelamento

**Files:**
- Modify: `apps/web/src/pages/portal/Requests.tsx`

**Interfaces:**
- Consumes: `Comments` com `entityType="request"` (Task 7); `ClientRequest.boardId/cancellationReason/cancelledByType` (Task 8); `usePortalClient()` já existente no arquivo para `clientId`/contexto de usuário logado do portal.

- [ ] **Step 1: Reescrever `apps/web/src/pages/portal/Requests.tsx`**

```typescript
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Comments } from '@/components/shared/Comments'
import { cn } from '@/lib/utils'
import { Plus, Inbox, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import type { ClientRequest } from '@/types'
import { toast } from 'sonner'
import { usePortalClient } from './Layout'

const STATUS_LABEL: Record<ClientRequest['status'], string> = {
  PENDING: 'Em análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Não aprovada',
  CANCELLED: 'Cancelada',
  NEEDS_INFO: 'Aguardando resposta',
}

const STATUS_STYLE: Record<ClientRequest['status'], string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
  NEEDS_INFO: 'bg-blue-100 text-blue-700',
}

export default function PortalRequests() {
  const qc = useQueryClient()
  const { clientId } = usePortalClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', description: '', departmentId: '', osTemplateId: '' })
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: requests = [], isLoading } = useQuery<ClientRequest[]>({
    queryKey: ['portal-requests', clientId],
    queryFn: () => api.get('/portal/requests', { params: { clientId } }).then((r) => r.data),
    enabled: !!clientId,
  })

  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['portal-departments'],
    queryFn: () => api.get('/portal/departments').then((r) => r.data),
  })

  const { data: osTemplates = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['portal-os-templates'],
    queryFn: () => api.get('/portal/os-templates').then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () => api.post('/portal/requests', {
      clientId,
      title: form.title,
      description: form.description,
      departmentId: form.departmentId || undefined,
      osTemplateId: form.osTemplateId || undefined,
    }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Solicitação enviada')
      qc.invalidateQueries({ queryKey: ['portal-requests'] })
      setOpen(false)
      setForm({ title: '', description: '', departmentId: '', osTemplateId: '' })
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

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Minhas Solicitações</h1>
        <Button onClick={() => setOpen(true)} className="bg-[#185FA5] hover:bg-[#0C447C] text-white gap-2">
          <Plus size={16} />
          Nova solicitação
        </Button>
      </div>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <Inbox size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhuma solicitação ainda</p>
          <p className="text-xs mt-1">Use o botão acima para pedir algo ao seu escritório.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => {
            const isExpanded = expandedId === r.id
            return (
              <div key={r.id} className="bg-surface rounded-lg border border-border px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{r.title}</p>
                    {r.description && <p className="text-xs text-muted-foreground mt-0.5">{r.description}</p>}
                    {r.status === 'REJECTED' && r.rejectionReason && (
                      <p className="text-xs text-red-500 mt-1 italic">Motivo: {r.rejectionReason}</p>
                    )}
                    {r.status === 'CANCELLED' && r.cancelledByType === 'USER' && r.cancellationReason && (
                      <p className="text-xs text-gray-500 mt-1 italic">Cancelada pelo escritório — motivo: {r.cancellationReason}</p>
                    )}
                  </div>
                  <span className={cn('text-xs px-2 py-0.5 rounded-full flex-shrink-0', STATUS_STYLE[r.status])}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>

                <div className="flex gap-2 mt-2 items-center flex-wrap">
                  {(r.status === 'PENDING' || r.status === 'NEEDS_INFO') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { if (window.confirm('Cancelar esta solicitação?')) cancelMutation.mutate(r.id) }}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 -ml-2"
                    >
                      Cancelar
                    </Button>
                  )}
                  {r.boardId && (
                    <Link
                      to={`/portal/board/${r.boardId}`}
                      className="text-xs text-[#185FA5] hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink size={12} />
                      Ver processo
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 ml-auto"
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    Comentários
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <Comments entityType="request" entityId={r.id} currentUserId={clientId} role="CLIENT" />
                  </div>
                )}
              </div>
            )
          })}
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
              <Label htmlFor="req-os-template">Tipo de solicitação</Label>
              <select
                id="req-os-template"
                value={form.osTemplateId}
                onChange={(e) => setForm({ ...form, osTemplateId: e.target.value })}
                className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">Outro</option>
                {osTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
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
                className="flex w-full rounded-md border border-border bg-surface text-foreground px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="req-department">Departamento (opcional)</Label>
              <select
                id="req-department"
                value={form.departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                className="flex h-9 w-full rounded-md border border-border bg-surface text-foreground px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">Não sei / Geral</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
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

Nota: o link "Ver processo" usa `/portal/board/${r.boardId}` — a única rota de detalhe de processo que existe no portal (`apps/web/src/router.tsx:243`, `{ path: 'board/:boardId', element: <PortalBoard /> }`); não há rota de detalhe de task isolada no portal, só o board completo. `currentUserId={clientId}` no `Comments` segue o mesmo valor que o portal já usa pra identificar o autor "cliente" nos comentários de Task — `canDelete` compara `c.client?.id === currentUserId` contra `Client.id`, não `ClientUser.id`, e `clientId` aqui já é o `Client.id` resolvido por `usePortalClient()`.

- [ ] **Step 2: Verificar tipos e rodar testes de componentes do portal**

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web test portal
```

Esperado: sem erros de tipo; testes de portal passando.

- [ ] **Step 3: Testar manualmente no dev server**

```bash
pnpm --filter web dev
```

Validar como cliente: status `NEEDS_INFO` aparece com label "Aguardando resposta"; cancelar funciona em `PENDING` e `NEEDS_INFO`, mas o botão não aparece em `APPROVED`; link "Ver processo" aparece só quando `boardId` existe; comentar numa request `NEEDS_INFO` reverte pra "Em análise" após recarregar a lista.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/portal/Requests.tsx
git commit -m "feat(portal): badge NEEDS_INFO, thread de comentários, link do processo e motivo de cancelamento"
```

---

### Task 11: Atualizar `docs/TASKS.md` e verificação final completa

**Files:**
- Modify: `docs/TASKS.md`

**Interfaces:** nenhuma — tarefa de fechamento.

- [ ] **Step 1: Marcar o item 5 do roadmap como concluído em `docs/TASKS.md`**

Localizar a entrada "5. Evolução de Solicitações → Ordem de Serviço" (ou equivalente) e marcar como concluída, seguindo o mesmo padrão usado para os itens anteriores do roadmap já fechados nesta sessão (SLA, Métricas de produtividade).

- [ ] **Step 2: Rodar a suíte completa da API**

```bash
pnpm --filter api test
```

Esperado: todos os testes passando, incluindo os pré-existentes (nenhuma regressão em `requests`, `comments`, `notifications`, `dashboard`, etc).

- [ ] **Step 3: Rodar a suíte completa do frontend**

```bash
pnpm --filter web test
```

Esperado: todos os testes passando.

- [ ] **Step 4: Rodar typecheck completo dos dois workspaces**

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter web exec tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 5: Build de produção do frontend (sanity check)**

```bash
pnpm --filter web build
```

Esperado: build concluído sem erros.

- [ ] **Step 6: Commit final**

```bash
git add docs/TASKS.md
git commit -m "docs: marca Evolução de Solicitações → OS como concluído no roadmap"
```

---

## Self-Review (preenchido durante a escrita do plano)

**1. Cobertura da spec:** link pós-aprovação (admin+portal) → Task 9/10 via `boardId`; status `NEEDS_INFO` → Task 1 (schema) + 3 (`markNeedsInfo`) + 4 (rota) + 9/10 (UI); `RequestComment` + auto-revert → Task 2 (módulo) + 9/10 (UI); cancelamento pós-aprovação com trava de atividade e motivo obrigatório → Task 1 (campos) + 3 (`cancelApprovedRequest`) + 4 (rota) + 9 (UI); 3 novos eventos de notificação → Task 5 (backend) + 6 (UI). Todas as linhas da tabela de decisões da spec têm uma task correspondente.

**2. Placeholder scan:** nenhum "TBD"/"implementar depois" — `useAuth()` (Task 9) e a rota `/portal/board/:boardId` (Task 10) foram confirmados lendo o código-fonte durante a escrita deste plano, não deixados como suposição.

**3. Consistência de tipos:** `markNeedsInfo`/`cancelApprovedRequest` (Task 3) usados com a mesma assinatura em Task 4 (rotas) e Task 3 (testes); `entityType`/`entityId` (Task 7) usados identicamente em Task 9 e 10; `ClientRequest.boardId/cancelledByType/cancellationReason` (Task 8) consumidos exatamente como declarados nas Tasks 9/10.

**4. Review Focus:** as 5 situações listadas (cancelamento com atividade, comentário do cliente revertendo status, comentário da equipe não revertendo, departmentId nulo, transição de status inválida) têm teste dedicado nas Tasks 2 e 3.
