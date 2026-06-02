# Spec — Fase 4: Core Kanban

**Data:** 2026-06-02  
**Escopo:** CRUD completo de users, clients, boards, columns, tasks (move + reorder), TaskHistory automático, comentários com authorType discriminado, e 5 arquivos de teste.

---

## Contexto

Schema Prisma já migrado (`20260602010001_init`). Todos os modelos existem: `User`, `Client`, `Board`, `Column`, `Task`, `Comment`, `TaskHistory`. Nenhuma migration nova é necessária nesta fase.

---

## Módulos a criar

```
src/modules/users/
  users.routes.ts
  users.service.ts
  users.schema.ts

src/modules/clients/
  clients.routes.ts
  clients.service.ts
  clients.schema.ts

src/modules/boards/
  boards.routes.ts
  boards.service.ts
  boards.schema.ts

src/modules/columns/
  columns.routes.ts
  columns.service.ts
  columns.schema.ts

src/modules/tasks/
  tasks.routes.ts
  tasks.service.ts
  tasks.schema.ts

src/modules/comments/
  comments.routes.ts
  comments.service.ts
  comments.schema.ts
```

---

## Stub de fila (`src/lib/queue.ts`)

No-op que será substituído na Fase 5:

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

---

## Módulo: Users

### Endpoints

| Método | Path | Role |
|--------|------|------|
| GET | `/users` | ORG_ADMIN |
| POST | `/users` | ORG_ADMIN |
| PATCH | `/users/:id` | ORG_ADMIN |
| DELETE | `/users/:id` | ORG_ADMIN (soft delete: `isActive: false`) |

### Service — regras

- `POST /users`: hash de senha com bcrypt (cost 10); role só pode ser `ORG_MANAGER` ou `ORG_MEMBER`; email único global.
- `DELETE /users/:id`: soft delete — `isActive: false`. Verifica que `user.organizationId === req.user.organizationId`.
- Todos os métodos filtram por `organizationId` do token.

### Schema Zod

```typescript
createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['ORG_MANAGER', 'ORG_MEMBER']),
  phone: z.string().optional(),
})

updateUserSchema = createUserSchema.partial().omit({ password: true })
```

---

## Módulo: Clients

### Endpoints

| Método | Path | Role |
|--------|------|------|
| GET | `/clients` | ORG_ADMIN, ORG_MANAGER |
| POST | `/clients` | ORG_ADMIN, ORG_MANAGER + `checkPlanLimit` |
| PATCH | `/clients/:id` | ORG_ADMIN, ORG_MANAGER |
| DELETE | `/clients/:id` | ORG_ADMIN, ORG_MANAGER (soft delete) |

### Service — regras

- `POST /clients`: hash de senha; email único dentro da organização (`@@unique([email, organizationId])`).
- `DELETE /clients/:id`: soft delete — `isActive: false`. Ao desativar, não conta mais no limite do plano.
- Todos os métodos filtram por `organizationId` do token.

### Schema Zod

```typescript
createClientSchema = z.object({
  name: z.string().min(2),
  cnpj: z.string().optional(),
  email: z.string().email(),
  password: z.string().min(8),
  whatsapp: z.string().optional(),
})

updateClientSchema = createClientSchema.partial().omit({ password: true })
```

---

## Módulo: Boards

### Endpoints

| Método | Path | Role |
|--------|------|------|
| GET | `/boards` | ORG_ADMIN, ORG_MANAGER, ORG_MEMBER; CLIENT (só os próprios) |
| GET | `/boards/:id` | mesmas roles acima |
| POST | `/boards` | ORG_ADMIN, ORG_MANAGER |
| PATCH | `/boards/:id` | ORG_ADMIN, ORG_MANAGER |

### Service — regras

- `GET /boards`: filtra por `organizationId`; se role `CLIENT`, filtra também por `clientId`.
- `GET /boards/:id`: retorna board com colunas ordenadas por `position` e tarefas por coluna ordenadas por `position`.
- Isolamento: `findFirst({ where: { id, organizationId } })` — null → 404.
- `clientId` no POST deve pertencer à mesma organização.

### Schema Zod

```typescript
createBoardSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  clientId: z.string().cuid(),
})

updateBoardSchema = createBoardSchema.partial()
```

---

## Módulo: Columns

### Endpoints

| Método | Path | Role |
|--------|------|------|
| POST | `/boards/:boardId/columns` | ORG_ADMIN, ORG_MANAGER |
| PATCH | `/columns/:id` | ORG_ADMIN, ORG_MANAGER |
| PATCH | `/columns/reorder` | ORG_ADMIN, ORG_MANAGER |
| DELETE | `/columns/:id` | ORG_ADMIN |

### Service — regras

- `POST`: verifica que o board pertence à organização antes de criar.
- `PATCH /columns/reorder`: bulk update via `$transaction([...items.map(i => prisma.column.update({ where: { id: i.id }, data: { position: i.position } }))])`. Verifica que todos os column IDs pertencem à organização.
- `DELETE`: cascata automática via `onDelete: Cascade` nas tasks.

### Schema Zod

```typescript
createColumnSchema = z.object({
  title: z.string().min(1),
  color: z.string().optional(),
  position: z.number().int().min(0),
  isFinal: z.boolean().default(false),
})

reorderColumnsSchema = z.array(z.object({ id: z.string().cuid(), position: z.number().int().min(0) }))
```

---

## Módulo: Tasks

### Endpoints

| Método | Path | Role |
|--------|------|------|
| POST | `/columns/:columnId/tasks` | ORG_ADMIN, ORG_MANAGER, ORG_MEMBER |
| PATCH | `/tasks/:id` | ORG_ADMIN, ORG_MANAGER, ORG_MEMBER |
| PATCH | `/tasks/:id/move` | ORG_ADMIN, ORG_MANAGER, ORG_MEMBER |
| PATCH | `/tasks/reorder` | ORG_ADMIN, ORG_MANAGER, ORG_MEMBER |
| DELETE | `/tasks/:id` | ORG_ADMIN, ORG_MANAGER |

### Service — regras

**`createTask`:**
- Verifica que `columnId` pertence à organização (via column → board → organizationId).
- Grava `TaskHistory` com `action: 'created'`.
- Chama `enqueueNotification({ event: 'TASK_CREATED', ... })`.

**`moveTask(taskId, { columnId, position }, actor)`:**
- Lookup: task → column → board → organizationId; valida pertencimento.
- Target column: valida que também pertence à mesma organização.
- Em `$transaction`:
  1. `prisma.task.update({ data: { columnId, position } })`
  2. Se `targetColumn.isFinal`: `prisma.task.update({ data: { status: 'DONE' } })`
  3. `prisma.taskHistory.create({ action: 'moved_to', fromValue: fromColumn.title, toValue: toColumn.title, ... })`
- Após transaction: `enqueueNotification({ event: 'TASK_MOVED', ... })`.
- Se `isFinal`: também `enqueueNotification({ event: 'TASK_COMPLETED', ... })`.

**`updateTask`:**
- Grava `TaskHistory` para mudanças de prioridade (`priority_changed`) e assignee (`assigned_to`).

**`reorderTasks`:**
- Bulk update em `$transaction` — valida que todos os task IDs pertencem à organização.

### Schema Zod

```typescript
createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  assigneeId: z.string().cuid().optional(),
  dueDate: z.string().datetime().optional(),
  tags: z.array(z.string()).default([]),
})

moveTaskSchema = z.object({
  columnId: z.string().cuid(),
  position: z.number().int().min(0),
})

reorderTasksSchema = z.array(z.object({
  id: z.string().cuid(),
  position: z.number().int().min(0),
  columnId: z.string().cuid(),
}))
```

---

## Módulo: Comments

### Endpoints

| Método | Path | Role |
|--------|------|------|
| GET | `/tasks/:taskId/comments` | USER (org) ou CLIENT |
| POST | `/tasks/:taskId/comments` | USER (org) ou CLIENT |
| DELETE | `/comments/:id` | autor ou ORG_ADMIN |

### Service — regras

- `authorType` é derivado do JWT: se `role` é `CLIENT` → `authorType: 'CLIENT'`, `clientId: req.user.sub`; caso contrário → `authorType: 'USER'`, `userId: req.user.sub`.
- `GET`: verifica que task pertence à organização do solicitante.
- `DELETE`: verifica que o comentário pertence ao autor (por `userId` ou `clientId`) ou que o solicitante tem role `ORG_ADMIN`.

### Schema Zod

```typescript
createCommentSchema = z.object({ content: z.string().min(1) })
```

---

## Testes

### `checkPlanLimit.test.ts`

Testa o middleware standalone (igual ao padrão de `checkSubscription.test.ts`):

- **passes** quando `clientsCount < plan.maxClients`
- **throws 422** quando `clientsCount >= plan.maxClients`
- **passes** quando `organizationId` é null (MASTER)

### `verifyOrg.test.ts`

Testa o middleware standalone:

- **passes** quando `role === 'MASTER'` (sem param na URL)
- **passes** quando `params.organizationId === user.organizationId`
- **throws 403** quando `params.organizationId !== user.organizationId`
- **passes** quando não há `params.organizationId` na URL

### `tasks.service.test.ts`

Testa a função `moveTask` diretamente (sem HTTP):

- move task: `columnId` e `position` atualizados no banco
- grava `TaskHistory` com `action: 'moved_to'`, `fromValue`, `toValue`
- coluna `isFinal: true` → `task.status === 'DONE'`
- coluna `isFinal: false` → `task.status` mantido

### `tasks.routes.test.ts`

Testa `PATCH /tasks/:id/move` via HTTP (integration):

- 200: move para coluna normal
- 200: move para coluna `isFinal` → response inclui `status: 'DONE'`
- 403: user de org diferente não pode mover
- 404: task inexistente

### `comments.routes.test.ts`

Testa `POST /tasks/:taskId/comments` via HTTP:

- JWT de ORG_MEMBER → `authorType: 'USER'` no banco
- JWT de CLIENT → `authorType: 'CLIENT'` no banco
- 403: CLIENT de outra org não pode comentar

---

## Registro no `server.ts`

Adicionar:

```typescript
import { usersRoutes } from '@/modules/users/users.routes'
import { clientsRoutes } from '@/modules/clients/clients.routes'
import { boardsRoutes } from '@/modules/boards/boards.routes'
import { columnsRoutes } from '@/modules/columns/columns.routes'
import { tasksRoutes } from '@/modules/tasks/tasks.routes'
import { commentsRoutes } from '@/modules/comments/comments.routes'

app.register(usersRoutes, { prefix: '/users' })
app.register(clientsRoutes, { prefix: '/clients' })
app.register(boardsRoutes, { prefix: '/boards' })
app.register(columnsRoutes)   // sem prefix: /boards/:boardId/columns + /columns/:id
app.register(tasksRoutes)     // sem prefix: /columns/:columnId/tasks + /tasks/:id
app.register(commentsRoutes)  // sem prefix: /tasks/:taskId/comments + /comments/:id
```

---

## Checklist de conclusão (critério da Fase 4)

- [ ] CRUD completo de users, clients, boards, columns, tasks, comments funcional
- [ ] `PATCH /tasks/:id/move` seta `status: DONE` quando `isFinal: true`
- [ ] `TaskHistory` gravado em todas as mutações relevantes
- [ ] `checkPlanLimit` bloqueia `POST /clients` ao atingir limite
- [ ] 5 arquivos de teste passando
- [ ] `pnpm --filter api test` verde
