# Board Workflow & Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que Gerentes e Colaboradores criem processos (boards) pela UI, com visibilidade filtrada por responsável para ORG_MEMBER, e 3 colunas padrão criadas automaticamente em cada novo board.

**Architecture:** Adiciona `responsibleUserId` ao modelo `Board` via migration. O serviço `listBoards` filtra por esse campo quando o caller é `ORG_MEMBER`. O `createBoard` auto-atribui o responsável quando criado por ORG_MEMBER e cria 3 colunas padrão na mesma transação. No frontend, a Dashboard ganha um modal "Novo Processo" acessível a todos os roles ORG.

**Tech Stack:** Prisma v6 (migration), Fastify v5 (API), React 19 + TanStack Query + shadcn/ui Dialog (frontend).

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `apps/api/prisma/schema.prisma` | Modificar | Adicionar `responsibleUserId` ao Board e relação no User |
| `apps/api/prisma/migrations/...` | Criar | Migration SQL gerada pelo Prisma |
| `apps/api/src/modules/boards/boards.schema.ts` | Modificar | Adicionar `responsibleUserId` opcional ao createBoardSchema |
| `apps/api/src/modules/boards/boards.service.ts` | Modificar | listBoards filtra por responsável; createBoard auto-atribui e cria colunas padrão |
| `apps/api/src/modules/boards/boards.routes.ts` | Modificar | POST /boards permite ORG_MEMBER; GET /boards passa userId para filtro |
| `apps/api/src/modules/clients/clients.routes.ts` | Modificar | GET /clients permite ORG_MEMBER |
| `apps/api/src/modules/columns/columns.routes.ts` | Modificar | POST + PATCH de colunas permite ORG_MEMBER |
| `apps/api/src/modules/boards/boards.routes.test.ts` | Criar | Testes das novas permissões |
| `apps/web/src/types/index.ts` | Modificar | Adicionar `responsibleUserId` ao tipo Board |
| `apps/web/src/pages/app/Dashboard.tsx` | Modificar | Botão "Novo Processo" + modal com form |

---

## Task 1: Schema Prisma — adicionar responsibleUserId ao Board

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Adicionar o campo ao modelo Board**

No arquivo `apps/api/prisma/schema.prisma`, localizar o modelo `Board` (linha ~124) e adicionar o campo e a relação:

```prisma
model Board {
  id                String   @id @default(cuid())
  title             String
  description       String?
  organizationId    String
  clientId          String
  responsibleUserId String?
  isActive          Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  organization    Organization @relation(fields: [organizationId], references: [id])
  client          Client       @relation(fields: [clientId], references: [id])
  responsibleUser User?        @relation("BoardResponsible", fields: [responsibleUserId], references: [id])
  columns         Column[]

  @@map("boards")
}
```

- [ ] **Step 2: Adicionar relação inversa no modelo User**

No modelo `User`, adicionar após `attachments Attachment[]`:

```prisma
  responsibleBoards Board[] @relation("BoardResponsible")
```

- [ ] **Step 3: Gerar e aplicar a migration**

```bash
pnpm --filter api prisma migrate dev --name add_board_responsible_user
```

Expected output:
```
The following migration(s) have been created and applied from new schema changes:
migrations/20260603.../migration.sql
```

- [ ] **Step 4: Verificar que a migration foi aplicada**

```bash
pnpm --filter api prisma studio
```

Ou verificar via psql que a coluna existe:
```bash
psql $DATABASE_URL -c "\d boards"
```

Expected: coluna `responsible_user_id` visível.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat: adiciona responsibleUserId ao Board para filtro por colaborador"
```

---

## Task 2: boards.schema.ts — aceitar responsibleUserId

**Files:**
- Modify: `apps/api/src/modules/boards/boards.schema.ts`

- [ ] **Step 1: Substituir o conteúdo do arquivo**

```typescript
import { z } from 'zod'

export const createBoardSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  clientId: z.string().cuid(),
  responsibleUserId: z.string().cuid().optional(),
})

export const updateBoardSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  responsibleUserId: z.string().cuid().nullable().optional(),
})

export type CreateBoardBody = z.infer<typeof createBoardSchema>
export type UpdateBoardBody = z.infer<typeof updateBoardSchema>

export const searchQuerySchema = z.object({
  q: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CANCELLED']).optional(),
  assigneeId: z.string().cuid().optional(),
  dueBefore: z.string().datetime().optional(),
  dueAfter: z.string().datetime().optional(),
})

export type SearchQuery = z.infer<typeof searchQuerySchema>
```

- [ ] **Step 2: Rodar testes para confirmar sem quebras**

```bash
pnpm --filter api test
```

Expected: todos os testes passando.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/boards/boards.schema.ts
git commit -m "feat: boards.schema aceita responsibleUserId em create e update"
```

---

## Task 3: boards.service.ts — filtro por responsável e colunas padrão

**Files:**
- Modify: `apps/api/src/modules/boards/boards.service.ts`

**Lógica:**
- `listBoards`: aceita `responsibleUserId?` e filtra quando fornecido
- `createBoard`: aceita `userId` e `userRole`; se ORG_MEMBER, seta `responsibleUserId = userId`; cria 3 colunas padrão na mesma transação
- `updateBoard`: permite atualizar `responsibleUserId`

- [ ] **Step 1: Substituir o conteúdo do arquivo**

```typescript
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateBoardBody, UpdateBoardBody, SearchQuery } from './boards.schema'

const DEFAULT_COLUMNS = [
  { title: 'Pendente', position: 0, color: '#6B7280', isFinal: false },
  { title: 'Em andamento', position: 1, color: '#3B82F6', isFinal: false },
  { title: 'Concluído', position: 2, color: '#10B981', isFinal: true },
]

export async function listBoards(
  organizationId: string,
  clientId?: string,
  responsibleUserId?: string,
) {
  return prisma.board.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(clientId ? { clientId } : {}),
      ...(responsibleUserId ? { responsibleUserId } : {}),
    },
    include: {
      client: { select: { id: true, name: true } },
      columns: {
        orderBy: { position: 'asc' },
        include: { tasks: { orderBy: { position: 'asc' } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getBoardById(id: string, organizationId: string) {
  const board = await prisma.board.findFirst({
    where: { id, organizationId, isActive: true },
    include: {
      client: { select: { id: true, name: true } },
      columns: {
        orderBy: { position: 'asc' },
        include: { tasks: { orderBy: { position: 'asc' } } },
      },
    },
  })
  if (!board) throw new AppError(404, 'Board não encontrado')
  return board
}

export async function createBoard(
  organizationId: string,
  userId: string,
  userRole: string,
  data: CreateBoardBody,
) {
  const client = await prisma.client.findFirst({
    where: { id: data.clientId, organizationId, isActive: true },
  })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  const responsibleUserId =
    userRole === 'ORG_MEMBER' ? userId : (data.responsibleUserId ?? null)

  return prisma.board.create({
    data: {
      title: data.title,
      description: data.description,
      clientId: data.clientId,
      organizationId,
      responsibleUserId,
      columns: { create: DEFAULT_COLUMNS },
    },
    include: {
      client: { select: { id: true, name: true } },
      columns: { orderBy: { position: 'asc' } },
    },
  })
}

export async function updateBoard(id: string, organizationId: string, data: UpdateBoardBody) {
  const board = await prisma.board.findFirst({ where: { id, organizationId, isActive: true } })
  if (!board) throw new AppError(404, 'Board não encontrado')

  return prisma.board.update({
    where: { id },
    data,
    include: { client: { select: { id: true, name: true } } },
  })
}

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
    },
    orderBy: { position: 'asc' },
  })
}
```

- [ ] **Step 2: Rodar testes**

```bash
pnpm --filter api test
```

Expected: todos passando (os testes existentes de search.routes.test.ts devem continuar passando).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/boards/boards.service.ts
git commit -m "feat: boards.service filtra por responsável e cria colunas padrão ao criar board"
```

---

## Task 4: boards.routes.ts — ORG_MEMBER pode criar e ver apenas seus boards

**Files:**
- Modify: `apps/api/src/modules/boards/boards.routes.ts`

**Lógica:**
- `GET /boards`: passa `responsibleUserId = user.sub` quando role = ORG_MEMBER
- `POST /boards`: abre para ORG_MEMBER; passa `userId` e `userRole` para o service

- [ ] **Step 1: Substituir o conteúdo do arquivo**

```typescript
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createBoardSchema, updateBoardSchema, searchQuerySchema } from './boards.schema'
import { listBoards, getBoardById, createBoard, updateBoard, searchTasks } from './boards.service'

export async function boardsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { organizationId, role, sub } = request.user
    const clientId = role === 'CLIENT' ? sub : undefined
    const responsibleUserId = role === 'ORG_MEMBER' ? sub : undefined
    return reply.send(await listBoards(organizationId!, clientId, responsibleUserId))
  })

  app.get('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getBoardById(id, request.user.organizationId!))
  })

  app.get('/:id/tasks/search', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = searchQuerySchema.safeParse(request.query)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await searchTasks(id, request.user.organizationId!, result.data))
  })

  app.post('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'), checkSubscription],
  }, async (request, reply) => {
    const result = createBoardSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(
      await createBoard(
        request.user.organizationId!,
        request.user.sub,
        request.user.role,
        result.data,
      ),
    )
  })

  app.patch('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateBoardSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateBoard(id, request.user.organizationId!, result.data))
  })
}
```

- [ ] **Step 2: Rodar testes**

```bash
pnpm --filter api test
```

Expected: passando.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/boards/boards.routes.ts
git commit -m "feat: ORG_MEMBER pode criar boards e vê apenas os seus"
```

---

## Task 5: clients.routes.ts — ORG_MEMBER pode ler clientes

**Files:**
- Modify: `apps/api/src/modules/clients/clients.routes.ts`

**Lógica:** O `GET /clients` precisa estar acessível para ORG_MEMBER pois o modal de criação de board precisa listar os clientes. O hook global bloqueia ORG_MEMBER — mover a proteção para rota específica.

- [ ] **Step 1: Substituir o conteúdo do arquivo**

```typescript
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { checkPlanLimit } from '@/middlewares/checkPlanLimit'
import { AppError } from '@/errors/AppError'
import { createClientSchema, updateClientSchema } from './clients.schema'
import { listClients, createClient, updateClient, deleteClient } from './clients.service'

export async function clientsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  // ORG_MEMBER pode ler clientes (para usar no modal de criação de board)
  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    return reply.send(await listClients(request.user.organizationId!))
  })

  // Apenas Admin e Gerente criam, editam e excluem clientes
  app.post('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription, checkPlanLimit],
  }, async (request, reply) => {
    const result = createClientSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createClient(request.user.organizationId!, result.data))
  })

  app.patch('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateClientSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateClient(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteClient(id, request.user.organizationId!))
  })
}
```

- [ ] **Step 2: Rodar testes**

```bash
pnpm --filter api test
```

Expected: passando.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/clients/clients.routes.ts
git commit -m "feat: ORG_MEMBER pode ler clientes para criar boards"
```

---

## Task 6: columns.routes.ts — ORG_MEMBER pode criar e editar colunas

**Files:**
- Modify: `apps/api/src/modules/columns/columns.routes.ts`

**Lógica:** Colaboradores precisam poder gerenciar colunas nos seus boards. DELETE continua restrito a ORG_ADMIN.

- [ ] **Step 1: Substituir o conteúdo do arquivo**

```typescript
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createColumnSchema, updateColumnSchema, reorderColumnsSchema } from './columns.schema'
import { createColumn, updateColumn, reorderColumns, deleteColumn } from './columns.service'

export async function columnsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', checkSubscription)

  app.post('/boards/:boardId/columns', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { boardId } = request.params as { boardId: string }
    const result = createColumnSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createColumn(boardId, request.user.organizationId!, result.data))
  })

  app.patch('/columns/reorder', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const result = reorderColumnsSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await reorderColumns(result.data, request.user.organizationId!))
  })

  app.patch('/columns/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateColumnSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateColumn(id, request.user.organizationId!, result.data))
  })

  // Delete restrito a ADMIN — ação destrutiva
  app.delete('/columns/:id', {
    preHandler: [requireRole('ORG_ADMIN')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.status(204).send(await deleteColumn(id, request.user.organizationId!))
  })
}
```

- [ ] **Step 2: Rodar testes**

```bash
pnpm --filter api test
```

Expected: passando.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/columns/columns.routes.ts
git commit -m "feat: ORG_MEMBER pode criar e editar colunas"
```

---

## Task 7: Testes de API — novas permissões de board

**Files:**
- Create: `apps/api/src/modules/boards/boards.routes.test.ts`

- [ ] **Step 1: Criar o arquivo de testes**

```typescript
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  getAuthHeader,
} from '@/test/helpers'

describe('POST /boards', () => {
  it('ORG_MEMBER cria board e fica como responsável automático', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)

    const auth = await getAuthHeader(member.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: '/boards',
      headers: { authorization: auth },
      payload: { title: 'Abertura LTDA', clientId: client.id },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.title).toBe('Abertura LTDA')
    expect(body.responsibleUserId).toBe(member.id)
    expect(body.columns).toHaveLength(3)
    expect(body.columns[0].title).toBe('Pendente')
    expect(body.columns[2].title).toBe('Concluído')
    expect(body.columns[2].isFinal).toBe(true)
  })

  it('ORG_MANAGER cria board sem responsável automático', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const client = await createTestClient(org.id)

    const auth = await getAuthHeader(manager.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: '/boards',
      headers: { authorization: auth },
      payload: { title: 'Processo ABC', clientId: client.id },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.responsibleUserId).toBeNull()
    expect(body.columns).toHaveLength(3)
  })

  it('ORG_MANAGER pode atribuir responsável ao criar board', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)

    const auth = await getAuthHeader(manager.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: '/boards',
      headers: { authorization: auth },
      payload: { title: 'Processo XYZ', clientId: client.id, responsibleUserId: member.id },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.responsibleUserId).toBe(member.id)
  })
})

describe('GET /boards', () => {
  it('ORG_MEMBER vê apenas boards onde é responsável', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const admin = await createTestUser(org.id, { role: 'ORG_ADMIN' })
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)

    // Board do member
    const authMember = await getAuthHeader(member.email, 'Test@1234')
    await app.inject({
      method: 'POST',
      url: '/boards',
      headers: { authorization: authMember },
      payload: { title: 'Board do Member', clientId: client.id },
    })

    // Board do admin (sem responsável)
    const authAdmin = await getAuthHeader(admin.email, 'Test@1234')
    await app.inject({
      method: 'POST',
      url: '/boards',
      headers: { authorization: authAdmin },
      payload: { title: 'Board do Admin', clientId: client.id },
    })

    // Member vê só o seu
    const res = await app.inject({
      method: 'GET',
      url: '/boards',
      headers: { authorization: authMember },
    })

    expect(res.statusCode).toBe(200)
    const boards = JSON.parse(res.body)
    expect(boards).toHaveLength(1)
    expect(boards[0].title).toBe('Board do Member')
  })

  it('ORG_MANAGER vê todos os boards da org', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const manager = await createTestUser(org.id, { role: 'ORG_MANAGER' })
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)

    const authManager = await getAuthHeader(manager.email, 'Test@1234')
    const authMember = await getAuthHeader(member.email, 'Test@1234')

    await app.inject({
      method: 'POST',
      url: '/boards',
      headers: { authorization: authManager },
      payload: { title: 'Board Manager', clientId: client.id },
    })
    await app.inject({
      method: 'POST',
      url: '/boards',
      headers: { authorization: authMember },
      payload: { title: 'Board Member', clientId: client.id },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/boards',
      headers: { authorization: authManager },
    })

    expect(res.statusCode).toBe(200)
    const boards = JSON.parse(res.body)
    expect(boards).toHaveLength(2)
  })
})

describe('GET /clients (ORG_MEMBER)', () => {
  it('ORG_MEMBER pode listar clientes', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    await createTestClient(org.id)

    const auth = await getAuthHeader(member.email, 'Test@1234')
    const res = await app.inject({
      method: 'GET',
      url: '/clients',
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const clients = JSON.parse(res.body)
    expect(clients).toHaveLength(1)
  })

  it('ORG_MEMBER não pode criar clientes', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const member = await createTestUser(org.id, { role: 'ORG_MEMBER' })

    const auth = await getAuthHeader(member.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: '/clients',
      headers: { authorization: auth },
      payload: { name: 'Novo Cliente', email: 'c@test.com', password: 'Test@1234' },
    })

    expect(res.statusCode).toBe(403)
  })
})
```

- [ ] **Step 2: Rodar os novos testes**

```bash
pnpm --filter api test
```

Expected: todos passando, incluindo os 5 novos testes.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/boards/boards.routes.test.ts
git commit -m "test: permissões de board para ORG_MEMBER e criação com colunas padrão"
```

---

## Task 8: types/index.ts — atualizar tipo Board

**Files:**
- Modify: `apps/web/src/types/index.ts`

- [ ] **Step 1: Adicionar `responsibleUserId` ao tipo Board**

No arquivo `apps/web/src/types/index.ts`, localizar a interface `Board` e adicionar o campo:

```typescript
export interface Board {
  id: string
  title: string
  description: string | null
  clientId: string
  organizationId: string
  responsibleUserId: string | null
  isActive: boolean
  columns: Column[]
  client: { id: string; name: string }
}
```

- [ ] **Step 2: Rodar testes do frontend**

```bash
pnpm --filter web test
```

Expected: `12 passed (5)`

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/types/index.ts
git commit -m "feat: adiciona responsibleUserId ao tipo Board"
```

---

## Task 9: Dashboard.tsx — botão "Novo Processo" + modal

**Files:**
- Modify: `apps/web/src/pages/app/Dashboard.tsx`

**Design:**
- Botão "Novo Processo" no topo direito da Dashboard, visível para ORG_ADMIN, ORG_MANAGER e ORG_MEMBER
- Modal (shadcn Dialog) com: campo Título + seletor de Cliente (native select estilizado) + nota sobre colunas padrão
- POST `/boards` ao submeter → redireciona para `/app/board/:newBoardId`
- Estado de loading no botão de submit

- [ ] **Step 1: Substituir o conteúdo de `apps/web/src/pages/app/Dashboard.tsx`**

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Plus } from 'lucide-react'
import type { Board, Client } from '@/types'

interface BoardSummary extends Pick<Board, 'id' | 'title' | 'client' | 'columns'> {}

export default function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', clientId: '' })

  const { data: boards = [], isLoading } = useQuery<BoardSummary[]>({
    queryKey: ['boards'],
    queryFn: () => api.get('/boards').then((r) => r.data),
  })

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients').then((r) => r.data),
    enabled: open,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/boards', { title: form.title, clientId: form.clientId }).then((r) => r.data),
    onSuccess: (board) => {
      qc.invalidateQueries({ queryKey: ['boards'] })
      setOpen(false)
      setForm({ title: '', clientId: '' })
      navigate(`/app/board/${board.id}`)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim() || !form.clientId) return
    createMutation.mutate()
  }

  async function handleExportReport(clientId: string, clientName: string) {
    const month = new Date().toISOString().slice(0, 7)
    try {
      const res = await api.get(`/clients/${clientId}/report?month=${month}`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `relatorio-${clientName}-${month}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Relatório não disponível para este período.')
    }
  }

  if (isLoading) return <div className="p-8 text-gray-500">Carregando...</div>

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        {user?.role !== 'CLIENT' && (
          <Button
            onClick={() => setOpen(true)}
            className="bg-[#185FA5] hover:bg-[#0C447C] text-white gap-2"
          >
            <Plus size={16} />
            Novo Processo
          </Button>
        )}
      </div>

      {boards.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg font-medium mb-2">Nenhum processo cadastrado ainda</p>
          <p className="text-sm">Clique em "Novo Processo" para começar</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {boards.map((board) => {
            const allTasks = board.columns?.flatMap((c) => c.tasks ?? []) ?? []
            const doneTasks = allTasks.filter((t) => t.status === 'DONE').length
            const overdueTasks = allTasks.filter(
              (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'DONE',
            ).length
            const progress =
              allTasks.length > 0 ? Math.round((doneTasks / allTasks.length) * 100) : 0

            return (
              <Link key={board.id} to={`/app/board/${board.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardHeader>
                    <CardTitle className="text-base">{board.title}</CardTitle>
                    <p className="text-sm text-gray-500">{board.client?.name}</p>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-2">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Progresso</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                    {overdueTasks > 0 && (
                      <p className="text-xs text-red-500 font-medium mt-2">
                        ⚠ {overdueTasks} tarefa{overdueTasks > 1 ? 's' : ''} vencida
                        {overdueTasks > 1 ? 's' : ''}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        handleExportReport(board.client.id, board.client.name)
                      }}
                      className="mt-2 text-xs text-blue-500 hover:text-blue-700 hover:underline"
                    >
                      Exportar relatório
                    </button>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Processo</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="board-title">Título do processo</Label>
              <Input
                id="board-title"
                placeholder="Ex: Abertura de empresa LTDA"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="board-client">Cliente</Label>
              <select
                id="board-client"
                value={form.clientId}
                onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                required
                className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <option value="">Selecione um cliente</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <p className="text-xs text-gray-400">
              3 colunas padrão serão criadas automaticamente: Pendente → Em andamento → Concluído
            </p>

            {createMutation.isError && (
              <p className="text-sm text-red-600">Erro ao criar processo. Tente novamente.</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || !form.title.trim() || !form.clientId}
                className="bg-[#185FA5] hover:bg-[#0C447C] text-white"
              >
                {createMutation.isPending ? 'Criando...' : 'Criar processo'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

- [ ] **Step 2: Rodar testes do frontend**

```bash
pnpm --filter web test
```

Expected: `12 passed (5)`

- [ ] **Step 3: Testar visualmente**

Com a API e o frontend rodando (`pnpm --filter api dev` e `pnpm --filter web dev`):

1. Login como `admin@g2a.com.br` → Dashboard deve mostrar botão "Novo Processo"
2. Clicar no botão → modal abre com campo de título e select de cliente
3. Preencher e submeter → redireciona para o board recém-criado com 3 colunas
4. Login como colaborador → Dashboard mostra apenas os boards do colaborador
5. Colaborador também vê o botão "Novo Processo" e consegue criar

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/app/Dashboard.tsx
git commit -m "feat: Dashboard com botão 'Novo Processo' e modal de criação"
```

---

## Task 10: Atualizar documentação

**Files:**
- Modify: `docs/TASKS.md`

- [ ] **Step 1: Atualizar o TASKS.md com os itens implementados**

Localizar a seção "Fase 4 — Core Kanban" e adicionar ao final:

```markdown
### Ajustes de roles e workflow (pós-fase 4)
- [x] `responsibleUserId` no Board — colaborador vê apenas seus processos
- [x] `POST /boards` aberto para ORG_MEMBER — cria com responsável automático
- [x] `GET /clients` aberto para ORG_MEMBER — necessário para modal de criação
- [x] `POST /boards/:id/columns` aberto para ORG_MEMBER
- [x] Dashboard: botão "Novo Processo" + modal com 3 colunas padrão automáticas
```

- [ ] **Step 2: Commit**

```bash
git add docs/TASKS.md
git commit -m "docs: atualiza TASKS.md com ajustes de roles e workflow de criação de board"
```
