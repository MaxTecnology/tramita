# Departamentos + Responsabilidade por Cliente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a fundação organizacional do roadmap de tarefas recorrentes (Fase 10, item 2a): departamentos configuráveis por organização, responsabilidade de cliente por departamento (substituindo o `ClientAssignment` genérico atual), e roteamento de notificação por departamento nos dois pontos que já existem (comentário de cliente em tarefa, e Solicitação).

**Architecture:** Novo model `Department` (escopado por organização). `ClientAssignment` ganha `departmentId` obrigatório e sua chave única muda de `(clientId, userId)` pra `(clientId, departmentId)`. `Task` e `Request` ganham `departmentId` opcional. A notificação de comentário/solicitação passa a filtrar `ClientAssignment` por `departmentId` quando a entidade que originou o evento tiver um; sem departamento, mantém o comportamento atual (todos os responsáveis do cliente, fallback pra admins/gerentes). Zero mudança de infraestrutura (fila, SSE, auth) — só modelagem de dados e um módulo CRUD novo.

**Tech Stack:** Fastify v5, Prisma v6, Zod, React 19 + TanStack Query, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-09-20-departments-responsibility-design.md`

## Global Constraints

- TypeScript `strict: true` — sem `any`.
- Validação Zod em toda entrada nova.
- Migration é destrutiva na tabela `client_assignments` (dado atual é só de teste, decisão explícita do usuário) — **confirmar com o usuário antes de rodar `migrate:dev`/`migrate:reset` de verdade**, mesmo sendo banco de teste, por ser operação irreversível.
- Sem teste novo pra CRUD de rotas simples nem pra componentes de frontend, seguindo a política do projeto — só lógica de negócio (unicidade por departamento, fallback de notificação, herança de departamento na aprovação de Request).

---

## File Map

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `apps/api/prisma/schema.prisma` | Modificar | Model `Department`, `ClientAssignment.departmentId`, `Task.departmentId`, `Request.departmentId` |
| `apps/api/src/modules/departments/departments.schema.ts` | Criar | Zod schema do CRUD |
| `apps/api/src/modules/departments/departments.service.ts` | Criar | CRUD + bloqueio de delete em uso |
| `apps/api/src/modules/departments/departments.routes.ts` | Criar | Rotas `ORG_ADMIN` |
| `apps/api/src/server.ts` | Modificar | Registrar `departmentsRoutes` |
| `apps/api/src/modules/clients/clients.schema.ts` | Modificar | `setAssignmentsSchema` vira por-departamento |
| `apps/api/src/modules/clients/clients.service.ts` | Modificar | `listAssignments`/`setAssignments` por departamento |
| `apps/api/src/modules/clients/clients.routes.ts` | Modificar | Chamada atualizada pro novo contrato |
| `apps/api/src/modules/comments/comments.service.ts` | Modificar | Roteamento de notificação por departamento |
| `apps/api/src/modules/requests/requests.schema.ts` | Modificar | `createRequestSchema` ganha `departmentId` opcional |
| `apps/api/src/modules/requests/requests.service.ts` | Modificar | Roteamento por departamento + herança na aprovação |
| `apps/api/src/modules/tasks/tasks.schema.ts` | Modificar | `createTaskSchema`/`updateTaskSchema` ganham `departmentId` opcional |
| `apps/web/src/types/index.ts` | Modificar | `Task.departmentId`, `ClientRequest.departmentId`, tipo `Department` |
| `apps/web/src/components/AppLayout.tsx` | Modificar | Item de menu "Departamentos" sob Configurações |
| `apps/web/src/router.tsx` | Modificar | Rota `/app/settings/departments` |
| `apps/web/src/pages/app/settings/Departments.tsx` | Criar | Tela de CRUD |
| `apps/web/src/pages/app/Clients.tsx` | Modificar | `AssignmentsSection` reescrita por departamento |
| `apps/web/src/components/shared/TaskDrawer.tsx` | Modificar | Campo opcional de departamento |
| `apps/web/src/pages/portal/Requests.tsx` | Modificar | Campo opcional de departamento no formulário |
| `apps/api/src/modules/portal/portal.routes.ts` | Modificar | `GET /portal/departments` (leitura, pro select do cliente) |

---

## Task 1: Schema Prisma + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

- [ ] **Step 1: Adicionar o model `Department`**

Logo após o model `Organization` (ou em qualquer ponto do arquivo próximo aos models de organização/usuário — não há um lugar fixo exigido, só manter perto de `ClientAssignment` para legibilidade). Adicionar antes do model `ClientAssignment` (linha ~135):

```prisma
model Department {
  id             String   @id @default(cuid())
  organizationId String
  name           String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organization      Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  clientAssignments ClientAssignment[]
  tasks              Task[]
  requests           Request[]

  @@unique([organizationId, name])
  @@map("departments")
}
```

- [ ] **Step 2: Alterar `ClientAssignment`**

Substituir o model inteiro (linhas 135-146 atualmente):

```prisma
model ClientAssignment {
  id           String   @id @default(cuid())
  clientId     String
  departmentId String
  userId       String
  createdAt    DateTime @default(now())

  client     Client     @relation(fields: [clientId], references: [id], onDelete: Cascade)
  department Department @relation(fields: [departmentId], references: [id], onDelete: Cascade)
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([clientId, departmentId])
  @@map("client_assignments")
}
```

- [ ] **Step 3: Adicionar `departmentId` opcional em `Task`**

No model `Task` (atualmente por volta da linha 230), adicionar o campo depois de `sourceRequestId`:

```prisma
  sourceRequestId String?
  departmentId    String?
```

E adicionar a relação no bloco de relações do mesmo model, junto das outras (`column`, `assignee`, etc.):

```prisma
  department       Department?   @relation(fields: [departmentId], references: [id])
```

- [ ] **Step 4: Adicionar `departmentId` opcional em `Request`**

No model `Request` (por volta da linha 168), adicionar o campo depois de `taskId`:

```prisma
  taskId          String?       @unique
  departmentId    String?
```

E a relação no bloco de relações do mesmo model:

```prisma
  department   Department?         @relation(fields: [departmentId], references: [id])
```

- [ ] **Step 5: Adicionar a relação reversa em `Organization`**

Encontrar o model `Organization` e adicionar `departments Department[]` junto das outras relações reversas dele (ex: perto de `users Organization[]` ou equivalente — seguir o padrão já usado nesse model pra outras entidades filhas).

- [ ] **Step 6: Gerar e aplicar a migration**

```bash
pnpm --filter api migrate:dev -- --name add_departments
```
Expected: Prisma detecta que a mudança em `client_assignments` (troca de chave única, coluna nova obrigatória sem default) exige recriar a tabela — como o dado atual é só de teste (decisão do usuário), aceitar a migration destrutiva proposta pelo Prisma CLI quando perguntado. **Se este comando pedir confirmação interativa de perda de dados, e você é um agente sem conversa com o usuário no momento, PARE e reporte BLOCKED em vez de confirmar sozinho** — a política do projeto exige aviso explícito antes de qualquer operação destrutiva, mesmo em banco de teste.

- [ ] **Step 7: Gerar o client e conferir que compila**

```bash
pnpm --filter api exec prisma generate
pnpm --filter api exec tsc --noEmit
```
Expected: sem erro (os campos novos ainda não são usados em lugar nenhum do código nesta etapa, então não deve haver erro de tipo).

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(db): adicionar Department e departmentId em ClientAssignment/Task/Request"
```

---

## Task 2: Módulo `departments` (backend)

**Files:**
- Create: `apps/api/src/modules/departments/departments.schema.ts`
- Create: `apps/api/src/modules/departments/departments.service.ts`
- Create: `apps/api/src/modules/departments/departments.routes.ts`
- Modify: `apps/api/src/server.ts`

**Depende do Task 1.**

- [ ] **Step 1: Criar `apps/api/src/modules/departments/departments.schema.ts`**

```typescript
import { z } from 'zod'

export const createDepartmentSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
})

export const updateDepartmentSchema = createDepartmentSchema.partial()

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>
```

- [ ] **Step 2: Criar `apps/api/src/modules/departments/departments.service.ts`**

```typescript
import { prisma } from '@/lib/prisma'
import { AppError } from '@/errors/AppError'
import type { CreateDepartmentInput, UpdateDepartmentInput } from './departments.schema'

export async function listDepartments(organizationId: string) {
  return prisma.department.findMany({
    where: { organizationId },
    orderBy: { name: 'asc' },
  })
}

export async function createDepartment(organizationId: string, data: CreateDepartmentInput) {
  const existing = await prisma.department.findFirst({
    where: { organizationId, name: data.name },
  })
  if (existing) throw new AppError(409, 'Já existe um departamento com esse nome')

  return prisma.department.create({ data: { ...data, organizationId } })
}

export async function updateDepartment(
  id: string,
  organizationId: string,
  data: UpdateDepartmentInput,
) {
  const department = await prisma.department.findFirst({ where: { id, organizationId } })
  if (!department) throw new AppError(404, 'Departamento não encontrado')

  if (data.name) {
    const existing = await prisma.department.findFirst({
      where: { organizationId, name: data.name, id: { not: id } },
    })
    if (existing) throw new AppError(409, 'Já existe um departamento com esse nome')
  }

  return prisma.department.update({ where: { id }, data })
}

export async function deleteDepartment(id: string, organizationId: string) {
  const department = await prisma.department.findFirst({ where: { id, organizationId } })
  if (!department) throw new AppError(404, 'Departamento não encontrado')

  const assignmentsCount = await prisma.clientAssignment.count({ where: { departmentId: id } })
  if (assignmentsCount > 0) {
    throw new AppError(409, 'Departamento em uso — remova as atribuições de responsável antes de excluir')
  }

  await prisma.department.delete({ where: { id } })
  return { ok: true }
}
```

- [ ] **Step 3: Criar `apps/api/src/modules/departments/departments.routes.ts`**

```typescript
import type { FastifyInstance } from 'fastify'
import { verifyJWT } from '@/middlewares/verifyJWT'
import { requireRole } from '@/middlewares/requireRole'
import { checkSubscription } from '@/middlewares/checkSubscription'
import { AppError } from '@/errors/AppError'
import { createDepartmentSchema, updateDepartmentSchema } from './departments.schema'
import {
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from './departments.service'

export async function departmentsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', verifyJWT)

  // Leitura liberada pra qualquer role da org (colaboradores precisam ver a lista
  // pra marcar departamento em tarefa) — só mutação é restrita a ORG_ADMIN
  app.get('/', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    return reply.send(await listDepartments(request.user.organizationId!))
  })

  app.addHook('preHandler', requireRole('ORG_ADMIN'))

  app.post('/', { preHandler: [checkSubscription] }, async (request, reply) => {
    const result = createDepartmentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.status(201).send(await createDepartment(request.user.organizationId!, result.data))
  })

  app.patch('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = updateDepartmentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await updateDepartment(id, request.user.organizationId!, result.data))
  })

  app.delete('/:id', { preHandler: [checkSubscription] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    return reply.send(await deleteDepartment(id, request.user.organizationId!))
  })
}
```

Nota: dois `preHandler` hooks de `requireRole` em sequência (primeiro liberando leitura pra 3 roles, depois restringindo tudo que vem depois a só `ORG_ADMIN`) é o mesmo padrão já usado em `apps/api/src/modules/users/users.routes.ts` (`/me` liberado, resto restrito).

- [ ] **Step 4: Registrar o módulo em `apps/api/src/server.ts`**

Adicionar o import junto dos outros (perto de `import { dashboardRoutes } from '@/modules/dashboard/dashboard.routes'`):
```typescript
import { departmentsRoutes } from '@/modules/departments/departments.routes'
```
E o registro junto dos outros `app.register(...)`:
```typescript
  app.register(departmentsRoutes, { prefix: '/departments' })
```

- [ ] **Step 5: Rodar a suíte da API**

```bash
pnpm --filter api test
```
Expected: continua tudo passando (módulo novo ainda sem teste próprio — vem no Task 6).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/departments/ apps/api/src/server.ts
git commit -m "feat(api): módulo departments (CRUD, ORG_ADMIN)"
```

---

## Task 3: `clients.service.ts`/`clients.routes.ts`/`clients.schema.ts` — assignments por departamento

**Files:**
- Modify: `apps/api/src/modules/clients/clients.schema.ts`
- Modify: `apps/api/src/modules/clients/clients.service.ts`
- Modify: `apps/api/src/modules/clients/clients.routes.ts`

**Depende do Task 1.**

- [ ] **Step 1: `clients.schema.ts` — trocar `setAssignmentsSchema`**

Trocar:
```typescript
export const setAssignmentsSchema = z.object({
  userIds: z.array(z.string()).default([]),
})
```
por:
```typescript
export const setAssignmentSchema = z.object({
  departmentId: z.string().cuid(),
  userId: z.string().cuid().nullable(),
})
```
E o type exportado correspondente:
```typescript
export type SetAssignmentBody = z.infer<typeof setAssignmentSchema>
```
(troca `SetAssignmentsBody`/`setAssignmentsSchema` plural por singular — reflete que agora é "definir um departamento por vez", não a lista toda)

- [ ] **Step 2: `clients.service.ts` — reescrever `listAssignments` e `setAssignments`**

Trocar as duas funções (`listAssignments` e `setAssignments`, e a chamada recursiva que `setAssignments` faz a `listAssignments` no final) por:

```typescript
export async function listAssignments(clientId: string, organizationId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  return prisma.clientAssignment.findMany({
    where: { clientId },
    select: {
      id: true,
      departmentId: true,
      userId: true,
      department: { select: { id: true, name: true } },
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  })
}

export async function setAssignment(
  clientId: string,
  organizationId: string,
  departmentId: string,
  userId: string | null,
) {
  const client = await prisma.client.findFirst({ where: { id: clientId, organizationId } })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  const department = await prisma.department.findFirst({ where: { id: departmentId, organizationId } })
  if (!department) throw new AppError(404, 'Departamento não encontrado')

  if (userId === null) {
    await prisma.clientAssignment.deleteMany({ where: { clientId, departmentId } })
    return listAssignments(clientId, organizationId)
  }

  const validUser = await prisma.user.findFirst({
    where: { id: userId, organizationId, isActive: true },
    select: { id: true },
  })
  if (!validUser) throw new AppError(400, 'Usuário inválido')

  await prisma.clientAssignment.upsert({
    where: { clientId_departmentId: { clientId, departmentId } },
    update: { userId },
    create: { clientId, departmentId, userId },
  })

  return listAssignments(clientId, organizationId)
}
```

(o nome do campo composto no `where` do `upsert`, `clientId_departmentId`, é gerado automaticamente pelo Prisma a partir de `@@unique([clientId, departmentId])` — segue a mesma convenção de nomeação que o Prisma já usa nos outros `@@unique` compostos deste schema)

- [ ] **Step 3: `clients.routes.ts` — atualizar a rota `PUT /:id/assignments`**

Trocar o import (linha 7-8) de `setAssignmentsSchema`/`setAssignments` por `setAssignmentSchema`/`setAssignment`, e o handler:
```typescript
  app.put('/:id/assignments', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER'), checkSubscription],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = setAssignmentSchema.safeParse(request.body)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(
      await setAssignment(id, request.user.organizationId!, result.data.departmentId, result.data.userId),
    )
  })
```

- [ ] **Step 4: Rodar a suíte da API**

```bash
pnpm --filter api test
```
Expected: qualquer teste existente que usava o contrato antigo de `setAssignments`/`userIds` vai falhar — se houver, ajustar esse teste pro novo contrato (`departmentId`/`userId`) como parte deste mesmo step, não deixar quebrado.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/clients/
git commit -m "feat(api): responsabilidade por cliente vira por-departamento"
```

---

## Task 4: Roteamento de notificação por departamento (comentário + solicitação)

**Files:**
- Modify: `apps/api/src/modules/comments/comments.service.ts`
- Modify: `apps/api/src/modules/requests/requests.service.ts`
- Modify: `apps/api/src/modules/requests/requests.schema.ts`

**Depende do Task 1.**

- [ ] **Step 1: `comments.service.ts` — incluir `departmentId` na busca da task e filtrar a query de assignments**

No `createComment`, o `include` da busca da task (linha ~65) já traz `column: { include: { board: ... } }` — adicionar `departmentId: true` ao `select`/incluir o campo direto da task (já vem por padrão, já que não há `select` explícito na query da task, ela traz todos os campos escalares incluindo o novo `departmentId`).

Trocar o bloco (linhas 92-97):
```typescript
    const assignments = await prisma.clientAssignment.findMany({
      where: { clientId: actor.id },
      select: { userId: true },
    })
```
por:
```typescript
    const assignments = await prisma.clientAssignment.findMany({
      where: task.departmentId
        ? { clientId: actor.id, departmentId: task.departmentId }
        : { clientId: actor.id },
      select: { userId: true },
    })
```

- [ ] **Step 2: `requests.schema.ts` — adicionar `departmentId` opcional**

Trocar:
```typescript
export const createRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
})
```
por:
```typescript
export const createRequestSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  departmentId: z.string().cuid().optional(),
})
```

- [ ] **Step 3: `requests.service.ts` — `createRequest` grava e usa `departmentId`**

Trocar a criação da request (linha ~20-22):
```typescript
  const request = await prisma.request.create({
    data: { organizationId, clientId, title: data.title, description: data.description },
  })
```
por:
```typescript
  const request = await prisma.request.create({
    data: {
      organizationId,
      clientId,
      title: data.title,
      description: data.description,
      departmentId: data.departmentId,
    },
  })
```
E o bloco de busca de assignments (linhas 25-28):
```typescript
  const assignments = await prisma.clientAssignment.findMany({
    where: { clientId },
    select: { userId: true },
  })
```
por:
```typescript
  const assignments = await prisma.clientAssignment.findMany({
    where: request.departmentId
      ? { clientId, departmentId: request.departmentId }
      : { clientId },
    select: { userId: true },
  })
```

- [ ] **Step 4: `requests.service.ts` — `approveRequest` propaga `departmentId` pra Task criada**

No `approveRequest`, a chamada a `createTask` (linhas 125-130) hoje passa `{ title, description, priority: 'MEDIUM', tags: [] }`. Adicionar `departmentId`:
```typescript
  const task = await createTask(
    columnId,
    organizationId,
    {
      title: request.title,
      description: request.description ?? undefined,
      priority: 'MEDIUM',
      tags: [],
      departmentId: request.departmentId ?? undefined,
    },
    { id: reviewerId, type: 'user' },
  )
```
(isso exige que `CreateTaskBody`/`createTask` aceitem `departmentId` — ver Task 5)

- [ ] **Step 5: Rodar a suíte da API**

```bash
pnpm --filter api test
```
Expected: ainda vai falhar type-check até o Task 5 (porque `createTask`/`CreateTaskBody` ainda não têm `departmentId`) — **rode `pnpm --filter api exec tsc --noEmit` pra confirmar esse erro específico esperado, mas NÃO faça commit deste task até o Task 5 estar pronto** (os dois tasks juntos formam uma unidade compilável).

- [ ] **Step 6: Commit (só depois do Task 5 também estar pronto — ver nota no Step 5)**

```bash
git add apps/api/src/modules/comments/comments.service.ts apps/api/src/modules/requests/
git commit -m "feat(api): roteamento de notificação por departamento (comentário + solicitação)"
```

---

## Task 5: `tasks.schema.ts` — aceitar `departmentId` opcional

**Files:**
- Modify: `apps/api/src/modules/tasks/tasks.schema.ts`

**Depende do Task 1. Deve ser feito na mesma leva que o Task 4 (Task 4 depende deste pra compilar) — mas como unidade de trabalho separada, cada um com seu próprio diff, o commit final pode ser um só cobrindo os dois se for mais prático pro implementador.**

- [ ] **Step 1: Adicionar `departmentId` opcional em `createTaskSchema` e `updateTaskSchema`**

Em `apps/api/src/modules/tasks/tasks.schema.ts`, no `createTaskSchema`:
```typescript
export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  assigneeId: z.string().cuid().optional(),
  dueDate: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
  departmentId: z.string().cuid().optional(),
})
```
E no `updateTaskSchema`:
```typescript
export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  assigneeId: z.string().cuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
  tags: z.array(z.string()).optional(),
  departmentId: z.string().cuid().nullable().optional(),
})
```

- [ ] **Step 2: Conferir `tasks.service.ts` — `createTask` já grava `departmentId` sem mudança de código**

`createTask` (em `apps/api/src/modules/tasks/tasks.service.ts`) faz `tx.task.create({ data: { title: data.title, description: data.description, priority: data.priority, assigneeId: data.assigneeId, dueDate: ..., tags: data.tags, position, columnId, creatorId: actor.id } })` — adicionar `departmentId: data.departmentId` nesse objeto de `data`.

- [ ] **Step 3: Conferir `tasks.service.ts` — `updateTask` já grava `departmentId` sem mudança de código**

`updateTask` faz `tx.task.update({ data: { title: data.title, description: data.description, priority: data.priority, assigneeId: data.assigneeId, dueDate: ..., tags: data.tags } })` — adicionar `departmentId: data.departmentId` nesse objeto de `data`. Não precisa de lógica de histórico (`TaskHistory`) pra essa mudança — o padrão existente só grava histórico pra `priority`/`assigneeId` (ver os `historyEntries.push` já existentes), não é necessário estender isso agora.

- [ ] **Step 4: Rodar a suíte completa da API e o type-check**

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter api test
```
Expected: zero erro de tipo (isso fecha a dependência que o Task 4 tinha neste task), suíte passando.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/tasks/
git commit -m "feat(api): createTask/updateTask aceitam departmentId opcional"
```

Se este task foi feito por um implementador diferente do Task 4 e ambos já estão prontos, tanto faz a ordem dos dois commits — só not deixar UM commitado sem o outro se isso quebrar o type-check em algum ponto intermediário do histórico.

---

## Task 6: Testes de lógica de negócio (departments, assignments, roteamento por departamento)

**Files:**
- Create: `apps/api/src/modules/departments/departments.service.test.ts`
- Modify or create: `apps/api/src/modules/clients/clients.service.test.ts` (adicionar aos testes de assignment se o arquivo já existir; senão criar)
- Modify: `apps/api/src/modules/comments/comments.service.test.ts` (se existir) ou criar
- Modify: `apps/api/src/modules/requests/requests.service.test.ts` (se existir) ou criar

**Depende dos Tasks 1-5 estarem completos e commitados.**

- [ ] **Step 1: Verificar quais desses arquivos de teste já existem**

```bash
ls apps/api/src/modules/clients/clients.service.test.ts apps/api/src/modules/comments/comments.service.test.ts apps/api/src/modules/requests/requests.service.test.ts 2>&1
```
Pra cada um que existir, os testes novos deste task são **adicionados** a ele (novos blocos `describe`), não substituem o arquivo. Pra cada um que não existir, criar do zero seguindo o padrão dos outros `*.service.test.ts` deste projeto (`describe`/`it`, helpers de `@/test/helpers`, ver `apps/api/src/modules/columns/columns.service.test.ts` como referência de estilo pra um module CRUD simples com isolamento por organização).

- [ ] **Step 2: `departments.service.test.ts` — criar**

Cobrir: `createDepartment` cria e rejeita nome duplicado na mesma organização (409) mas permite o mesmo nome em organizações diferentes; `updateDepartment` renomeia e rejeita 404 pra departamento de outra organização; `deleteDepartment` remove departamento sem uso, e é bloqueado (409) se houver `ClientAssignment` vinculado.

Usar os helpers existentes (`createTestPlan`, `createTestOrg`) de `@/test/helpers` — não há um `createTestDepartment` helper ainda, criar os departamentos diretamente via `prisma.department.create(...)` dentro dos testes (não vale a pena adicionar um helper novo pra uma entidade tão simples usada só neste arquivo).

- [ ] **Step 3: Testes de `setAssignment`/`listAssignments` (em `clients.service.test.ts`)**

Cobrir: atribuir um responsável a um cliente+departamento e depois atribuir outro usuário ao mesmo cliente+departamento substitui o anterior (não soma, `listAssignments` retorna só 1 linha pra aquele departamento); o mesmo usuário pode ser responsável em dois departamentos diferentes do mesmo cliente (`listAssignments` retorna 2 linhas); `setAssignment` com `userId: null` remove a atribuição (`listAssignments` não retorna mais aquela linha); `setAssignment` com `userId` de um usuário de outra organização rejeita com 400.

- [ ] **Step 4: Teste de roteamento por departamento em `comments.service.ts`**

Cobrir dois casos: (a) uma tarefa **com** `departmentId` — cliente comenta, só o responsável daquele departamento específico recebe a notificação (verificar via `enqueueNotification` ou o efeito equivalente já usado nos testes existentes desse arquivo, se houver — senão verificar o `NotificationLog`/chamada de fila do jeito que os outros testes deste projeto já verificam efeitos de notificação); (b) a mesma tarefa **sem** `departmentId` — o comportamento cai no fallback de hoje (todos os responsáveis do cliente, independente de departamento).

- [ ] **Step 5: Teste de herança de departamento em `approveRequest`**

Cobrir: criar uma `Request` com `departmentId` definido, aprovar em modo `NEW_BOARD`, verificar que a `Task` criada tem o mesmo `departmentId`. Repetir pro modo `EXISTING_BOARD`.

- [ ] **Step 6: Rodar a suíte completa**

```bash
pnpm --filter api test
```
Expected: tudo passando, incluindo os testes novos.

- [ ] **Step 7: Rodar cobertura pra conferir que não regrediu abaixo de 80%**

```bash
pnpm --filter api test:coverage
```
Expected: exit 0 (o CI já reativou o enforcement desse threshold — ver `docs/tech-debt.md`).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/departments/departments.service.test.ts apps/api/src/modules/clients/ apps/api/src/modules/comments/ apps/api/src/modules/requests/
git commit -m "test: cobertura de departamentos, assignment por departamento e roteamento de notificação"
```

---

## Task 7: Frontend — tipos, menu, rota, página de Departamentos

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/router.tsx`
- Create: `apps/web/src/pages/app/settings/Departments.tsx`

**Depende do Task 2.**

- [ ] **Step 1: `types/index.ts` — adicionar o tipo `Department` e o campo `departmentId`**

Adicionar, junto dos outros tipos exportados:
```typescript
export interface Department {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}
```
E no `interface Task` existente, adicionar depois de `sourceRequestId`:
```typescript
  sourceRequestId: string | null
  departmentId: string | null
```
E no `interface ClientRequest` existente, adicionar depois de `taskId`:
```typescript
  taskId: string | null
  departmentId: string | null
```

- [ ] **Step 2: Criar `apps/web/src/pages/app/settings/Departments.tsx`**

Tela nova — usa os componentes `ui/` já restilizados pelo redesign visual (`Button`, `Card`, `Input`, `Label`, `Dialog`) e as classes de token (`bg-surface`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-accent`) em vez de cor hardcoded, já que não herda débito visual de tela antiga.

```typescript
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Pencil, Trash2, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Department } from '@/types'

export default function Departments() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [name, setName] = useState('')

  const { data: departments = [], isLoading } = useQuery<Department[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? api.patch(`/departments/${editing.id}`, { name }).then((r) => r.data)
        : api.post('/departments', { name }).then((r) => r.data),
    onSuccess: () => {
      toast.success(editing ? 'Departamento atualizado' : 'Departamento criado')
      qc.invalidateQueries({ queryKey: ['departments'] })
      closeDialog()
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao salvar departamento')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/departments/${id}`),
    onSuccess: () => {
      toast.success('Departamento removido')
      qc.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(message ?? 'Erro ao remover departamento')
    },
  })

  function openCreate() {
    setEditing(null)
    setName('')
    setOpen(true)
  }

  function openEdit(department: Department) {
    setEditing(department)
    setName(department.name)
    setOpen(true)
  }

  function closeDialog() {
    setOpen(false)
    setEditing(null)
    setName('')
  }

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Carregando...</div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-bold text-foreground">Departamentos</h1>
        <Button onClick={openCreate} className="gap-2">
          <Plus size={16} />
          Novo departamento
        </Button>
      </div>

      {departments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <Building2 size={48} className="mb-3 opacity-40" />
          <p className="text-sm font-medium">Nenhum departamento cadastrado</p>
          <p className="text-xs mt-1">Use o botão acima pra criar o primeiro (ex: Fiscal, Pessoal, Contábil).</p>
        </div>
      ) : (
        <div className="space-y-2">
          {departments.map((d) => (
            <Card key={d.id} className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{d.name}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => openEdit(d)}
                  className="p-1.5 rounded-md text-muted-foreground hover:bg-neutral-bg hover:text-foreground"
                  aria-label="Editar"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => { if (window.confirm(`Excluir o departamento "${d.name}"?`)) deleteMutation.mutate(d.id) }}
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
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar departamento' : 'Novo departamento'}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); if (name.trim()) saveMutation.mutate() }}
            className="space-y-4 mt-2"
          >
            <div className="space-y-1.5">
              <Label htmlFor="dept-name">Nome</Label>
              <Input
                id="dept-name"
                placeholder="Ex: Fiscal"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeDialog}>Cancelar</Button>
              <Button type="submit" disabled={saveMutation.isPending || !name.trim()}>
                {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

Requer que `Department` esteja exportado de `@/types` (feito no Step 1 acima).

- [ ] **Step 3: `AppLayout.tsx` — adicionar item de menu**

No bloco de itens sob "Configurações" (depois de `SidebarLink to="/app/settings/subscription"`), adicionar:
```typescript
          {ADMIN_ROLES.includes(role) && (
            <SidebarLink to="/app/settings/departments" icon={<Building2 size={16} />} label="Departamentos" onClick={handleNavClick} />
          )}
```
E adicionar `Building2` ao import de `lucide-react` no topo do arquivo (junto dos outros ícones já importados de lá).

- [ ] **Step 4: `router.tsx` — registrar a rota**

Adicionar o import (junto dos outros `import ... from '@/pages/app/settings/...'`):
```typescript
import Departments from '@/pages/app/settings/Departments'
```
E a entrada de rota (no array `children` de `/app`, junto de `settings/subscription`):
```typescript
      {
        path: 'settings/departments',
        element: (
          <ProtectedRoute allowedRoles={ADMIN_ROLES}>
            <Departments />
          </ProtectedRoute>
        ),
      },
```

- [ ] **Step 5: Rodar o dev server e conferir visualmente**

```bash
pnpm --filter web dev
```
Login como ORG_ADMIN, conferir que "Departamentos" aparece no menu sob Configurações, a tela carrega, criar/editar/apagar um departamento de teste funciona.

- [ ] **Step 6: Rodar a suíte de testes do web e type-check**

```bash
pnpm --filter web test
pnpm --filter web exec tsc --noEmit
```
Expected: tudo passando.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/components/AppLayout.tsx apps/web/src/router.tsx apps/web/src/pages/app/settings/Departments.tsx
git commit -m "feat(web): tela de Departamentos + item de menu"
```

---

## Task 8: Frontend — `Clients.tsx` AssignmentsSection por departamento

**Files:**
- Modify: `apps/web/src/pages/app/Clients.tsx`

**Depende dos Tasks 3 e 7.**

- [ ] **Step 1: Reescrever `AssignmentsSection`**

Substituir a função inteira (atualmente linhas ~20-108 do arquivo, de `function AssignmentsSection` até o fechamento antes de `type ClientType = 'PF' | 'PJ'`):

```typescript
function AssignmentsSection({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient()

  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
  })

  const { data: users = [] } = useQuery<OrgUser[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  })

  const { data: assignments = [] } = useQuery<Assignment[]>({
    queryKey: ['client-assignments', clientId],
    queryFn: () => api.get(`/clients/${clientId}/assignments`).then((r) => r.data),
  })

  const saveMutation = useMutation({
    mutationFn: ({ departmentId, userId }: { departmentId: string; userId: string | null }) =>
      api.put(`/clients/${clientId}/assignments`, { departmentId, userId }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Responsáveis atualizados')
      queryClient.invalidateQueries({ queryKey: ['client-assignments', clientId] })
    },
    onError: () => toast.error('Erro ao salvar responsáveis'),
  })

  const eligibleUsers = users.filter((u) => ['ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER'].includes(u.role))

  function responsibleFor(departmentId: string) {
    return assignments.find((a) => a.departmentId === departmentId)?.userId ?? ''
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <UserCheck size={14} className="text-gray-400" />
        <Label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Responsáveis por departamento</Label>
      </div>
      <p className="text-xs text-gray-400">
        Quando definido, só o responsável do departamento recebe notificações daquela área.
        Sem responsável, notifica todos os admins e gerentes.
      </p>
      {departments.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-3">Nenhum departamento cadastrado.</p>
      ) : (
        <div className="space-y-2">
          {departments.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">{d.name}</span>
              <select
                value={responsibleFor(d.id)}
                onChange={(e) => saveMutation.mutate({ departmentId: d.id, userId: e.target.value || null })}
                disabled={saveMutation.isPending}
                className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Sem responsável</option>
                {eligibleUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({ROLE_LABEL[u.role] ?? u.role})</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

E atualizar a interface `Assignment` (linha 14) pra refletir o novo shape retornado por `GET /clients/:id/assignments`:
```typescript
interface Assignment { id: string; departmentId: string; userId: string; department: { id: string; name: string }; user: OrgUser }
```

Nota: mantém as classes de cor hardcoded (`text-gray-*`, `border-gray-300` etc.) que já existiam no arquivo — `Clients.tsx` não faz parte do escopo do redesign visual (é uma fase futura, ver roadmap), não vale migrar cor aqui como efeito colateral desta task.

- [ ] **Step 2: Rodar o dev server e conferir visualmente**

```bash
pnpm --filter web dev
```
Abrir edição de um cliente, conferir que a seção "Responsáveis por departamento" lista os departamentos cadastrados (criar 2-3 de teste via a tela do Task 7 antes, se ainda não houver nenhum) com um select por linha, trocar o responsável de um departamento e confirmar que persiste ao recarregar.

- [ ] **Step 3: Rodar a suíte de testes do web e type-check**

```bash
pnpm --filter web test
pnpm --filter web exec tsc --noEmit
```
Expected: tudo passando.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/app/Clients.tsx
git commit -m "feat(web): responsáveis por cliente vira por-departamento"
```

---

## Task 9: Frontend — departamento em Tarefa (TaskDrawer) e Solicitação (portal)

**Files:**
- Modify: `apps/web/src/components/shared/TaskDrawer.tsx`
- Modify: `apps/web/src/pages/portal/Requests.tsx`
- Modify: `apps/api/src/modules/portal/portal.routes.ts`

**Depende dos Tasks 2, 4, 5, 7.**

- [ ] **Step 1: `portal.routes.ts` — adicionar leitura de departamentos pro cliente**

Adicionar o import:
```typescript
import { listDepartments } from '@/modules/departments/departments.service'
```
E uma rota nova (junto das outras `GET` deste arquivo, por exemplo depois de `GET /tasks/:taskId/history`):
```typescript
  app.get('/departments', async (request, reply) => {
    return reply.send(await listDepartments(request.user.organizationId!))
  })
```

- [ ] **Step 2: `TaskDrawer.tsx` — campo de departamento**

No tipo do `updateMutation` (linha ~70), trocar:
```typescript
    mutationFn: (data: Partial<Pick<Task, 'title' | 'priority' | 'description' | 'dueDate'>>) =>
```
por:
```typescript
    mutationFn: (data: Partial<Pick<Task, 'title' | 'priority' | 'description' | 'dueDate' | 'departmentId'>>) =>
```

Adicionar a busca de departamentos (junto dos outros hooks no topo do componente, depois de `const canEdit = isOrgRole(role)`):
```typescript
  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['departments'],
    queryFn: () => api.get('/departments').then((r) => r.data),
    enabled: canEdit,
  })
```
(precisa adicionar `Department` ou o shape inline — usar o shape inline `{ id: string; name: string }[]` como acima é suficiente, não precisa importar o tipo `Department` de `@/types` aqui já que só usa `id`/`name`)

No bloco "Badges de metadados" (onde já está o `<select>` de prioridade), adicionar um segundo `<select>` logo depois do de prioridade, só quando `canEdit`:
```typescript
            {canEdit && (
              <select
                value={task.departmentId ?? ''}
                onChange={(e) => updateMutation.mutate({ departmentId: e.target.value || null })}
                className="text-xs font-medium px-2 py-0.5 rounded-full border border-gray-200 text-gray-600 cursor-pointer bg-white"
              >
                <option value="">Sem departamento</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
```
Quando `!canEdit` (visão do cliente no portal), não mostrar nada de departamento — é informação interna do escritório, sem necessidade de aparecer pro cliente.

- [ ] **Step 3: `Requests.tsx` (portal) — campo de departamento no formulário de nova solicitação**

Adicionar a busca de departamentos (junto dos outros hooks no topo do componente):
```typescript
  const { data: departments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['portal-departments'],
    queryFn: () => api.get('/portal/departments').then((r) => r.data),
  })
```
Atualizar o estado do formulário (linha 30):
```typescript
  const [form, setForm] = useState({ title: '', description: '', departmentId: '' })
```
E o reset após sucesso (dentro do `onSuccess` do `createMutation`):
```typescript
      setForm({ title: '', description: '', departmentId: '' })
```
E o `mutationFn` do `createMutation` precisa mandar `departmentId` só se preenchido:
```typescript
    mutationFn: () => api.post('/portal/requests', {
      title: form.title,
      description: form.description,
      departmentId: form.departmentId || undefined,
    }).then((r) => r.data),
```
No formulário JSX, adicionar um campo depois do campo "Descrição" (antes do bloco `{createMutation.isError && ...}`):
```typescript
            <div className="space-y-1.5">
              <Label htmlFor="req-department">Departamento (opcional)</Label>
              <select
                id="req-department"
                value={form.departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <option value="">Não sei / Geral</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
```

- [ ] **Step 4: Rodar o dev server e conferir visualmente os dois fluxos**

```bash
pnpm --filter web dev
```
Como ORG_ADMIN: abrir uma tarefa existente, conferir o novo select de departamento ao lado do de prioridade, trocar e confirmar que persiste. Como CLIENT (portal): abrir "Nova solicitação", conferir o campo "Departamento (opcional)", criar uma solicitação com e sem departamento escolhido.

- [ ] **Step 5: Rodar as duas suítes de teste e type-check**

```bash
pnpm test
pnpm --filter web exec tsc --noEmit
```
Expected: tudo passando.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/shared/TaskDrawer.tsx apps/web/src/pages/portal/Requests.tsx apps/api/src/modules/portal/portal.routes.ts
git commit -m "feat: campo de departamento em tarefa e em nova solicitação do portal"
```

---

## Task 10: Verificação final

**Files:** nenhum arquivo novo — só verificação.

- [ ] **Step 1: Suíte completa (API + web)**

```bash
pnpm test
```
Expected: tudo passando.

- [ ] **Step 2: Cobertura da API**

```bash
pnpm --filter api test:coverage
```
Expected: exit 0 (threshold de 80% mantido).

- [ ] **Step 3: Type-check dos dois workspaces**

```bash
pnpm --filter api exec tsc --noEmit
pnpm --filter web exec tsc --noEmit
```
Expected: zero erro.

- [ ] **Step 4: Percorrer visualmente o fluxo completo**

```bash
pnpm --filter web dev
```
Fluxo ponta a ponta: criar 2 departamentos → atribuir responsáveis diferentes pra um cliente em cada departamento → criar uma tarefa com departamento numa board desse cliente → cliente comenta na tarefa (via portal) → conferir no log de notificações (`/app/settings/notifications`) que só o responsável daquele departamento foi notificado, não todos os responsáveis do cliente.

- [ ] **Step 5: Atualizar `docs/TASKS.md`**

Marcar o item 1 da lista "Roadmap de sub-projetos ativos" (Fase 10) como `[x]` — mesmo formato usado pro item 1 (redesign visual), com uma frase curta do que foi entregue e link pra esta spec/plano.
