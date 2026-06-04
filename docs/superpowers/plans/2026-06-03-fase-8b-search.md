# Fase 8b: Busca e Filtros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Endpoint `GET /boards/:id/tasks/search` com filtros combinados + barra de busca no board interno e busca de título no portal.

**Architecture:** O endpoint de busca é adicionado em `boards.routes.ts` e chama um novo `searchTasks` em `boards.service.ts`. No frontend o board interno usa um estado de filtros local que, quando preenchido, troca o fetch do board completo pelo endpoint de busca via TanStack Query. O portal usa filtro client-side no array de tasks já carregado.

**Tech Stack:** Backend: Prisma `where` dinâmico, Zod query-string parse. Frontend: TanStack Query, React state.

---

## File Map

**Backend — modificar:**
- `apps/api/src/modules/boards/boards.service.ts` — adicionar `searchTasks(boardId, orgId, filters)`
- `apps/api/src/modules/boards/boards.routes.ts` — adicionar rota `GET /:id/tasks/search`
- `apps/api/src/modules/boards/boards.schema.ts` — adicionar `searchQuerySchema`

**Backend — criar:**
- `apps/api/src/modules/boards/search.routes.test.ts` ← OBRIGATÓRIO

**Frontend — modificar:**
- `apps/web/src/pages/app/Board.tsx` — adicionar barra de busca + filtros
- `apps/web/src/pages/portal/Board.tsx` — adicionar busca por título (client-side)

---

## Task 1: Backend — search endpoint (TDD)

**Files:**
- Create: `apps/api/src/modules/boards/search.routes.test.ts`
- Modify: `apps/api/src/modules/boards/boards.schema.ts`
- Modify: `apps/api/src/modules/boards/boards.service.ts`
- Modify: `apps/api/src/modules/boards/boards.routes.ts`

- [ ] **Step 1: Criar o teste PRIMEIRO**

`apps/api/src/modules/boards/search.routes.test.ts`:
```typescript
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

describe('GET /boards/:id/tasks/search', () => {
  it('returns tasks matching title query', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    await createTestTask(col.id, user.id, { title: 'Abertura LTDA' })
    await createTestTask(col.id, user.id, { title: 'Encerramento SA' })

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'GET',
      url: `/boards/${board.id}/tasks/search?q=Abertura`,
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const tasks = JSON.parse(res.body)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].title).toBe('Abertura LTDA')
  })

  it('filters by priority', async () => {
    const plan = await createTestPlan()
    const org = await createTestOrg(plan.id)
    const user = await createTestUser(org.id)
    const client = await createTestClient(org.id)
    const board = await createTestBoard(org.id, client.id)
    const col = await createTestColumn(board.id, { position: 0 })
    await createTestTask(col.id, user.id, { priority: 'HIGH' })
    await createTestTask(col.id, user.id, { priority: 'LOW' })

    const auth = await getAuthHeader(user.email, 'Test@1234')
    const res = await app.inject({
      method: 'GET',
      url: `/boards/${board.id}/tasks/search?priority=HIGH`,
      headers: { authorization: auth },
    })

    expect(res.statusCode).toBe(200)
    const tasks = JSON.parse(res.body)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].priority).toBe('HIGH')
  })

  it('returns only tasks from the authenticated user org', async () => {
    const plan = await createTestPlan()
    const org1 = await createTestOrg(plan.id)
    const org2 = await createTestOrg(plan.id)
    const user1 = await createTestUser(org1.id)
    const user2 = await createTestUser(org2.id)
    const client1 = await createTestClient(org1.id)
    const board1 = await createTestBoard(org1.id, client1.id)
    const col1 = await createTestColumn(board1.id, { position: 0 })
    await createTestTask(col1.id, user1.id, { title: 'Tarefa Org1' })

    // user2 tries to search board1
    const auth2 = await getAuthHeader(user2.email, 'Test@1234')
    const res = await app.inject({
      method: 'GET',
      url: `/boards/${board1.id}/tasks/search?q=Tarefa`,
      headers: { authorization: auth2 },
    })

    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: Verificar que `createTestTask` aceita overrides de `title` e `priority`**

Ler `apps/api/src/test/helpers.ts` e verificar a assinatura de `createTestTask`. Se ela não aceitar overrides, adicionar o parâmetro opcional:

Assinatura atual esperada: `createTestTask(columnId, userId)`.

Se precisar adicionar overrides, modificar:
```typescript
export async function createTestTask(
  columnId: string,
  creatorId: string,
  overrides?: Partial<{ title: string; priority: string }>,
) {
  return prisma.task.create({
    data: {
      title: overrides?.title ?? 'Test Task',
      priority: (overrides?.priority as Priority) ?? 'MEDIUM',
      position: 0,
      columnId,
      creatorId,
    },
  })
}
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
pnpm --filter api test src/modules/boards/search.routes.test.ts 2>&1 | tail -5
```

Expected: FAIL — rota não existe.

- [ ] **Step 4: Adicionar `searchQuerySchema` em `apps/api/src/modules/boards/boards.schema.ts`**

Ler o arquivo atual e adicionar ao final:
```typescript
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

- [ ] **Step 5: Adicionar `searchTasks` em `apps/api/src/modules/boards/boards.service.ts`**

Ler o arquivo atual e adicionar a função ao final:
```typescript
import type { SearchQuery } from './boards.schema'

export async function searchTasks(boardId: string, organizationId: string, filters: SearchQuery) {
  // Verify board belongs to org
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

**NOTA:** o `import type { SearchQuery }` já está no mesmo arquivo — se houver circular import, importar de `boards.schema.ts` explicitamente.

- [ ] **Step 6: Adicionar rota em `apps/api/src/modules/boards/boards.routes.ts`**

Adicionar o import de `searchTasks` e `searchQuerySchema`:
```typescript
import { listBoards, getBoardById, createBoard, updateBoard, searchTasks } from './boards.service'
import { createBoardSchema, updateBoardSchema, searchQuerySchema } from './boards.schema'
```

Adicionar a rota dentro de `boardsRoutes` (antes do `app.post('/')`):
```typescript
  app.get('/:id/tasks/search', {
    preHandler: [requireRole('ORG_ADMIN', 'ORG_MANAGER', 'ORG_MEMBER')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = searchQuerySchema.safeParse(request.query)
    if (!result.success) throw new AppError(400, result.error.errors[0].message)
    return reply.send(await searchTasks(id, request.user.organizationId!, result.data))
  })
```

- [ ] **Step 7: Rodar — deve passar**

```bash
pnpm --filter api test src/modules/boards/search.routes.test.ts --reporter=verbose 2>&1 | tail -12
```

Expected: 3 testes PASS.

- [ ] **Step 8: Suite completa**

```bash
pnpm --filter api test 2>&1 | tail -5
```

- [ ] **Step 9: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/api/src/modules/boards/ apps/api/src/test/helpers.ts
git -C /home/max/job/autohubs/tramita commit -m "feat: search endpoint — GET /boards/:id/tasks/search com filtros combinados (TDD)"
```

---

## Task 2: Frontend — search bar + filtros

**Files:**
- Modify: `apps/web/src/pages/app/Board.tsx`
- Modify: `apps/web/src/pages/portal/Board.tsx`

- [ ] **Step 1: Atualizar `apps/web/src/pages/app/Board.tsx` — adicionar barra de busca**

Ler o arquivo atual. Adicionar estado de busca e lógica de filtro no topo da função `Board()`:

Adicionar import da api e useQuery no topo (se não existir):
```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Task } from '@/types'
```

Adicionar estado de busca dentro da função `Board()`:
```typescript
const [search, setSearch] = useState('')
const [filterPriority, setFilterPriority] = useState('')

const hasFilters = search.trim() !== '' || filterPriority !== ''

const { data: searchResults } = useQuery<Task[]>({
  queryKey: ['board-search', boardId, search, filterPriority],
  queryFn: () => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('q', search.trim())
    if (filterPriority) params.set('priority', filterPriority)
    return api.get(`/boards/${boardId}/tasks/search?${params}`).then((r) => r.data)
  },
  enabled: !!boardId && hasFilters,
})
```

Adicionar a barra de busca no JSX, logo após o header (`</div>` do header), antes do board container:
```typescript
{/* Search bar */}
<div className="flex items-center gap-3 px-6 py-2 border-b border-gray-100 bg-white">
  <input
    type="text"
    placeholder="Buscar tarefas..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    className="flex-1 h-8 rounded-md border border-gray-300 bg-white px-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
  />
  <select
    value={filterPriority}
    onChange={(e) => setFilterPriority(e.target.value)}
    className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
  >
    <option value="">Prioridade</option>
    <option value="LOW">Baixa</option>
    <option value="MEDIUM">Média</option>
    <option value="HIGH">Alta</option>
    <option value="URGENT">Urgente</option>
  </select>
  {hasFilters && (
    <button
      onClick={() => { setSearch(''); setFilterPriority('') }}
      className="text-xs text-gray-500 hover:text-gray-700 underline"
    >
      Limpar
    </button>
  )}
</div>
```

Quando `hasFilters` for true, mostrar os resultados da busca como uma lista acima do board (ou em vez das colunas). Adicionar bloco antes do `<div className="flex-1 overflow-x-auto p-6">`:

```typescript
{hasFilters && searchResults && (
  <div className="px-6 py-4 border-b border-gray-100 bg-yellow-50">
    <p className="text-xs text-gray-500 mb-3">{searchResults.length} resultado(s)</p>
    <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
      {searchResults.map((task) => (
        <div
          key={task.id}
          onClick={() => setSelectedTask(task)}
          className="bg-white rounded-lg p-3 border border-gray-200 cursor-pointer hover:shadow-sm text-sm"
        >
          <span className="font-medium text-gray-800">{task.title}</span>
          <span className="ml-2 text-xs text-gray-400">{task.priority}</span>
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 2: Atualizar `apps/web/src/pages/portal/Board.tsx` — busca client-side por título**

Ler o arquivo atual. Adicionar estado de busca e filtro no array de colunas:

Adicionar import `useState` (se não existir já):
```typescript
import { useState } from 'react'
```

Adicionar estado dentro da função `PortalBoard()`:
```typescript
const [titleSearch, setTitleSearch] = useState('')
```

Filtrar colunas para mostrar apenas tasks que correspondem à busca:
```typescript
const filteredColumns = board.columns.map((col) => ({
  ...col,
  tasks: titleSearch.trim()
    ? col.tasks.filter((t) => t.title.toLowerCase().includes(titleSearch.toLowerCase()))
    : col.tasks,
}))
```

Adicionar barra de busca no JSX, após o header:
```typescript
{/* Simple title search */}
<div className="px-6 py-2 border-b border-gray-100 bg-white">
  <input
    type="text"
    placeholder="Buscar por título..."
    value={titleSearch}
    onChange={(e) => setTitleSearch(e.target.value)}
    className="w-full h-8 rounded-md border border-gray-300 bg-white px-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
  />
</div>
```

E substituir `board.columns.map(...)` por `filteredColumns.map(...)` na renderização das colunas.

- [ ] **Step 3: Verificar build**

```bash
pnpm --filter web build 2>&1 | tail -5
```

- [ ] **Step 4: Rodar testes frontend**

```bash
pnpm --filter web test 2>&1 | tail -5
```

Expected: 12 passando.

- [ ] **Step 5: Commit**

```bash
git -C /home/max/job/autohubs/tramita add apps/web/src/pages/app/Board.tsx apps/web/src/pages/portal/Board.tsx
git -C /home/max/job/autohubs/tramita commit -m "feat: search UI — barra de busca+filtros no board interno, busca client-side no portal"
```

---

## Task 3: TASKS.md

- [ ] **Step 1: Rodar suites**

```bash
pnpm --filter api test 2>&1 | tail -5 && pnpm --filter web test 2>&1 | tail -5
```

- [ ] **Step 2: Atualizar TASKS.md**

Marcar o teste `search.routes.test.ts` no header da Fase 8:
```markdown
- [x] `search.routes.test.ts` — filtros combinados retornam apenas tarefas da org correta
```

Marcar `### 8b — Busca e Filtros` como `✅` e todos os itens como `[x]`.

- [ ] **Step 3: Commit**

```bash
git -C /home/max/job/autohubs/tramita add docs/TASKS.md
git -C /home/max/job/autohubs/tramita commit -m "docs: Fase 8b Busca concluída no TASKS.md"
```

---

## Self-Review

### Spec coverage
| Requisito | Task |
|---|---|
| `search.routes.test.ts` — filtros combinados, org correta | Task 1 |
| `GET /boards/:id/tasks/search?q=&priority=&status=&assigneeId=&dueBefore=&dueAfter=` | Task 1 |
| Frontend: barra de busca + filtros no board interno | Task 2 |
| Portal: busca por título de tarefa | Task 2 |

### Type consistency
`SearchQuery` inferred from `searchQuerySchema` — mesmos campos nos três pontos de uso (schema, service, route).
