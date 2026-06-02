# Fase 4: Core Kanban — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar CRUD completo de users, clients, boards, columns, tasks (move + reorder) e comments com TaskHistory automático, isolamento de tenant no service layer, stub de fila para notificações e os 5 arquivos de teste exigidos pela Fase 4.

**Architecture:** Seis módulos novos em `src/modules/` seguindo o padrão `routes / service / schema`. Isolamento de tenant via `findFirst({ where: { id, organizationId } })` em todos os services — 404 quando o recurso não pertence à org. Nenhuma migration nova (schema já migrado em `20260602010001_init`).

**Tech Stack:** Fastify v5, Prisma v6, Zod, bcryptjs, JWT RS256 (já configurado). Testes com Vitest + `app.inject`. Helper `getAuthHeader(email, password)` já existe em `src/test/helpers.ts`.

---

## File Map

**Criar:**
- `apps/api/src/lib/queue.ts` — stub no-op de fila (Fase 5 substitui)
- `apps/api/src/modules/users/users.schema.ts`
- `apps/api/src/modules/users/users.service.ts`
- `apps/api/src/modules/users/users.routes.ts`
- `apps/api/src/modules/clients/clients.schema.ts`
- `apps/api/src/modules/clients/clients.service.ts`
- `apps/api/src/modules/clients/clients.routes.ts`
- `apps/api/src/modules/boards/boards.schema.ts`
- `apps/api/src/modules/boards/boards.service.ts`
- `apps/api/src/modules/boards/boards.routes.ts`
- `apps/api/src/modules/columns/columns.schema.ts`
- `apps/api/src/modules/columns/columns.service.ts`
- `apps/api/src/modules/columns/columns.routes.ts`
- `apps/api/src/modules/tasks/tasks.schema.ts`
- `apps/api/src/modules/tasks/tasks.service.ts`
- `apps/api/src/modules/tasks/tasks.routes.ts`
- `apps/api/src/modules/comments/comments.schema.ts`
- `apps/api/src/modules/comments/comments.service.ts`
- `apps/api/src/modules/comments/comments.routes.ts`
- `apps/api/src/middlewares/checkPlanLimit.test.ts`
- `apps/api/src/middlewares/verifyOrg.test.ts`
- `apps/api/src/modules/tasks/tasks.service.test.ts`
- `apps/api/src/modules/tasks/tasks.routes.test.ts`
- `apps/api/src/modules/comments/comments.routes.test.ts`

**Modificar:**
- `apps/api/src/test/helpers.ts` — adicionar `createTestBoard`, `createTestColumn`, `createTestTask`
- `apps/api/src/server.ts` — registrar os 6 novos módulos
- `docs/TASKS.md` — marcar Fase 4 como concluída

---

## Task 1: Test Helpers + Queue Stub

**Files:**
- Modify: `apps/api/src/test/helpers.ts`
- Create: `apps/api/src/lib/queue.ts`

- [ ] **Step 1: Adicionar helpers de board, column e task**

Abrir `apps/api/src/test/helpers.ts` e acrescentar ao final do arquivo:

```typescript
export async function createTestBoard(organizationId: string, clientId: string) {
  return prisma.board.create({
    data: {
      title: 'Test Board',
      organizationId,
      clientId,
    },
  })
}

export async function createTestColumn(
  boardId: string,
  overrides?: Partial<{ title: string; isFinal: boolean; position: number }>,
) {
  return prisma.column.create({
    data: {
      title: overrides?.title ?? (overrides?.isFinal ? 'Concluído' : 'Em Andamento'),
      position: overrides?.position ?? 0,
      isFinal: overrides?.isFinal ?? false,
      boardId,
    },
  })
}

export async function createTestTask(
  columnId: string,
  creatorId: string,
  overrides?: Partial<{ title: string; position: number }>,
) {
  return prisma.task.create({
    data: {
      title: overrides?.title ?? 'Test Task',
      position: overrides?.position ?? 0,
      columnId,
      creatorId,
    },
  })
}
```

- [ ] **Step 2: Criar o stub de fila**

Criar `apps/api/src/lib/queue.ts`:

```typescript
export interface NotificationJob {
  event: string
  taskId: string
  organizationId: string
  clientId: string
  metadata: Record<string, string | undefined>
}

export async function enqueueNotification(_job: NotificationJob): Promise<void> {}
```

- [ ] **Step 3: Verificar que o projeto ainda compila**

```bash
cd apps/api && pnpm tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/test/helpers.ts apps/api/src/lib/queue.ts
git commit -m "feat: test helpers (board/column/task) + queue stub"
```

---

## Task 2: checkPlanLimit.test.ts

O middleware `checkPlanLimit` já existe em `apps/api/src/middlewares/checkPlanLimit.ts`. Esta task só cria o arquivo de teste.

**Files:**
- Create: `apps/api/src/middlewares/checkPlanLimit.test.ts`

- [ ] **Step 1: Escrever o arquivo de teste**

```typescript
import { describe, it, expect } from 'vitest'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { prisma } from '@/lib/prisma'
import { checkPlanLimit } from '@/middlewares/checkPlanLimit'
import { createTestPlan, createTestOrg, createTestClient } from '@/test/helpers'

function mockReq(organizationId: string | null): FastifyRequest {
  return { user: { sub: 'u1', role: 'ORG_ADMIN', organizationId } } as unknown as FastifyRequest
}
const reply = {} as FastifyReply

describe('checkPlanLimit', () => {
  it('passes when organizationId is null (MASTER)', async () => {
    await expect(checkPlanLimit(mockReq(null), reply)).resolves.toBeUndefined()
  })

  it('passes when clientsCount < plan.maxClients', async () => {
    const plan = await createTestPlan({ maxClients: 5 })
    const org = await createTestOrg(plan.id)
    await expect(checkPlanLimit(mockReq(org.id), reply)).resolves.toBeUndefined()
  })

  it('passes when clientsCount is maxClients - 1', async () => {
    const plan = await createTestPlan({ maxClients: 2 })
    const org = await createTestOrg(plan.id)
    await createTestClient(org.id)
    await expect(checkPlanLimit(mockReq(org.id), reply)).resolves.toBeUndefined()
  })

  it('throws 422 when clientsCount >= plan.maxClients', async () => {
    const plan = await createTestPlan({ maxClients: 1 })
    const org = await createTestOrg(plan.id)
    await createTestClient(org.id)
    await expect(checkPlanLimit(mockReq(org.id), reply)).rejects.toMatchObject({
      statusCode: 422,
    })
  })
})
```

- [ ] **Step 2: Rodar e verificar que passa**

```bash
pnpm --filter api test src/middlewares/checkPlanLimit.test.ts
```

Esperado: 4 testes PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/middlewares/checkPlanLimit.test.ts
git commit -m "test: checkPlanLimit — bloqueia quando clientsCount >= maxClients"
```

---

## Task 3: verifyOrg.test.ts

O middleware `verifyOrg` já existe em `apps/api/src/middlewares/verifyOrg.ts`. Esta task só cria o arquivo de teste.

**Files:**
- Create: `apps/api/src/middlewares/verifyOrg.test.ts`

- [ ] **Step 1: Escrever o arquivo de teste**

```typescript
import { describe, it, expect } from 'vitest'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyOrg } from '@/middlewares/verifyOrg'

function mockReq(
  role: string,
  organizationId: string,
  params: Record<string, string> = {},
): FastifyRequest {
  return {
    user: { sub: 'u1', role, organizationId },
    params,
  } as unknown as FastifyRequest
}
const reply = {} as FastifyReply

describe('verifyOrg', () => {
  it('passes for MASTER regardless of params', async () => {
    const req = mockReq('MASTER', 'master-org', { organizationId: 'other-org' })
    await expect(verifyOrg(req, reply)).resolves.toBeUndefined()
  })

  it('passes when params.organizationId matches user.organizationId', async () => {
    const req = mockReq('ORG_ADMIN', 'org-123', { organizationId: 'org-123' })
    await expect(verifyOrg(req, reply)).resolves.toBeUndefined()
  })

  it('throws 403 when params.organizationId does not match user.organizationId', async () => {
    const req = mockReq('ORG_ADMIN', 'org-123', { organizationId: 'org-456' })
    await expect(verifyOrg(req, reply)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('passes when there is no organizationId param in the URL', async () => {
    const req = mockReq('ORG_ADMIN', 'org-123', {})
    await expect(verifyOrg(req, reply)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Rodar e verificar que passa**

```bash
pnpm --filter api test src/middlewares/verifyOrg.test.ts
```

Esperado: 4 testes PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/middlewares/verifyOrg.test.ts
git commit -m "test: verifyOrg — bloqueia acesso a recurso de outra org"
```

---

## Task 4: Users Module

**Files:**
- Create: `apps/api/src/modules/users/users.schema.ts`
- Create: `apps/api/src/modules/users/users.service.ts`
- Create: `apps/api/src/modules/users/users.routes.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Criar o schema**

```typescript
// apps/api/src/modules/users/users.schema.ts
import { z } from 'zod'

export const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['ORG_MANAGER', 'ORG_MEMBER']),
  phone: z.string().optional(),
})

export const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role: z.enum(['ORG_MANAGER', 'ORG_MEMBER']).optional(),
  phone: z.string().optional(),
})

export type CreateUserBody = z.infer<typeof createUserSchema>
export type UpdateUserBody = z.infer<typeof updateUserSchema>
```

- [ ] **Step 2: Criar o service**

```typescript
// apps/api/src/modules/users/users.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { hashPassword } from '@/modules/auth/auth.service'
import type { CreateUserBody, UpdateUserBody } from './users.schema'

const SELECT = {
  id: true, name: true, email: true, role: true, phone: true, isActive: true, createdAt: true,
}

export async function listUsers(organizationId: string) {
  return prisma.user.findMany({
    where: { organizationId, isActive: true },
    select: SELECT,
    orderBy: { createdAt: 'asc' },
  })
}

export async function createUser(organizationId: string, data: CreateUserBody) {
  const existing = await prisma.user.findUnique({ where: { email: data.email } })
  if (existing) throw new AppError(409, 'E-mail já cadastrado')

  return prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash: await hashPassword(data.password),
      role: data.role,
      phone: data.phone,
      organizationId,
    },
    select: SELECT,
  })
}

export async function updateUser(id: string, organizationId: string, data: UpdateUserBody) {
  const user = await prisma.user.findFirst({ where: { id, organizationId, isActive: true } })
  if (!user) throw new AppError(404, 'Usuário não encontrado')

  return prisma.user.update({ where: { id }, data, select: SELECT })
}

export async function deleteUser(id: string, organizationId: string) {
  const user = await prisma.user.findFirst({ where: { id, organizationId, isActive: true } })
  if (!user) throw new AppError(404, 'Usuário não encontrado')

  return prisma.user.update({ where: { id }, data: { isActive: false }, select: SELECT })
}
```

- [ ] **Step 3: Criar as rotas**

```typescript
// apps/api/src/modules/users/users.routes.ts
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createUserSchema, updateUserSchema } from './users.schema'
import { listUsers, createUser, updateUser, deleteUser } from './users.service'

export async function usersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', requireRole('ORG_ADMIN'))

  app.get('/', async (request, reply) => {
    return reply.send(await listUsers(request.user.organizationId!))
  })

  app.post('/', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = createUserSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createUser(request.user.organizationId!, result.data))
  })

  app.patch('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateUserSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateUser(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteUser(id, request.user.organizationId!))
  })
}
```

- [ ] **Step 4: Registrar em server.ts**

Abrir `apps/api/src/server.ts` e adicionar logo após as imports existentes:

```typescript
import { usersRoutes } from '@/modules/users/users.routes'
```

E logo após `app.register(orgRoutes, { prefix: '/org' })`:

```typescript
app.register(usersRoutes, { prefix: '/users' })
```

- [ ] **Step 5: Verificar compilação e smoke test**

```bash
pnpm --filter api tsc --noEmit
pnpm --filter api test --reporter=verbose 2>&1 | tail -20
```

Esperado: sem erros de TypeScript, suite existente continua verde.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/users/ apps/api/src/server.ts
git commit -m "feat: módulo users — CRUD interno com soft delete (ORG_ADMIN)"
```

---

## Task 5: Clients Module

**Files:**
- Create: `apps/api/src/modules/clients/clients.schema.ts`
- Create: `apps/api/src/modules/clients/clients.service.ts`
- Create: `apps/api/src/modules/clients/clients.routes.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Criar o schema**

```typescript
// apps/api/src/modules/clients/clients.schema.ts
import { z } from 'zod'

export const createClientSchema = z.object({
  name: z.string().min(2),
  cnpj: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(8),
  whatsapp: z.string().optional(),
})

export const updateClientSchema = z.object({
  name: z.string().min(2).optional(),
  cnpj: z.string().optional(),
  email: z.string().email().optional(),
  whatsapp: z.string().optional(),
})

export type CreateClientBody = z.infer<typeof createClientSchema>
export type UpdateClientBody = z.infer<typeof updateClientSchema>
```

- [ ] **Step 2: Criar o service**

```typescript
// apps/api/src/modules/clients/clients.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { hashPassword } from '@/modules/auth/auth.service'
import type { CreateClientBody, UpdateClientBody } from './clients.schema'

const SELECT = {
  id: true, name: true, cnpj: true, email: true, whatsapp: true, isActive: true, createdAt: true,
}

export async function listClients(organizationId: string) {
  return prisma.client.findMany({
    where: { organizationId, isActive: true },
    select: SELECT,
    orderBy: { name: 'asc' },
  })
}

export async function createClient(organizationId: string, data: CreateClientBody) {
  const existing = await prisma.client.findFirst({
    where: { email: data.email, organizationId },
  })
  if (existing) throw new AppError(409, 'E-mail já cadastrado nesta organização')

  return prisma.client.create({
    data: {
      name: data.name,
      cnpj: data.cnpj,
      email: data.email,
      passwordHash: await hashPassword(data.password),
      whatsapp: data.whatsapp,
      organizationId,
    },
    select: SELECT,
  })
}

export async function updateClient(id: string, organizationId: string, data: UpdateClientBody) {
  const client = await prisma.client.findFirst({ where: { id, organizationId, isActive: true } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  return prisma.client.update({ where: { id }, data, select: SELECT })
}

export async function deleteClient(id: string, organizationId: string) {
  const client = await prisma.client.findFirst({ where: { id, organizationId, isActive: true } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  return prisma.client.update({ where: { id }, data: { isActive: false }, select: SELECT })
}
```

- [ ] **Step 3: Criar as rotas**

```typescript
// apps/api/src/modules/clients/clients.routes.ts
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
  app.addHook('preHandler', requireRole('ORG_ADMIN', 'ORG_MANAGER'))

  app.get('/', async (request, reply) => {
    return reply.send(await listClients(request.user.organizationId!))
  })

  app.post('/', { preHandler: [checkSubscription, checkPlanLimit] }, async (request, reply) => {
    const result = createClientSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createClient(request.user.organizationId!, result.data))
  })

  app.patch('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateClientSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateClient(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteClient(id, request.user.organizationId!))
  })
}
```

- [ ] **Step 4: Registrar em server.ts**

Adicionar import:
```typescript
import { clientsRoutes } from '@/modules/clients/clients.routes'
```

Adicionar registro após `usersRoutes`:
```typescript
app.register(clientsRoutes, { prefix: '/clients' })
```

- [ ] **Step 5: Verificar compilação**

```bash
pnpm --filter api tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/clients/ apps/api/src/server.ts
git commit -m "feat: módulo clients — CRUD com checkPlanLimit em POST"
```

---

## Task 6: Boards Module

**Files:**
- Create: `apps/api/src/modules/boards/boards.schema.ts`
- Create: `apps/api/src/modules/boards/boards.service.ts`
- Create: `apps/api/src/modules/boards/boards.routes.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Criar o schema**

```typescript
// apps/api/src/modules/boards/boards.schema.ts
import { z } from 'zod'

export const createBoardSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  clientId: z.string().cuid(),
})

export const updateBoardSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
})

export type CreateBoardBody = z.infer<typeof createBoardSchema>
export type UpdateBoardBody = z.infer<typeof updateBoardSchema>
```

- [ ] **Step 2: Criar o service**

```typescript
// apps/api/src/modules/boards/boards.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateBoardBody, UpdateBoardBody } from './boards.schema'

export async function listBoards(organizationId: string, clientId?: string) {
  return prisma.board.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(clientId ? { clientId } : {}),
    },
    include: {
      client: { select: { id: true, name: true } },
      _count: { select: { columns: true } },
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

export async function createBoard(organizationId: string, data: CreateBoardBody) {
  const client = await prisma.client.findFirst({
    where: { id: data.clientId, organizationId, isActive: true },
  })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  return prisma.board.create({
    data: { title: data.title, description: data.description, clientId: data.clientId, organizationId },
    include: { client: { select: { id: true, name: true } } },
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
```

- [ ] **Step 3: Criar as rotas**

```typescript
// apps/api/src/modules/boards/boards.routes.ts
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createBoardSchema, updateBoardSchema } from './boards.schema'
import { listBoards, getBoardById, createBoard, updateBoard } from './boards.service'

export async function boardsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { organizationId, role, sub } = request.user
    const clientId = role === 'CLIENT' ? sub : undefined
    return reply.send(await listBoards(organizationId!, clientId))
  })

  app.get('/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER', 'CLIENT')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await getBoardById(id, request.user.organizationId!))
  })

  app.post('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const result = createBoardSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createBoard(request.user.organizationId!, result.data))
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

- [ ] **Step 4: Registrar em server.ts**

Adicionar import:
```typescript
import { boardsRoutes } from '@/modules/boards/boards.routes'
```

Adicionar registro após `clientsRoutes`:
```typescript
app.register(boardsRoutes, { prefix: '/boards' })
```

- [ ] **Step 5: Verificar compilação**

```bash
pnpm --filter api tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/boards/ apps/api/src/server.ts
git commit -m "feat: módulo boards — CRUD com isolamento de tenant e suporte a role CLIENT"
```

---

## Task 7: Columns Module

**Files:**
- Create: `apps/api/src/modules/columns/columns.schema.ts`
- Create: `apps/api/src/modules/columns/columns.service.ts`
- Create: `apps/api/src/modules/columns/columns.routes.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Criar o schema**

```typescript
// apps/api/src/modules/columns/columns.schema.ts
import { z } from 'zod'

export const createColumnSchema = z.object({
  title: z.string().min(1),
  color: z.string().optional(),
  position: z.number().int().min(0),
  isFinal: z.boolean().default(false),
})

export const updateColumnSchema = z.object({
  title: z.string().min(1).optional(),
  color: z.string().optional(),
  position: z.number().int().min(0).optional(),
  isFinal: z.boolean().optional(),
})

export const reorderColumnsSchema = z.array(
  z.object({
    id: z.string().cuid(),
    position: z.number().int().min(0),
  }),
)

export type CreateColumnBody = z.infer<typeof createColumnSchema>
export type UpdateColumnBody = z.infer<typeof updateColumnSchema>
export type ReorderColumnsBody = z.infer<typeof reorderColumnsSchema>
```

- [ ] **Step 2: Criar o service**

```typescript
// apps/api/src/modules/columns/columns.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateColumnBody, UpdateColumnBody, ReorderColumnsBody } from './columns.schema'

export async function createColumn(boardId: string, organizationId: string, data: CreateColumnBody) {
  const board = await prisma.board.findFirst({ where: { id: boardId, organizationId, isActive: true } })
  if (!board) throw new AppError(404, 'Board não encontrado')

  return prisma.column.create({ data: { ...data, boardId } })
}

export async function updateColumn(id: string, organizationId: string, data: UpdateColumnBody) {
  const column = await prisma.column.findFirst({
    where: { id, board: { organizationId } },
  })
  if (!column) throw new AppError(404, 'Coluna não encontrada')

  return prisma.column.update({ where: { id }, data })
}

export async function reorderColumns(items: ReorderColumnsBody, organizationId: string) {
  const columns = await prisma.column.findMany({
    where: { id: { in: items.map((i) => i.id) }, board: { organizationId } },
  })
  if (columns.length !== items.length) throw new AppError(403, 'Acesso negado')

  await prisma.$transaction(
    items.map((i) => prisma.column.update({ where: { id: i.id }, data: { position: i.position } })),
  )
  return { ok: true }
}

export async function deleteColumn(id: string, organizationId: string) {
  const column = await prisma.column.findFirst({
    where: { id, board: { organizationId } },
  })
  if (!column) throw new AppError(404, 'Coluna não encontrada')

  await prisma.column.delete({ where: { id } })
  return { ok: true }
}
```

- [ ] **Step 3: Criar as rotas**

**IMPORTANTE:** registrar `/columns/reorder` antes de `/columns/:id` para evitar que "reorder" seja interpretado como um `:id`.

```typescript
// apps/api/src/modules/columns/columns.routes.ts
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
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const { boardId } = request.params as { boardId: string }
    const result = createColumnSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createColumn(boardId, request.user.organizationId!, result.data))
  })

  // reorder ANTES de /:id
  app.patch('/columns/reorder', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const result = reorderColumnsSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await reorderColumns(result.data, request.user.organizationId!))
  })

  app.patch('/columns/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateColumnSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateColumn(id, request.user.organizationId!, result.data))
  })

  app.delete('/columns/:id', {
    preHandler: [requireRole('ORG_ADMIN')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.status(204).send(await deleteColumn(id, request.user.organizationId!))
  })
}
```

- [ ] **Step 4: Registrar em server.ts (sem prefix)**

Adicionar import:
```typescript
import { columnsRoutes } from '@/modules/columns/columns.routes'
```

Adicionar registro após `boardsRoutes` **sem prefixo** (as rotas já têm `/boards/:boardId/columns` e `/columns/:id` embutidos):
```typescript
app.register(columnsRoutes)
```

- [ ] **Step 5: Verificar compilação**

```bash
pnpm --filter api tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/columns/ apps/api/src/server.ts
git commit -m "feat: módulo columns — CRUD + reorder com verificação de pertencimento à org"
```

---

## Task 8: Tasks Module

Esta é a task mais complexa. Segue TDD estrito: service test primeiro, depois routes test.

**Files:**
- Create: `apps/api/src/modules/tasks/tasks.schema.ts`
- Create: `apps/api/src/modules/tasks/tasks.service.test.ts`
- Create: `apps/api/src/modules/tasks/tasks.service.ts`
- Create: `apps/api/src/modules/tasks/tasks.routes.test.ts`
- Create: `apps/api/src/modules/tasks/tasks.routes.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Criar o schema**

```typescript
// apps/api/src/modules/tasks/tasks.schema.ts
import { z } from 'zod'

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  assigneeId: z.string().cuid().optional(),
  dueDate: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
})

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assigneeId: z.string().cuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  tags: z.array(z.string()).optional(),
})

export const moveTaskSchema = z.object({
  columnId: z.string().cuid(),
  position: z.number().int().min(0),
})

export const reorderTasksSchema = z.array(
  z.object({
    id: z.string().cuid(),
    position: z.number().int().min(0),
    columnId: z.string().cuid(),
  }),
)

export type CreateTaskBody = z.infer<typeof createTaskSchema>
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>
export type MoveTaskBody = z.infer<typeof moveTaskSchema>
export type ReorderTasksBody = z.infer<typeof reorderTasksSchema>
```

- [ ] **Step 2: Escrever tasks.service.test.ts (TDD — antes do service)**

```typescript
// apps/api/src/modules/tasks/tasks.service.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { moveTask } from '@/modules/tasks/tasks.service'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
} from '@/test/helpers'

describe('moveTask', () => {
  it('updates columnId and position', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const col2 = await createTestColumn(board.id, { position: 1 })
    const task = await createTestTask(col1.id, user.id)

    const result = await moveTask(task.id, org.id, { columnId: col2.id, position: 0 }, {
      id: user.id, type: 'user',
    })

    expect(result.columnId).toBe(col2.id)
    expect(result.position).toBe(0)
  })

  it('records TaskHistory with action moved_to, fromValue and toValue', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { title: 'Backlog', position: 0 })
    const col2 = await createTestColumn(board.id, { title: 'Em Revisão', position: 1 })
    const task = await createTestTask(col1.id, user.id)

    await moveTask(task.id, org.id, { columnId: col2.id, position: 0 }, {
      id: user.id, type: 'user',
    })

    const history = await prisma.taskHistory.findFirst({ where: { taskId: task.id } })
    expect(history?.action).toBe('moved_to')
    expect(history?.fromValue).toBe('Backlog')
    expect(history?.toValue).toBe('Em Revisão')
  })

  it('sets status DONE when target column isFinal is true', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const finalCol = await createTestColumn(board.id, { position: 1, isFinal: true })
    const task = await createTestTask(col1.id, user.id)

    const result = await moveTask(task.id, org.id, { columnId: finalCol.id, position: 0 }, {
      id: user.id, type: 'user',
    })

    expect(result.status).toBe('DONE')
  })

  it('keeps status OPEN when target column isFinal is false', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const col2 = await createTestColumn(board.id, { position: 1 })
    const task = await createTestTask(col1.id, user.id)

    const result = await moveTask(task.id, org.id, { columnId: col2.id, position: 0 }, {
      id: user.id, type: 'user',
    })

    expect(result.status).toBe('OPEN')
  })
})
```

- [ ] **Step 3: Rodar e confirmar que falha (service ainda não existe)**

```bash
pnpm --filter api test src/modules/tasks/tasks.service.test.ts
```

Esperado: FAIL com "Cannot find module '@/modules/tasks/tasks.service'".

- [ ] **Step 4: Criar tasks.service.ts**

```typescript
// apps/api/src/modules/tasks/tasks.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import { enqueueNotification } from '@/lib/queue'
import type { CreateTaskBody, UpdateTaskBody, MoveTaskBody, ReorderTasksBody } from './tasks.schema'

export interface Actor {
  id: string
  type: 'user' | 'client'
}

// Called BEFORE $transaction to avoid incompatible tx type
async function resolveActorName(actorId: string, actorType: 'user' | 'client'): Promise<string> {
  if (actorType === 'user') {
    const u = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
    return u?.name ?? 'Unknown'
  }
  const c = await prisma.client.findUnique({ where: { id: actorId }, select: { name: true } })
  return c?.name ?? 'Unknown'
}

async function verifyColumnBelongsToOrg(columnId: string, organizationId: string) {
  const column = await prisma.column.findFirst({
    where: { id: columnId },
    include: { board: { select: { organizationId: true, clientId: true } } },
  })
  if (!column || column.board.organizationId !== organizationId) {
    throw new AppError(404, 'Coluna não encontrada')
  }
  return column
}

async function verifyTaskBelongsToOrg(taskId: string, organizationId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId },
    include: {
      column: {
        include: { board: { select: { organizationId: true, clientId: true } } },
      },
    },
  })
  if (!task || task.column.board.organizationId !== organizationId) {
    throw new AppError(404, 'Tarefa não encontrada')
  }
  return task
}

export async function createTask(
  columnId: string,
  organizationId: string,
  data: CreateTaskBody,
  actor: Actor,
) {
  const column = await verifyColumnBelongsToOrg(columnId, organizationId)
  const actorName = await resolveActorName(actor.id, actor.type)

  const task = await prisma.$transaction(async (tx) => {
    const position = await tx.task.count({ where: { columnId } })

    const created = await tx.task.create({
      data: {
        title: data.title,
        description: data.description,
        priority: data.priority,
        assigneeId: data.assigneeId,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        tags: data.tags,
        position,
        columnId,
        creatorId: actor.id,
      },
    })

    await tx.taskHistory.create({
      data: {
        taskId: created.id,
        action: 'created',
        toValue: data.title,
        actorType: actor.type,
        actorId: actor.id,
        actorName,
      },
    })

    return created
  })

  await enqueueNotification({
    event: 'TASK_CREATED',
    taskId: task.id,
    organizationId,
    clientId: column.board.clientId,
    metadata: { taskTitle: task.title },
  })

  return task
}

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

  const updatedTask = await prisma.$transaction(async (tx) => {

    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        columnId: data.columnId,
        position: data.position,
        ...(toColumn.isFinal ? { status: 'DONE' } : {}),
      },
    })

    await tx.taskHistory.create({
      data: {
        taskId,
        action: 'moved_to',
        fromValue: fromColumn.title,
        toValue: toColumn.title,
        actorType: actor.type,
        actorId: actor.id,
        actorName,
      },
    })

    return updated
  })

  await enqueueNotification({
    event: 'TASK_MOVED',
    taskId,
    organizationId,
    clientId: toColumn.board.clientId,
    metadata: {
      taskTitle: task.title,
      fromColumn: fromColumn.title,
      toColumn: toColumn.title,
    },
  })

  if (toColumn.isFinal) {
    await enqueueNotification({
      event: 'TASK_COMPLETED',
      taskId,
      organizationId,
      clientId: toColumn.board.clientId,
      metadata: { taskTitle: task.title },
    })
  }

  return updatedTask
}

export async function updateTask(
  id: string,
  organizationId: string,
  data: UpdateTaskBody,
  actor: Actor,
) {
  const task = await verifyTaskBelongsToOrg(id, organizationId)

  const historyEntries: Array<{ action: string; fromValue?: string; toValue?: string }> = []

  if (data.priority !== undefined && data.priority !== task.priority) {
    historyEntries.push({
      action: 'priority_changed',
      fromValue: task.priority,
      toValue: data.priority,
    })
  }
  if (data.assigneeId !== undefined && data.assigneeId !== task.assigneeId) {
    historyEntries.push({
      action: 'assigned_to',
      fromValue: task.assigneeId ?? undefined,
      toValue: data.assigneeId ?? undefined,
    })
  }

  const actorName = await resolveActorName(actor.id, actor.type)

  return prisma.$transaction(async (tx) => {
    const updated = await tx.task.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        priority: data.priority,
        assigneeId: data.assigneeId,
        dueDate:
          data.dueDate === null ? null
          : data.dueDate !== undefined ? new Date(data.dueDate)
          : undefined,
        tags: data.tags,
      },
    })

    for (const entry of historyEntries) {
      await tx.taskHistory.create({
        data: {
          taskId: id,
          action: entry.action,
          fromValue: entry.fromValue,
          toValue: entry.toValue,
          actorType: actor.type,
          actorId: actor.id,
          actorName,
        },
      })
    }

    return updated
  })
}

export async function reorderTasks(items: ReorderTasksBody, organizationId: string) {
  const tasks = await prisma.task.findMany({
    where: {
      id: { in: items.map((i) => i.id) },
      column: { board: { organizationId } },
    },
  })
  if (tasks.length !== items.length) throw new AppError(403, 'Acesso negado')

  await prisma.$transaction(
    items.map((i) =>
      prisma.task.update({ where: { id: i.id }, data: { position: i.position, columnId: i.columnId } }),
    ),
  )
  return { ok: true }
}

export async function deleteTask(id: string, organizationId: string) {
  await verifyTaskBelongsToOrg(id, organizationId)
  await prisma.task.delete({ where: { id } })
  return { ok: true }
}
```

- [ ] **Step 5: Rodar tasks.service.test.ts — deve passar**

```bash
pnpm --filter api test src/modules/tasks/tasks.service.test.ts
```

Esperado: 4 testes PASS.

- [ ] **Step 6: Escrever tasks.routes.test.ts (TDD — antes das rotas)**

```typescript
// apps/api/src/modules/tasks/tasks.routes.test.ts
import { describe, it, expect } from 'vitest'
import { app } from '@/test/setup'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
  getAuthHeader,
} from '@/test/helpers'

describe('PATCH /tasks/:id/move', () => {
  it('moves task to a normal column — 200 with columnId updated', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const col2 = await createTestColumn(board.id, { position: 1 })
    const task = await createTestTask(col1.id, user.id)

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}/move`,
      headers: { authorization: auth },
      payload: { columnId: col2.id, position: 0 },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.columnId).toBe(col2.id)
    expect(body.status).toBe('OPEN')
  })

  it('moves task to isFinal column — status becomes DONE', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const finalCol = await createTestColumn(board.id, { position: 1, isFinal: true })
    const task = await createTestTask(col1.id, user.id)

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}/move`,
      headers: { authorization: auth },
      payload: { columnId: finalCol.id, position: 0 },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('DONE')
  })

  it('returns 404 when user belongs to a different org (resource isolation)', async () => {
    const plan = await createTestPlan()
    const org1 = await createTestOrg(plan.id)
    const org2 = await createTestOrg(plan.id)
    const user1 = await createTestUser(org1.id)
    const user2 = await createTestUser(org2.id)
    const client = await createTestClient(org1.id)
    const board = await createTestBoard(org1.id, client.id)
    const col1 = await createTestColumn(board.id, { position: 0 })
    const col2 = await createTestColumn(board.id, { position: 1 })
    const task = await createTestTask(col1.id, user1.id)

    const auth = await getAuthHeader(user2.email, 'Test@1234')
    const res = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}/move`,
      headers: { authorization: auth },
      payload: { columnId: col2.id, position: 0 },
    })

    expect(res.statusCode).toBe(404)
  })

  it('returns 404 for non-existent task', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'PATCH',
      url: '/tasks/nonexistent-id-00000000/move',
      headers: { authorization: auth },
      payload: { columnId: col.id, position: 0 },
    })

    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 7: Rodar tasks.routes.test.ts — deve falhar (rotas não registradas)**

```bash
pnpm --filter api test src/modules/tasks/tasks.routes.test.ts
```

Esperado: FAIL com 404 em todas as rotas (não registradas ainda).

- [ ] **Step 8: Criar tasks.routes.ts**

**IMPORTANTE:** registrar `/tasks/reorder` antes de `/tasks/:id` e `/tasks/:id/move` antes de `/tasks/:id`.

```typescript
// apps/api/src/modules/tasks/tasks.routes.ts
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createTaskSchema, updateTaskSchema, moveTaskSchema, reorderTasksSchema } from './tasks.schema'
import { createTask, moveTask, updateTask, reorderTasks, deleteTask } from './tasks.service'

export async function tasksRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)
  app.addHook('preHandler', checkSubscription)

  app.post('/columns/:columnId/tasks', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { columnId } = request.params as { columnId: string }
    const result = createTaskSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const actor = { id: request.user.sub, type: 'user' as const }
    return reply.status(201).send(
      await createTask(columnId, request.user.organizationId!, result.data, actor),
    )
  })

  // reorder ANTES de /:id
  app.patch('/tasks/reorder', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const result = reorderTasksSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await reorderTasks(result.data, request.user.organizationId!))
  })

  // /tasks/:id/move ANTES de /tasks/:id
  app.patch('/tasks/:id/move', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = moveTaskSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const actor = { id: request.user.sub, type: 'user' as const }
    return reply.send(await moveTask(id, request.user.organizationId!, result.data, actor))
  })

  app.patch('/tasks/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateTaskSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const actor = { id: request.user.sub, type: 'user' as const }
    return reply.send(await updateTask(id, request.user.organizationId!, result.data, actor))
  })

  app.delete('/tasks/:id', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.status(204).send(await deleteTask(id, request.user.organizationId!))
  })
}
```

- [ ] **Step 9: Registrar em server.ts (sem prefix)**

Adicionar import:
```typescript
import { tasksRoutes } from '@/modules/tasks/tasks.routes'
```

Adicionar após `columnsRoutes`:
```typescript
app.register(tasksRoutes)
```

- [ ] **Step 10: Rodar os dois arquivos de teste de tasks — ambos devem passar**

```bash
pnpm --filter api test src/modules/tasks/
```

Esperado: 8 testes PASS (4 service + 4 routes).

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/tasks/ apps/api/src/server.ts
git commit -m "feat: módulo tasks — CRUD + move + reorder + TaskHistory automático"
```

---

## Task 9: Comments Module

**Files:**
- Create: `apps/api/src/modules/comments/comments.schema.ts`
- Create: `apps/api/src/modules/comments/comments.routes.test.ts`
- Create: `apps/api/src/modules/comments/comments.service.ts`
- Create: `apps/api/src/modules/comments/comments.routes.ts`
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Criar o schema**

```typescript
// apps/api/src/modules/comments/comments.schema.ts
import { z } from 'zod'

export const createCommentSchema = z.object({
  content: z.string().min(1),
})

export type CreateCommentBody = z.infer<typeof createCommentSchema>
```

- [ ] **Step 2: Escrever comments.routes.test.ts (TDD — antes do service)**

`createTestClient` em `helpers.ts` usa a senha `'Client@1234'` no bcrypt hash. `createTestUser` usa `'Test@1234'`.

```typescript
// apps/api/src/modules/comments/comments.routes.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '@/lib/prisma'
import { app } from '@/test/setup'
import {
  createTestPlan,
  createTestOrg,
  createTestUser,
  createTestClient,
  createTestBoard,
  createTestColumn,
  createTestTask,
  getAuthHeader,
} from '@/test/helpers'

describe('POST /tasks/:taskId/comments', () => {
  it('creates comment with authorType USER when JWT is from ORG_MEMBER', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id, { role: 'ORG_MEMBER' })
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/comments`,
      headers: { authorization: auth },
      payload: { content: 'Comentário do usuário interno' },
    })

    expect(res.statusCode).toBe(201)
    const comment = await prisma.comment.findFirst({ where: { taskId: task.id } })
    expect(comment?.authorType).toBe('USER')
    expect(comment?.userId).toBe(user.id)
    expect(comment?.clientId).toBeNull()
  })

  it('creates comment with authorType CLIENT when JWT is from CLIENT', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, user.id)

    // CLIENT faz login com o próprio email + 'Client@1234'
    const auth = await getAuthHeader(client.email, 'Client@1234')
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/comments`,
      headers: { authorization: auth },
      payload: { content: 'Comentário do cliente final' },
    })

    expect(res.statusCode).toBe(201)
    const comment = await prisma.comment.findFirst({ where: { taskId: task.id } })
    expect(comment?.authorType).toBe('CLIENT')
    expect(comment?.clientId).toBe(client.id)
    expect(comment?.userId).toBeNull()
  })

  it('returns 404 when CLIENT tries to comment on task from another org', async () => {
    const plan = await createTestPlan()
    const org1 = await createTestOrg(plan.id)
    const org2 = await createTestOrg(plan.id)
    const userOrg1 = await createTestUser(org1.id)
    const clientOrg1 = await createTestClient(org1.id)
    const clientOrg2 = await createTestClient(org2.id)
    const board = await createTestBoard(org1.id, clientOrg1.id)
    const col = await createTestColumn(board.id, { position: 0 })
    const task = await createTestTask(col.id, userOrg1.id)

    const auth = await getAuthHeader(clientOrg2.email, 'Client@1234')
    const res = await app.inject({
      method: 'POST',
      url: `/tasks/${task.id}/comments`,
      headers: { authorization: auth },
      payload: { content: 'Tentativa cross-org' },
    })

    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
pnpm --filter api test src/modules/comments/comments.routes.test.ts
```

Esperado: FAIL (rotas não existem).

- [ ] **Step 4: Criar comments.service.ts**

```typescript
// apps/api/src/modules/comments/comments.service.ts
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateCommentBody } from './comments.schema'

interface CommentActor {
  id: string
  role: string
  organizationId: string
}

export async function listComments(taskId: string, organizationId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')

  return prisma.comment.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
    },
  })
}

export async function createComment(
  taskId: string,
  data: CreateCommentBody,
  actor: CommentActor,
) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, column: { board: { organizationId: actor.organizationId } } },
  })
  if (!task) throw new AppError(404, 'Tarefa não encontrada')

  const isClient = actor.role === 'CLIENT'
  return prisma.comment.create({
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

  await prisma.comment.delete({ where: { id } })
  return { ok: true }
}
```

- [ ] **Step 5: Criar comments.routes.ts**

```typescript
// apps/api/src/modules/comments/comments.routes.ts
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { AppError } from '@/errors/AppError'
import { createCommentSchema } from './comments.schema'
import { listComments, createComment, deleteComment } from './comments.service'

export async function commentsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  app.get('/tasks/:taskId/comments', async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    return reply.send(await listComments(taskId, request.user.organizationId!))
  })

  app.post('/tasks/:taskId/comments', async (request, reply) => {
    const { taskId } = request.params as { taskId: string }
    const result = createCommentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    const actor = {
      id: request.user.sub,
      role: request.user.role,
      organizationId: request.user.organizationId!,
    }
    return reply.status(201).send(await createComment(taskId, result.data, actor))
  })

  app.delete('/comments/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const actor = {
      id: request.user.sub,
      role: request.user.role,
      organizationId: request.user.organizationId!,
    }
    return reply.status(204).send(await deleteComment(id, actor))
  })
}
```

- [ ] **Step 6: Registrar em server.ts (sem prefix)**

Adicionar import:
```typescript
import { commentsRoutes } from '@/modules/comments/comments.routes'
```

Adicionar após `tasksRoutes`:
```typescript
app.register(commentsRoutes)
```

- [ ] **Step 7: Rodar comments.routes.test.ts — deve passar**

```bash
pnpm --filter api test src/modules/comments/comments.routes.test.ts
```

Esperado: 3 testes PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/comments/ apps/api/src/server.ts
git commit -m "feat: módulo comments — authorType discriminado (USER/CLIENT)"
```

---

## Task 10: Full Test Suite + TASKS.md

- [ ] **Step 1: Rodar a suite completa**

```bash
pnpm --filter api test
```

Esperado: todos os testes PASS. Se houver falhas, corrigir antes de avançar.

- [ ] **Step 2: Verificar cobertura mínima**

```bash
pnpm --filter api test:coverage
```

Esperado: cobertura ≥ 80% em `src/modules/` e `src/lib/` (threshold configurado em `vitest.config.ts`).

- [ ] **Step 3: Marcar Fase 4 como concluída em TASKS.md**

Abrir `docs/TASKS.md` e marcar todos os checkboxes da Fase 4:

```markdown
## Fase 4 — Core Kanban ✅
### Testes da Fase 4
- [x] `checkPlanLimit.test.ts` — bloqueia criação de cliente acima do limite do plano
- [x] `verifyOrg.test.ts` — bloqueia acesso a recurso de outra org
- [x] `tasks.service.test.ts` — move tarefa, atualiza position, grava TaskHistory
- [x] `tasks.routes.test.ts` — PATCH /tasks/:id/move (coluna isFinal dispara TASK_COMPLETED)
- [x] `comments.routes.test.ts` — authorType correto para USER e CLIENT
- [x] CRUD usuários internos (`/users`)
- [x] CRUD clientes finais (`/clients`) com validação de limite do plano
- [x] CRUD boards (`/boards`)
- [x] CRUD colunas + reorder (`/columns`)
- [x] CRUD tarefas + move + reorder (`/tasks`)
- [x] Histórico automático em cada mutação (`TaskHistory`)
- [x] CRUD comentários com `authorType` discriminado
```

- [ ] **Step 4: Commit final**

```bash
git add docs/TASKS.md
git commit -m "docs: marca Fase 4 como concluída no TASKS.md"
```
