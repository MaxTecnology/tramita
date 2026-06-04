# TaskDrawer Unificado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o `TaskModal` (colaboradores) e refatorar o `portal/TaskDrawer` (clientes) em um único componente `TaskDrawer` compartilhado, com comentários com soft delete, upload de anexo por cliente, e endpoint de histórico para ORG roles.

**Architecture:** Um componente `components/shared/TaskDrawer.tsx` com prop `role` que controla quais elementos são editáveis vs. read-only. O backend recebe dois schema migrations independentes e ajustes de serviço. O portal e o board interno passam a usar o mesmo componente.

**Tech Stack:** Fastify v5, Prisma v6, React 19, TanStack Query, TailwindCSS v4, shadcn/ui

---

## Mapa de Arquivos

**Backend — criar/modificar:**
- `apps/api/prisma/schema.prisma` — adicionar campos de soft delete em Comment e client uploader em Attachment
- `apps/api/src/modules/comments/comments.service.ts` — soft delete + listagem condicional por role
- `apps/api/src/modules/comments/comments.routes.ts` — passar role para listComments e deleteComment
- `apps/api/src/modules/attachments/attachments.routes.ts` — liberar CLIENT no POST, passar actorId/role no DELETE
- `apps/api/src/modules/attachments/attachments.service.ts` — suportar uploadedByClient e permissão de delete do cliente
- `apps/api/src/modules/tasks/tasks.service.ts` — adicionar getTaskHistory()
- `apps/api/src/modules/tasks/tasks.routes.ts` — adicionar GET /tasks/:id/history

**Frontend — criar/modificar:**
- `apps/web/src/types/index.ts` — tipos Comment, Attachment, TaskHistory atualizados
- `apps/web/src/components/shared/TaskDrawer.tsx` — novo componente unificado
- `apps/web/src/components/shared/Comments.tsx` — componente de comentários com soft delete
- `apps/web/src/components/portal/Comments.tsx` — re-exporta de shared
- `apps/web/src/components/portal/TaskDrawer.tsx` — wrapper fino que usa shared
- `apps/web/src/components/TaskModal.tsx` — removido
- `apps/web/src/pages/app/Board.tsx` — troca TaskModal por TaskDrawer
- `apps/web/src/pages/portal/Board.tsx` — usa novo TaskDrawer via portal/TaskDrawer

---

## Task 1: Migration — Soft delete em Comment

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Adicionar campos ao model Comment**

Em `apps/api/prisma/schema.prisma`, substituir o model Comment por:

```prisma
model Comment {
  id             String            @id @default(cuid())
  content        String
  taskId         String
  authorType     CommentAuthorType
  userId         String?
  clientId       String?
  deletedAt      DateTime?
  deletedBy      String?
  deletedByType  String?           // "USER" | "CLIENT"
  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  task   Task    @relation(fields: [taskId], references: [id], onDelete: Cascade)
  user   User?   @relation(fields: [userId], references: [id])
  client Client? @relation(fields: [clientId], references: [id])

  @@map("comments")
}
```

- [ ] **Criar a migration**

```bash
cd apps/api && pnpm prisma migrate dev --name add_soft_delete_to_comments
```

Esperado: migration criada e aplicada sem erros.

- [ ] **Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat: soft delete fields on Comment model"
```

---

## Task 2: Migration — Client uploader em Attachment

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Alterar model Attachment**

Em `apps/api/prisma/schema.prisma`, substituir o model Attachment por:

```prisma
model Attachment {
  id               String   @id @default(cuid())
  taskId           String
  filename         String
  mimeType         String
  size             Int
  storageKey       String
  uploadedBy       String?
  uploadedByClient String?
  createdAt        DateTime @default(now())

  task           Task    @relation(fields: [taskId], references: [id], onDelete: Cascade)
  uploader       User?   @relation(fields: [uploadedBy], references: [id])
  uploaderClient Client? @relation(fields: [uploadedByClient], references: [id])

  @@map("attachments")
}
```

- [ ] **Criar a migration**

```bash
cd apps/api && pnpm prisma migrate dev --name add_client_uploader_to_attachments
```

Esperado: migration criada e aplicada sem erros. A coluna `uploadedBy` vira nullable sem perda de dados (valor NULL para linhas existentes não há, mas o tipo muda).

- [ ] **Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat: nullable uploadedBy and uploadedByClient on Attachment"
```

---

## Task 3: Backend — Soft delete em comments.service.ts

**Files:**
- Modify: `apps/api/src/modules/comments/comments.service.ts`
- Modify: `apps/api/src/modules/comments/comments.routes.ts`

- [ ] **Escrever o teste de soft delete**

Criar `apps/api/src/modules/comments/comments.service.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { deleteComment, listComments } from './comments.service'

// Setup: cria org, client, user, board, column, task antes de cada teste
// (reutilize helpers de outros testes de integração se existirem)

describe('deleteComment - soft delete', () => {
  it('marca deletedAt em vez de remover o registro', async () => {
    // arrange: cria comentário no banco
    const org = await prisma.organization.create({
      data: { name: 'Org', slug: 'org', email: 'o@o.com', planId: (await prisma.plan.findFirst())!.id },
    })
    const user = await prisma.user.create({
      data: { name: 'João', email: 'j@j.com', password: 'x', role: 'ORG_ADMIN', organizationId: org.id },
    })
    const client = await prisma.client.create({
      data: { name: 'Empresa X', email: 'x@x.com', organizationId: org.id },
    })
    const board = await prisma.board.create({
      data: { title: 'B', organizationId: org.id, clientId: client.id, creatorId: user.id },
    })
    const column = await prisma.column.create({
      data: { title: 'C', position: 0, boardId: board.id },
    })
    const task = await prisma.task.create({
      data: { title: 'T', position: 0, columnId: column.id, creatorId: user.id },
    })
    const comment = await prisma.comment.create({
      data: { content: 'Texto importante', taskId: task.id, authorType: 'USER', userId: user.id },
    })

    // act
    await deleteComment(comment.id, { id: user.id, role: 'ORG_ADMIN', organizationId: org.id })

    // assert: registro ainda existe no banco
    const found = await prisma.comment.findUnique({ where: { id: comment.id } })
    expect(found).not.toBeNull()
    expect(found!.deletedAt).not.toBeNull()
    expect(found!.deletedBy).toBe(user.id)
    expect(found!.deletedByType).toBe('USER')
    expect(found!.content).toBe('Texto importante')
  })

  it('cliente só pode soft-deletar o próprio comentário', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Org2', slug: 'org2', email: 'o2@o.com', planId: (await prisma.plan.findFirst())!.id },
    })
    const user = await prisma.user.create({
      data: { name: 'J', email: 'j2@j.com', password: 'x', role: 'ORG_ADMIN', organizationId: org.id },
    })
    const client = await prisma.client.create({
      data: { name: 'EmpY', email: 'y@y.com', organizationId: org.id },
    })
    const board = await prisma.board.create({
      data: { title: 'B', organizationId: org.id, clientId: client.id, creatorId: user.id },
    })
    const column = await prisma.column.create({
      data: { title: 'C', position: 0, boardId: board.id },
    })
    const task = await prisma.task.create({
      data: { title: 'T', position: 0, columnId: column.id, creatorId: user.id },
    })
    const otherClient = await prisma.client.create({
      data: { name: 'EmpZ', email: 'z@z.com', organizationId: org.id },
    })
    const comment = await prisma.comment.create({
      data: { content: 'Comentário do outro', taskId: task.id, authorType: 'CLIENT', clientId: client.id },
    })

    // outro cliente tentando deletar
    await expect(
      deleteComment(comment.id, { id: otherClient.id, role: 'CLIENT', organizationId: org.id })
    ).rejects.toThrow('Sem permissão')
  })
})

describe('listComments - soft delete visibility', () => {
  it('ORG_MEMBER não vê conteúdo de comentário deletado', async () => {
    // arrange: criar contexto e comentário deletado
    const org = await prisma.organization.create({
      data: { name: 'Org3', slug: 'org3', email: 'o3@o.com', planId: (await prisma.plan.findFirst())!.id },
    })
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: 'a3@a.com', password: 'x', role: 'ORG_ADMIN', organizationId: org.id },
    })
    const member = await prisma.user.create({
      data: { name: 'Membro', email: 'm3@m.com', password: 'x', role: 'ORG_MEMBER', organizationId: org.id },
    })
    const client = await prisma.client.create({
      data: { name: 'EmpW', email: 'w@w.com', organizationId: org.id },
    })
    const board = await prisma.board.create({
      data: { title: 'B', organizationId: org.id, clientId: client.id, creatorId: admin.id },
    })
    const column = await prisma.column.create({
      data: { title: 'C', position: 0, boardId: board.id },
    })
    const task = await prisma.task.create({
      data: { title: 'T', position: 0, columnId: column.id, creatorId: admin.id },
    })
    await prisma.comment.create({
      data: {
        content: 'Segredo',
        taskId: task.id,
        authorType: 'CLIENT',
        clientId: client.id,
        deletedAt: new Date(),
        deletedBy: client.id,
        deletedByType: 'CLIENT',
      },
    })

    // member não vê o conteúdo
    const resultMember = await listComments(task.id, org.id, 'ORG_MEMBER')
    expect(resultMember[0].content).toBeNull()
    expect(resultMember[0].deletedContent).toBeUndefined()

    // admin vê o conteúdo
    const resultAdmin = await listComments(task.id, org.id, 'ORG_ADMIN')
    expect(resultAdmin[0].deletedContent).toBe('Segredo')
  })
})
```

- [ ] **Rodar teste para verificar que falha**

```bash
pnpm --filter api test src/modules/comments/comments.service.test.ts
```

Esperado: FAIL — `deleteComment` não tem soft delete, `listComments` não aceita `role`.

- [ ] **Atualizar comments.service.ts**

Substituir o conteúdo de `apps/api/src/modules/comments/comments.service.ts`:

```typescript
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { publishBoardEvent } from '@/lib/sse'
import { enqueueNotification } from '@/lib/queue'
import type { CreateCommentBody } from './comments.schema'

interface CommentActor {
  id: string
  role: string
  organizationId: string
}

const CAN_SEE_DELETED_CONTENT = new Set(['ORG_ADMIN', 'ORG_MANAGER'])

export async function listComments(taskId: string, organizationId: string, role: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')

  const comments = await prisma.comment.findMany({
    where: { taskId },
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

export async function createComment(
  taskId: string,
  data: CreateCommentBody,
  actor: CommentActor,
) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId: actor.organizationId } } },
    include: { column: { include: { board: { select: { id: true, clientId: true } } } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')

  const isClient = actor.role === 'CLIENT'
  const comment = await prisma.comment.create({
    data: {
      content: data.content,
      taskId,
      authorType: isClient ? 'CLIENT' : 'USER',
      userId: isClient ? undefined : actor.id,
      clientId: isClient ? actor.id : undefined,
    },
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  })

  await publishBoardEvent(task.column.board.id, {
    event: 'comment:added',
    data: { taskId, commentId: comment.id },
  })

  const authorName = isClient
    ? (comment.client?.name ?? 'Cliente')
    : (comment.user?.name ?? 'Colaborador')

  await enqueueNotification({
    event: 'TASK_COMMENT_ADDED',
    taskId,
    organizationId: actor.organizationId,
    clientId: task.column.board.clientId,
    metadata: {
      taskTitle: task.title,
      commentText: data.content,
      commentAuthorName: authorName,
    },
  })

  return comment
}

export async function deleteComment(id: string, actor: CommentActor) {
  const comment = await prisma.comment.findFirst({
    where: { id },
    include: {
      task: {
        include: {
          column: { include: { board: { select: { organizationId: true } } } },
        },
      },
    },
  })
  if (!comment) throw new AppError(404, 'Comentário não encontrado')
  if (comment.task.column.board.organizationId !== actor.organizationId) {
    throw new AppError(403, 'Acesso negado')
  }

  const isAuthor =
    (actor.role === 'CLIENT' && comment.clientId === actor.id) ||
    (actor.role !== 'CLIENT' && comment.userId === actor.id)
  const isAdmin = actor.role === 'ORG_ADMIN'

  if (!isAuthor && !isAdmin) throw new AppError(403, 'Sem permissão')

  await prisma.comment.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      deletedBy: actor.id,
      deletedByType: actor.role === 'CLIENT' ? 'CLIENT' : 'USER',
    },
  })

  return { ok: true }
}
```

- [ ] **Atualizar comments.routes.ts para passar role**

Substituir o conteúdo de `apps/api/src/modules/comments/comments.routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { AppError } from '@/errors/AppError'
import { createCommentSchema } from './comments.schema'
import { listComments, createComment, deleteComment } from './comments.service'

export async function commentsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/tasks/:taskId/comments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    return reply.send(
      await listComments(taskId, request.user.organizationId!, request.user.role)
    )
  })

  app.post('/tasks/:taskId/comments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    const result = createCommentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(
      await createComment(taskId, result.data, {
        id: request.user.sub,
        role: request.user.role,
        organizationId: request.user.organizationId!,
      })
    )
  })

  app.delete('/comments/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(
      await deleteComment(id, {
        id: request.user.sub,
        role: request.user.role,
        organizationId: request.user.organizationId!,
      })
    )
  })
}
```

- [ ] **Rodar os testes e verificar que passam**

```bash
pnpm --filter api test src/modules/comments/comments.service.test.ts
```

Esperado: todos os testes PASS.

- [ ] **Commit**

```bash
git add apps/api/src/modules/comments/
git commit -m "feat: soft delete em comentários com visibilidade por role"
```

---

## Task 4: Backend — GET /tasks/:id/history para ORG roles

**Files:**
- Modify: `apps/api/src/modules/tasks/tasks.service.ts`
- Modify: `apps/api/src/modules/tasks/tasks.routes.ts`

- [ ] **Adicionar getTaskHistory() em tasks.service.ts**

Adicionar ao final de `apps/api/src/modules/tasks/tasks.service.ts` (após a função `moveTask`):

```typescript
export async function getTaskHistory(taskId: string, organizationId: string) {
  const task = await verifyTaskBelongsToOrg(taskId, organizationId)
  if (!task) throw new AppError(404, 'Tarefa não encontrada')

  return prisma.taskHistory.findMany({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
  })
}
```

- [ ] **Adicionar rota GET /tasks/:id/history em tasks.routes.ts**

Adicionar antes do `app.delete('/tasks/:id', ...)` em `apps/api/src/modules/tasks/tasks.routes.ts`:

```typescript
  app.get('/tasks/:id/history', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getTaskHistory(id, request.user.organizationId!))
  })
```

E adicionar `getTaskHistory` no import:

```typescript
import { createTask, moveTask, updateTask, reorderTasks, deleteTask, getTaskHistory } from './tasks.service'
```

- [ ] **Verificar compilação TypeScript**

```bash
pnpm --filter api build 2>&1 | head -20
```

Esperado: sem erros de tipo.

- [ ] **Commit**

```bash
git add apps/api/src/modules/tasks/
git commit -m "feat: GET /tasks/:id/history para ORG roles"
```

---

## Task 5: Backend — Upload e delete de anexos pelo cliente

**Files:**
- Modify: `apps/api/src/modules/attachments/attachments.service.ts`
- Modify: `apps/api/src/modules/attachments/attachments.routes.ts`

- [ ] **Atualizar attachments.service.ts**

Substituir o conteúdo de `apps/api/src/modules/attachments/attachments.service.ts`:

```typescript
import { prisma } from '@/lib/prisma'
import { uploadFile, getSignedDownloadUrl, deleteFile } from '@/lib/b2'
import { AppError } from '@/errors/AppError'

interface UploadPayload {
  filename: string
  mimeType: string
  size: number
  buffer: Buffer
}

interface UploaderActor {
  id: string
  role: string
}

async function verifyTaskBelongsToOrg(taskId: string, organizationId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')
  return task
}

export async function createAttachment(
  taskId: string,
  organizationId: string,
  actor: UploaderActor,
  payload: UploadPayload,
) {
  await verifyTaskBelongsToOrg(taskId, organizationId)

  const storageKey = `attachments/${taskId}/${Date.now()}-${payload.filename}`
  await uploadFile(storageKey, payload.buffer, payload.mimeType)

  const isClient = actor.role === 'CLIENT'

  return prisma.attachment.create({
    data: {
      taskId,
      filename: payload.filename,
      mimeType: payload.mimeType,
      size: payload.size,
      storageKey,
      uploadedBy: isClient ? undefined : actor.id,
      uploadedByClient: isClient ? actor.id : undefined,
    },
  })
}

export async function listAttachments(taskId: string, organizationId: string) {
  await verifyTaskBelongsToOrg(taskId, organizationId)

  const attachments = await prisma.attachment.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
    include: {
      uploader: { select: { name: true } },
      uploaderClient: { select: { name: true } },
    },
  })

  return Promise.all(
    attachments.map(async (a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      uploadedBy: a.uploadedBy,
      uploadedByClient: a.uploadedByClient,
      uploaderName: a.uploader?.name ?? a.uploaderClient?.name ?? 'Desconhecido',
      signedUrl: await getSignedDownloadUrl(a.storageKey),
      createdAt: a.createdAt,
    })),
  )
}

export async function deleteAttachment(
  attachmentId: string,
  taskId: string,
  organizationId: string,
  actor: UploaderActor,
) {
  await verifyTaskBelongsToOrg(taskId, organizationId)

  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, taskId },
  })
  if (!attachment) throw new AppError(404, 'Anexo não encontrado')

  // Cliente só pode deletar o próprio anexo
  if (actor.role === 'CLIENT' && attachment.uploadedByClient !== actor.id) {
    throw new AppError(403, 'Sem permissão para remover este anexo')
  }

  await deleteFile(attachment.storageKey)
  await prisma.attachment.delete({ where: { id: attachmentId } })
  return { ok: true }
}
```

- [ ] **Atualizar attachments.routes.ts**

Substituir o conteúdo de `apps/api/src/modules/attachments/attachments.routes.ts`:

```typescript
import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createAttachment, listAttachments, deleteAttachment } from './attachments.service'

const MAX_FILE_SIZE = 20 * 1024 * 1024

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'application/zip',
])

export async function attachmentsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_FILE_SIZE } })

  app.addHook('preHandler', verifyJWT)

  app.post('/tasks/:id/attachments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT'), checkSubscription],
  }, async (request, reply) => {
    const { id: taskId } = request.params as { id: string }

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

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      await file.toBuffer().catch(() => {})
      throw new AppError(422, 'Tipo de arquivo não permitido')
    }

    const buffer = await file.toBuffer()
    if (buffer.length > MAX_FILE_SIZE) throw new AppError(413, 'Arquivo excede o limite de 20MB')

    const attachment = await createAttachment(
      taskId,
      request.user.organizationId!,
      { id: request.user.sub, role: request.user.role },
      { filename: file.filename, mimeType: file.mimetype, size: buffer.length, buffer },
    )

    return reply.status(201).send(attachment)
  })

  app.get('/tasks/:id/attachments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { id: taskId } = request.params as { id: string }
    return reply.send(await listAttachments(taskId, request.user.organizationId!))
  })

  app.delete('/tasks/:id/attachments/:attachmentId', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT'), checkSubscription],
  }, async (request, reply) => {
    const { id: taskId, attachmentId } = request.params as { id: string; attachmentId: string }
    return reply.status(204).send(
      await deleteAttachment(
        attachmentId,
        taskId,
        request.user.organizationId!,
        { id: request.user.sub, role: request.user.role },
      )
    )
  })
}
```

- [ ] **Verificar compilação TypeScript**

```bash
pnpm --filter api build 2>&1 | head -20
```

Esperado: sem erros de tipo.

- [ ] **Commit**

```bash
git add apps/api/src/modules/attachments/
git commit -m "feat: upload e delete de anexos liberado para CLIENT"
```

---

## Task 6: Frontend — Tipos TypeScript atualizados

**Files:**
- Modify: `apps/web/src/types/index.ts`

- [ ] **Adicionar tipos Comment, Attachment e TaskHistory**

Adicionar ao final de `apps/web/src/types/index.ts`:

```typescript
export type OrgRole = 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'
export type DrawerRole = OrgRole | 'CLIENT'

export interface Comment {
  id: string
  content: string | null
  authorType: 'USER' | 'CLIENT'
  user: { id: string; name: string } | null
  client: { id: string; name: string } | null
  deletedAt: string | null
  deletedBy: string | null
  deletedByType: 'USER' | 'CLIENT' | null
  deletedContent?: string
  createdAt: string
}

export interface Attachment {
  id: string
  filename: string
  mimeType: string
  size: number
  uploadedBy: string | null
  uploadedByClient: string | null
  uploaderName: string
  signedUrl: string
  createdAt: string
}

export interface TaskHistory {
  id: string
  action: string
  fromValue: string | null
  toValue: string | null
  actorName: string
  createdAt: string
}
```

- [ ] **Commit**

```bash
git add apps/web/src/types/index.ts
git commit -m "feat: tipos Comment, Attachment e TaskHistory no frontend"
```

---

## Task 7: Frontend — Shared Comments component

**Files:**
- Create: `apps/web/src/components/shared/Comments.tsx`
- Modify: `apps/web/src/components/portal/Comments.tsx`

- [ ] **Criar apps/web/src/components/shared/Comments.tsx**

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Comment, DrawerRole } from '@/types'

interface Props {
  taskId: string
  currentUserId: string
  role: DrawerRole
}

const CAN_SEE_DELETED = new Set<DrawerRole>(['ORG_ADMIN', 'ORG_MANAGER'])

export function Comments({ taskId, currentUserId, role }: Props) {
  const queryClient = useQueryClient()
  const [content, setContent] = useState('')

  const { data: comments = [] } = useQuery<Comment[]>({
    queryKey: ['comments', taskId],
    queryFn: () => api.get(`/tasks/${taskId}/comments`).then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(`/tasks/${taskId}/comments`, { content }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', taskId] })
      setContent('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) =>
      api.delete(`/comments/${commentId}`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', taskId] }),
  })

  function canDelete(c: Comment) {
    if (c.deletedAt) return false
    if (role === 'CLIENT') return c.client?.id === currentUserId
    if (role === 'ORG_ADMIN') return true
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
                  <span className="text-xs text-gray-400">
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
                  <p className="text-xs text-gray-400 italic">
                    Comentário removido em {new Date(c.deletedAt!).toLocaleString('pt-BR')}
                  </p>
                  {CAN_SEE_DELETED.has(role) && c.deletedContent && (
                    <details className="mt-1">
                      <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                        Ver conteúdo removido
                      </summary>
                      <p className="text-sm text-gray-500 mt-1 line-through">{c.deletedContent}</p>
                    </details>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-800">{c.content}</p>
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
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
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

- [ ] **Atualizar portal/Comments.tsx para re-exportar**

Substituir todo o conteúdo de `apps/web/src/components/portal/Comments.tsx`:

```tsx
export { Comments } from '@/components/shared/Comments'
```

- [ ] **Commit**

```bash
git add apps/web/src/components/shared/Comments.tsx apps/web/src/components/portal/Comments.tsx
git commit -m "feat: Comments component compartilhado com soft delete"
```

---

## Task 8: Frontend — TaskDrawer unificado

**Files:**
- Create: `apps/web/src/components/shared/TaskDrawer.tsx`
- Modify: `apps/web/src/components/portal/TaskDrawer.tsx`

- [ ] **Criar apps/web/src/components/shared/TaskDrawer.tsx**

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Paperclip, MessageSquare, Clock } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Comments } from '@/components/shared/Comments'
import type { Task, Attachment, TaskHistory, DrawerRole } from '@/types'

interface Props {
  task: Task
  currentUserId: string
  role: DrawerRole
  onClose: () => void
}

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

const PRIORITY_COLOR: Record<Task['priority'], string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-600',
  HIGH: 'bg-orange-100 text-orange-600',
  URGENT: 'bg-red-100 text-red-600',
}

type Tab = 'comments' | 'attachments' | 'history'

const isOrgRole = (role: DrawerRole): role is Exclude<DrawerRole, 'CLIENT'> => role !== 'CLIENT'

const historyEndpoint = (taskId: string, role: DrawerRole) =>
  role === 'CLIENT'
    ? `/portal/tasks/${taskId}/history`
    : `/tasks/${taskId}/history`

export function TaskDrawer({ task, currentUserId, role, onClose }: Props) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('comments')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(task.title)
  const [descValue, setDescValue] = useState(task.description ?? '')

  const canEdit = isOrgRole(role)

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Pick<Task, 'title' | 'priority' | 'description' | 'dueDate'>>) =>
      api.patch(`/tasks/${task.id}`, data).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['board'] }),
  })

  const { data: attachments = [] } = useQuery<Attachment[]>({
    queryKey: ['attachments', task.id],
    queryFn: () => api.get(`/tasks/${task.id}/attachments`).then((r) => r.data),
    enabled: tab === 'attachments',
  })

  const { data: history = [] } = useQuery<TaskHistory[]>({
    queryKey: ['task-history', task.id],
    queryFn: () => api.get(historyEndpoint(task.id, role)).then((r) => r.data),
    enabled: tab === 'history',
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.post(`/tasks/${task.id}/attachments`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', task.id] }),
  })

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attachmentId: string) =>
      api.delete(`/tasks/${task.id}/attachments/${attachmentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', task.id] }),
  })

  const isOverdue =
    task.dueDate !== null &&
    task.status !== 'DONE' &&
    new Date(task.dueDate) < new Date()

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'comments', label: 'Comentários', icon: <MessageSquare size={14} /> },
    { id: 'attachments', label: 'Anexos', icon: <Paperclip size={14} /> },
    { id: 'history', label: 'Histórico', icon: <Clock size={14} /> },
  ]

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex flex-col bg-white shadow-2xl w-full max-w-[560px]">

        {/* Header fixo */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-start justify-between mb-3">
            {canEdit && editingTitle ? (
              <input
                autoFocus
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={() => {
                  setEditingTitle(false)
                  if (titleValue.trim() && titleValue !== task.title) {
                    updateMutation.mutate({ title: titleValue.trim() })
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') { setTitleValue(task.title); setEditingTitle(false) }
                }}
                className="flex-1 text-base font-semibold text-gray-900 border-b border-blue-500 focus:outline-none bg-transparent mr-4"
              />
            ) : (
              <h2
                className={cn(
                  'flex-1 text-base font-semibold text-gray-900 leading-tight mr-4',
                  canEdit && 'cursor-pointer hover:text-blue-600',
                )}
                onClick={() => canEdit && setEditingTitle(true)}
              >
                {task.title}
              </h2>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
              <X size={20} />
            </button>
          </div>

          {/* Badges de metadados */}
          <div className="flex flex-wrap gap-2 mb-3">
            {canEdit ? (
              <select
                value={task.priority}
                onChange={(e) => updateMutation.mutate({ priority: e.target.value as Task['priority'] })}
                className={cn('text-xs font-medium px-2 py-0.5 rounded-full border-0 cursor-pointer', PRIORITY_COLOR[task.priority])}
              >
                {(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as Task['priority'][]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                ))}
              </select>
            ) : (
              <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', PRIORITY_COLOR[task.priority])}>
                {PRIORITY_LABEL[task.priority]}
              </span>
            )}

            {task.dueDate && (
              <span className={cn('text-xs px-2 py-0.5 rounded-full bg-gray-100', isOverdue && 'bg-red-100 text-red-600 font-medium')}>
                {isOverdue ? '⚠ ' : ''}Prazo: {new Date(task.dueDate).toLocaleDateString('pt-BR')}
              </span>
            )}
          </div>

          {/* Descrição */}
          {canEdit ? (
            <textarea
              value={descValue}
              onChange={(e) => setDescValue(e.target.value)}
              onBlur={() => {
                if (descValue !== (task.description ?? '')) {
                  updateMutation.mutate({ description: descValue || null })
                }
              }}
              placeholder="Adicionar descrição..."
              rows={2}
              className="w-full text-sm text-gray-700 border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none placeholder:text-gray-400"
            />
          ) : (
            task.description && (
              <p className="text-sm text-gray-700">{task.description}</p>
            )
          )}
        </div>

        {/* Abas */}
        <div className="flex border-b border-gray-200 flex-shrink-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                tab === t.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Conteúdo da aba */}
        <div className="flex-1 overflow-y-auto p-5">

          {tab === 'comments' && (
            <Comments taskId={task.id} currentUserId={currentUserId} role={role} />
          )}

          {tab === 'attachments' && (
            <div className="space-y-3">
              {attachments.length === 0 && (
                <p className="text-sm text-gray-400">Nenhum anexo ainda.</p>
              )}
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Paperclip size={14} className="text-gray-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <a
                        href={a.signedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:underline block truncate"
                      >
                        {a.filename}
                      </a>
                      <p className="text-xs text-gray-400">
                        {(a.size / 1024).toFixed(0)} KB · {a.uploaderName}
                      </p>
                    </div>
                  </div>
                  {(isOrgRole(role) || a.uploadedByClient === currentUserId) && (
                    <button
                      type="button"
                      onClick={() => deleteAttachmentMutation.mutate(a.id)}
                      className="text-xs text-red-400 hover:text-red-600 ml-2 flex-shrink-0"
                    >
                      Remover
                    </button>
                  )}
                </div>
              ))}
              <label className="flex items-center gap-2 cursor-pointer mt-2">
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) uploadMutation.mutate(file)
                    e.target.value = ''
                  }}
                />
                <span className="text-sm text-blue-600 hover:underline">
                  {uploadMutation.isPending ? 'Enviando...' : '+ Adicionar arquivo'}
                </span>
              </label>
            </div>
          )}

          {tab === 'history' && (
            <div className="relative pl-4">
              {history.length === 0 && (
                <p className="text-sm text-gray-400">Sem histórico ainda.</p>
              )}
              <div className="absolute left-1.5 top-0 bottom-0 w-px bg-gray-200" />
              {history.map((h) => (
                <div key={h.id} className="relative mb-4 last:mb-0">
                  <div className="absolute -left-[11px] top-1.5 w-2 h-2 rounded-full bg-blue-400" />
                  <p className="text-xs text-gray-600">
                    <span className="font-medium">{h.actorName}</span>
                    {' — '}
                    {h.action}
                    {h.toValue && <span className="text-gray-500"> → {h.toValue}</span>}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(h.createdAt).toLocaleString('pt-BR')}
                  </p>
                </div>
              ))}
            </div>
          )}

        </div>
      </aside>
    </>
  )
}
```

- [ ] **Atualizar portal/TaskDrawer.tsx para usar o shared**

Substituir o conteúdo de `apps/web/src/components/portal/TaskDrawer.tsx`:

```tsx
export { TaskDrawer } from '@/components/shared/TaskDrawer'
```

- [ ] **Commit**

```bash
git add apps/web/src/components/shared/TaskDrawer.tsx apps/web/src/components/portal/TaskDrawer.tsx
git commit -m "feat: TaskDrawer unificado com abas e suporte a CLIENT e ORG roles"
```

---

## Task 9: Frontend — Integrar no Board interno

**Files:**
- Modify: `apps/web/src/pages/app/Board.tsx`
- Delete: `apps/web/src/components/TaskModal.tsx`

- [ ] **Localizar imports e uso do TaskModal em Board.tsx**

```bash
grep -n "TaskModal\|selectedTask" apps/web/src/pages/app/Board.tsx
```

- [ ] **Substituir TaskModal por TaskDrawer em Board.tsx**

Trocar o import no topo:

```tsx
// remover esta linha:
import { TaskModal } from '@/components/TaskModal'

// adicionar:
import { TaskDrawer } from '@/components/shared/TaskDrawer'
import { useAuth } from '@/hooks/useAuth'
```

Adicionar dentro do componente Board (logo após o useState existente):

```tsx
const { user } = useAuth()
```

Substituir o bloco `{selectedTask && <TaskModal ... />}` pelo drawer:

```tsx
{selectedTask && user && (
  <TaskDrawer
    task={selectedTask}
    currentUserId={user.id}
    role={user.role as 'ORG_ADMIN' | 'ORG_MANAGER' | 'ORG_MEMBER'}
    onClose={() => setSelectedTask(null)}
  />
)}
```

- [ ] **Deletar TaskModal.tsx**

```bash
rm apps/web/src/components/TaskModal.tsx
```

- [ ] **Verificar que não há outros imports de TaskModal**

```bash
grep -r "TaskModal" apps/web/src/
```

Esperado: nenhum resultado.

- [ ] **Commit**

```bash
git add apps/web/src/pages/app/Board.tsx
git rm apps/web/src/components/TaskModal.tsx
git commit -m "feat: Board interno usa TaskDrawer unificado; remove TaskModal"
```

---

## Task 10: Frontend — Integrar no Portal Board

**Files:**
- Modify: `apps/web/src/pages/portal/Board.tsx`

- [ ] **Verificar imports do portal/Board.tsx**

```bash
grep -n "TaskDrawer\|selectedTask\|import" apps/web/src/pages/portal/Board.tsx | head -20
```

- [ ] **Atualizar portal/Board.tsx para passar as props do novo TaskDrawer**

Adicionar `useAuth` aos imports (linha 1 do arquivo):

```tsx
import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ArrowLeft } from 'lucide-react'
import { useBoardStream } from '@/hooks/useBoardStream'
import { TaskDrawer } from '@/components/portal/TaskDrawer'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import type { Board, Task } from '@/types'
```

Adicionar `const { user } = useAuth()` logo após o `useState` no corpo do componente `PortalBoard`:

```tsx
export default function PortalBoard() {
  const { boardId } = useParams<{ boardId: string }>()
  useBoardStream(boardId)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [titleSearch, setTitleSearch] = useState('')
  const { user } = useAuth()
```

Substituir a linha 128–130 (o bloco `{selectedTask && ...}`):

```tsx
// antes:
{selectedTask && (
  <TaskDrawer task={selectedTask} onClose={() => setSelectedTask(null)} />
)}

// depois:
{selectedTask && (
  <TaskDrawer
    task={selectedTask}
    currentUserId={user?.id ?? ''}
    role="CLIENT"
    onClose={() => setSelectedTask(null)}
  />
)}
```

- [ ] **Iniciar o servidor de desenvolvimento e abrir o portal**

```bash
pnpm --filter web dev
```

Abrir `http://localhost:5173` no browser. Fazer login como cliente. Clicar em uma tarefa. Verificar que:
- Drawer abre da direita com largura correta
- Aba Comentários está ativa por padrão
- Comentários do cliente aparecem com borda azul
- Campo de novo comentário está visível
- Aba Anexos permite upload
- Aba Histórico exibe os eventos

- [ ] **Abrir o board interno**

Fazer login como ORG_ADMIN. Clicar em uma tarefa. Verificar que:
- Campos do header (título, prioridade, descrição) estão editáveis
- Alteração de título ao pressionar Enter atualiza o board
- Comentários de cliente e colaborador diferenciados visualmente
- Botão "Ver conteúdo removido" aparece para ORG_ADMIN em comentários deletados
- Upload de arquivo funciona

- [ ] **Commit**

```bash
git add apps/web/src/pages/portal/Board.tsx
git commit -m "feat: portal Board usa TaskDrawer unificado"
```

---

## Checklist Final de Validação

- [ ] `pnpm --filter api build` — sem erros TypeScript
- [ ] `pnpm --filter api test` — testes de soft delete passando
- [ ] Comentário deletado por cliente: registro permanece no banco com `deletedAt` preenchido
- [ ] ORG_ADMIN vê "Ver conteúdo removido"; ORG_MEMBER não vê
- [ ] Cliente consegue fazer upload de anexo
- [ ] Cliente não consegue deletar anexo de outro usuário (retorna 403)
- [ ] Board interno: título e prioridade editáveis inline no header do drawer
- [ ] Portal: drawer abre em read-only para campos, comentários e anexos funcionais
- [ ] Histórico carrega via `/tasks/:id/history` no interno e `/portal/tasks/:id/history` no portal
- [ ] TaskModal.tsx não existe mais no projeto
